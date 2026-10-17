import os
import re
import uuid
import logging
from datetime import datetime, timezone, timedelta
from zoneinfo import ZoneInfo

import bcrypt
import jwt
from fastapi import Request, HTTPException, Depends, Response
from motor.motor_asyncio import AsyncIOMotorClient

logger = logging.getLogger("gsb31")
client = AsyncIOMotorClient(os.environ["MONGO_URL"])
db = client[os.environ["DB_NAME"]]
JWT_SECRET = os.environ["JWT_SECRET"]
JKT = ZoneInfo("Asia/Jakarta")

ROLE_LABELS = {
    "director": "Direktur / Super Admin",
    "opfin": "Operasional + Keuangan",
    "ops": "Operasional",
}
ROLE_PERMS = {
    "director": {"ops", "finance", "director"},
    "opfin": {"ops", "finance"},
    "ops": {"ops"},
}
MAX_USERS = 10
MAX_OPS = 7
ACCESS_MIN = 15
REFRESH_DAYS = 7

DENIED = {
    "director": {"code": "DIRECTOR_ONLY", "message": "Fitur ini hanya dapat diakses oleh Direktur."},
    "finance": {"code": "FINANCE_RESTRICTED", "message": "Akun Anda tidak memiliki izin untuk mengakses fitur keuangan."},
}

DEFAULT_SETTINGS = {
    "reminder_windows": [30, 14, 7],
    "quotation_approver_roles": ["director"],
    "email_reminders_enabled": True,
    "kopra_activity_types": ["Pembelian", "Penjualan", "Pengiriman", "Lainnya"],
    "kopra_units": ["kg", "ton", "karung"],
    "document_categories": ["Legalitas Perusahaan", "Perizinan", "Sertifikat", "Kontrak", "Perjanjian", "Lainnya"],
    "income_categories": ["Penjualan Kopra", "Pendapatan Lain"],
    "expense_categories": ["Pembelian Kopra", "Transportasi", "Operasional", "Gaji", "Lainnya"],
    "company": {
        "name": "PT Gurindam Sinar Berkah",
        "director": "Tengku Erens",
        "address": "",
        "phone": "",
        "email": "",
        "npwp": "",
        "website": "",
    },
}


def now_iso():
    return datetime.now(timezone.utc).isoformat()


def today_jkt():
    return datetime.now(JKT).date()


def new_id():
    return str(uuid.uuid4())


def norm_key(s: str) -> str:
    return " ".join(s.lower().split())


def rx(q: str):
    return {"$regex": re.escape(q.strip()), "$options": "i"}


def hash_password(p: str) -> str:
    return bcrypt.hashpw(p.encode(), bcrypt.gensalt()).decode()


def verify_password(p: str, h: str) -> bool:
    try:
        return bcrypt.checkpw(p.encode(), h.encode())
    except ValueError:
        return False


def make_token(user: dict, typ: str) -> str:
    delta = timedelta(minutes=ACCESS_MIN) if typ == "access" else timedelta(days=REFRESH_DAYS)
    payload = {"sub": user["id"], "tv": user.get("token_version", 0), "type": typ,
               "exp": datetime.now(timezone.utc) + delta}
    return jwt.encode(payload, JWT_SECRET, algorithm="HS256")


def set_auth_cookies(resp: Response, user: dict):
    resp.set_cookie("access_token", make_token(user, "access"), httponly=True, secure=True,
                    samesite="lax", max_age=ACCESS_MIN * 60, path="/")
    resp.set_cookie("refresh_token", make_token(user, "refresh"), httponly=True, secure=True,
                    samesite="lax", max_age=REFRESH_DAYS * 86400, path="/api/auth")


def clear_auth_cookies(resp: Response):
    resp.delete_cookie("access_token", path="/")
    resp.delete_cookie("refresh_token", path="/api/auth")


async def user_from_token(token: str, typ: str) -> dict:
    try:
        p = jwt.decode(token, JWT_SECRET, algorithms=["HS256"])
    except jwt.InvalidTokenError:
        raise HTTPException(401, "Sesi tidak valid atau telah berakhir.")
    if p.get("type") != typ:
        raise HTTPException(401, "Sesi tidak valid.")
    u = await db.users.find_one({"id": p.get("sub")}, {"_id": 0})
    if not u or not u.get("is_active") or u.get("token_version", 0) != p.get("tv"):
        raise HTTPException(401, "Sesi tidak valid atau akun tidak aktif.")
    return u


async def get_session_user(request: Request) -> dict:
    token = request.cookies.get("access_token")
    if not token:
        h = request.headers.get("Authorization", "")
        if h.startswith("Bearer "):
            token = h[7:]
    if not token:
        raise HTTPException(401, "Silakan login terlebih dahulu.")
    u = await user_from_token(token, "access")
    u.pop("password_hash", None)
    return u


async def current_user(request: Request) -> dict:
    u = await get_session_user(request)
    if u.get("must_change_password"):
        raise HTTPException(403, detail={"code": "PASSWORD_CHANGE_REQUIRED",
                                         "message": "Silakan ganti password terlebih dahulu."})
    return u


def has_perm(user: dict, perm: str) -> bool:
    return perm in ROLE_PERMS.get(user.get("role"), set())


async def deny(user: dict, perm: str, path: str):
    await audit(user, "access_denied", "feature", perm, result="denied", detail=path)
    raise HTTPException(403, detail=DENIED.get(perm, DENIED["director"]))


def require(perm: str):
    async def dep(request: Request, user: dict = Depends(current_user)):
        if not has_perm(user, perm):
            await deny(user, perm, request.url.path)
        return user
    return dep


async def audit(user, action, obj_type=None, obj_id=None, result="success", detail=None):
    await db.audit_logs.insert_one({
        "id": new_id(), "at": now_iso(),
        "user_id": user.get("id") if user else None,
        "user_name": user.get("name") if user else None,
        "username": user.get("username") if user else None,
        "action": action, "object_type": obj_type, "object_id": obj_id,
        "result": result, "detail": detail,
    })


def public_user(u: dict) -> dict:
    out = {k: u.get(k) for k in ["id", "username", "email", "name", "role", "is_active",
                                 "must_change_password", "created_at", "last_login_at"]}
    out["role_label"] = ROLE_LABELS.get(u["role"])
    out["permissions"] = sorted(ROLE_PERMS.get(u["role"], set()))
    return out


async def get_settings() -> dict:
    doc = await db.settings.find_one({"id": "app"}, {"_id": 0}) or {}
    s = {**DEFAULT_SETTINGS, **{k: v for k, v in doc.items() if k != "id"}}
    s["company"] = {**DEFAULT_SETTINGS["company"], **(doc.get("company") or {})}
    return s


async def partner_map(ids) -> dict:
    ids = [i for i in set(ids) if i]
    if not ids:
        return {}
    return {p["id"]: p["name"] async for p in db.partners.find({"id": {"$in": ids}}, {"_id": 0, "id": 1, "name": 1})}


async def ensure_partner(pid):
    if pid and not await db.partners.find_one({"id": pid}, {"_id": 1}):
        raise HTTPException(400, "Mitra yang dipilih tidak ditemukan.")
