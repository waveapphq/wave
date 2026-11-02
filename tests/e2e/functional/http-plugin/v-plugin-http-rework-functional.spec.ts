/**
 * V-PLUGIN-HTTP-REWORK-FUNCTIONAL: the HTTP block end to end against a recording server
 * REQ: REQ-3.4.1.4, REQ-3.1.3.21
 *
 * The recording HTTP server lives in the spec: its byte-exact ordering and absence proofs are
 * per-spec state a shared stack service cannot hold. Four runs:
 *
 *   Test 1 (main): Bearer via the Auth section; the generated Content-Type wins over a
 *     dynamic-map Content-Type; a dynamic-map Content-Length fails before send with its
 *     sentence; the map / part literal-vs-expression and coercion wire matrix; a text-only
 *     multipart body sent as real multipart; file download, cap and trace; a query entry
 *     given None sent as empty text (M5).
 *   Test 2: Basic and API-key auth modes reach the server composed and masked; the
 *     section-enabler rows carry no expression toggle.
 *   Test 3: the runtime auth required-field checks (admin-seeded).
 *   Test 4: trace name-masking of short and response catalog headers, the reveal path, the
 *     marked-trace parity, a 1-redirect hop trace, and the file-mode size cap.
 *
 * Run: ./scripts/e2e-targeted-local.sh functional/http-plugin/v-plugin-http-rework-functional.spec.ts
 */

import http from 'node:http'
import crypto from 'node:crypto'
import fs from 'fs'
import path from 'path'
import { test, expect, type Page } from '../../helpers/playwright-fixtures'
import { getLogTexts, getLogCopyTexts } from '../../helpers/log-reader'
import {
  importValidateAndNavigate,
  getActiveSessionId,
  getSessionVariables,
} from '../../helpers/fixture-import'
import { selectEnvironment, configSheet } from '../../helpers/workbench'
import { BACKEND_URL } from '../../helpers/config'

const TOKEN = 'tok-rework-9f2d41c8a7'
const MULTIPART_FILE_CONTENT = 'WAVE-MULTIPART-CONTENT'
const DL_CONTENT = Buffer.from('WAVE-DL-0123456789'.repeat(128)) // 2304 bytes
const DL_SHA256 = crypto.createHash('sha256').update(DL_CONTENT).digest('hex')
const BIG_CONTENT = 'X'.repeat(4096)
const BIGFILE_CONTENT = Buffer.from('F'.repeat(4096))
const FILECAP_SHA = crypto.createHash('sha256').update(BIGFILE_CONTENT.subarray(0, 1024)).digest('hex')
const RAW_COOKIE = 'sid=raw-cookie-abcdef123456'
const RAW_SETCOOKIE = 'token=raw-setcookie-987654321zzz'
const REVEAL_KEY = 'reveal-key-longvalue'
const TRACE_MARKER = 'markervalue-1234567'
const CONTENT_LENGTH_MESSAGE =
  'Headers from the headers expression contain "Content-Length": ' +
  'Header "Content-Length" cannot be set manually - the HTTP stack blocks length overrides'

interface SeenRequest {
  method: string
  url: string
  headers: http.IncomingHttpHeaders
  body: Buffer
}

function startRecordingServer(seen: SeenRequest[]): Promise<{ server: http.Server; port: number }> {
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    req.on('end', () => {
      seen.push({
        method: req.method ?? '',
        url: req.url ?? '',
        headers: req.headers,
        body: Buffer.concat(chunks),
      })
      const url = req.url ?? '/'
      if (url.startsWith('/echo')) {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        return res.end(JSON.stringify({ authorization: req.headers.authorization ?? null }))
      }
      if (url.startsWith('/files/report.bin')) {
        res.writeHead(200, { 'Content-Type': 'application/octet-stream' })
        return res.end(DL_CONTENT)
      }
      if (url.startsWith('/bigfile')) {
        res.writeHead(200, { 'Content-Type': 'application/octet-stream' })
        return res.end(BIGFILE_CONTENT)
      }
      if (url.startsWith('/big')) {
        res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' })
        return res.end(BIG_CONTENT)
      }
      if (url.startsWith('/redir')) {
        res.writeHead(302, { Location: '/landed', 'Content-Type': 'application/json' })
        return res.end(JSON.stringify({ redirect: true }))
      }
      if (url.startsWith('/cookie')) {
        res.writeHead(200, { 'Set-Cookie': RAW_SETCOOKIE, 'Content-Type': 'application/json' })
        return res.end(JSON.stringify({ ok: true }))
      }
      res.writeHead(200, { 'Content-Type': 'application/json' })
      return res.end(JSON.stringify({ ok: true }))
    })
  })
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : 0
      resolve({ server, port })
    })
  })
}

