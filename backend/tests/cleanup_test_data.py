# Cleanup helper for GSB31 tests: resets staff temp passwords via director API, removes TEST_ data from MongoDB.
# Run: python /app/backend/tests/cleanup_test_data.py  (then: sudo supervisorctl restart backend to reconcile counters)
import os
import requests
from pathlib import Path
from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv(Path(__file__).parent.parent / ".env")
fe = dict(line.strip().split("=", 1) for line in open("/app/frontend/.env") if "=" in line)
API = fe["REACT_APP_BACKEND_URL"].rstrip("/") + "/api"
TEMP = os.environ["STAFF_TEMP_PASSWORD"]

s = requests.Session()
r = s.post(f"{API}/auth/login", json={"identifier": os.environ["ADMIN_USERNAME"], "password": os.environ["ADMIN_PASSWORD"]})
r.raise_for_status()
users = s.get(f"{API}/users").json()["items"]
for u in users:
    if u["username"] in ("putri.anjani", "firdaus.apek", "billy"):
        print(u["username"], s.post(f"{API}/users/{u['id']}/reset-password", json={"new_password": TEMP}).status_code)
        if not u["is_active"]:
            s.patch(f"{API}/users/{u['id']}", json={"is_active": True})
s.put(f"{API}/settings", json={"quotation_approver_roles": ["director"]})

db = MongoClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]
pids = [p["id"] for p in db.partners.find({"name": {"$regex": "^TEST_"}}, {"id": 1})]
qids = [q["id"] for q in db.quotations.find({"$or": [{"number": {"$regex": "^TEST_"}}, {"partner_id": {"$in": pids}}]}, {"id": 1})]
dids = [d["id"] for d in db.documents.find({"$or": [{"name": {"$regex": "^TEST_"}}, {"partner_id": {"$in": pids}}]}, {"id": 1})]
kids = [k["id"] for k in db.kopra.find({"$or": [{"notes": {"$regex": "^TEST_"}}, {"partner_id": {"$in": pids}}]}, {"id": 1})]
print("users", db.users.delete_many({"username": {"$regex": "^test_"}}).deleted_count)
print("partners", db.partners.delete_many({"id": {"$in": pids}}).deleted_count)
print("quotations", db.quotations.delete_many({"id": {"$in": qids}}).deleted_count)
print("documents", db.documents.delete_many({"id": {"$in": dids}}).deleted_count)
print("files", db.files.delete_many({"document_id": {"$in": dids}}).deleted_count)
print("kopra", db.kopra.delete_many({"id": {"$in": kids}}).deleted_count)
print("transactions", db.transactions.delete_many({"description": {"$regex": "^TEST_"}}).deleted_count)
print("reminders", db.reminders.delete_many({"$or": [{"source_id": {"$in": qids + dids}}, {"title": {"$regex": "TEST_"}}]}).deleted_count)
print("login_attempts", db.login_attempts.delete_many({"key": {"$regex": "test_"}}).deleted_count)
