# GSB31 backend regression suite: auth, RBAC, user quota, partners, kopra, quotations, documents/reminders, finance, audit.
# NOTE: module-level functions only (xdist loadscope keeps them on one worker, sequential). All created data prefixed TEST_.
import os
import io
import uuid
import concurrent.futures as cf
from datetime import date, timedelta

import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
API = f"{BASE_URL}/api"
DIR_ID, DIR_PW = "tengku.erens", "GSB31-Direktur!2026"
DIR_EMAIL = "dikafirmanyoga@gmail.com"
TEMP_PW = "GSB31-Sementara!26"
NEW_PW = "TestPass12345x"
RUN = uuid.uuid4().hex[:6]
STATE = {}


def login(ident, pw):
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json={"identifier": ident, "password": pw})
    return s, r


def staff_session(username):
    s, r = login(username, TEMP_PW)
    if r.status_code == 401:
        s, r = login(username, NEW_PW)
    assert r.status_code == 200, r.text
    if r.json()["must_change_password"]:
        c = s.post(f"{API}/auth/change-password", json={"current_password": TEMP_PW, "new_password": NEW_PW})
        assert c.status_code == 200, c.text
    return s


@pytest.fixture(scope="module")
def d():
    s, r = login(DIR_ID, DIR_PW)
    assert r.status_code == 200, r.text
    return s


@pytest.fixture(scope="module")
def putri():
    return staff_session("putri.anjani")


@pytest.fixture(scope="module")
def billy():
    return staff_session("billy")


# ---------- Auth ----------
def test_login_username_and_cookies():
    s, r = login(DIR_ID, DIR_PW)
    assert r.status_code == 200
    assert r.json()["role"] == "director"
    sc = r.headers.get("set-cookie", "")
    # ingress rewrites SameSite to None; Partitioned - only check httponly/secure
    assert "access_token" in sc and "httponly" in sc.lower() and "secure" in sc.lower()
    assert "password_hash" not in r.json()


def test_login_email():
    s, r = login(DIR_EMAIL.upper(), DIR_PW)
    assert r.status_code == 200 and r.json()["username"] == DIR_ID


def test_wrong_password_and_lockout():
    ident = f"test_lock_{RUN}"
    codes = [requests.post(f"{API}/auth/login", json={"identifier": ident, "password": "x"}).status_code for _ in range(6)]
    assert codes[:5] == [401] * 5, codes
    assert codes[5] == 429, codes


def test_no_register_endpoint():
    r = requests.post(f"{API}/auth/register", json={"username": "x", "password": "y"})
    assert r.status_code in (404, 405)


def test_must_change_password_blocks_apis():
    s, r = login("firdaus.apek", TEMP_PW)
    if r.status_code != 200:
        pytest.skip("firdaus already changed")
    assert r.json()["must_change_password"] is True
    g = s.get(f"{API}/partners")
    assert g.status_code == 403 and g.json()["detail"]["code"] == "PASSWORD_CHANGE_REQUIRED"
    assert s.get(f"{API}/auth/me").status_code == 200
    weak = s.post(f"{API}/auth/change-password", json={"current_password": TEMP_PW, "new_password": "short"})
    assert weak.status_code in (400, 422)
    c = s.post(f"{API}/auth/change-password", json={"current_password": TEMP_PW, "new_password": NEW_PW})
    assert c.status_code == 200 and c.json()["must_change_password"] is False
    assert s.get(f"{API}/partners").status_code == 200


# ---------- RBAC ----------
def test_opfin_director_only(putri):
    for m, p in [("get", "/users"), ("get", "/director/summary"), ("get", "/audit-logs")]:
        r = getattr(putri, m)(f"{API}{p}")
        assert r.status_code == 403 and r.json()["detail"]["code"] == "DIRECTOR_ONLY", (p, r.text)
    r = putri.put(f"{API}/settings", json={"quotation_approver_roles": ["director", "opfin"]})
    assert r.status_code == 403 and r.json()["detail"]["code"] == "DIRECTOR_ONLY"
    assert putri.get(f"{API}/finance/summary").status_code == 200
    assert "finance" in putri.get(f"{API}/dashboard").json()


