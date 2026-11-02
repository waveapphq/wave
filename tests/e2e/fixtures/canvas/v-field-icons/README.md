# V-FIELD-ICONS: One Meaning per Icon

Verify Inspect, the window full-size button and the field expand each keep their own icon
(FIELD-11, FIELD-13). Spec: `tests/e2e/visual/canvas/v-field-icons.spec.ts`.

## Prerequisites

None - each test creates a `zz-11541-s1-icons-` Test through `POST /tests` holding the String variable `run_id`
(`r-42`), the List variable `hosts` (`["alpha"]`), a Log Block that reads both and a Python Block whose script is
`print("ready")`, checks it validates with zero errors, opens it and deletes it afterwards.

## Steps

1. Open the Test in the workbench; for the light test, switch the theme with the shell toggle.
2. Expand the Variable Manager and look at the `run_id` row.
3. Pencil on `hosts`, then Open editor; close the sheet and Cancel the window.
4. Open the Python Block's window from its cog and expand Script; click the full-size button twice; close the
   sheet and Cancel the window.

## Validation

- **Variable row:** `r-42` in the string color with `STRING`; icons eye, magnifying glass (`Inspect run_id`),
  pencil, trash, left to right; no field-expand arrows on the row
- **List editor:** `Edit value` with `ARRAY` and the close X; row `0` holds `alpha` in the string color with its ∅
  inside the box (not pressed), then the two diagonal arrows, the `string` type pill, move up, move down and the
  trash, left to right
- **Script sheet:** the full-size button is the four-corner frame at the header's right end, after the close X; a
  click fills the window and shows four inward corners (pressed); a second click restores the size and the frame
- **Themes:** every check above in the dark and the light theme; screenshots of the row and both sheets are
  attached
