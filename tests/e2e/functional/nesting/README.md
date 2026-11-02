# Nesting Functional Tests

Functional E2E coverage for nesting (REQ-3.1.1.4): wherever a For Loop can sit, every container
runs exactly as it does on the main flow, at any depth and inside every slot kind, including a
Remote Execution body and a Function body.

## Suite structure

- Every `v-nesting-*-functional.spec.ts` file declares its own tests: it calls `test.describe`, its
  `test.afterEach` cleanup hooks and one `test(...)` per cell itself, looping over a cell list.
- The cell modules (`placement-cells.ts`, `break-continue-cells.ts`, `halt-cells.ts`, `failure-cells.ts`,
  `assert-wait-cells.ts`, `parallel-signal-cells.ts`, `stop-cells.ts`, `variable-cells.ts`, `reload-cells.ts`) never call
  `test()`, `test.describe()` or a hook. They export the describe title, the cell plans in registration
  order (each with its title), the cell timeout and an async `run...Cell(page, plan)` that holds the
  cell's graph, run and assertions. The cleanup bodies live in `deleteCellEntities` (`nesting-harness.ts`),
  `deleteSignalCellEntities` (`signal-cell-open.ts`) and `deleteStopProbeTests` (`stop-probes.ts`), and
  each spec calls them from its own `afterEach` hooks.
- Why: Playwright records a test's file as the module where `test()` is called. The CI shard planner
  (`scripts/e2e-shard-plan.mjs`) builds each shard's file list from `playwright test --list`, so a test
  declared inside a helper module is listed under that helper, which Playwright does not run as a spec
  file, and the test never runs in CI.

## Where a cell runs: canvas or API

- Every cell runs one of two ways, decided by its cell id in `cellSurface` (`nesting-harness.ts`). The cell
  code is the same either way: `openCell` / `openSignalCell`, `startCellRun` / `finishCell` / `runCell`
  and the `expect...` readers switch on `cell.surface`.
- **Canvas** (133 cells): the Test opens in the Workbench, Run is clicked (so the pre-run check runs), and
  the harness reads the console rows and each Block's `data-execution-status`. Canvas cells are every
  cell whose behavior lives in the page (`C.*` debug, Run Current, Run from Here and disabled nodes; `D.*`
  locus badges and drilled Function bodies; `B6.*` Stop) plus a paint sample: every `A.for-body.*` cell
  (untaken branches paint skipped) and every `B3.for.<inner>.bare.then` cell (failed Blocks and
  containers paint failed).
- **API** (every other cell): the harness subscribes to `workbench:<session>` and `log:<session>` on
  `/ws`, starts the run with `POST /workbench/run` carrying that session id, waits for a terminal status
  and `execution_completed`, and reads the log entries and session variables. Paint comes from
  `paintFromEvents` (`api-run.ts`), which applies the canvas rule to the same `block_status_changed`
  events the canvas paints from (`passed` paints `success`, a stopped run paints its current Block
  `stopped`, a Block with no event paints nothing). The canvas sample proves that rule against the page.
- Why the API surface is safe for these cells: the run, the routing, the markers, the verdict, the
  variables and the status events are the engine's, identical on both surfaces. The canvas adds to the
  pre-run gate only the in-memory undeclared-variable check, which reads declared names and never the
  graph's nesting, and on a clean, freshly loaded Test nothing else. Why it exists: the page load, the
  environment selection and the console scroll made up most of each cell's time.

## What the suite proves

Matrix A (placement) runs each of the 11 container kinds as the inner container inside each of
the 16 slot kinds, one Playwright test per cell (176 cells). A cell passes only when:

- the graph imports with zero validation errors and run-context validation reports none;
- the run verdict is passed;
- the inner container's sub-flow marker Log runs the expected number of times, and every marker in
  a branch the run is not routed into never runs;
- the inner container's `then` successor (the rejoin for If/Else and split Assert, the node after
  the instance for a Function) runs once per entry, inside the outer slot;
- the outer container's `then` successor and the bookend run once, in that order;
- no node is left `running`, and no console ERROR line appears except the lines that name a Block
  the graph marks as a trigger (the failing Block that routes a Try/Catch into its catch path);
- `nest_inner`, written by the Variable Setter at the innermost depth, reads `inner-<token>` at the
  top after the run;
