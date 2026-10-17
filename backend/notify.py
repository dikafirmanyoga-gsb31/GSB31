import os
import re
import hmac
import asyncio
import ipaddress
from html import escape
from html.parser import HTMLParser
from urllib.parse import urlparse

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request, BackgroundTasks

from core import db, require, audit, now_iso, today_jkt, get_settings, logger, ROLE_LABELS
from routes_docs import sync_reminders, days_left

router = APIRouter()

EMAIL_BASE_URL = "https://integrations.emergentagent.com"
EMAIL_KEY = os.environ["EMERGENT_EMAIL_KEY"]
EMAIL_FROM_NAME = os.environ["EMAIL_FROM_NAME"]
EMAIL_REPLY_TO = os.environ.get("EMAIL_REPLY_TO")
CRON_SECRET = os.environ["WEBHOOK_CRON_SECRET"]
_lock = asyncio.Lock()

_SHORTENERS = ("bit.ly", "tinyurl.com", "t.co", "is.gd", "cutt.ly", "goo.gl", "rebrand.ly")
_CRED_ASK = ("reply with your password", "reply with the code", "send your password", "cvv",
             "send us your password", "enter your password below", "confirm your card number",
             "your full card number", "seed phrase", "recovery phrase", "verify your card",
             "social security number", "confirm your bank details")
_HOSTISH = re.compile(r"\b(?:https?://)?((?:[a-z0-9-]+\.)+[a-z]{2,})", re.I)


def _host_ok(host: str) -> bool:
    if not host or "xn--" in host:
        return False
    try:
        ipaddress.ip_address(host)
        return False
    except ValueError:
        pass
    return not any(host == s or host.endswith("." + s) for s in _SHORTENERS)


def _same_site(shown: str, real: str) -> bool:
    return shown == real or real.endswith("." + shown) or shown.endswith("." + real)


class _EmailScan(HTMLParser):
    def __init__(self):
        super().__init__()
        self.tags, self.urls, self.anchors = set(), [], []
        self._href, self._text = None, []

    def handle_starttag(self, tag, attrs):
        self.tags.add(tag.lower())
        self.urls += [v for k, v in attrs if k.lower() in ("href", "src") and v]
        if tag.lower() == "a":
            self._href = dict((k.lower(), v) for k, v in attrs).get("href")
            self._text = []

    def handle_data(self, data):
        if self._href is not None:
            self._text.append(data)

    def handle_endtag(self, tag):
        if tag.lower() == "a" and self._href is not None:
            self.anchors.append((self._href, "".join(self._text)))
            self._href, self._text = None, []


def _assert_safe_email(subject: str, html: str) -> None:
    scan = _EmailScan()
    scan.feed(html)
    if scan.tags & {"form", "input", "textarea", "select"}:
        raise ValueError("No forms or input fields in email (G2)")
    body = f"{subject}\n{html}".lower()
    for p in _CRED_ASK:
        if p in body:
            raise ValueError(f"Email asks the recipient for credentials: {p!r} (G2)")
    for url in scan.urls:
        low = url.strip().lower()
        if low.startswith(("mailto:", "tel:", "cid:", "#")):
            continue
        if not low.startswith("https://"):
            raise ValueError(f"Email links/assets must be absolute https: {url!r} (G3)")
        host = urlparse(low).hostname or ""
        if not _host_ok(host) or urlparse(low).username is not None:
            raise ValueError(f"Shortened, numeric-host or credential-bearing URL: {url!r} (G3)")
    for href, text in scan.anchors:
        real = urlparse(href.strip().lower()).hostname or ""
        if not real:
            continue
        for m in _HOSTISH.finditer(text):
            if not _same_site(m.group(1).lower(), real):
                raise ValueError(f"Anchor text {m.group(1)!r} != real link host {real!r} (G3)")


async def send_email(*, to: str, subject: str, html: str) -> str:
    _assert_safe_email(subject, html)
    payload = {"to": [to], "subject": subject, "html": html, "from_name": EMAIL_FROM_NAME}
    if EMAIL_REPLY_TO:
        payload["contact_email"] = EMAIL_REPLY_TO
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.post(f"{EMAIL_BASE_URL}/api/v1/email/send", headers={"X-Email-Key": EMAIL_KEY}, json=payload)
    if resp.status_code >= 400:
        try:
            code = resp.json().get("code", "")
        except ValueError:
            code = ""
        raise RuntimeError(code or f"http_{resp.status_code}")
    return resp.json().get("id")


LEVEL_TEXT = {"terlambat": "SUDAH LEWAT", "H-7": "7 hari atau kurang", "H-14": "14 hari atau kurang", "H-30": "30 hari atau kurang"}


def current_level(dl: int, windows) -> str | None:
    if dl < 0:
        return "terlambat"
    hit = [w for w in sorted(windows) if dl <= w]
    return f"H-{hit[0]}" if hit else None