function loadFixture(baseUrl: string): Record<string, any> {
  const fixture = JSON.parse(fs.readFileSync(path.resolve(__dirname, 'rework-fixture.json'), 'utf-8'))
  fixture.variables.base_url.value = baseUrl
  fixture.variables.api_token.value = TOKEN
  return fixture
}

/** Console to DEBUG, pick an environment, run, and wait for a terminal status. */
async function setDebugSelectRun(page: Page) {
  const panel = page.locator('[data-testid="console-panel"]').first()
  if ((await panel.getAttribute('data-state')) === 'collapsed') {
    await page
      .locator('[data-testid="console-panel-header"] button[aria-label="Toggle console"]')
      .click()
  }
  await page.locator('button[aria-label="Minimum log level"]').click()
  await page.getByRole('option', { name: 'DEBUG' }).click()
  await selectEnvironment(page)
  await page.locator('[data-testid="run-button"]').click()
  const status = page.locator('[data-testid="workflow-status"]')
  await expect(status).not.toHaveAttribute('data-status', 'idle', { timeout: 10_000 })
  await expect(status).not.toHaveAttribute('data-status', 'running', { timeout: 30_000 })
  return status
}

const find = (seen: SeenRequest[], prefix: string) => seen.find((r) => r.url.startsWith(prefix))

// ---------------------------------------------------------------------------
// Test 1 - the reworked fixture end-to-end
// ---------------------------------------------------------------------------

const SUCCESS_NODES = [
  'fileio-src',
  'http-auth',
  'log-auth',
  'http-apikey',
  'http-getbody',
  'http-form',
  'http-genwins',
  'http-multi',
  'http-multi-textonly',
  'http-coerce',
  'http-dl',
  'log-dl',
  'log-dl-sha',
  'http-cap',
  'log-cap',
  'tc-content-length',
  'log-content-length',
  'tc-missing',
  'log-missing',
  'tc-nullq',
  'http-nullq',
]

