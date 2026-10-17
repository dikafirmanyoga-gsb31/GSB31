import re
from datetime import date
from typing import Optional, List, Literal

from fastapi import APIRouter, HTTPException, Depends, Request
from pydantic import BaseModel, Field
from pymongo.errors import DuplicateKeyError

from core import (db, require, current_user, has_perm, deny, audit, new_id, now_iso, today_jkt, norm_key, rx,
                  get_settings, partner_map, ensure_partner)

router = APIRouter()
FIN_FIELDS = ("price_per_unit", "total_value")


# ---------- Settings & company ----------
class CompanyIn(BaseModel):
    name: str = Field(min_length=2, max_length=150)
    director: str = Field(min_length=2, max_length=100)
    address: str = Field("", max_length=300)
    phone: str = Field("", max_length=40)
    email: str = Field("", max_length=120)
    npwp: str = Field("", max_length=40)
    website: str = Field("", max_length=120)


class SettingsIn(BaseModel):
    reminder_windows: Optional[List[int]] = Field(None, min_length=1, max_length=5)
    quotation_approver_roles: Optional[List[Literal["director", "opfin"]]] = None
    email_reminders_enabled: Optional[bool] = None
    kopra_activity_types: Optional[List[str]] = Field(None, min_length=1, max_length=20)
    kopra_units: Optional[List[str]] = Field(None, min_length=1, max_length=20)
    document_categories: Optional[List[str]] = Field(None, min_length=1, max_length=30)
    income_categories: Optional[List[str]] = Field(None, min_length=1, max_length=30)
    expense_categories: Optional[List[str]] = Field(None, min_length=1, max_length=30)
    company: Optional[CompanyIn] = None


@router.get("/settings")
async def read_settings(user=Depends(current_user)):
    return await get_settings()


@router.put("/settings")
async def update_settings(body: SettingsIn, user=Depends(require("director"))):
    data = body.model_dump(exclude_none=True)
    if "reminder_windows" in data:
        w = sorted({int(x) for x in data["reminder_windows"]}, reverse=True)
        if any(x < 1 or x > 365 for x in w):
            raise HTTPException(400, "Periode pengingat harus antara 1 dan 365 hari.")
        data["reminder_windows"] = w
    if "quotation_approver_roles" in data:
        data["quotation_approver_roles"] = sorted(set(data["quotation_approver_roles"]) | {"director"})
    for k in ("kopra_activity_types", "kopra_units", "document_categories", "income_categories", "expense_categories"):
        if k in data:
            vals = [v.strip()[:60] for v in data[k] if v.strip()]
            if not vals:
                raise HTTPException(400, "Daftar pilihan tidak boleh kosong.")
            data[k] = list(dict.fromkeys(vals))
    await db.settings.update_one({"id": "app"}, {"$set": data}, upsert=True)
    await audit(user, "settings_updated", "settings", "app", detail=", ".join(data.keys()))
    return await get_settings()


@router.get("/company")
async def company(user=Depends(current_user)):
    return (await get_settings())["company"]


class AccessIn(BaseModel):
    feature: Literal["finance", "director"]


@router.post("/access/check")
async def access_check(body: AccessIn, request: Request, user=Depends(current_user)):
    if not has_perm(user, body.feature):
        await deny(user, body.feature, f"menu:{body.feature}")
    return {"ok": True}


# ---------- Partners ----------
class PartnerIn(BaseModel):
    name: str = Field(min_length=2, max_length=150)
    types: List[Literal["pelanggan", "pemasok", "mitra"]] = Field(min_length=1)
    contact_person: Optional[str] = Field(None, max_length=100)
    phone: Optional[str] = Field(None, max_length=40)
    email: Optional[str] = Field(None, max_length=120)
    address: Optional[str] = Field(None, max_length=300)
    location: Optional[str] = Field(None, max_length=120)
    notes: Optional[str] = Field(None, max_length=2000)
    is_active: bool = True


@router.get("/partners")
async def list_partners(q: str = "", type: str = "", user=Depends(require("ops"))):
    f = {}
    if q.strip():
        f["$or"] = [{"name": rx(q)}, {"contact_person": rx(q)}, {"location": rx(q)}, {"phone": rx(q)}]
    if type:
        f["types"] = type
    return [p async for p in db.partners.find(f, {"_id": 0, "name_key": 0}).sort("name", 1).limit(1000)]


