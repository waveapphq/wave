# V-EXEC-01: Suite Execution Detail View

Short description:
Renders the shared Execution Detail view for a terminal Suite execution. Asserts the header, EXECUTION INFO panel (Status, Totals, Started, Duration, Triggered, Environment), TAGS & DESCRIPTION section, Components table with the suite's test rows, and Console visibility.

Pre-requisites:
- Backend running on port 8000 with admin API enabled (`WAVE_ADMIN_ALLOWED=true`).
- Frontend running on port 3000.
- `01-seed.sh` executed (seeds 1 suite, 3 tests, 1 environment, 1 passed suite execution).

Execution steps:
1. Navigate to `/executions/d0000001-0000-0000-0000-000000000001`.
2. Wait for `[data-testid="execution-detail-page"]` to be visible.
3. Observe the DetailHeader name.
4. Confirm EXECUTION INFO section and its rows render.
5. Confirm the Components table lists the suite's tests.
6. Confirm the Console panel is visible.
7. Confirm the Terminal-state toolbar: Re-run + Export + Delete (no Stop / View Running).

Validation criteria:
- DetailHeader shows "Authentication Suite".
- EXECUTION INFO rows: Status = Passed, Started / Duration / Triggered / Environment = "Local", Totals with colored numbers.
- Tags & Description section renders distinct from Execution Info.
- Components table has rows for Login Flow, User Profile Update, Password Reset.
- Toolbar renders Re-run / Export / Delete; no Stop or View Running buttons.
- Console panel `[data-testid="execution-console"]` visible.
