# Variable Window - Functional

Functional specs for the one variable window (VMGR-106 to VMGR-114): the window the Variable
Manager pencil opens filled, in Edit, for a Test variable, a Function local, an input or an
output, with its Initial / Current value pill (inputs: Default / Current). Each spec seeds its
own Test with a unique name through `POST /tests`, checks `POST /tests/{id}/validate` returns
zero errors, drives the window through the UI, and reads every result back from the saved Test
(`GET /tests/{id}`) and the run log.

## Pre-requisites

- Backend and frontend on the per-worker ports (Playwright fixtures).
- The shared E2E execution environment (`ensureEnvironment`, created by the import helper).
- No other services.
- Containerized only (see `tests/e2e/README.md`); the folder runs in the `functional-workflow`
  project of `playwright.functional.config.ts`, beside `variable-create-modal/`.

## v-vmgr-window-functional.spec.ts

Fixture: `vmgr-window-fixture.json` - Test variables `item_id` (integer 7, read by an expression
Log and a template Log), `retyped` (string `abc`), `maybe` (string `present`), `staged`
(integer 1), `token` (string, plain), `old_secret` (string, secret), `calc` (integer expression
`2 + 3`), `ratio` (float), `big_count` (integer), `flag` (boolean) and a 64-character name, each
read by its own Log; a Local Function `Window_Fn` whose local `fn_count` (integer 5) is read by
its inner Log; a closing `window-done` Log.

### Execution Steps

1. Test 1 imports the fixture and opens it. Through the pencil and the Edit window: rename
   `item_id` to `part_id`; retype `retyped` to Integer (Cancel first, then Change type); tick
   Set to null on `maybe`; tick Mark as secret on `token` (Make secret and save); untick it on
   `old_secret` (Remove & Delete Value); change `calc` from Expression to Literal (Cancel first,
   then Change kind) and back to Expression (Cancel); drill into `Window_Fn` and change
   `fn_count` to 6.
2. Save the Test, read it back, reload it and reopen the edited windows.
3. Give `staged` the Current value 42 before any run, then Run to the closing `window-done` line.
4. Test 2 imports a fresh copy. In the Edit window it types a 28-significant-digit float into
   `ratio`, a 19-digit integer into `big_count`, letters into both, and picks `true` for `flag`;
   it renames the 64-character variable and, holding a Current value in its window, presses Run.

### Validation Criteria

- The pencil opens a window titled `Edit variable` showing the saved Name, Type, Kind and value
  on the Initial view, for a Test variable and a Function local; Save closes it and the row shows
  the new value; the value is still there after the Test save and a reload.
- A rename shows `Renaming updates all references to item_id across the test.`
  (`across the Function.` for a local); the saved Test holds `item_id` nowhere, and both readers
  log the value under the new name (`item=7`, `tmpl item=7`).
- A retype asks `Change variable type?`; Cancel keeps String and `abc`; Change type resets the
  value to `0`, saved as an integer and logged `retyped=0`.
- Set to null saves `null` (the stored value is null) and the run logs `null`.
- Mark as secret on: the saved value reads back as `********`, the value is in no store file
  in the clear, and the run logs `********`. Off: the value is cleared to empty text, the saved
  variable is plain, and the run logs `old_secret=[]`.
- Expression to Literal asks `Change variable kind?` with
  `Changing kind to literal will clear the existing expression. This cannot be undone.`; Cancel
  keeps Expression and `2 + 3`; Change kind shows `0` on Initial and on Current; the saved Test
  stores a Literal 0 and the run logs `calc=0`. Literal to Expression asks the same and shows an
  empty expression box.
- A Current value set before the run is what the run logs (`staged=42`); the saved Test keeps 1.
- A Float field takes 28 significant digits: its counter shows from 23/28 muted and 28/28 red,
  a 29th digit is dropped with no error, and the run logs the exact value; an Integer field counts
  digits to 19/19 and drops the 20th; letters are dropped as typed; a Boolean is a true / false
  control and `true` is logged `true`.
- With a 64-character name, the rename notice keeps the old name inside its tinted box and the
  window body has no horizontal scrollbar; Run with an unsaved Current value shows
  `Unsaved Current value` with the name wrapped inside the dialog, and Cancel starts nothing.

## v-vmgr-window-table-functional.spec.ts

No fixture file. Tests 1 and 2 each seed a blank Test through `POST /tests` (test 1 with one
saved table `tedit`: columns `zip` string and `n` integer, row `11111`, `1`). Test 3 seeds a Test
holding an empty table `vt`, a Variable Setter that sets it and a probe Log. Test 4 seeds one
Suite and one Regression (holding the Suite) with an empty table `t` each, and adds a System
table variable through the Settings editor; all are removed afterwards. The probe Log of test 1
is built through the UI; those of tests 3 and 4 through `POST /tests`.

