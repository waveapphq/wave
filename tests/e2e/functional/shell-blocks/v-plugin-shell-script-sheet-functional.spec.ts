/**
 * SH-16: Shell Script sheet behavior, name rules, bound type and binding on rename
 * Design Decisions: SHRUN-3, SHRUN-4, SHRUN-5, SHRUN-6, SHRUN-13, VARSET-5, VARSET-8
 * REQ: REQ-3.4.1.1, REQ-3.4.2.2
 *
 * Pass Criteria:
 * 1. Script Type: Source shows Script and no Script File; after Script is set to
 *    `echo keep`, File shows Script File with Browse and no Script; back on Source the
 *    Script field reads `echo keep`. The Shell row sits directly under Script Type,
 *    above Script / Script File, in both Script Types.
 * 2. Arguments in the shared list editor: Add is named by its text `Add argument`; three
 *    added items read $1 `a`, $2 `b`, $3 `c`; after "Remove argument $2" item 0 is `a` at $1,
 *    item 1 is `c` at $2, there is no item 2, and focus is on the item that took the
 *    removed one's place; "Move argument $2 up" keeps focus on that arrow of the moved item
 *    (now $1, so on its down arrow, the up one being off); removing the last item puts focus
 *    on Add argument; Save writes `[{value: c}, {value: a}]` into the field.
 * 3. Variable exports: no name error shows while a just-added name field has focus.
 *    After the field is left (Tab) the error sits on its own table row under the export
 *    row and reads exactly "Another variable export has this name" on both `A` rows,
 *    "A block output already has this name" for `stdout`, and "Name must start with a
 *    letter or underscore, and contain only letters, numbers, and underscores" for `1x`,
 *    each with Save disabled; renaming to `B` clears every error and Save is enabled.
 * 4. Stop on pattern ticked with both patterns empty: Fail pattern carries the required
 *    asterisk, its alert reads exactly "Set a pass pattern, a fail pattern or both", and
 *    both the sheet Save and the unsaved-changes Save are disabled; after Pass pattern
 *    `^ok` the asterisk and the alert are gone and Save is enabled.
 * 5. Input Variables map editor: `WAVE_X` sets `aria-invalid="true"` and the validation
 *    strip reads exactly "Variable names may not start with WAVE_: 'WAVE_X'"; `1X` reads
 *    exactly "Invalid variable name: '1X'"; `X1` clears the strip.
 * 6. Bound type: an export `COUNT` bound to `f3_count` survives a reload; after a later
 *    edit and save the Variable Manager still shows `f3_count` as integer, the persisted
 *    Test keeps `integer`, and the COUNT row's Type select is disabled and reads Integer.
 * 7. Rename binding: after `STATUS` is renamed to `STATUS_RENAMED` in the Variable Manager
 *    the export row name stays `STATUS` and its binding reads `STATUS_RENAMED`; the
 *    persisted node has `outputBindings.STATUS` `STATUS_RENAMED`, `outputBindings.COUNT`
 *    still `f3_count`, no key `STATUS_RENAMED`, and `script_variables` contains `STATUS`.
 */

import fs from 'fs'
import path from 'path'
import { test, expect, type Locator, type Page } from '../../helpers/playwright-fixtures'
import { importValidateAndNavigate } from '../../helpers/fixture-import'
import { BACKEND_URL } from '../../helpers/config'
import {
  addListItem,
  editPreview,
  listAddButton,
  listItems,
  listMoveDown,
  listMoveUp,
  listPositions,
  openFieldEditor,
  openListEditor,
  saveListEditor,
  typeFieldText,
} from '../../helpers/config-sheet'
import { listItem } from '../../helpers/entry-editors'
import {
  EDIT_WINDOW,
  expandVariableManager,
  openEditWindow,
  renameInWindow,
  saveWindow,
  variableRow,
} from '../../helpers/variable-create'
import {
  closeConfig,
  deleteTest,
  expandGroup,
  openConfig,
  openTestOnCanvas,
  persistedNodes,
  saveConfig,
  saveWorkbench,
} from '../file-picker/picker'
import { newToken, withToken } from './shell-helpers'

