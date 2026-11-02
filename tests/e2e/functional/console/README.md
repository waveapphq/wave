# V-CONSOLE-SOURCE-RESIZE: Source-Column Resize Handle Regression Guard

Pin the console panel's source/message column resize handle so two
historical regressions cannot recur:

1. Stale 12ch timestamp spacer in the resize-bar overlay (after
   `log-entry.tsx` bumped `TIMESTAMP_WIDTH_CH` to 18ch for the timezone
   token), which left the visible 1px line six characters left of the
   actual source-column boundary.
2. `all: unset` on the resize button reset `pointer-events` to
   `inherit`, picking up the parent overlay's `pointer-events: none`
   and silencing every hover/click. The Tailwind `pointer-events-auto`
   utility cannot win against an inline style.

## Prerequisites

- Backend running on the worker's backend port
- Frontend running on the worker's frontend port
- Shared E2E environment present (handled by `ensureEnvironment` at
  test start)

## Fixtures

- `fixture.json` - Three chained Log plugins (`log-a` → `log-b` →
  `log-c`) producing three log entries so the virtualizer mounts the
  source-column resize handle (handle is only rendered when
  `entries.length > 0`).

## Steps

1. Import the fixture and run it via the action-bar Run button. Wait
   for `data-status="passed"`.
2. Open the console panel (it starts collapsed by default).
3. Read the alignment metrics: handle's horizontal center vs. the
   source column's right edge.
4. Move the cursor away from the handle and read the resting
   inner-line `width`; hover the handle and read the hover width.
5. Drag the handle by `+60px`, then by `-120px`. After each drag
   capture the source column's pixel width.
6. In a second test, at a 1600 px wide window: give the first Log block
   the Name `Say hello`, run, and read the Source cell of its row. Read
   it again at a 1280 px wide window. Drag the handle far right, then
   far left, twice each way.

## Validation

- **Alignment**: `Math.abs(handleCenter - sourceRight) <= 2px` both
  before and after the drag pass (timestamp/level/source spacers in
  `content.tsx` and `log-entry.tsx` stay in lockstep).
- **Cursor**: `getComputedStyle(handle).cursor === 'col-resize'`
  (defends against the `all: unset` cascade race).
- **Inner line width**: `1px` at rest, `2px` after `handle.hover()`
  (defends against the lost-hover regression).
- **Drag delta**: `+60px` cursor delta widens the source column by
  ~60px (within ±1.5ch tolerance for chWidth jitter); subsequent
  `-120px` drag leaves the column ~60px narrower than the starting
  width.
- **Set width**: the Source cell is 20 characters wide by default at
  both window widths and shows `Log : Say hello` whole; a long drag
  right stops at 50 characters and a long drag left stops at 10, and a
  second drag the same way changes nothing. At every width the message
  starts 16 px after the Source and runs to the end of the row.

---

# V-CONSOLE-SETTINGS-PERSIST-FUNCTIONAL: Shared Persisted Display Settings

Regression guard: console display settings previously reset on every reload
(four per-surface copies of the defaults). They are now one remembered
per-browser preference shared by the live console, the Execution History
console, and the report log panel.

## Prerequisites

- Backend and frontend running (standard functional-stack ports)
- Shared E2E environment present (created by `ensureEnvironment` at test start)

## Fixtures

- Reuses `fixture.json` (three chained Log plugins), imported with a unique
  name and run as a TRACKED execution over REST so the history page and the
  report viewer have a persisted run to render.

## Steps

1. Run the fixture tracked; pre-generate its JSON report
2. In the live console: toggle all four display switches off and step the
   text size to 14; assert the persisted preference; reload and re-assert
3. Open the Execution History console: same switch states, hidden columns,
   14px rows, system rows filtered; toggle Timestamps back on there
4. Open the report log panel: the three shared column toggles apply, text
   size stays at the report default (12px), system rows are NOT filtered;
   toggle Source on from the report Columns picker
5. Return to the history console and assert the report-made change applies

## Validation

- **Persistence:** `wave-console-display-settings` carries every change and
  survives reload
- **Cross-surface:** live, history and report consoles all read AND write the
  same preference
- **Report reduction:** exactly the three column toggles follow the shared
  preference on the report panel; text size and the system-log filter stay
  workbench/history-only

---

# V-CONSOLE-RUN-ORDER: Consecutive Runs Stay In Time Order

Regression guard for the console interleaving consecutive runs. The console ordered its entries
on a per-session counter that restarts at zero on every run, and its "same
ordering domain" check only compared run ids that were all undefined - so
running the same test three times rendered every run's first line, then every
run's second line, and so on. Ordering now leads on the entry timestamp.

The unit guard is `frontend/tests/features/workbench/stores/log-store.test.ts`;
this is the end-to-end proof, read off the rendered console rows.

## Prerequisites

- Backend and frontend running (standard functional-stack ports)
- Shared E2E environment present (created by `ensureEnvironment` at test start)
- Reuses `fixture.json` (three chained Log plugins), so each run contributes a
  known first and last line

## Steps

