/**
 * V-PLUGIN-SQL-02: SQL editor states
 * Design Decisions: SQL-3, SQL-10, SQL-11, SQL-12, SQL-13
 * REQ: REQ-3.4.1.6, REQ-5.1.4
 *
 * Runs in the no-data project list. beforeAll creates a per-run schema with the 14 demo
 * tables on the stack's PostgreSQL through a tracked run; every test seeds its own Test
 * through POST /tests whose SQL blocks land in that schema (Driver options search_path);
 * afterAll drops the schema, deletes every Test and clears the workbench session, so the
 * next spec's bare /workbench does not recover the finished cleanup run. Theme-agnostic DOM
 * assertions.
 *
 * Pass Criteria:
 * 1. The SQL row opens the Edit value sheet in SQL mode: STRING badge; footer Kind
 *    Literal (Literal / Template offered), Format SQL locked, F1 Help opening the SQL
 *    keyboard list, the Get Tables chip idle, then Close / Save / Run with Run primary.
 * 2. With nothing loaded, the suggestion list at a table position (after FROM) holds a
 *    TABLES section whose only row is "Get tables from the database" with the database
 *    icon; picking it pulls the catalog and inserts nothing, and the open list then
 *    lists the loaded tables under TABLES.
 * 3. The settled chip reads "Tables · 14" with the refresh button beside it; it opens
 *    the Tables popover above the chip, whose search "ord" lists order_items then orders
 *    (the catalog's order) with each table's columns under it, the match underlined and
 *    the first row highlighted; picking a table inserts its name at the cursor. With the
 *    tables loaded, a keyword where a table name goes (FROM WHERE) is never read as a table,
 *    while a table the catalog lacks still warns "Table '...' is not in the loaded tables".
 * 4. After ":" the suggestion list holds a PARAMETERS section listing the Parameters
 *    entries with the ":" icon; picking one inserts it.
 * 5. The validation strip is amber and reads "Parameter 'limit' is defined but not used
 *    in the SQL" plus "(+1 more)", whose list adds "Line 6: SET search_path ends the
 *    script; its effect ends with the block"; only the SET line carries the amber wavy
 *    underline; the warnings block neither Save nor Run.
 * 6. Run on a long statement: a spinner and a destructive Stop with a square icon replace
 *    Run, Save is disabled, Kind, F1 Help, Get Tables and Close stay enabled at full
 *    strength; Stop ends the run and Run comes back.
 * 7. The chip's six states: Get Tables with the database icon; Connecting... and Getting
 *    tables... each with a spinner and its own square Stop, which returns the chip to Get
 *    Tables; Got 14 tables in the success colors with a check; Tables · 14 with the
 *    refresh button, reached after the three-second hold or at once on the next keystroke;
 *    Could not get tables in the error color with an alert icon, the database's own
 *    refusal in its tooltip.
 */

import { leaveExpressionEditor } from '../../helpers/code-editor'
import { randomBytes, randomUUID } from 'node:crypto'
import {
  test,
  expect,
  type APIRequestContext,
  type Locator,
  type Page,
  type Route,
} from '../../helpers/playwright-fixtures'
import {
  FRONTEND_URL,
  POSTGRES_PORT,
  SQL_STACK_DATABASE,
  SQL_STACK_PASSWORD,
  SQL_STACK_USER,
  SQL_TARGET_HOST,
  ensureEnvironment,
} from '../../helpers/config'
import { createValidTest, openTest, validateTest } from '../../helpers/fn-seed'
import { clearSettledWorkbenchSession, runTrackedTest } from '../../helpers/k8s-run'
import { openStringParamSheet } from '../../helpers/param-config'
import { selectEnvironment } from '../../helpers/workbench'
import { deleteTest, openConfig } from '../../functional/file-picker/picker'
import {
  tablesChip,
  tablesChipStatus,
  tablesPopover,
  typeScript,
} from '../../functional/python-block/editor-helpers'
import { escapeRegExp } from '../../helpers/log-reader'

/** This worker's schema; every table of the run lives in it and is dropped with it. */
const SCHEMA = `v_sql02_${randomBytes(4).toString('hex')}`

/** The 14 demo tables; `orders` and `order_items` are the wireframe's. */
const TABLES: ReadonlyArray<{ name: string; columns: string }> = [
  { name: 'addresses', columns: 'id integer, customer_id integer, street text, city text, zip text' },
  { name: 'categories', columns: 'id integer, name text, parent_id integer' },
  { name: 'coupons', columns: 'id integer, code text, percent_off integer, expires_at timestamp' },
  { name: 'customers', columns: 'id integer, name text, email text, created_at timestamp' },
  { name: 'employees', columns: 'id integer, name text, role text, hired_at timestamp' },
  { name: 'inventory', columns: 'id integer, sku text, warehouse text, qty integer' },
  { name: 'invoices', columns: 'id integer, order_id integer, amount numeric, issued_at timestamp' },
  { name: 'order_items', columns: 'id integer, order_id integer, sku text, qty integer, price numeric' },
  { name: 'orders', columns: 'id integer, customer_id integer, status text, total numeric, created_at timestamp' },
  { name: 'payments', columns: 'id integer, invoice_id integer, method text, amount numeric, paid_at timestamp' },
  { name: 'products', columns: 'id integer, sku text, name text, price numeric, category_id integer' },
  { name: 'reviews', columns: 'id integer, product_id integer, rating integer, body text' },
  { name: 'shipments', columns: 'id integer, order_id integer, carrier text, shipped_at timestamp' },
  { name: 'suppliers', columns: 'id integer, name text, country text' },
]

