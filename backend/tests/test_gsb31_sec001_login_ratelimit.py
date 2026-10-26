# SEC-001: login lockout DoS fix — pair/IP/account rate limiting, client_ip trust, auth regression.
import os
import uuid
from datetime import datetime, timezone, timedelta

import bcrypt
import pytest
import requests
from pymongo import MongoClient


def _env(path, key):
    for line in open(path):
        if line.startswith(key + "="):
            return line.split("=", 1)[1].strip().strip('"')


BASE_URL = (os.environ.get("REACT_APP_BACKEND_URL") or _env("/app/frontend/.env", "REACT_APP_BACKEND_URL")).rstrip("/")
LOCAL = "http://localhost:8001"
mongo = MongoClient(_env("/app/backend/.env", "MONGO_URL"))
db = mongo[_env("/app/backend/.env", "DB_NAME")]
PW = "TestSec!2026a"
RUN = uuid.uuid4().hex[:6]
USERS = {}


def _mk(username, role="ops", active=True):
    uid = str(uuid.uuid4())
    db.users.insert_one({"id": uid, "username": username, "name": f"TEST_ {username}", "role": role,
                         "password_hash": bcrypt.hashpw(PW.encode(), bcrypt.gensalt()).decode(),
                         "is_active": active, "must_change_password": False, "token_version": 0,
                         "created_at": datetime.now(timezone.utc).isoformat()})
    USERS[username] = uid
    return uid


@pytest.fixture(scope="module", autouse=True)
def setup_users():
    for name, role, active in [("test_sec_victim", "ops", True), ("test_sec_victim2", "ops", True),
                               ("test_sec_victim3", "ops", True), ("test_sec_reg", "ops", True),
                               ("test_sec_pw", "opfin", True), ("test_sec_reset", "ops", True), ("test_sec_reset2", "ops", True), ("test_sec_inactive", "ops", False)]:
        db.users.delete_many({"username": name})
        _mk(name, role, active)
    yield
    ids = list(USERS.values())
    db.users.delete_many({"id": {"$in": ids}})
    db.login_known_ips.delete_many({"user_id": {"$in": ids}})
    db.login_attempts.delete_many({})


def login_local(ident, pw, ip):
    return requests.post(f"{LOCAL}/api/auth/login", json={"identifier": ident, "password": pw},
                         headers={"X-Forwarded-For": f"{ip}, 10.0.0.1, 10.0.0.2"}, timeout=20)


def ipn(a, b):
    return f"198.18.{a}.{b}"


# ---- client_ip ----
class TestClientIP:
    def test_local_xff_resolution(self):
        ip = ipn(1, 1)
        r = login_local("test_sec_nouser_" + RUN, "x", ip)
        assert r.status_code == 401
        assert db.login_attempts.find_one({"key": f"ip:{ip}"}) is not None

    def test_external_spoofed_xff_ignored(self):
        spoof = "1.2.3.4"
        ident = "test_sec_spoof_" + RUN
        r = requests.post(f"{BASE_URL}/api/auth/login", json={"identifier": ident, "password": "x"},
                          headers={"X-Forwarded-For": spoof}, timeout=20)
        assert r.status_code == 401
        log = db.audit_logs.find_one({"action": "login_failed", "detail": {"$regex": ident}}, sort=[("at", -1)])
        assert log and f"ip={spoof}" not in log["detail"], log
        assert db.login_attempts.find_one({"key": f"pair:{spoof}:{ident}"}) is None
        print("resolved:", log["detail"])

    def test_external_long_spoofed_chain_ignored(self):
        ident = "test_sec_spoof2_" + RUN
        r = requests.post(f"{BASE_URL}/api/auth/login", json={"identifier": ident, "password": "x"},
                          headers={"X-Forwarded-For": "9.9.9.9, 8.8.8.8, 7.7.7.7, 6.6.6.6"}, timeout=20)
        assert r.status_code == 401
        log = db.audit_logs.find_one({"action": "login_failed", "detail": {"$regex": ident}}, sort=[("at", -1)])
        for s in ["9.9.9.9", "8.8.8.8", "7.7.7.7", "6.6.6.6"]:
            assert f"ip={s}" not in log["detail"], log["detail"]
        print("resolved:", log["detail"])


