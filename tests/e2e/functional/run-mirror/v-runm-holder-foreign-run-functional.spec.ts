/**
 * V-RUNM-HOLDER-FOREIGN-RUN-FUNCTIONAL: the holder tab follows a tracked run it did not start
 * to its end.
 * Design Decisions: RUNM-1, RUNM-10; 15.6.0.3 (read-only only while a session runs)
 * REQ: REQ-5.2.7.15
 *
 * Pass Criteria:
 * 1. With test A open in the holder tab, a tracked run of test B started over REST shows as
 *    running in that tab (Stop offered, Run withdrawn).
 * 2. When B reaches its terminal state the tab leaves running: the status reads B's verdict
 *    and Run is offered again, so the canvas is editable.
 */

import type { BrowserContext } from '@playwright/test'
import { test, expect } from '../../helpers/playwright-fixtures'
import { BACKEND_URL } from '../../helpers/config'
import { SEL, resetOwnership, waitUntilHeld } from '../../helpers/ownership'
import {
  loadFixture,
  importFixture,
  environmentId,
  openHolderWithTest,
  allowRunAttach,
  startTrackedRun,
  pollExecutionTerminal,
} from './helpers'

const open: BrowserContext[] = []

test.describe('V-RUNM-HOLDER-FOREIGN-RUN-FUNCTIONAL: a foreign tracked run ends in the holder tab', () => {
  test.beforeEach(async ({ request }) => {
    await resetOwnership(request)
    await request.delete(`${BACKEND_URL}/workbench/session`).catch(() => undefined)
  })

  test.afterEach(async ({ request }) => {
    for (const context of open.splice(0)) await context.close().catch(() => {})
    await resetOwnership(request)
    // The finished tracked run stays the recovered session; a later bare /workbench would redirect.
    await request.delete(`${BACKEND_URL}/workbench/session`).catch(() => undefined)
  })

  test('the holder tab leaves running when the foreign run ends', async ({ browser, request }) => {
    const openId = await importFixture(request, loadFixture())
    const runId = await importFixture(request, loadFixture())
    const envId = await environmentId(request)

    const holder = await openHolderWithTest(browser, openId, (c) => open.push(c))
    await waitUntilHeld(request)
    await allowRunAttach(holder)
    const status = holder.locator('[data-testid="workflow-status"]')

    const executionId = await startTrackedRun(request, runId, envId)

    await test.step('the foreign run shows as running in the holder tab', async () => {
      await expect(status).toHaveAttribute('data-status', 'running', { timeout: 15_000 })
      await expect(holder.locator('[data-testid="action-stop-button"]')).toBeVisible()
    })

    expect(await pollExecutionTerminal(request, executionId)).toBe('passed')

    await test.step('the tab leaves running with the run verdict and offers Run again', async () => {
      await expect(status).toHaveAttribute('data-status', 'passed', { timeout: 15_000 })
      await expect(holder.locator(SEL.runButton)).toBeVisible()
      await expect(holder.locator('[data-testid="action-stop-button"]')).toHaveCount(0)
    })
  })
})
