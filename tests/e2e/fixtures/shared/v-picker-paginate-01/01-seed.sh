#!/bin/bash
# V-PICKER-PAGINATE-01: Seeds the paginated entity-picker visual fixture.
# 60 standalone tests (3 picker pages of 25) + 1 empty target suite,
# 59 candidate suites (60 suites total) + 1 empty target regression.
set -e
source "$(dirname "$0")/../../../scripts/lib.sh"

_admin_on
trap _admin_off EXIT

# Reset existing data so the picker totals are exact (60 tests / 60 suites)
_reset

SUITE_ID="e8000001-0001-0001-0001-000000000001"
REGRESSION_ID="e8000002-0001-0001-0001-000000000001"

# 60 candidate tests with a mix of statuses (picker row badges)
STATUSES=("passed" "failed" "never_run")
for i in $(seq 1 60); do
  NUM=$(printf "%03d" "$i")
  ID="e8000003-0001-0001-0001-$(printf "%012d" "$i")"
  STATUS="${STATUSES[$(( (i - 1) % 3 ))]}"
  _batch_test "$ID" "Picker Test $NUM" "" '["picker"]' "$STATUS"
done
_flush_tests

# Suites: 1 empty target + 59 candidates = 60 total, so the regression
# suite picker shows "60 suites - refine your search to narrow down".
# Entities carry the full shape the POST APIs write (description/tags/
# variables/suites) - the update paths raw-index those keys.
TS="$(_ts)"
SUITE_OPS="[{\"op\":\"add\",\"entity\":{\"id\":\"$SUITE_ID\",\"name\":\"Picker Paginate Suite\",\"version\":\"1.0.0\",\"description\":\"\",\"tags\":[],\"variables\":{},\"created_at\":\"$TS\",\"updated_at\":\"$TS\",\"metadata\":{},\"tests\":[]}}"
for i in $(seq 1 59); do
  NUM=$(printf "%03d" "$i")
  ID="e8000004-0001-0001-0001-$(printf "%012d" "$i")"
  SUITE_OPS+=",{\"op\":\"add\",\"entity\":{\"id\":\"$ID\",\"name\":\"Picker Suite $NUM\",\"version\":\"1.0.0\",\"description\":\"\",\"tags\":[],\"variables\":{},\"created_at\":\"$TS\",\"updated_at\":\"$TS\",\"metadata\":{},\"tests\":[]}}"
done
SUITE_OPS+="]"
_bulk suites "$SUITE_OPS"

_bulk regressions "[{\"op\":\"add\",\"entity\":{\"id\":\"$REGRESSION_ID\",\"name\":\"Picker Paginate Regression\",\"version\":\"1.0.0\",\"description\":\"\",\"suites\":[],\"tags\":[],\"variables\":{},\"created_at\":\"$TS\",\"updated_at\":\"$TS\",\"metadata\":{}}}]"

echo "V-PICKER-PAGINATE-01 seeded: 60 tests, 60 suites (1 target + 59 candidates), 1 regression"
