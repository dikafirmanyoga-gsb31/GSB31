# GSB31 iteration 3: weekly business summary (preview, manual run disabled, cron webhook) + document templates (upload/list/download/archive).
# NOTE: this suite never sends a real email (weekly_summary_enabled is set false before any run/cron call). Run with -n 0.
import os
import time
import uuid
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

import pytest
import requests
from dotenv import dotenv_values
from pymongo import MongoClient

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
API = f"{BASE_URL}/api"
ENV = dotenv_values("/app/backend/.env")
CRON_SECRET = ENV["WEBHOOK_CRON_SECRET"]
DIR_ID, DIR_PW = "tengku.erens", "GSB31-Direktur!2026"
TEMP_PW = "GSB31-Sementara!26"
NEW_PW = "TestPass12345x"
RUN = uuid.uuid4().hex[:6]
STATE = {}
db = MongoClient(ENV["MONGO_URL"])[ENV["DB_NAME"]]

TODAY = datetime.now(ZoneInfo("Asia/Jakarta")).date()
W_START = TODAY - timedelta(days=TODAY.weekday() + 7)
W_END = W_START + timedelta(days=6)


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


def iso(dt):
    return dt.isoformat()


# ---------- Weekly summary: RBAC ----------
def test_weekly_rbac(putri, billy):
    for s in (putri, billy):
        for r in (s.get(f"{API}/notifications/weekly-summary/preview"), s.post(f"{API}/notifications/weekly-summary/run")):
            assert r.status_code == 403
            assert r.json()["detail"]["code"] == "DIRECTOR_ONLY"
    assert requests.get(f"{API}/notifications/weekly-summary/preview").status_code == 401


# ---------- Weekly summary: preview period + counts ----------
def test_weekly_preview_counts(d):
    base = d.get(f"{API}/notifications/weekly-summary/preview")
    assert base.status_code == 200, base.text
    b = base.json()
    assert b["start"] == iso(W_START) and b["end"] == iso(W_END)
    assert W_START.weekday() == 0 and W_END.weekday() == 6

    p = d.post(f"{API}/partners", json={"name": f"TEST_Weekly {RUN}", "types": ["pelanggan"]})
    assert p.status_code == 200, p.text
    pid = p.json()["id"]
    items = [{"description": "Kopra", "quantity": 2, "unit": "ton", "unit_price": 1000}]
    mid = W_START + timedelta(days=2)
    qa = d.post(f"{API}/quotations", json={"number": f"TEST_WA{RUN}", "date": iso(mid), "valid_until": iso(TODAY + timedelta(days=20)),
                                           "partner_id": pid, "items": items})
    assert qa.status_code == 200, qa.text
    qb = d.post(f"{API}/quotations", json={"number": f"TEST_WB{RUN}", "date": iso(W_START - timedelta(days=7)),
                                           "valid_until": iso(TODAY + timedelta(days=20)), "partner_id": pid, "items": items})
    qc = d.post(f"{API}/quotations", json={"number": f"TEST_WC{RUN}", "date": iso(TODAY), "valid_until": iso(TODAY + timedelta(days=20)),
                                           "partner_id": pid, "items": items})
    assert qb.status_code == 200 and qc.status_code == 200
    # inject decision history inside / outside period
    db.quotations.update_one({"id": qa.json()["id"]}, {"$set": {"status": "sent"}, "$push": {"history": {"$each": [
        {"status": "pending", "at": f"{iso(mid)}T02:00:00+00:00"},
        {"status": "approved", "at": f"{iso(mid + timedelta(days=1))}T03:00:00+00:00"},
        {"status": "sent", "at": f"{iso(W_END)}T03:00:00+00:00"}]}}})
    db.quotations.update_one({"id": qb.json()["id"]}, {"$set": {"status": "rejected"}, "$push": {"history": {"$each": [
        {"status": "rejected", "at": f"{iso(W_START)}T01:00:00+00:00"},
        {"status": "approved", "at": f"{iso(W_START - timedelta(days=1))}T01:00:00+00:00"}]}}})

    # contracts
    k1 = d.post(f"{API}/documents", json={"kind": "kontrak", "name": f"TEST_WK1 {RUN}", "category": "Kontrak",
                                          "expiry_date": iso(TODAY + timedelta(days=10)), "partner_id": pid})
    k2 = d.post(f"{API}/documents", json={"kind": "kontrak", "name": f"TEST_WK2 {RUN}", "category": "Kontrak",
                                          "expiry_date": iso(TODAY - timedelta(days=5)), "partner_id": pid})
    k3 = d.post(f"{API}/documents", json={"kind": "kontrak", "name": f"TEST_WK3 {RUN}", "category": "Kontrak",
                                          "expiry_date": iso(TODAY + timedelta(days=60)), "partner_id": pid})
    for k in (k1, k2, k3):
        assert k.status_code == 200, k.text
    db.documents.update_one({"id": k3.json()["id"]}, {"$set": {"created_at": f"{iso(W_START + timedelta(days=3))}T05:00:00+00:00"}})

    # transactions
    def tx(t, dt, amt):
        r = d.post(f"{API}/finance/transactions", json={"type": t, "date": iso(dt), "category": "Pendapatan Lain" if t == "pemasukan" else "Lainnya", "amount": amt,
                                                         "description": f"TEST_weekly {RUN}"})
        assert r.status_code == 200, r.text
        return r.json()["id"]
    tx("pemasukan", W_START + timedelta(days=1), 1000000)
    tx("pemasukan", W_START, 100)
    tx("pengeluaran", W_END, 250000)
    vid = tx("pemasukan", W_START + timedelta(days=2), 500000)
    tx("pemasukan", W_START - timedelta(days=1), 7)
    tx("pemasukan", W_END + timedelta(days=1), 999)
    v = d.post(f"{API}/finance/transactions/{vid}/void", json={"reason": "TEST_ void"})
    assert v.status_code == 200, v.text

    a = d.get(f"{API}/notifications/weekly-summary/preview").json()
    STATE["preview"] = a
    assert a["quotations_created"] == b["quotations_created"] + 1
    assert round(a["quotations_value"] - b["quotations_value"], 2) == 2000
    assert a["decided"]["approved"] == b["decided"]["approved"] + 1
    assert a["decided"]["sent"] == b["decided"]["sent"] + 1
    assert a["decided"]["rejected"] == b["decided"]["rejected"] + 1
    assert a["new_contracts"] == b["new_contracts"] + 1
    assert len(a["contracts_expiring"]) == len(b["contracts_expiring"]) + 1
    assert any(x["name"] == f"TEST_WK1 {RUN}" and x["days_left"] == 10 for x in a["contracts_expiring"])
    assert a["contracts_expired"] == b["contracts_expired"] + 1
    assert round(a["cash"]["income"] - b["cash"]["income"], 2) == 1000100
    assert round(a["cash"]["expense"] - b["cash"]["expense"], 2) == 250000
    assert a["cash"]["count"] == b["cash"]["count"] + 3
    assert "_id" not in str(a)


