# V-CANVAS-03: Selected State Visual

Verify selected block displays proper visual feedback including white dashed halo and action row.

## Prerequisites

No fixtures required. Test creates nodes dynamically from palette.

## Steps

1. Open http://localhost:3000/workbench
2. Drag HTTP Client block from palette to canvas
3. Click on the block to select it

## Validation

- **Selection halo:** White dashed outline (2px, 4px offset) wraps entire node
- **Connection handles:** Input (top) and output (bottom) handles visible
- **Action row:** Appears below selected block
- **Action row content:** Version indicator (left), gear icon, kebab icon (right)
- **Surrounding UI:** Layout unchanged by selection
- **Context menu:** Kebab opens menu with Run/Debug/Edit/State/Delete groups
- **Multi-select:** Action row hidden when multiple nodes selected
