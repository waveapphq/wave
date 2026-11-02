/**
 * V-PLUGIN-REMOTE-EXEC-FUNCTIONAL: Remote Execution container mixed-locus body
 *
 * One workflow, one run, exercising the Remote Execution container against the
 * real-service stack (tests/e2e/services/): a real OpenSSH host (`sshd`, :9445)
 * and the internal `http-target` service (unpublished - its DNS name resolves
 * ONLY inside the stack network, never on WAVE). The pushed pure-Python bundle
 * REALLY runs under the host's python3:
 *
 *   open-session  -> the mandatory Execution Host (an open SSH session)
 *   exec-host     -> real `hostname` proves the execution host is wave-e2e-host
 *   container     -> probes python3 (real `python3 --version`), pushes the
 *                    bundle, opens ONE persistent worker, runs the body, binds
 *                    Remote Session ID, tears the worker down
 *     body:
 *       http-in   -> REMOTABLE: routed to the host worker (R). Its URL names
 *                    `http-target`, resolvable only from the host - a local run
 *                    on WAVE could never reach it; the real 200 + real body
 *                    prove the bundle's urllib executed on the host.
 *       json-in   -> NON-remotable: runs locally on WAVE (L), binds its result.
 *       log-in    -> NON-remotable: runs locally on WAVE (L); logs the bound R
 *                    result (real response body) + a masked secret.
 *     then:
 *       log-then      -> the container's Remote Session ID output is bound (hex).
 *       http-outside  -> an HTTP block OUTSIDE any container still runs LOCALLY
 *                        on WAVE (real httpx GET of the backend health endpoint,
 *                        which the sshd host could never reach).
 *
 * REQ: REQ-3.4.1.4 (real-service harness)
 */

import { test, expect, type Page } from '../../helpers/playwright-fixtures'
import { waitForLogText } from '../../helpers/log-reader'
import { waitForCanvasLoad } from '../../helpers/canvas'
import { BACKEND_PORT, E2E_ENV_NAME, ensureEnvironment } from '../../helpers/config'
import { injectServiceHost } from '../../helpers/fixture-import'
import { randomUUID } from 'node:crypto'
import fs from 'fs'
import path from 'path'

const SECRET = 's3cr3t-remote-token'
const MASK = '********'
const REMOTE_URL = 'http://http-target:9444/api'

function loadFixture(): Record<string, any> {
  const fixture = injectServiceHost(
    JSON.parse(fs.readFileSync(path.resolve(__dirname, 'fixture.json'), 'utf-8'))
  ) as Record<string, any>
  fixture.variables.backend_port.value = parseInt(BACKEND_PORT, 10)
  fixture.name = `${fixture.name} ${randomUUID().slice(0, 8)}`
  return fixture
}

async function selectEnvironment(page: Page, envName: string) {
  await page.locator('[data-testid="environment-selector"]').click()
  const popover = page.locator('[data-testid="environment-popover"]')
  await expect(popover).toBeVisible()
  await popover.locator(`button:has-text("${envName}")`).first().click()
  await expect(popover).not.toBeVisible()
}

async function getNodeStatuses(page: Page) {
  return page.evaluate(() => {
    const nodes = document.querySelectorAll('[data-testid^="workflow-node-"]')
    return Array.from(nodes).map((n) => ({
      testId: n.getAttribute('data-testid'),
      status: n.getAttribute('data-execution-status'),
    }))
  })
}

const NODE_IDS = [
  'open-session', 'exec-host', 'log-open', 'container',
  'http-in', 'json-in', 'log-in',
  'log-then', 'http-outside', 'log-outside',
]

