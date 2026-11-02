#!/bin/bash
# V-REG-RUN-01: Seeds the surface for "Run from regression detail" visual.
# Creates 1 environment, 3 tests (one shared across two suites), 2 suites,
# 1 regression pointing at both. The shared test drives the duplicate badge
# that appears inside the RunDialog on the regression.
set -e
source "$(dirname "$0")/../../../scripts/lib.sh"

BACKEND_URL="${WAVE_BACKEND_URL:-http://localhost:${WAVE_E2E_BACKEND_PORT:-8000}}"

_admin_on
trap _admin_off EXIT

_reset_all

ENV1="e0000001-0000-0000-0000-000000000001"
T_SHARED="b0000041-0001-0001-0001-000000000001"
T_AUTH="b0000042-0002-0002-0002-000000000002"
T_CHECKOUT="b0000043-0003-0003-0003-000000000003"
S_AUTH="c0000041-0001-0001-0001-000000000001"
S_CHECKOUT="c0000042-0002-0002-0002-000000000002"
R1="a0000041-0000-0000-0000-000000000001"

_add_environment "$ENV1" "Local"

_add_test "$T_SHARED" "Shared Smoke Test" "" '["shared"]'
_add_test "$T_AUTH" "Auth Only Test" "" '["auth"]'
_add_test "$T_CHECKOUT" "Checkout Only Test" "" '["checkout"]'

_add_suite "$S_AUTH" "Auth Suite" "" "[\"$T_SHARED\",\"$T_AUTH\"]"
_add_suite "$S_CHECKOUT" "Checkout Suite" "" "[\"$T_SHARED\",\"$T_CHECKOUT\"]"

_add_regression "$R1" "Runnable Regression"

# Attach suites to the regression via direct PUT (mirrors v-exec-02 pattern).
curl -sf -X PUT "${BACKEND_URL}/regressions/${R1}" \
  -H "Content-Type: application/json" \
  -d "{
    \"description\": \"Regression fixture for Run dialog + duplicate badge.\",
    \"tags\": [\"run-from-detail\"],
    \"suites\": [\"${S_AUTH}\", \"${S_CHECKOUT}\"],
    \"variables\": {}
  }" > /dev/null

echo "V-REG-RUN-01 seeded: 1 env + 3 tests (1 shared) + 2 suites + 1 regression"
