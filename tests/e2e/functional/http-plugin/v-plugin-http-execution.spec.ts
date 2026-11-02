/**
 * HTTP Plugin End-to-End Execution Test
 *
 * Imports a pre-built workflow fixture with 55 nodes, then runs it to exercise
 * ALL HTTP plugin parameters, all output variables, and all HTTP methods.
 * Fail cases are wrapped in try-catch blocks to verify error handling.
 *
 * HTTPS endpoints ride the published http-echo stack service (127.0.0.1:9449,
 * rewritten to the shard gateway in container mode via injectHttp).
 *
 * Success nodes:
 *   - HTTP GET to backend /health (default params)
 *   - HTTP POST with body + headers to http-echo /echo
 *   - HTTP PUT with body + query_params to http-echo /echo
 *   - HTTP DELETE /echo with body (captures headers output)
 *   - HTTP PATCH /echo with body
 *   - HTTP HEAD /health (captures content_type output)
 *   - HTTP OPTIONS /echo
 *   - HTTP GET redirect chain (allow_redirects=true default, max_redirects=10 default)
 *   - HTTP GET no redirect (allow_redirects=false)
 *   - HTTP GET custom max redirects (max_redirects=3)
 *   - HTTP GET retry with default codes (fail_count=2, retry_count=3)
 *   - HTTP GET retry with custom codes (fail_status=429, retryable_status_codes=["429"])
 *   - HTTP GET delay/timeout (1s delay, 5s timeout)
 *   - HTTPS verify_ssl=false
 *   - HTTPS verify_ssl=true with CA cert PEM
 *   - HTTP timeout arm + retry through timeout (2s timeout, 1 retry)
 *   - HTTP GET /status/404 (non-2xx as successful response)
 *   - HTTP GET /status/500 (server error as successful response)
 *   - HTTP POST with multiple headers (Content-Type, X-Request-ID, X-Custom-Auth)
 *   - HTTP GET with multiple query_params (foo, baz, num)
 *   - HTTP GET /redirect-to?url=/health (single redirect via redirect-to endpoint)
 *
 * Fail nodes (4, wrapped in try-catch - error caught and logged):
 *   - HTTP max_redirects=1 on 3-redirect chain (too many redirects)
 *   - HTTPS without CA cert (verify_ssl=true, SSL fails)
 *   - HTTP timeout with no retry (timeout=1s, delay=10s, retry_count=0)
 *   - HTTP connection refused (localhost:19999, no server)
 *
 * V-HTTP-CONTENT-TYPE (REQ-3.4.3.10): a second Test, built in this spec, posts two
 * Test Data files as file bodies with Type Auto to http-echo /echo.
 *
 * Pass Criteria (V-HTTP-CONTENT-TYPE):
 * 1. The built Test validates clean once its two files are uploaded, and the run passes
 * 2. http-echo received the `.yaml` file with Content-Type `application/yaml`
 * 3. http-echo received the `.xlsx` file with Content-Type
 *    `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`
 * 4. Each request was a POST whose body is the uploaded file's own content
 *
 * Run manually with: ./scripts/e2e-targeted-local.sh functional/http-plugin/v-plugin-http-execution.spec.ts
 */

import { test, expect, type Page } from '../../helpers/playwright-fixtures'
import { getLogTexts, getLogLines } from '../../helpers/log-reader'
import {
  getActiveSessionId,
  getSessionVariables,
  importValidateAndNavigate,
  sessionValue,
} from '../../helpers/fixture-import'
import {
  BACKEND_PORT,
  BACKEND_URL,
  CA_CERT_PEM,
  E2E_ENV_NAME,
  HTTP_MAIN_PORT,
  HTTP_TARGET_HOST,
  ensureEnvironment,
} from '../../helpers/config'
import { createValidTest, openTest, releaseWorkbenchOwnership, validateTest } from '../../helpers/fn-seed'
import { chainEdges, markerNode, pluginNode, stackNodes } from '../../helpers/k8s-nodes'
import { expectNodesSuccess, finishRun, startRun } from '../../helpers/k8s-run'
import { uploadTestData } from '../../helpers/testdata'
import fs from 'fs'
import path from 'path'

