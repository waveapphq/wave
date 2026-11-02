/**
 * V-NULL-EDITORS-FUNCTIONAL: a stored null in the editable views, and Fix All declaring null.
 * Wireframe: none (the "Edit value" sheet of the variable window and the validation dialog are existing surfaces)
 * Design Decisions: VMGR-93 (one null look, null chip names, tooltip `Click to enter a value`), FIELD-5 (one gray)
 * REQ: REQ-3.1.3.20 (Fix All declares a missing variable with no value), REQ-3.1.3.11, REQ-3.1.2.4
 *
 * Pass Criteria:
 * 1. Table: in the "Edit value" sheet of `grid`'s Edit window each null cell is a button reading `null` in the null
 *    look (italic, monospace, Text Muted), named `Row <n> <column> (null)` (VMGR-93), with the tooltip
 *    `Click to enter a value`; a non-null cell is an editable input.
 * 2. Table: a click turns each null cell into an editable cell holding its column type's default -
 *    empty text (string), `0` (integer), `false` (boolean) - and Save writes those values (an
 *    integer as exact digit text) while the other cells keep theirs; the saved table keeps its
 *    column names and types in the stored `{columns, rows}` form (REQ-3.5.5.4, GET /tests/{id});
 *    the `grid` row reads `2×3 table` before the edit and after the save.
 * 3. List and map: `array-edit-null-1`, `map-edit-null-1` and `map-edit-null-2` read `null` in the null look,
 *    named `Item 1 (null)`, `mem (null)` and `debug (null)`, with the same tooltip.
 * 4. List and map: editing another item and saving keeps each null in the saved test, and the chips are
 *    back after a reload.
 * 5. List and map: a click enters the item type's default - empty text for a string item, `0` for an
 *    integer value, `false` for a boolean value - and Save writes it.
 * 6. Fix All on Save: with pause_ms (read by the Delay's duration) removed, Save is refused with
 *    UNDECLARED_VARIABLE and the fix `Add variable to manager (type: integer)`; the dialog
 *    `Cannot Save Test` offers Fix All, which declares pause_ms again as an integer and its row
 *    reads `null` in the null look, not dimmed, where it read `5` before.
 * 7. Fix All on Save: the saved test declares pause_ms (integer) with no value, the row still reads
 *    `null` after a reload, and the test validates with zero errors.
 * 8. Fix All on open: a stored test missing pause_ms opens with `Test Issues Found` listing the
 *    integer fix; Fix All declares pause_ms as an integer holding null (row in the null look,
 *    stored with no value) and the test validates with zero errors.
 *
 * Phase: functional-workflow (imports its own fixture, deletes it after).
 */

import { test, expect, type Locator, type Page } from '../../helpers/playwright-fixtures'
import { importValidateAndNavigate } from '../../helpers/fixture-import'
import { openTest, rawPersistTest, validateTest, VALIDATION } from '../../helpers/fn-seed'
import { getTest, readFixture } from '../../helpers/element-types'
import { deleteTest } from '../file-picker/picker'
import {
  closeValueEditor,
  editWindow,
  expandVariableManager,
  openEditWindow,
  openValueEditor,
  saveValueEditor,
  saveWindow,
  setValueEditorView,
  variableRow,
} from '../../helpers/variable-create'
import { saveBtn } from '../../helpers/workbench'
import { BACKEND_URL } from '../../helpers/config'

const NULL_CHIP_TOOLTIP = 'Click to enter a value'

// ---------------------------------------------------------------------------
// Look checks
// ---------------------------------------------------------------------------

/** VMGR-93, FIELD-5: exact text `null`, italic, the monospace stack and Text Muted. */
async function expectNullLook(target: Locator): Promise<void> {
  await expect(target).toHaveText('null')
  const look = await target.evaluate((el) => {
    const probe = (className: string, color = '') => {
      const span = document.createElement('span')
      span.className = className
      span.style.color = color
      ;(el.parentElement ?? document.body).appendChild(span)
      const style = getComputedStyle(span)
      const result = { color: style.color, fontFamily: style.fontFamily }
      span.remove()
      return result
    }
    const style = getComputedStyle(el)
    return {
      fontStyle: style.fontStyle,
      fontFamily: style.fontFamily,
      color: style.color,
      mono: probe('font-mono').fontFamily,
      muted: probe('', 'var(--color-text-muted)').color,
    }
  })
  expect(look.fontStyle, 'the null look is italic').toBe('italic')
  expect(look.fontFamily, 'the null look uses the monospace stack').toBe(look.mono)
  expect(look.fontFamily).toMatch(/mono/i)
  expect(look.color, 'the null look uses Text Muted').toBe(look.muted)
}