test.describe('Remote Execution container E2E Execution', () => {
  test('mixed-locus body: remotable runs on host, non-remotable + external run local', async ({ page }) => {
    const fixture = loadFixture()

    await page.request.delete(`http://localhost:${BACKEND_PORT}/workbench/session/`).catch(() => {})
    await ensureEnvironment(page.request)

    const createResp = await page.request.post(`http://localhost:${BACKEND_PORT}/tests`, { data: fixture })
    const createBody = await createResp.json().catch(() => null)
    expect(createResp.ok(), `POST /tests failed: ${createResp.status()} - ${JSON.stringify(createBody)}`).toBeTruthy()
    const testId = createBody.data?.id || createBody.id

    const validateResp = await page.request.post(
      `http://localhost:${BACKEND_PORT}/tests/${testId}/validate?context=run`
    )
    const validateBody = await validateResp.json().catch(() => null)
    expect(validateResp.ok(), `Fixture validation failed: ${validateResp.status()} - ${JSON.stringify(validateBody)}`).toBeTruthy()
    expect(validateBody.data?.errors ?? []).toEqual([])

    await page.goto(`/workbench?editTest=${testId}`)
    await page.evaluate(() => localStorage.clear())
    await page.goto(`/workbench?editTest=${testId}`)
    await waitForCanvasLoad(page)

    await selectEnvironment(page, E2E_ENV_NAME)
    await page.locator('[data-testid="run-button"]').click()
    const status = page.locator('[data-testid="workflow-status"]')
    await expect(status).not.toHaveAttribute('data-status', 'idle', { timeout: 5_000 })
    await expect(status).not.toHaveAttribute('data-status', 'running', { timeout: 60_000 })

    const logs = await waitForLogText(page, 'ssh-remote-exec-done')
    const all = logs.join('\n')
    const statusVal = await status.getAttribute('data-status')
    if (statusVal !== 'passed') {
      console.log('=== REMOTE EXEC WORKFLOW FAILED ===')
      console.log('node statuses:', JSON.stringify(await getNodeStatuses(page), null, 2))
      console.log('logs:', all)
    }
    expect(statusVal).toBe('passed')

    const present = (marker: string) =>
      expect(logs.some((t) => t.includes(marker)), `Expected "${marker}" in logs.\n${all}`).toBeTruthy()

    // ---- The execution host is the REAL sshd container ----
    await test.step('execution host is real: hostname resolves to wave-e2e-host', () => {
      present('session opened connected=True host=wave-e2e-host')
    })

    // ---- Remotable HTTP ran ON THE HOST (worker), real response bound ----
    await test.step('http-in ran remotely (R): real http-target response + worker log replayed', () => {
      // `http-target` is unpublished: its name resolves only inside the stack,
      // so a local run of this URL on WAVE could not even resolve it. The real
      // 200 proves the bundle's urllib executed on the host.
      present('in-body rx=200')
      present('"status":"healthy"')
      // The worker's captured log is replayed into the run.
      present(`HTTP 200 ${REMOTE_URL}`)
    })

    // ---- Non-remotable JSON + Log ran LOCALLY on WAVE (L) ----
    await test.step('json-in + log-in ran locally (L): bound JSON result present', () => {
      // json-parser combined result {"n": 42} bound to jr and logged locally.
      expect(
        logs.some((t) => t.includes('in-body rx=200') && t.includes('42')),
        `Expected the local JSON result (42) in the body log.\n${all}`
      ).toBeTruthy()
    })

    // ---- Secret in the body flow is masked, never cleartext ----
    await test.step('secret is masked in the remote container flow', () => {
      present(`secretcheck=${MASK}`)
      expect(all.includes(SECRET), `Secret leaked in cleartext.\n${all}`).toBeFalsy()
    })

    // ---- Remote Session ID output bound (hex handle) + then continuation ----
    await test.step('container binds Remote Session ID and runs the then branch', () => {
      present('remote-exec-then-done')
      present('rsid_len=32')
    })

    // ---- HTTP OUTSIDE the container still runs LOCALLY on WAVE ----
    await test.step('external HTTP runs locally (real httpx GET of the backend health)', () => {
      // The backend health endpoint is reachable only from WAVE, never from the
      // sshd host - the 200 proves the out-of-container block ran locally.
      present('outside local status=200')
    })

    // ---- Every node succeeded ----
    await test.step('node statuses', async () => {
      present('ssh-remote-exec-done')
      for (const id of NODE_IDS) {
        await expect(page.locator(`[data-testid="workflow-node-${id}"]`)).toHaveAttribute(
          'data-execution-status',
          'success'
        )
      }
    })
  })
})
