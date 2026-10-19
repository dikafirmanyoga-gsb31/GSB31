import re
from typing import Optional, Literal

from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel, ConfigDict, Field, field_validator
from pymongo.errors import DuplicateKeyError

from core import (db, require, audit, hash_password, public_user, new_id, now_iso, MAX_USERS, MAX_OPS, ROLE_LABELS)
from routes_auth import validate_password_strength

router = APIRouter(prefix="/users")
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def norm_email(v):
    if v is None:
        return None
    v = v.strip().lower()
    if not v:
        return None
    if not EMAIL_RE.match(v):
        raise ValueError("Format email tidak valid.")
    return v


class UserCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str = Field(min_length=2, max_length=80)
    username: str = Field(min_length=3, max_length=30)
    email: Optional[str] = None
    role: Literal["opfin", "ops"]
    password: str = Field(min_length=8, max_length=128)

    @field_validator("username")
    @classmethod
    def v_username(cls, v):
        v = v.strip().lower()
        if not re.fullmatch(r"[a-z0-9._-]{3,30}", v):
            raise ValueError("Username hanya boleh huruf kecil, angka, titik, garis bawah, atau strip.")
        return v

    @field_validator("email")
    @classmethod
    def v_email(cls, v):
        return norm_email(v)

    @field_validator("name")
    @classmethod
    def v_name(cls, v):
        return strip_name(v)


def strip_name(v):
    if v is None:
        return None
    v = " ".join(v.split())
    if len(v) < 2:
        raise ValueError("Nama minimal 2 karakter.")
    return v


class UserUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: Optional[str] = Field(None, min_length=2, max_length=80)
    email: Optional[str] = None
    role: Optional[Literal["opfin", "ops"]] = None
    is_active: Optional[bool] = None

    @field_validator("name")
    @classmethod
    def v_name(cls, v):
        return strip_name(v)


class ResetPwIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    new_password: str = Field(min_length=8, max_length=128)


async def acquire(name: str, limit: int) -> bool:
    r = await db.counters.find_one_and_update({"_id": name, "count": {"$lt": limit}}, {"$inc": {"count": 1}})
    return r is not None


async def release(name: str):
    await db.counters.update_one({"_id": name, "count": {"$gt": 0}}, {"$inc": {"count": -1}})


async def reconcile_counters():
    total = await db.users.count_documents({})
    ops = await db.users.count_documents({"role": "ops"})
    await db.counters.update_one({"_id": "users"}, {"$set": {"count": total}}, upsert=True)
    await db.counters.update_one({"_id": "ops"}, {"$set": {"count": ops}}, upsert=True)


async def quota():
    total = await db.users.count_documents({})
    by_role = {r: await db.users.count_documents({"role": r}) for r in ROLE_LABELS}
    return {"total": total, "max_total": MAX_USERS, "by_role": by_role, "max_ops": MAX_OPS,
            "remaining": max(0, MAX_USERS - total)}


@router.get("")
async def list_users(user=Depends(require("director"))):
    items = [public_user(u) async for u in db.users.find({}, {"_id": 0, "password_hash": 0}).sort("created_at", 1)]
    return {"items": items, "quota": await quota()}


@router.post("")
async def create_user(body: UserCreate, user=Depends(require("director"))):
    validate_password_strength(body.password)
    if not await acquire("users", MAX_USERS):
        await audit(user, "user_create_rejected", "user", None, "denied", "batas 10 akun")
        raise HTTPException(409, "Batas maksimum 10 akun telah tercapai. Akun baru tidak dapat dibuat.")
    if body.role == "ops" and not await acquire("ops", MAX_OPS):
        await release("users")
        raise HTTPException(409, "Batas maksimum 7 akun Operasional telah tercapai.")
    doc = {"id": new_id(), "username": body.username, "name": body.name, "role": body.role,
           "password_hash": hash_password(body.password), "is_active": True, "must_change_password": True,
           "token_version": 0, "created_at": now_iso(), "created_by": user["id"]}
    if body.email:
        doc["email"] = body.email
    try:
        await db.users.insert_one(doc)
    except DuplicateKeyError:
        await release("users")
        if body.role == "ops":
            await release("ops")
        raise HTTPException(409, "Username atau email sudah digunakan.")
    await audit(user, "user_created", "user", doc["id"], detail=f"{body.username} ({ROLE_LABELS[body.role]})")
    return public_user(doc)


@router.patch("/{uid}")
async def update_user(uid: str, body: UserUpdate, user=Depends(require("director"))):
    target = await db.users.find_one({"id": uid}, {"_id": 0})
    if not target:
        raise HTTPException(404, "Akun tidak ditemukan.")
    if target["role"] == "director" and (body.role is not None or body.is_active is not None):
        raise HTTPException(400, "Peran dan status akun direktur tidak dapat diubah.")
    sets, unsets, inc = {}, {}, {}
    if body.name is not None:
        sets["name"] = body.name
    if body.email is not None:
        try:
            em = norm_email(body.email)
        except ValueError as e:
            raise HTTPException(400, str(e))
        if em:
            sets["email"] = em
        else:
            unsets["email"] = ""
    role_changed = body.role is not None and body.role != target["role"]
    acquired_ops = False
    if role_changed:
        if body.role == "ops":
            if not await acquire("ops", MAX_OPS):
                raise HTTPException(409, "Batas maksimum 7 akun Operasional telah tercapai.")
            acquired_ops = True
        sets["role"] = body.role
        inc["token_version"] = 1
    if body.is_active is not None and body.is_active != target.get("is_active"):
        sets["is_active"] = body.is_active
        if not body.is_active:
            inc["token_version"] = 1
    upd = {}
    if sets:
        upd["$set"] = {**sets, "updated_at": now_iso()}
    if unsets:
        upd["$unset"] = unsets
    if inc:
        upd["$inc"] = inc
    if upd:
        # Guard on the role read above so concurrent role changes cannot double-count the ops slot.
        try:
            res = await db.users.update_one({"id": uid, "role": target["role"]}, upd)
        except DuplicateKeyError:
            if acquired_ops:
                await release("ops")
            raise HTTPException(409, "Email sudah digunakan akun lain.")
        if not res.matched_count:
            if acquired_ops:
                await release("ops")
            raise HTTPException(409, "Akun sedang diubah oleh proses lain. Silakan muat ulang lalu coba lagi.")
        if role_changed and target["role"] == "ops":
            await release("ops")
    if role_changed:
        await audit(user, "role_changed", "user", uid, detail=f"{target['role']} -> {body.role}")
    if "is_active" in sets:
        await audit(user, "user_activated" if body.is_active else "user_deactivated", "user", uid, detail=target["username"])
    if "name" in sets or "email" in sets or unsets:
        await audit(user, "user_updated", "user", uid, detail=target["username"])
    return public_user(await db.users.find_one({"id": uid}, {"_id": 0}))


@router.post("/{uid}/reset-password")
async def reset_password(uid: str, body: ResetPwIn, user=Depends(require("director"))):
    validate_password_strength(body.new_password)
    target = await db.users.find_one({"id": uid}, {"_id": 0})
    if not target:
        raise HTTPException(404, "Akun tidak ditemukan.")
    await db.users.update_one({"id": uid}, {"$set": {"password_hash": hash_password(body.new_password),
                                                     "must_change_password": uid != user["id"]},
                                            "$inc": {"token_version": 1}})
    await audit(user, "password_reset", "user", uid, detail=target["username"])
    return {"ok": True}
