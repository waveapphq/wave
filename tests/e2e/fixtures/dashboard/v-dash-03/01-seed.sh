#!/bin/bash
# V-DASH-03: Seeds 22 recent activity items for scroll testing
# Mix of tests, suites, and regressions with real relationships
set -e
source "$(dirname "$0")/../../../scripts/lib.sh"

_admin_on
trap _admin_off EXIT

# Reset existing data
_reset

# Pre-defined UUIDs for entities (valid UUID format required)
# Regressions
REG_V2_RELEASE="86ecc0da-9eae-46d8-b8df-4c23c7def5d5"
REG_WAVE_25_12="592a4f9b-7fc7-4dfa-a076-75883d3ccebf"
REG_WAVE_25_11="dac52cfb-bc37-4234-a4cf-445080ee3126"
REG_HOTFIX_2_0_1="187314a0-c734-49f7-a670-37dd84ec5848"
REG_SPRINT_42="c5d9081f-25e8-41a1-abde-d1fd1cd9474a"
REG_QUARTERLY_Q4="57dd8a09-14a8-467f-ba9c-c11817c730f5"
# Suites
SUITE_API_INT="7d44429d-14e9-4dfd-8cb6-a0a27c6d21fc"
SUITE_GUI_SMOKE="a1f9c9ad-2aee-4167-8163-c6fed2c5ad31"
SUITE_HEALTHCHECKS="21077fbf-651a-4516-998f-531d30852719"
SUITE_TLS="efd0bce7-99f4-4e1a-8b1c-60738522e4a8"
SUITE_AUTH="bfcf26fb-c0f5-43aa-9f58-37cd9f2cb851"
SUITE_PERF="474af62b-b830-47fb-a3f4-0dd5694a7836"
SUITE_SECURITY="dd9eae5c-a37c-4649-9d3f-d5d24e5309ac"
SUITE_DATA_INT="4d07ed73-6711-41e3-91a1-b68f0695ea74"
# Tests
TEST_API_HEALTH="b4af517f-2ee5-4503-826f-e0926a42016b"
TEST_DB_CONN="44993f64-a4d4-47d0-8bee-342421dd110b"
TEST_LOGIN="7d139ea1-8fe8-4999-af31-275e7bb2b877"
TEST_OPENSEARCH="61e8be2a-2df3-4d7c-a594-9ed9c305197f"
TEST_TLS_CERT="39ba9cac-66d9-47d9-859b-c4dd5c0a33bc"
TEST_USER_REG="5271459c-7be6-427a-a193-1c7c03fd55c0"
TEST_PW_RESET="3f1f85ae-46a1-4f82-9fef-1eb7102ee7ed"
TEST_SESSION="0e64c6c7-b3c7-4d7e-a168-7154877909ce"

# Regressions (6 items) - create first so suites can reference them
_add_regression "$REG_V2_RELEASE" "v2.0.0 Release"
_add_regression "$REG_WAVE_25_12" "WAVE 25.12"
_add_regression "$REG_WAVE_25_11" "WAVE 25.11"
_add_regression "$REG_HOTFIX_2_0_1" "Hotfix 2.0.1"
_add_regression "$REG_SPRINT_42" "Sprint 42"
_add_regression "$REG_QUARTERLY_Q4" "Quarterly Q4"

# Suites (8 items) - some linked to regressions, some unassigned
# Format: _add_suite <id> <name> [parent_regression_name] [tests_json_array]
_add_suite "$SUITE_API_INT" "API Integration Suite" "v2.0.0 Release"
_add_suite "$SUITE_GUI_SMOKE" "GUI Smoke Tests" "WAVE 25.12" "[\"$TEST_LOGIN\"]"
_add_suite "$SUITE_HEALTHCHECKS" "Health Checks" "WAVE 25.12" "[\"$TEST_API_HEALTH\"]"
_add_suite "$SUITE_TLS" "TLS Validation" "v2.0.0 Release" "[\"$TEST_TLS_CERT\"]"
_add_suite "$SUITE_AUTH" "Authentication Suite" "WAVE 25.11" "[\"$TEST_USER_REG\",\"$TEST_SESSION\"]"
_add_suite "$SUITE_PERF" "Performance Tests"  # Unassigned
_add_suite "$SUITE_SECURITY" "Security Scans"  # Unassigned
_add_suite "$SUITE_DATA_INT" "Data Integrity" "Quarterly Q4" "[\"$TEST_DB_CONN\"]"

# Tests (8 items) - some linked to suites, some unassigned
# Format: _add_test <id> <name> [parent_suite_name]
_add_test "$TEST_API_HEALTH" "API Health Check" "Health Checks"
_add_test "$TEST_DB_CONN" "Database Connection Pool" "Data Integrity"
_add_test "$TEST_LOGIN" "Login Flow Test" "GUI Smoke Tests"
_add_test "$TEST_OPENSEARCH" "OpenSearch Index Rotation"  # Unassigned
_add_test "$TEST_TLS_CERT" "TLS Certificate Validation" "TLS Validation"
_add_test "$TEST_USER_REG" "User Registration" "Authentication Suite"
_add_test "$TEST_PW_RESET" "Password Reset"  # Unassigned
_add_test "$TEST_SESSION" "Session Timeout" "Authentication Suite"

# Computed counts:
# Suites:
#   API Integration Suite: 0 tests
#   GUI Smoke Tests: 1 test (Login Flow Test)
#   Health Checks: 1 test (API Health Check)
#   TLS Validation: 1 test (TLS Certificate Validation)
#   Authentication Suite: 2 tests (User Registration, Session Timeout)
#   Performance Tests: 0 tests (unassigned suite)
#   Security Scans: 0 tests (unassigned suite)
#   Data Integrity: 1 test (Database Connection Pool)
#
# Regressions:
#   v2.0.0 Release: API Integration Suite (0) + TLS Validation (1) = 1 test
#   WAVE 25.12: GUI Smoke Tests (1) + Health Checks (1) = 2 tests
#   WAVE 25.11: Authentication Suite (2) = 2 tests
#   Hotfix 2.0.1: 0 tests (no suites assigned)
#   Sprint 42: 0 tests (no suites assigned)
#   Quarterly Q4: Data Integrity (1) = 1 test

echo "V-DASH-03 seeded: 8 tests, 8 suites, 6 regressions (22 total activity items)"
