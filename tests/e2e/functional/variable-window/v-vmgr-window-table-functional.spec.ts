/**
 * V-VMGR-WINDOW-TABLE: lists, maps, tables and long strings in the variable window and the "Edit value" window
 * Design Decisions: VMGR-106, VMGR-110, VMGR-70, VMGR-71, VMGR-82
 * REQ: REQ-3.5.5.1, REQ-3.5.5.4, REQ-3.1.3.19, REQ-3.1.3.14, REQ-3.1.3.1, REQ-3.1.3.11
 *
 * Setup (API): one blank `v-vmgr-window-` Test per test (`POST /tests`, zero validation errors), the shared
 * execution environment, and for the entity test one Suite, one Regression and one System variable, all
 * removed after. Every value is typed through the UI; the probe Log is built through the UI.
 *
 * Pass Criteria:
 * 1. A table typed in the window's one-line field, one typed in the "Edit value" window's Code view, and a
 *    saved table edited in the Edit window's "Edit value" Visual grid are stored with their column types
 *    (`zip` string, `n` integer); the run reads `zip` as `02134` (not 2134) and `n + 1` as 8. A type change
 *    on the saved table asks first and counts its row (`1 existing table entry`); Cancel keeps it.
 * 2. In the window a list, map or table value is one line with an Open editor button; Open editor shows the
 *    "Edit value" window with Visual / Code and Format; its Save writes the value back into the one line.
 * 3. A wrong cell type or an extra column typed in the one-line field shows the problem strip, `(+1 more)`
 *    lists every problem, and Create is held until the text is fixed.
 * 4. A map and a list typed in Code, then reshaped in Visual (rename, remove, add, move), are stored exactly
 *    as shown with every element type, and the run reads each element as its type.
 * 5. A String Literal is a one-line field holding the full value; Open editor shows it, offers the string
 *    format view (`Auto (JSON)`) and Format, and keeps the line breaks Format adds; the window shows the
 *    first line cut with "…"; the saved value keeps its line breaks and reopens on seven lines.
 * 6. A Variable Setter table row saved through the "Edit value" window is stored with its column types,
 *    its row reads `1 rows x 2 col`, and the run reads the set table with its types.
 * 7. A Suite, a Regression and a System table saved through their own value cells are stored with their
 *    column types and their rows read `1 rows x 2 col`; each editor reopens it with no refusal, shows the
 *    column types and saves a cell edit; a Test in the Suite reads each one with its types.
 */

import { randomUUID } from 'node:crypto'
import { test, expect, type APIRequestContext, type Locator, type Page } from '../../helpers/playwright-fixtures'
import { BACKEND_URL, ensureEnvironment } from '../../helpers/config'
import {
  createEntity,
  entityValueCell,
  entityVariableRow,
  newEntityVariableRow,
  openEntityValue,
  openEntityVariables,
  openSystemVariables,
  openSystemVariablesOnNewRow,
  saveVariablesDialog,
  setEntityRowType,
} from '../../helpers/entity-variables'
import {
  expectListRows,
  expectMapRows,
  pickElementType,
  runToken,
  type ListRow,
  type MapRow,
} from '../../helpers/element-types'
import { createValidTest, logNode, openTest, startEdge, validateTest } from '../../helpers/fn-seed'
import { expectConsoleLine, formatEntries } from '../../helpers/log-reader'
import { valueEditorSheet } from '../../helpers/param-config'
import {
  answerChangeConfirm,
  cancelWindow,
  closeValueEditor,
  expandVariableManager,
  expectWindowValue,
  formatValueEditor,
  openCreateModal,
  openEditWindow,
  openValueEditor,
  replaceValueEditorCode,
  saveValueEditor,
  saveWindow,
  setCreateName,
  setCreateType,
  setValueEditorView,
  setWindowValue,
  valueEditorCode,
  valueField,
  variableRow,
  windowSaveButton,
} from '../../helpers/variable-create'
import {
  dropBelowStart,
  openBlockSheet,
  runToEnd,
  saveBlockSheet,
  saveTest,
  selectEnvironment,
  setBlockExpression,
} from '../../helpers/workbench'

