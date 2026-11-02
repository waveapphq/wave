# V-RUNADHOC-FUNCTIONAL: Ad-Hoc Run / Debug End-to-End

Verify Run Current, Run from Here, and Debug from Here pin the engine to the
right node (or sub-tree) and that a dirty right-click run fires directly
against the in-memory body (run-current - no run-confirm dialog).

## Prerequisites

- Backend running on the worker's backend port
- Frontend running on the worker's frontend port
- Shared E2E environment present (handled by `ensureEnvironment` at test
  start)

## Fixtures

- `fixture.json` - Six chained Log plugins (`log-pre` → `log-step1` →
  `log-target` → `log-step3` → `log-step4` → `log-post`) plus a standalone
  Note annotation. Each Log emits a unique `adhoc-<name>` marker so
  Console assertions can prove exactly which subset of the chain ran.
- `fixture-stop.json` - A standalone 30s Delay (`delay-solo`) and a For loop
  (`for-adhoc`) whose body logs `adhoc-stop-body` then holds a second 30s
  Delay (`delay-body`). Long enough that an ad-hoc run can be stopped with a
  Block genuinely in flight.

## Specs

- `v-runadhoc-functional.spec.ts` - the four ad-hoc phases below.
- `v-runadhoc-stop.spec.ts` - stopping an ad-hoc Run Current. Each of its two
  tests imports `fixture-stop.json` fresh, because a Stop leaves the session
  terminal and a second run would inherit the prior Block states.

## Steps

The single spec drives one workbench session through four phases against
a fresh fixture import:

1. **Run Current** on `log-target` via the right-click menu.
2. **Run from Here** on `log-target` via the right-click menu.
3. **Debug from Here** on `log-target` after enabling Pause on First
   Block from the canvas right-click menu, then `Continue`.
4. **Dirty run-current**: right-click → Disable on `log-pre` (sets
   `isDirty=true`), then right-click Run Current on `log-target`. The run
   fires directly against the in-memory body (no run-confirm dialog).

## Validation

- Phase 1: `log-target` shows `data-execution-status="success"`; nodes
  before and after retain non-success / non-running statuses; Console
  contains `adhoc-target` and not `adhoc-pre` / `adhoc-step3`. Toast
  reads `Block 'Log Target' ran successfully`.
- Phase 2: `log-target` + every downstream node shows
  `data-execution-status="success"`; pre-target nodes still untouched.
  Console gains `adhoc-step3` / `adhoc-step4` / `adhoc-post`.
- Phase 3: Workflow status is `paused`, `log-target` carries
  `data-paused="true"`. After `Continue`, status returns to `passed` and
  the downstream nodes complete.
- Phase 4: No run-confirm dialog appears (no `Save and Run` /
  `Discard and Run` buttons). The workflow status reaches `passed`,
  `log-target` shows `success`, and `log-pre` keeps `data-disabled="true"`
  in the in-memory canvas (run-current did not save it).

## Stop coverage (`v-runadhoc-stop.spec.ts`)

Canceling settles every Block the run was standing on, and each settled
Block gets its own console line naming itself. The test-level framing lines
("execution started", "completed successfully", "execution stopped by user")
stay suppressed for an ad-hoc run.

- Run Current on `delay-solo`, stopped in flight: exactly one WARN
  `Stopped by user` line, with the Source `Delay : Solo Delay` (EXEC-25).
- Run Current on `for-adhoc` with `delay-body` in flight, stopped: exactly two
  such lines, with the Sources `For Loop : Adhoc Loop` and `Delay : Body Delay`;
  the already-finished `Log : Body Log` gets none.
- Neither console carries a test-level framing line.

The spec reads each row's Source from the row's copy text: the console source
column cuts a Source to its width, the copy text keeps it whole.
