import asyncio
from datetime import date
from typing import Optional, Literal

from fastapi import APIRouter, HTTPException, Depends, UploadFile, File
from fastapi.responses import Response
from pydantic import BaseModel, Field
from pymongo.errors import DuplicateKeyError

from core import (db, require, audit, new_id, now_iso, today_jkt, rx, get_settings, partner_map, ensure_partner, logger)
from storage import put_object, get_object, APP_NAME

router = APIRouter()
ALLOWED = {"pdf": "application/pdf", "jpg": "image/jpeg", "jpeg": "image/jpeg", "png": "image/png", "webp": "image/webp"}
MAX_FILE = 10 * 1024 * 1024


class DocumentIn(BaseModel):
    kind: Literal["dokumen", "kontrak"] = "dokumen"
    name: str = Field(min_length=2, max_length=200)
    number: Optional[str] = Field(None, max_length=80)
    category: str = Field(min_length=1, max_length=60)
    issue_date: Optional[date] = None
    expiry_date: Optional[date] = None
    partner_id: Optional[str] = None
    quotation_id: Optional[str] = None
    kopra_activity_id: Optional[str] = None
    status: Literal["aktif", "arsip"] = "aktif"
    storage_location: Optional[str] = Field(None, max_length=200)
    notes: Optional[str] = Field(None, max_length=2000)


def days_left(d: Optional[str]):
    if not d:
        return None
    return (date.fromisoformat(d) - today_jkt()).days


def validity(doc: dict, max_window: int) -> str:
    if doc.get("status") == "arsip":
        return "arsip"
    dl = days_left(doc.get("expiry_date"))
    if dl is None:
        return "tanpa_batas"
    if dl < 0:
        return "kedaluwarsa"
    return "segera" if dl <= max_window else "berlaku"


async def validate_doc(body: DocumentIn):
    s = await get_settings()
    if body.category not in s["document_categories"]:
        raise HTTPException(400, "Kategori dokumen tidak valid.")
    if body.issue_date and body.expiry_date and body.expiry_date < body.issue_date:
        raise HTTPException(400, "Tanggal kedaluwarsa tidak boleh sebelum tanggal terbit.")
    await ensure_partner(body.partner_id)
    if body.quotation_id and not await db.quotations.find_one({"id": body.quotation_id}, {"_id": 1}):
        raise HTTPException(400, "Penawaran terkait tidak ditemukan.")


@router.get("/documents")
async def list_documents(kind: str = "", category: str = "", state: str = "", q: str = "", partner_id: str = "",
                         user=Depends(require("ops"))):
    f = {}
    if kind:
        f["kind"] = kind
    if category:
        f["category"] = category
    if partner_id:
        f["partner_id"] = partner_id
    if q.strip():
        f["$or"] = [{"name": rx(q)}, {"number": rx(q)}, {"notes": rx(q)}]
    mw = max((await get_settings())["reminder_windows"])
    items = []
    async for d in db.documents.find(f, {"_id": 0}).sort("created_at", -1).limit(1000):
        d["validity"] = validity(d, mw)
        d["days_left"] = days_left(d.get("expiry_date"))
        if not state or d["validity"] == state:
            items.append(d)
    names = await partner_map(i.get("partner_id") for i in items)
    counts = {}
    async for fl in db.files.aggregate([{"$match": {"is_deleted": False}}, {"$group": {"_id": "$document_id", "n": {"$sum": 1}}}]):
        counts[fl["_id"]] = fl["n"]
    for i in items:
        i["partner_name"] = names.get(i.get("partner_id"))
        i["file_count"] = counts.get(i["id"], 0)
    return items


@router.get("/documents/{did}")
async def get_document(did: str, user=Depends(require("ops"))):
    d = await db.documents.find_one({"id": did}, {"_id": 0})
    if not d:
        raise HTTPException(404, "Dokumen tidak ditemukan.")
    mw = max((await get_settings())["reminder_windows"])
    d["validity"] = validity(d, mw)
    d["days_left"] = days_left(d.get("expiry_date"))
    d["files"] = [f async for f in db.files.find({"document_id": did, "is_deleted": False}, {"_id": 0, "storage_path": 0})]
    names = await partner_map([d.get("partner_id")])
    d["partner_name"] = names.get(d.get("partner_id"))
    if d.get("quotation_id"):
        qq = await db.quotations.find_one({"id": d["quotation_id"]}, {"_id": 0, "number": 1})
        d["quotation_number"] = qq["number"] if qq else None
    return d