// ---------------------------------------------------------------------------
// Fixture loading
// ---------------------------------------------------------------------------

function loadFixture(): Record<string, any> {
  const fixture = JSON.parse(fs.readFileSync(path.resolve(__dirname, 'fixture.json'), 'utf-8'))
  // Override variable defaults with runtime config
  fixture.variables.backend_port.value = parseInt(BACKEND_PORT, 10)
  // Per-run key: the /retry and /timeout endpoints hold per-key state on the shared http-echo service
  fixture.variables.run_key.value = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  fixture.variables.ca_cert_pem.value = CA_CERT_PEM
  return fixture
}

// ---------------------------------------------------------------------------
// Node name mapping
// ---------------------------------------------------------------------------

type NodeName =
  | 'HTTP_GET' | 'LOG_GET'
  | 'HTTP_POST' | 'LOG_POST'
  | 'HTTP_PUT' | 'LOG_PUT'
  | 'HTTP_DELETE' | 'LOG_DELETE'
  | 'HTTP_PATCH' | 'LOG_PATCH'
  | 'HTTP_HEAD' | 'LOG_HEAD'
  | 'HTTP_OPTIONS' | 'LOG_OPTIONS'
  | 'HTTP_REDIRECT' | 'LOG_REDIRECT'
  | 'HTTP_NO_REDIRECT' | 'LOG_NO_REDIRECT'
  | 'HTTP_CUSTOM_MAX_REDIRECTS' | 'LOG_CUSTOM_MAX_REDIRECTS'
  | 'HTTP_RETRY' | 'LOG_RETRY'
  | 'HTTP_CUSTOM_RETRY_CODES' | 'LOG_CUSTOM_RETRY_CODES'
  | 'HTTP_DELAY' | 'LOG_DELAY'
  | 'HTTPS_NO_VERIFY' | 'LOG_HTTPS_NO_VERIFY'
  | 'HTTPS_CA_CERT' | 'LOG_HTTPS_CA_CERT'
  | 'HTTP_TIMEOUT_ARM' | 'HTTP_TIMEOUT' | 'LOG_TIMEOUT'
  | 'HTTP_STATUS_404' | 'LOG_STATUS_404'
  | 'HTTP_STATUS_500' | 'LOG_STATUS_500'
  | 'HTTP_MULTI_HEADERS' | 'LOG_MULTI_HEADERS'
  | 'HTTP_MULTI_PARAMS' | 'LOG_MULTI_PARAMS'
  | 'HTTP_REDIRECT_TO' | 'LOG_REDIRECT_TO'
  | 'HTTPS_NO_CA'
  | 'HTTP_MAX_REDIRECTS_FAIL'
  | 'HTTP_TIMEOUT_NO_RETRY'
  | 'HTTP_CONN_REFUSED'
  | 'TC_REDIR' | 'LOG_FAIL_REDIR'
  | 'TC_SSL' | 'LOG_FAIL_SSL'
  | 'TC_TIMEOUT' | 'LOG_FAIL_TIMEOUT'
  | 'TC_CONNREF' | 'LOG_FAIL_CONNREF'

