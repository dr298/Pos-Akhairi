#!/bin/bash
API_URL="https://pos-uat.akhairi.com"
COOKIE_JAR="/tmp/cookies.txt"

echo "--- Testing Menu CRUD ---"
HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" -b $COOKIE_JAR $API_URL/api/menu/items)
if [ "$HTTP_STATUS" == "200" ]; then
    echo "Menu Fetch Pass"
    exit 0
else
    echo "Menu Fetch Fail: $HTTP_STATUS"
    exit 1
fi
