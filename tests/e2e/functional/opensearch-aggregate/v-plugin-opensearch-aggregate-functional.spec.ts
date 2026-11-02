/**
 * V-PLUGIN-OPENSEARCH-AGGREGATE-FUNCTIONAL: the OpenSearch block in Aggregate mode against the real cluster
 * Wireframe: N/A
 * Design Decisions: OS-7, OS-8, OS-9, OS-10, OS-11, OS-13
 * REQ: REQ-3.3.3.2, REQ-3.4.1.15
 *
 * The fixture chains eight Aggregates over the run's own F-METRICS and F-LOGS indexes, fixed window
 * 2026-09-25T10:00:00Z to 10:04:59Z, each followed by an `os-agg-...` Log. A second test builds one
 * Aggregate in the config sheet: Count plus a Percentile, a Unique count and a Custom (JSON) entry added
 * there. Percentiles and unique counts are checked against the same aggregation sent as admin.
 *
 * Pass Criteria:
 * 1. The fixture imports through POST /tests with no repairs and validates with zero findings.
 * 2. BY-MINUTE: Results columns `@timestamp`, `count`, `percentile 95 of latency_ms`; five rows 10:00 to
 *    10:04; counts 3, 3, 2, 0, 2; each percentile equals the oracle, the quiet 10:03 row 0; Total results
 *    10; the console holds the one INFO summary line and no table.
 * 3. BY-FIELD: rows checkout 5 / 224 / 3 and search 3 / 100 / 3 (unique counts equal the oracle); WARN
 *    `Top values kept 2 values of service.name; 2 matching documents have other values and are left out`;
 *    Total results 10.
 * 4. INCREASE: per minute 60, 70, 35, 0, 50 (the counter restart at 10:02 is not a drop).
 * 5. WHOLE: one row 10, 101.25, 40, 250, 215.
 * 6. CUSTOM: columns `count`, `slowest`, `custom 3`; values 10, 250, 40.
 * 7. ERRORS-PER-MINUTE: rows 2, 0, 4, 0, 0; Total results 6; the Assert `max(errors.col('count')) <= 5`
 *    passes; the Try/Catch around `<= 3` catches and `os-agg-busy-minute-caught` prints.
 * 8. STAT-NO-FIELD: Record and continue gives Reason `Validation`, Error `Stat 1 (Sum) needs a Field`,
 *    one WARN, no request sent, and the block ends amber.
 * 9. STAT-DUP: Reason `Validation`, Error
 *    `Stats 1 and 2 both make the column 'count'; each stat needs its own column`.
 * 10. Sheet: in the Stats editor, Percentile (95, latency_ms), Unique count (user.id) and Custom (JSON)
 *     (`max latency`) added with Add stat read `95th percentile of latency_ms`, `Unique count of user.id`, `Custom: max latency`;
 *     after Get fields the Field box offers only numeric fields for Percentile and only aggregatable fields
 *     for Unique count; the saved block holds the four entries.
 * 11. Sheet run: Results columns `@timestamp, count, percentile 95 of latency_ms, unique count of user.id,
 *     max latency`; 10:00 count 2, unique 2, max 812; 10:02 count 4, unique 4, max 1500; the quiet minutes
 *     count 0, unique 0 and 0 for the percentile and the max (OS-8); percentiles and unique counts equal
 *     the oracle; Total results 6; the console holds the INFO summary line and no table.
 * 12. Every run passes and reaches its bookend.
 */

import fs from 'fs'
import path from 'path'
import { test, expect, type Locator, type Page } from '../../helpers/playwright-fixtures'
import { BACKEND_URL, CA_CERT_PEM, OPENSEARCH_PASSWORD, OPENSEARCH_USER } from '../../helpers/config'
import {
  getActiveSessionId,
  getSessionVariables,
  importValidateAndNavigate,
  sessionTable,
  sessionValue,
  type SessionVariables,
  type WaveTable,
} from '../../helpers/fixture-import'
import { logNode, validateTest } from '../../helpers/fn-seed'
import { expectNodeStatus, finishRun, startRun } from '../../helpers/k8s-run'
import { formatEntries, getLogCopyTexts, setConsoleMinimumLevel, type LogEntry } from '../../helpers/log-reader'
import {
  createOpenSearchIndex,
  deleteOpenSearchIndexes,
  F_LOGS,
  F_METRICS,
  FIXED_FROM,
  FIXED_FROM_ISO,
  FIXED_TO,
  FIXED_TO_ISO,
  MAP_LOGS,
  MAP_METRICS,
  openSearchIndexName,
  openSearchOracle,
  openSearchRequest,
  seedOpenSearch,
} from '../../helpers/opensearch-stack'
import {
  addStatEntry,
  clickSuggestFooter,
  dismissSuggestions,
  listItems,
  openFieldEditor,
  openListEditor,
  openSuggestions,
  pickEnum,
  saveListEditor,
  saveTimePicker,
  setAbsoluteTime,
  setStatEntry,
  statColumnLine,
  statFieldBox,
  statTrigger,
} from '../../helpers/config-sheet'
import { persistedNodes, saveConfig, saveWorkbench } from '../file-picker/picker'
import {
  openOpenSearchSheet,
  openSearchNode,
  realClusterValues,
  seedTest,
} from '../../visual/canvas/opensearch-sheet-seed'
import { blockSource, consoleEntriesFromCopy, newToken, withToken } from '../shell-blocks/shell-helpers'