const NODE = 'sh-sheet'

const DUPLICATE_NAME = 'Another variable export has this name'
const OUTPUT_CLASH = 'A block output already has this name'
const NAME_RULE =
  'Name must start with a letter or underscore, and contain only letters, numbers, and underscores'

function loadFixture(token: string): Record<string, unknown> {
  const raw = JSON.parse(fs.readFileSync(path.resolve(__dirname, 'fixture-sheet.json'), 'utf-8'))
  return withToken(raw, token)
}

/** The input parameter rows of the sheet, by wire name, in render order. */
async function inputRowOrder(dialog: Locator): Promise<string[]> {
  return dialog
    .locator('tr[data-testid^="param-row-"]')
    .evaluateAll((rows) =>
      rows.map((row) => (row.getAttribute('data-testid') ?? '').slice('param-row-'.length)),
    )
}

async function expectShellUnderScriptType(dialog: Locator, contentRow: string): Promise<void> {
  const order = await inputRowOrder(dialog)
  const typeAt = order.indexOf('script_type')
  expect(typeAt, `row order: ${order.join(', ')}`).toBeGreaterThanOrEqual(0)
  expect(order.slice(typeAt, typeAt + 3), `row order: ${order.join(', ')}`).toEqual([
    'script_type',
    'shell',
    contentRow,
  ])
}

async function selectScriptType(page: Page, dialog: Locator, label: 'Source' | 'File'): Promise<void> {
  const select = dialog.getByRole('combobox', { name: 'Script Type' })
  await select.click()
  await page.getByRole('option', { name: label, exact: true }).click()
  await expect(select).toContainText(label)
}

function saveButtons(dialog: Locator): Locator {
  return dialog.getByRole('button', { name: /^Save$/ })
}

async function expectSaveDisabled(dialog: Locator): Promise<void> {
  const buttons = saveButtons(dialog)
  const count = await buttons.count()
  expect(count, 'the sheet renders a Save button').toBeGreaterThan(0)
  for (let i = 0; i < count; i++) await expect(buttons.nth(i)).toBeDisabled()
}

async function expectSaveEnabled(dialog: Locator): Promise<void> {
  const buttons = saveButtons(dialog)
  const count = await buttons.count()
  expect(count, 'the sheet renders a Save button').toBeGreaterThan(0)
  for (let i = 0; i < count; i++) await expect(buttons.nth(i)).toBeEnabled()
}

function exportName(dialog: Locator, index: number): Locator {
  return dialog.getByTestId(`output-list-name-${index}`)
}

async function expectNoNameError(dialog: Locator, index: number): Promise<void> {
  await expect(dialog.locator(`#output-list-name-error-${index}`)).toHaveCount(0)
  await expect(exportName(dialog, index)).not.toHaveAttribute('aria-invalid', 'true')
}

/** The name error sits on its own table row directly under the export row, never in the name cell. */
async function expectNameError(dialog: Locator, index: number, message: string): Promise<void> {
  const name = exportName(dialog, index)
  const exportRow = name.locator('xpath=ancestor::tr[1]')
  const errorRow = exportRow.locator('xpath=following-sibling::tr[1]')
  const alert = errorRow.locator(`#output-list-name-error-${index}`)
  await expect(alert).toHaveAttribute('role', 'alert')
  await expect(alert).toHaveText(message)
  await expect(exportRow.getByRole('alert')).toHaveCount(0)
  await expect(name).toHaveAttribute('aria-invalid', 'true')
}

async function renameExport(dialog: Locator, index: number, name: string): Promise<void> {
  const field = exportName(dialog, index)
  await field.fill(name)
  await field.press('Tab')
}

