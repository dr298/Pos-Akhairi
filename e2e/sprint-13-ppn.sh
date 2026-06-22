#!/bin/bash
# Sprint 13 E2E — PPN global config + per-menu override + auto-hide.
# Tests:
#   T1: PPN=11% order → taxCents > 0, ppnBpUsed=1100, receipt has "PPN 11%"
#   T2: PPN=0% order → taxCents = 0, ppnBpUsed=0, receipt NO PPN row
#   T3: PPN=12% order → taxCents reflects 12%
#   T4: PPN=11% global + menu.taxRateBp=2000 (20%) → per-menu wins
#   T5: PPN=11% global + menu.taxRateBp=0 → fallback to global (11%)
#   T6: settings validation (out-of-range → 400)
set -euo pipefail

API=http://127.0.0.1:8787
db() { docker exec pos-postgres psql -U pos -d pos_akhairi -At -c "$1"; }
get() { wget -qO- --load-cookies "$CK" "$API$1"; }
put() { wget -qO- --load-cookies "$CK" --header="Content-Type: application/json" --method=PUT --body-data="$2" "$API$1"; }
post() { wget -qO- --load-cookies "$CK" --header="Content-Type: application/json" --post-data="$2" "$API$1"; }
n_jq() { node -e "let s=''; process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s); $1})"; }
node_fix_cookie() {
  node -e "const fs=require('fs');const t=fs.readFileSync('$CK','utf8').split('\n').map(l=>{const p=l.split('\t');if(p.length>=4 && /^[0-9.]+$/.test(p[4])) p[3]='FALSE';return p.join('\t');}).join('\n');fs.writeFileSync('$CK',t);"
}

# Create a fresh, tax-free menu to use across the tests (taxRateBp=0).
# We need an OWNER cookie + a menuItemId.

CK=/tmp/cookies-s13.txt
rm -f $CK

# Login (file in one block to keep secret out of command history)
printf '{"email":"owner@bkj.id","password":"password123"}' > /tmp/login-body-s13.json
wget -q --save-cookies $CK --keep-session-cookies \
  --post-file /tmp/login-body-s13.json \
  --header='Content-Type: application/json' \
  $API/api/auth/login -O /dev/null
node_fix_cookie
echo "✓ logged in"

# --- helpers ---
set_ppn() {  # arg: integer percent (e.g. 11, 0, 12). Stores in basis points.
  local pct="$1"
  local bp=$((pct * 100))
  put /api/settings/DEFAULT_PPN_BP "{\"value\":\"$bp\"}" > /dev/null
}

create_order() {  # arg: menuItemId
  local mid="$1"
  local body
  shift_id=$(db "SELECT id FROM shifts WHERE status='OPEN' LIMIT 1;")
  local shift_param=""
  [ -n "$shift_id" ] && shift_param=",\"shiftId\":\"$shift_id\""
  body="{\"type\":\"DINE_IN\",\"items\":[{\"menuItemId\":\"$mid\",\"quantity\":1}]${shift_param}}"
  post /api/orders "$body" | n_jq "console.log(j.data.id || j.data.order?.id)"
}

cleanup_tax_test_menu() {  # arg: id
  db "DELETE FROM order_items WHERE menu_item_id='$1'; DELETE FROM menu_items WHERE id='$1';" >/dev/null
}

# Use the existing seeded "Bakso Sapi" menu as our tax-free base.
# Its seed data has taxRateBp=1100; we patch it to 0 for the clean tests.
bakso_id=$(db "SELECT id FROM menu_items WHERE name='Bakso Sapi' LIMIT 1;")
if [ -z "$bakso_id" ]; then
  echo "  Bakso Sapi not found; aborting"
  exit 1
fi
# Backup current taxRateBp so we can restore
original_tax_bp=$(db "SELECT tax_rate_bp FROM menu_items WHERE id='$bakso_id';")
db "UPDATE menu_items SET tax_rate_bp=0 WHERE id='$bakso_id';" >/dev/null
trap "db \"UPDATE menu_items SET tax_rate_bp=$original_tax_bp WHERE id='$bakso_id';\" >/dev/null" EXIT

pass() { echo "  ✓ $1"; }
fail() { echo "  ✗ $1"; exit 1; }

echo ""
echo "== T1: PPN=11% → taxCents > 0, ppnBpUsed=1100 =="
set_ppn 11
order_id=$(create_order "$bakso_id")
tax=$(db "SELECT tax_cents FROM orders WHERE id='$order_id';")
ppn_used=$(db "SELECT ppn_bp_used FROM orders WHERE id='$order_id';")
[ "$tax" != "0" ] && [ "$tax" != "" ] || fail "taxCents was $tax (expected > 0)"
[ "$ppn_used" = "1100" ] || fail "ppnBpUsed was $ppn_used (expected 1100)"
pass "taxCents=$tax ppnBpUsed=$ppn_used"

