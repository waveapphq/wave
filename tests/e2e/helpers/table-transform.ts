/** The CSV and Excel Transform section: sheet drivers, the stored shape and the shared matrix (CSV-7, CSV-8, CSV-12). */

import { expect, type Locator, type Page } from './playwright-fixtures'
import { getActiveSessionId, getSessionVariables, type SessionVariables } from './fixture-import'
import { startRun } from './k8s-run'
import { getLogEntries, type LogEntry } from './log-reader'
import { chainEdges, pluginNode, stackNodes, type WorkflowEdge, type WorkflowNode } from './k8s-nodes'
import { buildZip } from './zip-writer'

export type SortDirection = 'asc' | 'desc'
export type FilterColumnType = 'string' | 'integer' | 'float' | 'boolean'

const DIRECTION_LABELS: Record<SortDirection, string> = { asc: 'Ascending', desc: 'Descending' }
const AS_TYPE_LABELS: Record<FilterColumnType, string> = {
  string: 'String',
  integer: 'Integer',
  float: 'Float',
  boolean: 'Boolean',
}

const SORT_ROWS = '[data-testid^="sort-row-"]'
const FILTER_BLOCKS = '[data-testid^="filter-block-"]'
const CONDITION_OPERATORS = '[data-testid^="filter-condition-operator-"]'

async function openSection(sheet: Locator, section: 'csv-sorts-section' | 'csv-filters-section'): Promise<void> {
  const trigger = sheet.locator(`[data-testid="${section}-trigger"]`)
  if ((await trigger.getAttribute('data-state')) !== 'open') await trigger.click()
  await expect(trigger).toHaveAttribute('data-state', 'open')
}

async function pickOption(page: Page, trigger: Locator, label: string): Promise<void> {
  await trigger.click()
  await page.getByRole('option', { name: label, exact: true }).click()
  await expect(trigger).toHaveText(label)
}

async function setColumnName(scope: Locator, column: string): Promise<void> {
  const value = scope.locator('[data-testid="column-ref-value"]').first()
  await value.fill(column)
  await expect(value).toHaveValue(column)
}

/** Every filter block of the sheet, in order. */
export function filterBlocks(sheet: Locator): Locator {
  return sheet.locator(FILTER_BLOCKS)
}

/** Add a sort row on a column name with a direction; returns the row. */
export async function addSort(
  page: Page,
  sheet: Locator,
  column: string,
  direction: SortDirection,
): Promise<Locator> {
  await openSection(sheet, 'csv-sorts-section')
  const rows = sheet.locator(SORT_ROWS)
  const before = await rows.count()
  await sheet.locator('[data-testid="sort-add-button"]').click()
  await expect(rows).toHaveCount(before + 1)
  const row = rows.nth(before)
  await setColumnName(row, column)
  await pickOption(page, row.locator('[data-testid^="sort-direction-"]'), DIRECTION_LABELS[direction])
  return row
}

/** Add a filter block on a column name with its "as" type; returns the block. */
export async function addFilterBlock(
  page: Page,
  sheet: Locator,
  column: string,
  asType: FilterColumnType,
): Promise<Locator> {
  await openSection(sheet, 'csv-filters-section')
  const blocks = filterBlocks(sheet)
  const before = await blocks.count()
  await sheet.locator('[data-testid="filter-add-block"]').click()
  await expect(blocks).toHaveCount(before + 1)
  const block = blocks.nth(before)
  await setColumnName(block, column)
  await pickOption(page, block.locator('[data-testid^="filter-astype-"]'), AS_TYPE_LABELS[asType])
  return block
}

/** Add a literal condition to a filter block: the operator by its label, then the value unless the operator takes none. */
export async function addFilterLiteral(
  page: Page,
  block: Locator,
  operatorLabel: string,
  value?: string,
): Promise<Locator> {
  const operators = block.locator(CONDITION_OPERATORS)
  const before = await operators.count()
  await block.locator('[data-testid^="filter-add-literal-"]').click()
  await expect(operators).toHaveCount(before + 1)
  const operator = operators.nth(before)
  await pickOption(page, operator, operatorLabel)
  if (value !== undefined) {
    const id = ((await operator.getAttribute('data-testid')) ?? '').replace('filter-condition-operator-', '')
    const input = block.locator(`[data-testid="filter-condition-value-${id}"]`)
    await input.fill(value)
    await expect(input).toHaveValue(value)
  }
  return operator
}

