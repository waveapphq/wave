/**
 * V-PLUGIN-SQL-EDITOR-FUNCTIONAL: The SQL editor against the stack's PostgreSQL
 * Design Decisions: SQL-10, SQL-11, SQL-12, SQL-13
 * REQ: REQ-3.4.1.6, REQ-3.4.1.19, REQ-5.1.4, REQ-3.2.2.4
 *
 * Pass Criteria:
 * 1. Get Tables from the footer chip starts a real pull (answered 202, not cached) and the
 *    chip shows Connecting... with a square Stop; Stop sends the cancel for that very job,
 *    the chip is back on Get Tables, and the pull's late answer never loads it.
 * 2. With nothing loaded, the suggestion list at a table position (after FROM) is headed
 *    Tables and offers Get tables from the database; choosing it inserts nothing and pulls:
 *    the chip goes Connecting... (Getting tables...) Got N tables, holds that for three
 *    seconds, then settles on Tables · N, N being the tables the pull answered, the spec's
 *    own two among them with their columns; the same position then suggests the tables.
 * 3. The Tables popover keeps the catalog's order, filters on the table name with the
 *    match underlined and the columns under each table, and choosing a table inserts it at
 *    the cursor; after `table.` the suggestion list offers that table's columns and
 *    choosing one inserts it.
 * 4. A table created after the pull is not in the popover until Refresh; Refresh re-pulls
 *    (refresh true, answered 202), a keystroke ends the Got N tables hold at once, and the
 *    new table is then listed.
 * 5. A second block on the same connection opens its editor with the chip already settled
 *    on the refreshed count and the new table listed, and no catalog pull is started.
 * 6. `SELECT TOP 1 ...` is flagged by the server check on PostgreSQL as an amber warning,
 *    not an error; Save still saves it into the config and Run still runs it, where the
 *    database judges: the block fails with `Statement 1 (...) failed: 42601: syntax error
 *    at or near "1"`.
 * 7. In Template kind a body holding `{{ }}` sends no syntax check and its warning goes
 *    away; on SQL Server the same `SELECT TOP 1 ...` body gets a check with no finding and
 *    no warning.
 * 8. Run from the editor runs this block alone with the saved SQL: `Connected to PostgreSQL
 *    ... at {host}:{port}`, `Statement 1: 2 rows, N ms`, the DEBUG Outputs line with Rows
 *    and Row count 2, and the bound variables hold the two rows; no other block ran.
 * 9. While `SELECT 1; SELECT pg_sleep(60)` runs from the editor (`Statement 1: 1 rows` is on
 *    the console, so the sleep is the statement on the database): Kind switches and switches
 *    back, F1 Help opens, Get Tables pulls and settles, Save stays dead on the changed draft,
 *    and the config behind is read-only.
 * 10. The editor's Stop ends that run within 10 s: session and block stopped, one WARN
 *    `Stopped by user` from the block, no `Statement 2` line, Run back; the probe block, run
 *    alone afterwards, finds in pg_stat_activity neither the tagged statement nor any
 *    connection with the blocks' application_name.
 * 11. Close stays usable during a second such run and leaves the run going; the canvas
 *    toolbar's Stop then ends it and the probe finds nothing left on the database either.
 * 12. A Get Tables that fails (Port 9479, where nothing listens) leaves the chip on Could not
 *    get tables and raises exactly one error toast, titled `Could not get tables`, whose message
 *    is the reason the server's catalog job gave (`Could not connect to PostgreSQL at
 *    {host}:9479: ...`); closing the editor raises no other.
 * 13. The editor's keys: Ctrl+/ turns the line under the cursor into a `-- ` comment, which Save
 *    keeps in the saved Test; Ctrl+F opens the find panel and Esc closes it with the editor
 *    still open; Ctrl+G opens the Go to line prompt on the cursor's line.
 * 14. SQLite: Get Tables on a block whose File holds two tables settles on `Tables · 2` and the
 *    popover lists both with their columns. With Driver option `isolation_level` the pull fails
 *    with `SQLite Driver option 'isolation_level' is not supported: SQLite takes timeout and
 *    cached_statements`. With a File that is not there the pull fails with `Could not open the
 *    SQLite file {file}: unable to open database file` and the file is still absent.
 * 15. Get Tables on a block with TLS on (the stack CA, Verify on) that holds no client
 *    certificate and no client key: the start is never refused, the chip loads the tables and
 *    the answer holds the spec's two tables, as a run of that block connects (REQ-3.1.3.21).
 *
 * Needs the stack's `postgres` service. Every table and tag carries a per-run token and the
 * tables are dropped in afterAll. The SQLite case needs no service: the spec builds its database
 * and uploads it to the Test's own Test Data.
 */

import { leaveExpressionEditor } from '../../helpers/code-editor'
import { fieldInput } from '../../helpers/value-field'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { DatabaseSync } from 'node:sqlite'

import {
  test,
  expect,
  type APIRequestContext,
  type Locator,
  type Page,
  type Route,
} from '../../helpers/playwright-fixtures'
import {
  getActiveSessionId,
  getSessionVariables,
  importValidateAndNavigate,
  injectServiceHost,
} from '../../helpers/fixture-import'
import { createValidTest, validateTest } from '../../helpers/fn-seed'
import { clearSettledWorkbenchSession, runTrackedTest } from '../../helpers/k8s-run'
import { clickNodeContextMenuItem, saveBtn, selectEnvironment } from '../../helpers/workbench'
import { getNode } from '../../helpers/element-types'
import { listTestDataPaths } from '../../helpers/testdata'
import {
  clearConsoleLogs,
  getLogCopyTexts,
  getLogTexts,
  setConsoleMinimumLevel,
  waitForLogText,
} from '../../helpers/log-reader'
import {
  BACKEND_URL,
  CA_CERT_PEM,
  POSTGRES_PORT,
  SQL_STACK_DATABASE,
  SQL_STACK_PASSWORD,
  SQL_STACK_USER,
  SQL_TARGET_HOST,
} from '../../helpers/config'
import { deleteTest, importWithTestData, openConfig, saveConfig } from '../file-picker/picker'
import { consoleEntriesFromCopy, newToken, withToken } from '../shell-blocks/shell-helpers'
import {
  closeConfigSheet,
  closeEditorWhileRunning,
  closeScriptSheet,
  expectEditorWhileRunning,
  openScriptSheet,
  runButton,
  saveButton,
  stopButton,
  stopRunFromToolbar,
  tablesChip,
  tablesChipStatus,
  tablesPopover,
  workflowStatus,
} from '../python-block/editor-helpers'

const NODE_A = '43e2e07d-8d2c-46d5-a9cd-64ca8f890eda'
const NODE_B = 'e5529cd5-847d-4868-b642-c005fe304dbc'
const NODE_PROBE = '49f223af-a9fb-4f72-8f54-821293f37011'
/** The console source of the blocks' own lines and of the stop line: the block name. */
const SOURCE_A = 'SQL'
const STOP_LINE = 'Stopped by user'

const TOKEN = newToken()
const ORDERS = `sqled_${TOKEN}_orders`
const ITEMS = `sqled_${TOKEN}_order_items`
const LATE = `sqled_${TOKEN}_late`

