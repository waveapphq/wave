# V-LIST-11: Executions List

Verify Executions list displays execution history with filters, pagination, status badges, and appropriate actions.

## Prerequisites

```bash
./tests/e2e/scripts/reset.sh
./tests/e2e/fixtures/lists/v-list-11/01-seed.sh
```

## Steps

1. Open http://localhost:3000/executions

## Validation

**Page Structure:**
- **Page title:** "Executions" (h1)
- **NO "New" button:** Per LIST-8, executions are created by running entities
- **NO Mass Action button:** Per EXEC-1/EXEC-2, executions are read-only
- **No breadcrumb:** List pages have no breadcrumb per design
- **Single heading:** Exactly one "Executions" heading

**Filters:**
- **Search bar:** Placeholder "Search executions..."
- **Status filter:** Multi-select dropdown (Running, Passed, Failed, Stopped)
- **Type filter:** Multi-select dropdown (Test, Suite, Regression) - unique to executions
- **Columns button:** Visible

**Table:**
- **No checkbox column:** No selection for read-only entity
- **Columns:** Name, Type, Triggered By, Started, Duration, Status, Actions
- **Rows:** 30 executions with pagination

**Status Badges:**
- **Passed:** Green badge
- **Failed:** Red badge
- **Running:** Blue badge with pulsing dot (animate-pulse per DASH-21)
- **Stopped:** Gray badge

**Row Actions:**
- **View (eye icon):** Visible on all rows
- **Stop (square icon):** Visible ONLY for running executions
- **Actions menu (kebab):** Visible on all rows

**Triggered By Values:**
- User names: Will, Ashley, Edward
- System: "CI Pipeline", "Scheduled"

**Duration Format:**
- Short: "45s", "5s"
- Medium: "2m 34s", "8m 45s"
- Long: "1h 12m"

**Type Values:**
- Test, Suite, Regression

**Pagination (per LIST-2):**
- **Info text:** "Showing X-Y of 30 executions"
- **Page size selector:** Dropdown visible
- **First/Last buttons:** Visible
- **Anchored at bottom:** Uses flex-shrink-0

**Layout (DASH-4, DASH-5, DASH-8):**
- **Viewport filling:** Page container has h-full, overflow-hidden
- **Table grows:** Table area flex-grows to fill available space
- **No horizontal scroll:** Page width fits viewport

**Empty State (per LIST-6):**
- **Icon:** Play icon (CirclePlay)
- **Message:** "No executions yet"
- **Description:** "Run a test, suite, or regression to see execution history here"
- **CTA:** "Go to Tests" with primary styling (navigates to /tests)
- **Filters disabled:** Status and Type filters are disabled when empty

**Loading State (per LIST-4):**
- **Skeleton rows:** 9 skeleton rows during loading
- **aria-busy:** Page container has aria-busy="true" during loading