/** Add an export row, name it, leave the field, and pick an existing variable in its binding. */
async function addBoundExport(
  page: Page,
  dialog: Locator,
  name: string,
  variable: string,
): Promise<number> {
  const index = await dialog.locator('[data-testid^="output-list-name-"]').count()
  await dialog.getByTestId('output-list-add').click()
  await renameExport(dialog, index, name)
  const combobox = dialog.getByTestId(`output-list-binding-${index}`).getByRole('combobox')
  await combobox.click()
  await combobox.fill(variable)
  await page
    .getByRole('option')
    .filter({ hasText: new RegExp(`^${variable}`) })
    .first()
    .click()
  await expect(combobox).toHaveValue(variable)
  return index
}

async function expectLockedType(dialog: Locator, index: number, label: string): Promise<void> {
  const type = dialog.getByTestId(`output-list-type-${index}`)
  await expect(type).toBeDisabled()
  await expect(type).toHaveText(label)
}

async function persistedTest(page: Page, testId: string): Promise<Record<string, any>> {
  const response = await page.request.get(`${BACKEND_URL}/tests/${testId}`)
  expect(response.ok(), `GET /tests/${testId} answered ${response.status()}`).toBeTruthy()
  const body = await response.json()
  return (body.data ?? body) as Record<string, any>
}

