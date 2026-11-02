# V-CANVAS-01f: Palette Collapsed State

Verify the collapsed block palette displays vertical icon strip with flyout behavior.

## Prerequisites

```bash
./tests/e2e/scripts/reset.sh
./tests/e2e/fixtures/canvas/v-canvas-01f/01-seed.sh
```

Seeds palette usage data for Recent/Most Used sections.

## Steps

1. Navigate to http://localhost:3000/tests/new
2. Verify palette is in collapsed state (44px width)
3. Interact with icon strip and flyouts

## Validation

- **Collapsed width**: Palette has `data-state="collapsed"` and 44px width
- **Icon strip**: 7 category icons present in vertical order:
  - Search (magnifying glass, cyan)
  - Most Used (star, yellow)
  - Recent (clock, cyan)
  - Controls (git-branch, orange)
  - Plugins (puzzle piece, magenta)
  - Add (plus, cyan)
  - Library (bar chart, yellow)
- **Icon tooltips**: Each icon shows tooltip on hover with category name
- **Controls flyout**: Hover on Controls icon shows flyout with 10 control items
- **Plugins flyout**: Hover on Plugins icon shows flyout with 6 subcategories and counts
- **Recent flyout**: Hover on Recent icon shows flyout with recently used elements
- **Most Used flyout**: Hover on Most Used icon shows flyout with frequent elements
- **Expand trigger**: Click anywhere on palette expands to 160px width
- **Drag from flyout**: Elements can be dragged directly from flyout to canvas
- **Flyout dismiss**: Flyout hides when mouse leaves flyout area
