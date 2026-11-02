/**
 * V-PLUGIN-OPENSEARCH-REMOTE-FUNCTIONAL: the OpenSearch block inside a Remote Execution body
 * Wireframe: N/A
 * Design Decisions: OS-14, OS-11, OS-8, OS-10
 * REQ: REQ-5.1.2, REQ-3.4.1.15, REQ-3.4.1.3
 *
 * A Remote Execution body on `sshd` holds three OpenSearch blocks that dial the cluster by its
 * compose name `https://opensearch:9200` (only the remote host resolves it), Basic with the WAVE
 * Test CA and Verify Server Certificate on: a Search and an errors-per-minute Aggregate on the
 * run's F-LOGS index, fixed window, then the calibrated slow query on the run's S-SLOW index with
 * Timeout 2 and Record and continue. Logs on WAVE read the outputs after the body. The password
 * and CA are filled at load, the slow query after calibration; none is stored in the fixture.
 *
 * Pass Criteria:
 * 1. The fixture imports through POST /tests with no repairs and validates with zero findings.
 * 2. Every OpenSearch block in the body carries the R locus badge; no other block carries one.
 * 3. NOTHING-INSTALLED: over SSH, `python3 -c "import opensearchpy"` fails on the remote host
 *    with ModuleNotFoundError: no OpenSearch client is installed there.
 * 4. REMOTE-SEARCH: DQL `log.level: "ERROR"` finds Total 6 with the six ERROR documents newest
 *    first; its Results reach a WAVE variable that a Log on WAVE after the body reads.
 * 5. REMOTE-AGG: errors per minute (Group by time 1 minute, Count) gives the rows 2, 0, 4, 0, 0
 *    for 10:00 to 10:04, Total results 6.
 * 6. Each passing block logs only its INFO summary line; the DEBUG request lines come back from
 *    the remote host.
 * 7. REMOTE-TIMEOUT: the slow search is cut by Timeout 2: Reason Timeout, one WARN line, the
 *    block ends amber; the search task on the cluster is canceled or gone within 5 s of running,
 *    and the cluster lists it as canceled (the connection was shut down, the search did not
 *    finish on its own).
 * 8. NO-LEAK: the run log, DEBUG included, never holds `os-secret` nor the Basic credential.
 * 9. The session close lists the one session, the run passes and reaches its bookend.
 */

import fs from 'fs'
import path from 'path'
import { test, expect, type Page } from '../../helpers/playwright-fixtures'
import {
  BACKEND_URL,
  CA_CERT_PEM,
  OPENSEARCH_INTERNAL_PORT,
  OPENSEARCH_PASSWORD,
  OPENSEARCH_SERVICE,
  OPENSEARCH_USER,
  SSH_FIXTURE_HOST_SENTINEL,
  SSH_MAIN_PORT,
  SSH_STACK_PASSWORD,
  SSH_STACK_USER,
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
import { expectNodeStatus, finishRun, startRun } from '../../helpers/k8s-run'
import { formatEntries, getLogCopyTexts, setConsoleMinimumLevel, type LogEntry } from '../../helpers/log-reader'
import {
  createOpenSearchIndex,
  deleteOpenSearchIndexes,
  F_LOGS,
  FIXED_FROM_ISO,
  FIXED_TO_ISO,
  MAP_LOGS,
  MAP_SLOW,
  calibrateSlowQuery,
  openSearchIndexName,
  openSearchSearchTasks,
  seedOpenSearch,
  slowDocs,
  slowQuery,
  waitForSearchTaskGone,
  waitForSearchTaskRunning,
  type OpenSearchTask,
} from '../../helpers/opensearch-stack'
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
  variables: Record<string, { value: unknown; type: string; scope: string; secret?: boolean }>
  [key: string]: unknown
}

const FIXTURE_FILE = 'fixture-opensearch.json'
const BOOKEND = 'os-remote-done'
const LOCUS_BADGE = '[data-testid="node-remote-locus-badge"]'
const MASK = '********'
const CLUSTER_URL = `https://${OPENSEARCH_SERVICE}:${OPENSEARCH_INTERNAL_PORT}`
const SSH_OPEN = 'Open the Execution Host session (secret password)'
const IMPORT_CHECK = 'Try to import an OpenSearch client on the remote host'
const NOT_INSTALLED = "ModuleNotFoundError: No module named 'opensearchpy'"
const TIMEOUT_S = 2
const TIMEOUT_ERROR = `Timed out after ${TIMEOUT_S} seconds; the connection was shut down, so OpenSearch ends the search`
/** The criterion's bound: the cut search is canceled or gone this long after it was seen running. */
const TASK_END_MS = 5_000

