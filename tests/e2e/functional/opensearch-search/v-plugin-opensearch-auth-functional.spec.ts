/**
 * V-PLUGIN-OPENSEARCH-AUTH-FUNCTIONAL: every way the OpenSearch block identifies itself to the real cluster
 * Wireframe: N/A
 * Design Decisions: OS-2, OS-10, OS-11
 * REQ: REQ-5.1.2, REQ-3.4.1.15
 *
 * One workflow chains nine Searches on the run's own F-LOGS index, fixed window, DQL
 * `log.level: "ERROR"`. After each Search an Assert checks its Total results and a Log writes an
 * `os-auth-...` line. Secrets, PEMs and the API token are filled at load, never stored in the fixture.
 *
 * Pass Criteria:
 * 1. The fixture imports through POST /tests with no repairs and validates with zero findings.
 * 2. BASIC: `wave` / `os-secret` over verified TLS with the WAVE Test CA finds Total 6.
 * 3. CLIENT-CERT: no credentials, the tls-lab client certificate and key, the CA: Total 6.
 * 4. BEARER: the checked-in JWT as Bearer Token, the CA: Total 6.
 * 5. API-KEY: an API token minted for this run (revoked after): Total 6.
 * 6. GATEWAY: the plain-http gateway `http://127.0.0.1:9478/os` with Basic: Total 6, and every request
 *    goes out under the `/os` prefix.
 * 7. VERIFY-OFF: Verify Server Certificate off and no CA: Total 6.
 * 8. VERIFY-NO-CA: verify on, no CA, Record and continue: Reason Unreachable, the error names the
 *    address and contains CERTIFICATE_VERIFY_FAILED; the block ends amber and asks nothing more; it
 *    logs once, at DEBUG, that it trusts WAVE's built-in certificate list (REQ-4.5.16).
 * 9. SCHEME-WORD: API Key typed as `ApiKey <token>`, Record and continue: sent as typed, so Reason
 *    AuthFailed with `HTTP 401: Unauthorized`.
 * 10. ANONYMOUS: no credentials and no client certificate, Record and continue: Reason AuthFailed,
 *     Error `HTTP 401: Unauthorized`.
 * 11. Every passing Search logs only its INFO summary line (no result rows) and binds Success, the six
 *     ERROR documents newest first in Results, and Total results; every recorded one logs one WARN.
 * 12. NO-LEAK: the whole run log, DEBUG included, holds none of the password, the JWT, the minted
 *     token, the base64 of `wave:os-secret` or the client key.
 * 13. Every Assert passes, every bound value reaches its Log line, and the session passes.
 */

