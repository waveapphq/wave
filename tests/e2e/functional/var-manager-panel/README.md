# Variable Manager Panel - Functional

End-to-end coverage of the redesigned Variable Manager panel.

Five specs live here:

| Spec | Fixture | Covers |
|------|---------|--------|
| `v-vmgr-03-functional.spec.ts` | `fixture.json` | post-run row state, eye toggle, lazy expressions, count summaries, Run All clearing, edit/delete unlock |
| `v-vmgr-live-table.spec.ts` | `fixture-live-table.json` | live complex values during a run: a declared table shows its dimensions, a declared array shows its count |
| `v-variable-manager-virtualized.spec.ts` | `fixture-virtualized.json` plus 55 loader-generated fillers | the list above the 50-variable virtualization threshold: every drawn slot renders its own row, pitch and separators match the plain branch, scrolling reaches the last name, arrow-key navigation walks the whole list, filter and sort still apply, and a template-only reference is Used |
| `v-var-unused-references-functional.spec.ts` | none (a blank `zz-` Test per test, built through the UI) | every place a block names a variable counts as a reference (VMGR-105): a condition row of Assert, If/Else, Switch, While and Wait Until, a Variable Setter row's value and target, a Function Block's input field and, inside a Function, a nested Function Block's input field each clear the Unused badge; a rename rewrites condition rows and Function Block fields; a Function Block input opens literal (FNCFG-6). The place table in `unused-places.ts` drives one test per place (16) in Test scope and inside a Function (an input and a local): the name read only there is not Unused, the saved Test holds the reader, and the badge is back once the reader is removed |
| `v-var-rename-delete-functional.spec.ts` | none (a blank `zz-` Test per test, built through the UI) | a rename through the variable's Edit window (row pencil, Name, Save) follows an HTTP output binding and an XML Parser query alias (the alias key in the queries, their output types and the binding) and a run writes the new names; a rename follows the `{{ }}` of a Template variable and the name in an Expression variable and a run prints the same values; the delete dialog counts the blocks that read a variable (Cancel keeps it) and names the block whose output binding it clears |

`fixture-virtualized.json` checks in 7 declarations. The spec's loader pads the
map to 62 with fillers named `vm1_008_pad` through `vm1_062_pad`, each holding
the number in its own name, so the asserted rows stay readable and the fillers
have one rule. The panel switches to the windowed list above 50 declarations, so
the total must stay above that: 62 also leaves the `_pad` filter 55 matches, a
real narrowing rather than a no-op, while `vm1_00` leaves 9 and flips the panel
back to the plain branch on the same page.

`items_arr` in `fixture.json` and `order_rows` in `fixture-live-table.json`
must both seed a RECORD as their first element. A live push that guesses a
variable's type from its value calls a list of records a table, which is
exactly what the array rows must catch; a scalar in front hides it.
`v-vmgr-live-table.spec.ts` asserts both seeds, so an edit that puts a scalar
back in front fails rather than quietly weakening the other spec.

## Pre-requisites

- Backend on the per-worker port (Playwright fixtures).
- Frontend on the matching per-worker port.
- The shared environment `E2E Execution Env` (provisioned by `ensureEnvironment`).

## Execution Steps

1. POST `fixture.json` to `/tests` and assert `GET /tests/{id}/validate`
   returns zero errors.
2. Navigate to `/workbench?editTest={testId}` and expand the Variable
   Manager panel.
3. Select the shared environment and click Run.
4. Wait for the workflow to reach status `passed`.
5. Assert post-run row state for every variable in the fixture.
6. Toggle the eye on `counter` and assert the runtime <-> definition flip.
7. Run again to confirm stale runtime values clear before the new run
   repopulates them.

## Validation Criteria

- Eyes for non-secret rows are enabled after the first run (regression
  guard).
- `referenced_expr` row shows `15` (counter+10), realized lazily on first
  read by the Log node.
- `unused_expr` row shows the expression source `9999` - never realized
  because no node ever read it.
- `items_arr` runtime value renders as `[2 items]` and `map_data` as
  `{3 keys}` (count summaries).
- `api_token` value stays masked as `********` through the entire run.
- Edit and delete buttons are unlocked after the run reaches `passed`
  (regression guard).
