# Control Block Fields: Condition Rows, Setter Rows, Lanes and Modes End-to-End

Verify the control Blocks on the one value field: the condition row of If/Else, Switch, Assert, While, Wait Until
and the CSV / Excel filters, the Variable Setter row, the Parallel lane limit, and the mode sections. Each spec
drives the Block window through the UI, reads the stored Test back with `GET /tests/{id}`, and runs it, asserting
log lines, Block statuses and the values the run bound. The save spec sends broken bodies straight to the REST
routes and asserts the exact refusal texts.

## Prerequisites

- Backend and frontend running (standard functional-stack ports)
- Shared execution environment (`ensureEnvironment` creates it if absent)
- No external service: the control Blocks and the save check run inside WAVE and open no protocol, so nothing from
  `tests/e2e/services/` is required
- `fixture-conditions.json` - If/Else `Route by health` and `Match host`, Switch `Pick region`, a split Assert, a
  While whose body is a Setter and a Log, a Wait Until and a CSV Parser with two filter blocks; every path ends in
  a Log that names it (`route=if`, `case=eu`, `assert=pass`, `while=<n>`, `wait=then`, ...)
- `fixture-setter.json` - one Setter with every row form (text, {x}, Template text, secret text, a list with one
  {x} entry, a map, an integer, a secret integer, a secret list), a Local Function whose body Setter writes its
  output, and a Log printing each variable
- `fixture-parallel.json` - the lanes `capped` and `probe`, each a five-second Delay with no limit, and `probe_ms`
- `fixture-modes.json` - a For with Break and Continue, a Try / Catch / Finally, a Parallel, a Wait Until with a
  `retry` lane, a Note, an If/Else and a split Assert, none of their choices stored
- `fixture-untouched.json` - one stored Assert, If/Else, Switch, While, Wait Until, Parallel and Setter
- `v-ctrl-fields-save-functional.spec.ts` builds its bodies inline
- `stored-blocks.ts` - the stored Test and canvas Block reads the specs share

## Isolation on the shared stack

Each test imports its own Test through `POST /tests` under a `zz-ctrl-fields-<spec>-<n>` name, checks
`POST /tests/{id}/validate` has zero errors, asserts only on that Test and its run, and deletes it afterwards.

## Specs

| Spec | Covers |
|---|---|
| `v-ctrl-fields-conditions-functional.spec.ts` | A typed text value stores no flag; {x} on a filled value asks first and Clear & Empty starts at `''`; a Template from the Edit value sheet; a number compare value has no expand and stores its typed text; `is null` on a {x} row asks first and drops the value; the `Edit Condition` and `Edit Value` editor titles; window errors and the card mark; a Variable Manager rename reaching an untouched open window; filter rows in {x} and Template; 880 px control windows and the 672 px CSV Parser window; every row part by role and name; `_cell` offered in an As Integer filter block |
| `v-ctrl-fields-operator-fit-functional.spec.ts` | An operator change keeps a compare value only when it fits the new compare type: `contains abc` to `length equals` asks `Change operator?` first, Cancel keeps it, Change operator drops the value and its flags and holds Save until a new value is typed; a whole number stays with no question; a Template under `length equals` asks and goes |
| `v-ctrl-fields-save-functional.spec.ts` | `POST /tests` refusals for control structure, condition rows, a Template on a number, undeclared names and Setter element types; a read-only refusal at import; `REQUIRED_PARAM_*` as warnings on load; a Function save with a blank {x} Setter row; the workbench Save dialog showing the backend text |
| `v-ctrl-fields-setter-functional.spec.ts` | Setter rows from the window to the run: literal, null, {x}, Template and per-entry {x} rows, secret rows and Delete & Edit, the nameless row, per-row sheets and focus, type changes, the stored flags and the `(scope: function)` line |
| `v-ctrl-fields-parallel-functional.spec.ts` | A lane limit in {x} stores its dotted flag, moves with its lane and stops exactly one lane per run; JOIN MODE stores `values.join` |
| `v-ctrl-fields-modes-functional.spec.ts` | Mode sections keep their ids and store untouched defaults; edges a mode or lane change takes away at Save; the Note's stored text and color; a null For Count; a stored Watch Wait never running its retry lane |
| `v-ctrl-fields-untouched-functional.spec.ts` | Each control window, fresh from the palette and stored, closes on Escape with no unsaved-changes question and leaves the Block unchanged; a fresh Assert reads as Split, a fresh Wait Until as Retry and a fresh Parallel as Wait for all |

## Steps

1. Import the fixture via `POST /tests` and confirm `POST /tests/{id}/validate` reports zero errors
2. Open the Test in the workbench and change the rows through each Block window, as a person does
3. Save the window and the Test, then read the stored Block back
4. Pick the shared environment, press Run, and read the console, the Block statuses and the session variables once
   the run ends

## Validation

- **Conditions:** the stored items hold exactly what the window set (`reference_value`, `reference_is_expression`,
  `reference_is_template`, no compare value under an operator that takes none); the run logs `route=if`,
  `route=template`, `case=eu`, `assert=pass`, `while=1`, `while=2`, `while=3` and `wait=then`, and no line of a path
  it must not take; the Logs of the untaken If/Else and Assert branches never run and those of the untaken Switch
  cases paint `skipped`; `filtered` holds only the row with id `3`
- **Save:** each refusal answers 422 with exactly the listed code and message, and nothing is stored
- **Setter:** the DEBUG `Set variable '<name>' = <value> (scope: test)` lines, the masked console value and the
  stored `expressionFields`, `templateFields`, `elementTypes` and `config.secretFields`
- **Parallel:** exactly one `Branch '<lane>' exceeded its time limit of 60 ms` ERROR per run, the Parallel Block
  `failed` and the verdict `failed`
- **Modes:** the stored defaults and edges, the Note under `config.values`, the passing For and Watch runs
- **Untouched:** no question on close, an unchanged canvas Block and, after a Test save, an unchanged stored Block
