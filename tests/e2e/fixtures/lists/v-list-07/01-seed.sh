#!/bin/bash
# V-LIST-07: Seeds populated suites list with various status states
# Creates 30 suites (>25 for pagination) with Passed, Failed, and Never Run statuses
set -e
source "$(dirname "$0")/../../../scripts/lib.sh"

_admin_on
trap _admin_off EXIT

# Reset existing data
_reset

# Create tests first (suites need tests to show test count)
# We'll create tests and assign them to suites via parent_suite metadata
# Using valid UUID format: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx (hex chars only)
_add_test "00000001-0001-0001-0001-000000000001" "API Health Check" "" '["api"]' "passed"
_add_test "00000002-0002-0002-0002-000000000002" "TLS Validation" "" '["tls"]' "passed"
_add_test "00000003-0003-0003-0003-000000000003" "DB Connection" "" '["db"]' "passed"
_add_test "00000004-0004-0004-0004-000000000004" "Auth Flow" "" '["auth"]' "passed"
_add_test "00000005-0005-0005-0005-000000000005" "Cache Test" "" '["cache"]' "failed"
_add_test "00000006-0006-0006-0006-000000000006" "Queue Test" "" '["queue"]' "failed"
_add_test "00000007-0007-0007-0007-000000000007" "Storage Test" "" '["storage"]' ""
_add_test "00000008-0008-0008-0008-000000000008" "Network Test" "" '["network"]' ""

# Create 30 suites with various statuses
# Using valid UUID format (no letters outside hex: 0-9, a-f)
# Passed suites (18)
_add_suite "a0000001-0001-0001-0001-000000000001" "Healthchecks"
_add_suite "a0000002-0002-0002-0002-000000000002" "TLS Validation"
_add_suite "a0000003-0003-0003-0003-000000000003" "Data Integrity"
_add_suite "a0000004-0004-0004-0004-000000000004" "K8s Resilience"
_add_suite "a0000005-0005-0005-0005-000000000005" "Network Security"
_add_suite "a0000006-0006-0006-0006-000000000006" "Identity"
_add_suite "a0000007-0007-0007-0007-000000000007" "Performance"
_add_suite "a0000008-0008-0008-0008-000000000008" "API Integration"
_add_suite "a0000009-0009-0009-0009-000000000009" "Database"
_add_suite "a0000010-0010-0010-0010-000000000010" "Caching"
_add_suite "a0000011-0011-0011-0011-000000000011" "Messaging"
_add_suite "a0000012-0012-0012-0012-000000000012" "Storage"
_add_suite "a0000013-0013-0013-0013-000000000013" "Monitoring"
_add_suite "a0000014-0014-0014-0014-000000000014" "Logging"
_add_suite "a0000015-0015-0015-0015-000000000015" "Alerting"
_add_suite "a0000016-0016-0016-0016-000000000016" "Security Scans"
_add_suite "a0000017-0017-0017-0017-000000000017" "Compliance"
_add_suite "a0000018-0018-0018-0018-000000000018" "Disaster Recovery"

# Failed suites (7)
_add_suite "a0000019-0019-0019-0019-000000000019" "Load Testing"
_add_suite "a0000020-0020-0020-0020-000000000020" "Stress Testing"
_add_suite "a0000021-0021-0021-0021-000000000021" "Chaos Engineering"
_add_suite "a0000022-0022-0022-0022-000000000022" "Failover Testing"
_add_suite "a0000023-0023-0023-0023-000000000023" "Backup Validation"
_add_suite "a0000024-0024-0024-0024-000000000024" "Recovery Testing"
_add_suite "a0000025-0025-0025-0025-000000000025" "Encryption Validation"

# Never run suites (5)
_add_suite "a0000026-0026-0026-0026-000000000026" "New Feature Tests"
_add_suite "a0000027-0027-0027-0027-000000000027" "Experimental"
_add_suite "a0000028-0028-0028-0028-000000000028" "Beta Features"
_add_suite "a0000029-0029-0029-0029-000000000029" "Alpha Testing"
_add_suite "a0000030-0030-0030-0030-000000000030" "Upcoming Features"

