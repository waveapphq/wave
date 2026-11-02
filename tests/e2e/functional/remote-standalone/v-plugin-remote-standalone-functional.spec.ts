/**
 * V-PLUGIN-REMOTE-STANDALONE-FUNCTIONAL: standalone routing of a body block
 *
 * Run Current / Run from Here on a single block must route by the same locus
 * rules as a full container run - a remotable body block runs on the host (never
 * locally), a block outside a container runs locally. Against the real-service
 * stack: the body block's URL names the internal `http-target` service, whose
 * DNS resolves ONLY inside the stack network - a local run on WAVE could never
 * reach it, so a real 200 proves host-side execution.
 *
 *   T1  Run Current on a remotable body block with NO live session -> FAILS with
 *       the session-named message and NEVER runs the plugin locally (never a
 *       silent local HTTP run that fails "connection attempts failed").
 *   T2  Run Current on the SSH Session Open block (ad-hoc keeps the session live),
 *       then Run Current on the remotable body block -> it runs ON THE HOST
 *       (real bundle under the host python3; worker log replayed).
 *   T3  Run Current on a remotable block OUTSIDE any container -> runs LOCALLY on
 *       WAVE (real httpx round-trip).
 *   T4  Run Current on a NON-remotable body block with NO live session -> runs LOCALLY
 *       on WAVE and passes (the ad-hoc run reaches no block that runs on the remote host,
 *       so it needs no session).
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
    JSON.parse(fs.readFileSync(path.resolve(__dirname, 'fixture.json'), 'utf-8'))
  ) as Record<string, any>
  fixture.variables.backend_port.value = parseInt(BACKEND_PORT, 10)
  // Unique per POST so repeated tests / retries don't 409 on the name.
  fixture.name = `${fixture.name} ${randomUUID().slice(0, 8)}`
  return fixture
}

async function selectEnvironment(page: Page) {
  await page.locator('[data-testid="environment-selector"]').click()
  const popover = page.locator('[data-testid="environment-popover"]')
  await expect(popover).toBeVisible()
  await popover.locator(`button:has-text("${E2E_ENV_NAME}")`).first().click()
  await expect(popover).not.toBeVisible()
}

type AdHocItem = 'Run Current' | 'Run from Here'
async function rightClickAdHoc(page: Page, nodeId: string, item: AdHocItem) {
  const node = page.locator(`[data-testid="workflow-node-${nodeId}"]`)
  await expect(node).toBeVisible()
  await node.click({ button: 'right' })
  const menu = page.locator('[role="menu"]')
  await expect(menu).toBeVisible()
  await menu.locator('[role="menuitem"]').filter({ hasText: item }).click()
  await expect(menu).not.toBeVisible()
}

async function waitForStatus(page: Page, expected: 'passed' | 'failed', timeout = 30_000) {
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

test.describe('Remote standalone routing', () => {
  test('T1: Run Current on a remotable body block with no live session fails and never runs local', async ({ page }) => {
    await importAndOpen(page)
    await rightClickAdHoc(page, 'http-in', 'Run Current')
    await waitForStatus(page, 'failed')

    const logs = await getLogTexts(page)
    const all = logs.join('\n')
    // Session-named guidance, not a local execution.
    expect(
      logs.some((t) => t.includes("its SSH session 'sid' is closed or not connected") && t.includes('Open it first')),
      `Expected the session-named remote-block error.\n${all}`
    ).toBeTruthy()
    // It must NEVER have run at all: the session gate fires before any attempt,
    // so the host-only URL never surfaces (no local httpx echo, no worker replay).
    expect(all.includes('http-target'), `The block must not run locally on WAVE.\n${all}`).toBeFalsy()
    expect(all.includes('HTTP 200'), `No live session -> it could not run on the host either.\n${all}`).toBeFalsy()
    expect(await page.locator('[data-testid="workflow-node-http-in"]').getAttribute('data-execution-status')).not.toBe('success')
  })

  test('T2: after Run Current opens the session, Run Current on the body block runs on the host', async ({ page }) => {
    await importAndOpen(page)

    // Ad-hoc open keeps the session live.
    await rightClickAdHoc(page, 'open-session', 'Run Current')
    await waitForStatus(page, 'passed')

    // Now the remotable body block runs ON THE HOST (real worker), not locally.
    await rightClickAdHoc(page, 'http-in', 'Run Current')
    await waitForStatus(page, 'passed')

    // http-target resolves only inside the stack: the real 200 (replayed from
    // the worker's log) is possible only if the request left the host, never WAVE.
    const logs = await waitForLogText(page, `HTTP 200 ${REMOTE_URL}`)
    const all = logs.join('\n')
    expect(await page.locator('[data-testid="workflow-node-http-in"]').getAttribute('data-execution-status')).toBe('success')
    // Never local: a local attempt on the stack-only name would fail to resolve.
    expect(all.includes('All connection attempts failed'), `no local attempt may surface.\n${all}`).toBeFalsy()
    expect(all.includes('Name or service not known'), `no local DNS failure may surface.\n${all}`).toBeFalsy()
  })

  test('T3: Run Current on a remotable block OUTSIDE any container runs locally on WAVE', async ({ page }) => {
    await importAndOpen(page)
    await rightClickAdHoc(page, 'http-outside', 'Run Current')
    await waitForStatus(page, 'passed')

    const logs = await getLogTexts(page)
    const all = logs.join('\n')
    // A remotable block outside any container runs locally: it succeeds (a real
    // local httpx round-trip to the backend health, which no stack host can
    // reach) with no session and never routes to a host. Run Current runs only
    // this node, so assert on its status.
    expect(await page.locator('[data-testid="workflow-node-http-outside"]').getAttribute('data-execution-status')).toBe('success')
    expect(all.includes('closed or not connected'), `an out-of-container block must not require a session.\n${all}`).toBeFalsy()
  })

  test('T4: Run Current on a non-remotable body block with no live session runs locally', async ({ page }) => {
    await importAndOpen(page)
    await rightClickAdHoc(page, 'json-in', 'Run Current')
    await waitForStatus(page, 'passed')

    const logs = await getLogTexts(page)
    const all = logs.join('\n')
    // No session error - a block that runs on WAVE never needs the Execution Host session.
    expect(all.includes('closed or not connected'), `a non-remotable block must not require a session.\n${all}`).toBeFalsy()
    expect(await page.locator('[data-testid="workflow-node-json-in"]').getAttribute('data-execution-status')).toBe('success')
  })
})
