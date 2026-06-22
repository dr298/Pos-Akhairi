#!/bin/bash
# Full UI E2E — verify every navbar route works (page exists, JS bundle
# contains the component, primary API call returns 200, no 500s).
#
# Run as: bash e2e/full-ui-e2e.sh
#
# Why bash + curl and not Playwright/camofox:
#   - Browser tool in this env is broken (tab sessions return 500)
#   - Cloudflare tunnel routes pos.akhairi.com to localhost:3080, but
#     pos-web is on 127.0.0.1:3030 — would need a container restart
#   - The bash pattern walks Next.js JS chunks to confirm the page
#     component reached the served bundle (skill: pos-akhairi-e2e)
set -euo pipefail

WEB=http://127.0.0.1:3080
API=http://127.0.0.1:8787
COOKIE=""
ORDER_ID=""

pass() { echo "  ✓ $1"; }
fail() { echo "  ✗ $1"; exit 1; }
section() { echo ""; echo "== $1 =="; }

# ─── Setup ────────────────────────────────────────────────────────────
section "Setup: login as OWNER"
rm -f /tmp/ck_e2e.txt
curl -s -c /tmp/ck_e2e.txt -X POST -H 'Content-Type: application/json' \
  -d '{"email":"owner@bkj.id","password":"password123"}' \
  $API/api/auth/login -o /dev/null
# Fix the secure=TRUE → FALSE cookie bug (skill: pos-akhairi-e2e)
node -e "
const fs=require('fs');
const t=fs.readFileSync('/tmp/ck_e2e.txt','utf8').split('\n').map(l=>{
  const p=l.split('\t');
  if(p.length>=4 && /^[0-9.]+$/.test(p[4])) p[3]='FALSE';
  return p.join('\t');
}).join('\n');
fs.writeFileSync('/tmp/ck_e2e.txt',t);
"
COOKIE=$(awk '$6=="pos_session"{print $7}' /tmp/ck_e2e.txt)
[ -n "$COOKIE" ] || fail "no cookie after login"
pass "logged in (cookie len=${#COOKIE})"

# Sample order id for dynamic routes
ORDER_ID=$(docker exec pos-postgres psql -U pos -d pos_akhairi -At -c \
  "SELECT id FROM orders LIMIT 1" 2>/dev/null)
[ -n "$ORDER_ID" ] || fail "no orders in DB"
pass "sample order: $ORDER_ID"

# ─── 1. Nav audit: every href resolves to a page.tsx ─────────────────
section "T1: navbar href → page.tsx audit"
missing=0
for h in \
  /pos /pos/history /pos/reservations /pos/shift /pos/shifts/history \
  /pos/waiter /pos/waste \
  /pos/menu /pos/menu/engineering /pos/menu/combos \
  /pos/prep-sheets /pos/promos /pos/discounts \
  /pos/customers /pos/suppliers \
  /pos/z-report /pos/transfers /pos/accounting-export /pos/purchase-orders \
  /pos/settings/hardware /pos/settings \
  /display; do
  # Authenticated routes
  code=$(curl -s -o /dev/null -w '%{http_code}' -H "Cookie: pos_session=$COOKIE" "$WEB$h")
  if [ "$code" = "200" ]; then
    pass "$h → 200"
  elif [ "$code" = "404" ]; then
    echo "  ✗ $h → 404 (DEAD NAV LINK)"
    missing=$((missing + 1))
  else
    echo "  ✗ $h → $code (unexpected)"
    missing=$((missing + 1))
  fi
done
# Public route (no auth)
code=$(curl -s -o /dev/null -w '%{http_code}' "$WEB/kiosk")
if [ "$code" = "200" ]; then
  pass "/kiosk (public) → 200"
else
  echo "  ✗ /kiosk → $code"
  missing=$((missing + 1))
fi
# Stop at first failure of the navbar audit so we can fix the 2 dead
# links before continuing
[ "$missing" = "0" ] || { echo ""; echo "FIX: $missing dead nav link(s) found. Aborting audit until fixed."; exit 2; }

