# V-CANVAS-SHORTCUTS: Keyboard Shortcuts for Canvas Operations

Verify keyboard shortcuts for clipboard, editing, and history operations on the workflow canvas.

## Prerequisites

No special seeding required. Tests use an empty canvas with palette drag-drop.

## Steps

1. Open http://localhost:3000/workbench
2. Drop one or more nodes from palette
3. Select nodes, then test each shortcut
4. Verify clipboard operations (copy, cut, paste, duplicate)
5. Verify history operations (undo, redo)
6. Verify focus guards (shortcuts don't fire in text inputs)

## Validation

- **Ctrl+A:** Selects all workflow nodes (data-selected="true")
- **Ctrl+C + Ctrl+V:** Copies selected nodes, paste creates new nodes
- **Ctrl+X + Ctrl+V:** Cuts removes selected nodes, paste restores them
- **Ctrl+D:** Duplicates selected nodes immediately (node count increases)
- **Ctrl+Z:** Undoes last action (redo button becomes enabled)
- **Ctrl+Shift+Z:** Redoes undone action (undo button becomes enabled)
- **Focus guard:** Ctrl+A in search input selects text, not nodes
