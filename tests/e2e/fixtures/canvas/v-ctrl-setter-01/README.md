# V-CTRL-SETTER-01: The Variable Setter Rows

Verify that the Variable Setter rows keep fixed columns under their headers, that each value shows its own face
(text, {x}, Template, masked secret, list with an {x} entry, map, null) and that a blank {x} shows its message
(FIELD-1, FIELD-5, FIELD-6, FIELD-16, VARSET-5, VARSET-6, VARSET-7, VARSET-8, VMGR-83). Spec:
`tests/e2e/visual/canvas/v-ctrl-setter-01.spec.ts`.

## Prerequisites

None - each test creates a `zz-ctrl-fields-setter-` Test through `POST /tests` (seed in
`tests/e2e/visual/canvas/control-fields-seed.ts`), checks it validates with zero errors, opens it and deletes it
afterwards. The Test holds the Variable Setter `Set run values`; every row target is a declared Test variable.

| Row | Type | Stored value |
|-----|------|--------------|
| `greeting` | String | `hello world` |
| `next_attempt` | Integer | {x} `attempt + 1` |
| `summary` | String | Template `Run {{ run_id }} done` |
| `api_token` | String, Secret | sealed at save |
| `host_list` | Array | `["web-1", "web-2", backup_host]`, item 2 as {x} |
| `limits` | Map | `{"cpu": 2, "mem": "4Gi"}` |

Further Test variables: `run_id`, `backup_host` (String), `attempt` (Integer).

## Steps

1. Open the Test in the workbench; for the light test, switch the theme with the shell toggle.
2. Open `Set run values`'s window from its cog.
3. Click Add and type `last_error` as the new row's name; click the Description.
4. Click the `next_attempt` box, press Ctrl+A, then Delete; click the Description.
5. Cancel the window and answer Close.

## Validation

- **Window:** 880 px wide
- **Header:** `Variables` with the `Add` button (32 px); column labels Name, Type, Secret (centered over its column),
  Value (4 px left padding), each over its column
- **Columns:** Name 189 x 36, Type 100 x 32, Secret 32 (16 px box centered), value box 357 x 36, expand 32, {x} 32,
  delete 32, 8 px apart, in line on every row; every part of a row centered on the same line (within 1 px)
- **Null button:** inside the value box at its right end; unpressed on `greeting`, `host_list`, `limits`; pressed with
  the primary tint on `last_error`, which shows `null` italic in Text Muted; none on `next_attempt`, `summary`,
  `api_token`
- **Faces:** `greeting` `hello world` in the string color; `limits` in the map color; `next_attempt` `attempt + 1` in
  the expression color with its {x} pressed; `summary` with `{{ run_id }}` in the expression color and the rest in the
  foreground color; the {x} and Template boxes have no shadow, the literal boxes have one
- **List line:** `host_list` draws `["web-1", "web-2", {{ backup_host }}]` on one line, `{{ backup_host }}` in the
  expression color without quotes as far as it shows, the rest in the list color; the box gives the text at least
  297 px (the mock's room); a line wider than that (the font decides) ends with an ellipsis at the box edge, clear of
  the null button, and the expand shows it whole
- **Masked secret:** `api_token` ticked Secret; lock, pencil and eight dots in that order; no expand; {x} shown; the
  button is named `api_token: Edit protected value`
- **Types:** String, Integer, String, String, Array, Map held at 50 percent; `last_error` String enabled
- **Error (step 4):** `Value is required` 4 px under the `next_attempt` box (12 / 16 px, destructive), starting at the
  box; the box red, its {x} pressed, its expand kept; the row grows 20 px; Save disabled with
  `Save is disabled: the settings have errors`
- **Themes:** every check above in the dark and the light theme; a screenshot of the window is attached before and
  after the error
