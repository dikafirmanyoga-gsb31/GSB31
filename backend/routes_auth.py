import os
import re
import ipaddress
from datetime import datetime, timezone, timedelta

from fastapi import APIRouter, Request, Response, HTTPException, Depends
from pydantic import BaseModel, Field

from core import (db, audit, verify_password, hash_password, set_auth_cookies, clear_auth_cookies,
                  get_session_user, user_from_token, public_user, now_iso)

router = APIRouter(prefix="/auth")
# Per source IP + identifier: 5 failures -> lock that pair, backoff 15/30/60 min.
PAIR_MAX, PAIR_BASE_MIN, PAIR_CAP_MIN = 5, 15, 60
# Per source IP (all identifiers): 20 failures in 15 min -> block that IP 15 min.
IP_MAX, IP_WINDOW_MIN, IP_LOCK_MIN = 20, 15, 15
# Per identifier (all IPs): 10 failures in 15 min -> only IPs never used for a successful login of this account are paused.
ACCT_MAX, ACCT_WINDOW_MIN = 10, 15
KNOWN_IP_DAYS = 60
TRUSTED_PROXY_HOPS = int(os.environ.get("TRUSTED_PROXY_HOPS", "1"))
LOCK_MSG = "Terlalu banyak percobaan login. Silakan coba lagi nanti."


class LoginIn(BaseModel):
    identifier: str = Field(min_length=1, max_length=120)
    password: str = Field(min_length=1, max_length=200)


class ChangePwIn(BaseModel):
    current_password: str = Field(min_length=1, max_length=200)
    new_password: str = Field(min_length=8, max_length=128)


def validate_password_strength(p: str):
    if not (re.search(r"[A-Za-z]", p) and re.search(r"\d", p)):
        raise HTTPException(400, "Password minimal 8 karakter dan harus mengandung huruf serta angka.")


def _is_private(host: str) -> bool:
    try:
        return ipaddress.ip_address(host).is_private
    except ValueError:
        return False


def client_ip(request: Request) -> str:
    # Only trust X-Forwarded-For when the direct peer is internal proxy infrastructure;
    # take the entry appended by the trusted hop(s), never the client-controlled left side.
    peer = request.client.host if request.client else "unknown"
    fwd = request.headers.get("x-forwarded-for")
    if fwd and _is_private(peer) and TRUSTED_PROXY_HOPS > 0:
        parts = [p.strip() for p in fwd.split(",") if p.strip()]
        if len(parts) >= TRUSTED_PROXY_HOPS:
            return parts[-TRUSTED_PROXY_HOPS]
    return peer


def _locked(doc, now) -> bool:
    return bool(doc and doc.get("locked_until") and datetime.fromisoformat(doc["locked_until"]) > now)


async def _window_count(key: str, now, window_min: int) -> int:
    doc = await db.login_attempts.find_one({"key": key}, {"_id": 0})
    ws = doc.get("window_start") if doc else None
    if not ws or datetime.fromisoformat(ws) <= now - timedelta(minutes=window_min):
        return 0
    return doc.get("count", 0)


async def _bump_window(key: str, now, window_min: int) -> int:
    if await _window_count(key, now, window_min) == 0:
        await db.login_attempts.update_one({"key": key}, {"$set": {"count": 1, "window_start": now.isoformat(), "updated_at": now.isoformat()}}, upsert=True)
        return 1
    doc = await db.login_attempts.find_one_and_update({"key": key}, {"$inc": {"count": 1}, "$set": {"updated_at": now.isoformat()}}, return_document=True)
    return doc["count"]


async def _record_failure(ip: str, ident: str, now):
    pair_key = f"pair:{ip}:{ident}"
    pair = await db.login_attempts.find_one_and_update(
        {"key": pair_key}, {"$inc": {"count": 1}, "$set": {"updated_at": now.isoformat()}}, upsert=True, return_document=True)
    if pair["count"] >= PAIR_MAX:
        locks = pair.get("locks", 0) + 1
        minutes = min(PAIR_BASE_MIN * 2 ** (locks - 1), PAIR_CAP_MIN)
        await db.login_attempts.update_one({"key": pair_key}, {"$set": {"count": 0, "locks": locks, "locked_until": (now + timedelta(minutes=minutes)).isoformat()}})
    ip_count = await _bump_window(f"ip:{ip}", now, IP_WINDOW_MIN)
    if ip_count >= IP_MAX:
        await db.login_attempts.update_one({"key": f"ip:{ip}"}, {"$set": {"locked_until": (now + timedelta(minutes=IP_LOCK_MIN)).isoformat()}})
    await _bump_window(f"acct:{ident}", now, ACCT_WINDOW_MIN)


