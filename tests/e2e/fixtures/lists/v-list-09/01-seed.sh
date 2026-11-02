#!/bin/bash
# V-LIST-09: Seeds populated regressions list with various status states
# Creates 30 regressions (>25 for pagination) with Passed, Failed, and Never Run statuses
# Per wireframe: Names follow LIST-9 pattern "AppName Version"
set -e
source "$(dirname "$0")/../../../scripts/lib.sh"

_admin_on
trap _admin_off EXIT

# Reset existing data
_reset

# Create tests first (valid UUIDs with hex-only characters)
_add_test "10000001-0001-4001-8001-000000000001" "API Health Check" "" '["api"]' "passed"
_add_test "10000002-0002-4002-8002-000000000002" "TLS Validation" "" '["tls"]' "passed"
_add_test "10000003-0003-4003-8003-000000000003" "DB Connection" "" '["db"]' "passed"
_add_test "10000004-0004-4004-8004-000000000004" "Auth Flow" "" '["auth"]' "passed"
_add_test "10000005-0005-4005-8005-000000000005" "Cache Test" "" '["cache"]' "failed"
_add_test "10000006-0006-4006-8006-000000000006" "Queue Test" "" '["queue"]' "failed"
_add_test "10000007-0007-4007-8007-000000000007" "Storage Test" "" '["storage"]' ""
_add_test "10000008-0008-4008-8008-000000000008" "Network Test" "" '["network"]' ""

# Create suites that will be assigned to regressions
# 3 suites per regression on average
_add_suite "20000001-0001-4001-8001-000000000001" "Core Services"
_add_suite "20000002-0002-4002-8002-000000000002" "API Tests"
_add_suite "20000003-0003-4003-8003-000000000003" "Database Tests"
_add_suite "20000004-0004-4004-8004-000000000004" "Security Tests"
_add_suite "20000005-0005-4005-8005-000000000005" "Integration Tests"
_add_suite "20000006-0006-4006-8006-000000000006" "Performance Tests"
_add_suite "20000007-0007-4007-8007-000000000007" "Load Tests"
_add_suite "20000008-0008-4008-8008-000000000008" "Stress Tests"
_add_suite "20000009-0009-4009-8009-000000000009" "UI Tests"
_add_suite "2000000a-000a-400a-800a-00000000000a" "E2E Tests"

# Create 30 regressions with various statuses
# Names follow LIST-9 pattern: "AppName Version" (e.g., "WAVE 25.12")

# Passed regressions (18)
_add_regression "30000001-0001-4001-8001-000000000001" "WAVE 25.12"
_add_regression "30000002-0002-4002-8002-000000000002" "Billing v2.1"
_add_regression "30000003-0003-4003-8003-000000000003" "Routing 1.3.0"
_add_regression "30000004-0004-4004-8004-000000000004" "WAVE 25.11"
_add_regression "30000005-0005-4005-8005-000000000005" "Billing v2.0"
_add_regression "30000006-0006-4006-8006-000000000006" "Routing 1.2.10"
_add_regression "30000007-0007-4007-8007-000000000007" "WAVE 25.10"
_add_regression "30000008-0008-4008-8008-000000000008" "Billing v1.5"
_add_regression "30000009-0009-4009-8009-000000000009" "DataFlow 3.0"
_add_regression "3000000a-000a-400a-800a-00000000000a" "NetGuard 2.5"
_add_regression "3000000b-000b-400b-800b-00000000000b" "CloudSync 1.8"
_add_regression "3000000c-000c-400c-800c-00000000000c" "SecureVault 4.2"
_add_regression "3000000d-000d-400d-800d-00000000000d" "LogStream 2.0"
_add_regression "3000000e-000e-400e-800e-00000000000e" "MetricHub 1.5"
_add_regression "3000000f-000f-400f-800f-00000000000f" "AlertEngine 3.1"
_add_regression "30000010-0010-4010-8010-000000000010" "BackupPro 2.3"
_add_regression "30000011-0011-4011-8011-000000000011" "RecoverNow 1.2"
_add_regression "30000012-0012-4012-8012-000000000012" "EncryptAll 2.0"

# Failed regressions (7)
_add_regression "30000013-0013-4013-8013-000000000013" "Routing 1.2.9"
_add_regression "30000014-0014-4014-8014-000000000014" "LoadDriver 1.0"
_add_regression "30000015-0015-4015-8015-000000000015" "StressTest 2.5"
_add_regression "30000016-0016-4016-8016-000000000016" "FaultInjector 1.1"
_add_regression "30000017-0017-4017-8017-000000000017" "FailOver 3.0"
_add_regression "30000018-0018-4018-8018-000000000018" "CacheRush 1.5"
_add_regression "30000019-0019-4019-8019-000000000019" "QueueStorm 2.0"

