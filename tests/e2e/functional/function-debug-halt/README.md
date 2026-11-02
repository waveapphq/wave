# Function Debug + Halt Scope Functional Tests

Functional E2E coverage for step-debugging a Function as
a single-egress composite (REQ-3.2.1.3 / REQ-3.2.1.4) and the function-scope
Halt (REQ-3.5.1.14). Each spec imports its fixture, validates it (zero
errors), then drives a real workbench run and asserts on engine-side outcomes.

## Prerequisites

- Backend + frontend running on the worker's ports
- Shared E2E environment present (handled by `ensureEnvironment` at test start)

## Fixtures

- `fixture-composite-debug.json` - a local `Function_1` (body A -> B) followed by
  an after-Log. Drives Step Over / Step Into / Skip Block / Repeat Step on the
  Function node.
- `fixture-halt-scopes.json` - `log-before -> FnPassed -> FnSkipped ->
  Try/Catch{ try: FnFailed, catch: log-caught } -> log-after`. FnPassed /
  FnSkipped / FnFailed each contain a function-scope `Halt` with status
  passed / skipped / failed.

## Steps

Each spec:

1. Import its fixture via `POST /tests` and validate via `POST
   /tests/{id}/validate` (zero errors required).
2. Open `/workbench?editTest=<id>`.
3. For step debugging: toggle a breakpoint on the Function node, `Debug`, then drive the
   Paused Toolbar verb under test. For Halt: `Run` to terminal.
4. Assert on console markers, node run-state badges, `data-paused` location,
   and the terminal session status.

## Validation

- **Step Over**: body markers `fn-A` + `fn-B` log atomically, engine
  re-pauses on the after-Log (`data-paused`), Function badge is success.
- **Step Into**: canvas auto-drills into the body, pauses on
  `inner-a` (`data-paused`) before it runs; Continue logs all markers, passes.
- **Skip Block**: body never runs, engine routes to the after-Log, the
  Function is marked `skipped` (a structural skip - no diverging 409).
- **Repeat Step**: each Repeat re-invokes the body (one more `fn-A`) and
  re-pauses in place on the Function node.
- **Halt**: session passes; FnPassed badge PASS, FnSkipped badge SKIP, FnFailed
  badge FAIL; the catch path (`halt-caught`) and the then-egress (`halt-after`)
  both run - the failure is caught, never draining past the Try/Catch.
