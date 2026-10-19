# Seed TEST_ partner/quotation/document/transaction for mobile card + camera upload UI tests; writes ids to /tmp/seed.json
import json
import requests
from PIL import Image
import random

fe = dict(line.strip().split("=", 1) for line in open("/app/frontend/.env") if "=" in line)
API = fe["REACT_APP_BACKEND_URL"].rstrip("/") + "/api"
s = requests.Session()
s.post(f"{API}/auth/login", json={"identifier": "tengku.erens", "password": "GSB31-Direktur!2026"}).raise_for_status()
p = s.post(f"{API}/partners", json={"name": "TEST_Mobile Mitra Kartu", "types": ["pelanggan"]}).json()
q = s.post(f"{API}/quotations", json={"number": "TEST_QM-001", "date": "2026-01-10", "valid_until": "2026-03-10", "partner_id": p["id"],
                                     "subject": "TEST_ kartu", "items": [{"description": "Kopra", "quantity": 2, "unit": "ton", "unit_price": 1500000}]}).json()
d = s.post(f"{API}/documents", json={"kind": "dokumen", "name": "TEST_Dok Foto HP", "number": "TEST-D-1", "category": "Legalitas", "issue_date": "2026-01-01",
                                    "expiry_date": "2026-12-31", "partner_id": p["id"]})
print("doc", d.status_code, d.text[:200])
d = d.json()
t = s.post(f"{API}/finance/transactions", json={"type": "pemasukan", "date": "2026-01-12", "category": s.get(f"{API}/settings").json()["income_categories"][0],
                                               "amount": 2500000, "description": "TEST_ transaksi kartu", "partner_id": p["id"]}).json()
json.dump({"partner": p["id"], "quotation": q.get("id"), "document": d.get("id"), "transaction": t.get("id")}, open("/tmp/seed.json", "w"))
print(open("/tmp/seed.json").read())

# large noisy JPEG 4000x3000 and small PNG
img = Image.new("RGB", (4000, 3000))
px = img.load()
for y in range(0, 3000, 4):
    for x in range(0, 4000, 4):
        c = (random.randint(0, 255), random.randint(0, 255), random.randint(0, 255))
        for dy in range(4):
            for dx in range(4):
                px[x + dx, y + dy] = c
img.save("/tmp/big_photo.jpg", quality=95)
Image.new("RGB", (200, 100), (0, 200, 255)).save("/tmp/small.png")
import os
print("big jpg size", os.path.getsize("/tmp/big_photo.jpg"))
