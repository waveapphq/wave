# V-CANVAS-LOAD-01: Loading Overlay During Canvas Preparation

Verify loading overlay appears during canvas preparation with spinner and contextual message, then fades out smoothly when ready.

## Prerequisites

```bash
./tests/e2e/scripts/reset.sh
```

No additional seeding required - tests loading overlay behavior on blank canvas and with route-mocked test fetch.

## Steps

1. Navigate to http://localhost:3000/workbench (blank canvas)
2. Navigate to http://localhost:3000/workbench?editTest=test-load-01 (mocked test fetch)

## Validation

- **Overlay visible on mount**: Loading overlay appears immediately when canvas page loads
- **Spinner present**: Overlay contains 40px Loader2 spinner with animate-spin animation
- **Contextual message**: "Preparing workbench…" for blank canvas, "Loading test…" for test fetch
- **Scoped coverage**: Overlay covers only canvas area (not toolbar, breadcrumb, palette)
- **Fade-out transition**: Overlay fades out with 200ms ease-out CSS transition when canvas is ready
- **Dismissed state**: After ready, overlay has opacity-0 and pointer-events-none
- **Z-index stacking**: Overlay uses z-50 to sit above canvas content
- **Background token**: Overlay uses bg-card for themed background
