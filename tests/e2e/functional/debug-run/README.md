# Debug Run Functional Tests

Functional E2E coverage for the debug machinery: breakpoints,
pause_on_first_block, pause_on_errors, Continue, Skip Block (as step), Stop
from paused, nested-body pauses in Try/Catch, and reload-persistence semantics.

## Prerequisites

- Backend running on the worker's backend port
- Frontend running on the worker's frontend port
- Shared E2E environment created (handled by `ensureEnvironment` at test start)

## Fixtures

- `fixture-flat.json` - linear chain of 5 Log blocks (log-1 .. log-5). Used by
  `v-dbg-flat-functional` and `v-dbg-persistence-functional`.
- `fixture-trycatch.json` - Try/Catch with a Log then a failing Log in the try
  path, and a Log in the catch path. Used by `v-dbg-trycatch-functional`.

## Test files and scenarios

| File | Scenarios |
|------|-----------|
| `v-dbg-flat-functional.spec.ts` | (a) two breakpoints + Continue, (b) pause_on_first_block, (d)/(i) Skip Block as step, (e) Stop (Immediate + Finalize), (f) Run ignores breakpoints, (j) Stop preserves prior terminal states, (k) Continue race, (l) JSON-serializable response (implicit) |
| `v-dbg-trycatch-functional.spec.ts` | (c)/(h) pause_on_errors on failing nested try-body node, (g) breakpoint on nested try-body node |
| `v-dbg-persistence-functional.spec.ts` | (m) debug options persist per browser, breakpoints do NOT persist across reload |

## Validation

- Engine reaches the expected terminal state (`passed`, `stopped`).
- Node execution statuses match the scenario (e.g. log-3 stopped, prior nodes success).
- Console log lines include the paused strings:
  - `⏸ Paused at <Name> (breakpoint)`
  - `⏸ Paused at <Name> (first_block)`
  - `⏸ Paused at <Name> (step)`
  - `⏸ Paused on error at <Name>: <ExceptionClass>: <message>`
