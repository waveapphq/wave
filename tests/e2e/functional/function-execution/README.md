# Function Execution Functional Tests

Five Playwright functional tests covering REQ-3.2.1.1 (Function variant of
normal execution) and how Halt, a scope-fail Assert and Try/Catch propagate
across the Function boundary.

| Spec | Anchor |
|------|--------|
| `v-canvas-fn-exec-01.spec.ts` | REQ-3.2.1.1 - Local Function inside a Test runs end-to-end; inner Log surfaces in WebSocket panel. |
| `v-canvas-fn-run-scoped-01.spec.ts` | REQ-3.2.1.1 - drilled-in scoped invocation (missing/unknown id rejection, `SCOPED_RUN_ADVISORY` warning, `scoped_result` payload). |
| `v-canvas-fn-halt-01.spec.ts` | `Halt(scope=test)` inside Function stops parent flow. |
| `v-canvas-fn-assert-scope-fail-01.spec.ts` | Inner split `Assert(fail_current_scope=True)` marks the Function body failed; the Function reports failed, the parent flow stops there (sibling-after never runs), session ends `failed`. |
| `v-canvas-fn-assert-in-trycatch-01.spec.ts` | Try/Catch wrapping a Function whose body a split Assert marked failed catches the failed Function: catch runs, sibling-after runs, session ends `passed`. |

## Prerequisites

- Backend running on port 8000 (or `WAVE_E2E_BACKEND_PORT`)
- Frontend running on port 3000 (or `WAVE_E2E_FRONTEND_PORT`)
- No external seed script - each spec self-seeds via `POST /tests` using its
  matching `fixture-*.json`.

## Steps

1. Import the spec's fixture JSON via `POST /tests`.
2. `v-canvas-fn-exec-01`: open `/workbench?editTest={id}` and Run from the
   workbench Run button. The other specs start the run via `POST /workbench/run`.
3. Poll `GET /workbench/{id}/status` for terminal status.
4. Halt / scope-fail / Try/Catch specs: read per-block states from
   `GET /workbench/session` (the status route does not return them).

## Validation

Each spec defines its own pass criteria in the file docstring. Common shape:

- Inner block_states match the expected per-node status (passed / failed / skipped).
- Final session `status` matches the test's expected outcome.
- For halt / scope-fail / try-catch tests: sibling-after the Function runs (or
  does not) according to the contract being pinned.
- For the scoped-run spec: the `warnings` array contains `SCOPED_RUN_ADVISORY`
  and the `scoped_result` field is present on the status payload.
