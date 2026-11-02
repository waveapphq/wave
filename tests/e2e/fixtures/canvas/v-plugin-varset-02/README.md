# V-PLUGIN-VARSET-02: Variable Setter Functional Tests

Functional tests for the Variable Setter control - verifies that variables can be added, edited, typed, and persisted correctly.

## Prerequisites

Backend seeding required - creates a test with a Variable Setter workflow node and multi-scope variables.

## Seeded Data

- **Test**: "Variable Setter Functional Test" with workflow: Start -> VarSetter -> End
- **Variables** (7 total across 3 scopes):
  - Regression: `reg_env` (string), `reg_debug` (boolean)
  - Suite: `suite_timeout` (integer), `suite_retries` (integer)
  - Test: `test_name` (string), `test_count` (integer), `test_ratio` (float)

## Steps

1. Run seed script to create test with workflow and variables
2. Open workbench with `?editTest=a0020e00-0001-0001-0001-000000000001`
3. Select the Variable Setter node and open config modal
4. Exercise all functional scenarios

## Validation

- **Add variables**: New variable rows accept name, type, value
- **All types**: string, integer, float, boolean, array, map, table
- **Expression mode**: Per-variable expression toggle
- **Autocomplete**: Shows existing variables with scope labels
- **Shadowing**: Amber warning for suite/regression-scoped variables
- **Type locking**: Existing variable type is locked (grayed out)
- **Persistence**: Variables survive save/reopen cycle
- **Delete**: Rows can be removed
