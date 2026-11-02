# V-CANVAS-03-S46: Single Connection Enforcement & Edge Relocation

Verify that nodes enforce single ingress/egress connections and that dragging from occupied handles triggers edge relocation.

## Prerequisites

No special seeding required. Tests use an empty canvas with palette drag-drop.

## Steps

1. Open http://localhost:3000/workbench
2. Create Start -> If-Else connection via auto-connect
3. Try to connect Start to a second node (should fail - has-egress)
4. Try to connect another node to If-Else (should fail - has-ingress)
5. Drag from If-Else's occupied input handle to initiate relocation
6. Observe muted original edge (dashed, 40% opacity, red X label)
7. Drop on empty canvas to restore original edge

## Validation

- **Single egress:** Cannot create second outgoing edge from Start
- **Single ingress:** Cannot create second incoming edge to If-Else
- **Edge relocation:** Dragging from occupied handle enters relocation mode
- **Muted edge:** Original edge shows dashed stroke, 40% opacity, red X label
- **Cancel relocation:** Dropping on empty canvas restores original edge
- **Reconnect:** Dropping on valid target reconnects the edge (not tested here due to complexity)
