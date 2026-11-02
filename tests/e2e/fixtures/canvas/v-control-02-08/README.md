# V-CONTROL-02-08: Control Configuration Modal - Version-Specific Behavior

Verify version selector, changelog, details, and parameters behave correctly per version.

## Prerequisites

```bash
./tests/e2e/scripts/reset.sh
./tests/e2e/fixtures/canvas/v-control-02-08/01-seed.sh
```

## Steps

1. Open http://localhost:3000/tests/new
2. Drop a control on canvas
3. Open config modal via gear button
4. Test version selector, changelog, details, parameters

## Validation

### V-CONTROL-02: Delay Control Element UI
- If/Else and While have exactly 1 version

### V-CONTROL-03: Version Selector Green Arrow
- No green arrow when on the latest version
- No green arrow for single-version controls

### V-CONTROL-04: Version Selector Single Version Behavior
- Dropdown opens even with single version
- Dropdown arrow icon always visible
- No "Latest" label (per wireframe)

### V-CONTROL-05: Changelog Dialog
- No Close button in footer
- Version dropdown and release date on same row
- Production (1.0.0): Shows meaningful entries

### V-CONTROL-06: Details Dialog
- No Close button in footer
- Version badge visible
- Markdown bold/code renders correctly

### V-CONTROL-07: Version-Specific Parameters
- Production (1.0.0): Shows parameters
- Production with empty required disables Save

### V-CONTROL-08: Initial Version on Canvas
- A dropped control shows no inline version on the canvas
- The modal shows the node's version
