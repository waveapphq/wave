/**
 * V-SECMASK-01: Per-Block "Secrets" config section - Mask specific fields (HTTP Client)
 *
 * Phase: no-data (parallel) - palette drag-drop only, no backend data needed
 * Design Decisions: SECREV-1, SECREV-3
 * REQ: REQ-3.1.3.16 (per-block protocol-field masking) + REQ-3.1.3.5 (run-output control)
 *
 * The "Secrets" collapsible (testid secrets-section-trigger, label "Secrets") holds the
 * tri-state run-output Select above the "Mask specific fields" list.
 *
 * Pass Criteria:
 * 1. A "Secrets" collapsible renders as the LAST section of Input Parameters
 *    (below the Connection group header), collapsed by default.
 * 2. Expanded: the tri-state run-output Select defaults to "Use system setting",
 *    and the "Mask specific fields" list shows the plugin's eight declared
 *    sensitive-header fields, each a checkbox CHECKED (masked) by default.
 * 3. The field-list helper uses "Mask specific fields" wording.
 * 4. Unchecking a field flips it to the revealed (unchecked) state (SECREV-3);
 *    the other fields stay masked - reveal is per-field.
 */

import { test, expect, type Page } from '../../helpers/playwright-fixtures'
import { dragPaletteItemToCanvas, waitForCanvasLoad } from '../../helpers/canvas'
import { configSheet, openSelectedBlockSheet } from '../../helpers/workbench'
import { BACKEND_URL } from '../../helpers/config'

// Catalog order per the FE secretMaskFields / BE _SENSITIVE_HEADERS (eight headers).
const SECRET_FIELDS = [
  'authorization',
  'proxy-authorization',
  'cookie',
  'set-cookie',
  'x-api-key',
  'x-auth-token',
  'x-csrf-token',
  'x-xsrf-token',
]

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
  await dragPaletteItemToCanvas(page, 'http', {
    x: canvasBox!.width / 2,
    y: canvasBox!.height / 2,
  })
  await page.waitForTimeout(100)

  const firstNode = page.locator('[data-testid^="workflow-node-"][data-nodetype]').first()
  await firstNode.locator('button').first().dispatchEvent('click')
  await expect(firstNode).toHaveAttribute('data-selected', 'true')

  await openSelectedBlockSheet(page)
  const modal = configSheet(page)
  await expect(modal).toBeVisible()
  return modal
}

test.describe('V-SECMASK-01: Secrets config section - Mask specific fields', () => {
  test.beforeEach(async ({ page }) => {
    // System run_output off so the HTTP block's "system" default stays masked
    // and its "Mask specific fields" list is enabled (not disabled by a reveal).
    await page.request.put(`${BACKEND_URL}/admin/secret-masking`, {
      data: { run_output: false, test_variables: false, shared_variables: false, credential_inputs: false },
    })
    // Fresh canvas; do NOT delete /workbench/session (shared with fixture phase).
    await page.goto('/')
    await page.evaluate(() => localStorage.clear())
  })

  test('V-SECMASK-01-S1: trigger reads "Secrets", collapsed and below Connection', async ({
    page,
  }) => {
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    const modal = await addHttpNodeAndOpenConfig(page)

    const trigger = modal.locator('[data-testid="secrets-section-trigger"]')
    await expect(trigger).toBeVisible()
    await expect(trigger).toContainText('Secrets')

    // Collapsed by default: neither the tri-state Select nor a field checkbox
    // is rendered/visible yet.
    await expect(modal.locator('[data-testid="secret-reveal-select"]')).not.toBeVisible()
    await expect(
      modal.locator('[data-testid="secret-mask-field-authorization"]'),
    ).not.toBeVisible()

    // Last section: the trigger sits below the Connection group header (SECREV-1).
    const connection = modal.locator('[data-testid="group-header-Connection"]')
    const connBox = await connection.boundingBox()
    const trigBox = await trigger.boundingBox()
    expect(trigBox!.y).toBeGreaterThan(connBox!.y)
  })

  test('V-SECMASK-01-S2: expanded shows the tri-state selector + eight header rows checked by default', async ({
    page,
  }) => {
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    const modal = await addHttpNodeAndOpenConfig(page)

    await modal.locator('[data-testid="secrets-section-trigger"]').click()

    // Tri-state run-output control defaults to "Use system setting" (SECREV-2).
    const select = modal.locator('[data-testid="secret-reveal-select"]')
    await expect(select).toBeVisible()
    await expect(select).toContainText('Use system setting')

    // System run_output off (default) -> effective masked -> the field list is
    // ENABLED, every field checked (masked) by default, in catalog order.
    for (const key of SECRET_FIELDS) {
      const box = modal.locator(`[data-testid="secret-mask-field-${key}"]`)
      await expect(box, `field ${key} renders`).toBeVisible()
      await expect(box, `field ${key} enabled (not revealed)`).toBeEnabled()
      await expect(box, `field ${key} checked (masked) by default`).toHaveAttribute(
        'data-state',
        'checked',
      )
    }
    // Exactly the eight declared fields - no more, no fewer.
    await expect(modal.locator('[data-testid^="secret-mask-field-"]')).toHaveCount(
      SECRET_FIELDS.length,
    )
  })

  test('V-SECMASK-01-S3: field-list helper uses "Mask specific fields" wording', async ({
    page,
  }) => {
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    const modal = await addHttpNodeAndOpenConfig(page)

    // Helper is hidden until the section is expanded.
    const helper = modal.getByText(
      "Credential fields, masked by default. Uncheck to reveal one in this block's logs & reports.",
    )
    await expect(helper).not.toBeVisible()

    await modal.locator('[data-testid="secrets-section-trigger"]').click()
    await expect(modal.getByText('Mask specific fields')).toBeVisible()
    await expect(helper).toBeVisible()
  })

  test('V-SECMASK-01-S4: unchecking a field flips it to revealed (unchecked)', async ({
    page,
  }) => {
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    const modal = await addHttpNodeAndOpenConfig(page)

    await modal.locator('[data-testid="secrets-section-trigger"]').click()

    const setCookie = modal.locator('[data-testid="secret-mask-field-set-cookie"]')
    await expect(setCookie).toHaveAttribute('data-state', 'checked')

    await setCookie.click()
    await expect(setCookie).toHaveAttribute('data-state', 'unchecked')

    // The other fields stay masked - reveal is per-field.
    await expect(modal.locator('[data-testid="secret-mask-field-authorization"]')).toHaveAttribute(
      'data-state',
      'checked',
    )
  })
})
