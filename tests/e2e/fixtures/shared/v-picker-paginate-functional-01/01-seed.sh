#!/bin/bash
# V-PICKER-PAGINATE-FUNCTIONAL-01: namespaced picker fixture (NO DB reset -
# runs inside the functional-workflow phase alongside self-seeding specs).
# 60 "PKR2T" candidate tests + 1 empty target suite; 60 "PKR2S" candidate
# suites each with a failed execution + 1 empty target regression.
# The specs scope the picker to the fixture via the PKR2T / PKR2S search
# prefixes, so leftover entities from sibling specs cannot interfere.
# Torn down by 02-cleanup.sh.
set -e
source "$(dirname "$0")/../../../scripts/lib.sh"

_admin_on
trap _admin_off EXIT

TARGET_SUITE_ID="e9100002-0001-0001-0001-000000000001"
TARGET_REGRESSION_ID="e9100005-0001-0001-0001-000000000001"
TS="$(_ts)"

for i in $(seq 1 60); do
  NUM=$(printf "%03d" "$i")
  _batch_test "e9100001-0001-0001-0001-$(printf "%012d" "$i")" "PKR2T Cand $NUM" "" "" ""
done
_flush_tests

# Suites and the regression carry the full shape POST /suites and
# POST /regressions write (description/tags/variables/suites); the
# regression update path raw-indexes those keys when snapshotting.
SUITE_OPS=""
EXEC_OPS=""
for i in $(seq 1 60); do
  NUM=$(printf "%03d" "$i")
  SID="e9100003-0001-0001-0001-$(printf "%012d" "$i")"
  EID="e9100004-0001-0001-0001-$(printf "%012d" "$i")"
  [[ -n "$SUITE_OPS" ]] && SUITE_OPS+=","
  SUITE_OPS+="{\"op\":\"add\",\"entity\":{\"id\":\"$SID\",\"name\":\"PKR2S Suite $NUM\",\"version\":\"1\",\"description\":\"\",\"tags\":[],\"variables\":{},\"created_at\":\"$TS\",\"updated_at\":\"$TS\",\"metadata\":{},\"tests\":[]}}"
  [[ -n "$EXEC_OPS" ]] && EXEC_OPS+=","
  EXEC_OPS+="{\"op\":\"add\",\"entity\":{\"id\":\"$EID\",\"entity_type\":\"suite\",\"entity_id\":\"$SID\",\"status\":\"failed\",\"progress\":100,\"started_at\":\"$TS\",\"updated_at\":\"$TS\",\"tests_total\":1,\"tests_selected\":1,\"completed_at\":\"$TS\"}}"
done
SUITE_OPS+=",{\"op\":\"add\",\"entity\":{\"id\":\"$TARGET_SUITE_ID\",\"name\":\"PKR2 Target Suite\",\"version\":\"1\",\"description\":\"\",\"tags\":[],\"variables\":{},\"created_at\":\"$TS\",\"updated_at\":\"$TS\",\"metadata\":{},\"tests\":[]}}"
_bulk suites "[$SUITE_OPS]"
_bulk executions "[$EXEC_OPS]"

_bulk regressions "[{\"op\":\"add\",\"entity\":{\"id\":\"$TARGET_REGRESSION_ID\",\"name\":\"PKR2 Target Regression\",\"version\":\"1.0.0\",\"description\":\"\",\"suites\":[],\"tags\":[],\"variables\":{},\"created_at\":\"$TS\",\"updated_at\":\"$TS\",\"metadata\":{}}}]"

echo "V-PICKER-PAGINATE-FUNCTIONAL-01 seeded (PKR2 namespace): 60 tests, 61 suites, 60 executions, 1 regression"