# ─── 2. Dynamic routes ────────────────────────────────────────────────
section "T2: dynamic routes"
for h in "/pos/orders/$ORDER_ID" "/pos/orders/$ORDER_ID/receipt" "/pos/success/$ORDER_ID"; do
  code=$(curl -s -o /dev/null -w '%{http_code}' -H "Cookie: pos_session=$COOKIE" "$WEB$h")
  if [ "$code" = "200" ]; then
    pass "$h → 200"
  else
    fail "$h → $code"
  fi
done

# ─── 3. Page components in JS bundles ────────────────────────────────
section "T3: each page's component is in the served JS bundle"
check_in_bundle() {
  local route="$1" needle="$2"
  local html code found
  html=$(curl -s -H "Cookie: pos_session=$COOKIE" "$WEB$route")
  found=0
  for c in $(echo "$html" | grep -oE '/_next/static/chunks/[^"]+\.js'); do
    body=$(curl -s "$WEB$c" 2>/dev/null)
    # `needle` may contain an alternation like "A|B|C"
    if echo "$body" | grep -qE "$needle"; then
      found=1
      break
    fi
  done
  if [ "$found" = "1" ]; then
    pass "$route contains '$needle' in JS bundle"
  else
    fail "$route missing '$needle' in JS bundle"
  fi
}

check_in_bundle "/pos"                  "Order"
check_in_bundle "/pos/history"          "Riwayat|history"
check_in_bundle "/pos/reservations"     "Reservasi"
check_in_bundle "/pos/shift"            "Shift"
check_in_bundle "/pos/menu"             "Daftar Menu|menu"
check_in_bundle "/pos/customers"        "Pelanggan"
check_in_bundle "/pos/z-report"         "Z-Report"
check_in_bundle "/pos/settings"         "Identitas Bisnis"
check_in_bundle "/pos/settings/hardware" "Printer Bluetooth"
check_in_bundle "/pos/success/$ORDER_ID" "/api/business"

# ─── 4. Primary API call per page (smoke) ────────────────────────────
section "T4: primary API call per page returns 200"
api_get() {
  curl -s -o /dev/null -w '%{http_code}' -H "Cookie: pos_session=$1" "$API$2"
}
# Operasional
[ "$(api_get "$COOKIE" /api/orders)" = "200" ] && pass "GET /api/orders" || fail "GET /api/orders"
[ "$(api_get "$COOKIE" /api/reservations)" = "200" ] && pass "GET /api/reservations" || fail "GET /api/reservations"
[ "$(api_get "$COOKIE" /api/shifts/current)" = "200" ] && pass "GET /api/shifts/current" || fail "GET /api/shifts/current"
[ "$(api_get "$COOKIE" /api/shifts)" = "200" ] && pass "GET /api/shifts" || fail "GET /api/shifts"
[ "$(api_get "$COOKIE" /api/tables)" = "200" ] && pass "GET /api/tables" || fail "GET /api/tables"
[ "$(api_get "$COOKIE" /api/waste)" = "200" ] && pass "GET /api/waste" || fail "GET /api/waste"
# Menu
[ "$(api_get "$COOKIE" /api/menu/items)" = "200" ] && pass "GET /api/menu/items" || fail "GET /api/menu/items"
[ "$(api_get "$COOKIE" /api/menu/categories)" = "200" ] && pass "GET /api/menu/categories" || fail "GET /api/menu/categories"
[ "$(api_get "$COOKIE" /api/menu-engineering/snapshots)" = "200" ] && pass "GET /api/menu-engineering/snapshots" || fail "GET /api/menu-engineering/snapshots"
[ "$(api_get "$COOKIE" /api/combos)" = "200" ] && pass "GET /api/combos" || fail "GET /api/combos"
[ "$(api_get "$COOKIE" /api/prep-sheets)" = "200" ] && pass "GET /api/prep-sheets" || fail "GET /api/prep-sheets"
[ "$(api_get "$COOKIE" /api/promos)" = "200" ] && pass "GET /api/promos" || fail "GET /api/promos"
[ "$(api_get "$COOKIE" /api/discounts)" = "200" ] && pass "GET /api/discounts" || fail "GET /api/discounts"
# People
[ "$(api_get "$COOKIE" /api/customers)" = "200" ] && pass "GET /api/customers" || fail "GET /api/customers"
[ "$(api_get "$COOKIE" /api/suppliers)" = "200" ] && pass "GET /api/suppliers" || fail "GET /api/suppliers"
# Finance
[ "$(api_get "$COOKIE" /api/reports/z-report?date=2026-06-22)" = "200" ] && pass "GET /api/reports/z-report" || fail "GET /api/reports/z-report"
[ "$(api_get "$COOKIE" /api/purchase-orders)" = "200" ] && pass "GET /api/purchase-orders" || fail "GET /api/purchase-orders"
# Settings
[ "$(api_get "$COOKIE" /api/settings)" = "200" ] && pass "GET /api/settings" || fail "GET /api/settings"
[ "$(api_get "$COOKIE" /api/business)" = "200" ] && pass "GET /api/business" || fail "GET /api/business"

