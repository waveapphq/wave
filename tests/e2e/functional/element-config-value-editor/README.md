# V-ELEMENT-CONFIG-VALUE-EDITOR-FUNCTIONAL

Element-config parameter value editing migrates onto the shared "Edit value"
sheet. The HTTP node's Headers / Query Params (maps) and Body
(multiline string) open the shared `ValueEditorSheet`; the deleted array / map /
text editor modals are gone. Param maps stay string -> string, the body keeps its
Format control + templateFields opt-in, and the edits persist and reach the request.

## Prerequisites

- Backend + frontend running on the worker's ports.
- The compose stack's published `http-echo` service (`127.0.0.1:9449`, see `../../services/README.md`).
- The shared E2E environment (`ensureEnvironment`); each test imports its own fixture.

## Fixtures

Built inline by `buildFixture`: an HTTP POST to `https://127.0.0.1:9449/echo`
(`verify_ssl=false`, host rewritten in container mode via `injectHttpHost`) whose
`body` output binds to `echo_response`, read back by a downstream Log.
Variables: `who="Ada"`, `echo_response`.

## Steps

T1 (string-only maps + templated body, runs):
1. Import + validate (zero errors); open the test in the workbench.
2. Open the HTTP config; edit Headers via the sheet (`x-echo-port` = `8080`) and
   Query Params via the sheet (`q1` = `8081`); expand the collapsed "Body" group
   card and confirm the body sheet shows Kind=Template.
3. Save config + the workbench; read `GET /tests/{id}/workflow`.
4. Select the E2E environment and Run; read the console.

T2 (Format round-trip + modal removal, no run):
1. Import a JSON-body fixture; open the test; open the HTTP config.
2. Open Headers, then Body, through the sheet; pretty-print the JSON body; Save.
3. Save the workbench; re-read the persisted body and reopen the body sheet.

## Validation

- T1: the sheet map shows its fixed string type as a read-only pill, never a
  picker; persisted `headers` / `query_params` values are JSON STRINGS (`"8080"` /
  `"8081"`), not numbers; `body` keeps its `{{ who }}` source and is in
  `templateFields`. The run is `passed`; the
  echo reflects `x-echo-port:"8080"`, `q1:"8081"`, and the rendered `Hi Ada`; the
  HTTP node status is `success`.
- T2: opening Headers / Body shows `value-editor-sheet` with NO `map-editor-modal`
  / `array-editor-modal` / `text-editor-modal`; the body Format dropdown reads
  `Auto (JSON)` and the Format button reflows onto multiple lines; the persisted
  body round-trips as the same JSON object (pretty-printed) and re-detects JSON on reopen.

---

# The Close / Save contract

Two more surfaces of the same shared sheet: what its own footer promises
(PYRUN-20), and how the surface that opened it owns it (SAVE-1).

## V-ELEMENT-CONFIG-VALUE-EDITOR (T3, T4)

Same file, same HTTP fixture, no execution.

- T3: the sheet's dismiss button reads `Close`, never `Cancel`; Save is dead while
  the draft equals what was last saved (a plain string parameter too); Save applies
  the value, keeps the sheet open and goes dead again; Close closes and asks nothing.
  The applied value is read back from `GET /tests/{id}/workflow`.
- T4: Close with unsaved text asks `Keep Editing` / `Close` / `Save`. Keep Editing
  returns to the editor with the text intact, Close discards it and the row keeps its
  old value, Save applies the value and then closes - proved against the stored Test.

## V-PARENT-CHILD-SAVE (own file)

Fixtures: built inline - one Python block (`pcs-py`) seeded with a Source script,
an Interpreter, two Arguments rows and an empty Input Variables map (T1-T4); one
SFTP block (`pcs-sftp`) on Download with Destination `artifact://out/a.txt` (T6,
T7). T5 seeds its own Suite instead. Every test deletes what it created in
`afterAll`.

- T1: the value sheet is not a DOM descendant of the config sheet; maximize
  fills the viewport and restores; Ctrl+Enter applies that editor without saving or
  closing the config; Escape closes the front-most sheet only; dragging the config
  by its handle never moves the value sheet. Nothing reaches the server.
- T2: with nothing changed the config's Save is dead and closing asks nothing;
  unsaved text in an open editor alone makes Save live; closing asks Keep Editing /
  Close / Save; one Save writes the config's own Description and BOTH open editors
  in one step, one undo reverses all of it, and the stored Test carries all three.
- T3: the footer note reads exactly `Save is disabled: the Input Variables
  editor has errors` while that editor has changes it cannot save, and exactly
  `Save is disabled: the settings have errors` while the config's own form is
  invalid; the question's Save carries the same note and is dead.
- T4: a Script Type switch that hides the Script row asks Keep Editing / Close (no
  Save) while the row's editor holds unsaved text; so does removing an Arguments
  item in the shared list editor while that item's own text editor holds unsaved
  text (FIELD-10); Keep Editing leaves the row or item exactly as it was, Close
  carries the action out and the row or item, its editor and its text all go; a
  clean editor closes with its item and asks nothing.
- T5: the Suite variable grid takes the same rules through its own
  `unsaved-discard` / `unsaved-save-close` answers, and the saved value is read back
  from `GET /suites/{id}`.
- T6 (criterion 10, one sheet per field): (a) Browse over a clean Edit value sheet
  closes it and opens the picker without asking; (b) Browse over typed text asks
  Keep Editing / Close / Save - Keep Editing leaves the sheet open, in front
  (`data-active="true"`) and opens no picker, Close leaves the field on
  `artifact://out/a.txt` and the picker opens on it (`picker-reference-scheme`
  `artifact://`, `picker-reference-input` `out/a.txt`), Save writes the typed text
  into the field and the picker opens on it; (c) the edit control over a picker
  with a changed path asks the same, Save writes the Reference into the field and
  the Edit value sheet opens on it, a clean picker closes at once; (d) a picker
  whose path is cleared cannot be selected, so the question's Save is dead with
  exactly `Save is disabled: the Destination editor has errors` and Close leaves
  the field as it was. The stored Test carries the last value written.
- T7 (criterion 11, the expression switch takes the field's sheets away): over
  typed text the switch asks Keep Editing / Close with no Save; Keep Editing leaves
  the field literal (`aria-pressed="false"`) with the sheet open and the text
  intact, Close takes the sheet and its text away, and the field, still holding
  its value, then asks the switch warning (FIELD-7), whose Clear switches it to an
  empty expression; switching back to literal opens
  neither sheet; with a clean picker open the switch happens at once and the
  picker closes.

## Authoring note

The sheets are siblings, not children, so an open editor can cover the config row a
step needs to click. `parkEditor()` drags the editor to a viewport edge and
`revealRow()` / `revealFooter()` scroll the config body, so every parent click lands
on the parent. Keep both when adding steps that drive the parent with an editor open.
