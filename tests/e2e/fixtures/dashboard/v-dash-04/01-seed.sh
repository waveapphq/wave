#!/bin/bash
# V-DASH-04: Seeds executions with all variations for comprehensive testing
# Covers: running/passed/failed × test/suite/regression with real relationships
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
REG_HOTFIX_2_0_1="187314a0-c734-49f7-a670-37dd84ec5848"
# Suites
SUITE_GUI_SMOKE="a1f9c9ad-2aee-4167-8163-c6fed2c5ad31"
SUITE_HEALTHCHECKS="21077fbf-651a-4516-998f-531d30852719"
SUITE_TLS="efd0bce7-99f4-4e1a-8b1c-60738522e4a8"
SUITE_PROGRESS="afe9e8d3-2dc0-4bde-a895-02178538406a"
# Tests
TEST_API_HEALTH="b4af517f-2ee5-4503-826f-e0926a42016b"
TEST_LOGIN="7d139ea1-8fe8-4999-af31-275e7bb2b877"
TEST_TLS_CERT="39ba9cac-66d9-47d9-859b-c4dd5c0a33bc"
# Executions
EXEC_TEST_RUN="c24a965d-cffa-4abd-856e-424a0a300d4c"
EXEC_TEST_PASS="d5228b23-1389-4be0-9d82-2ddcb9795b0e"
EXEC_TEST_FAIL="bcaa1d97-b6b8-43be-a444-015fbc4b8b28"
EXEC_SUITE_RUN="1aea7e63-3795-4bd4-a3b4-ab45162362cf"
EXEC_SUITE_PASS="80222e98-2110-4eb7-883e-9795038b7788"
EXEC_SUITE_FAIL="894f5643-375d-40f2-821f-bb3f69bcee37"
EXEC_REG_RUN="a8c6d7e4-ed0a-43ae-bda3-96cef5c3feb6"
EXEC_REG_PASS="4b45e354-6046-4d9e-ac09-f1ee8bfed760"
EXEC_REG_FAIL="7a7708e0-e9c0-4de4-a35d-58aaedc9ba61"
EXEC_PROGRESS="ac1f4f5d-ebec-4707-97ec-a2a03523d4c3"

# Regressions (create first so suites can reference them)
_add_regression "$REG_V2_RELEASE" "v2.0.0 Release"
_add_regression "$REG_WAVE_25_12" "WAVE 25.12"
_add_regression "$REG_HOTFIX_2_0_1" "Hotfix 2.0.1"

# Suites for suite executions (some linked to regressions, some unassigned)
# Format: _add_suite <id> <name> [parent_regression_name] [tests_json_array]
_add_suite "$SUITE_GUI_SMOKE" "GUI Smoke Tests" "WAVE 25.12"
_add_suite "$SUITE_HEALTHCHECKS" "Health Checks" "" "[\"$TEST_API_HEALTH\"]"
_add_suite "$SUITE_TLS" "TLS Validation" "v2.0.0 Release" "[\"$TEST_TLS_CERT\"]"
_add_suite "$SUITE_PROGRESS" "Progress Test Suite"  # Unassigned

# Tests for test executions (some linked to suites, some unassigned)
# Format: _add_test <id> <name> [parent_suite_name]
_add_test "$TEST_API_HEALTH" "API Health Check" "Health Checks"
_add_test "$TEST_LOGIN" "Login Flow Test"  # Unassigned
_add_test "$TEST_TLS_CERT" "TLS Certificate Validation" "TLS Validation"

# Computed counts:
# Suites:
#   GUI Smoke Tests: 0 tests
#   Health Checks: 1 test (API Health Check)
#   TLS Validation: 1 test (TLS Certificate Validation)
#   Progress Test Suite: 0 tests
#
# Regressions:
#   v2.0.0 Release: TLS Validation (1) = 1 test
#   WAVE 25.12: GUI Smoke Tests (0) = 0 tests
#   Hotfix 2.0.1: 0 tests (no suites assigned)

# Executions: All combinations of status × entity type
# _add_exec <id> <entity_id> <status> <progress> [timestamp] [tests_total] [tests_selected] [entity_type]

# Test executions (no "tests selected" shown)
_add_exec "$EXEC_TEST_RUN" "$TEST_API_HEALTH" "running" 60 "$(_ts)" 1 1 "test"
_add_exec "$EXEC_TEST_PASS" "$TEST_LOGIN" "passed" 100 "$(_ts)" 1 1 "test"
_add_exec "$EXEC_TEST_FAIL" "$TEST_TLS_CERT" "failed" 100 "$(_ts)" 1 1 "test"

# Suite executions (shows "tests done"). Fractional progress value here
# exercises the 2-decimal rounding path: 33.33333... -> "33.33%" in the UI.
_add_exec "$EXEC_SUITE_RUN" "$SUITE_HEALTHCHECKS" "running" 33.33333333 "$(_ts)" 25 20 "suite"
_add_exec "$EXEC_SUITE_PASS" "$SUITE_TLS" "passed" 100 "$(_ts)" 15 15 "suite"
_add_exec "$EXEC_SUITE_FAIL" "$SUITE_GUI_SMOKE" "failed" 80 "$(_ts)" 30 30 "suite"

# Regression executions (shows "tests selected")
_add_exec "$EXEC_REG_RUN" "$REG_WAVE_25_12" "running" 25 "$(_ts)" 150 120 "regression"
_add_exec "$EXEC_REG_PASS" "$REG_V2_RELEASE" "passed" 100 "$(_ts)" 200 200 "regression"
_add_exec "$EXEC_REG_FAIL" "$REG_HOTFIX_2_0_1" "failed" 50 "$(_ts)" 50 40 "regression"

# Progress update test execution (for V-DASH-04-S7 progress update test)
_add_exec "$EXEC_PROGRESS" "$SUITE_PROGRESS" "running" 25 "$(_ts)" 10 10 "suite"

echo "V-DASH-04 seeded: 3 tests, 4 suites, 3 regressions, 10 executions (all variations)"