# ---- Scenario 1: pair lock ----
class TestPairLock:
    def test_attacker_ip_locked_victim_other_ip_ok(self):
        A, B = ipn(2, 1), ipn(2, 2)
        codes = [login_local("test_sec_victim", "wrong", A).status_code for _ in range(5)]
        assert codes == [401] * 5, codes
        assert login_local("test_sec_victim", "wrong", A).status_code == 429
        assert login_local("test_sec_victim", PW, A).status_code == 429  # even correct pw from A
        doc = db.login_attempts.find_one({"key": f"pair:{A}:test_sec_victim"})
        assert doc["locks"] == 1
        until = datetime.fromisoformat(doc["locked_until"])
        mins = (until - datetime.now(timezone.utc)).total_seconds() / 60
        assert 14 < mins <= 15.1, mins
        r = login_local("test_sec_victim", PW, B)
        assert r.status_code == 200, r.text
        assert r.json()["username"] == "test_sec_victim"

    def test_backoff_30_then_60_cap(self):
        A = ipn(2, 1)
        key = f"pair:{A}:test_sec_victim"
        expected = [30, 60, 60]
        for exp in expected:
            db.login_attempts.delete_one({"key": "acct:test_sec_victim"})  # isolate from account rule
            db.login_attempts.update_one({"key": key}, {"$set": {"locked_until": (datetime.now(timezone.utc) - timedelta(seconds=1)).isoformat()}})
            for _ in range(5):
                assert login_local("test_sec_victim", "wrong", A).status_code == 401
            doc = db.login_attempts.find_one({"key": key})
            mins = (datetime.fromisoformat(doc["locked_until"]) - datetime.now(timezone.utc)).total_seconds() / 60
            assert exp - 1 < mins <= exp + 0.1, (exp, mins, doc)
            assert login_local("test_sec_victim", "wrong", A).status_code == 429

    def test_identifier_case_insensitive_same_pair(self):
        A = ipn(2, 1)
        assert login_local("TEST_SEC_VICTIM", PW, A).status_code == 429


# ---- Scenario 2: account under distributed attack ----
class TestAccountUnderAttack:
    def test_known_ip_ok_unknown_ip_blocked(self):
        B, C = ipn(3, 200), ipn(3, 201)
        assert login_local("test_sec_victim2", PW, B).status_code == 200  # B becomes known
        assert db.login_known_ips.find_one({"user_id": USERS["test_sec_victim2"], "ip": B})
        codes = [login_local("test_sec_victim2", "wrong", ipn(3, i + 1)).status_code for i in range(12)]
        assert codes == [401] * 10 + [429, 429], codes
        r = login_local("test_sec_victim2", PW, C)
        assert r.status_code == 429, r.text
        r = login_local("test_sec_victim2", PW, B)
        assert r.status_code == 200, r.text
        # attacker using a fresh IP with wrong password is also stopped (doesn't hit pw check)
        assert login_local("test_sec_victim2", "wrong", ipn(3, 150)).status_code == 429

    def test_acct_window_expiry_recovers_unknown_ip(self):
        C = ipn(3, 201)
        db.login_attempts.update_one({"key": "acct:test_sec_victim2"},
                                     {"$set": {"window_start": (datetime.now(timezone.utc) - timedelta(minutes=16)).isoformat()}})
        assert login_local("test_sec_victim2", PW, C).status_code == 200

    def test_known_ip_expired_after_60_days_treated_unknown(self):
        B = ipn(4, 200)
        assert login_local("test_sec_victim3", PW, B).status_code == 200
        for i in range(10):
            login_local("test_sec_victim3", "wrong", ipn(4, i + 1))
        db.login_known_ips.update_one({"user_id": USERS["test_sec_victim3"], "ip": B},
                                      {"$set": {"at": (datetime.now(timezone.utc) - timedelta(days=61)).isoformat()}})
        assert login_local("test_sec_victim3", PW, B).status_code == 429


