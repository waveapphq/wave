# V-CANVAS-06: Console Expanded with Filtering

Verify console panel filtering, settings popover, and log level controls work correctly.

## Prerequisites

```bash
./tests/e2e/scripts/reset.sh
./tests/e2e/fixtures/canvas/v-canvas-06/01-seed.sh
```

## Steps

1. Open http://localhost:3000/workbench
2. Verify level dropdown functionality
3. Open settings popover and verify toggles
4. Test font size controls
5. Verify error badge behavior (requires execution with errors)

## Validation

### Level Dropdown
- Shows all 5 levels: DEBUG, INFO, WARN, ERROR, FATAL
- Default level is INFO
- Selecting a level changes the displayed value
- Level filter shows selected level and above

### Settings Popover
- Opens on gear button click
- Shows "Display Options" heading
- Has Show Timestamps toggle (default: ON)
- Has Show Level toggle (default: ON)
- Has Show Source toggle (default: ON)
- Has Show System Logs toggle (default: ON)
- Has Text Size controls with +/- buttons

### Font Size Controls
- Default font size is 12px
- Decrease button reduces size (-1)
- Increase button increases size (+1)
- Minimum size is 10px (decrease disabled at min)
- Maximum size is 18px (increase disabled at max)

### Toggle Functionality
- All toggles default to checked state
- Toggles can be toggled off and back on
- Toggle changes persist during session

### Header Layout
- Header has role="toolbar" for accessibility
- Console content has role="log" for accessibility
- Buttons in correct order: Level -> Copy -> Settings -> Clear
- Console icon has emerald-400 color styling

### Error Badge (when errors exist)
- Red triangle with error count
- Click expands panel and activates error filter
- Error filter chip appears with dismiss button
- Dismissing chip returns to normal view
