#!/bin/bash
# V-DASH-05: Seeds minimal data to switch from empty to populated state
set -e
source "$(dirname "$0")/../../../scripts/lib.sh"

_admin_on
trap _admin_off EXIT

# Reset existing data
_reset

# Pre-defined UUID for entity (valid UUID format required)
TEST_FIRST="d5a8c9f2-4e3b-49a1-8c7d-6f1e2a3b4c5d"

# Add just one test to trigger populated state (no Tour CTA)
_add_test "$TEST_FIRST" "First Test"

echo "V-DASH-05 seeded: 1 test (triggers populated state)"
