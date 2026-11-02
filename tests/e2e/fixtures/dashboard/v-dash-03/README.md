# V-DASH-03: Recent Activity Section

Verify Recent Activity section displays all entity types with scrolling.

## Prerequisites

```bash
./tests/e2e/scripts/reset.sh
./tests/e2e/fixtures/dashboard/v-dash-03/01-seed.sh
```

## Steps

1. Open http://localhost:3000/dashboard

## Validation

- **Section header:** "Recent Activity" visible
- **Activity items:** 22 items (8 tests, 8 suites, 6 regressions)
- **Item format:** Type icon, name, context line
- **Entity types:** All three types represented (test, suite, regression)
- **Scrolling:** Section scrolls when content exceeds visible area
