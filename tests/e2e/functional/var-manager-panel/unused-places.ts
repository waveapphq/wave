/** The places a block or another variable reads a name (VMGR-105), each built through the UI in Test scope and inside a Function. */

import { expect, type Locator, type Page } from '../../helpers/playwright-fixtures'
import type { PaletteDragSpec } from '../../helpers/canvas'
import { leaveExpressionEditor } from '../../helpers/code-editor'
import { exprToggle, paramRow } from '../../helpers/config-sheet'
import {
  addExpressionRow,
  addLiteralRow,
  conditionBody,
  pickConditionVariable,
  pickOperator,
  setReference,
  type ConditionBlock,
} from '../../helpers/condition-builder'
import { openStringParamSheet } from '../../helpers/param-config'
import { addFilterBlock } from '../../helpers/table-transform'
import {
  createFunctionParam,
  createModal,
  createSimpleVariable,
  insertCodeValue,
  openCreateModal,
  setCreateKind,
  setCreateName,
  submitCreate,
  variableRow,
  type CreateVariableOptions,
} from '../../helpers/variable-create'
import {
  digIn,
  dropBelowStart,
  openBlockSheet,
  popToBreadcrumbSegment,
  saveBlockSheet,
  setBlockExpression,
} from '../../helpers/workbench'
import { dropBelow } from '../canvas-lanes/lanes-helpers'
import {
  bindFunctionInput,
  deleteBlock,
  deleteVariable,
  expressionOf,
  replaceCode,
  storedBodyNode,
  storedNode,
  type StoredNode,
  type StoredTest,
} from './references-helpers'

// --- Check blocks ---

export interface CheckBlockCase {
  label: string
  article: 'a' | 'an'
  block: ConditionBlock
  palette: PaletteDragSpec
  /** Card prefix of the branch that holds the condition list, when the block has branches. */
  cardPrefix?: 'branch' | 'case'
  /** The stored condition items of the block's first condition list. */
  storedRows: (values: Record<string, unknown>) => unknown
  /** A required setting of the block, other than its conditions, typed as `[name, text]`. */
  requiredSetting?: [string, string]
}

const BRANCH_ROWS = (values: Record<string, unknown>): unknown =>
  ((values.branches ?? []) as Array<{ conditions?: unknown }>)[0]?.conditions
const FLAT_ROWS = (values: Record<string, unknown>): unknown => values.conditions

export const CHECK_BLOCKS: CheckBlockCase[] = [
  { label: 'Assert', article: 'an', block: 'assert', palette: 'assert', storedRows: (values) => values.assertions },
  { label: 'If/Else', article: 'an', block: 'if-else', palette: 'if', cardPrefix: 'branch', storedRows: BRANCH_ROWS },
  {
    label: 'Switch',
    article: 'a',
    block: 'switch',
    palette: { term: 'switch', testId: 'palette-item-switch-case' },
    cardPrefix: 'case',
    storedRows: BRANCH_ROWS,
  },
  { label: 'While', article: 'a', block: 'while', palette: 'while', storedRows: FLAT_ROWS },
  {
    label: 'Wait Until',
    article: 'a',
    block: 'wait-until',
    palette: { term: 'wait', testId: 'palette-item-wait-until' },
    storedRows: FLAT_ROWS,
    requiredSetting: ['timeout', '1000'],
  },
]

const ASSERT = CHECK_BLOCKS[0]

type Item = Record<string, unknown>

/** The condition rows of a check block's first list, without the and / or items between them. */
export function storedConditionRows(check: CheckBlockCase, node: StoredNode): Item[] {
  const items = check.storedRows(node.data.config?.values ?? {})
  return (Array.isArray(items) ? (items as Item[]) : []).filter((item) => item.type !== 'operator')
}

/** A row added after the first sits after an and / or item, so the list path of row n is 2n. */
const rowPath = (index: number): string => String(index * 2)

/** Open a check block's sheet on its first condition list. */
export async function openConditionList(
  page: Page,
  blockId: string,
  check: CheckBlockCase,
): Promise<{ sheet: Locator; body: Locator }> {
  const sheet = await openBlockSheet(page, blockId)
  const body = conditionBody(sheet, check.block)
  if (check.cardPrefix && !(await body.isVisible())) {
    await sheet.locator(`[data-testid="${check.cardPrefix}-toggle-branch_0"]`).click()
  }
  await expect(body).toBeVisible()
  return { sheet, body }
}