# Create executions to set suite statuses (using valid UUIDs for exec IDs)
# Passed suites
_add_exec "e0000001-0001-0001-0001-000000000001" "a0000001-0001-0001-0001-000000000001" "passed" 100 "$(_ts)" 5 5 "suite"
_add_exec "e0000002-0002-0002-0002-000000000002" "a0000002-0002-0002-0002-000000000002" "passed" 100 "$(_ts)" 3 3 "suite"
_add_exec "e0000003-0003-0003-0003-000000000003" "a0000003-0003-0003-0003-000000000003" "passed" 100 "$(_ts)" 8 8 "suite"
_add_exec "e0000004-0004-0004-0004-000000000004" "a0000004-0004-0004-0004-000000000004" "passed" 100 "$(_ts)" 12 12 "suite"
_add_exec "e0000005-0005-0005-0005-000000000005" "a0000005-0005-0005-0005-000000000005" "passed" 100 "$(_ts)" 6 6 "suite"
_add_exec "e0000006-0006-0006-0006-000000000006" "a0000006-0006-0006-0006-000000000006" "passed" 100 "$(_ts)" 4 4 "suite"
_add_exec "e0000007-0007-0007-0007-000000000007" "a0000007-0007-0007-0007-000000000007" "passed" 100 "$(_ts)" 10 10 "suite"
_add_exec "e0000008-0008-0008-0008-000000000008" "a0000008-0008-0008-0008-000000000008" "passed" 100 "$(_ts)" 7 7 "suite"
_add_exec "e0000009-0009-0009-0009-000000000009" "a0000009-0009-0009-0009-000000000009" "passed" 100 "$(_ts)" 5 5 "suite"
_add_exec "e0000010-0010-0010-0010-000000000010" "a0000010-0010-0010-0010-000000000010" "passed" 100 "$(_ts)" 3 3 "suite"
_add_exec "e0000011-0011-0011-0011-000000000011" "a0000011-0011-0011-0011-000000000011" "passed" 100 "$(_ts)" 4 4 "suite"
_add_exec "e0000012-0012-0012-0012-000000000012" "a0000012-0012-0012-0012-000000000012" "passed" 100 "$(_ts)" 6 6 "suite"
_add_exec "e0000013-0013-0013-0013-000000000013" "a0000013-0013-0013-0013-000000000013" "passed" 100 "$(_ts)" 8 8 "suite"
_add_exec "e0000014-0014-0014-0014-000000000014" "a0000014-0014-0014-0014-000000000014" "passed" 100 "$(_ts)" 5 5 "suite"
_add_exec "e0000015-0015-0015-0015-000000000015" "a0000015-0015-0015-0015-000000000015" "passed" 100 "$(_ts)" 4 4 "suite"
_add_exec "e0000016-0016-0016-0016-000000000016" "a0000016-0016-0016-0016-000000000016" "passed" 100 "$(_ts)" 9 9 "suite"
_add_exec "e0000017-0017-0017-0017-000000000017" "a0000017-0017-0017-0017-000000000017" "passed" 100 "$(_ts)" 6 6 "suite"
_add_exec "e0000018-0018-0018-0018-000000000018" "a0000018-0018-0018-0018-000000000018" "passed" 100 "$(_ts)" 7 7 "suite"

# Failed suites
_add_exec "e0000019-0019-0019-0019-000000000019" "a0000019-0019-0019-0019-000000000019" "failed" 100 "$(_ts)" 15 15 "suite"
_add_exec "e0000020-0020-0020-0020-000000000020" "a0000020-0020-0020-0020-000000000020" "failed" 100 "$(_ts)" 10 10 "suite"
_add_exec "e0000021-0021-0021-0021-000000000021" "a0000021-0021-0021-0021-000000000021" "failed" 100 "$(_ts)" 8 8 "suite"
_add_exec "e0000022-0022-0022-0022-000000000022" "a0000022-0022-0022-0022-000000000022" "failed" 100 "$(_ts)" 5 5 "suite"
_add_exec "e0000023-0023-0023-0023-000000000023" "a0000023-0023-0023-0023-000000000023" "failed" 100 "$(_ts)" 6 6 "suite"
_add_exec "e0000024-0024-0024-0024-000000000024" "a0000024-0024-0024-0024-000000000024" "failed" 100 "$(_ts)" 4 4 "suite"
_add_exec "e0000025-0025-0025-0025-000000000025" "a0000025-0025-0025-0025-000000000025" "failed" 100 "$(_ts)" 7 7 "suite"

# Never run suites: 26-30 (no executions created)

echo "V-LIST-07 seeded: 30 suites, 8 tests, 25 executions (18 passed, 7 failed, 5 never run)"