### Execution Steps

1. Test 1: in New variable windows, type the table `tline` in the one-line field (first with a
   wrong cell, then with an extra column too, then fixed); type `tsheet` in the "Edit value"
   window's Code view and Format it; in `tedit`'s Edit window, change its cells in the
   "Edit value" Visual grid; type a map `m` and a list `a` in Code, then rename, remove and add
   map entries and move, remove and add list items in Visual. Drop a Log under Start that reads
   every value, save the Test and run it. In `tedit`'s Edit window it first picks Type Map and
   cancels the confirm.
2. Test 2: type a 307-character String in a New variable window, open the "Edit value" window,
   replace it with compact JSON, Format it, save, create, save the Test, and reopen it.
3. Test 3: in the Variable Setter's row, type the table in the "Edit value" Code view, save the
   sheet and the Test, read the stored node back and run.
4. Test 4: in the Suite, Regression and System variable editors, type the table in its value
   cell's "Edit value" Code view and save; reopen each editor, change the `zip` cell in the
   Visual grid and save again; add a Test with a probe Log to the Suite and run it.

### Validation Criteria

- A list, map or table value is one line in the window with an Open editor button; Open editor
  shows the `Edit value` window on Visual, with Code and Format; its Save writes the value back
  into the one line (`[{"zip": "02134", "n": 7}]`).
- A wrong cell in the one-line field shows `Row 1 "n": expected integer` and holds Create; with
  an extra column the strip's `(+1 more)` lists
  `Unexpected column "extra" - change columns in the Visual view` and the cell problem.
- Every table is stored with `columns` `[{name: zip, type: string}, {name: n, type: integer}]`
  and the row `02134`, `7`; the map stores `{zip: 02134, count: 16, f: 2.5, z2: 007}` with types
  string / integer / float / string, the list `[2.5, 7, true, 42]` with float / integer /
  boolean / integer.
- The run logs `TLINE zip=02134 n=8 types=string,integer` (also `TSHEET`, `TEDIT`),
  `MAP zip=02134-x count=17 f=5.0 z2=007x` and `LIST a0=5.0 a1=8 a2=False a3=43` on one line and
  passes.
- The String field holds all 307 characters; the "Edit value" window shows them, offers
  `Auto (JSON)` and Format; after Format the value has seven lines, the window shows `{…`
  read-only, the saved value keeps its line breaks and reopens on seven lines.
- Picking Map on the saved `tedit` asks `Change variable type?` with
  `Changing type to map will clear 1 existing table entry. This cannot be undone.`; Cancel keeps
  the table.
- The Variable Setter row reads `1 rows x 2 col`, the saved node holds the table with its
  column types, and the run logs `SETTER zip=02134 n=8 types=string,integer` and passes.
- Each entity editor row reads `1 rows x 2 col` after the sheet Save, stores its table with the
  column types, reopens it with no
  `Must be a JSON array of objects` refusal, shows `string` / `integer` column types, and saves
  the cell edit; the run logs `SUITE zip=02134 n=8 types=string,integer` (also `REG`, `SYS`)
  and passes.

## v-fn-param-window-functional.spec.ts

No fixture file. Each test stores its own `zz-` Test through `POST /tests` (checked to validate
with no error):
- `Rename_Fn`: the Required input `who_in` (its Function Block holds `ann`), the output
  `res_out` and the secret output `tok_out`, bound to the Test variables `got` and `sec_got`
  (Secret ticked on `tok_out`) and written by a body Variable Setter from `who_in`; a root Log
  prints `got` and `sec_got`.
- `Drop_Fn`: its Function Block holds `abc` in the Required String `txt`, `3` in the Required
  Integer `cnt`, the expression `src + '!'` (Test variable `src` = `hello`) in the String `calc`
  and `high` in the enum `level` (`low`, `high`, default `low`); the body Log adds 1 to `calc`.
- `Defaults_Fn`: no inputs, the String local `taken`, the Boolean local `flag_loc`, a body Log.
- `Rules_Fn`: an empty Local Function. The Function save goes through `POST /functions` and the
  recipes through the MCP endpoint (`validate_recipe`), enabled until restart and reset after.

### Execution Steps

1. Rename: drill into `Rename_Fn`, rename `who_in` to `person`, `res_out` to `result` and
   `tok_out` to `tok_new` in their Edit windows; open the Function Block sheet; save the Test;
   Run.
