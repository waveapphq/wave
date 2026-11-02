# V-FIELD-BLOCK-STATES: The One Value Field on a Function Block Window

Verify every state of the one value field on the Function Block window `deploy_check` (FIELD-1, FIELD-2, FIELD-3, FIELD-4, FIELD-5, FIELD-6, FIELD-8,
CANVAS-207). Spec: `tests/e2e/visual/canvas/v-field-block-states.spec.ts`.

## Prerequisites

None - each test creates a `zz-11541-s1-block-states-` Test through `POST /tests` (seed in
`tests/e2e/visual/canvas/deploy-check-seed.ts`), checks it validates with zero errors, opens it and deletes it
afterwards. The Test holds the Test variable `backup_host` and the Local Function Block `deploy_check` with these
optional inputs unless noted:

| Input | Type | Default | Stored value |
|-------|------|---------|--------------|
| `region` | String | `eu-west-1` | not set |
| `owner` | String | `platform` | `qa-team` |
| `prefix` | String | none | `""` |
| `note` | String | none | `null` |
| `tags` | Array | `["smoke"]` | not set |
| `targets` | Array | none | `["web-1", backup_host, "web-3"]`, item 1 as {x} |
| `env` (Required) | String, allowed `dev`, `staging`, `prod` | `staging` | `staging` |

## Steps

1. Open the Test in the workbench; for the light test, switch the theme with the shell toggle.
2. Open `deploy_check`'s window from its cog.
3. Click `region`, press Ctrl+A, then Delete, then Backspace; click the Description.
4. Click `targets` and press `x`; click the Description.
5. Click `region`'s {x}, then click it again.
6. Cancel the window (answer Close if it asks).

## Validation

- **Chrome:** `deploy_check - Edit Config` with the Function icon; Name `deploy_check`; Description placeholder
  `Optional. Per-instance description for this Function.`; INPUT PARAMETERS with Parameter / Type / Value and the
  seven rows in order, each with its (i) and type, `env` with the red star; OUTPUT VARIABLES
  `This Function declares no outputs.`; Profiles, Cancel, Save (disabled)
- **Icon columns:** expand (two diagonal arrows) then {x} after every field, all in line; `env` keeps the expand
  column empty and keeps {x}
- **Gray default:** `region` `eu-west-1` and `tags` `["smoke"]` upright in Text Muted, whole text selectable, no
  reset, no ∅
- **Gray-default tooltip:** Delete and Backspace show `Not set, so the default is used. Type to use your own value.`
  above `region`; the value and the disabled Save stay
- **Reset:** `owner` `qa-team` in the string color, `Reset to default` counterclockwise icon inside at the right end
- **`<empty string>`:** `prefix` italic Text Muted, not selectable, its ∅ not pressed
- **`null`:** `note` italic monospace Text Muted, its ∅ inside at the right end, pressed (tint, primary color)
- **`{{ }}` line:** `targets` reads `["web-1", {{ backup_host }}, "web-3"]` once, on one whole line,
  `{{ backup_host }}` in the expression color, the rest in the list color; `x` shows
  `Has {{ }} entries. Open the editor to change it.` above it and changes nothing
- **Choice list:** `env` `staging` in a normal color with its chevron; no reset, no expand
- **One gray:** the gray defaults, the {x} hint `'eu-west-1'` (switched with no question), `null` and
  `<empty string>` all compute to `#71717a`
- **Stored Test:** unchanged after Cancel
- **Themes:** every check above in the dark and the light theme; a screenshot of the window is attached
