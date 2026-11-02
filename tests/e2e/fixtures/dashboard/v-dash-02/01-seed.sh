#!/bin/bash
# V-DASH-02: Seeds populated dashboard data with varied executions
set -e
source "$(dirname "$0")/../../../scripts/lib.sh"

_admin_on
trap _admin_off EXIT

# Reset existing data
_reset

# Pre-defined UUIDs for entities (valid UUID format required)
REG_V2_RELEASE="86ecc0da-9eae-46d8-b8df-4c23c7def5d5"
REG_WAVE_25_12="592a4f9b-7fc7-4dfa-a076-75883d3ccebf"
SUITE_API_INT="7d44429d-14e9-4dfd-8cb6-a0a27c6d21fc"
SUITE_GUI_SMOKE="a1f9c9ad-2aee-4167-8163-c6fed2c5ad31"
SUITE_HEALTHCHECKS="21077fbf-651a-4516-998f-531d30852719"
SUITE_TLS="efd0bce7-99f4-4e1a-8b1c-60738522e4a8"
TEST_API_HEALTH="b4af517f-2ee5-4503-826f-e0926a42016b"
TEST_DB_CONN="44993f64-a4d4-47d0-8bee-342421dd110b"
TEST_LOGIN="7d139ea1-8fe8-4999-af31-275e7bb2b877"
TEST_OPENSEARCH="61e8be2a-2df3-4d7c-a594-9ed9c305197f"
TEST_TLS_CERT="39ba9cac-66d9-47d9-859b-c4dd5c0a33bc"
EXEC_REG_WAVE="26b9e8d2-3fd7-48f0-a3e0-4e0d9bf3a648"
EXEC_SUITE_HEALTH="10063ce4-776e-4a84-9fdd-52aa7a6894bb"
EXEC_SUITE_GUI="9d71ff35-7160-40a8-9e8b-a56c2bdcfdf4"
EXEC_SUITE_TLS="2bb954c1-ef55-4e52-ac85-33d7bb37fbb6"
EXEC_OLD_PASSED="a880b1d2-cd8f-4049-9f1c-effd078f2004"

# Regressions (create first so suites can reference them)
_add_regression "$REG_V2_RELEASE" "v2.0.0 Release"
_add_regression "$REG_WAVE_25_12" "WAVE 25.12"

# Suites (some linked to regressions, some unassigned)
# Format: _add_suite <id> <name> [parent_regression_name] [tests_json_array]
_add_suite "$SUITE_API_INT" "API Integration Suite" "v2.0.0 Release" "[\"$TEST_DB_CONN\"]"
_add_suite "$SUITE_GUI_SMOKE" "GUI Smoke Tests" "WAVE 25.12"
_add_suite "$SUITE_HEALTHCHECKS" "Health Checks" "" "[\"$TEST_API_HEALTH\"]"
_add_suite "$SUITE_TLS" "TLS Validation" "" "[\"$TEST_TLS_CERT\"]"

# Tests (some linked to suites, some unassigned)
# Format: _add_test <id> <name> [parent_suite_name]
_add_test "$TEST_API_HEALTH" "API Health Check" "Health Checks"
_add_test "$TEST_DB_CONN" "Database Connection Pool" "API Integration Suite"
_add_test "$TEST_LOGIN" "Login Flow Test"  # Unassigned
_add_test "$TEST_OPENSEARCH" "OpenSearch Index Rotation"  # Unassigned
_add_test "$TEST_TLS_CERT" "TLS Certificate Validation" "TLS Validation"

# Computed counts:
# Suites: API Integration Suite (1), GUI Smoke Tests (0), Health Checks (1), TLS Validation (1)
# Regressions:
#   v2.0.0 Release: API Integration Suite (1) = 1 test
#   WAVE 25.12: GUI Smoke Tests (0) = 0 tests

# Executions (4 recent + 1 old) with varied entity types and test counts
# _add_exec <id> <entity_id> <status> <progress> [timestamp] [tests_total] [tests_selected] [entity_type]

# Regression execution: running at 45%, 50 total tests, 40 selected
_add_exec "$EXEC_REG_WAVE" "$REG_WAVE_25_12" "running" 45 "$(_ts)" 50 40 "regression"

# Suite execution: running at 20%, 25 total tests, 20 selected
_add_exec "$EXEC_SUITE_HEALTH" "$SUITE_HEALTHCHECKS" "running" 20 "$(_ts)" 25 20 "suite"

# Suite execution: failed at 75%, 30 total tests, 30 selected
_add_exec "$EXEC_SUITE_GUI" "$SUITE_GUI_SMOKE" "failed" 75 "$(_ts)" 30 30 "suite"

# Suite execution: passed at 100%, 15 total tests, 15 selected
_add_exec "$EXEC_SUITE_TLS" "$SUITE_TLS" "passed" 100 "$(_ts)" 15 15 "suite"

# Old execution (>24h): passed, should be excluded from 24h metrics
_add_exec "$EXEC_OLD_PASSED" "$TEST_API_HEALTH" "passed" 100 "$(_ts_old)" 10 10 "test"

echo "V-DASH-02 seeded: 5 tests, 4 suites, 2 regressions, 5 executions (4 recent + 1 old)"
