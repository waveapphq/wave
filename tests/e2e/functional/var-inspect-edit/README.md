# V-VMGR-06-EDIT Editing in the One Window - Functional

End-to-end coverage of editing Test variables in the one variable window (VMGR-106, VMGR-108,
VMGR-110; REQ-3.1.3.11 / REQ-3.1.3.13). The row pencil opens the variable's window filled, in
Edit; the watcher only shows values. Lists, maps and tables are edited in the "Edit value" window
the field's Open editor opens.

## Pre-requisites

- Backend on the per-worker port (Playwright fixtures).
- Frontend on the matching per-worker port.

## V-VMGR-06-EDIT

- Spec: `v-var-inspect-edit-functional.spec.ts`; fixture: `fixture.json`.

### Execution Steps

1. POST `fixture.json` to `/tests` and assert `POST /tests/{id}/validate` returns zero errors.
2. Navigate to `/workbench?editTest={testId}` and expand the Variable Manager.
3. Open the `count` watcher and check it has no Edit; close it.
4. Pencil `count`: check the window's title, Type, Kind, pill and value; change the value to `7`, Save.
5. Pencil `colors`: Open editor, Visual, change the first item to `crimson`, Save the sheet, Close it,
   Save the window.
6. Pencil `colors`: type broken JSON into the field, then valid JSON; Open editor, Code, type broken
   JSON, then valid JSON; Close the sheet and the window without saving.
7. Pencil `derived`: make the source read itself, then fix it; Save.
8. Pencil `base`: clear the name, then rename to `account`; Save.
9. Save the Test, reload it, and check the rows and the `colors` window.

### Validation Criteria

- The fixture validates with zero errors before any UI interaction.
- The watcher has no Edit button.
- The pencil opens a window titled `Edit variable` showing Type Integer, Kind Literal, the `Initial`
  pill and the value `3`; after Save the window is gone and the row shows `7`.
- The list edited in the sheet comes back as `["crimson", "green", "blue"]`; the row shows `[3 items]`.
- Broken JSON in the window's field shows the `create-validation` strip and disables Save; in the
  sheet's Code view it shows the `value-editor-validation` strip and disables Save and the Visual
  view; valid JSON clears both.
- A self-reading source shows `Circular reference detected for variable 'derived': derived -> derived`
  with Save disabled; a fixed source saves and the row shows `'ok-done'`.
- An empty name shows `Name is required` with Save disabled; `account` shows the rename notice and
  saves, and the row is renamed.
- After the Test save and a reload the rows show `7`, `wave` and `'ok-done'`, and the `colors` window
  shows `["crimson", "green", "blue"]`.

## V-VMGR-INSPECT-ELEMENT-TYPES

- Spec: `v-vmgr-inspect-element-types.spec.ts`; fixture: `element-types-fixture.json`.
- A map saved without element types opens in the "Edit value" Visual view as text; picking a row type
  asks first, clears the text to the type's default, and the number typed again makes the window's Save
  a real edit; the saved Test declares the type, it reads back after a reload, and a run reads each
  element as its declared type (REQ-3.1.3.19).

## V-VMGR-INSPECT-ELEMENT-TYPE-RESHAPE

- Spec: `v-vmgr-inspect-element-type-reshape.spec.ts`; fixture: `element-types-reshape-fixture.json`.
- Reshaping a typed map (rename a key, remove a row, add a digits-only row that stays text) and a typed
  list (move, remove, add an item whose type is picked after its text: the pick asks
  `Change item type?`, clears the text to the type's default, and the number typed again keeps the
  picked type) in the "Edit value" sheet keeps every type on its own value; a decimal typed into a
  whole-number row never enters it, so the row keeps its number; a trip through the Code view and back
  keeps every type; the saved Test, a reload and the run agree, a 19-digit whole number adding exactly
  (REQ-3.1.3.19).

## V-VAR-WATCHER-SCOPE

- Spec: `v-var-watcher-scope-functional.spec.ts`; no fixture file (the Test is built in code: a Test variable
  `shared_name` holding `from the test` and a Local Function `Scope_Fn` whose own local is also named
  `shared_name`, holding `from the function`; zero validation errors).
- A watcher belongs to its variable's scope, not to its name (REQ-3.1.3.11, REQ-3.1.3.1): the Test variable's
  watcher shows `from the test` and marks only its row; drilled into the Function the same-named local is not
  marked and the Test watcher stays open; expanding the local opens a second watcher showing `from the function`;
  back at the root both stay open with their own values; closing the Test watcher unmarks only the Test row, and
  drilled again the local is still marked with its watcher open.
