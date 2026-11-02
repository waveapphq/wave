#!/bin/bash
# V-LIST-05: Seeds tests for bulk selection testing
# Creates multiple tests to test BULK-1 through BULK-4 selection patterns
set -e
source "$(dirname "$0")/../../../scripts/lib.sh"

_admin_on
trap _admin_off EXIT

# Reset existing data
_reset

# Create suites with UUIDs
_add_suite "a1b2c3d4-e5f6-7890-abcd-ef1234567890" "API Tests"
_add_suite "b2c3d4e5-f6a7-8901-bcde-f12345678901" "UI Tests"
_add_suite "c3d4e5f6-a7b8-9012-cdef-123456789012" "Integration"

# Create multiple tests for selection testing with UUIDs and tags
_add_test "11111111-1111-1111-1111-111111111111" "Test Selection Item 1" "API Tests" '["api","smoke"]'
_add_test "22222222-2222-2222-2222-222222222222" "Test Selection Item 2" "API Tests" '["api","regression"]'
_add_test "33333333-3333-3333-3333-333333333333" "Test Selection Item 3" "UI Tests" '["ui","smoke"]'
_add_test "44444444-4444-4444-4444-444444444444" "Test Selection Item 4" "UI Tests" '["ui","regression"]'
_add_test "55555555-5555-5555-5555-555555555555" "Test Selection Item 5" "Integration" '["integration","smoke"]'
_add_test "66666666-6666-6666-6666-666666666666" "Test Selection Item 6" "Integration" '["integration","regression"]'

# Add some executions for status variety (using test UUIDs and exec UUIDs)
_add_exec "e1e1e1e1-1111-1111-1111-111111111111" "11111111-1111-1111-1111-111111111111" "passed" 100 "$(_ts)" 1 1 "test"
_add_exec "e3e3e3e3-3333-3333-3333-333333333333" "33333333-3333-3333-3333-333333333333" "failed" 100 "$(_ts)" 1 1 "test"
_add_exec "e5e5e5e5-5555-5555-5555-555555555555" "55555555-5555-5555-5555-555555555555" "passed" 100 "$(_ts)" 1 1 "test"

echo "V-LIST-05 seeded: 6 tests, 3 suites, 3 executions"