def build_html(name: str, items: list) -> str:
    rows = "".join(
        f'<tr><td style="padding:8px;border-bottom:1px solid #e2e8f0">{escape(i["title"])}</td>'
        f'<td style="padding:8px;border-bottom:1px solid #e2e8f0;white-space:nowrap">{escape(i["due_date"])}</td>'
        f'<td style="padding:8px;border-bottom:1px solid #e2e8f0;white-space:nowrap">'
        f'{escape("lewat " + str(-i["days_left"]) + " hari" if i["days_left"] < 0 else str(i["days_left"]) + " hari lagi")}</td></tr>'
        for i in items)
    return (
        '<table role="presentation" width="100%" style="font-family:Arial,sans-serif;color:#0f172a"><tr><td style="padding:24px">'
        f'<p style="font-size:18px;font-weight:bold;color:#0284c7;margin:0 0 12px">GSB31 · Pengingat Masa Berlaku</p>'
        f'<p>Yth. {escape(name)},</p>'
        '<p>Dokumen/kontrak berikut mendekati atau telah melewati tanggal berakhirnya:</p>'
        '<table role="presentation" width="100%" style="border-collapse:collapse;font-size:14px">'
        '<tr style="background:#f1f5f9"><th align="left" style="padding:8px">Dokumen / Kontrak</th>'
        '<th align="left" style="padding:8px">Tanggal berakhir</th><th align="left" style="padding:8px">Sisa waktu</th></tr>'
        f'{rows}</table>'
        '<p>Silakan masuk ke aplikasi GSB31 untuk menindaklanjuti pengingat ini.</p>'
        f'<p style="font-size:12px;color:#64748b">Dikirim otomatis oleh {escape(EMAIL_FROM_NAME)}. '
        'Email ini tidak pernah meminta password atau data rahasia Anda.</p></td></tr></table>')


async def run_email_reminders(trigger: str) -> dict:
    async with _lock:
        s = await get_settings()
        if not s.get("email_reminders_enabled", True):
            return {"status": "disabled", "items": 0, "sent": 0, "failed": 0}
        await sync_reminders()
        windows = s["reminder_windows"]
        due = []
        async for r in db.reminders.find({"auto": True, "status": "open", "source_type": {"$in": ["dokumen", "kontrak"]}}, {"_id": 0}):
            r["days_left"] = days_left(r["due_date"])
            lvl = current_level(r["days_left"], windows)
            if lvl and lvl not in (r.get("emailed_levels") or []):
                r["_level"] = lvl
                due.append(r)
        if not due:
            return {"status": "nothing_due", "items": 0, "sent": 0, "failed": 0}
        due.sort(key=lambda x: x["days_left"])
        recipients = [u async for u in db.users.find({"is_active": True, "email": {"$type": "string"}}, {"_id": 0, "id": 1, "name": 1, "email": 1, "role": 1})]
        sent = failed = 0
        subject = f"[GSB31] {len(due)} dokumen/kontrak mendekati masa berakhir"
        html_cache = {}
        for u in recipients:
            html = html_cache.setdefault(u["name"], build_html(u["name"], due))
            status, err = "sent", None
            try:
                await send_email(to=u["email"], subject=subject, html=html)
                sent += 1
            except Exception as e:
                status, err = "failed", str(e)[:120]
                failed += 1
                logger.warning(f"Reminder email failed: {err}")
            await db.email_logs.insert_one({"at": now_iso(), "to_user_id": u["id"], "to_name": u["name"], "to_email": u["email"],
                                            "subject": subject, "items": len(due), "status": status, "error": err, "trigger": trigger})
        if sent:
            for r in due:
                await db.reminders.update_one({"id": r["id"]}, {"$addToSet": {"emailed_levels": r["_level"]}, "$set": {"last_emailed_at": now_iso()}})
        await audit(None, "reminder_emails_sent", "email", None, "success" if not failed else "failed",
                    f"{trigger}: {len(due)} item, {sent} terkirim, {failed} gagal, {len(recipients)} penerima")
        return {"status": "done", "items": len(due), "sent": sent, "failed": failed, "recipients": len(recipients)}


@router.post("/cron/reminder-emails")
async def cron_reminder_emails(request: Request, background: BackgroundTasks):
    # Cron endpoints must ack 2xx immediately; enqueue/background the actual work.
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer ") or not hmac.compare_digest(auth[7:], CRON_SECRET):
        raise HTTPException(401, "Unauthorized")
    try:
        body = await request.json()
    except Exception:
        body = {}
    run_id = request.headers.get("X-Webhook-Id") or (body or {}).get("run_id") or f"{today_jkt().isoformat()}-noid"
    res = await db.cron_runs.update_one({"_id": run_id}, {"$setOnInsert": {"at": now_iso(), "job": "reminder-emails"}}, upsert=True)
    if res.upserted_id is not None:
        background.add_task(run_email_reminders, "cron")
    return {"accepted": True}


@router.post("/notifications/email-reminders/run")
async def run_now(user=Depends(require("director"))):
    res = await run_email_reminders(f"manual:{user['username']}")
    await audit(user, "reminder_emails_manual", "email", None, detail=str(res))
    return res


@router.get("/notifications/email-logs")
async def email_logs(user=Depends(require("director"))):
    recipients = [{"name": u["name"], "email": u.get("email"), "role": ROLE_LABELS[u["role"]], "is_active": u["is_active"]}
                  async for u in db.users.find({}, {"_id": 0, "name": 1, "email": 1, "role": 1, "is_active": 1})]
    logs = [x async for x in db.email_logs.find({}, {"_id": 0}).sort("at", -1).limit(50)]
    return {"recipients": recipients, "logs": logs}
