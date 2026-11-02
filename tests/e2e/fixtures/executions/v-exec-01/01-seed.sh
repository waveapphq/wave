#!/bin/bash
# V-EXEC-01: Seeds a terminal suite execution for the Execution Detail view
# Creates 1 suite (3 tests) + 1 environment + 1 passed suite execution
set -e
source "$(dirname "$0")/../../../scripts/lib.sh"

BACKEND_URL="${WAVE_BACKEND_URL:-http://localhost:${WAVE_E2E_BACKEND_PORT:-8000}}"

_admin_on
trap _admin_off EXIT

_reset_all

T1="b0000011-0001-0001-0001-000000000001"
T2="b0000012-0002-0002-0002-000000000002"
T3="b0000013-0003-0003-0003-000000000003"
S1="c0000002-0001-0001-0001-000000000001"
ENV1="e0000001-0000-0000-0000-000000000001"
EXEC1="d0000001-0000-0000-0000-000000000001"
TS="2026-04-15T10:00:00+00:00"
END_TS="2026-04-15T10:00:12+00:00"

_add_test "$T1" "Login Flow" "" '["auth"]' "passed"
_add_test "$T2" "User Profile Update" "" '["user"]' "passed"
_add_test "$T3" "Password Reset" "" '["auth","security"]' "failed"

_add_suite "$S1" "Authentication Suite" "" "[\"$T1\",\"$T2\",\"$T3\"]"

curl -sf -X PUT "${BACKEND_URL}/suites/${S1}" \
  -H "Content-Type: application/json" \
  -d '{
    "description": "Authentication and user management test suite.",
    "tags": ["auth", "user-management"],
    "variables": {}
  }' > /dev/null

_add_environment "$ENV1" "Local"

_bulk executions "[{\"op\":\"add\",\"entity\":{\"id\":\"${EXEC1}\",\"name\":\"Authentication Suite\",\"entity_type\":\"suite\",\"entity_id\":\"${S1}\",\"environment_id\":\"${ENV1}\",\"status\":\"passed\",\"progress\":100,\"started_at\":\"${TS}\",\"updated_at\":\"${END_TS}\",\"completed_at\":\"${END_TS}\",\"ended_at\":\"${END_TS}\",\"duration\":12,\"triggered_by\":\"dev\",\"tests_total\":3,\"tests_selected\":3}}]"

echo "V-EXEC-01 seeded: 1 suite (3 tests) + 1 environment + 1 passed suite execution"