@router.post("/partners")
async def create_partner(body: PartnerIn, user=Depends(require("ops"))):
    doc = {"id": new_id(), **body.model_dump(), "name": body.name.strip(), "name_key": norm_key(body.name),
           "created_at": now_iso(), "created_by": user["id"]}
    try:
        await db.partners.insert_one(doc)
    except DuplicateKeyError:
        raise HTTPException(409, "Mitra dengan nama tersebut sudah terdaftar.")
    await audit(user, "partner_created", "partner", doc["id"], detail=doc["name"])
    doc.pop("_id", None)
    doc.pop("name_key", None)
    return doc


@router.put("/partners/{pid}")
async def update_partner(pid: str, body: PartnerIn, user=Depends(require("ops"))):
    data = {**body.model_dump(), "name": body.name.strip(), "name_key": norm_key(body.name), "updated_at": now_iso()}
    try:
        r = await db.partners.update_one({"id": pid}, {"$set": data})
    except DuplicateKeyError:
        raise HTTPException(409, "Mitra dengan nama tersebut sudah terdaftar.")
    if not r.matched_count:
        raise HTTPException(404, "Mitra tidak ditemukan.")
    await audit(user, "partner_updated", "partner", pid, detail=data["name"])
    return await db.partners.find_one({"id": pid}, {"_id": 0, "name_key": 0})


@router.get("/partners/{pid}")
async def partner_detail(pid: str, user=Depends(require("ops"))):
    p = await db.partners.find_one({"id": pid}, {"_id": 0, "name_key": 0})
    if not p:
        raise HTTPException(404, "Mitra tidak ditemukan.")
    proj = {"_id": 0, "id": 1, "number": 1, "date": 1, "status": 1, "valid_until": 1, "total": 1}
    p["quotations"] = [quotation_out(q) async for q in db.quotations.find({"partner_id": pid}, proj).sort("date", -1)]
    p["documents"] = [d async for d in db.documents.find({"partner_id": pid}, {"_id": 0, "id": 1, "name": 1, "kind": 1, "category": 1, "expiry_date": 1, "status": 1}).sort("created_at", -1)]
    p["kopra"] = [strip_fin(k, user) async for k in db.kopra.find({"partner_id": pid}, {"_id": 0}).sort("date", -1).limit(50)]
    return p


# ---------- Kopra ----------
class KopraIn(BaseModel):
    activity_type: str = Field(min_length=1, max_length=60)
    date: date
    partner_id: Optional[str] = None
    location: Optional[str] = Field(None, max_length=150)
    quantity: float = Field(gt=0, le=1e9)
    unit: str = Field(min_length=1, max_length=20)
    status: Literal["rencana", "berjalan", "selesai", "dibatalkan"] = "rencana"
    reference_no: Optional[str] = Field(None, max_length=60)
    notes: Optional[str] = Field(None, max_length=2000)
    price_per_unit: Optional[float] = Field(None, ge=0, le=1e12)


def strip_fin(doc: dict, user: dict) -> dict:
    if not has_perm(user, "finance"):
        for f in FIN_FIELDS:
            doc.pop(f, None)
    return doc


async def validate_kopra(body: KopraIn):
    s = await get_settings()
    if body.activity_type not in s["kopra_activity_types"]:
        raise HTTPException(400, "Jenis kegiatan tidak valid.")
    if body.unit not in s["kopra_units"]:
        raise HTTPException(400, "Satuan tidak valid.")
    await ensure_partner(body.partner_id)


def kopra_data(body: KopraIn, user: dict, existing: Optional[dict] = None) -> dict:
    data = body.model_dump(mode="json")
    if has_perm(user, "finance"):
        p = data.get("price_per_unit")
        data["total_value"] = round(p * body.quantity, 2) if p is not None else None
    else:
        data.pop("price_per_unit", None)
        if existing and existing.get("price_per_unit") is not None:
            data["total_value"] = round(existing["price_per_unit"] * body.quantity, 2)
    return data


@router.get("/kopra")
async def list_kopra(activity_type: str = "", status: str = "", partner_id: str = "", date_from: str = "",
                     date_to: str = "", q: str = "", user=Depends(require("ops"))):
    f = {}
    if activity_type:
        f["activity_type"] = activity_type
    if status:
        f["status"] = status
    if partner_id:
        f["partner_id"] = partner_id
    if date_from or date_to:
        f["date"] = {**({"$gte": date_from} if date_from else {}), **({"$lte": date_to} if date_to else {})}
    if q.strip():
        f["$or"] = [{"location": rx(q)}, {"reference_no": rx(q)}, {"notes": rx(q)}]
    items = [strip_fin(k, user) async for k in db.kopra.find(f, {"_id": 0}).sort("date", -1).limit(1000)]
    names = await partner_map(i.get("partner_id") for i in items)
    for i in items:
        i["partner_name"] = names.get(i.get("partner_id"))
    return items