# ---------- Weekly summary: disabled manual run + cron ----------
def test_weekly_run_disabled_and_cron(d):
    r = d.put(f"{API}/settings", json={"weekly_summary_enabled": False})
    assert r.status_code == 200, r.text
    assert d.get(f"{API}/settings").json()["weekly_summary_enabled"] is False
    logs0 = db.email_logs.count_documents({})
    try:
        run = d.post(f"{API}/notifications/weekly-summary/run")
        assert run.status_code == 200 and run.json()["status"] == "disabled" and run.json()["sent"] == 0
        url = f"{API}/cron/weekly-summary"
        assert requests.post(url).status_code == 401
        assert requests.post(url, headers={"Authorization": "Bearer wrong"}).status_code == 401
        assert requests.post(url, headers={"Authorization": CRON_SECRET}).status_code == 401
        wid = f"TEST_weekly_{RUN}"
        h = {"Authorization": f"Bearer {CRON_SECRET}", "X-Webhook-Id": wid}
        t0 = time.time()
        c1 = requests.post(url, headers=h, json={})
        assert c1.status_code == 200 and c1.json()["accepted"] is True
        assert time.time() - t0 < 10
        c2 = requests.post(url, headers=h, json={})
        assert c2.status_code == 200
        assert db.cron_runs.count_documents({"_id": wid}) == 1
        assert db.cron_runs.find_one({"_id": wid})["job"] == "weekly-summary"
        time.sleep(3)
        assert db.email_logs.count_documents({}) == logs0
    finally:
        d.put(f"{API}/settings", json={"weekly_summary_enabled": True})
    assert d.get(f"{API}/settings").json()["weekly_summary_enabled"] is True


# ---------- Templates ----------
DOCX = b"PK\x03\x04TEST_docx_content" + os.urandom(64)
PDF = b"%PDF-1.4\nTEST_pdf\n%%EOF"
PNG = b"\x89PNG\r\n\x1a\n" + os.urandom(32)


def upload(s, name, category, fname, data, ctype="application/octet-stream", notes=None):
    form = {"name": name, "category": category}
    if notes:
        form["notes"] = notes
    return s.post(f"{API}/templates", data=form, files={"file": (fname, data, ctype)})


def test_template_upload_rbac(putri, billy):
    for s in (putri, billy):
        r = upload(s, f"TEST_tpl {RUN}", "Penawaran", "a.pdf", PDF)
        assert r.status_code == 403 and r.json()["detail"]["code"] == "DIRECTOR_ONLY"
    assert upload(requests, f"TEST_tpl {RUN}", "Penawaran", "a.pdf", PDF).status_code == 401


