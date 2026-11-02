/**
 * V-VMGR-CREATE-SECRET: a Test secret is inspectable only while unsaved; saving the test re-masks it
 * Design Decisions: VMGR-106, SECUI-1, SECUI-9
 * REQ: REQ-3.1.3.5
 *
 * Phase: functional-workflow (seeds an empty Test, saves it).
 *
 * Pass Criteria:
 * 1. A new secret is inspectable: its watcher shows the value with the "stays visible" strip.
 * 2. Saving the test closes the watcher and locks the row's expand control.
 * 3. The pencil on the saved secret opens its Edit window masked and asks nothing; Cancel on
 *    the masked field's question keeps it masked and locked.
 * 4. "Delete & Edit" empties the field with the strip; saving a new value makes the secret
 *    unsaved again, so its expand control unlocks.
 */

import { test, expect, type Locator, type Page } from '../../helpers/playwright-fixtures'
import { BACKEND_PORT } from '../../helpers/config'
import { createValidTest, openTest } from '../../helpers/fn-seed'
import { saveBtn } from '../../helpers/workbench'
import {
  cancelWindow,
  createSimpleVariable,
  editProtectedValue,
  openEditWindow,
  saveWindow,
  setWindowValue,
  valueEditor,
  valueField,
  variableRow,
} from '../../helpers/variable-create'

const NAME = 'api_key'
const VALUE = 'sk-secret-123'

const watcher = (page: Page) => page.locator(`section[aria-label="Inspect variable ${NAME}"]`)
const expandBtn = (page: Page) =>
  variableRow(page, NAME).locator('[data-testid^="expand-button-"]')
const maskedField = (win: Locator) =>
  valueField(win).getByRole('button', { name: 'Value: Edit protected value', exact: true })
const consent = (page: Page) => page.getByRole('dialog', { name: 'Edit Protected Value?' })

test.describe('V-VMGR-CREATE-SECRET: root-secret visibility', () => {
  test('an unsaved secret is inspectable; saving re-masks + re-locks; Delete & Edit in the window re-opens', async ({
    page,
    request,
  }) => {
    test.setTimeout(180_000)
    const testId = await createValidTest(request, {
      name: `V-VMGR-CREATE-SECRET ${Date.now()}`,
      nodes: [],
    })
    await page.request.delete(`http://localhost:${BACKEND_PORT}/workbench/session`).catch(() => {})
    await openTest(page, testId)

    // Create an unsaved root secret (string literal + Mark as secret).
    await createSimpleVariable(page, NAME, { value: VALUE, secret: true })
    await expect(
      variableRow(page, NAME).locator('[data-testid^="secret-badge-"]'),
    ).toBeVisible()

    await test.step('an UNSAVED secret is inspectable; the watcher shows the value with the amber notice', async () => {
      await expect(expandBtn(page)).not.toHaveAttribute('aria-disabled', 'true')
      await expandBtn(page).click()
      await expect(watcher(page)).toBeVisible()
      await expect(watcher(page).locator('[data-testid="scalar-body"] .cm-content')).toHaveText(
        VALUE,
      )
      await expect(watcher(page).locator('[data-testid="inspect-secret-notice"]')).toBeVisible()
    })

    await test.step('saving the test re-locks the secret (open watcher closes, expand disables) with no refresh', async () => {
      await expect(saveBtn(page)).toBeEnabled()
      await saveBtn(page).click()
      await expect(saveBtn(page)).toBeDisabled({ timeout: 10_000 })
      // The open watcher closes and the row expand control disables (masked).
      await expect(watcher(page)).toHaveCount(0)
      await expect(expandBtn(page)).toHaveAttribute('aria-disabled', 'true')
    })

    await test.step('the pencil on a SAVED secret opens its window masked; Cancel on the question leaves it locked', async () => {
      const win = await openEditWindow(page, NAME)
      await expect(consent(page), 'the pencil asks nothing').toHaveCount(0)
      await expect(maskedField(win)).toBeVisible()
      await editProtectedValue(page, win, 'Cancel')
      await expect(maskedField(win)).toBeVisible()
      await cancelWindow(page, win)
      // Cancel opens nothing - the saved secret stays locked.
      await expect(watcher(page)).toHaveCount(0)
      await expect(expandBtn(page)).toHaveAttribute('aria-disabled', 'true')
    })

    await test.step('Delete & Edit empties the field (write-only replace); saving makes it UNSAVED again', async () => {
      const win = await openEditWindow(page, NAME)
      await editProtectedValue(page, win, 'Delete & Edit')
      // The stored value never seeds the field - it opens empty.
      await expect(valueEditor(page, win)).toHaveValue('')
      await expect(win.locator('[data-testid="inspect-secret-notice"]')).toBeVisible()
      await setWindowValue(page, win, 'sk-rotated-456')
      await saveWindow(page, win)
      // Unsaved again -> the row expand control re-enables.
      await expect(expandBtn(page)).not.toHaveAttribute('aria-disabled', 'true')
    })
  })
})
