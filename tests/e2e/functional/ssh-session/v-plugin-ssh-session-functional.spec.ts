/**
 * V-PLUGIN-SSH-SESSION-FUNCTIONAL: SSH Session trio End-to-End Execution Test
 *
 * One workflow, one run, exercising the SSH Session Open / Execute / Close
 * plugins against the real-service stack (tests/e2e/services/): a real OpenSSH
 * host (`sshd`, :9445) and a real nested jump host (`nested-sshd`, reachable
 * only through the first):
 *
 *   open-a           -> direct session (hop_count 1, connected true, banner)
 *   exec-a           -> `echo hello-from-a` (stdout + exit_code 0)
 *   exec-fail        -> real shell `echo failing with 3 >&2; exit 3`
 *                       (non-zero exit returned, NOT raised; stderr captured)
 *   exec-127         -> unknown command: the real shell's exit 127 + stderr
 *   open-b           -> chained through A via Parent Session to the nested
 *                       host (hop_count 2, real jump tunnel)
 *   exec-b           -> echoes `$(hostname)` through the 2-hop chain, proving
 *                       the command really ran on `nested-host`
 *   close-a          -> cascades to B (child before parent); both bound
 *                       Connected variables flip to false
 *   tc-closed (try)  -> exec on the now-closed A raises; catch proves the
 *                       "not found or already closed" error path
 *
 * Proves: shared-connection exec, non-zero exit passthrough, stderr capture,
 * the real 127 contract, multi-hop parent chaining onto a second real host,
 * cascade close, the Connected-flips-false-on-close contract (direct A +
 * cascaded child B), and the closed-session raise. Session outcome must be
 * passed (the only failure is caught).
 *
 * REQ: REQ-3.4.1.3, REQ-5.1.5
 */

import { test, expect, type Page } from '../../helpers/playwright-fixtures'
import { getLogLines, waitForLogText } from '../../helpers/log-reader'
import { waitForCanvasLoad } from '../../helpers/canvas'
import { BACKEND_PORT, E2E_ENV_NAME, ensureEnvironment } from '../../helpers/config'
import { injectServiceHost } from '../../helpers/fixture-import'
import fs from 'fs'
import path from 'path'

function loadFixture(): Record<string, unknown> {
  return injectServiceHost(
    JSON.parse(fs.readFileSync(path.resolve(__dirname, 'fixture.json'), 'utf-8'))
  )
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
      name: n.textContent?.substring(0, 80) || null,
    }))
  })
}

test.describe('SSH Session Trio E2E Execution', () => {
  test('Open / Execute / Close with a 2-hop chain and cascade close', async ({ page }) => {
    const fixture = loadFixture()

    // ---- Import + validate (zero errors before running) ----
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
    expect(
      validateResp.ok(),
      `Fixture validation failed: ${validateResp.status()} - ${JSON.stringify(validateBody)}`
    ).toBeTruthy()
    expect(validateBody.data?.errors ?? []).toEqual([])

    // ---- Navigate + run ----
    await page.goto(`/workbench?editTest=${testId}`)
    await page.evaluate(() => localStorage.clear())
    await page.goto(`/workbench?editTest=${testId}`)
    await waitForCanvasLoad(page)

    await selectEnvironment(page, E2E_ENV_NAME)
    await page.locator('[data-testid="run-button"]').click()
    const status = page.locator('[data-testid="workflow-status"]')
    await expect(status).not.toHaveAttribute('data-status', 'idle', { timeout: 5_000 })
    await expect(status).not.toHaveAttribute('data-status', 'running', { timeout: 30_000 })

    const logs = await waitForLogText(page, 'ssh-e2e-done')
    const logEntries = await getLogLines(page)
    const all = logs.join('\n')

    const statusVal = await status.getAttribute('data-status')
    if (statusVal !== 'passed') {
      console.log('=== SSH WORKFLOW FAILED ===')
      console.log('node statuses:', JSON.stringify(await getNodeStatuses(page), null, 2))
      console.log('logs:', all)
    }
    expect(statusVal).toBe('passed')

    const present = (marker: string) =>
      expect(logs.some((t) => t.includes(marker)), `Expected "${marker}" in logs.\n${all}`).toBeTruthy()

    // ---- Open A: direct session, connected, banner, hop 1 ----
    await test.step('Open A - direct session', () => {
      present('A opened connected=True hop=1')
      present('SSH-2.0') // server_banner output populated
    })

    // ---- Execute on A: stdout + exit_code 0 bound to variables ----
    await test.step('Execute echo on A', () => {
      present('A exec stdout=hello-from-a code=0')
    })

    // ---- Non-zero exit returned (not raised) + stderr captured ----
    await test.step('Execute non-zero exit + stderr', () => {
      present('A fail code=3 stderr=failing with 3')
    })

    // ---- Unknown command: the real shell reports 127 + "command not found" ----
    await test.step('Execute unknown command returns the real 127', () => {
      present('A 127 code=127')
      const line127 = logs.find((t) => t.includes('A 127 code=127')) ?? ''
      expect(line127, `real shell stderr expected.\n${line127}`).toContain('command not found')
    })

    // ---- Open B chained through A to the REAL nested host + execute through it ----
    await test.step('Open B chained through A, execute on the nested host', () => {
      present('B opened connected=True hop=2')
      // $(hostname) resolves on the far end: the command really ran on nested-host.
      present('B exec stdout=hello-from-b-from-nested-host')
    })

    // ---- Close A cascades to B; both bound Connected variables flip false ----
    await test.step('Close A cascades to B; Connected flips false (13.8)', () => {
      // a_conn is the directly-closed session; b_conn is the cascaded child.
      present('a_conn=False b_conn=False')
      const closeLine = logs.find((t) => t.includes('a_conn=False b_conn=False')) ?? ''
      const closedCount = (closeLine.match(/ssh_session_/g) ?? []).length
      expect(closedCount, `Close should report 2 cascaded session ids.\n${closeLine}`).toBe(2)
    })

    // ---- Exec on the closed session raises; caught by try-catch ----
    await test.step('Execute on a closed session raises (caught)', () => {
      present('exec-after-close-caught')
      present('not found or already closed')
      expect(
        logEntries.some((e) => e.includes('Try-path error caught')),
        'Engine should log that the closed-session error was caught'
      ).toBeTruthy()
    })

    // ---- Bookend + node statuses ----
    await test.step('Bookend + node statuses', async () => {
      present('ssh-e2e-done')
      for (const id of ['open-a', 'exec-a', 'exec-fail', 'exec-127', 'open-b', 'exec-b', 'close-a', 'log-caught', 'log-done']) {
        await expect(page.locator(`[data-testid="workflow-node-${id}"]`)).toHaveAttribute(
          'data-execution-status',
          'success'
        )
      }
    })
  })
})