def test_template_upload_validation(d):
    r = upload(d, f"TEST_bad {RUN}", "Bukan Kategori", "a.pdf", PDF)
    assert r.status_code == 400 and "Kategori" in r.json()["detail"]
    r = upload(d, f"TEST_bad {RUN}", "Penawaran", "virus.exe", b"MZ123")
    assert r.status_code == 400
    r = upload(d, f"TEST_bad {RUN}", "Penawaran", "noext", b"abc")
    assert r.status_code == 400
    r = upload(d, f"TEST_bad {RUN}", "Penawaran", "empty.pdf", b"")
    assert r.status_code == 400
    r = upload(d, "X", "Penawaran", "a.pdf", PDF)
    assert r.status_code == 422
    big = b"0" * (15 * 1024 * 1024 + 10)
    r = upload(d, f"TEST_big {RUN}", "Penawaran", "big.pdf", big)
    assert r.status_code in (400, 413), r.status_code
    STATE["big_status"] = r.status_code
    assert db.templates.count_documents({"name": {"$regex": "^TEST_(bad|big)"}}) == 0


def test_template_upload_and_list(d, putri, billy):
    created = []
    for nm, cat, fn, data in [(f"TEST_Kop {RUN}", "Kop Surat", "kop.docx", DOCX), (f"TEST_Pen {RUN}", "Penawaran", "penawaran.PDF", PDF),
                              (f"TEST_Tri {RUN}", "Kontrak Tripartit", "tri.png", PNG)]:
        r = upload(d, nm, cat, fn, data, notes="TEST_ notes")
        assert r.status_code == 200, r.text
        t = r.json()
        assert t["name"] == nm and t["category"] == cat and t["size"] == len(data) and t["is_archived"] is False
        assert "storage_path" not in t and "_id" not in t
        created.append(t)
    assert created[1]["ext"] == "pdf" and created[1]["content_type"] == "application/pdf"
    STATE["tpls"] = created
    for s in (d, putri, billy):
        r = s.get(f"{API}/templates")
        assert r.status_code == 200
        js = r.json()
        ids = {x["id"] for x in js["items"]}
        assert all(t["id"] in ids for t in created)
        assert "Kontrak Kerja Sama" in js["categories"]
        assert all("storage_path" not in x for x in js["items"])
    r = billy.get(f"{API}/templates", params={"category": "Kop Surat"}).json()["items"]
    assert all(x["category"] == "Kop Surat" for x in r) and any(x["id"] == created[0]["id"] for x in r)
    r = billy.get(f"{API}/templates", params={"q": "penawaran.pdf"}).json()["items"]
    assert any(x["id"] == created[1]["id"] for x in r)
    assert requests.get(f"{API}/templates").status_code == 401


def test_template_download(d, putri, billy):
    t = STATE["tpls"][0]
    for s in (d, putri, billy):
        r = s.get(f"{API}/templates/{t['id']}/file")
        assert r.status_code == 200, r.text
        assert r.content == DOCX
        assert "attachment" in r.headers["content-disposition"] and "kop.docx" in r.headers["content-disposition"]
        assert "wordprocessingml" in r.headers["content-type"]
    assert requests.get(f"{API}/templates/{t['id']}/file").status_code == 401
    assert d.get(f"{API}/templates/nope/file").status_code == 404


def test_template_unicode_filename_download(d):
    r = upload(d, f"TEST_Uni {RUN}", "Lainnya", "Kontrak—Tripartit Ü.pdf", PDF)
    assert r.status_code == 200, r.text
    STATE["uni"] = r.json()["id"]
    g = d.get(f"{API}/templates/{r.json()['id']}/file")
    assert g.status_code == 200, f"unicode filename download -> {g.status_code}"


def test_template_archive(d, putri, billy):
    t = STATE["tpls"][2]
    for s in (putri, billy):
        r = s.post(f"{API}/templates/{t['id']}/archive")
        assert r.status_code == 403 and r.json()["detail"]["code"] == "DIRECTOR_ONLY"
    r = d.post(f"{API}/templates/{t['id']}/archive")
    assert r.status_code == 200 and r.json()["is_archived"] is True
    ids = {x["id"] for x in billy.get(f"{API}/templates").json()["items"]}
    assert t["id"] not in ids
    ids = {x["id"] for x in d.get(f"{API}/templates", params={"include_archived": "true"}).json()["items"]}
    assert t["id"] in ids
    r = d.post(f"{API}/templates/{t['id']}/archive")
    assert r.status_code == 200 and r.json()["is_archived"] is False
    assert t["id"] in {x["id"] for x in billy.get(f"{API}/templates").json()["items"]}
    assert d.post(f"{API}/templates/nope/archive").status_code == 404