interface RemoteCase {
  /** The OpenSearch block's Description, which finds it in the fixture. */
  block: string
  /** The block's Name, as its console Source carries it (EXEC-25). */
  name: string
  /** The prefix of the case's variables in the fixture. */
  key: string
  purpose: 'app-logs' | 'slow'
  mode: 'search' | 'aggregate'
  record: boolean
}

const SEARCH: RemoteCase = {
  block: 'Search on the remote host',
  name: 'Search on the remote host',
  key: 'rs',
  purpose: 'app-logs',
  mode: 'search',
  record: false,
}
const AGG: RemoteCase = {
  block: 'Errors per minute on the remote host',
  name: 'Remote errors per minute',
  key: 'ra',
  purpose: 'app-logs',
  mode: 'aggregate',
  record: false,
}
const SLOW: RemoteCase = {
  block: 'Slow search on the remote host',
  name: 'Slow search on the remote host',
  key: 'rt',
  purpose: 'slow',
  mode: 'search',
  record: true,
}
const BODY = [SEARCH, AGG, SLOW]

/** The six ERROR documents of F-LOGS, newest first, as the Results cells hold them. */
const ERROR_ROWS = F_LOGS.filter((doc) => (doc.log as { level: string }).level === 'ERROR')
  .map((doc) => [doc['@timestamp'], 'ERROR', doc.message] as unknown[])
  .sort((a, b) => String(b[0]).localeCompare(String(a[0])))

/** Errors per minute over the fixed window: 10:00 = 2, 10:01 = 0, 10:02 = 4, 10:03 = 0, 10:04 = 0. */
const ERRORS_PER_MINUTE = [2, 0, 4, 0, 0].map((count, minute) => [`2026-09-25T10:0${minute}:00.000Z`, count])

const createdTests: string[] = []
let token = ''
let slowN = 0

function loadFixture(): Fixture {
  const raw = fs.readFileSync(path.resolve(__dirname, FIXTURE_FILE), 'utf-8')
  expect(raw.includes('__TOKEN__'), 'the fixture names its indexes with the run placeholder').toBe(true)
  expect(raw.includes(OPENSEARCH_PASSWORD), 'the fixture stores no cluster password').toBe(false)
  return JSON.parse(raw) as Fixture
}

function blockOf(fixture: Fixture, description: string): FixtureNode {
  const found = fixture.workflow.nodes.filter((node) => node.data.description === description)
  expect(found, `the fixture must declare one block described "${description}"`).toHaveLength(1)
  return found[0]
}

