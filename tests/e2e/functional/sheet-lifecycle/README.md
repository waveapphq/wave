# V-SHEET-03: Config Sheet Lifecycle (functional)

Config sheets on an interactive canvas: dirty-delete confirmation, the
dirty-sheet close gate, and the dirty-drill confirmation with scope
read-only persistence (CANVAS-230, REQ-3.1.1.5).

## Prerequisites

- A running stack (each test seeds its own Test via `POST /tests`).

## Steps

1. **S1**: open a Log's config sheet, rename it (dirty), select the node and
   press Delete; cancel the confirmation, repeat and confirm.
2. **S2**: open a Log's config sheet, leave it clean, delete the node.
3. **S3**: dirty a sheet (canvas itself clean), click the toolbar Close.
4. **S4**: seed a Test with a top-level Log and a local Function; open the
   Log's sheet, rename it (unsaved), click the Function's dig-in; cancel the
   prompt, then repeat and confirm; pop back via the breadcrumb.
5. **S5**: drill into the Function (clean - no prompt), dirty the inner
   Log's sheet, pop via the breadcrumb; cancel, then repeat and confirm.

## Validation

- **S1**: "Delete with unsaved changes?" confirmation appears; Keep Editing
  keeps node + sheet; Close removes the node and closes its sheet.
- **S2**: no confirmation; node deleted, sheet closed silently.
- **S3**: the "Unsaved Changes" close prompt appears although the canvas has
  no workflow edits; Cancel keeps the sheet with its edits.
- **S4**: "Navigate with unsaved changes?" appears before the drill; Cancel
  stays at the root with the edits intact (accidental dig-in causes no data
  loss). Confirming drills: the sheet persists read-only (pill, frozen
  fields, footer Close, no Save) with its form reset to saved values, and
  re-enables silently on returning to its scope.
- **S5**: breadcrumb pops get the same guard; after confirming, the
  out-of-scope sheet persists read-only with the form reset.

## V-SHEET-CANVAS-CHANGE (functional)

`v-sheet-canvas-change-functional.spec.ts` - an open config sheet follows canvas changes it did not make and keeps
its own edits (CANVAS-230, REQ-3.1.1.5, REQ-3.1.3.1).

### Prerequisites

- A running stack; each test seeds its own Test via `POST /tests` (zero validation errors).

### Steps

1. **Binding**: seed a root CSV Parser whose Row Count writes the Test variable `gone_rows` and a Local Function
   whose inner CSV Parser writes its local `gone_local`. Open the root Block's sheet, delete `gone_rows` from its
   Variable Manager row and rename the Block in the sheet. Repeat drilled into the Function with `gone_local`,
   then Save the Test.
2. **Typed Name**: seed a Function Block `fn_a` whose output `result` writes the Test variable `total`, and a Log
   beside it. Type a new Name in `fn_a`'s sheet without saving; select the Log, rename the Log, delete `total`;
   then Save `fn_a`'s sheet and the Test.

### Validation

- **Binding**: the deleted variable's binding empties in the open sheet and its Save stays disabled; after the
  renames and the Test save both stored Blocks have their new names and no binding to either deleted name.
- **Typed Name**: the typed Name survives the selection, the other Block's rename and the delete (whose binding
  empties); the Save stores the typed Name and no binding to `total`.

## V-SHEET-DIALOG (functional)

`v-sheet-dialog-functional.spec.ts` - floating windows are non-modal dialogs named by their titles, and the
variable window puts the cursor in Name as it opens (CANVAS-227, VMGR-15, VMGR-106, REQ-5.2.1.32, REQ-5.2.1.33).

### Prerequisites

- A running stack; the spec seeds its own Test with the integer variable `counter` read by one Log, and checks
  `POST /tests/{id}/validate` returns zero errors.

### Steps

1. Open the Test, expand the Variable Manager and press `+ Add`.
2. Press the pencil on `counter`.
3. Press the expand button on `counter` to open its watcher.
4. Press `+ Add` again with the three windows open, then press Escape.

### Validation

- The `+ Add` window is a dialog named `New variable`, marked not modal, with the cursor in its Name field; it
  has the text color of the page around it and no margin or padding of its own.
- The pencil's window is a dialog named `Edit variable`, marked not modal, with the cursor in Name holding `counter`.
- The watcher is a dialog named `counter`, marked not modal.
- The page behind stays usable: its `Add` button is still found by its role and opens a second `New variable` window.
- Escape closes only the window in front (the second `New variable` window); the watcher and the Edit window stay.

## V-SHEET-FLOATING-DIALOGS (functional)

`v-sheet-floating-dialogs-functional.spec.ts` - every other floating window is a non-modal dialog named by its
visible title, the page behind it stays usable, and a window that sets a starting field puts the cursor there
(CANVAS-227, VMGR-106, TDATA-9, REQ-5.2.1.32, REQ-5.2.1.33).

### Prerequisites

- A running stack; each test stores its own `zz-win-<n>` Test through `POST /tests`, checks that
  `POST /tests/{id}/validate` finds no error, and deletes it after:
  1. a Log;
  2. a Local Function `Params_Fn` with the input `zz_in` and the output `zz_out`;
  3. a Log reading the String `greeting`, the list `hosts`, the map `limits` and the table `servers`;
  4. an HTTP Request `Fetch Status` in multipart body mode;
  5. three File I/O Blocks: Read, List and Copy;
  6. a Log.

### Steps

Each test opens its Test and expands the Variable Manager. With each window open, the test presses the Variable
Manager's `Add` (inside a Function, `Add` and then `Variable`), then Escape.

1. Press Ctrl+Space (Quick Insert).
2. Drill into `Params_Fn`; open `Add` > `Input parameter` and `Add` > `Output parameter`, then the pencils of
   `zz_in` and `zz_out`.
3. Open each variable's Edit window and press `Open editor`.
4. Open `Fetch Status` from its cog; press `Profiles`; open `Open editor for Parts` in Body and
   `Open editor for Cipher Suites` in TLS / Certificates.
5. Open each File I/O Block and press Browse: Read Path, Copy Source, List Path, Copy Destination.
6. Open the Functions Library from the palette, then the `Test Data` and `Artifacts` chips.

### Validation

- Each window is the dialog named by its title, is not marked modal and is not shown as a modal dialog: `Quick
  Insert`; `New input parameter`, `New output parameter`, `Edit input parameter`, `Edit output parameter`;
  `Edit value` for a text, list, map and table value; `Fetch Status - Edit Config`; `Profiles`; `Edit value` of the
  Parts editor and of the cipher picker; `Choose a file`, `Choose a file or folder`, `Choose a folder`, `Save as`;
  `Functions Library`; `Test Data`; `Session Artifacts`.
- The page behind stays usable: its `Add` button is still found by its role and opens a `New variable` window while
  the window under test stays open; Escape closes only the `New variable` window.
- The cursor: in Quick Insert's search box; in Name of each input and output window (Edit holds the parameter's
  name); inside the editor of Edit value (the code editor of a text, the list, map and table bodies). The other
  windows set no starting cursor and the spec checks none.
