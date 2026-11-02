# V-VMGR-WIN-02: The Value Field Faces

Verify the variable window's value field for each type, kind and state
(VMGR-110, VMGR-111).
Spec: `tests/e2e/visual/canvas/v-vmgr-window-02.spec.ts`.

## Prerequisites

None - each test creates a `zz-` Test through `POST /tests` holding one Log Block and the Test variables
`s_str = "hello"`, `n_int = 42`, `b_bool = true`, `a_arr = [1, 2, 3]`, `m_map = {}`,
`t_tab = [{"host": "db-1", "port": 5432}, {"host": "db-2", "port": 5433}]`, `z_null = null` (String),
`sec` (a saved secret String) and `e_expr = n_int * 2` (Integer expression), checks it validates with zero
errors, opens it and deletes it afterwards.

## Steps

1. Open the Test in the workbench; for the light test, switch the theme with the shell toggle.
2. For each variable: press its pencil, read the Edit window, then Cancel (it closes at once).

## Validation

- **String / Array / Map:** `hello`, `[1, 2, 3]`, `{}` on one 36 px monospace line in the string, array
  and map colors, with the icon-only Open editor button
- **Table:** `[{"host": "db-1", "port": 5432}, {"host": "db-2", "port": 5433}]` on one line cut with "…",
  in the table color, with Open editor
- **Integer:** `42` in a full-width 36 px box in the integer color, no Open editor
- **Boolean:** the 144 px `true` / `false` control, `true` pressed in filled indigo, no Open editor
- **Set to null:** Kind gone, Type alone at half width, `Set to null` ticked, `null` in the null look,
  no Open editor
- **Secret:** Mark as secret ticked; a grayed masked field with the pencil and lock icons and eight dots,
  no Open editor
- **Expression:** Kind `Expression`; `n_int * 2` in the expression color; no Set to null row, no Open editor
- **Type row:** each Type reads its name with its muted hint; Kind beside it unless hidden
- **Themes:** every check above in the dark and the light theme; a screenshot of each face is attached
