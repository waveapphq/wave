# V-CTRL-CONDROW-01: The Condition Row in the If/Else Window

Verify that every condition row of the If/Else window sits on one line with fixed columns, its values in their type
colors, and that the row messages hang under their boxes (FIELD-1, FIELD-14, FIELD-15, FIELD-16, FIELDERR-1,
FIELDERR-2). Spec: `tests/e2e/visual/canvas/v-ctrl-condrow-01.spec.ts`.

## Prerequisites

None - each test creates a `zz-ctrl-fields-condrow-` Test through `POST /tests` (seed in
`tests/e2e/visual/canvas/control-fields-seed.ts`), checks it validates with zero errors, opens it and deletes it
afterwards. The Test holds the If/Else `Route by health` and these Test variables: `status`, `expected_status`,
`region` (String), `latency_ms`, `retries` (Integer), `errors` (Array).

| Card | Name | Rows |
|------|------|------|
| IF | `Healthy` | `status` equals `ready`; OR; `status` equals {x} `expected_status` |
| ELSE IF | `Slow` | `latency_ms` greater than `500`; AND; a group (`retries` less than `3`; OR; `region` starts with `eu`); AND; the expression `len(errors) == 0` |
| ELSE | `Fallback` | none |

## Steps

1. Open the Test in the workbench; for the light test, switch the theme with the shell toggle.
2. Open `Route by health`'s window from its cog.
3. In IF, click Add Assertion, then Literal.
4. Click the `expected_status` box, press Ctrl+A, then Delete; click the Description.
5. Cancel the window and answer Close.

## Validation

- **Window:** 880 px wide
- **One line:** variable box, type pill, operator list, value box, expand, {x}, delete, up, down; every part of a row
  centered on the same line (within 1 px), 8 px apart
- **Sizes:** variable box 160 x 36; operator list 140 x 36, radius 8, 1 px border, shadow, clear fill, 14 px text,
  chevron at 50 percent; value box 36 px tall, taking the rest of the row
- **Columns:** expand and {x} in one column per nesting level; the group's columns 13 px left of the top level's
- **Expand:** shown on `ready`, `expected_status`, `eu` and the expression row; the number rows `500` and `3` leave the
  32 px column empty
- **Colors:** `ready` and `eu` in the string color, `500` and `3` in the integer color, `expected_status` and
  `len(errors) == 0` in the expression color with no shadow; the pressed {x} with the primary fill at 10 percent and
  the primary icon
- **Expression row:** braces marker, box, expand in the top-level expand column, an empty {x} column, actions in
  their column
- **Structure:** cards IF `Healthy`, ELSE IF `Slow`, ELSE `Fallback` in that order; pills OR (IF), AND, AND (ELSE
  IF), OR (group); the group dashed with its footer buttons; Add Assertion and Add Group in each list; `Else If`
  enabled, `Else` disabled; footer Changelog, Details, Profiles, Cancel, Save; ELSE reads
  `Catch-all branch - no conditions needed`
- **Errors (steps 3-4):** the new row's empty variable box is red with `Choose a variable.` 4 px under it (12 / 16
  px, destructive) and its value box keeps its border; the cleared {x} box is red with `Value is required` 4 px under
  it, starting at the box; both rows grow 20 px and the pill under the message starts at or below it; the IF card
  shows the red warning mark right after its badge and its name box moves right by the mark; Save disabled with
  `Save is disabled: the settings have errors`
- **Themes:** every check above in the dark and the light theme; a screenshot of the window is attached before and
  after the errors