/** The fixture must carry the harness constants; each body block gets the password, the CA and the slow query here. */
function prepareFixture(fixture: Fixture): Fixture {
  const ssh = blockOf(fixture, SSH_OPEN).data.config.values
  expect(ssh.host, 'the SSH block carries the sentinel the import rewrites').toBe(SSH_FIXTURE_HOST_SENTINEL)
  expect(String(ssh.port), 'the SSH block targets the stack sshd port').toBe(SSH_MAIN_PORT)
  expect(ssh.username).toBe(SSH_STACK_USER)
  expect(ssh.password, 'the password comes from the secret test variable').toBe('ssh_pwd')
  expect(fixture.variables.ssh_pwd.secret, 'the password variable is secret').toBe(true)
  expect(fixture.variables.ssh_pwd.value).toBe(SSH_STACK_PASSWORD)
  expect(blockOf(fixture, IMPORT_CHECK).data.config.values.command).toBe('python3 -c "import opensearchpy"')

  const searches = fixture.workflow.nodes.filter((node) => node.data.elementType === 'opensearch')
  expect(searches.map((node) => node.data.description), 'the three body blocks, in body order').toEqual(
    BODY.map((c) => c.block),
  )
  for (const c of BODY) {
    const node = blockOf(fixture, c.block)
    const values = node.data.config.values
    const what = `"${c.block}"`
    expect(node.data.label, `${what} carries its Name`).toBe(c.name)
    expect(values.url, `${what} dials the compose name only the remote host resolves`).toBe(CLUSTER_URL)
    expect(values.index, `${what} reads the run's own index`).toBe(openSearchIndexName(token, c.purpose))
    expect(values.mode).toBe(c.mode)
    expect(values.username, `${what} logs in with Basic`).toBe(OPENSEARCH_USER)
    expect(values.verify_ssl, `${what} verifies the server certificate`).toBe(true)
    expect(values.on_error, `${what} fails or records`).toBe(c.record ? 'record' : 'fail')
    expect(values.password, `${what} stores no password`).toBe('')
    expect(values.ca_cert, `${what} stores no CA`).toBe('')
    values.password = OPENSEARCH_PASSWORD
    values.ca_cert = CA_CERT_PEM
  }
  const agg = blockOf(fixture, AGG.block).data.config.values
  expect(agg.query, 'errors per minute').toBe('log.level: "ERROR"')
  expect(agg.group_by_time, 'Group by time: Every 1 minute').toBe('1m')
  expect(agg.stats, 'Stats: Count').toEqual([{ value: { stat: 'count' } }])
  const slow = blockOf(fixture, SLOW.block).data.config.values
  expect(slow.query_language).toBe('query_dsl')
  expect(slow.query, 'the slow query is filled after calibration').toBe('')
  expect(slow.timeout, 'Timeout 2').toBe(TIMEOUT_S)
  slow.query = JSON.stringify(slowQuery(slowN))
  return fixture
}

function blockEntries(entries: readonly LogEntry[], c: RemoteCase): LogEntry[] {
  const source = blockSource('OpenSearch', c.name)
  return entries.filter((entry) => entry.source === source)
}

/** The block's INFO and WARN lines as "LEVEL message", the elapsed seconds blanked. */
function summaryLines(entries: readonly LogEntry[], c: RemoteCase): string[] {
  return blockEntries(entries, c)
    .filter((entry) => entry.level !== 'DEBUG')
    .map((entry) => `${entry.level} ${entry.message.replace(/, \d+\.\d{2} s$/, ', # s')}`)
}