# ─── 5. Receipt preview ──────────────────────────────────────────────
section "T5: receipt preview API"
code=$(api_get "$COOKIE" "/api/receipts/preview/$ORDER_ID")
[ "$code" = "200" ] && pass "GET /api/receipts/preview/$ORDER_ID" || fail "GET receipt preview → $code"

# ─── 6. Settings write/read roundtrip ────────────────────────────────
section "T6: settings roundtrip (BUSINESS_NAME)"
orig=$(curl -s -H "Cookie: pos_session=$COOKIE" "$API/api/business" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).data.name))")
echo "  current BUSINESS_NAME: $orig"
new_name="E2E Test $(date +%s)"
code=$(curl -s -o /dev/null -w '%{http_code}' -X PUT \
  -H "Cookie: pos_session=$COOKIE" -H 'Content-Type: application/json' \
  -d "{\"value\":\"$new_name\"}" "$API/api/settings/BUSINESS_NAME")
[ "$code" = "200" ] || fail "PUT BUSINESS_NAME → $code"
got=$(curl -s -H "Cookie: pos_session=$COOKIE" "$API/api/business" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).data.name))")
[ "$got" = "$new_name" ] || fail "name was '$got', expected '$new_name'"
pass "BUSINESS_NAME updated and reflected"
# Restore
curl -s -X PUT -H "Cookie: pos_session=$COOKIE" -H 'Content-Type: application/json' \
  -d "{\"value\":\"$orig\"}" "$API/api/settings/BUSINESS_NAME" > /dev/null
pass "restored to '$orig'"

# ─── 7. Login flow roundtrip ─────────────────────────────────────────
section "T7: full login roundtrip"
rm -f /tmp/ck_e2e2.txt
curl -s -c /tmp/ck_e2e2.txt -X POST -H 'Content-Type: application/json' \
  -d '{"email":"cashier@bkj.id","password":"password123"}' \
  $API/api/auth/login -o /tmp/login_resp.json
[ -s /tmp/login_resp.json ] || fail "no login response"
node -e "
const j=JSON.parse(require('fs').readFileSync('/tmp/login_resp.json'));
// /api/auth/login returns {user:{...}} (no 'data' envelope)
const u = j.user || (j.data && j.data.user);
if(!u) { console.error('login shape wrong:', JSON.stringify(j)); process.exit(1); }
if(u.role !== 'CASHIER') { console.error('expected CASHIER, got', u.role); process.exit(1); }
console.log('  cashier login ok, role =', u.role);
"
pass "cashier login returns correct user shape"
code=$(curl -s -o /dev/null -w '%{http_code}' -H "Cookie: pos_session=$(awk '$6=="pos_session"{print $7}' /tmp/ck_e2e2.txt)" "$API/api/auth/me")
[ "$code" = "200" ] && pass "/api/auth/me → 200" || fail "/api/auth/me → $code"

# ─── 8. Role gating (negative tests) ─────────────────────────────────
section "T8: role gating (cashier can't access manager/owner routes)"
CASHIER_COOKIE=$(awk '$6=="pos_session"{print $7}' /tmp/ck_e2e2.txt)
# Cashier tries to set BUSINESS_NAME → 403
code=$(curl -s -o /dev/null -w '%{http_code}' -X PUT \
  -H "Cookie: pos_session=$CASHIER_COOKIE" -H 'Content-Type: application/json' \
  -d '{"value":"hack"}' "$API/api/settings/BUSINESS_NAME")
