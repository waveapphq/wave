# V-CONTROL-01: Control Palette - 14 Controls in 4 Categories

Verify the control palette displays all 14 controls with correct categories and colors.

## Prerequisites

```bash
./tests/e2e/scripts/reset.sh
./tests/e2e/fixtures/canvas/v-control-01/01-seed.sh
```

## Steps

1. Open http://localhost:3000/tests/new
2. Click Controls icon in collapsed palette to open flyout
3. Verify all controls are displayed
4. Expand palette and verify subgroups

## Validation

- **Control count:** 14 controls total
- **Categories (4):**
  - Conditionals (3): If/Else, Switch, Assert - orange
  - Loops (5): For, ForEach, While, Break, Continue - cyan
  - Flow (4): Parallel, Try/Catch, Halt, Variable Setter - green
  - Timing (2): Delay, Wait Until - yellow
- **Flyout layout:** Grid with 3 columns
- **Expanded layout:** 4 collapsible subgroups
- **Accessibility:** role="option", aria-label on each control
- **Draggable:** draggable="true" attribute on all controls
