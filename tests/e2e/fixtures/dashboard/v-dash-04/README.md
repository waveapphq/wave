# V-DASH-04: Recent Executions Section

Verify Recent Executions section displays all execution variations with progress updates.

## Prerequisites

```bash
./tests/e2e/scripts/reset.sh
./tests/e2e/fixtures/dashboard/v-dash-04/01-seed.sh
```

## Steps

1. Open http://localhost:3000/dashboard

## Validation

- **Section header:** "Recent Executions" visible
- **Execution cards:** 10 cards covering all variations (3 test, 4 suite, 3 regression)
- **Entity types:** Test, Suite, Regression all present
- **Statuses:** Running, Passed, Failed all present
- **Test executions:** Status + time only (no "tests selected")
- **Suite/Regression:** Status + "X/Y tests selected"
- **Running:** Shows percentage (e.g., "45%")
- **Progress updates:** Changes reflected after reload

## Progress Update Test

```bash
# Update to 75%
./tests/e2e/fixtures/dashboard/v-dash-04/02-update.sh exec-progress-test 75 running

# Complete execution
./tests/e2e/fixtures/dashboard/v-dash-04/02-update.sh exec-progress-test 100 passed
```
