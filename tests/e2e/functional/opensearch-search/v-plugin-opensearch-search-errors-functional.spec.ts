/**
 * V-PLUGIN-OPENSEARCH-SEARCH-ERRORS-FUNCTIONAL: every way a Search fails or ends amber against the real cluster
 * Wireframe: N/A
 * Design Decisions: OS-9, OS-10, OS-11
 * REQ: REQ-3.4.1.15, REQ-5.1.2, REQ-3.3.2.6
 *
 * `fixture-errors.json` chains one Search per case, each On error = Record and continue and followed by a Log
 * `os-err-<case> reason=... error=...`, then a last Search that fails the block and a Log that never runs.
 * `fixture-stop.json` holds one slow Search the spec stops from the canvas. Secrets are filled at load.
 *
 * Pass Criteria:
 * 1. Both fixtures import through POST /tests with no repairs and validate with zero findings.
 * 2. URL-CREDS: a Cluster URL holding `wave:<password>@` is refused with Validation and the password text never
 *    appears in the run log, DEBUG included.
 * 3. UNREACH: `https://127.0.0.1:9479` records Unreachable `Could not connect to OpenSearch at 127.0.0.1:9479:
 *    [Errno 111] Connection refused`.
 * 4. AUTH-401: `wave` with a wrong password records AuthFailed `HTTP 401: Unauthorized`.
 * 5. AUTH-403: `wave-limited` on the run's index records AuthFailed, the error starting
 *    `security_exception: no permissions for [indices:data/read/`.
 * 6. SHARDS: Query DSL `{"term": {"latency_ms": "abc"}}` records RequestFailed with the first root cause and the
 *    query as sent.
 * 7. PARSE: Query DSL `{"matchall": {}}` records RequestFailed starting `parsing_exception: unknown query [matchall]`.
 * 8. TWO-CREDS, EPOCH-S, DQL-SYNTAX: each records Validation with its own text and sends nothing.
 * 9. TIME-FIELD: Time field `log.level` records Validation `... is not a date field in <index>: it is keyword`.
 * 10. NO-INDEX, UNKNOWN-FIELD, PARTIAL: the block ends amber with its WARN and its INFO summary, Success true,
 *     Total 0, 0 and 1.
 * 11. TIMEOUT: the slow query with Timeout 2 records Timeout; within 5 s of the Timeout the search is canceled or
 *     gone on the cluster.
 * 12. Every recorded failure logs one WARN `Search failed (<Reason>): <error>`, binds Success false, Total 0 and
 *     empty Results, ends amber, and its Log prints exactly `os-err-<case> reason=<Reason> error=<error>`.
 * 13. FAIL: the last Search (On error = Fail the block) fails, the Log after it never prints, and the run ends
 *     failed with that block as its only failure.
 * 14. STOP: once the slow Search runs on the cluster, the canvas Stop and "Stop Immediately" end the run stopped,
 *     the block's lines end with the one `Stopped by user` mark, the Log after it never prints, and within 5 s
 *     the search is canceled or gone on the cluster.
 */

import fs from 'fs'
import path from 'path'
import { test, expect, type Page } from '../../helpers/playwright-fixtures'
import {
  BACKEND_URL,
  CA_CERT_PEM,
  OPENSEARCH_LIMITED_PASSWORD,
  OPENSEARCH_PASSWORD,
  OPENSEARCH_USER,
} from '../../helpers/config'
import {
  getActiveSessionId,
  getSessionVariables,
  importValidateAndNavigate,
  sessionTable,
  sessionValue,
  type SessionVariables,
} from '../../helpers/fixture-import'
import { validateTest } from '../../helpers/fn-seed'
import { expectNodeStatus, finishRunAnyVerdict, startRun } from '../../helpers/k8s-run'
import {
  formatEntries,
  getLogCopyTexts,
  setConsoleMinimumLevel,
  type LogEntry,
} from '../../helpers/log-reader'
import {
  createOpenSearchIndex,
  calibrateSlowQuery,
  deleteOpenSearchIndexes,
  F_LOGS,
  FIXED_FROM,
  FIXED_FROM_ISO,
  FIXED_TO,
  FIXED_TO_ISO,
  MAP_LOGS,
  MAP_SLOW,
  openSearchIndexName,
  seedOpenSearch,
  slowDocs,
  waitForSearchTaskGone,
  waitForSearchTaskRunning,
  type OpenSearchMappings,
} from '../../helpers/opensearch-stack'
import { blockSource, consoleEntriesFromCopy, newToken, withToken } from '../shell-blocks/shell-helpers'
import { repeatedSlowQuery } from './errors-helpers'