async function saveCheckSheet(sheet: Locator, check: CheckBlockCase): Promise<void> {
  if (check.requiredSetting) {
    const [name, text] = check.requiredSetting
    await sheet.locator(`[data-testid="param-input-${name}"]`).fill(text)
  }
  await saveBlockSheet(sheet)
}

/** Build literal rows `<variable> equals <value>` in a check block's first condition list and Save the sheet. */
export async function buildConditionRows(
  page: Page,
  blockId: string,
  check: CheckBlockCase,
  rows: ReadonlyArray<readonly [string, string]>,
): Promise<void> {
  const { sheet, body } = await openConditionList(page, blockId, check)
  for (const [index, [variable, value]] of rows.entries()) {
    await addLiteralRow(body)
    await pickConditionVariable(page, body, rowPath(index), variable)
    await pickOperator(page, body, rowPath(index), 'equals')
    await setReference(body, rowPath(index), value)
  }
  await saveCheckSheet(sheet, check)
}

/** One literal Assert row `<variable> equals <expression>`, the compare-to value an expression. */
async function buildCompareToExpression(page: Page, blockId: string, variable: string, expression: string): Promise<void> {
  const { sheet, body } = await openConditionList(page, blockId, ASSERT)
  await addLiteralRow(body)
  await pickConditionVariable(page, body, '0', variable)
  await pickOperator(page, body, '0', 'equals')
  const toggle = body.locator('[data-testid="assert-expr-toggle-0"]')
  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-pressed', 'true')
  const editor = body.locator('[data-testid="assert-value-input-0"] .cm-content')
  await replaceCode(page, editor, expression)
  await leaveExpressionEditor(editor)
  await saveBlockSheet(sheet)
}

/** One Assert expression row. */
async function buildExpressionRow(page: Page, blockId: string, expression: string): Promise<void> {
  const { sheet, body } = await openConditionList(page, blockId, ASSERT)
  await addExpressionRow(body)
  const editor = body.locator('[data-testid="assert-expression-input-0"] .cm-content')
  await replaceCode(page, editor, expression)
  await leaveExpressionEditor(editor)
  await saveBlockSheet(sheet)
}

// --- Other block settings ---

/** A string setting made a Template in its Edit value sheet. */
async function setBlockTemplate(page: Page, blockId: string, setting: string, template: string): Promise<void> {
  const sheet = await openBlockSheet(page, blockId)
  const editor = await openStringParamSheet(sheet, page, setting)
  await editor.locator('[data-testid="kind-dropdown"]').click()
  await page.getByRole('option', { name: 'Template', exact: true }).click()
  await expect(editor.locator('[data-testid="kind-dropdown"]')).toContainText('Template')
  await replaceCode(page, editor.locator('.cm-content').first(), template)
  await editor.locator('[data-testid="value-editor-save-button"]').click()
  await editor.locator('[data-testid="value-editor-cancel-button"]').click()
  await expect(editor).toBeHidden()
  await saveBlockSheet(sheet)
}

/** Variable Setter rows `<target> = <expression>`. */
async function buildSetterRows(page: Page, blockId: string, rows: ReadonlyArray<readonly [string, string]>): Promise<void> {
  const sheet = await openBlockSheet(page, blockId)
  const add = sheet.locator('[data-testid="varset-add-button"]')
  for (const [index, [target, expression]] of rows.entries()) {
    const nameInput = sheet.locator(`[data-testid="varset-name-input-${index}"]`)
    if ((await nameInput.count()) === 0) await add.click()
    await nameInput.fill(target)
    await add.focus()
    await sheet.locator(`[data-testid="varset-expression-toggle-${index}"]`).click()
    const editor = sheet.locator(`[data-testid="param-input-${target}"] .cm-content`)
    await replaceCode(page, editor, expression)
    await leaveExpressionEditor(editor)
    await expect(sheet).toBeVisible()
  }
  await saveBlockSheet(sheet)
}

