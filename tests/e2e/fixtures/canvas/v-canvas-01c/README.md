# V-CANVAS-01c: Canvas Breadcrumb Bar

Verify canvas breadcrumb bar structure, navigation, and status indicator in idle state.

## Prerequisites

```bash
./tests/e2e/scripts/reset.sh
```

No additional seeding required - tests idle canvas state.

## Steps

1. Navigate to http://localhost:3000/tests/new
2. For workbench test: Navigate to http://localhost:3000/workbench

## Validation

- **Breadcrumb height**: Breadcrumb bar container is exactly 36px tall
- **Back arrow visible**: Left side shows clickable back arrow navigation
- **Draft path**: Shows "Draft Workflow" text for unsaved workflows (or "Draft Block" on /workbench)
- **Idle status**: Right side shows "Idle" status indicator with muted gray styling (per CANVAS-33)
- **Reset hidden**: "Reset" link is not visible in idle state
- **Back clickable**: Back arrow is a button/link element with pointer cursor, not disabled
- **Element ordering**: Left-to-right order: Back arrow | Path text | Status indicator