interface FixtureNode {
  id: string
  data: {
    label: string
    elementType: string
    description: string
    expressionFields: string[]
    config: { values: Record<string, unknown>; outputBindings: Record<string, string> }
  }
}

interface Fixture {
  name: string
  workflow: { nodes: FixtureNode[]; edges: Array<Record<string, unknown>> }
  [key: string]: unknown
}

type Kind = 'recorded' | 'amber'
type Fill = 'password' | 'wrong_password' | 'limited_password' | 'api_key' | 'url_credentials' | 'slow_query'

interface ErrorCase {
  /** The Search block's Name, which is also its Description. */
  block: string
  /** The prefix of the case's variables in the fixture. */
  key: string
  /** The case's Log line starts `os-err-<slug> `. */
  slug: string
  kind: Kind
  fills: Fill[]
  /** The endpoints of the block's DEBUG request lines, sorted. */
  requests: string[]
}

/** A reason and its error: the whole text, or the start a varying cluster text must begin with. */
interface Recorded {
  reason: string
  error: string
  prefix?: string
}

/** An amber outcome: its WARN, the pattern it searched, its Total and its Results. */
interface Amber {
  warn: string
  index: string
  total: number
  columns: string[]
  rows: unknown[][]
}

const ERRORS_FIXTURE = 'fixture-errors.json'
const STOP_FIXTURE = 'fixture-stop.json'
const DIRECT_URL = 'https://127.0.0.1:9477'
/** Nothing listens on 9479 and the import never rewrites it, so every mode dials its own loopback. */
const CLOSED_URL = 'https://127.0.0.1:9479'
const UNREACHABLE_ERROR = 'Could not connect to OpenSearch at 127.0.0.1:9479: [Errno 111] Connection refused'
const WRONG_PASSWORD = 'not-the-password'
// Held by no secret row anywhere in the run, so the run-wide masking cannot hide a leak.
const URL_ONLY_PASSWORD = 'url-only-Pass-5k'
/** Refused before anything is sent, so the cluster never sees it. */
const UNUSED_API_KEY = 'os_never-sent'
const SLOW_PLACEHOLDER = '__SLOW_QUERY__'
const TIMEOUT_SECONDS = 2
const CANCEL_WINDOW_MS = 5_000
/** Three distinct copies of the slow filter make one search outlast the Timeout plus the 5 s window. */
const SLOW_COPIES = 3
const SECRET_ROWS = ['password', 'api_key', 'bearer_token', 'client_cert', 'client_key']
const FAIL_BLOCK = 'Fail the block'
const FAIL_AFTER = 'os-err-fail-after'
/** The session outcome line; the import adds a unique suffix to the Test name. */
const HALTED_FAILED = /^Test 'V-PLUGIN-OPENSEARCH-SEARCH-ERRORS [^']+' halted with status: failed$/
const STOP_BLOCK = 'Slow search'
const STOP_AFTER = 'os-stop-after'
/** The engine's mark on the block a Stop interrupts; it carries that block's Source (EXEC-25). */
const STOP_MARK = 'WARN Stopped by user'
const MASK = '********'

const FIELD_CAPS = 'GET _field_caps'
const SEARCH = 'POST _search'
const NOTHING_SENT: string[] = []
const FIELDS_ONLY = [FIELD_CAPS]
const BOTH = [FIELD_CAPS, SEARCH]

const PASSWORD: Fill[] = ['password']

function errorCase(
  block: string,
  key: string,
  slug: string,
  kind: Kind,
  requests: string[],
  fills: Fill[] = PASSWORD,
): ErrorCase {
  return { block, key, slug, kind, requests, fills }
}