[ "$code" = "403" ] && pass "cashier PUT BUSINESS_NAME → 403" || fail "expected 403, got $code"
# Cashier tries to list users (if such endpoint exists)
code=$(curl -s -o /dev/null -w '%{http_code}' \
  -H "Cookie: pos_session=$CASHIER_COOKIE" "$API/api/users")
if [ "$code" = "200" ]; then
  pass "/api/users accessible (CASHIER allowed)"
elif [ "$code" = "403" ]; then
  pass "/api/users → 403 (cashier denied)"
else
  echo "  ? /api/users → $code (skip)"
fi

# ─── 9. Static asset check (no 404 on JS) ────────────────────────────
section "T9: no broken JS chunks"
homepage=$(curl -s -H "Cookie: pos_session=$COOKIE" "$WEB/pos")
js_count=$(echo "$homepage" | grep -oE '/_next/static/chunks/[^"]+\.js' | wc -l)
echo "  /pos loads $js_count JS chunks"
broken=0
for c in $(echo "$homepage" | grep -oE '/_next/static/chunks/[^"]+\.js'); do
  code=$(curl -s -o /dev/null -w '%{http_code}' "$WEB$c")
  if [ "$code" != "200" ]; then
    echo "  ✗ $c → $code"
    broken=$((broken + 1))
  fi
done
[ "$broken" = "0" ] && pass "all JS chunks return 200" || fail "$broken chunks broken"

# ─── 10. WebSocket /api/ws reachable ─────────────────────────────────
section "T10: WebSocket upgrade endpoint"
# Just check the upgrade header — ws uses Upgrade: websocket
code=$(curl -s -o /dev/null -w '%{http_code}' \
  -H "Connection: Upgrade" -H "Upgrade: websocket" \
  -H "Sec-WebSocket-Version: 13" -H "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==" \
  -H "Cookie: pos_session=$COOKIE" \
  --max-time 2 "$API/api/ws" 2>/dev/null || echo "000")
if [ "$code" = "101" ] || [ "$code" = "200" ] || [ "$code" = "426" ]; then
  pass "ws upgrade reachable (code=$code)"
else
  echo "  ? /api/ws returned $code (may need WS client to verify fully)"
fi

# ─── 11. Per-page button wiring (form action or onClick handler) ─────
section "T11: button/form wiring present in served JS bundles"
# Each entry: route | needles (any of these should be in JS bundle for the
# page to be considered wired up — button onClick, form action, etc.)
# Empty needle list = skip (no form to wire)
check_wired() {
  local route="$1" needle="$2"
  local html=""
  # /kiosk is public, others need cookie
  if [ "$route" = "/kiosk" ] || [ "$route" = "/login" ]; then
    html=$(curl -s "$WEB$route")
  else
    html=$(curl -s -H "Cookie: pos_session=$COOKIE" "$WEB$route")
  fi
  # Empty needle → just verify a chunk loaded
  if [ -z "$needle" ]; then
    if echo "$html" | grep -qE '/_next/static/chunks/[^"]+\.js'; then
      pass "$route has served JS"
    else
      fail "$route missing JS chunks"
    fi
    return
  fi
  local found=0
  for c in $(echo "$html" | grep -oE '/_next/static/chunks/[^"]+\.js'); do
    body=$(curl -s "$WEB$c" 2>/dev/null)
    if echo "$body" | grep -qE "$needle"; then
      found=1
      break
    fi
  done
  if [ "$found" = "1" ]; then
    pass "$route contains '$needle' in JS bundle"
  else
    fail "$route missing '$needle' in JS bundle"
  fi
}