/** Not dimmed: the product of every opacity from the row up to the document is 1. */
async function expectNotDimmed(row: Locator): Promise<void> {
  const opacity = await row.evaluate((el) => {
    let total = 1
    for (let node: Element | null = el; node; node = node.parentElement) {
      total *= Number(getComputedStyle(node).opacity)
    }
    return total
  })
  expect(opacity, 'a null row is not dimmed').toBe(1)
}

/** VMGR-93: a null chip reads `null` in the null look, carries its name and the tooltip. */
async function expectNullChip(page: Page, chip: Locator, name: string): Promise<void> {
  await expect(chip).toHaveCount(1)
  await expect(chip).toHaveJSProperty('tagName', 'BUTTON')
  await expect(chip).toHaveAccessibleName(name)
  await expectNullLook(chip)
  await chip.hover()
  await expect(page.getByRole('tooltip')).toHaveText(NULL_CHIP_TOOLTIP)
  await page.mouse.move(0, 0)
  await expect(page.getByRole('tooltip')).toHaveCount(0)
}

// ---------------------------------------------------------------------------
// Variable Manager and the Edit window's "Edit value" sheet
// ---------------------------------------------------------------------------

const rowValue = (page: Page, name: string): Locator =>
  variableRow(page, name).locator('[data-testid^="variable-value-"]')
const rowType = (page: Page, name: string): Locator =>
  variableRow(page, name).locator('[data-testid^="type-badge-"]')
/** The row pencil's Edit window, its value open in the "Edit value" sheet's Visual view. */
async function openEditor(page: Page, name: string): Promise<Locator> {
  const win = await openEditWindow(page, name)
  const sheet = await openValueEditor(page, win)
  await setValueEditorView(page, sheet, 'Visual')
  return sheet
}

/** Apply the sheet to the window, close it, and save the window. */
async function saveEditor(page: Page, name: string): Promise<void> {
  const win = await editWindow(page, name)
  const sheet = page.locator('[data-testid="value-editor-sheet"]')
  await saveValueEditor(sheet)
  await closeValueEditor(page, sheet)
  await saveWindow(page, win)
}

async function saveTest(page: Page): Promise<void> {
  await expect(saveBtn(page)).toBeEnabled()
  await saveBtn(page).click()
  await expect(saveBtn(page)).toBeDisabled({ timeout: 15_000 })
}

async function reopen(page: Page, testId: string): Promise<void> {
  await openTest(page, testId)
  await expandVariableManager(page)
}

// ===========================================================================

