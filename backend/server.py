from pathlib import Path
from dotenv import load_dotenv

load_dotenv(Path(__file__).parent / ".env")

import os  # noqa: E402
import asyncio  # noqa: E402
import logging  # noqa: E402
from fastapi import FastAPI, APIRouter  # noqa: E402
from starlette.middleware.cors import CORSMiddleware  # noqa: E402

from core import db, client, hash_password, new_id, now_iso, logger  # noqa: E402
from storage import init_storage  # noqa: E402
import routes_auth, routes_users, routes_business, routes_docs, routes_finance, routes_reports, notify, routes_extra  # noqa: E402,E401

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s")

app = FastAPI(title="GSB31")
api = APIRouter(prefix="/api")
for r in (routes_auth, routes_users, routes_business, routes_docs, routes_finance, routes_reports, notify, routes_extra):
    api.include_router(r.router)


@api.get("/")
async def root():
    return {"app": "GSB31", "status": "ok"}


app.include_router(api)
app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ["CORS_ORIGINS"].split(","),
    allow_methods=["*"],
    allow_headers=["*"],
)


async def create_indexes():
    await db.users.create_index("id", unique=True)
    await db.users.create_index("username", unique=True)
    await db.users.create_index("email", unique=True, partialFilterExpression={"email": {"$type": "string"}})
    await db.partners.create_index("id", unique=True)
    await db.partners.create_index("name_key", unique=True)
    await db.quotations.create_index("id", unique=True)
    await db.quotations.create_index("number", unique=True)
    await db.documents.create_index("id", unique=True)
    await db.kopra.create_index("id", unique=True)
    await db.transactions.create_index("id", unique=True)
    await db.files.create_index("id", unique=True)
    await db.reminders.create_index("id", unique=True)
    await db.reminders.create_index("source_key", unique=True)
    await db.audit_logs.create_index([("at", -1)])
    await db.login_attempts.create_index("key", unique=True)
    await db.login_known_ips.create_index([("user_id", 1), ("ip", 1)], unique=True)
    await db.email_logs.create_index([("at", -1)])
    await db.templates.create_index("id", unique=True)


def seed_user(username, name, role, password, email=None, must_change=True):
    d = {"id": new_id(), "username": username, "name": name, "role": role, "password_hash": hash_password(password),
         "is_active": True, "must_change_password": must_change, "token_version": 0, "created_at": now_iso(),
         "created_by": "system"}
    if email:
        d["email"] = email.lower()
    return d


async def seed():
    if not await db.users.find_one({"role": "director"}):
        await db.users.insert_one(seed_user(os.environ["ADMIN_USERNAME"], "Tengku Erens", "director",
                                            os.environ["ADMIN_PASSWORD"], os.environ["ADMIN_EMAIL"], must_change=False))
    if not await db.meta.find_one({"_id": "staff_seeded"}):
        tmp = os.environ["STAFF_TEMP_PASSWORD"]
        for username, name, role in (("putri.anjani", "Putri Anjani", "opfin"), ("firdaus.apek", "Firdaus Apek", "opfin"),
                                     ("billy", "Billy", "ops")):
            if not await db.users.find_one({"username": username}):
                await db.users.insert_one(seed_user(username, name, role, tmp))
        await db.meta.insert_one({"_id": "staff_seeded", "at": now_iso()})


@app.on_event("startup")
async def startup():
    await create_indexes()
    await seed()
    await routes_users.reconcile_counters()
    await routes_docs.sync_reminders()
    try:
        await asyncio.to_thread(init_storage)
        logger.info("Storage initialized")
    except Exception as e:
        logger.error(f"Storage init failed: {type(e).__name__}")


@app.on_event("shutdown")
async def shutdown():
    client.close()