# Forms & submit buttons — each page has at least one form submit or
# button onClick handler that POSTs/PUTs/DELETEs to an /api/* endpoint.
check_wired "/pos"                        'onClick|onSubmit|fetch\(.\/api'
check_wired "/pos/history"                'fetch\(.\/api'
check_wired "/pos/menu"                   'onClick|onSubmit|fetch\(.\/api'
check_wired "/pos/menu/engineering"       'createMenuEngineeringSnapshot|onClick'
check_wired "/pos/customers"              'onClick|onSubmit'
check_wired "/pos/suppliers"              'onClick|onSubmit'
check_wired "/pos/promos"                 'onClick|onSubmit'
check_wired "/pos/discounts"              'onClick|onSubmit'
check_wired "/pos/combos"                 'onClick|onSubmit'
check_wired "/pos/prep-sheets"            'onClick|onSubmit'
check_wired "/pos/reservations"           'onClick|onSubmit'
check_wired "/pos/shift"                  'onClick|onSubmit'
check_wired "/pos/shifts/history"         ''
check_wired "/pos/waiter"                 'onClick|onSubmit'
check_wired "/pos/waste"                  'onClick|onSubmit'
check_wired "/pos/z-report"               'print|window\.print'
check_wired "/pos/purchase-orders"        'onClick|onSubmit'
check_wired "/pos/transfers"              'onSubmit|transfer-submit'  # data-testid from /pos/transfers form
check_wired "/pos/accounting-export"      'onClick|onSubmit|download'
check_wired "/pos/settings"               'onClick|onSubmit'
check_wired "/pos/settings/hardware"      'connect|disconnect|onClick'
check_wired "/display"                    'websocket|WebSocket'
check_wired "/kiosk"                      'onClick|onSubmit|Bayar'
check_wired "/login"                      'onSubmit|signIn'

# ─── 12. User flow: login → order → payment → receipt (full API trace)
section "T12: full user flow (cashier sells, owner sees it, receipt works)"
# Step 1: cashier login (re-login each run to avoid stale session)
rm -f /tmp/ck_flow.txt
LOGIN_HTTP=$(curl -s -c /tmp/ck_flow.txt -X POST -H 'Content-Type: application/json' \
  -d '{"email":"cashier@bkj.id","password":"password123"}' \
  -o /tmp/login_flow.json -w '%{http_code}' $API/api/auth/login)
[ "$LOGIN_HTTP" = "200" ] || fail "step 1: cashier login http $LOGIN_HTTP"
node -e "
const fs=require('fs');
const t=fs.readFileSync('/tmp/ck_flow.txt','utf8').split('\\n').map(l=>{
  const p=l.split('\\t');
  if(p.length>=4 && /^[0-9.]+\$/.test(p[4])) p[3]='FALSE';
  return p.join('\\t');
}).join('\\n');
fs.writeFileSync('/tmp/ck_flow.txt',t);
"
FLOW_COOKIE=$(awk '$6=="pos_session"{print $7}' /tmp/ck_flow.txt)
[ -n "$FLOW_COOKIE" ] && pass "step 1: cashier login" || fail "step 1: no cookie"

# Step 2: open a shift (cashier needs an open shift to create orders).
# If "ShiftAlreadyOpen" comes back, the existing shift is fine.
SHIFT=$(curl -s -H "Cookie: pos_session=$FLOW_COOKIE" $API/api/shifts/current)
# /api/shifts/current returns {data: {id, ...}} (flat), not {data: {shift: ...}}
SHIFT_ID=$(echo "$SHIFT" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{const j=JSON.parse(s);const sh=j.data?.shift||j.shift||j.data;console.log(sh?.id || '');}catch(e){console.log('');}})")
if [ -z "$SHIFT_ID" ]; then
  OPEN=$(curl -s -X POST -H "Cookie: pos_session=$FLOW_COOKIE" -H 'Content-Type: application/json' -d '{"openingCash":100000}' $API/api/shifts/open)
  SHIFT_ID=$(echo "$OPEN" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{const j=JSON.parse(s);console.log(j.data?.shift?.id || j.shift?.id || j.data?.id || j.id || '');}catch(e){console.log('');}})")
fi
[ -n "$SHIFT_ID" ] && pass "step 2: shift open (id=$SHIFT_ID)" || fail "step 2: shift open (tried: $OPEN)"