/** Pick a For Each collection from its variable picker. */
async function pickCollection(page: Page, blockId: string, name: string): Promise<void> {
  const sheet = await openBlockSheet(page, blockId)
  // The row also holds the collection type select, a button combobox; the picker is the text area.
  const picker = paramRow(sheet, 'collection').locator('textarea[role="combobox"]')
  await picker.click()
  const option = page.getByRole('option').filter({ has: page.getByText(name, { exact: true }) }).first()
  await expect(option, `${name} is offered as the collection`).toBeVisible({ timeout: 5_000 })
  await option.click()
  await expect(picker).toHaveValue(name)
  await saveBlockSheet(sheet)
}

/** Paste a text value into a string setting's Edit value sheet in one input. */
async function pasteValue(page: Page, sheet: Locator, setting: string, text: string): Promise<void> {
  const editor = await openStringParamSheet(sheet, page, setting)
  await replaceCode(page, editor.locator('.cm-content').first(), text)
  await editor.locator('[data-testid="value-editor-save-button"]').click()
  await editor.locator('[data-testid="value-editor-cancel-button"]').click()
  await expect(editor).toBeHidden()
}

type TableBlock = 'csv' | 'excel'

const TABLE_PALETTE: Record<TableBlock, PaletteDragSpec> = {
  csv: { term: 'csv', testId: 'palette-item-csv-parser' },
  excel: { term: 'excel', testId: 'palette-item-excel-parser' },
}

/** A CSV or Excel Read block whose one filter block on `id` holds one expression row. */
async function buildFilterExpression(page: Page, blockId: string, kind: TableBlock, expression: string): Promise<void> {
  const sheet = await openBlockSheet(page, blockId)
  if (kind === 'csv') {
    await pasteValue(page, sheet, 'csv_content', 'id\na')
  } else {
    // The workbook is never read: the sheet only needs one to Save.
    await exprToggle(sheet, 'workbook').click()
    const workbook = sheet.locator('[data-testid="param-input-workbook"] .cm-content')
    await replaceCode(page, workbook, "'testdata://book.xlsx'")
    await leaveExpressionEditor(workbook)
  }
  const block = await addFilterBlock(page, sheet, 'id', 'string')
  await block.locator('[data-testid^="filter-add-expression-"]').click()
  const editor = block.locator('.cm-content').last()
  await replaceCode(page, editor, expression)
  await leaveExpressionEditor(editor)
  await saveBlockSheet(sheet)
}

// --- Variables ---

/** A Test variable of the given Kind, its source typed into the code editor in one input. */
export async function createComputedVariable(
  page: Page,
  name: string,
  kind: 'Expression' | 'Template',
  source: string,
): Promise<void> {
  const modal = await openCreateModal(page)
  await setCreateName(page, name)
  await setCreateKind(page, kind)
  await insertCodeValue(page, source)
  // Leaving the editor runs the window's checks before Create.
  await leaveExpressionEditor(modal)
  await submitCreate(page)
  await expect(createModal(page)).toBeHidden()
  await expect(variableRow(page, name)).toBeVisible()
}

interface StoredLocal {
  name?: string
  value?: unknown
  isExpression?: boolean
  isTemplate?: boolean
}

/** A Function local as the saved Test holds it. */
function storedLocal(stored: StoredTest, functionId: string, name: string): StoredLocal {
  const locals = storedNode(stored, functionId).data.localDefinition?.variables
  const list = Array.isArray(locals) ? (locals as StoredLocal[]) : Object.entries(locals ?? {}).map(([key, v]) => ({ name: key, ...(v as StoredLocal) }))
  const local = list.find((v) => v.name === name)
  expect(local, `local ${name} is in Function ${functionId}`).toBeTruthy()
  return local as StoredLocal
}

// --- The place table ---

/** Where a reader is built: the Test (no Function) or the body of a Local Function. */
export interface ReaderScope {
  page: Page
  /** The Local Function the reader sits in; null in Test scope. */
  functionId: string | null
  /** The breadcrumb name of the scope, to come back to it after drilling deeper. */
  scopeName: string
}

export interface Reader {
  /** Proves the saved Test holds the reader at the place the cell names. */
  verify: (stored: StoredTest) => void
  /** Takes the reader away: deletes its block(s) or the other variable. */
  remove: () => Promise<void>
}

export interface Declared {
  mode: 'variable' | 'input' | 'output'
  name: string
  opts?: CreateVariableOptions
}

