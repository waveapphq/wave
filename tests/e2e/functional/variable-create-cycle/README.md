# V-VAR-CREATE-CYCLE-FUNCTIONAL: Create-Variable Cycle Gate

Verify that the Add Variable dialog surfaces a cycle-path error inline,
disables the Create button while the cycle is present, clears the error
when the expression is corrected, and lets the create succeed.

## Prerequisites

- Backend running on the worker's backend port.
- Frontend running on the worker's frontend port.
- No fixtures or pre-seeded data required.

## Fixtures

None.

## Steps

1. Navigate to `/workbench` (Draft Workflow). Expand the Variable Manager.
2. Click the Add button to open the Create Variable dialog.
3. Fill the Name field with `selfvar` and choose Type = Integer.
4. Toggle expression mode and type `selfvar + 1` in the expression field.
   Press Tab to blur.
5. Edit the expression to `1 + 1`.
6. Click Create.

## Validation

- Step 4: The inline `expression-cycle-error` element is visible inside
  `expression-field-container` with `role="alert"` and reads exactly:
  `Circular reference detected for variable 'selfvar': selfvar -> selfvar`.
  The Create button is disabled.
- Step 5: As soon as the expression changes, the inline error disappears
  and Create re-enables.
- Step 6: The dialog closes and the variable manager shows a row labeled
  "Variable selfvar".
