/**
 * V-CTRL-FIELDS-CONDITIONS: the one condition row in If/Else, Switch, Assert, While, Wait Until and CSV filters
 * Design Decisions: FIELD-7, FIELD-13, FIELD-15, FIELD-16, FIELDERR-1, FIELDERR-2, CSV-12, CANVAS-230
 * REQ: REQ-3.5.1.1, REQ-3.5.1.5, REQ-3.5.1.11, REQ-3.5.1.17, REQ-3.5.1.20, REQ-3.5.4.3, REQ-3.4.1.12, REQ-3.1.1.5
 *
 * `fixture-conditions.json` chains If/Else `Route by health`, If/Else `Match host`, Switch `Pick region`, a split
 * Assert, a While whose body is a Setter and a Log, a Wait Until and a CSV Parser with two filter blocks; every path
 * ends in a Log that names it, and `Log done` closes the run.
 *
 * Pass Criteria:
 * 1. Typing `ready` into a text compare value and Save stores `reference_value: "ready"` and no flag.
 * 2. {x} on a filled value asks `Switch the field to an expression?` with Cancel / Clear / Clear & Empty; after
 *    Clear & Empty and `expected_status`, the item stores `reference_is_expression: true`.
 * 3. Expand on the `host equals` value opens the Edit value sheet; Template with `{{ prefix }}-1` stores
 *    `reference_is_template: true`, the box shows the Template face, and the run logs `route=template`.
 * 4. A number compare value has no expand; `500` stores as its typed text `"500"`.
 * 5. Changing a row holding a {x} value to `is null` asks the value-loss question first; after confirming, the
 *    value box goes and the stored item has no `reference_value`, `reference_is_expression` or `reference_is_template`.
 * 6. OR and groups are kept at Save and decide the run: the log holds `route=if`, `route=template`, `case=eu`,
 *    `assert=pass`, `while=1`, `while=2`, `while=3`, `wait=then`, and none of the other path lines; the Logs of the
 *    untaken If/Else and Assert branches never run, and those of the untaken Switch cases paint skipped.
 * 7. An expression row's expand and Ctrl+E open the editor titled `Edit Condition`; the compare value's {x} editor
 *    is `Edit Value`.
 * 8. Switch case, While and Wait Until rows are the same row: a {x} compare value in each, proven by `case=eu`, the
 *    three `while=` lines and `wait=then`.
 * 9. CSV filter rows: the {x} `min_id` value and the Template `{{ prefix }}` value; after the run `filtered` holds
 *    only the row with id `3`.
 * 10. Window errors: Add Assertion shows `Choose a variable.`; a blank text value shows `Value is required`; Save is
 *    held; the card mark shows.
 * 11. With the If/Else window open and untouched, renaming `region` in the Variable Manager reaches the open row and
 *    is no edit of the window (Save stays off); after a label edit, the window Save writes the new name.
 * 12. Every control window opens 880 px wide; the CSV Parser window opens 672 px. Outcome: the run passes.
 * 13. Every part of a condition row and a filter row is reachable by role and name: the combobox `Operator`, the
 *    textbox `Value` and the button `Value expression mode`.
 * 14. An As Integer filter block offers `_cell` typed `integer` when `_c` is typed in an expression row and in a
 *    compare value in {x}.
 */

