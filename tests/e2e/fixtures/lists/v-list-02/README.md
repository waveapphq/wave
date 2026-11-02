# V-LIST-02: Tests List Empty

Verify tests list displays empty state with call-to-action when no tests exist.

## Prerequisites

```bash
./tests/e2e/scripts/reset.sh
# No seeding needed - empty state
```

## Steps

1. Open http://localhost:3000/tests

## Validation

- **Page header:** "Tests" title with "+ New Test" button visible
- **Empty state icon:** Test tube icon (entity-specific per LIST-6)
- **Empty state title:** "No tests yet"
- **Empty state description:** Encouraging message about creating first test
- **CTA button:** "Create Your First Test" with primary (blue) styling
- **Filters:** Visible but muted/disabled
- **Mass Action:** Not visible in empty state
- **Columns:** Button visible
- **Table:** No rows visible
