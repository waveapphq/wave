/**
 * V-VMGR-CREATE-NESTED-ROUNDTRIP: an array item / map value of a nested type
 * keeps its type and value across save + reload + inspect.
 *
 * Create an array variable with one element typed `map`, give
 * it a real map value, save, then inspect - the element type stays `map` and the
 * map value never renders as an escaped quoted string. A nested array / map
 * element round-trips through storage as VERBATIM JSON TEXT (the backend
 * realizes it), and the reseed + read paths recognize a JSON array / map text
 * string as that nested type, matching the backend.
 *
 * REQ-3.1.3.11 (Variable Manager UI panel), REQ-3.1.3.13 (computed/complex
 * variables), REQ-3.1.3.19; VMGR-110 (the value is edited in the "Edit value" window).
 *
 * Phase: functional-workflow (seeds + saves a Test, then reloads it).
 *
 * Pass Criteria:
 * 1. Authoring an array item as `{"host":"localhost"}` in the New variable window's
 *    "Edit value" window infers the `map` type pill.
 * 2. After save + reload, inspecting the variable shows the element as the map
 *    `{"host":"localhost"}` - NOT an escaped quoted string `"{\"host\":...}"`.
 * 3. Re-editing the variable (Edit window, Open editor) shows the element type pill
 *    as `map` (not `string`) and the cell value as the unescaped JSON.
 */

import { test, expect, type Page } from '../../helpers/playwright-fixtures'
import { BACKEND_PORT } from '../../helpers/config'
import { createValidTest, openTest } from '../../helpers/fn-seed'
import {
  closeValueEditor,
  expandVariableManager,
  openCreateModal,
  openEditWindow,
  openValueEditor,
  saveValueEditor,
  saveWindow,
  setCreateName,
  setCreateType,
  variableRow,
} from '../../helpers/variable-create'
import { saveBtn } from '../../helpers/workbench'

const MAP_TEXT = '{"host":"localhost"}'
// The nested map never renders as a quoted string cell (outer quotes).
const QUOTED = `"${MAP_TEXT}"`

/** Create the array `name` holding one map item, typed in the "Edit value" window. */
async function createArrayWithMapItem(page: Page, name: string, pickMapFirst = false): Promise<void> {
  const win = await openCreateModal(page)
  await setCreateName(page, name, win)
  await setCreateType(page, 'array', win)
  const sheet = await openValueEditor(page, win)
  await sheet.locator('[data-testid="array-add-item"]').click()
  if (pickMapFirst) {
    // The user's "one element of type map" path: the pill first, then the value.
    await sheet.locator('[data-testid="array-type-0"]').click()
    await page.getByRole('option', { name: 'map', exact: true }).click()
  }
  await sheet.locator('[data-testid="array-edit-input-0"]').fill(MAP_TEXT)
  // The type pill reads `map`, picked or inferred from the JSON the user typed.
  await expect(sheet.locator('[data-testid="array-type-0"]')).toHaveText('map')
  await saveValueEditor(sheet)
  await closeValueEditor(page, sheet)
  await saveWindow(page, win)
  await expect(variableRow(page, name)).toBeVisible()
}

/** The item rows of `name` in its Edit window's "Edit value" window. */
async function expectMapItemInEditor(page: Page, name: string): Promise<void> {
  const win = await openEditWindow(page, name)
  const sheet = await openValueEditor(page, win)
  await expect(sheet.locator('[data-testid="array-type-0"]')).toHaveText('map')
  await expect(sheet.locator('[data-testid="array-edit-input-0"]')).toHaveValue(MAP_TEXT)
}

async function toolbarSave(page: Page): Promise<void> {
  await expect(saveBtn(page)).toBeEnabled()
  await saveBtn(page).click()
  // The toolbar Save settles back to a non-dirty state once the test persists.
  await expect(saveBtn(page)).toBeDisabled({ timeout: 10_000 })
}

