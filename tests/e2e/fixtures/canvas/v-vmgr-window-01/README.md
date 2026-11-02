# V-VMGR-WIN-01: The Test Variable Window

Verify the one variable window for a Test variable: New variable (Map), Edit with Initial and Edit with
Current (VMGR-106, VMGR-108, VMGR-109, VMGR-110, VMGR-114).
Spec: `tests/e2e/visual/canvas/v-vmgr-window-01.spec.ts`.

## Prerequisites

None - each test creates a `zz-` Test through `POST /tests` holding the Map variable
`conf = {"host": "db.internal", "port": 5432, "user": "wave"}` and one Log Block, checks it validates with
zero errors, opens it and deletes it afterwards.

## Steps

1. Open the Test in the workbench; for the light test, switch the theme with the shell toggle.
2. Stage a Current value before any run: pencil on `conf`, pill Current, type
   `{"host": "db.internal", "port": 6543, "user": "wave"}`, Save.
3. Variable Manager "+ Add": pick Type Map; type a name, then empty it; Cancel and answer Close.
4. Pencil on `conf`: the window opens on Initial; switch the pill to Current; Cancel.

## Validation

- **Window:** 410 px wide, rounded border, resize corner at the bottom right
- **Header:** grip, `New variable` / `Edit variable` at 18 px semibold, close X at the right, no badge
- **Labels:** Name, Type, Kind, Value at 16 px medium, 6 px above their field
- **Fields:** Name 36 px monospace (Add placeholder `variable_name`); Type `Map` with the muted
  `Key-value pairs` and Kind `Literal` in two equal columns 12 px apart; `Mark as secret (value will be
  masked)` above `Set to null`, 14 px, both enabled
- **Add:** `Value` with no pill; `{}` on one monospace line in the map color; icon-only borderless 32 x 32
  Open editor button right of it; Cancel then Create, Create disabled until a name is typed
- **Edit, Initial:** 22 px, 12 px semibold indigo `Initial` pill with its chevron right after `Value`,
  centered on it; the saved map on one line cut with "…"; Cancel then Save, Save enabled
- **Edit, Current:** amber `Current` pill; the staged map; Name, Type, Kind and both checkboxes enabled;
  Save enabled
- **Themes:** every check above in the dark and the light theme; a screenshot of each frame is attached
