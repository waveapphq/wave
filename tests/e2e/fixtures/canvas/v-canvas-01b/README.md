# V-CANVAS-01b: Canvas Toolbar

Verify canvas toolbar structure, button groups, and controls in idle workflow state.

## Prerequisites

```bash
./tests/e2e/scripts/reset.sh
```

No additional seeding required - tests idle canvas state.

## Steps

1. Navigate to http://localhost:3000/tests/new

## Validation

- **Toolbar height**: Toolbar container is exactly 44px tall
- **Left button group**: Contains Save, Undo, Redo buttons with 8px gaps
- **Right button group**: Contains Environment selector, Debug gear, Debug button, Run button
- **Close button hidden**: Close (×) button not visible in draft state
- **Environment placeholder**: Selector shows placeholder text when no environment selected
- **Split button pattern**: Run and Debug buttons have primary action + dropdown trigger
- **Button states in empty canvas**:
  - Save: DISABLED (no changes to save)
  - Undo: DISABLED (no history)
  - Redo: DISABLED (no future)
  - Environment selector: ENABLED
  - Debug gear: ENABLED
  - Debug: DISABLED (no environment selected)
  - Run: DISABLED (no environment selected)
- **Debug popover**: Clicking gear opens popover with "Pause on first block" and "Pause on errors" checkboxes
- **Right group order**: Left-to-right: Environment → Gear → Debug → Run