1. Import the fixture and open it in the workbench; pick the shared environment
2. Press Run and wait until the run's last line has rendered
3. Press Run again WITHOUT clearing the console, and wait for the second copy
4. Read every rendered row (timestamp, level, message) by scrolling the
   virtualized console top to bottom

## Validation

- **Accumulation:** each of the three markers renders exactly twice - a second
  run adds to the console rather than replacing it
- **Run boundary:** the second run's first line renders BELOW the first run's
  last line, which is exactly what interleaving broke
- **Time order:** every row's rendered timestamp is greater than or equal to the
  row above it (a midnight rollover is unwrapped rather than read as a jump back)

---

# V-CONSOLE-SOURCE-NAMES-FUNCTIONAL: The Console Source Names The Block

The Source column says which block wrote a line (EXEC-25): the type's
palette name alone when the block's Name is empty, is the palette name
or is the catalog's name for the type, else `{palette name} : {Name}`.
A block's Description, its type id and its block id never show there.

## Prerequisites

- Backend and frontend running (standard functional-stack ports)
- Shared E2E environment present (created by `ensureEnvironment` at test start)
- E2E service stack up: `sshd` (9445), `http-echo` (9450) and `kwok` (9460)

## Fixtures

- `fixture-source-names.json` - one chain with a block of every kind the
  rule names: Log blocks named `Log`, with an empty Name and `Say hello`;
  HTTP blocks named `HTTP Client` and `GET http://host/x`; SQL blocks
  named `SQL` and `Run PSQL Proc` on a SQLite file; CSV, Var Setter,
  If / Else, Switch, Try / Catch, For Loop, For Each and While Loop; a
  Function with a Log block in its body; SSH Session Open, Exec and
  Close; a Remote Execution with a Python block in its body; K8s Connect
  and K8s Get. Every block carries a Description.
- `fixture-source-names-drop.json` - one SQL block named `SQL`; the spec
  drops a second SQL block from the palette beside it.
- `fixture-source-names-stop.json` - a Function named `Open the portal`
  whose body logs one line and then holds a Delay named
  `Wait for the login`.
- `fixture-source-names-stop-switch.json` - a Switch named `Switch/Case`
  whose case logs one line and then holds a Delay.
- `fixture-source-names-stop-remote.json` - a Remote Execution named
  `On the far host` whose body is a Python block that sleeps on the
  stack's `sshd`.

## Steps

1. Names run: listen to the browser console, import
   `fixture-source-names.json`, open it, set the console Level to
   `DEBUG`, press Run and wait for the last line. Read every row from
   its copy text. Drag the Source column to its widest and read the
   rows as shown. Generate the session report and read its log rows.
2. Dropped block: import `fixture-source-names-drop.json`, drop a SQL
   block from the palette, set it to a SQLite file and a one-line
   script in its config sheet, and Run Current on it.
3. Stop inside a Function: import `fixture-source-names-stop.json`, run,
   wait for the Delay's `Delay: waiting 60000 ms` line, press Stop and
   confirm.
4. Stop inside a Switch: the same with
   `fixture-source-names-stop-switch.json`.
5. Stop inside a Remote Execution: import
   `fixture-source-names-stop-remote.json`, run, wait for the body
   block's `Running the script ... on the remote host` line, press Stop
   and confirm.
6. Level select: choose each of the five levels in turn and measure the
   trigger in the page.

## Validation

- **Type name alone:** `Log` for the block named `Log` and the one
  with an empty Name, `HTTP` for `HTTP Client`, `SQL` for `SQL`
- **Type and Name:** `SQL : Run PSQL Proc`, `Log : Say hello`;
  the dropped block is named `SQL_1` and writes under `SQL : SQL_1`
- **No Description:** no Source holds any block's Description
- **Palette names:** the run's Sources are exactly the expected
  list (`SSH Session Exec`, `K8s Get : Read the namespace`,
  `Var Setter`, `If / Else`, `Try / Catch`, `HTTP`, `CSV`, ...); none
  holds a type id or a block id; a Switch named `Pick a route` writes
  its `Branch taken` line under `Switch : Pick a route`; a stopped
  Switch named `Switch/Case` is marked `Switch`
- **Colon in a Name:** `HTTP : GET http://host/x` in the copied
  text, in the Source cell once the column is wide enough, and in the
  report
- **Remote body, Function body, loops:**
  `Python : Count on the host`, `Log : Say welcome`,
  `For Loop : Count to two`, `For Each : Each host`,
  `While Loop : Until done`
- **System lines:** the engine's lines keep `SYSTEM`; a
  Function's own lines keep `FUNCTION`
- **Stopped marks:** two WARN `Stopped by user` lines,
  `Function : Open the portal` and `Delay : Wait for the login`; no
  line shows a block id. A stopped Remote Execution is marked
  `Remote Execution : On the far host` and its body block
  `Python : Hold on the host`
- **React warning:** the browser console holds no
  `Cannot update a component` line after the load or after the run.
  The bundled app prints no React development warnings, so here the
  check proves only that the page loads and runs with no error; the
  test that fails when the warning returns is
  `frontend/tests/features/workbench/common/canvas/workflow-node/node-description.test.tsx`
- **Level select:** the trigger is 96 px wide and reads each
  level whole: the word fits its box and ends before the arrow
