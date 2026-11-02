# V-DASH-05: Quick Actions Section

Verify the Quick Actions section renders the three common workflow shortcuts.

## Prerequisites

```bash
./tests/e2e/scripts/reset.sh
./tests/e2e/fixtures/dashboard/v-dash-05/01-seed.sh
```

## Steps

1. Open http://localhost:3000/dashboard
   - **Validate:** 3 actions: New Test, Run Regression, View Reports

## Validation

- **Actions:** 3 (New Test, Run Regression, View Reports)
- **Layout:** Horizontal row
- **Button format:** Title + description text