- inside a For, For Each or While body, the untaken branch Blocks of an inner If/Else, Switch/Case or
  split Assert paint `skipped` (LOOP:120). Outside a loop body the design states no paint for those
  Blocks, so no paint is asserted there.

## Cell ids

`A.<slot>.<inner>`, for example `A.for-body.parallel`. Every test title starts with its cell id.

| Slot kinds (spec file) | Slots |
|---|---|
| `v-nesting-in-if-else-functional.spec.ts` | `if-branch`, `else-branch` |
| `v-nesting-in-switch-case-functional.spec.ts` | `case`, `default` |
| `v-nesting-in-assert-split-functional.spec.ts` | `assert-pass`, `assert-fail` |
| `v-nesting-in-for-functional.spec.ts` | `for-body` |
| `v-nesting-in-for-each-functional.spec.ts` | `for-each-body` |
| `v-nesting-in-while-functional.spec.ts` | `while-body` |
| `v-nesting-in-wait-until-functional.spec.ts` | `wait-until-body` |
| `v-nesting-in-parallel-functional.spec.ts` | `parallel-lane` |
| `v-nesting-in-try-catch-functional.spec.ts` | `try`, `catch`, `finally` |
| `v-nesting-in-remote-exec-functional.spec.ts` | `remote-body` |
| `v-nesting-in-function-functional.spec.ts` | `function-body` |

Inner kinds, in order: `if-else`, `switch-case`, `assert-split`, `for`, `for-each`, `while`,
`wait-until`, `parallel`, `try-catch`, `remote-exec`, `function`.

## Signal cells in the other branch slots, Function isolation, lane limits, Wait Until scopes

| Spec file | Cell ids | Cells | Cell module |
|---|---|---|---|
| `v-nesting-signals-break-continue-branches-functional.spec.ts` | `B1.<for\|for-each\|while>.<else-branch\|default\|assert-fail>.<break\|continue>.<nearest\|outer>` | 36 | `break-continue-cells.ts` (`breakContinueCellPlans` with `BRANCH_SIGNAL_SLOTS`) |
| `v-nesting-signals-variables-functions-functional.spec.ts` | `B7.fn-by-value.lanes`, `B7.fn-concurrent.lanes` | 2 | `variable-cells.ts` (`laneIsolationCellPlans`) |
| `v-nesting-signals-parallel-lane-limit-functional.spec.ts` | `B5.<for-body\|for-each-body\|while-body\|try\|catch\|finally>.lane-time-limit` | 6 | `parallel-signal-cells.ts` (`laneTimeLimitPlans`) |
| `v-nesting-signals-wait-timeout-scopes-functional.spec.ts` | `B4.<container kind>.wait-timeout-<function\|try>` | 22 | `assert-wait-cells.ts` (`waitTimeoutScopePlans`) |
| `v-nesting-signals-failure-reload-functional.spec.ts` | `R.for-body.<if-branch\|assert-fail>.fails-in-branch`, `R.try.if-branch.fails-in-branch`, `R.for-body.if-branch.fails-after-rejoin` | 4 | `reload-cells.ts` (`reloadPlans`) |
| `v-nesting-skipped-lane-paint-functional.spec.ts` | `U.if-else`, `U.assert-split`, `Z.<placement>`, `C.<failure\|break\|continue\|halt>.<placement>` (placement: `test-flow\|in-container\|function-body`) | 17 | none (cells in the spec) |

- B1: the else branch and the Assert fail leg assert the same outcome as the if branch and the pass leg; the
  Switch/Case default cells record a refusal or the run and assert only that no node is left running.
- B1 try, catch and finally (`v-nesting-signals-break-continue-<for|for-each|while>-functional.spec.ts`): the
  Try/Catch has its finally path enabled. The signal leaves the Try/Catch the way `break` leaves `try ... finally`:
  the rest of its path and the catch path never run, and the finally path (the try path for a signal in finally)
  runs once each time the signal leaves, before the target loop's then successor. The For spec also holds
  `B1.for.try-finally.if-else-break`: For Loop body > Try/Catch (try: a marker, then an If/Else holding a Break;
  finally: a Log) > a Log after the loop; the finally Log and the Log after the loop run once, in that order.
- B7 by-value: lane 1 runs a Function Block whose Function prints its input, holds 4 s and prints it again while
  lane 2 writes the bound Test variable after 1.5 s. B7 concurrent: one library Function on a Function Block in each
  lane with different inputs and output bindings (`uses.of`).
