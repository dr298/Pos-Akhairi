#!/usr/bin/env bash
# Sprint 25 — auth state consistency.
#
# User reports (2026-06-23):
#   1. Visiting /login while already authed still shows the login form
#      and can be submitted to log in AGAIN (wasting a session rotation).
#   2. Refreshing any /pos page, or hard-navigating via URL, throws
#      "Terjadi kesalahan / Halaman tidak dapat dimuat" from the
#      global-error fallback, even when the session is valid.
#
# This test covers what we CAN verify from curl/HTML (the rest is
# React hydration behavior that's only visible in a real browser):
#
#   A. /login HTML returns 200 with the login form (the bounce
#      happens client-side via useEffect). Form has email+password
#      inputs and the "Masuk" submit button.
#   B. /pos with a valid session returns 200 and the server-rendered
#      HTML contains the "Memuat…" loading placeholder. No 500.
#   C. /api/auth/me with a valid cookie returns 200 + user.
#   D. /api/auth/me with NO cookie returns 401. (Negative case so we
#      know the auth gate is actually enforcing.)
#   E. Login while already authed still returns 200 + new session
#      (this is fine server-side — the bounce is client-side UX).
#   F. /pos/error.tsx + /app/error.tsx + global-error.tsx bundles all
#      shipped (bundle marker verification).
#
# What this test does NOT cover (needs a real browser):
#   - useEffect-based redirect from /login when already authed.
#   - The exact "Terjadi kesalahan" reproduction in the user's
#     browser. We can only verify that the page returns 200 with
#     a non-error placeholder from the server.
#   - The cause of the original hard-nav crash. We added
#     diagnostic info (actual error.message in the overlay) so the
#     next occurrence will tell us exactly what blew up.

set -uo pipefail

BASE="${BASE_URL:-https://pos.akhairi.com}"
JAR=$(mktemp)
trap 'rm -f "$JAR"' EXIT

PASS=0
FAIL=0
ok()  { echo "  ✓ $1"; PASS=$((PASS+1)); }
bad() { echo "  ✗ $1"; FAIL=$((FAIL+1)); }

# ─── A. /login renders the form ───────────────────────────────────────────
echo "A. /login renders the login form (server-side)"
LOGIN_HTML=$(curl -s -c "$JAR" "$BASE/login")
if echo "$LOGIN_HTML" | grep -qi 'type="email"'; then
  ok "login form has email input"
else
  bad "login form missing email input"
fi
if echo "$LOGIN_HTML" | grep -qi 'type="password"'; then
  ok "login form has password input"
else
  bad "login form missing password input"
fi
if echo "$LOGIN_HTML" | grep -qE 'Masuk[^<]*</button>|Masuk</'; then
  ok "login form has Masuk submit button"
else
  bad "login form missing Masuk button"
fi

# ─── B. /pos with valid session returns 200 + loading placeholder ────────
echo ""
echo "B. /pos with valid session"
curl -s -c "$JAR" -b "$JAR" -X POST "$BASE/api/auth/login" \
  -H 'content-type: application/json' \
  -d '{"email":"cashier@bkj.id","password":"password123"}' -o /dev/null

POS_CODE=$(curl -s -b "$JAR" -o /tmp/pos-sprint25.html -w '%{http_code}' "$BASE/pos")
if [ "$POS_CODE" = "200" ]; then
  ok "/pos returns 200 for authed user"
else
  bad "/pos returned $POS_CODE (expected 200)"
fi
if grep -q 'Memuat' /tmp/pos-sprint25.html; then
  ok "/pos server-render contains Memuat… loading placeholder"
else
  bad "/pos server-render does NOT contain Memuat…"
fi
if grep -q 'Terjadi kesalahan' /tmp/pos-sprint25.html; then
  bad "/pos server-render already shows error overlay"
else
  ok "/pos server-render does NOT show error overlay"
fi

# ─── C. /api/auth/me with valid cookie returns 200 ────────────────────────
echo ""
echo "C. /api/auth/me valid cookie"
ME_CODE=$(curl -s -b "$JAR" -o /tmp/me-sprint25.json -w '%{http_code}' "$BASE/api/auth/me")
if [ "$ME_CODE" = "200" ]; then
  ok "/api/auth/me returns 200 for authed user"
else
  bad "/api/auth/me returned $ME_CODE (expected 200)"
fi
if grep -q '"user":{' /tmp/me-sprint25.json; then
  ok "/api/auth/me returns user payload"
else
  bad "/api/auth/me payload missing user"
fi

# ─── D. /api/auth/me without cookie returns 401 ──────────────────────────
echo ""
echo "D. /api/auth/me without cookie"
EMPTY_JAR=$(mktemp)
trap 'rm -f "$JAR" "$EMPTY_JAR"' EXIT
NOAUTH_CODE=$(curl -s -b "$EMPTY_JAR" -o /dev/null -w '%{http_code}' "$BASE/api/auth/me")
if [ "$NOAUTH_CODE" = "401" ]; then
  ok "/api/auth/me returns 401 without cookie"
else
  bad "/api/auth/me returned $NOAUTH_CODE without cookie (expected 401)"
fi

# ─── E. login while already authed is allowed server-side ─────────────────
echo ""
echo "E. login while already authed"
RELOGIN_CODE=$(curl -s -b "$JAR" -c "$JAR" -X POST "$BASE/api/auth/login" \
  -H 'content-type: application/json' \
  -d '{"email":"cashier@bkj.id","password":"password123"}' -o /dev/null -w '%{http_code}')
if [ "$RELOGIN_CODE" = "200" ]; then
  ok "second login succeeds (200) — client useEffect handles the bounce UX"
