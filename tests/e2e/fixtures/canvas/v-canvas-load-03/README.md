# V-CANVAS-LOAD-03: No Visual Flicker of Intermediate Canvas States

Verify canvas content stays hidden during preparation phase to prevent flicker of unpositioned nodes or empty canvas.

## Prerequisites

```bash
./tests/e2e/scripts/reset.sh
```

No additional seeding required - tests canvas visibility behavior on blank canvas and with route-mocked test fetch.

## Steps

1. Navigate to http://localhost:3000/workbench (blank canvas)
2. Navigate to http://localhost:3000/workbench?editTest=test-flicker-check (mocked test fetch)

## Validation

- **Canvas hidden on mount**: Canvas has opacity-0 during preparation phase
- **Canvas visible after ready**: Canvas transitions to opacity-100 when fully ready
- **Coordinated states**: Overlay visible (opacity-100) while canvas hidden (opacity-0) during preparation
- **Coordinated reveal**: Overlay hidden (opacity-0) and canvas visible (opacity-100) after ready
- **Transition properties**: Canvas has transition-opacity, duration-200, ease-out CSS classes
- **Layout stability**: Canvas parent dimensions remain stable during loading-to-ready transition (no CLS)
- **Test fetch flicker prevention**: Canvas stays hidden during entire test fetch + node creation cycle
- **Instant hide**: Canvas uses inline transitionDuration 0ms to prevent fade-in when hiding
