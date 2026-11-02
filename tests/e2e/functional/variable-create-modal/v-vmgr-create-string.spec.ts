/**
 * V-VMGR-CREATE-STRING: the create modal's string Kind editors.
 *
 * Phase: functional-workflow (seeds an empty Test, no run).
 */

import { leaveExpressionEditor } from '../../helpers/code-editor'
import { test, expect } from '../../helpers/playwright-fixtures'
import { BACKEND_PORT } from '../../helpers/config'
import { createValidTest, openTest } from '../../helpers/fn-seed'
import {
  openCreateModal,
  setCreateName,
  setCreateKind,
  cancelCreate,
  closeValueEditor,
  createSimpleVariable,
  expectWindowValue,
  openValueEditor,
  saveValueEditor,
  valueEditor,
  valueEditorCode,
} from '../../helpers/variable-create'

test.describe('V-VMGR-CREATE-STRING: string Kind editors', () => {
  test('Switching to Expression after a multi-line value never crashes the editor', async ({
    page,
    request,
  }) => {
    test.setTimeout(120_000)
    const testId = await createValidTest(request, {
      name: `V-VMGR-CREATE-STRING-FIX4 ${Date.now()}`,
      nodes: [],
    })
    await page.request.delete(`http://localhost:${BACKEND_PORT}/workbench/session`).catch(() => {})
    await openTest(page, testId)

    const modal = await openCreateModal(page)
    await setCreateName(page, 'sx', modal)
    // A multi-line value is entered in the Edit value window; the one-line field keeps every line.
    const sheet = await openValueEditor(page, modal)
    const body = valueEditorCode(sheet)
    await body.click()
    await page.keyboard.type('line one')
    await page.keyboard.press('Enter')
    await page.keyboard.type('line two')
    await page.keyboard.press('Enter')
    await page.keyboard.type('line three')
    await saveValueEditor(sheet)
    await closeValueEditor(page, sheet)
    await expectWindowValue(modal, 'line one\nline two\nline three')

    // Switch Kind -> Expression. The source collapses to a single line and the
    // editor must stay interactive when the selection is restored past the shorter doc.
    await setCreateKind(page, 'Expression', modal)
    const expr = valueEditor(page, modal)
    await expr.click()
    await page.keyboard.press('ControlOrMeta+a') // select-all was the crash trigger
    await page.keyboard.press('Delete')
    await page.keyboard.type('1 + 1')
    // Still interactive + single line -> proves no crash.
    await expect(expr).toContainText('1 + 1')
    await cancelCreate(page, modal)
  })

  test('A Template offers variable autocomplete inside {{ }}', async ({
    page,
    request,
  }) => {
    test.setTimeout(120_000)
    const testId = await createValidTest(request, {
      name: `V-VMGR-CREATE-STRING-FIX5 ${Date.now()}`,
      nodes: [],
    })
    await page.request.delete(`http://localhost:${BACKEND_PORT}/workbench/session`).catch(() => {})
    await openTest(page, testId)

    // A variable must exist for the template to suggest.
    await createSimpleVariable(page, 'username', { value: 'ada' })

    const modal = await openCreateModal(page)
    await setCreateName(page, 'greeting', modal)
    await setCreateKind(page, 'Template', modal)
    const body = valueEditor(page, modal)
    await body.click()
    await page.keyboard.type('Hi {{')
    // Ctrl/Cmd+Space inside {{ }} opens the variable autocomplete with `username`.
    await page.keyboard.press('ControlOrMeta+ ')
    const tip = page.locator('.cm-tooltip-autocomplete')
    await expect(tip).toBeVisible()
    await expect(tip).toContainText('username')
    await leaveExpressionEditor(body)
    await cancelCreate(page, modal)
  })
})
