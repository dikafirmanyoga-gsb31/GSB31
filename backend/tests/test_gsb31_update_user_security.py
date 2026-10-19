# GSB31 iteration 6: PATCH /api/users/{id} hardening (extra=forbid), ops counter integrity on role change, limits, director protection, RBAC, audit.
# Module-level tests run sequentially. Creates TEST_ users (username test_sec*), removed + counters reconciled in teardown.
import os
import uuid
import concurrent.futures as cf
from pathlib import Path

import pytest
import requests
from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv(Path(__file__).parent.parent / ".env")
BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
API = f"{BASE_URL}/api"
DIR_ID, DIR_PW = os.environ["ADMIN_USERNAME"], os.environ["ADMIN_PASSWORD"]
DIR_EMAIL = os.environ["ADMIN_EMAIL"]
TEMP_PW = os.environ["STAFF_TEMP_PASSWORD"]
NEW_PW = "TestPass12345x"
PW = "Abcdefg123"
RUN = uuid.uuid4().hex[:5]
DB = MongoClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]
S = {}


def login(ident, pw):
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json={"identifier": ident, "password": pw})
    return s, r


def counters_ok():
    c = DB.counters.find_one({"_id": "ops"})["count"]
    a = DB.users.count_documents({"role": "ops"})
    return c, a


def mk(d, name, role, email=None):
    body = {"name": f"TEST_ {name}", "username": f"test_sec{name.lower()}{RUN}", "role": role, "password": PW}
    if email:
        body["email"] = email
    return d.post(f"{API}/users", json=body)


@pytest.fixture(scope="module", autouse=True)
def cleanup():
    yield
    DB.users.delete_many({"username": {"$regex": "^test_sec"}})
    DB.counters.update_one({"_id": "users"}, {"$set": {"count": DB.users.count_documents({})}})
    DB.counters.update_one({"_id": "ops"}, {"$set": {"count": DB.users.count_documents({"role": "ops"})}})


@pytest.fixture(scope="module")
def d():
    s, r = login(DIR_ID, DIR_PW)
    assert r.status_code == 200, r.text
    return s


def test_baseline_counters():
    c, a = counters_ok()
    assert c == a, (c, a)


# ---------- extra=forbid ----------
def test_create_user_A_and_extra_fields_rejected_on_create(d):
    r = d.post(f"{API}/users", json={"name": "TEST_ X", "username": f"test_secx{RUN}", "role": "opfin", "password": PW, "is_active": False})
    assert r.status_code == 422, r.text
    r = d.post(f"{API}/users", json={"name": "TEST_ X", "username": f"test_secx{RUN}", "role": "opfin", "password": PW, "must_change_password": False})
    assert r.status_code == 422
    r = mk(d, "A", "opfin")
    assert r.status_code == 200, r.text
    S["A"] = r.json()
    assert S["A"]["role"] == "opfin"


@pytest.mark.parametrize("field,val", [("token_version", 0), ("password_hash", "x"), ("must_change_password", False),
                                       ("username", "hacker"), ("id", "zzz"), ("created_by", "x")])
def test_patch_unknown_field_rejected(d, field, val):
    uid = S["A"]["id"]
    before = DB.users.find_one({"id": uid}, {"_id": 0})
    r = d.patch(f"{API}/users/{uid}", json={field: val})
    assert r.status_code == 422, (field, r.status_code, r.text)
    # mixed with valid field also rejected and nothing applied
    r = d.patch(f"{API}/users/{uid}", json={"name": "TEST_ Hijack", field: val})
    assert r.status_code == 422
    after = DB.users.find_one({"id": uid}, {"_id": 0})
    assert after == before


def test_reset_password_extra_rejected(d):
    uid = S["A"]["id"]
    r = d.post(f"{API}/users/{uid}/reset-password", json={"new_password": "Abcdefg999", "must_change_password": False})
    assert r.status_code == 422
    r = d.post(f"{API}/users/{uid}/reset-password", json={"new_password": PW})
    assert r.status_code == 200


# ---------- role change counter integrity ----------
def test_role_cycle_counter(d):
    uid = S["A"]["id"]
    for role in ["ops", "opfin", "ops", "opfin"]:
        r = d.patch(f"{API}/users/{uid}", json={"role": role})
        assert r.status_code == 200, r.text
        assert r.json()["role"] == role
        c, a = counters_ok()
        assert c == a, (role, c, a)
    # same role no-op
    r = d.patch(f"{API}/users/{uid}", json={"role": "opfin"})
    assert r.status_code == 200
    assert counters_ok()[0] == counters_ok()[1]


def test_duplicate_email_with_role_ops_no_leak(d):
    uid = S["A"]["id"]
    c0, _ = counters_ok()
    r = d.patch(f"{API}/users/{uid}", json={"email": DIR_EMAIL, "role": "ops"})
    assert r.status_code == 409, r.text
    c1, a1 = counters_ok()
    assert c1 == c0 == a1
    u = DB.users.find_one({"id": uid})
    assert u["role"] == "opfin" and u.get("email") != DIR_EMAIL
    r = d.patch(f"{API}/users/{uid}", json={"email": DIR_EMAIL.upper()})
    assert r.status_code == 409