/** The operator labels a filter block's literal condition offers, in order (the select is closed again). */
export async function filterOperatorOptions(page: Page, block: Locator, index = 0): Promise<string[]> {
  const operator = block.locator(CONDITION_OPERATORS).nth(index)
  await operator.click()
  const listbox = page.getByRole('listbox')
  await expect(listbox).toBeVisible()
  const labels = (await listbox.getByRole('option').allTextContents()).map((label) => label.trim())
  await page.keyboard.press('Escape')
  await expect(listbox).toHaveCount(0)
  return labels
}

// ---------------------------------------------------------------------------
// Column references by index, the "as" type and condition rows
// ---------------------------------------------------------------------------

export type ColumnRefMode = 'name' | 'index'

/** A column reference as the sheet stores it: a header name, or a 0-based index kept as text. */
export interface StoredColumnRef {
  mode: ColumnRefMode
  value: string
}

const MODE_LABELS: Record<ColumnRefMode, string> = { name: 'Name', index: 'Index' }

/** A column reference by header name. */
export function nameRef(name: string): StoredColumnRef {
  return { mode: 'name', value: name }
}

/** A column reference by 0-based index. */
export function indexRef(index: number): StoredColumnRef {
  return { mode: 'index', value: String(index) }
}

async function setColumnRef(page: Page, scope: Locator, ref: StoredColumnRef): Promise<void> {
  const mode = scope.locator('[data-testid="column-ref-mode"]').first()
  if ((await mode.textContent())?.trim() !== MODE_LABELS[ref.mode]) {
    await pickOption(page, mode, MODE_LABELS[ref.mode])
  }
  await setColumnName(scope, ref.value)
}

/** Add a sort row on a column by name or by index with a direction; returns the row. */
export async function addSortOn(
  page: Page,
  sheet: Locator,
  ref: StoredColumnRef,
  direction: SortDirection,
): Promise<Locator> {
  await openSection(sheet, 'csv-sorts-section')
  const rows = sheet.locator(SORT_ROWS)
  const before = await rows.count()
  await sheet.locator('[data-testid="sort-add-button"]').click()
  await expect(rows).toHaveCount(before + 1)
  const row = rows.nth(before)
  await setColumnRef(page, row, ref)
  await pickOption(page, row.locator('[data-testid^="sort-direction-"]'), DIRECTION_LABELS[direction])
  return row
}

/** Switch a filter block's "as" type. */
export async function setFilterAsType(page: Page, block: Locator, asType: FilterColumnType): Promise<void> {
  await pickOption(page, block.locator('[data-testid^="filter-astype-"]'), AS_TYPE_LABELS[asType])
}

/** Pick the operator of a filter block's nth literal condition and, when given, fill its value. */
export async function setFilterCondition(
  page: Page,
  block: Locator,
  index: number,
  operatorLabel: string,
  value?: string,
): Promise<void> {
  const operator = block.locator(CONDITION_OPERATORS).nth(index)
  await pickOption(page, operator, operatorLabel)
  if (value === undefined) return
  const id = ((await operator.getAttribute('data-testid')) ?? '').replace('filter-condition-operator-', '')
  const input = block.locator(`[data-testid="filter-condition-value-${id}"]`)
  await input.fill(value)
  await expect(input).toHaveValue(value)
}

// ---------------------------------------------------------------------------
// The one stored shape (CSV-12) and generators that write it
// ---------------------------------------------------------------------------

/** A literal condition row as the sheet stores it. */
export interface StoredCondition {
  id: string
  type: 'literal'
  variable: '_cell'
  value_type: FilterColumnType
  operator: string
  reference_value: string | null
  reference_is_expression: false
}

