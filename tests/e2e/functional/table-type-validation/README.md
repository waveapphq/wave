# V-TABLE-VALIDATION Table Type Validation - Functional

End-to-end coverage of design-time table validation in the "Edit value" window that the
variable window's Open editor opens (REQ-3.1.3.11, VMGR-69 to VMGR-71, VMGR-106, VMGR-110). One shared table-schema validator backs
both the Visual and the Code view, so Save is held the same way; the rules mirror the backend
`Table` contract (REQ-3.5.5.1) and move the failure to design time.

## Pre-requisites

- Backend on the per-worker port (Playwright fixtures).
- Frontend on the matching per-worker port.

## Execution Steps

1. POST `fixture.json` to `/tests` and assert `POST /tests/{id}/validate` returns
   zero errors. The `results` variable is a row-objects table (`id` integer,
   `name` string).
2. Navigate to `/workbench?editTest={testId}` and expand the Variable Manager.
3. Visual: pencil `results` (the Edit window), Open editor; type a lone `-` into the
   `id` cell, then rename the second column to a duplicate `id`; fix both.
4. Code: pencil `results`, Open editor, switch to Code; drive an invalid integer cell,
   an unexpected key, a missing key, then a valid fix; Save the "Edit value" window,
   Close it, Save the Edit window and save the Test.
5. In Code, drive a multi-problem state and expand the issue list.
6. In Code, type invalid JSON and open the View menu.
7. In Code, set a boolean in the string column, switch to Visual; then a non-list
   structure value; then a column-shape drift value.
8. Open `results` in the watcher (expand) and switch Mode to Compare.

## Validation Criteria

- The fixture validates with zero errors before any UI interaction.
- Visual: an invalid `id` cell gets `aria-invalid` and the strip
  (`value-editor-validation`) shows `Row 0 "id": expected integer`; a duplicate column
  flags both `id` headers and the strip leads with `Duplicate column name "id"` plus the
  `(+N more)` count (every problem counts: 2 duplicate columns + 1 bad cell ->
  `(+2 more)`); Save is disabled throughout; fixing both clears the strip and a changed
  valid value enables Save.
- Code: `Row 0 "id": expected integer` (bad cell),
  `Unexpected column "extra" - change columns in the Visual view`,
  `Missing column "name" - change columns in the Visual view` each disable Save; a valid
  fix enables Save, its Save writes `[{"id": 7, "name": "zeta"}, {"id": 2, "name": "beta"}]`
  into the window's one-line field, and the saved Test stores the rows `7, zeta` and
  `2, beta` with the columns `id` integer and `name` string.
- The strip shows the first message + a clickable `(+N more)`
  (`value-editor-validation-more`) that opens a portaled list
  (`value-editor-validation-more-list`) containing every problem (one row per problem).
- Invalid JSON shows the parser's JSON error, disables Save and Format, and the Visual
  option is `aria-disabled` with the `view-locked-alert` icon (its reason is the shared
  tooltip, no `title`); valid JSON clears it and unlocks Visual.
- A string-column cell set to a boolean shows `Row 0 "name": expected string`, disables
  Save, and keeps Visual ENABLED; the error is preserved across the switch to Visual
  (cleared by editing the grid cell). A non-list value (`Table must be a list of rows`)
  locks Visual; column-shape drift keeps Visual enabled.
- The watcher's Compare mode pill carries the `slate` active-neutral classes and NOT
  `text-muted-foreground` (it must not read as disabled).

## Notes

- Canvas node-kebab helpers (`clickNodeKebabItem`) do not apply: the spec drives the
  Variable Manager, the variable window and the "Edit value" window only.
- Code JSON is replaced in one input (`replaceValueEditorCode`), so CodeMirror's
  auto-close-brackets does not mangle the braces / quotes.
