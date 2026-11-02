/**
 * V-SECRET-VISIBLE-STRIP: the "stays visible until you save" strip shows only for a new or changed Test secret
 * Design Decisions: VMGR-106, VMGR-108, SECUI-1, SECUI-9
 * REQ: REQ-3.1.3.5, REQ-3.1.2.10
 *
 * Phase: functional-workflow (each test imports its own Test; no run).
 *
 * Pass Criteria:
 * 1. A new Test variable marked secret in the Add window shows the strip
 *    `Secret value stays visible until you save the test.` there; a plain value shows none.
 * 2. The new secret's watcher and its Edit window (Initial view) show the strip; the Current
 *    view of the Edit window shows none.
 * 3. An untouched saved secret is locked (expand disabled) and its Edit window shows the masked
 *    field with no strip; after "Delete & Edit" and a new value the strip shows in the window
 *    and, once saved in the window, in its watcher.
 * 4. A saved null secret stays unlocked with no strip: its watcher opens and its Edit window
 *    shows the null field; unticking Set to null asks no protected-value question.
 * 5. The Test save removes the strip: the open secret watchers close, both secrets lock and
 *    their Edit windows show the masked field with no strip; the saved Test holds them secret.
 */

import { test, expect, type Locator, type Page } from '../../helpers/playwright-fixtures'
import { BACKEND_URL } from '../../helpers/config'
import { importValidateAndNavigate } from '../../helpers/fixture-import'
import { saveTest } from '../../helpers/workbench'
import {
  cancelWindow,
  createNullField,
  editProtectedValue,
  expandVariableManager,
  openCreateModal,
  openEditWindow,
  saveWindow,
  setCreateName,
  setValueView,
  setWindowCheckbox,
  setWindowValue,
  submitCreate,
  typeStringValue,
  valueEditor,
  valueField,
  variableRow,
} from '../../helpers/variable-create'

const STRIP = 'Secret value stays visible until you save the test.'
const MASK = '********'

const FIXTURE: Record<string, unknown> = {
  name: 'Secret Visible Strip E2E',
  version: '1.0.0',
  description: 'A saved secret, a saved null secret and a plain variable.',
  workflow: { nodes: [], edges: [] },
  variables: {
    saved_tok: { value: 'strip-saved-1', type: 'string', scope: 'test', secret: true },
    saved_null: { value: null, type: 'string', scope: 'test', secret: true },
    plain_note: { value: 'note-1', type: 'string', scope: 'test' },
  },
  metadata: { tags: [], suite_id: null, parent_suite: null },
}

const strip = (scope: Locator): Locator => scope.getByTestId('inspect-secret-notice')
const watcher = (page: Page, name: string): Locator => page.locator(`section[aria-label="Inspect variable ${name}"]`)
const expandButton = (page: Page, name: string): Locator =>
  variableRow(page, name).locator('[data-testid^="expand-button-"]')
const maskedField = (win: Locator): Locator =>
  valueField(win).getByRole('button', { name: 'Value: Edit protected value', exact: true })
const protectedQuestion = (page: Page): Locator => page.getByRole('dialog', { name: 'Edit Protected Value?' })

async function openWatcher(page: Page, name: string): Promise<Locator> {
  await expect(expandButton(page, name), `${name} is unlocked`).not.toHaveAttribute('aria-disabled', 'true')
  await expandButton(page, name).click()
  await expect(watcher(page, name)).toBeVisible()
  return watcher(page, name)
}

async function closeWatcher(page: Page, name: string): Promise<void> {
  await watcher(page, name).getByRole('button', { name: `Close inspector for ${name}`, exact: true }).click()
  await expect(watcher(page, name)).toHaveCount(0)
}

let testId = ''

