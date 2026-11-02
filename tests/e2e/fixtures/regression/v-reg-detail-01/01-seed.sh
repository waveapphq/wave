#!/bin/bash
# V-REG-DETAIL-01: Seeds a regression with suites, variables, tags, and description
# Creates 1 regression with 3 suites, 2 variables, 3 tags
set -e
source "$(dirname "$0")/../../../scripts/lib.sh"

BACKEND_URL="${WAVE_BACKEND_URL:-http://localhost:${WAVE_E2E_BACKEND_PORT:-8000}}"

_admin_on
trap _admin_off EXIT

# Reset
_reset

# Test UUIDs
T1="b0000001-0001-0001-0001-000000000001"
T2="b0000002-0002-0002-0002-000000000002"
T3="b0000003-0003-0003-0003-000000000003"

# Suite UUIDs
S1="c0000001-0001-0001-0001-000000000001"
S2="c0000002-0002-0002-0002-000000000002"
S3="c0000003-0003-0003-0003-000000000003"

# Regression UUID
R1="d0000001-0001-0001-0001-000000000001"

# Create tests
_add_test "$T1" "API Health Check" "" '["api"]' "passed"
_add_test "$T2" "Database Validation" "" '["db"]' "passed"
_add_test "$T3" "Auth Flow" "" '["auth"]' "failed"

# Create suites with tests
_add_suite "$S1" "Infrastructure Suite" "" "[\"$T1\"]"
_add_suite "$S2" "Database Suite" "" "[\"$T2\"]"
_add_suite "$S3" "Security Suite" "" "[\"$T3\"]"

# Create regression
_add_regression "$R1" "Nightly Smoke"

# Update regression with suites, variables, tags, description
curl -sf -X PUT "${BACKEND_URL}/regressions/${R1}" \
  -H "Content-Type: application/json" \
  -d '{
    "description": "Nightly smoke test regression covering critical infrastructure paths.",
    "tags": ["nightly", "smoke", "critical"],
    "suites": ["'"$S1"'", "'"$S2"'", "'"$S3"'"],
    "variables": {
      "env_name": {
        "type": "string",
        "value": "production",
        "secret": false
      },
      "max_parallel": {
        "type": "integer",
        "value": "4",
        "secret": false
      }
    }
  }' > /dev/null

echo "V-REG-DETAIL-01 seeded: 1 regression (3 suites, 2 variables, 3 tags)"
