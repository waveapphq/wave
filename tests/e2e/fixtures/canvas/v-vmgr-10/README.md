# V-VMGR-10: Watchers - Null and Empty Bodies Centered

Verify watchers draw a whole null in the null look and keep `null` / `no items` centered in the body at
any watcher size (VMGR-93, VMGR-94), keep their footer controls for null (no Edit, VMGR-106), and draw a null item
inside an array in the null look. Spec:
`tests/e2e/visual/canvas/v-vmgr-10.spec.ts`.

## Prerequisites

None - the spec imports `fixture.json` through `POST /tests` (zero-error validation), opens
`/workbench?editTest={id}` at 1800x1200 and deletes the Test afterwards. The fixture holds
`null_string`, `null_integer`, `null_table`, `null_array` (null), `empty_array` (`[]`) and
`arr_null_item` (`["a", null, "c"]`).

## Steps

1. Read the stored Test back (`GET /tests/{id}`).
2. Open watchers for `null_string`, `null_integer`, `null_array`, `empty_array`, `null_table` from the
   Variable Manager and drag them apart over the canvas.
3. Resize `null_array` smaller and `null_string` and `null_table` larger with the corner grip.
4. On `null_array`, switch the view select to Code and back to Visual.
5. Close the five watchers and open `arr_null_item`.

## Validation

- **Body text:** `null` (four null watchers) and `no items` (`empty_array`), italic, monospace, muted
- **Sizes as opened:** `null_integer` is the narrowest and shortest watcher; `null_table` and
  `null_array` are taller than `null_string`
- **Centered:** the text's center is within 2px of the body's center on both axes (horizontally the
  body box, vertically between header and footer), as opened and again after the resize
- **Footers, left to right:** `null_string` `Current`, `Auto`; `null_integer` `Current`; `null_array`
  and `null_table` `Current`, `Visual`; `empty_array` `Current`, `Visual`, `0 items`; no count on a
  null watcher; no watcher has an Edit button (the watcher only shows values, VMGR-106)
- **View select (VMGR-94):** Visual and Code; Code shows `null` with no count; back on Visual the text is
  centered again
- **Null item (VMGR-93):** item 1 reads `null` in the null look, items `"a"` and `"c"` upright; `3 items`
- **Attachments:** `watchers-null-centered.png`, `watchers-null-resized.png`, `watcher-null-item.png`
