# V-CANVAS-01a: Canvas Page Layout

Verify canvas page layout with auto-collapsed sidebar and correct panel structure.

## Prerequisites

```bash
./tests/e2e/scripts/reset.sh
```

No additional seeding required - tests empty canvas state.

## Steps

1. Navigate to http://localhost:3000/tests/new

## Validation

- **Canvas renders**: Canvas page container visible at `/tests/new`
- **Sidebar collapsed**: Sidebar has `data-state="collapsed"` and 56px width (per SHELL-6)
- **Content fills width**: Main content area fills remaining viewport width after sidebar
- **No horizontal scroll**: Document scrollWidth equals clientWidth
- **Panel structure (Canvas Page Layout)**: Left-to-right order: Sidebar (56px) | Block Palette | Canvas + Console | Variable Manager
- **Route detection**: Canvas routes (`/tests/new`, `/workbench`) trigger auto-collapse; non-canvas routes expand sidebar
- **Dynamic routes**: `/tests/:id/edit` and `/workbench/:id` patterns also trigger canvas mode (tested with seeded data)
- **Panel widths**: Block Palette 44px collapsed, Variable Manager 44px collapsed, Console 40px collapsed height
