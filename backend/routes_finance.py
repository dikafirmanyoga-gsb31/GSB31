from datetime import date
from typing import Optional, Literal

from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel, Field

from core import (db, require, current_user, has_perm, audit, new_id, now_iso, today_jkt, get_settings, partner_map,
                  ensure_partner, MAX_USERS)
from routes_business import strip_fin, quotation_out
from routes_docs import list_reminders_data, validity, days_left
from routes_users import quota

router = APIRouter()


class TxIn(BaseModel):
    type: Literal["pemasukan", "pengeluaran"]
    date: date
    category: str = Field(min_length=1, max_length=60)
    amount: float = Field(gt=0, le=1e13)
    description: str = Field(min_length=2, max_length=500)
    partner_id: Optional[str] = None
    kopra_activity_id: Optional[str] = None
    quotation_id: Optional[str] = None
    reference_no: Optional[str] = Field(None, max_length=60)


class VoidIn(BaseModel):
    reason: str = Field(min_length=3, max_length=300)


async def validate_tx(body: TxIn):
    s = await get_settings()
    cats = s["income_categories"] if body.type == "pemasukan" else s["expense_categories"]
    if body.category not in cats:
        raise HTTPException(400, "Kategori transaksi tidak valid.")
    await ensure_partner(body.partner_id)
    if body.kopra_activity_id and not await db.kopra.find_one({"id": body.kopra_activity_id}, {"_id": 1}):
        raise HTTPException(400, "Kegiatan kopra terkait tidak ditemukan.")
    if body.quotation_id and not await db.quotations.find_one({"id": body.quotation_id}, {"_id": 1}):
        raise HTTPException(400, "Penawaran terkait tidak ditemukan.")


def date_filter(date_from: str, date_to: str) -> dict:
    if not (date_from or date_to):
        return {}
    return {"date": {**({"$gte": date_from} if date_from else {}), **({"$lte": date_to} if date_to else {})}}


async def summarize(date_from: str = "", date_to: str = "") -> dict:
    f = {"is_void": {"$ne": True}, **date_filter(date_from, date_to)}
    income = expense = 0.0
    by_cat, monthly = {}, {}
    async for t in db.transactions.find(f, {"_id": 0, "type": 1, "amount": 1, "category": 1, "date": 1}):
        a = t["amount"]
        if t["type"] == "pemasukan":
            income += a
        else:
            expense += a
        k = (t["type"], t["category"])
        by_cat[k] = by_cat.get(k, 0) + a
        m = monthly.setdefault(t["date"][:7], {"month": t["date"][:7], "pemasukan": 0, "pengeluaran": 0})
        m[t["type"]] += a
    return {"income": round(income, 2), "expense": round(expense, 2), "net": round(income - expense, 2),
            "count": await db.transactions.count_documents(f),
            "by_category": [{"type": k[0], "category": k[1], "amount": round(v, 2)} for k, v in sorted(by_cat.items(), key=lambda x: -x[1])],
            "monthly": sorted(monthly.values(), key=lambda x: x["month"])}


@router.get("/finance/transactions")
async def list_tx(type: str = "", category: str = "", date_from: str = "", date_to: str = "", include_void: bool = False,
                  user=Depends(require("finance"))):
    f = date_filter(date_from, date_to)
    if type:
        f["type"] = type
    if category:
        f["category"] = category
    if not include_void:
        f["is_void"] = {"$ne": True}
    items = [t async for t in db.transactions.find(f, {"_id": 0}).sort([("date", -1), ("created_at", -1)]).limit(2000)]
    names = await partner_map(i.get("partner_id") for i in items)
    for i in items:
        i["partner_name"] = names.get(i.get("partner_id"))
    return items


@router.post("/finance/transactions")
async def create_tx(body: TxIn, user=Depends(require("finance"))):
    await validate_tx(body)
    doc = {"id": new_id(), **body.model_dump(mode="json"), "amount": round(body.amount, 2), "is_void": False,
           "created_at": now_iso(), "created_by": user["id"], "created_by_name": user["name"]}
    await db.transactions.insert_one(doc)
    await audit(user, "finance_created", "transaction", doc["id"], detail=f"{body.type} {doc['amount']}")
    doc.pop("_id", None)
    return doc


@router.put("/finance/transactions/{tid}")
async def update_tx(tid: str, body: TxIn, user=Depends(require("finance"))):
    t = await db.transactions.find_one({"id": tid}, {"_id": 0})
    if not t:
        raise HTTPException(404, "Transaksi tidak ditemukan.")
    if t.get("is_void"):
        raise HTTPException(400, "Transaksi yang dibatalkan tidak dapat diedit.")
    await validate_tx(body)
    await db.transactions.update_one({"id": tid}, {"$set": {**body.model_dump(mode="json"), "amount": round(body.amount, 2),
                                                            "updated_at": now_iso(), "updated_by": user["id"]}})
    await audit(user, "finance_updated", "transaction", tid, detail=f"{t['amount']} -> {round(body.amount, 2)}")
    return await db.transactions.find_one({"id": tid}, {"_id": 0})


@router.post("/finance/transactions/{tid}/void")
async def void_tx(tid: str, body: VoidIn, user=Depends(require("director"))):
    t = await db.transactions.find_one({"id": tid}, {"_id": 0})
    if not t or t.get("is_void"):
        raise HTTPException(404, "Transaksi tidak ditemukan.")
    await db.transactions.update_one({"id": tid}, {"$set": {"is_void": True, "void_reason": body.reason,
                                                            "voided_by": user["id"], "voided_at": now_iso()}})
    await audit(user, "finance_voided", "transaction", tid, detail=body.reason)
    return {"ok": True}


