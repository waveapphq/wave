# V-CANVAS-RB-S1, S2, S5: Rubber-Band Selection & Chain Select

Verify Shift+drag rubber-band box selection and the Shift+click chain selection no-op cases on the canvas.

## Prerequisites

No special seeding required. Tests create nodes dynamically via palette drag-drop.

## Steps

1. Clear workbench session and localStorage
2. Open http://localhost:3000/workbench
3. Add workflow nodes from palette at specific positions
4. Perform Shift+drag or Shift+click interactions
5. Verify selection state via data-selected attribute

## Validation

### V-CANVAS-RB-S1: Shift+Drag Selection Rectangle
- Shift+drag on canvas background draws a visible selection rectangle
- React Flow renders `.react-flow__selection` element during Shift+drag
- Regular drag without Shift pans the canvas (no selection box)

### V-CANVAS-RB-S2: Additive Box Selection
- Shift+drag selects all nodes whose bounding boxes intersect the rectangle
- Selection is additive: previously selected nodes remain selected
- Partial intersection is sufficient (no full containment needed)

### V-CANVAS-RB-S5: Chain Select No-Op Cases
- Shift+click with no nodes selected: no chain select fires
- Shift+click on unconnected node: BFS finds no path, no extra nodes selected