- B5 lane limit: a 1 s limit on lane 1 only, no section limit, over a 5 s Delay.
- B4: the signal is a single-mode Assert or a Wait Until timeout with Fail current scope on, so it fails its block
  and the flow stops there. A Try/Catch container catches it in its own catch path; otherwise it ends the enclosing
  Function or the Test, or the top-level catch catches it. B4 Wait Until scopes: the root-Test `wait-timeout` shape,
  moved into a Function body or a top-level try path, with the same expectations as the matching `assert-function`
  and `assert-try` cells.
- R: an If/Else if branch or a split Assert fail branch in a For Loop body or a Try/Catch try path; a marker runs in
  the branch and a Block fails in the branch or after the branch rejoins. The routed branch edge is stored before its
  sibling. The cell runs on the canvas whatever `cellSurface` says, reads the stored block states from
  `GET /workbench/session`, reloads the page and checks that the marker paints success, the failing Block failed and
  the marker the failure cut off skipped, both during the run and after the reload.
- U: one Test chains a container per sub-flow slot (For, For Each and While bodies, the Wait Until retry lane, a
  Parallel lane, the Try/Catch try, catch and finally paths, a Switch/Case case and default, a Remote Execution
  body) and a Function Block; each holds an If/Else (or a split Assert) whose taken branch logs, whose untaken branch
  holds a marker and whose branches rejoin on a Log. Z: a For with count 0, a For Each over a null variable, over
  `[]` and over an empty table, a While false at its first check and a Wait Until met at its first check, each with
  a two-Log lane, on the Test flow, in a try path or in a Function body. C: a failing Log, a Break, a Continue (in a
  For body) or a Halt (ending a try path) ahead of a For with a body and a Log, in the same three places. Each cell
  runs on the canvas, then as a
  tracked run: the untaken marker and every Block of a zero-run lane paint skipped (the taken and rejoin Logs
  success) during the run, in `GET /workbench/session`, after a reload and on the history canvas with its stored
  states (a Function body read on the drilled canvas each time).

## Depth, Halt, failure, Parallel, Stop and variable cells

| Spec file | Cell ids | Cells | Cell module | What it proves |
|---|---|---|---|---|
| `v-nesting-depth-functional.spec.ts` | `D.rx-body.<container kind>` (every kind but Remote Execution), `D.rx-in-rx`, `D.depth4-chain`, `D.fn-in-fn`, `D.rx-first-to-finish` | 14 | none (cells in the spec; probes from `execution-host-probes.ts`) | a container in a Remote Execution body steers on WAVE while its remotable Blocks use the body's worker; an inner Remote Execution opens its own worker; a depth-4 chain and a Function inside a Function run as at Test level; a read after a first-to-finish Parallel still runs on the Execution Host and no worker is left |
| `v-nesting-signals-halt-<container kind>-functional.spec.ts` (11 files) | `B2.<container kind>.d<2\|3>.<function\|test\|suite\|regression>.<passed\|failed\|skipped>` | 24 per file | `halt-cells.ts` (`haltCellPlans`) | a Halt at depth 2 or 3 ends the run with its status and nothing after it runs; a function-scope Halt ends only its Function unless it fails |
| `v-nesting-signals-failure-<container kind>-functional.spec.ts` (11 files, the reload spec aside) | `B3.<outer kind>.<inner kind>.<trycatch\|bare>.<then\|nothen>` | 44 per file | `failure-cells.ts` (`failurePlans`) | no Block or then successor after a failing Block at depth 2 runs: bare, the run fails; under a top-level Try/Catch the catch runs once and the run passes; the Block and a Parallel or Function around it paint failed (a cell with a Wait Until checks only the import, the untaken branches and that no node is left running) |
| `v-nesting-signals-parallel-functional.spec.ts` | `B5.<for-body\|for-each-body\|while-body\|try\|catch\|finally>.<lane-failure\|time-limit>` | 12 | `parallel-signal-cells.ts` (`parallelSignalPlans`) | a lane failure or an expired section time limit fails the Parallel, which then ends the loop or routes the Try/Catch path like any failed Block |
| `v-nesting-signals-stop-functional.spec.ts` | `B6.<container kind>` | 11 | `stop-cells.ts` (`stopPlans`) | an Immediate Stop while a Shell Script runs at depth 3 stops the run within 10 s, paints the Shell Script and each in-flight container around it stopped (If/Else and split Assert aside), runs nothing after, and leaves no process or worker behind |
| `v-nesting-signals-variables-functional.spec.ts` | `B7.set-d3.<slot>`, `B7.loop-vars.<for\|for-each\|while>.<inner kind>`, `B7.fn-<input\|output\|local>.<containers\|functions>` | 55 | `variable-cells.ts` (`variableCellPlans`) | a depth-3 write reads at the top, loop index and item bind at depth, and a Function at depth passes inputs and outputs and keeps its locals |
| `v-nesting-loop-null-functional.spec.ts` | `B7.loop-null.<for-each\|for\|for-each-empty>.<slot>` | 48 | `variable-cells.ts` (`loopNullCellPlans`) | a For Each over a null variable, a For whose count is a null variable and a For Each over `[]`, inside each slot kind, run zero times: the body never runs, the loop prints `Starting loop (0 iterations)` and its then path runs on every entry of the slot, the bound index reads 0 and the bound item keeps its seed (never `{}`), also through a Function's outputs |
| `v-nesting-loop-null-functional.spec.ts` | `B7.zero-run.<kind>.<placement>.<then\|no-then>` | 71 | `variable-cells.ts` (`zeroRunCellPlans`) | every container whose lane can run zero times (the three loop-null cases, a For with count 0, a For Each over `{}`, a While false at its first check, a Wait Until met at its first check) on the Test flow, in a For body, in a Function body, in a Function inside a Function, and in a For body or a try path inside a Function, with a Block on its then lane or last on its lane: the lane never runs and the flow goes on (the loop-null shapes already in the row above are left out) |