# Never run regressions (5)
_add_regression "3000001a-001a-401a-801a-00000000001a" "NewApp 1.0"
_add_regression "3000001b-001b-401b-801b-00000000001b" "BetaFeature 0.5"
_add_regression "3000001c-001c-401c-801c-00000000001c" "AlphaTest 0.1"
_add_regression "3000001d-001d-401d-801d-00000000001d" "Upcoming 1.0"
_add_regression "3000001e-001e-401e-801e-00000000001e" "Experimental 0.2"

# Create executions to set regression statuses
# Passed regressions (using entity_type="regression")
_add_exec "e0000001-0001-4001-8001-000000000001" "30000001-0001-4001-8001-000000000001" "passed" 100 "$(_ts)" 15 15 "regression"
_add_exec "e0000002-0002-4002-8002-000000000002" "30000002-0002-4002-8002-000000000002" "passed" 100 "$(_ts)" 10 10 "regression"
_add_exec "e0000003-0003-4003-8003-000000000003" "30000003-0003-4003-8003-000000000003" "passed" 100 "$(_ts)" 25 25 "regression"
_add_exec "e0000004-0004-4004-8004-000000000004" "30000004-0004-4004-8004-000000000004" "passed" 100 "$(_ts)" 20 20 "regression"
_add_exec "e0000005-0005-4005-8005-000000000005" "30000005-0005-4005-8005-000000000005" "passed" 100 "$(_ts)" 12 12 "regression"
_add_exec "e0000006-0006-4006-8006-000000000006" "30000006-0006-4006-8006-000000000006" "passed" 100 "$(_ts)" 8 8 "regression"
_add_exec "e0000007-0007-4007-8007-000000000007" "30000007-0007-4007-8007-000000000007" "passed" 100 "$(_ts)" 18 18 "regression"
_add_exec "e0000008-0008-4008-8008-000000000008" "30000008-0008-4008-8008-000000000008" "passed" 100 "$(_ts)" 22 22 "regression"
_add_exec "e0000009-0009-4009-8009-000000000009" "30000009-0009-4009-8009-000000000009" "passed" 100 "$(_ts)" 14 14 "regression"
_add_exec "e000000a-000a-400a-800a-00000000000a" "3000000a-000a-400a-800a-00000000000a" "passed" 100 "$(_ts)" 16 16 "regression"
_add_exec "e000000b-000b-400b-800b-00000000000b" "3000000b-000b-400b-800b-00000000000b" "passed" 100 "$(_ts)" 9 9 "regression"
_add_exec "e000000c-000c-400c-800c-00000000000c" "3000000c-000c-400c-800c-00000000000c" "passed" 100 "$(_ts)" 11 11 "regression"
_add_exec "e000000d-000d-400d-800d-00000000000d" "3000000d-000d-400d-800d-00000000000d" "passed" 100 "$(_ts)" 7 7 "regression"
_add_exec "e000000e-000e-400e-800e-00000000000e" "3000000e-000e-400e-800e-00000000000e" "passed" 100 "$(_ts)" 13 13 "regression"
_add_exec "e000000f-000f-400f-800f-00000000000f" "3000000f-000f-400f-800f-00000000000f" "passed" 100 "$(_ts)" 19 19 "regression"
_add_exec "e0000010-0010-4010-8010-000000000010" "30000010-0010-4010-8010-000000000010" "passed" 100 "$(_ts)" 6 6 "regression"
_add_exec "e0000011-0011-4011-8011-000000000011" "30000011-0011-4011-8011-000000000011" "passed" 100 "$(_ts)" 5 5 "regression"
_add_exec "e0000012-0012-4012-8012-000000000012" "30000012-0012-4012-8012-000000000012" "passed" 100 "$(_ts)" 8 8 "regression"

# Failed regressions
_add_exec "e0000013-0013-4013-8013-000000000013" "30000013-0013-4013-8013-000000000013" "failed" 100 "$(_ts)" 12 12 "regression"
_add_exec "e0000014-0014-4014-8014-000000000014" "30000014-0014-4014-8014-000000000014" "failed" 100 "$(_ts)" 30 30 "regression"
_add_exec "e0000015-0015-4015-8015-000000000015" "30000015-0015-4015-8015-000000000015" "failed" 100 "$(_ts)" 25 25 "regression"
_add_exec "e0000016-0016-4016-8016-000000000016" "30000016-0016-4016-8016-000000000016" "failed" 100 "$(_ts)" 15 15 "regression"
_add_exec "e0000017-0017-4017-8017-000000000017" "30000017-0017-4017-8017-000000000017" "failed" 100 "$(_ts)" 10 10 "regression"
_add_exec "e0000018-0018-4018-8018-000000000018" "30000018-0018-4018-8018-000000000018" "failed" 100 "$(_ts)" 8 8 "regression"
_add_exec "e0000019-0019-4019-8019-000000000019" "30000019-0019-4019-8019-000000000019" "failed" 100 "$(_ts)" 12 12 "regression"

# Never run regressions: 1a-1e (no executions created)

echo "V-LIST-09 seeded: 30 regressions, 10 suites, 8 tests, 25 executions (18 passed, 7 failed, 5 never run)"