async def _known_ip(user_id: str, ip: str, now) -> bool:
    doc = await db.login_known_ips.find_one({"user_id": user_id, "ip": ip}, {"_id": 0, "at": 1})
    return bool(doc and datetime.fromisoformat(doc["at"]) > now - timedelta(days=KNOWN_IP_DAYS))


@router.post("/login")
async def login(body: LoginIn, request: Request, response: Response):
    ident = body.identifier.strip().lower()
    ip = client_ip(request)
    now = datetime.now(timezone.utc)
    if _locked(await db.login_attempts.find_one({"key": f"ip:{ip}"}, {"_id": 0}), now) or \
            _locked(await db.login_attempts.find_one({"key": f"pair:{ip}:{ident}"}, {"_id": 0}), now):
        await audit(None, "login_rate_limited", "user", None, "denied", f"identifier={ident} ip={ip}")
        raise HTTPException(429, LOCK_MSG)
    u = await db.users.find_one({"$or": [{"username": ident}, {"email": ident}]}, {"_id": 0})
    if u and await _window_count(f"acct:{ident}", now, ACCT_WINDOW_MIN) >= ACCT_MAX and not await _known_ip(u["id"], ip, now):
        await audit(u, "login_rate_limited", "user", u["id"], "denied", f"account under attack, unknown ip={ip}")
        raise HTTPException(429, LOCK_MSG)
    if not u or not verify_password(body.password, u["password_hash"]):
        await _record_failure(ip, ident, now)
        await audit(u, "login_failed", "user", u["id"] if u else None, "failed", f"identifier={ident} ip={ip}")
        raise HTTPException(401, "Username/email atau password salah.")
    if not u.get("is_active"):
        await audit(u, "login_blocked_inactive", "user", u["id"], "denied")
        raise HTTPException(403, "Akun Anda telah dinonaktifkan. Silakan hubungi direktur.")
    await db.login_attempts.delete_one({"key": f"pair:{ip}:{ident}"})
    await db.login_known_ips.update_one({"user_id": u["id"], "ip": ip}, {"$set": {"at": now.isoformat()}}, upsert=True)
    await db.users.update_one({"id": u["id"]}, {"$set": {"last_login_at": now_iso()}})
    set_auth_cookies(response, u)
    await audit(u, "login_success", "user", u["id"])
    return public_user(u)


@router.post("/logout")
async def logout(request: Request, response: Response):
    try:
        u = await get_session_user(request)
    except HTTPException:
        u = None
    if u:
        await db.users.update_one({"id": u["id"]}, {"$inc": {"token_version": 1}})
        await audit(u, "logout", "user", u["id"])
    clear_auth_cookies(response)
    return {"ok": True}


@router.get("/me")
async def me(user: dict = Depends(get_session_user)):
    return public_user(user)


@router.post("/refresh")
async def refresh(request: Request, response: Response):
    token = request.cookies.get("refresh_token")
    if not token:
        raise HTTPException(401, "Sesi telah berakhir.")
    u = await user_from_token(token, "refresh")
    set_auth_cookies(response, u)
    return public_user(u)


@router.post("/change-password")
async def change_password(body: ChangePwIn, response: Response, user: dict = Depends(get_session_user)):
    validate_password_strength(body.new_password)
    full = await db.users.find_one({"id": user["id"]}, {"_id": 0})
    if not verify_password(body.current_password, full["password_hash"]):
        raise HTTPException(400, "Password saat ini tidak sesuai.")
    if body.current_password == body.new_password:
        raise HTTPException(400, "Password baru harus berbeda dari password saat ini.")
    await db.users.update_one({"id": user["id"]}, {
        "$set": {"password_hash": hash_password(body.new_password), "must_change_password": False,
                 "password_changed_at": now_iso()},
        "$inc": {"token_version": 1}})
    updated = await db.users.find_one({"id": user["id"]}, {"_id": 0})
    set_auth_cookies(response, updated)
    await audit(user, "password_changed", "user", user["id"])
    return public_user(updated)
