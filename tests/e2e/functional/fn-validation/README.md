# V-FN-VAL-* : Function validation completeness (REQ-3.1.2.4)

Canonical, recursive, path-aware, Save/Run-consistent Function validation. Nine
specs; all but `v-fn-block-save-refusals-functional` use
`tests/e2e/helpers/fn-seed.ts` (raw-persist + library-publish + node-builders +
the validate-contract helper), and the four `v-fn-block-*`, `v-fn-flow-*` and
`v-fn-input-*` specs use `tests/e2e/helpers/fn-block.ts`.

## Prerequisites

No external seed script. Each spec self-seeds. States that the canonical
pipeline now blocks at the write path (missing version, missing id, a literal
of the wrong type, a nested body or Function flow the save refuses) are
raw-persisted through
`POST /admin/bulk/tests` (which bypasses save validation); valid baselines use
`POST /tests`. Library entries are created via `POST /functions`. Admin mode is
enabled per stack (`WAVE_ADMIN_ALLOWED=true`).

## Specs

### v-fn-val-paths-01 (path rows + drill navigation)

1. Raw-persist a 2-deep nested Local body `Outer_Fn > Inner_Fn > Log_1` whose
   leaf `Log_1` leaves its required `message` empty. Open `/workbench?editTest=`.
2. The validation dialog renders the row `Outer_Fn / Inner_Fn / Log_1 - Required
   parameter 'message' is empty` (segments + leaf are buttons; message after `-`).
3. Clicking the `Inner_Fn` segment drills into Inner_Fn and dismisses the dialog.
4. Clicking the row drills to + selects the failing leaf (`data-selected="true"`).
5. The save modal ("Cannot Save Test") surfaces the same path row.

**Validation:** `function_path` is rendered root-to-leaf; `navigateToIssue`
drills by segment depth (segment) or full path + leaf select (row); the dialog
dismisses on navigation. Save-context parity surfaces the identical row.

### v-fn-val-ver-01 (top-level missing-version gate, reproduce-first)

1. Publish a library Function at `1.0.0`; raw-persist a Test with a top-level
   Shared instance pinned to the absent `2.0.0`.
2. `validate?context=run|load|import` returns 422 with `MISSING_FUNCTION_VERSION`
   and the exact message `Pinned version 2.0.0 is no longer available in the library`.
3. `POST /tests` (Save) returns 422.
4. A disabled instance pinned to `2.0.0` is exempt (clean); a pin to `1.0.0` is clean.

**Validation:** the gate blocks Validate/Save/Run; disabled nodes and available
pins are clean; the message drops the raw Function UUID. Reproduce-first:
fails if the gate is reverted.

### v-fn-val-schema-01 (pinned-contract field and type checks, reproduce-first)

1. Publish a library Function `1.0.0` with a required input `user_id` (string).
2. A Function Block with no value for `user_id` -> `POST /tests` 422 +
   `REQUIRED_PARAM_MISSING` ("Required parameter 'user_id' is missing").
3. A Function Block holding `user_id` = `abc` -> `validate` clean, and the write
   path accepts it.
