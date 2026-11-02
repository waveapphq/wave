/**
 * V-PLUGIN-REMOTE-LIFECYCLE-FUNCTIONAL: SSH session lifecycle on run boundaries
 *
 * WAVE closes every open SSH session/worker on a FULL run's clean end
 * (passed/failed) and on Test Close / reset, but keeps them live after an ad-hoc
 * run (so a single remote block can be re-run) and after an Immediate Stop.
 * Against the real-service stack: the body block reaches the internal
 * `http-target` service, whose DNS resolves only inside the stack - a real 200
 * proves host-side execution over a live session.
 *
 *   T5  A full run drains the session at clean end: a follow-up Run Current on
 *       the remotable body block then FAILS "session closed" (a live session
 *       would have run it on the host). Reuses the remote-standalone fixture.
 *   T6  Immediate Stop keeps the session live: a breakpoint pauses the run
 *       right before the container (the session is already open), Immediate
 *       Stop ends it (status "stopped"), and a follow-up Run Current on the
 *       remotable body block runs ON THE HOST over the surviving session.
 *
 * REQ: REQ-3.4.1.3
 */

import { test, expect, type Page } from '../../helpers/playwright-fixtures'
import { getLogTexts, waitForLogText } from '../../helpers/log-reader'
import { waitForCanvasLoad } from '../../helpers/canvas'
import { BACKEND_PORT, E2E_ENV_NAME, ensureEnvironment } from '../../helpers/config'
import { injectServiceHost } from '../../helpers/fixture-import'
import { randomUUID } from 'node:crypto'
import fs from 'fs'
import path from 'path'

const REMOTE_URL = 'http://http-target:9444/api'

function loadFixture(): Record<string, any> {
  const fixture = injectServiceHost(
    JSON.parse(fs.readFileSync(path.resolve(__dirname, '../remote-standalone/fixture.json'), 'utf-8'))
  ) as Record<string, any>
  fixture.variables.backend_port.value = parseInt(BACKEND_PORT, 10)
  // Unique per POST so retries / a sibling suite don't 409 on the shared name.
  fixture.name = `Remote Lifecycle ${randomUUID().slice(0, 8)}`
  return fixture
}

async function selectEnvironment(page: Page) {
  await page.locator('[data-testid="environment-selector"]').click()
  const popover = page.locator('[data-testid="environment-popover"]')
  await expect(popover).toBeVisible()
  await popover.locator(`button:has-text("${E2E_ENV_NAME}")`).first().click()
  await expect(popover).not.toBeVisible()
}

async function rightClickAdHoc(page: Page, nodeId: string, item: 'Run Current') {
  const node = page.locator(`[data-testid="workflow-node-${nodeId}"]`)
  await expect(node).toBeVisible()
  await node.click({ button: 'right' })
  const menu = page.locator('[role="menu"]')
  await expect(menu).toBeVisible()
  await menu.locator('[role="menuitem"]').filter({ hasText: item }).click()
  await expect(menu).not.toBeVisible()
}

async function toggleBreakpoint(page: Page, nodeId: string) {
  const node = page.locator(`[data-testid="workflow-node-${nodeId}"]`)
  await expect(node).toBeVisible()
  await node.click({ button: 'right' })
  const menu = page.locator('[role="menu"]')
  await expect(menu).toBeVisible()
  await menu.getByText('Toggle Breakpoint', { exact: true }).click()
  await expect(menu).not.toBeVisible()
}

async function waitForStatus(page: Page, expected: 'passed' | 'failed' | 'paused' | 'stopped', timeout = 30_000) {
  await expect(page.locator('[data-testid="workflow-status"]')).toHaveAttribute('data-status', expected, { timeout })
}

async function importAndOpen(page: Page): Promise<void> {
  await page.request.delete(`http://localhost:${BACKEND_PORT}/workbench/session/`).catch(() => {})
  await ensureEnvironment(page.request)
  const createResp = await page.request.post(`http://localhost:${BACKEND_PORT}/tests`, { data: loadFixture() })
  const createBody = await createResp.json().catch(() => null)
  expect(createResp.ok(), `POST /tests failed: ${createResp.status()} - ${JSON.stringify(createBody)}`).toBeTruthy()
  const testId = createBody.data?.id || createBody.id
  await page.goto(`/workbench?editTest=${testId}`)
  await page.evaluate(() => localStorage.clear())
  await page.goto(`/workbench?editTest=${testId}`)
  await waitForCanvasLoad(page)
  await selectEnvironment(page)
}

test.describe('Remote session lifecycle', () => {
  test('T5: a full run drains the session -> a follow-up remote Run Current then fails', async ({ page }) => {
    await importAndOpen(page)

    // Full run: the container runs the body ON THE HOST during the run (the
    // worker-replayed real 200 from the stack-only http-target proves it)...
    await page.locator('[data-testid="run-button"]').click()
    await waitForStatus(page, 'passed')
    await waitForLogText(page, `HTTP 200 ${REMOTE_URL}`)

    // ...but the session is drained at the clean end. A follow-up Run Current on
    // the remotable body block must now FAIL (a live session would have passed).
    await rightClickAdHoc(page, 'http-in', 'Run Current')
    await waitForStatus(page, 'failed')

    const logs = await getLogTexts(page)
    const all = logs.join('\n')
    expect(
      logs.some((t) => t.includes("its SSH session 'sid' is closed or not connected")),
      `after a full run the session must be drained (follow-up remote block fails).\n${all}`
    ).toBeTruthy()
    expect(
      await page.locator('[data-testid="workflow-node-http-in"]').getAttribute('data-execution-status')
    ).not.toBe('success')
  })

  test('T6: Immediate Stop keeps the session live -> follow-up Run Current runs on the host', async ({ page }) => {
    await importAndOpen(page)

    // Deterministic mid-run stop: a breakpoint on the container pauses the
    // debug run AFTER open-session executed but BEFORE the worker opens.
    await toggleBreakpoint(page, 'container')
    await page.locator('[data-testid="debug-button"]').click()
    await waitForStatus(page, 'paused')
    await expect(page.locator('[data-testid="workflow-node-container"]')).toHaveAttribute('data-paused', 'true')

    // Immediate Stop while paused: the run ends "stopped", the session survives.
    await page.locator('[data-testid="action-stop-button"]').click()
    const dialog = page.locator('[data-testid="stop-confirmation-dialog"]')
    await expect(dialog).toBeVisible()
    await page.locator('[data-testid="stop-confirm-immediate"]').click()
    await waitForStatus(page, 'stopped', 10_000)

    // The surviving session carries a follow-up Run Current on the remotable
    // body block ON THE HOST (a drained session would fail "session closed").
    await rightClickAdHoc(page, 'http-in', 'Run Current')
    await waitForStatus(page, 'passed')

    const logs = await waitForLogText(page, `HTTP 200 ${REMOTE_URL}`)
    const all = logs.join('\n')
    expect(
      await page.locator('[data-testid="workflow-node-http-in"]').getAttribute('data-execution-status')
    ).toBe('success')
    expect(
      all.includes("closed or not connected"),
      `the session must survive an Immediate Stop.\n${all}`
    ).toBeFalsy()
  })
})
