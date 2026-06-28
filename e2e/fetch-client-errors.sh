#!/usr/bin/env bash
# Sprint 25 — fetch recent client-side errors from the error feed.
# Usage: bash e2e/fetch-client-errors.sh [limit]
#
# Requires OWNER session (logs in as owner@bkj.id with password123).
# Prints the last N client error events with their message, route, and
# timestamp. Useful for diagnosing "Terjadi kesalahan" reports from
# users in the field.

set -uo pipefail

BASE="${BASE_URL:-https://pos-uat.akhairi.com}"
LIMIT="${1:-20}"
JAR=$(mktemp)
trap 'rm -f "$JAR"' EXIT

curl -s -c "$JAR" -X POST "$BASE/api/auth/login" \
  -H 'content-type: application/json' \
  -d '{"email":"owner@bkj.id","password":"password123"}' -o /dev/null

curl -s -b "$JAR" "$BASE/api/errors?limit=$LIMIT&route=client" \
  | node -e "
let data = '';
process.stdin.on('data', c => data += c);
process.stdin.on('end', () => {
  try {
    const j = JSON.parse(data);
    const items = (j?.data?.items || []).filter(i => i.route?.startsWith('client:'));
    if (items.length === 0) {
      console.log('No client errors in feed.');
      process.exit(0);
    }
    console.log('Found ' + items.length + ' client error(s):');
    console.log('');
    for (const it of items) {
      console.log('—'.repeat(70));
      console.log('when:    ' + it.createdAt);
      console.log('route:   ' + it.route);
      console.log('message: ' + (it.message || '').slice(0, 300));
      if (it.stack) {
        const head = it.stack.split('\n').slice(0, 3).join('\n           ');
        console.log('stack:   ' + head);
      }
      // Sprint 25.4 — also show componentStack from the `context` JSON
      // column. The pos-tree-error-boundary posts this whenever it
      // catches an error. The component stack is the most useful
      // piece of info for debugging React #310 (hooks-order errors)
      // because it tells you WHICH component has the bad hook order.
      if (it.context && it.context.componentStack) {
        const cs = it.context.componentStack.split('\n').slice(0, 10).join('\n         ');
        console.log('comp:    ' + cs);
      }
      console.log('');
    }
  } catch (e) {
    console.error('Failed to parse response:', e.message);
    console.error('Raw:', data.slice(0, 500));
    process.exit(1);
  }
});
"
