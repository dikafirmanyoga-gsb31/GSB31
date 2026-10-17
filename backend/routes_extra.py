import asyncio
from datetime import timedelta
from html import escape
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request, BackgroundTasks, UploadFile, File, Form
from fastapi.responses import Response

from core import db, require, audit, new_id, now_iso, today_jkt, get_settings, logger, rx
from routes_business import quotation_out
from routes_finance import summarize
from routes_docs import days_left
from storage import put_object, get_object, APP_NAME
from notify import send_email, EMAIL_FROM_NAME, CRON_SECRET, hmac

router = APIRouter()

# ---------- Weekly summary ----------
QLABEL = {"draft": "Draft", "pending": "Menunggu Persetujuan", "approved": "Disetujui", "sent": "Dikirim", "rejected": "Ditolak", "expired": "Kedaluwarsa"}


def idr(v):
    return "Rp " + f"{v:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")


def last_week():
    t = today_jkt()
    start = t - timedelta(days=t.weekday() + 7)
    return start, start + timedelta(days=6)


async def weekly_data():
    start, end = last_week()
    s_iso, e_iso = start.isoformat(), end.isoformat()
    created = [q async for q in db.quotations.find({"date": {"$gte": s_iso, "$lte": e_iso}}, {"_id": 0, "number": 1, "total": 1, "status": 1, "valid_until": 1})]
    decided = {"approved": 0, "rejected": 0, "sent": 0}
    async for q in db.quotations.find({"history.at": {"$gte": s_iso, "$lte": e_iso + "T99"}}, {"_id": 0, "history": 1}):
        for h in q.get("history", []):
            if s_iso <= h["at"][:10] <= e_iso and h["status"] in decided:
                decided[h["status"]] += 1
    open_status = {}
    async for q in db.quotations.find({"status": {"$in": ["pending", "approved", "sent"]}}, {"_id": 0, "status": 1, "valid_until": 1}):
        st = quotation_out(q)["effective_status"]
        open_status[st] = open_status.get(st, 0) + 1
    new_contracts = await db.documents.count_documents({"kind": "kontrak", "created_at": {"$gte": s_iso, "$lte": e_iso + "T99"}})
    expiring, expired = [], 0
    async for d in db.documents.find({"kind": "kontrak", "status": "aktif", "expiry_date": {"$nin": [None, ""]}}, {"_id": 0, "name": 1, "expiry_date": 1}):
        dl = days_left(d["expiry_date"])
        if dl < 0:
            expired += 1
        elif dl <= 30:
            expiring.append({**d, "days_left": dl})
    expiring.sort(key=lambda x: x["days_left"])
    return {"start": s_iso, "end": e_iso, "quotations_created": len(created), "quotations_value": round(sum(q["total"] for q in created), 2),
            "decided": decided, "open_status": open_status, "new_contracts": new_contracts, "contracts_expiring": expiring,
            "contracts_expired": expired, "cash": await summarize(s_iso, e_iso)}


def row(label, value):
    return (f'<tr><td style="padding:6px 8px;border-bottom:1px solid #e2e8f0">{escape(label)}</td>'
            f'<td align="right" style="padding:6px 8px;border-bottom:1px solid #e2e8f0"><b>{escape(str(value))}</b></td></tr>')


def section(title, rows):
    return (f'<p style="font-size:15px;font-weight:bold;color:#0284c7;margin:20px 0 6px">{escape(title)}</p>'
            f'<table role="presentation" width="100%" style="border-collapse:collapse;font-size:14px">{"".join(rows)}</table>')


