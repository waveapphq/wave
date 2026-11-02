# VI-INT-02: Click to Select Block

Verify click interaction for block selection and deselection.

## Prerequisites

No special seeding required - tests add nodes via drag/drop from palette.

## Steps

1. Navigate to http://localhost:3000/workbench
2. Add workflow blocks by dragging from palette
3. Click on a workflow block
4. Click on canvas background
5. Click on a different block

## Validation

- **Click selects**: Node gets `data-selected="true"` attribute on click
- **Click canvas deselects**: Clicking empty canvas area clears selection
- **Selection changes**: Clicking a different node changes selection to that node
- **Single selection**: Only one node selected at a time by default
- **Data attribute**: Selection state is queryable via `data-selected` attribute
- **Double-click safe**: Double-clicking does not cause errors
- **Selection stable**: Selection persists through non-deselecting interactions

Note: This test covers INTERACTION behavior only. Visual styling (2px border, etc.) is covered by V-CANVAS-03.
