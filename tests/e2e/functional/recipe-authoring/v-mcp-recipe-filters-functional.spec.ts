/**
 * V-MCP-RECIPE-FILTERS: the recipe guide documents the CSV / Excel filter form, and a filter a
 * recipe writes opens in the config sheet and runs like one built there
 * Wireframe: none (tool surface)
 * Design Decisions: CSV-7, CSV-8, CSV-12
 * REQ: REQ-5.2.7.3, REQ-5.2.7.7, REQ-5.2.7.8, REQ-3.4.1.12
 *
 * Seed: none. Each Test is created over the live MCP endpoint by `create_test_from_recipe`: the
 * first with a CSV filter written in the one stored filter shape (CSV-12), the second with the
 * guide's own filter example as written.
 *
 * Pass Criteria:
 * 1. `get_recipe_guide` carries a filters subsection (a heading naming filters) that shows the
 *    stored item shape (`asType`).
 * 2. `create_test_from_recipe` creates the Test and stores the filter as written.
 * 3. The CSV config sheet shows one filter block on `amount` as Integer with one literal
 *    condition: operator "greater than", value `5`.
 * 4. The run passes the CSV block and the Log prints the kept ids `kept=b,c`.
 * 5. `get_block` describes the `sorts` and `filters` item shape (`direction`, `asType`, `_cell`).
 * 6. The guide's filter example, placed in a recipe as written, compiles; the sheet shows its
 *    sort (`amount` descending) and its filter (`amount` as Integer, greater than 5); the run
 *    keeps the ids in sort order: `kept=c,b`.
 * 7. A recipe filter row on not null written with a stray `reference_value: ''` is stored with
 *    none, `get_test_recipe` reads it back with none, the sheet shows "not null" with no value
 *    box, and the run keeps every row: `kept=a,b,c` (REQ-3.1.3.25).
 */

import { test, expect, type Locator, type Page } from '../../helpers/playwright-fixtures'
import { BACKEND_PORT, BACKEND_URL, ensureEnvironment } from '../../helpers/config'
import { getTest, runToken } from '../../helpers/element-types'
import { openTest } from '../../helpers/fn-seed'
import { startRun } from '../../helpers/k8s-run'
import { expectConsoleLine, formatEntries, getLogEntries, type LogEntry } from '../../helpers/log-reader'
import { callTool, enableMcpUntilRestart, resetMcpSettings } from '../../helpers/mcp'
import { resetOwnership } from '../../helpers/ownership'
import { filterBlocks } from '../../helpers/table-transform'
import { closeConfig, deleteTest, openConfig } from '../file-picker/picker'

// One MCP port per stack so host-mode parallel workers never collide.
const MCP_PORT = Number(BACKEND_PORT) + 765

const STORED_FILTER = {
  id: 'amount-filter',
  column: { mode: 'name', value: 'amount' },
  asType: 'integer',
  conditions: [
    {
      id: 'amount-over-five',
      type: 'literal',
      variable: '_cell',
      value_type: 'integer',
      operator: 'greater_than',
      reference_value: '5',
      reference_is_expression: false,
    },
  ],
}
const KEPT_IDS = 'kept=b,c'

/** A CSV block whose filter keeps the rows over 5, and a Log of the kept ids. */
function recipeFor(name: string): string {
  return `test:
  name: ${name}
  description: A CSV filter written in the stored filter shape
flow:
  - block: csv-parser
    label: Amounts over five
    settings:
      operation: parse
      csv_content: |
        id,amount
        a,3
        b,8
        c,12
      filters:
        - id: ${STORED_FILTER.id}
          column: {mode: name, value: amount}
          asType: integer
          conditions:
            - id: ${STORED_FILTER.conditions[0].id}
              type: literal
              variable: _cell
              value_type: integer
              operator: greater_than
              reference_value: '5'
              reference_is_expression: false
    capture:
      table: kept_rows
  - block: log
    settings:
      message: {expr: "'kept=' + ','.join(kept_rows.col('id'))"}
`
}

const STRAY_ROW_ID = 'amount-not-null'

/** A CSV filter row on not null written with a stray empty compare-to value, and a Log of the kept ids. */
function strayValueRecipe(name: string): string {
  return recipeFor(name)
    .replace(`id: ${STORED_FILTER.conditions[0].id}`, `id: ${STRAY_ROW_ID}`)
    .replace('operator: greater_than', 'operator: is_not_null')
    .replace("reference_value: '5'", "reference_value: ''")
}

