#!/bin/bash
# V-SUITE-RUN-01: Seeds the surface for "Run from suite detail" visual.
# Creates 1 environment + 3 tests + 1 suite holding all three. No execution
# records - the visual opens the Run dialog and cancels; no run is triggered.
set -e
source "$(dirname "$0")/../../../scripts/lib.sh"

_admin_on
trap _admin_off EXIT

_reset_all

ENV1="e0000001-0000-0000-0000-000000000001"
T1="b0000031-0001-0001-0001-000000000001"
T2="b0000032-0002-0002-0002-000000000002"
T3="b0000033-0003-0003-0003-000000000003"
S1="c0000031-0001-0001-0001-000000000001"

_add_environment "$ENV1" "Local"
_add_test "$T1" "Verify DB Connectivity" "" '["db"]'
_add_test "$T2" "Ping API Gateway" "" '["api"]'
_add_test "$T3" "Check Cache Availability" "" '["cache"]'

_add_suite "$S1" "Runnable Suite" "" "[\"$T1\",\"$T2\",\"$T3\"]"

echo "V-SUITE-RUN-01 seeded: 1 env + 3 tests + 1 suite"