@router.post("/kopra")
async def create_kopra(body: KopraIn, user=Depends(require("ops"))):
    await validate_kopra(body)
    doc = {"id": new_id(), **kopra_data(body, user), "created_at": now_iso(), "created_by": user["id"]}
    await db.kopra.insert_one(doc)
    await audit(user, "kopra_created", "kopra", doc["id"], detail=f"{body.activity_type} {body.quantity} {body.unit}")
    doc.pop("_id", None)
    return strip_fin(doc, user)


@router.put("/kopra/{kid}")
async def update_kopra(kid: str, body: KopraIn, user=Depends(require("ops"))):
    existing = await db.kopra.find_one({"id": kid}, {"_id": 0})
    if not existing:
        raise HTTPException(404, "Kegiatan tidak ditemukan.")
    await validate_kopra(body)
    await db.kopra.update_one({"id": kid}, {"$set": {**kopra_data(body, user, existing), "updated_at": now_iso()}})
    await audit(user, "kopra_updated", "kopra", kid)
    return strip_fin(await db.kopra.find_one({"id": kid}, {"_id": 0}), user)


# ---------- Quotations ----------
class QItem(BaseModel):
    description: str = Field(min_length=1, max_length=300)
    quantity: float = Field(gt=0, le=1e9)
    unit: str = Field(min_length=1, max_length=20)
    unit_price: float = Field(ge=0, le=1e12)


class QuotationIn(BaseModel):
    number: str = Field(min_length=3, max_length=60)
    date: date
    valid_until: date
    partner_id: str
    subject: Optional[str] = Field(None, max_length=200)
    items: List[QItem] = Field(min_length=1, max_length=50)
    tax_percent: float = Field(0, ge=0, le=100)
    terms: Optional[str] = Field(None, max_length=5000)
    notes: Optional[str] = Field(None, max_length=2000)


class StatusIn(BaseModel):
    status: Literal["draft", "pending", "approved", "rejected", "sent"]
    note: Optional[str] = Field(None, max_length=500)


TRANSITIONS = {("draft", "pending"): "ops", ("pending", "draft"): "ops", ("pending", "approved"): "approve",
               ("pending", "rejected"): "approve", ("rejected", "draft"): "ops", ("approved", "sent"): "ops"}
ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII"]


def quotation_out(q: dict) -> dict:
    q["effective_status"] = q["status"]
    if q["status"] in ("pending", "approved", "sent") and q.get("valid_until") and q["valid_until"] < today_jkt().isoformat():
        q["effective_status"] = "expired"
    return q


def compute_totals(body: QuotationIn) -> dict:
    items = []
    for it in body.items:
        d = it.model_dump()
        d["description"] = d["description"].strip()
        d["amount"] = round(it.quantity * it.unit_price, 2)
        items.append(d)
    subtotal = round(sum(i["amount"] for i in items), 2)
    tax = round(subtotal * body.tax_percent / 100, 2)
    return {"items": items, "subtotal": subtotal, "tax_amount": tax, "total": round(subtotal + tax, 2)}


async def validate_quotation(body: QuotationIn):
    if body.valid_until < body.date:
        raise HTTPException(400, "Tanggal masa berlaku tidak boleh sebelum tanggal penawaran.")
    if not await db.partners.find_one({"id": body.partner_id}, {"_id": 1}):
        raise HTTPException(400, "Pelanggan yang dipilih tidak ditemukan.")


@router.get("/quotations/next-number")
async def next_number(user=Depends(require("ops"))):
    t = today_jkt()
    prefix = f"/GSB/PNW/{ROMAN[t.month - 1]}/{t.year}"
    n = await db.quotations.count_documents({"number": {"$regex": re.escape(prefix) + "$"}})
    while True:
        n += 1
        num = f"{n:03d}{prefix}"
        if not await db.quotations.find_one({"number": num}, {"_id": 1}):
            return {"number": num}


