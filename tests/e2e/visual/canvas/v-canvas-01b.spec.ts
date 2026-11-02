/**
 * V-CANVAS-01b: Canvas Toolbar
 *
 * Design Decisions: RUN-1 to RUN-6, DEBUG-1 to DEBUG-8, CANVAS-76, CANVAS-79-80
 *
 * Main Purpose: Verify canvas toolbar structure, button groups, and controls
 * in the idle workflow state.
 *
 * Pass Criteria:
 * 1. Toolbar height is 44px
 * 2. Left group: Close (×), Save, Undo, Redo buttons with 8px gap
 * 3. Right group: Environment selector, Debug options gear, Debug button, Run button
 * 4. Close button hidden when in draft state (nothing to close)
 * 5. Environment selector shows placeholder text when unselected
 * 6. Run/Debug buttons use split button pattern (primary + dropdown)
 * 7. Button states: Save/Undo/Redo disabled (no changes/history), Run/Debug disabled (no env selected)
 * 8. Debug options popover contains pause checkboxes
 * 9. Right group buttons in correct order: Env → Gear → Debug → Run
 */

import { test, expect } from '../../helpers/playwright-fixtures'
import { waitForCanvasLoad, waitForCanvasToolbar } from '../../helpers/canvas'

test.describe('V-CANVAS-01b: Canvas Toolbar', () => {
  // Empty state test: relies on global setup reset, no individual reset needed
  // This test runs in the empty-state-desktop project phase (parallel)

  test('V-CANVAS-01b: toolbar has correct height of 48px', async ({
    page,
  }) => {
    await page.goto('/tests/new')
    await waitForCanvasLoad(page)
    await waitForCanvasToolbar(page)

    // Toolbar height is 48px (h-12 = 3rem = 48px)
    const toolbar = page.locator('[data-testid="canvas-toolbar"]')
    await expect(toolbar, 'Toolbar should be visible').toBeVisible()

    const toolbarBox = await toolbar.boundingBox()
    expect(toolbarBox, 'Toolbar should have bounding box').not.toBeNull()
    expect(
      toolbarBox!.height,
      'Toolbar height should be 48px (h-12)'
    ).toBe(48)
  })

  test('V-CANVAS-01b-S1: left button group contains workflow actions', async ({
    page,
  }) => {
    await page.goto('/tests/new')
    await waitForCanvasLoad(page)
    await waitForCanvasToolbar(page)

    // 2. Left group: Close (×), Save, Undo, Redo buttons with 8px gap
    const leftGroup = page.locator('[data-testid="toolbar-left-group"]')
    await expect(leftGroup, 'Left button group should be visible').toBeVisible()

    // Save button should be visible (Close is hidden in draft state)
    const saveButton = leftGroup.locator('[data-testid="toolbar-save-button"]')
    await expect(saveButton, 'Save button should be visible').toBeVisible()

    // Undo button should be visible
    const undoButton = leftGroup.locator('[data-testid="toolbar-undo-button"]')
    await expect(undoButton, 'Undo button should be visible').toBeVisible()

    // Redo button should be visible
    const redoButton = leftGroup.locator('[data-testid="toolbar-redo-button"]')
    await expect(redoButton, 'Redo button should be visible').toBeVisible()

    // Verify buttons are positioned sequentially (Save before Undo before Redo)
    const saveBox = await saveButton.boundingBox()
    const undoBox = await undoButton.boundingBox()

    expect(saveBox, 'Save button should have bounding box').not.toBeNull()
    expect(undoBox, 'Undo button should have bounding box').not.toBeNull()

    // Save should be to the left of Undo
    expect(
      saveBox!.x + saveBox!.width,
      'Save button should be to the left of Undo button'
    ).toBeLessThan(undoBox!.x)
  })

  test('V-CANVAS-01b-S2: right button group contains execution controls', async ({
    page,
  }) => {
    await page.goto('/tests/new')
    await waitForCanvasLoad(page)
    await waitForCanvasToolbar(page)

    // 3. Right group: Environment selector, Debug options gear, Debug button, Run button
    const rightGroup = page.locator('[data-testid="toolbar-right-group"]')
    await expect(rightGroup, 'Right button group should be visible').toBeVisible()

    // Environment selector
    const envSelector = rightGroup.locator('[data-testid="environment-selector"]')
    await expect(envSelector, 'Environment selector should be visible').toBeVisible()

    // Debug options gear
    const debugGear = rightGroup.locator('[data-testid="debug-options-gear"]')
    await expect(debugGear, 'Debug options gear should be visible').toBeVisible()

    // Debug button
    const debugButton = rightGroup.locator('[data-testid="debug-button"]')
    await expect(debugButton, 'Debug button should be visible').toBeVisible()

    // Run button
    const runButton = rightGroup.locator('[data-testid="run-button"]')
    await expect(runButton, 'Run button should be visible').toBeVisible()
  })

  test('V-CANVAS-01b-S3: close button visible in draft state', async ({
    page,
  }) => {
    await page.goto('/tests/new')
    await waitForCanvasLoad(page)
    await waitForCanvasToolbar(page)

    // Close button is visible even in draft state (allows returning to tests list)
    // Per V-REGRESS-06: Close button should always be visible
    const closeButton = page.locator('[data-testid="toolbar-close-button"]')
    await expect(
      closeButton,
      'Close button should be visible'
    ).toBeVisible()
  })

  test('V-CANVAS-01b-S4: environment selector shows placeholder when unselected', async ({
    page,
  }) => {
    await page.goto('/tests/new')
    await waitForCanvasLoad(page)
    await waitForCanvasToolbar(page)

    // 5. Environment selector shows placeholder text when unselected
    const envSelector = page.locator('[data-testid="environment-selector"]')
    await expect(envSelector, 'Environment selector should be visible').toBeVisible()

    // Should show placeholder text (e.g., "Select environment" or similar)
    const envText = await envSelector.textContent()
    expect(
      envText?.toLowerCase(),
      'Environment selector should show placeholder text'
    ).toMatch(/select|environment|choose/i)
  })

  test('V-CANVAS-01b-S5: run and debug buttons use split button pattern', async ({
    page,
  }) => {
    await page.goto('/tests/new')
    await waitForCanvasLoad(page)
    await waitForCanvasToolbar(page)

    // 6. Run/Debug buttons use split button pattern (primary + dropdown)

    // Run button should have split button structure
    const runButton = page.locator('[data-testid="run-button"]')
    await expect(runButton, 'Run button should be visible').toBeVisible()

    // Run button should have dropdown trigger
    const runDropdown = page.locator('[data-testid="run-button-dropdown"]')
    await expect(
      runDropdown,
      'Run button should have dropdown trigger'
    ).toBeVisible()

    // Debug button should have split button structure
    const debugButton = page.locator('[data-testid="debug-button"]')
    await expect(debugButton, 'Debug button should be visible').toBeVisible()

    // Debug button should have dropdown trigger
    const debugDropdown = page.locator('[data-testid="debug-button-dropdown"]')
    await expect(
      debugDropdown,
      'Debug button should have dropdown trigger'
    ).toBeVisible()
  })

  test('V-CANVAS-01b-S6: toolbar button states in idle empty canvas', async ({
    page,
  }) => {
    await page.goto('/tests/new')
    await waitForCanvasLoad(page)
    await waitForCanvasToolbar(page)

    // 7. Button states in idle workflow (empty canvas, no environment selected)

    // Save button DISABLED - nothing to save in clean draft (no changes)
    const saveButton = page.locator('[data-testid="toolbar-save-button"]')
    await expect(saveButton, 'Save button should be disabled (no changes)').toBeDisabled()

    // Undo button DISABLED - no history in empty canvas
    const undoButton = page.locator('[data-testid="toolbar-undo-button"]')
    await expect(undoButton, 'Undo button should be disabled (no history)').toBeDisabled()

    // Redo button DISABLED - no future history in empty canvas
    const redoButton = page.locator('[data-testid="toolbar-redo-button"]')
    await expect(redoButton, 'Redo button should be disabled (no future)').toBeDisabled()

    // Environment selector ENABLED - user can select
    const envSelector = page.locator('[data-testid="environment-selector"]')
    await expect(envSelector, 'Environment selector should be enabled').toBeEnabled()

    // Debug gear ENABLED - can configure debug options
    const debugGear = page.locator('[data-testid="debug-options-gear"]')
    await expect(debugGear, 'Debug gear should be enabled').toBeEnabled()

    // Debug button ENABLED - shows env dialog if no environment selected (V-CANVAS-14)
    const debugButton = page.locator('[data-testid="debug-button"]')
    await expect(debugButton, 'Debug button should be enabled (shows env dialog if no env)').toBeEnabled()

    // Run button ENABLED - shows env dialog if no environment selected (V-CANVAS-14)
    const runButton = page.locator('[data-testid="run-button"]')
    await expect(runButton, 'Run button should be enabled (shows env dialog if no env)').toBeEnabled()
  })

  test('V-CANVAS-01b-S7: debug options popover opens on gear click', async ({
    page,
  }) => {
    await page.goto('/tests/new')
    await waitForCanvasLoad(page)
    await waitForCanvasToolbar(page)

    // Click debug options gear (per DEBUG-1 to DEBUG-8)
    const debugGear = page.locator('[data-testid="debug-options-gear"]')
    await debugGear.click()

    // Debug options popover should appear
    const debugPopover = page.locator('[data-testid="debug-options-popover"]')
    await expect(
      debugPopover,
      'Debug options popover should be visible after clicking gear'
    ).toBeVisible()

    // Popover should contain checkboxes for debug options
    const pauseOnFirstCheckbox = debugPopover.locator('[data-testid="pause-on-first-checkbox"]')
    await expect(
      pauseOnFirstCheckbox,
      'Pause on first block checkbox should be visible'
    ).toBeVisible()

    const pauseOnErrorsCheckbox = debugPopover.locator('[data-testid="pause-on-errors-checkbox"]')
    await expect(
      pauseOnErrorsCheckbox,
      'Pause on errors checkbox should be visible'
    ).toBeVisible()
  })

  test('V-CANVAS-01b-S8: right group buttons in correct left-to-right order', async ({
    page,
  }) => {
    await page.goto('/tests/new')
    await waitForCanvasLoad(page)
    await waitForCanvasToolbar(page)

    // 9. Right group buttons in correct order: Env → Gear → Debug → Run
    const envSelector = page.locator('[data-testid="environment-selector"]')
    const debugGear = page.locator('[data-testid="debug-options-gear"]')
    const debugButton = page.locator('[data-testid="debug-button"]')
    const runButton = page.locator('[data-testid="run-button"]')

    const envBox = await envSelector.boundingBox()
    const gearBox = await debugGear.boundingBox()
    const debugBox = await debugButton.boundingBox()
    const runBox = await runButton.boundingBox()

    expect(envBox, 'Env selector should have bounding box').not.toBeNull()
    expect(gearBox, 'Debug gear should have bounding box').not.toBeNull()
    expect(debugBox, 'Debug button should have bounding box').not.toBeNull()
    expect(runBox, 'Run button should have bounding box').not.toBeNull()

    // Verify left-to-right order: Env < Gear < Debug < Run
    expect(
      envBox!.x,
      'Environment selector should be leftmost in right group'
    ).toBeLessThan(gearBox!.x)

    expect(
      gearBox!.x,
      'Debug gear should be after environment selector'
    ).toBeLessThan(debugBox!.x)

    expect(
      debugBox!.x,
      'Debug button should be after debug gear'
    ).toBeLessThan(runBox!.x)
  })
})
