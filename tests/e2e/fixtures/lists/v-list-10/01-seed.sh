#!/bin/bash
# V-LIST-10: Seeds data for Regression Run Dialog test
# Creates regressions with varied suite/test combinations for test selection UI
# Creates environments for environment selection UI
#
# Combinations covered:
# - Regression with 1 suite, 1 test: "WAVE 25.12"
# - Regression with 1 suite, multiple tests: "Billing v2.1"
# - Regression with multiple suites, 0 tests: "Routing 1.3.0"
# - Regression with multiple suites, multiple tests: "DataFlow 3.0"
# - Regression with 1 suite, 0 tests: "NewApp 1.0"
# - Regression with multiple suites mixed (some empty, some with tests): "NetGuard 2.5"
set -e
source "$(dirname "$0")/../../../scripts/lib.sh"

_admin_on
trap _admin_off EXIT

# Reset existing data
_reset

# =============================================================================
# REGRESSIONS (created first, referenced by suites)
# =============================================================================
_add_regression "30000001-0001-4001-8001-000000000001" "WAVE 25.12"        # 1 suite, 1 test
_add_regression "30000002-0002-4002-8002-000000000002" "Billing v2.1"      # 1 suite, 3 tests
_add_regression "30000003-0003-4003-8003-000000000003" "Routing 1.3.0"     # 2 suites, 0 tests
_add_regression "30000004-0004-4004-8004-000000000004" "DataFlow 3.0"      # 3 suites, 5 tests
_add_regression "30000005-0005-4005-8005-000000000005" "NewApp 1.0"        # 1 suite, 0 tests
_add_regression "30000006-0006-4006-8006-000000000006" "NetGuard 2.5"      # 3 suites mixed

# =============================================================================
# SUITES (linked to regressions via parent_regression, tests via tests array)
# =============================================================================
# WAVE 25.12: 1 suite, 1 test
_add_suite "20000001-0001-4001-8001-000000000001" "Auth Suite" "WAVE 25.12" '["10000001-0001-4001-8001-000000000001"]'

# Billing v2.1: 1 suite, 3 tests
_add_suite "20000002-0002-4002-8002-000000000002" "API Suite" "Billing v2.1" '["10000002-0002-4002-8002-000000000002","10000003-0003-4003-8003-000000000003","10000004-0004-4004-8004-000000000004"]'

# Routing 1.3.0: 2 empty suites
_add_suite "20000003-0003-4003-8003-000000000003" "Empty Suite A" "Routing 1.3.0"
_add_suite "20000004-0004-4004-8004-000000000004" "Empty Suite B" "Routing 1.3.0"

# DataFlow 3.0: 3 suites with tests
_add_suite "20000005-0005-4005-8005-000000000005" "Database Suite" "DataFlow 3.0" '["10000005-0005-4005-8005-000000000005","10000006-0006-4006-8006-000000000006"]'
_add_suite "20000006-0006-4006-8006-000000000006" "Cache Suite" "DataFlow 3.0" '["10000007-0007-4007-8007-000000000007","10000008-0008-4008-8008-000000000008"]'
_add_suite "20000007-0007-4007-8007-000000000007" "Queue Suite" "DataFlow 3.0" '["10000009-0009-4009-8009-000000000009"]'

# NewApp 1.0: 1 empty suite
_add_suite "20000008-0008-4008-8008-000000000008" "Placeholder Suite" "NewApp 1.0"

# NetGuard 2.5: 3 suites mixed (1 empty, 2 with tests)
_add_suite "20000009-0009-4009-8009-000000000009" "Security Suite" "NetGuard 2.5" '["1000000a-000a-400a-800a-00000000000a","1000000b-000b-400b-800b-00000000000b"]'
_add_suite "2000000a-000a-400a-800a-00000000000a" "Network Suite" "NetGuard 2.5" '["1000000c-000c-400c-800c-00000000000c"]'
_add_suite "2000000b-000b-400b-800b-00000000000b" "Empty Security Suite" "NetGuard 2.5"

# =============================================================================
# TESTS (linked to suites via parent_suite)
# =============================================================================
# WAVE 25.12 - Auth Suite: 1 test
_add_test "10000001-0001-4001-8001-000000000001" "Login Test" "Auth Suite" '["auth"]' "passed"

# Billing v2.1 - API Suite: 3 tests
_add_test "10000002-0002-4002-8002-000000000002" "API Health Check" "API Suite" '["api"]' "passed"
_add_test "10000003-0003-4003-8003-000000000003" "API Rate Limit" "API Suite" '["api"]' "passed"
_add_test "10000004-0004-4004-8004-000000000004" "API Auth" "API Suite" '["api","auth"]' "failed"