const TABLE_COUNT = TABLES.length

/** The wireframe's query, the cursor's line left at `FROM `. */
const TABLES_SCRIPT = [
  'SELECT id, status, total',
  'FROM ',
  'WHERE customer_id = :customer',
  '  AND status = :status',
  'ORDER BY created_at DESC',
].join('\n')

/** Line 4 ends before its placeholder; the spec types the `:`. */
const PARAMS_SCRIPT = [
  'SELECT id, status, total',
  'FROM orders',
  'WHERE customer_id = :customer',
  '  AND status = ',
  'ORDER BY created_at DESC;',
  'SET search_path TO public;',
].join('\n')

/** One line, so typing it presses no Enter: an unknown table, then FROM with no table before WHERE. */
const KEYWORD_SCRIPT = 'SELECT id FROM ordrs; SELECT id FROM WHERE id = 1'
const UNKNOWN_TABLE = "Line 1: Table 'ordrs' is not in the loaded tables"

const UNUSED_LIMIT = "Parameter 'limit' is defined but not used in the SQL"
const SESSION_STATE_END = 'Line 6: SET search_path ends the script; its effect ends with the block'
const GET_TABLES_ACTION = 'Get tables from the database'
const AMBER_UNDERLINE = 'rgb(245, 158, 11)'
const SQL_HELP_ACTIONS = [
  'Autocomplete',
  'Run',
  'Save',
  'Close',
  'Toggle comment',
  'Find and replace',
  'Go to line',
  'Indent / outdent',
  'Undo / redo',
]

type Values = Record<string, unknown>

const CONNECTION: Values = {
  operation: 'run_sql',
  database_type: 'postgresql',
  host: SQL_TARGET_HOST,
  port: Number(POSTGRES_PORT),
  database: SQL_STACK_DATABASE,
  username: SQL_STACK_USER,
  password: SQL_STACK_PASSWORD,
  script_type: 'source',
}

/** The connection rows landing in this run's schema: pg8000's own startup parameter. */
const IN_SCHEMA: Values = {
  ...CONNECTION,
  driver_options: { startup_params: { search_path: SCHEMA } },
}

const created: string[] = []

// --- seed ---------------------------------------------------------------------------

function sqlNode(id: string, values: Values, x: number): Record<string, unknown> {
  return {
    id,
    type: 'workflowNode',
    position: { x, y: 100 },
    data: {
      label: 'SQL',
      elementType: 'sql-client',
      nodeType: 'plugin',
      category: 'database',
      version: '1.0.0',
      description: '',
      hasNewerVersion: false,
      expressionFields: [],
      templateFields: [],
      config: { values, outputBindings: {}, profileBindings: [] },
    },
    measured: { width: 120, height: 62 },
  }
}

/** POST /tests with the blocks chained after Start; asserts the Test validates clean. */
async function seedTest(
  request: APIRequestContext,
  name: string,
  blocks: ReadonlyArray<{ id: string; values: Values }>,
): Promise<string> {
  await ensureEnvironment(request)
  const nodes = blocks.map((block, index) => sqlNode(block.id, block.values, 200 + index * 200))
  const edges = blocks.map((block, index) => ({
    id: randomUUID(),
    source: index === 0 ? 'start-node' : blocks[index - 1].id,
    target: block.id,
    type: 'default',
  }))
  const testId = await createValidTest(request, {
    name: `${name} ${SCHEMA}`,
    nodes,
    edges,
    variables: {},
  })
  created.push(testId)
  const result = await validateTest(request, testId, 'load')
  expect(result.errors, `"${name}" failed validation: ${JSON.stringify(result.errors)}`).toHaveLength(0)
  return testId
}

/** Run one SQL script through a tracked run of its own Test, and require it to pass. */
async function runScript(request: APIRequestContext, name: string, sql: string): Promise<void> {
  const testId = await seedTest(request, name, [
    { id: randomUUID(), values: { ...CONNECTION, sql, stop_on_error: true } },
  ])
  const run = await runTrackedTest(request, testId)
  expect(run.verdict, `${name} (execution ${run.executionId})`).toBe('passed')
}

