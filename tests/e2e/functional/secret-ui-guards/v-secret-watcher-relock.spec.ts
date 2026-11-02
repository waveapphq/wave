/**
 * V-SECRET-WATCHER-RELOCK: saving and reloading re-lock every open secret watcher
 * Wireframe: none (watcher behavior)
 * Design Decisions: VMGR-106, SECUI-1
 * REQ: REQ-3.1.3.5
 *
 * Each test holds several secret watchers open at once, so every one of them must close.
 *
 * Pass Criteria:
 *  1. With TWO unsaved-secret watchers open (values legitimately visible pre-save), saving
 *     the test closes BOTH; the plain-variable watcher stays open
 *  2. After the save re-lock, the row pencil no longer reveals the old value - its Edit
 *     window shows the masked field
 *  3. With several secret watchers open (saved secrets replaced through "Delete & Edit"),
 *     a page reload restores NO secret watcher while the plain-variable watcher still restores
 */

import { test, expect, type Page } from '../../helpers/playwright-fixtures'
import { waitForCanvasLoad } from '../../helpers/canvas'
import { importValidateAndNavigate } from '../../helpers/fixture-import'
import { saveBtn } from '../../helpers/workbench'
import {
  variableRow,
  expandVariableManager,
  createSimpleVariable,
  cancelWindow,
  editProtectedValue,
  openEditWindow,
  saveWindow,
  setWindowValue,
  valueField,
} from '../../helpers/variable-create'
import fs from 'fs'
import path from 'path'

function loadFixture(): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(path.resolve(__dirname, 'fixture.json'), 'utf-8'))
}

const watcher = (page: Page, name: string) =>
  page.locator(`section[aria-label="Inspect variable ${name}"]`)
const expandBtn = (page: Page, name: string) =>
  variableRow(page, name).locator('[data-testid^="expand-button-"]')
const consentDialog = (page: Page) => page.getByRole('dialog', { name: 'Edit Protected Value?' })

test.describe('V-SECRET-WATCHER-RELOCK', () => {
  test('saving closes ALL open secret watchers; the pencil opens the masked field', async ({
    page,
  }) => {
    test.setTimeout(240_000)
    await importValidateAndNavigate(page, loadFixture())
    await expandVariableManager(page)

    // Two UNSAVED secrets - their values are legitimately visible pre-save.
    await createSimpleVariable(page, 'sec_a', { value: 'sec-a-v4lue-7701', secret: true })
    await createSimpleVariable(page, 'sec_b', { value: 'sec-b-v4lue-7702', secret: true })

    await test.step('Open BOTH unsaved-secret watchers plus a plain watcher', async () => {
      await expandBtn(page, 'sec_a').click()
      await expect(watcher(page, 'sec_a')).toBeVisible()
      await expect(
        watcher(page, 'sec_a').locator('[data-testid="scalar-body"] .cm-content'),
      ).toHaveText('sec-a-v4lue-7701')

      await expandBtn(page, 'sec_b').click()
      await expect(watcher(page, 'sec_b')).toBeVisible()

      await expandBtn(page, 'plain_note').click()
      await expect(watcher(page, 'plain_note')).toBeVisible()
    })

    await test.step('saving the test closes BOTH secret watchers in one commit, not just the last', async () => {
      await expect(saveBtn(page)).toBeEnabled()
      await saveBtn(page).click()
      await expect(saveBtn(page)).toBeDisabled({ timeout: 10_000 })

      await expect(watcher(page, 'sec_a')).toHaveCount(0)
      await expect(watcher(page, 'sec_b')).toHaveCount(0)
      // The plain watcher is untouched by the re-lock sweep.
      await expect(watcher(page, 'plain_note')).toBeVisible()
    })

    await test.step('the pencil no longer reveals the old value - its Edit window shows the masked field', async () => {
      await expect(expandBtn(page, 'sec_a')).toHaveAttribute('aria-disabled', 'true')
      const win = await openEditWindow(page, 'sec_a')
      await expect(consentDialog(page)).toHaveCount(0)
      await expect(
        valueField(win).getByRole('button', { name: 'Value: Edit protected value', exact: true }),
      ).toBeVisible()
      await expect(win).not.toContainText('sec-a-v4lue-7701')
      // No watcher opened carrying the old value.
      await expect(watcher(page, 'sec_a')).toHaveCount(0)
      await cancelWindow(page, win)
    })
  })

  test('a reload restores NO secret watcher while plain watchers restore', async ({
    page,
  }) => {
    test.setTimeout(240_000)
    await importValidateAndNavigate(page, loadFixture())
    await expandVariableManager(page)

    await test.step('Open a plain watcher and TWO watchers of saved secrets replaced through Delete & Edit', async () => {
      await expandBtn(page, 'plain_note').click()
      await expect(watcher(page, 'plain_note')).toBeVisible()

      for (const [name, value] of [
        ['api_key', 'relock-key-7703'],
        ['cred_map', '{"k": "relock-map-7704"}'],
      ] as const) {
        const win = await openEditWindow(page, name)
        await editProtectedValue(page, win, 'Delete & Edit')
        await setWindowValue(page, win, value)
        await saveWindow(page, win)
        await expandBtn(page, name).click()
        await expect(watcher(page, name)).toBeVisible()
      }
    })

    await test.step('reload restores the plain watcher only - every secret watcher stays closed', async () => {
      await expect(watcher(page, 'plain_note'), 'the plain watcher is open before the reload').toBeVisible()
      await page.reload()
      await waitForCanvasLoad(page)
      await expandVariableManager(page)

      await expect(watcher(page, 'plain_note')).toBeVisible()
      await expect(watcher(page, 'api_key')).toHaveCount(0)
      await expect(watcher(page, 'cred_map')).toHaveCount(0)
    })
  })
})
