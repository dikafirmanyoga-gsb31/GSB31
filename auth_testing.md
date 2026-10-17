# GSB31 Auth Testing
- Login: POST /api/auth/login {"identifier": username or email, "password"} -> sets httpOnly cookies access_token/refresh_token
- GET /api/auth/me returns user with role + permissions (ops/finance/director)
- Staff seeded with must_change_password=true -> all non-auth APIs return 403 {"code":"PASSWORD_CHANGE_REQUIRED"} until POST /api/auth/change-password
- 5 failed logins per ip+identifier -> 429 lock for 15 min
- Deactivated users / logout increments token_version -> old tokens 401
- Users collection: bcrypt hashes ($2b$), unique username, unique partial email
- Max 10 users enforced with atomic counters (db.counters _id users/ops), Role C max 7