/** Seed one block, open the Test, its config sheet and the SQL row's editor. */
async function openEditor(page: Page, name: string, values: Values): Promise<Locator> {
  const nodeId = randomUUID()
  const testId = await seedTest(page.request, name, [{ id: nodeId, values }])
  await openTest(page, testId)
  const config = await openConfig(page, nodeId)
  const sheet = await openStringParamSheet(config, page, 'sql')
  await expect(sheet.locator('.cm-content')).toBeVisible()
  return sheet
}

// --- locators -----------------------------------------------------------------------

const footerButton = (sheet: Locator, id: string): Locator => sheet.locator(`[data-testid="${id}"]`)
const chipButton = (sheet: Locator): Locator =>
  tablesChip(sheet).locator('button:not([aria-label="Refresh tables"]):not([aria-label="Stop getting tables"])')
const chipStop = (sheet: Locator): Locator => tablesChip(sheet).getByRole('button', { name: 'Stop getting tables' })
const chipRefresh = (sheet: Locator): Locator => tablesChip(sheet).getByRole('button', { name: 'Refresh tables' })
const completion = (page: Page): Locator => page.locator('.cm-tooltip-autocomplete ul[role="listbox"]').first()
const strip = (sheet: Locator): Locator => sheet.locator('[data-testid="value-editor-validation"]')
const editorLine = (sheet: Locator, line: number): Locator => sheet.locator('.cm-content .cm-line').nth(line - 1)

/** Every message the strip lists: its one message, or the whole list behind "(+N more)". */
async function stripMessages(page: Page, sheet: Locator): Promise<string[]> {
  if ((await strip(sheet).count()) === 0) return []
  const more = sheet.locator('[data-testid="value-editor-validation-more"]')
  if ((await more.count()) === 0) return [(await strip(sheet).innerText()).trim()]
  await more.click()
  const list = page.locator('[data-testid="value-editor-validation-more-list"]')
  await expect(list).toBeVisible()
  const messages = await list.locator('span').allInnerTexts()
  await sheet.locator('[data-testid="value-editor-sheet-drag-handle"]').click()
  await expect(list).toBeHidden()
  return messages
}

async function editorText(sheet: Locator): Promise<string> {
  return sheet
    .locator('.cm-content .cm-line')
    .evaluateAll((lines) => lines.map((line) => line.textContent ?? '').join('\n'))
}

async function cursorAtLineEnd(page: Page, sheet: Locator, line: number): Promise<void> {
  await editorLine(sheet, line).click()
  await page.keyboard.press('End')
}

/** The rendered suggestion rows under each section header, with their icon classes. */
function suggestionSections(
  page: Page,
): Promise<Array<{ header: string; transform: string; rows: Array<{ label: string; icon: string }> }>> {
  return completion(page).evaluate((ul) => {
    const sections: Array<{ header: string; transform: string; rows: Array<{ label: string; icon: string }> }> = []
    for (const child of Array.from(ul.children)) {
      if (child.classList.contains('cm-completionSection')) {
        sections.push({
          header: (child.textContent ?? '').trim(),
          transform: globalThis.getComputedStyle(child).textTransform,
          rows: [],
        })
        continue
      }
      if (child.tagName !== 'LI') continue
      sections.at(-1)?.rows.push({
        label: child.querySelector('.cm-completionLabel')?.textContent ?? '',
        icon: child.querySelector('.cm-completionIcon')?.className ?? '',
      })
    }
    return sections
  })
}

/** The computed color a CSS color value or a utility class resolves to on this page. */
function resolvedColor(page: Page, probe: { style?: string; className?: string }): Promise<string> {
  return page.evaluate(({ style, className }) => {
    const span = document.createElement('span')
    if (style) span.style.color = style
    if (className) span.className = className
    document.body.appendChild(span)
    const color = globalThis.getComputedStyle(span).color
    span.remove()
    return color
  }, probe)
}

/** Every ancestor of the element up to the sheet reads at full strength, in no disabled fieldset. */
function atFullStrength(control: Locator): Promise<{ opacity: string[]; inDisabledFieldset: boolean }> {
  return control.evaluate((el) => {
    const opacity: string[] = []
    for (let node: Element | null = el; node; node = node.parentElement) {
      opacity.push(globalThis.getComputedStyle(node).opacity)
      if (node.getAttribute('data-testid') === 'value-editor-sheet') break
    }
    return { opacity, inDisabledFieldset: el.closest('fieldset:disabled') !== null }
  })
}

interface ChipSnapshot {
  state: string | null
  text: string
  icons: string[]
  color: string
  refresh: boolean
}

/** The chip read in one go: the done state holds for three seconds only. */
function chipSnapshot(sheet: Locator): Promise<ChipSnapshot> {
  return tablesChip(sheet).evaluate((root) => {
    const primary = root.querySelector(
      'button:not([aria-label="Refresh tables"]):not([aria-label="Stop getting tables"])',
    )
    return {
      state: root.getAttribute('data-state'),
      text: (primary?.textContent ?? '').trim(),
      icons: primary
        ? Array.from(primary.querySelectorAll('svg')).map((svg) => svg.getAttribute('class') ?? '')
        : [],
      color: primary ? globalThis.getComputedStyle(primary).color : '',
      refresh: root.querySelector('button[aria-label="Refresh tables"]') !== null,
    }
  })
}