## Functions and Remote Execution at more than one level

`v-nesting-functions-remote-functional.spec.ts` holds the `F.<case>` cells (10). Its probes and openers live in
`functions-remote-probes.ts`; the host and worker probes come from `execution-host-probes.ts` and the worker
recorder and the gone check from `stop-probes.ts`.

| Cell | Shape | Surface |
|---|---|---|
| `F.fn-in-fn-in-body` | body > Function > Function > host and worker probes; R read on the drilled inner body | canvas |
| `F.rx-in-fn-in-body` | body > Function > inner Remote Execution (session a Function input); own worker, none left | API |
| `F.containers-in-fn-in-body` | body > Function > For Loop, Parallel lanes, Try/Catch failing on the remote host | API |
| `F.same-fn-two-calls` | one library Function on a Function Block inside a body (remote host, R) and outside (WAVE) | canvas |
| `F.rx-fn-in-loop-and-lane` | a Function holding a Remote Execution, on Function Blocks in a For Loop and a Parallel lane | API |
| `F.session-through-two-fns` | session through two Function inputs to a Remote Execution | API |
| `F.debug-in-fn-in-body` | breakpoint, Repeat Step, Step Over, Continue inside a Function in a body | canvas |
| `F.run-scope-fn-in-body` | Run Scope of a Function whose instance sits in a body | canvas |
| `F.testdata-in-fn-in-body` | a `testdata://` read in a Function in a body: saves clean, fails at run time | API |
| `F.library-fn-standalone` | a library Function with remotable Blocks opened from the library (no Test) | canvas |

- `cellSurface` does not list `F.*`, so the canvas cells open through `openCanvasCell`, which opens the harness cell
  and then the Test on the Workbench page.
- The debug cell's echo request goes to `http-target`, whose name resolves only on the remote host's network, so a
  passed request shows it ran on the remote host. The Try/Catch cell reads a file written into the run's artifacts
  folder on WAVE, so the read can only fail on the remote host.
- The locus badge drilled from a Function Block outside any body, and on a library Function opened with no Test,
  is not settled by the design; those cells record the badge as an `unsettled` annotation and assert nothing on it.
- `F.library-fn-standalone` creates no Test; `deleteLibraryOnlyFunctions` removes what it published.

## Ad-hoc runs inside a Function body

`v-nesting-adhoc-functional.spec.ts` drives every ad-hoc run inside a Function body on the canvas, after a full
run of the same Test, so each cell proves the run starts from the state the full run left.

