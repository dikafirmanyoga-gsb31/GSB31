# GSB31 — PRD

## Original problem statement
"ini sebagai dasar logo dan warna mengikuti karakter aplikasinya." + MASTER PROMPT GSB31 — FULL APPLICATION IMPLEMENTATION, PT GURINDAM SINAR BERKAH (aplikasi operasional terpadu: login aman tanpa registrasi publik, 3 peran (Direktur / Operasional+Keuangan / Operasional), maks 10 akun, menu seragam dengan pop-up DIRECTOR ONLY / ACCESS RESTRICTED, dashboard, usaha kopra, mitra, penawaran, dokumen & kontrak, pengingat otomatis, keuangan, fitur direktur, audit log, integrasi CP31 terpisah). Tambahan user: "di menu tengku erens direktur ada tambahan menu untuk bisa membuat akun anggota nantinya".

User choices: 4 akun awal dengan password sementara (wajib ganti); persetujuan penawaran default Direktur, bisa diperluas ke Role B via Pengaturan; upload file terlindungi (object storage); cetak/PDF dari browser; CP31 belum ada API → halaman status saja.

## Architecture
- Backend FastAPI: core.py (auth JWT cookie, require(perm), audit), routes_auth, routes_users (atomic counters for 10/7 limits), routes_business (settings, company, partners, kopra, quotations), routes_docs (documents, files, reminders sync), routes_finance (finance, dashboard, director summary, audit logs), storage.py (Emergent object storage)
- MongoDB collections: users, counters, partners, kopra, quotations, documents, files, reminders, transactions, audit_logs, settings, login_attempts, meta
- Frontend React: AppShell (same sidebar for all), RestrictionModal (global 403 listener), Guard for direct URLs, pages per module. Theme: dark navy + cyan neon (from CP31 logo).

## User personas
- Tengku Erens (Direktur, full access)
- Putri Anjani, Firdaus Apek (Operasional + Keuangan)
- Billy + up to 6 staff (Operasional saja)

## Implemented (2026-10-17)
- Login username/email, bcrypt, httpOnly cookies, refresh, logout invalidates token, lockout 5x/15 min per identifier, forced password change, director reset password
- Account mgmt (director only): create/edit/role/deactivate, max 10 total & 7 Role C enforced atomically (tested concurrently)
- RBAC on every endpoint; finance stripped from kopra/dashboard for Role C; popups + audit on denied access
- Dashboard from real data; Data Perusahaan; Mitra (dedupe); Usaha Kopra (configurable types/units); Penawaran (server totals, status flow, approval, print); Dokumen & Kontrak (upload/download protected); Pengingat (auto, no duplicates, H-30/14/7 configurable, Asia/Jakarta, tasks, follow-up); Keuangan (transactions, summary, chart, void by director); Menu Direktur (summary, akun, audit log, pengaturan); CP31 status page (not connected)
- Tested: iteration_1 (backend 22/22, frontend 95%) — issues fixed afterwards (XFF lockout bypass, mobile overflow, sheet close, approve buttons hidden, void dialog)

## Implemented (2026-10-17, iteration 2)
- Email reminders (Emergent managed Resend): daily cron 08:00 WIB (.emergent/crons.yml -> POST /api/cron/reminder-emails, bearer secret, idempotent run id), one digest per active user with email, each level (H-30/14/7/terlambat) emailed once per document/contract, reset when expiry changes; director tab "Notifikasi Email" (toggle, send now, logs)
- Excel export: /api/reports/finance.xlsx (finance roles; Ringkasan, Per Bulan, Per Kategori, Transaksi) and /api/reports/kopra.xlsx (all roles; price columns only for finance roles); buttons on Keuangan & Usaha Kopra pages
- Tested iteration_2: 14/16 new + 22/22 regression; 2 minor bugs (number format, invalid date 500) fixed and verified

## Implemented (2026-10-17, iteration 3)
- Weekly business summary email to Director every Monday 07:00 WIB (cron weekly-summary -> /api/cron/weekly-summary): quotations, contracts, cash flow of previous Mon–Sun (WIB bounds converted to UTC); toggle + manual send (with confirm) in Director > Notifikasi Email
- Template Dokumen menu: director uploads official templates (DOCX/DOC/PDF/JPG/PNG, max 15MB; categories Kop Surat, Penawaran, Kontrak Kerja Sama, Kontrak Tripartit, Surat Resmi, Lainnya), all roles download, archive/restore; unicode filenames supported
- Tested iteration_3 (8/9 + 22/22 regression); unicode download + timezone bugs fixed and verified

## Implemented (2026-10-17, iteration 4) — visual refresh only
- Darker navy base with subtle radial cyan glow, glass cards with top accent line, gradient sidebar active state, glowing primary buttons, dotted status badges, blurred dialog overlays, pill-style user box (avatar, role badge) in topbar, refined login glow. No functional changes.

## Implemented (2026-10-17, iteration 5) — PWA & mobile
- PWA: manifest.json, icons (192/512/maskable/apple-touch), minimal service worker (network-first navigations, offline.html fallback, API never cached), install button (Chrome/Edge/Android) + iOS "Tambah ke Layar Utama" hint
- Mobile: bottom navigation (Beranda, Penawaran, Kopra, Pengingat, Menu), safe-area insets, no horizontal overflow; same backend/RBAC
- Not provided: full offline data, background push notifications

## Implemented (2026-10-17, iteration 6)
- Foto Dokumen: camera capture button in document detail (capture=environment), client-side JPEG compression (max 2400px), saved as protected document file
- Mobile card lists (<768px) for Penawaran, Dokumen & Kontrak, Keuangan transactions; quotation detail items as cards on phone

## Implemented (2026-10-19, iteration 7) — code quality
- A: static audit (eslint no-undef/exhaustive-deps, ruff F821) found 0 undefined vars; fixed suppressed exhaustive-deps in useFetch (deps [url, tick]); unused catch vars removed
- B: update_user hardened — extra=forbid on UserCreate/UserUpdate/ResetPwIn, name whitespace validation, ops counter released only after successful conditional update (role-guarded), rollback on duplicate email/concurrent change
- C: no value-vs-identity `is` misuse found; `random` in tests/seed_mobile_cards.py only for image noise (kept, not security)
- D: stable keys for editable quotation rows (_k client-only)
- E (not done): large function refactors / type hints intentionally deferred
- Tests: iteration_6 (51/51 backend + frontend no fetch loops), iteration_7 (quotation rows)

## Pending from user
- Staff email addresses (Putri, Firdaus, Billy) — user said "nanti saja"
- Official template files (kop surat, draft penawaran, kontrak kerja sama/tripartit) to be uploaded by user; later: generate quotation print from the official kop surat

## Backlog
- P1: WhatsApp notifications (not configured)
- P1: Staff accounts need email addresses to receive reminder emails
- P1: CP31 integration once API/docs available
- P2: shadcn date pickers, export Excel/CSV reports, laporan laba-rugi when data sufficient
- P2: Company profile fields (alamat, telepon, NPWP) must be filled by director — currently empty

## Next tasks
- Director fills company profile; staff log in and set own passwords
