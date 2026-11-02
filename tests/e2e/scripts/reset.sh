#!/bin/bash
# Clears E2E test data via admin API, with environments and profiles. Functions, system variables, network settings, SSH hosts and artifact files stay
set -e
BACKEND_URL="${WAVE_BACKEND_URL:-http://localhost:${WAVE_E2E_BACKEND_PORT:-8000}}"

curl -sf -X POST "${BACKEND_URL}/admin/enable" -H "Content-Type: application/json" \
    -d '{"reason": "E2E reset"}' > /dev/null

# Clear the test data and system infrastructure (environments, profiles) for E2E tests
curl -sf -X POST "${BACKEND_URL}/admin/reset" -H "Content-Type: application/json" \
    -d '{"confirm": true, "scope": ["entities", "blocks", "executions", "artifacts", "testdata", "mcp", "environments", "profiles"]}' > /dev/null

# Clear workbench session too - admin/reset does not touch it, and a stale
# session pointing to a now-deleted test causes downstream tests to see the
# "Test not found" modal open on first navigation to /workbench, which blocks
# interaction via the Radix AlertDialog overlay.
curl -sf -X DELETE "${BACKEND_URL}/workbench/session" > /dev/null 2>&1 || true

curl -sf -X POST "${BACKEND_URL}/admin/disable" > /dev/null 2>&1 || true

echo "Data reset complete"