import fs from 'fs'
import path from 'path'
import { test, expect, type APIRequestContext, type Locator, type Page } from '../../helpers/playwright-fixtures'
import { BACKEND_URL } from '../../helpers/config'
import { SUGGESTION_LIST } from '../../helpers/code-editor'
import {
  addLiteralRow,
  openConditionBody,
  operatorTrigger,
  pickConditionVariable,
  referenceToggle,
  type ConditionBlock,
} from '../../helpers/condition-builder'
import { settingsNote, saveButton } from '../../helpers/config-sheet'
import {
  getActiveSessionId,
  getSessionVariables,
  importValidateAndNavigate,
  sessionTable,
} from '../../helpers/fixture-import'
import { applyAndCloseValueSheet, replaceCode, valueSheet } from '../../helpers/fn-block'
import { expectNodeStatus, expectNodesSuccess, finishRun, startRun } from '../../helpers/k8s-run'
import { deleteTestQuietly, discardSheet, storedNode, typeNumber } from '../../helpers/number-rule'
import { switchWarning, switchWarningButtons, SWITCH_BODY, SWITCH_TO_EXPRESSION_TITLE } from '../../helpers/value-field'
import { expandVariableManager, variableRow } from '../../helpers/variable-create'
import { openBlockSheet, saveBlockSheet, saveTest } from '../../helpers/workbench'
import { renameVariable } from '../var-manager-panel/references-helpers'

const ROUTE = 'cf-if-route'
const MATCH = 'cf-if-template'
const SWITCH = 'cf-switch'
const ASSERT = 'cf-assert'
const WHILE = 'cf-while'
const SETTER = 'cf-set-counter'
const WAIT = 'cf-wait'
const CSV = 'cf-csv'

const TAKEN_LOGS = ['cf-log-if', 'cf-log-template', 'cf-log-eu', 'cf-log-pass', 'cf-log-while', 'cf-log-wait', 'cf-log-done']
// An If/Else and a split Assert paint nothing on a branch they did not take; a Switch paints its untaken cases skipped.
const UNTAKEN_BRANCH_LOGS = ['cf-log-slow', 'cf-log-fallback', 'cf-log-else', 'cf-log-fail']
const UNTAKEN_CASE_LOGS = ['cf-log-grouped', 'cf-log-default']

type Item = Record<string, any>

function loadFixture(n: number): Record<string, unknown> {
  const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixture-conditions.json'), 'utf-8'))
  fixture.name = `zz-ctrl-fields-conditions-${n}`
  return fixture
}

function itemIn(items: Item[], id: string): Item | undefined {
  for (const item of items) {
    if (item.id === id) return item
    const inner = item.type === 'group' ? itemIn(item.items as Item[], id) : undefined
    if (inner) return inner
  }
  return undefined
}

/** The item with `id` at any depth of a condition list. */
function findItem(items: Item[], id: string): Item {
  const item = itemIn(items, id)
  expect(item, `the condition item ${id} is stored`).toBeTruthy()
  return item as Item
}

async function storedValues(request: APIRequestContext, testId: string, nodeId: string): Promise<Item> {
  return (await storedNode(request, testId, nodeId)).data.config.values as Item
}

function branchItems(values: Item, branchId: string): Item[] {
  return (values.branches as Item[]).find((branch) => branch.id === branchId)?.conditions as Item[]
}

/** A compare value's box: the text or number box, or in {x} and Template the code box around `.cm-content`. */
function valueBox(body: Locator, rowPath: string): Locator {
  return body.locator(`[data-testid="param-input-assert-value-${rowPath}"]`)
}

/** The {x} or Template code box of a compare value. */
function codeBox(body: Locator, rowPath: string): Locator {
  return valueBox(body, rowPath).locator('.cm-content')
}

async function sheetWidth(sheet: Locator): Promise<number> {
  return Math.round((await sheet.boundingBox())?.width ?? 0)
}

/** Open a Block window and assert the width it opens at. */
async function openAt(page: Page, blockId: string, width: number): Promise<Locator> {
  const sheet = await openBlockSheet(page, blockId)
  await expect.poll(() => sheetWidth(sheet), { message: `${blockId} opens ${width} px wide` }).toBe(width)
  return sheet
}

/** The expression editor a click or Ctrl+E opened: its title, then Cancel. */
async function expectEditorTitle(page: Page, title: string): Promise<void> {
  const editor = page.locator('[data-testid="expression-editor-modal"]')
  await expect(editor).toBeVisible()
  await expect(editor.locator('h2').first()).toHaveText(title)
  await editor.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(editor).toHaveCount(0)
}