# ---- Scenario 3: IP spraying ----
class TestIPSpray:
    def test_spray_20_identifiers_blocks_ip(self):
        S = ipn(5, 1)
        codes = [login_local(f"test_sec_spray_{RUN}_{i}", "wrong", S).status_code for i in range(20)]
        assert codes == [401] * 20, codes
        r = login_local("test_sec_reg", PW, S)  # new identifier, even correct pw
        assert r.status_code == 429
        # other IP unaffected
        assert login_local("test_sec_reg", PW, ipn(5, 2)).status_code == 200

    def test_ip_lock_expiry(self):
        S = ipn(5, 1)
        past = (datetime.now(timezone.utc) - timedelta(minutes=16)).isoformat()
        db.login_attempts.update_one({"key": f"ip:{S}"}, {"$set": {"locked_until": past, "window_start": past}})
        assert login_local("test_sec_reg", PW, S).status_code == 200


# ---- Scenario 4: reset on success ----
class TestResetOnSuccess:
    def test_pair_counter_resets_after_success(self):
        A = ipn(6, 1)
        for _ in range(4):
            assert login_local("test_sec_reset", "wrong", A).status_code == 401
        assert login_local("test_sec_reset", PW, A).status_code == 200
        assert db.login_attempts.find_one({"key": f"pair:{A}:test_sec_reset"}) is None
        for _ in range(4):
            assert login_local("test_sec_reset", "wrong", A).status_code == 401
        assert login_local("test_sec_reset", PW, A).status_code == 200

    def test_pair_lock_expiry_recovers(self):
        A = ipn(6, 2)
        for _ in range(5):
            login_local("test_sec_reset2", "wrong", A)
        assert login_local("test_sec_reset2", PW, A).status_code == 429
        db.login_attempts.update_one({"key": f"pair:{A}:test_sec_reset2"},
                                     {"$set": {"locked_until": (datetime.now(timezone.utc) - timedelta(minutes=1)).isoformat()}})
        assert login_local("test_sec_reset2", PW, A).status_code == 200
        # backoff memory cleared after success
        assert db.login_attempts.find_one({"key": f"pair:{A}:test_sec_reset2"}) is None


# ---- Regression (external URL, real cookies) ----
class TestAuthRegression:
    def _login(self, user):
        s = requests.Session()
        r = s.post(f"{BASE_URL}/api/auth/login", json={"identifier": user, "password": PW}, timeout=20)
        return s, r

    def test_login_cookies_me_refresh_logout(self):
        s, r = self._login("test_sec_reg")
        assert r.status_code == 200
        sc = r.headers.get("set-cookie", "").lower()
        assert "access_token" in sc and "refresh_token" in sc and "httponly" in sc and "secure" in sc
        assert s.get(f"{BASE_URL}/api/auth/me").json()["username"] == "test_sec_reg"
        rr = s.post(f"{BASE_URL}/api/auth/refresh")
        assert rr.status_code == 200
        old = s.cookies.get("access_token")
        assert s.post(f"{BASE_URL}/api/auth/logout").json()["ok"] is True
        r2 = requests.get(f"{BASE_URL}/api/auth/me", cookies={"access_token": old})
        assert r2.status_code == 401
        r3 = requests.get(f"{BASE_URL}/api/auth/me", headers={"Authorization": f"Bearer {old}"})
        assert r3.status_code == 401

    def test_rbac_ops_finance_403(self):
        s, r = self._login("test_sec_reg")
        assert r.status_code == 200
        assert s.get(f"{BASE_URL}/api/finance/summary").status_code == 403

    def test_inactive_403(self):
        _, r = self._login("test_sec_inactive")
        assert r.status_code == 403

    def test_wrong_password_401(self):
        r = requests.post(f"{BASE_URL}/api/auth/login", json={"identifier": "test_sec_reg", "password": "nope"}, timeout=20)
        assert r.status_code == 401

    def test_change_password(self):
        s, r = self._login("test_sec_pw")
        assert r.status_code == 200
        old = s.cookies.get("access_token")
        r = s.post(f"{BASE_URL}/api/auth/change-password", json={"current_password": PW, "new_password": "NewSecPw2026x"})
        assert r.status_code == 200, r.text
        assert requests.get(f"{BASE_URL}/api/auth/me", cookies={"access_token": old}).status_code == 401
        assert s.get(f"{BASE_URL}/api/auth/me").status_code == 200
        r = requests.post(f"{BASE_URL}/api/auth/login", json={"identifier": "test_sec_pw", "password": "NewSecPw2026x"}, timeout=20)
        assert r.status_code == 200
