# V-EDGE-IDS: Every Wire Has Its Own Id

Verify that WAVE refuses a workflow whose wires repeat an id, whichever client
sends it, and stores nothing (REQ-5.2.4.3, Error Code Taxonomy: Edge identity).
The finding names the id once: `Edge ID '<id>' is used by more than one edge`.
Nothing is repaired first, because the repairs find wires by their id; that
holds for the Fix endpoint too.

The save, import, restore, run and Fix specs go through the API only. The
load dialog spec opens the stored Test on the canvas; nothing runs a workflow.

## Prerequisites

- Backend running on the worker's backend port. A Test the save refuses is
  stored through `POST /admin/bulk/tests` (`rawPersistTest` turns the admin
  API on first)
- Shared execution environment (`resolveEnvironmentId` creates it if absent)
- `fixture-repeated-ids.json` - two Logs chained from Start, both wires on the
  id `e-repeat`; the specs derive the clean Test (second wire on `e-ei-a-b`),
  the Local Function body and the library Function from it
- `fixture-fix-cross-scope.json` - a Try/Catch whose wire from Start and a
  cross-scope wire out of its try path share the id `e-shared`; the load
  dialog spec also stores it with the wire from Start on `e-ef-start`, so the
  cross-scope wire is its one finding
- `edge-ids.ts` - the fixture reads, the finding text and the answer reads

Every Test is named `V-EDGE-IDS <step> <unique>` and every library Function
`v-edge-ids-fn-<6 hex>`; each test deletes what it stored.

## V-EDGE-IDS-SAVE: every client path refuses it

`v-edge-ids-save-functional.spec.ts`

### Steps

1. `POST /tests` the repeated-id Test
2. `POST /tests` the clean Test, then `PUT /tests/{id}` the repeated-id workflow
3. `POST /tests` a Test whose one Block is a Local Function running the
   repeated-id workflow
4. `POST /functions` a library Function running the repeated-id workflow
5. `POST /tests/import/validate`, then `POST /tests/import`, with the
   repeated-id Test as a JSON file
6. `POST /api/backup/validate`, then `POST /api/backup/restore`, with an
   archive holding only the repeated-id Test (`manifest.json` plus one
   `tests/<id>.json` member)
7. `POST /workbench/run` of the clean Test with the repeated-id workflow sent
   unsaved, then of a stored Test that repeats the id

### Validation

- **Saves:** `POST /tests`, `PUT /tests/{id}` and `POST /functions` answer 422,
  `Test has 1 validation error(s)` (`Function has ...` for the Function), with
  the one finding in `error.details`; no Test or Function of that name is
  stored, and the update keeps the stored wires
- **Local Function body:** the same answer, the finding on the Function Block
  `ei-fn`
- **Import:** the preview marks the Test `fatal` with the finding and nothing
  importable; the import answers 422, code `DUPLICATE_EDGE_ID`, message
  `Cannot import test '<name>'. <finding>`, and stores nothing
- **Restore:** the preview and the result list the Test as `fatal` with the
  finding as its reason; the backup's Test id is not stored
- **Run gate:** both runs answer 400 `VALIDATION_ERROR`,
  `Cannot run test: validation errors: <finding>`

## V-EDGE-IDS-FIX: the Fix endpoint refuses it and drops no wire

`v-edge-ids-fix-functional.spec.ts`

### Steps

1. Store `fixture-fix-cross-scope.json` through `POST /admin/bulk/tests`
2. `POST /tests/{id}/validate?context=load`
3. `POST /tests/{id}/fix`
4. `GET /tests/{id}`

### Validation

- The load validation names `e-shared` once as repeated and names the
  cross-scope wire by that id, with the Fix action
  `Remove the cross-scope edge`
- The Fix answers 422 with the `DUPLICATE_EDGE_ID` finding in `error.details`
- The stored Test keeps every Block and every wire as stored, the wire from
  Start that shares the id with the cross-scope wire included

## V-EDGE-IDS-LOAD: the load dialog offers no automatic fix, and its Fix reports a deleted Test

`v-edge-ids-load-dialog-functional.spec.ts`

### Steps

1. Store `fixture-repeated-ids.json` through `POST /admin/bulk/tests` and open
   it on the canvas
2. Store `fixture-fix-cross-scope.json` the same way, read
   `POST /tests/{id}/validate?context=load`, then open it on the canvas
3. Close each load dialog, then `GET /tests/{id}`
4. Store `fixture-fix-cross-scope.json` with the wire from Start on
   `e-ef-start`, read `POST /tests/{id}/validate?context=load`, open it on the
   canvas, `DELETE /tests/{id}` while the load dialog is open, press Fix All,
   then Close the dialog that follows

### Validation

- **Repeated id alone:** the `Test Issues Found` dialog lists
  `Edge ID 'e-repeat' is used by more than one edge` once with `-` in its Fix
  cell, offers no Fix All and reads `must be resolved manually`
- **Beside a fixable finding:** the load validation gives the cross-scope wire
  the fix action `Remove the cross-scope edge` and the repeated id none; the
  dialog lists `Edge ID 'e-shared' is used by more than one edge` once with
  `-` in its Fix cell, offers no Fix All, and its headline does not say any
  item `can be automatically fixed`, because the Fix endpoint refuses the Test
- **Close:** the Test stays open on the canvas with every Block, and the stored
  Test keeps every wire as stored
- **Fix on a deleted Test:** the load validation lists no repeated id and gives
  the cross-scope wire `Remove the cross-scope edge`; the dialog offers Fix All
  and Save is off. After the delete, Fix All raises the `Test not found`
  dialog a Save raises on a clean canvas (`The test "<name>" is no longer on
  the server. Close clears the canvas and starts a new draft.`, one Close
  button) in place of the load dialog, and no
  `Failed to apply automatic fixes. Please try again.` toast shows. Close
  leaves an empty `Draft Workflow` canvas
