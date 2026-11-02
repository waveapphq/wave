# V-PROTECTED-VALUE-FOCUS-FUNCTIONAL: "Edit Protected Value?" keyboard focus

Verify that the "Edit Protected Value?" question, asked and answered with the keyboard,
keeps or drops the stored secret as answered and never leaves keyboard focus on the page
body (REQ-3.1.3.5, REQ-3.1.3.18). Three surfaces: a block dialog row with a stored secret
text, a block dialog row with a stored secret number, and the masked value field of a saved
secret variable's Edit window.

## Prerequisites

- Backend + frontend running (standard functional-test stack)
- Shared E2E environment (created by the import helper if missing)
- No fixture file: the spec holds its Test inline and imports it via `POST /tests`
  before every test. It has an SSH Session Open block with a stored Password, a
  Variable Setter block with a stored secret integer row, a saved secret variable
  `api_key` and a plain integer variable `plain_counter`
- The system masking flags are reset to all-off before every test, so a stored secret
  shows masked

## Steps

1. Import the Test and open it in the workbench
2. Block dialog (run once for the SSH Session Open Password row and once for the
   Variable Setter integer row): double-click the block, Tab onto the masked value from
   the control before it, press Enter
3. Edit window: expand the panel, Tab from the `api_key` row onto its pencil, press Enter
   (the window opens with the masked field and asks nothing), Tab from the value pill onto
   the masked field, press Enter
4. Answer the question with the keyboard: Enter on Cancel, then ask again and press
   Escape; in a second test Tab to "Delete & Edit" and press Enter
5. After Cancel and Escape: make one other change (the block's Description, or the value
   of `plain_counter` in its Edit window), save, and read the saved test over the API
6. After "Delete & Edit": save (the block dialog and the test, or the empty Edit window
   and the test) and read the saved test over the API

## Validation

- **Cancel and Escape, block dialog:** the question is gone, the block dialog stays
  open, no "Edit value" sheet opened, the row is still masked and the masked value holds
  keyboard focus.
- **Cancel and Escape, Edit window:** the question is gone, the window stays open, the
  field is still masked and holds keyboard focus.
- **Stored value kept:** after the Save the saved test holds the other change and the
  same sealed value as before, byte for byte (`GET /tests/{id}/workflow` for a block,
  `GET /tests/{id}/export?format=json&secrets=encrypted` for the variable).
- **Delete & Edit, secret text:** no editor sheet opens; the row is its empty one
  value field, no longer masked, with keyboard focus in its text box.
- **Delete & Edit, secret number:** no sheet opens, the row's number input is empty and
  holds keyboard focus.
- **Delete & Edit, Edit window:** the field becomes the empty text field and holds
  keyboard focus.
- **Stored value dropped:** after the Save the saved test holds no value for the
  password, for the setter row and for `api_key`.

# V-SECRET-PROMOTE-WARNING: the Save warning before a Block Save makes variables secret

Spec: `v-secret-promote-warning-functional.spec.ts`. Verify that a Block Save which would make an
existing plain variable secret asks first, names every such variable, and that Cancel leaves
everything as it was (SECUI-12, REQ-4.5.20). Five carriers: the HTTP Request outputs table, the
Function Block outputs table, the Shell Script and Python export rows, and the Variable Setter
rows.

## Prerequisites

- Backend + frontend running (standard functional-test stack); no run is started
- No fixture file: each test seeds its own `zz-` Test via `POST /tests` with the carrier Block
  bound to plain variables that hold values (Secret unticked), or to an already secret variable
- The test-variables reveal setting is turned off for the file when it is on, and turned back on
  afterwards

## Steps

1. Per carrier, one variable and several variables: open the Block, tick Secret on the bound rows
   (a secret Function output's row opens ticked; its binding is typed in), Save
2. Confirm cells: "Make secret and save", then the toolbar Save
3. Cancel cells: press Escape, then Cancel; close the sheet through the Unsaved changes question
   (Close), add a probe variable and save the Test
4. Negatives: type a new variable into a free Secret row and tick Secret on the row of the already
   secret variable, Save, toolbar Save
5. The Save button of the Unsaved changes question (HTTP Request and Function Block): tick, Cancel
   the sheet, Save from the question, confirm the warning
6. Sticky secret: bind the secret variable on a second HTTP Request with Secret unticked, Save;
   untick Secret on the first one, Save; toolbar Save; reopen the Test

## Validation

- **Warning texts:** one variable reads "Make this variable secret?" and "Saving makes the plain
  variable `<name>` a secret. Its value is masked from then on. Making it plain again clears its
  value."; several read "Make N variables secret?" and "Saving makes these plain variables
  secrets. Their values are masked from then on. Making them plain again clears their values."
  over a mono list of every name (twelve Variable Setter names, the list scrolls). Buttons "Cancel" and a red
  "Make secret and save"
- **Confirm:** the sheet closes; each row shows the SECRET badge and `********`; the saved Test
  declares each variable secret, the encrypted export holds its value sealed, the Block keeps every
  Secret row and a Variable Setter literal is sealed
- **Escape and Cancel:** Escape leaves the warning and the sheet open; Cancel returns to the sheet
  with the ticks kept; after the Test save every variable is plain with its value and the Block
  holds no Secret row
- **Negatives:** the Save closes the sheet with no warning; the new variable is created secret and
  the other stays secret and sealed
- **Sticky secret:** no warning opens; after the reopen the variable keeps its SECRET badge and
  `********`, and the saved Test keeps it secret and sealed with both Blocks bound to it

# Saved-secret window guards

Each spec seeds its own Test through `POST /tests` (`fixture.json` or an inline Test) and runs in
the `functional-workflow` project. Design: VMGR-106, VMGR-108, SECUI-1, SECUI-9 (REQ-3.1.3.5).

| V-TEST | Spec | Covers |
|--------|------|--------|
| V-SECRET-DROP-CONSENT | `v-secret-drop-consent.spec.ts` | The row pencil on a saved secret opens its Edit window at once with the masked field (dots, pencil, lock) and asks nothing; the masked field's pencil asks "Edit Protected Value?"; Cancel keeps it and a run still uses the stored value; "Delete & Edit" empties the field (a map: no entry in its "Edit value" sheet, also after a reload) and closing unsaved keeps the stored value |
| V-SECRET-WATCHER-RELOCK | `v-secret-watcher-relock.spec.ts` | Saving the test closes every open secret watcher; the saved secret's window shows the masked field; a reload restores no secret watcher |
| V-SECRET-VISIBLE-STRIP | `v-secret-visible-strip-functional.spec.ts` | "Secret value stays visible until you save the test." shows for a new or changed Test secret in the Add window, the Edit window's Initial view and the watcher; never for an untouched saved secret, a saved null secret or the Current view; a null secret unlocks with no question; the Test save removes it |
| V-SECRET-FUNCTION-STRIP | `v-secret-function-strip-functional.spec.ts` | The same rule for a Local Function and a Shared draft in a Test (strip until the Test save; never on a secret input) and for the library View (the strip names the Function; Publish locks the locals, also two levels deep) |
| V-SECRET-DEFINITION-CHANGE | `v-secret-definition-change-functional.spec.ts` | "Delete & Edit", Change kind and Change type on a saved secret clear the masked control; the typed value is saved secret, masked on the row and in the run log, and the run uses it |
