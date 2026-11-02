# V-VAR-RENAME-REFACTOR-FUNCTIONAL: Rename Refactors All References

Verify that renaming a variable in its window (VMGR-106, VMGR-108) refactors EVERY reference across
the saved Test, that the old name survives nowhere, that the rename is never silent, and that the
run reads the new name everywhere.

## Prerequisites

- Backend running on the worker's backend port.
- Frontend running on the worker's frontend port.
- The shared E2E execution environment (created by the import helper).
- No fixtures need to be pre-seeded; the spec imports its own fixture.

## Fixtures

- `fixture.json` - one Test with Test variable `widget_id` (integer) referenced across:
  - a Variable Setter TARGET (`widget_id = 7`)
  - a Variable Setter per-key EXPRESSION value (`doubled = widget_id * 2`)
  - a Variable Setter per-key TEMPLATE value (`caption = id is {{ widget_id }}`)
  - a Log TEMPLATE field (`Total {{ widget_id }}`)
  - a Log EXPRESSION field (`str(widget_id)`)

## Steps

1. Import `fixture.json` via `POST /tests` and check `POST /tests/{id}/validate` returns zero errors.
2. Navigate to `/workbench?editTest=<testId>`, wait for the canvas, expand the Variable Manager.
3. Pencil `widget_id`; type `doubled` in the Name field, then `widget_id` again.
4. Type `gadget_key`; Save the window.
5. Save the Test and read it back from `GET /tests/<testId>`.
6. Run the Test.

## Validation

- Step 3: `doubled` shows `A variable with this name already exists` and Save is disabled; the own
  name shows no error and no notice, and Save is enabled.
- Step 4: the notice reads `Renaming updates all references to widget_id across the test.`; after
  Save the row is `gadget_key` and no `widget_id` row is left.
- Step 5 (persisted Test):
  - The serialized workflow and variables contain `gadget_key` and NOT `widget_id` anywhere.
  - The variable definition is renamed (`gadget_key`, not `widget_id`).
  - Setter target key + `variableTypes` renamed to `gadget_key`.
  - Setter expression value is `gadget_key * 2`; template value is `id is {{ gadget_key }}`.
  - Log template field is `Total {{ gadget_key }}`; Log expression field is `str(gadget_key)`.
- Step 6: the run passes and the two Logs print `Total 7` and `7`.
