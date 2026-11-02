# V-PLUGIN-VARSET-03: Variable Watcher Live Update

Verify the Variable Watcher integration seam - when a Variable Setter modifies variables during execution, the Variable Manager Watch List shows updated runtime values via WebSocket push.

## Prerequisites

Backend seeding required - creates a test with a pre-configured Variable Setter that changes two watched variables.

## Seeded Data

- **Test**: "Variable Watcher Live Update Test" with workflow: Start -> VarSetter (pre-configured) -> End
- **Variables** (2 at test scope):
  - `watch_str` (string): initial "original", setter changes to "updated by setter"
  - `watch_int` (integer): initial 0, setter changes to 99

## Steps

1. Run seed script to create test with pre-configured Variable Setter
2. Open workbench with `?editTest=a0030e00-0001-0001-0001-000000000001`
3. Expand Variable Manager panel
4. Watch both variables (click eye icon)
5. Run the workflow
6. Verify Watch List values update to reflect setter's changes

## Validation

- **Watch List populated**: Both variables appear in Watch List after clicking eye icon
- **Live update**: After workflow execution, Watch List shows "updated by setter" and "99"
- **Original vs runtime**: Values change from definition values to runtime values
