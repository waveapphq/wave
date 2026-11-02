/**
 * V-VMGR-CURRENT-EDIT-ELEMENT-TYPES: while paused, a typed map's Current value shows
 * each element as its declared type, and a Current edit keeps those types when it
 * overrides the running value.
 * REQ: REQ-3.1.3.19, REQ-3.2.1.6, REQ-3.2.2.18
 *
 * Pass Criteria:
 * 1. Paused at the gate, the Current view of `m` shows the whole number 16 and the float
 *    1.0 as numbers, the zip code as quoted text, and a 19-digit whole number with every
 *    digit (past a double's exact range).
 * 2. The row shows the map as a summary; the Edit window's Current value opens in the "Edit value"
 *    sheet with every entry's declared type.
 * 3. Overriding `n` to 20 makes the map live; reopened, its Current view (now the running
 *    session's own value) still shows all 19 digits, and a second Current edit (`n` to 21)
 *    starts from them, so the untouched entry is never rounded.
 * 4. The session read keeps `n` a whole number and the 19-digit entry as its exact digits,
 *    and names every element's type.
 * 5. After Continue the downstream Log reads `n` as 21 (22 after adding one), `f` as a
 *    float, `zip` as text and the 19-digit entry plus one exactly.
 *
 * Phase: functional-workflow (imports its own fixture, deletes it after).
 */

import { test, expect, type Locator, type Page } from '../../helpers/playwright-fixtures'
import { getLogTexts } from '../../helpers/log-reader'
import { closeValueEditor, openValueEditor, saveValueEditor, setValueEditorView } from '../../helpers/variable-create'
import {
  BIG_INT,
  BIG_INT_PLUS_ONE,
  deleteTest,
  expectMapRows,
  readFixture,
} from '../../helpers/element-types'
import {
  clickContinue,
  clickEdit,
  closeInspector,
  expectPausedAt,
  getActiveSessionId,
  getSessionVariables,
  importValidateOpen,
  openInspector,
  rowFor,
  saveEdit,
  selectEnvironment,
  setBreakpoint,
  startDebugRun,
  waitForStatus,
} from './helpers'

const GATE = '8a36497a-9695-4383-8bcc-a31aac4c67f0'

/** The watcher's Edit window on Current, with its map open in the "Edit value" sheet's Visual view. */
async function openCurrentMap(page: Page, watcher: Locator): Promise<{ win: Locator; sheet: Locator }> {
  const win = await clickEdit(watcher)
  const sheet = await openValueEditor(page, win)
  await setValueEditorView(page, sheet, 'Visual')
  return { win, sheet }
}

/** Apply the sheet to the window, close it, and save the window's Current value. */
async function saveCurrentMap(page: Page, win: Locator, sheet: Locator): Promise<void> {
  await saveValueEditor(sheet)
  await closeValueEditor(page, sheet)
  await saveEdit(win)
}

test.describe('V-VMGR-CURRENT-EDIT-ELEMENT-TYPES: typed map elements in the Current view and edit', () => {
  let testId = ''

  test.afterEach(async ({ request }) => {
    if (testId) await deleteTest(request, testId)
  })

  test('the Current view and a Current edit keep every element type', async ({ page }) => {
    test.setTimeout(180_000)
    testId = await importValidateOpen(page, readFixture(__dirname, 'element-types-fixture.json'))
    await setBreakpoint(page, GATE)
    await selectEnvironment(page)
    await startDebugRun(page)
    await expectPausedAt(page, GATE)

    await test.step('the Current view shows numbers as numbers and the zip code as text', async () => {
      await expect(rowFor(page, 'm').locator('[data-testid^="variable-value-"]')).toHaveText('{4 keys}')
      const modal = await openInspector(page, 'm')
      const rows = modal.locator('[data-testid="map-body"] [data-testid="map-row"]')
      await expect(rows).toHaveCount(4)
      await expect(rows.nth(0).locator('td').nth(1), 'n shows as a number').toHaveText('16')
      await expect(rows.nth(1).locator('td').nth(1), 'f shows as a float').toHaveText('1.0')
      await expect(rows.nth(2).locator('td').nth(1), 'zip shows as text').toHaveText('"02134"')
      await expect(rows.nth(3).locator('td').nth(1), 'big keeps every digit').toHaveText(BIG_INT)

      const { win, sheet } = await openCurrentMap(page, modal)
      await expectMapRows(sheet, [
        { key: 'n', text: '16', type: 'integer' },
        { key: 'f', text: '1.0', type: 'float' },
        { key: 'zip', text: '02134', type: 'string' },
        { key: 'big', text: BIG_INT, type: 'integer' },
      ])
      await sheet.locator('[data-testid="map-edit-value-0"]').fill('20')
      await expect(sheet.locator('[data-testid="map-type-0"]')).toHaveText('integer')
      await saveCurrentMap(page, win, sheet)
      await closeInspector(page, 'm')
    })

    await test.step('the live map keeps every digit into a second Current edit', async () => {
      const modal = await openInspector(page, 'm')
      const rows = modal.locator('[data-testid="map-body"] [data-testid="map-row"]')
      await expect(rows.nth(0).locator('td').nth(1), 'n shows the override').toHaveText('20')
      await expect(rows.nth(3).locator('td').nth(1), 'the live big keeps every digit').toHaveText(BIG_INT)
      const { win, sheet } = await openCurrentMap(page, modal)
      await expectMapRows(sheet, [
        { key: 'n', text: '20', type: 'integer' },
        { key: 'f', text: '1.0', type: 'float' },
        { key: 'zip', text: '02134', type: 'string' },
        { key: 'big', text: BIG_INT, type: 'integer' },
      ])
      await sheet.locator('[data-testid="map-edit-value-0"]').fill('21')
      await saveCurrentMap(page, win, sheet)
      await closeInspector(page, 'm')
    })

    await test.step('the running session holds the override with its element types', async () => {
      const variables = (await getSessionVariables(page, await getActiveSessionId(page))) as Record<
        string,
        { value: unknown; type: string; elementTypes?: unknown }
      >
      expect(variables.m.value).toEqual({ n: 21, f: '1.0', zip: '02134', big: BIG_INT })
      expect(variables.m.elementTypes).toEqual({ n: 'integer', f: 'float', zip: 'string', big: 'integer' })
    })

    await test.step('Continue: the Log reads the override as a whole number', async () => {
      await clickContinue(page)
      await waitForStatus(page, 'passed')
      const logs = await getLogTexts(page)
      expect(logs, logs.join('\n')).toContain(`CUR n=22 f=2.0 zip=02134-x big=${BIG_INT_PLUS_ONE}`)
    })
  })
})