- The second run repopulates runtime values without showing stale values
  from the prior run.

## V-VMGR-LIVE-TABLE Execution Steps

1. Import `fixture-live-table.json` (CSV Parser binds a real 3x2 table to a
   variable declared `table`; a Var Setter writes a 3-record array to a
   variable declared `array`; a Delay holds the run open; a Log prints the
   truth).
2. Expand the panel and assert both rows still render their definition
   (`0x0 table`, `[0 items]`).
3. Run, and while the status is still `running` assert the table row reads
   `3x2 table` and the array row reads `[3 items]` - the multiplication sign
   is U+00D7, not the letter x.
4. After the run passes, assert both values survive and the type badges still
   read `table` and `array`.
5. Cross-check the console line and `GET /workbench/{sid}/variables`.

## V-VMGR-LIVE-TABLE Validation Criteria

- A declared `table` variable updates live at all - before the one-measurement
  push it was typed as a string, failed to encode and was dropped.
- A declared `array` holding records shows its real count, not `[0 items]`.
- The displayed form follows the DECLARED type, not the shape of the value.

## V-VMGR-VIRTUALIZED Execution Steps

1. Assert the built fixture holds 62 declarations, which is above the
   50-variable threshold.
2. Import it, open the workbench and expand the Variable Manager panel.
3. Assert the panel is on the windowed branch: the spacer spans all 62 rows at
   the fixed pitch, the list is exactly as tall as the panel body that measures
   it, and that body is taller than the first-paint fallback.
4. Read every drawn slot and assert each holds exactly one row, in the A-Z
   order, with distinct names.
5. Assert the badges on the first window: Used, Unused, SECRET, expression,
   OUT and type.
6. Measure row pitch, row height and the bottom separator in the windowed
   branch.
7. Filter to 9 matches so the panel drops to the plain branch, and measure the
   same three things again.
8. Filter to `_pad` (55 matches, still windowed), then to a term that matches
   nothing.
9. Clear the filter and sort by Name Z-A, by Type, then back to Name A-Z.
10. Scroll to the bottom and read the last name and its value.
11. Walk focus with ArrowDown from the first row to the last, then back up five
    rows.

## V-VMGR-VIRTUALIZED Validation Criteria

- The window the list uses is the measured panel body, not the 400px
  first-paint fallback.
- Every drawn slot holds one row; no slot is an empty box, and the names and
  values read in DOM order are the first K entries of the A-Z order.
- Row pitch, row height and the bottom separator are identical in the windowed
  branch and in the plain branch, measured on the same variables.
- The filter narrows above the threshold, flips the branch when it drops below
  it, and reports no match by name.
- Sorting reorders the window with no scroll at all, and the spacer still spans
  every row.
- Scrolling to the bottom reaches the last name and its value; before the
  scroll that row is not drawn at all.
- ArrowDown walks focus from the first row to the last across the whole list,
  and ArrowUp walks back, always landing on a drawn row.
- A variable named only inside a `{{ }}` marker is Used; one named as literal
  text in the same string is not.

## V-VAR-UNUSED-REFERENCES Execution Steps

1. Create a blank `zz-` Test through `POST /tests` and open it.
2. Create the variables with the Variable Manager's Add window.
3. Drop each block from the palette and build its reference in the config sheet: a literal
   condition row `<variable> equals x` (Assert, If/Else, Switch, While, Wait Until), a Variable
   Setter row writing one variable from an expression reading another, or a Local Function with
   the input `who` given the variable by {x} in its Function Block window. Nested case: inside a
   Local Function, a Function-local variable given to the input `level` of a nested Local Function
   Block.
4. Save the sheet and the Test; read the stored Test back.
5. Rename case: rename `status` to `state` in its Edit window (row pencil, Name, Save) and save the Test.

## V-VAR-UNUSED-REFERENCES Validation Criteria

- Before the reference exists, the variable row shows the `Unused` badge.
- The stored block names the variable where it was built.
- After the reference is saved, the row shows no `Unused` badge.
- After the rename, the stored Test names `state` in the Assert row and the Function Block's `who`
  field and `status` nowhere.