const TABLE_TEXT = '[{"zip": "02134", "n": 7}]'
const TYPED_COLUMNS = [
  { name: 'zip', type: 'string' },
  { name: 'n', type: 'integer' },
]
const OLD_TABLE_REFUSAL = 'Must be a JSON array of objects'
/** The Edit-value button's summary of a one-row, two-column table. */
const TABLE_PREVIEW = '1 rows x 2 col'

const MAP_CODE = '{"zip": "02134", "n": 16, "f": 2.5, "on": true}'
const MAP_TYPED: readonly MapRow[] = [
  { key: 'zip', text: '02134', type: 'string' },
  { key: 'n', text: '16', type: 'integer' },
  { key: 'f', text: '2.5', type: 'float' },
  { key: 'on', text: 'true', type: 'boolean' },
]
const MAP_RESHAPED: readonly MapRow[] = [
  { key: 'zip', text: '02134', type: 'string' },
  { key: 'count', text: '16', type: 'integer' },
  { key: 'f', text: '2.5', type: 'float' },
  { key: 'z2', text: '007', type: 'string' },
]
const LIST_CODE = '["02134", 7, 2.5, true]'
const LIST_TYPED: readonly ListRow[] = [
  { text: '02134', type: 'string' },
  { text: '7', type: 'integer' },
  { text: '2.5', type: 'float' },
  { text: 'true', type: 'boolean' },
]
const LIST_RESHAPED: readonly ListRow[] = [
  { text: '2.5', type: 'float' },
  { text: '7', type: 'integer' },
  { text: 'true', type: 'boolean' },
  { text: '42', type: 'integer' },
]

const LONG_TEXT = `select-${'abcdefghij'.repeat(30)}`
const COMPACT_JSON = '{"host":"db.example","ports":[5432,5433]}'
const PRETTY_JSON = '{\n  "host": "db.example",\n  "ports": [\n    5432,\n    5433\n  ]\n}'

type Rec = Record<string, any>

function uniqueName(label: string): string {
  return `v-vmgr-window-${label}-${runToken()}`
}

/** A stored table carries its column types and the typed cells (REQ-3.5.5.4). */
function expectTypedTable(value: unknown, what: string): void {
  const table = (value ?? {}) as { columns?: unknown; rows?: unknown[][] }
  expect(table.columns, `${what} keeps its column types`).toEqual(TYPED_COLUMNS)
  expect(table.rows, `${what} keeps its one row`).toHaveLength(1)
  expect(table.rows?.[0]?.[0], `${what} keeps the zip text`).toBe('02134')
  expect(String(table.rows?.[0]?.[1]), `${what} keeps the n cell`).toBe('7')
}

/** An f-string part that reads the table `ref` the way only its column types allow. */
function tableProbe(tag: string, ref: string): string {
  return `${tag} zip={${ref}[0]['zip']} n={${ref}[0]['n'] + 1} types={${ref}.col_types()[0]},{${ref}.col_types()[1]}`
}

function tableProbeLine(tag: string): string {
  return `${tag} zip=02134 n=8 types=string,integer`
}

/** A Variable Setter Block that sets the table `name` (empty until a row is typed). */
function setterNode(id: string, name: string): Rec {
  return {
    id,
    type: 'workflowNode',
    position: { x: 320, y: 140 },
    data: {
      label: 'Var Setter',
      elementType: 'variable-setter',
      nodeType: 'control',
      category: 'flow',
      version: '1.0.0',
      description: 'Set a table',
      hasNewerVersion: false,
      expressionFields: [],
      templateFields: [],
      variableExpressionKeys: [],
      variableTypes: { [name]: 'table' },
      config: { values: { variables: { [name]: [] } }, outputBindings: {}, profileBindings: [] },
    },
    measured: { width: 120, height: 62 },
  }
}

/** The one-line text box of a window's value field. */
function lineInput(win: Locator): Locator {
  return valueField(win).locator('input')
}

async function seedBlankTest(request: APIRequestContext, label: string, variables: Rec = {}): Promise<string> {
  const id = await createValidTest(request, { name: uniqueName(label), nodes: [], variables })
  const validation = await validateTest(request, id)
  expect(validation.errors, `the seed validates clean: ${JSON.stringify(validation.errors)}`).toEqual([])
  return id
}

