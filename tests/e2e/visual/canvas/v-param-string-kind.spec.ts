/**
 * V-PARAM-STRING-KIND: single-line string param adopts the shared value affordance
 * Design Decisions: FIELD-1
 * REQ: REQ-3.1.1.5, REQ-3.4.2.2
 *
 * A single-line string param (HTTP `url`) is the one value field: a text box with its expand
 * (`Open editor for URL`) that opens the "Edit value" sheet, where the Literal / Template kind dropdown
 * lives. The `{}` expression toggle stays on the row. Row-level validation (URL format + required)
 * surfaces below the value field.
 *
 * Phase: no-data (parallel) - palette drag-drop only, no backend data needed.
 *
 * Pass Criteria:
 * 1. The url row renders the one value field: an editable text box and its expand `Open editor for URL`.
 * 2. The `{}` expression toggle is present on the row.
 * 3. Opening the sheet shows the Literal/Template kind dropdown, and Template is a
 *    selectable kind (the control single-line string params carry).
 * 4. An invalid url surfaces "URL must start with http:// or https://" in the row.
 * 5. A required empty url keeps Save disabled; a valid url clears the error and
 *    enables Save.
 */

import { test, expect, type Page, type Locator } from '../../helpers/playwright-fixtures'
import { dragPaletteItemToCanvas, waitForCanvasLoad } from '../../helpers/canvas'
import { BACKEND_PORT } from '../../helpers/config'
import { configSheet, openSelectedBlockSheet } from '../../helpers/workbench'
import { setStringParam, openStringParamSheet } from '../../helpers/param-config'

async function clearSession(page: Page) {
  await page.request.delete(`http://localhost:${BACKEND_PORT}/workbench/session`).catch(() => {})
  await page.goto('/workbench')
  await page.evaluate(() => localStorage.clear())
  await page.goto('/workbench')
}

async function addHttpNodeAndOpenConfig(page: Page): Promise<Locator> {
  const palette = page.locator('[data-testid="block-palette"]')
  if ((await palette.getAttribute('data-state')) === 'collapsed') {
    await page.locator('[data-testid="palette-expand-button"]').click()
    await expect(palette).toHaveAttribute('data-state', 'expanded')
  }
  await page.locator('[data-testid="palette-search-input"]').fill('http')
  const canvas = page.locator('[data-testid="workflow-canvas"]')
  const canvasBox = await canvas.boundingBox()
  await dragPaletteItemToCanvas(page, 'http', { x: canvasBox!.width * 0.5, y: canvasBox!.height * 0.5 })

  const node = page.locator('[data-testid^="workflow-node-"][data-nodetype]').first()
  await node.scrollIntoViewIfNeeded()
  await node.locator('button').first().dispatchEvent('click')
  await expect(node).toHaveAttribute('data-selected', 'true')
  await openSelectedBlockSheet(page)
  const modal = configSheet(page)
  await expect(modal).toBeVisible()
  return modal
}

test.describe('V-PARAM-STRING-KIND: single-line string param value affordance', () => {
  test('S1: url edits in the one value field, and its expand opens the kind sheet', async ({
    page,
  }) => {
    await clearSession(page)
    await waitForCanvasLoad(page)
    const modal = await addHttpNodeAndOpenConfig(page)

    const urlRow = modal.locator('[data-testid="param-row-url"]')
    await expect(urlRow).toBeVisible()

    // FIELD-1: the value cell is the one value field, a text box with its expand.
    await expect(urlRow.locator('[data-slot="input-group"] input')).toBeEditable()
    await expect(urlRow.getByRole('button', { name: 'Open editor for URL', exact: true })).toBeVisible()

    // The `{}` expression toggle stays on the row (unchanged affordance).
    await expect(urlRow.locator('[data-testid="expression-toggle"]')).toBeVisible()

    // Opening the sheet shows the Literal/Template kind control; Template is a
    // selectable kind for a single-line string param.
    const sheet = await openStringParamSheet(urlRow, page, 'url')
    const kind = sheet.locator('[data-testid="kind-dropdown"]')
    await expect(kind).toContainText('Literal')
    await kind.click()
    await expect(page.locator('[role="option"]', { hasText: 'Template' })).toBeVisible()
    await page.keyboard.press('Escape') // close the kind menu
    await sheet.locator('[data-testid="value-editor-cancel-button"]').click()
    await expect(sheet).toBeHidden()
  })

  test('S2: URL-format validation surfaces in the row; required gates Save', async ({ page }) => {
    await clearSession(page)
    await waitForCanvasLoad(page)
    const modal = await addHttpNodeAndOpenConfig(page)

    const urlRow = modal.locator('[data-testid="param-row-url"]')
    const saveBtn = modal.getByRole('button', { name: 'Save' }).last()

    // Required url empty -> Save blocked (required enforcement, value-based).
    await expect(saveBtn).toBeDisabled()

    // An invalid url surfaces the format error in the row, below the value field.
    await setStringParam(urlRow, page, 'url', 'notaurl')
    await expect(urlRow.locator('[role="alert"]')).toContainText(
      'URL must start with http:// or https://',
    )
    await expect(saveBtn).toBeDisabled()

    // A valid url clears the error and unblocks Save.
    await setStringParam(urlRow, page, 'url', 'https://example.com')
    await expect(urlRow.locator('[role="alert"]')).toHaveCount(0)
    await expect(saveBtn).toBeEnabled()
  })
})