def build_weekly_html(name, company, d):
    c = d["cash"]
    q_rows = [row("Penawaran baru", d["quotations_created"]), row("Nilai penawaran baru", idr(d["quotations_value"])),
              row("Disetujui", d["decided"]["approved"]), row("Dikirim ke pelanggan", d["decided"]["sent"]), row("Ditolak", d["decided"]["rejected"])]
    q_rows += [row(f"Saat ini {QLABEL[k]}", v) for k, v in d["open_status"].items()]
    k_rows = [row("Kontrak baru dicatat", d["new_contracts"]), row("Berakhir dalam 30 hari", len(d["contracts_expiring"])),
              row("Sudah lewat masa berlaku", d["contracts_expired"])]
    k_rows += [row(f"· {x['name']} ({x['expiry_date']})", f"{x['days_left']} hari lagi") for x in d["contracts_expiring"][:8]]
    f_rows = [row("Pemasukan", idr(c["income"])), row("Pengeluaran", idr(c["expense"])), row("Arus kas bersih", idr(c["net"])),
              row("Jumlah transaksi", c["count"])]
    return ('<table role="presentation" width="100%" style="font-family:Arial,sans-serif;color:#0f172a"><tr><td style="padding:24px">'
            '<p style="font-size:18px;font-weight:bold;color:#0284c7;margin:0">GSB31 · Ringkasan Bisnis Mingguan</p>'
            f'<p style="color:#64748b;margin:4px 0 16px">{escape(company)} · {escape(d["start"])} s/d {escape(d["end"])}</p>'
            f'<p>Yth. {escape(name)},</p><p>Berikut ringkasan kegiatan bisnis minggu lalu berdasarkan data di GSB31:</p>'
            + section("Penawaran", q_rows) + section("Kontrak", k_rows) + section("Arus Kas", f_rows) +
            '<p style="margin-top:20px">Detail lengkap tersedia di Menu Direktur aplikasi GSB31.</p>'
            f'<p style="font-size:12px;color:#64748b">Dikirim otomatis oleh {escape(EMAIL_FROM_NAME)}. '
            'Email ini tidak pernah meminta password atau data rahasia Anda.</p></td></tr></table>')


async def run_weekly_summary(trigger: str) -> dict:
    s = await get_settings()
    if not s.get("weekly_summary_enabled", True):
        return {"status": "disabled", "sent": 0, "failed": 0}
    directors = [u async for u in db.users.find({"role": "director", "is_active": True, "email": {"$type": "string"}}, {"_id": 0, "id": 1, "name": 1, "email": 1})]
    if not directors:
        return {"status": "no_recipient", "sent": 0, "failed": 0}
    d = await weekly_data()
    subject = f"[GSB31] Ringkasan Bisnis Mingguan {d['start']} s/d {d['end']}"
    sent = failed = 0
    for u in directors:
        status, err = "sent", None
        try:
            await send_email(to=u["email"], subject=subject, html=build_weekly_html(u["name"], s["company"]["name"], d))
            sent += 1
        except Exception as e:
            status, err = "failed", str(e)[:120]
            failed += 1
            logger.warning(f"Weekly summary failed: {err}")
        await db.email_logs.insert_one({"at": now_iso(), "to_user_id": u["id"], "to_name": u["name"], "to_email": u["email"],
                                        "subject": subject, "items": d["quotations_created"], "status": status, "error": err, "trigger": f"weekly:{trigger}"})
    await audit(None, "weekly_summary_sent", "email", None, "success" if not failed else "failed", f"{trigger}: {sent} terkirim, {failed} gagal")
    return {"status": "done", "sent": sent, "failed": failed, "period": [d["start"], d["end"]]}


@router.post("/cron/weekly-summary")
async def cron_weekly(request: Request, background: BackgroundTasks):
    # Cron endpoints must ack 2xx immediately; enqueue/background the actual work.
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer ") or not hmac.compare_digest(auth[7:], CRON_SECRET):
        raise HTTPException(401, "Unauthorized")
    try:
        body = await request.json()
    except Exception:
        body = {}
    run_id = request.headers.get("X-Webhook-Id") or (body or {}).get("run_id") or f"weekly-{today_jkt().isoformat()}"
    res = await db.cron_runs.update_one({"_id": run_id}, {"$setOnInsert": {"at": now_iso(), "job": "weekly-summary"}}, upsert=True)
    if res.upserted_id is not None:
        background.add_task(run_weekly_summary, "cron")
    return {"accepted": True}


@router.get("/notifications/weekly-summary/preview")
async def weekly_preview(user=Depends(require("director"))):
    return await weekly_data()


@router.post("/notifications/weekly-summary/run")
async def weekly_run(user=Depends(require("director"))):
    res = await run_weekly_summary(f"manual:{user['username']}")
    await audit(user, "weekly_summary_manual", "email", None, detail=str(res))
    return res