/** The guide's headings, one per line. */
function headings(guide: string): string[] {
  return guide.split('\n').filter((line) => /^#{2,4} /.test(line))
}

/** The guide's filters subsection: its heading through the line before the next heading. */
function filterSection(guide: string): string {
  const lines = guide.split('\n')
  const start = lines.findIndex((line) => /^#{2,4} .*\bfilters?\b/i.test(line))
  if (start === -1) return ''
  const end = lines.findIndex((line, i) => i > start && /^#{1,4} /.test(line))
  return lines.slice(start, end === -1 ? undefined : end).join('\n')
}

const GUIDE_KEPT = 'kept=c,b'

/** The guide's filter example: the yaml block of its filters subsection. */
function filterExample(guide: string): string {
  return /```yaml\n([\s\S]*?)```/.exec(filterSection(guide))?.[1] ?? ''
}

/** A recipe whose flow is the guide's example as written, then a Log of the ids it captures. */
function recipeAround(example: string, table: string, name: string): string {
  const flow = example
    .trimEnd()
    .split('\n')
    .map((line) => `  ${line}`)
    .join('\n')
  return `test:
  name: ${name}
  description: The guide's filter example as written
flow:
${flow}
  - block: log
    settings:
      message: {expr: "'kept=' + ','.join(${table}.col('id'))"}
`
}

/** The description of a catalog setting found anywhere in a `get_block` answer. */
function settingDescription(node: unknown, name: string): string {
  if (Array.isArray(node)) {
    for (const item of node) {
      const found = settingDescription(item, name)
      if (found) return found
    }
    return ''
  }
  if (node && typeof node === 'object') {
    const record = node as Record<string, unknown>
    if (record.name === name && typeof record.description === 'string') return record.description
    return settingDescription(Object.values(record), name)
  }
  return ''
}

/** Open a sheet section unless it is open already. */
async function openSection(sheet: Locator, section: string): Promise<void> {
  const trigger = sheet.locator(`[data-testid="${section}-trigger"]`)
  if ((await trigger.getAttribute('data-state')) !== 'open') await trigger.click()
  await expect(trigger).toHaveAttribute('data-state', 'open')
}

/** Wait for the run to settle and its console to carry the Log line or the failure. */
async function settledEntries(page: Page, status: Locator): Promise<LogEntry[]> {
  await expect(status).not.toHaveAttribute('data-status', 'running', { timeout: 120_000 })
  let entries: LogEntry[] = []
  await expect
    .poll(
      async () => {
        entries = await getLogEntries(page)
        return entries.some((e) => e.source === 'Log' || e.level === 'ERROR' || e.level === 'FATAL')
      },
      { timeout: 30_000, message: 'the console carries the Log line or the failure' },
    )
    .toBe(true)
  return entries
}

test.describe('V-MCP-RECIPE-FILTERS: the filter form in the guide, the sheet and the run', () => {
  let testId = ''

  test.beforeEach(async ({ page, request }) => {
    await request.delete(`${BACKEND_URL}/workbench/session/`).catch(() => undefined)
    await resetOwnership(request)
    await ensureEnvironment(request)
    await enableMcpUntilRestart(page, MCP_PORT)
  })

  test.afterEach(async ({ page, request }) => {
    await request.delete(`${BACKEND_URL}/workbench/session/`).catch(() => undefined)
    if (testId) await deleteTest(request, testId)
    testId = ''
    await resetOwnership(request)
    await resetMcpSettings(page)
  })

  test('the guide documents the filter form and a recipe-built filter edits and runs like a UI-built one', async ({
    page,
    request,
  }) => {
    test.setTimeout(240_000)

    await test.step('the guide carries a filters subsection with the stored item shape', () => {
      const guide = callTool(MCP_PORT, 'get_recipe_guide', {}).payload.guide as string
      expect(guide.length, 'the guide is served').toBeGreaterThan(0)
      // Soft: the sheet and the run below are recorded even while the guide lacks the subsection.
      expect
        .soft(
          filterSection(guide),
          `the guide has a filters subsection showing the stored item shape. Headings:\n${headings(guide).join('\n')}`,
        )
        .toContain('asType')
    })

    let csvId = ''
    await test.step('a recipe with a CSV filter in the stored shape is created and stored as written', async () => {
      const created = callTool(MCP_PORT, 'create_test_from_recipe', {
        recipe: recipeFor(`zz-mcp-recipe-filters-${runToken()}`),
      })
      expect(created.payload.created, JSON.stringify(created.payload)).toBe(true)
      testId = created.payload.test_id as string
      const nodes = (await getTest(request, testId)).workflow.nodes as Array<Record<string, any>>
      const csv = nodes.find((node) => node.data.elementType === 'csv-parser')
      expect(csv, 'the CSV block is stored').toBeTruthy()
      csvId = csv?.id as string
      expect(csv?.data.config.values.filters).toEqual([STORED_FILTER])
    })

    await test.step('the CSV sheet shows the filter as the sheet builds it', async () => {
      await openTest(page, testId)
      const sheet = await openConfig(page, csvId)
      await sheet.locator('[data-testid="csv-filters-section-trigger"]').click()
      const blocks = filterBlocks(sheet)
      await expect(blocks).toHaveCount(1)
      const block = blocks.first()
      await expect(block.locator('[data-testid="column-ref-value"]')).toHaveValue('amount')
      await expect(block.locator('[data-testid^="filter-astype-"]')).toHaveText('Integer')
      const operators = block.locator('[data-testid^="filter-condition-operator-"]')
      await expect(operators).toHaveCount(1)
      await expect(operators.first()).toHaveText('greater than')
      await expect(block.locator(`[data-testid="filter-condition-value-${STORED_FILTER.conditions[0].id}"]`)).toHaveValue(
        '5',
      )
      await closeConfig(sheet)
    })

    const status = await startRun(page)
    const entries = await settledEntries(page, status)

    await test.step('the run keeps the rows over 5', async () => {
      await expect(
        page.locator(`[data-testid="workflow-node-${csvId}"]`),
        `the recipe-built CSV block runs.\n${formatEntries(entries)}`,
      ).toHaveAttribute('data-execution-status', 'success')
      expectConsoleLine(entries, 'INFO', KEPT_IDS)
    })
  })

  test("the guide's filter example compiles, opens in the sheet with its rows and runs", async ({ page, request }) => {
    test.setTimeout(240_000)

    let example = ''
    let table = ''
    await test.step('the guide and the block catalog document the stored sort and filter shape', () => {
      const guide = callTool(MCP_PORT, 'get_recipe_guide', {}).payload.guide as string
      const section = filterSection(guide)
      expect(section, `the guide has a filters subsection. Headings:\n${headings(guide).join('\n')}`).toContain(
        'asType',
      )
      expect(section).toContain('_cell')
      example = filterExample(guide)
      expect(example, `the filters subsection carries a yaml example:\n${section}`).toMatch(/^- block: csv-parser\n/)
      table = /capture:\s*\{table:\s*(\w+)\}/.exec(example)?.[1] ?? ''
      expect(table, `the example captures its table:\n${example}`).not.toBe('')
      const block = callTool(MCP_PORT, 'get_block', { block_id: 'csv-parser' }).payload
      expect(settingDescription(block, 'sorts'), 'get_block describes a sort').toContain('direction')
      const filters = settingDescription(block, 'filters')
      expect(filters, 'get_block describes a filter').toContain('asType')
      expect(filters).toContain('_cell')
    })

    let csvId = ''
    await test.step('a recipe holding the example as written is created', async () => {
      const created = callTool(MCP_PORT, 'create_test_from_recipe', {
        recipe: recipeAround(example, table, `zz-mcp-guide-filter-${runToken()}`),
      })
      expect(created.payload.created, JSON.stringify(created.payload)).toBe(true)
      testId = created.payload.test_id as string
      const nodes = (await getTest(request, testId)).workflow.nodes as Array<Record<string, any>>
      const csv = nodes.find((node) => node.data.elementType === 'csv-parser')
      expect(csv, 'the CSV block is stored').toBeTruthy()
      csvId = csv?.id as string
      expect(csv?.data.config.values).toMatchObject({
        sorts: [{ column: { mode: 'name', value: 'amount' }, direction: 'desc' }],
        filters: [
          {
            column: { mode: 'name', value: 'amount' },
            asType: 'integer',
            conditions: [{ type: 'literal', variable: '_cell', value_type: 'integer', operator: 'greater_than' }],
          },
        ],
      })
    })

    await test.step('the CSV sheet shows the sort and the filter as the sheet builds them', async () => {
      await openTest(page, testId)
      const sheet = await openConfig(page, csvId)
      await openSection(sheet, 'csv-sorts-section')
      const sorts = sheet.locator('[data-testid^="sort-row-"]')
      await expect(sorts).toHaveCount(1)
      await expect(sorts.first().locator('[data-testid="column-ref-value"]')).toHaveValue('amount')
      await expect(sorts.first().locator('[data-testid^="sort-direction-"]')).toHaveText('Descending')
      await openSection(sheet, 'csv-filters-section')
      const blocks = filterBlocks(sheet)
      await expect(blocks).toHaveCount(1)
      const block = blocks.first()
      await expect(block.locator('[data-testid="column-ref-value"]')).toHaveValue('amount')
      await expect(block.locator('[data-testid^="filter-astype-"]')).toHaveText('Integer')
      const operators = block.locator('[data-testid^="filter-condition-operator-"]')
      await expect(operators).toHaveCount(1)
      await expect(operators.first()).toHaveText('greater than')
      await expect(block.locator('[data-testid^="filter-condition-value-"]')).toHaveValue('5')
      await closeConfig(sheet)
    })

    const status = await startRun(page)
    const entries = await settledEntries(page, status)

    await test.step('the run keeps the rows over 5 in sort order', async () => {
      await expect(
        page.locator(`[data-testid="workflow-node-${csvId}"]`),
        `the guide's example runs.\n${formatEntries(entries)}`,
      ).toHaveAttribute('data-execution-status', 'success')
      expectConsoleLine(entries, 'INFO', GUIDE_KEPT)
    })
  })

  test('a recipe filter row on not null given a stray value is stored and read back with none', async ({
    page,
    request,
  }) => {
    test.setTimeout(240_000)

    let csvId = ''
    await test.step('the row is stored with no compare-to value', async () => {
      const created = callTool(MCP_PORT, 'create_test_from_recipe', {
        recipe: strayValueRecipe(`zz-mcp-recipe-filter-stray-${runToken()}`),
      })
      expect(created.payload.created, JSON.stringify(created.payload)).toBe(true)
      testId = created.payload.test_id as string
      const nodes = (await getTest(request, testId)).workflow.nodes as Array<Record<string, any>>
      const csv = nodes.find((node) => node.data.elementType === 'csv-parser')
      expect(csv, 'the CSV block is stored').toBeTruthy()
      csvId = csv?.id as string
      // Per REQ-3.1.3.25: an operator that takes no compare-to value stores none.
      expect(csv?.data.config.values.filters).toEqual([
        {
          ...STORED_FILTER,
          conditions: [
            { ...STORED_FILTER.conditions[0], id: STRAY_ROW_ID, operator: 'is_not_null', reference_value: null },
          ],
        },
      ])
    })

    await test.step('get_test_recipe reads the row back with no compare-to value', () => {
      const readback = callTool(MCP_PORT, 'get_test_recipe', { test_ref: testId })
      const recipe = readback.payload.recipe as string
      expect(recipe, JSON.stringify(readback.payload)).toMatch(/^\s+operator: is_not_null$/m)
      expect(recipe).toMatch(/^\s+reference_value: null$/m)
      expect(recipe).not.toMatch(/reference_value: ''/)
    })

    await test.step('the sheet shows not null with no value box', async () => {
      await openTest(page, testId)
      const sheet = await openConfig(page, csvId)
      await openSection(sheet, 'csv-filters-section')
      const block = filterBlocks(sheet).first()
      await expect(block.locator(`[data-testid="filter-condition-operator-${STRAY_ROW_ID}"]`)).toHaveText('not null')
      await expect(block.locator(`[data-testid="filter-condition-value-${STRAY_ROW_ID}"]`)).toHaveCount(0)
      await closeConfig(sheet)
    })

    const status = await startRun(page)
    const entries = await settledEntries(page, status)

    await test.step('the run keeps every row', () => {
      expectConsoleLine(entries, 'INFO', 'kept=a,b,c')
    })
  })
})
