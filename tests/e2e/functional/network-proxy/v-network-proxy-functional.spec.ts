/**
 * V-NET-PROXY-FUNCTIONAL: the Proxy setting routes the web requests WAVE makes
 * Wireframe: N/A
 * Design Decisions: NET-10, HTTP-13, SHELL-10
 * REQ: REQ-4.7.14, REQ-4.7.16
 *
 * Every proxy is saved through Settings > Network > Proxy > Setup and proven by a run against a
 * target that only the proxy can resolve: `http-target`, `kwok-internal`, `opensearch` and
 * `tls-lab` are compose DNS names, so an answer from one of them came through the proxy and a
 * name resolution failure is a direct connection. The proxies are the tinyproxy pair of the
 * stack: open on 9458, with a login on 9459.
 *
 * Pass Criteria:
 * 1. Custom with the open proxy and an empty list: an HTTP block on WAVE setting gets 200 and the
 *    target's own body from `http-target` over plain HTTP and over HTTPS and from the chart
 *    repository, and each block writes `Using the proxy <host>:9458` once at DEBUG; the same
 *    block on Off fails with a name resolution failure and writes no proxy line.
 * 2. "All addresses except the list" with an Exact entry for the plain `http-target` address and
 *    a Regex entry, typed in capitals, for its HTTPS address: both blocks fail directly, and the
 *    chart repository, which is not in the list, still goes through the proxy.
 * 3. "Only the addresses in the list" with the Exact entry alone: the plain `http-target` address
 *    is reached; the chart repository and the HTTPS port of the same host are not.
 * 4. The login proxy with Username and Password: 200 over plain HTTP and over HTTPS, one
 *    `Using the proxy <host>:9459` line per block, the password field masked after Save and
 *    after a reload, and neither the password nor its Basic value in any rendered console line
 *    or in the copied log text.
 * 5. A wrong password: both blocks fail with `Proxy <host>:9459 refused the connection to
 *    http-target:<port>: 407 Proxy Authentication Required`, the Try/Catch catches each one, the
 *    catch branch logs its line, the block shows `data-execution-status="failed"` and the run
 *    passes.
 * 6. "Delete & Edit" then Save removes the password (`password_set` false, `password: null` in
 *    the config file) and the login proxy answers 407 again.
 * 7. K8s Connect and K8s Get against `kwok-internal` and an OpenSearch search against
 *    `opensearch` each succeed while their address is the one in the list and fail with a name
 *    resolution failure while it is not.
 * 8. Helm Install from `http://tls-lab:9463` against `kwok-internal` deploys the chart with both
 *    addresses in the list, and fails to reach the chart repository with the cluster alone.
 * 9. With the Custom proxy on, a Shell Exec `env` prints no proxy variable and no proxy password,
 *    while an HTTP block of the same run goes through the proxy.
 * 10. After Save the stack's config file holds `network.proxy` with the saved values, both
 *     entries and a sealed password, and the plain password nowhere.
 * 11. Every fixture imports with no repairs and validates with zero errors; every run passes.
 */

import fs from 'fs'
import path from 'path'
import { randomBytes } from 'node:crypto'
import {
  test,
  expect,
  type APIRequestContext,
  type Locator,
  type Page,
} from '../../helpers/playwright-fixtures'
import {
  BACKEND_URL,
  CA_CERT_PEM,
  CHART_REPO_INTERNAL_SERVICE,
  HTTP_TARGET_HOST,
  HTTP_TARGET_SERVICE,
  K8S_ADMIN_TOKEN,
  K8S_CA_PEM,
  K8S_INTERNAL_PORT,
  K8S_INTERNAL_SERVICE,
  OPENSEARCH_INTERNAL_PORT,
  OPENSEARCH_PASSWORD,
  OPENSEARCH_SERVICE,
  PROXY_AUTH_PORT,
  PROXY_AUTH_SECRET,
  PROXY_AUTH_USER,
  PROXY_PORT,
} from '../../helpers/config'
import { configSection, readConfigText, stackPaths } from '../../helpers/config-file'
import {
  getActiveSessionId,
  getSessionVariables,
  importValidateAndNavigate,
  sessionValue,
  type SessionVariables,
} from '../../helpers/fixture-import'
import { validateTest } from '../../helpers/fn-seed'
import { expectNodeStatus, finishRun, startRun } from '../../helpers/k8s-run'
import {
  escapeRegExp,
  formatEntries,
  getLogCopyTexts,
  getLogTexts,
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
  CHART_REPO_INTERNAL_URL,
  expectEmptyRelease,
  expectRecorded,
  expectReleaseRow,
  installedLine,
  recordedLine,
  releaseName,
  statusOf,
  uninstalledLine,
} from '../helm/cases-helm'
import { blockSource, consoleEntriesFromCopy, withToken } from '../shell-blocks/shell-helpers'

// --- addresses -----------------------------------------------------------
const SETUP_PATH = '/settings/network/proxy/setup'

/** The ports `http-target` listens on inside the stack network. */
const TARGET_HTTP_PORT = '9444'
const TARGET_HTTPS_PORT = '9443'

const PLAIN_ORIGIN = `http://${HTTP_TARGET_SERVICE}:${TARGET_HTTP_PORT}`
const TLS_ORIGIN = `https://${HTTP_TARGET_SERVICE}:${TARGET_HTTPS_PORT}`
const PLAIN_URL = `${PLAIN_ORIGIN}/api`
const TLS_URL = `${TLS_ORIGIN}/echo`
const CHART_INDEX_URL = `${CHART_REPO_INTERNAL_URL}/index.yaml`
const CLUSTER_URL = `https://${K8S_INTERNAL_SERVICE}:${K8S_INTERNAL_PORT}`
const SEARCH_ADDRESS = `${OPENSEARCH_SERVICE}:${OPENSEARCH_INTERNAL_PORT}`
const SEARCH_URL = `https://${SEARCH_ADDRESS}`

