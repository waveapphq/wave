# V-VMGR-CREATE-03: Parameter Windows and Their Default Rules

Verify the New input parameter and New output parameter windows
(VMGR-97, VMGR-98, VMGR-100, VMGR-103, VMGR-104, VMGR-112, VMGR-113).
Spec: `tests/e2e/visual/canvas/v-vmgr-create-03.spec.ts`.

## Prerequisites

None - the spec creates a `zz-` Test holding one empty Local Function through `POST /tests`, opens it,
digs into the Function and deletes the Test afterwards.

## Steps

1. In the Function, open "+ Add" > Input parameter: Type Array with the default `["alpha", "beta", "gamma"]`
   (open its "Edit value" window); then a String input with Create enum ticked and Allowed values
   `["alpha", "beta", "gamma"]` (open the Allowed values "Edit value" window).
2. Open "+ Add" > Output parameter: Type Integer, Kind Expression `len(rows)`; then Set to null ticked.
3. Open an Array input with the default `[1, 2, 10]`, then an Integer input with Create enum ticked, Allowed
   values `[1, 2, 10]` and the default `2`; open each list's "Edit value" window.
4. Open input windows with Required ticked (String), Mark as secret ticked (Array), and both (String).
5. On each forced Set to null row: click the box and its label, press Space and Enter, hover the row, Tab
   onto the box.
6. On an Integer input, tick Create enum, then untick it and tick Mark as secret.

## Validation

- **Order:** Name, Description, Type (half width, no Kind on an input), Required, Mark as secret, Set to
  null, Create enum (String, Integer, Float only), Allowed values (enum only), then the value captioned
  `Default value`; an output has Type and Kind on one row and the caption `Value`
- **Lists:** an ordinary list's "Edit value" grid has a Type column and opens in Visual; the enum Allowed
  values grid has `#` and `Value` only, items in the input Type's color
- **Output:** Kind Expression shows the expression field with no Set to null row; ticked Set to null hides
  Kind and shows one `null` field
- **Forced null (secret):** Set to null ticked with `aria-disabled="true"` (never `disabled`), stays ticked
  through a click, a label click, Space and Enter; the default is a read-only `null` input with
  `aria-disabled`
- **Tooltip:** the exact secret reason opens right of the "Set to null" label on hover and on Tab; Required
  plus secret shows the secret reason
- **Focus ring:** one 2 px indigo ring around box and label at full opacity; the box draws none
- **Required:** Set to null unticked and locked with "off while Required is set"; the default stays an
  editable field; unticking Required frees the row
- **Exclusion:** "off while enum is set" (Mark as secret, Set to null), "locked on while enum is set",
  "off while secret is set"
- **Attachments:** a screenshot of each window state
