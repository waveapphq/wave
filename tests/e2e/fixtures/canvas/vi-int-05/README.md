# VI-INT-05: Zoom/Pan Canvas

Verify zoom and pan controls for navigating the workflow canvas.

## Prerequisites

No special seeding required - tests use the empty canvas with Start node.

## Steps

1. Navigate to http://localhost:3000/workbench
2. Use mouse wheel to zoom in/out
3. Click-drag on canvas background to pan
4. Click fit-to-screen button

## Validation

- **Mouse wheel zoom**: Scroll up (negative deltaY) zooms in, scroll down zooms out
- **Click-drag pan**: Dragging on canvas background translates the viewport
- **Fit-to-screen**: React Flow's built-in `button.react-flow__controls-fitview`
- **Zoom buttons**: React Flow's `button.react-flow__controls-zoomin` and `button.react-flow__controls-zoomout`
- **Zoom limits**: Zoom is limited between ~10% and ~400%
- **Combined operation**: Pan and zoom work together smoothly
- **Pan does not select**: Panning action does not accidentally select nodes
- **Transform persistence**: Viewport state accessible via React Flow transform