const OPEN_PROXY = `${HTTP_TARGET_HOST}:${PROXY_PORT}`
const LOGIN_PROXY = `${HTTP_TARGET_HOST}:${PROXY_AUTH_PORT}`
const WRONG_PASSWORD = 'wrong-proxy-login'
const CHART_VERSION = '0.1.0'

/** What `http-target` answers on its plain port. */
const TARGET_HEALTH = { status: 'healthy', port: Number(TARGET_HTTPS_PORT) }

// Two resolver answers for a name nobody knows; which one comes depends on the host.
const NAME_FAILURE = String.raw`\[Errno -(?:2\] Name or service not known|3\] Temporary failure in name resolution)`
const DIRECT_HTTP = new RegExp(`^${NAME_FAILURE}$`)
const DIRECT_K8S = new RegExp(
  `^Could not read the Kubernetes version from ${escapeRegExp(CLUSTER_URL)}: ` +
    `Could not connect to the Kubernetes API at ${escapeRegExp(CLUSTER_URL)}: ${NAME_FAILURE}$`,
)
const DIRECT_SEARCH = new RegExp(
  `^Could not connect to OpenSearch at ${escapeRegExp(SEARCH_ADDRESS)}: ${NAME_FAILURE}$`,
)
const DIRECT_CHART = new RegExp(
  `^INSTALLATION FAILED: .*Get "${escapeRegExp(CHART_INDEX_URL)}": ` +
    `dial tcp: lookup ${escapeRegExp(CHART_REPO_INTERNAL_SERVICE)}\\b.+$`,
)

function refusedLogin(port: string): string {
  return `Proxy ${LOGIN_PROXY} refused the connection to ${HTTP_TARGET_SERVICE}:${port}: 407 Proxy Authentication Required`
}

// --- fixtures ------------------------------------------------------------
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

function loadFixture(file: string): Fixture {
  return JSON.parse(fs.readFileSync(path.resolve(__dirname, file), 'utf-8')) as Fixture
}

function valuesOf(fixture: Fixture, id: string): Record<string, unknown> {
  const found = fixture.workflow.nodes.find((node) => node.id === id)
  expect(found, `the fixture must declare the block "${id}"`).toBeTruthy()
  return (found as FixtureNode).data.config.values
}

/** The block dials the address the stack names, with no retry to slow a failing leg down. */
function expectHttpBlock(fixture: Fixture, id: string, url: string, proxyMode: string): void {
  expect(valuesOf(fixture, id), `the values of "${id}"`).toMatchObject({
    url,
    proxy_mode: proxyMode,
    retry_count: 0,
  })
}

function routesFixture(): Fixture {
  const fixture = loadFixture('fixture-http-routes.json')
  expectHttpBlock(fixture, 'http-setting', PLAIN_URL, 'wave-setting')
  expectHttpBlock(fixture, 'http-off', PLAIN_URL, 'off')
  expectHttpBlock(fixture, 'http-other', CHART_INDEX_URL, 'wave-setting')
  expectHttpBlock(fixture, 'http-tls', TLS_URL, 'wave-setting')
  expect(fixture.variables.lab_ca.value, 'no CA is stored').toBe('')
  fixture.variables.lab_ca.value = CA_CERT_PEM
  return fixture
}

function loginFixture(): Fixture {
  const fixture = loadFixture('fixture-http-login.json')
  expectHttpBlock(fixture, 'http-plain', PLAIN_URL, 'wave-setting')
  expectHttpBlock(fixture, 'http-tls', TLS_URL, 'wave-setting')
  expect(fixture.variables.lab_ca.value, 'no CA is stored').toBe('')
  fixture.variables.lab_ca.value = CA_CERT_PEM
  return fixture
}

function fillClusterLogin(fixture: Fixture): void {
  expect(fixture.variables.k8s_admin_token.value, 'no token is stored').toBe('')
  expect(fixture.variables.k8s_ca.value, 'no CA is stored').toBe('')
  fixture.variables.k8s_admin_token.value = K8S_ADMIN_TOKEN
  fixture.variables.k8s_ca.value = K8S_CA_PEM
}

function clusterFixture(token: string): Fixture {
  const fixture = withToken(loadFixture('fixture-k8s-opensearch.json'), token)
  expect(valuesOf(fixture, 'k8s-connect').api_url, 'K8s Connect dials the internal cluster').toBe(CLUSTER_URL)
  const search = valuesOf(fixture, 'os-search')
  expect(search.url, 'the search dials the node by its compose name').toBe(SEARCH_URL)
  expect(search.index, 'the search reads the index of this run').toBe(openSearchIndexName(token, 'proxy'))
  expect(search.password, 'the OpenSearch block stores no password').toBe('')
  expect(search.ca_cert, 'the OpenSearch block stores no CA').toBe('')
  search.password = OPENSEARCH_PASSWORD
  search.ca_cert = CA_CERT_PEM
  fillClusterLogin(fixture)
  return fixture
}

interface HelmNames {
  namespace: string
  release: string
}

/** Names of one run: the workflow creates and removes both on the internal cluster. */
function helmNames(): HelmNames {
  const suffix = randomBytes(4).toString('hex')
  return { namespace: `wave-e2e-${suffix}`, release: releaseName('proxy', suffix) }
}

function helmFixture(names: HelmNames): Fixture {
  const fixture = loadFixture('fixture-helm.json')
  expect(valuesOf(fixture, 'helm-connect').api_url, 'K8s Connect dials the internal cluster').toBe(CLUSTER_URL)
  expect(valuesOf(fixture, 'helm-install'), 'the chart comes from the repository by its compose name').toMatchObject({
    repo: CHART_REPO_INTERNAL_URL,
    chart: CHART.demo,
    version: CHART_VERSION,
  })
  fillClusterLogin(fixture)
  const named = JSON.stringify(fixture)
    .split('__NAMESPACE__')
    .join(names.namespace)
    .split('__RELEASE__')
    .join(names.release)
  return JSON.parse(named) as Fixture
}

