/**
 * V-PLUGIN-OPENSEARCH-SEARCH-FUNCTIONAL: the OpenSearch block's Search mode against the real cluster
 * Wireframe: N/A
 * Design Decisions: OS-4, OS-5, OS-6, OS-8, OS-9, OS-10
 * REQ: REQ-3.3.2.2, REQ-3.3.2.3, REQ-3.3.2.5, REQ-3.3.2.6, REQ-3.3.3.1, REQ-3.3.3.6
 *
 * One workflow chains every case; each case writes its own `os-...` Log line so a failure names it.
 * The fixed-window cases run first; the chain then goes on from the If/Else branch each wait case
 * expects. The two live indexes are created empty in beforeAll and filled by the spec only once the
 * run log shows the first round of the wait on `-live-a` finding nothing.
 *
 * Pass Criteria:
 * 1. The fixture imports through POST /tests with no repairs and validates with zero findings.
 * 2. WAIT-A: a Python block saves test_start as a UTC ISO time; the Wait Until runs its Search at
 *    least twice, the first round finding 0 results; the If/Else then takes the error branch and logs
 *    `os-live-a-branch=error message=Payment failed`.
 * 3. WAIT-B: the same wait on `-live-b` takes the success branch; after the Delay the collecting
 *    Search from test_start to the found line's @timestamp keeps all four lines oldest first, and the
 *    three Asserts pass.
 * 4. W2-TOTAL: Max results 1 keeps one row and logs WARN `Kept 1 of 6 results (Max results)`; Total
 *    results stays 6; the block ends passed, not amber; the INFO line reports `6 results, 1 kept`.
 * 5. W2-CELL: a `{{ }}` value holding a quote, inside DQL quotes, is escaped: Total 1, `Card declined`.
 * 6. ESC-WORD: a `{{ }}` value outside quotes is one literal value: `ann or bob` finds Total 0.
 * 7. DSL-VALUE: a `{{ }}` integer standing alone in Query DSL lands as a JSON number: Total 3.
 * 8. DSL-PASTED: a pasted whole request keeps only its query and says what it dropped: Total 1.
 * 9. EXPR: the Query row in expression mode builds the DQL text: Total 3.
 * 10. BY-ID: DQL on `_id` finds document 10: Total 1, `Batch complete`.
 * 11. SHAPES: an object field gives one dotted column per leaf, in the document's order, arrays as
 *     JSON text; empty Fields gives one `_source` column holding the whole document as JSON text.
 * 12. SORT: Sort by latency_ms, Newest first, Max results 1 keeps the 1500 ms line.
 * 13. PAGE-ALL: Max results 0 pages past 10,000: Total 10050, 10050 rows, 10050 distinct _id values,
 *     every seq once, in sort order; no Max results WARN; the console holds no row text.
 * 14. PAGE-CUT: Max results 10001 keeps the first 10001 rows of the same order, logs
 *     WARN `Kept 10001 of 10050 results (Max results)` and ends passed.
 * 15. DATE-MATH: `<...-daily-{now/d}>` over now-3d to now reads today's index only (Total 1); the
 *     wildcard minus today's index reads the two others (Total 2).
 * 16. Every Search logs only its INFO summary line, its WARN lines and its notes (no result data);
 *     the session passes with no block failed or amber.
 */

import fs from 'fs'
import path from 'path'
import { test, expect } from '../../helpers/playwright-fixtures'
import { BACKEND_URL, CA_CERT_PEM, OPENSEARCH_PASSWORD, OPENSEARCH_USER } from '../../helpers/config'
import {
  getActiveSessionId,
  getSessionVariables,
  importValidateAndNavigate,
  sessionTable,
  sessionValue,
  type SessionVariables,
} from '../../helpers/fixture-import'
import { validateTest } from '../../helpers/fn-seed'
import { expectNodeStatus, finishRun, startRun } from '../../helpers/k8s-run'
import {
  escapeRegExp,
  formatEntries,
  getLogCopyTexts,
  setConsoleMinimumLevel,
  type LogEntry,
} from '../../helpers/log-reader'
import {
  bulkPageDocs,
  createOpenSearchIndex,
  dailyDocs,
  dailyIndexNames,
  deleteOpenSearchIndexes,
  F_LOGS,
  FIXED_FROM_ISO,
  FIXED_TO_ISO,
  MAP_LOGS,
  MAP_PAGE,
  openSearchIndexName,
  seedOpenSearch,
  utcDayStamp,
  type OpenSearchDoc,
} from '../../helpers/opensearch-stack'
import { consoleEntriesFromCopy, newToken, withToken } from '../shell-blocks/shell-helpers'
import {
  blockEntries,
  LIVE_A,
  LIVE_B,
  liveDocs,
  searchBodies,
  searchSummaries,
  summaryLines,
  waitForConsoleMessage,
  withoutCursors,
} from './search-helpers'

