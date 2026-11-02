#!/bin/bash
# V-EXEC-02: Seeds a terminal regression execution for the Execution Detail view.
# Creates 1 regression with 2 suites (each 2 tests), 1 environment, 1 passed
# regression execution.
set -e
source "$(dirname "$0")/../../../scripts/lib.sh"

BACKEND_URL="${WAVE_BACKEND_URL:-http://localhost:${WAVE_E2E_BACKEND_PORT:-8000}}"

_admin_on
trap _admin_off EXIT

_reset_all

T1="b0000021-0001-0001-0001-000000000001"
T2="b0000022-0002-0002-0002-000000000002"
T3="b0000023-0003-0003-0003-000000000003"
T4="b0000024-0004-0004-0004-000000000004"
S1="c0000021-0001-0001-0001-000000000001"
S2="c0000022-0002-0002-0002-000000000002"
R1="a0000001-0000-0000-0000-000000000001"
ENV1="e0000001-0000-0000-0000-000000000001"
EXEC1="d0000002-0000-0000-0000-000000000002"
TS="2026-04-15T11:00:00+00:00"
END_TS="2026-04-15T11:05:24+00:00"

_add_test "$T1" "Login smoke" "" '["auth"]' "passed"
_add_test "$T2" "Logout smoke" "" '["auth"]' "passed"
_add_test "$T3" "Checkout Happy Path" "" '["checkout"]' "passed"
_add_test "$T4" "Checkout Declined Card" "" '["checkout"]' "failed"

_add_suite "$S1" "Auth Suite" "" "[\"$T1\",\"$T2\"]"
_add_suite "$S2" "Checkout Suite" "" "[\"$T3\",\"$T4\"]"

_add_regression "$R1" "Nightly Regression"

# Attach suites to the regression (set suites array via direct PUT).
curl -sf -X PUT "${BACKEND_URL}/regressions/${R1}" \
  -H "Content-Type: application/json" \
  -d "{
    \"description\": \"Nightly full-stack regression suite.\",
    \"tags\": [\"nightly\"],
    \"suites\": [\"${S1}\", \"${S2}\"],
    \"variables\": {}
  }" > /dev/null

_add_environment "$ENV1" "Local"

_bulk executions "[{\"op\":\"add\",\"entity\":{\"id\":\"${EXEC1}\",\"name\":\"Nightly Regression\",\"entity_type\":\"regression\",\"entity_id\":\"${R1}\",\"environment_id\":\"${ENV1}\",\"status\":\"passed\",\"progress\":100,\"started_at\":\"${TS}\",\"updated_at\":\"${END_TS}\",\"completed_at\":\"${END_TS}\",\"ended_at\":\"${END_TS}\",\"duration\":324,\"triggered_by\":\"dev\",\"tests_total\":4,\"tests_selected\":4}}]"

echo "V-EXEC-02 seeded: 1 regression (2 suites, 4 tests) + 1 environment + 1 passed regression execution"