export interface ScopeCell {
  /** Names created before the reader: Test variables, or a Function's inputs, outputs and locals. */
  declare: Declared[]
  /** The names the reader reads or writes: each loses its Unused badge, and gets it back once the reader goes. */
  read: string[]
  build: (scope: ReaderScope) => Promise<Reader>
}

export interface Place {
  title: string
  test: ScopeCell
  fn: ScopeCell
}

/** Create a declared name in the scope the page shows. */
export async function declare(page: Page, inFunction: boolean, item: Declared): Promise<void> {
  if (inFunction) await createFunctionParam(page, item.mode, item.name, item.opts)
  else await createSimpleVariable(page, item.name, item.opts)
}

function blockIn(stored: StoredTest, scope: ReaderScope, id: string): StoredNode {
  return scope.functionId ? storedBodyNode(stored, scope.functionId, id) : storedNode(stored, id)
}

function values(node: StoredNode): Record<string, unknown> {
  return node.data.config?.values ?? {}
}

const TEST_SRC: Declared = { mode: 'variable', name: 't_src', opts: { value: 'a' } }
const FN_IN: Declared = { mode: 'input', name: 'fn_in' }
const FN_LOC: Declared = { mode: 'variable', name: 'fn_loc', opts: { value: 'b' } }

/** A cell whose reader is one block linked from the scope's Start (a Function refuses an unreachable block), configured by `configure` and checked on the saved block by `check`. */
function blockCell(
  declared: Declared[],
  read: string[],
  palette: PaletteDragSpec,
  configure: (page: Page, blockId: string) => Promise<void>,
  check: (node: StoredNode) => void,
): ScopeCell {
  return {
    declare: declared,
    read,
    build: async (scope) => {
      const blockId = await dropBelowStart(scope.page, palette)
      await configure(scope.page, blockId)
      return {
        verify: (stored) => check(blockIn(stored, scope, blockId)),
        remove: () => deleteBlock(scope.page, blockId),
      }
    },
  }
}

/** A cell whose reader is another variable of the scope, created with `kind` and `source`. */
function variableCell(
  declared: Declared[],
  read: string[],
  reader: string,
  kind: 'Expression' | 'Template',
  source: string,
): ScopeCell {
  return {
    declare: declared,
    read,
    build: async (scope) => {
      if (scope.functionId) await createFunctionParam(scope.page, 'variable', reader, { kind, value: source })
      else await createComputedVariable(scope.page, reader, kind, source)
      const flag = kind === 'Expression' ? 'isExpression' : 'isTemplate'
      return {
        verify: (stored) => {
          const held = scope.functionId ? storedLocal(stored, scope.functionId, reader) : stored.variables[reader]
          expect(held, `the stored ${reader}`).toMatchObject({ value: source, [flag]: true })
        },
        remove: () => deleteVariable(scope.page, reader),
      }
    },
  }
}

function expressionSetting(node: StoredNode, setting: string, text: string): void {
  expect(node.data.expressionFields ?? [], `${setting} is an expression`).toContain(setting)
  expect(values(node)[setting]).toBe(text)
}

function templateSetting(node: StoredNode, setting: string, text: string): void {
  expect(node.data.templateFields ?? [], `${setting} is a template`).toContain(setting)
  expect(values(node)[setting]).toBe(text)
}

function conditionCell(check: CheckBlockCase, declared: Declared[], rows: Array<[string, string]>): ScopeCell {
  return blockCell(
    declared,
    rows.map(([variable]) => variable),
    check.palette,
    (page, id) => buildConditionRows(page, id, check, rows),
    (node) => {
      const stored = storedConditionRows(check, node)
      expect(stored.map((row) => row.variable), `the stored ${check.label} rows`).toEqual(rows.map(([variable]) => variable))
    },
  )
}

function compareToCell(declared: Declared[], read: string[], subject: string, expression: string): ScopeCell {
  return blockCell(declared, read, ASSERT.palette, (page, id) => buildCompareToExpression(page, id, subject, expression), (node) => {
    expect(storedConditionRows(ASSERT, node)).toEqual([
      expect.objectContaining({ type: 'literal', variable: subject, reference_is_expression: true, reference_value: expression }),
    ])
  })
}

