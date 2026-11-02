# V-FN-SCOPE-LOCALVAR-01: self-referencing local variable (reproduce-first)

Verify a Function body that references its own declared LOCAL variable saves
clean - no false `UNRESOLVED_VARIABLE_REFERENCE`, no node alert, no drill crash.

## Prerequisites

No external seed script. The spec self-seeds via `POST /tests` (a VALID
baseline): a local Function `Function_1` declaring the local variable `subtotal`
in the canvas ARRAY shape (`[{name,type,value}]`), whose inner Log reads the bare
name `subtotal`.

## Steps

1. `POST /tests` with the Function above (this is the reproduce-first gate: the
   create must SUCCEED).
2. Open `/workbench?editTest={id}`.
3. No validation dialog appears; the Function node carries no alert badge.
4. Drill into the Function body - the inner Log renders (no crash).
5. `GET .../validate?context=run` is clean - no `UNRESOLVED_VARIABLE_REFERENCE`.

## Validation

- Guards the BE `_function_scope_names` array bug: it must collect local-variable
  names from the array shape, not only a dict. Against the pre-fix dict-only
  collector the body ref is flagged `UNRESOLVED_VARIABLE_REFERENCE` and
  `POST /tests` returns 422 - so step 1 FAILS if the fix is reverted.
- Guards the FE `useFunctionScope`/`varNamesFrom` array handling (steps 3-4).
