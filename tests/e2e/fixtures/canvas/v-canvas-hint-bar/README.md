# V-CANVAS-HB-S1 to S7: Interactions Hint Popover

Verify the floating hint popover and circle toggle button for keyboard shortcut reference.

## Prerequisites

No special seeding required. Tests use an empty canvas with cleared localStorage.

## Steps

1. Clear workbench session and localStorage
2. Open http://localhost:3000/workbench
3. Verify circle button visible bottom-right
4. Verify popover is closed by default
5. Click ? to open popover
6. Verify 4 sections, 15 shortcuts, key badges
7. Click ? again to close
8. Click outside to close
9. Verify aria-label and aria-expanded

## Validation

### V-CANVAS-HB-S1: Toggle Button Visibility
- Circle button (rounded-full) with "?" text visible bottom-right of canvas

### V-CANVAS-HB-S2: Default Closed State
- Popover content not in DOM when closed
- No section headers (EDITING, SELECTION, NAVIGATION, HISTORY) visible

### V-CANVAS-HB-S3: Popover Content
- 4 uppercase section headers: EDITING, SELECTION, NAVIGATION, HISTORY
- 3 separators between sections
- 15 shortcut entries total
- Editing (6): Copy, Cut, Paste, Duplicate, Delete, Unlink
- Selection (5): Select, Multi-select, Box Select, Chain Select, Select All
- Navigation (2): Zoom, Pan
- History (2): Undo, Redo
- Key badges: Del, Backspace, Click, Shift+Drag, Shift+Click, Scroll, Drag

### V-CANVAS-HB-S4: Platform-Aware Modifiers
- Ctrl-based shortcuts on Linux (Ctrl+C, Ctrl+X, Ctrl+V, Ctrl+D, Ctrl+A, Ctrl+Z)
- Ctrl+Click for Multi-select
- No ⌘ modifier on Linux

### V-CANVAS-HB-S5: Toggle Close
- Second click on ? closes popover (removes from DOM)

### V-CANVAS-HB-S6: Outside Click
- Clicking canvas background closes the popover

### V-CANVAS-HB-S7: Accessibility
- aria-label="Toggle keyboard shortcuts"
- aria-expanded reflects open/closed state
- Button element (<button>) for keyboard accessibility
