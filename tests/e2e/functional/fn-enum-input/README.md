# V-FN-ENUM: enum Function inputs - Functional

End-to-end coverage of enum Function inputs (REQ-3.1.2.11, VMGR-100, VMGR-104, VMGR-112, FNCFG-6,
FNCFG-9): the input window creates an enum from allowed values of its Type (String, Integer or
Float) with a default picked from them, and the Function Block window offers the allowed values as a
select. A pick is stored as the literal of its Type and reaches the body typed; a pick the library
version switched to no longer holds is dropped, so the Save names the empty input; a Local Function that drops a picked value empties the
Function Block, so the save and a run name the input; a variable or expression outside the list
fails the Function Block when the run starts; a recipe value outside the list is refused. The Function Block window spec also checks that a number typed into a
literal-mode integer input is the field value the Block saves (REQ-3.1.1.5).

## Pre-requisites

- Backend and frontend on the per-worker ports (Playwright fixtures).
- The shared environment `E2E Execution Env` (provisioned by `ensureEnvironment`) for the runs.
- The MCP listener, enabled until restart on the stack's own port by the recipe test and reset
  after it.
- No stack services.

| Spec | What it builds | Seeds (API) |
|------|----------------|-------------|
| `v-fn-enum-create-functional.spec.ts` | In the input window of a Local Function: one enum per Type (String `low`, `high`; Integer `1`, `2`; Float `0.5`, `1.5`) with Create enum and a picked default, each with a wrong-typed value (`true`, `abc`) typed into Allowed values and taken out again; an input that ticks Mark as secret instead; an enum with no default picked; a Local Function enum narrowed to `low` while its Function Block picked `high` | per test a `zz-` Test holding one empty Local Function; for the narrowed enum a library Function (`low`, `high`, with a version 1.1.0 listing only `low`) and a Test whose library Function Block on 1.0.0 and Local Function Block both pick `high` |
| `v-fn-enum-call-functional.spec.ts` | A String enum `level` built in the input window of a dropped Local Function; the Function Block windows of that Function, of a seeded Local Function and of a library instance; picks `high`, `2`, `1.5` saved and run; a version switch that leaves the picks outside the new lists; an expression typed per Value Type; a `5` typed into the literal-mode integer input `n`; recipes over MCP (create, read back, amend) | library Functions with `level_str`, `level_int`, `level_float` (deleted with cascade; one gets version 1.1.0 with other allowed values after the pick); `zz-` Tests holding Local Functions and library instances with those enum inputs in their stored shape; per Value Type a `zz-` Test with a variable `pick` outside the list; a `zz-` Test holding a Local Function with the optional integer input `n` read by a body Log |

## Steps

1. Seed the Test (and the library Function) through the API and open the Test.
2. Create spec: dig into the Function, Add > Input parameter, pick the Type, Create enum, add each
   allowed value in the "Edit value" window and pick the default; type a wrong-typed list into
   Allowed values and put the right one back; Create, save the Test and read it back; reload.
   Tick Mark as secret and Create enum in turn. Tick Create enum with no default picked. Narrow the
   Local Function's allowed values to `low`, open both Function Blocks, press Save and Run, then
   pick `low` in the Local Block, save and Run. The Function Block, which exists before each
   window-made enum, starts on its default with nothing left to save (FNCFG-9).
3. Function Block spec: build `level` in the window, pop to the Test, and double-click each Function
   to open its Function Block window; pick a value of each enum, Save the window and the Test, and
   Run; switch the library Function Block to version 1.1.0 and Save; give `level` an expression and
   Run; for the literal case type `5` into `n`, Save, save the Test and Run; validate, create, read
   back and amend the recipes over MCP.

## Validation

- Create: no enum error and Create enabled for every Value Type; an enabled Create adds the
  input row; the list shows each value's Type read-only (columns #, Value, Type; no Type picker).
- Wrong type: `Allowed value at index 2 (true) is not a valid string` (and `(abc)` for integer and
  float) under the list, Create off until the value goes.
- Stored: the Type, `enumValues` typed (`["low", "high"]`, `[1, 2]`, `[0.5, 1.5]`),
  `required: true`, the picked `default`, no `secret`; the input is back after a reload.
- Exclusion: "off while enum is set" / "off while secret is set"; the secret input is stored with
  no enum keys, the enum input never secret.
- No default picked: the Default value caption carries the red star; the Default select reads
  `Default value is required` and Create is off;
  Required is locked on (`locked on while enum is set`), Set to null is off and locked
  (`off while enum is set`); once a value is picked the input is stored with it as `default`.
- Narrowed Local enum: the Local Function Block's select is empty and offers only `low`, the library
  Function Block still shows `high`; Save opens "Cannot Save Test" with
  `Required parameter 'level' is missing` and nothing is stored; Run without saving is refused with
  `Cannot Run Test` naming the same; once the Local Block picks `low` the run passes, logging
  `S=high` from the library Block on 1.0.0 and `L=low`.
- Call: each enum input row holds a select whose options are its allowed values in order, on a
  Local Function and on a library Function, for String, Integer and Float; an enum input added
  after the Block exists starts on its default (`low`).
- Picks: stored in `config.values` as `high`, `2`, `1.5`; each body prints `S=high I=3 F=3.0`.
- Stale pick: after the switch to 1.1.0 each select reads `Select…`, the Block's alert lists
  `Required parameter '<input>' is missing` for each Type, and Save opens "Cannot Save Test" with the
  same; the stored Test keeps version 1.0.0 and its picks.
- Run start: the Function Block fails with `Block 'Enum_Run' failed: Parameter 'level' must be one of:
  <list>; Actual value was '<value>'.`; the body never runs.
- Recipe: `validate_recipe` and `create_test_from_recipe` refuse each value outside its list
  with `INVALID_ENUM_VALUE` `Setting '<input>' of block 'pick_level' must be one of: ...` and
  create nothing; listed values validate clean, create a Function Block holding them, read back as
  the same `- function:` step with `settings`, and an amend of the readback changes the value on
  the same Block.
- Literal: the stored field value of `n` is `5` (`config.values`, no expression field) and the
  body prints `5`.
- Every Test is deleted after its test; library Functions are deleted with `cascade=true`; MCP
  settings are reset.