/** The probe block's tag: its Parameters look for it in pg_stat_activity. */
const SLEEP_TAG = `sqled-probe-${TOKEN}`
/** Statement 1 answers at once, so its console line shows the sleep is the one on the database. */
const SLEEP_SCRIPT = `SELECT 1 AS armed; SELECT pg_sleep(60) AS slept, '${SLEEP_TAG}' AS tag`
const ARMED_LINE = /^Statement 1: 1 rows, \d+ ms$/

const CATALOG_JOB = /\/sql-tools\/catalog\/[0-9a-f]{32}(\?.*)?$/

/** Nothing listens on this port of the stack host. */
const UNREACHABLE_PORT = '9479'
const TABLES_FAILED = 'Could not get tables'
/** The body the comment case types; Ctrl+/ comments the second line. */
const COMMENT_LINES = ['SELECT 1 AS one', 'WHERE 1 = 1']

const LITE_TABLES = '009b6107-3197-453c-86ef-55c8da36ec7c'
const LITE_OPTION = '1c1081ce-52ad-44e8-950e-d11d0c33cbe9'
const LITE_MISSING = '921ca481-e28b-481d-928a-4e2eca6139a7'
const LITE_FILE = `sqled-${TOKEN}.db`
const LITE_MISSING_FILE = `sqled-${TOKEN}-missing.db`
const LITE_OPTION_REFUSED =
  "SQLite Driver option 'isolation_level' is not supported: SQLite takes timeout and cached_statements"
/** What Get Tables answers for the uploaded database: tables by name, columns in their own order. */
const LITE_CATALOG = [
  {
    schema: 'main',
    name: 'customers',
    kind: 'table',
    columns: [
      { name: 'id', type: 'INTEGER' },
      { name: 'name', type: 'TEXT' },
    ],
  },
  {
    schema: 'main',
    name: 'orders',
    kind: 'table',
    columns: [
      { name: 'id', type: 'INTEGER' },
      { name: 'customer_id', type: 'INTEGER' },
      { name: 'total', type: 'REAL' },
    ],
  },
]

const createdTests: string[] = []

interface FixtureNode {
  id: string
  data: { config: { values: Record<string, unknown> } }
}

interface Fixture {
  name: string
  workflow: { nodes: FixtureNode[]; edges: Array<Record<string, unknown>> }
  variables: Record<string, unknown>
}

/** The fixture with this run's token, the stack login from config.ts and the mode's host. */
function sqlFixture(file: string): Fixture {
  const raw = JSON.parse(fs.readFileSync(path.resolve(__dirname, file), 'utf-8')) as Fixture
  const fixture = withToken(raw, TOKEN)
  for (const node of fixture.workflow.nodes) {
    Object.assign(node.data.config.values, {
      port: Number(POSTGRES_PORT),
      database: SQL_STACK_DATABASE,
      username: SQL_STACK_USER,
      password: SQL_STACK_PASSWORD,
    })
  }
  return injectServiceHost(
    fixture as unknown as Record<string, unknown>,
    SQL_TARGET_HOST,
  ) as unknown as Fixture
}

/** The SQLite fixture with this run's token; its blocks need no login and no host. */
function sqliteFixture(): Fixture {
  const raw = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, 'fixture-sqlite.json'), 'utf-8'),
  ) as Fixture
  return withToken(raw, TOKEN)
}

/** A SQLite database holding LITE_CATALOG's two tables, built in its own folder and read back as bytes. */
function twoTableDatabase(): Buffer {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'wave-e2e-sqled-'))
  try {
    const file = path.join(folder, LITE_FILE)
    const database = new DatabaseSync(file)
    database.exec('CREATE TABLE customers (id INTEGER PRIMARY KEY, name TEXT NOT NULL)')
    database.exec('CREATE TABLE orders (id INTEGER PRIMARY KEY, customer_id INTEGER, total REAL)')
    database.close()
    return fs.readFileSync(file)
  } finally {
    fs.rmSync(folder, { recursive: true, force: true })
  }
}