@router.get("/finance/summary")
async def finance_summary(date_from: str = "", date_to: str = "", user=Depends(require("finance"))):
    return await summarize(date_from, date_to)


def month_range():
    t = today_jkt()
    return t.replace(day=1).isoformat(), t.isoformat()


@router.get("/dashboard")
async def dashboard(user=Depends(current_user)):
    s = await get_settings()
    mw = max(s["reminder_windows"])
    m_from, m_to = month_range()
    partners = {k: await db.partners.count_documents({"types": k}) for k in ("pelanggan", "pemasok", "mitra")}
    q_counts = {}
    async for q in db.quotations.find({}, {"_id": 0, "status": 1, "valid_until": 1}):
        st = quotation_out(q)["effective_status"]
        q_counts[st] = q_counts.get(st, 0) + 1
    contracts = {"aktif": 0, "segera": 0, "kedaluwarsa": 0}
    expiring = []
    async for d in db.documents.find({"status": "aktif"}, {"_id": 0, "id": 1, "name": 1, "kind": 1, "expiry_date": 1, "status": 1}):
        v = validity(d, mw)
        if d["kind"] == "kontrak":
            contracts["aktif"] += 1
            if v in contracts:
                contracts[v] += 1
        if v in ("segera", "kedaluwarsa"):
            expiring.append({**d, "validity": v, "days_left": days_left(d["expiry_date"])})
    expiring.sort(key=lambda x: x["days_left"])
    reminders = await list_reminders_data("open", "active")
    recent = [strip_fin(k, user) async for k in db.kopra.find({}, {"_id": 0}).sort([("date", -1), ("created_at", -1)]).limit(6)]
    names = await partner_map(k.get("partner_id") for k in recent)
    for k in recent:
        k["partner_name"] = names.get(k.get("partner_id"))
    kopra_month = [{"activity_type": g["_id"]["t"], "unit": g["_id"]["u"], "quantity": g["q"], "count": g["n"]}
                   async for g in db.kopra.aggregate([
                       {"$match": {"date": {"$gte": m_from, "$lte": m_to}, "status": {"$ne": "dibatalkan"}}},
                       {"$group": {"_id": {"t": "$activity_type", "u": "$unit"}, "q": {"$sum": "$quantity"}, "n": {"$sum": 1}}}])]
    out = {
        "partners": partners, "quotations": q_counts, "contracts": contracts,
        "documents_total": await db.documents.count_documents({"status": "aktif"}),
        "expiring": expiring[:8], "reminders": reminders[:8],
        "reminders_overdue": sum(1 for r in reminders if r["level"] == "terlambat"),
        "reminders_open": len(reminders), "recent_kopra": recent, "kopra_month": kopra_month,
        "period": {"from": m_from, "to": m_to},
    }
    if has_perm(user, "finance"):
        out["finance"] = {"month": await summarize(m_from, m_to)}
    return out


@router.get("/director/summary")
async def director_summary(user=Depends(require("director"))):
    t = today_jkt()
    y_from = t.replace(month=1, day=1).isoformat()
    m_from, m_to = month_range()
    pending = [quotation_out(q) async for q in db.quotations.find({"status": "pending"}, {"_id": 0, "items": 0, "history": 0}).sort("created_at", 1)]
    names = await partner_map(q["partner_id"] for q in pending)
    for q in pending:
        q["partner_name"] = names.get(q["partner_id"])
    top = [x async for x in db.transactions.aggregate([
        {"$match": {"is_void": {"$ne": True}, "type": "pemasukan", "date": {"$gte": y_from}, "partner_id": {"$nin": [None, ""]}}},
        {"$group": {"_id": "$partner_id", "amount": {"$sum": "$amount"}}}, {"$sort": {"amount": -1}}, {"$limit": 5}])]
    pnames = await partner_map(x["_id"] for x in top)
    kopra_year = [{"activity_type": g["_id"]["t"], "unit": g["_id"]["u"], "quantity": g["q"], "value": g["v"]}
                  async for g in db.kopra.aggregate([
                      {"$match": {"date": {"$gte": y_from}, "status": {"$ne": "dibatalkan"}}},
                      {"$group": {"_id": {"t": "$activity_type", "u": "$unit"}, "q": {"$sum": "$quantity"},
                                  "v": {"$sum": {"$ifNull": ["$total_value", 0]}}}}])]
    return {
        "year": t.year, "finance_year": await summarize(y_from, t.isoformat()), "finance_month": await summarize(m_from, m_to),
        "finance_all": await summarize(), "pending_approvals": pending,
        "top_customers": [{"partner_id": x["_id"], "name": pnames.get(x["_id"]), "amount": round(x["amount"], 2)} for x in top],
        "kopra_year": kopra_year, "users": await quota(), "max_users": MAX_USERS,
    }


@router.get("/audit-logs")
async def audit_logs(action: str = "", user_id: str = "", result: str = "", date_from: str = "", date_to: str = "",
                     limit: int = 50, skip: int = 0, user=Depends(require("director"))):
    f = {}
    if action:
        f["action"] = action
    if user_id:
        f["user_id"] = user_id
    if result:
        f["result"] = result
    if date_from or date_to:
        f["at"] = {**({"$gte": date_from} if date_from else {}), **({"$lte": date_to + "T99"} if date_to else {})}
    limit = max(1, min(limit, 200))
    items = [a async for a in db.audit_logs.find(f, {"_id": 0}).sort("at", -1).skip(max(0, skip)).limit(limit)]
    actions = await db.audit_logs.distinct("action")
    return {"items": items, "total": await db.audit_logs.count_documents(f), "actions": sorted(actions)}