const DESCRIPTION_TO_NODE: Record<string, NodeName> = {
  'GET Health': 'HTTP_GET',
  'Log GET Body': 'LOG_GET',
  'POST Environment': 'HTTP_POST',
  'Log POST Status': 'LOG_POST',
  'PUT Echo + Params': 'HTTP_PUT',
  'Log PUT Body': 'LOG_PUT',
  'DELETE Echo': 'HTTP_DELETE',
  'Log DELETE Headers': 'LOG_DELETE',
  'PATCH Echo': 'HTTP_PATCH',
  'Log PATCH Body': 'LOG_PATCH',
  'HEAD Health': 'HTTP_HEAD',
  'Log HEAD Content-Type': 'LOG_HEAD',
  'OPTIONS Echo': 'HTTP_OPTIONS',
  'Log OPTIONS Body': 'LOG_OPTIONS',
  'GET Redirect Chain': 'HTTP_REDIRECT',
  'Log Final URL': 'LOG_REDIRECT',
  'GET No Redirect': 'HTTP_NO_REDIRECT',
  'Log No Redirect Status': 'LOG_NO_REDIRECT',
  'GET Custom Max Redirects': 'HTTP_CUSTOM_MAX_REDIRECTS',
  'Log Custom Max Redir URL': 'LOG_CUSTOM_MAX_REDIRECTS',
  'GET Retry (2 fails)': 'HTTP_RETRY',
  'Log Retry Body': 'LOG_RETRY',
  'GET Custom Retry Codes': 'HTTP_CUSTOM_RETRY_CODES',
  'Log Custom Retry Body': 'LOG_CUSTOM_RETRY_CODES',
  'GET Delay 1s': 'HTTP_DELAY',
  'Log Response Time': 'LOG_DELAY',
  'HTTPS Skip Verify': 'HTTPS_NO_VERIFY',
  'Log HTTPS Status': 'LOG_HTTPS_NO_VERIFY',
  'HTTPS With CA': 'HTTPS_CA_CERT',
  'Log CA Status': 'LOG_HTTPS_CA_CERT',
  'Arm Timeout': 'HTTP_TIMEOUT_ARM',
  'Timeout + Retry': 'HTTP_TIMEOUT',
  'Log Timeout Body': 'LOG_TIMEOUT',
  'GET Status 404': 'HTTP_STATUS_404',
  'Log Status 404': 'LOG_STATUS_404',
  'GET Status 500': 'HTTP_STATUS_500',
  'Log Status 500': 'LOG_STATUS_500',
  'POST Multi Headers': 'HTTP_MULTI_HEADERS',
  'Log Multi Headers': 'LOG_MULTI_HEADERS',
  'GET Multi Params': 'HTTP_MULTI_PARAMS',
  'Log Multi Params': 'LOG_MULTI_PARAMS',
  'GET Redirect-To': 'HTTP_REDIRECT_TO',
  'Log Redirect-To URL': 'LOG_REDIRECT_TO',
  'HTTPS No CA (Fail)': 'HTTPS_NO_CA',
  'Max Redirects Exceeded (Fail)': 'HTTP_MAX_REDIRECTS_FAIL',
  'Timeout No Retry (Fail)': 'HTTP_TIMEOUT_NO_RETRY',
  'Connection Refused (Fail)': 'HTTP_CONN_REFUSED',
  'TC: redir': 'TC_REDIR',
  'Log redir caught': 'LOG_FAIL_REDIR',
  'TC: ssl': 'TC_SSL',
  'Log ssl caught': 'LOG_FAIL_SSL',
  'TC: timeout': 'TC_TIMEOUT',
  'Log timeout caught': 'LOG_FAIL_TIMEOUT',
  'TC: connref': 'TC_CONNREF',
  'Log connref caught': 'LOG_FAIL_CONNREF',
}

const SUCCESS_NAMES: NodeName[] = [
  'HTTP_GET', 'LOG_GET',
  'HTTP_POST', 'LOG_POST',
  'HTTP_PUT', 'LOG_PUT',
  'HTTP_DELETE', 'LOG_DELETE',
  'HTTP_PATCH', 'LOG_PATCH',
  'HTTP_HEAD', 'LOG_HEAD',
  'HTTP_OPTIONS', 'LOG_OPTIONS',
  'HTTP_REDIRECT', 'LOG_REDIRECT',
  'HTTP_NO_REDIRECT', 'LOG_NO_REDIRECT',
  'HTTP_CUSTOM_MAX_REDIRECTS', 'LOG_CUSTOM_MAX_REDIRECTS',
  'HTTP_RETRY', 'LOG_RETRY',
  'HTTP_CUSTOM_RETRY_CODES', 'LOG_CUSTOM_RETRY_CODES',
  'HTTP_DELAY', 'LOG_DELAY',
  'HTTPS_NO_VERIFY', 'LOG_HTTPS_NO_VERIFY',
  'HTTPS_CA_CERT', 'LOG_HTTPS_CA_CERT',
  'HTTP_TIMEOUT_ARM', 'HTTP_TIMEOUT', 'LOG_TIMEOUT',
  'HTTP_STATUS_404', 'LOG_STATUS_404',
  'HTTP_STATUS_500', 'LOG_STATUS_500',
  'HTTP_MULTI_HEADERS', 'LOG_MULTI_HEADERS',
  'HTTP_MULTI_PARAMS', 'LOG_MULTI_PARAMS',
  'HTTP_REDIRECT_TO', 'LOG_REDIRECT_TO',
  'TC_REDIR', 'TC_SSL', 'TC_TIMEOUT', 'TC_CONNREF',
]

