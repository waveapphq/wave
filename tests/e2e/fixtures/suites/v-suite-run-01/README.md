# V-SUITE-RUN-01: Run button + Run dialog on Suite Detail

Verify the Run affordance on the suite detail page and the RunDialog it opens.

## Prerequisites

```bash
./tests/e2e/scripts/reset.sh
./tests/e2e/fixtures/suites/v-suite-run-01/01-seed.sh
```

## Steps

1. Open http://localhost:3000/suites/c0000031-0001-0001-0001-000000000001
2. Click the primary Run button in the detail header
3. Inspect the Run dialog (environment list, tests list, cancel)

## Validation

- **Run button:** `[data-testid="suite-run-btn"]` visible in the header
- **Dialog opens:** `[data-testid="run-dialog-content"]` visible after click
- **Environment list:** seeded "Local" env visible inside `[data-testid="all-environments"]`
- **Tests list:** select-all row plus 3 `run-dialog-test-item` rows (one per seeded test)
- **Cancel:** dialog closes; URL unchanged
