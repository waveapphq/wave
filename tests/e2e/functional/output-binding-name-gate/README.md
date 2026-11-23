# V-BINDING-NAME-GATE: the "Assign to" suggestion list never covers the name error

A shared surface, not a plugin one. Every Block writes its outputs into
variables through the same "Assign to" field, and the Function instance modal
offers the same field for a Function's declared outputs. When the typed name
cannot be a variable name, the suggestion list stays clear of the sentence
explaining why, so the reason and the disabled Save's cause stay readable.

The name gate has two specs, because the Block config sheet and the Function
config modal are different components that share only the row table
underneath. Two more specs in this folder cover what the same box holds and
how its empty hint looks (see the sections at the end).

## Prerequisites

- Backend and frontend running (standard functional-stack ports)
- Each test seeds its own Test through the API; the stale-binding test uses the
  admin bulk route, because the state it needs cannot be written through the
  normal save path
- No environment, no run: every assertion is on the open sheet

## Steps

1. Seed a Test and open it in the workbench
2. Open the Block config sheet (HTTP Client) or the Function config modal
3. Click the "Assign to" field of an output and type a name that breaks the
   variable-name rule
4. Read the page: suggestion layers, the message under the row, the input's
   accessibility wiring, the Save button
5. Press Backspace once and read the same things again, touching nothing else
6. On the Block sheet, type the name of an existing variable of the wrong type
   and read the same things a third time

## Validation

- **Picker still works:** clicking an empty field opens the suggestion list
- **Invalid name:** no popover layer anywhere on the page, no dropdown footer,
  no "new variable" hint, no "No matching variables" text, `aria-expanded` is
  false
- **Readable:** the full sentence
  `'k8s-' is not a valid variable name (use letters, digits, underscores; must not start with a digit)`
  is on screen and nothing is drawn on top of it
- **Assistive technology:** the input is marked invalid and its
  `aria-describedby` equals the `id` read from the message under it (found by
  its `data-testid`); the id itself is never asserted
- **Save:** disabled while the name is invalid
- **Unprompted return:** one Backspace brings the list, the footer and the "will
  be created" hint back, clears the message, drops the description reference and
  re-enables Save, with no keystroke to reopen anything
- **Regression trap:** a TYPE-MISMATCH error keeps the list OPEN and selectable,
  and picking the type-compatible variable from it clears the error and
  re-enables Save. The suppression keys on name syntax only
- **Function modal:** the same message, the same description reference and the
  same disabled Save; and a stale binding left for an output the Function no
  longer declares renders no row and no message and does not keep Save disabled

## V-BINDING-ASSIGN-NAME: the Assign to box holds a variable name

`v-binding-assign-name-functional.spec.ts`. The Assign to box of an output
holds the name of the variable the output writes, never a value of the
output's type, so no value check of that type runs on it. The only line under
an output row is its binding error (CANVAS-131).

### Steps

1. Seed a Test with an HTTP Request Block and open its window
2. Type `scode` into Status Code (Integer) and `took` into Response Time
   (Float), then save the window and the Test
3. Seed a Test with a Local Function Block whose Function declares the outputs
   `url` (string) and `total` (integer); type `final_url` and `n`, then save
4. Seed a Test that declares the string variable `code_text` and type it into
   Status Code

### Validation

- **No value check:** no line under either row (no
  `Enter a valid integer value`, no `Enter a valid float value`, no URL line
  under the output named `url`), no Save note, Save enabled
- **Stored:** the saved Block's `outputBindings` hold both names
- **Binding error kept:** `Type mismatch: "code_text" is string, expected integer`
  at `field-error-status_code` is the one line under the row, the box points
  at it through `aria-describedby`, and Save stays disabled with
  `Save is disabled: the settings have errors`

## V-BINDING-ASSIGN-HINT: the empty hint is the gray of a not-set default

`v-binding-assign-hint-functional.spec.ts`. An empty Assign to box shows the
hint `variable_name` in Text Muted, the gray of a not-set default (FIELD-2,
CANVAS-131).

### Steps

1. Seed a Test with an HTTP Request Block, no output bound and Retry Delay not
   set, and open its window
2. Open Timeouts & Retries and read the computed colors; close the window,
   switch the theme with the shell toggle and read them again

### Validation

- **Not set:** Retry Delay shows the default `1` in Text Muted with no reset
  icon
- **Hint:** the `Assign Body to` box is empty with the placeholder
  `variable_name`
- **Same gray:** in the light and the dark theme, the computed color of that
  placeholder equals the computed color of the gray default `1`
