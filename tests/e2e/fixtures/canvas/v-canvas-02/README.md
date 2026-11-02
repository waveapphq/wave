# V-CANVAS-02: Block Appears on Canvas

Verify populated canvas displays multiple blocks with connecting edges.

## Prerequisites

No special seeding required - tests add nodes via drag/drop from palette.

## Steps

1. Navigate to http://localhost:3000/workbench
2. Add workflow blocks by dragging from palette
3. Connect blocks by dragging handles
4. Verify canvas renders the workflow correctly

## Validation

- **Block count**: At least 3 workflow nodes visible after adding via palette
- **Edges**: Edges connect blocks using smoothstep routing
- **Icons visible**: Each block displays an icon (`[data-testid="workflow-node-icon"]`)
- **No overlap**: Blocks have proper spacing, no overlapping bounding boxes
- **Within viewport**: All blocks are at least partially visible in canvas bounds
