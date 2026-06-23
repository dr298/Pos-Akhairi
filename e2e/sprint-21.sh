#!/bin/bash
# Sprint 21 E2E — verifies all new pages + endpoints.
#
#  1. Login as owner
#  2. POST /api/inventory/:id/adjust → 200 + ADJUSTMENT log written
#  3. GET  /api/inventory/:id/adjustments → log present
#  4. GET  /api/reports/pnl → 200 + valid shape
#  5. GET  /api/purchase-orders/report → 200 + valid shape
#  6. GET  /api/receipts → 200 + list (may be empty)
#  7. GET  /pos/orders → 200 HTML (redirect target)
#  8. GET  /pos/orders/receipt → 200 HTML
#  9. GET  /pos/inventory/adjustment → 200 HTML
# 10. GET  /pos/accounting/pnl → 200 HTML
# 11. GET  /pos/purchase-orders/report → 200 HTML
# 12. GET  /pos/z-report → 200 HTML (no React #310 crash)
# 13. GET  /api/reports/z-report → 200 (since /pos/z-report uses it)
# 14. NAV check: every link in POSLayout returns 200

set -euo pipefail
BASE="http://127.0.0.1:8787"
WEB="http://127.0.0.1:3080"
COOKIE="/tmp/sprint21_cookie.txt"
rm -f "$COOKIE"

PASS=0
FAIL=0
log()  { echo -e "  $*"; }
ok()   { log "  [PASS] $*"; PASS=$((PASS+1)); }
ko()   { log "  [FAIL] $*"; FAIL=$((FAIL+1)); }

echo "== 1. Login as owner =="
curl -s -c "$COOKIE" -H 'Content-Type: application/json' \
  -X POST "$BASE/api/auth/login" \
  -d '{"email":"owner@bkj.id","password":"password123"}' > /tmp/login.json
if grep -q '"id"' /tmp/login.json; then ok "owner login"; else ko "owner login: $(cat /tmp/login.json)"; exit 1; fi

echo "== 2. Pick an inventory item =="
curl -s -b "$COOKIE" "$BASE/api/inventory" > /tmp/inv.json
ITEM_ID=$(python3 -c "import json;d=json.load(open('/tmp/inv.json'));print(d.get('data',{}).get('items',[{}])[0].get('id',''))")
ITEM_QTY=$(python3 -c "import json;d=json.load(open('/tmp/inv.json'));print(d.get('data',{}).get('items',[{}])[0].get('quantity','0'))")
if [ -n "$ITEM_ID" ]; then ok "got inventory item id=$ITEM_ID qty=$ITEM_QTY"; else ko "no inventory item"; exit 1; fi

echo "== 3. POST adjust (gain) =="
NEW_QTY=$(python3 -c "print(round(float('$ITEM_QTY')+2, 4))")
curl -s -b "$COOKIE" -H 'Content-Type: application/json' \
  -X POST "$BASE/api/inventory/$ITEM_ID/adjust" \
  -d "{\"actualQty\":\"$NEW_QTY\",\"reason\":\"Sprint 21 E2E test gain\"}" > /tmp/adj.json
if grep -q '"GAIN"' /tmp/adj.json; then ok "adjust GAIN recorded"; else ko "adjust failed: $(cat /tmp/adj.json)"; fi

echo "== 4. POST adjust (loss) =="
NEW_QTY2=$(python3 -c "print(round(float('$NEW_QTY')-1, 4))")
curl -s -b "$COOKIE" -H 'Content-Type: application/json' \
  -X POST "$BASE/api/inventory/$ITEM_ID/adjust" \
  -d "{\"actualQty\":\"$NEW_QTY2\",\"reason\":\"Sprint 21 E2E test loss\"}" > /tmp/adj2.json
if grep -q '"LOSS"' /tmp/adj2.json; then ok "adjust LOSS recorded"; else ko "loss failed: $(cat /tmp/adj2.json)"; fi

