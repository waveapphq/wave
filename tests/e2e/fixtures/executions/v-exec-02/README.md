# V-EXEC-02: Regression Execution Detail View

Short description:
Renders the shared Execution Detail view for a terminal Regression execution. The Components table is hierarchical: suite parent rows collapsible with test children; collapsed by default.

Pre-requisites:
- Backend and frontend running; admin API enabled.
- `01-seed.sh` executed (seeds 1 regression, 2 suites, 4 tests, 1 environment, 1 passed regression execution).

Execution steps:
1. Navigate to `/executions/d0000002-0000-0000-0000-000000000002`.
2. Wait for `[data-testid="execution-detail-page"]` visible.
3. Confirm suite parent rows render and tests are hidden by default (collapsed).
4. Expand a suite and confirm its child tests render.

Validation criteria:
- DetailHeader shows "Nightly Regression".
- Components table shows both suite parent rows ("Auth Suite", "Checkout Suite").
- Child test rows (Login smoke, Logout smoke, Checkout Happy Path, Checkout Declined Card) are initially hidden.
- Expanding a suite reveals its tests.
- Toolbar shows Re-run / Export / Delete (terminal state).
- Environment shows "Local".
