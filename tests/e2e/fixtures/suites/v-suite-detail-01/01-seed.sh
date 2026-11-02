#!/bin/bash
# V-SUITE-DETAIL-01: Seeds a suite with tests, variables, tags, and description
# Creates 1 suite with 4 tests and 3 variables for populated detail page testing
set -e
source "$(dirname "$0")/../../../scripts/lib.sh"

BACKEND_URL="${WAVE_BACKEND_URL:-http://localhost:${WAVE_E2E_BACKEND_PORT:-8000}}"

_admin_on
trap _admin_off EXIT

# Reset existing data
_reset

# Test UUIDs
T1="b0000001-0001-0001-0001-000000000001"
T2="b0000002-0002-0002-0002-000000000002"
T3="b0000003-0003-0003-0003-000000000003"
T4="b0000004-0004-0004-0004-000000000004"

# Suite UUID
S1="c0000001-0001-0001-0001-000000000001"

# Create tests first
_add_test "$T1" "API Health Check" "" '["api","smoke"]' "passed"
_add_test "$T2" "Database Connection" "" '["db","integration"]' "passed"
_add_test "$T3" "Auth Flow Validation" "" '["auth","security"]' "failed"
_add_test "$T4" "Cache Performance" "" '["cache","perf"]' ""

# Create suite with tests
_add_suite "$S1" "Infrastructure Health" "" "[\"$T1\",\"$T2\",\"$T3\",\"$T4\"]"

# Create an execution to set suite status
_add_exec "d0000001-0001-0001-0001-000000000001" "$S1" "passed" 100 "$(_ts)" 4 4 "suite"

# Set suite variables and metadata via PUT (admin must be on for this)
curl -sf -X PUT "${BACKEND_URL}/suites/${S1}" \
  -H "Content-Type: application/json" \
  -d '{
    "description": "Core infrastructure health validation suite covering API, database, auth, and cache layers.",
    "tags": ["infrastructure", "health", "critical"],
    "variables": {
      "api_url": {
        "type": "string",
        "value": "https://api.example.com",
        "secret": false
      },
      "db_password": {
        "type": "string",
        "value": "s3cr3t-p4ss",
        "secret": true
      },
      "max_retries": {
        "type": "integer",
        "value": "3",
        "secret": false
      }
    }
  }' > /dev/null

echo "V-SUITE-DETAIL-01 seeded: 1 suite (4 tests, 3 variables, 3 tags)"
