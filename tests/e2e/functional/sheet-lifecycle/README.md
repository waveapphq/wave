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
