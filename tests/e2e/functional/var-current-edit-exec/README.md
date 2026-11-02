# V-VMGR-EXEC-STOP-STATE Stop-State Node Behavior - Functional

Spec: `v-vmgr-exec-stop-state-functional.spec.ts`. How Blocks look after a Debug run inside a Function
is stopped, on the same pause / stop lifecycle as the runtime override (REQ-3.2.1.6). One local-Function
Test with a single inner Log:

- Stop while paused inside the Function keeps the canvas drilled in.
- Stop finalizes the running ancestor Function (RUNNING -> stopped).
- The stopped inner node drops its paused halo.
- A minimal Function node honors the 192px min-width floor.

## Pre-requisites

- Backend on the per-worker port (Playwright fixtures).
- Frontend on the matching per-worker port.
- The shared E2E execution environment (created by the spec if missing).

## Execution Steps

1. Create the Test via POST `/tests` and assert `POST /tests/{id}/validate`
   returns zero errors.
2. Open the Test and measure the minimal `Fn` node (the Function min-width floor
   is 192px, vs 160px for plugins).
3. Set a breakpoint on the Function node at the root, Debug; it pauses on the
   Function. Step Into: the canvas drills in and pauses on the inner Log.
4. Stop immediately.
5. Pop to root and inspect the Function node.

## Validation Criteria

- The Test validates with zero errors before any UI interaction.
- The Function node's rendered width is >= 192px.
- At the pause the inner Log is visible and carries `data-paused="true"`.
- After Stop the inner Log is STILL visible (the canvas stayed drilled in; a
  pop-to-root would have unmounted it) and no longer carries `data-paused`.
- After popping to root the Function node carries
  `data-execution-status="stopped"` (the running ancestor was finalized).

# V-VMGR-EDITS-BETWEEN-RUNS Variable Edits Between Block Runs - Functional

Spec: `v-vmgr-edits-between-runs-functional.spec.ts`. What the Variable Manager
row, the watcher, the variable's Edit window and the next block run agree on
after a variable is edited between runs or while a run is paused (REQ-3.2.1.5,
REQ-3.2.1.6, VMGR-8, VMGR-9, VMGR-10, VMGR-19, VMGR-106, VMGR-107). Every case reads a Log block's console line, so no
external service is used: the URL in the fixtures is only printed.

| Fixture | Variables | Blocks |
|---------|-----------|--------|
| `fixture-edits-between-runs-template.json` | `port` = 8080, `base_url` = template `http://api.example:{{ port }}/health` | Log Port prints `port=...`, Log URL prints `base_url=...` |
| `fixture-edits-between-runs-random.json` | `token` = expression whose result holds three object addresses, new on every evaluation | Log Token prints `token=...` |
| `fixture-edits-between-runs-expressions.json` | `name` = `Ada`, `greeting` = `'hello ' + name`, `farewell` = `'bye ' + name` | Log Greeting prints `greeting=...`, Log Farewell prints `farewell=...` |
| `fixture-edits-between-runs-paused.json` | `port` = 8080, `slots` = integer with no value (holds null) | Gate (literal message), Log Port prints `port=...`, Log Slots prints `slots=...` |

## Pre-requisites

- Backend on the per-worker port (Playwright fixtures).
- Frontend on the matching per-worker port.
- The shared E2E execution environment (created by the spec if missing).

## Execution Steps

Every test starts the same way: POST its fixture to `/tests`, assert
`POST /tests/{id}/validate` returns zero errors, open
`/workbench?editTest={testId}`, expand the Variable Manager and select the
environment.

1. Template fixture. Run. Change `port` to 9090 with the row pencil. Run
   Current on Log URL.
2. Template fixture. Run. Change the source of `base_url` to
   `https://api.example:{{ port }}/ready` with the row pencil. Run Current on
   Log URL.
3. Random fixture. Run Current on Log Token twice, with no edit in between.
4. Template fixture. Run. Open `port`'s Edit window with the pencil, pill
   Current, 7070, Save; reopen it on Initial and Cancel. Run Current on Log URL.
5. Template fixture, no run yet. Give `port` the Current value 7070 in its Edit
   window; switch its watcher to Initial. Run Current on Log Port.
6. Expressions fixture. Run. Open the `greeting` watcher, open its Edit window
   (pill Current) from the row pencil, source `'hi ' + name`, Save. Run Current
   on Log Greeting.
7. Paused fixture. Breakpoint on Gate, Debug. While paused open the `port`
   watcher, then change `port` to 9090 with the row pencil, which is enabled
   while paused (VMGR-107); look at the watcher on Current and Initial; toggle
   the row's eye twice. Continue.
8. Paused fixture. Breakpoint on Gate, Debug. While paused change `slots` to 5
   with the row pencil; look at its watcher on Current and Initial. Continue;
   open `slots` again.
9. Expressions fixture, no run yet. Run Current on Log Greeting. Click the eye
   of the `farewell` row. Give `greeting` the Current source `'hi ' + name` in
   its Edit window. Run Current on Log Greeting. Click the eye of the
   `farewell` row again.

## Validation Criteria

- Every fixture validates with zero errors before any UI interaction.
- Case 1: after the pencil edit the `base_url` row reads the template source,
  not `http://api.example:8080/health`; the Run Current prints
  `base_url=http://api.example:9090/health` and the row shows that rendering.
- Case 2: the Run Current prints `base_url=https://api.example:8080/ready` and
  the row shows that rendering.
- Case 3: the first line matches `token=[<map object at 0x...>, ...]` with
  three addresses and the second line is equal to the first.
- Case 4: the Edit window's Current view starts from the run's `8080`; after
  Save the `port` row reads `7070` and Initial still reads `8080`; the Run
  Current prints `base_url=http://api.example:7070/health`.
- Case 5: the `port` row reads `7070`, Initial reads `8080`, and the Run
  Current prints `port=7070`.
- Case 6: the Edit window's Current view shows the active source
  `'hello ' + name`; after the Current source edit the `greeting` row reads
  `<not evaluated yet>` while the `farewell` row keeps `bye Ada`; the Run
  Current prints `greeting=hi Ada` and the row shows `hi Ada`.
- Case 7: while paused, Initial reads `9090`, Current reads `8080`, the row
  reads `8080` and its definition view reads `9090`; Continue prints
  `port=8080` once; after the run ends the row reads `9090`.
- Case 8: while paused, Initial reads `5` and the row and Current read
  `null` in the null look (italic, monospace, muted, not dimmed; VMGR-93);
  Continue prints `slots=None` (a Python f-string) and the run passes; after
  the run ends the row and Current read `5`.
- Case 9: after the Current source edit the `farewell` row still reads
  `'bye ' + name` in italics with the crossed-out eye; after the second Run
  Current it still reads `'bye ' + name`, and one click on its eye turns it to
  `<not evaluated yet>`.
