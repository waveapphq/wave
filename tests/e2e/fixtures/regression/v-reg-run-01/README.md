# V-REG-RUN-01: Run button + Run dialog on Regression Detail

Verify the Run affordance on the regression detail page and the RunDialog it opens,
including the duplicate-test badge for a test that appears in more than one suite.

## Prerequisites

```bash
./tests/e2e/scripts/reset.sh
./tests/e2e/fixtures/regression/v-reg-run-01/01-seed.sh
```

## Steps

1. Open http://localhost:3000/regressions/a0000041-0000-0000-0000-000000000001
2. Click the primary Run button in the detail header
3. Expand one of the suite groups in the dialog
4. Inspect the duplicate badge on the shared test row

## Validation

- **Run button:** `[data-testid="regression-run-btn"]` visible in the header
- **Dialog opens:** `[data-testid="run-dialog-content"]` visible after click
- **Environment list:** seeded "Local" env visible inside `[data-testid="all-environments"]`
- **Suite groups:** two `[data-testid^="suite-group-"]` rows (Auth Suite, Checkout Suite)
- **Suite expansion:** clicking a suite header reveals its `run-dialog-test-item` children
- **Duplicate badge:** `[data-testid="duplicate-test-badge"]` present on the shared test row; absent on suite-unique rows
- **Cancel:** dialog closes; URL unchanged
