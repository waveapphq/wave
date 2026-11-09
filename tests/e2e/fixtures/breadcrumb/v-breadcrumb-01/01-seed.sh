#!/bin/bash
# V-BREADCRUMB-01: Shared fixture for the breadcrumb V-tests.
#
# Seeds:
#   - Tests: short test (Login Check), 200-char test name (truncation), and
#     a small test that lives in multiple suites for the tests-list multi-suite
#     popover cell coverage.
#   - Suites: short suite (in regression for cascade tests), 200-char suite
#     name (truncation), plus two extra suites that share a test so the
#     tests-list Suite cell renders the multi-suite EntityListPopover.
#   - Regressions: short regression (contains the cascade suite), 200-char
#     regression name (truncation source for the detail-header cascade).
#   - Executions: one terminal test-type execution with a workflow_snapshot
#     for the history-canvas standalone breadcrumb mode.
#
# The tests-list multi-suite cell needs a test that appears in >= 3 suites.
# The breadcrumb truncation cases need entity names with single 200-char
# tokens so the truncate clamp engages without word breaks.
set -e
source "$(dirname "$0")/../../../scripts/lib.sh"

BACKEND_URL="${WAVE_BACKEND_URL:-http://localhost:${WAVE_E2E_BACKEND_PORT:-8000}}"

_admin_on
trap _admin_off EXIT

_reset_all

# IDs
T_SHORT="b1100001-0001-0001-0001-000000000001"
T_LONG="b1100002-0002-0002-0002-000000000002"
T_MULTI="b1100003-0003-0003-0003-000000000003"
S_SHORT="c1100001-0001-0001-0001-000000000001"
S_LONG="c1100002-0002-0002-0002-000000000002"
S_ALPHA="c1100003-0003-0003-0003-000000000003"
S_BETA="c1100004-0004-0004-0004-000000000004"
S_GAMMA="c1100005-0005-0005-0005-000000000005"
R_SHORT="d1100001-0001-0001-0001-000000000001"
R_LONG="d1100002-0002-0002-0002-000000000002"
EXEC_TEST_STANDALONE="e1100001-0001-0001-0001-000000000001"
EXEC_SUITE_RUN="e1100002-0002-0002-0002-000000000002"
ENV_LOCAL="f1100001-0001-0001-0001-000000000001"

LONG_NAME="$(printf 'q%.0s' {1..200})"
TS="2026-05-15T12:00:00+00:00"

# Tests - each needs a non-empty workflow so /tests/<id>/validate doesn't
# return MISSING_WORKFLOW which would block the workbench canvas from
# becoming ready (loadTest bails out before requestFitView on fatal errors).
TS_TEST="$(_ts)"
_workflow_log() {
  # Emits a single-node Log workflow rooted at the start node.
  cat <<EOF
{
  "nodes": [
    {
      "id": "log-1",
      "type": "workflowNode",
      "position": {"x": 400, "y": 150},
      "data": {
        "label": "Log Step",
        "elementType": "log",
        "nodeType": "plugin",
        "category": "core",
        "version": "1.0.0",
        "config": {"values": {"message": "hi"}}
      }
    }
  ],
  "edges": [{"source": "start-node", "target": "log-1"}]
}
EOF
}

for tid_name in \
  "$T_SHORT|Login Check" \
  "$T_LONG|$LONG_NAME" \
  "$T_MULTI|Shared Auth Test"
do
  TID="${tid_name%%|*}"
  TNAME="${tid_name#*|}"
  _bulk tests "[{\"op\":\"add\",\"entity\":{\"id\":\"$TID\",\"name\":\"$TNAME\",\"version\":\"1.0.0\",\"created_at\":\"$TS_TEST\",\"updated_at\":\"$TS_TEST\",\"metadata\":{\"tags\":[\"smoke\"],\"status\":\"passed\",\"last_run\":\"$TS_TEST\"},\"workflow\":$(_workflow_log),\"variables\":{}}}]"
done

# Suites
# S_SHORT contains T_SHORT and lives directly under R_SHORT for the
# regression-origin edit-mode + truncation cascade tests.
_add_suite "$S_SHORT" "Smoke Suite" "" "[\"$T_SHORT\"]"
# S_LONG carries the 200-char name (breadcrumb leaf overflow source).
_add_suite "$S_LONG" "$LONG_NAME" "" "[\"$T_LONG\"]"
# Three more suites all containing T_MULTI so the tests-list cell renders
# the "N suites" EntityListPopover trigger.
_add_suite "$S_ALPHA" "Alpha Suite" "" "[\"$T_MULTI\"]"
_add_suite "$S_BETA"  "Beta Suite"  "" "[\"$T_MULTI\"]"
_add_suite "$S_GAMMA" "Gamma Suite" "" "[\"$T_MULTI\"]"

# Regressions
# R_SHORT contains S_SHORT for the cascade tests + regression-origin edit-mode.
# PUT /regressions/<id> requires the full body (description / tags / suites /
# variables) - partial updates return 500.
_add_regression "$R_SHORT" "Nightly Smoke"
curl -sf -X PUT "${BACKEND_URL}/regressions/${R_SHORT}" \
  -H "Content-Type: application/json" \
  -d "{\"description\":\"\",\"tags\":[],\"suites\":[\"${S_SHORT}\"],\"variables\":{}}" > /dev/null

# R_LONG carries the 200-char name (detail-header prefix overflow source).
_add_regression "$R_LONG" "$LONG_NAME"
curl -sf -X PUT "${BACKEND_URL}/regressions/${R_LONG}" \
  -H "Content-Type: application/json" \
  -d "{\"description\":\"\",\"tags\":[],\"suites\":[\"${S_LONG}\"],\"variables\":{}}" > /dev/null

# Environment for the terminal test execution
_add_environment "$ENV_LOCAL" "Local"

# Standalone test-type execution for the history-canvas breadcrumb mode.
# run_id == id so _locate_run() finds the row, and workflow_snapshot gives
# the canvas a node to render so the breadcrumb shows up alongside content.
END_TS="2026-05-15T12:00:05+00:00"
_bulk executions "[{\"op\":\"add\",\"entity\":{
  \"id\":\"${EXEC_TEST_STANDALONE}\",
  \"run_id\":\"${EXEC_TEST_STANDALONE}\",
  \"name\":\"Login Check\",
  \"entity_type\":\"test\",
  \"entity_id\":\"${T_SHORT}\",
  \"environment_id\":\"${ENV_LOCAL}\",
  \"status\":\"passed\",
  \"progress\":100,
  \"triggered_by\":\"e2e\",
  \"started_at\":\"${TS}\",
  \"updated_at\":\"${END_TS}\",
  \"completed_at\":\"${END_TS}\",
  \"duration\":5,
  \"tests_total\":1,
  \"tests_selected\":1,
  \"workflow_snapshot\":{
    \"nodes\":[{\"id\":\"login\",\"type\":\"controlNode\",\"position\":{\"x\":120,\"y\":120},\"data\":{\"controlId\":\"log\",\"name\":\"Login step\"},\"width\":140,\"height\":62}],
    \"edges\":[]
  }
}}]"

# Suite-type execution so /executions/<id> renders the DetailHeader instead
# of redirecting to /executions/history/<id> (the redirect only fires for
# test-type executions).
_add_exec "$EXEC_SUITE_RUN" "$S_SHORT" "passed" 100 "$TS" 1 1 "suite"

echo "V-BREADCRUMB-01 seeded: 3 tests, 5 suites, 2 regressions, 2 executions"