interface FixtureNode {
  id: string
  data: {
    label: string
    elementType: string
    description: string
    config: { values: Record<string, unknown>; outputBindings: Record<string, string> }
  }
}

interface Fixture {
  name: string
  workflow: { nodes: FixtureNode[]; edges: Array<Record<string, unknown>> }
  [key: string]: unknown
}

const FIXTURE_FILE = 'fixture.json'
const BOOKEND = 'os-agg-done'
const DIRECT_URL = 'https://127.0.0.1:9477'

interface AggCase {
  /** The block's Name, which is also its Description. */
  block: string
  /** The purpose part of the index the block reads. */
  index: 'metrics' | 'app-logs'
  record: boolean
}

const CASES: AggCase[] = [
  { block: 'By minute', index: 'metrics', record: false },
  { block: 'By field', index: 'metrics', record: false },
  { block: 'Increase per minute', index: 'metrics', record: false },
  { block: 'Whole window', index: 'metrics', record: false },
  { block: 'Custom JSON', index: 'metrics', record: false },
  { block: 'Errors per minute', index: 'app-logs', record: false },
  { block: 'Stat with no field', index: 'metrics', record: true },
  { block: 'Two counts', index: 'metrics', record: true },
]

/** The five one-minute slots of the fixed window, as the time column holds them. */
const MINUTES = ['10:00', '10:01', '10:02', '10:03', '10:04'].map((minute) => `2026-09-25T${minute}:00.000Z`)
const WINDOW_RANGE = { range: { '@timestamp': { gte: FIXED_FROM, lte: FIXED_TO } } }
const PER_MINUTE = {
  field: '@timestamp',
  fixed_interval: '1m',
  min_doc_count: 0,
  extended_bounds: { min: Date.parse(FIXED_FROM), max: Date.parse(FIXED_TO) },
  time_zone: 'UTC',
  format: 'strict_date_optional_time',
}
const ERROR_FILTER = { term: { 'log.level': 'ERROR' } }
const NUMERIC_TYPES = new Set([
  'long',
  'integer',
  'short',
  'byte',
  'double',
  'float',
  'half_float',
  'scaled_float',
  'unsigned_long',
])

const NO_FIELD_ERROR = 'Stat 1 (Sum) needs a Field'
const DUP_ERROR = "Stats 1 and 2 both make the column 'count'; each stat needs its own column"
const TOP_VALUES_WARN =
  'Top values kept 2 values of service.name; 2 matching documents have other values and are left out'

// The block built in the sheet: its Test holds only the connection rows, its output bindings and a bookend.
const SHEET_NODE_ID = '7a5e0fa1-c55c-46f8-8b8a-816d83711b6f'
const SHEET_LOG_ID = 'e67b6d28-4bae-452c-912a-7d91dc7060ef'
const SHEET_START_EDGE_ID = '35dbfbe7-55d6-4221-b69b-eb933c07e99c'
const SHEET_LOG_EDGE_ID = 'a018f2b5-97c0-4081-ac6b-5bdedfac7a9e'
const SHEET_BOOKEND = 'os-agg-sheet-done'
const SHEET_QUERY = 'log.level: "ERROR"'
const MAX_LATENCY_JSON = '{"max": {"field": "latency_ms"}}'
const SHEET_COLUMNS = [
  '@timestamp',
  'count',
  'percentile 95 of latency_ms',
  'unique count of user.id',
  'max latency',
]

const createdTests: string[] = []
let token = ''

function loadFixture(): Fixture {
  return JSON.parse(fs.readFileSync(path.resolve(__dirname, FIXTURE_FILE), 'utf-8')) as Fixture
}

function blockOf(fixture: Fixture, description: string): FixtureNode {
  const found = fixture.workflow.nodes.filter((node) => node.data.description === description)
  expect(found, `the fixture must declare one block described "${description}"`).toHaveLength(1)
  return found[0]
}