const CASES: ErrorCase[] = [
  errorCase('URL with credentials', 'urlcreds', 'url-creds', 'recorded', NOTHING_SENT, ['url_credentials']),
  errorCase('Unreachable', 'unreach', 'unreach', 'recorded', FIELDS_ONLY),
  errorCase('Wrong password', 'auth401', 'auth-401', 'recorded', FIELDS_ONLY, ['wrong_password']),
  errorCase('No permission', 'auth403', 'auth-403', 'recorded', FIELDS_ONLY, ['limited_password']),
  errorCase('All shards failed', 'shards', 'shards', 'recorded', BOTH),
  errorCase('Unknown query', 'parse', 'parse', 'recorded', BOTH),
  errorCase('Two credentials', 'twocreds', 'two-creds', 'recorded', NOTHING_SENT, ['api_key']),
  errorCase('Epoch seconds', 'epochs', 'epoch-s', 'recorded', NOTHING_SENT),
  errorCase('DQL syntax', 'dql', 'dql-syntax', 'recorded', NOTHING_SENT),
  errorCase('Time field not a date', 'timefield', 'time-field', 'recorded', FIELDS_ONLY),
  errorCase('No index', 'noindex', 'no-index', 'amber', FIELDS_ONLY),
  errorCase('Unknown field', 'unknown', 'unknown-field', 'amber', BOTH),
  errorCase('Partial results', 'partial', 'partial', 'amber', BOTH),
  errorCase('Timeout', 'timeout', 'timeout', 'recorded', BOTH, ['password', 'slow_query']),
]

const RECORDED_CASES = CASES.filter((c) => c.kind === 'recorded')
const AMBER_CASES = CASES.filter((c) => c.kind === 'amber')

/** M-MIXED: `latency_ms` long in `-mixed-a`, keyword in `-mixed-b`, one document each. */
function mixedMapping(latencyType: string): OpenSearchMappings {
  return { properties: { '@timestamp': { type: 'date' }, latency_ms: { type: latencyType } } }
}

const MIXED_TIMESTAMP = '2026-09-25T10:00:00Z'

const createdTests: string[] = []
let token = ''
let slowN = 0

function loadFixture(file: string): Fixture {
  return JSON.parse(fs.readFileSync(path.resolve(__dirname, file), 'utf-8')) as Fixture
}

function blockOf(fixture: Fixture, description: string): FixtureNode {
  const found = fixture.workflow.nodes.filter((node) => node.data.description === description)
  expect(found, `the fixture must declare one block described "${description}"`).toHaveLength(1)
  return found[0]
}

function expectNoSecretStored(values: Record<string, unknown>, what: string): void {
  for (const row of SECRET_ROWS) {
    expect(values[row], `${what} stores no ${row}`).toBe('')
  }
}

function fill(values: Record<string, unknown>, fills: readonly Fill[]): void {
  values.ca_cert = CA_CERT_PEM
  for (const item of fills) {
    if (item === 'password') values.password = OPENSEARCH_PASSWORD
    if (item === 'wrong_password') values.password = WRONG_PASSWORD
    if (item === 'limited_password') values.password = OPENSEARCH_LIMITED_PASSWORD
    if (item === 'api_key') values.api_key = UNUSED_API_KEY
    if (item === 'url_credentials') {
      values.url = DIRECT_URL.replace('://', `://${OPENSEARCH_USER}:${URL_ONLY_PASSWORD}@`)
    }
    if (item === 'slow_query') {
      expect(values.query, 'the slow Search holds the slow-query placeholder').toBe(SLOW_PLACEHOLDER)
      values.query = repeatedSlowQuery(slowN, SLOW_COPIES)
    }
  }
}

