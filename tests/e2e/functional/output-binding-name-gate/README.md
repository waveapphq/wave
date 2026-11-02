# V-BINDING-NAME-GATE: the "Assign to" suggestion list never covers the name error

A shared surface, not a plugin one. Every Block writes its outputs into
variables through the same "Assign to" field, and the Function instance modal
offers the same field for a Function's declared outputs. When the typed name
cannot be a variable name, the suggestion list used to drop over the sentence
explaining why, so the reason was unreadable and the disabled Save had no
visible cause.

Two specs, because the Block config sheet and the Function config modal are
different components that share only the row table underneath.

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
