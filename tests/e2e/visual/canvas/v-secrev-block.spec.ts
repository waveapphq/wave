/**
 * V-SECREV-BLOCK: block "Secrets" section - tri-state run-output control
 *
 * Phase: no-data (parallel) - palette drag-drop + config modal, no backend data.
 * Design Decisions: SECREV-1, SECREV-2, SECREV-3
 * REQ: REQ-3.1.3.5 (per-block run-output masking control) + REQ-3.1.3.16
 *
 * Pass Criteria (the tri-state Select drives all downstream affordances live):
 * 1. Default "Use system setting" (system off): masked helper, no amber warning,
 *    the "Mask specific fields" list ENABLED, no collapsed pill.
 * 2. "Always reveal": amber warning box, the field list DISABLED with the hint,
 *    and a "Revealing" pill on the collapsed trigger.
 * 3. "Always mask": masked-override helper, no warning, field list ENABLED, no pill.
 */

import { test, expect, type Page } from '../../helpers/playwright-fixtures'
import { dragPaletteItemToCanvas, waitForCanvasLoad } from '../../helpers/canvas'
import { configSheet, openSelectedBlockSheet } from '../../helpers/workbench'
import { BACKEND_URL } from '../../helpers/config'

async function resetMaskingFlags(page: Page) {
  await page.request.put(`${BACKEND_URL}/admin/secret-masking`, {
    data: { run_output: false, test_variables: false, shared_variables: false, credential_inputs: false },
  })
}

async function setupPalette(page: Page) {
  const palette = page.locator('[data-testid="block-palette"]')
  if ((await palette.getAttribute('data-state')) === 'collapsed') {
    await page.locator('[data-testid="palette-expand-button"]').click()
    await expect(palette).toHaveAttribute('data-state', 'expanded')
  }
}

async function addHttpNodeAndOpenConfig(page: Page) {
  await setupPalette(page)
  await page.locator('[data-testid="palette-search-input"]').fill('http')
  await page.waitForTimeout(100)
  const canvas = page.locator('[data-testid="workflow-canvas"]')
  const canvasBox = await canvas.boundingBox()
  await dragPaletteItemToCanvas(page, 'http', { x: canvasBox!.width / 2, y: canvasBox!.height / 2 })
  await page.waitForTimeout(100)

  const firstNode = page.locator('[data-testid^="workflow-node-"][data-nodetype]').first()
  await firstNode.locator('button').first().dispatchEvent('click')
  await expect(firstNode).toHaveAttribute('data-selected', 'true')
  await openSelectedBlockSheet(page)
  const modal = configSheet(page)
  await expect(modal).toBeVisible()
  return modal
}

async function selectRevealOption(page: Page, label: string) {
  await page.locator('[data-testid="secret-reveal-select"]').click()
  await page.getByRole('option').filter({ hasText: label }).click()
}

test.describe('V-SECREV-BLOCK: block Secrets tri-state control', () => {
  test.beforeEach(async ({ page }) => {
    await resetMaskingFlags(page)
    await page.goto('/')
    await page.evaluate(() => localStorage.clear())
  })

  test('the tri-state selector drives helper, amber warning, disabled field list, and collapsed pill', async ({
    page,
  }) => {
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    const modal = await addHttpNodeAndOpenConfig(page)
    const trigger = modal.locator('[data-testid="secrets-section-trigger"]')
    const warning = modal.locator('[data-testid="secret-reveal-warning"]')
    const pill = trigger.locator('[data-testid="secret-reveal-pill"]')
    const firstField = modal.locator('[data-testid="secret-mask-field-authorization"]')

    await trigger.click() // expand

    await test.step('SECREV-2 default: Use system setting, masked, no warning, list enabled', async () => {
      await expect(modal.locator('[data-testid="secret-reveal-select"]')).toContainText(
        'Use system setting',
      )
      await expect(
        modal.getByText('Follows the system setting. Currently: masked.'),
      ).toBeVisible()
      await expect(warning).toHaveCount(0)
      await expect(firstField).toBeEnabled()
      await expect(pill).toHaveCount(0)
    })

    await test.step('SECREV-2/3 Always reveal: amber warning + disabled field list + hint', async () => {
      await selectRevealOption(page, 'Always reveal')
      await expect(modal.locator('[data-testid="secret-reveal-select"]')).toContainText(
        'Always reveal',
      )
      await expect(warning).toBeVisible()
      await expect(firstField).toBeDisabled()
      await expect(
        modal.getByText('Run output is revealed - per-field masking has no effect.'),
      ).toBeVisible()
    })

    await test.step('SECREV-1 collapsed trigger shows the amber "Revealing" pill', async () => {
      await trigger.click() // collapse
      await expect(pill).toBeVisible()
      await expect(pill).toContainText('Revealing')
      await trigger.click() // re-expand
    })

    await test.step('SECREV-2 Always mask: masked-override helper, no warning, list enabled, no pill', async () => {
      await selectRevealOption(page, 'Always mask')
      await expect(
        modal.getByText('Kept masked regardless of the system setting.'),
      ).toBeVisible()
      await expect(warning).toHaveCount(0)
      await expect(firstField).toBeEnabled()
      await trigger.click() // collapse
      await expect(pill).toHaveCount(0)
    })
  })
})
