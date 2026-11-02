# V-CANVAS-SHORTCUT-LABELS: Context Menu Shortcut Labels

Verify that keyboard shortcut labels appear on context menu items.

## Prerequisites

No special seeding required. Tests use an empty canvas with palette drag-drop.

## Steps

1. Open http://localhost:3000/workbench
2. Drop a node from palette
3. Right-click node to verify shortcut labels
4. Right-click empty canvas to verify shortcut labels
5. Drop a connected node, right-click edge to verify shortcut label
6. Click node kebab to verify shortcut labels in dropdown

## Validation

- **Node context menu:** Copy (Ctrl+C), Cut (Ctrl+X), Duplicate (Ctrl+D), Delete (Del), Unlink (Backspace)
- **Canvas context menu:** Paste (Ctrl+V), Select All (Ctrl+A). Fit View has no shortcut.
- **Edge context menu:** Delete (Del)
- **Kebab dropdown:** Same labels as node right-click context menu
- **Styling:** Labels are right-aligned, muted foreground color, aria-hidden="true"
