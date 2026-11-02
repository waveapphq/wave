# V-LIST-10: Regression Run Dialog

Verify Run Dialog displays correctly with test selection (grouped by suite) and environment selection.

## Prerequisites

```bash
./tests/e2e/scripts/reset.sh
./tests/e2e/fixtures/lists/v-list-10/01-seed.sh
```

## Steps

1. Open http://localhost:3000/regressions
2. Click the Run button on any regression row
3. Verify the Run Dialog opens

## Validation

**Dialog Structure (LISTRUN-1 through LISTRUN-3):**
- **Modal overlay:** Semi-transparent background (#00000080)
- **Dialog width:** 320px, centered in viewport
- **Header:** "Run Regression" title with close (×) button
- **Subtitle:** Shows regression name (e.g., "WAVE 25.12")

**Test Selection (Regression-specific):**
- **Section header:** "Select Tests"
- **Select All:** Checkbox with "X of Y selected" counter
- **Suite groups:** Expandable/collapsible sections (Collapsible component)
- **Suite header:** Chevron + Suite name + Suite checkbox + "X/Y" counter
- **Tests:** Listed under each suite with individual checkboxes
- **Scroll area:** Wraps entire grouped list for overflow

**Environment Selection (LISTRUN-4 through LISTRUN-9):**
- **Search input:** "Search environments..." placeholder
- **ALL ENVIRONMENTS section:** Scrollable list of all environments
- **NO "Remember selection" checkbox:** Per LISTRUN-9

**Footer (LISTRUN-10 through LISTRUN-11):**
- **Divider:** Visual separator above footer
- **Buttons:** Cancel + Run, right-aligned
- **Run button:** Primary styling (blue)

**Interactions:**
- **Close button (×):** Closes dialog
- **Cancel button:** Closes dialog
- **Escape key:** Closes dialog
- **Select All:** Toggles all tests across all suites
- **Suite checkbox:** Toggles all tests within that suite
- **Environment search:** Filters environment list

**Accessibility:**
- **Dialog role:** role="dialog" with aria-modal="true"
- **Focus management:** Dialog traps focus when open
- **Keyboard navigation:** Tab, Escape supported