interface FixtureNode {
  id: string
  data: {
    label: string
    elementType: string
    description: string
    expressionFields: string[]
    templateFields: string[]
    config: { values: Record<string, unknown>; outputBindings: Record<string, string> }
  }
}

interface Fixture {
  name: string
  workflow: { nodes: FixtureNode[]; edges: Array<Record<string, unknown>> }
  [key: string]: unknown
}

const FIXTURE_FILE = 'fixture.json'
const BOOKEND = 'os-search-done'
const DIRECT_URL = 'https://127.0.0.1:9477'
const PAGE_DOCS = 10050
const PAGE_CUT = 10001
const DAY_MS = 24 * 60 * 60 * 1000
const LOG_COLUMNS = ['@timestamp', 'log.level', 'message']
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/

/** The rows in expression mode, by block (save rule 2); every other row is text. */
const EXPRESSION_ROWS: Record<string, string[]> = {
  'Live A wait search': ['from'],
  'Live B wait search': ['from'],
  'Live B collect': ['from', 'to'],
  'Expression query': ['query'],
}
/** The If/Else branches the run must not take. */
const UNTAKEN = ['Live A success', 'Live B error']

const createdTests: string[] = []
let token = ''
let seededAt = new Date()
let doc10Id = ''

function loadFixture(): Fixture {
  return JSON.parse(fs.readFileSync(path.resolve(__dirname, FIXTURE_FILE), 'utf-8')) as Fixture
}

function fillPlaceholders(fixture: Fixture): Fixture {
  const text = JSON.stringify(withToken(fixture, token))
    .split('__TODAY__')
    .join(utcDayStamp(seededAt))
    .split('__DOC10_ID__')
    .join(doc10Id)
  return JSON.parse(text) as Fixture
}

/** Every Search dials the direct node as `wave` and stores no secret; the save rules hold; then the fills. */
function prepareFixture(fixture: Fixture): Fixture {
  for (const node of fixture.workflow.nodes) {
    const { description, templateFields, expressionFields, config } = node.data
    const what = `"${description}"`
    for (const [row, value] of Object.entries(config.values)) {
      if (typeof value === 'string' && value.includes('{{')) {
        expect(templateFields, `${what} lists its {{ }} row ${row} as a template (save rule 1)`).toContain(row)
      }
    }
    expect(
      templateFields.filter((row) => expressionFields.includes(row)),
      `${what} puts no row in both lists`,
    ).toEqual([])
    if (node.data.elementType !== 'opensearch') continue
    expect(node.data.label, `${what} is named as it is described`).toBe(description)
    expect(expressionFields, `${what} expression rows (save rule 2)`).toEqual(
      EXPRESSION_ROWS[description] ?? [],
    )
    expect(config.values.url, `${what} carries the host-mode address the import rewrites`).toBe(DIRECT_URL)
    expect(config.values.username, `${what} logs in as wave`).toBe(OPENSEARCH_USER)
    expect(config.values.verify_ssl, `${what} verifies the certificate`).toBe(true)
    expect(config.values.on_error, `${what} fails the block on error`).toBe('fail')
    for (const row of ['password', 'api_key', 'bearer_token', 'ca_cert', 'client_cert', 'client_key']) {
      expect(config.values[row], `${what} stores no ${row}`).toBe('')
    }
    config.values.password = OPENSEARCH_PASSWORD
    config.values.ca_cert = CA_CERT_PEM
  }
  return fixture
}

function nodeByDescription(fixture: Fixture, description: string): FixtureNode {
  const found = fixture.workflow.nodes.filter((node) => node.data.description === description)
  expect(found, `the fixture must declare one block described "${description}"`).toHaveLength(1)
  return found[0]
}

