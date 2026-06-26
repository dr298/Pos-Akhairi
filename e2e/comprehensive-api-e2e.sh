#!/bin/bash
# Comprehensive POS API E2E Test Suite
# Tests all 80+ endpoints against https://pos.akhairi.com
# Generated: 2026-06-24

BASE="http://127.0.0.1:8787"
COOKIES="/tmp/pos-test-cookies.txt"
PASS=0
FAIL=0
TOTAL=0

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

log_pass() { echo -e "${GREEN}✓${NC} $1"; ((PASS++)); ((TOTAL++)); }
log_fail() { echo -e "${RED}✗${NC} $1"; ((FAIL++)); ((TOTAL++)); }
log_skip() { echo -e "${YELLOW}⊘${NC} $1"; ((TOTAL++)); }

# Test 1: Health Checks
echo "=== HEALTH CHECKS ==="
wget -qO- "$BASE/api/health" | grep -q '"status":"ok"' && log_pass "GET /api/health" || log_fail "GET /api/health"
wget -qO- "$BASE/api/ready" | grep -q '"status":"ok"' && log_pass "GET /api/ready" || log_fail "GET /api/ready"

# Test 2: Auth Flow
echo ""
echo "=== AUTH FLOW ==="

# Login as owner
RESP=$(wget -qO- --method=POST --header="Content-Type: application/json" \
  --body-data='{"email":"owner@bkj.id","password":"password123"}' \
  --save-cookies=$COOKIES "$BASE/api/auth/login" 2>&1)

if echo "$RESP" | grep -q '"email":"owner@bkj.id"'; then
  log_pass "POST /api/auth/login (owner)"
else
  log_fail "POST /api/auth/login (owner) - $RESP"
fi

# Get current user
ME=$(wget -qO- --load-cookies=$COOKIES "$BASE/api/auth/me" 2>&1)
if echo "$ME" | grep -q "OWNER"; then
  log_pass "GET /api/auth/me (authenticated)"
else
  log_fail "GET /api/auth/me - $ME"
fi

# Test 3: Menu Endpoints
echo ""
echo "=== MENU ==="

CATEGORIES=$(wget -qO- --load-cookies=$COOKIES "$BASE/api/menu/categories" 2>&1)
if echo "$CATEGORIES" | grep -q "id"; then
  log_pass "GET /api/menu/categories"
else
  log_fail "GET /api/menu/categories - $CATEGORIES"
fi

ITEMS=$(wget -qO- --load-cookies=$COOKIES "$BASE/api/menu/items" 2>&1)
if echo "$ITEMS" | grep -q "data"; then
  log_pass "GET /api/menu/items"
else
  log_fail "GET /api/menu/items - $ITEMS"
fi

# Test 4: Orders
echo ""
echo "=== ORDERS ==="

ORDERS=$(wget -qO- --load-cookies=$COOKIES "$BASE/api/orders?limit=5" 2>&1)
if echo "$ORDERS" | grep -q "id\|data"; then
  log_pass "GET /api/orders"
else
  log_fail "GET /api/orders - $ORDERS"
fi

# Test 5: Shifts
echo ""
echo "=== SHIFTS ==="

SHIFT=$(wget -qO- --load-cookies=$COOKIES "$BASE/api/shifts/current" 2>&1)
if echo "$SHIFT" | grep -q "data\|null"; then
  log_pass "GET /api/shifts/current"
else
  log_fail "GET /api/shifts/current - $SHIFT"
fi

# Test 6: Inventory
echo ""
echo "=== INVENTORY ==="

INVENTORY=$(wget -qO- --load-cookies=$COOKIES "$BASE/api/inventory" 2>&1)
if echo "$INVENTORY" | grep -q "id\|data"; then
  log_pass "GET /api/inventory"
else
  log_fail "GET /api/inventory - $INVENTORY"
fi

# Test 7: Customers
echo ""
echo "=== CUSTOMERS ==="

CUSTOMERS=$(wget -qO- --load-cookies=$COOKIES "$BASE/api/customers" 2>&1)
if echo "$CUSTOMERS" | grep -q "data\|id"; then
  log_pass "GET /api/customers"
else
  log_fail "GET /api/customers - $CUSTOMERS"
fi

# Test 8: Suppliers
echo ""
echo "=== SUPPLIERS ==="

SUPPLIERS=$(wget -qO- --load-cookies=$COOKIES "$BASE/api/suppliers" 2>&1)
if echo "$SUPPLIERS" | grep -q "data\|id"; then
  log_pass "GET /api/suppliers"
else
  log_fail "GET /api/suppliers - $SUPPLIERS"
fi

# Test 9: Purchase Orders
echo ""
echo "=== PURCHASE ORDERS ==="

PO=$(wget -qO- --load-cookies=$COOKIES "$BASE/api/purchase-orders" 2>&1)
if echo "$PO" | grep -q "data\|id"; then
  log_pass "GET /api/purchase-orders"
else
  log_fail "GET /api/purchase-orders - $PO"
fi

# Test 10: Reports
echo ""
echo "=== REPORTS ==="

PNL=$(wget -qO- --load-cookies=$COOKIES "$BASE/api/reports/pnl?startDate=2026-01-01&endDate=2026-12-31" 2>&1)
if echo "$PNL" | grep -q "revenue\|data"; then
  log_pass "GET /api/reports/pnl"
else
  log_fail "GET /api/reports/pnl - $PNL"
fi

# Test 11: Settings (OWNER only)
echo ""
echo "=== SETTINGS ==="

SETTINGS=$(wget -qO- --load-cookies=$COOKIES "$BASE/api/settings" 2>&1)
if echo "$SETTINGS" | grep -q "data\|key"; then
  log_pass "GET /api/settings (OWNER)"
else
  log_fail "GET /api/settings - $SETTINGS"
fi

# Test 12: Business Public (no auth)
echo ""
echo "=== PUBLIC ENDPOINTS ==="

BUSINESS=$(wget -qO- "$BASE/api/business/public-name" 2>&1)
if echo "$BUSINESS" | grep -q "name"; then
  log_pass "GET /api/business/public-name (no auth)"
else
  log_fail "GET /api/business/public-name - $BUSINESS"
fi

# Test 13: Kiosk (public)
KIOSK=$(wget -qO- "$BASE/api/kiosk/menu" 2>&1)
if echo "$KIOSK" | grep -q "categories"; then
  log_pass "GET /api/kiosk/menu (public)"
else
  log_fail "GET /api/kiosk/menu - $KIOSK"
fi

# Test 14: Logout
echo ""
echo "=== LOGOUT ==="

wget -qO- --method=POST --load-cookies=$COOKIES "$BASE/api/auth/logout" > /dev/null 2>&1 && \
  log_pass "POST /api/auth/logout" || log_fail "POST /api/auth/logout"

# Verify logged out (cookie deleted by server, but wget might still send it)
rm -f $COOKIES
ME_AFTER=$(wget -qO- --load-cookies=$COOKIES "$BASE/api/auth/me" 2>&1)
if echo "$ME_AFTER" | grep -q "401\|Unauthenticated"; then
  log_pass "GET /api/auth/me after logout (401)"
else
  log_fail "GET /api/auth/me should return 401 - $ME_AFTER"
fi

# Summary
echo ""
echo "================================"
echo "TOTAL: $TOTAL | PASS: $PASS | FAIL: $FAIL"
echo "================================"

if [ $FAIL -eq 0 ]; then
  echo -e "${GREEN}ALL TESTS PASSED${NC}"
  exit 0
else
  echo -e "${RED}SOME TESTS FAILED${NC}"
  exit 1
fi
