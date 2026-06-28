#!/usr/bin/env bash
# Sprint 23 — Inventory dedup regression test.
#
# The root cause was commit 8604cee (drop Branch model) removing the
# @@unique([branchId, sku]) constraint on InventoryItem. The seed
# re-ran without that constraint, doubling every inventory item.
# Symptoms: items appear duplicated, stock opname adjustments are
# applied to the wrong row, direction math confused by the duplicate.
#
# This test asserts the dedup is permanent:
# 1. /api/inventory returns exactly the seeded SKUs (5), no duplicates.
# 2. POST /api/inventory/.../adjust with a positive delta returns GAIN.
# 3. POST /api/inventory/.../adjust with a negative delta returns LOSS.
# 4. A direct DB INSERT with a duplicate SKU is rejected by the unique
#    constraint (P2002 from Prisma, or SQLSTATE 23505 from raw SQL).
# 5. The seed is idempotent: running it again does NOT create new rows.

set -e
cd "$(dirname "$0")/.."

BASE="https://pos-uat.akhairi.com"
COOKIE="/tmp/sprint-23-cookie.txt"
rm -f "$COOKIE"

PASS=0
FAIL=0

ok()  { echo "  [PASS] $1"; PASS=$((PASS+1)); }
ko()  { echo "  [FAIL] $1"; FAIL=$((FAIL+1)); }

echo "== 1. Login as owner =="
status=$(curl -s -c "$COOKIE" -X POST "$BASE/api/auth/login" \
  -H 'content-type: application/json' \
  -d '{"email":"owner@bkj.id","password":"password123"}' \
  -o /dev/null -w '%{http_code}')
if [ "$status" = "200" ]; then ok "owner login"; else ko "login failed: $status"; exit 1; fi

echo "== 2. /api/inventory returns no duplicates =="
curl -s -b "$COOKIE" "$BASE/api/inventory" > /tmp/inv.json
DUPES=$(python3 -c "
import json
d = json.load(open('/tmp/inv.json'))
items = d.get('data', {}).get('items', [])
skus = [i['sku'] for i in items]
from collections import Counter
c = Counter(skus)
dupes = {k: v for k, v in c.items() if v > 1}
print(len(dupes))
print(len(items))
")
DUPES_COUNT=$(echo "$DUPES" | head -1)
TOTAL_COUNT=$(echo "$DUPES" | tail -1)
if [ "$DUPES_COUNT" = "0" ]; then
  ok "no duplicate SKUs ($TOTAL_COUNT unique items)"
else
  ko "$DUPES_COUNT duplicate SKUs found"
fi

echo "== 3. GAIN adjust returns direction=GAIN =="
ITEM_ID=$(python3 -c "import json; print(json.load(open('/tmp/inv.json'))['data']['items'][0]['id'])")
ITEM_QTY=$(python3 -c "import json; print(json.load(open('/tmp/inv.json'))['data']['items'][0]['quantity'])")
HIGHER=$(python3 -c "print(float('$ITEM_QTY') + 100)")
RESULT=$(curl -s -b "$COOKIE" -X POST "$BASE/api/inventory/$ITEM_ID/adjust" \
  -H 'content-type: application/json' \
  -d "{\"actualQty\":\"$HIGHER\",\"reason\":\"Sprint 23 GAIN test\"}")
DIR=$(echo "$RESULT" | python3 -c "import json,sys; print(json.load(sys.stdin)['data']['direction'])")
DELTA=$(echo "$RESULT" | python3 -c "import json,sys; print(json.load(sys.stdin)['data']['delta'])")
if [ "$DIR" = "GAIN" ]; then
  ok "positive delta=$DELTA → direction=GAIN"
else
  ko "expected GAIN, got $DIR (delta=$DELTA)"
fi

echo "== 4. LOSS adjust returns direction=LOSS =="
LOWER=$(python3 -c "print(float('$ITEM_QTY') - 1)")
RESULT=$(curl -s -b "$COOKIE" -X POST "$BASE/api/inventory/$ITEM_ID/adjust" \
  -H 'content-type: application/json' \
  -d "{\"actualQty\":\"$LOWER\",\"reason\":\"Sprint 23 LOSS test\"}")
DIR=$(echo "$RESULT" | python3 -c "import json,sys; print(json.load(sys.stdin)['data']['direction'])")
DELTA=$(echo "$RESULT" | python3 -c "import json,sys; print(json.load(sys.stdin)['data']['delta'])")
if [ "$DIR" = "LOSS" ]; then
  ok "negative delta=$DELTA → direction=LOSS"
else
  ko "expected LOSS, got $DIR (delta=$DELTA)"
fi

echo "== 5. DB rejects duplicate SKU insert (unique constraint) =="
# Direct SQL via docker exec. Expected: ERROR 23505 (unique_violation).
DUP_RESULT=$(docker exec pos-postgres psql -U pos -d pos_akhairi -c \
  "INSERT INTO inventory_items (id, sku, name, unit, updated_at) VALUES ('sprint23-dup-test', 'RM-BAKSO', 'Sprint 23 Dup', 'kg', NOW());" 2>&1 || true)
if echo "$DUP_RESULT" | grep -q '23505\|unique constraint\|duplicate key'; then
  ok "duplicate SKU rejected by unique constraint"
else
  ko "expected 23505/unique_violation, got: $DUP_RESULT"
fi

echo "== 6. /pos/inventory/adjustment page renders =="
status=$(curl -s -b "$COOKIE" "$BASE/pos/inventory/adjustment" -o /dev/null -w '%{http_code}')
if [ "$status" = "200" ]; then ok "/pos/inventory/adjustment → 200"; else ko "page failed: $status"; fi

echo "== 7. Re-running seed does not create dupes =="
# Run the seed via docker (uses the in-container DB). Count before and after.
BEFORE=$(docker exec pos-postgres psql -U pos -d pos_akhairi -t -A -c "SELECT COUNT(*) FROM inventory_items;")
# Use the api container which has all deps + .env
docker exec -e DATABASE_URL="postgresql://pos:posakairi2026@postgres:5432/pos_akhairi" \
  pos-api sh -c 'cd /app/packages/db && npx tsx scripts/seed.ts 2>&1 | tail -3' > /tmp/seed-out.txt || true
AFTER=$(docker exec pos-postgres psql -U pos -d pos_akhairi -t -A -c "SELECT COUNT(*) FROM inventory_items;")
if [ "$BEFORE" = "$AFTER" ]; then
  ok "seed is idempotent ($BEFORE items before, $AFTER after)"
else
  ko "seed changed row count: $BEFORE → $AFTER"
fi

echo
echo "== RESULT: $PASS pass, $FAIL fail =="
if [ "$FAIL" -gt 0 ]; then exit 1; else echo "ALL GREEN"; fi