| Cell | Shape | What it proves |
|---|---|---|
| `C.run-current.function-body` | pre-set writes `fn_in`; the inner Function body holds fn-set -> target -> fn-bump -> next | Run Current on target reads the input and the local the full run left (fn-bump's `+` included) |
| `C.run-from-here.function-body` | same | Run from Here starts from that state, runs the rest of the body and nothing outside it |
| `C.run-scope.function-body.nested` | the inner Function body holds a Function `deep` whose body is target -> fn-bump -> next | Run Scope opened into `deep` runs it from the local its last run left |
| `C.<run-current\|run-from-here\|debug-current\|debug-from-here>.function-body.reset` | the Run Current shape, with Reset between the runs | after Reset the Required input `fn_in` has no value, so each ad-hoc run on target stops before it, the console carries `Block '<Function>' failed: 'fn_in' is null` as Run Scope prints it, and the run carries the advisory (FNCFG-8) |

The same spec holds one cell per slot kind (16 each, 64 cells) for `C.run-current.<slot>`, `C.run-from-here.<slot>`,
`C.disabled.block.<slot>` and `C.disabled.container.<slot>`; the two `function-body` run cells in the table above are
among them. Each cell's Test runs pre -> a Try/Catch whose try path holds the inner container (inner -> inner-then)
-> outer-then -> bookend, and the inner container's slot holds the cell's Blocks. Run Current on target (the slot
holds target -> next) passes and runs target once and nothing else. Run from Here on target runs target and next
once, in that order, and never runs pre or an untaken branch; whether the run continues past the slot is not
asserted. A full run with a disabled Block in the slot (a disabled marker -> next) passes, never runs the disabled
Block and runs next once per slot run, with inner-then, outer-then and the bookend once. A full run with a disabled
inner container passes with pre, outer-then and the bookend once; for Switch/Case, the loops, Wait Until, Parallel
and Try/Catch nothing inside the container runs and inner-then runs once, and for If/Else, split Assert, Remote
Execution and Function the sub-flow is not asserted.

- The Functions are library Functions, so their opened bodies are read-only; right-clicking a node there still
  offers the run and debug items.
- The console keeps every run's lines until Reset, so the cells count the exact text target prints (its marker
  text, a colon and `fn_note`) rather than the marker alone.

## A block failure inside a Wait Until retry sub-flow

A block that fails inside a Wait Until retry sub-flow fails the Wait Until at once, like any container around a
failure; a Try/Catch inside the sub-flow is how an author keeps polling past a failed round. The B4 cells whose
container is a Wait Until (`B4.wait-until.*` in `v-nesting-signals-assert-wait-functional.spec.ts` and
`v-nesting-signals-wait-timeout-scopes-functional.spec.ts`) assert the same outcome as every other container kind.

## Debug at depth 2 (`C.debug.<slot>`)

`v-nesting-debug-functional.spec.ts` holds one cell per slot kind: a breakpoint on `bp` in the inner container's
slot pauses the Debug run, two Repeat Steps each run `bp` once, and Step Over then pauses on `next` without running
`bp` again. A Block that Repeat Step ran already has a result, so Continue and Step Over proceed from it (EM:1380).
After Continue the run passes with `bp` counted exactly twice.

## Graph builder (`tests/e2e/helpers/nesting-graph.ts`)

A graph is a chain of steps; a container step's slot holds its own chain, so depth is unlimited.
Consecutive steps connect through the previous step's exit (a leaf's edge, a container's `then`,
a Function instance's sibling-after edge, or every branch tail of an If/Else or split Assert).

- `container(kind, id, body, { slot?, slots?, options?, lanes?, uses? })` - `body` fills `slot` and the run is
  routed there; `slots` gives explicit chains for other slots; a slot left out gets a generated marker.
  `options`: `iterations`, `disabled`, `failScope`, `neverSatisfied`, `timeoutMs`, `join`,
  `timeLimitMs`, `laneTimeLimitMs` (the time limit of lane 1 only), `enableCatch`, `enableFinally`,
  `sessionVar`, `bindIndex`, `bindItem`, `collection` (a For Each collection expression in place of the generated
  list), `countExpression` (a For count expression in place of `iterations`).
- `lanes` (Parallel only): chains for lane 2, 3, ... in place of the generated `<id>-lane-2` marker.
- `uses` (Function only): `of` names an earlier Function step whose library Function this step's Block runs
  (no body, nothing new published), so one Function can sit in the graph more than once; `fields` maps an
  input field to an expression in the enclosing scope and `outputs` maps an output to the enclosing-scope
  variable it is assigned to. Names left out keep the same-name default.
