# V-TESTS-ARTIFACT-GATES: Tests-Page Gates over Session Artifacts

Verify the tests-page session-teardown gates against a workbench session
holding ephemeral artifacts: the New Test gate warns on a
clean-but-executed session and clears it on discard, the Open-in-Workbench
switch dialog carries the artifact-loss callout, and the running-session
blocker never warns.

## Prerequisites

- Backend running on the worker's backend port.
- Frontend running on the worker's frontend port.
- No pre-seeded fixtures; every test imports its own via `POST /tests`
  (unique names) and validates with zero errors before running.

## Fixtures (built inline by the spec)

- `Gate Artifacts` - two File I/O writes (`artifact://report.json`,
  `artifact://output/data.json`); runs to `passed` in the workbench.
- `Gate Target` - a single Log test used as the row clicked for the
  switch gesture.
- `Gate Running` - a File I/O write followed by a 15s Delay so the
  session is RUNNING while already holding an artifact.

## Steps

1. New Test: run `Gate Artifacts` to terminal, go to `/tests`, click New Test;
   confirm through `Reset & Create Test`.
2. New Test, zero path: with no session, click New Test.
3. Switch: run `Gate Artifacts` to terminal, click the `Gate Target` row;
   cancel via `View Pending Workflow`.
4. Switch blocker: run `Gate Running`, navigate to `/tests` while it is
   running, click New Test; cancel.

## Validation

- **Step 1:** The switch dialog opens AT `/tests` with the `Active
  Execution State` title and the exact plural callout copy; `Reset &
  Create Test` opens the New Test form dialog and
  `GET /workbench/session` returns null data (session cleared).
- **Step 2:** The New Test form dialog opens directly; no switch dialog.
- **Step 3:** The switch dialog shows the callout and `Reset & Open New`;
  the cancel path leaves both artifacts in
  `GET /workbench/session/artifacts`.
- **Step 4:** The blocker dialog reads `Test is Running`, offers Cancel +
  `Go to Workbench`, and contains NO artifact-loss callout even though the
  running session holds an artifact.
