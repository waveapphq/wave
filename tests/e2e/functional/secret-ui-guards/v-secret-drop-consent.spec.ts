/**
 * V-SECRET-DROP-CONSENT: a saved secret opens masked in its Edit window; only the masked field asks before clearing it
 * Design Decisions: VMGR-106, SECUI-1, SECUI-9
 * REQ: REQ-3.1.3.5
 *
 * Pass Criteria:
 *  1. A plain load shows no "Secret value stays visible until you save the test." strip.
 *  2. The row pencil on a saved secret opens its Edit window at once: the masked field (dots,
 *     pencil, lock), no "Edit Protected Value?" question, no strip and no stored text.
 *  3. The masked field's pencil asks "Edit Protected Value?" (no strip while it is open); Cancel
 *     keeps the masked value, the unchanged window closes at once and a run still uses the
 *     stored value (KEY-INTACT).
 *  4. "Delete & Edit" turns the field into the empty field of its type with the strip; closing
 *     the window through the Unsaved changes question writes nothing, the strip goes and a run
 *     still uses the stored value.
 *  5. A saved secret map behaves the same: after "Delete & Edit" its field holds the empty map and
 *     its "Edit value" sheet renders no entry derived from the stored or masked value.
 *  6. After a page reload a saved secret map shows `********` on its row, opens masked, and
 *     "Delete & Edit" never crashes the page nor renders rows derived from the mask.
 */

import { test, expect, type Locator, type Page } from '../../helpers/playwright-fixtures'
import { getLogTexts } from '../../helpers/log-reader'
import { waitForCanvasLoad } from '../../helpers/canvas'
import { importValidateAndNavigate } from '../../helpers/fixture-import'
import { selectEnvironment, runToTerminal } from '../../helpers/workbench'
import {
  cancelWindow,
  closeValueEditor,
  editProtectedValue,
  expandVariableManager,
  openEditWindow,
  openValueEditor,
  setValueEditorView,
  valueEditor,
  valueField,
  variableRow,
} from '../../helpers/variable-create'
import fs from 'fs'
import path from 'path'

const MASK = '********'
const DOTS = '••••••••'
const STRIP = 'Secret value stays visible until you save the test.'
const STORED_KEY = 'k3y-real-v4lue-8811'

function loadFixture(): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(path.resolve(__dirname, 'fixture.json'), 'utf-8'))
}

const maskedField = (win: Locator): Locator =>
  valueField(win).getByRole('button', { name: 'Value: Edit protected value', exact: true })
const protectedQuestion = (page: Page): Locator => page.getByRole('dialog', { name: 'Edit Protected Value?' })
const notice = (scope: Page | Locator): Locator => scope.locator('[data-testid="inspect-secret-notice"]')

async function expectRunResolvesRealValue(page: Page): Promise<void> {
  await runToTerminal(page)
  const logTexts = await getLogTexts(page)
  const all = logTexts.join('\n')
  expect(
    logTexts.some((t) => t === 'KEY-INTACT'),
    `Expected KEY-INTACT (stored secret survived). Got:\n${all}`,
  ).toBeTruthy()
  expect(all).not.toContain('KEY-DROPPED')
}

/** The "Edit value" sheet of an emptied secret map renders no entry from the stored or masked value. */
async function expectNoMapEntries(page: Page, win: Locator): Promise<void> {
  const sheet = await openValueEditor(page, win)
  await setValueEditorView(page, sheet, 'Visual')
  await expect(sheet.locator('[data-testid="map-edit-body"]')).toBeVisible()
  const valueInputs = sheet.locator('[data-testid^="map-edit-value-"]')
  const count = await valueInputs.count()
  expect(count, 'an empty map editor must not render stored or masked rows').toBeLessThanOrEqual(1)
  for (let i = 0; i < count; i++) {
    await expect(valueInputs.nth(i)).toHaveValue('')
  }
  await closeValueEditor(page, sheet)
}

