#!/bin/bash
API_URL="https://pos.akhairi.com"
COOKIE_JAR="/tmp/cookies.txt"
EMAIL="owner@bkj.id"
PASSWORD="password123"

echo "--- Testing Auth ---"
# Login
curl -s -c $COOKIE_JAR -X POST $API_URL/api/auth/login \
     -H "Content-Type: application/json" \
     -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}" > /dev/null
# Verify
HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" -b $COOKIE_JAR $API_URL/api/auth/me)
if [ "$HTTP_STATUS" == "200" ]; then
    echo "Auth Pass"
    exit 0
else
    echo "Auth Fail: $HTTP_STATUS"
    exit 1
fi
