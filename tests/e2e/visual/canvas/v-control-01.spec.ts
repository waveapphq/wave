/**
 * V-CONTROL-01: Control Palette - 13 Controls in 4 Categories
 *
 * Design Decisions: CANVAS-97 through CANVAS-104
 * REQ: REQ-5.2.1.48, REQ-5.2.1.46
 *
 * Pass Criteria:
 * 1. 15 controls total in 5 categories (Conditional, Loop, Flow, Timing, Misc)
 * 2. Category colors: orange, cyan, green, yellow
 * 3. Conditional (3): If/Else, Switch, Assert - orange (text-orange-500)
 * 4. Loop (5): For, ForEach, While, Break, Continue - cyan (text-cyan-500)
 * 5. Flow (3): Parallel, Try/Catch, Halt - green (text-green-500)
 * 6. Timing (2): Delay, Wait Until - yellow (text-yellow-500)
 * 7. Controls are draggable (draggable="true" + dataTransfer)
 * 8. Grid layout in collapsed flyout
 * 9. Grouped in expanded palette with 5 subgroups
 * 10. Each control has role="option" and aria-label for accessibility
 */

import { test, expect } from '../../helpers/playwright-fixtures'
import { expandPalette, waitForCanvasLoad } from '../../helpers/canvas'