function environmentFixture(): Fixture {
  const fixture = loadFixture('fixture-shell-env.json')
  expectHttpBlock(fixture, 'http-check', PLAIN_URL, 'wave-setting')
  expect(valuesOf(fixture, 'shell-env').command, 'the script prints its environment').toBe('env')
  return fixture
}

// --- the Proxy setting, over the API -------------------------------------
interface ProxyEntry {
  kind: 'exact' | 'regex'
  address: string
}

interface ProxySaved {
  enabled: boolean
  source: string
  host: string
  port: number | null
  username: string
  password_set: boolean
  list_mode: string
  entries: ProxyEntry[]
  proxy_local_addresses: boolean
}

interface ProxyView extends ProxySaved {
  host_values: { https_proxy: string | null; http_proxy: string | null; no_proxy: string | null }
}

async function readProxy(request: APIRequestContext): Promise<ProxyView> {
  const response = await request.get(`${BACKEND_URL}/network/proxy`)
  const text = await response.text()
  expect(response.status(), `GET /network/proxy answered ${response.status()}: ${text}`).toBe(200)
  expect(text, 'the answer never carries a password').not.toMatch(/"password"\s*:/)
  return JSON.parse(text) as ProxyView
}

/** The saved setting, read back over the API, is exactly what the page was told. */
async function expectSaved(request: APIRequestContext, expected: ProxySaved): Promise<void> {
  const { host_values: _hostValues, ...saved } = await readProxy(request)
  expect(saved, 'GET /network/proxy after Save').toEqual(expected)
}

function customProxy(port: string, overrides: Partial<ProxySaved> = {}): ProxySaved {
  return {
    enabled: true,
    source: 'custom',
    host: HTTP_TARGET_HOST,
    port: Number(port),
    username: '',
    password_set: false,
    list_mode: 'except',
    entries: [],
    proxy_local_addresses: false,
    ...overrides,
  }
}

// --- the Proxy Setup page ------------------------------------------------
const LIST_MODE_LABEL = { except: 'All addresses except the list', only: 'Only the addresses in the list' }
const KIND_LABEL = { exact: 'Exact', regex: 'Regex' }

async function openSetup(page: Page): Promise<Locator> {
  await page.goto(SETUP_PATH)
  const tab = page.getByTestId('network-proxy-setup-tab')
  await expect(tab.getByRole('switch', { name: 'Use a proxy', exact: true })).toBeVisible()
  await expect(page.getByTestId('settings-nav-network-proxy-setup')).toHaveAttribute('aria-current', 'page')
  return tab
}

function segment(tab: Locator, group: string, label: string): Locator {
  return tab
    .getByRole('group', { name: group, exact: true })
    .getByRole('button', { name: label, exact: true })
}

function passwordInput(tab: Locator): Locator {
  return tab.locator('input[name="password"]')
}

function maskedPassword(tab: Locator): Locator {
  return tab.getByRole('button', { name: 'Password: Edit protected value', exact: true })
}

/** Turn the proxy on and type a Custom proxy into a page that shows the defaults. */
async function typeCustomProxy(tab: Locator, port: string): Promise<void> {
  await tab.getByRole('switch', { name: 'Use a proxy', exact: true }).click()
  await segment(tab, 'Source', 'Custom').click()
  await tab.locator('input[name="proxy-host"]').fill(HTTP_TARGET_HOST)
  await tab.locator('input[name="proxy-port"]').fill(port)
}

/** Choose the list mode and make the address list hold exactly these entries, in order. */
async function typeList(tab: Locator, mode: 'except' | 'only', entries: readonly ProxyEntry[]): Promise<void> {
  await segment(tab, 'Use the proxy for', LIST_MODE_LABEL[mode]).click()
  const rows = tab.locator('input[name^="proxy-entry-"]')
  for (let row = await rows.count(); row > 0; row -= 1) {
    await tab.getByRole('button', { name: `Remove entry ${row}`, exact: true }).click()
  }
  await expect(rows).toHaveCount(0)
  for (const [index, entry] of entries.entries()) {
    const row = index + 1
    await tab.getByRole('button', { name: 'Add entry', exact: true }).click()
    await segment(tab, `Entry ${row} type`, KIND_LABEL[entry.kind]).click()
    await tab.locator(`input[name="proxy-entry-${row}"]`).fill(entry.address)
  }
}

/** Press Save, wait for the write to answer 200 and for the page to be clean again. */
async function saveSetup(page: Page, tab: Locator): Promise<void> {
  const save = tab.getByRole('button', { name: 'Save', exact: true })
  await expect(save, 'Save is offered once the backend accepts the staged change').toBeEnabled()
  const written = page.waitForResponse(
    (response) => response.request().method() === 'PATCH' && response.url().endsWith('/network/proxy'),
  )
  await save.click()
  expect((await written).status(), 'PATCH /network/proxy').toBe(200)
  await expect(save, 'a saved page has nothing left to save').toBeDisabled()
}

/** Answer the masked field's question with "Delete & Edit": the field becomes an empty input. */
async function deleteStoredPassword(page: Page, tab: Locator): Promise<void> {
  await maskedPassword(tab).click()
  const question = page.getByRole('dialog', { name: 'Edit Protected Value?' })
  await question.getByRole('button', { name: 'Delete & Edit', exact: true }).click()
  await expect(question).toBeHidden()
  await expect(passwordInput(tab)).toHaveValue('')
}

