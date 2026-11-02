# V-LIST-03: List Loading State

Verify tests list displays loading skeleton during data fetch.

## Prerequisites

```bash
# Test intercepts API to delay response - no seeding needed
```

## Steps

1. Open http://localhost:3000/tests (with API delay intercepted)

## Validation

- **Page header:** "Tests" title visible during loading
- **Skeleton rows (LIST-4):** 9 skeleton rows filling viewport
- **Skeleton bars:** Varying widths for visual variety
- **Filters:** Visible but disabled during loading
- **Pagination:** Skeleton or disabled state
- **Table headers:** Column headers visible (not skeleton)
- **Layout stability:** No flickering or layout shift when data loads
