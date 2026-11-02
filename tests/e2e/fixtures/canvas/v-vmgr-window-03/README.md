# V-VMGR-WIN-03: The Input Parameter Window

Verify the input parameter window: an enum
input in Add, an input just made an enum in Edit, the enum's Current value, and a plain Required input
(VMGR-108, VMGR-111, VMGR-112, VMGR-113, VMGR-114).
Spec: `tests/e2e/visual/canvas/v-vmgr-window-03.spec.ts`.

## Prerequisites

None - each test creates a `zz-` Test through `POST /tests` holding two Local Functions, `NewInputs`
(empty) and `EditInputs` (one optional String input `env` with the default `local`), checks it validates
with zero errors, opens it and deletes it afterwards.

## Steps

1. Open the Test in the workbench; for the light test, switch the theme with the shell toggle.
2. Dig into `NewInputs`. "+ Add" > Input parameter: Name `env`, tick Create enum, Allowed values
   `["dev", "staging", "prod"]`, Default value `dev`, Create.
3. "+ Add" > Input parameter: Name `host`, tick Required; Cancel and answer Close.
4. Back at the Test, dig into `EditInputs`. Pencil on `env`: tick Create enum, Allowed values
   `["dev", "staging", "prod"]`; then pick `dev` and Save.
5. Pencil on `env`, pill Current, pick `staging`; Cancel and answer Close.

## Validation

- **Window:** 560 px wide; `New input parameter` / `Edit input parameter`; green `IN` badge right before
  the close X
- **Description and Type:** `Description` over an 80 px textarea with the placeholder `What this parameter
  is for` and a resize grip; half-width Type `String` with `Text value`; no Kind
- **Checkboxes:** `Required (the Function Block must set a value)`, `Mark as secret (value will be
  masked)`, `Set to null`, `Create enum (limit the Function Block to a fixed set of values)`, in that order
- **Enum on:** Required ticked and locked (`locked on while enum is set`); Mark as secret and Set to null
  unticked and locked (`off while enum is set`); `Allowed values` right after Create enum as one line
  `["dev", "staging", "prod"]` in the list color with Open editor
- **Enum New:** `Default value` select reads `dev`; Create enabled; the input is created
- **Default just made an enum:** `Value` with the indigo `Default` pill; empty `Select…` with the red
  border and the red `Default value is required` under it; Save disabled until `dev` is picked
- **Current:** `Value` with the amber `Current` pill; the select reads `staging`; Name, Description and
  Type editable; Save enabled
- **Plain Required:** Required ticked and enabled; Mark as secret free; Set to null unticked and locked
  (`off while Required is set`); Create enum free; `Default value` an empty field with no placeholder and
  Open editor; Create enabled
- **Themes:** every check above in the dark and the light theme; a screenshot of each frame is attached
