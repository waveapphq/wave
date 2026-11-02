# V-CANVAS-01h: Canvas Empty State

Verify canvas empty state displays onboarding components for new users.

## Prerequisites

```bash
./tests/e2e/scripts/reset.sh
```

No additional seeding required - tests empty canvas state.

## Steps

1. Navigate to http://localhost:3000/tests/new

## Validation

- **Start node visible**: Shows green play icon and "Start" label (per CANVAS-29)
- **Start positioned**: Start node is horizontally centered in upper portion of canvas
- **Placeholder block**: Dashed border container visible below the start node (per CANVAS-32). The connecting dashed line between Start and the placeholder is drawn as a React Flow edge.
- **Hint text**: Placeholder contains guidance text about dragging from palette (per CANVAS-30)
- **Pulse animation**: Start node has pulse animation when no outgoing connection
- **Z-ordering**: Top-to-bottom order: Start node → Placeholder