async function openCsvFilters(sheet: Locator): Promise<void> {
  const trigger = sheet.locator('[data-testid="csv-filters-section-trigger"]')
  if ((await trigger.getAttribute('data-state')) !== 'open') await trigger.click()
  await expect(trigger).toHaveAttribute('data-state', 'open')
}

/** Make a text compare value a Template through its Edit value sheet. */
async function setTemplate(page: Page, scope: Locator, stem: string, text: string): Promise<void> {
  await scope.locator(`[data-testid="param-expand-${stem}"]`).click()
  const editor = valueSheet(page)
  await expect(editor).toBeVisible()
  await expect(editor.getByRole('heading', { name: 'Edit value', exact: true })).toBeVisible()
  const kind = editor.getByTestId('kind-dropdown')
  await expect(kind).toHaveText('Literal')
  await kind.click()
  await page.getByRole('option', { name: 'Template', exact: true }).click()
  await expect(kind).toHaveText('Template')
  await replaceCode(page, editor.locator('.cm-content').first(), text)
  await applyAndCloseValueSheet(editor)
}

/** The completion list offers `_cell` typed `integer` after `_c` is typed into `code`. */
async function expectCellOffered(page: Page, code: Locator): Promise<void> {
  await code.click()
  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.press('Delete')
  await page.keyboard.type('_c')
  const list = page.locator(SUGGESTION_LIST)
  await expect(list).toBeVisible({ timeout: 5_000 })
  const option = list.locator('li').filter({ has: page.locator('.cm-completionLabel', { hasText: /^_cell$/ }) })
  await expect(option).toHaveCount(1)
  await expect(option.locator('.cm-completionDetail')).toHaveText('integer')
  await page.keyboard.press('Escape')
  await expect(list).toHaveCount(0)
}