/** The operators that take no compare-to value; a row on one stores none (REQ-3.1.3.25). */
export const NO_COMPARE_TO_OPERATORS: ReadonlySet<string> = new Set([
  'is_true',
  'is_false',
  'is_empty',
  'is_not_empty',
  'is_null',
  'is_not_null',
])

/** A filter block as the sheet stores it. */
export interface StoredFilter {
  id: string
  column: StoredColumnRef
  asType: FilterColumnType
  conditions: StoredCondition[]
}

/** A sort key as the sheet stores it. */
export interface StoredSort {
  id: string
  column: StoredColumnRef
  direction: SortDirection
}

/** One filter block with one literal row; an operator that takes no compare-to value stores none, as the sheet does. */
export function storedFilter(
  id: string,
  column: StoredColumnRef,
  asType: FilterColumnType,
  operator: string,
  value = '',
): StoredFilter {
  return {
    id,
    column,
    asType,
    conditions: [
      {
        id: `${id}-row`,
        type: 'literal',
        variable: '_cell',
        value_type: asType,
        operator,
        reference_value: NO_COMPARE_TO_OPERATORS.has(operator) ? null : value,
        reference_is_expression: false,
      },
    ],
  }
}

/** One sort key. */
export function storedSort(id: string, column: StoredColumnRef, direction: SortDirection): StoredSort {
  return { id, column, direction }
}

/** A deep copy without the `id` keys, which the sheet generates per row. */
export function withoutIds<T>(value: T): T {
  if (Array.isArray(value)) return value.map((item) => withoutIds(item)) as T
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([key]) => key !== 'id')
        .map(([key, item]) => [key, withoutIds(item)]),
    ) as T
  }
  return value
}

// ---------------------------------------------------------------------------
// The shared filter and sort matrix (REQ-3.1.3.25 holds-nothing answers on a null cell)
// ---------------------------------------------------------------------------

export type SheetCell = string | number | boolean | null

/** One filter cell: an operator, its compare-to text, and the ids it keeps on each column. */
export interface FilterCell {
  operator: string
  label: string
  value?: string
  held: string
  withNull: string
}

/** The filter matrix rows: per "as" type a held column and a column whose row b holds null. */
export const FILTER_DATA: ReadonlyArray<readonly SheetCell[]> = [
  ['id', 's_h', 's_n', 'i_h', 'i_n', 'f_h', 'f_n', 'b_h', 'b_n'],
  ['a', 'apple', 'apple', 3, 3, 1.5, 1.5, true, true],
  ['b', 'banana', null, 8, null, 2.5, null, false, null],
  ['c', 'cherry', 'cherry', 12, 12, 3.75, 3.75, true, false],
]

export type FilterColumnSide = 'held' | 'withNull'

/** The two columns each "as" type filters. */
export const FILTER_COLUMNS: Record<FilterColumnType, Record<FilterColumnSide, string>> = {
  string: { held: 's_h', withNull: 's_n' },
  integer: { held: 'i_h', withNull: 'i_n' },
  float: { held: 'f_h', withNull: 'f_n' },
  boolean: { held: 'b_h', withNull: 'b_n' },
}