2. Drop: drill into `Drop_Fn`, retype `txt` to Integer, `cnt` to Float and `calc` to Integer,
   narrow `level`'s allowed values to `["low"]`, add the Required input `extra`; pop out, read the
   Block's alert and sheet, press Save; then set `txt` 7, pick `low`, give `extra` `'x'`, save
   and Run.
3. Defaults: in New input windows type `taken` and `_id` as the name; check the true / false
   caption (New input `Default value`, Edit of `flag_loc` `Value`); create `who` (Required,
   default `dflt`) and the enum `level` (`low`, `mid`, `high`, default `low`), clicking the enum's
   caption in Add and in Edit; make the body Log print both; Run while drilled in; Reset, give
   `level` the Current value `high`, Run; pop out, read the Block, Run the Test.
4. Rules: in a New input window tick Create enum and type the allowed values `["", "high"]`,
   then `["low", "high", "low"]`, then `["low", "high"]`; flip Mark as secret and Create enum;
   send the same lists to `POST /functions` and in recipes, plus a recipe input both secret and
   an enum.

### Validation Criteria

- Each rename shows `Renaming updates all references to <old> across the Function.`; the Block
  keeps `ann` under `person`, `result` bound to `got`, `tok_new` bound to `sec_got` with Secret
  ticked; the saved Test holds no old name; the run passes and logs `got=R-ann sec=********`,
  never `T-ann`.
- Drop: the Block's alert lists `Required parameter 'extra' is missing`,
  `Required parameter 'level' is missing` and `Required parameter 'txt' is missing`; the sheet
  shows `txt` empty, `cnt` 3, `calc` still `src + '!'`, `level` at `Select…` offering only `low`,
  `extra` empty; Save opens `Cannot Save Test` naming the three; once set the Test saves, and the
  run fails at the Function Block with no `C=` line.
- `taken` shows `A variable with this name already exists`, `_id` shows `Parameter name must
  start with a letter, contain only letters, numbers, underscores`, Create held off.
- The true / false group is named `Default value` / `Value` and a caption click focuses nothing
  in it; a click on the enum caption (`Default value` in Add, `Value` in Edit) opens its select,
  which holds the focus once closed.
- Run alone logs `who=dflt level=low`, then with the Current value `who=dflt level=high`; the
  Block shows `who` empty and `level` on `low` (FNCFG-9), its alert names only `who`; Run on the
  Test is refused with `Cannot Run Test` naming only `Required parameter 'who' is missing`, and the
  body Log never prints; once the Block gives `'caller'` and `mid` the alert clears.
- Allowed values: `Allowed value at index 0 is empty` (Default offers `high` only) and
  `Allowed value at index 2 (low) is already listed` (Default offers `low`, `high`), in red, Create
  held off; with Create enum on Mark as secret is locked with `off while enum is set`, with Mark as
  secret on Create enum is locked with `off while secret is set`, and Set to null is held on with
  `A secret input has no default: the Function Block gives the value.`
- `POST /functions` and `validate_recipe` refuse `Enum input 'level' has an empty allowed value`
  and `Allowed value 'low' of enum input 'level' is listed more than once`; the recipe also
  refuses `Input 'level' cannot be both secret and an enum`; the clean recipe validates.

## v-vmgr-window-paused-functional.spec.ts

The window around a run: paused, running, before a run and after it (VMGR-19, VMGR-61, VMGR-64,
VMGR-106, VMGR-107, VMGR-108, VMGR-111). Fixtures are built in the spec from the shared
`helpers/fn-seed.ts` Blocks:

| Fixture | Variables | Blocks |
|---------|-----------|--------|
| root | `count` = 3, `factor` = 10, `slots` = 4 (integers), `spare` (string, unused) | Gate, Read Count (`count=...`), Gate Two, Read Factor (`factor=...`), Show Slots (prints `slots` as WAVE prints it), Probe |
| lock | `count` = 3 | Gate, Hold (Delay 20 s), Gate Two, Read Count |
| function | Test `n` = 5; Local Function `Scope_Fn` with its own local `n` = 1 | Gate, `Scope_Fn` (Fn First `fn-first=...`, Fn Second `fn-second=...`), After Fn (`root-n=...`) |

### Execution Steps

1. Root fixture, breakpoint on Gate, Debug. While paused: delete `spare`; open `count` with the
   pencil, switch the pill to Current, type 8 and Cancel (Keep Editing, then Close); reopen with no
   change and Cancel; set the Current value 7 and Save; set `slots`' Current value to null and
   Save; Continue.
