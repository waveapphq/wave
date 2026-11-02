# V-SAVE-01: Save Test Dialog

Verify Save Test Dialog structure, fields, validation, and behavior from Workbench toolbar.

## Prerequisites

No fixture seeding required. Tests operate on fresh canvas state.

```bash
# Clear localStorage and reset canvas state (handled in beforeEach)
```

## Steps

1. Open http://localhost:3000/workbench
2. Add a block to canvas to make it dirty
3. Click Save button in toolbar
4. Interact with dialog fields

## Validation

**Dialog Structure:**
- **Title:** "New Test" for new workflow
- **Name field:** Required, text input with placeholder
- **Description field:** Optional textarea
- **Tags field:** Free-form chip input (Enter/comma to add)
- **Suite selector:** Searchable dropdown with skeleton loading state

**Button Behavior:**
- **Cancel:** Closes dialog without saving
- **Create Test/Save:** Submits form, shows spinner during save
- **Escape:** Closes dialog (when not saving)

**Validation:**
- **Empty name:** Shows "required" error inline
- **Duplicate name:** Shows "already exists" error
- **API error:** Shows error in footer area

**Accessibility:**
- `aria-modal="true"` on dialog
- `aria-labelledby` pointing to title
- `aria-invalid="true"` on field with error

**After Save:**
- Dialog closes
- Breadcrumbs update from "Draft Workflow" to saved test name
