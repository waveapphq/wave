# V-FN-LOCAL-VAR-EDITS: a Function's own variable edited between block runs

Verify that a Function's local variable no block wrote follows its definition on the next
Run Current inside that Function, that one a block wrote keeps the block's value, and that
the Variable Manager row shows the edit before the next run starts.

Spec: `v-fn-local-var-edits-functional.spec.ts`. Fixture: `local-var-edits-fixture.json`.
Shared steps: `fn-adhoc-drive.ts`.

## Prerequisites

- Backend and frontend of the run's own stack (the Playwright fixtures pick the ports).
- The shared E2E execution environment (created on demand).
- No seed script: each test imports the fixture through `POST /tests` under its own name,
  checks that it validates with zero errors, and deletes it afterwards.

The fixture is one local Function `Local_Vars` with two integer local variables:
`fn_plain = 100`, which no block writes, and `fn_kept = 5`, which the Variable Setter
`Write Kept` sets to 500. The Log `Read Locals` prints `fn-read:<fn_plain>:<fn_kept>`.

## Steps

Every test starts the same way: open the Test, pick the environment, Run, open the Function
with its dig-in glyph and expand the Variable Manager.

1. **A variable no block writes** - change `fn_plain` to 200 with the row's pencil and Run
   Current on `Read Locals` from its kebab; change it to 300 and Run Current again.
2. **A variable a block wrote** - change `fn_kept` to 6 with the pencil, switch the row to
   its definition view with the eye, and Run Current on `Read Locals`.
3. **The row** - change `fn_plain` to 200 with the pencil and start no run.

## Validation

- **Full run:** the console holds exactly one `fn-read:` line, `fn-read:100:500`.
- **Step 1:** after the first Run Current the `fn-read:` lines are `fn-read:100:500` and
  `fn-read:200:500`; the second adds `fn-read:300:500`. Each Run Current adds one line.
- **Step 2:** the `fn_kept` row shows `500` before and after the edit, and `6` in its
  definition view; Run Current adds a second `fn-read:100:500` and no line ending in `:6`.
- **Step 3:** the `fn_plain` row shows `100` after the run and `200` after the edit, still
  in its live view (open eye), and the backend holds the same finished session as before
  the edit.

# V-FN-LOCAL-EXPRESSION-VARS: Function-local and output kinds at run (VMGR-99)

Spec: `v-fn-local-expression-vars-functional.spec.ts`. No fixture.

## Prerequisites

- Each UI test seeds one blank `zz-` Test; the library test publishes a `zz-` library Function
  (deleted with `cascade=true`) and seeds a Test holding its Shared block with the output bound.

## Steps

1. Drag a Function from the palette under Start, drill in and make its declarations with the Add menu:
   a local Expression of every type plus a Template local; or an integer input `n` = 3 with an
   Expression output of every type and a Template output; or an output that fails at return
   (`1 / 0`), or a Template output over an input set to null.
2. Drop a Log under the body's Start; for the outputs, bind each one to a new variable in the Function
   Block window. Save, Run.

## Validation

- Locals: one Log prints `abc|5|4.5|True|[1, 2, 3]|{'k': 6}|2|t-5`.
- Outputs: the bound variables hold `n3`, 5, 4.5, true, [3, 6], {k: 6}, a table of `k` rows 3 and 6,
  and `id-3`, each typed as its output.
- Failing outputs: the run fails with `Output 'o_bad': Expression evaluation failed for '1 / 0':
  division by zero` and `'{{ note }}' in 'o_label' is null`, after the body ran.
- Library: the published body prints `lib 5` and the bound variable holds 6.
- Declared types: a table Expression variable of the root flow and of a Function reads as a table
  (`['k']` column names in the body) and a float Expression variable holds the exact float `4.5`.
- A table Expression output that is not rows fails the Function Block: `Output 'o_rows': Parameter 'o_rows'
  expects table, got list`.
- A float holding a whole number (typed in the window, seeded as `5`, or computed `2 + 3`) reads typed
  float with the text `5`.

# V-FN-LOCAL-SECRET-CURRENT-FUNCTIONAL: Current values of a Function's own secrets in the run log

Spec: `v-fn-local-secret-current-functional.spec.ts`. No fixture file (the Test is built in code).
Shared steps: `fn-adhoc-drive.ts`.

## Prerequisites

- The shared E2E execution environment.
- Each test seeds through `POST /tests` (zero validation errors) a root Log, then a Local Function
  declaring the secret local `fn_tok` and the secret output `fn_out` (a default); its body Log prints
  each whole value and its last six characters, so the line proves which value ran without showing it.

## Steps

1. **Before any run** - drill into the Function and give `fn_tok` and `fn_out` new Current values in
   their Edit windows (row pencil, pill Current, Delete & Edit on the masked field, type, Save); back
   at the root, Run.
2. **Held while paused** - set a breakpoint on the root Log and Debug to the pause; drill in and give
   `fn_tok` a Current value the same way; Stop before the run reaches the Function; then Run Current on
   the Function Block.

## Validation

- **Step 1:** the body line reads `tok=******** tail=<last six of the new local> out=******** otail=<last
  six of the new output>`; no console line holds either value.
- **Step 2:** the stopped run printed no `tok=` line; the Run Current body line reads the held local's
  tail with both values masked, and no console line holds the value.