async function waitForChip(sheet: Locator, state: string, timeout: number): Promise<ChipSnapshot> {
  let seen: ChipSnapshot | null = null
  await expect
    .poll(
      async () => {
        seen = await chipSnapshot(sheet)
        return seen.state
      },
      { timeout, intervals: [100] },
    )
    .toBe(state)
  return seen as unknown as ChipSnapshot
}

/** Holds the page's catalog pull on the status `pin.status` names; DELETE is counted and answered canceled. */
async function pinCatalog(
  page: Page,
  pin: { status: string; deletes: number },
): Promise<() => Promise<void>> {
  const frontendOrigin = new URL(FRONTEND_URL).origin
  const matcher = (url: URL): boolean =>
    /^(\/api)?\/sql-tools\/catalog(\/[^/]+)?$/.test(url.pathname) &&
    (url.origin !== frontendOrigin || url.pathname.startsWith('/api/'))
  const handler = async (route: Route): Promise<void> => {
    const method = route.request().method()
    const answer = (data: Record<string, unknown>) =>
      route.fulfill({
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': route.request().headers().origin ?? frontendOrigin,
          'Access-Control-Allow-Credentials': 'true',
        },
        body: JSON.stringify({ success: true, data }),
      })
    if (method === 'POST') return answer({ job_id: 'v-plugin-sql-02-pinned', cached: false })
    if (method === 'GET') return answer({ status: pin.status })
    if (method === 'DELETE') {
      pin.deletes += 1
      return answer({ status: 'canceled' })
    }
    return route.fallback()
  }
  await page.route(matcher, handler)
  return () => page.unroute(matcher, handler)
}

// --- tests --------------------------------------------------------------------------

