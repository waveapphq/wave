# V-VMGR-INSPECT: Variable Inspect Modal Fixtures

Test definitions consumed by `tests/e2e/visual/canvas/v-vmgr-03.spec.ts`
(visual, `fixture.json`), `v-vmgr-03-live.spec.ts` (scalar live update,
`fixture-live.json`), `v-vmgr-04.spec.ts` (complex bodies visual,
`fixture.json`), `v-vmgr-04-live.spec.ts` (complex live values + declared
secret, `fixture-live-complex.json`), `v-vmgr-05.spec.ts` /
`v-vmgr-05-live.spec.ts` (expression views idle + evaluation transition,
`fixture-expression-views.json`), and `v-vmgr-06.spec.ts` (Compare mode
static states, `fixture.json`) / `v-vmgr-06-live.spec.ts` (Compare mode live
delta, `fixture-live-complex.json`). They drive the per-variable inspect
modal.

## Prerequisites

None - each spec imports its fixture via `POST /tests`, then navigates
`/workbench?editTest={id}`. No seed script. The live specs additionally
ensure the shared `E2E Execution Env` environment exists and validate
the fixture (`POST /tests/{id}/validate`, zero errors) before running it.

## Steps

`fixture.json` (visual specs - the workflow is never run):

1. Open watchers from the panel rows' expand buttons.
2. V-VMGR-03 exercises modes, footer metric, resize grips, stacking, scope
   drill (Function_1), and reload persistence; it injects a ~300-line string
   into `huge_log` before import for the viewport-cap scenario.
3. V-VMGR-04 exercises the complex typed bodies, the View dropdown + Code
   view, complex metrics, empty / initial states, and the 500-row Visual cap;
   it injects 512 integers into `big_list` before import.
4. V-VMGR-06 exercises Compare mode static states: the Mode menu's third
   Compare entry, the two-pane split (dim+italic Initial vs normal Current,
   hairline divider), the always-arrow delta metric for string / array /
   table (`3 -> 3 chars` / `5 -> 5 items` / `3 -> 3 rows`), the View dropdown
   driving both panes, and the expression scalar (`api_url`) source/evaluated
   panes with the disabled `Literal` View and `expression -> no value yet`.

`fixture-live.json` (V-VMGR-03 live spec - the workflow runs once per scenario):

1. Open a watcher on `greeting` while idle.
2. Run: Var Setter writes `"hello from runtime"`, Delay (2500 ms) holds the
   run open, Log reads `greeting`.
3. Reset the workflow from the breadcrumb afterwards.

`fixture-live-complex.json` (V-VMGR-04 live + V-VMGR-06 live specs):

1. Open a watcher on `metrics` while idle (definition `[1, 2]`).
2. Run: Var Setter writes a 6-element mixed array, Delay (2500 ms) holds,
   a second Var Setter mutates `metrics` to a 3-element array mid-run,
   a second Delay holds again, Log reads `metrics`.
3. The secret scenario re-imports the fixture with `token` declared secret,
   runs, and reads `GET /workbench/{session_id}/variables`.
4. V-VMGR-06 live opens the `metrics` watcher in Compare and asserts the
   Current pane resolves the full 6-element then 3-element runtime array while
   the Initial pane stays the `[1, 2]` definition, the delta metric flipping
   `2 -> 2 items` -> `2 -> 6 items` -> `2 -> 3 items`.

`fixture-expression-views.json` (V-VMGR-05 visual + live specs):

1. V-VMGR-05 (never runs the workflow): open watchers on `service_name`
   (literal scalar), `api_url` (string expression), and `service_matrix`
   (array expression) and exercise the per-kind View dropdown families,
   the idle empty state, the Expression view, and the Initial lock.
2. V-VMGR-05 live: open BOTH expression watchers while idle, then run; the
   Log's message expression (`expressionFields: ['message']`) references
   both variables so the engine realizes them lazily during the run and the
   open watchers transition in place.

## Validation

`fixture.json` variables cover every modal state:

- **Scalar literals**: `user_name` (string "bob"), `attempt` (integer 1),
  `debug_log` (boolean true), `ratio` (float 0.5) - compact 320px watchers
  for the numeric / boolean literals, 400px for strings.
- **Expression row** (`api_url`): `{x}` header badge; idle opens in the
  Literal view with the "Not evaluated yet." empty state; the Expression
  view shows the cyan source with the `expression` metric.