/** Run one statement script on the stack's PostgreSQL as a tracked run; answers its Row count. */
async function runAdmin(
  request: APIRequestContext,
  sql: string,
  parameters: Record<string, string> = {},
): Promise<number> {
  const fixture = sqlFixture('fixture-admin.json')
  Object.assign(fixture.workflow.nodes[0].data.config.values, { sql, parameters })
  const testId = await createValidTest(request, {
    name: `${fixture.name} ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    nodes: fixture.workflow.nodes as unknown as Array<Record<string, unknown>>,
    edges: fixture.workflow.edges,
    variables: fixture.variables,
  })
  try {
    const validation = await validateTest(request, testId, 'run')
    expect(validation.errors, JSON.stringify(validation.errors)).toEqual([])
    const { executionId, verdict } = await runTrackedTest(request, testId)
    expect(verdict, `the admin statement must pass: ${sql}`).toBe('passed')
    const response = await request.get(`${BACKEND_URL}/executions/${executionId}/variables`)
    expect(response.ok(), `GET /executions/${executionId}/variables`).toBeTruthy()
    const body = (await response.json()) as { data?: Record<string, unknown> }
    const stored = (body.data ?? body) as Record<string, unknown>
    const count = stored.admin_count
    const value =
      count !== null && typeof count === 'object' && 'value' in count
        ? (count as { value: unknown }).value
        : count
    return Number(value)
  } finally {
    await deleteTest(request, testId)
  }
}

/** The chip's loaded button, which opens the Tables popover. */
function tablesButton(sheet: Locator): Locator {
  return tablesChip(sheet).getByRole('button', { name: /^(Got \d+ tables?|Tables · \d+)$/ })
}

function editorContent(sheet: Locator): Locator {
  return sheet.locator('.cm-content').first()
}

function completionList(page: Page): Locator {
  return page.locator('.cm-tooltip-autocomplete')
}

function node(page: Page, nodeId: string): Locator {
  return page.getByTestId(`workflow-node-${nodeId}`)
}

/** Replace the editor text without the auto-closing brackets and quotes typing would add. */
async function setEditorText(page: Page, sheet: Locator, text: string): Promise<void> {
  await editorContent(sheet).click()
  await page.keyboard.press('Control+a')
  await page.keyboard.press('Delete')
  await page.keyboard.insertText(text)
  await expect(editorContent(sheet)).toHaveText(text)
  await leaveExpressionEditor(sheet)
}

/** Open the suggestion list at the cursor, asking for it when typing did not. */
async function expectSuggestions(page: Page): Promise<Locator> {
  const list = completionList(page)
  if (!(await list.isVisible())) {
    await expect(list)
      .toBeVisible({ timeout: 3_000 })
      .catch(() => page.keyboard.press('Control+Space'))
  }
  await expect(list).toBeVisible({ timeout: 10_000 })
  return list
}

/** Record every state the chip passes through, with the label it showed and when. */
async function recordChip(page: Page): Promise<void> {
  await page.evaluate(() => {
    const element = document.querySelector(
      '[data-testid="value-editor-sheet"] [data-testid="get-tables-chip"]',
    ) as HTMLElement
    const store = window as unknown as {
      __chipLog: Array<{ state: string; label: string; at: number }>
      __chipObserver?: MutationObserver
    }
    store.__chipObserver?.disconnect()
    store.__chipLog = []
    const observer = new MutationObserver(() => {
      const state = element.dataset.state ?? ''
      const label =
        element.querySelector('[data-testid="get-tables-status"]')?.textContent ?? ''
      const last = store.__chipLog[store.__chipLog.length - 1]
      if (last?.state !== state || last?.label !== label) {
        store.__chipLog.push({ state, label, at: performance.now() })
      }
    })
    observer.observe(element, {
      attributes: true,
      attributeFilter: ['data-state'],
      subtree: true,
      childList: true,
      characterData: true,
    })
    store.__chipObserver = observer
  })
}

async function chipLog(page: Page): Promise<Array<{ state: string; label: string; at: number }>> {
  return page.evaluate(
    () =>
      (window as unknown as { __chipLog: Array<{ state: string; label: string; at: number }> })
        .__chipLog,
  )
}

interface ToastRecord {
  error: boolean
  title: string
  message: string
}

/** Record every toast raised from now on, with its title and message, even once it has faded. */
async function recordToasts(page: Page): Promise<void> {
  await page.evaluate(() => {
    const store = window as unknown as {
      __toastLog: Array<{ error: boolean; title: string; message: string }>
      __toastObserver?: MutationObserver
    }
    store.__toastObserver?.disconnect()
    store.__toastLog = []
    const seen = new WeakSet<Element>(Array.from(document.querySelectorAll('[data-toast]')))
    const observer = new MutationObserver(() => {
      for (const toast of Array.from(document.querySelectorAll('[data-toast]'))) {
        if (seen.has(toast)) continue
        seen.add(toast)
        store.__toastLog.push({
          error: toast.classList.contains('toast-error'),
          title: toast.querySelector('.font-semibold')?.textContent ?? '',
          message: toast.querySelector('.text-sm.text-muted')?.textContent ?? '',
        })
      }
    })
    observer.observe(document.body, { childList: true, subtree: true })
    store.__toastObserver = observer
  })
}

async function toastLog(page: Page): Promise<ToastRecord[]> {
  return page.evaluate(() => (window as unknown as { __toastLog: ToastRecord[] }).__toastLog)
}

interface CatalogTable {
  schema: string
  name: string
  columns: Array<{ name: string }>
}

interface CatalogCalls {
  starts: Array<{ refresh: boolean }>
  answers: CatalogTable[][]
}

/** Every catalog start the page sends, and the tables of every catalog answer that carries them. */
function watchCatalog(page: Page): CatalogCalls {
  const calls: CatalogCalls = { starts: [], answers: [] }
  page.on('request', (request) => {
    if (isCatalogStart(request.url(), request.method())) {
      const body = request.postDataJSON() as { refresh?: boolean } | null
      calls.starts.push({ refresh: body?.refresh === true })
    }
  })
  page.on('response', async (response) => {
    if (!new URL(response.url()).pathname.includes('/sql-tools/catalog')) return
    const body = (await response.json().catch(() => null)) as {
      data?: { tables?: CatalogTable[] }
    } | null
    if (body?.data?.tables) calls.answers.push(body.data.tables)
  })
  return calls
}

function isCatalogStart(url: string, method: string): boolean {
  return method === 'POST' && new URL(url).pathname.endsWith('/sql-tools/catalog')
}

/** The reason of every catalog job that answers failed, in the order the answers arrive. */
function watchCatalogFailures(page: Page): string[] {
  const reasons: string[] = []
  page.on('response', async (response) => {
    if (response.request().method() !== 'GET' || !CATALOG_JOB.test(response.url())) return
    const body = (await response.json().catch(() => null)) as {
      data?: { status?: string; error?: string }
    } | null
    if (body?.data?.status === 'failed') reasons.push(body.data.error ?? '')
  })
  return reasons
}

/** Hold the first poll of a pull until released, so a Stop lands while the pull is in flight. */
async function holdFirstPoll(
  page: Page,
): Promise<{ held: Promise<string>; release: () => void; done: () => Promise<void> }> {
  let open!: () => void
  const gate = new Promise<void>((resolve) => {
    open = resolve
  })
  let caught!: (url: string) => void
  const held = new Promise<string>((resolve) => {
    caught = resolve
  })
  let taken = false
  const handler = async (route: Route): Promise<void> => {
    if (taken || route.request().method() !== 'GET') {
      await route.fallback()
      return
    }
    taken = true
    caught(route.request().url())
    await gate
    await route.continue()
  }
  await page.route(CATALOG_JOB, handler)
  return { held, release: () => open(), done: () => page.unroute(CATALOG_JOB, handler) }
}

async function openSqlEditor(page: Page, nodeId: string): Promise<{ dialog: Locator; sheet: Locator }> {
  const dialog = await openConfig(page, nodeId)
  const sheet = await openScriptSheet(page, dialog, 'sql')
  return { dialog, sheet }
}

async function importEditorTest(page: Page): Promise<string> {
  const testId = await importValidateAndNavigate(
    page,
    sqlFixture('fixture.json') as unknown as Record<string, unknown>,
  )
  createdTests.push(testId)
  // Expand the console before a sheet can sit over its header.
  await getLogTexts(page)
  await selectEnvironment(page)
  return testId
}

/** A Get Tables that must fail with one toast: answers the reason the catalog job gave. */
async function failedPullReason(page: Page, nodeId: string, failures: string[]): Promise<string> {
  const { dialog, sheet } = await openSqlEditor(page, nodeId)
  await expect(tablesChip(sheet)).toHaveAttribute('data-state', 'idle')
  await recordToasts(page)
  const before = failures.length
  await tablesChip(sheet).getByRole('button', { name: 'Get Tables' }).click()
  await expect(tablesChip(sheet)).toHaveAttribute('data-state', 'failed', { timeout: 60_000 })
  await expect(tablesChipStatus(sheet)).toHaveText(TABLES_FAILED)
  await expect
    .poll(() => failures.length, { message: 'the catalog job answered failed' })
    .toBe(before + 1)
  const reason = failures[before]
  await expect
    .poll(() => toastLog(page), { message: 'one error toast carries the reason' })
    .toEqual([{ error: true, title: TABLES_FAILED, message: reason }])
  await closeScriptSheet(page, sheet)
  await closeConfigSheet(page, dialog)
  return reason
}

/** The console lines the stack's blocks wrote, read from each row's full copy text. */
async function consoleEntries(page: Page): Promise<Array<{ level: string; source: string; message: string }>> {
  return consoleEntriesFromCopy(await getLogCopyTexts(page))
}

/** Wait until a console line from the SQL blocks matches `pattern` and answer it. */
async function waitForSqlLine(page: Page, pattern: RegExp, timeout = 60_000): Promise<string> {
  let found = ''
  await expect
    .poll(
      async () => {
        const hit = (await consoleEntries(page)).find(
          (entry) => entry.source === SOURCE_A && pattern.test(entry.message),
        )
        found = hit?.message ?? ''
        return found
      },
      { timeout, message: `expected a console line matching ${pattern}` },
    )
    .not.toBe('')
  return found
}

/** Run the probe block alone, on a fresh console each time, until pg_stat_activity holds nothing of ours. */
async function expectNothingLeftOnDatabase(page: Page, message: string): Promise<void> {
  await expect(async () => {
    await clearConsoleLogs(page)
    await clickNodeContextMenuItem(page, NODE_PROBE, 'Run Current')
    await expect(workflowStatus(page)).toHaveAttribute('data-status', 'passed', { timeout: 60_000 })
    const line = await waitForSqlLine(page, /^Statement 1: \d+ rows, \d+ ms$/, 30_000)
    expect(line, message).toMatch(/^Statement 1: 0 rows, /)
  }).toPass({ timeout: 90_000, intervals: [1_000, 2_000] })
}

test.describe('V-PLUGIN-SQL-EDITOR-FUNCTIONAL: the SQL editor against a real PostgreSQL (SQL-10 to SQL-13)', () => {
  test.beforeAll(async ({ request }) => {
    await runAdmin(
      request,
      [
        `CREATE TABLE ${ORDERS} (id integer PRIMARY KEY, status text, total integer)`,
        `CREATE TABLE ${ITEMS} (id integer PRIMARY KEY, order_id integer, sku text)`,
        `INSERT INTO ${ORDERS} VALUES (1, 'open', 10), (2, 'shipped', 20)`,
      ].join(';\n'),
    )
  })

  test.afterAll(async ({ request }) => {
    // A failed step can leave a run going, and no tracked run starts beside it.
    await request.delete(`${BACKEND_URL}/workbench/session/`).catch(() => undefined)
    await runAdmin(request, `DROP TABLE IF EXISTS ${ORDERS}, ${ITEMS}, ${LATE}`)
    while (createdTests.length > 0) {
      await deleteTest(request, createdTests.pop() as string)
    }
    await clearSettledWorkbenchSession(request)
  })

  test('SQL-12: Get Tables pulls, stops, refreshes, searches and inserts, and one pull serves both blocks', async ({
    page,
  }) => {
    test.setTimeout(300_000)
    const calls = watchCatalog(page)
    await importEditorTest(page)
    const { dialog, sheet } = await openSqlEditor(page, NODE_A)
    await expect(tablesChip(sheet)).toHaveAttribute('data-state', 'idle')
    await expect(tablesChipStatus(sheet)).toHaveText('Get Tables')

    await test.step('Stop during a pull started from the chip interrupts it', async () => {
      const hold = await holdFirstPoll(page)
      const started = page.waitForResponse((r) => isCatalogStart(r.url(), r.request().method()))
      await tablesChip(sheet).getByRole('button', { name: 'Get Tables' }).click()
      const answer = (await (await started).json()) as { data: { job_id: string; cached: boolean } }
      expect(answer.data.cached, 'a fresh connection starts a real pull').toBe(false)
      const jobId = answer.data.job_id
      await hold.held
      await expect(tablesChip(sheet)).toHaveAttribute('data-state', 'connecting')
      await expect(tablesChipStatus(sheet)).toHaveText('Connecting...')

      const canceled = page.waitForRequest(
        (r) => r.method() === 'DELETE' && new URL(r.url()).pathname.endsWith(`/sql-tools/catalog/${jobId}`),
      )
      await tablesChip(sheet).getByRole('button', { name: 'Stop getting tables' }).click()
      await canceled
      await expect(tablesChip(sheet)).toHaveAttribute('data-state', 'idle')
      await expect(tablesChipStatus(sheet)).toHaveText('Get Tables')

      await recordChip(page)
      const late = page.waitForResponse(
        (r) => r.request().method() === 'GET' && new URL(r.url()).pathname.endsWith(`/sql-tools/catalog/${jobId}`),
      )
      hold.release()
      await late
      await hold.done()
    })

    let pulled: CatalogTable[] = []
    await test.step('the Tables suggestion row at a table position starts the pull', async () => {
      await editorContent(sheet).click()
      await page.keyboard.press('Control+a')
      await page.keyboard.press('Delete')
      await page.keyboard.type('SELECT * FROM ')
      const list = await expectSuggestions(page)
      await expect(list.locator('.cm-completionSection')).toHaveText(['Tables'])
      const row = list.getByRole('option', { name: 'Get tables from the database' })
      await expect(row).toBeVisible()
      expect(await chipLog(page), 'the stopped pull never loaded the chip').toEqual([])

      const answersBefore = calls.answers.length
      await row.click()
      await expect(editorContent(sheet), 'the action row inserts nothing').toHaveText('SELECT * FROM ')
      await expect(tablesChip(sheet)).toHaveAttribute('data-state', 'settled', { timeout: 60_000 })
      await expect
        .poll(() => calls.answers.length, { message: 'the pull answered its tables' })
        .toBeGreaterThan(answersBefore)
      pulled = calls.answers[calls.answers.length - 1]
      // SQL-11: once loaded, the same table position suggests the tables themselves.
      const loaded = await expectSuggestions(page)
      await expect(loaded.getByRole('option', { name: 'Get tables from the database' })).toHaveCount(0)
      await expect(loaded.getByRole('option', { name: ORDERS, exact: true })).toBeVisible()
      await expect(loaded.getByRole('option', { name: ITEMS, exact: true })).toBeVisible()
      await leaveExpressionEditor(sheet)
    })

    await test.step('the chip passes through its states, holds Got N tables for three seconds, then settles', async () => {
      const count = pulled.length
      const ours = pulled.filter((table) => table.name.includes(TOKEN))
      expect(ours.map((table) => [table.name, table.columns.map((column) => column.name)])).toEqual([
        [ITEMS, ['id', 'order_id', 'sku']],
        [ORDERS, ['id', 'status', 'total']],
      ])
      const log = await chipLog(page)
      const dump = JSON.stringify(log)
      expect(log.map((entry) => entry.state).join(','), dump).toMatch(
        /^connecting,(reading,)?done,settled$/,
      )
      const labels = Object.fromEntries(log.map((entry) => [entry.state, entry.label]))
      expect(labels, dump).toEqual({
        connecting: 'Connecting...',
        ...(labels.reading === undefined ? {} : { reading: 'Getting tables...' }),
        done: `Got ${count} tables`,
        settled: `Tables · ${count}`,
      })
      const done = log.find((entry) => entry.state === 'done')!
      const settled = log.find((entry) => entry.state === 'settled')!
      expect(settled.at - done.at, `Got N tables holds about three seconds. ${dump}`).toBeGreaterThan(
        2_500,
      )
    })

    await test.step('the Tables popover filters in catalog order and inserts the chosen table at the cursor', async () => {
      await tablesButton(sheet).click()
      const popover = tablesPopover(page)
      await expect(popover).toBeVisible()
      const search = popover.getByRole('combobox', { name: 'Search tables' })
      await search.fill(`${TOKEN}_order`)
      const items = popover.locator('[data-testid^="tables-popover-item-"]')
      await expect(items).toHaveCount(2)
      expect(
        await items.evaluateAll((elements) => elements.map((element) => element.getAttribute('data-testid'))),
      ).toEqual([`tables-popover-item-${ITEMS}`, `tables-popover-item-${ORDERS}`])
      await expect(popover.getByTestId('tables-popover-match')).toHaveText([
        `${TOKEN}_order`,
        `${TOKEN}_order`,
      ])
      await expect(popover.getByTestId(`tables-popover-columns-${ORDERS}`)).toHaveText(
        /^id\s+status\s+total$/,
      )
      await expect(popover.getByTestId(`tables-popover-columns-${ITEMS}`)).toHaveText(
        /^id\s+order_id\s+sku$/,
      )
      await search.fill(`${TOKEN}_orders`)
      await expect(items).toHaveCount(1)
      await popover.getByTestId(`tables-popover-item-${ORDERS}`).click()
      await expect(popover).toBeHidden()
      await expect(editorContent(sheet)).toHaveText(`SELECT * FROM ${ORDERS}`)
    })

    await test.step('after table. the suggestions are its columns and choosing one inserts it', async () => {
      await editorContent(sheet).click()
      await page.keyboard.press('Control+End')
      await page.keyboard.type(` WHERE ${ORDERS}.`)
      const list = await expectSuggestions(page)
      await expect(list.getByRole('option', { name: 'id', exact: true })).toBeVisible()
      await expect(list.getByRole('option', { name: 'total', exact: true })).toBeVisible()
      await list.getByRole('option', { name: 'status', exact: true }).click()
      await expect(editorContent(sheet)).toHaveText(
        `SELECT * FROM ${ORDERS} WHERE ${ORDERS}.status`,
      )
      await leaveExpressionEditor(sheet)
    })

    let refreshed: CatalogTable[] = []
    await test.step('a table made after the pull shows only after Refresh, which re-pulls', async () => {
      // Made from this editor's own Run: a tracked run started beside the open test takes the workbench over.
      await setEditorText(page, sheet, `CREATE TABLE ${LATE} (id integer)`)
      await runButton(sheet).click()
      await expect(workflowStatus(page)).toHaveAttribute('data-status', 'passed', { timeout: 90_000 })
      await waitForSqlLine(page, /^Statement 1: 0 rows changed, \d+ ms$/)
      await tablesButton(sheet).click()
      const popover = tablesPopover(page)
      await popover.getByRole('combobox', { name: 'Search tables' }).fill(`${TOKEN}_late`)
      await expect(popover.getByText('No matching tables')).toBeVisible()
      await editorContent(sheet).click()
      await expect(popover).toBeHidden()

      await recordChip(page)
      const startsBefore = calls.starts.length
      const answersBefore = calls.answers.length
      const started = page.waitForResponse((r) => isCatalogStart(r.url(), r.request().method()))
      await tablesChip(sheet).getByRole('button', { name: 'Refresh tables' }).click()
      expect((await started).status(), 'Refresh starts a new pull').toBe(202)
      expect(calls.starts.slice(startsBefore)).toEqual([{ refresh: true }])
      // A keystroke in the editor ends the Got N tables hold at once.
      await editorContent(sheet).click()
      await page.keyboard.press('Control+End')
      await page.waitForFunction(
        () =>
          document
            .querySelector('[data-testid="value-editor-sheet"] [data-testid="get-tables-chip"]')
            ?.getAttribute('data-state') === 'done',
        undefined,
        { polling: 'raf', timeout: 60_000 },
      )
      await page.keyboard.type(' ')
      await expect(tablesChip(sheet)).toHaveAttribute('data-state', 'settled')
      await page.keyboard.press('Backspace')
      await leaveExpressionEditor(sheet)
      const log = await chipLog(page)
      const done = log.find((entry) => entry.state === 'done')!
      const settled = log.find((entry) => entry.state === 'settled')!
      expect(settled.at - done.at, JSON.stringify(log)).toBeLessThan(2_500)

      await expect
        .poll(() => calls.answers.length, { message: 'the refresh answered its tables' })
        .toBeGreaterThan(answersBefore)
      refreshed = calls.answers[calls.answers.length - 1]
      expect(refreshed.map((table) => table.name)).toContain(LATE)
      await expect(tablesChipStatus(sheet)).toHaveText(`Tables · ${refreshed.length}`)
      await tablesButton(sheet).click()
      await popover.getByRole('combobox', { name: 'Search tables' }).fill(`${TOKEN}_late`)
      await expect(popover.getByTestId(`tables-popover-item-${LATE}`)).toBeVisible()
      await editorContent(sheet).click()
      await expect(popover).toBeHidden()
    })

    await test.step('the second block on the same connection reuses the pull', async () => {
      await closeScriptSheet(page, sheet)
      await closeConfigSheet(page, dialog)
      const startsBefore = calls.starts.length
      const second = await openSqlEditor(page, NODE_B)
      await expect(tablesChip(second.sheet)).toHaveAttribute('data-state', 'settled')
      await expect(tablesChipStatus(second.sheet)).toHaveText(`Tables · ${refreshed.length}`)
      await tablesButton(second.sheet).click()
      const popover = tablesPopover(page)
      await popover.getByRole('combobox', { name: 'Search tables' }).fill(`${TOKEN}_late`)
      await expect(popover.getByTestId(`tables-popover-item-${LATE}`)).toBeVisible()
      await editorContent(second.sheet).click()
      await expect(popover).toBeHidden()
      expect(calls.starts.length, 'the second editor starts no pull').toBe(startsBefore)
      await closeScriptSheet(page, second.sheet)
      await closeConfigSheet(page, second.dialog)
    })
  })

  test('SQL-10: syntax warnings follow the Database type and never block Save or Run; {{ }} is not checked', async ({
    page,
  }) => {
    test.setTimeout(300_000)
    const checks: Array<{ database_type: string; script: string }> = []
    page.on('request', (request) => {
      if (request.method() === 'POST' && new URL(request.url()).pathname.endsWith('/sql-tools/check')) {
        checks.push(request.postDataJSON() as { database_type: string; script: string })
      }
    })
    const isCheckOf = (databaseType: string, script: string) => (r: { url(): string; request(): { method(): string; postDataJSON(): unknown } }) => {
      if (r.request().method() !== 'POST' || !new URL(r.url()).pathname.endsWith('/sql-tools/check')) return false
      const body = r.request().postDataJSON() as { database_type: string; script: string }
      return body.database_type === databaseType && body.script === script
    }
    const top = `SELECT TOP 1 id, status FROM ${ORDERS} ORDER BY id`
    const templated = 'SELECT TOP 1 id FROM {{ sqled_table }}'

    const testId = await importEditorTest(page)
    const { dialog, sheet } = await openSqlEditor(page, NODE_A)
    const strip = sheet.getByTestId('value-editor-validation')

    await test.step('PostgreSQL flags SELECT TOP as an amber warning', async () => {
      const checked = page.waitForResponse(isCheckOf('postgresql', top))
      await setEditorText(page, sheet, top)
      const answer = (await (await checked).json()) as { data: { issues: Array<{ message: string }> } }
      expect(answer.data.issues.map((issue) => issue.message)).toContain(
        'Invalid expression / Unexpected token',
      )
      await expect(strip).toHaveText(/^Line 1: Invalid expression \/ Unexpected token/)
      await expect(strip, 'a syntax finding is a warning, not a blocking error').not.toHaveAttribute(
        'role',
        'alert',
      )
    })

    await test.step('Save saves the flagged SQL into the config', async () => {
      await expect(saveButton(sheet)).toBeEnabled()
      await saveButton(sheet).click()
      await expect(sheet).toBeVisible()
      await expect(saveButton(sheet)).toBeDisabled()
      await expect(fieldInput(dialog, 'sql')).toHaveValue(top)
    })

    await test.step('Run runs the flagged SQL and PostgreSQL judges it', async () => {
      await expect(runButton(sheet)).toBeEnabled()
      await runButton(sheet).click()
      await expect(workflowStatus(page)).toHaveAttribute('data-status', 'failed', { timeout: 90_000 })
      const failure = `Statement 1 (${top}) failed: 42601: syntax error at or near "1"`
      await waitForLogText(page, failure, 30_000)
      const entries = consoleEntriesFromCopy(await getLogCopyTexts(page))
      expect(entries.filter((entry) => entry.message === failure), JSON.stringify(entries, null, 2)).toEqual([
        { level: 'ERROR', source: SOURCE_A, message: failure },
      ])
      await expect(node(page, NODE_A)).toHaveAttribute('data-execution-status', 'failed')
      await expect(runButton(sheet)).toBeEnabled({ timeout: 10_000 })
    })

    await test.step('a Template body holding {{ }} is not syntax-checked', async () => {
      await sheet.getByTestId('kind-dropdown').click()
      await page.getByRole('option', { name: 'Template', exact: true }).click()
      await expect(sheet.getByTestId('kind-dropdown')).toHaveText('Template')
      await expect(strip, 'the flagged body is still flagged in Template kind').toBeVisible({
        timeout: 10_000,
      })
      await setEditorText(page, sheet, templated)
      await expect(strip, 'the {{ }} body carries no syntax warning').toHaveCount(0, {
        timeout: 10_000,
      })
      expect(
        checks.filter((check) => check.script.includes('{{')),
        'a body holding {{ }} never goes to the syntax check',
      ).toEqual([])
      await closeScriptSheet(page, sheet)
    })

    await test.step('SQL Server takes the same SELECT TOP without a warning', async () => {
      await dialog.getByRole('combobox', { name: 'Database type' }).click()
      await page.getByRole('option', { name: 'SQL Server', exact: true }).click()
      await expect(dialog.getByRole('combobox', { name: 'Database type' })).toContainText('SQL Server')
      const checked = page.waitForResponse(isCheckOf('mssql', top))
      const mssqlSheet = await openScriptSheet(page, dialog, 'sql')
      await expect(editorContent(mssqlSheet)).toHaveText(top)
      const answer = (await (await checked).json()) as { data: { issues: unknown[] } }
      expect(answer.data.issues).toEqual([])
      await expect(mssqlSheet.getByTestId('value-editor-validation')).toHaveCount(0)
      await closeScriptSheet(page, mssqlSheet)
    })

    await closeConfigSheet(page, dialog)
    expect(testId).toBeTruthy()
  })

  test('SQL-13: Run from the editor shows the rows, and Stop cancels a long statement on the database', async ({
    page,
  }) => {
    test.setTimeout(360_000)

    await importEditorTest(page)
    await setConsoleMinimumLevel(page, 'DEBUG')
    let { dialog, sheet } = await openSqlEditor(page, NODE_A)

    await test.step('Run from the editor runs this block alone and shows its rows', async () => {
      await runButton(sheet).click()
      await expect(workflowStatus(page)).toHaveAttribute('data-status', 'passed', { timeout: 90_000 })
      await waitForLogText(page, 'Outputs:', 30_000)
      const entries = await consoleEntries(page)
      const dump = JSON.stringify(entries, null, 2)
      const own = entries.filter((entry) => entry.source === SOURCE_A)
      const connected = new RegExp(
        `^Connected to PostgreSQL \\S.* at ${SQL_TARGET_HOST.replaceAll('.', '\\.')}:${POSTGRES_PORT}$`,
      )
      expect(own.filter((entry) => connected.test(entry.message)).map((entry) => entry.level), dump).toEqual([
        'INFO',
      ])
      expect(
        own.filter((entry) => /^Statement 1: 2 rows, \d+ ms$/.test(entry.message)).map((entry) => entry.level),
        dump,
      ).toEqual(['INFO'])
      const outputs = own.filter((entry) => entry.message.startsWith('Outputs:'))
      expect(outputs.map((entry) => entry.level), dump).toEqual(['DEBUG'])
      expect(outputs[0].message).toContain('"rows":"Table([id, status, total], 2 rows)"')
      expect(outputs[0].message).toContain('"row_count":2')

      const variables = await getSessionVariables(page, await getActiveSessionId(page))
      expect(variables.sqled_count?.value, JSON.stringify(variables)).toBe(2)
      const rows = JSON.stringify(variables.sqled_rows?.value)
      for (const cell of ['open', 'shipped', '10', '20']) expect(rows, 'the bound Rows').toContain(cell)
      await expect(node(page, NODE_A)).toHaveAttribute('data-execution-status', 'success')
      for (const other of [NODE_B, NODE_PROBE]) {
        const status = await node(page, other).getAttribute('data-execution-status')
        expect(status === 'success' || status === 'running', `${other} ran: ${status}`).toBe(false)
      }
    })

    await test.step('a long statement goes to the database', async () => {
      await setEditorText(page, sheet, SLEEP_SCRIPT)
      await runButton(sheet).click()
      await expect(stopButton(sheet)).toBeVisible({ timeout: 20_000 })
      await waitForSqlLine(page, ARMED_LINE)
      await expect(workflowStatus(page)).toHaveAttribute('data-status', 'running')
    })

    await test.step('Kind, F1 Help and Get Tables stay usable during the run; Save and the config do not', async () => {
      const kind = sheet.getByTestId('kind-dropdown')
      await kind.click()
      await page.getByRole('option', { name: 'Template', exact: true }).click()
      await expect(kind).toHaveText('Template')
      await kind.click()
      await page.getByRole('option', { name: 'Literal', exact: true }).click()
      await expect(kind).toHaveText('Literal')

      await expectEditorWhileRunning(page, dialog, sheet, 'sql')

      await tablesChip(sheet).getByRole('button', { name: 'Get Tables' }).click()
      await expect(tablesChip(sheet)).toHaveAttribute('data-state', /^(done|settled)$/, { timeout: 60_000 })
      await expect(tablesChipStatus(sheet)).toHaveText(/^(Got \d+ tables|Tables · \d+)$/)
      await expect(workflowStatus(page)).toHaveAttribute('data-status', 'running')
    })

    await test.step("the editor's Stop ends the run within a few seconds", async () => {
      const clicked = Date.now()
      await stopButton(sheet).click()
      await expect(workflowStatus(page)).toHaveAttribute('data-status', 'stopped', { timeout: 10_000 })
      expect(Date.now() - clicked, 'Stop must not wait for the 60 s statement').toBeLessThan(10_000)
      await expect(runButton(sheet)).toBeEnabled({ timeout: 10_000 })
      await expect(stopButton(sheet)).toHaveCount(0)
      await expect(node(page, NODE_A)).toHaveAttribute('data-execution-status', 'stopped')
      await waitForLogText(page, STOP_LINE, 30_000)
      const entries = await consoleEntries(page)
      const dump = JSON.stringify(entries, null, 2)
      expect(entries.filter((entry) => entry.message === STOP_LINE), dump).toEqual([
        { level: 'WARN', source: SOURCE_A, message: STOP_LINE },
      ])
      expect(
        entries.filter((entry) => entry.message.startsWith('Statement 2')),
        `the sleep never finished\n${dump}`,
      ).toEqual([])
    })

    await test.step('the statement and its connection are gone from the database', async () => {
      await closeScriptSheet(page, sheet)
      await closeConfigSheet(page, dialog)
      await expectNothingLeftOnDatabase(
        page,
        'Stop must cancel the statement on the database and close its connection',
      )
    })

    await test.step('Close stays usable during a run; the toolbar Stop then ends it on the database too', async () => {
      // The open editor covers the console header, so the console is cleared first.
      await clearConsoleLogs(page)
      ;({ dialog, sheet } = await openSqlEditor(page, NODE_A))
      await setEditorText(page, sheet, SLEEP_SCRIPT)
      await runButton(sheet).click()
      await expect(stopButton(sheet)).toBeVisible({ timeout: 20_000 })
      await waitForSqlLine(page, ARMED_LINE)
      await closeEditorWhileRunning(page, sheet)
      await stopRunFromToolbar(page)
      await closeConfigSheet(page, dialog)
      await expectNothingLeftOnDatabase(
        page,
        'the toolbar Stop must cancel the statement on the database too',
      )
    })
  })

  test('SQL-12: a failed Get Tables raises one toast, Could not get tables, with the reason the server gave', async ({
    page,
  }) => {
    test.setTimeout(180_000)
    const reasons: string[] = []
    page.on('response', async (response) => {
      if (response.request().method() !== 'GET' || !CATALOG_JOB.test(response.url())) return
      const body = (await response.json().catch(() => null)) as {
        data?: { status?: string; error?: string }
      } | null
      if (body?.data?.status === 'failed') reasons.push(body.data.error ?? '')
    })

    await importEditorTest(page)
    const dialog = await openConfig(page, NODE_B)
    const port = dialog.getByTestId('param-input-port')
    await port.fill(UNREACHABLE_PORT)
    await expect(port).toHaveValue(UNREACHABLE_PORT)
    const sheet = await openScriptSheet(page, dialog, 'sql')
    await expect(tablesChip(sheet)).toHaveAttribute('data-state', 'idle')
    await recordToasts(page)

    await tablesChip(sheet).getByRole('button', { name: 'Get Tables' }).click()
    await expect(tablesChip(sheet)).toHaveAttribute('data-state', 'failed', { timeout: 90_000 })
    await expect(tablesChipStatus(sheet)).toHaveText(TABLES_FAILED)
    await expect.poll(() => reasons.length, { message: 'the catalog job answered failed' }).toBe(1)
    const reason = reasons[0]
    expect(reason, 'the server names the address it could not reach').toMatch(
      new RegExp(`^Could not connect to PostgreSQL at ${SQL_TARGET_HOST.replaceAll('.', '\\.')}:${UNREACHABLE_PORT}: \\S`),
    )
    await expect
      .poll(() => toastLog(page), { message: 'one error toast carries the reason' })
      .toEqual([{ error: true, title: TABLES_FAILED, message: reason }])

    await closeScriptSheet(page, sheet)
    await closeConfigSheet(page, dialog)
    expect(await toastLog(page), 'no second toast for the same failure').toEqual([
      { error: true, title: TABLES_FAILED, message: reason },
    ])
  })

  test('SQL-12: Get Tables over TLS with no client certificate or key lists the tables, as a run connects', async ({
    page,
  }) => {
    test.setTimeout(180_000)
    const calls = watchCatalog(page)
    const refusals: string[] = []
    page.on('response', async (response) => {
      if (!isCatalogStart(response.url(), response.request().method()) || response.ok()) return
      refusals.push(`${response.status()} ${await response.text().catch(() => '')}`)
    })
    const fixture = sqlFixture('fixture.json')
    const values = fixture.workflow.nodes.find((candidate) => candidate.id === NODE_B)!.data.config.values
    Object.assign(values, { tls: true, verify_ssl: true, ca_cert: CA_CERT_PEM })
    expect(Object.keys(values), 'the block holds no client certificate').not.toContain('client_cert')
    expect(Object.keys(values), 'the block holds no client key').not.toContain('client_key')
    createdTests.push(await importValidateAndNavigate(page, fixture as unknown as Record<string, unknown>))
    await getLogTexts(page)
    await selectEnvironment(page)

    const { dialog, sheet } = await openSqlEditor(page, NODE_B)
    await expect(tablesChip(sheet)).toHaveAttribute('data-state', 'idle')
    await tablesChip(sheet).getByRole('button', { name: 'Get Tables' }).click()
    await expect(tablesButton(sheet), 'the pull over TLS loads the tables').toBeVisible({ timeout: 60_000 })
    expect(refusals, 'the server takes the rows the block does not hold as nothing given (I6)').toEqual([])
    await expect.poll(() => calls.answers.length, { message: 'the pull answered its tables' }).toBeGreaterThan(0)
    expect(calls.answers.at(-1)!.map((table) => table.name)).toEqual(expect.arrayContaining([ORDERS, ITEMS]))

    await closeScriptSheet(page, sheet)
    await closeConfigSheet(page, dialog)
  })

  test('SQL-10: Ctrl+/ comments a line with -- and Save keeps it; Ctrl+F opens find and Esc closes it', async ({
    page,
    request,
  }) => {
    test.setTimeout(180_000)
    const testId = await importEditorTest(page)
    const { dialog, sheet } = await openSqlEditor(page, NODE_B)
    const lines = sheet.locator('.cm-line')

    await test.step('Ctrl+/ turns the line under the cursor into a -- comment', async () => {
      await editorContent(sheet).click()
      await page.keyboard.press('ControlOrMeta+a')
      await page.keyboard.press('Delete')
      await page.keyboard.insertText(COMMENT_LINES.join('\n'))
      await leaveExpressionEditor(sheet)
      await expect(lines).toHaveText(COMMENT_LINES)
      await lines.nth(1).click()
      await page.keyboard.press('ControlOrMeta+/')
      await expect(lines).toHaveText([COMMENT_LINES[0], `-- ${COMMENT_LINES[1]}`])
    })

    await test.step('Ctrl+F opens the find panel and Esc closes it, not the editor', async () => {
      await page.keyboard.press('ControlOrMeta+f')
      const find = sheet.locator('.cm-search')
      await expect(find).toBeVisible()
      await expect(find.locator('input[name="search"]')).toBeFocused()
      await page.keyboard.press('Escape')
      await expect(find).toHaveCount(0)
      await expect(sheet, 'Esc closed the find panel, not the editor').toBeVisible()
    })

    await test.step('Save keeps the commented line in the saved Test', async () => {
      await saveButton(sheet).click()
      await expect(saveButton(sheet)).toBeDisabled()
      await closeScriptSheet(page, sheet)
      await saveConfig(dialog)
      await expect(saveBtn(page)).toBeEnabled()
      await saveBtn(page).click()
      await expect(saveBtn(page)).toBeDisabled({ timeout: 10_000 })
      const node = await getNode(request, testId, NODE_B)
      expect(node.data.config.values.sql).toBe(`${COMMENT_LINES[0]}\n-- ${COMMENT_LINES[1]}`)
    })
  })

  test("SQL-10: Ctrl+G opens the Go to line prompt on the cursor's line", async ({ page }) => {
    test.setTimeout(120_000)
    await importEditorTest(page)
    const { dialog, sheet } = await openSqlEditor(page, NODE_B)
    const lines = sheet.locator('.cm-line')
    await editorContent(sheet).click()
    await page.keyboard.press('ControlOrMeta+a')
    await page.keyboard.press('Delete')
    await page.keyboard.insertText(COMMENT_LINES.join('\n'))
    await leaveExpressionEditor(sheet)
    await expect(lines).toHaveText(COMMENT_LINES)

    await lines.nth(1).click()
    await page.keyboard.press('ControlOrMeta+g')
    const prompt = sheet.locator('.cm-goto-line')
    await expect(prompt, 'Ctrl+G opens Go to line').toBeVisible()
    await expect(prompt).toContainText('Go to line')
    await expect(prompt.locator('input[name="line"]')).toBeFocused()
    await expect(prompt.locator('input[name="line"]')).toHaveValue('2')
    await expect(sheet.locator('.cm-search'), 'Ctrl+G is not find').toHaveCount(0)

    await closeScriptSheet(page, sheet)
    await closeConfigSheet(page, dialog)
  })
})

test.describe('V-PLUGIN-SQL-EDITOR-FUNCTIONAL: Get Tables on a SQLite File (SQL-12)', () => {
  test.afterAll(async ({ request }) => {
    await request.delete(`${BACKEND_URL}/workbench/session/`).catch(() => undefined)
    while (createdTests.length > 0) {
      await deleteTest(request, createdTests.pop() as string)
    }
  })

  test('SQL-12: Get Tables on a SQLite File lists its tables and columns, refuses a Driver option SQLite does not take, and never creates a missing File', async ({
    page,
  }) => {
    test.setTimeout(240_000)
    const fixture = sqliteFixture()
    const valuesOf = (nodeId: string): Record<string, unknown> => {
      const found = fixture.workflow.nodes.filter((item) => item.id === nodeId)
      expect(found, `the fixture declares block ${nodeId} once`).toHaveLength(1)
      return found[0].data.config.values
    }
    const file = `testdata://${LITE_FILE}`
    const missingFile = `testdata://${LITE_MISSING_FILE}`
    expect(valuesOf(LITE_TABLES)).toMatchObject({ database_type: 'sqlite', file, driver_options: {} })
    expect(valuesOf(LITE_OPTION)).toMatchObject({
      database_type: 'sqlite',
      file,
      driver_options: { isolation_level: 'DEFERRED' },
    })
    expect(valuesOf(LITE_MISSING)).toMatchObject({
      database_type: 'sqlite',
      file: missingFile,
      driver_options: {},
    })

    const calls = watchCatalog(page)
    const failures = watchCatalogFailures(page)
    const testId = await importWithTestData(
      page,
      fixture as unknown as Record<string, unknown>,
      [{ folder: '', name: LITE_FILE, body: twoTableDatabase() }],
      { rejectRepairs: true },
    )
    createdTests.push(testId)
    const validation = await validateTest(page.request, testId, 'run')
    expect(validation.status, `validate answered ${validation.status}`).toBe(200)
    expect(
      validation.errors,
      `the fixture must validate clean. Got: ${JSON.stringify(validation.errors)}`,
    ).toHaveLength(0)
    expect(
      await listTestDataPaths(page.request, testId),
      'Test Data holds the database and nothing else',
    ).toEqual([LITE_FILE])
    await selectEnvironment(page)

    await test.step('a File holding two tables: the chip settles on Tables · 2 and the popover lists both with their columns', async () => {
      const { dialog, sheet } = await openSqlEditor(page, LITE_TABLES)
      await expect(tablesChip(sheet)).toHaveAttribute('data-state', 'idle')
      await expect(tablesChipStatus(sheet)).toHaveText('Get Tables')

      const started = page.waitForResponse((r) => isCatalogStart(r.url(), r.request().method()))
      await tablesChip(sheet).getByRole('button', { name: 'Get Tables' }).click()
      const answer = (await (await started).json()) as { data: { cached: boolean } }
      expect(answer.data.cached, 'the first Get Tables on this File is a real pull').toBe(false)
      await expect(tablesChip(sheet)).toHaveAttribute('data-state', 'settled', { timeout: 60_000 })
      await expect(tablesChipStatus(sheet)).toHaveText('Tables · 2')
      await expect
        .poll(() => calls.answers.length, { message: 'the pull answered its tables' })
        .toBeGreaterThan(0)
      expect(
        calls.answers[calls.answers.length - 1],
        'the pull answers both tables with their columns and column types',
      ).toEqual(LITE_CATALOG)

      await tablesButton(sheet).click()
      const popover = tablesPopover(page)
      await expect(popover).toBeVisible()
      const items = popover.locator('[data-testid^="tables-popover-item-"]')
      await expect(items).toHaveCount(2)
      expect(
        await items.evaluateAll((elements) => elements.map((element) => element.getAttribute('data-testid'))),
      ).toEqual(['tables-popover-item-customers', 'tables-popover-item-orders'])
      await expect(popover.getByTestId('tables-popover-columns-customers')).toHaveText(/^id\s+name$/)
      await expect(popover.getByTestId('tables-popover-columns-orders')).toHaveText(
        /^id\s+customer_id\s+total$/,
      )
      await editorContent(sheet).click()
      await expect(popover).toBeHidden()
      await closeScriptSheet(page, sheet)
      await closeConfigSheet(page, dialog)
    })

    await test.step('Driver option isolation_level: the pull fails, naming the two options SQLite takes', async () => {
      expect(await failedPullReason(page, LITE_OPTION, failures)).toBe(LITE_OPTION_REFUSED)
    })

    await test.step('a File that is not there: the pull fails and the file is still absent', async () => {
      expect(await failedPullReason(page, LITE_MISSING, failures)).toBe(
        `Could not open the SQLite file ${missingFile}: unable to open database file`,
      )
      expect(
        await listTestDataPaths(page.request, testId),
        'Get Tables created no file: Test Data still holds the database alone',
      ).toEqual([LITE_FILE])
    })
  })
})