test.describe('V-PLUGIN-SQL-02: the SQL editor', () => {
  test.beforeAll(async ({ request }) => {
    test.setTimeout(180_000)
    const creates = TABLES.map((table) => `CREATE TABLE ${SCHEMA}.${table.name} (${table.columns});`)
    await runScript(request, 'V-PLUGIN-SQL-02 schema', [`CREATE SCHEMA ${SCHEMA};`, ...creates].join('\n'))
  })

  test.afterAll(async ({ request }) => {
    test.setTimeout(180_000)
    try {
      await runScript(request, 'V-PLUGIN-SQL-02 cleanup', `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE;`)
    } finally {
      for (const testId of created.splice(0)) await deleteTest(request, testId)
      await clearSettledWorkbenchSession(request)
    }
  })

  test('suggest-tables: SQL mode footer, and the Get tables row where a table name goes (SQL-10, SQL-11, SQL-12)', async ({
    page,
  }) => {
    test.setTimeout(120_000)
    const sheet = await openEditor(page, 'V-PLUGIN-SQL-02 suggest-tables', {
      ...IN_SCHEMA,
      sql: TABLES_SCRIPT,
      parameters: { customer: '42', status: 'open' },
    })

    await test.step('SQL mode: STRING badge, Kind Literal with Template offered, Format SQL locked', async () => {
      await expect(sheet.locator('[data-testid="value-editor-type-badge"]')).toHaveText(/^string$/i)
      const kind = footerButton(sheet, 'kind-dropdown')
      await expect(kind).toHaveText('Literal')
      await kind.click()
      const options = page.getByRole('listbox').getByRole('option')
      await expect(options).toHaveText(['Literal', 'Template'])
      await page.getByRole('option', { name: 'Literal', exact: true }).click()
      await expect(kind).toHaveText('Literal')
      const format = footerButton(sheet, 'format-dropdown')
      await expect(format).toHaveText('SQL')
      await expect(format).toBeDisabled()
    })

    await test.step('F1 Help opens the SQL keyboard list, without Rename', async () => {
      const help = footerButton(sheet, 'value-editor-help-chip')
      await expect(help.locator('kbd')).toHaveText('F1')
      await expect(help).toContainText('Help')
      await help.click()
      const popover = page.locator('[data-testid="sql-help-popover"]')
      await expect(popover).toBeVisible()
      await expect(popover.locator('h3')).toHaveText('Keyboard')
      await expect(popover.locator('[data-testid="sql-help-key-label"]')).toHaveText(SQL_HELP_ACTIONS)
      await popover.getByRole('button', { name: 'Close help' }).click()
      await expect(popover).toBeHidden()
    })

    await test.step('the idle chip, then Close / Save / Run with Run primary, left to right', async () => {
      await expect(tablesChip(sheet)).toHaveAttribute('data-state', 'idle')
      await expect(chipButton(sheet)).toHaveText('Get Tables')
      await expect(chipButton(sheet).locator('svg.lucide-database')).toHaveCount(1)
      const order = [
        footerButton(sheet, 'kind-dropdown'),
        footerButton(sheet, 'format-dropdown'),
        footerButton(sheet, 'value-editor-help-chip'),
        chipButton(sheet),
        footerButton(sheet, 'value-editor-cancel-button'),
        footerButton(sheet, 'value-editor-save-button'),
        footerButton(sheet, 'value-editor-run-button'),
      ]
      const boxes = await Promise.all(order.map((control) => control.boundingBox()))
      for (let index = 1; index < boxes.length; index += 1) {
        expect(boxes[index]!.x, `footer control ${index} sits right of control ${index - 1}`).toBeGreaterThanOrEqual(
          boxes[index - 1]!.x + boxes[index - 1]!.width,
        )
        const drift = Math.abs(
          boxes[index]!.y + boxes[index]!.height / 2 - (boxes[0]!.y + boxes[0]!.height / 2),
        )
        expect(drift, `footer control ${index} shares the footer row`).toBeLessThanOrEqual(2)
      }
      await expect(footerButton(sheet, 'value-editor-cancel-button')).toHaveText('Close')
      await expect(footerButton(sheet, 'value-editor-save-button')).toHaveText('Save')
      await expect(footerButton(sheet, 'value-editor-run-button')).toHaveText('Run')
      await expect(footerButton(sheet, 'value-editor-run-button')).toHaveClass(/\bbtn-primary\b/)
      await expect(footerButton(sheet, 'value-editor-save-button')).not.toHaveClass(/\bbtn-primary\b/)
      await expect(footerButton(sheet, 'value-editor-cancel-button')).not.toHaveClass(/\bbtn-primary\b/)
      await expect(footerButton(sheet, 'value-editor-run-button')).toBeEnabled()
    })

    await test.step('after FROM with nothing loaded: a TABLES section holding only Get tables', async () => {
      await cursorAtLineEnd(page, sheet, 2)
      await page.keyboard.press('Control+Space')
      await expect(completion(page)).toBeVisible()
      const sections = await suggestionSections(page)
      expect(sections).toEqual([
        {
          header: 'Tables',
          transform: 'uppercase',
          rows: [{ label: GET_TABLES_ACTION, icon: expect.stringContaining('cm-completionIcon-sql-get-tables') }],
        },
      ])
    })

    await test.step('picking the row pulls the catalog, and the open list turns into the tables', async () => {
      const before = await editorText(sheet)
      // A click: the list ignores Enter for its first moments, so a fast Enter types a newline.
      await completion(page).locator('li[role="option"]').filter({ hasText: GET_TABLES_ACTION }).click()
      await expect(tablesChip(sheet)).toHaveAttribute('data-state', /^(done|settled)$/, { timeout: 30_000 })
      await expect(chipButton(sheet)).toHaveText(new RegExp(`^(Got ${TABLE_COUNT} tables|Tables · ${TABLE_COUNT})$`))
      expect(await editorText(sheet), 'the action row inserts nothing').toBe(before)

      await expect
        .poll(async () => {
          const sections = await suggestionSections(page)
          return sections.map((section) => [section.header, section.rows.map((row) => row.label).sort()])
        })
        .toEqual([['Tables', TABLES.map((table) => table.name).sort()]])
      await leaveExpressionEditor(sheet)
    })
  })

  test('tables: the settled chip opens the Tables popover, whose pick lands at the cursor (SQL-12)', async ({
    page,
  }) => {
    test.setTimeout(120_000)
    const sheet = await openEditor(page, 'V-PLUGIN-SQL-02 tables', {
      ...IN_SCHEMA,
      sql: TABLES_SCRIPT,
      parameters: { customer: '42', status: 'open' },
    })

    await chipButton(sheet).click()
    await expect(tablesChip(sheet)).toHaveAttribute('data-state', 'settled', { timeout: 30_000 })

    await test.step('the settled chip reads Tables · 14, the refresh button beside it', async () => {
      await expect(chipButton(sheet)).toHaveText(`Tables · ${TABLE_COUNT}`)
      await expect(chipButton(sheet).locator('svg.lucide-database')).toHaveCount(1)
      await expect(chipRefresh(sheet)).toBeVisible()
      await expect(chipRefresh(sheet).locator('svg.lucide-refresh-cw')).toHaveCount(1)
      const [label, refresh] = await Promise.all([chipButton(sheet).boundingBox(), chipRefresh(sheet).boundingBox()])
      expect(refresh!.x, 'refresh sits right of the chip').toBeGreaterThanOrEqual(label!.x + label!.width)
      expect(refresh!.x - (label!.x + label!.width), 'refresh sits beside the chip').toBeLessThanOrEqual(8)
      expect(Math.abs(refresh!.y + refresh!.height / 2 - (label!.y + label!.height / 2))).toBeLessThanOrEqual(1)
    })

    await test.step('the popover opens above the chip; "ord" lists order_items then orders with their columns', async () => {
      await cursorAtLineEnd(page, sheet, 2)
      await leaveExpressionEditor(sheet)
      await chipButton(sheet).click()
      const popover = tablesPopover(page)
      await expect(popover).toBeVisible()
      const search = popover.getByRole('combobox', { name: 'Search tables' })
      await expect(search).toBeFocused()
      await page.keyboard.type('ord')
      await expect(search).toHaveValue('ord')

      const items = popover.locator('[data-testid^="tables-popover-item-"]')
      await expect(items).toHaveCount(2)
      expect(
        await items.evaluateAll((els) => els.map((el) => el.getAttribute('data-testid'))),
      ).toEqual(['tables-popover-item-order_items', 'tables-popover-item-orders'])
      await expect(popover.locator('[data-testid="tables-popover-columns-order_items"]')).toHaveText(
        'id  order_id  sku  qty  price',
      )
      await expect(popover.locator('[data-testid="tables-popover-columns-orders"]')).toHaveText(
        'id  customer_id  status  total  created_at',
      )
      await expect(popover.locator('[data-testid="tables-popover-match"]')).toHaveText(['ord', 'ord'])
      await expect(items.first()).toHaveAttribute('aria-selected', 'true')
      await expect(items.nth(1)).not.toHaveAttribute('aria-selected', 'true')

      const [popoverBox, chipBox] = await Promise.all([popover.boundingBox(), chipButton(sheet).boundingBox()])
      expect(popoverBox!.y + popoverBox!.height, 'the popover stands above the chip').toBeLessThanOrEqual(chipBox!.y + 1)
    })

    await test.step('picking orders inserts it at the cursor and gives the editor back', async () => {
      await tablesPopover(page).locator('[data-testid="tables-popover-item-orders"]').click()
      await expect(tablesPopover(page)).toBeHidden()
      await expect(editorLine(sheet, 2)).toHaveText('FROM orders')
      expect(await editorText(sheet)).toBe(TABLES_SCRIPT.replace('FROM \n', 'FROM orders\n'))
      await expect(sheet.locator('.cm-content')).toBeFocused()
      await expect(footerButton(sheet, 'value-editor-save-button')).toBeEnabled()
    })

    await test.step('a keyword where a table name goes is not a table; an unknown table still warns (SQL-12)', async () => {
      await typeScript(page, sheet, KEYWORD_SCRIPT)
      let messages: string[] = []
      await expect
        .poll(
          async () => {
            messages = await stripMessages(page, sheet)
            return messages
          },
          { timeout: 15_000 },
        )
        .toContain(UNKNOWN_TABLE)
      expect(
        messages.filter((message) => message.includes("Table 'WHERE'")),
        `WHERE is a keyword, not a table. The strip listed:\n${messages.join('\n')}`,
      ).toEqual([])
    })
  })

  test('suggest-params: the PARAMETERS section after ":" and the two check warnings (SQL-3, SQL-10, SQL-11)', async ({
    page,
  }) => {
    test.setTimeout(120_000)
    const sheet = await openEditor(page, 'V-PLUGIN-SQL-02 suggest-params', {
      ...IN_SCHEMA,
      sql: PARAMS_SCRIPT,
      parameters: { customer: '42', status: 'open', limit: '50' },
    })
    // Loaded as in the wireframe, so a table the script names is checked against the catalog.
    await chipButton(sheet).click()
    await expect(tablesChip(sheet)).toHaveAttribute('data-state', 'settled', { timeout: 30_000 })

    await test.step('":" lists the Parameters entries under PARAMETERS', async () => {
      await cursorAtLineEnd(page, sheet, 4)
      await page.keyboard.type(':')
      await expect(completion(page)).toBeVisible()
      const sections = await suggestionSections(page)
      expect(sections.map((section) => [section.header, section.transform])).toEqual([['Parameters', 'uppercase']])
      expect(sections[0].rows.map((row) => row.label).sort()).toEqual(['customer', 'limit', 'status'])
      for (const row of sections[0].rows) {
        expect(row.icon, `${row.label} carries the ":" icon`).toContain('cm-completionIcon-sql-parameter')
      }
    })

    await test.step('picking status inserts it', async () => {
      await completion(page).locator('li[role="option"]').filter({ hasText: /^status$/ }).click()
      await expect(completion(page)).toBeHidden()
      await expect(editorLine(sheet, 4)).toHaveText('  AND status = :status')
    })

    await test.step('the amber strip: the unused parameter first, the session-state end in its list', async () => {
      await expect(strip(sheet)).toHaveText(new RegExp(`^${escapeRegExp(UNUSED_LIMIT)}\\s*\\(\\+1 more\\)$`), {
        timeout: 15_000,
      })
      await expect(strip(sheet), 'check warnings are advisory, not an alert').not.toHaveAttribute('role', 'alert')
      await expect(strip(sheet)).toHaveClass(/\bbg-amber-500\/10\b/)
      await sheet.locator('[data-testid="value-editor-validation-more"]').click()
      const list = page.locator('[data-testid="value-editor-validation-more-list"]')
      await expect(list).toBeVisible()
      await expect(list.locator('span')).toHaveText([UNUSED_LIMIT, SESSION_STATE_END])
      await sheet.locator('[data-testid="value-editor-sheet-drag-handle"]').click()
      await expect(list).toBeHidden()
    })

    await test.step('only the SET line carries the amber wavy underline', async () => {
      const underlined = await sheet.locator('.cm-content .cm-line').evaluateAll((lines) =>
        lines.map((line) => {
          const marks = Array.from(line.querySelectorAll('.cm-unknown-variable')).filter(
            (mark) => !mark.parentElement?.closest('.cm-unknown-variable'),
          )
          const style = marks[0] ? globalThis.getComputedStyle(marks[0]) : null
          return {
            text: marks.map((mark) => mark.textContent ?? '').join(''),
            line: style?.textDecorationLine ?? null,
            style: style?.textDecorationStyle ?? null,
            color: style?.textDecorationColor ?? null,
          }
        }),
      )
      expect(underlined.slice(0, 5).map((line) => line.text)).toEqual(['', '', '', '', ''])
      expect(underlined[5]).toEqual({
        text: 'SET search_path TO public;',
        line: 'underline',
        style: 'wavy',
        color: AMBER_UNDERLINE,
      })
    })

    await test.step('the warnings block neither Save nor Run', async () => {
      await expect(footerButton(sheet, 'value-editor-save-button')).toBeEnabled()
      await expect(footerButton(sheet, 'value-editor-run-button')).toBeEnabled()
    })
  })

  test('running: spinner and Stop replace Run, Save waits, the rest of the footer stays live (SQL-13)', async ({
    page,
  }) => {
    test.setTimeout(150_000)
    const nodeId = randomUUID()
    const testId = await seedTest(page.request, 'V-PLUGIN-SQL-02 running', [
      { id: nodeId, values: { ...CONNECTION, sql: 'SELECT pg_sleep(60)' } },
    ])
    await openTest(page, testId)
    await selectEnvironment(page)
    const config = await openConfig(page, nodeId)
    const sheet = await openStringParamSheet(config, page, 'sql')

    await footerButton(sheet, 'value-editor-run-button').click()
    const stop = footerButton(sheet, 'value-editor-stop-button')
    await expect(stop).toBeVisible({ timeout: 30_000 })

    await test.step('a spinner and a destructive Stop with a square icon stand where Run was', async () => {
      await expect(footerButton(sheet, 'value-editor-run-button')).toHaveCount(0)
      await expect(footerButton(sheet, 'value-editor-run-spinner')).toBeVisible()
      await expect(stop).toHaveText('Stop')
      await expect(stop).toHaveClass(/\bbtn-danger\b/)
      await expect(stop.locator('svg.lucide-square')).toHaveCount(1)
      const [spinner, stopBox, save] = await Promise.all([
        footerButton(sheet, 'value-editor-run-spinner').boundingBox(),
        stop.boundingBox(),
        footerButton(sheet, 'value-editor-save-button').boundingBox(),
      ])
      expect(spinner!.x, 'the spinner sits after Save').toBeGreaterThanOrEqual(save!.x + save!.width)
      expect(stopBox!.x, 'Stop sits after the spinner').toBeGreaterThanOrEqual(spinner!.x + spinner!.width)
    })

    await test.step('Save is disabled; Kind, F1 Help, Get Tables, Close and Stop are live at full strength', async () => {
      await expect(footerButton(sheet, 'value-editor-save-button')).toBeDisabled()
      const live = [
        footerButton(sheet, 'kind-dropdown'),
        footerButton(sheet, 'value-editor-help-chip'),
        chipButton(sheet),
        footerButton(sheet, 'value-editor-cancel-button'),
        stop,
      ]
      await expect(chipButton(sheet)).toHaveText('Get Tables')
      for (const control of live) {
        await expect(control).toBeEnabled()
        const strength = await atFullStrength(control)
        expect(strength.inDisabledFieldset).toBe(false)
        expect(new Set(strength.opacity)).toEqual(new Set(['1']))
      }
    })

    await test.step('Stop ends the run and Run comes back', async () => {
      await stop.click()
      await expect(footerButton(sheet, 'value-editor-run-button')).toBeVisible({ timeout: 30_000 })
      await expect(footerButton(sheet, 'value-editor-run-spinner')).toHaveCount(0)
      await expect(page.locator('[data-testid="workflow-status"]')).not.toHaveAttribute('data-status', 'running', {
        timeout: 30_000,
      })
    })
  })

  test('chip states: Get Tables, Connecting..., Getting tables..., Got 14 tables, Tables · 14 (SQL-12)', async ({
    page,
  }) => {
    test.setTimeout(120_000)
    const sheet = await openEditor(page, 'V-PLUGIN-SQL-02 chip states', { ...IN_SCHEMA, sql: 'SELECT 1' })

    await test.step('idle: Get Tables with the database icon, no spinner and no Stop', async () => {
      await expect(tablesChip(sheet)).toHaveAttribute('data-state', 'idle')
      await expect(chipButton(sheet)).toHaveText('Get Tables')
      await expect(chipButton(sheet).locator('svg.lucide-database')).toHaveCount(1)
      await expect(tablesChip(sheet).locator('[data-testid="get-tables-spinner"]')).toHaveCount(0)
      await expect(chipStop(sheet)).toHaveCount(0)
    })

    const pin = { status: 'connecting', deletes: 0 }
    const unpin = await pinCatalog(page, pin)
    try {
      await test.step('Connecting... then Getting tables..., each with a spinner and a square Stop', async () => {
        await chipButton(sheet).click()
        for (const [state, label] of [
          ['connecting', 'Connecting...'],
          ['reading', 'Getting tables...'],
        ] as const) {
          pin.status = state
          await expect(tablesChip(sheet)).toHaveAttribute('data-state', state)
          await expect(tablesChipStatus(sheet)).toHaveText(label)
          await expect(tablesChipStatus(sheet)).toBeVisible()
          await expect(tablesChip(sheet).locator('[data-testid="get-tables-spinner"]')).toBeVisible()
          await expect(chipStop(sheet)).toBeVisible()
          await expect(chipStop(sheet).locator('svg.lucide-square')).toHaveCount(1)
          await expect(chipButton(sheet)).toHaveCount(0)
        }
      })

      await test.step('Stop cancels the pull on the server and returns the chip to Get Tables', async () => {
        await chipStop(sheet).click()
        await expect(tablesChip(sheet)).toHaveAttribute('data-state', 'idle')
        await expect(chipButton(sheet)).toHaveText('Get Tables')
        expect(pin.deletes, 'Stop sent the cancel').toBe(1)
      })
    } finally {
      await unpin()
    }

    const successText = await resolvedColor(page, { style: 'var(--color-success-text)' })

    await test.step('a real pull: Got 14 tables with a check, settling by itself to Tables · 14', async () => {
      await chipButton(sheet).click()
      await page.mouse.move(4, 4)
      const done = await waitForChip(sheet, 'done', 30_000)
      expect(done).toEqual({
        state: 'done',
        text: `Got ${TABLE_COUNT} tables`,
        icons: [expect.stringContaining('lucide-check')],
        color: successText,
        refresh: false,
      })

      const settled = await waitForChip(sheet, 'settled', 6_000)
      expect(settled).toEqual({
        state: 'settled',
        text: `Tables · ${TABLE_COUNT}`,
        icons: [expect.stringContaining('lucide-database')],
        color: expect.any(String),
        refresh: true,
      })
    })

    await test.step('refresh re-pulls; the next keystroke settles Got 14 tables at once', async () => {
      const repull = page.waitForRequest(
        (request) =>
          request.method() === 'POST' &&
          /\/sql-tools\/catalog$/.test(new URL(request.url()).pathname) &&
          request.postDataJSON()?.refresh === true,
      )
      await chipRefresh(sheet).click()
      await repull
      await waitForChip(sheet, 'done', 30_000)
      await cursorAtLineEnd(page, sheet, 1)
      const typedAt = Date.now()
      await page.keyboard.type(';')
      const settled = await waitForChip(sheet, 'settled', 2_500)
      expect(Date.now() - typedAt, 'settled on the keystroke, not the three-second hold').toBeLessThan(1_500)
      expect(settled.text).toBe(`Tables · ${TABLE_COUNT}`)
      await leaveExpressionEditor(sheet)
    })
  })

  test('chip failed: Could not get tables, in the error color with the refusal in its tooltip (SQL-12)', async ({
    page,
  }) => {
    test.setTimeout(120_000)
    const sheet = await openEditor(page, 'V-PLUGIN-SQL-02 chip failed', {
      ...CONNECTION,
      password: `not-${SQL_STACK_PASSWORD}`,
      sql: 'SELECT 1',
    })
    const errorText = await resolvedColor(page, { className: 'text-error' })

    await chipButton(sheet).click()
    await expect(tablesChip(sheet)).toHaveAttribute('data-state', 'failed', { timeout: 60_000 })
    await expect(chipButton(sheet)).toHaveText('Could not get tables')
    await expect(chipButton(sheet).locator('svg.lucide-circle-alert')).toHaveCount(1)
    await expect(chipButton(sheet)).toHaveCSS('color', errorText)
    await expect(chipStop(sheet)).toHaveCount(0)
    await expect(chipRefresh(sheet)).toHaveCount(0)

    await chipButton(sheet).hover()
    const tooltip = page.locator('[data-slot="tooltip-content"]:not([data-state="closed"])')
    await expect(tooltip).toBeVisible({ timeout: 10_000 })
    await expect(tooltip.locator('[role="tooltip"]')).toContainText('password authentication failed')
  })
})
