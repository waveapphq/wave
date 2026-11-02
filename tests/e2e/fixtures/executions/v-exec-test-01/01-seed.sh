#!/bin/bash
# V-EXEC-HISTORY-01:
# Seeds a terminal TEST-type execution that renders on the Historical
# Test Canvas (`/executions/history/<execId>`). Test-type runs reuse
# the execution id as the run_id, so the cover sheet carries
# `run_id == id`. Also seeds a minimal workflow_snapshot so the
# canvas has nodes to render, which `get_historical_test_run` picks up
# via `snapshot.workflow OR execution.workflow_snapshot`.
#
# NOTE: for a test-type execution `/executions/<id>` redirects to
# `/executions/history/<id>`; v-exec-test-01.spec.ts asserts that page.
set -e
source "$(dirname "$0")/../../../scripts/lib.sh"

BACKEND_URL="${WAVE_BACKEND_URL:-http://localhost:${WAVE_E2E_BACKEND_PORT:-8000}}"

_admin_on
trap _admin_off EXIT

_reset_all

T1="b0000031-0001-0001-0001-000000000001"
ENV1="e0000001-0000-0000-0000-000000000001"
EXEC1="d0000003-0000-0000-0000-000000000003"
TS="2026-04-15T12:00:00+00:00"
END_TS="2026-04-15T12:00:05+00:00"

_add_test "$T1" "Login smoke" "" '["auth"]' "passed"

curl -sf -X PUT "${BACKEND_URL}/tests/${T1}" \
  -H "Content-Type: application/json" \
  -d '{
    "description": "Verifies the happy-path login.",
    "metadata": {"tags": ["auth", "smoke"]}
  }' > /dev/null 2>&1 || true

_add_environment "$ENV1" "Local"

# Execution cover sheet with the Historical Canvas plumbing:
#   - run_id == id so _locate_run() finds the row for a test-type run.
#   - workflow_snapshot provides the nodes/edges the canvas paints when
#     no snapshot file exists on disk (pre-refactor behavior).
_bulk executions "[{\"op\":\"add\",\"entity\":{
  \"id\":\"${EXEC1}\",
  \"run_id\":\"${EXEC1}\",
  \"name\":\"Login smoke\",
  \"entity_type\":\"test\",
  \"entity_id\":\"${T1}\",
  \"environment_id\":\"${ENV1}\",
  \"status\":\"passed\",
  \"progress\":100,
  \"started_at\":\"${TS}\",
  \"updated_at\":\"${END_TS}\",
  \"completed_at\":\"${END_TS}\",
  \"ended_at\":\"${END_TS}\",
  \"duration\":5,
  \"triggered_by\":\"dev\",
  \"tests_total\":1,
  \"tests_selected\":1,
  \"workflow_snapshot\":{
    \"nodes\":[
      {\"id\":\"start-node\",\"type\":\"startNode\",\"position\":{\"x\":400,\"y\":40},\"data\":{\"label\":\"Start\"}},
      {\"id\":\"log-hist\",\"type\":\"workflowNode\",\"position\":{\"x\":400,\"y\":160},\"data\":{\"label\":\"Log\",\"elementType\":\"log\",\"nodeType\":\"plugin\",\"category\":\"logging\",\"version\":\"1.0.0\",\"description\":\"Login Smoke Log\",\"hasNewerVersion\":false,\"expressionFields\":[],\"templateFields\":[],\"variableExpressionKeys\":[],\"config\":{\"values\":{\"level\":\"INFO\",\"message\":\"login-smoke-passed\"},\"outputBindings\":{},\"profileBindings\":[]}},\"measured\":{\"width\":120,\"height\":62}}
    ],
    \"edges\":[
      {\"id\":\"e1\",\"source\":\"start-node\",\"target\":\"log-hist\",\"type\":\"default\"}
    ]
  }
}}]"

echo "V-EXEC-HISTORY-01 seeded: 1 terminal test-type execution with workflow snapshot"