/** Every Search is recorded but the last, stores no secret, and gets its fills from config. */
function prepareErrorsFixture(fixture: Fixture): Fixture {
  const searches = fixture.workflow.nodes.filter((node) => node.data.elementType === 'opensearch')
  expect(searches.map((node) => node.data.description), 'one Search per case, in case order, then FAIL').toEqual([
    ...CASES.map((c) => c.block),
    FAIL_BLOCK,
  ])
  expect(searches.map((node) => node.data.label), 'every Search is named as it is described').toEqual(
    searches.map((node) => node.data.description),
  )
  for (const c of CASES) {
    const node = blockOf(fixture, c.block)
    const values = node.data.config.values
    const what = `"${c.block}"`
    expect(values.on_error, `${what} records its failure`).toBe('record')
    expect(Object.keys(node.data.config.outputBindings).sort(), `${what} binds every output`).toEqual([
      'error',
      'reason',
      'results',
      'success',
      'total_results',
    ])
    expectNoSecretStored(values, what)
    fill(values, c.fills)
  }
  const urlCreds = blockOf(fixture, 'URL with credentials').data.config.values
  expect(urlCreds.username, 'URL-CREDS sets no Username: the URL is its only fault').toBe('')
  expect(blockOf(fixture, 'Unreachable').data.config.values.url).toBe(CLOSED_URL)
  expect(blockOf(fixture, 'No permission').data.config.values.username).toBe('wave-limited')
  expect(blockOf(fixture, 'Epoch seconds').data.expressionFields, 'EPOCH-S sets From in expression mode').toEqual([
    'from',
  ])
  expect(blockOf(fixture, 'Timeout').data.config.values.timeout).toBe(TIMEOUT_SECONDS)
  const failing = blockOf(fixture, FAIL_BLOCK).data.config.values
  expect(failing.on_error, 'the last Search fails the block').toBe('fail')
  expect(failing.url).toBe(CLOSED_URL)
  expectNoSecretStored(failing, `"${FAIL_BLOCK}"`)
  fill(failing, PASSWORD)
  return fixture
}

function prepareStopFixture(fixture: Fixture): Fixture {
  const node = blockOf(fixture, STOP_BLOCK)
  const values = node.data.config.values
  expect(node.data.label, 'the stopped Search is named as it is described').toBe(STOP_BLOCK)
  expect(values.timeout, 'the stopped Search keeps the 300 s Timeout').toBe(300)
  expect(values.index, 'the stopped Search reads its own slow index').toBe(openSearchIndexName(token, 'stop-slow'))
  expectNoSecretStored(values, `"${STOP_BLOCK}"`)
  fill(values, ['password', 'slow_query'])
  return fixture
}

async function importAndValidate(page: Page, fixture: Fixture): Promise<void> {
  const testId = await importValidateAndNavigate(page, fixture as unknown as Record<string, unknown>, {
    injectHttp: true,
    rejectRepairs: true,
  })
  createdTests.push(testId)
  const validation = await validateTest(page.request, testId, 'run')
  expect(validation.status, `validate answered ${validation.status}`).toBe(200)
  expect(validation.errors, `zero errors. Got: ${JSON.stringify(validation.errors)}`).toHaveLength(0)
  expect(validation.warnings, `zero warnings. Got: ${JSON.stringify(validation.warnings)}`).toHaveLength(0)
}

function blockEntries(entries: readonly LogEntry[], block: string): LogEntry[] {
  const source = blockSource('OpenSearch', block)
  return entries.filter((entry) => entry.source === source)
}

/** The block's INFO, WARN and ERROR lines as "LEVEL message", the elapsed seconds blanked, sorted. */
function summaryLines(entries: readonly LogEntry[], block: string): string[] {
  return blockEntries(entries, block)
    .filter((entry) => entry.level !== 'DEBUG')
    .map((entry) => `${entry.level} ${entry.message.replace(/, \d+\.\d{2} s$/, ', # s')}`)
    .sort()
}