def test_ops_finance_restricted(billy):
    for p in ["/finance/transactions", "/finance/summary"]:
        r = billy.get(f"{API}{p}")
        assert r.status_code == 403 and r.json()["detail"]["code"] == "FINANCE_RESTRICTED"
    r = billy.post(f"{API}/finance/transactions", json={"type": "pemasukan", "date": "2026-01-10", "category": "Penjualan Kopra", "amount": 1, "description": "TEST_x"})
    assert r.status_code == 403
    dash = billy.get(f"{API}/dashboard")
    assert dash.status_code == 200 and "finance" not in dash.json()
    assert billy.get(f"{API}/users").status_code == 403
    r = billy.post(f"{API}/access/check", json={"feature": "finance"})
    assert r.status_code == 403 and r.json()["detail"]["code"] == "FINANCE_RESTRICTED"


def test_staff_cannot_create_user(putri, billy):
    for s in (putri, billy):
        r = s.post(f"{API}/users", json={"name": "TEST_x", "username": f"test_x{RUN}", "role": "ops", "password": "Abcdefg123"})
        assert r.status_code == 403


# ---------- Users quota ----------
def test_concurrent_user_creation_caps_at_10(d):
    q = d.get(f"{API}/users").json()["quota"]
    remaining = q["remaining"]
    STATE["initial_total"] = q["total"]

    def mk(i):
        return d.post(f"{API}/users", json={"name": f"TEST_ User {i}", "username": f"test_u{i}_{RUN}", "role": "ops", "password": "Abcdefg123"})
    with cf.ThreadPoolExecutor(max_workers=10) as ex:
        res = list(ex.map(mk, range(remaining + 3)))
    codes = [r.status_code for r in res]
    assert codes.count(200) == remaining, codes
    assert codes.count(409) == 3, codes
    STATE["test_users"] = [r.json() for r in res if r.status_code == 200]
    q2 = d.get(f"{API}/users").json()["quota"]
    assert q2["total"] == 10


def test_11th_user_rejected(d):
    r = d.post(f"{API}/users", json={"name": "TEST_ Eleven", "username": f"test_11_{RUN}", "role": "opfin", "password": "Abcdefg123"})
    assert r.status_code == 409


def test_ops_max_7_via_role_change(d):
    q = d.get(f"{API}/users").json()
    if q["quota"]["by_role"]["ops"] < 7:
        pytest.skip("ops not at 7")
    putri_u = next(u for u in q["items"] if u["username"] == "putri.anjani")
    r = d.patch(f"{API}/users/{putri_u['id']}", json={"role": "ops"})
    if r.status_code == 200:
        d.patch(f"{API}/users/{putri_u['id']}", json={"role": "opfin"})
    assert r.status_code == 409, r.text


def test_deactivate_kills_session(d):
    u = STATE["test_users"][0]
    s, r = login(u["username"], "Abcdefg123")
    assert r.status_code == 200
    assert s.get(f"{API}/auth/me").status_code == 200
    p = d.patch(f"{API}/users/{u['id']}", json={"is_active": False})
    assert p.status_code == 200 and p.json()["is_active"] is False
    assert s.get(f"{API}/auth/me").status_code == 401
    _, r2 = login(u["username"], "Abcdefg123")
    assert r2.status_code == 403
    # inactive still counted
    assert d.get(f"{API}/users").json()["quota"]["total"] == 10


def test_director_role_immutable(d):
    me = d.get(f"{API}/auth/me").json()
    r = d.patch(f"{API}/users/{me['id']}", json={"role": "ops"})
    assert r.status_code == 400


# ---------- Partners ----------
def test_partner_crud_and_dedupe(billy):
    name = f"TEST_ Mitra {RUN}"
    r = billy.post(f"{API}/partners", json={"name": name, "types": ["pelanggan"], "phone": "0812"})
    assert r.status_code == 200, r.text
    STATE["partner"] = r.json()
    dup = billy.post(f"{API}/partners", json={"name": "  " + name.upper().replace(" ", "  ") + " ", "types": ["pemasok"]})
    assert dup.status_code == 409
    u = billy.put(f"{API}/partners/{r.json()['id']}", json={"name": name, "types": ["pelanggan", "pemasok"], "location": "Dumai"})
    assert u.status_code == 200 and u.json()["location"] == "Dumai"
    g = billy.get(f"{API}/partners/{r.json()['id']}")
    assert g.status_code == 200 and set(g.json()["types"]) == {"pelanggan", "pemasok"}


