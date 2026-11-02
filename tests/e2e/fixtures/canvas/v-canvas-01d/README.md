# V-CANVAS-01d: Console Panel with Streaming Logs

Verify the console panel renders correctly with proper structure, collapse/expand functionality, and header elements.

## Prerequisites

```bash
./tests/e2e/scripts/reset.sh
./tests/e2e/fixtures/canvas/v-canvas-01d/01-seed.sh
```

## Steps

1. Open http://localhost:3000/workbench
2. Verify console panel exists at bottom of canvas
3. Toggle collapse/expand and verify dimensions
4. Verify header elements (title, icon, dropdown, buttons)
5. Expand and verify resize functionality

## Validation

### Panel Structure
- Console panel visible at bottom of canvas page
- Collapsed height is ~45px
- Expanded height is ~200px
- Panel spans full canvas width

### Collapse/Expand
- Toggle button toggles between collapsed/expanded states
- Height transitions smoothly (200ms transition)
- Resize handle only visible when expanded

### Header Elements
- "Console" title with emerald Activity icon
- Level dropdown with "Level:" label
- Settings button (gear icon)
- Clear button (trash icon)
- Copy button (copy icon)
- Separators between button groups

### Button States
- Clear button disabled when no entries
- Copy button disabled when no entries
- Header height is 48px (h-12)

### Resize Functionality
- Drag handle appears when expanded
- Dragging up increases panel height
- Panel respects min/max height constraints (100-600px)