4. A Function Block holding the integer `123` for `user_id` (raw-persisted) ->
   `validate` 422 + `INVALID_SETTING_TYPE` ("Setting 'user_id' of block
   '<Function name>' expects string, got integer").

**Validation:** the pinned version's inputs are the Function Block's fields and
go through the one field check every Block gets.

### v-fn-val-fixall-01 ("Fix All" gated on the auto-fixable subset)

1. Content-only (missing param + missing version): the load dialog headline reads
   "2 item(s) must be resolved manually", there is NO Fix All, every Fix cell is `-`.
2. Mixed (+ a fixable dangling edge): Fix All IS present, the headline reads
   "1 of 3 item(s) can be automatically fixed", the fixable row shows its action
   and the content rows show `-`.

**Validation:** invariant "Fix All shown <=> >=1 row has a real Fix". (Fix All
execution is covered by `tests/e2e/visual/canvas/v-validate-load-01.spec.ts`.)

### v-fn-val-expression-output-01 (names in a Function's own Expressions, REQ-3.1.2.4)

1. Stored shapes (admin bulk route, no save check): a Local Function whose local or Output Expression
   names an unknown name (`nope + 1`), reads itself (`selfy + 1`), or forms a cycle with a second one
   (`cy_a` / `cy_b`, `o_a` / `o_b`).
2. In the window: a seeded Test holding one Local Function; the local `bad = nope + 1` and the Output
   `o_bad = gone * 2` are typed into the in-Function create window and the Test is saved; a self
   reference and the second half of a cycle are typed and the field left.

**Validation:** validate reports `UNRESOLVED_VARIABLE_REFERENCE` `Variable '<name>' is not defined in
this Function's scope (inputs, outputs, and local variables)` or `EXPRESSION_CYCLE` `Circular
dependency detected while evaluating expression variable '<name>'` (the first of a cycle in declaration
order) and `POST /tests` answers 422. The window takes an unknown name and the toolbar Save is refused
with the Cannot Save Test dialog naming both; the window refuses a self reference and a cycle with its
cycle error and a disabled Create.

### v-fn-block-flow-rules-functional (a Function flow's read-only and scope rules)

1. Raw-persist a Test with a Local Function `Rules_Fn` (Integer input `x`, given 7 by its Function Block)
   whose flow holds a CSV Parser writing its Row Count to `x` and a Log printing `str(suite.x)`.
2. The save check reports `INPUT_WRITE_FORBIDDEN` `Writes to declared input 'x'; inputs are read-only`
   and `EXTERNAL_SCOPE_READ_FORBIDDEN` `Reads variable 'x' from external scope 'suite'; only the
   Function's own scope is visible`; drilled into the Function flow, the CSV Parser's and the Log's alert
   badges list them.
3. The Log reading `str(x)` and the CSV Parser writing the local `count` lose their badges; the Test saves
   and its run passes, printing `7`.

### v-fn-block-save-refusals-functional (what a Function save refuses, API saves)

Each case is saved through the library save (`POST /functions`) and, where it applies, as a Local Function
body or a Shared Function Block's edit-mode draft inside a Test (`POST /tests`).

1. An unknown control type `x` is refused with `UNKNOWN_BLOCK_TYPE` `Unknown block type: 'x'`, and a Log
   whose expression appends to a list with `EXPRESSION_CHANGES_DATA`, on every save surface; nothing is
   stored.
2. A library save with a 65-character Block description is refused with `DESCRIPTION_TOO_LONG` `Block
   description must be at most 64 characters`; 64 characters save.
3. A true / false input with no default, optional or Required, is refused with `BOOLEAN_INPUT_NO_DEFAULT`
   `Boolean input 'flag' needs a default` in an edit-mode draft and a library save; with the default
   `false` the Test saves and the stored draft keeps it.

### v-fn-flow-save-checks-functional (the save checks every Block of a Function flow)

Each case is saved on the library save, a Local Function body and a Shared Function Block's edit-mode
draft.

1. A muted Log with no message and a muted Shared Function Block with an empty Required input never block
   a save; the stored Local body runs through the UI and passes with only the unmuted Log printed.
   Unmuted, the same Blocks are refused with `Required parameter 'message' is missing`, `Setting 'level'
   of block 'log' expects string, got integer` and `Required parameter 'who' is missing`.
2. An undeclared name in a Template's `{{ }}`, in an output target and in a Variable Setter target is
   refused with `UNRESOLVED_VARIABLE_REFERENCE` `Variable 'nope' is not defined in this Function's scope
   (inputs, outputs, and local variables)` and nothing is stored; the same sites with declared names save.
3. A Variable Setter writing a declared input is refused with `INPUT_WRITE_FORBIDDEN` and no
   undeclared-name finding.

### v-fn-input-type-check-functional (an Integer input given text by an expression)

1. Seed a Test with the variable `label_text` (string `abc`) and a Local Function `Typed_Fn` whose
   Required Integer input `n` holds 3 on its Function Block.
2. Switching `n` to {x} asks first; Clear, then `label_text`, saves and stores `n` as the expression
   `label_text`.
3. The run fails at the Function Block with `Function 'Typed_Fn' completed with status failed: Parameter
   'n' expects integer, got str`; the body Log never prints.
4. With `len(label_text)`, which gives an integer, the same Function runs and prints `n=3`.
