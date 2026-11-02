# V-CANVAS-03-S42/S43: Auto-Connection Proximity Animation

Verify ghost edge and handle glow appear when dragging near a free output handle, and disappear when moving away.

## Prerequisites

No special seeding required. Tests use an empty canvas with palette drag-drop.

## Steps

1. Open http://localhost:3000/workbench
2. Drag a palette item near Start node (within ~100px threshold)
3. Observe ghost edge (dashed line) and handle glow (green pulse)
4. Move drag away from threshold
5. Observe ghost edge and glow disappear
6. Drop near Start to verify auto-connect creates edge
7. Drop far from Start to verify no auto-connect

## Validation

- **Ghost edge:** Dashed #A1A1AA at 60% opacity, smoothstep bezier from source output to drag position
- **Handle glow:** Source handle shows ring-green-400, bg-green-500, animate-pulse
- **Threshold:** ~100px from free output handle
- **Auto-connect:** Drop within threshold creates edge; outside threshold does not
- **Start participation:** Start node's handle glows during proximity on empty canvas
- **Pulse stops:** Start node stops pulsing animation after connection made
