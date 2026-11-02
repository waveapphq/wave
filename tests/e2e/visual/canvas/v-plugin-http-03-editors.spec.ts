/**
 * V-PLUGIN-HTTP-03-EDITORS: HTTP Request - the Headers map and Retryable Codes list editors
 * Design Decisions: FIELD-1, FIELD-2, FIELD-10
 * REQ: REQ-3.1.1.5, REQ-3.1.3.19
 *
 * Phase: no-data (parallel) - drops its own HTTP Request on a fresh canvas.
 *
 * Pass Criteria:
 * 1. Headers and Retryable Codes are one value fields; their expand opens the map / list editor.
 * 2. Both editors have a fixed item type: the header band reads `Type`, level with the other labels,
 *    and each entry shows a read-only `string` pill (no combobox, no chevron); the {x} toggle sits
 *    right after the pill with the editor's grid gap; in both themes.
 * 3. Map editor: entries added and one removed are saved; the field's one line reads them and the
 *    editor holds them after the window Save and reopen.
 * 4. List editor: not set, Retryable Codes shows its default list in gray; 429 added and 502 removed are
 *    saved; the line reads `["503", "504", "429"]`, also after reopen.
 */

import { test, expect, type Page, type Locator } from '../../helpers/playwright-fixtures'
import { dragPaletteItemToCanvas, waitForCanvasLoad } from '../../helpers/canvas'
import { BACKEND_PORT } from '../../helpers/config'
import { saveListEditor } from '../../helpers/config-sheet'
import { headerLabel, listItem, mapEntry, openBlockEditor, rectOf, type EntryParts } from '../../helpers/entry-editors'
import { toggleTheme } from '../../helpers/theme'
import { expectTextMuted, fieldInput, resetButton } from '../../helpers/value-field'
import { configSheet } from '../../helpers/workbench'

const HEADERS_LINE = '{"Accept": "application/json", "X-Request-ID": "req-001"}'
const CODES_LINE = '["503", "504", "429"]'

async function clearSession(page: Page) {
  await page.request.delete(`http://localhost:${BACKEND_PORT}/workbench/session`).catch(() => {})
  await page.goto('/workbench')
  await page.evaluate(() => localStorage.clear())
  await page.goto('/workbench')
}

async function addHttpNode(page: Page) {
  const canvasBox = await page.locator('[data-testid="workflow-canvas"]').boundingBox()
  await dragPaletteItemToCanvas(page, 'http', { x: canvasBox!.width * 0.5, y: canvasBox!.height * 0.5 })
}

async function openHttpConfig(page: Page): Promise<Locator> {
  const node = page.locator('[data-testid^="workflow-node-"][data-nodetype]').first()
  await node.locator('button').first().dispatchEvent('click')
  await expect(node).toHaveAttribute('data-selected', 'true')
  await page.locator('[data-testid="node-configure"]').click()
  const sheet = configSheet(page)
  await expect(sheet).toBeVisible()
  return sheet
}

async function openRetries(sheet: Locator) {
  const header = sheet.locator('[data-testid="group-header-Timeouts & Retries"]')
  if ((await header.getAttribute('aria-expanded')) !== 'true') await header.click()
  await expect(header).toHaveAttribute('aria-expanded', 'true')
}

/** The read-only `string` pill and the {x} right after it with the grid's own gap (FIELD-10). */
async function expectFixedTypeLook(editor: Locator, entry: EntryParts, what: string) {
  const type = headerLabel(editor, 'Type')
  await expect(type, `${what}: the Type header`).toBeVisible()
  const label = await rectOf(type, `${what} Type header`)
  const value = await rectOf(headerLabel(editor, 'Value'), `${what} Value header`)
  expect(Math.abs(label.y - value.y), `${what}: Type sits level with Value`).toBeLessThanOrEqual(1)

  await expect(entry.typeCell, `${what}: the pill`).toHaveText('string')
  await expect(entry.typeCell, `${what}: the pill is no combobox`).not.toHaveAttribute('role', 'combobox')
  await expect(entry.typeCell.locator('svg'), `${what}: the pill has no chevron`).toHaveCount(0)
  const pill = await rectOf(entry.typeCell, `${what} pill`)
  const toggle = await rectOf(entry.exprToggle, `${what} {x}`)
  const gap = await entry.typeCell.evaluate((el) => {
    let node: HTMLElement | null = el.parentElement
    while (node && getComputedStyle(node).display !== 'grid') node = node.parentElement
    return node ? Number.parseFloat(getComputedStyle(node).columnGap) : Number.NaN
  })
  expect(gap, `${what}: the row is a grid with a gap`).toBeGreaterThan(0)
  expect(Math.abs(toggle.x - (pill.x + pill.width) - gap), `${what}: {x} right after the pill`).toBeLessThanOrEqual(1)
}