/** Every operator of each "as" type with its kept ids; a null cell keeps its row for not equals, does not contain, is null. */
export const FILTER_CELLS: Record<FilterColumnType, readonly FilterCell[]> = {
  string: [
    { operator: 'equals', label: 'equals', value: 'apple', held: 'a', withNull: 'a' },
    { operator: 'not_equals', label: 'not equals', value: 'apple', held: 'b,c', withNull: 'b,c' },
    { operator: 'contains', label: 'contains', value: 'e', held: 'a,c', withNull: 'a,c' },
    { operator: 'does_not_contain', label: 'does not contain', value: 'e', held: 'b', withNull: 'b' },
    { operator: 'starts_with', label: 'starts with', value: 'ch', held: 'c', withNull: 'c' },
    { operator: 'ends_with', label: 'ends with', value: 'e', held: 'a', withNull: 'a' },
    { operator: 'matches_regex', label: 'matches regex', value: '^[ab]', held: 'a,b', withNull: 'a' },
    { operator: 'is_null', label: 'is null', held: '', withNull: 'b' },
    { operator: 'is_not_null', label: 'not null', held: 'a,b,c', withNull: 'a,c' },
  ],
  integer: [
    { operator: 'equals', label: 'equals', value: '3', held: 'a', withNull: 'a' },
    { operator: 'not_equals', label: 'not equals', value: '3', held: 'b,c', withNull: 'b,c' },
    { operator: 'less_than', label: 'less than', value: '10', held: 'a,b', withNull: 'a' },
    { operator: 'greater_than', label: 'greater than', value: '5', held: 'b,c', withNull: 'c' },
    { operator: 'less_or_equal', label: 'less or equal', value: '8', held: 'a,b', withNull: 'a' },
    { operator: 'greater_or_equal', label: 'greater or equal', value: '8', held: 'b,c', withNull: 'c' },
    { operator: 'is_null', label: 'is null', held: '', withNull: 'b' },
    { operator: 'is_not_null', label: 'not null', held: 'a,b,c', withNull: 'a,c' },
  ],
  float: [
    { operator: 'equals', label: 'equals', value: '1.5', held: 'a', withNull: 'a' },
    { operator: 'not_equals', label: 'not equals', value: '1.5', held: 'b,c', withNull: 'b,c' },
    { operator: 'less_than', label: 'less than', value: '3', held: 'a,b', withNull: 'a' },
    { operator: 'greater_than', label: 'greater than', value: '2', held: 'b,c', withNull: 'c' },
    { operator: 'less_or_equal', label: 'less or equal', value: '2.5', held: 'a,b', withNull: 'a' },
    { operator: 'greater_or_equal', label: 'greater or equal', value: '2.5', held: 'b,c', withNull: 'c' },
    { operator: 'is_null', label: 'is null', held: '', withNull: 'b' },
    { operator: 'is_not_null', label: 'not null', held: 'a,b,c', withNull: 'a,c' },
  ],
  boolean: [
    { operator: 'is_true', label: 'is true', held: 'a,c', withNull: 'a' },
    { operator: 'is_false', label: 'is false', held: 'b', withNull: 'c' },
    { operator: 'is_null', label: 'is null', held: '', withNull: 'b' },
    { operator: 'is_not_null', label: 'not null', held: 'a,b,c', withNull: 'a,c' },
  ],
}

/** The one cell of each "as" type built through the sheet; the rest are generated in the shape it stores. */
export const SHEET_BUILT_CELLS: Record<FilterColumnType, { operator: string; side: FilterColumnSide }> = {
  string: { operator: 'contains', side: 'withNull' },
  integer: { operator: 'not_equals', side: 'withNull' },
  float: { operator: 'greater_or_equal', side: 'held' },
  boolean: { operator: 'is_null', side: 'withNull' },
}

/** The matrix cell of an "as" type by operator. */
export function filterCell(asType: FilterColumnType, operator: string): FilterCell {
  const cell = FILTER_CELLS[asType].find((candidate) => candidate.operator === operator)
  if (!cell) throw new Error(`no ${asType} filter cell for ${operator}`)
  return cell
}

/** The sort matrix rows, in an order no single key keeps; row a's score is null. */
export const SORT_DATA: ReadonlyArray<readonly SheetCell[]> = [
  ['id', 'region', 'amount', 'score'],
  ['c', 'west', 3, 3],
  ['a', 'east', 12, null],
  ['d', 'west', 8, 8],
  ['b', 'east', 5, 5],
]

/** One sort cell: the keys in priority order and the ids in the order they leave. */
export interface SortCell {
  name: string
  keys: ReadonlyArray<{ column: StoredColumnRef; direction: SortDirection }>
  order: string
}

