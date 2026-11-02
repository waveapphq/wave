# VI-INT-03: Connect Blocks with Edge

Verify edge creation interaction between workflow blocks.

## Prerequisites

No special seeding required - tests add nodes via drag/drop from palette.

## Steps

1. Navigate to http://localhost:3000/workbench
2. Add workflow blocks by dragging from palette
3. Drag from source handle (`.react-flow__handle-bottom`) to target handle (`.react-flow__handle-top`)
4. Test various connection scenarios

## Validation

- **Handles exist**: React Flow handles (`.react-flow__handle`) are attached to workflow nodes
- **Auto-connect**: Dropping node near Start node creates edge automatically
- **Manual connection**: Dragging handle to target creates `.react-flow__edge`
- **Self-loop rejected**: Cannot connect node's source to its own target
- **Duplicate rejected**: Cannot create edge that already exists (same source → target)
- **Reverse allowed**: Can create B→A edge even if A→B exists
