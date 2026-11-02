# V-DASH-02: Dashboard Metric Cards

Verify dashboard displays 4 metric cards with correct counts and layout.

## Prerequisites

```bash
./tests/e2e/scripts/reset.sh
./tests/e2e/fixtures/dashboard/v-dash-02/01-seed.sh
```

## Steps

1. Open http://localhost:3000/dashboard

## Validation

- **Metrics row:** Tests=5, Suites=4, Regressions=2, Executions(24h)=4
- **Card layout:** 4 cards in horizontal row (left to right)
- **Tests/Suites/Regressions:** Count only (no subtitle)
- **Executions (24h):** Count + running/passed/failed subtitle
- **24h filter:** Old execution (>24h) excluded from count
