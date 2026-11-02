# V-LIST-09: Regressions List Populated

Verify Regressions list displays data table with filters, pagination, and all status types.

## Prerequisites

```bash
./tests/e2e/scripts/reset.sh
./tests/e2e/fixtures/lists/v-list-09/01-seed.sh
```

## Steps

1. Open http://localhost:3000/regressions

## Validation

**Page Structure:**
- **Page title:** "Regressions" (h1) with "+ New Regression" button
- **No breadcrumb:** List pages have no breadcrumb per design
- **Single heading:** Exactly one "Regressions" heading (no duplicate from breadcrumb)

**Filters (per LIST-1):**
- **Search bar:** Placeholder "Search regressions..."
- **Status filter:** Multi-select dropdown visible
- **Tags filter:** Multi-select dropdown visible
- **Columns button:** Visible
- **NO Mass Action button:** Regressions are top of hierarchy, no Mass Action per wireframe

**Table (per LIST-1):**
- **Columns:** Name, Version, Suites (count), Tests (total), Status, Last Run, Actions
- **No checkbox column:** No selection for regressions (no Mass Action)
- **Rows:** 30 regressions displayed with pagination

**Names (per LIST-9):**
- **Naming pattern:** "AppName Version" (e.g., "WAVE 25.12", "Billing v2.1")

**Status Badges (per LIST-7):**
- **Passed:** Green badge (18 regressions)
- **Failed:** Red badge (7 regressions)
- **Never Run:** Gray badge (5 regressions)

**Row Actions:**
- **Run button:** Visible and prominent on each row
- **Actions menu:** Kebab menu with additional actions (Edit, Duplicate, Delete)

**Pagination (per LIST-2):**
- **Info text:** "Showing X-Y of 30 regressions"
- **Page size selector:** Dropdown visible
- **Anchored at bottom:** Uses flex-shrink-0

**Layout (DASH-4, DASH-5, DASH-8):**
- **Viewport filling:** Page container has h-full, overflow-hidden
- **Table grows:** Table area flex-grows to fill available space
- **No horizontal scroll:** Page width fits viewport

**Empty State (per LIST-6):**
- **Icon:** Purple layers icon for regressions
- **Message:** "No regressions yet"
- **CTA:** "Create Your First Regression" with primary styling
