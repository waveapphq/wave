/**
 * V-CANVAS-15: Paused Canvas - Breadcrumb, Breakpoint Indicator, and Node Border
 *
 * Design Decisions: CANVAS-79 (breadcrumb amber static dot), CANVAS-81 (paused
 * amber 3-4px border, selection halo suppressed), CANVAS-82 (breakpoint red
 * dot at top-right of node, all canvas states)
 * REQ: REQ-3.2.2.1 (Set breakpoints), REQ-3.2.2.3 (Pause/resume), REQ-3.2.2.5
 * (Real-time progress monitoring - paused visuals)
 *
 * Pass Criteria:
 * 1. Breadcrumb status indicator shows data-status="paused" with amber dot and
 *    "Paused" label while the engine is paused (CANVAS-79).
 * 2. Paused node has data-paused="true" and an amber 3-4px border
 *    (class contains "border-amber-500" and "border-[3px]") (CANVAS-81).
 * 3. Breakpoint red dot ("node-breakpoint-dot") is visible on the node that
 *    has a breakpoint set - both before running, during pause, and on nodes
 *    other than the paused one (CANVAS-82).
 */

import { test, expect, type Page } from '../../helpers/playwright-fixtures'
import { waitForCanvasLoad } from '../../helpers/canvas'
import { BACKEND_PORT, E2E_ENV_NAME, ensureEnvironment } from '../../helpers/config'
import fs from 'fs'
import path from 'path'

function loadFixture(nameSuffix: string): Record<string, unknown> {
  const raw = fs.readFileSync(
    path.resolve(__dirname, '../../functional/debug-run/fixture-flat.json'),
    'utf-8',
  )
  const fixture = JSON.parse(raw)
  fixture.name = `V-CANVAS-15 - ${nameSuffix} ${Date.now()}`
  return fixture
}

async function importAndNavigate(page: Page, nameSuffix: string): Promise<string> {
  await page.request
    .delete(`http://localhost:${BACKEND_PORT}/workbench/session/`)
    .catch(() => {})
  await ensureEnvironment(page.request)

  const createResp = await page.request.post(`http://localhost:${BACKEND_PORT}/tests`, {
    data: loadFixture(nameSuffix),
  })
  const body = await createResp.json().catch(() => null)
  expect(
    createResp.ok(),
    `POST /tests failed: ${createResp.status()} - ${JSON.stringify(body)}`,
  ).toBeTruthy()
  const testId = body.data?.id || body.id

  await page.goto(`/workbench?editTest=${testId}`)
  await page.evaluate(() => localStorage.clear())
  await page.goto(`/workbench?editTest=${testId}`)
  await waitForCanvasLoad(page)
  return testId
}

async function selectEnvironment(page: Page): Promise<void> {
  await page.locator('[data-testid="environment-selector"]').click()
  const popover = page.locator('[data-testid="environment-popover"]')
  await expect(popover).toBeVisible()
  await popover.locator(`button:has-text("${E2E_ENV_NAME}")`).first().click()
  await expect(popover).not.toBeVisible()
}

async function confirmStop(page: Page): Promise<void> {
  await page.locator('[data-testid="action-stop-button"]').click()
  const dialog = page.locator('[data-testid="stop-confirmation-dialog"]')
  await expect(dialog).toBeVisible()
  await page.locator('[data-testid="stop-confirm-immediate"]').click()
}

async function toggleBreakpoint(page: Page, nodeId: string): Promise<void> {
  const node = page.locator(`[data-testid="workflow-node-${nodeId}"]`)
  await expect(node).toBeVisible()
  await node.click({ button: 'right' })
  const menu = page.locator('[role="menu"]')
  await expect(menu).toBeVisible()
  await menu.getByText('Toggle Breakpoint', { exact: true }).click()
  await expect(menu).not.toBeVisible()
}