// Fail nodes are wrapped in try-catch - the HTTP node fails, catch-path log executes
const FAIL_CATCH_NAMES: NodeName[] = [
  'LOG_FAIL_REDIR',
  'LOG_FAIL_SSL',
  'LOG_FAIL_TIMEOUT',
  'LOG_FAIL_CONNREF',
]

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildNodeIds(fixture: Record<string, any>): Map<NodeName, string> {
  const nodeIds = new Map<NodeName, string>()
  for (const node of fixture.workflow.nodes) {
    const displayName = node.data?.description
    const nodeName = DESCRIPTION_TO_NODE[displayName]
    if (nodeName) {
      nodeIds.set(nodeName, `workflow-node-${node.id}`)
    }
  }
  return nodeIds
}

async function selectEnvironment(page: Page, envName: string) {
  const envSelector = page.locator('[data-testid="environment-selector"]')
  await envSelector.click()
  const envPopover = page.locator('[data-testid="environment-popover"]')
  await expect(envPopover).toBeVisible()
  await envPopover.locator(`button:has-text("${envName}")`).first().click()
  await expect(envPopover).not.toBeVisible()
}

// ---------------------------------------------------------------------------
// V-HTTP-CONTENT-TYPE
// ---------------------------------------------------------------------------

const ECHO_URL = `https://${HTTP_TARGET_HOST}:${HTTP_MAIN_PORT}/echo`

interface AutoTypeLeg {
  id: string
  file: string
  content: string
  variable: string
  contentType: string
}

/** What http-echo answers on /echo: the request as it arrived. */
interface EchoedRequest {
  method: string
  body?: string
  headers: Record<string, string>
}

/** An HTTP block that posts one Test Data file as its body with Type Auto. */
function fileBodyNode(leg: AutoTypeLeg) {
  return pluginNode({
    id: leg.id,
    label: 'HTTP',
    elementType: 'http-client',
    category: 'network',
    description: `POST ${leg.file}`,
    values: {
      url: ECHO_URL,
      method: 'POST',
      timeout: 15,
      retry_count: 0,
      verify_ssl: false,
      body_mode: 'file',
      file_source: `testdata://${leg.file}`,
      file_content_type: 'auto',
      body_auto_headers: true,
    },
    outputBindings: { body: leg.variable },
  })
}

// ---------------------------------------------------------------------------
// Test
// ---------------------------------------------------------------------------

