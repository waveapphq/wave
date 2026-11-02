# V-CANVAS-LOAD-02: Viewport Centered on Start Node

Verify viewport centers on Start node and onboarding placeholder for blank and draft workflows.

## Prerequisites

```bash
./tests/e2e/scripts/reset.sh
```

No additional seeding required - tests viewport centering on blank canvas and draft restoration.

## Steps

1. Navigate to http://localhost:3000/workbench (blank canvas)
2. Add a block, navigate away, return (draft restoration)

## Validation

- **Start node centered**: Start node visible and horizontally centered in canvas viewport
- **Onboarding visible**: Onboarding placeholder visible below start node
- **Ghost connector**: Dashed ghost connector visible between start and placeholder
- **Upper positioning**: Start node appears in upper portion of canvas (not bottom)
- **Full group visible**: Entire onboarding group (start + connector + placeholder) fits within viewport
- **Draft viewport preserved**: After draft restoration, node positions are approximately preserved