test.describe('V-SECRET-VISIBLE-STRIP', () => {
  test.afterEach(async ({ request }) => {
    if (testId) await request.delete(`${BACKEND_URL}/tests/${testId}`).catch(() => undefined)
    testId = ''
  })

  test('the strip shows for a new or changed secret only, never on Current, and the Test save removes it', async ({
    page,
    request,
  }) => {
    test.setTimeout(180_000)
    testId = await importValidateAndNavigate(page, FIXTURE)
    await expandVariableManager(page)

    await test.step('a new secret in the Add window shows the strip; a plain value shows none', async () => {
      const add = await openCreateModal(page)
      await setCreateName(page, 'new_tok', add)
      await typeStringValue(page, 'strip-new-1', add)
      await expect(strip(add), 'a plain value shows no strip').toHaveCount(0)
      await setWindowCheckbox(add, 'secret', true)
      await expect(strip(add)).toHaveText(STRIP)
      await submitCreate(page, add)
      await expect(add).toBeHidden()
      await expect(variableRow(page, 'new_tok')).toBeVisible()
    })

    await test.step('the new secret: the watcher and the Initial view show the strip, the Current view none', async () => {
      const seen = await openWatcher(page, 'new_tok')
      await expect(seen).toContainText('strip-new-1')
      await expect(strip(seen)).toHaveText(STRIP)
      await closeWatcher(page, 'new_tok')

      const win = await openEditWindow(page, 'new_tok')
      await expect(maskedField(win), 'an unsaved secret is never masked in its window').toHaveCount(0)
      await expect(valueEditor(page, win)).toHaveValue('strip-new-1')
      await expect(strip(win)).toHaveText(STRIP)
      await setValueView(page, win, 'Current')
      await expect(strip(win), 'the Current view shows no strip').toHaveCount(0)
      await setValueView(page, win, 'Initial')
      await expect(strip(win)).toHaveText(STRIP)
      await cancelWindow(page, win)
    })

    await test.step('an untouched saved secret is locked and shows no strip until its value changes', async () => {
      await expect(expandButton(page, 'saved_tok')).toHaveAttribute('aria-disabled', 'true')
      const win = await openEditWindow(page, 'saved_tok')
      await expect(maskedField(win)).toBeVisible()
      await expect(strip(win), 'an untouched saved secret shows no strip').toHaveCount(0)
      await editProtectedValue(page, win, 'Delete & Edit')
      await expect(strip(win)).toHaveText(STRIP)
      await setWindowValue(page, win, 'strip-saved-2')
      await saveWindow(page, win)

      const seen = await openWatcher(page, 'saved_tok')
      await expect(seen).toContainText('strip-saved-2')
      await expect(strip(seen)).toHaveText(STRIP)
    })

    await test.step('a saved null secret stays unlocked with no strip and no protected-value question', async () => {
      const seen = await openWatcher(page, 'saved_null')
      await expect(strip(seen), 'an untouched saved null secret shows no strip').toHaveCount(0)
      await closeWatcher(page, 'saved_null')

      const win = await openEditWindow(page, 'saved_null')
      await expect(createNullField(page, win)).toBeVisible()
      await expect(maskedField(win)).toHaveCount(0)
      await expect(strip(win)).toHaveCount(0)
      await setWindowCheckbox(win, 'set-to-null', false)
      await expect(protectedQuestion(page)).toHaveCount(0)
      await expect(valueEditor(page, win)).toBeEditable()
      await cancelWindow(page, win, 'Close')
    })

    await test.step('the Test save closes the secret watchers, locks both secrets and removes the strip', async () => {
      await openWatcher(page, 'new_tok')
      await saveTest(page)
      await expect(watcher(page, 'new_tok')).toHaveCount(0)
      await expect(watcher(page, 'saved_tok')).toHaveCount(0)
      for (const name of ['new_tok', 'saved_tok']) {
        await expect(expandButton(page, name), `${name} locks`).toHaveAttribute('aria-disabled', 'true')
        await expect(variableRow(page, name).locator('[data-testid^="variable-value-"]')).toHaveText(MASK)
        const win = await openEditWindow(page, name)
        await expect(maskedField(win)).toBeVisible()
        await expect(strip(win), `${name} shows no strip after the save`).toHaveCount(0)
        await cancelWindow(page, win)
      }
      await expect(expandButton(page, 'saved_null'), 'a null secret stays unlocked').not.toHaveAttribute(
        'aria-disabled',
        'true',
      )

      const saved = await request.get(`${BACKEND_URL}/tests/${testId}`)
      expect(saved.ok(), `GET /tests/${testId}: ${saved.status()}`).toBeTruthy()
      const variables = (await saved.json()).data.variables as Record<string, { value: unknown; secret?: boolean }>
      for (const name of ['new_tok', 'saved_tok']) {
        expect(variables[name], `the saved Test holds ${name} secret`).toMatchObject({ value: MASK, secret: true })
      }
    })
  })
})