# ---------- Kopra ----------
def test_kopra_price_stripping(putri, billy):
    pid = STATE["partner"]["id"]
    r = putri.post(f"{API}/kopra", json={"activity_type": "Pembelian", "date": date.today().isoformat(), "partner_id": pid,
                                         "quantity": 100, "unit": "kg", "price_per_unit": 12000, "notes": "TEST_kopra"})
    assert r.status_code == 200, r.text
    assert r.json()["total_value"] == 1200000
    kid = r.json()["id"]
    STATE["kopra"] = kid
    lst = billy.get(f"{API}/kopra").json()
    k = next(x for x in lst if x["id"] == kid)
    assert "price_per_unit" not in k and "total_value" not in k
    # billy updates quantity; price preserved
    u = billy.put(f"{API}/kopra/{kid}", json={"activity_type": "Pembelian", "date": date.today().isoformat(), "partner_id": pid,
                                             "quantity": 200, "unit": "kg", "price_per_unit": 1, "notes": "TEST_kopra"})
    assert u.status_code == 200 and "price_per_unit" not in u.json()
    k2 = next(x for x in putri.get(f"{API}/kopra").json() if x["id"] == kid)
    assert k2["price_per_unit"] == 12000 and k2["total_value"] == 2400000
    dash = billy.get(f"{API}/dashboard").json()
    assert all("price_per_unit" not in x and "total_value" not in x for x in dash["recent_kopra"])
    pd = billy.get(f"{API}/partners/{pid}").json()
    assert all("price_per_unit" not in x for x in pd["kopra"])


# ---------- Quotations ----------
def test_quotation_flow_and_approval_rbac(d, putri, billy):
    pid = STATE["partner"]["id"]
    t = date.today()
    body = {"number": f"TEST_Q{RUN}", "date": t.isoformat(), "valid_until": (t + timedelta(days=10)).isoformat(),
            "partner_id": pid, "subject": "TEST_ sub", "tax_percent": 11,
            "items": [{"description": "Kopra", "quantity": 10, "unit": "ton", "unit_price": 1000},
                      {"description": "Ongkir", "quantity": 1, "unit": "trip", "unit_price": 500}]}
    r = billy.post(f"{API}/quotations", json={**body, "subtotal": 1, "total": 1})
    assert r.status_code == 200, r.text
    q = r.json()
    assert q["subtotal"] == 10500 and q["tax_amount"] == 1155 and q["total"] == 11655 and q["status"] == "draft"
    STATE["quotation"] = q["id"]
    assert billy.post(f"{API}/quotations", json=body).status_code == 409
    assert billy.post(f"{API}/quotations/{q['id']}/status", json={"status": "approved"}).status_code == 400
    assert billy.post(f"{API}/quotations/{q['id']}/status", json={"status": "pending"}).status_code == 200
    for s in (billy, putri):
        r = s.post(f"{API}/quotations/{q['id']}/status", json={"status": "approved"})
        assert r.status_code == 403 and r.json()["detail"]["code"] == "DIRECTOR_ONLY"
    # enable opfin approval
    st = d.put(f"{API}/settings", json={"quotation_approver_roles": ["opfin"]})
    assert st.status_code == 200 and set(st.json()["quotation_approver_roles"]) == {"director", "opfin"}
    try:
        assert billy.post(f"{API}/quotations/{q['id']}/status", json={"status": "approved"}).status_code == 403
        a = putri.post(f"{API}/quotations/{q['id']}/status", json={"status": "approved"})
        assert a.status_code == 200 and a.json()["status"] == "approved"
    finally:
        d.put(f"{API}/settings", json={"quotation_approver_roles": ["director"]})
    s2 = billy.post(f"{API}/quotations/{q['id']}/status", json={"status": "sent"})
    assert s2.status_code == 200 and s2.json()["status"] == "sent"
    # edit not allowed after sent
    assert billy.put(f"{API}/quotations/{q['id']}", json=body).status_code == 400
    assert d.get(f"{API}/settings").json()["quotation_approver_roles"] == ["director"]


def test_quotation_reminder_single(billy):
    rs = billy.get(f"{API}/reminders").json()
    hits = [r for r in rs if r.get("source_id") == STATE["quotation"]]
    assert len(hits) == 1 and hits[0]["level"] == "H-14"


