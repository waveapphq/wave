# V-LIST-08: Suites List Empty

Verify Suites list displays empty state with call-to-action.

## Prerequisites

```bash
./tests/e2e/scripts/reset.sh
# No additional seeding needed - empty state test
```

## Steps

1. Open http://localhost:3000/suites

## Validation

**Page Header:**
- **Page title:** "Suites" (h1) visible
- **New Suite button:** "+ New Suite" button visible

**Empty State (per LIST-6):**
- **Icon:** FolderKanban icon visible (entity-specific)
- **Title:** "No suites yet" message
- **Description:** Encouraging message visible
- **CTA button:** "Create Your First Suite" with primary (blue) styling

**Filters:**
- **Status filter:** Visible but muted
- **Tags filter:** Visible but muted
- **Columns button:** Visible
- **Mass Action button:** NOT visible in empty state

**Table:**
- **No data rows:** Table body is empty (0 rows)