test.describe('V-CANVAS-15: Paused canvas visuals', () => {
  test('V-CANVAS-15-S1: breakpoint red dot renders on the breakpointed node before Debug', async ({
    page,
  }) => {
    await importAndNavigate(page, 'S1')

    // Initially, no node has a breakpoint dot.
    const log2 = page.locator('[data-testid="workflow-node-log-2"]')
    await expect(log2.locator('[data-testid="node-breakpoint-dot"]')).toHaveCount(0)

    // Toggle a breakpoint on log-2 and log-4 - dots appear on both.
    await toggleBreakpoint(page, 'log-2')
    await toggleBreakpoint(page, 'log-4')
    await expect(log2.locator('[data-testid="node-breakpoint-dot"]')).toBeVisible()
    await expect(
      page.locator('[data-testid="workflow-node-log-4"] [data-testid="node-breakpoint-dot"]'),
    ).toBeVisible()
    // Nodes without a breakpoint do NOT render the dot.
    await expect(
      page.locator('[data-testid="workflow-node-log-1"] [data-testid="node-breakpoint-dot"]'),
    ).toHaveCount(0)
  })

  test('V-CANVAS-15-S2: breadcrumb shows paused status with amber dot during pause', async ({
    page,
  }) => {
    await importAndNavigate(page, 'S2')
    await toggleBreakpoint(page, 'log-2')
    await selectEnvironment(page)
    await page.locator('[data-testid="debug-button"]').click()

    const status = page.locator('[data-testid="workflow-status"]')
    await expect(status).toHaveAttribute('data-status', 'paused', { timeout: 15_000 })

    // Breadcrumb dot must be amber while paused (CANVAS-79).
    const statusDot = status.locator('span.rounded-full').first()
    await expect(statusDot).toHaveClass(/bg-amber-500/)

    await confirmStop(page)
    await expect(status).toHaveAttribute('data-status', 'stopped', { timeout: 10_000 })
  })

  test('V-CANVAS-15-S3: paused node has amber 3-4px border and data-paused="true"', async ({
    page,
  }) => {
    await importAndNavigate(page, 'S3')
    await toggleBreakpoint(page, 'log-2')
    await selectEnvironment(page)
    await page.locator('[data-testid="debug-button"]').click()

    const status = page.locator('[data-testid="workflow-status"]')
    await expect(status).toHaveAttribute('data-status', 'paused', { timeout: 15_000 })

    const pausedNode = page.locator('[data-testid="workflow-node-log-2"]')
    await expect(pausedNode).toHaveAttribute('data-paused', 'true')
    // Amber 3-4px border per CANVAS-81 - class list includes border-amber-500
    // and border-[3px].
    await expect(pausedNode).toHaveClass(/border-amber-500/)
    await expect(pausedNode).toHaveClass(/border-\[3px\]/)

    // Breakpoint red dot still renders on the paused node (coexists with the
    // amber border).
    await expect(pausedNode.locator('[data-testid="node-breakpoint-dot"]')).toBeVisible()

    await confirmStop(page)
    await expect(status).toHaveAttribute('data-status', 'stopped', { timeout: 10_000 })
  })

  test('V-CANVAS-15-S4: non-paused nodes do not get the amber border', async ({ page }) => {
    await importAndNavigate(page, 'S4')
    await toggleBreakpoint(page, 'log-2')
    await selectEnvironment(page)
    await page.locator('[data-testid="debug-button"]').click()

    const status = page.locator('[data-testid="workflow-status"]')
    await expect(status).toHaveAttribute('data-status', 'paused', { timeout: 15_000 })

    // log-1 has already passed, log-3/4/5 haven't run - none should have
    // data-paused="true".
    for (const otherId of ['log-1', 'log-3', 'log-4', 'log-5']) {
      const other = page.locator(`[data-testid="workflow-node-${otherId}"]`)
      await expect(other).not.toHaveAttribute('data-paused', 'true')
    }

    await confirmStop(page)
    await expect(status).toHaveAttribute('data-status', 'stopped', { timeout: 10_000 })
  })
})