def test_invalid_email_400(d):
    r = d.patch(f"{API}/users/{S['A']['id']}", json={"email": "not-an-email"})
    assert r.status_code in (400, 422)


def test_concurrent_role_changes(d):
    uid = S["A"]["id"]

    def p(i):
        return d.patch(f"{API}/users/{uid}", json={"role": "ops" if i % 2 == 0 else "opfin"}).status_code
    for _ in range(3):
        with cf.ThreadPoolExecutor(max_workers=12) as ex:
            codes = list(ex.map(p, range(24)))
        assert set(codes) <= {200, 409}, codes
        c, a = counters_ok()
        assert c == a, (codes, c, a)


def test_ops_limit_on_role_change(d):
    uid = S["A"]["id"]
    r = d.patch(f"{API}/users/{uid}", json={"role": "ops"})
    assert r.status_code == 200
    _, a = counters_ok()
    need = 7 - a
    S["extra"] = []
    for i in range(need):
        r = mk(d, f"O{i}", "ops")
        assert r.status_code == 200, r.text
        S["extra"].append(r.json())
    c, a = counters_ok()
    assert c == a == 7
    putri = DB.users.find_one({"username": "putri.anjani"})
    r = d.patch(f"{API}/users/{putri['id']}", json={"role": "ops"})
    assert r.status_code == 409, r.text
    assert DB.users.find_one({"username": "putri.anjani"})["role"] == "opfin"
    c, a = counters_ok()
    assert c == a == 7
    # free a slot via A -> opfin, then ops again allowed
    assert d.patch(f"{API}/users/{uid}", json={"role": "opfin"}).status_code == 200
    assert counters_ok() == (6, 6)
    assert d.patch(f"{API}/users/{uid}", json={"role": "ops"}).status_code == 200
    assert counters_ok() == (7, 7)


# ---------- deactivate / audit ----------
def test_deactivate_revokes_and_audit(d):
    u = S["extra"][0] if S.get("extra") else S["A"]
    s, r = login(u["username"], PW)
    assert r.status_code == 200
    assert s.get(f"{API}/auth/me").status_code == 200
    p = d.patch(f"{API}/users/{u['id']}", json={"is_active": False})
    assert p.status_code == 200 and p.json()["is_active"] is False
    assert s.get(f"{API}/auth/me").status_code == 401
    logs = d.get(f"{API}/audit-logs", params={"action": "user_deactivated"}).json()["items"]
    assert any(l["object_id"] == u["id"] for l in logs)
    logs = d.get(f"{API}/audit-logs", params={"action": "role_changed"}).json()["items"]
    assert any(l["object_id"] == S["A"]["id"] for l in logs)
    p = d.patch(f"{API}/users/{u['id']}", json={"is_active": True})
    assert p.status_code == 200 and p.json()["is_active"] is True


# ---------- director protection ----------
def test_director_protections(d):
    me = d.get(f"{API}/auth/me").json()
    assert d.patch(f"{API}/users/{me['id']}", json={"role": "ops"}).status_code == 400
    assert d.patch(f"{API}/users/{me['id']}", json={"is_active": False}).status_code == 400
    assert d.patch(f"{API}/users/{me['id']}", json={"name": "    "}).status_code == 422
    assert d.patch(f"{API}/users/{me['id']}", json={"name": " a "}).status_code == 422
    orig = me["name"]
    r = d.patch(f"{API}/users/{me['id']}", json={"name": "  Tengku   Erens Test "})
    assert r.status_code == 200 and r.json()["name"] == "Tengku Erens Test"
    r = d.patch(f"{API}/users/{me['id']}", json={"name": orig})
    assert r.status_code == 200 and r.json()["name"] == orig
    r = d.patch(f"{API}/users/{me['id']}", json={"email": "test_sec_dir@example.com"})
    assert r.status_code == 200 and r.json()["email"] == "test_sec_dir@example.com"
    r = d.patch(f"{API}/users/{me['id']}", json={"email": DIR_EMAIL})
    assert r.status_code == 200 and r.json()["email"] == DIR_EMAIL
    assert d.get(f"{API}/auth/me").status_code == 200


def test_spaces_name_rejected_on_create(d):
    r = d.post(f"{API}/users", json={"name": "     ", "username": f"test_secsp{RUN}", "role": "opfin", "password": PW})
    assert r.status_code == 422


# ---------- RBAC ----------
@pytest.mark.parametrize("username", ["putri.anjani", "billy"])
def test_non_director_patch_forbidden(username):
    s, r = login(username, TEMP_PW)
    if r.status_code == 401:
        s, r = login(username, NEW_PW)
    assert r.status_code == 200, r.text
    if r.json()["must_change_password"]:
        assert s.post(f"{API}/auth/change-password", json={"current_password": TEMP_PW, "new_password": NEW_PW}).status_code == 200
    r = s.patch(f"{API}/users/{S['A']['id']}", json={"role": "ops"})
    assert r.status_code == 403
    assert r.json()["detail"]["code"] == "DIRECTOR_ONLY"
    me = s.get(f"{API}/auth/me").json()
    r = s.patch(f"{API}/users/{me['id']}", json={"name": "TEST_ self"})
    assert r.status_code == 403


def test_final_counters():
    c, a = counters_ok()
    assert c == a
