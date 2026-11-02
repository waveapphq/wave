# Debug Step / Repeat / Skip-Routing Functional Tests

Functional E2E coverage for Step Over / Step Into / Repeat Step / Skip Block
routing. Drives a real workbench debug session for
each scenario and asserts on engine-side outcomes (node statuses, console
markers, terminal session state).

## Prerequisites

- Backend running on the worker's backend port
- Frontend running on the worker's frontend port
- Compose stack `http-echo` service reachable (brought up by the CI / targeted runner)
- Shared E2E environment present (handled by `ensureEnvironment` at test start)

## Fixtures

- `fixture-step-loop.json` - For-Loop count=3 with body Log `f'iter-{i}'`
  and an after-loop Log. Shared between the Step Over and Step Into specs.
- `fixture-repeat-step.json` - Try-Catch wrapping a flaky HTTP plugin that
  hits the `http-echo` stateful `/timeout` endpoint. The first request
  times out (HTTP plugin raises TimeoutError) and the endpoint is disarmed
  for the retry, so the second request returns instantly. Then-egress logs
  `tc-passed`; catch-egress logs `tc-caught`.
- `fixture-skip-routing.json` - For-Loop with body Log `inside-body` and an
  after-loop Log. Used to verify single-egress cascade-skip routing.
- `fixture-skip-blocked.json` - Two-branch If-Else with branch_if Log `T`
  and branch_else Log `F`. Used to verify Skip Block is rejected on a
  diverging parent at both the API and UI layers.

## Steps

Each spec runs a single self-contained scenario:

1. Import its fixture via `POST /tests` and validate via
   `GET /tests/{id}/validate` (zero errors required).
2. Open `/workbench?editTest=<id>` and toggle the relevant breakpoint /
   debug option.
3. Click `Debug` to start a debug run.
4. Drive the Paused Toolbar verb under test (Step Over / Step Into / Repeat
   Step / Skip Block) and assert on the resulting pause state.
5. `Continue` to terminal where appropriate.

## Validation

- Engine reaches the expected pause node (`data-paused="true"`) and pause
  reason (Console line `⏸ Paused at <Name> (<reason>)`).
- Per-node execution status (`data-execution-status`) is correct for the
  scenario (e.g. body skipped after Skip Block; HTTP success after a
  successful Repeat).
- Console contains the expected logs (e.g. `iter-0`/`iter-1`/`iter-2` after
  Step Over, no `inside-body` after a cascade-skip, no `tc-caught` when
  final-attempt-wins routes through `then`).
- Skip-blocked spec asserts the API returns 409 with the anchored message
  `^Cannot skip branching block 'if-else': step into a branch and skip a
  leaf instead$` and that the Paused Toolbar Skip Block button has
  `aria-disabled="true"` plus the matching `title` tooltip.

## V-DEBUG-PAUSED-TOOLBAR-WRAP

`v-debug-paused-toolbar-wrap-functional.spec.ts` - the paused toolbar keeps every button label whole at any
window width (REQ-3.2.1.3). No fixture file: the spec builds a Test of two Log Blocks in code.

### Prerequisites

- The same stack as above; no `http-echo` call.

### Steps

1. Seed the two-Log Test via `POST /tests` (zero validation errors) and open it at a 1400px wide window.
2. Pick the shared environment, turn on "pause on first" and start a Debug run; it pauses on the first Log.
3. Measure the toolbar, its buttons and the canvas top at 1400px.
4. Widen the window to 1920px and measure again.
5. Continue to the end.

### Validation

- 1400px: every paused button is on screen with its label on one line; the buttons that do not fit move
  whole to a second row, each row ends at the right edge of the button group, no button is cut off, and
  the canvas starts below the taller toolbar.
- 1920px: the toolbar is one 48px row with every button on the same line, and the canvas moves back up by
  exactly the height the toolbar lost.
- The run is still paused on the first Log; Continue finishes it `passed` with the second Log `success`.