@router.get("/quotations")
async def list_quotations(q: str = "", status: str = "", partner_id: str = "", user=Depends(require("ops"))):
    f = {}
    if q.strip():
        f["$or"] = [{"number": rx(q)}, {"subject": rx(q)}]
    if partner_id:
        f["partner_id"] = partner_id
    items = [quotation_out(x) async for x in db.quotations.find(f, {"_id": 0, "items": 0, "history": 0}).sort("created_at", -1).limit(1000)]
    if status:
        items = [i for i in items if i["effective_status"] == status]
    names = await partner_map(i["partner_id"] for i in items)
    for i in items:
        i["partner_name"] = names.get(i["partner_id"])
    return items


@router.get("/quotations/{qid}")
async def get_quotation(qid: str, user=Depends(require("ops"))):
    x = await db.quotations.find_one({"id": qid}, {"_id": 0})
    if not x:
        raise HTTPException(404, "Penawaran tidak ditemukan.")
    x["partner"] = await db.partners.find_one({"id": x["partner_id"]}, {"_id": 0, "name_key": 0})
    x["documents"] = [d async for d in db.documents.find({"quotation_id": qid}, {"_id": 0, "id": 1, "name": 1, "kind": 1, "number": 1})]
    s = await get_settings()
    x["can_approve"] = user["role"] in s["quotation_approver_roles"]
    return quotation_out(x)


@router.post("/quotations")
async def create_quotation(body: QuotationIn, user=Depends(require("ops"))):
    await validate_quotation(body)
    doc = {"id": new_id(), **body.model_dump(mode="json"), **compute_totals(body), "number": body.number.strip(),
           "status": "draft", "created_at": now_iso(), "created_by": user["id"], "created_by_name": user["name"],
           "history": [{"status": "draft", "by": user["id"], "by_name": user["name"], "at": now_iso(), "note": "Dibuat"}]}
    try:
        await db.quotations.insert_one(doc)
    except DuplicateKeyError:
        raise HTTPException(409, "Nomor penawaran sudah digunakan.")
    await audit(user, "quotation_created", "quotation", doc["id"], detail=doc["number"])
    doc.pop("_id", None)
    return quotation_out(doc)


@router.put("/quotations/{qid}")
async def update_quotation(qid: str, body: QuotationIn, user=Depends(require("ops"))):
    x = await db.quotations.find_one({"id": qid}, {"_id": 0})
    if not x:
        raise HTTPException(404, "Penawaran tidak ditemukan.")
    if x["status"] not in ("draft", "rejected"):
        raise HTTPException(400, "Hanya penawaran berstatus Draft atau Ditolak yang dapat diedit.")
    await validate_quotation(body)
    data = {**body.model_dump(mode="json"), **compute_totals(body), "number": body.number.strip(), "status": "draft",
            "updated_at": now_iso()}
    hist = {"status": "draft", "by": user["id"], "by_name": user["name"], "at": now_iso(), "note": "Diedit"}
    try:
        await db.quotations.update_one({"id": qid}, {"$set": data, "$push": {"history": hist}})
    except DuplicateKeyError:
        raise HTTPException(409, "Nomor penawaran sudah digunakan.")
    await audit(user, "quotation_updated", "quotation", qid, detail=data["number"])
    return await get_quotation(qid, user)


@router.post("/quotations/{qid}/status")
async def change_status(qid: str, body: StatusIn, request: Request, user=Depends(require("ops"))):
    x = await db.quotations.find_one({"id": qid}, {"_id": 0})
    if not x:
        raise HTTPException(404, "Penawaran tidak ditemukan.")
    need = TRANSITIONS.get((x["status"], body.status))
    if not need:
        raise HTTPException(400, "Perubahan status tersebut tidak diizinkan.")
    if need == "approve":
        s = await get_settings()
        if user["role"] not in s["quotation_approver_roles"]:
            await deny(user, "director", request.url.path)
    if body.status in ("approved", "sent") and quotation_out(dict(x))["effective_status"] == "expired":
        raise HTTPException(400, "Penawaran sudah kedaluwarsa. Kembalikan ke Draft dan perbarui masa berlaku.")
    hist = {"status": body.status, "by": user["id"], "by_name": user["name"], "at": now_iso(), "note": body.note}
    sets = {"status": body.status, "updated_at": now_iso()}
    if body.status in ("approved", "rejected"):
        sets.update({"decided_by": user["id"], "decided_by_name": user["name"], "decided_at": now_iso()})
    await db.quotations.update_one({"id": qid}, {"$set": sets, "$push": {"history": hist}})
    await audit(user, "quotation_status_changed", "quotation", qid, detail=f"{x['number']}: {x['status']} -> {body.status}")
    return await get_quotation(qid, user)
