#!/bin/bash
# A4/A5: Seeds two executions on distant `started_at` timestamps so a
# "Last 7 days" preset filter strictly hides the old row, and a custom
# range spanning only the current month hides the old row too.
set -e
source "$(dirname "$0")/../../../scripts/lib.sh"

BACKEND_URL="${WAVE_BACKEND_URL:-http://localhost:${WAVE_E2E_BACKEND_PORT:-8000}}"

_admin_on
trap _admin_off EXIT

_reset_all

S1="c0000051-0001-0001-0001-000000000001"
T1="b0000051-0001-0001-0001-000000000001"
T2="b0000052-0002-0002-0002-000000000002"
ENV1="e0000001-0000-0000-0000-000000000001"
EXEC_NEW="d0000051-0000-0000-0000-000000000051"
EXEC_OLD="d0000052-0000-0000-0000-000000000052"

# Recent execution - in the past relative to the backend's `now` AND on the
# CURRENT UTC calendar day. "Last 7 days" uses `now.toISOString()` as the
# upper bound (so future-dated rows would be filtered out), and the A5
# "today only" custom-range case requires `started_at` to fall inside
# [today 00:00 UTC, today 23:59 UTC]. A naive "1 hour ago" breaks A5 in
# the first hour after UTC midnight - 1 hour ago is then yesterday. Clamp
# to the later of (now - 1h, today 00:00 UTC) so the row is always past
# AND always today.
ONE_HOUR_AGO="$(date -u -d '1 hour ago' +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -u -v-1H +%Y-%m-%dT%H:%M:%SZ)"
START_OF_TODAY="$(date -u +%Y-%m-%d)T00:00:00Z"
if [[ "$ONE_HOUR_AGO" < "$START_OF_TODAY" ]]; then
    TS_NEW="$START_OF_TODAY"
else
    TS_NEW="$ONE_HOUR_AGO"
fi
END_TS_NEW="$TS_NEW"

# Old execution - 120 days ago. Well outside Last 7 / 30 / 90 day presets and
# outside any same-month custom range (assuming the test runs in 2026).
OLD_DATE="$(date -u -d '120 days ago' +%Y-%m-%d 2>/dev/null || date -u -v-120d +%Y-%m-%d)"
TS_OLD="${OLD_DATE}T10:00:00+00:00"
END_TS_OLD="${OLD_DATE}T10:00:10+00:00"

_add_test "$T1" "Recent Smoke" "" '["smoke"]' "passed"
_add_test "$T2" "Ancient Smoke" "" '["smoke"]' "passed"
_add_suite "$S1" "Date Range Suite" "" "[\"$T1\",\"$T2\"]"

_add_environment "$ENV1" "Local"

_bulk executions "[
  {\"op\":\"add\",\"entity\":{\"id\":\"${EXEC_NEW}\",\"name\":\"Recent Run\",\"entity_type\":\"suite\",\"entity_id\":\"${S1}\",\"environment_id\":\"${ENV1}\",\"status\":\"passed\",\"progress\":100,\"started_at\":\"${TS_NEW}\",\"updated_at\":\"${END_TS_NEW}\",\"completed_at\":\"${END_TS_NEW}\",\"ended_at\":\"${END_TS_NEW}\",\"duration\":5,\"triggered_by\":\"dev\",\"tests_total\":2,\"tests_selected\":2}},
  {\"op\":\"add\",\"entity\":{\"id\":\"${EXEC_OLD}\",\"name\":\"Ancient Run\",\"entity_type\":\"suite\",\"entity_id\":\"${S1}\",\"environment_id\":\"${ENV1}\",\"status\":\"passed\",\"progress\":100,\"started_at\":\"${TS_OLD}\",\"updated_at\":\"${END_TS_OLD}\",\"completed_at\":\"${END_TS_OLD}\",\"ended_at\":\"${END_TS_OLD}\",\"duration\":10,\"triggered_by\":\"dev\",\"tests_total\":2,\"tests_selected\":2}}
]"

echo "V-EXEC-DATE-RANGE-APPLY seeded: 1 recent run (today) + 1 old run (120 days ago)"