/** Each Aggregate dials the host-mode address as `wave` and stores no secret; the password and CA come from config. */
function prepareFixture(fixture: Fixture): Fixture {
  const blocks = fixture.workflow.nodes.filter((node) => node.data.elementType === 'opensearch')
  expect(blocks.map((node) => node.data.description), 'one Aggregate per case, in case order').toEqual(
    CASES.map((c) => c.block),
  )
  for (const c of CASES) {
    const node = blockOf(fixture, c.block)
    const values = node.data.config.values
    const what = `"${c.block}"`
    expect(node.data.label, `${what} is named as it is described`).toBe(c.block)
    expect(values.url, `${what} carries the host-mode address the import rewrites`).toBe(DIRECT_URL)
    expect(values.index, `${what} reads the run's own index`).toBe(openSearchIndexName(token, c.index))
    expect(values.username, `${what} logs in as wave`).toBe(OPENSEARCH_USER)
    expect(values.mode, `${what} aggregates`).toBe('aggregate')
    expect([values.from, values.to], `${what} reads the fixed window`).toEqual([FIXED_FROM, FIXED_TO])
    expect(values.on_error, `${what} fails or records`).toBe(c.record ? 'record' : 'fail')
    expect([values.password, values.ca_cert], `${what} stores no password and no CA`).toEqual(['', ''])
    values.password = OPENSEARCH_PASSWORD
    values.ca_cert = CA_CERT_PEM
  }
  return fixture
}

/** The Test the sheet case starts from: the connection rows, the output bindings and a bookend Log. */
function sheetFixture(index: string): Record<string, unknown> {
  return {
    name: 'V-PLUGIN-OPENSEARCH-AGGREGATE sheet',
    version: '1.0.0',
    description: '',
    workflow: {
      nodes: [
        openSearchNode(
          SHEET_NODE_ID,
          realClusterValues(index),
          { outputBindings: { success: 'sheet_ok', results: 'sheet_rows', total_results: 'sheet_total' } },
          { x: 400, y: 60 },
        ),
        logNode(SHEET_LOG_ID, 'Log', `'${SHEET_BOOKEND}'`, { x: 400, y: 180 }),
      ],
      edges: [
        { id: SHEET_START_EDGE_ID, source: 'start-node', target: SHEET_NODE_ID },
        { id: SHEET_LOG_EDGE_ID, source: SHEET_NODE_ID, target: SHEET_LOG_ID },
      ],
    },
    variables: {
      sheet_ok: { value: false, type: 'boolean', scope: 'test' },
      sheet_rows: { value: [], type: 'table', scope: 'test' },
      sheet_total: { value: -1, type: 'integer', scope: 'test' },
    },
    metadata: { tags: [], suite_id: null, parent_suite: null },
  }
}

// --- Results reads -----------------------------------------------------------

/** A number cell: a JSON number, or the exact decimal text a float column carries. */
function num(cell: unknown, what: string): number {
  if (typeof cell === 'number') return cell
  expect(String(cell), `${what} is a number or exact decimal text`).toMatch(/^-?\d+(\.\d+)?$/)
  return Number(cell)
}

function columnNames(table: WaveTable): string[] {
  return table.columns.map((column) => column.name)
}

function column(table: WaveTable, name: string): unknown[] {
  const at = columnNames(table).indexOf(name)
  expect(at, `column "${name}" in ${JSON.stringify(columnNames(table))}`).toBeGreaterThanOrEqual(0)
  return table.rows.map((row) => row[at])
}

function numbers(table: WaveTable, name: string): number[] {
  return column(table, name).map((cell, row) => num(cell, `${name} in row ${row}`))
}

// --- oracles -------------------------------------------------------------------

/** The per-minute buckets of the same aggregation, sent as admin over the fixed window. */
async function perMinuteOracle(
  index: string,
  filters: Array<Record<string, unknown>>,
  aggs: Record<string, unknown>,
): Promise<Array<Record<string, any>>> {
  const answer = await openSearchOracle(index, {
    size: 0,
    track_total_hits: true,
    query: { bool: { filter: [...filters, WINDOW_RANGE] } },
    aggs: { time: { date_histogram: PER_MINUTE, aggs } },
  })
  const buckets = answer.aggregations.time.buckets as Array<Record<string, any>>
  expect(buckets.map((bucket) => bucket.key_as_string), 'the oracle has the five minutes').toEqual(MINUTES)
  return buckets
}

const percentileOf = (bucket: Record<string, any>): number | null => bucket.p.values[0].value

/** OS-8: a quiet slot shows 0; a slot with documents shows the oracle's value. */
function quietAsZero(bucket: Record<string, any>, value: number | null): number | null {
  return bucket.doc_count === 0 ? 0 : value
}