test.describe('V-PLUGIN-HTTP-03-EDITORS: map and list editors of the HTTP Request', () => {
  test('V-PLUGIN-HTTP-03-S3: fixed-type editors, and their entries kept after Save and reopen', async ({ page }) => {
    await clearSession(page)
    await waitForCanvasLoad(page)
    await addHttpNode(page)
    let sheet = await openHttpConfig(page)
    await fieldInput(sheet, 'url').fill('https://example.com')

    await test.step('Headers: the map editor with its fixed type, in both themes', async () => {
      for (const round of [1, 2]) {
        const editor = await openBlockEditor(page, sheet, 'headers')
        await expect(editor.locator('[data-testid="value-editor-type-badge"]')).toContainText('map')
        await editor.locator('[data-testid="map-add-entry"]').click()
        await expectFixedTypeLook(editor, mapEntry(editor, 0), `Headers, round ${round}`)
        await editor.locator('[data-testid="value-editor-cancel-button"]').click()
        const discard = page.locator('[data-testid="value-editor-unsaved-discard-button"]')
        if (await discard.isVisible({ timeout: 1_000 }).catch(() => false)) await discard.click()
        await expect(editor).toBeHidden()
        if (round === 1) await toggleTheme(page)
      }
      await toggleTheme(page)
    })

    await test.step('Headers: entries added and one removed are saved', async () => {
      const editor = await openBlockEditor(page, sheet, 'headers')
      const add = editor.locator('[data-testid="map-add-entry"]')
      const rows: Array<[string, string]> = [
        ['Accept', 'application/json'],
        ['X-Request-ID', 'req-001'],
        ['X-Temp-Header', 'to-be-removed'],
      ]
      for (const [index, [key, value]] of rows.entries()) {
        await add.click()
        await mapEntry(editor, index).keyInput.fill(key)
        await mapEntry(editor, index).valueInput.fill(value)
      }
      await mapEntry(editor, 2).remove.click()
      await expect(editor.locator('input[data-testid^="map-edit-key-"]')).toHaveCount(2)
      await saveListEditor(editor)
      await expect(fieldInput(sheet, 'headers')).toHaveValue(HEADERS_LINE)
    })

    await test.step('Retryable Codes: the list editor with its fixed type, in both themes', async () => {
      await openRetries(sheet)
      const line = fieldInput(sheet, 'retryable_status_codes')
      await expect(line).toHaveValue('["502", "503", "504"]')
      await expectTextMuted(line, 'the default list')
      await expect(resetButton(sheet, 'retryable_status_codes')).toHaveCount(0)
      for (const round of [1, 2]) {
        const editor = await openBlockEditor(page, sheet, 'retryable_status_codes')
        await expect(editor.locator('[data-testid="value-editor-type-badge"]')).toContainText('array')
        await expectFixedTypeLook(editor, listItem(editor, 0), `Retryable Codes, round ${round}`)
        await editor.locator('[data-testid="value-editor-cancel-button"]').click()
        await expect(editor).toBeHidden()
        if (round === 1) await toggleTheme(page)
      }
      await toggleTheme(page)
    })

    await test.step('Retryable Codes: 429 added and 502 removed are saved', async () => {
      const editor = await openBlockEditor(page, sheet, 'retryable_status_codes')
      await editor.locator('[data-testid="array-add-item"]').click()
      await listItem(editor, 3).valueInput.fill('429')
      await listItem(editor, 0).remove.click()
      await expect(editor.locator('input[data-testid^="array-edit-input-"]')).toHaveCount(3)
      await saveListEditor(editor)
      await expect(fieldInput(sheet, 'retryable_status_codes')).toHaveValue(CODES_LINE)
    })

    const save = sheet.getByRole('button', { name: 'Save', exact: true }).last()
    await expect(save).toBeEnabled()
    await save.click()
    await expect(sheet).toBeHidden()

    await test.step('after reopen both fields and editors hold what was saved', async () => {
      sheet = await openHttpConfig(page)
      await expect(fieldInput(sheet, 'headers')).toHaveValue(HEADERS_LINE)
      const headers = await openBlockEditor(page, sheet, 'headers')
      await expect(mapEntry(headers, 0).keyInput).toHaveValue('Accept')
      await expect(mapEntry(headers, 0).valueInput).toHaveValue('application/json')
      await expect(mapEntry(headers, 1).keyInput).toHaveValue('X-Request-ID')
      await expect(mapEntry(headers, 1).valueInput).toHaveValue('req-001')
      await headers.locator('[data-testid="value-editor-cancel-button"]').click()
      await expect(headers).toBeHidden()

      await openRetries(sheet)
      await expect(fieldInput(sheet, 'retryable_status_codes')).toHaveValue(CODES_LINE)
      await expect(resetButton(sheet, 'retryable_status_codes')).toHaveCount(1)
      const codes = await openBlockEditor(page, sheet, 'retryable_status_codes')
      const items = codes.locator('input[data-testid^="array-edit-input-"]')
      await expect
        .poll(() => items.evaluateAll((els) => els.map((el) => (el as HTMLInputElement).value)))
        .toEqual(['503', '504', '429'])
      await codes.locator('[data-testid="value-editor-cancel-button"]').click()
      await expect(codes).toBeHidden()
    })
  })
})