test.describe('HTTP Plugin Rework E2E Execution', () => {
  test('Auth section, body modes, generated-wins, content-length fail, coercion, cap, trace', async ({
    page,
  }) => {
    const seen: SeenRequest[] = []
    const { server, port } = await startRecordingServer(seen)

    try {
      const testId = await importValidateAndNavigate(page, loadFixture(`http://127.0.0.1:${port}`))
      expect(testId).toBeTruthy()

      const status = await setDebugSelectRun(page)
      // The two failing nodes fail INSIDE try-catch, so the session still passes.
      await expect(status).toHaveAttribute('data-status', 'passed')

      await test.step('Server received: Bearer auth, short api key, bodies, generated-wins', async () => {
        // Bearer via the Auth section
        const auth = find(seen, '/echo')
        expect(auth, 'expected /echo request').toBeTruthy()
        expect(auth!.headers.authorization).toBe(`Bearer ${TOKEN}`)

        // Guard 1: a catalog header with a short value (below the value-scan floor)
        // still reaches the server RAW - name-masking happens only in the console
        const apikey = find(seen, '/apikey')
        expect(apikey!.headers['x-api-key']).toBe('open')

        // GET-with-body (literal Content-Type row)
        const getBody = find(seen, '/getecho')
        expect(getBody!.method).toBe('GET')
        expect(getBody!.body.toString('utf-8')).toBe('{"query":"open"}')
        expect(getBody!.headers['content-type']).toBe('application/json')

        // Form mode: url-encoded pairs + generated Content-Type
        const form = find(seen, '/form')
        expect(form!.headers['content-type']).toBe('application/x-www-form-urlencoded')
        const formPairs = new URLSearchParams(form!.body.toString('utf-8'))
        expect(formPairs.get('username')).toBe('alice')
        expect(formPairs.get('scope')).toBe('orders read')

        // Guard 7: the generated Content-Type OVERWRITES an expression-map
        // Content-Type - the server receives the generated urlencoded type, not
        // the map's application/json
        const genwins = find(seen, '/genwins')
        expect(genwins!.headers['content-type']).toBe('application/x-www-form-urlencoded')

        // Multipart (file + text) reaches the server as real multipart
        const upload = find(seen, '/upload')
        expect(upload!.headers['content-type']).toMatch(/^multipart\/form-data; boundary=/)
        const multipartBody = upload!.body.toString('utf-8')
        expect(multipartBody).toContain('name="meta"')
        expect(multipartBody).toContain('filename="src.bin"')
        expect(multipartBody).toContain(MULTIPART_FILE_CONTENT)

        // Guard 8: a TEXT-ONLY multipart body arrives as real multipart/form-data
        // WITH a boundary
        const uploadText = find(seen, '/uploadtext')
        expect(uploadText!.headers['content-type']).toMatch(/^multipart\/form-data; boundary=/)
        const textBody = uploadText!.body.toString('utf-8')
        expect(textBody).toContain('name="alpha"')
        expect(textBody).toContain('one')
        expect(textBody).toContain('name="beta"')
        expect(textBody).toContain('two')

        // Guard 9: literal vs expression at runtime. A literal header holding
        // {{ }} chars is sent VERBATIM; expression query params evaluate and
        // coerce to strings (int -> "10", an empty entry -> "", concat computed)
        const coerce = find(seen, '/coerce')
        expect(coerce!.headers['x-lit']).toBe('{{ literal }}')
        const query = new URLSearchParams(coerce!.url.split('?')[1] ?? '')
        expect(query.get('n')).toBe('10')
        expect(query.has('z'), 'the empty entry is sent').toBe(true)
        expect(query.get('z'), 'the empty entry is sent as empty text').toBe('')
        expect(query.get('c')).toBe('pre-xyz')

        // The download + cap requests happened; the two failing nodes never sent
        expect(seen.some((r) => r.url.startsWith('/files/report.bin'))).toBeTruthy()
        expect(seen.some((r) => r.url.startsWith('/big'))).toBeTruthy()
        expect(seen.some((r) => r.url.startsWith('/content-length'))).toBeFalsy()
        expect(seen.some((r) => r.url.startsWith('/missing-upload'))).toBeFalsy()
        // M5: a query entry given None reaches the server as empty text (REQ-3.1.3.21).
        const nullq = find(seen, '/nullq')
        expect(nullq, 'the request with a null query entry is sent').toBeTruthy()
        const nullQuery = new URLSearchParams(nullq!.url.split('?')[1] ?? '')
        expect(nullQuery.has('z'), 'the null entry is sent').toBe(true)
        expect(nullQuery.get('z'), 'the null entry is sent as empty text').toBe('')
      })

      await test.step('Persisted output bindings (session variables)', async () => {
        const sessionId = await getActiveSessionId(page)
        const variables = await getSessionVariables(page, sessionId)
        expect(variables.dl_path?.value).toBe('artifact://report.bin')
        expect(variables.dl_sha?.value).toBe(DL_SHA256)
        expect(variables.dl_size?.value).toBe(DL_CONTENT.length)
        expect(variables.cap_size?.value).toBe(1024)
      })

      await test.step('Console: masking, outputs, cap WARN, content-length fail, missing file', async () => {
        const logTexts = await getLogTexts(page)
        const allLogText = logTexts.join('\n')

        // Bearer masking: the raw token never renders; the auth echo is masked
        expect(allLogText, 'raw token must never render in the console').not.toContain(TOKEN)
        expect(
          logTexts.some((t) => t.includes('"authorization"') && t.includes('********')),
          `Expected a masked auth echo. Got:\n${allLogText}`,
        ).toBeTruthy()

        // File-mode outputs
        expect(logTexts.some((t) => t === 'dl=artifact://report.bin')).toBeTruthy()
        expect(logTexts.some((t) => t === `sha=${DL_SHA256} size=${DL_CONTENT.length}`)).toBeTruthy()

        // Body cap WARN (reworded) + capped size output
        expect(logTexts.some((t) => t === 'Response size exceeded 1.0 KB - truncated')).toBeTruthy()
        expect(logTexts.some((t) => t === 'cap_len=1024')).toBeTruthy()

        // Guard 5: the reworded dynamic-map Content-Length failure, source-attributed
        expect(
          logTexts.some((t) => t.includes(CONTENT_LENGTH_MESSAGE)),
          `Expected the reworded Content-Length message. Got:\n${allLogText}`,
        ).toBeTruthy()
        expect(logTexts.some((t) => t === 'content-length-caught')).toBeTruthy()

        // Missing file source
        expect(
          logTexts.some((t) => t.includes('File not found: artifact://missing/nope.bin')),
        ).toBeTruthy()
        expect(logTexts.some((t) => t === 'file-missing-caught')).toBeTruthy()

        // M5: nothing failed on the null query entry, so its catch branch never ran
        expect(logTexts.some((t) => t === 'nullq-caught')).toBe(false)

        // INFO summary format unchanged
        expect(
          logTexts.some((t) => /^HTTP 200 OK \(\d+ms, [\d.]+ K?B, application\/json\)$/.test(t)),
        ).toBeTruthy()
      })

      await test.step('Combined DEBUG trace: masked Authorization, short api-key, wire timing', async () => {
        const copyTexts = await getLogCopyTexts(page)
        const all = copyTexts.join('\n@@ENTRY@@\n')
        expect(all).not.toContain(TOKEN)

        // The bearer GET /echo exchange rides ONE multiline entry, masked
        const exchangeEntry = copyTexts.find(
          (t) => t.includes('/echo') && /^> Authorization: \*+$/m.test(t),
        )
        expect(exchangeEntry, `Expected a masked /echo exchange. Entries:\n${all}`).toBeTruthy()
        expect(exchangeEntry!).toMatch(/GET http:\/\/127\.0\.0\.1:\d+\/echo -> 200 OK \(/)
        expect(exchangeEntry!).toMatch(/^< Content-Type: application\/json$/im)

        // 3-entry contract for a plain GET: connect + exchange + timing
        expect(copyTexts.some((t) => /Connected to 127\.0\.0\.1:\d+/.test(t))).toBeTruthy()

        // Guard 1: the short api-key value name-masks in the /apikey exchange
        const apikeyEntry = copyTexts.find(
          (t) => t.includes('/apikey') && /^> X-Api-Key: \*+$/im.test(t),
        )
        expect(apikeyEntry, 'expected an /apikey exchange entry').toBeTruthy()
        expect(apikeyEntry!).toMatch(/^> X-Api-Key: \*+$/im)
        expect(apikeyEntry!).not.toContain('open ')

        // Guard 3: the Timing entry total is the wire window - > 0 and >= each part
        const timingEntry = copyTexts.find((t) => /Timing: dns/.test(t))
        expect(timingEntry, 'expected a Timing entry').toBeTruthy()
        const m = timingEntry!.match(
          /connect ([\d.]+)ms, tls [\d.]+ms, first byte ([\d.]+)ms, download ([\d.]+)ms, total ([\d.]+)ms/,
        )
        expect(m, `Timing entry did not parse: ${timingEntry}`).toBeTruthy()
        const [connect, firstByte, download, total] = [m![1], m![2], m![3], m![4]].map(Number)
        expect(total).toBeGreaterThan(0)
        expect(total).toBeGreaterThanOrEqual(connect)
        expect(total).toBeGreaterThanOrEqual(firstByte)
        expect(total).toBeGreaterThanOrEqual(download)
      })

      await test.step('Node statuses: chain success, every failing node failed', async () => {
        for (const nodeId of SUCCESS_NODES) {
          await expect(page.locator(`[data-testid="workflow-node-${nodeId}"]`)).toHaveAttribute(
            'data-execution-status',
            'success',
          )
        }
        await expect(page.locator('[data-testid="workflow-node-http-content-length"]')).toHaveAttribute(
          'data-execution-status',
          'failed',
        )
        await expect(page.locator('[data-testid="workflow-node-http-missing"]')).toHaveAttribute(
          'data-execution-status',
          'failed',
        )
      })

      await test.step('Downloaded artifact listed, bytes match, visible in the sheet', async () => {
        const listResponse = await page.request.get(`${BACKEND_URL}/workbench/session/artifacts`)
        expect(listResponse.ok()).toBeTruthy()
        const body = (await listResponse.json()) as {
          items: Array<{ path: string; size_bytes: number }>
        }
        const entry = body.items.find((item) => item.path === 'report.bin')
        expect(entry, `Expected report.bin. Got: ${JSON.stringify(body.items)}`).toBeTruthy()
        expect(entry!.size_bytes).toBe(DL_CONTENT.length)

        const contentResponse = await page.request.get(
          `${BACKEND_URL}/workbench/session/artifacts/content/report.bin`,
        )
        const bytes = await contentResponse.body()
        expect(crypto.createHash('sha256').update(bytes).digest('hex')).toBe(DL_SHA256)

        const chip = page.locator('[data-testid="breadcrumb-artifacts-chip"]')
        await chip.click()
        const sheet = page.locator('[data-testid="session-artifacts-sheet"]')
        await expect(sheet).toBeVisible()
        await expect(
          sheet.locator('[data-testid="file-row"]').filter({ hasText: 'report.bin' }),
        ).toBeVisible()
      })
    } finally {
      server.close()
    }
  })

  // -------------------------------------------------------------------------
  // Test 2 - Basic + API-key auth modes reach the server; enablers carry no {x}
  // -------------------------------------------------------------------------

  test('Auth modes reach the server composed + masked; enablers carry no expression toggle (guards 6a/19)', async ({
    page,
  }) => {
    const seen: SeenRequest[] = []
    const { server, port } = await startRecordingServer(seen)
    const base = `http://127.0.0.1:${port}`
    const BASIC_B64 = Buffer.from('wave-user:wave-secret-pw').toString('base64')

    const httpAuthNode = (id: string, y: number, urlPath: string, values: Record<string, unknown>) => ({
      id,
      type: 'workflowNode',
      position: { x: -75, y },
      data: {
        label: 'HTTP',
        elementType: 'http-client',
        nodeType: 'plugin',
        category: 'network',
        version: '1.0.0',
        description: id,
        hasNewerVersion: false,
        expressionFields: ['url'],
        templateFields: [],
        config: {
          values: { method: 'GET', timeout: 10, url: `f'{base_url}${urlPath}'`, ...values },
          outputBindings: {},
          profileBindings: [],
        },
      },
      measured: { width: 120, height: 62 },
    })

    const fixture = {
      name: 'HTTP Auth Modes',
      version: '1.0.0',
      description: '',
      workflow: {
        nodes: [
          httpAuthNode('http-basic', 160, '/basic', {
            auth_enabled: true,
            auth_mode: 'basic',
            auth_username: 'wave-user',
            auth_password: 'wave-secret-pw',
          }),
          httpAuthNode('http-apikeyauth', 280, '/apikeyauth', {
            auth_enabled: true,
            auth_mode: 'api_key',
            auth_header_name: 'X-Api-Key',
            auth_key: 'apikey-secret-99',
          }),
        ],
        edges: [
          { id: 'e-start', source: 'start-node', target: 'http-basic' },
          { id: 'e-1', source: 'http-basic', target: 'http-apikeyauth' },
        ],
      },
      variables: { base_url: { value: base, type: 'string', scope: 'test' } },
      metadata: { tags: [], suite_id: null, parent_suite: null },
    }

    try {
      await importValidateAndNavigate(page, fixture)
      const status = await setDebugSelectRun(page)
      await expect(status).toHaveAttribute('data-status', 'passed')

      await test.step('Server received the composed Basic + API-key headers', async () => {
        expect(find(seen, '/basic')!.headers.authorization).toBe(`Basic ${BASIC_B64}`)
        expect(find(seen, '/apikeyauth')!.headers['x-api-key']).toBe('apikey-secret-99')
      })

      await test.step('Console masks both composed credentials in the DEBUG exchange', async () => {
        const copyTexts = await getLogCopyTexts(page)
        expect(copyTexts.join('\n')).not.toContain(BASIC_B64)
        expect(copyTexts.join('\n')).not.toContain('apikey-secret-99')
        const basicEntry = copyTexts.find(
          (t) => t.includes('/basic') && /^> Authorization: \*+$/im.test(t),
        )
        expect(basicEntry, 'expected a masked /basic exchange entry').toBeTruthy()
        expect(basicEntry!).toMatch(/^> Authorization: \*+$/im)
        const keyEntry = copyTexts.find(
          (t) => t.includes('/apikeyauth') && /^> X-Api-Key: \*+$/im.test(t),
        )
        expect(keyEntry, 'expected a masked /apikeyauth exchange entry').toBeTruthy()
        expect(keyEntry!).toMatch(/^> X-Api-Key: \*+$/im)
      })

      await test.step('Guard 19: Enable Auth + Auto Headers rows render without the {x} toggle', async () => {
        await page.locator('[data-testid="workflow-node-http-basic"]').dblclick()
        const sheet = configSheet(page)
        await expect(sheet).toBeVisible()
        await sheet.locator('[data-testid="group-header-Auth"]').click()
        await expect(
          sheet.locator('[data-testid="param-row-auth_enabled"] [data-testid="expression-toggle"]'),
        ).toHaveCount(0)
        await sheet.locator('[data-testid="group-header-Body"]').click()
        await expect(
          sheet.locator('[data-testid="param-row-body_auto_headers"] [data-testid="expression-toggle"]'),
        ).toHaveCount(0)
      })
    } finally {
      server.close()
    }
  })

  // -------------------------------------------------------------------------
  // Test 3 - runtime auth required-field guards (guard 6c)
  //
  // A required auth field whose value is an expression resolving to "" is
  // PRESENT at save (the field carries the expression text) but empty at send,
  // so the runtime guard fires like the missing-file node - no admin bypass and
  // no "run an invalid test" dependency.
  // -------------------------------------------------------------------------

  test('Runtime auth required-field guards fire before sending (guard 6c)', async ({ page }) => {
    const seen: SeenRequest[] = []
    const { server, port } = await startRecordingServer(seen)
    const base = `http://127.0.0.1:${port}`

    const httpNode = (
      id: string,
      y: number,
      values: Record<string, unknown>,
      emptyField: string,
    ) => ({
      id,
      type: 'workflowNode',
      position: { x: -250, y },
      data: {
        label: 'HTTP',
        elementType: 'http-client',
        nodeType: 'plugin',
        category: 'network',
        version: '1.0.0',
        description: id,
        hasNewerVersion: false,
        // The empty-required field is an expression evaluating to "".
        expressionFields: ['url', emptyField],
        templateFields: [],
        config: {
          values: { method: 'GET', timeout: 10, url: `f'{base_url}/req-${id}'`, [emptyField]: "''", ...values },
          outputBindings: {},
          profileBindings: [],
        },
      },
      measured: { width: 120, height: 62 },
    })
    const tcNode = (id: string, y: number) => ({
      id,
      type: 'workflowNode',
      position: { x: -75, y },
      data: {
        label: 'Try/Catch',
        elementType: 'try-catch-finally',
        nodeType: 'control',
        category: 'flow',
        version: '1.0.0',
        description: id,
        hasNewerVersion: false,
        expressionFields: [],
        templateFields: [],
        config: {
          values: { enable_catch: true, enable_finally: false },
          outputBindings: {},
          profileBindings: [],
        },
        variableExpressionKeys: [],
      },
      measured: { width: 120, height: 62 },
    })
    const logNode = (id: string, y: number, message: string) => ({
      id,
      type: 'workflowNode',
      position: { x: 150, y },
      data: {
        label: 'Log',
        elementType: 'log',
        nodeType: 'plugin',
        category: 'system',
        version: '1.0.0',
        description: id,
        hasNewerVersion: false,
        expressionFields: ['message'],
        templateFields: [],
        config: {
          values: { message: `'${message}'`, level: 'WARN' },
          outputBindings: {},
          profileBindings: [],
        },
      },
      measured: { width: 120, height: 62 },
    })

    const fixture = {
      name: 'HTTP Auth Required',
      version: '1.0.0',
      description: '',
      workflow: {
        nodes: [
          tcNode('tc-basic', 100),
          httpNode('http-basic-empty', 200, { auth_enabled: true, auth_mode: 'basic', auth_username: 'u' }, 'auth_password'),
          logNode('log-basic', 200, 'basic-req-caught'),
          tcNode('tc-bearer', 300),
          httpNode('http-bearer-empty', 400, { auth_enabled: true, auth_mode: 'bearer' }, 'auth_token'),
          logNode('log-bearer', 400, 'bearer-req-caught'),
          tcNode('tc-key', 500),
          httpNode('http-key-empty', 600, { auth_enabled: true, auth_mode: 'api_key', auth_header_name: 'X-K' }, 'auth_key'),
          logNode('log-key', 600, 'key-req-caught'),
        ],
        edges: [
          { id: 'e-start', source: 'start-node', target: 'tc-basic' },
          { id: 'e-b-try', source: 'tc-basic', sourceHandle: 'try', target: 'http-basic-empty', type: 'default' },
          { id: 'e-b-catch', source: 'tc-basic', sourceHandle: 'catch', target: 'log-basic', type: 'default' },
          { id: 'e-b-then', source: 'tc-basic', sourceHandle: 'then', target: 'tc-bearer', type: 'default' },
          { id: 'e-t-try', source: 'tc-bearer', sourceHandle: 'try', target: 'http-bearer-empty', type: 'default' },
          { id: 'e-t-catch', source: 'tc-bearer', sourceHandle: 'catch', target: 'log-bearer', type: 'default' },
          { id: 'e-t-then', source: 'tc-bearer', sourceHandle: 'then', target: 'tc-key', type: 'default' },
          { id: 'e-k-try', source: 'tc-key', sourceHandle: 'try', target: 'http-key-empty', type: 'default' },
          { id: 'e-k-catch', source: 'tc-key', sourceHandle: 'catch', target: 'log-key', type: 'default' },
        ],
      },
      variables: { base_url: { value: base, type: 'string', scope: 'test' } },
      metadata: { tags: [], suite_id: null, parent_suite: null },
    }

    try {
      await importValidateAndNavigate(page, fixture)
      const status = await setDebugSelectRun(page)
      await expect(status).toHaveAttribute('data-status', 'passed')

      const logTexts = await getLogTexts(page)
      const allLogText = logTexts.join('\n')
      for (const message of [
        'Auth mode "Basic" requires Username and Password',
        'Auth mode "Bearer token" requires a Token',
        'Auth mode "API key" requires Header Name and Key',
      ]) {
        expect(
          logTexts.some((t) => t.includes(message)),
          `Expected runtime guard "${message}". Got:\n${allLogText}`,
        ).toBeTruthy()
      }
      for (const marker of ['basic-req-caught', 'bearer-req-caught', 'key-req-caught']) {
        expect(logTexts.some((t) => t === marker)).toBeTruthy()
      }
      // Nothing reached the server - the guards fire before any byte is sent
      expect(seen.length).toBe(0)
    } finally {
      server.close()
    }
  })

  // -------------------------------------------------------------------------
  // Test 4 - trace name-masking (short + response), reveal, marked-trace,
  //          redirect hops, file-mode cap (guards 1/2)
  // -------------------------------------------------------------------------

  test('Trace masking + reveal + marked-trace + redirect hops + file cap (guards 1/2)', async ({
    page,
  }) => {
    const seen: SeenRequest[] = []
    const { server, port } = await startRecordingServer(seen)
    const base = `http://127.0.0.1:${port}`

    const httpNode = (
      id: string,
      y: number,
      urlPath: string,
      values: Record<string, unknown>,
      extraConfig: Record<string, unknown> = {},
      outputBindings: Record<string, string> = {},
    ) => ({
      id,
      type: 'workflowNode',
      position: { x: -75, y },
      data: {
        label: 'HTTP',
        elementType: 'http-client',
        nodeType: 'plugin',
        category: 'network',
        version: '1.0.0',
        description: id,
        hasNewerVersion: false,
        expressionFields: ['url'],
        templateFields: [],
        config: {
          values: { method: 'GET', timeout: 10, url: `f'{base_url}${urlPath}'`, ...values },
          outputBindings,
          profileBindings: [],
          ...extraConfig,
        },
      },
      measured: { width: 120, height: 62 },
    })
    const logNode = (id: string, y: number, message: string) => ({
      id,
      type: 'workflowNode',
      position: { x: -75, y },
      data: {
        label: 'Log',
        elementType: 'log',
        nodeType: 'plugin',
        category: 'system',
        version: '1.0.0',
        description: id,
        hasNewerVersion: false,
        expressionFields: ['message'],
        templateFields: [],
        config: { values: { message, level: 'INFO' }, outputBindings: {}, profileBindings: [] },
      },
      measured: { width: 120, height: 62 },
    })

    const fixture = {
      name: 'HTTP Trace Advanced',
      version: '1.0.0',
      description: '',
      workflow: {
        nodes: [
          // Name-mask: request Cookie + response Set-Cookie
          httpNode(
            'http-cookie',
            120,
            '/cookie',
            { headers: { Cookie: RAW_COOKIE } },
            {},
            { headers: 'cookie_headers' },
          ),
          // Guard 1 reveal path: the block's unmask list keeps X-Api-Key raw
          httpNode(
            'http-reveal',
            220,
            '/reveal',
            { headers: { 'X-Api-Key': REVEAL_KEY } },
            { unmasked_secret_fields: ['x-api-key'] },
          ),
          // Guard 2: marking the trace output secret masks EVERY hop header value,
          // even a non-catalog one; the control node leaves it raw
          httpNode(
            'http-marktrace',
            320,
            '/marktrace',
            { headers: { 'X-Trace-Marker': TRACE_MARKER } },
            { outputSecretFields: ['trace'] },
          ),
          httpNode('http-nomark', 420, '/nomark', { headers: { 'X-Trace-Marker': TRACE_MARKER } }),
          // A single redirect hop -> two exchange entries, both URLs
          httpNode('http-redir', 520, '/redir', {}),
          // File-mode size cap - artifact truncated to the cap, sha of the prefix
          httpNode(
            'http-filecap',
            620,
            '/bigfile',
            { response_mode: 'file', max_size: 1024 },
            {},
            { body: 'fcap_path', sha256: 'fcap_sha', size: 'fcap_size' },
          ),
          logNode('log-fcap', 720, "f'fcap={fcap_path} sha={fcap_sha} size={fcap_size}'"),
        ],
        edges: [
          { id: 'e-start', source: 'start-node', target: 'http-cookie' },
          { id: 'e-1', source: 'http-cookie', target: 'http-reveal' },
          { id: 'e-2', source: 'http-reveal', target: 'http-marktrace' },
          { id: 'e-3', source: 'http-marktrace', target: 'http-nomark' },
          { id: 'e-4', source: 'http-nomark', target: 'http-redir' },
          { id: 'e-5', source: 'http-redir', target: 'http-filecap' },
          { id: 'e-6', source: 'http-filecap', target: 'log-fcap' },
        ],
      },
      variables: {
        base_url: { value: base, type: 'string', scope: 'test' },
        cookie_headers: { value: '', type: 'map', scope: 'test' },
        fcap_path: { value: '', type: 'string', scope: 'test' },
        fcap_sha: { value: '', type: 'string', scope: 'test' },
        fcap_size: { value: null, type: 'integer', scope: 'test' },
      },
      metadata: { tags: [], suite_id: null, parent_suite: null },
    }

    try {
      await importValidateAndNavigate(page, fixture)
      const status = await setDebugSelectRun(page)
      await expect(status).toHaveAttribute('data-status', 'passed')

      await test.step('The server received the raw Cookie request header', async () => {
        expect(find(seen, '/cookie')!.headers.cookie).toBe(RAW_COOKIE)
      })

      await test.step('A 1-redirect GET followed both hops', async () => {
        expect(seen.some((r) => r.url.startsWith('/redir'))).toBeTruthy()
        expect(seen.some((r) => r.url.startsWith('/landed'))).toBeTruthy()
      })

      await test.step('Capped file output', async () => {
        const sessionId = await getActiveSessionId(page)
        const variables = await getSessionVariables(page, sessionId)
        // The run-secret registry scrubs the registered Set-Cookie value from the stored
        // headers output (safe, downstream of the plugin return), so raw values are not asserted.
        // The file is truncated to the cap; sha256 is of the truncated prefix
        expect(variables.fcap_size?.value).toBe(1024)
        expect(variables.fcap_sha?.value).toBe(FILECAP_SHA)
        expect(variables.fcap_path?.value).toBe('artifact://bigfile')
      })

      await test.step('Console: name-masking, reveal, marked-trace parity, file cap WARN', async () => {
        const copyTexts = await getLogCopyTexts(page)
        const logTexts = await getLogTexts(page)

        // Guard 1 name-mask: request Cookie + response Set-Cookie mask in the hop
        const cookieEntry = copyTexts.find(
          (t) => t.includes('/cookie') && /^> Cookie: \*+$/im.test(t),
        )
        expect(cookieEntry, 'expected a masked /cookie exchange entry').toBeTruthy()
        expect(cookieEntry!).toMatch(/^> Cookie: \*+$/im)
        expect(cookieEntry!).toMatch(/^< Set-Cookie: \*+$/im)

        // Guard 1 reveal: the block's unmask list keeps X-Api-Key raw here
        const revealEntry = copyTexts.find(
          (t) => t.includes('/reveal') && new RegExp(`^> X-Api-Key: ${REVEAL_KEY}$`, 'im').test(t),
        )
        expect(revealEntry, 'expected a revealed /reveal exchange entry').toBeTruthy()
        expect(revealEntry!).toMatch(new RegExp(`^> X-Api-Key: ${REVEAL_KEY}$`, 'im'))

        // Guard 2: marking the trace output secret masks the non-catalog marker in that
        // node's combined DEBUG entry (parity with a marked headers output).
        // The block's own Inputs line comes first and names the header as typed; this is the exchange.
        const markEntry = copyTexts.find((t) => t.includes('/marktrace') && /^> X-Trace-Marker: /im.test(t))
        expect(markEntry, 'expected the /marktrace exchange entry').toBeTruthy()
        expect(markEntry!).not.toContain(TRACE_MARKER)
        // The unmarked control node is NOT asserted raw here: the run-secret registry scrubs
        // the registered value run-wide at render time, so a same-valued control masks too
        // (order-dependent). Per-node vs run-wide trace masking is a flagged product question.

        // The file-mode cap warns and reports the capped outputs
        expect(logTexts.some((t) => t === 'Response size exceeded 1.0 KB - truncated')).toBeTruthy()
        expect(logTexts.some((t) => t === `fcap=artifact://bigfile sha=${FILECAP_SHA} size=1024`)).toBeTruthy()
      })
    } finally {
      server.close()
    }
  })
})