test.describe('HTTP Plugin E2E Execution', () => {
  test('Import fixture, run success covering all params, methods, and outputs', async ({ page }) => {
    const fixture = loadFixture()
    const nodeIds = buildNodeIds(fixture)

    // Verify all nodes mapped correctly
    const allNames = [...SUCCESS_NAMES, ...FAIL_CATCH_NAMES, 'HTTP_MAX_REDIRECTS_FAIL', 'HTTPS_NO_CA', 'HTTP_TIMEOUT_NO_RETRY', 'HTTP_CONN_REFUSED'] as NodeName[]
    for (const name of allNames) {
      expect(nodeIds.has(name), `Node "${name}" not found in fixture`).toBeTruthy()
    }

    // ================================================================
    // STEP 1: Create environment and import test via API
    // ================================================================
    await test.step('Create environment and import test via API', async () => {
      await importValidateAndNavigate(page, fixture, { injectHttp: true })
    })

    // ================================================================
    // STEP 2: Run - all nodes execute, fail nodes caught by try-catch
    // ================================================================
    await test.step('Select environment and run', async () => {
      await selectEnvironment(page, E2E_ENV_NAME)

      const runButton = page.locator('[data-testid="run-button"]')
      await runButton.click()

      const statusIndicator = page.locator('[data-testid="workflow-status"]')

      // Wait for execution to actually start (async validation + API call before status changes)
      await expect(statusIndicator).not.toHaveAttribute('data-status', 'idle', { timeout: 5_000 })

      // Wait for workflow to finish (passed or failed)
      await expect(statusIndicator).not.toHaveAttribute('data-status', 'running', {
        timeout: 15_000,
      })

      // Diagnostic: if not passed, dump node statuses and console errors
      const status = await statusIndicator.getAttribute('data-status')
      if (status !== 'passed') {
        const nodeStatuses = await page.evaluate(() => {
          const nodes = document.querySelectorAll('[data-testid^="workflow-node-"]')
          return Array.from(nodes).map((n) => ({
            testId: n.getAttribute('data-testid'),
            status: n.getAttribute('data-execution-status'),
            name: n.querySelector('[class*="description"], [class*="name"]')?.textContent
              || n.textContent?.substring(0, 80),
          }))
        })
        const failedNodes = nodeStatuses.filter((n) => n.status === 'failed')
        const errorNodes = nodeStatuses.filter((n) => n.status === 'error')
        const logEntries: string[] = await getLogLines(page)
        const errorLogs = logEntries.filter((e) => e.startsWith('[ERROR]') || e.startsWith('[WARN]'))
        console.log('=== WORKFLOW FAILED ===')
        console.log('Failed nodes:', JSON.stringify(failedNodes, null, 2))
        console.log('Error nodes:', JSON.stringify(errorNodes, null, 2))
        console.log('Error/warn logs:', JSON.stringify(errorLogs, null, 2))
        console.log('All node statuses:', JSON.stringify(nodeStatuses, null, 2))
      }

      expect(status).toBe('passed')
    })

    // ================================================================
    // STEP 3: Verify console output and node statuses
    // ================================================================
    await test.step('Verify console output and node statuses', async () => {
      const logTexts: string[] = await getLogTexts(page)
      const allLogText = logTexts.join('\n')

      // --- Methods ---

      // GET /health -> body contains "status":"healthy"
      expect(
        logTexts.some((t) => t.includes('"status"') && t.includes('"healthy"')),
        `Expected health JSON in logs. Got:\n${allLogText}`
      ).toBeTruthy()

      // POST /echo -> status 200
      expect(
        logTexts.some((t) => t.includes('200')),
        `Expected "200" (POST status) in logs. Got:\n${allLogText}`
      ).toBeTruthy()

      // PUT /echo -> body contains "method":"PUT" and query_params with "env"
      expect(
        logTexts.some((t) => t.includes('"PUT"') && t.includes('"env"')),
        `Expected PUT echo with query_params in logs. Got:\n${allLogText}`
      ).toBeTruthy()

      // DELETE /echo -> headers output is a map (logged as Python dict with title-case keys)
      expect(
        logTexts.some((t) => t.toLowerCase().includes('content-type') && t.toLowerCase().includes('application/json')),
        `Expected response headers map in logs. Got:\n${allLogText}`
      ).toBeTruthy()

      // PATCH /echo -> body contains "method":"PATCH"
      expect(
        logTexts.some((t) => t.includes('"PATCH"')),
        `Expected PATCH echo body in logs. Got:\n${allLogText}`
      ).toBeTruthy()

      // HEAD /health -> content_type is "application/json"
      expect(
        logTexts.some((t) => t.trim() === 'application/json'),
        `Expected "application/json" content_type in logs. Got:\n${allLogText}`
      ).toBeTruthy()

      // OPTIONS /echo -> body contains "method":"OPTIONS"
      expect(
        logTexts.some((t) => t.includes('"OPTIONS"')),
        `Expected OPTIONS echo body in logs. Got:\n${allLogText}`
      ).toBeTruthy()

      // --- Redirects ---

      // Redirect chain -> final_url contains /redirect/0
      expect(
        logTexts.some((t) => t.includes('/redirect/0')),
        `Expected redirect final URL "/redirect/0" in logs. Got:\n${allLogText}`
      ).toBeTruthy()

      // No redirect (allow_redirects=false) -> status 302
      expect(
        logTexts.some((t) => t.includes('302')),
        `Expected "302" (no redirect status) in logs. Got:\n${allLogText}`
      ).toBeTruthy()

      // Custom max redirects (max_redirects=3 on /redirect/2) -> final_url contains /redirect/0
      expect(
        logTexts.filter((t) => t.includes('/redirect/0')).length >= 2,
        `Expected at least two "/redirect/0" entries (default + custom max). Got:\n${allLogText}`
      ).toBeTruthy()

      // Redirect-to -> final_url contains /health (redirected from /redirect-to)
      expect(
        logTexts.some((t) => t.includes('/health') && !t.includes('"status"')),
        `Expected redirect-to final URL containing "/health" in logs. Got:\n${allLogText}`
      ).toBeTruthy()

      // --- Retries ---

      // Retry with default codes -> "Success after retries"
      expect(
        logTexts.some((t) => t.includes('Success after retries')),
        `Expected "Success after retries" in logs. Got:\n${allLogText}`
      ).toBeTruthy()

      // Retry with custom codes (429) -> also "Success after retries"
      expect(
        logTexts.filter((t) => t.includes('Success after retries')).length >= 2,
        `Expected at least two "Success after retries" entries (default + custom codes). Got:\n${allLogText}`
      ).toBeTruthy()

      // --- Timeout ---

      // Delay -> response_time is a number
      expect(
        logTexts.some((t) => /^\d+(\.\d+)?$/.test(t.trim())),
        `Expected numeric response_time in logs. Got:\n${allLogText}`
      ).toBeTruthy()

      // Timeout + retry -> "Timeout test passed"
      expect(
        logTexts.some((t) => t.includes('Timeout test passed')),
        `Expected "Timeout test passed" in logs. Got:\n${allLogText}`
      ).toBeTruthy()

      // --- SSL ---

      // HTTPS statuses (200) from skip-verify and ca-cert nodes
      expect(
        logTexts.filter((t) => t.includes('200')).length >= 2,
        `Expected at least two "200" entries in logs. Got:\n${allLogText}`
      ).toBeTruthy()

      // --- Non-2xx status codes ---

      // GET /status/404 -> status_code logged as 404
      expect(
        logTexts.some((t) => t.includes('404')),
        `Expected "404" status code in logs. Got:\n${allLogText}`
      ).toBeTruthy()

      // GET /status/500 -> status_code logged as 500
      expect(
        logTexts.some((t) => t.includes('500')),
        `Expected "500" status code in logs. Got:\n${allLogText}`
      ).toBeTruthy()

      // --- Multiple headers ---

      // POST /echo with 3 headers -> body echoes all headers
      expect(
        logTexts.some((t) => t.includes('x-request-id') && t.includes('e2e-test-123')),
        `Expected X-Request-ID header in echo body. Got:\n${allLogText}`
      ).toBeTruthy()
      expect(
        logTexts.some((t) => t.includes('x-custom-auth') && t.includes('Bearer test-token')),
        `Expected X-Custom-Auth header in echo body. Got:\n${allLogText}`
      ).toBeTruthy()

      // --- Multiple query params ---

      // GET /echo with 3 params -> body echoes all params
      expect(
        logTexts.some((t) => t.includes('"foo"') && t.includes('"bar"')),
        `Expected foo=bar in echo body. Got:\n${allLogText}`
      ).toBeTruthy()
      expect(
        logTexts.some((t) => t.includes('"baz"') && t.includes('"qux"')),
        `Expected baz=qux in echo body. Got:\n${allLogText}`
      ).toBeTruthy()
      expect(
        logTexts.some((t) => t.includes('"num"') && t.includes('"42"')),
        `Expected num=42 in echo body. Got:\n${allLogText}`
      ).toBeTruthy()

      // --- Node statuses ---

      for (const name of SUCCESS_NAMES) {
        const node = page.locator(`[data-testid="${nodeIds.get(name)}"]`)
        await expect(node).toHaveAttribute('data-execution-status', 'success')
      }

      // --- Fail nodes wrapped in try-catch: catch-path log markers ---

      // Max redirects exceeded -> caught
      expect(
        logTexts.some((t) => t.includes('fail-redir-caught')),
        `Expected "fail-redir-caught" in logs. Got:\n${allLogText}`
      ).toBeTruthy()

      // HTTPS no CA cert -> caught
      expect(
        logTexts.some((t) => t.includes('fail-ssl-caught')),
        `Expected "fail-ssl-caught" in logs. Got:\n${allLogText}`
      ).toBeTruthy()

      // The bundled pure-Python TLS engine raises its own verification message
      // when verify is on with no trusted CA.
      expect(
        allLogText.includes('Certificate verification failed'),
        `Expected the bundled-TLS verification message in logs. Got:\n${allLogText}`
      ).toBeTruthy()

      // Timeout no retry -> caught
      expect(
        logTexts.some((t) => t.includes('fail-timeout-caught')),
        `Expected "fail-timeout-caught" in logs. Got:\n${allLogText}`
      ).toBeTruthy()

      // Connection refused -> caught
      expect(
        logTexts.some((t) => t.includes('fail-connref-caught')),
        `Expected "fail-connref-caught" in logs. Got:\n${allLogText}`
      ).toBeTruthy()

      // Catch-path log nodes should have executed
      for (const name of FAIL_CATCH_NAMES) {
        const node = page.locator(`[data-testid="${nodeIds.get(name)}"]`)
        await expect(node).toHaveAttribute('data-execution-status', 'success')
      }
    })
  })

  test('V-HTTP-CONTENT-TYPE: a file body with Type Auto is sent with the content type of its extension', async ({
    page,
    request,
  }) => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const bookend = `http-content-type-done-${suffix}`
    const legs: AutoTypeLeg[] = [
      {
        id: 'http-auto-yaml',
        file: `settings-${suffix}.yaml`,
        content: `service: wave\nrun: ${suffix}\n`,
        variable: 'yaml_echo',
        contentType: 'application/yaml',
      },
      {
        id: 'http-auto-xlsx',
        file: `report-${suffix}.xlsx`,
        // The type follows the extension, so a marker stands in for a workbook.
        content: `wave-sheet-${suffix}`,
        variable: 'xlsx_echo',
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      },
    ]
    const ids = [...legs.map((leg) => leg.id), 'log-done']

    await ensureEnvironment(request)
    const testId = await createValidTest(request, {
      name: `HTTP Content Type ${suffix}`,
      nodes: stackNodes([
        ...legs.map(fileBodyNode),
        markerNode({ id: 'log-done', description: 'Bookend', text: bookend }),
      ]),
      edges: chainEdges(ids),
      variables: Object.fromEntries(
        legs.map((leg) => [leg.variable, { value: '', type: 'string', scope: 'test' }]),
      ),
    })

    try {
      await test.step('Upload the two files to the Test Data and validate', async () => {
        // Both go up as octet-stream, so the sent type can only come from the extension.
        for (const leg of legs) await uploadTestData(request, testId, '', leg.file, leg.content)
        const validation = await validateTest(request, testId, 'run')
        expect(
          validation.errors,
          `the built Test must validate clean. Got: ${JSON.stringify(validation.errors)}`,
        ).toEqual([])
      })

      await test.step('Run the Test to a pass', async () => {
        await openTest(page, testId)
        const status = await startRun(page)
        await finishRun(page, status, bookend)
        await expectNodesSuccess(page, ids)
      })

      await test.step('http-echo received each file with the content type of its extension', async () => {
        const variables = await getSessionVariables(page, await getActiveSessionId(page))
        for (const leg of legs) {
          const raw = sessionValue(variables, leg.variable)
          const received = (typeof raw === 'string' ? JSON.parse(raw) : raw) as EchoedRequest
          expect(received.method, `method http-echo received for ${leg.file}`).toBe('POST')
          expect(
            received.headers['content-type'],
            `Content-Type http-echo received for ${leg.file}`,
          ).toBe(leg.contentType)
          expect(received.body, `body http-echo received for ${leg.file}`).toBe(leg.content)
        }
      })
    } finally {
      await request.delete(`${BACKEND_URL}/workbench/session`).catch(() => undefined)
      await releaseWorkbenchOwnership(request)
      await request.delete(`${BACKEND_URL}/tests/${testId}`).catch(() => undefined)
    }
  })
})