test.describe('V-VMGR-CREATE-NESTED-ROUNDTRIP: nested element type survives save + inspect', () => {
  test('an array item typed map keeps its type and unescaped value across save + reload', async ({
    page,
    request,
  }) => {
    test.setTimeout(120_000)
    const testId = await createValidTest(request, {
      name: `V-VMGR-CREATE-NESTED ${Date.now()}`,
      nodes: [],
    })
    await page.request.delete(`http://localhost:${BACKEND_PORT}/workbench/session`).catch(() => {})
    await openTest(page, testId)

    // ------------------------------------------------------------------
    // Author an array variable whose single element is a map (authored by
    // typing JSON, which bracket-commits to the map type).
    // ------------------------------------------------------------------
    await createArrayWithMapItem(page, 'cfg')

    // ------------------------------------------------------------------
    // Save, then reload so the value comes back from the backend as the
    // verbatim JSON-text element (the real round trip).
    // ------------------------------------------------------------------
    await toolbarSave(page)
    await openTest(page, testId)
    await expandVariableManager(page)
    await expect(variableRow(page, 'cfg')).toBeVisible()

    // ------------------------------------------------------------------
    // Inspect (read): the element shows as the map, NOT an escaped string.
    // ------------------------------------------------------------------
    await variableRow(page, 'cfg').locator('[data-testid^="expand-button-"]').click()
    const inspect = page.locator('section[aria-label="Inspect variable cfg"]')
    await expect(inspect).toBeVisible()
    const arrayBody = inspect.locator('[data-testid="array-body"]')
    await expect(arrayBody.locator('[data-testid="array-row"]')).toHaveCount(1)
    // The element cell shows the map exactly (no outer quotes).
    await expect(arrayBody.getByText(MAP_TEXT, { exact: true })).toBeVisible()
    await expect(arrayBody.getByText(QUOTED, { exact: true })).toHaveCount(0)
    // Close the read watcher before opening the editor.
    await inspect.locator('[aria-label="Close inspector for cfg"]').click()
    await expect(inspect).toHaveCount(0)

    // ------------------------------------------------------------------
    // Inspect (edit): the type pill is map (not string) and the cell value
    // is the unescaped JSON the user authored.
    // ------------------------------------------------------------------
    await expectMapItemInEditor(page, 'cfg')
  })

  test('an element whose type is set to map by hand keeps it across save + inspect (no reload + reload)', async ({
    page,
    request,
  }) => {
    test.setTimeout(120_000)
    const testId = await createValidTest(request, {
      name: `V-VMGR-CREATE-NESTED-EXPLICIT ${Date.now()}`,
      nodes: [],
    })
    await page.request.delete(`http://localhost:${BACKEND_PORT}/workbench/session`).catch(() => {})
    await openTest(page, testId)

    await createArrayWithMapItem(page, 'cfg2', true)

    // Inspect immediately (no save / reload) - the in-session reseed already
    // re-types from the stored value.
    await variableRow(page, 'cfg2').locator('[data-testid^="expand-button-"]').click()
    const inspect = page.locator('section[aria-label="Inspect variable cfg2"]')
    await expect(inspect.locator('[data-testid="array-body"]').getByText(MAP_TEXT, { exact: true }))
      .toBeVisible()
    await inspect.locator('[aria-label="Close inspector for cfg2"]').click()
    await expect(inspect).toHaveCount(0)

    // Now save + reload and re-check the read + edit views.
    await toolbarSave(page)
    await openTest(page, testId)
    await expandVariableManager(page)
    await expectMapItemInEditor(page, 'cfg2')
  })

  // ----------------------------------------------------------------------
  // The inspect (read) Code view + watcher text operations.
  // ----------------------------------------------------------------------
  async function createArrayWithMap(
    page: Page,
    request: import('@playwright/test').APIRequestContext,
    name: string,
  ): Promise<void> {
    const testId = await createValidTest(request, {
      name: `${name} ${Date.now()}`,
      nodes: [],
    })
    await page.request.delete(`http://localhost:${BACKEND_PORT}/workbench/session`).catch(() => {})
    await openTest(page, testId)
    await createArrayWithMapItem(page, name)
  }

  async function openInspectInCode(page: Page, name: string) {
    await variableRow(page, name).locator('[data-testid^="expand-button-"]').click()
    const inspect = page.locator(`section[aria-label="Inspect variable ${name}"]`)
    await expect(inspect).toBeVisible()
    await inspect.locator('[data-testid="view-dropdown"]').click()
    await page.getByRole('option', { name: 'Code', exact: true }).click()
    return inspect
  }

  test('the inspect Code view shows a nested map element unescaped (not JSON.stringify-escaped)', async ({
    page,
    request,
  }) => {
    test.setTimeout(120_000)
    await createArrayWithMap(page, request, 'cfg3')

    const inspect = await openInspectInCode(page, 'cfg3')
    const code = inspect.locator('[data-testid="code-body"] .cm-content')
    // The map element renders as the (pretty-printed) structure - its keys/values
    // unescaped, NOT the escaped quoted string `"{\"host\":\"localhost\"}"`.
    await expect(code).toContainText('"host"')
    await expect(code).toContainText('"localhost"')
    await expect(code).not.toContainText('\\')
  })

  test('the read watcher Code view supports select-all + copy when focused (not edit mode)', async ({
    page,
    request,
  }) => {
    test.setTimeout(120_000)
    await createArrayWithMap(page, request, 'cfg4')

    await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])

    const inspect = await openInspectInCode(page, 'cfg4')
    const code = inspect.locator('[data-testid="code-body"] .cm-content')
    await code.click()
    await page.keyboard.press('ControlOrMeta+a')
    // The draggable sheet's select-none must not defeat selection in the read
    // Code view: Ctrl+A selects the document text...
    const selected = await page.evaluate(() => window.getSelection()?.toString() ?? '')
    expect(selected).toContain('host')

    // ...and Ctrl+C copies it to the clipboard.
    await page.keyboard.press('ControlOrMeta+c')
    const clip = await page.evaluate(() => navigator.clipboard.readText())
    expect(clip).toContain('host')
  })
})
