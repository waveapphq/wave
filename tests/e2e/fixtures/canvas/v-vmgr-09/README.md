# V-VMGR-09: Variable Manager Rows - Null Look

Verify Variable Manager rows draw a null value in the one null look (VMGR-93) beside the empty value of
the same type, and that a local Function's parameter and local rows stored null do too. Spec: `tests/e2e/visual/canvas/v-vmgr-09.spec.ts`.

## Prerequisites

None - the spec imports `fixture.json` through `POST /tests` (zero-error validation), opens
`/workbench?editTest={id}` at 1600x1300 and deletes the Test afterwards. The fixture holds a null and an
empty variable of each of the seven types, `text_null` (the string "null"), and the local Function
`Fn_null_params` with input `fn_in` (string, default null), output `fn_out` (integer, default null) and
local `fn_local` (string, null). The null defaults are seeded through the API.

## Steps

1. Read the stored Test back (`GET /tests/{id}`).
2. Expand the Variable Manager and read every row.
3. Dig into `Fn_null_params` and read the PARAMETERS and VARIABLES rows.

## Validation

- **Stored values:** the seven `null_*` variables are null, the seven `empty_*` variables hold `[]`,
  `false`, `0`, `0`, `{}`, `""`, `[]`; the Function's `fn_in` and `fn_out` defaults and `fn_local` are null
- **Null rows:** `null_array` to `null_table` read exactly `null`, italic, monospace, in the
  muted-foreground color; no "not set" anywhere
- **Not dimmed:** each null row is at full opacity; its name has the same color, weight and opacity as
  the empty row's name
- **Empty rows:** `[0 items]` amber, `false` orange, `0` pink (float), `0` violet (integer), `{0 keys}`
  emerald, blank sky (string), `0×0 table` blue, all upright
- **Text "null":** `text_null` reads `null` as an ordinary sky string, upright
- **Badges:** `Unused` and the type pill on each null row match its empty twin
- **Function rows:** INPUTS `fn_in` (IN, string), OUTPUTS `fn_out` (OUT, integer), VARIABLES `fn_local`
  (string) read `null` in the null look, not dimmed, with `Unused`
- **Attachments:** `null-rows.png`, `empty-rows.png`, `function-parameter-rows.png`
