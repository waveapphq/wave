# V-CANVAS-01e: Variable Manager Panel Layout

Verify Variable Manager panel layout on the right edge of the canvas.

## Prerequisites

No seeding required - tests run on empty canvas.

## Steps

1. Open http://localhost:3000/workbench

## Validation (13 tests)

- **Panel position:** Visible on right edge of canvas with left border
- **Default state:** Panel starts expanded (defaultCollapsed={false})
- **Collapsed dimensions:** 64px width
- **Collapsed label:** Shows stacked vertical letters for "Variable Manager"
- **Collapsed icon:** Icon in rounded box (matches palette style)
- **Expanded dimensions:** 320px default width
- **Full height:** Panel fills canvas viewport height
- **Toggle:** Expand/collapse button toggles panel state
- **Border:** Left border visible for visual separation
- **Resize handle visible:** When expanded
- **Resize handle hidden:** When collapsed
- **Header:** Shows "Variable Manager" title with icon when expanded
- **Resizable:** Panel can be resized between 240px and 600px