function expressionRowCell(declared: Declared[], read: string[], expression: string): ScopeCell {
  return blockCell(declared, read, ASSERT.palette, (page, id) => buildExpressionRow(page, id, expression), (node) => {
    expect(storedConditionRows(ASSERT, node)).toEqual([expect.objectContaining({ type: 'expression', expression })])
  })
}

const SETTER: PaletteDragSpec = { term: 'var setter', testId: 'palette-item-variable-setter' }

function setterCell(declared: Declared[], read: string[], rows: Array<[string, string]>): ScopeCell {
  return blockCell(declared, read, SETTER, (page, id) => buildSetterRows(page, id, rows), (node) => {
    const held = (values(node).variables ?? {}) as Record<string, unknown>
    for (const [target, expression] of rows) expect(held[target], `the stored Setter row ${target}`).toBe(expression)
  })
}

function collectionCell(declared: Declared[], name: string): ScopeCell {
  return blockCell(declared, [name], 'for each', (page, id) => pickCollection(page, id, name), (node) => {
    expect(values(node).collection, 'the stored collection').toBe(name)
  })
}

const filterRow = (name: string): string => `_cell == ${name}`

/** A CSV block and an Excel Read block, each with one filter expression row reading one name. */
function filterCell(declared: Declared[], csvName: string, excelName: string): ScopeCell {
  return {
    declare: declared,
    read: [csvName, excelName],
    build: async (scope) => {
      const csvId = await dropBelowStart(scope.page, TABLE_PALETTE.csv)
      await buildFilterExpression(scope.page, csvId, 'csv', filterRow(csvName))
      const excelId = await dropBelow(scope.page, csvId, null, TABLE_PALETTE.excel)
      await buildFilterExpression(scope.page, excelId, 'excel', filterRow(excelName))
      const filterRows = (node: StoredNode): unknown =>
        ((values(node).filters ?? []) as Array<{ conditions?: unknown }>)[0]?.conditions
      return {
        verify: (stored) => {
          expect(filterRows(blockIn(stored, scope, csvId)), 'the CSV filter row').toEqual([
            expect.objectContaining({ type: 'expression', expression: filterRow(csvName) }),
          ])
          expect(filterRows(blockIn(stored, scope, excelId)), 'the Excel filter row').toEqual([
            expect.objectContaining({ type: 'expression', expression: filterRow(excelName) }),
          ])
        },
        remove: async () => {
          await deleteBlock(scope.page, csvId)
          await deleteBlock(scope.page, excelId)
        },
      }
    },
  }
}

/** A Local Function Block whose one input, declared inside it, is bound to `expression`. */
function bindingCell(declared: Declared[], read: string[], input: string, expression: string): ScopeCell {
  return {
    declare: declared,
    read,
    build: async (scope) => {
      const { page } = scope
      const callId = await dropBelowStart(page, page.locator('[data-testid="palette-new-block-button"]'))
      await digIn(page, callId)
      await createFunctionParam(page, 'input', input)
      await popToBreadcrumbSegment(page, scope.scopeName)
      await expect(page.locator(`[data-testid="workflow-node-${callId}"]`)).toBeVisible({ timeout: 15_000 })
      const sheet = await openBlockSheet(page, callId)
      await bindFunctionInput(page, sheet, input, expression)
      await saveBlockSheet(sheet)
      return {
        verify: (stored) => expect(expressionOf(blockIn(stored, scope, callId), input), 'the stored expression field').toBe(expression),
        remove: () => deleteBlock(page, callId),
      }
    },
  }
}

