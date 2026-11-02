#!/bin/bash
# Seeds a regression execution where the SAME test_id appears in
# TWO suites (Auth + Admin). The backend rollup issues distinct run_ids
# per (suite, test) pair so the Historical Test Canvas opens two
# independent pages, one per run_id. One of the two suites has an
# additional `excluded` test to verify the View button is hidden when
# the row has no run_id.
set -e
source "$(dirname "$0")/../../../scripts/lib.sh"

BACKEND_URL="${WAVE_BACKEND_URL:-http://localhost:${WAVE_E2E_BACKEND_PORT:-8000}}"

_admin_on
trap _admin_off EXIT

_reset_all

T_SHARED="b0000061-0001-0001-0001-000000000001"
T_EXCLUDED="b0000062-0002-0002-0002-000000000002"
S_AUTH="c0000061-0001-0001-0001-000000000001"
S_ADMIN="c0000062-0002-0002-0002-000000000002"
R1="a0000061-0000-0000-0000-000000000001"
ENV1="e0000001-0000-0000-0000-000000000001"
EXEC1="d0000061-0000-0000-0000-000000000061"

RUN_AUTH="d0000061-0001-0001-0001-aa00000000aa"
RUN_ADMIN="d0000061-0002-0002-0002-bb00000000bb"

TS="2026-04-15T14:00:00+00:00"
END_TS="2026-04-15T14:00:20+00:00"

_add_test "$T_SHARED" "Login Smoke" "" '["auth"]' "passed"
_add_test "$T_EXCLUDED" "Admin-only Check" "" '["admin"]' "never_run"
_add_suite "$S_AUTH" "Auth Suite" "" "[\"$T_SHARED\"]"
_add_suite "$S_ADMIN" "Admin Suite" "" "[\"$T_SHARED\",\"$T_EXCLUDED\"]"
_add_regression "$R1" "Duplicate Test Regression"

curl -sf -X PUT "${BACKEND_URL}/regressions/${R1}" \
  -H "Content-Type: application/json" \
  -d "{\"description\": \"Same test in two suites; one test excluded.\", \"tags\": [\"regression\"], \"suites\": [\"${S_AUTH}\",\"${S_ADMIN}\"], \"variables\": {}}" > /dev/null

_add_environment "$ENV1" "Local"

# Execution record. entity_type=regression, selected_tests references the
# (suite_id, test_id) pairs; the Admin-only test is absent so it renders
# as excluded (no run_id). duplicate_tests tells the detail view that
# `T_SHARED` runs in both Auth and Admin suites.
_bulk executions "[{\"op\":\"add\",\"entity\":{
  \"id\":\"${EXEC1}\",
  \"name\":\"Duplicate Test Regression\",
  \"entity_type\":\"regression\",
  \"entity_id\":\"${R1}\",
  \"environment_id\":\"${ENV1}\",
  \"status\":\"passed\",
  \"progress\":100,
  \"started_at\":\"${TS}\",
  \"updated_at\":\"${END_TS}\",
  \"completed_at\":\"${END_TS}\",
  \"ended_at\":\"${END_TS}\",
  \"duration\":20,
  \"triggered_by\":\"dev\",
  \"tests_total\":3,
  \"tests_selected\":2,
  \"selected_tests\":[{\"suite_id\":\"${S_AUTH}\",\"test_id\":\"${T_SHARED}\"},{\"suite_id\":\"${S_ADMIN}\",\"test_id\":\"${T_SHARED}\"}],
  \"suites\":[
    {\"id\":\"${S_AUTH}\",\"name\":\"Auth Suite\",\"status\":\"passed\",\"progress\":100,\"duration\":10,\"tests\":[
      {\"id\":\"${T_SHARED}\",\"name\":\"Login Smoke\",\"status\":\"passed\",\"duration\":10,\"tags\":[\"auth\"],\"run_id\":\"${RUN_AUTH}\"}
    ]},
    {\"id\":\"${S_ADMIN}\",\"name\":\"Admin Suite\",\"status\":\"passed\",\"progress\":100,\"duration\":10,\"tests\":[
      {\"id\":\"${T_SHARED}\",\"name\":\"Login Smoke\",\"status\":\"passed\",\"duration\":10,\"tags\":[\"auth\"],\"run_id\":\"${RUN_ADMIN}\"},
      {\"id\":\"${T_EXCLUDED}\",\"name\":\"Admin-only Check\",\"status\":\"excluded\",\"duration\":null,\"tags\":[\"admin\"]}
    ]}
  ]
}}]"

echo "V-EXEC-DUPLICATE-TEST seeded: regression with same test in 2 suites (2 distinct run_ids) + 1 excluded row"