/** One key by name and by index, ascending and descending (CSV-7). */
export const SINGLE_SORT_CELLS: readonly SortCell[] = [
  { name: 'by_name_asc', keys: [{ column: nameRef('amount'), direction: 'asc' }], order: 'c,b,d,a' },
  { name: 'by_name_desc', keys: [{ column: nameRef('amount'), direction: 'desc' }], order: 'a,d,b,c' },
  { name: 'by_index_asc', keys: [{ column: indexRef(0), direction: 'asc' }], order: 'a,b,c,d' },
  { name: 'by_index_desc', keys: [{ column: indexRef(0), direction: 'desc' }], order: 'd,c,b,a' },
]

/** Two keys keep their priority; a null cell sorts last whatever the direction. */
export const PRIORITY_SORT_CELLS: readonly SortCell[] = [
  {
    name: 'two_keys',
    keys: [
      { column: nameRef('region'), direction: 'asc' },
      { column: nameRef('amount'), direction: 'desc' },
    ],
    order: 'a,b,d,c',
  },
  { name: 'null_last', keys: [{ column: nameRef('score'), direction: 'desc' }], order: 'd,b,c,a' },
]

// ---------------------------------------------------------------------------
// Sources: CSV text and a workbook
// ---------------------------------------------------------------------------

/** The rows as CSV text; a null cell is an empty field. */
export function csvText(rows: ReadonlyArray<readonly SheetCell[]>): string {
  return rows.map((row) => row.map((cell) => (cell === null ? '' : String(cell))).join(',')).join('\n')
}

const SHEET_NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
const REL_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
const PACKAGE_REL_NS = 'http://schemas.openxmlformats.org/package/2006/relationships'
const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'

function workbookCell(ref: string, value: SheetCell): string {
  if (value === null) return ''
  if (typeof value === 'boolean') return `<c r="${ref}" t="b"><v>${value ? 1 : 0}</v></c>`
  if (typeof value === 'number') return `<c r="${ref}"><v>${value}</v></c>`
  return `<c r="${ref}" t="inlineStr"><is><t>${value}</t></is></c>`
}

/** A one-sheet .xlsx of the rows: text inline, numbers and booleans typed, a null cell left out. */
export function buildWorkbook(rows: ReadonlyArray<readonly SheetCell[]>, sheetName = 'Sheet1'): Buffer {
  const sheetRows = rows
    .map(
      (row, i) =>
        `<row r="${i + 1}">` +
        row.map((value, j) => workbookCell(`${String.fromCodePoint(65 + j)}${i + 1}`, value)).join('') +
        '</row>',
    )
    .join('')
  const parts: Record<string, string> = {
    '[Content_Types].xml':
      `${XML_HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
      '</Types>',
    '_rels/.rels':
      `${XML_HEAD}<Relationships xmlns="${PACKAGE_REL_NS}">` +
      `<Relationship Id="rId1" Type="${REL_NS}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    'xl/workbook.xml':
      `${XML_HEAD}<workbook xmlns="${SHEET_NS}" xmlns:r="${REL_NS}">` +
      `<sheets><sheet name="${sheetName}" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    'xl/_rels/workbook.xml.rels':
      `${XML_HEAD}<Relationships xmlns="${PACKAGE_REL_NS}">` +
      `<Relationship Id="rId1" Type="${REL_NS}/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`,
    'xl/worksheets/sheet1.xml': `${XML_HEAD}<worksheet xmlns="${SHEET_NS}"><sheetData>${sheetRows}</sheetData></worksheet>`,
  }
  return buildZip(Object.entries(parts).map(([name, xml]) => ({ name, data: Buffer.from(xml, 'utf-8') })))
}

// ---------------------------------------------------------------------------
// Generated Tests and the kept rows a run binds
// ---------------------------------------------------------------------------

export type TransformParser = 'csv' | 'excel'

const PARSER_NODES: Record<TransformParser, { elementType: string; label: string }> = {
  csv: { elementType: 'csv-parser', label: 'CSV Parser' },
  excel: { elementType: 'excel-parser', label: 'Excel Parser' },
}

/** The setting values that point a parser at its rows: CSV text, or a workbook in Test Data. */
export function transformSource(
  parser: TransformParser,
  rows: ReadonlyArray<readonly SheetCell[]>,
  workbook = '',
): Record<string, unknown> {
  return parser === 'csv'
    ? { operation: 'parse', csv_content: csvText(rows) }
    : { operation: 'read', workbook: `testdata://${workbook}` }
}