import fs from 'fs'
import path from 'path'
import { test, expect } from '../../helpers/playwright-fixtures'
import {
  BACKEND_URL,
  CA_CERT_PEM,
  OPENSEARCH_GATEWAY_PORT,
  OPENSEARCH_GATEWAY_PREFIX,
  OPENSEARCH_JWT,
  OPENSEARCH_PASSWORD,
  OPENSEARCH_PORT,
  OPENSEARCH_TARGET_HOST,
  OPENSEARCH_USER,
  TLS_LAB_CLIENT_CERT_PEM,
  TLS_LAB_CLIENT_KEY_PEM,
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
import {
  escapeRegExp,
  formatEntries,
  getLogCopyTexts,
  setConsoleMinimumLevel,
  type LogEntry,
} from '../../helpers/log-reader'
import {
  createOpenSearchIndex,
  deleteOpenSearchIndexes,
  F_LOGS,
  FIXED_FROM_ISO,
  FIXED_TO_ISO,
  MAP_LOGS,
  mintOpenSearchApiToken,
  openSearchIndexName,
  revokeOpenSearchApiToken,
  seedOpenSearch,
  type OpenSearchApiToken,
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
  [key: string]: unknown
}

const FIXTURE_FILE = 'fixture-auth.json'
const BOOKEND = 'os-auth-done'
const DIRECT_URL = 'https://127.0.0.1:9477'
const GATEWAY_URL = 'http://127.0.0.1:9478/os'
const UNAUTHORIZED = 'HTTP 401: Unauthorized'
const VERIFY_FAILED = 'CERTIFICATE_VERIFY_FAILED'
const MASK = '********'

type Fill = 'password' | 'ca' | 'client' | 'jwt' | 'api_key' | 'api_key_scheme'

interface AuthCase {
  /** The Search block's Name, which is also its Description. */
  block: string
  /** The prefix of the case's variables in the fixture. */
  key: string
  /** The case's Log line starts `os-auth-<slug> `. */
  slug: string
  url: string
  username: string
  verify: boolean
  record: boolean
  fills: Fill[]
}

function authCase(
  block: string,
  key: string,
  slug: string,
  fills: Fill[],
  options: Partial<Pick<AuthCase, 'url' | 'username' | 'verify' | 'record'>> = {},
): AuthCase {
  return { block, key, slug, fills, url: DIRECT_URL, username: '', verify: true, record: false, ...options }
}

const BASIC_LOGIN = { username: OPENSEARCH_USER }

const CASES: AuthCase[] = [
  authCase('Basic', 'basic', 'basic', ['password', 'ca'], BASIC_LOGIN),
  authCase('Client certificate', 'cert', 'client-cert', ['client', 'ca']),
  authCase('Bearer token', 'bearer', 'bearer', ['jwt', 'ca']),
  authCase('API key', 'apikey', 'api-key', ['api_key', 'ca']),
  authCase('Gateway with prefix', 'gateway', 'gateway', ['password'], { ...BASIC_LOGIN, url: GATEWAY_URL }),
  authCase('Verify off', 'voff', 'verify-off', ['password'], { ...BASIC_LOGIN, verify: false }),
  authCase('Verify without CA', 'noca', 'verify-no-ca', ['password'], { ...BASIC_LOGIN, record: true }),
  authCase('API key with scheme word', 'scheme', 'scheme-word', ['api_key_scheme', 'ca'], { record: true }),
  authCase('Anonymous', 'anon', 'anonymous', ['ca'], { record: true }),
]

const PASSING = CASES.filter((c) => !c.record)
const RECORDED = CASES.filter((c) => c.record)
const FILLED_ROWS = ['password', 'api_key', 'bearer_token', 'ca_cert', 'client_cert', 'client_key']
/** The fills that put a secret row on the block, so its DEBUG inputs echo shows the mask. */
const SECRET_FILLS: Fill[] = ['password', 'client', 'jwt', 'api_key', 'api_key_scheme']

/** The six ERROR documents of F-LOGS, newest first, as the Results cells hold them. */
const ERROR_ROWS = F_LOGS.filter((doc) => (doc.log as { level: string }).level === 'ERROR')
  .map((doc) => [doc['@timestamp'], 'ERROR', doc.message] as unknown[])
  .sort((a, b) => String(b[0]).localeCompare(String(a[0])))

const createdTests: string[] = []
let token = ''
let apiToken: OpenSearchApiToken | null = null

function loadFixture(): Fixture {
  return JSON.parse(fs.readFileSync(path.resolve(__dirname, FIXTURE_FILE), 'utf-8')) as Fixture
}

function blockOf(fixture: Fixture, description: string): FixtureNode {
  const found = fixture.workflow.nodes.filter((node) => node.data.description === description)
  expect(found, `the fixture must declare one block described "${description}"`).toHaveLength(1)
  return found[0]
}

/** Each Search dials the host-mode address its case names and stores no secret; the fills come from config. */
function prepareFixture(fixture: Fixture, key: OpenSearchApiToken): Fixture {
  const searches = fixture.workflow.nodes.filter((node) => node.data.elementType === 'opensearch')
  expect(searches.map((node) => node.data.description), 'one Search per case, in case order').toEqual(
    CASES.map((c) => c.block),
  )
  for (const c of CASES) {
    const node = blockOf(fixture, c.block)
    const values = node.data.config.values
    const what = `"${c.block}"`
    expect(node.data.label, `${what} is named as it is described`).toBe(c.block)
    expect(values.url, `${what} carries the host-mode address the import rewrites`).toBe(c.url)
    expect(values.index, `${what} reads the run's own index`).toBe(openSearchIndexName(token, 'app-logs'))
    expect(values.username, `${what} logs in as it means to`).toBe(c.username)
    expect(values.verify_ssl, `${what} sets Verify Server Certificate`).toBe(c.verify)
    expect(values.on_error, `${what} fails or records`).toBe(c.record ? 'record' : 'fail')
    for (const row of FILLED_ROWS) {
      expect(values[row], `${what} stores no ${row}`).toBe('')
    }
    for (const fill of c.fills) {
      if (fill === 'password') values.password = OPENSEARCH_PASSWORD
      if (fill === 'ca') values.ca_cert = CA_CERT_PEM
      if (fill === 'client') {
        values.client_cert = TLS_LAB_CLIENT_CERT_PEM
        values.client_key = TLS_LAB_CLIENT_KEY_PEM
      }
      if (fill === 'jwt') values.bearer_token = OPENSEARCH_JWT
      if (fill === 'api_key') values.api_key = key.token
      if (fill === 'api_key_scheme') values.api_key = `ApiKey ${key.token}`
    }
  }
  return fixture
}

/** The request path a case's cluster address starts every request with. */
function prefixOf(c: AuthCase): string {
  return c.url === GATEWAY_URL ? OPENSEARCH_GATEWAY_PREFIX : ''
}

/** Where WAVE dials a case, as the Unreachable text names it. */
function whereOf(c: AuthCase): string {
  const port = c.url === GATEWAY_URL ? OPENSEARCH_GATEWAY_PORT : OPENSEARCH_PORT
  return `${OPENSEARCH_TARGET_HOST}:${port}`
}

function blockEntries(entries: readonly LogEntry[], c: AuthCase): LogEntry[] {
  const source = blockSource('OpenSearch', c.block)
  return entries.filter((entry) => entry.source === source)
}

/** The block's INFO and WARN lines as "LEVEL message", the elapsed seconds blanked. */
function summaryLines(entries: readonly LogEntry[], c: AuthCase): string[] {
  return blockEntries(entries, c)
    .filter((entry) => entry.level !== 'DEBUG')
    .map((entry) => `${entry.level} ${entry.message.replace(/, \d+\.\d{2} s$/, ', # s')}`)
}

/** The DEBUG request lines the block wrote, each cut to its method and path, sorted: the harvest does not keep their order. */
function requestLines(entries: readonly LogEntry[], c: AuthCase): string[] {
  return blockEntries(entries, c)
    .filter((entry) => entry.level === 'DEBUG' && /^(GET|POST) \//.test(entry.message))
    .map((entry) => entry.message.split(' ').slice(0, 2).join(' '))
    .sort()
}

function expectBlockLines(entries: readonly LogEntry[], c: AuthCase, expected: string[]): void {
  // The harvest does not keep line order, so compare sorted.
  expect(summaryLines(entries, c).sort(), `the INFO / WARN lines of "${c.block}".\n${formatEntries(entries)}`).toEqual(
    [...expected].sort(),
  )
}

test.describe('V-PLUGIN-OPENSEARCH-AUTH-FUNCTIONAL: the ways the block identifies itself', () => {
  test.beforeAll(async () => {
    token = newToken()
    const index = openSearchIndexName(token, 'app-logs')
    await createOpenSearchIndex(index, MAP_LOGS)
    await seedOpenSearch(index, F_LOGS)
    apiToken = await mintOpenSearchApiToken(openSearchIndexName(token, 'auth-api-key'))
  })

  test.afterAll(async ({ request }) => {
    await request.delete(`${BACKEND_URL}/workbench/session/`).catch(() => undefined)
    for (const testId of createdTests.splice(0)) {
      await request.delete(`${BACKEND_URL}/tests/${testId}`).catch(() => undefined)
    }
    if (apiToken) await revokeOpenSearchApiToken(apiToken.id)
    if (token) await deleteOpenSearchIndexes(token)
  })

  test('Basic, client certificate, Bearer, API Key, the gateway, verify on and off, and no leak', async ({
    page,
  }) => {
    test.setTimeout(240_000)
    expect(apiToken, 'the API token was minted in beforeAll').not.toBeNull()
    const key = apiToken as OpenSearchApiToken
    const index = openSearchIndexName(token, 'app-logs')
    const fixture = prepareFixture(withToken(loadFixture(), token), key)
    const infoLine = `INFO Search ${index} from ${FIXED_FROM_ISO} to ${FIXED_TO_ISO}: 6 results, 6 kept, # s`
    const fieldCaps = (c: AuthCase): string => `GET ${prefixOf(c)}/${index}/_field_caps?fields=*&ignore_unavailable=true&allow_no_indices=true`
    const search = (c: AuthCase): string => `POST ${prefixOf(c)}/${index}/_search`

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
    const certificates = await page.request.get(`${BACKEND_URL}/network/certificates`)
    expect(certificates.ok(), 'GET /network/certificates').toBe(true)
    const builtinLabel = String((await certificates.json()).settings.builtin.label)
    const entries = consoleEntriesFromCopy(await getLogCopyTexts(page))
    const messages = entries.map((entry) => entry.message)
    const expectLog = (line: string): void => {
      expect(messages, `the console must carry "${line}".\n${formatEntries(entries)}`).toContain(line)
    }

    await test.step('every block ends in its state: passing Searches green, recorded ones amber (OS-11)', async () => {
      for (const node of fixture.workflow.nodes) {
        const recorded = RECORDED.some((c) => c.block === node.data.description)
        await expectNodeStatus(page, node.id, recorded ? 'warning' : 'success')
      }
    })

    for (const c of PASSING) {
      await test.step(`${c.slug.toUpperCase()}: Total 6, the six ERROR documents newest first (OS-2)`, () => {
        expectBlockLines(entries, c, [infoLine])
        expect(requestLines(entries, c), `"${c.block}" reads the field list and searches`).toEqual([
          fieldCaps(c),
          search(c),
        ])
        expect(sessionValue(variables, `${c.key}_ok`), `${c.key}_ok`).toBe(true)
        expect(sessionValue(variables, `${c.key}_total`), `${c.key}_total`).toBe(6)
        const rows = sessionTable(variables, `${c.key}_rows`)
        expect(rows.columns.map((column) => column.name), `${c.key}_rows columns`).toEqual([
          '@timestamp',
          'log.level',
          'message',
        ])
        expect(rows.rows, `${c.key}_rows holds the ERROR documents newest first`).toEqual(ERROR_ROWS)
        expectLog(`os-auth-${c.slug} total=6 first=${String(ERROR_ROWS[0][2])}`)
      })
    }

    await test.step('GATEWAY: the /os path prefix is kept on every request (OS-2)', () => {
      const gateway = CASES.find((c) => c.key === 'gateway') as AuthCase
      const lines = requestLines(entries, gateway)
      expect(lines.length, 'the gateway block sent requests').toBeGreaterThan(0)
      for (const line of lines) {
        expect(line, 'every gateway request keeps the prefix').toMatch(
          new RegExp(`^(GET|POST) ${escapeRegExp(OPENSEARCH_GATEWAY_PREFIX)}/`),
        )
      }
    })

    const recorded = (keyName: string): AuthCase => RECORDED.find((c) => c.key === keyName) as AuthCase

    await test.step('VERIFY-NO-CA: Unreachable with CERTIFICATE_VERIFY_FAILED, no search sent (OS-11)', () => {
      const c = recorded('noca')
      const error = String(sessionValue(variables, 'noca_error'))
      expect(error.startsWith(`Could not connect to OpenSearch at ${whereOf(c)}: `), error).toBe(true)
      expect(error, 'the TLS check failed on the certificate').toContain(VERIFY_FAILED)
      expect(sessionValue(variables, 'noca_ok')).toBe(false)
      expect(sessionValue(variables, 'noca_reason')).toBe('Unreachable')
      expect(sessionValue(variables, 'noca_total')).toBe(0)
      expect(sessionTable(variables, 'noca_rows')).toEqual({ columns: [], rows: [] })
      expectBlockLines(entries, c, [`WARN Search failed (Unreachable): ${error}`])
      expect(
        blockEntries(entries, c)
          .filter((entry) => entry.message.startsWith('Trusting '))
          .map((entry) => `${entry.level} ${entry.message}`),
        `the trust line of "${c.block}".\n${formatEntries(entries)}`,
      ).toEqual([`DEBUG Trusting WAVE's built-in certificate list (${builtinLabel})`])
      expect(requestLines(entries, c), 'only the field-list request was attempted').toEqual([fieldCaps(c)])
      expectLog(`os-auth-verify-no-ca total=0 reason=Unreachable error=${error}`)
    })

    await test.step('SCHEME-WORD: the API Key is sent as typed, so AuthFailed (OS-2)', () => {
      const c = recorded('scheme')
      expect(sessionValue(variables, 'scheme_ok')).toBe(false)
      expect(sessionValue(variables, 'scheme_reason')).toBe('AuthFailed')
      expect(sessionValue(variables, 'scheme_error')).toBe(UNAUTHORIZED)
      expect(sessionValue(variables, 'scheme_total')).toBe(0)
      expect(sessionTable(variables, 'scheme_rows')).toEqual({ columns: [], rows: [] })
      expectBlockLines(entries, c, [`WARN Search failed (AuthFailed): ${UNAUTHORIZED}`])
      expect(requestLines(entries, c)).toEqual([fieldCaps(c)])
      expectLog(`os-auth-scheme-word total=0 reason=AuthFailed error=${UNAUTHORIZED}`)
    })

    await test.step('ANONYMOUS: no credentials and no certificate is refused with 401 (OS-2, OS-11)', () => {
      const c = recorded('anon')
      expect(sessionValue(variables, 'anon_ok')).toBe(false)
      expect(sessionValue(variables, 'anon_reason')).toBe('AuthFailed')
      expect(sessionValue(variables, 'anon_error')).toBe(UNAUTHORIZED)
      expect(sessionValue(variables, 'anon_total')).toBe(0)
      expect(sessionTable(variables, 'anon_rows')).toEqual({ columns: [], rows: [] })
      expectBlockLines(entries, c, [`WARN Search failed (AuthFailed): ${UNAUTHORIZED}`])
      expect(requestLines(entries, c)).toEqual([fieldCaps(c)])
      expectLog(`os-auth-anonymous total=0 reason=AuthFailed error=${UNAUTHORIZED}`)
    })

    await test.step('NO-LEAK: no secret reaches the run log, DEBUG included (REQ-5.1.2)', () => {
      for (const c of CASES) {
        const inputs = blockEntries(entries, c).filter(
          (entry) => entry.level === 'DEBUG' && entry.message.startsWith('Inputs: '),
        )
        expect(inputs, `DEBUG was on: "${c.block}" echoed its inputs once`).toHaveLength(1)
        if (c.fills.some((fill) => SECRET_FILLS.includes(fill))) {
          expect(inputs[0].message, `"${c.block}" echoes its secret as the mask`).toContain(MASK)
        }
      }
      const text = entries.map((entry) => `${entry.source} ${entry.message}`).join('\n')
      const keyBody = TLS_LAB_CLIENT_KEY_PEM.split('\n')[1]
      const needles: Record<string, string> = {
        password: OPENSEARCH_PASSWORD,
        JWT: OPENSEARCH_JWT,
        'minted API token': key.token,
        'Basic credential': Buffer.from(`${OPENSEARCH_USER}:${OPENSEARCH_PASSWORD}`).toString('base64'),
        'client key': keyBody,
      }
      for (const [what, needle] of Object.entries(needles)) {
        expect(needle.length, `the ${what} needle is not empty`).toBeGreaterThan(8)
        expect(text.includes(needle), `the run log leaked the ${what}`).toBe(false)
      }
    })

    await test.step('the run passes and reaches its bookend', () => {
      expectLog(BOOKEND)
    })
  })
})
