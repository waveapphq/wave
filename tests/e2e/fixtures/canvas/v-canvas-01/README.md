# V-CANVAS-01: Canvas Empty State Integration

Integration test verifying all canvas foundation components work together.

## Prerequisites

```bash
./tests/e2e/scripts/reset.sh
```

No additional seeding required - tests empty canvas state.

## Steps

1. Navigate to http://localhost:3000/tests/new

## Validation

### All Sub-component Criteria
- **V-CANVAS-01a (Layout)**: Sidebar collapsed (56px), panels in correct order, correct collapsed widths
- **V-CANVAS-01b (Toolbar)**: Save/Undo/Redo (disabled), Environment selector (enabled), Debug gear (enabled), Debug/Run (disabled)
- **V-CANVAS-01c (Breadcrumb)**: Back arrow, "Draft Workflow" path, "Idle" status
- **V-CANVAS-01h (Empty State)**: Start node with pulse, ghost connector, placeholder, tour button

### Integration Criteria
- **Component positioning**: Vertical order: Breadcrumb → Toolbar → Canvas (no gaps)
- **No panel overlap**: Sidebar | Palette | Canvas | VarManager have no overlap
- **Z-index layering**: Toolbar and breadcrumb render above canvas content
- **No horizontal scroll**: Document width fits viewport
- **Interactive element states**:
  - ENABLED: Environment selector, Debug gear, Back arrow, Tour button
  - DISABLED: Save, Undo, Redo, Debug, Run (empty canvas, no environment)