/** The DEBUG request lines the block wrote, each cut to its method and path, sorted: the harvest does not keep their order. */
function requestLines(entries: readonly LogEntry[], c: RemoteCase): string[] {
  return blockEntries(entries, c)
    .filter((entry) => entry.level === 'DEBUG' && /^(GET|POST) \//.test(entry.message))
    .map((entry) => entry.message.split(' ').slice(0, 2).join(' '))
    .sort()
}

/** Every body OpenSearch block shows one R badge; nothing outside the body shows one. */
async function expectRemoteLocusBadges(page: Page, fixture: Fixture): Promise<void> {
  const body = BODY.map((c) => blockOf(fixture, c.block).id)
  for (const node of fixture.workflow.nodes) {
    const badge = page.locator(`[data-testid="workflow-node-${node.id}"] ${LOCUS_BADGE}`)
    if (body.includes(node.id)) {
      await expect(badge, `"${node.data.description}" runs inside the body`).toHaveCount(1)
      await expect(badge, `"${node.data.description}" runs on the remote host`).toHaveAttribute('data-locus', 'R')
    } else {
      await expect(badge, `"${node.data.description}" sits outside the body`).toHaveCount(0)
    }
  }
}

test.describe('V-PLUGIN-OPENSEARCH-REMOTE-FUNCTIONAL: the OpenSearch block inside a Remote Execution body', () => {
  test.beforeAll(async () => {
    test.setTimeout(120_000)
    token = newToken()
    const logs = openSearchIndexName(token, 'app-logs')
    await createOpenSearchIndex(logs, MAP_LOGS)
    await seedOpenSearch(logs, F_LOGS)
    const slow = openSearchIndexName(token, 'slow')
    await createOpenSearchIndex(slow, MAP_SLOW)
    await seedOpenSearch(slow, slowDocs())
    slowN = (await calibrateSlowQuery(slow)).n
  })

  test.afterAll(async ({ request }) => {
    await request.delete(`${BACKEND_URL}/workbench/session/`).catch(() => undefined)
    for (const testId of createdTests.splice(0)) {
      await request.delete(`${BACKEND_URL}/tests/${testId}`).catch(() => undefined)
    }
    if (token) await deleteOpenSearchIndexes(token)
  })

  test('searches, aggregates and times out on a remote host with nothing installed', async ({ page }) => {
    test.setTimeout(300_000)
    expect(slowN, 'the slow query was calibrated in beforeAll').toBeGreaterThan(0)
    const logsIndex = openSearchIndexName(token, 'app-logs')
    const slowIndex = openSearchIndexName(token, 'slow')
    const fixture = prepareFixture(withToken(loadFixture(), token))
    const window = `from ${FIXED_FROM_ISO} to ${FIXED_TO_ISO}`
    const fieldCaps = (index: string): string =>
      `GET /${index}/_field_caps?fields=*&ignore_unavailable=true&allow_no_indices=true`

    const testId = await importValidateAndNavigate(page, fixture as unknown as Record<string, unknown>, {
      injectSsh: true,
      rejectRepairs: true,
    })
    createdTests.push(testId)

    const validation = await validateTest(page.request, testId, 'run')
    expect(validation.status, `validate answered ${validation.status}`).toBe(200)
    expect(validation.errors, `zero errors. Got: ${JSON.stringify(validation.errors)}`).toHaveLength(0)
    expect(validation.warnings, `zero warnings. Got: ${JSON.stringify(validation.warnings)}`).toHaveLength(0)

    await test.step('the canvas marks the body OpenSearch blocks as running on the remote host (OS-14)', async () => {
      await expectRemoteLocusBadges(page, fixture)
    })

    await setConsoleMinimumLevel(page, 'DEBUG')
    const status = await startRun(page)

    let listedAfterEnd: OpenSearchTask[] = []
    await test.step('REMOTE-TIMEOUT: the slow search runs on the cluster, then is canceled or gone within 5 s (OS-11)', async () => {
      await waitForSearchTaskRunning(slowIndex, 120_000)
      await waitForSearchTaskGone(slowIndex, TASK_END_MS)
      listedAfterEnd = (await openSearchSearchTasks()).filter((task) => task.description.includes(slowIndex))
    })

    await finishRun(page, status, BOOKEND, 240_000)

    const variables = (await getSessionVariables(page, await getActiveSessionId(page))) as SessionVariables
    const entries = consoleEntriesFromCopy(await getLogCopyTexts(page))
    const messages = entries.map((entry) => entry.message)
    const expectLog = (line: string): void => {
      expect(messages, `the console must carry "${line}".\n${formatEntries(entries)}`).toContain(line)
    }

    await test.step('every block ends in its state: the timed-out Search amber, the rest green (OS-11)', async () => {
      for (const node of fixture.workflow.nodes) {
        await expectNodeStatus(page, node.id, node.data.description === SLOW.block ? 'warning' : 'success')
      }
    })

    await test.step('NOTHING-INSTALLED: the remote host has no OpenSearch client (OS-14)', () => {
      const exit = sessionValue(variables, 'ni_exit')
      expect(exit, 'the import fails on the remote host').toBe(1)
      expect(String(sessionValue(variables, 'ni_err')), 'python3 ran and found no opensearchpy').toContain(
        NOT_INSTALLED,
      )
      expectLog('os-remote-nothing-installed exit=1')
    })

    await test.step('REMOTE-SEARCH: Total 6 on the remote host, its Results read by a Log on WAVE (OS-14, OS-8)', () => {
      expect(summaryLines(entries, SEARCH), `the INFO / WARN lines of "${SEARCH.block}".\n${formatEntries(entries)}`).toEqual([
        `INFO Search ${logsIndex} ${window}: 6 results, 6 kept, # s`,
      ])
      expect(requestLines(entries, SEARCH), 'the remote host read the field list and searched').toEqual([
        fieldCaps(logsIndex),
        `POST /${logsIndex}/_search`,
      ])
      expect(sessionValue(variables, 'rs_ok')).toBe(true)
      expect(sessionValue(variables, 'rs_total')).toBe(6)
      const rows = sessionTable(variables, 'rs_rows')
      expect(rows.columns.map((column) => column.name), 'rs_rows columns').toEqual(['@timestamp', 'log.level', 'message'])
      expect(rows.rows, 'rs_rows holds the ERROR documents newest first').toEqual(ERROR_ROWS)
      expectLog(`os-remote-search total=6 first=${String(ERROR_ROWS[0][2])}`)
    })

    await test.step('REMOTE-AGG: errors per minute on the remote host are 2, 0, 4, 0, 0 (OS-7, OS-8)', () => {
      expect(summaryLines(entries, AGG), `the INFO / WARN lines of "${AGG.block}".\n${formatEntries(entries)}`).toEqual([
        `INFO Aggregate ${logsIndex} ${window}: 6 results, 5 rows, # s`,
      ])
      expect(requestLines(entries, AGG), 'the remote host read the field list and aggregated').toEqual([
        fieldCaps(logsIndex),
        `POST /${logsIndex}/_search`,
      ])
      expect(sessionValue(variables, 'ra_ok')).toBe(true)
      expect(sessionValue(variables, 'ra_total'), 'Total results counts the matching documents').toBe(6)
      const rows = sessionTable(variables, 'ra_rows')
      expect(rows.columns.map((column) => column.name), 'ra_rows columns').toEqual(['@timestamp', 'count'])
      expect(rows.rows, 'one row per minute, quiet minutes as 0').toEqual(ERRORS_PER_MINUTE)
      expectLog('os-remote-agg total=6 counts=2,0,4,0,0')
    })

    await test.step('REMOTE-TIMEOUT: Reason Timeout, and the cluster marked the cut search canceled (OS-11)', () => {
      expect(sessionValue(variables, 'rt_ok'), 'Record and continue: Success is false').toBe(false)
      expect(sessionValue(variables, 'rt_reason')).toBe('Timeout')
      expect(sessionValue(variables, 'rt_error')).toBe(TIMEOUT_ERROR)
      expect(sessionValue(variables, 'rt_total')).toBe(0)
      expect(sessionTable(variables, 'rt_rows')).toEqual({ columns: [], rows: [] })
      expect(summaryLines(entries, SLOW), `one WARN line.\n${formatEntries(entries)}`).toEqual([
        `WARN Search failed (Timeout): ${TIMEOUT_ERROR}`,
      ])
      expect(requestLines(entries, SLOW), 'the remote host sent the slow search').toEqual([
        fieldCaps(slowIndex),
        `POST /${slowIndex}/_search`,
      ])
      expect(
        listedAfterEnd.length > 0 && listedAfterEnd.every((task) => task.canceled),
        `the cut search is still listed, marked canceled (a search that finishes is never marked so). Listed: ${JSON.stringify(listedAfterEnd)}`,
      ).toBe(true)
      expectLog('os-remote-timeout total=0 reason=Timeout')
    })

    await test.step('NO-LEAK: os-secret never reaches the run log, DEBUG included (REQ-5.1.2)', () => {
      for (const c of BODY) {
        const inputs = blockEntries(entries, c).filter(
          (entry) => entry.level === 'DEBUG' && entry.message.startsWith('Inputs: '),
        )
        expect(inputs, `DEBUG was on: "${c.block}" echoed its inputs once`).toHaveLength(1)
        expect(inputs[0].message, `"${c.block}" echoes its password as the mask`).toContain(MASK)
      }
      const text = entries.map((entry) => `${entry.source} ${entry.message}`).join('\n')
      const needles: Record<string, string> = {
        password: OPENSEARCH_PASSWORD,
        'Basic credential': Buffer.from(`${OPENSEARCH_USER}:${OPENSEARCH_PASSWORD}`).toString('base64'),
      }
      for (const [what, needle] of Object.entries(needles)) {
        expect(text.includes(needle), `the run log leaked the ${what}`).toBe(false)
      }
    })

    await test.step('the session closes and the run ends on its bookend', () => {
      expect(sessionValue(variables, 'closed_ids'), 'the session close lists the one session').toEqual([
        sessionValue(variables, 'sid'),
      ])
      expect(String(sessionValue(variables, 'rsid')), 'the container binds a worker handle').toMatch(/^[0-9a-f]{32}$/)
      expectLog(`os-remote-closes sessions=1 ${BOOKEND}`)
    })
  })
})