/** F-LOGS documents as Results rows for the given Fields entries. */
function logRows(docs: readonly OpenSearchDoc[], fields: readonly string[]): unknown[][] {
  return docs.map((doc) =>
    fields.map((field) =>
      field.split('.').reduce<unknown>((node, key) => (node as Record<string, unknown>)[key], doc),
    ),
  )
}

function newestFirst(docs: readonly OpenSearchDoc[]): OpenSearchDoc[] {
  return [...docs].sort((a, b) => String(b['@timestamp']).localeCompare(String(a['@timestamp'])))
}

function logsWhere(predicate: (doc: OpenSearchDoc) => boolean): OpenSearchDoc[] {
  return newestFirst(F_LOGS.filter(predicate))
}

const levelOf = (doc: OpenSearchDoc): string => (doc.log as { level: string }).level

test.describe('V-PLUGIN-OPENSEARCH-SEARCH-FUNCTIONAL: Search mode against the real cluster', () => {
  test.beforeAll(async () => {
    token = newToken()
    seededAt = new Date()
    const app = openSearchIndexName(token, 'app-logs')
    await createOpenSearchIndex(app, MAP_LOGS)
    doc10Id = (await seedOpenSearch(app, F_LOGS))[9]
    const bulk = openSearchIndexName(token, 'bulk')
    await createOpenSearchIndex(bulk, MAP_PAGE)
    await seedOpenSearch(bulk, bulkPageDocs(PAGE_DOCS))
    const dailies = dailyIndexNames(token, seededAt)
    const daily = dailyDocs(seededAt)
    for (const [i, name] of dailies.entries()) {
      await createOpenSearchIndex(name, MAP_LOGS)
      await seedOpenSearch(name, [daily[i]])
    }
    // L-LIVE: the mapping only, so the first rounds find the fields and 0 results.
    await createOpenSearchIndex(openSearchIndexName(token, 'live-a'), MAP_LOGS)
    await createOpenSearchIndex(openSearchIndexName(token, 'live-b'), MAP_LOGS)
  })

  test.afterAll(async ({ request }) => {
    await request.delete(`${BACKEND_URL}/workbench/session/`).catch(() => undefined)
    for (const testId of createdTests.splice(0)) {
      await request.delete(`${BACKEND_URL}/tests/${testId}`).catch(() => undefined)
    }
    if (token) await deleteOpenSearchIndexes(token)
  })

  test('wait-then-collect, Max results, escaping, Query DSL and expressions, shapes, sort, paging, date math', async ({
    page,
  }) => {
    test.setTimeout(300_000)
    const app = openSearchIndexName(token, 'app-logs')
    const bulk = openSearchIndexName(token, 'bulk')
    const liveA = openSearchIndexName(token, 'live-a')
    const liveB = openSearchIndexName(token, 'live-b')
    const fixture = prepareFixture(fillPlaceholders(loadFixture()))

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
    const runStartedMs = Date.now()
    const status = await startRun(page)

    let seedA: OpenSearchDoc[] = []
    let seedB: OpenSearchDoc[] = []
    await test.step('WAIT: the live documents land only after the first round on -live-a found none', async () => {
      const firstRound = new RegExp(`^Search ${escapeRegExp(liveA)} from .*: 0 results, 0 kept, \\d+\\.\\d{2} s$`)
      await waitForConsoleMessage(page, firstRound, 90_000)
      seedA = liveDocs(LIVE_A, Date.now())
      await seedOpenSearch(liveA, seedA)
      seedB = liveDocs(LIVE_B, Date.now())
      await seedOpenSearch(liveB, seedB)
    })

    await finishRun(page, status, BOOKEND, 240_000)

    const variables = (await getSessionVariables(page, await getActiveSessionId(page))) as SessionVariables
    const entries = consoleEntriesFromCopy(await getLogCopyTexts(page))
    const messages = entries.map((entry) => entry.message)
    const dump = formatEntries(entries)
    const expectLog = (line: string): void => {
      expect(messages, `the console must carry "${line}".\n${dump}`).toContain(line)
    }
    const expectNoLog = (prefix: string): void => {
      expect(
        messages.filter((message) => message.startsWith(prefix)),
        `the console must not carry "${prefix}..."`,
      ).toEqual([])
    }
    const expectTable = (name: string, columns: string[], rows: unknown[][]): void => {
      const table = sessionTable(variables, name)
      expect(table.columns.map((column) => column.name), `${name} columns`).toEqual(columns)
      expect(table.rows, `${name} rows`).toEqual(rows)
    }
    const expectLines = (name: string, lines: string[]): void => {
      expect(summaryLines(entries, name), `the INFO / WARN lines of "${name}".\n${dump}`).toEqual(
        [...lines].sort(),
      )
    }
    const fixedInfo = (total: string, kept: number): string =>
      `INFO Search ${app} from ${FIXED_FROM_ISO} to ${FIXED_TO_ISO}: ${total}, ${kept} kept, # s`
    const rendered = (name: string): string[] =>
      blockEntries(entries, name)
        .filter((entry: LogEntry) => entry.level === 'DEBUG' && entry.message.startsWith("Rendered 'query': "))
        .map((entry) => entry.message)
    const expectPassed = (description: string): Promise<void> =>
      expectNodeStatus(page, nodeByDescription(fixture, description).id, 'success')

    await test.step('SESSION: every block ran as designed, none failed or ended amber (OS-9)', async () => {
      for (const node of fixture.workflow.nodes) {
        if (UNTAKEN.includes(node.data.description)) {
          const state = await page
            .locator(`[data-testid="workflow-node-${node.id}"]`)
            .getAttribute('data-execution-status')
          expect(['success', 'warning', 'failed'], `"${node.data.description}" never ran`).not.toContain(state)
        } else {
          await expectNodeStatus(page, node.id, 'success')
        }
      }
      expectLog(BOOKEND)
    })

    const testStart = String(sessionValue(variables, 'test_start'))

    await test.step('WAIT-A: at least two rounds, the first finding nothing, then the error branch (OS-4, OS-9)', () => {
      expect(testStart, 'the Python block saved a UTC ISO time').toMatch(ISO_UTC)
      const startMs = Date.parse(testStart)
      expect(startMs, 'test_start was taken after Run was pressed').toBeGreaterThanOrEqual(runStartedMs - 5_000)
      expect(startMs, 'test_start was taken before the live documents were seeded').toBeLessThanOrEqual(
        Date.parse(String(seedA[0]['@timestamp'])),
      )
      expectLog(`os-live-waiting test_start=${testStart}`)

      const rounds = searchSummaries(entries, 'Live A wait search', liveA)
      expect(rounds.length, `the Wait Until ran at least two rounds.\n${dump}`).toBeGreaterThanOrEqual(2)
      for (const round of rounds) expect(round.from, 'every round reads from test_start').toBe(testStart)
      expect(rounds[0], 'the first round found nothing').toMatchObject({ total: 0, kept: 0 })
      for (const round of rounds.slice(0, -1)) expect(round.total, 'rounds before the last found nothing').toBe(0)
      const last = rounds[rounds.length - 1]
      // The last round counts the matching lines stamped up to its own now.
      const visible = seedA.filter(
        (doc) =>
          (levelOf(doc) === 'ERROR' || doc.message === 'Batch complete') &&
          Date.parse(String(doc['@timestamp'])) <= Date.parse(last.to),
      ).length
      expect(visible, 'the last round saw the ERROR line').toBeGreaterThanOrEqual(1)
      expect(last, 'the last round found the seeded lines and kept one').toMatchObject({ total: visible, kept: 1 })
      const lines = summaryLines(entries, 'Live A wait search')
      expect(lines.filter((line) => line.startsWith('INFO ')), 'one INFO line per round').toHaveLength(rounds.length)
      expect(
        lines.filter((line) => !line.startsWith('INFO ')),
        'the only WARN is the last round\'s Max results cut; nothing amber',
      ).toEqual(visible > 1 ? [`WARN Kept 1 of ${visible} results (Max results)`] : [])
      expect(sessionValue(variables, 'found_a')).toBe(visible)
      expectTable('final_a', LOG_COLUMNS, [[seedA[1]['@timestamp'], 'ERROR', 'Payment failed']])
      expect(sessionValue(variables, 'wait_a_passed')).toBe(true)
      expect(Number(sessionValue(variables, 'wait_a_elapsed')), 'one 2000 ms interval per round').toBeGreaterThanOrEqual(
        2000 * rounds.length,
      )
      expectLog('os-live-a-branch=error message=Payment failed')
      expectNoLog('os-live-a-branch=success')
    })

    await test.step('WAIT-B: the success branch, then the collecting Search keeps all four lines (OS-4, OS-6)', async () => {
      const rounds = searchSummaries(entries, 'Live B wait search', liveB)
      expect(rounds.length, `the wait on -live-b searched.\n${dump}`).toBeGreaterThanOrEqual(1)
      for (const round of rounds) expect(round.from, 'every round reads from test_start').toBe(testStart)
      expect(rounds[rounds.length - 1]).toMatchObject({ total: 1, kept: 1 })
      expect(
        summaryLines(entries, 'Live B wait search').filter((line) => !line.startsWith('INFO ')),
        'one match, one kept: no WARN, nothing amber',
      ).toEqual([])
      expect(sessionValue(variables, 'found_b')).toBe(1)
      expectTable('final_b', LOG_COLUMNS, [[seedB[3]['@timestamp'], 'INFO', 'Batch complete']])
      expect(sessionValue(variables, 'wait_b_passed')).toBe(true)
      expectLog('os-live-b-branch=success')
      expectNoLog('os-live-b-branch=error')

      expectLines('Live B collect', [
        `INFO Search ${liveB} from ${testStart} to ${String(seedB[3]['@timestamp'])}: 4 results, 4 kept, # s`,
      ])
      expect(sessionValue(variables, 'logs_total_b')).toBe(4)
      expectTable('logs_b', LOG_COLUMNS, seedB.map((doc) => [doc['@timestamp'], levelOf(doc), doc.message]))
      for (const assertion of ['Live B total', 'Live B first', 'Live B last']) await expectPassed(assertion)
      expectLog('os-live-b-collected total=4 first=Batch started last=Batch complete')
    })

    await test.step('W2-TOTAL: Max results 1 keeps one row, Total results stays 6, the block passes (OS-9)', async () => {
      expectLines('W2 total', [fixedInfo('6 results', 1), 'WARN Kept 1 of 6 results (Max results)'])
      const info = blockEntries(entries, 'W2 total').filter((entry) => entry.level === 'INFO')
      expect(info.map((entry) => entry.message)).toEqual([
        expect.stringMatching(
          new RegExp(
            `^Search ${escapeRegExp(app)} from 2026-09-25T10:00:00\\.000Z to 2026-09-25T10:04:59\\.000Z: 6 results, 1 kept, \\d+\\.\\d{2} s$`,
          ),
        ),
      ])
      await expectPassed('W2 total')
      expect(sessionValue(variables, 'w2_total')).toBe(6)
      expectTable('w2_rows', LOG_COLUMNS, logRows(logsWhere((doc) => levelOf(doc) === 'ERROR').slice(0, 1), LOG_COLUMNS))
      await expectPassed('W2 total is 6')
      expectLog('os-w2-total total=6 kept=1')
    })

    await test.step('W2-CELL: a quote inside DQL quotes is escaped (OS-5)', async () => {
      expect(rendered('W2 cell'), 'the value lands escaped inside the quotes').toEqual([
        `Rendered 'query': trace.id: "a1\\"b"`,
      ])
      expectLines('W2 cell', [fixedInfo('1 result', 1)])
      expect(sessionValue(variables, 'txn_total')).toBe(1)
      expectTable('txn', LOG_COLUMNS, logRows(logsWhere((doc) => doc.message === 'Card declined'), LOG_COLUMNS))
      await expectPassed('W2 cell message')
      expectLog('os-w2-cell total=1 message=Card declined')
    })

    await test.step('ESC-WORD: a value outside quotes is one literal value, never two names (OS-5)', () => {
      expectLines('Escape word', [fixedInfo('0 results', 0)])
      expect(sessionValue(variables, 'esc_total')).toBe(0)
      expectTable('esc_rows', LOG_COLUMNS, [])
      expectLog('os-esc-word total=0')
    })

    await test.step('DSL-VALUE: an integer standing alone in Query DSL is a JSON number (OS-5)', () => {
      expect(rendered('DSL value')).toEqual([`Rendered 'query': {"range": {"latency_ms": {"gte": 800}}}`])
      expectLines('DSL value', [fixedInfo('3 results', 3)])
      expect(sessionValue(variables, 'dsl_total')).toBe(3)
      const fields = ['@timestamp', 'latency_ms', 'message']
      expectTable('dsl_rows', fields, logRows(logsWhere((doc) => Number(doc.latency_ms) >= 800), fields))
      expectLog('os-dsl-value total=3')
    })

    await test.step('DSL-PASTED: a pasted request keeps only its query and names what it dropped (OS-5)', () => {
      expectLines('DSL pasted', [
        'INFO Query: kept only "query" from the pasted request; dropped "size", "sort"',
        fixedInfo('1 result', 1),
      ])
      expect(sessionValue(variables, 'pasted_total')).toBe(1)
      expectTable('pasted_rows', LOG_COLUMNS, logRows(logsWhere((doc) => levelOf(doc) === 'WARN'), LOG_COLUMNS))
      expectLog('os-dsl-pasted total=1 message=Retrying payment')
    })

    await test.step('EXPR: the Query row in expression mode builds the DQL text (OS-5)', () => {
      expectLines('Expression query', [fixedInfo('3 results', 3)])
      expect(sessionValue(variables, 'expr_total')).toBe(3)
      expectTable('expr_rows', LOG_COLUMNS, logRows(logsWhere((doc) => levelOf(doc) === 'INFO'), LOG_COLUMNS))
      expectLog('os-expr total=3')
    })

    await test.step('BY-ID: DQL on _id finds document 10 (OS-8)', () => {
      expectLines('By id', [fixedInfo('1 result', 1)])
      expect(sessionValue(variables, 'byid_total')).toBe(1)
      expectTable('byid_rows', ['_id', 'message'], [[doc10Id, 'Batch complete']])
      expectLog('os-by-id total=1 message=Batch complete')
    })

    await test.step('SHAPES: dotted columns with arrays as JSON text, and the whole document as _source (OS-6, OS-8)', () => {
      expectLines('Shapes fields', [fixedInfo('1 result', 1)])
      const shapes = sessionTable(variables, 'shape_rows')
      const cells = Object.fromEntries(
        shapes.columns.map((column, i) => [column.name, shapes.rows.map((row) => row[i])]),
      )
      expect(cells, 'one dotted column per leaf, the array as JSON text').toEqual({
        '@timestamp': ['2026-09-25T10:00:05.000Z'],
        'user.id': ['u1'],
        'user.name': ['ann'],
        'user.roles': ['["a","b"]'],
      })
      // Soft: a wrong leaf order is recorded while the cases after it still run.
      expect
        .soft(shapes.columns.map((column) => column.name), 'the leaf columns keep the document order')
        .toEqual(['@timestamp', 'user.id', 'user.name', 'user.roles'])
      expectLog('os-shapes-fields total=1 roles=["a","b"]')
      expectLines('Shapes source', [fixedInfo('1 result', 1)])
      expectTable('source_rows', ['_source'], [[JSON.stringify(F_LOGS[0])]])
      expectLog('os-shapes-source total=1')
    })

    await test.step('SORT: Sort by latency_ms, Newest first, keeps the 1500 ms line (OS-6)', () => {
      expectLines('Sort by latency', [fixedInfo('10 results', 1), 'WARN Kept 1 of 10 results (Max results)'])
      expect(sessionValue(variables, 'sort_total')).toBe(10)
      expectTable(
        'sort_rows',
        ['@timestamp', 'latency_ms', 'message'],
        [['2026-09-25T10:02:10.000Z', 1500, 'Timeout calling bank']],
      )
      expectLog('os-sort total=10 message=Timeout calling bank latency=1500')
    })

    const pageInfo = (kept: number): string =>
      `INFO Search ${bulk} from 2026-09-25T10:00:00.000Z to 2026-09-25T10:00:05.000Z: ${PAGE_DOCS} results, ${kept} kept, # s`
    const pageAll = sessionTable(variables, 'page_all_rows')

    await test.step('PAGE-ALL: Max results 0 pages past 10,000, loses nothing and prints no row (OS-6, OS-10)', () => {
      expectLines('Page all', [pageInfo(PAGE_DOCS)])
      expect(sessionValue(variables, 'page_all_total')).toBe(PAGE_DOCS)
      expect(pageAll.columns.map((column) => column.name)).toEqual(['_id', 'seq'])
      expect(pageAll.rows, 'Results keeps every document').toHaveLength(PAGE_DOCS)
      const ids = pageAll.rows.map((row) => String(row[0]))
      expect(new Set(ids).size, 'every _id once').toBe(PAGE_DOCS)
      const seqs = pageAll.rows.map((row) => Number(row[1]))
      expect([...seqs].sort((a, b) => a - b), 'every seq once').toEqual(
        Array.from({ length: PAGE_DOCS }, (_unused, i) => i + 1),
      )
      // B-PAGE stamps seq n at second (n - 1) % 5, so Newest first never goes back up.
      const seconds = seqs.map((seq) => (seq - 1) % 5)
      expect(
        seconds.findIndex((second, i) => i > 0 && second > seconds[i - 1]),
        'the rows come in sort order across the pages',
      ).toBe(-1)
      const pages = searchBodies(entries, 'Page all', bulk)
      expect(pages.map((body) => body.size), 'two pages of 10000').toEqual([10000, 10000])
      expect(pages[0].search_after, 'the first page starts at the top').toBeUndefined()
      expect(pages[1].search_after, 'the second page starts after row 10000').toEqual([
        expect.any(Number),
        ids[9999],
      ])
      // A request line may carry its paging cursor; nothing else of a row may reach the console.
      const text = withoutCursors(entries.map((entry) => `${entry.source} ${entry.message}`).join('\n'))
      expect(ids.filter((id) => text.includes(id)), 'no Results row reaches the console').toEqual([])
      expect(messages.filter((message) => /\.\.\. and \d+ more/.test(message)), 'no row summary either').toEqual([])
      expectLog(`os-page-all total=${PAGE_DOCS} kept=${PAGE_DOCS}`)
    })

    await test.step('PAGE-CUT: Max results 10001 keeps the first 10001 rows and warns (OS-9)', async () => {
      expectLines('Page cut', [pageInfo(PAGE_CUT), `WARN Kept ${PAGE_CUT} of ${PAGE_DOCS} results (Max results)`])
      await expectPassed('Page cut')
      expect(sessionValue(variables, 'page_cut_total')).toBe(PAGE_DOCS)
      const cut = sessionTable(variables, 'page_cut_rows')
      expect(cut.rows, 'the same order as the full read, cut at Max results').toEqual(pageAll.rows.slice(0, PAGE_CUT))
      expect(new Set(cut.rows.map((row) => String(row[0]))).size, 'every kept _id once').toBe(PAGE_CUT)
      expect(
        searchBodies(entries, 'Page cut', bulk).map((body) => [body.size, body.search_after]),
        'a full page, then only the one row Max results still wants',
      ).toEqual([
        [10000, undefined],
        [1, [expect.any(Number), String(cut.rows[9999][0])]],
      ])
      expectLog(`os-page-cut total=${PAGE_DOCS} kept=${PAGE_CUT}`)
    })

    await test.step('DATE-MATH: a date-math name reads today only; a wildcard minus today reads the others (OS-4)', () => {
      const daily = dailyDocs(seededAt)
      const stamps = daily.map((doc) => String(doc.message))
      const todayIndex = `<${openSearchIndexName(token, 'daily-{now/d}')}>`
      const today = searchSummaries(entries, 'Date math today', todayIndex)
      expect(today, `one INFO line for the date-math name.\n${dump}`).toHaveLength(1)
      expect(today[0]).toMatchObject({ total: 1, kept: 1 })
      expect(Date.parse(today[0].to) - Date.parse(today[0].from), 'From now-3d, To now').toBe(3 * DAY_MS)
      expect(summaryLines(entries, 'Date math today'), 'no WARN').toHaveLength(1)
      expect(sessionValue(variables, 'today_total')).toBe(1)
      expectTable('today_rows', ['@timestamp', 'message'], [[daily[0]['@timestamp'], stamps[0]]])
      expectLog(`os-date-math-today total=1 message=${stamps[0]}`)

      const othersIndex = `${openSearchIndexName(token, 'daily-*')},-${openSearchIndexName(token, `daily-${stamps[0]}`)}`
      const others = searchSummaries(entries, 'Date math others', othersIndex)
      expect(others, `one INFO line for the exclusion list.\n${dump}`).toHaveLength(1)
      expect(others[0]).toMatchObject({ total: 2, kept: 2 })
      expect(summaryLines(entries, 'Date math others'), 'no WARN').toHaveLength(1)
      expect(sessionValue(variables, 'others_total')).toBe(2)
      expectTable('others_rows', ['@timestamp', 'message'], [
        [daily[1]['@timestamp'], stamps[1]],
        [daily[2]['@timestamp'], stamps[2]],
      ])
      expectLog('os-date-math-others total=2')
    })
  })
})