@router.post("/documents")
async def create_document(body: DocumentIn, user=Depends(require("ops"))):
    await validate_doc(body)
    doc = {"id": new_id(), **body.model_dump(mode="json"), "name": body.name.strip(), "created_at": now_iso(),
           "created_by": user["id"], "created_by_name": user["name"]}
    await db.documents.insert_one(doc)
    await audit(user, "document_created", body.kind, doc["id"], detail=doc["name"])
    await sync_reminders()
    return await get_document(doc["id"], user)


@router.put("/documents/{did}")
async def update_document(did: str, body: DocumentIn, user=Depends(require("ops"))):
    await validate_doc(body)
    r = await db.documents.update_one({"id": did}, {"$set": {**body.model_dump(mode="json"), "name": body.name.strip(),
                                                              "updated_at": now_iso(), "updated_by": user["id"]}})
    if not r.matched_count:
        raise HTTPException(404, "Dokumen tidak ditemukan.")
    await audit(user, "document_updated", body.kind, did, detail=body.name)
    await sync_reminders()
    return await get_document(did, user)


@router.post("/documents/{did}/files")
async def upload_file(did: str, file: UploadFile = File(...), user=Depends(require("ops"))):
    d = await db.documents.find_one({"id": did}, {"_id": 0, "id": 1, "kind": 1})
    if not d:
        raise HTTPException(404, "Dokumen tidak ditemukan.")
    ext = (file.filename or "").rsplit(".", 1)[-1].lower() if "." in (file.filename or "") else ""
    if ext not in ALLOWED:
        raise HTTPException(400, "Format file tidak didukung. Gunakan PDF, JPG, PNG, atau WEBP.")
    data = await file.read()
    if not data:
        raise HTTPException(400, "File kosong.")
    if len(data) > MAX_FILE:
        raise HTTPException(400, "Ukuran file maksimal 10 MB.")
    fid = new_id()
    path = f"{APP_NAME}/documents/{did}/{fid}.{ext}"
    try:
        res = await asyncio.to_thread(put_object, path, data, ALLOWED[ext])
    except Exception as e:
        logger.error(f"upload failed: {type(e).__name__}")
        raise HTTPException(502, "Gagal mengunggah file. Silakan coba lagi.")
    rec = {"id": fid, "document_id": did, "storage_path": res.get("path", path), "original_filename": file.filename[:200],
           "content_type": ALLOWED[ext], "size": len(data), "is_deleted": False, "uploaded_by": user["id"],
           "uploaded_by_name": user["name"], "created_at": now_iso()}
    await db.files.insert_one(rec)
    await audit(user, "file_uploaded", d["kind"], did, detail=rec["original_filename"])
    rec.pop("_id", None)
    rec.pop("storage_path", None)
    return rec


@router.get("/files/{fid}")
async def download_file(fid: str, user=Depends(require("ops"))):
    rec = await db.files.find_one({"id": fid, "is_deleted": False}, {"_id": 0})
    if not rec:
        raise HTTPException(404, "File tidak ditemukan.")
    try:
        data, _ = await asyncio.to_thread(get_object, rec["storage_path"])
    except Exception as e:
        logger.error(f"download failed: {type(e).__name__}")
        raise HTTPException(502, "Gagal mengambil file. Silakan coba lagi.")
    name = rec["original_filename"].replace('"', "")
    return Response(content=data, media_type=rec["content_type"],
                    headers={"Content-Disposition": f'inline; filename="{name}"', "Cache-Control": "private, no-store"})


@router.delete("/files/{fid}")
async def delete_file(fid: str, user=Depends(require("ops"))):
    rec = await db.files.find_one({"id": fid, "is_deleted": False}, {"_id": 0})
    if not rec:
        raise HTTPException(404, "File tidak ditemukan.")
    await db.files.update_one({"id": fid}, {"$set": {"is_deleted": True, "deleted_by": user["id"], "deleted_at": now_iso()}})
    await audit(user, "file_deleted", "file", fid, detail=rec["original_filename"])
    return {"ok": True}


# ---------- Reminders ----------
class TaskIn(BaseModel):
    title: str = Field(min_length=2, max_length=200)
    due_date: date
    notes: Optional[str] = Field(None, max_length=1000)
    partner_id: Optional[str] = None


class ReminderUpdate(BaseModel):
    status: Literal["open", "done"]
    follow_up_note: Optional[str] = Field(None, max_length=1000)


