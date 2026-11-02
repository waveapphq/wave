/**
 * V-PLUGIN-SSH-VIA-PARENT-FUNCTIONAL: SSH Session "Via parent session"
 *
 * The chain-through-a-parent connection must be OPT-IN via the "Via parent
 * session" checkbox (use_parent). A stale/unresolved parent reference must never
 * connect DIRECT (bypassing the jump host). Proven against the real-service stack
 * (tests/e2e/services/): a real OpenSSH jump host (`sshd`, :9445) and a real
 * nested host (`nested-sshd`) with NO published port - reachable ONLY through
 * the jump:
 *
 *   open-a             -> direct baseline (hop 1)
 *   open-bad (try)     -> use_parent ON but the parent reference is unresolved:
 *                         FAILS "Parent SSH session is not open or not connected"
 *                         and NEVER connects direct (connected stays false)
 *   open-direct-stale  -> use_parent OFF but a stale parent value is present:
 *                         connects DIRECT (hop 1) - the checkbox, not the field,
 *                         decides
 *   open-nested        -> use_parent ON + parent A reaches the nested host
 *                         (hop 2); `hostname` proves it really ran there
 *   open-nested-direct -> the SAME host WITHOUT the parent FAILS (caught) -
 *                         the jump-isolation proof: traffic went through A
 *
 * Session outcome must be passed (the only failures are caught by try/catch).
 *
 * REQ: REQ-3.4.1.3 (real-service harness)
 */

import { test, expect, type Page } from '../../helpers/playwright-fixtures'
import { getLogLines, waitForLogText } from '../../helpers/log-reader'
import { waitForCanvasLoad } from '../../helpers/canvas'
import { BACKEND_PORT, E2E_ENV_NAME, ensureEnvironment } from '../../helpers/config'
import { injectServiceHost } from '../../helpers/fixture-import'
import { randomUUID } from 'node:crypto'
import fs from 'fs'
import path from 'path'

function loadFixture(): Record<string, any> {
  const fixture = JSON.parse(fs.readFileSync(path.resolve(__dirname, 'fixture.json'), 'utf-8'))
  fixture.name = `${fixture.name} ${randomUUID().slice(0, 8)}`
  return injectServiceHost(fixture)
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

test.describe('SSH Session Via-Parent E2E Execution', () => {
  test('checkbox decides chaining: unresolved parent fails, off-with-stale-value connects direct', async ({ page }) => {
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
    await expect(status).not.toHaveAttribute('data-status', 'running', { timeout: 30_000 })

    const logs = await waitForLogText(page, 'ssh-via-parent-e2e-done')
    const logEntries = await getLogLines(page)
    const all = logs.join('\n')
    const statusVal = await status.getAttribute('data-status')
    if (statusVal !== 'passed') {
      console.log('=== SSH VIA-PARENT WORKFLOW FAILED ===')
      console.log('node statuses:', JSON.stringify(await getNodeStatuses(page), null, 2))
      console.log('logs:', all)
    }
    expect(statusVal).toBe('passed')

    const present = (marker: string) =>
      expect(logs.some((t) => t.includes(marker)), `Expected "${marker}" in logs.\n${all}`).toBeTruthy()

    await test.step('A connects direct (hop 1)', () => {
      present('A opened connected=True hop=1')
    })

    await test.step('use_parent ON with an unresolved parent fails and never connects direct', () => {
      present('via-parent-no-parent-caught')
      present('Parent SSH session is not open or not connected')
      // The bad node must NOT have connected (no silent direct connect).
      const caughtLine = logs.find((t) => t.includes('via-parent-no-parent-caught')) ?? ''
      expect(caughtLine, `bad node must not have connected.\n${caughtLine}`).toContain('bad_conn=False')
      expect(
        logEntries.some((e) => e.includes('Try-path error caught')),
        'Engine should log that the via-parent error was caught'
      ).toBeTruthy()
    })

    await test.step('use_parent OFF with a stale parent value connects DIRECT (hop 1, not 2)', () => {
      // The checkbox, not the field, decides: off => direct even with a valid
      // parent id present in the (ignored) Parent Session field.
      present('stale-off connected=True hop=1 via-parent-off-direct')
    })

    await test.step('use_parent ON reaches the nested host through the jump (hop 2)', () => {
      // hostname resolves on the far end: the session really landed on the
      // nested host, and it got there through A (the only route).
      present('via-parent-nested connected=True hop=2 host=nested-host')
    })

    await test.step('the SAME nested host WITHOUT the parent is unreachable (jump isolation)', () => {
      present('direct-nested-caught conn=False')
      const errLine = logs.find((t) => t.includes('direct-nested-err ')) ?? ''
      expect(
        errLine,
        `the plugin's real connect error must surface.\n${errLine}`
      ).toContain('SSH connection to nested-sshd:22 failed')
    })

    await test.step('bookend + node statuses', async () => {
      present('ssh-via-parent-e2e-done')
      for (const id of [
        'open-a', 'log-a-open', 'tc-noparent', 'log-bad-caught', 'open-direct-stale', 'log-stale',
        'open-nested', 'exec-nested', 'log-nested', 'tc-direct', 'log-direct-caught', 'log-direct-err', 'log-done',
      ]) {
        await expect(page.locator(`[data-testid="workflow-node-${id}"]`)).toHaveAttribute(
          'data-execution-status',
          'success'
        )
      }
      // Both guarded probes must not succeed.
      for (const id of ['open-bad', 'open-nested-direct']) {
        expect(
          await page.locator(`[data-testid="workflow-node-${id}"]`).getAttribute('data-execution-status'),
          `${id} is a guarded failure probe and must not succeed`
        ).not.toBe('success')
      }
    })
  })
})
