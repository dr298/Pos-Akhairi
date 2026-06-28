#!/usr/bin/env bash
# Sprint 24 — page <title> now reads BUSINESS_NAME (not the domain).
#
# User report: "header title gausah tampilin domain, tampilin business
# name aja". Was hardcoded as 'pos.akhairi.com — Bakmie POS' which
# leaked the internal domain to the browser tab and bookmarks.
#
# Fix:
# - /api/business/public-name: new PUBLIC endpoint, returns just {name}
# - apps/web/src/app/layout.tsx: generateMetadata() fetches it server-
#   side, 60s revalidate, falls back to 'Bakmie POS' on error
#
# Test asserts:
# 1. /api/business/public-name returns 200 without auth
# 2. response shape is { name: string }
# 3. The current BUSINESS_NAME matches what's served
# 4. <title> on /pos, /login, /kiosk all reflect the business name
# 5. The hardcoded 'pos.akhairi.com' string is NOT in the title
# 6. /api/business (full snapshot) still requires auth

set -e
cd "$(dirname "$0")/.."

BASE="https://pos-uat.akhairi.com"
COOKIE="/tmp/sprint-24-cookie.txt"
rm -f "$COOKIE"

PASS=0
FAIL=0

ok()  { echo "  [PASS] $1"; PASS=$((PASS+1)); }
ko()  { echo "  [FAIL] $1"; FAIL=$((FAIL+1)); }

echo "== 1. /api/business/public-name reachable without auth =="
status=$(curl -s "$BASE/api/business/public-name" -o /tmp/pub-name.json -w '%{http_code}')
if [ "$status" = "200" ]; then ok "public-name returns 200 without auth"; else ko "expected 200, got $status: $(cat /tmp/pub-name.json)"; fi

echo "== 2. response shape =="
HAS_NAME=$(python3 -c "import json; d=json.load(open('/tmp/pub-name.json')); print('yes' if isinstance(d.get('name'), str) and d['name'] else 'no')")
if [ "$HAS_NAME" = "yes" ]; then
  ok "response has non-empty 'name' field"
else
  ko "missing or empty 'name': $(cat /tmp/pub-name.json)"
fi

PUB_NAME=$(python3 -c "import json; print(json.load(open('/tmp/pub-name.json'))['name'])")
echo "  [info] public-name = '$PUB_NAME'"

echo "== 3. login as owner to fetch /api/business for cross-check =="
status=$(curl -s -c "$COOKIE" -X POST "$BASE/api/auth/login" \
  -H 'content-type: application/json' \
  -d '{"email":"owner@bkj.id","password":"password123"}' \
  -o /dev/null -w '%{http_code}')
if [ "$status" != "200" ]; then ko "login failed: $status"; exit 1; fi
ok "owner login"

curl -s -b "$COOKIE" "$BASE/api/business" > /tmp/biz.json
AUTH_NAME=$(python3 -c "import json; print(json.load(open('/tmp/biz.json'))['data']['name'])")
echo "  [info] /api/business (auth) name = '$AUTH_NAME'"
if [ "$PUB_NAME" = "$AUTH_NAME" ]; then
  ok "public-name matches authed /api/business"
else
  ko "mismatch: public='$PUB_NAME' vs auth='$AUTH_NAME'"
fi

echo "== 4. <title> on all pages reflects the business name =="
for path in /pos /login /kiosk; do
  TITLE=$(curl -s "$BASE$path" | grep -oE '<title>[^<]+</title>' | head -1 | sed -E 's|<title>([^<]+)</title>|\1|')
  if [ "$TITLE" = "$AUTH_NAME" ]; then
    ok "$path -> <title>$TITLE</title>"
  else
    ko "$path title='$TITLE', expected '$AUTH_NAME'"
  fi
done

echo "== 5. <title> does NOT contain the internal domain =="
for path in /pos /login /kiosk; do
  TITLE=$(curl -s "$BASE$path" | grep -oE '<title>[^<]+</title>' | head -1)
  if echo "$TITLE" | grep -qE 'pos\.akhairi\.com'; then
    ko "$path still has domain in title: $TITLE"
  else
    ok "$path title has no 'pos.akhairi.com': $TITLE"
  fi
done

echo "== 6. public-name endpoint truly public (no auth header needed) =="
status=$(curl -s -H 'Cookie:' -H 'Authorization:' "$BASE/api/business/public-name" -o /dev/null -w '%{http_code}')
if [ "$status" = "200" ]; then
  ok "public-name works with empty Cookie + Authorization"
else
  ko "expected 200 with no auth, got $status"
fi

echo "== 7. /api/business (full snapshot) still requires auth =="
status=$(curl -s -H 'Cookie:' -H 'Authorization:' "$BASE/api/business" -o /dev/null -w '%{http_code}')
if [ "$status" = "401" ]; then
  ok "full /api/business still 401 without auth (address/footer protected)"
else
  ko "expected 401, got $status"
fi

echo
echo "== RESULT: $PASS pass, $FAIL fail =="
if [ "$FAIL" -gt 0 ]; then exit 1; else echo "ALL GREEN"; fi
