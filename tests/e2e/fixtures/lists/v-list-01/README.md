# V-LIST-01: Tests List Populated

Verify tests list displays data table with filters, pagination, and status badges.

## Prerequisites

```bash
./tests/e2e/scripts/reset.sh
./tests/e2e/fixtures/lists/v-list-01/01-seed.sh
```

## Steps

1. Open http://localhost:3000/tests

## Validation

- **Page header:** "Tests" title with "+ New Test" button (top right)
- **Search:** Search bar with placeholder "Search tests..."
- **Filters:** Status, Suite, Tags dropdowns visible
- **Toolbar:** "Mass Action" and "Columns" buttons present
- **Table columns:** Name, Suite, Status, Last Run, Actions
- **Status badges (LIST-7):**
  - Passed: green
  - Failed: red
  - Never Run: gray
- **Actions column:** Run button (play icon), overflow menu (...)
- **Pagination (LIST-2):** "Showing X-Y of Z tests", page size selector, page numbers