# ---------- Document templates ----------
TPL_TYPES = {"pdf": "application/pdf", "doc": "application/msword",
             "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
             "jpg": "image/jpeg", "jpeg": "image/jpeg", "png": "image/png"}
TPL_CATEGORIES = ["Kop Surat", "Penawaran", "Kontrak Kerja Sama", "Kontrak Tripartit", "Surat Resmi", "Lainnya"]
MAX_TPL = 15 * 1024 * 1024


@router.get("/templates")
async def list_templates(q: str = "", category: str = "", include_archived: bool = False, user=Depends(require("ops"))):
    f = {} if include_archived else {"is_archived": {"$ne": True}}
    if category:
        f["category"] = category
    if q.strip():
        f["$or"] = [{"name": rx(q)}, {"notes": rx(q)}, {"original_filename": rx(q)}]
    items = [t async for t in db.templates.find(f, {"_id": 0, "storage_path": 0}).sort([("category", 1), ("created_at", -1)])]
    return {"items": items, "categories": TPL_CATEGORIES}


@router.post("/templates")
async def upload_template(file: UploadFile = File(...), name: str = Form(..., min_length=2, max_length=150),
                          category: str = Form(...), notes: Optional[str] = Form(None, max_length=1000),
                          user=Depends(require("director"))):
    if category not in TPL_CATEGORIES:
        raise HTTPException(400, "Kategori template tidak valid.")
    fn = file.filename or ""
    ext = fn.rsplit(".", 1)[-1].lower() if "." in fn else ""
    if ext not in TPL_TYPES:
        raise HTTPException(400, "Format file tidak didukung. Gunakan DOCX, DOC, PDF, JPG, atau PNG.")
    data = await file.read()
    if not data:
        raise HTTPException(400, "File kosong.")
    if len(data) > MAX_TPL:
        raise HTTPException(400, "Ukuran file maksimal 15 MB.")
    tid = new_id()
    path = f"{APP_NAME}/templates/{tid}.{ext}"
    try:
        res = await asyncio.to_thread(put_object, path, data, TPL_TYPES[ext])
    except Exception as e:
        logger.error(f"template upload failed: {type(e).__name__}")
        raise HTTPException(502, "Gagal mengunggah file. Silakan coba lagi.")
    doc = {"id": tid, "name": name.strip(), "category": category, "notes": notes, "storage_path": res.get("path", path),
           "original_filename": fn[:200], "content_type": TPL_TYPES[ext], "ext": ext, "size": len(data), "is_archived": False,
           "uploaded_by": user["id"], "uploaded_by_name": user["name"], "created_at": now_iso()}
    await db.templates.insert_one(doc)
    await audit(user, "template_uploaded", "template", tid, detail=f"{category}: {doc['name']}")
    doc.pop("_id", None)
    doc.pop("storage_path", None)
    return doc


@router.get("/templates/{tid}/file")
async def download_template(tid: str, user=Depends(require("ops"))):
    t = await db.templates.find_one({"id": tid}, {"_id": 0})
    if not t:
        raise HTTPException(404, "Template tidak ditemukan.")
    try:
        data, _ = await asyncio.to_thread(get_object, t["storage_path"])
    except Exception as e:
        logger.error(f"template download failed: {type(e).__name__}")
        raise HTTPException(502, "Gagal mengambil file. Silakan coba lagi.")
    await audit(user, "template_downloaded", "template", tid, detail=t["name"])
    name = t["original_filename"].replace('"', "")
    return Response(content=data, media_type=t["content_type"],
                    headers={"Content-Disposition": f'attachment; filename="{name}"', "Cache-Control": "private, no-store"})


@router.post("/templates/{tid}/archive")
async def archive_template(tid: str, user=Depends(require("director"))):
    t = await db.templates.find_one({"id": tid}, {"_id": 0, "is_archived": 1, "name": 1})
    if not t:
        raise HTTPException(404, "Template tidak ditemukan.")
    val = not t.get("is_archived", False)
    await db.templates.update_one({"id": tid}, {"$set": {"is_archived": val, "updated_at": now_iso()}})
    await audit(user, "template_archived" if val else "template_restored", "template", tid, detail=t["name"])
    return {"ok": True, "is_archived": val}