test.describe('V-CTRL-FIELDS-CONDITIONS: the one condition row', () => {
  const created: string[] = []

  test.afterEach(async ({ request }) => {
    await request.delete(`${BACKEND_URL}/workbench/session/`).catch(() => undefined)
    for (const id of created.splice(0)) await deleteTestQuietly(request, id)
  })

  test('the windows store what each row is set to, and the run follows the stored rows', async ({ page, request }) => {
    test.setTimeout(480_000)
    const testId = await importValidateAndNavigate(page, loadFixture(1))
    created.push(testId)

    await test.step('8, 12. each control window opens 880 px wide, the CSV Parser 672 px; Switch, While and Wait Until hold a {x} compare value', async () => {
      const controls: Array<[string, ConditionBlock | null, string | undefined, string | null]> = [
        [ROUTE, null, undefined, null],
        [MATCH, null, undefined, null],
        [SWITCH, 'switch', 'case_eu', 'region_prefix'],
        [ASSERT, 'assert', undefined, 'expected_status'],
        [WHILE, 'while', undefined, 'limit'],
        [WAIT, 'wait-until', undefined, 'expected_status'],
        [SETTER, null, undefined, null],
      ]
      for (const [blockId, block, branch, expression] of controls) {
        const sheet = await openAt(page, blockId, 880)
        if (block !== null && expression !== null) {
          const body = await openConditionBody(sheet, block, branch)
          await expect(referenceToggle(body, '0'), `${blockId}: the compare value is {x}`).toHaveAttribute('aria-pressed', 'true')
          await expect(codeBox(body, '0')).toHaveText(expression)
        }
        await discardSheet(page, sheet)
      }
      const csv = await openAt(page, CSV, 672)
      await discardSheet(page, csv)
    })

    await test.step('10. a fresh row names the missing variable, then the missing value; Save is held and the card is marked', async () => {
      const sheet = await openBlockSheet(page, MATCH)
      const body = await openConditionBody(sheet, 'if-else', 'branch_tpl')
      await addLiteralRow(body)
      await expect(body.locator('[data-testid="assert-variable-error-2"]')).toHaveText('Choose a variable.')
      await expect(sheet.locator('[data-testid="branch-alert-branch_tpl"]')).toBeVisible()
      await expect(saveButton(sheet)).toBeDisabled()
      await expect(settingsNote(sheet)).toHaveText('Save is disabled: the settings have errors')
      await pickConditionVariable(page, body, '2', 'status')
      await expect(body.locator('[data-testid="assert-variable-error-2"]')).toHaveCount(0)
      await expect(body.locator('[data-testid="param-error-assert-value-2"]')).toHaveText('Value is required')
      await expect(saveButton(sheet)).toBeDisabled()
      await expect(sheet.locator('[data-testid="branch-alert-branch_tpl"]')).toBeVisible()
      await discardSheet(page, sheet)
    })

    await test.step('1-2. a typed text value stores no flag; {x} on a filled value asks first and Clear & Empty starts it at an empty text', async () => {
      const sheet = await openBlockSheet(page, ROUTE)
      const body = await openConditionBody(sheet, 'if-else', 'branch_healthy')
      await valueBox(body, '0').fill('ready')
      await expect(valueBox(body, '0')).toHaveValue('ready')

      await referenceToggle(body, '2').click()
      const dialog = switchWarning(page)
      await expect(dialog).toBeVisible()
      await expect(dialog.getByRole('heading', { name: SWITCH_TO_EXPRESSION_TITLE, exact: true })).toBeVisible()
      await expect(dialog).toContainText(SWITCH_BODY)
      await expect(switchWarningButtons(dialog)).toHaveText(['Cancel', 'Clear', 'Clear & Empty'])
      await dialog.getByRole('button', { name: 'Clear & Empty', exact: true }).click()
      await expect(dialog).toHaveCount(0)
      await expect(referenceToggle(body, '2')).toHaveAttribute('aria-pressed', 'true')
      await expect(codeBox(body, '2')).toHaveText("''")
      await replaceCode(page, codeBox(body, '2'), 'expected_status')
      await saveBlockSheet(sheet)
      await saveTest(page)

      const items = branchItems(await storedValues(request, testId, ROUTE), 'branch_healthy')
      expect(findItem(items, 'cond-healthy-status')).toEqual({
        id: 'cond-healthy-status',
        type: 'literal',
        variable: 'status',
        value_type: 'string',
        operator: 'equals',
        reference_value: 'ready',
      })
      const expected = findItem(items, 'cond-healthy-expected')
      expect(expected).toMatchObject({ reference_value: 'expected_status', reference_is_expression: true })
      expect(expected.reference_is_template ?? false).toBe(false)
    })

    await test.step('7. the expression row opens Edit Condition from expand and Ctrl+E; the {x} compare value opens Edit Value', async () => {
      const sheet = await openBlockSheet(page, ROUTE)
      const slow = await openConditionBody(sheet, 'if-else', 'branch_slow')
      await slow.locator('[data-testid="param-expand-assert-expr-4"]').click()
      await expectEditorTitle(page, 'Edit Condition')
      await slow.locator('[data-testid="param-input-assert-expr-4"] .cm-content').click()
      await page.keyboard.press('Control+e')
      await expectEditorTitle(page, 'Edit Condition')

      const healthy = await openConditionBody(sheet, 'if-else', 'branch_healthy')
      await healthy.locator('[data-testid="param-expand-assert-value-2"]').click()
      await expectEditorTitle(page, 'Edit Value')
      await codeBox(healthy, '2').click()
      await page.keyboard.press('Control+e')
      await expectEditorTitle(page, 'Edit Value')
      await discardSheet(page, sheet)
    })

    await test.step('4-5. a number compare value has no expand and stores 500 as typed; is null on a {x} row asks first and drops the value', async () => {
      const sheet = await openBlockSheet(page, ROUTE)
      const slow = await openConditionBody(sheet, 'if-else', 'branch_slow')
      await expect(slow.locator('[data-testid="param-expand-assert-value-0"]'), 'a number compare value has no expand').toHaveCount(0)
      await expect(slow.locator('[data-testid="param-expand-assert-value-2-2"]'), 'a text compare value has one').toHaveCount(1)
      await typeNumber(page, valueBox(slow, '0'), '500')

      const healthy = await openConditionBody(sheet, 'if-else', 'branch_healthy')
      const operator = operatorTrigger(healthy, '2')
      await operator.click()
      await page.getByRole('option', { name: 'is null', exact: true }).click()
      const question = page.getByRole('alertdialog').filter({ hasText: 'Change operator?' })
      await expect(question).toBeVisible()
      await expect(question).toContainText(
        'Changing operator to is null will clear 1 existing string value. This cannot be undone.',
      )
      await expect(operator, 'nothing changes before the answer').toHaveText('equals')
      await question.getByRole('button', { name: 'Change operator', exact: true }).click()
      await expect(question).toHaveCount(0)
      await expect(operator).toHaveText('is null')
      await expect(valueBox(healthy, '2')).toHaveCount(0)
      await expect(referenceToggle(healthy, '2')).toHaveCount(0)
      await saveBlockSheet(sheet)
      await saveTest(page)

      const values = await storedValues(request, testId, ROUTE)
      const latency = findItem(branchItems(values, 'branch_slow'), 'cond-slow-latency')
      expect(latency.reference_value).toBe('500')
      expect(findItem(branchItems(values, 'branch_healthy'), 'cond-healthy-expected')).toEqual({
        id: 'cond-healthy-expected',
        type: 'literal',
        variable: 'status',
        value_type: 'string',
        operator: 'is_null',
      })
    })

    await test.step('3. expand opens the Edit value sheet; a Template stores its flag and shows the Template face', async () => {
      const sheet = await openBlockSheet(page, MATCH)
      const body = await openConditionBody(sheet, 'if-else', 'branch_tpl')
      await setTemplate(page, body, 'assert-value-0', '{{ prefix }}-1')
      await expect(codeBox(body, '0'), 'the box shows the Template face').toHaveText('{{ prefix }}-1')
      await expect(referenceToggle(body, '0')).toHaveAttribute('aria-pressed', 'false')
      await saveBlockSheet(sheet)
      await saveTest(page)

      const item = findItem(branchItems(await storedValues(request, testId, MATCH), 'branch_tpl'), 'cond-tpl-host')
      expect(item).toMatchObject({ variable: 'host', operator: 'equals', reference_value: '{{ prefix }}-1', reference_is_template: true })
      expect(item.reference_is_expression ?? false).toBe(false)
    })

    await test.step('9. the CSV filter rows take a {x} min_id and a Template {{ prefix }}', async () => {
      const sheet = await openBlockSheet(page, CSV)
      await openCsvFilters(sheet)
      const idBlock = sheet.locator('[data-testid="filter-block-flt-id"]')
      await idBlock.locator('[data-testid="filter-condition-expr-toggle-flt-id-cond"]').click()
      const dialog = switchWarning(page)
      await expect(dialog).toBeVisible()
      await expect(switchWarningButtons(dialog), 'a number has no empty value to start from').toHaveText(['Cancel', 'Clear'])
      await dialog.getByRole('button', { name: 'Clear', exact: true }).click()
      await expect(dialog).toHaveCount(0)
      await replaceCode(page, idBlock.locator('[data-testid="param-input-filter-condition-value-flt-id-cond"] .cm-content'), 'min_id')

      const nameBlock = sheet.locator('[data-testid="filter-block-flt-name"]')
      await setTemplate(page, nameBlock, 'filter-condition-value-flt-name-cond', '{{ prefix }}')
      await expect(nameBlock.locator('[data-testid="param-input-filter-condition-value-flt-name-cond"] .cm-content')).toHaveText(
        '{{ prefix }}',
      )
      await saveBlockSheet(sheet)
      await saveTest(page)

      const filters = (await storedValues(request, testId, CSV)).filters as Item[]
      const byId = (id: string) => (filters.find((filter) => filter.id === id)?.conditions as Item[])[0]
      expect(byId('flt-id')).toMatchObject({ variable: '_cell', value_type: 'integer', reference_value: 'min_id', reference_is_expression: true })
      expect(byId('flt-name')).toMatchObject({ variable: '_cell', value_type: 'string', reference_value: '{{ prefix }}', reference_is_template: true })
    })

    await test.step('11. a rename in the Variable Manager reaches the untouched open window, and its Save writes the new name', async () => {
      const sheet = await openBlockSheet(page, ROUTE)
      const slow = await openConditionBody(sheet, 'if-else', 'branch_slow')
      const regionBox = slow.locator('[data-testid="assert-variable-2-2"]')
      await expect(regionBox).toHaveValue('region')
      await expandVariableManager(page)
      await expect(variableRow(page, 'region')).toBeVisible()
      await renameVariable(page, 'region', 'aws_region')
      await expect(regionBox, 'the open row follows the rename').toHaveValue('aws_region')
      await expect(saveButton(sheet), 'the canvas change is not an edit of the window').toBeDisabled()
      const label = sheet.locator('[data-testid="branch-label-branch_slow"]')
      await label.fill('Slow path')
      await expect(label).toHaveValue('Slow path')
      await saveBlockSheet(sheet)
      await saveTest(page)

      const route = await storedValues(request, testId, ROUTE)
      expect((route.branches as Item[]).find((branch) => branch.id === 'branch_slow')?.label).toBe('Slow path')
      expect(findItem(branchItems(route, 'branch_slow'), 'cond-slow-region').variable).toBe('aws_region')
      const cases = await storedValues(request, testId, SWITCH)
      expect(findItem(branchItems(cases, 'case_eu'), 'cond-eu-region').variable).toBe('aws_region')
      expect(findItem(branchItems(cases, 'case_grouped'), 'cond-grouped-region').variable).toBe('aws_region')
    })

    await test.step('6. OR and the groups are stored as built', async () => {
      const route = await storedValues(request, testId, ROUTE)
      expect(branchItems(route, 'branch_healthy')[1]).toEqual({ type: 'operator', value: 'or' })
      const slowGroup = findItem(branchItems(route, 'branch_slow'), 'grp-slow')
      expect((slowGroup.items as Item[]).map((item) => item.id ?? item.value)).toEqual(['cond-slow-retries', 'or', 'cond-slow-region'])
      const grouped = findItem(branchItems(await storedValues(request, testId, SWITCH), 'case_grouped'), 'grp-grouped')
      expect((grouped.items as Item[]).map((item) => item.id ?? item.value)).toEqual(['cond-grouped-region', 'or', 'cond-grouped-host'])
    })

    const status = await startRun(page)
    const logs = await finishRun(page, status, 'conditions-done')

    await test.step('3, 6, 8. the run takes the paths the stored rows decide', async () => {
      for (const line of ['route=if', 'route=template', 'case=eu', 'assert=pass', 'wait=then', 'conditions-done']) {
        expect(logs, `the log holds ${line}`).toContain(line)
      }
      expect(logs.filter((line) => line.startsWith('while='))).toEqual(['while=1', 'while=2', 'while=3'])
      for (const line of ['route=slow', 'route=fallback', 'route=else', 'case=grouped', 'case=default', 'assert=fail']) {
        expect(logs, `the log holds no ${line}`).not.toContain(line)
      }
      await expectNodesSuccess(page, [ROUTE, MATCH, SWITCH, ASSERT, WHILE, SETTER, WAIT, CSV, ...TAKEN_LOGS])
      for (const id of UNTAKEN_BRANCH_LOGS) {
        await expect(page.locator(`[data-testid="workflow-node-${id}"]`), `${id} never ran`).not.toHaveAttribute('data-execution-status')
      }
      for (const id of UNTAKEN_CASE_LOGS) await expectNodeStatus(page, id, 'skipped')
    })

    await test.step('9. the filters keep only the row with id 3', async () => {
      const table = sessionTable(await getSessionVariables(page, await getActiveSessionId(page)), 'filtered')
      expect(table.rows.map((row) => row.map(String))).toEqual([['3', 'web-3']])
    })
  })

  test('every part of a condition row and a filter row is reachable by its role and name', async ({ page }) => {
    test.setTimeout(180_000)
    created.push(await importValidateAndNavigate(page, loadFixture(2)))

    await test.step('13. an If/Else row: Operator, Value and Value expression mode', async () => {
      const sheet = await openBlockSheet(page, MATCH)
      const body = await openConditionBody(sheet, 'if-else', 'branch_tpl')
      const row = body.locator('[data-testid="assert-row-0"]')
      await expectRowByRole(page, row, 'contains')
      await discardSheet(page, sheet)
    })

    await test.step('13. a CSV filter row: Operator, Value and Value expression mode', async () => {
      const sheet = await openBlockSheet(page, CSV)
      await openCsvFilters(sheet)
      await expectRowByRole(page, sheet.locator('[data-testid="filter-block-flt-name"]'), 'ends with')
      await discardSheet(page, sheet)
    })
  })

  test('an As Integer filter block offers _cell in an expression row and in a {x} compare value', async ({ page }) => {
    test.setTimeout(180_000)
    created.push(await importValidateAndNavigate(page, loadFixture(3)))
    const sheet = await openBlockSheet(page, CSV)
    await openCsvFilters(sheet)
    const block = sheet.locator('[data-testid="filter-block-flt-id"]')

    await test.step('14. an expression row offers _cell typed integer', async () => {
      await block.locator('[data-testid="filter-add-expression-flt-id"]').click()
      const code = block.locator('[data-testid^="param-input-filter-condition-expr-"] .cm-content')
      await expect(code).toHaveCount(1)
      await expectCellOffered(page, code)
    })

    await test.step('14. a compare value in {x} offers _cell typed integer', async () => {
      await block.locator('[data-testid="filter-condition-expr-toggle-flt-id-cond"]').click()
      const dialog = switchWarning(page)
      await expect(dialog).toBeVisible()
      await dialog.getByRole('button', { name: 'Clear', exact: true }).click()
      await expect(dialog).toHaveCount(0)
      await expectCellOffered(page, block.locator('[data-testid="param-input-filter-condition-value-flt-id-cond"] .cm-content'))
    })
    await discardSheet(page, sheet)
  })
})

/** Drive one row by role and name only: pick an operator, type a value, then press {x} and clear it. */
async function expectRowByRole(page: Page, row: Locator, operatorLabel: string): Promise<void> {
  const operator = row.getByRole('combobox', { name: 'Operator', exact: true })
  const value = row.getByRole('textbox', { name: 'Value', exact: true })
  const toggle = row.getByRole('button', { name: 'Value expression mode', exact: true })
  await expect(operator).toHaveCount(1)
  await expect(value).toHaveCount(1)
  await expect(toggle).toHaveCount(1)

  await operator.click()
  await page.getByRole('option', { name: operatorLabel, exact: true }).click()
  await expect(operator).toHaveText(operatorLabel)
  await value.fill('web')
  await expect(value).toHaveValue('web')
  await expect(toggle).toHaveAttribute('aria-pressed', 'false')
  await toggle.click()
  const dialog = switchWarning(page)
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: 'Clear', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  await expect(toggle).toHaveAttribute('aria-pressed', 'true')
  await expect(row.getByRole('textbox', { name: 'Value', exact: true }), 'the {x} code box keeps the name').toHaveClass(/cm-content/)
}