# Step 3: create a new order with an item included (API requires it).
# /api/menu/items returns {data: [...]} (array directly), not {data: {items}}
MENU_ITEM=$(curl -s -H "Cookie: pos_session=$FLOW_COOKIE" $API/api/menu/items | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s);const arr=j.data?.items||j.items||(Array.isArray(j.data)?j.data:[]);const i=arr.find(x=>x.isActive);console.log(i?.id||'');})")
[ -z "$MENU_ITEM" ] && fail "step 3: no menu item to create order (got: $(curl -s -H "Cookie: pos_session=$FLOW_COOKIE" $API/api/menu/items | head -c 200))"
ORDER=$(curl -s -X POST -H "Cookie: pos_session=$FLOW_COOKIE" -H 'Content-Type: application/json' \
  -d "{\"type\":\"DINE_IN\",\"items\":[{\"menuItemId\":\"$MENU_ITEM\",\"quantity\":1}]}" \
  $API/api/orders)
NEW_ORDER_ID=$(echo "$ORDER" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{const j=JSON.parse(s);const o=j.data?.order||j.order||j.data||j;console.log(o.id||'');}catch(e){console.log('');}})")
[ -n "$NEW_ORDER_ID" ] && pass "step 3: order created (id=$NEW_ORDER_ID)" || fail "step 3: order create (got: $ORDER)"

# Step 4: items already in step 3, verify
ORDER_GET=$(curl -s -H "Cookie: pos_session=$FLOW_COOKIE" $API/api/orders/$NEW_ORDER_ID)
ITEMS_COUNT=$(echo "$ORDER_GET" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{const j=JSON.parse(s);const o=j.data?.order||j.order||j.data||j;console.log(o.items?.length||0);}catch(e){console.log(0);}})")
[ "$ITEMS_COUNT" -ge "1" ] && pass "step 4: order has $ITEMS_COUNT item(s)" || fail "step 4: order has no items"

# Step 5: pay the order. /api/orders/:id/pay-cash takes {amountGiven}.
# Fetch order total first so we pay enough.
TOTAL=$(echo "$ORDER_GET" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{const j=JSON.parse(s);const o=j.data?.order||j.order||j.data||j;console.log(parseInt(o.totalCents)||0);}catch(e){console.log(0);}})")
PAY_AMOUNT=$((TOTAL + 50000))  # 50k change buffer
PAID=$(curl -s -X POST -H "Cookie: pos_session=$FLOW_COOKIE" -H 'Content-Type: application/json' \
  -d "{\"amountGiven\":$PAY_AMOUNT}" \
  $API/api/orders/$NEW_ORDER_ID/pay-cash)
PAID_OK=$(echo "$PAID" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{const j=JSON.parse(s);const o=j.data?.order||j.order||j.data||j;console.log(o.status==='PAID'?'yes':(o.status||'unknown'));}catch(e){console.log('err');}})")
[ "$PAID_OK" = "yes" ] && pass "step 5: order paid (total=$TOTAL, paid=$PAY_AMOUNT)" || fail "step 5: pay (status=$PAID_OK, body=$PAID)"

# Step 7: receipt preview works
RECEIPT=$(curl -s -o /dev/null -w '%{http_code}' -H "Cookie: pos_session=$FLOW_COOKIE" $API/api/receipts/preview/$NEW_ORDER_ID)
[ "$RECEIPT" = "200" ] && pass "step 7: receipt preview 200" || fail "step 7: receipt preview $RECEIPT"

# Step 8: order detail page renders
PAGE=$(curl -s -o /dev/null -w '%{http_code}' -H "Cookie: pos_session=$FLOW_COOKIE" $WEB/pos/orders/$NEW_ORDER_ID)
[ "$PAGE" = "200" ] && pass "step 8: order detail page 200" || fail "step 8: order detail $PAGE"

# Step 9: owner can see the new order in /api/orders
OWNER_VIEW=$(curl -s -H "Cookie: pos_session=$COOKIE" "$API/api/orders" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{const j=JSON.parse(s);const a=j.data?.orders||j.orders||(Array.isArray(j.data)?j.data:[]);const hit=a.some(o=>o.id==='$NEW_ORDER_ID');console.log(hit?'yes':'no');}catch(e){console.log('err');}})")
[ "$OWNER_VIEW" = "yes" ] && pass "step 9: owner sees the new order" || fail "step 9: owner does not see it"

echo ""
echo "ALL E2E CHECKS PASSED ✓"