/** The names Get fields lists, split by the kinds a stat's Field offers: numeric and aggregatable. */
async function fieldKindsOracle(index: string): Promise<{ all: string[]; numeric: string[]; aggregatable: string[] }> {
  const answer = await openSearchRequest(
    'GET',
    `/${encodeURIComponent(index)}/_field_caps?fields=*&ignore_unavailable=true&allow_no_indices=true`,
  )
  expect(answer.status, `_field_caps on ${index}: ${answer.text.slice(0, 300)}`).toBe(200)
  const fields = answer.json.fields as Record<string, Record<string, { aggregatable?: boolean }>>
  // Metadata fields start with an underscore; the field list leaves them out.
  const named = Object.entries(fields).filter(([name]) => !name.startsWith('_'))
  const sorted = (list: Array<[string, unknown]>): string[] => list.map(([name]) => name).sort()
  return {
    all: sorted(named),
    numeric: sorted(named.filter(([, caps]) => Object.keys(caps).some((type) => NUMERIC_TYPES.has(type)))),
    aggregatable: sorted(named.filter(([, caps]) => Object.values(caps).every((cap) => cap.aggregatable === true))),
  }
}

// --- console reads -------------------------------------------------------------

function blockEntries(entries: readonly LogEntry[], name: string): LogEntry[] {
  const source = blockSource('OpenSearch', name)
  return entries.filter((entry) => entry.source === source)
}

/** The block's INFO and WARN lines as "LEVEL message", sorted, the elapsed seconds blanked: the harvest does not keep their order. */
function summaryLines(entries: readonly LogEntry[], name: string): string[] {
  return blockEntries(entries, name)
    .filter((entry) => entry.level !== 'DEBUG')
    .map((entry) => `${entry.level} ${entry.message.replace(/, \d+\.\d{2} s$/, ', # s')}`)
    .sort()
}

