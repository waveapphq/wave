/**
 * V-NET-CERT-FUNCTIONAL (consumers): a blank CA trusts WAVE's trust set in every non-HTTP block
 * Wireframe: N/A
 * Design Decisions: NET-5, NET-7, SQL-8, OS-11, HELM-5
 * REQ: REQ-4.5.16
 *
 * One workflow dials every non-HTTP TLS consumer with Verify Server Certificate on and its CA
 * Certificate blank: PostgreSQL (9473), SQL Server (9476), OpenSearch (9477), K8s Connect to kwok
 * (9460) and a Helm Install from the HTTPS chart repository (9464, Repository CA Certificate
 * blank). The SQL, OpenSearch and Helm blocks record their failure and a Try/Catch catches the K8s
 * Connect, so one run shows every consumer. The same test is run three times: on WAVE's built-in
 * list alone, after the WAVE Test CA is added through the Certificates API, and after kwok's own CA
 * is added too. A PostgreSQL block with TLS off rides along in every run.
 *
 * Pass Criteria:
 * 1. The fixture imports through POST /tests with no repairs and validates with zero errors; the
 *    Settings start on WAVE's built-in list with no Additional Certificates.
 * 2. Built-in list only: each of the five blocks fails certificate verification in its own words
 *    (SQL and OpenSearch `CERTIFICATE_VERIFY_FAILED`, K8s `no trusted issuer found`, Helm
 *    `certificate signed by unknown authority`), Reason Unreachable where the block records, and
 *    each logs `Trusting WAVE's built-in certificate list ({label})` once at DEBUG, with no suffix.
 * 3. The WAVE Test CA added (one additional certificate): PostgreSQL and SQL Server connect
 *    encrypted, OpenSearch finds its 6 documents, Helm deploys the chart and the cleanup removes it;
 *    kwok's certificate is signed by another CA, so K8s Connect still fails the same way. Every
 *    consumer logs `... and 1 additional certificate`.
 * 4. kwok's CA added too (two additional certificates): all five consumers pass, K8s Connect reads
 *    the cluster version, and every consumer logs `... and 2 additional certificates`.
 * 5. Only the five consumers log a trust line: the TLS-off block and the Helm blocks riding a
 *    session with its own CA never consult WAVE's trust set.
 * 6. PostgreSQL with TLS off is a plain connection in every run: `SELECT ssl FROM pg_stat_ssl
 *    WHERE pid = pg_backend_pid()` reads false (the stack's pg_hba accepts non-TLS clients).
 * 7. Every bound value reaches the summary Log line and every run passes.
 */

import fs from 'fs'
import path from 'path'
import { randomBytes } from 'node:crypto'
import { test, expect, type APIRequestContext, type Page } from '../../helpers/playwright-fixtures'
import {
  BACKEND_URL,
  CA_CERT_PEM,
  CHART_REPO_PASSWORD,
  CHART_REPO_TLS_PORT,
  CHART_REPO_USER,
  HTTP_FIXTURE_HOST_SENTINEL,
  HTTP_TARGET_HOST,
  K8S_ADMIN_TOKEN,
  K8S_API_PORT,
  K8S_CA_PEM,
  MSSQL_PORT,
  OPENSEARCH_PASSWORD,
  OPENSEARCH_PORT,
  POSTGRES_PORT,
  SQL_STACK_PASSWORD,
  SQL_TARGET_HOST,
} from '../../helpers/config'
import {
  getActiveSessionId,
  getSessionVariables,
  importValidateAndNavigate,
  injectServiceHost,
  sessionTable,
  sessionValue,
  type SessionVariables,
} from '../../helpers/fixture-import'
import { validateTest } from '../../helpers/fn-seed'
import { expectNodeStatus, finishRun, startRun } from '../../helpers/k8s-run'
import { seedRun, type SeededRun } from '../../helpers/k8s-seed'
import {
  clearConsoleLogs,
  escapeRegExp,
  formatEntries,
  getLogCopyTexts,
  setConsoleMinimumLevel,
  type LogEntry,
} from '../../helpers/log-reader'
import { resetNetworkSettings } from '../../helpers/network-settings'
import {
  createOpenSearchIndex,
  deleteOpenSearchIndexes,
  F_LOGS,
  MAP_LOGS,
  openSearchIndexName,
  seedOpenSearch,
} from '../../helpers/opensearch-stack'
import {
  CHART,
  CHART_REPO_TLS_URL,
  expectEmptyRelease,
  expectRecorded,
  expectReleaseRow,
  installedLine,
  statusOf,
  uninstallQuietly,
  uninstalledLine,
} from '../helm/cases-helm'
import { blockSource, consoleEntriesFromCopy, withToken } from '../shell-blocks/shell-helpers'