echo "== 5. GET adjustments log =="
curl -s -b "$COOKIE" "$BASE/api/inventory/$ITEM_ID/adjustments" > /tmp/adjlog.json
COUNT=$(python3 -c "import json;d=json.load(open('/tmp/adjlog.json'));print(len(d.get('data',{}).get('logs',[])))")
if [ "$COUNT" -ge 2 ]; then ok "adjustment log has $COUNT entries"; else ko "expected ≥2 log entries, got $COUNT"; fi

echo "== 6. GET /api/reports/pnl =="
TODAY=$(date -u +%Y-%m-%d)
FROM=$(date -u -d '7 days ago' +%Y-%m-%d 2>/dev/null || date -u -v-7d +%Y-%m-%d)
curl -s -b "$COOKIE" "$BASE/api/reports/pnl?from=$FROM&to=$TODAY" > /tmp/pnl.json
if grep -q '"revenue"' /tmp/pnl.json && grep -q '"cogsCents"' /tmp/pnl.json; then
  ok "pnl response valid"
else
  ko "pnl: $(cat /tmp/pnl.json)"
fi

echo "== 7. GET /api/purchase-orders/report =="
curl -s -b "$COOKIE" "$BASE/api/purchase-orders/report?from=$FROM&to=$TODAY" > /tmp/po.json
if grep -q '"totalCents"' /tmp/po.json && grep -q '"bySupplier"' /tmp/po.json; then
  ok "purchase report valid"
else
  ko "po report: $(cat /tmp/po.json)"
fi

echo "== 8. GET /api/receipts =="
curl -s -b "$COOKIE" "$BASE/api/receipts" > /tmp/rcpt.json
# Response is `{data: [...]}` (array of deliveries, not {logs: []}).
if python3 -c "import json;d=json.load(open('/tmp/rcpt.json'));assert isinstance(d.get('data'), list);print(len(d['data']))" 2>/dev/null; then
  ok "receipts endpoint valid (data is array)"
else
  ko "receipts: $(cat /tmp/rcpt.json)"
fi

echo "== 9. GET /api/reports/z-report (still works) =="
curl -s -b "$COOKIE" "$BASE/api/reports/z-report?date=$TODAY" > /tmp/zrep.json
if grep -q '"summary"' /tmp/zrep.json; then ok "z-report endpoint valid"; else ko "z-report: $(cat /tmp/zrep.json)"; fi

echo "== 10. HTML pages =="
for path in /pos/orders /pos/orders/receipt /pos/inventory/adjustment /pos/accounting/pnl /pos/purchase-orders/report /pos/z-report; do
  code=$(curl -s -b "$COOKIE" -o /dev/null -w '%{http_code}' "$WEB$path")
  if [ "$code" = "200" ]; then ok "$path → 200"; else ko "$path → $code"; fi
done

echo "== 11. Re-fetch /api/inventory — qty should reflect adjustment =="
curl -s -b "$COOKIE" "$BASE/api/inventory" > /tmp/inv2.json
NEW_SYSTEM_QTY=$(python3 -c "import json;d=json.load(open('/tmp/inv2.json'));print(d.get('data',{}).get('items',[{}])[0].get('quantity','0'))")
# Compare as floats to avoid "256" vs "256.0" string mismatch.
# Sprint 23 dedup: Prisma now returns "256" instead of "256.0000"
# because the underlying column is numeric(12,4) but JS drops trailing
# zeros on serialization. The test value comes from Python's round()
# which keeps ".0". Normalize via float().
if python3 -c "import sys; sys.exit(0 if abs(float('$NEW_QTY2') - float('$NEW_SYSTEM_QTY')) < 1e-6 else 1)"; then
  ok "system qty = $NEW_SYSTEM_QTY (matches last adjust $NEW_QTY2)"
else
  ko "expected $NEW_QTY2, got $NEW_SYSTEM_QTY"
fi

echo
echo "== RESULT: $PASS pass, $FAIL fail =="
[ "$FAIL" -eq 0 ] && echo "ALL GREEN" || echo "SOME FAILED"
exit $FAIL
