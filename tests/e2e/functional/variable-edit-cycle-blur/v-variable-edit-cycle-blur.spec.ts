/**
 * V-VAR-EDIT-CYCLE-BLUR-FUNCTIONAL: leaving an expression variable's source field after making it
 * read itself shows the cycle path in the variable's window and holds Save until it is fixed.
 * Design Decisions: VMGR-106, VMGR-110
 * REQ: REQ-3.1.3.13
 *
 * Phase: functional-workflow (blank workbench draft, no run).
 *
 * Pass Criteria:
 * 1. Create integer Expression variable `x` = `2 + 3` from "+ Add".
 * 2. Pencil `x`; type `x + 1` into the source field: no message while the field has focus.
 * 3. Leaving the field shows `Circular reference detected for variable 'x': x -> x`; Save is disabled.
 * 4. Typing `1 + 1` and leaving the field clears the message and enables Save.
 * 5. Save closes the window; exactly one `x` row is left and it keeps its `{x}` badge.
 */

import { leaveExpressionEditor } from '../../helpers/code-editor'
import { test, expect, type Locator, type Page } from '../../helpers/playwright-fixtures'
import { waitForCanvasLoad } from '../../helpers/canvas'
import { BACKEND_URL } from '../../helpers/config'
import {
  createSimpleVariable,
  expandVariableManager,
  openEditWindow,
  saveWindow,
  valueEditor,
  variableRow,
  windowSaveButton,
} from '../../helpers/variable-create'

/** Replace the source in one input; the field keeps focus. */
async function typeSource(page: Page, win: Locator, text: string): Promise<void> {
  const editor = valueEditor(page, win)
  await editor.click()
  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.press('Delete')
  await page.keyboard.insertText(text)
  await expect(editor).toHaveText(text)
}

test.describe('Edit-variable cycle gate on blur (V-VAR-EDIT-CYCLE-BLUR-FUNCTIONAL)', () => {
  test('a self-reading source shows its cycle when the field is left and holds Save until corrected', async ({ page }) => {
    await page.request.delete(`${BACKEND_URL}/workbench/session/`).catch(() => {})

    await page.goto('/')
    await page.evaluate(() => localStorage.clear())
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    await expandVariableManager(page)

    await createSimpleVariable(page, 'x', { type: 'integer', kind: 'Expression', value: '2 + 3' })
    await expect(variableRow(page, 'x')).toHaveCount(1)

    const win = await openEditWindow(page, 'x')
    const error = win.getByTestId('create-cycle-error')

    await test.step('the cycle shows once the field is left', async () => {
      await typeSource(page, win, 'x + 1')
      await expect(error).toHaveCount(0)
      await leaveExpressionEditor(valueEditor(page, win))
      await expect(error).toHaveText("Circular reference detected for variable 'x': x -> x")
      await expect(windowSaveButton(win)).toBeDisabled()
    })

    await test.step('a fixed source clears it and saves', async () => {
      await typeSource(page, win, '1 + 1')
      await leaveExpressionEditor(valueEditor(page, win))
      await expect(error).toHaveCount(0)
      await expect(windowSaveButton(win)).toBeEnabled()
      await saveWindow(page, win)
      const rows = variableRow(page, 'x')
      await expect(rows).toHaveCount(1)
      await expect(rows.locator('[data-testid^="expr-badge-"]')).toBeVisible()
      await expect(rows.locator('[data-testid^="variable-value-"]')).toHaveText('1 + 1')
    })
  })
})
