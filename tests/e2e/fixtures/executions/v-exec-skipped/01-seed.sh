#!/bin/bash
# A3: Seeds a regression execution terminated with status=skipped so the
# Executions list can surface the new 'skipped' row label coming from
# `mapStatus` after the frontend stopped falling back to 'running'.
set -e
source "$(dirname "$0")/../../../scripts/lib.sh"

BACKEND_URL="${WAVE_BACKEND_URL:-http://localhost:${WAVE_E2E_BACKEND_PORT:-8000}}"

_admin_on
trap _admin_off EXIT

_reset_all

T1="b0000041-0001-0001-0001-000000000001"
S1="c0000041-0001-0001-0001-000000000001"
R1="a0000041-0000-0000-0000-000000000001"
ENV1="e0000001-0000-0000-0000-000000000001"
EXEC1="d0000041-0000-0000-0000-000000000041"
TS="2026-04-15T13:00:00+00:00"
END_TS="2026-04-15T13:00:02+00:00"

_add_test "$T1" "Halt Smoke" "" '["halt"]' "skipped"
_add_suite "$S1" "Halt Suite" "" "[\"$T1\"]"
_add_regression "$R1" "Halt Regression"

curl -sf -X PUT "${BACKEND_URL}/regressions/${R1}" \
  -H "Content-Type: application/json" \
  -d "{\"description\": \"Regression halted by halt-with-skip.\", \"tags\": [\"halt\"], \"suites\": [\"${S1}\"], \"variables\": {}}" > /dev/null

_add_environment "$ENV1" "Local"

_bulk executions "[{\"op\":\"add\",\"entity\":{\"id\":\"${EXEC1}\",\"name\":\"Halt Regression\",\"entity_type\":\"regression\",\"entity_id\":\"${R1}\",\"environment_id\":\"${ENV1}\",\"status\":\"skipped\",\"progress\":100,\"started_at\":\"${TS}\",\"updated_at\":\"${END_TS}\",\"completed_at\":\"${END_TS}\",\"ended_at\":\"${END_TS}\",\"duration\":2,\"triggered_by\":\"dev\",\"tests_total\":1,\"tests_selected\":1}}]"

echo "V-EXEC-SKIPPED seeded: 1 regression terminated as skipped"