2. Root fixture, breakpoints on Gate and Gate Two, Debug. Rename `count` to `total` without
   saving and Continue (Cancel, then Drop Changes); at Gate Two type the Current value 20 for
   `factor` without saving and Continue (Save Changes).
3. Root fixture, no run yet. Hold the Current value 9 for `count` in its window and Run (Cancel,
   then Save Changes). Three more tests do the same Save Changes with Debug and a held Current
   value 9, and with Run and Debug holding a rename of `count` to `total` with the Initial value
   11. Another test runs once, Resets, holds 6 and Runs (Drop Changes), then Resets, saves the
   Current value 8 and Runs.
4. Lock fixture, breakpoints on Gate and Gate Two, Debug. Open `count` on Current, Continue into
   the Delay, look at the pencil and the window while running, type 12, then Save at Gate Two
   and Continue.
5. Root fixture, breakpoint on Gate, Debug. Rename `factor` to `scale` with the Current value 20
   in one Save; rename `count` to `total`, add a new `count` (50) and give it the Current value
   60; add `extra` (1) and give it the Current value 77; Continue. Point Probe at `count` and
   `extra` and Run. Add `late` (1), give it the Current value 88, point Probe at it and Run Current.
6. Root fixture, no run yet. Stage the Current value 7 for `count`, rename it to `total`, Undo,
   Run. Reset, add `extra`, stage 5, Undo, Run. Reset, retype `factor` to String (`ten`), stage
   `twenty`, Undo, Run.
7. Function fixture, breakpoints on Gate and on Fn Second (set drilled in). Debug, drill into
   `Scope_Fn` at the Gate pause, set the local `n`'s Current value 6, Stop, Run Current on Fn
   First. Debug again, set 7 at the Gate pause, Continue to Fn Second, set 9, Continue.

### Validation Criteria

- Paused, the pencil reads `Edit count` with the tooltip `Edit variable`, and the row delete
  removes `spare`. The pencil opens `Edit variable` on Initial with the saved 3; Current shows the
  live 3.
- Cancel with a change asks `Unsaved changes` with Keep Editing / Close / Save: Keep Editing
  keeps 8, Close writes nothing (the row and the session read keep 3); a window with no change
  closes at once.
- The saved Current 7 shows on the row and in the session read; reopened, Initial still reads 3
  and Current 7. A Current null shows the row in the null look, the session reads null and no
  `Current Value Not Saved` toast shows. Continue logs `count=7` and Show Slots logs `null`; the
  saved Test keeps `count` 3 and `slots` 4.
- Continue with an unsaved rename shows `Unsaved changes` naming `count`: Cancel keeps the run
  paused and the window holding `total`; Drop Changes puts `count` back in the window and the run
  logs `count=3`. Continue with an unsaved Current value shows `Unsaved Current value` naming
  `factor`; Save Changes closes the window and the run logs `factor=20`.
- Run with an unsaved Current value shows `Unsaved Current value` naming `count`: Cancel starts
  no session and the window keeps 9; Save Changes closes the window and the run logs `count=9`
  (Debug as well). With a held rename and Initial value the dialog reads `Unsaved changes`;
  Save Changes closes the window and the run holds `total` = 11, no `count`, and logs
  `count=11`. After Reset, Drop Changes puts 3 back in the window and runs `count=3`; a Current
  value 8 saved right after Reset runs `count=8`.
- While running, the pencil reads `Locked: edit count` and the window's Save is locked, both with
  the tooltip `Locked while the test is executing`; a click on the held Save keeps the window
  open with the typed 12 while the run still runs. Paused at Gate Two both work again: Save writes 12 and the run logs `count=12`.
- The rename saved with a Current value shows `scale` at 20 (no `factor` row); the live run reads
  `count` 3 and `factor` 20 and has no `extra`; no `Current Value Not Saved` toast shows. Continue
  logs `count=3` and `factor=20`. The next Run logs `probe=60:77`; Run Current after adding `late`
  logs `probe-late=88`.
- Undo of the rename brings `count` back holding 7 and Run logs `count=7`. Undo of the add removes
  `extra` and Run logs `count=3`; Undo of the retype shows `factor` 10 and Run logs `factor=10`.
- The Function local's Current value set at the Gate pause is saved with no toast; after Stop,
  Run Current on Fn First logs `fn-first=6`. In the next Debug run Fn First logs `fn-first=7`;
  paused at Fn Second the window's Current shows 7, the saved 9 is logged `fn-second=9`, After Fn
  logs `root-n=5` and the Test row `n` shows 5.