test.describe('SH-16: Shell Script sheet behavior', () => {
  let testId: string | undefined

  test.afterAll(async ({ request }) => {
    if (testId) await deleteTest(request, testId)
  })

  test('SH-16 sheet rows, name rules, bound type and binding on rename', async ({
    page,
  }: {
    page: Page
  }) => {
    test.setTimeout(240_000)
    const token = newToken()
    testId = await importValidateAndNavigate(page, loadFixture(token))
    const dialog = await openConfig(page, NODE)

    await test.step('Script Type swaps Script and Script File and keeps the Script draft', async () => {
      await expect(dialog.getByTestId('param-row-script')).toBeVisible()
      await expect(dialog.getByTestId('param-row-script_file')).toHaveCount(0)
      await expectShellUnderScriptType(dialog, 'script')

      await typeFieldText(dialog, 'script', 'echo keep')
      await selectScriptType(page, dialog, 'File')
      await expect(dialog.getByTestId('param-row-script_file')).toBeVisible()
      await expect(dialog.getByTestId('param-browse-script_file')).toBeVisible()
      await expect(dialog.getByTestId('param-row-script')).toHaveCount(0)
      await expectShellUnderScriptType(dialog, 'script_file')

      await selectScriptType(page, dialog, 'Source')
      await expect(dialog.getByTestId('param-row-script_file')).toHaveCount(0)
      await expect(editPreview(dialog, 'script')).toHaveValue('echo keep')
      await expectShellUnderScriptType(dialog, 'script')
    })

    await test.step('Arguments add, number, remove and move items in the list editor (SHRUN-4)', async () => {
      const editor = await openListEditor(page, dialog, 'arguments')
      await expect(listAddButton(editor)).toHaveText('Add argument')
      await expect(listAddButton(editor)).not.toHaveAttribute('aria-label')
      for (const value of ['a', 'b', 'c']) await addListItem(editor, value)
      expect(await listPositions(editor)).toEqual(['$1', '$2', '$3'])
      for (const [i, value] of ['a', 'b', 'c'].entries()) await expect(listItem(editor, i).valueInput).toHaveValue(value)

      const remove = listItem(editor, 1).remove
      await expect(remove).toHaveAccessibleName('Remove argument $2')
      await remove.click()
      await expect(listItem(editor, 0).valueInput).toHaveValue('a')
      await expect(listItem(editor, 1).valueInput).toHaveValue('c')
      expect(await listPositions(editor)).toEqual(['$1', '$2'])
      await expect(listItem(editor, 2).valueInput).toHaveCount(0)
      await expect(listItem(editor, 1).valueInput, 'focus is on the item that took the removed place').toBeFocused()

      const moveUp = listMoveUp(editor, 1)
      await expect(moveUp).toHaveAccessibleName('Move argument $2 up')
      await moveUp.click()
      await expect(listItem(editor, 0).valueInput).toHaveValue('c')
      await expect(listItem(editor, 1).valueInput).toHaveValue('a')
      // At $1 the up arrow is off, so focus stays on the moved item's other arrow.
      await expect(listMoveUp(editor, 0)).toHaveAttribute('aria-disabled', 'true')
      await expect(listMoveDown(editor, 0)).toBeFocused()

      await addListItem(editor, 'd')
      await listItem(editor, 2).remove.click()
      await expect(listItems(editor)).toHaveCount(2)
      await expect(listAddButton(editor), 'removing the last item moves focus to Add argument').toBeFocused()
      await saveListEditor(editor)
      await expect(editPreview(dialog, 'arguments')).toHaveValue('["c", "a"]')
    })

    await test.step('Variable export names show their error once the field is left', async () => {
      await expect(dialog.locator('[data-testid^="output-list-name-"]')).toHaveCount(0)
      const add = dialog.getByTestId('output-list-add')
      await expect(add).toHaveAttribute('aria-label', 'Add variable export')

      await add.click()
      await expect(exportName(dialog, 0)).toBeFocused()
      await expectNoNameError(dialog, 0)
      await exportName(dialog, 0).fill('A')

      await add.click()
      await expect(exportName(dialog, 1)).toBeFocused()
      await expectNoNameError(dialog, 1)
      await renameExport(dialog, 1, 'A')
      await expectNameError(dialog, 0, DUPLICATE_NAME)
      await expectNameError(dialog, 1, DUPLICATE_NAME)
      await expectSaveDisabled(dialog)

      await renameExport(dialog, 1, 'stdout')
      await expectNoNameError(dialog, 0)
      await expectNameError(dialog, 1, OUTPUT_CLASH)
      await expectSaveDisabled(dialog)

      await renameExport(dialog, 1, '1x')
      await expectNameError(dialog, 1, NAME_RULE)
      await expectSaveDisabled(dialog)

      await renameExport(dialog, 1, 'B')
      await expectNoNameError(dialog, 0)
      await expectNoNameError(dialog, 1)
      await expectSaveEnabled(dialog)

      const removeB = dialog.getByTestId('output-list-remove-1')
      await expect(removeB).toHaveAttribute('aria-label', 'Remove variable export 2')
      await removeB.click()
      await expect(exportName(dialog, 1)).toHaveCount(0)
      await expect(exportName(dialog, 0)).toHaveValue('A')
    })

    await test.step('Stop on pattern requires a pass pattern, a fail pattern or both', async () => {
      await expandGroup(dialog, 'Stop on Pattern')
      await dialog.getByRole('checkbox', { name: 'Stop on pattern' }).click()
      await expect(dialog.getByTestId('param-row-pass_pattern')).toBeVisible()
      const failRow = dialog.getByTestId('param-row-fail_pattern')
      await expect(failRow).toBeVisible()
      const asterisk = failRow.locator('span[aria-hidden="true"]', { hasText: /^\*$/ })
      await expect(asterisk).toHaveCount(1)
      await expect(failRow.getByRole('alert')).toHaveText('Set a pass pattern, a fail pattern or both')
      await expectSaveDisabled(dialog)
      // The unsaved-changes prompt carries the second Save, and it is blocked too.
      await dialog.locator('button[aria-label="Close"]').click()
      const unsaved = page.getByRole('dialog', { name: 'Unsaved changes' })
      await expect(unsaved).toBeVisible()
      await expect(unsaved.getByRole('button', { name: 'Save', exact: true })).toBeDisabled()
      await unsaved.getByRole('button', { name: 'Keep Editing' }).click()
      await expect(unsaved).toBeHidden()
      await expect(dialog).toBeVisible()

      await typeFieldText(dialog, 'pass_pattern', '^ok')
      await expect(asterisk).toHaveCount(0)
      await expect(failRow.getByRole('alert')).toHaveCount(0)
      await expectSaveEnabled(dialog)
    })

    await test.step('Input Variables names follow the shell rules', async () => {
      const sheet = await openFieldEditor(page, dialog, 'input_vars')
      await sheet.getByTestId('map-add-entry').click()
      const key = sheet.getByTestId('map-edit-key-0')
      const strip = page.getByTestId('value-editor-validation')

      await key.fill('WAVE_X')
      await expect(key).toHaveAttribute('aria-invalid', 'true')
      await expect(strip).toHaveAttribute('role', 'alert')
      await expect(strip).toHaveText("Variable names may not start with WAVE_: 'WAVE_X'")

      await key.fill('1X')
      await expect(strip).toHaveText("Invalid variable name: '1X'")

      await key.fill('X1')
      await expect(strip).toHaveCount(0)
      await expect(key).not.toHaveAttribute('aria-invalid', 'true')

      await sheet.getByTestId('value-editor-cancel-button').click()
      await page.getByTestId('value-editor-unsaved-discard-button').click()
      await expect(sheet).toBeHidden()
      await saveConfig(dialog)
    })

    let countIndex = -1
    await test.step('a bound export keeps its variable type across a reload', async () => {
      const sheet = await openConfig(page, NODE)
      countIndex = await addBoundExport(page, sheet, 'COUNT', 'f3_count')
      await expectLockedType(sheet, countIndex, 'Integer')
      await saveConfig(sheet)
      await saveWorkbench(page)

      await page.request.delete(`${BACKEND_URL}/workbench/session/`).catch(() => undefined)
      await openTestOnCanvas(page, testId as string)

      const reloaded = await openConfig(page, NODE)
      await expect(exportName(reloaded, countIndex)).toHaveValue('COUNT')
      await expectLockedType(reloaded, countIndex, 'Integer')
      await typeFieldText(reloaded, 'script', 'echo seed2')
      await saveConfig(reloaded)
      await saveWorkbench(page)

      await expandVariableManager(page)
      await expect(variableRow(page, 'f3_count').locator('[data-testid^="type-badge-"]')).toHaveText(
        /^integer$/i,
      )
      const saved = await persistedTest(page, testId as string)
      expect(saved.variables.f3_count.type).toBe('integer')
      const node = saved.workflow.nodes.find((n: { id: string }) => n.id === NODE)
      expect(node.data.config.values.script).toBe('echo seed2')
      expect(node.data.config.values.arguments, 'the list editor wrote record rows').toEqual([
        { value: 'c' },
        { value: 'a' },
      ])
      expect(node.data.config.outputBindings.COUNT).toBe('f3_count')

      const check = await openConfig(page, NODE)
      await expect(exportName(check, countIndex)).toHaveValue('COUNT')
      await expectLockedType(check, countIndex, 'Integer')
      await closeConfig(check)
    })

    await test.step('a binding follows a variable rename and the export name stays', async () => {
      const sheet = await openConfig(page, NODE)
      const statusIndex = await addBoundExport(page, sheet, 'STATUS', 'STATUS')
      await saveConfig(sheet)

      await expandVariableManager(page)
      const win = await openEditWindow(page, 'STATUS')
      await renameInWindow(win, 'STATUS_RENAMED')
      await saveWindow(page, win)
      await expect(variableRow(page, 'STATUS_RENAMED')).toBeVisible()
      await expect(variableRow(page, 'STATUS')).toHaveCount(0)
      await expect(page.locator(EDIT_WINDOW)).toHaveCount(0)

      const check = await openConfig(page, NODE)
      await expect(exportName(check, statusIndex)).toHaveValue('STATUS')
      await expect(
        check.getByTestId(`output-list-binding-${statusIndex}`).getByRole('combobox'),
      ).toHaveValue('STATUS_RENAMED')
      await closeConfig(check)

      await saveWorkbench(page)
      const config = (await persistedNodes(page.request, testId as string))[NODE].config
      expect(config.outputBindings.STATUS).toBe('STATUS_RENAMED')
      expect(config.outputBindings.COUNT).toBe('f3_count')
      expect(Object.keys(config.outputBindings)).not.toContain('STATUS_RENAMED')
      expect(config.values.script_variables).toContain('STATUS')
    })
  })
})