async function readData(request: APIRequestContext, path: string): Promise<Rec> {
  const resp = await request.get(`${BACKEND_URL}${path}`)
  expect(resp.ok(), `GET ${path}: ${resp.status()}`).toBeTruthy()
  return (await resp.json()).data as Rec
}

/** Open a row's value sheet; the stored typed table is never refused there. */
async function openTableValue(page: Page, dialog: Locator, name: string): Promise<Locator> {
  const row = await entityVariableRow(dialog, name)
  await expect(row.getByText(OLD_TABLE_REFUSAL, { exact: true }), `the ${name} row is not refused`).toHaveCount(0)
  return openEntityValue(page, row)
}

/** First save: the table typed in Code with a placeholder zip. */
async function typeEntityTable(page: Page, dialog: Locator, name: string): Promise<void> {
  const sheet = await openTableValue(page, dialog, name)
  await setValueEditorView(page, sheet, 'Code')
  await replaceValueEditorCode(page, sheet, '[{"zip": "00000", "n": 7}]')
  await saveValueEditor(sheet)
  await closeValueEditor(page, sheet)
  const preview = entityValueCell(await entityVariableRow(dialog, name))
  await expect.soft(preview, `the ${name} row summarizes the saved table`).toContainText(TABLE_PREVIEW)
  await saveVariablesDialog(dialog)
}

/** Reopen the editor on the stored typed table: no refusal, the grid shows the column types, a cell edit saves. */
async function editStoredEntityTable(page: Page, dialog: Locator, name: string): Promise<void> {
  const sheet = await openTableValue(page, dialog, name)
  await expect(sheet.locator('[data-testid="table-type-0"]')).toHaveText('string')
  await expect(sheet.locator('[data-testid="table-type-1"]')).toHaveText('integer')
  await expect(sheet.locator('[data-testid="table-cell-0-0"]')).toHaveValue('00000')
  await sheet.locator('[data-testid="table-cell-0-0"]').fill('02134')
  await saveValueEditor(sheet)
  await closeValueEditor(page, sheet)
  await expect(dialog.getByText(OLD_TABLE_REFUSAL, { exact: true })).toHaveCount(0)
  await saveVariablesDialog(dialog)
}