async def upsert_auto(source_type, source_id, title, due):
    key = f"{source_type}:{source_id}"
    ex = await db.reminders.find_one({"source_key": key}, {"_id": 0})
    if not ex:
        try:
            await db.reminders.insert_one({"id": new_id(), "source_key": key, "source_type": source_type,
                                           "source_id": source_id, "title": title, "due_date": due, "status": "open",
                                           "auto": True, "created_at": now_iso()})
        except DuplicateKeyError:
            pass
        return key
    if ex["due_date"] != due or ex["status"] == "closed":
        await db.reminders.update_one({"source_key": key}, {"$set": {"due_date": due, "title": title, "status": "open"},
                                                            "$unset": {"done_by": "", "done_by_name": "", "done_at": "", "follow_up_note": ""}})
    elif ex["title"] != title:
        await db.reminders.update_one({"source_key": key}, {"$set": {"title": title}})
    return key


async def sync_reminders():
    active = []
    async for d in db.documents.find({"status": "aktif", "expiry_date": {"$nin": [None, ""]}}, {"_id": 0, "id": 1, "kind": 1, "name": 1, "expiry_date": 1}):
        label = "Kontrak berakhir" if d["kind"] == "kontrak" else "Dokumen kedaluwarsa"
        active.append(await upsert_auto(d["kind"], d["id"], f"{label}: {d['name']}", d["expiry_date"]))
    async for q in db.quotations.find({"status": {"$in": ["pending", "approved", "sent"]}}, {"_id": 0, "id": 1, "number": 1, "valid_until": 1}):
        active.append(await upsert_auto("penawaran", q["id"], f"Masa berlaku penawaran {q['number']}", q["valid_until"]))
    await db.reminders.update_many({"auto": True, "status": "open", "source_key": {"$nin": active}}, {"$set": {"status": "closed"}})


def reminder_out(r: dict, windows) -> dict:
    dl = days_left(r["due_date"])
    r["days_left"] = dl
    if dl < 0:
        r["level"] = "terlambat"
    else:
        hit = [w for w in sorted(windows) if dl <= w]
        r["level"] = f"H-{hit[0]}" if hit else "terjadwal"
    return r


async def list_reminders_data(status: str = "open", scope: str = "active"):
    await sync_reminders()
    windows = (await get_settings())["reminder_windows"]
    mw = max(windows)
    f = {"status": {"$ne": "closed"}} if status == "all" else {"status": status}
    out = []
    async for r in db.reminders.find(f, {"_id": 0}).sort("due_date", 1).limit(1000):
        reminder_out(r, windows)
        if scope == "active" and r.get("auto") and r["status"] == "open" and r["days_left"] > mw:
            continue
        out.append(r)
    return out


@router.get("/reminders")
async def list_reminders(status: str = "open", scope: str = "active", user=Depends(require("ops"))):
    return await list_reminders_data(status, scope)


@router.post("/reminders")
async def create_task(body: TaskIn, user=Depends(require("ops"))):
    await ensure_partner(body.partner_id)
    rid = new_id()
    doc = {"id": rid, "source_key": f"tugas:{rid}", "source_type": "tugas", "source_id": rid, "title": body.title.strip(),
           "due_date": body.due_date.isoformat(), "notes": body.notes, "partner_id": body.partner_id, "status": "open",
           "auto": False, "created_at": now_iso(), "created_by": user["id"], "created_by_name": user["name"]}
    await db.reminders.insert_one(doc)
    await audit(user, "task_created", "reminder", rid, detail=doc["title"])
    doc.pop("_id", None)
    return reminder_out(doc, (await get_settings())["reminder_windows"])


@router.patch("/reminders/{rid}")
async def update_reminder(rid: str, body: ReminderUpdate, user=Depends(require("ops"))):
    r = await db.reminders.find_one({"id": rid}, {"_id": 0})
    if not r or r["status"] == "closed":
        raise HTTPException(404, "Pengingat tidak ditemukan.")
    if body.status == "done":
        upd = {"$set": {"status": "done", "done_by": user["id"], "done_by_name": user["name"], "done_at": now_iso(),
                        "follow_up_note": body.follow_up_note}}
    else:
        upd = {"$set": {"status": "open"}, "$unset": {"done_by": "", "done_by_name": "", "done_at": "", "follow_up_note": ""}}
    await db.reminders.update_one({"id": rid}, upd)
    await audit(user, "reminder_" + body.status, "reminder", rid, detail=r["title"])
    return reminder_out(await db.reminders.find_one({"id": rid}, {"_id": 0}), (await get_settings())["reminder_windows"])
