# V-CANVAS-03-S40/S41: Canvas Context Menu Reset

Verify that the canvas right-click context menu includes a Reset option that is disabled when idle and enabled after execution completes.

## Prerequisites

```bash
./tests/e2e/scripts/reset.sh
./tests/e2e/fixtures/canvas/v-canvas-04/01-seed.sh
```

Reuses the v-canvas-04 fixture (test with Log workflow + environments).

## Steps

1. Open http://localhost:3000/workbench?editTest=ac04e000-0001-0001-0001-000000000001
2. Right-click on empty canvas area
3. Verify Reset menu item is visible but disabled (idle state)
4. Run the test workflow to completion
5. Right-click on empty canvas again
6. Verify Reset is now enabled
7. Click Reset to clear execution state

## Validation

- **Reset visible:** Always shown as last item in canvas context menu
- **Disabled when idle:** aria-disabled="true" when status is idle
- **Enabled after execution:** No aria-disabled when status is passed/failed/stopped
- **Clears execution state:** Status returns to idle, node execution icons removed
- **Preserves user intent:** Skip/disable states are NOT cleared by Reset