// --- fixture -------------------------------------------------------------
interface FixtureNode {
  id: string
  data: {
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

const FIXTURE_FILE = 'fixture.json'
const BOOKEND = 'trust-consumers-done'
const NAMESPACE_PLACEHOLDER = '__NAMESPACE__'
const CHART_REPO_SENTINEL_URL = `https://${HTTP_FIXTURE_HOST_SENTINEL}:${CHART_REPO_TLS_PORT}`
const CHART_VERSION = '0.1.0'
const KWOK_LEAF_SUBJECT = 'O=system:masters, CN=kwok-admin'

/** The CA names the Certificates API reports for the two signers. */
const WAVE_TEST_CA_NAME = 'WAVE Test CA'
const KWOK_CA_NAME = 'wave-kwok-ca'

type Consumer = 'pg' | 'ms' | 'os' | 'k8s' | 'helm'

/** The five blocks that dial TLS with a blank CA, their Source (EXEC-25) and the CA that signs each service. */
const CONSUMERS: Record<Consumer, { node: string; source: string; signer: string }> = {
  pg: { node: 'pg-tls', source: blockSource('SQL', 'PG trust'), signer: WAVE_TEST_CA_NAME },
  ms: { node: 'ms-tls', source: blockSource('SQL', 'SQL Server trust'), signer: WAVE_TEST_CA_NAME },
  os: { node: 'os-tls', source: blockSource('OpenSearch', 'OpenSearch trust'), signer: WAVE_TEST_CA_NAME },
  k8s: { node: 'k8s-tls', source: blockSource('K8s Connect', 'K8s trust'), signer: KWOK_CA_NAME },
  helm: { node: 'helm-install', source: blockSource('Helm Install', 'Helm trust'), signer: WAVE_TEST_CA_NAME },
}
const CONSUMER_KEYS = Object.keys(CONSUMERS) as Consumer[]

const PLAIN_SOURCE = blockSource('SQL', 'PG plain')
const CLEANUP_SOURCE = blockSource('Helm Uninstall', 'Helm cleanup')

function loadFixture(): Fixture {
  return JSON.parse(fs.readFileSync(path.resolve(__dirname, FIXTURE_FILE), 'utf-8')) as Fixture
}

function nodeOf(fixture: Fixture, id: string): FixtureNode {
  const found = fixture.workflow.nodes.find((node) => node.id === id)
  expect(found, `the fixture must declare the block "${id}"`).toBeTruthy()
  return found as FixtureNode
}

/** Check every consumer dials with a blank CA and verification on, then fill secrets and run names. */
function prepareFixture(fixture: Fixture, namespace: string): Fixture {
  for (const key of CONSUMER_KEYS) {
    const values = nodeOf(fixture, CONSUMERS[key].node).data.config.values
    const what = `"${CONSUMERS[key].node}"`
    if (key === 'helm') {
      expect(values.repo_ca_cert, `${what} leaves the Repository CA Certificate blank`).toBe('')
      expect(values.repo_verify_ssl, `${what} verifies the repository`).toBe(true)
      continue
    }
    expect(values.ca_cert, `${what} leaves the CA Certificate blank`).toBe('')
    expect(values.verify_ssl, `${what} verifies the server certificate`).toBe(true)
  }
  for (const id of ['pg-tls', 'pg-plain', 'ms-tls']) {
    const values = nodeOf(fixture, id).data.config.values
    expect(values.password, `"${id}" stores no password`).toBe('')
    values.password = SQL_STACK_PASSWORD
  }
  expect(nodeOf(fixture, 'pg-plain').data.config.values.tls, 'the plain block turns TLS off').toBe(false)
  const search = nodeOf(fixture, 'os-tls').data.config.values
  expect(search.password, 'the OpenSearch block stores no password').toBe('')
  search.password = OPENSEARCH_PASSWORD
  const install = nodeOf(fixture, 'helm-install').data.config.values
  expect(install.repo, 'the chart URL carries the sentinel the spec rewrites').toBe(CHART_REPO_SENTINEL_URL)
  expect(install.repo_password, 'the Helm block stores no repository password').toBe('')
  install.repo = CHART_REPO_TLS_URL
  install.repo_username = CHART_REPO_USER
  install.repo_password = CHART_REPO_PASSWORD
  expect(fixture.variables.k8s_admin_token.value, 'no token is stored').toBe('')
  expect(fixture.variables.k8s_ca.value, 'no CA is stored').toBe('')
  fixture.variables.k8s_admin_token.value = K8S_ADMIN_TOKEN
  fixture.variables.k8s_ca.value = K8S_CA_PEM
  const named = JSON.parse(
    JSON.stringify(fixture).split(NAMESPACE_PLACEHOLDER).join(namespace),
  ) as Fixture
  return injectServiceHost(named, SQL_TARGET_HOST) as unknown as Fixture
}

// --- the Certificates API ------------------------------------------------
interface CertificatesView {
  settings: { public_source: string; builtin: { label: string; count: number } }
  additional: Array<{ id: string; name: string; type: string; expires: string }>
}

async function readCertificates(request: APIRequestContext): Promise<CertificatesView> {
  const resp = await request.get(`${BACKEND_URL}/network/certificates`)
  const text = await resp.text()
  expect(resp.status(), `GET /network/certificates answered ${resp.status()}: ${text}`).toBe(200)
  return JSON.parse(text) as CertificatesView
}

async function addCertificate(request: APIRequestContext, pem: string): Promise<CertificatesView> {
  const resp = await request.patch(`${BACKEND_URL}/network/certificates`, { data: { add: [pem] } })
  const text = await resp.text()
  expect(resp.status(), `PATCH /network/certificates answered ${resp.status()}: ${text}`).toBe(200)
  return JSON.parse(text) as CertificatesView
}

// --- reading a run back --------------------------------------------------
interface RunOutcome {
  entries: LogEntry[]
  vars: SessionVariables
  all: string
}

async function runOnce(page: Page): Promise<RunOutcome> {
  const status = await startRun(page)
  await finishRun(page, status, BOOKEND, 240_000)
  const entries = consoleEntriesFromCopy(await getLogCopyTexts(page))
  const vars = await getSessionVariables(page, await getActiveSessionId(page))
  return { entries, vars, all: formatEntries(entries) }
}

/** How every trust line starts. */
const TRUST_PREFIX = 'Trusting '

/** The run log line a blank CA writes on WAVE's built-in list with `count` Additional Certificates. */
function trustLine(label: string, count: number): string {
  const line = `Trusting WAVE's built-in certificate list (${label})`
  if (count === 0) return line
  return count === 1 ? `${line} and 1 additional certificate` : `${line} and ${count} additional certificates`
}

/** Measured figures and the server's version are blanked; everything else is compared exactly. */
function normalize(message: string): string {
  return message
    .replace(/, \d+ ms$/, ', {ms} ms')
    .replace(/^Connected to (PostgreSQL|SQL Server) \S+ at /, 'Connected to $1 {version} at ')
}

/** A block's INFO, WARN and ERROR lines plus its DEBUG trust line, as "LEVEL message". */
function linesOf(outcome: RunOutcome, source: string): string[] {
  return outcome.entries
    .filter((entry) => entry.source === source && (entry.level !== 'DEBUG' || entry.message.startsWith(TRUST_PREFIX)))
    .map((entry) => `${entry.level} ${normalize(entry.message)}`)
}

function expectLines(outcome: RunOutcome, source: string, expected: string[]): void {
  expect(
    [...linesOf(outcome, source)].sort(),
    `the console lines of "${source}".\n${outcome.all}`,
  ).toEqual([...expected].sort())
}

/** Exactly one trust line per consumer, nothing from any other block. */
function expectTrustLines(outcome: RunOutcome, expected: string): void {
  const trusting = outcome.entries
    .filter((entry) => entry.message.startsWith(TRUST_PREFIX))
    .map((entry) => `${entry.source} | ${entry.level} ${entry.message}`)
    .sort()
  expect(trusting, `one trust line per consumer.\n${outcome.all}`).toEqual(
    CONSUMER_KEYS.map((key) => `${CONSUMERS[key].source} | DEBUG ${expected}`).sort(),
  )
}

function text(vars: SessionVariables, name: string): string {
  const value = sessionValue(vars, name)
  expect(typeof value, `"${name}" holds text`).toBe('string')
  return value as string
}

/** A bound value as a Python f-string prints it. */
function python(vars: SessionVariables, name: string): string {
  const value = sessionValue(vars, name)
  if (value === true) return 'True'
  if (value === false) return 'False'
  if (value === null) return 'None'
  return String(value)
}

const SQL_HOST = escapeRegExp(SQL_TARGET_HOST)
const HTTP_HOST = escapeRegExp(HTTP_TARGET_HOST)

/** What each consumer says when the trust set lacks its signer. */
const K8S_URL = `https://${HTTP_HOST}:${K8S_API_PORT}`
const REFUSALS: Record<Consumer, RegExp> = {
  // PostgreSQL sends the WAVE Test CA after its leaf, so OpenSSL reports the chain's self-signed root.
  pg: new RegExp(
    `^Could not connect to PostgreSQL at ${SQL_HOST}:${POSTGRES_PORT}: \\[SSL: CERTIFICATE_VERIFY_FAILED\\] ` +
      'certificate verify failed: self-signed certificate in certificate chain \\(_ssl\\.c:\\d+\\)$',
  ),
  ms: new RegExp(
    `^Could not connect to SQL Server at ${SQL_HOST}:${MSSQL_PORT}: ` +
      "\\[\\('SSL routines', '', 'certificate verify failed'\\)\\]$",
  ),
  os: new RegExp(
    `^Could not connect to OpenSearch at ${HTTP_HOST}:${OPENSEARCH_PORT}: \\[SSL: CERTIFICATE_VERIFY_FAILED\\] ` +
      'certificate verify failed: unable to get local issuer certificate \\(_ssl\\.c:\\d+\\)$',
  ),
  k8s: new RegExp(
    `^Could not read the Kubernetes version from ${K8S_URL}: Could not verify the TLS certificate of ${K8S_URL}: ` +
      `Certificate verification failed: no trusted issuer found for certificate "${escapeRegExp(KWOK_LEAF_SUBJECT)}"$`,
  ),
  helm: new RegExp(
    `^INSTALLATION FAILED: .*Get "${escapeRegExp(CHART_REPO_TLS_URL)}/index\\.yaml": ` +
      'tls: failed to verify certificate: x509: certificate signed by unknown authority$',
  ),
}

// --- per-consumer checks -------------------------------------------------
async function expectRefused(page: Page, outcome: RunOutcome, key: Consumer, trust: string): Promise<void> {
  const { vars } = outcome
  const consumer = CONSUMERS[key]
  if (key === 'k8s') {
    const caught = sessionValue(vars, 'k8s_err') as Record<string, unknown>
    const message = String(caught?.message ?? '')
    expect(message, `K8s Connect refused kwok's certificate.\n${outcome.all}`).toMatch(REFUSALS.k8s)
    expect(sessionValue(vars, 'k8s_version'), 'no cluster version was read').toBe('')
    expect(
      outcome.entries.some((entry) => entry.level === 'WARN' && entry.message === 'trust-k8s caught'),
      `the Try/Catch caught the refusal.\n${outcome.all}`,
    ).toBe(true)
    expect(
      outcome.entries.some((entry) => entry.message === `trust-k8s version= caught=${message}`),
      `the caught message reaches the Log line.\n${outcome.all}`,
    ).toBe(true)
    expectLines(outcome, consumer.source, [`DEBUG ${trust}`])
    expect(
      outcome.entries.some(
        (entry) => entry.level === 'ERROR' && entry.message === `Block 'K8s trust' failed: ${message}`,
      ),
      `the engine names the failed block.\n${outcome.all}`,
    ).toBe(true)
    await expectNodeStatus(page, consumer.node, 'failed')
    return
  }
  if (key === 'helm') {
    expectRecorded(vars, 'helm', { reason: 'Unreachable' })
    expect(text(vars, 'helm_err'), `Helm refused the repository certificate.\n${outcome.all}`).toMatch(REFUSALS.helm)
    expectEmptyRelease(vars, 'helm')
    expect(statusOf(vars, 'helm'), 'a refused install reports no status').toBe('')
    expectLines(outcome, consumer.source, [
      `DEBUG ${trust}`,
      `WARN Helm Install failed (Unreachable): ${text(vars, 'helm_err')}`,
    ])
    await expectNodeStatus(page, consumer.node, 'warning')
    return
  }
  const error = text(vars, `${key}_err`)
  expect(error, `${key} refused the certificate.\n${outcome.all}`).toMatch(REFUSALS[key])
  expect(sessionValue(vars, `${key}_ok`), `${key}: Success under Record`).toBe(false)
  expect(text(vars, `${key}_reason`)).toBe('Unreachable')
  if (key === 'os') {
    expect(sessionValue(vars, 'os_total'), 'no search was answered').toBe(0)
    expectLines(outcome, consumer.source, [`DEBUG ${trust}`, `WARN Search failed (Unreachable): ${error}`])
  } else {
    expectLines(outcome, consumer.source, [`DEBUG ${trust}`, `WARN Run SQL failed (Unreachable): ${error}`])
  }
  await expectNodeStatus(page, consumer.node, 'warning')
}

async function expectTrusted(
  page: Page,
  outcome: RunOutcome,
  key: Consumer,
  trust: string,
  release: string,
  namespace: string,
): Promise<void> {
  const { vars } = outcome
  const consumer = CONSUMERS[key]
  await expectNodeStatus(page, consumer.node, 'success')
  if (key === 'pg') {
    expect(sessionValue(vars, 'pg_ok'), `PostgreSQL connects.\n${outcome.all}`).toBe(true)
    const rows = sessionTable(vars, 'pg_rows')
    expect(rows.columns).toEqual([
      { name: 'ssl', type: 'boolean' },
      { name: 'version', type: 'string' },
    ])
    expect(rows.rows.length, 'one session row').toBe(1)
    expect(rows.rows[0][0], 'the session is encrypted').toBe(true)
    expect(String(rows.rows[0][1])).toMatch(/^TLSv1\.[23]$/)
    expectLines(outcome, consumer.source, [
      `DEBUG ${trust}`,
      `INFO Connected to PostgreSQL {version} at ${SQL_TARGET_HOST}:${POSTGRES_PORT}`,
      'INFO Statement 1: 1 rows, {ms} ms',
    ])
  } else if (key === 'ms') {
    expect(sessionValue(vars, 'ms_ok'), `SQL Server connects.\n${outcome.all}`).toBe(true)
    expect(sessionTable(vars, 'ms_rows'), 'SQL Server reports the session encrypted').toEqual({
      columns: [{ name: 'encrypt_option', type: 'string' }],
      rows: [['TRUE']],
    })
    expectLines(outcome, consumer.source, [
      `DEBUG ${trust}`,
      `INFO Connected to SQL Server {version} at ${SQL_TARGET_HOST}:${MSSQL_PORT}`,
      'INFO Statement 1: 1 rows, {ms} ms',
    ])
  } else if (key === 'os') {
    expect(sessionValue(vars, 'os_ok'), `OpenSearch answers.\n${outcome.all}`).toBe(true)
    expect(sessionValue(vars, 'os_total'), 'the six ERROR documents').toBe(6)
    const lines = linesOf(outcome, consumer.source)
    expect(lines.filter((line) => line === `DEBUG ${trust}`), `one trust line.\n${outcome.all}`).toHaveLength(1)
    expect(lines.filter((line) => line.startsWith('WARN ') || line.startsWith('ERROR ')), outcome.all).toEqual([])
  } else if (key === 'k8s') {
    expect(String(sessionValue(vars, 'k8s_version')), `K8s Connect reads the version.\n${outcome.all}`).toMatch(
      /^v1\.33/,
    )
    expect(sessionValue(vars, 'k8s_err'), 'the Try/Catch binds no error when nothing was caught').toBeNull()
    expect(
      outcome.entries.some((entry) => entry.message === 'trust-k8s caught'),
      `the catch branch never ran.\n${outcome.all}`,
    ).toBe(false)
    expect(
      outcome.entries.some(
        (entry) => entry.message === `trust-k8s version=${String(sessionValue(vars, 'k8s_version'))} caught=none`,
      ),
      `the version reaches the Log line.\n${outcome.all}`,
    ).toBe(true)
    const lines = linesOf(outcome, consumer.source)
    expect(lines.filter((line) => line === `DEBUG ${trust}`), `one trust line.\n${outcome.all}`).toHaveLength(1)
    expect(lines.filter((line) => line.startsWith('WARN ') || line.startsWith('ERROR ')), outcome.all).toEqual([])
  } else {
    expectReleaseRow(vars, 'helm', {
      name: release,
      namespace,
      revision: 1,
      status: 'deployed',
      chart: `${CHART.demo}-${CHART_VERSION}`,
      appVersion: '1.0.0',
    })
    expect(statusOf(vars, 'helm')).toBe('deployed')
    expect(sessionValue(vars, 'helm_ok')).toBe(true)
    const lines = linesOf(outcome, consumer.source)
    expect(lines.filter((line) => line === `DEBUG ${trust}`), `one trust line.\n${outcome.all}`).toHaveLength(1)
    expect(lines, outcome.all).toContain(`INFO ${installedLine(release, 1)}`)
  }
}

/** The TLS-off block: a plain session, no trust line. */
async function expectPlain(page: Page, outcome: RunOutcome): Promise<void> {
  expect(sessionTable(outcome.vars, 'plain_rows'), 'TLS off negotiates no TLS').toEqual({
    columns: [{ name: 'ssl', type: 'boolean' }],
    rows: [[false]],
  })
  expectLines(outcome, PLAIN_SOURCE, [
    `INFO Connected to PostgreSQL {version} at ${SQL_TARGET_HOST}:${POSTGRES_PORT}`,
    'INFO Statement 1: 1 rows, {ms} ms',
  ])
  await expectNodeStatus(page, 'pg-plain', 'success')
}

/** The cleanup removes the release, the summary carries every bound value, and the run passed. */
async function expectRunTail(page: Page, outcome: RunOutcome, release: string): Promise<void> {
  const { vars } = outcome
  expect(linesOf(outcome, CLEANUP_SOURCE), outcome.all).toContain(`INFO ${uninstalledLine(release)}`)
  const summary =
    `trust-summary pg=${python(vars, 'pg_ok')}/${python(vars, 'pg_reason')} plain=False ` +
    `ms=${python(vars, 'ms_ok')}/${python(vars, 'ms_reason')} ` +
    `os=${python(vars, 'os_ok')}/${python(vars, 'os_reason')}/${python(vars, 'os_total')} ` +
    `helm=${python(vars, 'helm_ok')}/${python(vars, 'helm_reason')}/${python(vars, 'helm_status')}`
  expect(
    outcome.entries.some((entry) => entry.level === 'INFO' && entry.message === summary),
    `the summary line carries every bound value: ${summary}\n${outcome.all}`,
  ).toBe(true)
  for (const id of ['tc-k8s', 'log-k8s', 'helm-connect', 'helm-uninstall', 'log-summary', 'log-done']) {
    await expectNodeStatus(page, id, 'success')
  }
}

// --- suite ---------------------------------------------------------------
test.describe('V-NET-CERT-FUNCTIONAL: a blank CA trusts WAVE\'s trust set in the SQL, OpenSearch, K8s and Helm blocks', () => {
  let seeded: SeededRun | undefined
  let token = ''
  let release = ''
  const createdTests: string[] = []

  test.beforeEach(async () => {
    await resetNetworkSettings(BACKEND_URL)
  })

  test.afterEach(async ({ request }) => {
    await request.delete(`${BACKEND_URL}/workbench/session/`).catch(() => undefined)
    for (const testId of createdTests.splice(0)) {
      await request.delete(`${BACKEND_URL}/tests/${testId}`).catch(() => undefined)
    }
    if (token) await deleteOpenSearchIndexes(token).catch(() => undefined)
    if (seeded) {
      await uninstallQuietly(request, { namespace: seeded.namespace, release })
      await seeded.teardown()
      seeded = undefined
    }
    await resetNetworkSettings(BACKEND_URL)
  })

  test('built-in list alone refuses every lab service; adding the signing CAs lets each one through; TLS off stays plain', async ({
    page,
    request,
  }) => {
    test.setTimeout(480_000)
    token = `ct${randomBytes(4).toString('hex')}`
    release = `wave-trust-${token}`
    seeded = await seedRun(request, 'minimal')
    const namespace = seeded.namespace
    const index = openSearchIndexName(token, 'trust')
    await createOpenSearchIndex(index, MAP_LOGS)
    await seedOpenSearch(index, F_LOGS)

    const fixture = prepareFixture(withToken(loadFixture(), token), namespace)
    const testId = await importValidateAndNavigate(page, fixture, { injectHttp: true, rejectRepairs: true })
    createdTests.push(testId)
    const validation = await validateTest(page.request, testId, 'run')
    expect(validation.status, `validate answered ${validation.status}`).toBe(200)
    expect(validation.errors, `the fixture must validate clean: ${JSON.stringify(validation.errors)}`).toEqual([])

    const start = await readCertificates(request)
    expect(start.settings.public_source, 'the reset leaves WAVE on its built-in list').toBe('builtin')
    expect(start.additional, 'the reset leaves no Additional Certificates').toEqual([])
    const label = start.settings.builtin.label
    expect(label, 'the built-in list is labeled with its release month').toMatch(/^[A-Z][a-z]+ \d{4}$/)
    // The trust line is DEBUG (REQ-4.5.16).
    await setConsoleMinimumLevel(page, 'DEBUG')

    await test.step('built-in list alone: every consumer fails certificate verification', async () => {
      const outcome = await runOnce(page)
      const trust = trustLine(label, 0)
      expectTrustLines(outcome, trust)
      for (const key of CONSUMER_KEYS) await expectRefused(page, outcome, key, trust)
      await expectPlain(page, outcome)
      await expectRunTail(page, outcome, release)
    })

    await test.step('the WAVE Test CA added: its four services pass, kwok still fails', async () => {
      const view = await addCertificate(request, CA_CERT_PEM)
      expect(view.additional.map((row) => row.name)).toEqual([WAVE_TEST_CA_NAME])
      await clearConsoleLogs(page)
      const outcome = await runOnce(page)
      const trust = trustLine(label, 1)
      expectTrustLines(outcome, trust)
      for (const key of CONSUMER_KEYS) {
        if (CONSUMERS[key].signer === WAVE_TEST_CA_NAME) {
          await expectTrusted(page, outcome, key, trust, release, namespace)
        } else {
          await expectRefused(page, outcome, key, trust)
        }
      }
      await expectPlain(page, outcome)
      await expectRunTail(page, outcome, release)
    })

    await test.step("kwok's CA added too: every consumer passes", async () => {
      const view = await addCertificate(request, K8S_CA_PEM)
      expect(view.additional.map((row) => row.name)).toEqual([WAVE_TEST_CA_NAME, KWOK_CA_NAME])
      await clearConsoleLogs(page)
      const outcome = await runOnce(page)
      const trust = trustLine(label, 2)
      expectTrustLines(outcome, trust)
      for (const key of CONSUMER_KEYS) await expectTrusted(page, outcome, key, trust, release, namespace)
      await expectPlain(page, outcome)
      await expectRunTail(page, outcome, release)
    })
  })
})