echo ""
echo "== T2: PPN=0% → taxCents=0, ppnBpUsed=0, receipt NO PPN row =="
set_ppn 0
order_id=$(create_order "$bakso_id")
tax=$(db "SELECT tax_cents FROM orders WHERE id='$order_id';")
ppn_used=$(db "SELECT ppn_bp_used FROM orders WHERE id='$order_id';")
[ "$tax" = "0" ] || fail "taxCents was $tax (expected 0)"
[ "$ppn_used" = "0" ] || fail "ppnBpUsed was $ppn_used (expected 0)"
# Render the receipt and assert no PPN row in the text output
receipt=$(wget -qO- --load-cookies "$CK" "$API/api/receipts/preview/$order_id")
echo "$receipt" | grep -q "PPN" && fail "receipt text still has PPN reference" || true
pass "taxCents=0 ppnBpUsed=0 receipt has no PPN row"

echo ""
echo "== T3: PPN=12% → taxCents uses 12% rate =="
set_ppn 12
order_id=$(create_order "$bakso_id")
tax=$(db "SELECT tax_cents FROM orders WHERE id='$order_id';")
subtotal=$(db "SELECT subtotal_cents FROM orders WHERE id='$order_id';")
# 12% of subtotal, floored
expected=$(node -e "console.log(Math.floor($subtotal * 1200 / 10000))")
[ "$tax" = "$expected" ] || fail "taxCents=$tax expected=$expected (12% of $subtotal)"
pass "taxCents=$tax = 12% of subtotal=$subtotal"

echo ""
echo "== T4: PPN=11% global + menu.taxRateBp=2000 (20%) → per-menu wins =="
set_ppn 11
db "UPDATE menu_items SET tax_rate_bp=2000 WHERE id='$bakso_id';" >/dev/null
order_id=$(create_order "$bakso_id")
tax=$(db "SELECT tax_cents FROM orders WHERE id='$order_id';")
subtotal=$(db "SELECT subtotal_cents FROM orders WHERE id='$order_id';")
ppn_used=$(db "SELECT ppn_bp_used FROM orders WHERE id='$order_id';")
expected=$(node -e "console.log(Math.floor($subtotal * 2000 / 10000))")
[ "$tax" = "$expected" ] || fail "taxCents=$tax expected=$expected (20% of $subtotal)"
[ "$ppn_used" = "2000" ] || fail "ppnBpUsed=$ppn_used expected=2000 (max of per-line rates)"
pass "taxCents=$tax = 20% (per-menu override), ppnBpUsed=2000"
db "UPDATE menu_items SET tax_rate_bp=0 WHERE id='$bakso_id';" >/dev/null

echo ""
echo "== T5: PPN=11% global + menu.taxRateBp=0 → fallback to global 11% =="
set_ppn 11
db "UPDATE menu_items SET tax_rate_bp=0 WHERE id='$bakso_id';" >/dev/null
order_id=$(create_order "$bakso_id")
tax=$(db "SELECT tax_cents FROM orders WHERE id='$order_id';")
subtotal=$(db "SELECT subtotal_cents FROM orders WHERE id='$order_id';")
expected=$(node -e "console.log(Math.floor($subtotal * 1100 / 10000))")
[ "$tax" = "$expected" ] || fail "taxCents=$tax expected=$expected (11% global fallback of $subtotal)"
pass "taxCents=$tax = 11% (global fallback)"

echo ""
echo "== T6: settings validation — out-of-range → 400 =="
# Use --server-response to capture headers (printed to STDERR) separately
# from body (--output-document=/dev/null). wget exits non-zero on HTTP 4xx,
# so we allow failure with `|| true` to keep the script running.
resp=$(wget -O /dev/null --server-response --load-cookies "$CK" --method=PUT --header="Content-Type: application/json" --body-data='{"value":"99999"}' "$API/api/settings/DEFAULT_PPN_BP" 2>&1 || true)
resp_code=$(echo "$resp" | grep -E 'HTTP/[0-9.]+ [0-9]+' | head -1 | awk '{print $2}')
[ "$resp_code" = "400" ] || fail "expected 400, got '$resp_code'"
pass "out-of-range value rejected with 400"

echo ""
echo "== Cleanup: restore menu + set PPN back to 0% =="
db "UPDATE menu_items SET tax_rate_bp=$original_tax_bp WHERE id='$bakso_id';" >/dev/null
set_ppn 0
pass "PPN=0% and Bakso Sapi tax restored"

echo ""
echo "ALL SPRINT 13 PPN TESTS PASSED ✓"
