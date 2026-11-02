# V-BLOCK-NAME-FUNCTIONAL: WAVE names a block by its Name

Verify that every place that refers to a block uses the block's Name and never its
Description (design decision EXEC-26): the engine's own console lines, the block status
events, the error a Try / Catch hands to its Catch path, the delete confirmation of a
variable a block writes, the variable list of the expression editors, and the Target Loop
list of a Break and a Continue. Also verify that a block that arrives with no Name gets the
name the palette gives its type, the same name its console Source shows (EXEC-25).

Every block of the first four fixtures carries a Name and a Description that share no text.
Each check on them asserts the Name is shown and the Description is absent from the same
surface.

## Prerequisites

- Backend and frontend running (standard functional-stack ports)
- Shared execution environment (the import helper creates it if absent)
- No external service: the blocks are Log, Delay, CSV, Python (WAVE's own interpreter),
  Try / Catch, Var Setter, For Loop, Break and Continue
- `fixture.json` - one run: a Delay that holds the run while the spec subscribes to its
  events, a Log that runs (`Say hello`), a muted Log (`Muted step`), a Log the spec skips
  from its menu (`Skipped step`), a Try / Catch (`Guard the charge`) whose try path fails
  (`Charge card`) and whose Catch path logs `error.node` (`Report the charge`), and a last
  Python block named `PSQL` that raises
- `fixture-variable.json` - a CSV block named `Load rows` binds its table to the variable
  `rows`; a Log (`Show the rows`) follows it
- `fixture-loops.json` - a For Loop named `Retry upload` (with a Description) around a For
  Loop that keeps the default name `For Loop_1` (no Description, as a block dropped on the
  canvas), around a Log, a Break and a Continue that both target the inner loop
- `fixture-loops-blank.json` - a For Loop whose Name is empty, inside `Retry upload`, around
  a Break. Saving a Test fills an empty Name in, so this fixture fails validation
  (`MISSING_LABEL`) and is stored through the admin route, as a hand-edited file would be
- `fixture-unnamed.json` - five blocks with no Name and no Description: a For Loop and a
  Var Setter with an empty Name, a CSV block with no Name at all, a Try / Catch with a Name
  of three spaces, and a Log. The CSV block sits in the loop's body, the Var Setter on the
  try path, the Log writes the last line

## Isolation on the shared stack

Each test makes its own Tests under unique names, asserts only on their canvas, run and
session, and deletes them afterwards. No server state is reset.

## Steps

1. Import `fixture.json` through `POST /tests`, confirm `POST /tests/{id}/validate` reports
   zero errors, open the Test, set the console level to DEBUG, choose Skip in the menu of
   `Skipped step`, press Run, subscribe to the session's events during the leading Delay
   and wait for the run to fail
2. Import `fixture-variable.json` the same way, press Run and wait for it to pass
3. Open the Variable Manager's + Add dialog, choose Kind Expression and type `ro` in the
   value editor; cancel the dialog
4. Click the delete button of the `rows` row, read the confirmation, press Cancel
5. Open the config of `Show the rows` and type `ro` in the Message expression editor
6. Import `fixture-loops.json` the same way, open the config of the Continue (`Next
   attempt`) and open its Target Loop list
7. Open the config of the Break (`Stop early`), open its Target Loop list, pick
   `For Loop: Retry upload`, save the sheet and the Test, read `GET /tests/{id}/workflow`,
   then press Run
8. Store `fixture-loops-blank.json` through the admin route, read its validation findings,
   open it, and open the Target Loop list of its Break
9. Open the Tests page, press Import, choose `fixture-unnamed.json` (under a unique Test
   name), press Validate, read the review step, press Import
10. Read the imported Test with `GET /tests/{id}/workflow` and validate it
11. Open it in the Workbench, read each block on the canvas, set the console level to DEBUG,
    press Run and wait for it to pass
12. Save `fixture-unnamed.json` through `POST /tests` and read the stored Test

## Validation

- **Failed block:** the run ends `failed` and the console carries, from `SYSTEM` at
  ERROR, exactly `Block 'PSQL' failed: RuntimeError: seed rows are missing`. The only
  `Block '...' failed` lines are that one and the `Charge card` one. No console row holds
  any block's Description, in its message, in its Source or in its copied text
- **Engine lines:** `Executing 'Say hello' (plugin/log)` and `Completed 'Say hello'`
  at DEBUG, `Skipping 'Muted step' (disabled)` and `Skipping 'Skipped step' (skipped)` at
  INFO, all from `SYSTEM`; neither skipped block writes its own line
- **Status events:** every `block_status_changed` event carries, as `block_name`, the
  Name of the block its `block_id` names, and holds no Description. The statuses per block
  are `running` then `passed` (`Say hello`, `Guard the charge`, `Report the charge`,
  `After the charge`), `skipped` (`Muted step`, `Skipped step`), `running` then `failed`
  (`Charge card`, `PSQL`)
- **Caught error:** the Catch path writes `bn-catch node=Charge card` at WARN with
  Source `Log : Report the charge`; the bound error holds `node` = `Charge card` and the
  failed block's id, and nowhere the block's Description; `caught` is true; the engine line
  reads `Block 'Charge card' failed: Expression evaluation failed for '1/0': division by
  zero`
- **Binding line:** the run writes `'Load rows' → rows` from `SYSTEM` at DEBUG, `rows`
  holds the two rows read, and no console row holds the Description
- **Delete confirmation:** the dialog is titled `Delete "rows"?` and reads exactly
  `This action cannot be undone. The variable is bound as output by 1 block (Load rows) -
  those bindings will be cleared.`; the Description is not in the dialog; Cancel keeps the
  variable
- **Expression editors:** in the Variable Manager's value editor and in a block's
  Message editor the suggestion for `rows` reads `table ← Load rows`, and the list does not
  hold the Description
- **Target Loop list:** the Continue and the Break both show `For Loop: For Loop_1` as
  the chosen loop and list exactly `For Loop: Retry upload`, `For Loop: For Loop_1`; the
  Description of `Retry upload` is in no option
- **The option is the loop:** after picking `For Loop: Retry upload` the saved Break
  stores the id of the loop named `Retry upload`, and the run writes `bn-loop-pass` once
  (breaking the inner loop would write it twice) and passes
- **Empty Name:** the stored Test's only validation finding is `MISSING_LABEL` on the
  unnamed loop; the Break shows `For Loop: No Title` as the chosen loop and lists exactly
  `For Loop: Retry upload`, `For Loop: No Title`
- **Import review:** the dialog reads `1 importable, 0 blocked` and marks the file
  `Will auto-fix`
- **Stored names:** the imported Test holds `For Loop`, `CSV`, `Try / Catch`, `Var Setter`
  and `Log` as the Names of its five blocks and validates with zero errors; the Test saved
  through `POST /tests` holds the same five Names
- **Canvas:** each of the five blocks shows that name
- **Source:** the run passes; the Sources of its console rows (read from the copied text,
  console at DEBUG) are exactly `SYSTEM`, `For Loop`, `CSV`, `Try / Catch`, `Var Setter` and
  `Log`, so every block wrote lines and none carries a `{type} : {Name}` Source
- **Engine lines of the named blocks:** `Executing 'For Loop' (control/for)`,
  `Completed 'For Loop'`, `Executing 'Try / Catch' (control/try-catch-finally)`,
  `Executing 'Log' (plugin/log)`, `'For Loop' → pass_index` and `'CSV' → rows`, all from
  `SYSTEM` at DEBUG
