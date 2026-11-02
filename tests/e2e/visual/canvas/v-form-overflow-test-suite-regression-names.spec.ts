/**
 * V-FORM-OVERFLOW-TEST-SUITE-REGRESSION-NAMES: Name caps differ by entity type
 *
 * Phase: no-data (parallel) - opens each create dialog directly; no fixture data.
 *
 * Pass Criteria:
 *  - Test name caps at 255 (MAX_TEST_NAME_LENGTH; long descriptive titles allowed).
 *  - Suite name caps at 64 (MAX_ENTITY_NAME_LENGTH; identifier-shaped).
 *  - Regression name caps at 64 (MAX_ENTITY_NAME_LENGTH).
 *  - Each name field is the NameField primitive (textarea rows=1) with the
 *    standard counter (muted at >=80%, destructive at the cap).
 */

import { test, expect, type Page } from '../../helpers/playwright-fixtures'
import { dragPaletteItemToCanvas, waitForCanvasLoad } from '../../helpers/canvas'

async function dirtyCanvasAndOpenSaveDialog(page: Page) {
  await page.goto('/workbench')
  await waitForCanvasLoad(page)
  const canvas = page.locator('[data-testid="workflow-canvas"]')
  const cb = await canvas.boundingBox()
  await dragPaletteItemToCanvas(page, 'shell script', { x: cb!.width / 2, y: cb!.height / 2 })

  const saveButton = page.locator('[data-testid="toolbar-save-button"]')
  await expect(saveButton).toBeEnabled()
  await saveButton.click()

  const dialog = page.locator('[role="dialog"]').first()
  await expect(dialog).toBeVisible()
  return dialog
}

test.describe('V-FORM-OVERFLOW-TEST-SUITE-REGRESSION-NAMES: name caps per entity', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await page.evaluate(() => localStorage.clear())
  })

  test('S1: Test name caps at 255 (long descriptive titles)', async ({ page }) => {
    const dialog = await dirtyCanvasAndOpenSaveDialog(page)
    const name = dialog.locator('textarea#test-name')
    await expect(name).toBeVisible()
    await expect(name).toHaveAttribute('maxlength', '255')

    // Type 260 chars; native maxLength clips at 255.
    await name.fill('a'.repeat(260))
    expect((await name.inputValue()).length).toBe(255)

    // Counter at the cap is destructive.
    const counter = dialog.locator('span[aria-live="polite"]').first()
    await expect(counter).toBeVisible()
    await expect(counter).toHaveAttribute('data-state', 'destructive')
    await expect(counter).toHaveText('255/255')
  })

  test('S2: Test name counter muted at the 80% threshold (204..254)', async ({ page }) => {
    const dialog = await dirtyCanvasAndOpenSaveDialog(page)
    const name = dialog.locator('textarea#test-name')
    const counter = dialog.locator('span[aria-live="polite"]').first()

    // 203 chars: under 80% (204). Counter hidden.
    await name.fill('a'.repeat(203))
    await expect(counter).toHaveCount(0)

    // 204: muted.
    await name.fill('a'.repeat(204))
    await expect(counter).toBeVisible()
    await expect(counter).toHaveAttribute('data-state', 'muted')
    await expect(counter).toHaveText('204/255')
  })

  test('S3: Suite name caps at 64', async ({ page }) => {
    await page.goto('/suites')
    await page.waitForSelector('[data-testid="suites-page"]', { state: 'visible' })
    await page.waitForSelector('[data-testid="suites-page"][aria-busy="false"]', {
      state: 'attached',
    })
    await page.getByRole('button', { name: /New Suite/i }).first().click()
    const dialog = page.locator('[role="dialog"]').first()
    await expect(dialog).toBeVisible({ timeout: 10000 })

    const name = dialog.locator('[data-testid="suite-name-input"]')
    await expect(name).toBeVisible()
    await expect(name).toHaveAttribute('maxlength', '64')

    await name.fill('a'.repeat(70))
    expect((await name.inputValue()).length).toBe(64)

    const counter = dialog.locator('[data-testid="suite-name-input-counter"]')
    await expect(counter).toBeVisible()
    await expect(counter).toHaveAttribute('data-state', 'destructive')
    await expect(counter).toHaveText('64/64')
  })

  test('S4: Regression name caps at 64', async ({ page }) => {
    await page.goto('/regressions')
    await page.waitForSelector('[data-testid="regressions-page"]', { state: 'visible' })
    await page.waitForSelector('[data-testid="regressions-page"][aria-busy="false"]', {
      state: 'attached',
    })
    await page.getByRole('button', { name: /New Regression/i }).first().click()
    const dialog = page.locator('[role="dialog"]').first()
    await expect(dialog).toBeVisible({ timeout: 10000 })

    const name = dialog.locator('[data-testid="regression-name-input"]')
    await expect(name).toBeVisible()
    await expect(name).toHaveAttribute('maxlength', '64')

    await name.fill('a'.repeat(70))
    expect((await name.inputValue()).length).toBe(64)

    const counter = dialog.locator('[data-testid="regression-name-input-counter"]')
    await expect(counter).toBeVisible()
    await expect(counter).toHaveAttribute('data-state', 'destructive')
    await expect(counter).toHaveText('64/64')
  })

  test('S5: All three name fields share the NameField primitive shape', async ({ page }) => {
    // Suite
    await page.goto('/suites')
    await page.waitForSelector('[data-testid="suites-page"][aria-busy="false"]', {
      state: 'attached',
    })
    await page.getByRole('button', { name: /New Suite/i }).first().click()
    let dialog = page.locator('[role="dialog"]').first()
    await expect(dialog).toBeVisible({ timeout: 10000 })
    let name = dialog.locator('[data-testid="suite-name-input"]')
    await expect(name).toHaveAttribute('rows', '1')
    expect(await name.evaluate((el) => el.tagName)).toBe('TEXTAREA')

    // Regression
    await page.goto('/regressions')
    await page.waitForSelector('[data-testid="regressions-page"][aria-busy="false"]', {
      state: 'attached',
    })
    await page.getByRole('button', { name: /New Regression/i }).first().click()
    dialog = page.locator('[role="dialog"]').first()
    await expect(dialog).toBeVisible({ timeout: 10000 })
    name = dialog.locator('[data-testid="regression-name-input"]')
    await expect(name).toHaveAttribute('rows', '1')
    expect(await name.evaluate((el) => el.tagName)).toBe('TEXTAREA')

    // Test
    const testDialog = await dirtyCanvasAndOpenSaveDialog(page)
    const testName = testDialog.locator('textarea#test-name')
    await expect(testName).toHaveAttribute('rows', '1')
    expect(await testName.evaluate((el) => el.tagName)).toBe('TEXTAREA')
  })
})
