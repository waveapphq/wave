# V-CANVAS-03-S44/S45: Pill-Shaped Connection Handles

Verify all nodes display pill-shaped handles (16x8px) with directional chevron on egress handles.

## Prerequisites

No special seeding required. Tests use an empty canvas with palette drag-drop.

## Steps

1. Open http://localhost:3000/workbench
2. Verify Start node has pill-shaped output handle with green-500 fill
3. Drop a workflow node from palette
4. Verify input handle is pill-shaped (16x8px, zinc-600 fill, no icon)
5. Verify output handle is pill-shaped with chevron (ChevronDown)
6. Add multiple node types and verify all have pill handles

## Validation

- **Pill shape:** !w-4 (16px) and !h-2 (8px) with !rounded-full
- **Regular node color:** !bg-zinc-600 (solid, no alpha)
- **Start node color:** !bg-green-500
- **Hover ring:** zinc-400 for regular, green-400 for Start (2px ring)
- **Chevron on output:** data-testid="handle-chevron" present on output handles only
- **No chevron on input:** Input handles are plain pills without icons
- **Override:** !important used to override React Flow's default 6px handle CSS
