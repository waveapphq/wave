#!/bin/bash
# V-SUITE-DETAIL-02: Seeds a suite for edit mode testing
# Creates 1 suite with 3 tests + 5 extra tests available for test picker
set -e
source "$(dirname "$0")/../../../scripts/lib.sh"

BACKEND_URL="${WAVE_BACKEND_URL:-http://localhost:${WAVE_E2E_BACKEND_PORT:-8000}}"

_admin_on
trap _admin_off EXIT

# Reset existing data
_reset

# Tests IN the suite
T1="b0000011-0001-0001-0001-000000000001"
T2="b0000012-0002-0002-0002-000000000002"
T3="b0000013-0003-0003-0003-000000000003"

# Tests available but NOT in suite (for test picker)
T4="b0000014-0004-0004-0004-000000000004"
T5="b0000015-0005-0005-0005-000000000005"
T6="b0000016-0006-0006-0006-000000000006"
T7="b0000017-0007-0007-0007-000000000007"
T8="b0000018-0008-0008-0008-000000000008"

# Suite UUID
S1="c0000002-0001-0001-0001-000000000001"

# Create all tests
_add_test "$T1" "Login Flow" "" '["auth"]' "passed"
_add_test "$T2" "User Profile Update" "" '["user"]' "passed"
_add_test "$T3" "Password Reset" "" '["auth","security"]' "failed"
_add_test "$T4" "Registration" "" '["auth"]' ""
_add_test "$T5" "Session Management" "" '["auth"]' "passed"
_add_test "$T6" "OAuth Integration" "" '["auth","integration"]' ""
_add_test "$T7" "API Key Rotation" "" '["security"]' "passed"
_add_test "$T8" "Rate Limiting" "" '["performance"]' "failed"

# Create suite with 3 tests
_add_suite "$S1" "Authentication Suite" "" "[\"$T1\",\"$T2\",\"$T3\"]"

# Set suite metadata via PUT
curl -sf -X PUT "${BACKEND_URL}/suites/${S1}" \
  -H "Content-Type: application/json" \
  -d '{
    "description": "Authentication and user management test suite.",
    "tags": ["auth", "user-management"],
    "variables": {
      "base_url": {
        "type": "string",
        "value": "https://auth.example.com",
        "secret": false
      }
    }
  }' > /dev/null

echo "V-SUITE-DETAIL-02 seeded: 1 suite (3 tests), 5 extra tests for picker"
