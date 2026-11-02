/**
 * VI-INT-04: Debug Split Button and Debug Options Popover (Idle State)
 *
 * Design Decisions: DEBUG-1 to DEBUG-8, RUN-5, RUN-6, RUN-10, RUN-11, RUN-12
 * REQ: REQ-3.2.1.2 (Debug mode entry + options), REQ-3.2.1.5 (Debug Scope label)
 *
 * Pass Criteria:
 * 1. Debug split button is rendered in the idle canvas toolbar (DEBUG-1)
 * 2. Debug split button caret opens a dropdown with "Debug Scope" + "Debug All" (RUN-6 / DEBUG-2)
 * 3. Debug Options gear icon is rendered left of the Debug split button (RUN-10)
 * 4. Debug Options popover exposes exactly two checkboxes:
 *    - "Pause on first block" (RUN-11, DEBUG-8)
 *    - "Pause on errors" (RUN-11, DEBUG-8)
 * 5. Both checkboxes default to unchecked (DEBUG-5)
 * 6. Gear gets the primary/blue accent when either option is active (DEBUG-4)
 */

import { test, expect, type Page } from '../../helpers/playwright-fixtures'
import { waitForCanvasLoad } from '../../helpers/canvas'
import { BACKEND_PORT, E2E_ENV_NAME, ensureEnvironment } from '../../helpers/config'

async function openWorkbench(page: Page): Promise<void> {
  // Ensure the shared E2E environment exists so the Debug split button's
  // caret can be enabled (caret is disabled when no environment is selected).
  await page.request
    .delete(`http://localhost:${BACKEND_PORT}/workbench/session/`)
    .catch(() => {})
  await ensureEnvironment(page.request)

  await page.goto('/workbench')
  await page.evaluate(() => localStorage.clear())
  await page.goto('/workbench')
  await waitForCanvasLoad(page)
}

async function selectE2EEnv(page: Page): Promise<void> {
  await page.locator('[data-testid="environment-selector"]').click()
  const popover = page.locator('[data-testid="environment-popover"]')
  await expect(popover).toBeVisible()
  await popover.locator(`button:has-text("${E2E_ENV_NAME}")`).first().click()
  await expect(popover).not.toBeVisible()
}

test.describe('VI-INT-04: Debug Split Button and Debug Options Popover', () => {
  test('VI-INT-04-S1: Debug split button renders in idle toolbar', async ({ page }) => {
    await openWorkbench(page)

    const debugPrimary = page.locator('[data-testid="debug-button"]')
    await expect(debugPrimary).toBeVisible()
    await expect(debugPrimary).toContainText('Debug')

    const debugCaret = page.locator('[data-testid="debug-button-dropdown"]')
    await expect(debugCaret).toBeVisible()
  })

  test('VI-INT-04-S2: Debug caret dropdown exposes "Debug Scope" and "Debug All"', async ({
    page,
  }) => {
    await openWorkbench(page)
    // The caret is `caretDisabled` while no environment is selected; select
    // the shared E2E environment first to enable it.
    await selectE2EEnv(page)

    await page.locator('[data-testid="debug-button-dropdown"]').click()

    // Per the split-button contract: option testids follow
    // `${testIdPrefix}-${option.id}-option`. Prefix "debug", ids "current" and "all".
    await expect(page.locator('[data-testid="debug-current-option"]')).toBeVisible()
    await expect(page.locator('[data-testid="debug-current-option"]')).toContainText(
      'Debug Scope',
    )
    await expect(page.locator('[data-testid="debug-all-option"]')).toBeVisible()
    await expect(page.locator('[data-testid="debug-all-option"]')).toContainText('Debug All')

    // Close the menu to avoid leaking it into subsequent assertions.
    await page.keyboard.press('Escape')
  })

  test('VI-INT-04-S3: Debug Options gear renders left of Debug split button', async ({ page }) => {
    await openWorkbench(page)

    const gear = page.locator('[data-testid="debug-options-gear"]')
    const debugBtn = page.locator('[data-testid="debug-button"]')
    await expect(gear).toBeVisible()
    await expect(debugBtn).toBeVisible()

    // "Left of" the Debug button: gear's right edge should be before the
    // Debug button's left edge in the toolbar layout.
    const gearBox = await gear.boundingBox()
    const btnBox = await debugBtn.boundingBox()
    expect(gearBox).not.toBeNull()
    expect(btnBox).not.toBeNull()
    expect(gearBox!.x + gearBox!.width).toBeLessThanOrEqual(btnBox!.x + 1)
  })

  test('VI-INT-04-S4: Debug Options popover has two checkboxes, both off by default', async ({
    page,
  }) => {
    await openWorkbench(page)

    await page.locator('[data-testid="debug-options-gear"]').click()
    const popover = page.locator('[data-testid="debug-options-popover"]')
    await expect(popover).toBeVisible()
    await expect(popover).toContainText('Pause on first block')
    await expect(popover).toContainText('Pause on errors')

    const first = popover.locator('[data-testid="pause-on-first-checkbox"]')
    const errors = popover.locator('[data-testid="pause-on-errors-checkbox"]')
    await expect(first).toBeVisible()
    await expect(errors).toBeVisible()
    await expect(first).toHaveAttribute('data-state', 'unchecked')
    await expect(errors).toHaveAttribute('data-state', 'unchecked')
  })

  test('VI-INT-04-S5: Gear shows primary accent when any debug option is active', async ({
    page,
  }) => {
    await openWorkbench(page)

    const gear = page.locator('[data-testid="debug-options-gear"]')
    // With both options off, the gear must NOT have text-primary.
    await expect(gear).not.toHaveClass(/text-primary/)

    // Tick "Pause on first block".
    await gear.click()
    const popover = page.locator('[data-testid="debug-options-popover"]')
    await expect(popover).toBeVisible()
    await popover.locator('[data-testid="pause-on-first-checkbox"]').click()

    // Close popover, re-read gear class.
    await page.keyboard.press('Escape')
    await expect(popover).not.toBeVisible()
    await expect(gear).toHaveClass(/text-primary/)
  })
})