# DataFlow 3.0 - Database Suite: 2 tests
_add_test "10000005-0005-4005-8005-000000000005" "DB Connection" "Database Suite" '["db"]' "passed"
_add_test "10000006-0006-4006-8006-000000000006" "DB Query" "Database Suite" '["db"]' "passed"

# DataFlow 3.0 - Cache Suite: 2 tests
_add_test "10000007-0007-4007-8007-000000000007" "Cache Get" "Cache Suite" '["cache"]' "passed"
_add_test "10000008-0008-4008-8008-000000000008" "Cache Set" "Cache Suite" '["cache"]' "failed"

# DataFlow 3.0 - Queue Suite: 1 test
_add_test "10000009-0009-4009-8009-000000000009" "Queue Publish" "Queue Suite" '["queue"]' "passed"

# NetGuard 2.5 - Security Suite: 2 tests
_add_test "1000000a-000a-400a-800a-00000000000a" "TLS Check" "Security Suite" '["security"]' "passed"
_add_test "1000000b-000b-400b-800b-00000000000b" "Firewall Rules" "Security Suite" '["security"]' "passed"

# NetGuard 2.5 - Network Suite: 1 test
_add_test "1000000c-000c-400c-800c-00000000000c" "Ping Test" "Network Suite" '["network"]' "passed"

# =============================================================================
# EXECUTIONS (set regression statuses)
# =============================================================================
_add_exec "e0000001-0001-4001-8001-000000000001" "30000001-0001-4001-8001-000000000001" "passed" 100 "$(_ts)" 1 1 "regression"
_add_exec "e0000002-0002-4002-8002-000000000002" "30000002-0002-4002-8002-000000000002" "passed" 100 "$(_ts)" 3 3 "regression"
_add_exec "e0000003-0003-4003-8003-000000000003" "30000003-0003-4003-8003-000000000003" "failed" 100 "$(_ts)" 0 0 "regression"
_add_exec "e0000004-0004-4004-8004-000000000004" "30000004-0004-4004-8004-000000000004" "passed" 100 "$(_ts)" 5 5 "regression"
# NewApp 1.0 and NetGuard 2.5 have no executions (never_run)

# =============================================================================
# ENVIRONMENTS (for run dialog)
# =============================================================================
curl -sf -X POST "${BACKEND_URL}/admin/bulk/environments" \
  -H "Content-Type: application/json" \
  -d '{
    "operations": [
      {"op": "add", "entity": {"id": "e0000001-0001-4001-8001-100000000001", "name": "Development", "description": "Dev environment"}},
      {"op": "add", "entity": {"id": "e0000002-0002-4002-8002-100000000002", "name": "Staging", "description": "Staging environment"}},
      {"op": "add", "entity": {"id": "e0000003-0003-4003-8003-100000000003", "name": "Production", "description": "Production environment"}},
      {"op": "add", "entity": {"id": "e0000004-0004-4004-8004-100000000004", "name": "Local", "description": "Local development"}},
      {"op": "add", "entity": {"id": "e0000005-0005-4005-8005-100000000005", "name": "Demo", "description": "Demo environment"}},
      {"op": "add", "entity": {"id": "e0000006-0006-4006-8006-100000000006", "name": "Integration", "description": "Integration testing"}},
      {"op": "add", "entity": {"id": "e0000007-0007-4007-8007-100000000007", "name": "Performance", "description": "Performance testing"}},
      {"op": "add", "entity": {"id": "e0000008-0008-4008-8008-100000000008", "name": "QA", "description": "QA environment"}}
    ]
  }' > /dev/null 2>&1 || echo "Environments API not available, skipping"

echo "V-LIST-10 seeded:"
echo "  6 regressions (varied suite/test combinations)"
echo "  11 suites (some empty, some with tests)"
echo "  12 tests"
echo "  8 environments"
echo ""
echo "Regression breakdown:"
echo "  - WAVE 25.12: 1 suite, 1 test (passed)"
echo "  - Billing v2.1: 1 suite, 3 tests (passed)"
echo "  - Routing 1.3.0: 2 suites, 0 tests (failed)"
echo "  - DataFlow 3.0: 3 suites, 5 tests (passed)"
echo "  - NewApp 1.0: 1 suite, 0 tests (never_run)"
echo "  - NetGuard 2.5: 3 suites mixed, 3 tests (never_run)"
