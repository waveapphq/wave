# V-SAVE-02: Close Confirmation Dialog

Verify Close button behavior and confirmation dialog when canvas has unsaved changes.

## Prerequisites

No fixture seeding required. Tests operate on fresh canvas state.

```bash
# Clear localStorage and reset canvas state (handled in beforeEach)
```

## Steps

1. Open http://localhost:3000/workbench
2. Add a block to canvas to make it dirty
3. Click Close button in toolbar
4. Interact with confirmation dialog

## Validation

**Close Button State:**
- **Clean canvas:** Close button is disabled (grayed out)
- **Dirty canvas:** Close button is enabled (clickable)

**Dialog Structure:**
- **Title:** "Unsaved Changes"
- **Warning icon:** Orange/yellow warning icon visible
- **Message:** Explains unsaved changes
- **Buttons:** "Save and Close" and "Discard and Close"

**Button Behavior:**
- **Save and Close:** Opens Save dialog, after save resets canvas
- **Discard and Close:** Resets canvas immediately
- **X button:** Closes dialog without action (canvas unchanged)
- **Escape:** Closes dialog without action (canvas unchanged)

**After Action:**
- URL remains `/workbench` (user stays in Workbench)
- Canvas is empty (no workflow nodes)
- Breadcrumb shows "Draft Workflow"
- localStorage draft is cleared
