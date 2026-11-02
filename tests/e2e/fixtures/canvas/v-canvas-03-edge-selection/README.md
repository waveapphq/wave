# V-CANVAS-03-S37/S38/S39: Edge Selection & Keyboard Deletion

Verify that edges can be selected by clicking, deselected by clicking canvas, and deleted with the Delete key.

## Prerequisites

No special seeding required. Tests use an empty canvas with palette drag-drop.

## Steps

1. Open http://localhost:3000/workbench
2. Drop a node near Start to auto-connect
3. Click the edge to select it
4. Verify zinc-400 (#A1A1AA) stroke + 3px width
5. Click empty canvas to deselect
6. Select edge again and press Delete

## Validation

- **Default edge:** #71717A stroke, 2px width
- **Selected edge:** #A1A1AA stroke, 3px width
- **Mutual exclusivity:** Selecting edge deselects nodes, selecting node deselects edges
- **Deselection:** Canvas click returns edge to default styling
- **Deletion:** Delete key removes selected edge from canvas