test.describe('V-VMGR-WINDOW-TABLE: values edited in the window and the "Edit value" window', () => {
  let testId = ''
  let suiteId = ''
  let regressionId = ''
  let systemName = ''

  test.beforeAll(async ({ request }) => {
    await ensureEnvironment(request)
  })

  test.afterEach(async ({ request }) => {
    await request.delete(`${BACKEND_URL}/workbench/session/`).catch(() => undefined)
    if (testId) await request.delete(`${BACKEND_URL}/tests/${testId}`).catch(() => undefined)
    if (regressionId) await request.delete(`${BACKEND_URL}/regressions/${regressionId}`).catch(() => undefined)
    if (suiteId) await request.delete(`${BACKEND_URL}/suites/${suiteId}`).catch(() => undefined)
    if (systemName) await request.delete(`${BACKEND_URL}/variables/system/${systemName}`).catch(() => undefined)
    testId = ''
    suiteId = ''
    regressionId = ''
    systemName = ''
  })

  test('tables, maps and lists typed in the window or the "Edit value" window keep their types into a run', async ({
    page,
    request,
  }) => {
    test.setTimeout(300_000)
    testId = await seedBlankTest(request, 'tables', {
      tedit: { type: 'table', value: { columns: TYPED_COLUMNS, rows: [['11111', '1']] } },
    })
    await openTest(page, testId)
    await expandVariableManager(page)

    await test.step('VMGR-110: a table typed in the one-line field; a wrong cell or column holds Create', async () => {
      const win = await openCreateModal(page)
      await setCreateName(page, 'tline', win)
      await setCreateType(page, 'table', win)
      await expect(lineInput(win), 'a new table is one line').toHaveValue('[]')
      await expect(valueField(win).getByRole('button', { name: 'Open editor', exact: true })).toBeVisible()

      await setWindowValue(page, win, '[{"zip": "02134", "n": 7}, {"zip": "02139", "n": "x"}]')
      const strip = win.locator('[data-testid="create-validation"]')
      await expect(strip).toHaveText('Row 1 "n": expected integer')
      await expect(windowSaveButton(win), 'a wrong cell holds Create').toBeDisabled()

      await setWindowValue(page, win, '[{"zip": "02134", "n": 7}, {"zip": "02139", "n": "x", "extra": 1}]')
      await expect(win.locator('[data-testid="create-validation-more"]')).toHaveText('(+1 more)')
      await win.locator('[data-testid="create-validation-more"]').click()
      const list = page.locator('[data-testid="create-validation-more-list"]')
      for (const message of [
        'Unexpected column "extra" - change columns in the Visual view',
        'Row 1 "n": expected integer',
      ]) {
        await expect(list.getByText(message, { exact: true }), `the list names: ${message}`).toBeVisible()
      }
      await page.keyboard.press('Escape')
      await expect(list).toBeHidden()
      await expect(windowSaveButton(win)).toBeDisabled()

      await setWindowValue(page, win, TABLE_TEXT)
      await expect(strip).toHaveCount(0)
      await saveWindow(page, win)
      await expect(variableRow(page, 'tline')).toBeVisible()
    })

    await test.step('VMGR-110: a table typed in the "Edit value" window\'s Code view; its Save fills the one line', async () => {
      const win = await openCreateModal(page)
      await setCreateName(page, 'tsheet', win)
      await setCreateType(page, 'table', win)
      const sheet = await openValueEditor(page, win)
      await expect(sheet).toHaveAttribute('aria-label', 'Edit value')
      await expect(sheet.locator('[data-testid="view-dropdown"]'), 'the sheet opens on Visual').toHaveText('Visual')
      await expect(sheet.locator('[data-testid="table-edit-body"]')).toBeVisible()
      await setValueEditorView(page, sheet, 'Code')
      await replaceValueEditorCode(page, sheet, '[{"zip":"02134","n":7}]')
      await formatValueEditor(sheet)
      await expect(valueEditorCode(sheet).locator('.cm-line'), 'Format lays the rows out').toHaveCount(6)
      await saveValueEditor(sheet)
      await expect(lineInput(win), 'the sheet Save writes the value back').toHaveValue(TABLE_TEXT)
      await closeValueEditor(page, sheet)
      await saveWindow(page, win)
      await expect(variableRow(page, 'tsheet')).toBeVisible()
    })

    await test.step('VMGR-106: a saved table edited in the Edit window\'s "Edit value" Visual grid', async () => {
      const win = await openEditWindow(page, 'tedit')
      await expect(win).toHaveAttribute('aria-label', 'Edit variable')
      await expectWindowValue(win, '[{"zip": "11111", "n": 1}]')
      // VMGR-108: a type change on the saved table asks first and counts its row.
      await setCreateType(page, 'map', win)
      const confirm = page.getByRole('alertdialog').filter({ hasText: 'Change variable type?' })
      await expect
        .soft(confirm, 'the confirm counts the saved row')
        .toContainText('Changing type to map will clear 1 existing table entry. This cannot be undone.')
      await answerChangeConfirm(page, 'Cancel')
      await expectWindowValue(win, '[{"zip": "11111", "n": 1}]')
      const sheet = await openValueEditor(page, win)
      await expect(sheet.locator('[data-testid="table-type-0"]')).toHaveText('string')
      await expect(sheet.locator('[data-testid="table-type-1"]')).toHaveText('integer')
      await sheet.locator('[data-testid="table-cell-0-0"]').fill('02134')
      await sheet.locator('[data-testid="table-cell-0-1"]').fill('7')
      await saveValueEditor(sheet)
      await expectWindowValue(win, TABLE_TEXT)
      await closeValueEditor(page, sheet)
      await saveWindow(page, win)
    })

    await test.step('VMGR-82: a map typed in Code, then renamed, removed and added to in Visual', async () => {
      const win = await openCreateModal(page)
      await setCreateName(page, 'm', win)
      await setCreateType(page, 'map', win)
      await expect(valueField(win).getByRole('button', { name: 'Open editor', exact: true })).toBeVisible()
      const sheet = await openValueEditor(page, win)
      await setValueEditorView(page, sheet, 'Code')
      await expect(sheet.locator('[data-testid="value-editor-format-button"]'), 'Code offers Format').toBeVisible()
      await replaceValueEditorCode(page, sheet, MAP_CODE)
      await setValueEditorView(page, sheet, 'Visual')
      await expectMapRows(sheet, MAP_TYPED)
      await sheet.locator('[data-testid="map-edit-key-1"]').fill('count')
      await sheet.locator('[data-testid="map-remove-3"]').click()
      await sheet.locator('[data-testid="map-add-entry"]').click()
      await sheet.locator('[data-testid="map-edit-key-3"]').fill('z2')
      await sheet.locator('[data-testid="map-edit-value-3"]').fill('007')
      await expectMapRows(sheet, MAP_RESHAPED)
      await saveValueEditor(sheet)
      await expect(lineInput(win)).toHaveValue('{"zip": "02134", "count": 16, "f": 2.5, "z2": "007"}')
      await closeValueEditor(page, sheet)
      await saveWindow(page, win)
    })

    await test.step('VMGR-82: a list typed in Code, then moved, removed and added to in Visual', async () => {
      const win = await openCreateModal(page)
      await setCreateName(page, 'a', win)
      await setCreateType(page, 'array', win)
      const sheet = await openValueEditor(page, win)
      await setValueEditorView(page, sheet, 'Code')
      await replaceValueEditorCode(page, sheet, LIST_CODE)
      await setValueEditorView(page, sheet, 'Visual')
      await expectListRows(sheet, LIST_TYPED)
      await sheet.locator('[data-testid="array-move-up-2"]').click()
      await sheet.locator('[data-testid="array-remove-0"]').click()
      await sheet.locator('[data-testid="array-add-item"]').click()
      // Per FIELD-7: a type change on an entry holding a value asks first, so the new item takes its type, then its text.
      await pickElementType(page, sheet.locator('[data-testid="array-type-3"]'), 'integer')
      await sheet.locator('[data-testid="array-edit-input-3"]').fill('42')
      await expectListRows(sheet, LIST_RESHAPED)
      await saveValueEditor(sheet)
      await expect(lineInput(win)).toHaveValue('[2.5, 7, true, 42]')
      await closeValueEditor(page, sheet)
      await saveWindow(page, win)
    })

    await test.step('REQ-3.5.5.4: the saved Test stores every value exactly, with its types', async () => {
      const logId = await dropBelowStart(page, 'log')
      const probe = [
        tableProbe('TLINE', 'tline'),
        tableProbe('TSHEET', 'tsheet'),
        tableProbe('TEDIT', 'tedit'),
        "MAP zip={m['zip'] + '-x'} count={m['count'] + 1} f={m['f'] * 2} z2={m['z2'] + 'x'}",
        'LIST a0={a[0] * 2} a1={a[1] + 1} a2={not a[2]} a3={a[3] + 1}',
      ].join(' | ')
      await setBlockExpression(page, logId, 'message', `f"${probe}"`)
      await saveTest(page)

      const stored = await readData(request, `/tests/${testId}`)
      for (const name of ['tline', 'tsheet', 'tedit']) expectTypedTable(stored.variables[name].value, name)
      expect(stored.variables.m.value).toEqual({ zip: '02134', count: '16', f: '2.5', z2: '007' })
      expect(stored.variables.m.elementTypes).toEqual({ zip: 'string', count: 'integer', f: 'float', z2: 'string' })
      expect(stored.variables.a.value).toEqual(['2.5', '7', true, '42'])
      expect(stored.variables.a.elementTypes).toEqual(['float', 'integer', 'boolean', 'integer'])
      const validation = await validateTest(request, testId)
      expect(validation.errors, JSON.stringify(validation.errors)).toEqual([])
    })

    await test.step('REQ-3.5.5.1: the run reads `zip` as 02134 and every element as its type', async () => {
      await selectEnvironment(page)
      const { verdict, entries } = await runToEnd(page)
      expectConsoleLine(
        entries,
        'INFO',
        [
          tableProbeLine('TLINE'),
          tableProbeLine('TSHEET'),
          tableProbeLine('TEDIT'),
          'MAP zip=02134-x count=17 f=5.0 z2=007x',
          'LIST a0=5.0 a1=8 a2=False a3=43',
        ].join(' | '),
      )
      expect(verdict, `the run passes.\n${formatEntries(entries)}`).toBe('passed')
    })
  })

  test('a long String is one line in the window and keeps its line breaks through the "Edit value" window', async ({
    page,
    request,
  }) => {
    test.setTimeout(180_000)
    testId = await seedBlankTest(request, 'string')
    await openTest(page, testId)
    await expandVariableManager(page)

    await test.step('VMGR-110: the one-line field holds the whole long value', async () => {
      const win = await openCreateModal(page)
      await setCreateName(page, 's_text', win)
      await setWindowValue(page, win, LONG_TEXT)
      await expect(lineInput(win)).toHaveValue(LONG_TEXT)

      const sheet = await openValueEditor(page, win)
      await expect(sheet).toHaveAttribute('aria-label', 'Edit value')
      await expect(valueEditorCode(sheet)).toHaveText(LONG_TEXT)
      await replaceValueEditorCode(page, sheet, COMPACT_JSON)
      await expect(sheet.locator('[data-testid="format-dropdown"]'), 'the string format view is offered').toHaveText(
        'Auto (JSON)',
      )
      await formatValueEditor(sheet)
      await expect(valueEditorCode(sheet).locator('.cm-line'), 'Format adds the line breaks').toHaveCount(7)
      await saveValueEditor(sheet)
      await expect(lineInput(win), 'the window shows the first line cut').toHaveValue('{…')
      await expect(lineInput(win), 'a value with line breaks is changed in the larger editor').toHaveAttribute(
        'readonly',
        '',
      )
      await expect(lineInput(win)).toHaveAttribute('title', PRETTY_JSON)
      await closeValueEditor(page, sheet)
      await saveWindow(page, win)
      await expect(variableRow(page, 's_text')).toBeVisible()
    })

    await test.step('REQ-3.1.3.11: the saved value keeps its line breaks and reopens on its lines', async () => {
      await saveTest(page)
      const stored = await readData(request, `/tests/${testId}`)
      expect(stored.variables.s_text.value).toBe(PRETTY_JSON)

      const win = await openEditWindow(page, 's_text')
      await expect(lineInput(win)).toHaveValue('{…')
      const sheet = await openValueEditor(page, win)
      const lines = valueEditorCode(sheet).locator('.cm-line')
      await expect(lines).toHaveCount(7)
      await expect(lines.first()).toHaveText('{')
      await expect(lines.nth(1)).toHaveText('"host": "db.example",')
      await closeValueEditor(page, sheet)
      await cancelWindow(page, win)
    })
  })

  test('a Variable Setter table row saved through the "Edit value" window keeps its column types into a run', async ({
    page,
    request,
  }) => {
    test.setTimeout(180_000)
    const setterId = randomUUID()
    const logId = randomUUID()
    testId = await createValidTest(request, {
      name: uniqueName('setter'),
      nodes: [setterNode(setterId, 'vt'), logNode(logId, 'Log', `f"${tableProbe('SETTER', 'vt')}"`, { x: 320, y: 260 })],
      edges: [startEdge(setterId), { id: randomUUID(), source: setterId, target: logId, type: 'default' }],
      variables: { vt: { type: 'table', value: [] } },
    })
    const seeded = await validateTest(request, testId)
    expect(seeded.errors, `the seed validates clean: ${JSON.stringify(seeded.errors)}`).toEqual([])
    await openTest(page, testId)

    await test.step('REQ-3.4.1.14: the setter row\'s table typed in Code', async () => {
      const config = await openBlockSheet(page, setterId)
      await config.locator('[data-testid="varset-edit-value-0"]').click()
      const sheet = valueEditorSheet(page)
      await expect(sheet).toBeVisible()
      await setValueEditorView(page, sheet, 'Code')
      await replaceValueEditorCode(page, sheet, TABLE_TEXT)
      await saveValueEditor(sheet)
      await closeValueEditor(page, sheet)
      await expect
        .soft(config.locator('[data-testid="varset-edit-value-0"]'), 'the row summarizes the saved table')
        .toContainText(TABLE_PREVIEW)
      await saveBlockSheet(config)
      await saveTest(page)
    })

    await test.step('REQ-3.5.5.4: the saved row holds the table with its column types', async () => {
      const workflow = await readData(request, `/tests/${testId}/workflow`)
      const node = (workflow.nodes as Rec[]).find((entry) => entry.id === setterId)
      expectTypedTable(node?.data.config.values.variables.vt, 'the setter row')
      const validation = await validateTest(request, testId)
      expect(validation.errors, JSON.stringify(validation.errors)).toEqual([])
    })

    await test.step('REQ-3.5.5.1: the run reads the set table with its column types', async () => {
      await selectEnvironment(page)
      const { verdict, entries } = await runToEnd(page)
      expectConsoleLine(entries, 'INFO', tableProbeLine('SETTER'))
      expect(verdict, `the run passes.\n${formatEntries(entries)}`).toBe('passed')
    })
  })

  test('a Suite, Regression and System table saved through its value cell keeps its column types into a run', async ({
    page,
    request,
  }) => {
    test.setTimeout(360_000)
    const token = runToken().replace(/-/g, '_')
    systemName = `tbl_${token}`
    const emptyTable = { type: 'table', value: [], secret: false }
    suiteId = await createEntity(request, '/suites', { name: uniqueName('suite'), variables: { t: emptyTable } })
    regressionId = await createEntity(request, '/regressions', { name: uniqueName('regression') })
    const attach = await request.put(`${BACKEND_URL}/regressions/${regressionId}`, {
      data: { suites: [suiteId], variables: { t: emptyTable } },
    })
    expect(attach.ok(), `PUT regression: ${attach.status()}`).toBeTruthy()

    await test.step('Suite: a table typed in Code is stored with its column types and saved again', async () => {
      const path = `/suites/${suiteId}`
      await typeEntityTable(page, await openEntityVariables(page, 'suite', suiteId), 't')
      const first = await readData(request, path)
      expect(first.variables.t.value.columns, 'the Suite table keeps its column types').toEqual(TYPED_COLUMNS)
      await editStoredEntityTable(page, await openEntityVariables(page, 'suite', suiteId), 't')
      expectTypedTable((await readData(request, path)).variables.t.value, 'the Suite table')
    })

    await test.step('Regression: the same, through its own value cell', async () => {
      const path = `/regressions/${regressionId}`
      await typeEntityTable(page, await openEntityVariables(page, 'regression', regressionId), 't')
      const first = await readData(request, path)
      expect(first.variables.t.value.columns, 'the Regression table keeps its column types').toEqual(TYPED_COLUMNS)
      await editStoredEntityTable(page, await openEntityVariables(page, 'regression', regressionId), 't')
      expectTypedTable((await readData(request, path)).variables.t.value, 'the Regression table')
    })

    await test.step('System: a new table variable, the same through its own value cell', async () => {
      const dialog = await openSystemVariablesOnNewRow(page)
      const added = newEntityVariableRow(dialog)
      await setEntityRowType(page, added, 'Table')
      await added.locator('[data-testid="variable-name-input"]').fill(systemName)
      await typeEntityTable(page, dialog, systemName)
      const first = (await readData(request, '/variables/system')).variables
      expect(first[systemName].value.columns, 'the System table keeps its column types').toEqual(TYPED_COLUMNS)
      await editStoredEntityTable(page, await openSystemVariables(page), systemName)
      expectTypedTable((await readData(request, '/variables/system')).variables[systemName].value, 'the System table')
    })

    await test.step('a Test in the Suite reads each table with its column types', async () => {
      const probe = [
        tableProbe('SUITE', 'suite.t'),
        tableProbe('REG', 'regression.t'),
        tableProbe('SYS', `system.${systemName}`),
      ].join(' | ')
      const logId = randomUUID()
      testId = await createValidTest(request, {
        name: uniqueName('entity-run'),
        nodes: [logNode(logId, 'Log', `f"${probe}"`)],
        edges: [startEdge(logId)],
      })
      const add = await request.post(`${BACKEND_URL}/suites/${suiteId}/tests`, { data: { test_id: testId } })
      expect(add.ok(), `add the Test to the Suite: ${add.status()}`).toBeTruthy()
      const validation = await validateTest(request, testId)
      expect(validation.errors, JSON.stringify(validation.errors)).toEqual([])

      await openTest(page, testId)
      await selectEnvironment(page)
      const { verdict, entries } = await runToEnd(page)
      expectConsoleLine(
        entries,
        'INFO',
        [tableProbeLine('SUITE'), tableProbeLine('REG'), tableProbeLine('SYS')].join(' | '),
      )
      expect(verdict, `the run passes.\n${formatEntries(entries)}`).toBe('passed')
    })
  })
})
