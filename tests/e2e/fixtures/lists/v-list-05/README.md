# V-LIST-05: Tests List Selection

Verify tests list selection mode with checkboxes and bulk actions.

## Prerequisites

```bash
./tests/e2e/scripts/reset.sh
./tests/e2e/fixtures/lists/v-list-05/01-seed.sh
```

## Steps

1. Open http://localhost:3000/tests
2. Click "Mass Action" button to enter selection mode

## Validation

- **Checkbox column (BULK-2):** 28px width, prepended to table
- **Row checkboxes:** Each row has a checkbox
- **Header checkbox:** Select all checkbox in header
- **Selection counter:** "X selected" displayed (starts at "0 selected")
- **Selection button (BULK-1):** ~118px width
- **Dropdown menu (BULK-1):** ~155px width when open
- **Bulk actions disabled (BULK-4):** With 0 selected, all menu items disabled
- **Bulk actions enabled:** With items selected, menu items enabled
- **Action grouping (BULK-3):**
  - Run All
  - Export All
  - Duplicate All
  - Move to Suite
  - ─────────── (separator)
  - Delete All (red text)
- **Selected row highlight:** Selected rows visually distinguished
- **Close button (X):** Exits selection mode
