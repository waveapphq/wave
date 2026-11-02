# V-FN-REQUIRED-INPUT: a Required Function input and running a Function alone - Functional

End-to-end coverage of a Required Function input (REQ-3.1.2.10, REQ-3.1.3.21, FNCFG-8,
VMGR-103, VMGR-107, VMGR-113): for every type the input window keeps the default and locks Set to
null off, a default on a Required input is kept on save, the Current value the author sets before a
run of the Function alone is the value the run uses, also right after Reset, and with no value the
run stops and names the input; a read-only definition (library View, a library Function Block
drilled into) opens the input window with only the Current value editable; a library Function Block
whose Required input is given a variable holding null fails a Test run.

Spec: `v-fn-required-input-functional.spec.ts`.

## Pre-requisites

- Backend and frontend on the per-worker ports (Playwright fixtures).
- The shared environment `E2E Execution Env` (provisioned by `ensureEnvironment`).
- No stack services.
- Seeds (API): `zz-` library Functions with a Required string input and a body Log printing
  it (deleted with `cascade=true`); `zz-` Tests holding a Local Function with the same input
  (the Function Block gives it the expression `'caller'`), an empty Local Function, or the library
  Function's Block with no value for `who` next to a declared variable `who_src` with no value
  (stored through the admin bulk path, since a Required input with no value refuses `POST /tests`);
  all deleted afterwards.
- The two kept-default tests seed the Required input `dflt_who` with the default `old`.

## Steps

1. Library, Current value: open the library Function in the View, enter edit mode, set the
   Current value of `who` to `ann` in its window (pencil, Current), Run; Reset; Run again.
2. Library, no value: open the read-only View, check the `who` row shows `null`, Run.
3. Input window: in an empty Local Function, Add > Input parameter once per type (string,
   integer, float, boolean, array, map, table), type a default where the type has one, tick
   Required, try to tick Set to null (click, label click, Space), Create; Save the Test.
4. Kept default, Local: move the Function Block and Save the Test from the toolbar.
5. Kept default, library: in the View edit mode add a local variable and publish a new version.
6. Local, Current value: drill into the Local Function, set `who` to `ann`, Run; Reset; Run.
7. Local, no value: drill into the Local Function and Run.
8. Library Function Block: open the Test, give `who` the expression `who_src` in the Block's
   sheet, Save, Run.

## Validation

- Steps 1 and 6: both runs print `who=ann` (step 6 never prints the Function Block's `caller`).
- Steps 2 and 7: the run fails, the body Log prints nothing and the console carries the ERROR line
  `'who' is null`.
- Step 3: the default stays in its field; Set to null stays unticked with `aria-disabled="true"`
  and the hint `off while Required is set`; a Boolean input has Set to null off before Required is
  ticked, with the hint `off for a Boolean input`; every saved input is Required, and the String,
  Integer, Float and Boolean inputs keep the default typed (`true` for the Boolean).
- Steps 4 and 5: the saved input, and the published version's input, keep the default `old`.
- Drilled into the library Function Block, and in the library View: the pencil opens
  `Edit input parameter` with Name, Type, Description and Required locked and the default read-only
  (`dflt` in the View); the Current value saved there is what the run prints; the row delete stays
  locked and the Test save stays off.
- Step 8: the run fails, the Function Block paints `failed`, the console names `'who' is null`
  and the body Log never prints.
