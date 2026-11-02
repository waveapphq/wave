# V-CANVAS-14: Workbench Execution Controls

Verify environment selector, run/debug controls, and execution dialogs in the canvas workbench.

## Prerequisites

```bash
./tests/e2e/scripts/reset.sh
./tests/e2e/fixtures/canvas/v-canvas-14/01-seed.sh
```

## Steps

1. Open http://localhost:3000/workbench

## Validation

### Environment Selector Popover (ENV-1 to ENV-16)
- **S1:** Environment selector opens popover on click
- **S2:** Popover has search input with "Search environments..." placeholder
- **S3:** "All Environments" section header visible with seeded environments
- **S4:** Search filters environments (typing "Prod" hides "Development")
- **S5:** "Remember selection" checkbox present with label
- **S6:** Selecting environment updates selector button text

### Run/Debug Buttons (RUN-5 to RUN-8, DEBUG-1 to DEBUG-3)
- **S7:** Run button opens env dialog when no environment selected
- **S8:** Debug button opens env dialog when no environment selected
- **S9:** Run dropdown shows "Run Current" and "Run All" options
- **S10:** Debug dropdown shows "Debug Current" and "Debug All" options
- **S11:** Run/Debug dropdowns disabled when no environment selected

### Debug Options Gear (RUN-10 to RUN-12, DEBUG-4 to DEBUG-8)
- **S12:** Debug gear opens popover with two checkboxes
- **S13:** Checkboxes unchecked by default
- **S14:** Gear highlights (text-primary) when options active

### Environment Selection Dialog
- **S15:** Dialog has search, list, Cancel and confirm buttons
- **S16:** Confirm button enabled after selecting environment
- **S17:** Search filters environments in dialog
- **S18:** Cancel closes dialog without action

### Reset and State Tests
- **S19:** Reset link disabled in idle state
- **S20:** Idle controls (env selector, debug, run) visible in idle state
- **S21:** Run/Debug dropdowns enabled after environment selection
