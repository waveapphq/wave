# V-PROF-01: Profiles List Populated

Verify Profiles list page displays table with Type, Tags, Usage columns and actions.

## Prerequisites

```bash
./tests/e2e/scripts/reset.sh
./tests/e2e/fixtures/profiles/v-prof-01/01-seed.sh
```

## Steps

1. Open http://localhost:3000/profiles

## Validation

- **Page header:** "Profiles" title with "+ New Profile" button
- **Search bar:** Input with "Search profiles..." placeholder
- **Filters:** Type filter dropdown, Tags filter dropdown
- **NO Status filter:** Profiles don't execute, no status
- **NO Mass Action:** Not applicable for profiles
- **Columns button:** Present for column visibility toggle
- **Table columns:** Name, Type, Tags, Usage, Actions
- **Type badges:** Display profile type (database, ssh, http, etc.)
- **Tags badges:** Display tags as badges in Tags column
- **Usage column:** Shows "N tests" count
- **Actions column:** Edit button (pencil), kebab menu (Duplicate, Delete)
- **Delete disabled:** When Usage > 0, delete option is disabled
- **Pagination:** "Showing X-Y of Z profiles", page size selector, navigation
- **Layout:** Page fills viewport, pagination anchored at bottom