# ---------- Documents / reminders / files ----------
def test_document_reminder_no_duplicates(billy):
    exp = (date.today() + timedelta(days=20)).isoformat()
    body = {"kind": "kontrak", "name": f"TEST_ Kontrak {RUN}", "category": "Kontrak", "expiry_date": exp,
            "partner_id": STATE["partner"]["id"]}
    r = billy.post(f"{API}/documents", json=body)
    assert r.status_code == 200, r.text
    did = r.json()["id"]
    STATE["doc"] = did
    assert r.json()["validity"] == "segera"
    for _ in range(3):
        billy.get(f"{API}/reminders")
    billy.put(f"{API}/documents/{did}", json={**body, "notes": "TEST_ upd"})
    billy.put(f"{API}/documents/{did}", json={**body, "expiry_date": (date.today() + timedelta(days=5)).isoformat()})
    rs = billy.get(f"{API}/reminders?status=all").json()
    hits = [x for x in rs if x.get("source_id") == did]
    assert len(hits) == 1, hits
    assert hits[0]["level"] == "H-7"
    STATE["reminder"] = hits[0]["id"]


def test_mark_reminder_done(billy):
    r = billy.patch(f"{API}/reminders/{STATE['reminder']}", json={"status": "done", "follow_up_note": "TEST_ ok"})
    assert r.status_code == 200 and r.json()["status"] == "done"
    open_ids = [x["id"] for x in billy.get(f"{API}/reminders").json()]
    assert STATE["reminder"] not in open_ids
    done = [x for x in billy.get(f"{API}/reminders?status=done").json() if x["id"] == STATE["reminder"]]
    assert len(done) == 1


def test_file_upload_download(billy):
    did = STATE["doc"]
    pdf = b"%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF"
    r = billy.post(f"{API}/documents/{did}/files", files={"file": ("TEST_file.pdf", io.BytesIO(pdf), "application/pdf")})
    assert r.status_code == 200, r.text
    fid = r.json()["id"]
    STATE["file"] = fid
    png = b"\x89PNG\r\n\x1a\n" + b"0" * 50
    assert billy.post(f"{API}/documents/{did}/files", files={"file": ("TEST_img.png", io.BytesIO(png), "image/png")}).status_code == 200
    assert billy.post(f"{API}/documents/{did}/files", files={"file": ("x.exe", io.BytesIO(b"MZ"), "application/octet-stream")}).status_code == 400
    g = billy.get(f"{API}/files/{fid}")
    assert g.status_code == 200 and g.content == pdf
    assert requests.get(f"{API}/files/{fid}").status_code == 401
    det = billy.get(f"{API}/documents/{did}").json()
    assert len(det["files"]) == 2 and all("storage_path" not in f for f in det["files"])


# ---------- Finance ----------
def test_finance_crud_summary_void(d, putri):
    before = putri.get(f"{API}/finance/summary").json()
    r = putri.post(f"{API}/finance/transactions", json={"type": "pemasukan", "date": date.today().isoformat(),
                                                         "category": "Penjualan Kopra", "amount": 5000000, "description": "TEST_ tx"})
    assert r.status_code == 200, r.text
    tid = r.json()["id"]
    STATE["tx"] = tid
    u = putri.put(f"{API}/finance/transactions/{tid}", json={"type": "pemasukan", "date": date.today().isoformat(),
                                                             "category": "Penjualan Kopra", "amount": 6000000, "description": "TEST_ tx2"})
    assert u.status_code == 200 and u.json()["amount"] == 6000000
    after = putri.get(f"{API}/finance/summary").json()
    assert round(after["income"] - before["income"], 2) == 6000000
    bad = putri.post(f"{API}/finance/transactions", json={"type": "pemasukan", "date": date.today().isoformat(),
                                                           "category": "Gaji", "amount": 1, "description": "TEST_ bad"})
    assert bad.status_code == 400
    v = putri.post(f"{API}/finance/transactions/{tid}/void", json={"reason": "TEST_ salah"})
    assert v.status_code == 403 and v.json()["detail"]["code"] == "DIRECTOR_ONLY"
    v2 = d.post(f"{API}/finance/transactions/{tid}/void", json={"reason": "TEST_ salah"})
    assert v2.status_code == 200
    assert putri.get(f"{API}/finance/summary").json()["income"] == before["income"]


# ---------- Director / audit ----------
def test_director_summary_and_audit(d):
    s = d.get(f"{API}/director/summary")
    assert s.status_code == 200 and s.json()["users"]["total"] == 10
    a = d.get(f"{API}/audit-logs?limit=200").json()
    acts = set(a["actions"])
    for need in ["login_success", "login_failed", "access_denied", "user_created", "user_deactivated", "password_changed",
                 "quotation_status_changed", "finance_voided", "settings_updated"]:
        assert need in acts, need
    assert all("_id" not in x for x in a["items"])