test.describe('V-NULL-EDITORS-FUNCTIONAL: null in the edit views and Fix All', () => {
  let testId = ''

  test.beforeEach(async ({ page }) => {
    testId = await importValidateAndNavigate(page, readFixture(__dirname, 'fixture-editors.json'))
    await expandVariableManager(page)
  })

  test.afterEach(async ({ request }) => {
    await request.delete(`${BACKEND_URL}/workbench/session/`).catch(() => undefined)
    if (testId) await deleteTest(request, testId)
    testId = ''
  })

  test('a null table cell is the null chip and a click enters the column default', async ({
    page,
  }) => {
    await expect(rowValue(page, 'grid'), 'the stored table reads its size').toHaveText(
      '2\u00D73 table',
    )
    const modal = await openEditor(page, 'grid')
    await expect(modal.locator('[data-testid="table-edit-body"]')).toBeVisible()
    const cell = (row: number, column: number) =>
      modal.locator(`[data-testid="table-cell-${row}-${column}"]`)

    await test.step('each null cell reads null in the null look with its name and tooltip', async () => {
      await expectNullChip(page, cell(0, 1), 'Row 0 name (null)')
      await expectNullChip(page, cell(1, 0), 'Row 1 id (null)')
      await expectNullChip(page, cell(1, 2), 'Row 1 active (null)')
      await expect(cell(0, 0)).toHaveJSProperty('tagName', 'INPUT')
      await expect(cell(0, 0)).toHaveValue('1')
    })

    await test.step('a click gives an editable cell holding the column type default', async () => {
      await cell(0, 1).click()
      await expect(cell(0, 1)).toHaveJSProperty('tagName', 'INPUT')
      await expect(cell(0, 1)).toHaveValue('')
      await expect(cell(0, 1)).toBeEditable()

      await cell(1, 0).click()
      await expect(cell(1, 0)).toHaveJSProperty('tagName', 'INPUT')
      await expect(cell(1, 0)).toHaveValue('0')

      await cell(1, 2).click()
      await expect(cell(1, 2)).toHaveRole('combobox')
      await expect(cell(1, 2)).toHaveText('false')
    })

    await test.step('Save writes the defaults and keeps the other cells', async () => {
      await saveEditor(page, 'grid')
      await saveTest(page)
      const stored = await getTest(page.request, testId)
      expect(stored.variables.grid.type).toBe('table')
      // The column types are stored beside the rows; integers stay exact digit text.
      expect(stored.variables.grid.value).toEqual({
        columns: [
          { name: 'id', type: 'integer' },
          { name: 'name', type: 'string' },
          { name: 'active', type: 'boolean' },
        ],
        rows: [
          ['1', '', true],
          ['0', 'beta', false],
        ],
      })
      await expect(rowValue(page, 'grid')).toHaveText('2\u00D73 table')
    })
  })

  test('null list items and map values are null chips; another edit keeps them', async ({
    page,
  }) => {
    await test.step('the null item and the null map values read null with their names', async () => {
      const tags = await openEditor(page, 'tags')
      await expectNullChip(page, tags.locator('[data-testid="array-edit-null-1"]'), 'Item 1 (null)')
      const first = tags.locator('[data-testid="array-edit-input-0"]')
      await expect(first).toHaveValue('alpha')
      await first.fill('alpha2')
      await saveEditor(page, 'tags')

      const limits = await openEditor(page, 'limits')
      await expectNullChip(page, limits.locator('[data-testid="map-edit-null-1"]'), 'mem (null)')
      await expectNullChip(page, limits.locator('[data-testid="map-edit-null-2"]'), 'debug (null)')
      const cpu = limits.locator('[data-testid="map-edit-value-0"]')
      await expect(cpu).toHaveValue('two')
      await cpu.fill('three')
      await saveEditor(page, 'limits')
    })

    await test.step('editing another item and saving keeps each null', async () => {
      await saveTest(page)
      const stored = await getTest(page.request, testId)
      expect(stored.variables.tags.value).toEqual(['alpha2', null, 'gamma'])
      expect(stored.variables.limits.value).toEqual({ cpu: 'three', mem: null, debug: null })
      expect(stored.variables.limits.elementTypes).toEqual({
        cpu: 'string',
        mem: 'integer',
        debug: 'boolean',
      })
    })

    await test.step('after a reload a click enters the item type default and Save writes it', async () => {
      await reopen(page, testId)

      const tags = await openEditor(page, 'tags')
      const nullItem = tags.locator('[data-testid="array-edit-null-1"]')
      await expectNullChip(page, nullItem, 'Item 1 (null)')
      await nullItem.click()
      await expect(tags.locator('[data-testid="array-edit-input-1"]')).toHaveValue('')
      await expect(tags.locator('[data-testid="array-edit-null-1"]')).toHaveCount(0)
      await saveEditor(page, 'tags')

      const limits = await openEditor(page, 'limits')
      const mem = limits.locator('[data-testid="map-edit-null-1"]')
      const debug = limits.locator('[data-testid="map-edit-null-2"]')
      await expectNullChip(page, mem, 'mem (null)')
      await mem.click()
      await expect(limits.locator('[data-testid="map-edit-value-1"]')).toHaveValue('0')
      await debug.click()
      await expect(limits.locator('[data-testid="map-edit-value-2"]')).toHaveValue('false')
      await saveEditor(page, 'limits')

      await saveTest(page)
      const stored = await getTest(page.request, testId)
      expect(stored.variables.tags.value).toEqual(['alpha2', '', 'gamma'])
      expect(stored.variables.limits.value).toEqual({ cpu: 'three', mem: '0', debug: false })
    })
  })

  test('Fix All on Save declares the missing variable holding null', async ({ page }) => {
    await test.step('pause_ms reads its stored 5 before the change', async () => {
      await expect(rowValue(page, 'pause_ms')).toHaveText('5')
      await expect(rowValue(page, 'pause_ms').locator('span[translate="no"]')).toHaveCount(0)
    })

    await test.step('remove pause_ms from the Variable Manager', async () => {
      const row = variableRow(page, 'pause_ms')
      await row.hover()
      await row.locator('[data-testid^="delete-button-"]').click()
      const confirm = page.getByRole('alertdialog').filter({ hasText: /^Delete\b/ })
      await expect(confirm).toBeVisible()
      await confirm.getByRole('button', { name: 'Delete', exact: true }).click()
      await expect(row).toHaveCount(0)
    })

    await test.step('Save is refused naming the integer type; Fix All declares pause_ms again', async () => {
      const refusal = page.waitForResponse(
        (resp) =>
          resp.request().method() === 'PUT' && new URL(resp.url()).pathname === `/tests/${testId}`,
      )
      await saveBtn(page).click()
      const refused = await refusal
      expect(refused.status()).toBe(422)
      const details = (await refused.json()).error.details as Array<Record<string, unknown>>
      const undeclared = details.find(
        (d) => d.code === 'UNDECLARED_VARIABLE' && d.path === 'variables.pause_ms',
      )
      expect(undeclared?.fix_action).toBe('Add variable to manager (type: integer)')

      const dialog = page.locator(VALIDATION.dialog)
      await expect(dialog).toBeVisible()
      await expect(dialog).toContainText('Cannot Save Test')
      await expect(dialog.locator(VALIDATION.list)).toContainText("'pause_ms'")
      await dialog.locator(VALIDATION.fixAllBtn).click()
      await expect(dialog).toBeHidden()
    })

    await test.step('the declared row reads null in the null look with the integer type', async () => {
      await expect(rowValue(page, 'pause_ms')).toHaveText('null')
      await expectNullLook(rowValue(page, 'pause_ms').locator('span[translate="no"]'))
      await expectNotDimmed(variableRow(page, 'pause_ms'))
      await expect.soft(rowType(page, 'pause_ms'), 'Fix All keeps the inferred type').toHaveText('integer')
    })

    await test.step('the saved test declares it with no value and validates clean', async () => {
      await saveTest(page)
      const stored = await getTest(page.request, testId)
      expect(stored.variables.pause_ms.value ?? null, 'declared with no value').toBeNull()
      expect.soft(stored.variables.pause_ms.type, 'Fix All keeps the inferred type').toBe('integer')
      const validation = await validateTest(page.request, testId)
      expect(validation.errors).toEqual([])

      await reopen(page, testId)
      await expectNullLook(rowValue(page, 'pause_ms').locator('span[translate="no"]'))
    })
  })

  test('Fix All on opening a test declares the missing variable holding null', async ({
    page,
  }) => {
    const fixture = readFixture(__dirname, 'fixture-editors.json')
    const variables = { ...(fixture.variables as Record<string, unknown>) }
    delete variables.pause_ms
    const brokenId = await rawPersistTest(page.request, {
      name: `V-NULL-EDITORS missing ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      nodes: fixture.workflow.nodes,
      edges: fixture.workflow.edges,
      variables,
    })

    try {
      await test.step('opening the test lists the missing variable with its integer fix', async () => {
        await openTest(page, brokenId)
        const dialog = page.locator(VALIDATION.dialog)
        await expect(dialog).toBeVisible()
        await expect(dialog).toContainText('Test Issues Found')
        const list = dialog.locator(VALIDATION.list)
        await expect(list).toContainText("'pause_ms'")
        await expect(list).toContainText('Add variable to manager (type: integer)')
        await dialog.locator(VALIDATION.fixAllBtn).click()
        await expect(dialog).toBeHidden()
      })

      await test.step('the declared row reads null in the null look with the integer type', async () => {
        await expandVariableManager(page)
        await expect(rowType(page, 'pause_ms')).toHaveText('integer')
        await expect(rowValue(page, 'pause_ms')).toHaveText('null')
        await expectNullLook(rowValue(page, 'pause_ms').locator('span[translate="no"]'))
        await expectNotDimmed(variableRow(page, 'pause_ms'))
      })

      await test.step('the stored test declares it with no value and validates clean', async () => {
        const stored = await getTest(page.request, brokenId)
        expect(stored.variables.pause_ms.type).toBe('integer')
        expect(stored.variables.pause_ms.value ?? null, 'declared with no value').toBeNull()
        const validation = await validateTest(page.request, brokenId)
        expect(validation.errors).toEqual([])
      })
    } finally {
      await deleteTest(page.request, brokenId)
    }
  })
})