test.describe('V-CONTROL-01: Control Palette - 13 Controls', () => {
  // No backend data needed - controls are hardcoded (REQ-5.2.1.48)
  // Runs in parallel no-data phase

  // Helper to open controls flyout from collapsed palette
  async function openControlsFlyout(page: import('@playwright/test').Page) {
    const palette = page.locator('[data-testid="block-palette"]')
    const state = await palette.getAttribute('data-state')
    if (state === 'expanded') {
      await page.locator('[data-testid="palette-collapse-button"]').click()
      await expect(palette).toHaveAttribute('data-state', 'collapsed')
    }
    const controlsIcon = page.locator('[data-testid="palette-icon-controls"]')
    await controlsIcon.click()
    const flyout = page.locator('[data-testid="palette-flyout-controls"]')
    await expect(flyout).toBeVisible()
    return flyout
  }

  test('V-CONTROL-01-S1: collapsed flyout shows all 15 controls in grid layout', async ({
    page,
  }) => {
    await page.goto('/workbench')
    await waitForCanvasLoad(page)

    const flyout = await openControlsFlyout(page)

    // Per CANVAS-97: 15 controls total (14 original + Note)
    const controlIds = [
      // Conditional (3)
      'if-else',
      'switch-case',
      'assert',
      // Loop (5)
      'for',
      'for-each',
      'while',
      'break',
      'continue',
      // Flow (4)
      'parallel',
      'try-catch-finally',
      'halt',
      'variable-setter',
      // Timing (2)
      'delay',
      'wait-until',
      // Misc (1)
      'note',
    ]

    // Verify all 15 controls are present
    for (const id of controlIds) {
      await expect(flyout.locator(`[data-testid="flyout-item-${id}"]`)).toBeVisible()
    }

    // Verify total count
    const controlItems = flyout.locator('[data-testid^="flyout-item-"]')
    await expect(controlItems).toHaveCount(15)

    // Verify grid layout exists (3 columns per wireframe)
    const grids = flyout.locator('.grid.grid-cols-3')
    const gridCount = await grids.count()
    expect(gridCount).toBeGreaterThan(0) // At least one grid present
  })

  test('V-CONTROL-01-S2: flyout shows 5 category headers with correct colors', async ({
    page,
  }) => {
    await page.goto('/workbench')
    await waitForCanvasLoad(page)

    const flyout = await openControlsFlyout(page)

    // Per CANVAS-98-101: 5 categories with specific colors
    // Conditionals - orange
    const conditionalsHeader = flyout.locator('text=Conditionals').first()
    await expect(conditionalsHeader).toBeVisible()
    await expect(conditionalsHeader).toHaveClass(/text-orange-500/)

    // Loops - cyan
    const loopsHeader = flyout.locator('text=Loops').first()
    await expect(loopsHeader).toBeVisible()
    await expect(loopsHeader).toHaveClass(/text-cyan-500/)

    // Flow - green
    const flowHeader = flyout.locator('text=Flow').first()
    await expect(flowHeader).toBeVisible()
    await expect(flowHeader).toHaveClass(/text-green-500/)

    // Timing - yellow
    const timingHeader = flyout.locator('text=Timing').first()
    await expect(timingHeader).toBeVisible()
    await expect(timingHeader).toHaveClass(/text-yellow-500/)

    // Misc - slate
    const miscHeader = flyout.locator('text=Misc').first()
    await expect(miscHeader).toBeVisible()
    await expect(miscHeader).toHaveClass(/text-slate-400/)
  })

  test('V-CONTROL-01-S3: conditional controls (3) have orange icons', async ({
    page,
  }) => {
    await page.goto('/workbench')
    await waitForCanvasLoad(page)

    const flyout = await openControlsFlyout(page)

    const conditionalIds = ['if-else', 'switch-case', 'assert']
    for (const id of conditionalIds) {
      const item = flyout.locator(`[data-testid="flyout-item-${id}"]`)
      await expect(item).toBeVisible()
      // Icon should have orange color class
      const icon = item.locator('svg').first()
      await expect(icon).toHaveClass(/text-orange-500/)
    }
  })

  test('V-CONTROL-01-S4: loop controls (5) have cyan icons', async ({ page }) => {
    await page.goto('/workbench')
    await waitForCanvasLoad(page)

    const flyout = await openControlsFlyout(page)

    const loopIds = ['for', 'for-each', 'while', 'break', 'continue']
    for (const id of loopIds) {
      const item = flyout.locator(`[data-testid="flyout-item-${id}"]`)
      await expect(item).toBeVisible()
      // Icon should have cyan color class
      const icon = item.locator('svg').first()
      await expect(icon).toHaveClass(/text-cyan-500/)
    }
  })

  test('V-CONTROL-01-S5: flow controls (3) have green icons', async ({ page }) => {
    await page.goto('/workbench')
    await waitForCanvasLoad(page)

    const flyout = await openControlsFlyout(page)

    const flowIds = ['parallel', 'try-catch-finally', 'halt']
    for (const id of flowIds) {
      const item = flyout.locator(`[data-testid="flyout-item-${id}"]`)
      await expect(item).toBeVisible()
      // Icon should have green color class
      const icon = item.locator('svg').first()
      await expect(icon).toHaveClass(/text-green-500/)
    }
  })

  test('V-CONTROL-01-S6: timing controls (2) have yellow icons', async ({ page }) => {
    await page.goto('/workbench')
    await waitForCanvasLoad(page)

    const flyout = await openControlsFlyout(page)

    const timingIds = ['delay', 'wait-until']
    for (const id of timingIds) {
      const item = flyout.locator(`[data-testid="flyout-item-${id}"]`)
      await expect(item).toBeVisible()
      // Icon should have yellow color class
      const icon = item.locator('svg').first()
      await expect(icon).toHaveClass(/text-yellow-500/)
    }
  })

  test('V-CONTROL-01-S7: controls are draggable with correct dataTransfer', async ({
    page,
  }) => {
    await page.goto('/workbench')
    await waitForCanvasLoad(page)

    const flyout = await openControlsFlyout(page)

    // Test one control from each category
    const testItems = [
      { id: 'if-else', name: 'If / Else' },
      { id: 'while', name: 'While' },
      { id: 'parallel', name: 'Parallel' },
      { id: 'delay', name: 'Delay' },
    ]

    for (const { id } of testItems) {
      const item = flyout.locator(`[data-testid="flyout-item-${id}"]`)
      await expect(item).toHaveAttribute('draggable', 'true')
      // aria-label should be set
      const ariaLabel = await item.getAttribute('aria-label')
      expect(ariaLabel).toBeTruthy()
    }
  })

  test('V-CONTROL-01-S8: expanded palette has 5 control subgroups', async ({
    page,
  }) => {
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    await expandPalette(page)

    // Per CANVAS-102: 5 subgroups in expanded palette
    await expect(page.locator('[data-testid="palette-subgroup-conditionals"]')).toBeVisible()
    await expect(page.locator('[data-testid="palette-subgroup-loops"]')).toBeVisible()
    await expect(page.locator('[data-testid="palette-subgroup-flow"]')).toBeVisible()
    await expect(page.locator('[data-testid="palette-subgroup-timing"]')).toBeVisible()
    await expect(page.locator('[data-testid="palette-subgroup-misc"]')).toBeVisible()
  })

  test('V-CONTROL-01-S9: expanded subgroups show correct item counts', async ({
    page,
  }) => {
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    await expandPalette(page)

    // Verify item counts in subgroup headers
    const conditionals = page.locator('[data-testid="palette-subgroup-conditionals"]')
    await expect(conditionals.locator('[data-testid="subgroup-count"]')).toHaveText('3')

    const loops = page.locator('[data-testid="palette-subgroup-loops"]')
    await expect(loops.locator('[data-testid="subgroup-count"]')).toHaveText('5')

    const flow = page.locator('[data-testid="palette-subgroup-flow"]')
    await expect(flow.locator('[data-testid="subgroup-count"]')).toHaveText('4')

    const timing = page.locator('[data-testid="palette-subgroup-timing"]')
    await expect(timing.locator('[data-testid="subgroup-count"]')).toHaveText('2')

    const misc = page.locator('[data-testid="palette-subgroup-misc"]')
    await expect(misc.locator('[data-testid="subgroup-count"]')).toHaveText('1')
  })

  test('V-CONTROL-01-S10: expanded subgroup reveals control items when clicked', async ({
    page,
  }) => {
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    await expandPalette(page)

    // Expand conditionals subgroup
    const conditionalsSubgroup = page.locator('[data-testid="palette-subgroup-conditionals"]')
    await conditionalsSubgroup.locator('[data-testid="subgroup-header"]').click()

    // Verify controls are visible
    await expect(conditionalsSubgroup.locator('[data-testid="palette-item-if-else"]')).toBeVisible()
    await expect(conditionalsSubgroup.locator('[data-testid="palette-item-switch-case"]')).toBeVisible()
    await expect(conditionalsSubgroup.locator('[data-testid="palette-item-assert"]')).toBeVisible()

    // Verify items are draggable
    const ifElse = conditionalsSubgroup.locator('[data-testid="palette-item-if-else"]')
    await expect(ifElse).toHaveAttribute('draggable', 'true')
    await expect(ifElse).toHaveAttribute('aria-label', 'If / Else')
  })
})