/** The block's DEBUG request lines, each cut to its method and path, sorted. */
function requestLines(entries: readonly LogEntry[], name: string): string[] {
  return blockEntries(entries, name)
    .filter((entry) => entry.level === 'DEBUG' && /^(GET|POST) \//.test(entry.message))
    .map((entry) => entry.message.split(' ').slice(0, 2).join(' '))
    .sort()
}

function infoLine(index: string, total: number, rows: number): string {
  const results = total === 1 ? '1 result' : `${total} results`
  const kept = rows === 1 ? '1 row' : `${rows} rows`
  return `INFO Aggregate ${index} from ${FIXED_FROM_ISO} to ${FIXED_TO_ISO}: ${results}, ${kept}, # s`
}

/** OS-10: the block writes its summary, its WARNs and, at DEBUG, its inputs, requests and outputs echo; never a Results table. */
function expectNoTable(entries: readonly LogEntry[], name: string, header: string): void {
  const all = formatEntries(entries)
  for (const entry of blockEntries(entries, name).filter((e) => e.level === 'DEBUG')) {
    expect(entry.message, `"${name}" writes only its inputs, requests and outputs at DEBUG.\n${all}`).toMatch(
      /^(Inputs: |Outputs: |GET \/|POST \/)/,
    )
  }
  const printed = entries.filter(
    (entry) => entry.message.includes(header) || MINUTES.some((minute) => entry.message.startsWith(minute)),
  )
  expect(printed, `no console line prints the "${name}" table.\n${all}`).toEqual([])
}

// --- sheet drivers ---------------------------------------------------------------

/** Replace a CodeMirror editor's text in one insertion, so no bracket or quote is auto-closed. */
async function replaceEditorText(page: Page, editor: Locator, text: string): Promise<void> {
  const content = editor.locator('.cm-content').first()
  await content.click()
  await page.keyboard.press('Control+a')
  await page.keyboard.press('Delete')
  await page.keyboard.insertText(text)
  await expect(content).toHaveText(text)
}

async function saveAndCloseEditor(editor: Locator): Promise<void> {
  const save = editor.locator('[data-testid="value-editor-save-button"]')
  await save.click()
  await expect(save).toBeDisabled()
  await editor.locator('[data-testid="value-editor-cancel-button"]').click()
  await expect(editor).toBeHidden()
}

async function closeStatPopover(page: Page, popover: Locator): Promise<void> {
  if (await popover.isVisible()) await page.keyboard.press('Escape')
  await expect(popover).toBeHidden()
}

/** OS-13: the names a stat's Field box offers once the fields are pulled, sorted. */
async function expectOffered(page: Page, box: Locator, expected: string[], what: string): Promise<void> {
  const list = await openSuggestions(page, box)
  await expect
    .poll(
      async () =>
        (
          await list
            .locator('[cmdk-item]')
            .evaluateAll((items) => items.map((item) => item.getAttribute('data-value') ?? ''))
        ).sort(),
      { timeout: 30_000, message: `${what}: the Field box offers exactly ${JSON.stringify(expected)}` },
    )
    .toEqual(expected)
}

test.describe('V-PLUGIN-OPENSEARCH-AGGREGATE-FUNCTIONAL: Stats per minute, per field value and for the window', () => {
  test.beforeAll(async () => {
    token = newToken()
    const metrics = openSearchIndexName(token, 'metrics')
    await createOpenSearchIndex(metrics, MAP_METRICS)
    await seedOpenSearch(metrics, F_METRICS)
    for (const purpose of ['app-logs', 'logs']) {
      const index = openSearchIndexName(token, purpose)
      await createOpenSearchIndex(index, MAP_LOGS)
      await seedOpenSearch(index, F_LOGS)
    }
  })

  test.afterAll(async ({ request }) => {
    await request.delete(`${BACKEND_URL}/workbench/session/`).catch(() => undefined)
    for (const testId of createdTests.splice(0)) {
      await request.delete(`${BACKEND_URL}/tests/${testId}`).catch(() => undefined)
    }
    if (token) await deleteOpenSearchIndexes(token)
  })

  test('per minute, per field value and for the window: Increase, Custom (JSON), errors per minute, refused Stats', async ({
    page,
  }) => {
    test.setTimeout(240_000)
    const fixture = prepareFixture(withToken(loadFixture(), token))
    const metrics = openSearchIndexName(token, 'metrics')
    const appLogs = openSearchIndexName(token, 'app-logs')

    const testId = await importValidateAndNavigate(page, fixture as unknown as Record<string, unknown>, {
      injectHttp: true,
      rejectRepairs: true,
    })
    createdTests.push(testId)

    const validation = await validateTest(page.request, testId, 'run')
    expect(validation.status, `validate answered ${validation.status}`).toBe(200)
    expect(validation.errors, `zero errors. Got: ${JSON.stringify(validation.errors)}`).toHaveLength(0)
    expect(validation.warnings, `zero warnings. Got: ${JSON.stringify(validation.warnings)}`).toHaveLength(0)

    await setConsoleMinimumLevel(page, 'DEBUG')
    const status = await startRun(page)
    await finishRun(page, status, BOOKEND, 180_000)

    const variables = (await getSessionVariables(page, await getActiveSessionId(page))) as SessionVariables
    const entries = consoleEntriesFromCopy(await getLogCopyTexts(page))
    const messages = entries.map((entry) => entry.message)
    const expectLog = (line: string): void => {
      expect(messages, `the console must carry "${line}".\n${formatEntries(entries)}`).toContain(line)
    }
    const fetchReads = (name: string): void => {
      const index = openSearchIndexName(token, CASES.find((c) => c.block === name)?.index ?? 'metrics')
      expect(requestLines(entries, name), `"${name}" reads the field list, then aggregates`).toEqual([
        `GET /${index}/_field_caps?fields=*&ignore_unavailable=true&allow_no_indices=true`,
        `POST /${index}/_search`,
      ])
    }

    await test.step('every Aggregate ends in its state: green, the refused Stats amber (OS-11)', async () => {
      for (const c of CASES) {
        await expectNodeStatus(page, blockOf(fixture, c.block).id, c.record ? 'warning' : 'success')
      }
    })

    await test.step('BY-MINUTE: counts and the 95th percentile per minute, the quiet minute 0, no table (OS-8, OS-10)', async () => {
      const buckets = await perMinuteOracle(metrics, [], {
        p: { percentiles: { field: 'latency_ms', percents: [95], keyed: false } },
      })
      const rows = sessionTable(variables, 'minute_rows')
      expect(columnNames(rows), 'minute_rows columns').toEqual(['@timestamp', 'count', 'percentile 95 of latency_ms'])
      expect(column(rows, '@timestamp'), 'one row per minute of the window').toEqual(MINUTES)
      expect(numbers(rows, 'count'), 'documents per minute').toEqual([3, 3, 2, 0, 2])
      expect(numbers(rows, 'percentile 95 of latency_ms'), 'the percentile per minute equals the oracle').toEqual(
        buckets.map((bucket) => quietAsZero(bucket, percentileOf(bucket))),
      )
      expect(numbers(rows, 'percentile 95 of latency_ms')[3], 'the quiet 10:03 row shows 0').toBe(0)
      expect(sessionValue(variables, 'minute_ok')).toBe(true)
      expect(sessionValue(variables, 'minute_total'), 'Total results').toBe(10)
      expect(summaryLines(entries, 'By minute')).toEqual([infoLine(metrics, 10, 5)])
      fetchReads('By minute')
      expectNoTable(entries, 'By minute', '@timestamp | count')
      expectLog('os-agg-by-minute total=10 rows=5 first=3')
    })

    await test.step('BY-FIELD: Top values 2 of service.name with an average and a unique count, the rest in a WARN', async () => {
      const answer = await openSearchOracle(metrics, {
        size: 0,
        query: { bool: { filter: [WINDOW_RANGE] } },
        aggs: {
          group: {
            terms: { field: 'service.name', size: 2, order: { _count: 'desc' } },
            aggs: { u: { cardinality: { field: 'user.id' } } },
          },
        },
      })
      const unique = (answer.aggregations.group.buckets as Array<Record<string, any>>).map((bucket) => [
        bucket.key,
        bucket.u.value,
      ])
      expect(unique, 'the oracle keeps checkout and search').toEqual([
        ['checkout', expect.any(Number)],
        ['search', expect.any(Number)],
      ])
      const rows = sessionTable(variables, 'field_rows')
      expect(columnNames(rows), 'field_rows columns').toEqual([
        'service.name',
        'count',
        'average of latency_ms',
        'unique count of user.id',
      ])
      expect(column(rows, 'service.name'), 'the two most common values, most documents first').toEqual([
        'checkout',
        'search',
      ])
      expect(numbers(rows, 'count')).toEqual([5, 3])
      expect(numbers(rows, 'average of latency_ms')).toEqual([224, 100])
      expect(numbers(rows, 'unique count of user.id'), 'unique counts equal the oracle').toEqual(
        unique.map(([, value]) => value),
      )
      expect(numbers(rows, 'unique count of user.id')).toEqual([3, 3])
      expect(sessionValue(variables, 'field_total'), 'Total results').toBe(10)
      expect(summaryLines(entries, 'By field')).toEqual([infoLine(metrics, 10, 2), `WARN ${TOP_VALUES_WARN}`])
      fetchReads('By field')
      expectLog('os-agg-by-field total=10 top=checkout count=5')
    })

    await test.step('INCREASE: 60, 70, 35, 0, 50; the counter restart at 10:02 is not a drop (OS-7)', async () => {
      const rows = sessionTable(variables, 'rise_rows')
      expect(columnNames(rows), 'rise_rows columns').toEqual(['@timestamp', 'increase of requests_total'])
      expect(column(rows, '@timestamp')).toEqual(MINUTES)
      expect(numbers(rows, 'increase of requests_total')).toEqual([60, 70, 35, 0, 50])
      expect(sessionValue(variables, 'rise_total'), 'Total results').toBe(10)
      expect(summaryLines(entries, 'Increase per minute')).toEqual([infoLine(metrics, 10, 5)])
      fetchReads('Increase per minute')
      expectLog('os-agg-increase total=10 rows=5')
    })

    await test.step('WHOLE: one row for the window: 10, 101.25, 40, 250, 215 (OS-8)', async () => {
      const rows = sessionTable(variables, 'whole_rows')
      const names = ['count', 'sum of bytes', 'min of latency_ms', 'max of latency_ms', 'increase of requests_total']
      expect(columnNames(rows), 'whole_rows columns').toEqual(names)
      expect(rows.rows, 'one row for the whole window').toHaveLength(1)
      expect(names.map((name) => numbers(rows, name)[0])).toEqual([10, 101.25, 40, 250, 215])
      expect(sessionValue(variables, 'whole_total'), 'Total results').toBe(10)
      expect(summaryLines(entries, 'Whole window')).toEqual([infoLine(metrics, 10, 1)])
      fetchReads('Whole window')
      expectLog('os-agg-whole total=10 rows=1 count=10')
    })

    await test.step('CUSTOM: a named and an unnamed Custom (JSON) column: count, slowest, custom 3 (OS-7)', async () => {
      const rows = sessionTable(variables, 'custom_rows')
      expect(columnNames(rows), 'custom_rows columns').toEqual(['count', 'slowest', 'custom 3'])
      expect(rows.rows, 'one row for the whole window').toHaveLength(1)
      expect(['count', 'slowest', 'custom 3'].map((name) => numbers(rows, name)[0])).toEqual([10, 250, 40])
      expect(sessionValue(variables, 'custom_total'), 'Total results').toBe(10)
      expect(summaryLines(entries, 'Custom JSON')).toEqual([infoLine(metrics, 10, 1)])
      fetchReads('Custom JSON')
      expectLog('os-agg-custom total=10 columns=3')
    })

    await test.step('ERRORS-PER-MINUTE: 2, 0, 4, 0, 0; the <= 5 Assert passes, the <= 3 one is caught', async () => {
      const rows = sessionTable(variables, 'errors')
      expect(columnNames(rows), 'errors columns').toEqual(['@timestamp', 'count'])
      expect(column(rows, '@timestamp')).toEqual(MINUTES)
      expect(numbers(rows, 'count')).toEqual([2, 0, 4, 0, 0])
      expect(sessionValue(variables, 'errors_ok')).toBe(true)
      expect(sessionValue(variables, 'errors_total'), 'Total results').toBe(6)
      expect(summaryLines(entries, 'Errors per minute')).toEqual([infoLine(appLogs, 6, 5)])
      fetchReads('Errors per minute')
      await expectNodeStatus(page, blockOf(fixture, 'No minute over 5').id, 'success')
      await expectNodeStatus(page, blockOf(fixture, 'Busy minute caught').id, 'success')
      const failed = entries.filter(
        (entry) =>
          entry.source === blockSource('Assert', 'No minute over 3') &&
          entry.level === 'ERROR' &&
          entry.message === 'Assertion failed: 1 of 1 assertions failed',
      )
      expect(failed, `the <= 3 Assert fails on the busy minute.\n${formatEntries(entries)}`).toHaveLength(1)
      expect(sessionValue(variables, 'busy_caught'), 'the Try/Catch caught the <= 3 Assert').toBe(true)
      expectLog('os-agg-busy-minute-caught')
      expectLog('os-agg-errors-per-minute total=6 busiest=4')
    })

    const refused = [
      { block: 'Stat with no field', key: 'nofield', slug: 'stat-no-field', error: NO_FIELD_ERROR },
      { block: 'Two counts', key: 'dup', slug: 'stat-dup', error: DUP_ERROR },
    ]
    for (const r of refused) {
      await test.step(`${r.slug.toUpperCase()}: Reason Validation, "${r.error}", nothing sent (OS-7, OS-11)`, () => {
        expect(sessionValue(variables, `${r.key}_ok`)).toBe(false)
        expect(sessionValue(variables, `${r.key}_reason`)).toBe('Validation')
        expect(sessionValue(variables, `${r.key}_error`)).toBe(r.error)
        expect(sessionValue(variables, `${r.key}_total`)).toBe(0)
        expect(sessionTable(variables, `${r.key}_rows`)).toEqual({ columns: [], rows: [] })
        expect(summaryLines(entries, r.block)).toEqual([`WARN Aggregate failed (Validation): ${r.error}`])
        expect(requestLines(entries, r.block), `"${r.block}" is refused before any request`).toEqual([])
        expectLog(`os-agg-${r.slug} ok=false reason=Validation error=${r.error}`)
      })
    }

    await test.step('the run passes and reaches its bookend', () => {
      expectLog(BOOKEND)
    })
  })

  test('built in the sheet: Count plus Percentile, Unique count and Custom (JSON) added with Add stat', async ({
    page,
  }) => {
    test.setTimeout(240_000)
    const index = openSearchIndexName(token, 'logs')
    const kinds = await fieldKindsOracle(index)
    expect(kinds.numeric, 'MAP-LOGS maps one numeric field').toEqual(['latency_ms'])
    expect(kinds.aggregatable.length, 'the kinds leave text and object fields out').toBeLessThan(kinds.all.length)

    const testId = await seedTest(page.request, sheetFixture(index))
    createdTests.push(testId)
    const sheet = await openOpenSearchSheet(page, testId, SHEET_NODE_ID)
    let stats: Locator = sheet

    await test.step('Query, Mode Aggregate, Group by time and the window are set in the sheet', async () => {
      const editor = await openFieldEditor(page, sheet, 'query')
      await replaceEditorText(page, editor, SHEET_QUERY)
      await saveAndCloseEditor(editor)
      await pickEnum(page, sheet, 'mode', 'Aggregate')
      await pickEnum(page, sheet, 'group_by_time', 'Every 1 minute')
      await saveTimePicker(await setAbsoluteTime(page, sheet, 'from', FIXED_FROM))
      await saveTimePicker(await setAbsoluteTime(page, sheet, 'to', FIXED_TO))
      stats = await openListEditor(page, sheet, 'stats')
      await expect(listItems(stats)).toHaveCount(1)
      await expect(statTrigger(stats, 0)).toHaveText('Count')
    })

    await test.step('Percentile: after Get fields its Field box offers only numeric fields (OS-7, OS-13)', async () => {
      await addStatEntry(page, stats)
      const popover = await setStatEntry(page, stats, 1, { stat: 'Percentile', percent: 95 })
      const box = statFieldBox(popover)
      await expect(box).toHaveValue('')
      await clickSuggestFooter(page, box, 'Get fields')
      await expectOffered(page, box, kinds.numeric, 'Percentile')
      await dismissSuggestions(box)
      await setStatEntry(page, stats, 1, { field: 'latency_ms' })
      await expect(statColumnLine(popover)).toHaveText('percentile 95 of latency_ms')
      await closeStatPopover(page, popover)
    })

    await test.step('Unique count: its Field box offers only aggregatable fields (OS-7, OS-13)', async () => {
      await addStatEntry(page, stats)
      const popover = await setStatEntry(page, stats, 2, { stat: 'Unique count' })
      const box = statFieldBox(popover)
      await expect(box).toHaveValue('')
      await expectOffered(page, box, kinds.aggregatable, 'Unique count')
      await dismissSuggestions(box)
      await setStatEntry(page, stats, 2, { field: 'user.id' })
      await expect(statColumnLine(popover)).toHaveText('unique count of user.id')
      await closeStatPopover(page, popover)
    })

    await test.step('Custom (JSON): Column name max latency, the aggregation typed in Edit JSON (OS-7)', async () => {
      await addStatEntry(page, stats)
      const popover = await setStatEntry(page, stats, 3, { stat: 'Custom (JSON)', columnName: 'max latency' })
      await expect(statColumnLine(popover)).toHaveText('max latency')
      await popover.getByRole('button', { name: 'Edit JSON' }).click()
      // The aggregation editor opens beside the Stats editor, as its own Edit value sheet.
      const editor = page
        .locator('[data-testid="value-editor-sheet"]')
        .filter({ hasNot: page.locator('[data-testid="array-edit-body"]') })
      await expect(editor).toBeVisible()
      await replaceEditorText(page, editor, MAX_LATENCY_JSON)
      await saveAndCloseEditor(editor)
      await closeStatPopover(page, popover)
    })

    await test.step('the entries read in words and the saved block holds them (OS-7)', async () => {
      await expect(listItems(stats)).toHaveCount(4)
      await expect(statTrigger(stats, 0)).toHaveText('Count')
      await expect(statTrigger(stats, 1)).toHaveText('95th percentile of latency_ms')
      await expect(statTrigger(stats, 2)).toHaveText('Unique count of user.id')
      await expect(statTrigger(stats, 3)).toHaveText('Custom: max latency')
      await saveListEditor(stats)
      await saveConfig(sheet)
      await saveWorkbench(page)
      const values = (await persistedNodes(page.request, testId))[SHEET_NODE_ID].config.values
      expect(values.query, 'Query').toBe(SHEET_QUERY)
      expect(values.mode, 'Mode').toBe('aggregate')
      expect(values.group_by_time ?? '1m', 'Group by time').toBe('1m')
      expect([values.from, values.to], 'the window').toEqual([FIXED_FROM, FIXED_TO])
      expect(values.stats, 'the four Stats entries').toEqual([
        { value: { stat: 'count' } },
        { value: { stat: 'percentile', field: 'latency_ms', percent: 95 } },
        { value: { stat: 'unique_count', field: 'user.id' } },
        { value: { stat: 'custom', name: 'max latency', json: MAX_LATENCY_JSON } },
      ])
    })

    const status = await startRun(page)
    await finishRun(page, status, SHEET_BOOKEND, 120_000)
    const variables = (await getSessionVariables(page, await getActiveSessionId(page))) as SessionVariables
    const entries = consoleEntriesFromCopy(await getLogCopyTexts(page))

    await test.step('the run: one column per entry, errors per minute with their percentile, unique users and slowest (OS-8)', async () => {
      const buckets = await perMinuteOracle(index, [ERROR_FILTER], {
        p: { percentiles: { field: 'latency_ms', percents: [95], keyed: false } },
        u: { cardinality: { field: 'user.id' } },
      })
      const rows = sessionTable(variables, 'sheet_rows')
      expect(columnNames(rows), 'sheet_rows columns').toEqual(SHEET_COLUMNS)
      expect(column(rows, '@timestamp'), 'one row per minute of the window').toEqual(MINUTES)
      expect(numbers(rows, 'count'), 'ERROR documents per minute').toEqual([2, 0, 4, 0, 0])
      expect(numbers(rows, 'unique count of user.id'), 'unique users per minute').toEqual([2, 0, 4, 0, 0])
      expect(numbers(rows, 'unique count of user.id'), 'unique counts equal the oracle').toEqual(
        buckets.map((bucket) => bucket.u.value),
      )
      expect(numbers(rows, 'max latency'), 'the slowest ERROR per minute; quiet minutes 0').toEqual([
        812, 0, 1500, 0, 0,
      ])
      expect(numbers(rows, 'percentile 95 of latency_ms'), 'percentiles equal the oracle; quiet minutes 0').toEqual(
        buckets.map((bucket) => quietAsZero(bucket, percentileOf(bucket))),
      )
      expect(sessionValue(variables, 'sheet_ok')).toBe(true)
      expect(sessionValue(variables, 'sheet_total'), 'Total results').toBe(6)
      expect(summaryLines(entries, '')).toEqual([infoLine(index, 6, 5)])
      expectNoTable(entries, '', SHEET_COLUMNS.slice(0, 2).join(' | '))
    })
  })
})