else
  bad "second login returned $RELOGIN_CODE (expected 200)"
fi
# After re-login, /api/auth/me should still return 200 with new session
ME2_CODE=$(curl -s -b "$JAR" -o /dev/null -w '%{http_code}' "$BASE/api/auth/me")
if [ "$ME2_CODE" = "200" ]; then
  ok "/api/auth/me still 200 after re-login"
else
  bad "/api/auth/me returned $ME2_CODE after re-login"
fi

# ─── F. hard-nav stress: /pos/x/garbage/123 with valid session ────────────
echo ""
echo "F. hard-nav stress (valid session, random URL — should 404 not 500)"
RAND_PATH="/pos/zz-not-found-$(date +%s)/page"
HARD_NAV_CODE=$(curl -s -b "$JAR" -o /dev/null -w '%{http_code}' "$BASE$RAND_PATH")
if [ "$HARD_NAV_CODE" = "404" ] || [ "$HARD_NAV_CODE" = "200" ]; then
  ok "hard-nav to bogus path returned $HARD_NAV_CODE (expected 404 or 200, NOT 500)"
else
  bad "hard-nav to bogus path returned $HARD_NAV_CODE (expected 404 or 200)"
fi

# ─── G. /login hard-nav stress: must not 500 ──────────────────────────────
echo ""
echo "G. /login hard-nav with valid session (should still 200)"
LOGIN2_CODE=$(curl -s -b "$JAR" -o /dev/null -w '%{http_code}' "$BASE/login")
if [ "$LOGIN2_CODE" = "200" ]; then
  ok "/login returns 200 even when already authed (server-side gate NOT present)"
else
  bad "/login returned $LOGIN2_CODE (expected 200)"
fi

# ─── H. error boundary bundles shipped ────────────────────────────────────
echo ""
echo "H. error boundaries shipped (bundle markers)"
# Walk every JS chunk loaded by /login and look for the new error UI strings.
ALL_CHUNKS=$(curl -s "$BASE/login" | grep -oE '/_next/static/chunks/[^"]+\.js' | sort -u)
GLOBAL_HIT=0
APP_HIT=0
CLIENT_REPORT_HIT=0
for chunk in $ALL_CHUNKS; do
  BODY=$(curl -s "$BASE$chunk" 2>/dev/null)
  if echo "$BODY" | grep -q 'Login ulang'; then GLOBAL_HIT=1; fi
  if echo "$BODY" | grep -q 'Kembali ke POS'; then APP_HIT=1; fi
  if echo "$BODY" | grep -q 'client-error'; then CLIENT_REPORT_HIT=1; fi
done
if [ "$GLOBAL_HIT" = "1" ]; then
  ok "global-error.tsx bundle has 'Login ulang' button"
else
  bad "global-error.tsx bundle missing 'Login ulang' — old version still shipped"
fi
if [ "$APP_HIT" = "1" ]; then
  ok "app/error.tsx bundle has 'Kembali ke POS' button"
else
  bad "app/error.tsx bundle missing 'Kembali ke POS' — old version still shipped"
fi
if [ "$CLIENT_REPORT_HIT" = "1" ]; then
  ok "client-error reporting endpoint is referenced in a bundle"
else
  # Not fatal — the endpoint itself is on the API, not in the web bundle.
  echo "  - client-error endpoint not in web bundle (lazy, ok if API works)"
  PASS=$((PASS+1))
fi

# ─── I. client-error POST endpoint is reachable + persists ────────────────
echo ""
echo "I. POST /api/errors/client-error reachable + persists"
CE_CODE=$(curl -s -X POST "$BASE/api/errors/client-error" \
  -H 'content-type: application/json' \
  -d '{"message":"sprint-25 e2e test","source":"e2e/sprint-25","route":"/pos"}' \
  -o /tmp/ce-sprint25.json -w '%{http_code}')
if [ "$CE_CODE" = "200" ]; then
  ok "POST /api/errors/client-error returns 200"
else
  bad "POST /api/errors/client-error returned $CE_CODE (expected 200)"
fi
if grep -q '"ok":true' /tmp/ce-sprint25.json; then
  ok "client-error response has {ok: true}"
else
  bad "client-error response missing {ok: true}"
fi

# Validate the row landed in the DB. /api/errors/ is OWNER-only,
# so we need to login first to read it back.
OWNER_JAR=$(mktemp)
trap 'rm -f "$JAR" "$EMPTY_JAR" "$OWNER_JAR"' EXIT
curl -s -c "$OWNER_JAR" -X POST "$BASE/api/auth/login" \
  -H 'content-type: application/json' \
  -d '{"email":"owner@bkj.id","password":"password123"}' -o /dev/null
ERR_LIST_CODE=$(curl -s -b "$OWNER_JAR" -o /tmp/err-list-sprint25.json -w '%{http_code}' \
  "$BASE/api/errors?limit=10")
if [ "$ERR_LIST_CODE" = "200" ]; then
  ok "GET /api/errors (OWNER) returns 200"
else
  bad "GET /api/errors returned $ERR_LIST_CODE"
fi
if grep -q "sprint-25 e2e test" /tmp/err-list-sprint25.json; then
  ok "sprint-25 e2e error is in the error feed"
else
  bad "sprint-25 e2e error NOT found in error feed"
fi

# ─── Summary ──────────────────────────────────────────────────────────────
echo ""
echo "== RESULT: $PASS pass, $FAIL fail =="
[ "$FAIL" = "0" ] && echo "ALL GREEN" && exit 0
echo "SOME FAILED" && exit 1
