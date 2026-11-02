# V-LIST-07: Suites List Populated

Verify Suites list displays data table with filters, pagination, and all status types.

## Prerequisites

```bash
./tests/e2e/scripts/reset.sh
./tests/e2e/fixtures/lists/v-list-07/01-seed.sh
```

## Steps

1. Open http://localhost:3000/suites

## Validation

**Page Structure:**
- **Page title:** "Suites" (h1) with "+ New Suite" button
- **No breadcrumb:** List pages have no breadcrumb per design
- **Single heading:** Exactly one "Suites" heading (no duplicate from breadcrumb)

**Filters (per LIST-1):**
- **Search bar:** Placeholder "Search suites..."
- **Status filter:** Multi-select dropdown visible
- **Tags filter:** Multi-select dropdown visible
- **NO Suite filter:** Suites have no parent entity
- **Columns button:** Visible
- **Mass Action button:** Visible

**Table (per LIST-1):**
- **Columns:** Name, Tests (count), Status, Last Run, Actions
- **Rows:** 30 suites displayed with pagination

**Status Badges (per LIST-7):**
- **Passed:** Green badge (18 suites)
- **Failed:** Red badge (7 suites)
- **Never Run:** Gray badge (5 suites)

**Row Actions:**
- **Run button:** Visible on each row
- **Actions menu:** Kebab menu with additional actions

**Pagination (per LIST-2):**
- **Info text:** "Showing X-Y of 30 suites"
- **Page size selector:** Dropdown visible
- **Anchored at bottom:** Uses flex-shrink-0

**Layout (DASH-4, DASH-5, DASH-8):**
- **Viewport filling:** Page container has h-full, overflow-hidden
- **Table grows:** Table area flex-grows to fill available space
- **No horizontal scroll:** Page width fits viewport
