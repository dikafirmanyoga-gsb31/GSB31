import re
from datetime import datetime, timezone, timedelta

from fastapi import APIRouter, Request, Response, HTTPException, Depends
from pydantic import BaseModel, Field

from core import (db, audit, verify_password, hash_password, set_auth_cookies, clear_auth_cookies,
                  get_session_user, user_from_token, public_user, now_iso)

router = APIRouter(prefix="/auth")
LOCK_MAX, LOCK_MIN = 5, 15


class LoginIn(BaseModel):
    identifier: str = Field(min_length=1, max_length=120)
    password: str = Field(min_length=1, max_length=200)


class ChangePwIn(BaseModel):
    current_password: str = Field(min_length=1, max_length=200)
    new_password: str = Field(min_length=8, max_length=128)


def validate_password_strength(p: str):
    if not (re.search(r"[A-Za-z]", p) and re.search(r"\d", p)):
        raise HTTPException(400, "Password minimal 8 karakter dan harus mengandung huruf serta angka.")


def client_ip(request: Request) -> str:
    fwd = request.headers.get("x-forwarded-for")
    if fwd:
        return fwd.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


@router.post("/login")
async def login(body: LoginIn, request: Request, response: Response):
    ident = body.identifier.strip().lower()
    key = f"{client_ip(request)}:{ident}"
    now = datetime.now(timezone.utc)
    att = await db.login_attempts.find_one({"key": key}, {"_id": 0})
    if att and att.get("locked_until") and datetime.fromisoformat(att["locked_until"]) > now:
        raise HTTPException(429, "Terlalu banyak percobaan login. Silakan coba lagi dalam 15 menit.")
    u = await db.users.find_one({"$or": [{"username": ident}, {"email": ident}]}, {"_id": 0})
    if not u or not verify_password(body.password, u["password_hash"]):
        count = (att or {}).get("count", 0) + 1
        upd = {"count": count, "updated_at": now.isoformat()}
        if count >= LOCK_MAX:
            upd = {"count": 0, "locked_until": (now + timedelta(minutes=LOCK_MIN)).isoformat(), "updated_at": now.isoformat()}
        await db.login_attempts.update_one({"key": key}, {"$set": upd}, upsert=True)
        await audit(u, "login_failed", "user", u["id"] if u else None, "failed", f"identifier={ident}")
        raise HTTPException(401, "Username/email atau password salah.")
    if not u.get("is_active"):
        await audit(u, "login_blocked_inactive", "user", u["id"], "denied")
        raise HTTPException(403, "Akun Anda telah dinonaktifkan. Silakan hubungi direktur.")
    await db.login_attempts.delete_one({"key": key})
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
