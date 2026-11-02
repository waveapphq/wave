# V-LIST-04: List Error State

Verify tests list displays error state with retry capability when API fails.

## Prerequisites

```bash
# Test intercepts API to return error - no seeding needed
```

## Steps

1. Open http://localhost:3000/tests (with API error intercepted)

## Validation

- **Page header:** "Tests" title visible during error
- **Error icon (LIST-5):** Red warning triangle icon
- **Error title:** "Unable to load tests" or similar empathetic message
- **Error description:** "Something went wrong..." with empathetic tone
- **Retry button:** "Try Again" button visible and enabled
- **Retry action:** Clicking "Try Again" triggers API retry
- **Filters:** Visible but disabled during error
- **Columns button:** Visible but disabled
- **Table:** No rows visible, replaced by error state