export interface TransformNodeOptions {
  /** The Block id, and its Name. */
  id: string
  source: Record<string, unknown>
  /** The variable the Table output binds. */
  table: string
  filters?: StoredFilter[]
  sorts?: StoredSort[]
}

/** A CSV or Excel Block holding filters / sorts in the stored shape, its Table bound to a variable. */
export function transformNode(parser: TransformParser, opts: TransformNodeOptions): WorkflowNode {
  const values: Record<string, unknown> = { ...opts.source }
  if (opts.sorts) values.sorts = opts.sorts
  if (opts.filters) values.filters = opts.filters
  return pluginNode({
    id: opts.id,
    label: opts.id,
    elementType: PARSER_NODES[parser].elementType,
    category: 'data',
    description: PARSER_NODES[parser].label,
    values,
    outputBindings: { table: opts.table },
  })
}

/** Table variables declared with no value, for the Blocks to bind. */
export function tableVariables(names: readonly string[]): Record<string, Record<string, unknown>> {
  return Object.fromEntries(names.map((name) => [name, { value: null, type: 'table', scope: 'test' }]))
}

/** A Test body (nodes in one chain from Start, declared variables) and the kept ids per bound variable. */
export interface MatrixSeed {
  nodes: WorkflowNode[]
  edges: WorkflowEdge[]
  variables: Record<string, Record<string, unknown>>
  expected: Record<string, string>
}

function chainSeed(entries: ReadonlyArray<{ node: WorkflowNode; table: string; kept: string }>): MatrixSeed {
  const nodes = entries.map((entry) => entry.node)
  return {
    nodes: stackNodes(nodes),
    edges: chainEdges(nodes.map((node) => node.id)),
    variables: tableVariables(entries.map((entry) => entry.table)),
    expected: Object.fromEntries(entries.map((entry) => [entry.table, entry.kept])),
  }
}

/** One Block per operator of an "as" type and per column (held, holding null), in the stored filter shape. */
export function filterMatrixSeed(
  parser: TransformParser,
  asType: FilterColumnType,
  source: Record<string, unknown>,
): MatrixSeed {
  const sides: FilterColumnSide[] = ['held', 'withNull']
  return chainSeed(
    FILTER_CELLS[asType].flatMap((cell) =>
      sides.map((side) => {
        const column = FILTER_COLUMNS[asType][side]
        const table = `k_${cell.operator}_${column}`
        const filter = storedFilter(`${table}-filter`, nameRef(column), asType, cell.operator, cell.value)
        return { node: transformNode(parser, { id: table, source, table, filters: [filter] }), table, kept: cell[side] }
      }),
    ),
  )
}

/** The ids a bound table holds, in row order; null when the run never bound a table to it. */
export function keptIds(variables: SessionVariables, name: string): string | null {
  const value = variables[name]?.value as { rows?: unknown[][] } | null | undefined
  if (!value || !Array.isArray(value.rows)) return null
  return value.rows.map((row) => String(row[0])).join(',')
}

/** The kept ids of every listed variable, by name. */
export function keptIdsByName(variables: SessionVariables, names: readonly string[]): Record<string, string | null> {
  return Object.fromEntries(names.map((name) => [name, keptIds(variables, name)]))
}

/** What a finished run leaves: its verdict, its console and the session's variables. */
export interface SettledRun {
  verdict: string
  entries: LogEntry[]
  variables: SessionVariables
}

/** Run the Test open on the canvas to its end and read what it bound. */
export async function runAndReadSession(page: Page): Promise<SettledRun> {
  const status = await startRun(page)
  await expect(status).not.toHaveAttribute('data-status', 'running', { timeout: 120_000 })
  const verdict = (await status.getAttribute('data-status')) ?? ''
  const entries = await getLogEntries(page)
  const variables = await getSessionVariables(page, await getActiveSessionId(page))
  return { verdict, entries, variables }
}
