# V-CANVAS-04: Running State Visual Test

Verify execution state visualization on canvas during workflow run.

## Prerequisites

```bash
./tests/e2e/scripts/reset.sh
./tests/e2e/fixtures/canvas/v-canvas-04/01-seed.sh
```

## Steps

1. Open http://localhost:3000/workbench
2. Create a workflow with multiple blocks
3. Select an environment
4. Start the run
5. Observe execution states on nodes

## Validation

- **Breadcrumb status**: "Running" with blue pulse indicator during execution
- **Running block**: Blue border (#3B82F6) with pulse animation
- **Success block**: Green border (#22C55E) with checkmark icon
- **Failed block**: Red border (#EF4444) with X icon
- **Pending block**: Gray border (#A1A1AA), no icon
- **Status transitions**: States change as execution progresses
- **Reset clears**: Reset button clears execution states