- **Secret row** (`password`): expand visually disabled,
  "Secret values cannot be expanded" tooltip.
- **Huge string** (`huge_log`): watcher height caps at the viewport, footer
  stays reachable, body scrolls.
- **Complex rows** (expand ENABLED, typed bodies):
  - `items` (array, 5 mixed elements incl. a nested map and null) - index
    column, per-element tints, nested one-line JSON, `5 items` metric.
  - `headers` (map, 4 mixed-type entries) - key column, value tints,
    `4 keys` metric.
  - `results` (table dict, typed columns, 3 rows x 4 cols) - `#` index
    column, sticky uppercase header, per-cell tints, 480px default width.
- **Empty complex values**: `empty_list` (`no items` / `0 items`),
  `empty_map` (`no entries` / `0 keys`), `schema_only` (0-row table with a
  3-column schema: the `#`, `id`, `name`, `ok` header above `no rows` /
  `0 rows x 3 cols`).
- **500-cap array** (`big_list`): spec injects 512 integers; Visual renders
  500 rows + `+ 12 more - switch to Code view`; Code view has no cap.
- **Expression-typed array** (`computed_items`): Visual view default with
  the "Not evaluated yet." empty state; the View dropdown carries the
  three-item Visual / Code / Expression family; the cyan source lives in
  the Expression view.
- **Local Function** (`Function_1`: input `user_id`, local `fn_tmp`): scope
  drill keeps test-level watchers visible; a Function-local watcher survives
  the pop-back.

`fixture-live.json`:

- **Idle parity**: watcher Current equals Initial (`"hello"`) before the run.
- **Live update**: Current becomes `"hello from runtime"` during/after the
  run while Initial keeps `"hello"`.
- **Reset**: watcher returns to definition parity after breadcrumb Reset.

`fixture-live-complex.json`:

- **Full-value live inspection**: the open `metrics` watcher resolves the
  summary envelope to the FULL 6-element runtime array (first-fetch skeleton,
  then rows), not the panel's `[6 items]` summary.
- **Event-driven refresh**: the mid-run mutation re-fetches and renders the
  3-element array in place (stale-while-revalidate, no skeleton flicker).
- **Declared secret**: a `token` declared secret is masked in the row
  (`********`, SECRET badge), its expand is disabled with the tooltip
  `Secret values cannot be expanded`, and the workbench session variables
  endpoint returns `"********"` for it after a run.

`fixture-expression-views.json`:

- **Literal scalar** (`service_name`, "discovery"): footer renders the Mode
  dropdown only - no View dropdown.
- **Expression scalar** (`api_url`): opens in the Literal view with the
  centered muted italic "Not evaluated yet." line and the `no value yet`
  metric; the View menu lists exactly Literal / Expression (check on the
  selected entry, opens upward); the Expression view shows the cyan raw
  source with the `expression` metric; Initial mode disables the View
  dropdown forced to "Expression" and returning to Current restores the
  view selected before Initial.
- **Expression array** (`service_matrix`): same empty state; the View menu
  lists exactly Visual / Code / Expression.
- **Evaluation transition (live)**: after the run the ES watcher renders the
  evaluated string like a literal (quoted, sky tint, NOT cyan, `43 chars`)
  and the EC watcher renders the evaluated 3-element array rows (`3 items`);
  the Expression view still shows the source after evaluation.

`fixture.json` / `fixture-live-complex.json` (Compare mode, V-VMGR-06):

- **Compare split**: switching Mode to Compare splits the body into Initial
  (left, dim+italic) and Current (right, hairline divider) panes; the View
  dropdown drives both panes; the delta metric renders the always-shown ASCII
  arrow with the unit once at the end.
- **Static deltas** (`fixture.json`, idle - Current degrades to definition):
  string `3 -> 3 chars`, array `5 -> 5 items`, table `3 -> 3 rows`
  (per-pane mini-grids), expression scalar `expression -> no value yet` with
  the panes labeled `Initial - source` / `Current - evaluated` and the View
  dropdown collapsed to a disabled `Literal`.
- **Live delta** (`fixture-live-complex.json`): the Current pane resolves the
  full runtime array off the summary envelope while the Initial pane stays the
  definition; the metric flips `2 -> 2 items` -> `2 -> 6 items` ->
  `2 -> 3 items`.