/** The 16 places of matrix 5b, each in Test scope and in Function scope (an input and a local). */
export const PLACES: Place[] = [
  {
    title: 'a block setting expression',
    test: blockCell([TEST_SRC], ['t_src'], 'log', (page, id) => setBlockExpression(page, id, 'message', 't_src'), (node) =>
      expressionSetting(node, 'message', 't_src'),
    ),
    fn: blockCell([FN_IN, FN_LOC], ['fn_in', 'fn_loc'], 'log', (page, id) => setBlockExpression(page, id, 'message', 'fn_in + fn_loc'), (node) =>
      expressionSetting(node, 'message', 'fn_in + fn_loc'),
    ),
  },
  {
    title: "another variable's Expression",
    test: variableCell([TEST_SRC], ['t_src'], 't_calc', 'Expression', "t_src + '!'"),
    fn: variableCell([FN_IN, FN_LOC], ['fn_in', 'fn_loc'], 'fn_calc', 'Expression', 'fn_in + fn_loc'),
  },
  {
    title: 'a block setting template',
    test: blockCell([TEST_SRC], ['t_src'], 'log', (page, id) => setBlockTemplate(page, id, 'message', 'Hi {{t_src}}'), (node) =>
      templateSetting(node, 'message', 'Hi {{t_src}}'),
    ),
    fn: blockCell([FN_IN, FN_LOC], ['fn_in', 'fn_loc'], 'log', (page, id) => setBlockTemplate(page, id, 'message', '{{fn_in}} {{fn_loc}}'), (node) =>
      templateSetting(node, 'message', '{{fn_in}} {{fn_loc}}'),
    ),
  },
  {
    title: "another variable's Template",
    test: variableCell([TEST_SRC], ['t_src'], 't_tpl', 'Template', 'Hi {{t_src}}'),
    fn: variableCell([FN_IN, FN_LOC], ['fn_in', 'fn_loc'], 'fn_tpl', 'Template', '{{fn_in}}-{{fn_loc}}'),
  },
  ...CHECK_BLOCKS.map(
    (check): Place => ({
      title: `${check.article} ${check.label} condition row variable`,
      test: conditionCell(check, [TEST_SRC], [['t_src', 'x']]),
      fn: conditionCell(check, [FN_IN, FN_LOC], [
        ['fn_in', 'x'],
        ['fn_loc', 'y'],
      ]),
    }),
  ),
  {
    title: 'a condition compare-to expression',
    test: compareToCell([{ mode: 'variable', name: 't_subject', opts: { value: 'a' } }, TEST_SRC], ['t_src'], 't_subject', 't_src'),
    fn: compareToCell(
      [{ mode: 'variable', name: 'fn_subj', opts: { value: 'ab' } }, FN_IN, FN_LOC],
      ['fn_in', 'fn_loc'],
      'fn_subj',
      'fn_in + fn_loc',
    ),
  },
  {
    title: 'a condition expression row',
    test: expressionRowCell([TEST_SRC], ['t_src'], "t_src == 'x'"),
    fn: expressionRowCell([FN_IN, FN_LOC], ['fn_in', 'fn_loc'], 'fn_in == fn_loc'),
  },
  {
    title: 'a Variable Setter row value expression',
    test: setterCell([TEST_SRC, { mode: 'variable', name: 't_target', opts: { value: 'z' } }], ['t_src'], [['t_target', "t_src + '!'"]]),
    fn: setterCell(
      [FN_IN, FN_LOC, { mode: 'variable', name: 'fn_target', opts: { value: 'z' } }],
      ['fn_in', 'fn_loc'],
      [['fn_target', 'fn_in + fn_loc']],
    ),
  },
  {
    title: 'a Variable Setter row target',
    test: setterCell([{ mode: 'variable', name: 't_target', opts: { value: 'z' } }], ['t_target'], [['t_target', "'v'"]]),
    fn: setterCell(
      [FN_LOC, { mode: 'output', name: 'fn_out' }],
      ['fn_loc', 'fn_out'],
      [
        ['fn_loc', "'v'"],
        ['fn_out', "'w'"],
      ],
    ),
  },
  {
    title: 'a Function Block input binding',
    test: bindingCell([TEST_SRC], ['t_src'], 'who', 't_src'),
    fn: bindingCell([FN_IN, FN_LOC], ['fn_in', 'fn_loc'], 'level', 'fn_in + fn_loc'),
  },
  {
    title: 'a For Each collection',
    test: collectionCell([{ mode: 'variable', name: 't_items', opts: { type: 'array' } }], 't_items'),
    fn: collectionCell([{ mode: 'variable', name: 'fn_items', opts: { type: 'array' } }], 'fn_items'),
  },
  {
    title: 'a CSV / Excel filter expression row',
    test: filterCell(
      [
        { mode: 'variable', name: 't_csv_key', opts: { value: 'a' } },
        { mode: 'variable', name: 't_xls_key', opts: { value: 'a' } },
      ],
      't_csv_key',
      't_xls_key',
    ),
    fn: filterCell([FN_IN, FN_LOC], 'fn_in', 'fn_loc'),
  },
]