test.describe('V-SECRET-DROP-CONSENT', () => {
  test('a saved secret opens masked; Cancel keeps it, Delete & Edit empties the field, closing unsaved keeps the stored value', async ({
    page,
  }) => {
    test.setTimeout(240_000)
    const pageErrors: Error[] = []
    page.on('pageerror', (err) => pageErrors.push(err))

    await importValidateAndNavigate(page, loadFixture())
    await expandVariableManager(page)

    await test.step('no strip on a plain load', async () => {
      await expect(variableRow(page, 'api_key')).toBeVisible()
      await expect(notice(page)).toHaveCount(0)
    })

    await test.step('the row pencil opens the Edit window at once with the masked field', async () => {
      const win = await openEditWindow(page, 'api_key')
      await expect(protectedQuestion(page), 'the pencil asks nothing').toHaveCount(0)
      const masked = maskedField(win)
      await expect(masked).toBeVisible()
      await expect(masked).toHaveText(DOTS)
      await expect(masked.locator('svg.lucide-pencil')).toHaveCount(1)
      await expect(masked.locator('svg.lucide-lock')).toHaveCount(1)
      await expect(win).not.toContainText(STORED_KEY)
      await expect(notice(win)).toHaveCount(0)

      await masked.click()
      await expect(protectedQuestion(page)).toBeVisible()
      await expect(notice(page), 'no strip while only the question is up').toHaveCount(0)
      await protectedQuestion(page).getByRole('button', { name: 'Cancel', exact: true }).click()
      await expect(protectedQuestion(page)).toHaveCount(0)
      await expect(maskedField(win), 'Cancel keeps the masked value').toBeVisible()
      await expect(notice(win)).toHaveCount(0)
      await cancelWindow(page, win)
    })

    await test.step('after Cancel a run still resolves the stored value', async () => {
      await selectEnvironment(page)
      await expectRunResolvesRealValue(page)
    })

    await test.step('Delete & Edit empties the field and shows the strip; closing unsaved keeps the stored value', async () => {
      const win = await openEditWindow(page, 'api_key')
      await editProtectedValue(page, win, 'Delete & Edit')
      await expect(maskedField(win)).toHaveCount(0)
      await expect(valueEditor(page, win)).toHaveValue('')
      await expect(notice(win)).toHaveText(STRIP)
      await cancelWindow(page, win, 'Close')
      await expect(notice(page)).toHaveCount(0)
      await expectRunResolvesRealValue(page)
    })

    await test.step('a saved secret map: Delete & Edit leaves the empty map with no entry', async () => {
      const win = await openEditWindow(page, 'cred_map')
      await expect(maskedField(win)).toBeVisible()
      await editProtectedValue(page, win, 'Delete & Edit')
      await expect(valueEditor(page, win)).toHaveValue('{}')
      await expectNoMapEntries(page, win)
      await cancelWindow(page, win, 'Close')
    })

    expect(pageErrors, `page errors: ${pageErrors.map((e) => e.message).join(' | ')}`).toEqual([])
  })

  test('after a reload a saved secret map opens masked and Delete & Edit renders no placeholder rows', async ({
    page,
  }) => {
    test.setTimeout(180_000)
    const pageErrors: Error[] = []
    page.on('pageerror', (err) => pageErrors.push(err))

    await importValidateAndNavigate(page, loadFixture())
    // After the reload the store holds the masked read (a placeholder string) for the secret map.
    await page.reload()
    await waitForCanvasLoad(page)
    await expandVariableManager(page)

    const row = variableRow(page, 'cred_map')
    await expect(row).toBeVisible()
    await expect(row.locator('[data-testid^="variable-value-"]')).toHaveText(MASK)

    const win = await openEditWindow(page, 'cred_map')
    await expect(maskedField(win)).toBeVisible()
    await editProtectedValue(page, win, 'Delete & Edit')
    await expect(valueEditor(page, win)).toHaveValue('{}')
    await expectNoMapEntries(page, win)

    await expect(page.locator('[data-testid="workflow-canvas"]')).toBeVisible()
    expect(pageErrors, `page errors: ${pageErrors.map((e) => e.message).join(' | ')}`).toEqual([])
  })
})
