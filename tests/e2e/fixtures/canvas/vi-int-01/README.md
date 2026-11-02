# VI-INT-01: Drag Block from Palette to Canvas

Verify drag-and-drop functionality from palette to canvas creates workflow blocks.

## Prerequisites

No special seeding required.

## Steps

1. Navigate to http://localhost:3000/workbench
2. Expand the palette panel
3. Drag a control/plugin item from palette
4. Drop onto the React Flow canvas area

## Validation

- **Draggable items**: Palette items have `draggable="true"` attribute
- **Block creation**: New workflow node appears at drop position
- **Icon display**: Created block shows icon with `data-icon` attribute
- **Sequential drops**: Multiple blocks can be dropped one after another