- Leaves: `marker(id, level?)`, `setter(id, rows)`, `failBlock(id)`, `assertBlock(id, { pass, failScope })`,
  `halt(id, { scope, status })`, `breakBlock(id, targetLoop)`, `continueBlock(id, targetLoop)`,
  `delayBlock(id, ms)`, `shellScript(id, script, { outputBindings, vars })`, `hostProbe(id, variable)`,
  `leaf(node, { vars, trigger, terminal })`, `disable(step)`, `named(step)`.
- Names: a Block keeps its type's default Name and its id is its Description. A trigger (a leaf built with
  `trigger`, or a container that is its own trigger) carries its id as its Name too, because the engine
  names a Block by its Name (EXEC-26) and the harness excludes the ERROR lines that name a trigger.
  `named(step)` gives any other leaf its id as its Name when a spec reads a line that names it.
- `buildNestingGraph({ name, chain, topTry? })` returns the Test fixture and the Function plans (publish
  order), plus per-container info: generated `untaken` markers (never run), `siblings` (run once per
  entry), the catch `trigger`, and the While / Wait Until `counter` tail.
- Routing: if branch by a condition that holds, else branch by one that does not; a Switch case with
  Break set above a non-matching case and the default, the default after one non-matching case; the
  Assert fail leg with Fail current scope off (informational, no ERROR); the catch path by a Log
  evaluating `1/0` on the try path (the one trigger); a While counts with a counter Variable Setter at
  its body tail; a Wait Until checks a counter first and its body tail makes the next check hold.
- Variables: every bound variable is declared where it runs. `export` variables leave a Function as a
  declared output bound on the Function Block; `import` variables (the Execution Host session) enter as a
  Function input; `local` state inside a Function is a declared output nobody binds.
- Every Remote Execution gets an SSH Session Open on the shared `sshd` host at the head of the Test;
  the host is injected at import as `functional/remote-exec/` does.
- Output carries `__TOKEN__`; `markerText(id, token)` is a marker's full text.

## Cell harness (`nesting-harness.ts`)

- `deleteCellEntities(request, testInfo)`, called from each describe's `afterEach` in the spec: deletes that
  test's Test and every Function it published (`?cascade=true`, outermost first, each delete asserted).
- `openCell(page, cellId, { chain, topTry? })` - fresh token, Test named `<cellId> <token>`, publishes the
  Functions, clears the workbench session, imports with zero validation errors, opens the Test,
  asserts run-context validation reports no errors.
- `startCellRun` / `startCellDebug` (fail if the pre-run check opens its dialog), `finishCell(page, cell,
  { timeoutMs, awaitBookend })` for any verdict, `runCell` for both.
- The returned `CellRun` carries the verdict, console rows in order, console entries with full sources,
  node paint and session variables.
- Soft assertions naming the cell and the criterion: `expectVerdict`, `expectMarkerCount`,
  `expectRanBefore`, `expectNoNodeRunning`, `expectNoErrorLines`, `expectVariable`, `expectNodePaint`;
  readers `markerPositions`, `nodePaint`, `triggerErrorLines`, `cellText`.
- Debug and ad-hoc controls come from existing helpers: `toggleBreakpoint`, `expectPausedAt`,
  `clickStepOver`, `clickRepeatStep`, `clickContinue`, `clickStopImmediate` (Stop, then
  `stop-confirmation-dialog`, then `stop-confirm-immediate`) in `functional/debug-step/helpers.ts`;
  `clickNodeContextMenuItem(page, id, 'Run Current' | 'Run from Here')` and `disableNode` in
  `helpers/workbench.ts`.

## Services

Needs the `sshd` service up (`scripts/e2e-stack.sh up --wait`). The Remote Execution cells open a
connection-scoped session on the shared host and write nothing there. An ad-hoc cell inside a Remote
Execution body (`C.run-current.remote-body*`, `C.run-from-here.remote-body*`) first runs Run Current on the
Test's SSH Session Open, which leaves that session open for the ad-hoc run, and `adHocRunToEnd`
(`debug-adhoc-drive.ts`) waits for the new run's own session, so the earlier verdict never counts. The two
`closed-session` cells open no session: Run Current on a Block that runs on the remote host fails with the
closed-session reason, and Run Current on a Block that runs on WAVE passes. `D.rx-first-to-finish` and
`F.debug-in-fn-in-body` also need `http-target`: the first one's cut-off lane holds a request to it open from the
remote host, and the second one's echo request goes to it from the remote host.