async function expectPasswordMasked(tab: Locator): Promise<void> {
  await expect(maskedPassword(tab), 'a stored password shows masked').toBeVisible()
  await expect(passwordInput(tab), 'a stored password is never an input').toHaveCount(0)
}

// --- the stack's config file ---------------------------------------------
interface StoredProxy {
  settings: Record<string, string>
  entries: Array<{ kind: string; address: string }>
}

function unquoted(text: string): string {
  if (text.startsWith('"')) return JSON.parse(text) as string
  if (text.startsWith("'")) return text.slice(1, -1).replaceAll("''", "'")
  return text
}

/** The `network.proxy` keys as the config file holds them, comments left out. */
function storedProxy(configFile: string): StoredProxy {
  const lines = configSection(configFile, 'network').split('\n')
  const start = lines.indexOf('  proxy:')
  expect(start, 'the config file holds network.proxy').toBeGreaterThan(-1)
  const stored: StoredProxy = { settings: {}, entries: [] }
  for (const line of lines.slice(start + 1)) {
    if (/^\s*(#.*)?$/.test(line)) continue
    if (!line.startsWith('    ')) break
    const kind = /^ {6}- kind: (.+)$/.exec(line)
    const address = /^ {8}address: (.+)$/.exec(line)
    const setting = /^ {4}([a-z_]+): ?(.*)$/.exec(line)
    if (kind) stored.entries.push({ kind: unquoted(kind[1]), address: '' })
    else if (address) stored.entries[stored.entries.length - 1].address = unquoted(address[1])
    else if (setting && setting[1] !== 'entries') stored.settings[setting[1]] = unquoted(setting[2])
  }
  return stored
}

// --- running a fixture ---------------------------------------------------
interface RunOutcome {
  entries: LogEntry[]
  rendered: string[]
  copied: string[]
  vars: SessionVariables
  all: string
}

/** Import the fixture as a new test, run it with the console on DEBUG and read everything back. */
async function runFixture(
  page: Page,
  fixture: Fixture,
  bookend: string,
  createdTests: string[],
): Promise<RunOutcome> {
  const testId = await importValidateAndNavigate(page, fixture, { rejectRepairs: true })
  createdTests.push(testId)
  const validation = await validateTest(page.request, testId, 'run')
  expect(validation.status, `validate answered ${validation.status}`).toBe(200)
  expect(validation.errors, `the fixture must validate clean: ${JSON.stringify(validation.errors)}`).toEqual([])
  // The proxy line is DEBUG.
  await setConsoleMinimumLevel(page, 'DEBUG')
  const status = await startRun(page)
  await finishRun(page, status, bookend, 180_000)
  const rendered = await getLogTexts(page)
  const copied = await getLogCopyTexts(page)
  const entries = consoleEntriesFromCopy(copied)
  const vars = await getSessionVariables(page, await getActiveSessionId(page))
  return { entries, rendered, copied, vars, all: formatEntries(entries) }
}

function hasLine(outcome: RunOutcome, level: string, message: string): boolean {
  return outcome.entries.some((entry) => entry.level === level && entry.message === message)
}

function expectLine(outcome: RunOutcome, level: string, message: string): void {
  expect(hasLine(outcome, level, message), `the console must carry [${level}] "${message}".\n${outcome.all}`).toBe(
    true,
  )
}

function expectNoMessage(outcome: RunOutcome, message: string): void {
  expect(
    outcome.entries.filter((entry) => entry.message === message),
    `the console must not carry "${message}".\n${outcome.all}`,
  ).toEqual([])
}

/** One DEBUG proxy line from each of these blocks, naming this proxy, and none from any other block. */
function expectProxyLines(outcome: RunOutcome, proxy: string, sources: readonly string[]): void {
  const lines = outcome.entries
    .filter((entry) => entry.message.startsWith('Using the proxy '))
    .map((entry) => `${entry.source} | ${entry.level} ${entry.message}`)
    .sort()
  expect(lines, `the proxy lines of the run.\n${outcome.all}`).toEqual(
    sources.map((source) => `${source} | DEBUG Using the proxy ${proxy}`).sort(),
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
  return String(value)
}

/** The message a Try/Catch bound, or null when it caught nothing. */
function caughtMessage(vars: SessionVariables, name: string): string | null {
  const caught = sessionValue(vars, name) as { message?: unknown } | null
  return typeof caught?.message === 'string' ? caught.message : null
}

/** The line the Log block after the search prints from its bound outputs. */
function searchSummary(vars: SessionVariables): string {
  return `proxy-os ok=${python(vars, 'os_ok')} reason=${python(vars, 'os_reason')} total=${python(vars, 'os_total')}`
}

/** The line the Log block after the install prints from its bound outputs. */
function helmSummary(vars: SessionVariables): string {
  return `proxy-helm ok=${python(vars, 'helm_ok')} reason=${python(vars, 'helm_reason')} status=${python(vars, 'helm_status')}`
}

// --- one HTTP block inside its Try/Catch ---------------------------------
interface HttpLeg {
  key: string
  node: string
  /** The HTTP block's Name, which its Source and the engine's failure line carry (EXEC-25, EXEC-26). */
  name: string
  marker: string
}

const ROUTES = {
  setting: { key: 'setting', node: 'http-setting', name: 'Route setting', marker: 'route-setting' },
  off: { key: 'off', node: 'http-off', name: 'Route off', marker: 'route-off' },
  other: { key: 'other', node: 'http-other', name: 'Route other', marker: 'route-other' },
  tls: { key: 'tls', node: 'http-tls', name: 'Route tls', marker: 'route-tls' },
} as const satisfies Record<string, HttpLeg>

const LOGIN = {
  plain: { key: 'plain', node: 'http-plain', name: 'Login plain', marker: 'login-plain' },
  tls: { key: 'tls', node: 'http-tls', name: 'Login tls', marker: 'login-tls' },
} as const satisfies Record<string, HttpLeg>

const httpSource = (leg: HttpLeg): string => blockSource('HTTP', leg.name)

/** The block answered 200, nothing was caught and the catch branch never ran. */
async function expectReached(page: Page, outcome: RunOutcome, leg: HttpLeg): Promise<void> {
  const { vars } = outcome
  expect(caughtMessage(vars, `${leg.key}_err`), `"${leg.name}" must not fail.\n${outcome.all}`).toBeNull()
  expect(sessionValue(vars, `${leg.key}_status`), `"${leg.name}" status.\n${outcome.all}`).toBe(200)
  expectNoMessage(outcome, `${leg.marker} caught`)
  expectLine(outcome, 'INFO', `${leg.marker} status=200 caught=none`)
  await expectNodeStatus(page, leg.node, 'success')
}

/** The block failed with this message, the Try/Catch caught it and the catch branch ran. */
async function expectFailed(
  page: Page,
  outcome: RunOutcome,
  leg: HttpLeg,
  expected: string | RegExp,
): Promise<void> {
  const { vars } = outcome
  const message = caughtMessage(vars, `${leg.key}_err`) ?? ''
  if (typeof expected === 'string') {
    expect(message, `"${leg.name}" failure.\n${outcome.all}`).toBe(expected)
  } else {
    expect(message, `"${leg.name}" failure.\n${outcome.all}`).toMatch(expected)
  }
  expect(sessionValue(vars, `${leg.key}_status`), `"${leg.name}" got no answer`).toBe(0)
  expectLine(outcome, 'ERROR', `Block '${leg.name}' failed: ${message}`)
  expectLine(outcome, 'WARN', `Try-path error caught: ${message}`)
  expectLine(outcome, 'WARN', `${leg.marker} caught`)
  expectLine(outcome, 'INFO', `${leg.marker} status=0 caught=${message}`)
  await expectNodeStatus(page, leg.node, 'failed')
}

/** The HTTPS port answered with its own echo of the request. */
function expectEcho(outcome: RunOutcome, name: string): Record<string, string> {
  const echo = JSON.parse(text(outcome.vars, name)) as {
    method: string
    path: string
    headers: Record<string, string>
  }
  expect(echo.method, 'the echoed method').toBe('GET')
  expect(echo.path, 'the echoed path').toBe('/echo')
  expect(echo.headers.host, 'the target saw its own name').toBe(`${HTTP_TARGET_SERVICE}:${TARGET_HTTPS_PORT}`)
  return echo.headers
}

function expectHealth(outcome: RunOutcome, name: string): void {
  expect(JSON.parse(text(outcome.vars, name)), `the body of ${PLAIN_URL}`).toEqual(TARGET_HEALTH)
}

// --- suite ---------------------------------------------------------------
test.describe.configure({ mode: 'serial' })

test.describe('V-NET-PROXY-FUNCTIONAL: the Proxy setting routes the requests WAVE makes', () => {
  const createdTests: string[] = []
  let indexToken = ''

  test.beforeEach(async () => {
    await resetNetworkSettings(BACKEND_URL)
  })

  test.afterEach(async ({ request }) => {
    await request.delete(`${BACKEND_URL}/workbench/session/`).catch(() => undefined)
    for (const testId of createdTests.splice(0)) {
      await request.delete(`${BACKEND_URL}/tests/${testId}`).catch(() => undefined)
    }
    if (indexToken) await deleteOpenSearchIndexes(indexToken).catch(() => undefined)
    indexToken = ''
    await resetNetworkSettings(BACKEND_URL)
  })

  test('HTTP block: WAVE setting goes through the open proxy, Off and listed addresses connect directly', async ({
    page,
    request,
  }) => {
    test.setTimeout(420_000)
    const fixture = routesFixture()
    const listed: ProxyEntry = { kind: 'exact', address: PLAIN_ORIGIN }
    // Capitals in the pattern: entries match ignoring case.
    const pattern: ProxyEntry = {
      kind: 'regex',
      address: `^https://${escapeRegExp(HTTP_TARGET_SERVICE).toUpperCase()}(:\\d+)?$`,
    }

    expect(await readProxy(request), 'the reset leaves the proxy off').toMatchObject({
      enabled: false,
      source: 'host',
      entries: [],
    })

    await test.step('Custom with the open proxy and an empty list: every address goes through it', async () => {
      const tab = await openSetup(page)
      await typeCustomProxy(tab, PROXY_PORT)
      await saveSetup(page, tab)
      await expectSaved(request, customProxy(PROXY_PORT))

      const outcome = await runFixture(page, fixture, 'proxy-routes-done', createdTests)
      await expectReached(page, outcome, ROUTES.setting)
      expectHealth(outcome, 'setting_body')
      await expectFailed(page, outcome, ROUTES.off, DIRECT_HTTP)
      await expectReached(page, outcome, ROUTES.other)
      await expectReached(page, outcome, ROUTES.tls)
      expectEcho(outcome, 'tls_body')
      expectProxyLines(outcome, OPEN_PROXY, [
        httpSource(ROUTES.setting),
        httpSource(ROUTES.other),
        httpSource(ROUTES.tls),
      ])
    })

    await test.step('"All addresses except the list": an Exact and a Regex entry connect directly', async () => {
      const tab = await openSetup(page)
      await typeList(tab, 'except', [listed, pattern])
      await saveSetup(page, tab)
      await expectSaved(request, customProxy(PROXY_PORT, { entries: [listed, pattern] }))

      const outcome = await runFixture(page, fixture, 'proxy-routes-done', createdTests)
      await expectFailed(page, outcome, ROUTES.setting, DIRECT_HTTP)
      await expectFailed(page, outcome, ROUTES.off, DIRECT_HTTP)
      await expectFailed(page, outcome, ROUTES.tls, DIRECT_HTTP)
      await expectReached(page, outcome, ROUTES.other)
      expectProxyLines(outcome, OPEN_PROXY, [httpSource(ROUTES.other)])
    })

    await test.step('"Only the addresses in the list": the listed target alone goes through the proxy', async () => {
      const tab = await openSetup(page)
      await typeList(tab, 'only', [listed])
      await saveSetup(page, tab)
      await expectSaved(request, customProxy(PROXY_PORT, { list_mode: 'only', entries: [listed] }))

      const outcome = await runFixture(page, fixture, 'proxy-routes-done', createdTests)
      await expectReached(page, outcome, ROUTES.setting)
      expectHealth(outcome, 'setting_body')
      await expectFailed(page, outcome, ROUTES.off, DIRECT_HTTP)
      await expectFailed(page, outcome, ROUTES.other, DIRECT_HTTP)
      // An Exact entry is one protocol, host and port: the HTTPS port is another address.
      await expectFailed(page, outcome, ROUTES.tls, DIRECT_HTTP)
      expectProxyLines(outcome, OPEN_PROXY, [httpSource(ROUTES.setting)])
    })
  })

  test('login proxy: the saved login gets 200 and stays masked; a wrong or removed password gets 407 inside a Try/Catch', async ({
    page,
    request,
  }) => {
    test.setTimeout(420_000)
    const fixture = loginFixture()
    const { configFile } = await stackPaths(request)
    const entries: ProxyEntry[] = [
      { kind: 'exact', address: PLAIN_ORIGIN },
      { kind: 'exact', address: TLS_ORIGIN },
    ]
    const login = customProxy(PROXY_AUTH_PORT, {
      username: PROXY_AUTH_USER,
      password_set: true,
      list_mode: 'only',
      entries,
    })
    const basicValue = Buffer.from(`${PROXY_AUTH_USER}:${PROXY_AUTH_SECRET}`).toString('base64')

    const expectNowhere = (outcome: RunOutcome, secrets: readonly string[]): void => {
      const rendered = outcome.rendered.join('\n')
      const copied = outcome.copied.join('\n')
      for (const secret of secrets) {
        expect(rendered, 'no rendered console line shows the proxy login').not.toContain(secret)
        expect(copied, 'the copied log text does not hold the proxy login').not.toContain(secret)
      }
    }

    const expectRefused = async (outcome: RunOutcome): Promise<void> => {
      await expectFailed(page, outcome, LOGIN.plain, refusedLogin(TARGET_HTTP_PORT))
      await expectFailed(page, outcome, LOGIN.tls, refusedLogin(TARGET_HTTPS_PORT))
      expectProxyLines(outcome, LOGIN_PROXY, [])
      for (const id of ['tc-plain', 'log-plain-caught', 'log-plain', 'tc-tls', 'log-tls-caught', 'log-tls', 'log-done']) {
        await expectNodeStatus(page, id, 'success')
      }
    }

    await test.step('Username and Password saved: 200 over plain HTTP and over HTTPS, the password nowhere', async () => {
      const tab = await openSetup(page)
      await typeCustomProxy(tab, PROXY_AUTH_PORT)
      await tab.locator('input[name="proxy-username"]').fill(PROXY_AUTH_USER)
      await passwordInput(tab).fill(PROXY_AUTH_SECRET)
      await typeList(tab, 'only', entries)
      await saveSetup(page, tab)
      await expectPasswordMasked(tab)
      await expectSaved(request, login)
      await page.reload()
      await expectPasswordMasked(page.getByTestId('network-proxy-setup-tab'))
      expect(readConfigText(configFile), 'the config file holds no plain password').not.toContain(PROXY_AUTH_SECRET)
      expect(storedProxy(configFile).settings.password, 'the password is stored sealed').toMatch(
        /^wave:enc:v1:[A-Za-z0-9+/=]+$/,
      )

      const outcome = await runFixture(page, fixture, 'proxy-login-done', createdTests)
      await expectReached(page, outcome, LOGIN.plain)
      expectHealth(outcome, 'plain_body')
      await expectReached(page, outcome, LOGIN.tls)
      const seen = expectEcho(outcome, 'tls_body')
      expect(Object.keys(seen), 'the login stays with the proxy').not.toContain('proxy-authorization')
      expectProxyLines(outcome, LOGIN_PROXY, [httpSource(LOGIN.plain), httpSource(LOGIN.tls)])
      expectNowhere(outcome, [PROXY_AUTH_SECRET, basicValue])
    })

    await test.step('a wrong password: 407 from the proxy, caught, the block failed, the run passed', async () => {
      const tab = await openSetup(page)
      await expectPasswordMasked(tab)
      await deleteStoredPassword(page, tab)
      await passwordInput(tab).fill(WRONG_PASSWORD)
      await saveSetup(page, tab)
      await expectPasswordMasked(tab)
      await expectSaved(request, login)

      const outcome = await runFixture(page, fixture, 'proxy-login-done', createdTests)
      await expectRefused(outcome)
      expectNowhere(outcome, [WRONG_PASSWORD, PROXY_AUTH_SECRET])
    })

    await test.step('"Delete & Edit" then Save removes the password: 407 again', async () => {
      const tab = await openSetup(page)
      await deleteStoredPassword(page, tab)
      await saveSetup(page, tab)
      await expect(maskedPassword(tab), 'no password is stored any more').toHaveCount(0)
      await expect(passwordInput(tab)).toHaveValue('')
      await expectSaved(request, { ...login, password_set: false })
      expect(storedProxy(configFile).settings.password, 'the config file holds no password').toBe('null')

      const outcome = await runFixture(page, fixture, 'proxy-login-done', createdTests)
      await expectRefused(outcome)
    })
  })

  test('K8s and OpenSearch blocks reach their proxy-only targets only while the list names them', async ({
    page,
    request,
  }) => {
    indexToken = `px${randomBytes(4).toString('hex')}`
    const index = openSearchIndexName(indexToken, 'proxy')
    await createOpenSearchIndex(index, MAP_LOGS)
    await seedOpenSearch(index, F_LOGS)
    const fixture = clusterFixture(indexToken)
    const connectSource = blockSource('K8s Connect', 'Cluster by its compose name')
    const getSource = blockSource('K8s Get', 'Default namespace')
    const searchSource = blockSource('OpenSearch', 'Search by its compose name')
    const cluster: ProxyEntry = { kind: 'exact', address: CLUSTER_URL }
    const search: ProxyEntry = { kind: 'regex', address: `^${escapeRegExp(SEARCH_URL)}$` }

    await test.step('the cluster alone in the list: K8s goes through the proxy, the search connects directly', async () => {
      const tab = await openSetup(page)
      await typeCustomProxy(tab, PROXY_PORT)
      await typeList(tab, 'only', [cluster])
      await saveSetup(page, tab)
      await expectSaved(request, customProxy(PROXY_PORT, { list_mode: 'only', entries: [cluster] }))

      const outcome = await runFixture(page, fixture, 'proxy-k8s-os-done', createdTests)
      const { vars } = outcome
      const version = text(vars, 'k8s_version')
      expect(version, `K8s Connect reads the cluster version.\n${outcome.all}`).toMatch(/^v1\.33\.\d+$/)
      expect(caughtMessage(vars, 'k8s_err'), `nothing was caught.\n${outcome.all}`).toBeNull()
      expect(sessionValue(vars, 'ns_count'), 'K8s Get reads one namespace').toBe(1)
      expect(sessionValue(vars, 'ns_names'), 'K8s Get names it').toEqual(['default'])
      expectNoMessage(outcome, 'proxy-k8s caught')
      expectLine(outcome, 'INFO', `proxy-k8s version=${version} count=1 caught=none`)
      await expectNodeStatus(page, 'k8s-connect', 'success')
      await expectNodeStatus(page, 'k8s-get', 'success')

      const refusal = text(vars, 'os_err')
      expect(refusal, `the search connects directly and finds no such name.\n${outcome.all}`).toMatch(DIRECT_SEARCH)
      expect(sessionValue(vars, 'os_ok'), 'Success under Record').toBe(false)
      expect(text(vars, 'os_reason')).toBe('Unreachable')
      expect(sessionValue(vars, 'os_total'), 'no search was answered').toBe(0)
      expectLine(outcome, 'WARN', `Search failed (Unreachable): ${refusal}`)
      expectLine(outcome, 'INFO', searchSummary(vars))
      await expectNodeStatus(page, 'os-search', 'warning')
      expectProxyLines(outcome, OPEN_PROXY, [connectSource, getSource])
    })

    await test.step('the search alone in the list: the search goes through the proxy, K8s connects directly', async () => {
      const tab = await openSetup(page)
      await typeList(tab, 'only', [search])
      await saveSetup(page, tab)
      await expectSaved(request, customProxy(PROXY_PORT, { list_mode: 'only', entries: [search] }))

      const outcome = await runFixture(page, fixture, 'proxy-k8s-os-done', createdTests)
      const { vars } = outcome
      const refusal = caughtMessage(vars, 'k8s_err') ?? ''
      expect(refusal, `K8s Connect connects directly and finds no such name.\n${outcome.all}`).toMatch(DIRECT_K8S)
      expect(text(vars, 'k8s_version'), 'no cluster version was read').toBe('')
      expect(sessionValue(vars, 'ns_count'), 'K8s Get never ran').toBe(0)
      expectLine(outcome, 'ERROR', `Block 'Cluster by its compose name' failed: ${refusal}`)
      expectLine(outcome, 'WARN', 'proxy-k8s caught')
      expectLine(outcome, 'INFO', `proxy-k8s version= count=0 caught=${refusal}`)
      await expectNodeStatus(page, 'k8s-connect', 'failed')

      expect(sessionValue(vars, 'os_ok'), `the search is answered.\n${outcome.all}`).toBe(true)
      expect(sessionValue(vars, 'os_total'), 'the six ERROR documents').toBe(6)
      expect(text(vars, 'os_reason'), 'an answered search has no failure reason').toBe('')
      expectLine(outcome, 'INFO', searchSummary(vars))
      await expectNodeStatus(page, 'os-search', 'success')
      expectProxyLines(outcome, OPEN_PROXY, [searchSource])
    })
  })

  test('Helm Install deploys a chart from the proxy-only repository on the proxy-only cluster, and needs the proxy for both', async ({
    page,
    request,
  }) => {
    const installSource = blockSource('Helm Install', 'Chart by its compose name')
    const cluster: ProxyEntry = { kind: 'exact', address: CLUSTER_URL }
    const repository: ProxyEntry = { kind: 'exact', address: CHART_REPO_INTERNAL_URL }

    await test.step('the cluster and the chart repository in the list: the chart is deployed', async () => {
      const tab = await openSetup(page)
      await typeCustomProxy(tab, PROXY_PORT)
      await typeList(tab, 'only', [cluster, repository])
      await saveSetup(page, tab)
      await expectSaved(request, customProxy(PROXY_PORT, { list_mode: 'only', entries: [cluster, repository] }))

      const names = helmNames()
      const outcome = await runFixture(page, helmFixture(names), 'proxy-helm-done', createdTests)
      const { vars } = outcome
      expectReleaseRow(vars, 'helm', {
        name: names.release,
        namespace: names.namespace,
        revision: 1,
        status: 'deployed',
        chart: `${CHART.demo}-${CHART_VERSION}`,
        appVersion: '1.0.0',
      })
      expect(statusOf(vars, 'helm'), `the Status output.\n${outcome.all}`).toBe('deployed')
      expect(sessionValue(vars, 'helm_ok')).toBe(true)
      expectLine(outcome, 'INFO', installedLine(names.release, 1))
      expectLine(outcome, 'INFO', uninstalledLine(names.release))
      expect(text(vars, 'helm_reason'), 'a deployed chart has no failure reason').toBe('')
      expectLine(outcome, 'INFO', helmSummary(vars))
      expect(sessionValue(vars, 'ns_del_count'), 'the namespace the install created is removed').toBe(1)
      for (const id of ['helm-connect', 'helm-install', 'helm-uninstall', 'delete-ns', 'log-done']) {
        await expectNodeStatus(page, id, 'success')
      }
      expectProxyLines(outcome, OPEN_PROXY, [
        blockSource('K8s Connect', 'Cluster for Helm'),
        installSource,
        blockSource('Helm Uninstall', 'Remove the release'),
        blockSource('K8s Delete', 'Remove the namespace'),
      ])
    })

    await test.step('the cluster alone in the list: helm cannot reach the chart repository', async () => {
      const tab = await openSetup(page)
      await typeList(tab, 'only', [cluster])
      await saveSetup(page, tab)
      await expectSaved(request, customProxy(PROXY_PORT, { list_mode: 'only', entries: [cluster] }))

      const names = helmNames()
      const outcome = await runFixture(page, helmFixture(names), 'proxy-helm-done', createdTests)
      const { vars } = outcome
      expectRecorded(vars, 'helm', { reason: 'Unreachable' })
      const refusal = text(vars, 'helm_err')
      expect(refusal, `helm fetches the chart directly and finds no such name.\n${outcome.all}`).toMatch(DIRECT_CHART)
      expectEmptyRelease(vars, 'helm')
      expect(statusOf(vars, 'helm'), 'a failed install reports no status').toBe('')
      expect(
        outcome.entries.some(
          (entry) =>
            entry.source === installSource &&
            entry.level === 'WARN' &&
            entry.message === recordedLine('Helm Install', 'Unreachable', refusal),
        ),
        `the Install block records its failure.\n${outcome.all}`,
      ).toBe(true)
      expectLine(outcome, 'INFO', helmSummary(vars))
      await expectNodeStatus(page, 'helm-connect', 'success')
      await expectNodeStatus(page, 'helm-install', 'warning')
    })
  })

  test('Custom proxy on: a Shell Exec sees no proxy variable, and the config file holds the setting with a sealed password', async ({
    page,
    request,
  }) => {
    const { configFile } = await stackPaths(request)
    const entries: ProxyEntry[] = [
      { kind: 'exact', address: PLAIN_ORIGIN },
      { kind: 'regex', address: `^${escapeRegExp(TLS_ORIGIN)}$` },
    ]
    const before = await readProxy(request)
    expect(before.host_values, "the stack's backend has no proxy variable of its own").toEqual({
      https_proxy: null,
      http_proxy: null,
      no_proxy: null,
    })

    const tab = await openSetup(page)
    await typeCustomProxy(tab, PROXY_AUTH_PORT)
    await tab.locator('input[name="proxy-username"]').fill(PROXY_AUTH_USER)
    await passwordInput(tab).fill(PROXY_AUTH_SECRET)
    await typeList(tab, 'only', entries)
    await tab.getByRole('switch', { name: 'Use the proxy for local addresses too', exact: true }).click()
    await saveSetup(page, tab)
    await expectPasswordMasked(tab)
    await expectSaved(
      request,
      customProxy(PROXY_AUTH_PORT, {
        username: PROXY_AUTH_USER,
        password_set: true,
        list_mode: 'only',
        entries,
        proxy_local_addresses: true,
      }),
    )

    await test.step('the config file holds network.proxy with both entries and no plain password', () => {
      const { password, ...settings } = storedProxy(configFile).settings
      expect(settings, 'the keys of network.proxy').toEqual({
        enabled: 'true',
        source: 'custom',
        host: HTTP_TARGET_HOST,
        port: PROXY_AUTH_PORT,
        username: PROXY_AUTH_USER,
        list_mode: 'only',
        proxy_local_addresses: 'true',
      })
      expect(storedProxy(configFile).entries, 'the entries of network.proxy').toEqual(entries)
      expect(password, 'the password is stored sealed').toMatch(/^wave:enc:v1:[A-Za-z0-9+/=]+$/)
      expect(readConfigText(configFile), 'the config file holds no plain password').not.toContain(PROXY_AUTH_SECRET)
    })

    await test.step('Shell Exec env: no proxy variable and no proxy password reach the script', async () => {
      const outcome = await runFixture(page, environmentFixture(), 'proxy-env-done', createdTests)
      const { vars } = outcome
      expect(sessionValue(vars, 'check_status'), `the HTTP block of the same run uses the proxy.\n${outcome.all}`).toBe(200)
      const environment = text(vars, 'env_out')
      const names = environment
        .split('\n')
        .filter((line) => line.includes('='))
        .map((line) => line.slice(0, line.indexOf('=')))
      expect(names, 'the script prints its environment').toContain('PATH')
      expect(
        names.filter((name) => name.toLowerCase().includes('proxy')),
        'no proxy variable is set for the script',
      ).toEqual([])
      expect(environment, 'the proxy password is not in the environment').not.toContain(PROXY_AUTH_SECRET)
      await expectNodeStatus(page, 'http-check', 'success')
      await expectNodeStatus(page, 'shell-env', 'success')
      expectProxyLines(outcome, LOGIN_PROXY, [blockSource('HTTP', 'Proxy in force')])
    })
  })
})
