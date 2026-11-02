# V-TESTS-LIST-SWITCH-DIALOG-EXECUTED: Switch Dialog at the Tests List

End-to-end coverage for the switch-dialog gate at the tests-list boundary.
Clicking a different test row in the Tests list while the workbench holds a
clean-but-executed test (saved + terminal session) surfaces the switch dialog
AT `/tests`, before any navigation to `/workbench`.

## Prerequisites

- Backend running on the worker's backend port.
- Frontend running on the worker's frontend port.
- Shared E2E environment present (handled by `ensureEnvironment`).
- No external fixture file - the spec POSTs two inline single-Log fixtures.

## Steps

The spec runs two scenarios:

### Scenario 1: clean-but-executed workbench

1. Import Test A and Test B (single-Log fixtures).
2. Open Test A in the workbench, select the E2E environment, click Run.
3. Wait for the workflow status to reach a terminal value
   (`passed`/`failed`/`stopped`/`skipped`).
4. Confirm `toolbar-save-button` is disabled (test is clean - no edits).
5. Navigate to `/tests` via `page.goto`.
6. Click Test B's name cell.
7. Assert the switch-test-dialog is visible AND the URL is still `/tests`.
8. Assert the dialog title contains "Active Execution State".
9. Click "Reset & Open New".
10. Assert the URL becomes `/workbench?...editTest=<testBId>`.

### Scenario 2: idle-workbench sanity check

1. Import two new single-Log fixtures (no run is started).
2. Navigate to `/tests`.
3. Click a row.
4. Assert direct navigation to `/workbench?...editTest=<testId>` with no
   dialog rendered. Guards against over-correction (the gate must not
   surface the dialog for the truly-idle case).

## Validation

- **Scenario 1**: at the moment the dialog becomes visible the URL is
  still `/tests` (timing fix). The dialog title contains
  "Active Execution State" (executed-only branch). The "Reset & Open New"
  action navigates to `/workbench?editTest=<testBId>`.
- **Scenario 2**: no `switch-test-dialog` is rendered, and the URL flips
  directly to `/workbench?editTest=<testAId>`.