/** The endpoints the block's DEBUG request lines name, sorted: the harvest does not keep their order. */
function requestEndpoints(entries: readonly LogEntry[], block: string): string[] {
  return blockEntries(entries, block)
    .filter((entry) => entry.level === 'DEBUG' && /^(GET|POST) \//.test(entry.message))
    .map((entry) => {
      const [method, target] = entry.message.split(' ')
      return `${method} ${target.split('?')[0].split('/').pop()}`
    })
    .sort()
}

function inputsEchoes(entries: readonly LogEntry[], block: string): LogEntry[] {
  return blockEntries(entries, block).filter(
    (entry) => entry.level === 'DEBUG' && entry.message.startsWith('Inputs: '),
  )
}

function expectBlockLines(entries: readonly LogEntry[], block: string, expected: string[]): void {
  const own = formatEntries(blockEntries(entries, block))
  expect.soft(summaryLines(entries, block), `the INFO / WARN lines of "${block}".\n${own}`).toEqual([...expected].sort())
}

/** The case's Log wrote exactly one line, and it is this one. */
function expectCaseLog(entries: readonly LogEntry[], slug: string, line: string): void {
  const lines = entries.map((entry) => entry.message).filter((message) => message.startsWith(`os-err-${slug} `))
  expect.soft(lines, `one os-err-${slug} line, exactly as expected`).toEqual([line])
}

/** One Block's execution status, checked softly so every case reports. */
async function expectStatus(page: Page, nodeId: string, status: string): Promise<void> {
  await expect
    .soft(page.locator(`[data-testid="workflow-node-${nodeId}"]`), `block ${nodeId}`)
    .toHaveAttribute('data-execution-status', status)
}

function summaryInfo(index: string, total: number): string {
  const results = total === 1 ? '1 result' : `${total} results`
  return `INFO Search ${index} from ${FIXED_FROM_ISO} to ${FIXED_TO_ISO}: ${results}, ${total} kept, # s`
}

test.describe('V-PLUGIN-OPENSEARCH-SEARCH-ERRORS-FUNCTIONAL: failure reasons, amber outcomes, Timeout and Stop', () => {
  test.beforeAll(async () => {
    test.setTimeout(120_000)
    token = newToken()
    const logs = openSearchIndexName(token, 'app-logs')
    await createOpenSearchIndex(logs, MAP_LOGS)
    await seedOpenSearch(logs, F_LOGS)
    const mixedA = openSearchIndexName(token, 'mixed-a')
    const mixedB = openSearchIndexName(token, 'mixed-b')
    await createOpenSearchIndex(mixedA, mixedMapping('long'))
    await createOpenSearchIndex(mixedB, mixedMapping('keyword'))
    await seedOpenSearch(mixedA, [{ '@timestamp': MIXED_TIMESTAMP, latency_ms: 5 }])
    await seedOpenSearch(mixedB, [{ '@timestamp': MIXED_TIMESTAMP, latency_ms: 'abc' }])
    for (const purpose of ['slow', 'stop-slow']) {
      const index = openSearchIndexName(token, purpose)
      await createOpenSearchIndex(index, MAP_SLOW)
      await seedOpenSearch(index, slowDocs())
    }
    slowN = (await calibrateSlowQuery(openSearchIndexName(token, 'slow'))).n
  })

  test.afterAll(async ({ request }) => {
    await request.delete(`${BACKEND_URL}/workbench/session/`).catch(() => undefined)
    for (const testId of createdTests.splice(0)) {
      await request.delete(`${BACKEND_URL}/tests/${testId}`).catch(() => undefined)
    }
    if (token) await deleteOpenSearchIndexes(token)
  })

  test('every failure reason is recorded, three outcomes end amber, Timeout ends the search, FAIL fails the run', async ({
    page,
  }) => {
    test.setTimeout(240_000)
    expect(slowN, 'the slow query was calibrated in beforeAll').toBeGreaterThan(0)
    const fixture = prepareErrorsFixture(withToken(loadFixture(ERRORS_FIXTURE), token))
    const index = openSearchIndexName(token, 'app-logs')
    const noIndex = openSearchIndexName(token, 'nothing-*')
    const mixed = openSearchIndexName(token, 'mixed-*')
    const slowIndex = openSearchIndexName(token, 'slow')
    const idOf = (description: string): string => blockOf(fixture, description).id
    const bounds = `{"gte":${Date.parse(FIXED_FROM)},"lte":${Date.parse(FIXED_TO)},"format":"epoch_millis"}`
    const shardsPrefix =
      'search_phase_execution_exception: all shards failed. First root cause: query_shard_exception: failed to ' +
      'create query: For input string: "abc". Query as sent: {"bool":{"filter":['

    const RECORDED: Record<string, Recorded> = {
      urlcreds: {
        reason: 'Validation',
        error: 'Cluster URL must not hold a username or password: put them in Username and Password',
      },
      unreach: { reason: 'Unreachable', error: UNREACHABLE_ERROR },
      auth401: { reason: 'AuthFailed', error: 'HTTP 401: Unauthorized' },
      auth403: { reason: 'AuthFailed', error: '', prefix: 'security_exception: no permissions for [indices:data/read/' },
      shards: {
        reason: 'RequestFailed',
        error: `${shardsPrefix}{"range":{"@timestamp":${bounds}}},{"term":{"latency_ms":"abc"}}]}}`,
        prefix: shardsPrefix,
      },
      parse: { reason: 'RequestFailed', error: '', prefix: 'parsing_exception: unknown query [matchall]' },
      twocreds: {
        reason: 'Validation',
        error:
          'Set only one of Username and Password, API Key or Bearer Token: all three go in the one Authorization header',
      },
      epochs: {
        reason: 'Validation',
        error: 'From 1790332925 reads as epoch seconds; the row takes epoch milliseconds: for seconds, multiply by 1000',
      },
      dql: {
        reason: 'Validation',
        error: 'Query is not valid DQL at line 1, column 18: Expected ")", AND, OR, whitespace but end of input found.',
      },
      timefield: { reason: 'Validation', error: `Time field log.level is not a date field in ${index}: it is keyword` },
      timeout: {
        reason: 'Timeout',
        error: `Timed out after ${TIMEOUT_SECONDS} seconds; the connection was shut down, so OpenSearch ends the search`,
      },
    }
    const threeColumns = ['@timestamp', 'log.level', 'message']
    const AMBER: Record<string, Amber> = {
      noindex: {
        warn: `Index pattern ${noIndex} matches no index`,
        index: noIndex,
        total: 0,
        columns: threeColumns,
        rows: [],
      },
      unknown: {
        warn: `Field log.invalid is not in the field list of ${index}`,
        index,
        total: 0,
        columns: threeColumns,
        rows: [],
      },
      partial: {
        warn:
          'Partial results: 1 of 2 shards failed. First failure: query_shard_exception: failed to create query: ' +
          'For input string: "abc"',
        index: mixed,
        total: 1,
        columns: ['@timestamp', 'latency_ms'],
        rows: [[MIXED_TIMESTAMP, 'abc']],
      },
    }

    await importAndValidate(page, fixture)
    await setConsoleMinimumLevel(page, 'DEBUG')
    const status = await startRun(page)

    // Watched while the run goes on: the Timeout search lives about 2 s on the cluster.
    const timeoutWatch = (async (): Promise<void> => {
      await waitForSearchTaskRunning(slowIndex, 150_000)
      const seenAt = Date.now()
      await waitForSearchTaskGone(slowIndex, TIMEOUT_SECONDS * 1000 + CANCEL_WINDOW_MS)
      expect(Date.now() - seenAt, 'canceled or gone within 5 s of the Timeout').toBeLessThanOrEqual(
        TIMEOUT_SECONDS * 1000 + CANCEL_WINDOW_MS,
      )
    })().then(
      () => null,
      (error: unknown) => error,
    )

    const failLine = `Block '${FAIL_BLOCK}' failed: ${UNREACHABLE_ERROR}`
    const { verdict } = await finishRunAnyVerdict(page, status, failLine, 180_000)

    const variables = (await getSessionVariables(page, await getActiveSessionId(page))) as SessionVariables
    const entries = consoleEntriesFromCopy(await getLogCopyTexts(page))

    await test.step('every block ends in its state: recorded and amber Searches amber, FAIL failed (OS-9, OS-11)', async () => {
      for (const c of CASES) {
        await expectStatus(page, idOf(c.block), 'warning')
        await expectStatus(page, idOf(`Proof ${c.slug}`), 'success')
      }
      await expectStatus(page, idOf(FAIL_BLOCK), 'failed')
      await expect.soft(
        page.locator(`[data-testid="workflow-node-${idOf('After the failure')}"]`),
        'the Log after FAIL never ran',
      ).not.toHaveAttribute('data-execution-status', /^(running|success|warning|failed)$/)
    })

    for (const c of RECORDED_CASES) {
      const expected = RECORDED[c.key]
      await test.step(`${c.slug.toUpperCase()}: ${expected.reason} is recorded and logged (OS-11)`, () => {
        const error = String(sessionValue(variables, `${c.key}_error`))
        if (expected.prefix !== undefined) {
          const start = `${c.key}_error starts "${expected.prefix}": ${error}`
          expect.soft(error.startsWith(expected.prefix), start).toBe(true)
        }
        if (expected.error) expect.soft(error, `${c.key}_error`).toBe(expected.error)
        expect.soft(sessionValue(variables, `${c.key}_reason`), `${c.key}_reason`).toBe(expected.reason)
        expect.soft(sessionValue(variables, `${c.key}_ok`), `${c.key}_ok`).toBe(false)
        expect.soft(sessionValue(variables, `${c.key}_total`), `${c.key}_total`).toBe(0)
        expect.soft(sessionTable(variables, `${c.key}_rows`), `${c.key}_rows`).toEqual({ columns: [], rows: [] })
        expectBlockLines(entries, c.block, [`WARN Search failed (${expected.reason}): ${error}`])
        expect.soft(requestEndpoints(entries, c.block), `what "${c.block}" sent`).toEqual(c.requests)
        expectCaseLog(entries, c.slug, `os-err-${c.slug} reason=${expected.reason} error=${error}`)
      })
    }

    for (const c of AMBER_CASES) {
      const expected = AMBER[c.key]
      await test.step(`${c.slug.toUpperCase()}: amber with its WARN, Total ${expected.total} (OS-9, OS-10)`, () => {
        expectBlockLines(entries, c.block, [summaryInfo(expected.index, expected.total), `WARN ${expected.warn}`])
        expect.soft(requestEndpoints(entries, c.block), `what "${c.block}" sent`).toEqual(c.requests)
        expect.soft(sessionValue(variables, `${c.key}_ok`), `${c.key}_ok`).toBe(true)
        expect.soft(sessionValue(variables, `${c.key}_reason`), `${c.key}_reason`).toBe('')
        expect.soft(sessionValue(variables, `${c.key}_error`), `${c.key}_error`).toBe('')
        expect.soft(sessionValue(variables, `${c.key}_total`), `${c.key}_total`).toBe(expected.total)
        const rows = sessionTable(variables, `${c.key}_rows`)
        expect.soft(rows.columns.map((column) => column.name), `${c.key}_rows columns`).toEqual(expected.columns)
        expect.soft(rows.rows, `${c.key}_rows`).toEqual(expected.rows)
        expectCaseLog(entries, c.slug, `os-err-${c.slug} reason= error=`)
      })
    }

    await test.step('URL-CREDS: the password text never appears in the run log, DEBUG included (REQ-5.1.2)', () => {
      const urlCreds = CASES[0]
      const echoes = inputsEchoes(entries, urlCreds.block)
      expect.soft(echoes, 'DEBUG was on: URL-CREDS echoed its inputs once').toHaveLength(1)
      const text = entries.map((entry) => `${entry.source} ${entry.message}`).join('\n')
      const leaks = entries.filter((entry) => entry.message.includes(OPENSEARCH_PASSWORD))
      expect.soft(leaks, `the run log holds the password text.\n${formatEntries(leaks)}`).toEqual([])
      expect.soft(text.includes(OPENSEARCH_PASSWORD), 'the password text in a source column').toBe(false)
      expect.soft(text.includes(URL_ONLY_PASSWORD), 'the run log holds the password typed in the Cluster URL').toBe(false)
      expect.soft(text.includes(WRONG_PASSWORD), 'the run log holds the wrong password').toBe(false)
      expect.soft(text.includes(OPENSEARCH_LIMITED_PASSWORD), 'the run log holds the wave-limited password').toBe(false)
      const filled = inputsEchoes(entries, 'Wrong password')[0]?.message
      expect.soft(filled, 'a filled password echoes as the mask').toContain(MASK)
    })

    await test.step('TIMEOUT: within 5 s of the Timeout the search is canceled or gone on the cluster (OS-11)', async () => {
      const failure = await timeoutWatch
      const detail = failure === null ? '' : String(failure)
      expect.soft(detail, 'the Timeout search was seen running, then canceled or gone in time').toBe('')
    })

    await test.step('FAIL: the block fails, the Log after it never prints, the run fails for it alone (OS-11)', () => {
      expect.soft(verdict, 'the session outcome').toBe('failed')
      const errors = entries.filter((entry) => entry.level === 'ERROR').map((entry) => entry.message)
      const halted = errors.filter((message) => HALTED_FAILED.test(message))
      expect.soft(halted, `the run halts failed once.\n${errors.join('\n')}`).toHaveLength(1)
      const failures = errors.filter((message) => !HALTED_FAILED.test(message))
      expect.soft(failures, 'the only block failure is FAIL').toEqual([failLine])
      expectBlockLines(entries, FAIL_BLOCK, [])
      expect.soft(requestEndpoints(entries, FAIL_BLOCK), 'FAIL only tried the field list').toEqual(FIELDS_ONLY)
      expect.soft(
        entries.some((entry) => entry.message.includes(FAIL_AFTER)),
        'the Log after FAIL never prints',
      ).toBe(false)
    })
  })

  test('STOP: the canvas Stop ends the run and the search on the cluster (OS-11)', async ({ page }) => {
    test.setTimeout(180_000)
    expect(slowN, 'the slow query was calibrated in beforeAll').toBeGreaterThan(0)
    const fixture = prepareStopFixture(withToken(loadFixture(STOP_FIXTURE), token))
    const stopIndex = openSearchIndexName(token, 'stop-slow')
    const blockId = blockOf(fixture, STOP_BLOCK).id

    await importAndValidate(page, fixture)
    await setConsoleMinimumLevel(page, 'DEBUG')
    const status = await startRun(page)
    await waitForSearchTaskRunning(stopIndex, 60_000)

    await page.getByTestId('action-stop-button').click()
    const dialog = page.getByTestId('stop-confirmation-dialog')
    await expect(dialog).toBeVisible()
    await expect(dialog).toContainText('Stop execution immediately?')
    await dialog.getByRole('button', { name: 'Stop Immediately', exact: true }).click()
    const stoppedAt = Date.now()

    await test.step('within 5 s the search is canceled or gone on the cluster (OS-11)', async () => {
      await waitForSearchTaskGone(stopIndex, CANCEL_WINDOW_MS)
      expect(Date.now() - stoppedAt, 'canceled or gone within 5 s of the Stop').toBeLessThanOrEqual(
        CANCEL_WINDOW_MS,
      )
    })

    await test.step('the session ends stopped and the Search paints stopped', async () => {
      await expect(status).toHaveAttribute('data-status', 'stopped', { timeout: 15_000 })
      await expectNodeStatus(page, blockId, 'stopped')
    })

    await test.step('the block logs nothing after the stop mark and the Log after it never prints', async () => {
      const expected = [`DEBUG ${FIELD_CAPS}`, `DEBUG ${SEARCH}`, 'DEBUG Inputs', STOP_MARK].sort()
      let entries: LogEntry[] = []
      const blockLines = (): string[] =>
        blockEntries(entries, STOP_BLOCK)
          .map((entry) => {
            if (entry.message.startsWith('Inputs: ')) return `${entry.level} Inputs`
            const [method, target] = entry.message.split(' ')
            if (entry.level === 'DEBUG' && /^(GET|POST)$/.test(method)) {
              return `${entry.level} ${method} ${target.split('?')[0].split('/').pop()}`
            }
            return `${entry.level} ${entry.message}`
          })
          .sort()
      // A late line would land within seconds of the stop, so the check holds for the whole cancel window.
      await expect
        .poll(
          async () => {
            entries = consoleEntriesFromCopy(await getLogCopyTexts(page))
            return Date.now() - stoppedAt >= CANCEL_WINDOW_MS ? blockLines() : 'settling'
          },
          { timeout: 30_000, intervals: [500], message: 'only the lines written before the stop, then the stop mark' },
        )
        .toEqual(expected)
      expect(
        entries.some((entry) => entry.message.startsWith(STOP_AFTER)),
        `the Log after the stop never prints.\n${formatEntries(entries)}`,
      ).toBe(false)
      expect(
        entries.filter((entry) => entry.level === 'ERROR'),
        `a stop is not a failure.\n${formatEntries(entries)}`,
      ).toEqual([])
    })
  })
})
