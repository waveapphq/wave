#!/bin/bash
# V-PICKER-PAGINATE-FUNCTIONAL-01: deletes everything seeded by 01-seed.sh
# (fixed UUID ranges in the e91000xx namespace). Tolerant of partially
# missing entities so a failed spec never cascades into cleanup errors.
source "$(dirname "$0")/../../../scripts/lib.sh"

_admin_on
trap _admin_off EXIT

# Like _bulk but without -f: a 404 on an already-missing entity is fine here.
_bulk_tolerant() {
    local endpoint="$1" ops="$2"
    curl -s -X POST "${BACKEND_URL}/admin/bulk/${endpoint}" \
        -H "Content-Type: application/json" -d "{\"operations\": $ops}" > /dev/null
}

TEST_OPS=""
SUITE_OPS=""
EXEC_OPS=""
for i in $(seq 1 60); do
  P="$(printf "%012d" "$i")"
  [[ -n "$TEST_OPS" ]] && TEST_OPS+=","
  TEST_OPS+="{\"op\":\"delete\",\"entity\":{\"id\":\"e9100001-0001-0001-0001-$P\"}}"
  [[ -n "$SUITE_OPS" ]] && SUITE_OPS+=","
  SUITE_OPS+="{\"op\":\"delete\",\"entity\":{\"id\":\"e9100003-0001-0001-0001-$P\"}}"
  [[ -n "$EXEC_OPS" ]] && EXEC_OPS+=","
  EXEC_OPS+="{\"op\":\"delete\",\"entity\":{\"id\":\"e9100004-0001-0001-0001-$P\"}}"
done
SUITE_OPS+=",{\"op\":\"delete\",\"entity\":{\"id\":\"e9100002-0001-0001-0001-000000000001\"}}"

_bulk_tolerant executions "[$EXEC_OPS]"
_bulk_tolerant regressions "[{\"op\":\"delete\",\"entity\":{\"id\":\"e9100005-0001-0001-0001-000000000001\"}}]"
_bulk_tolerant suites "[$SUITE_OPS]"
_bulk_tolerant tests "[$TEST_OPS]"

echo "V-PICKER-PAGINATE-FUNCTIONAL-01 cleaned up"
