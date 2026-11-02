/**
 * V-CANVAS-ACTION-BAR-SCOPE-LABELS: Action-Bar Scope Labels
 *
 * Design Decisions: DEBUG-1 (split button)
 * REQ: REQ-3.2.1.5
 *
 * Pass Criteria:
 * 1. Run dropdown shows "Run Scope" and "Run All" options.
 * 2. Debug dropdown shows "Debug Scope" and "Debug All" options.
 * 3. The dropdown option testids are `run-current-option` /
 *    `run-all-option` / `debug-current-option` / `debug-all-option`.
 */

import { test, expect, type Page } from '../../helpers/playwright-fixtures'
import { waitForCanvasLoad } from '../../helpers/canvas'
import { BACKEND_PORT, E2E_ENV_NAME, ensureEnvironment } from '../../helpers/config'

async function selectE2EEnv(page: Page): Promise<void> {
  await page.locator('[data-testid="environment-selector"]').click()
  const popover = page.locator('[data-testid="environment-popover"]')
  await expect(popover).toBeVisible()
  await popover.locator(`button:has-text("${E2E_ENV_NAME}")`).first().click()
  await expect(popover).not.toBeVisible()
}

test.describe('V-CANVAS-ACTION-BAR-SCOPE-LABELS: Run/Debug split button labels', () => {
  test.beforeEach(async ({ page }) => {
    await page.request.delete(`http://localhost:${BACKEND_PORT}/workbench/session`).catch(() => {})
    // Create the shared E2E env BEFORE the workbench loads its env list, so
    // the environment-popover sees it on first hydration.
    await ensureEnvironment(page.request)
    await page.goto('/')
    await page.evaluate(() => localStorage.clear())
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
  })

  test('Run dropdown options read "Run Scope" / "Run All"', async ({ page }) => {
    // Caret is disabled until an environment is selected; pick the shared E2E env.
    await selectE2EEnv(page)

    const runDropdown = page.locator('[data-testid="run-button-dropdown"]')
    await expect(runDropdown).toBeEnabled()
    await runDropdown.click()

    const runScope = page.locator('[data-testid="run-current-option"]')
    const runAll = page.locator('[data-testid="run-all-option"]')

    // The Scope option's testid uses the `current` slug.
    await expect(runScope).toBeVisible()
    await expect(runScope).toHaveText('Run Scope')

    await expect(runAll).toBeVisible()
    await expect(runAll).toHaveText('Run All')
  })

  test('Debug dropdown options read "Debug Scope" / "Debug All"', async ({ page }) => {
    await selectE2EEnv(page)

    const debugDropdown = page.locator('[data-testid="debug-button-dropdown"]')
    await expect(debugDropdown).toBeEnabled()
    await debugDropdown.click()

    const debugScope = page.locator('[data-testid="debug-current-option"]')
    const debugAll = page.locator('[data-testid="debug-all-option"]')

    await expect(debugScope).toBeVisible()
    await expect(debugScope).toHaveText('Debug Scope')

    await expect(debugAll).toBeVisible()
    await expect(debugAll).toHaveText('Debug All')
  })

  test('the dropdowns show no "Run Current" / "Debug Current" label', async ({ page }) => {
    await selectE2EEnv(page)
    await page.locator('[data-testid="run-button-dropdown"]').click()
    const runMenu = page.locator('[role="menu"]')
    await expect(runMenu).toBeVisible()
    await expect(runMenu.getByText('Run Current', { exact: true })).toHaveCount(0)
    // Close the run menu before opening the debug menu.
    await page.keyboard.press('Escape')
    await expect(runMenu).not.toBeVisible()

    await page.locator('[data-testid="debug-button-dropdown"]').click()
    const debugMenu = page.locator('[role="menu"]')
    await expect(debugMenu).toBeVisible()
    await expect(debugMenu.getByText('Debug Current', { exact: true })).toHaveCount(0)
  })
})
