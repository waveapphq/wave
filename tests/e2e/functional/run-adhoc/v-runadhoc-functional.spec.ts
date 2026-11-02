/**
 * V-RUNADHOC-FUNCTIONAL: Ad-hoc Run / Debug End-to-End Coverage
 *
 * Imports a six-Log-plugin fixture, validates it, then exercises the
 * three behavioral modes that ship with REQ-3.2.1.5 plus the dirty-state
 * confirm-dialog gate that protects them. One spec, one fixture, all
 * permutations.
 *
 * Phases:
 *   P1 - Run Current on the mid-graph Log Target: only that node runs.
 *   P2 - Run from Here on the same node: target + downstream complete.
 *   P3 - Debug from Here on the same node with Pause on First Block: the
 *        engine pauses AT the chosen node, Continue drains the rest.
 *   P4 - Dirty in-memory run (run-current): dirty the canvas, right-click
 *        Run Current, assert NO run-confirm dialog appears and the ad-hoc run
 *        fires directly against the in-memory (post-disable) body.
 *
 * REQ: REQ-3.2.1.5 (Ad-hoc block execution), REQ-3.2.1.1 (run-current)
 */

import { test, expect, type Page } from '../../helpers/playwright-fixtures'
import { getLogTexts } from '../../helpers/log-reader'
import { waitForCanvasLoad } from '../../helpers/canvas'
import { BACKEND_PORT, E2E_ENV_NAME, ensureEnvironment } from '../../helpers/config'
import fs from 'fs'
import path from 'path'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function loadFixture(): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(path.resolve(__dirname, 'fixture.json'), 'utf-8'))
}

async function importAndOpen(page: Page): Promise<string> {
  const fixture = loadFixture()
  // Test names must be unique across the worker's DB so concurrent runs
  // don't collide. POST /tests treats a duplicate as a 500.
  const baseName = (fixture as { name?: string }).name ?? 'Run Ad-Hoc'
  const uniqueFixture = {
    ...fixture,
    name: `${baseName} ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  }

  await page.request.delete(`http://localhost:${BACKEND_PORT}/workbench/session/`).catch(() => {})
  await ensureEnvironment(page.request)

  const createResp = await page.request.post(`http://localhost:${BACKEND_PORT}/tests`, {
    data: uniqueFixture,
  })
  const createBody = await createResp.json().catch(() => null)
  expect(
    createResp.ok(),
    `POST /tests failed: ${createResp.status()} - ${JSON.stringify(createBody)}`,
  ).toBeTruthy()
  const testId = createBody.data?.id || createBody.id

  // Mandatory: fixture must pass /tests/{id}/validate with
  // zero errors before the run phases begin.
  const validateResp = await page.request.post(
    `http://localhost:${BACKEND_PORT}/tests/${testId}/validate`,
  )
  const validateBody = await validateResp.json().catch(() => null)
  expect(
    validateResp.ok(),
    `POST /tests/${testId}/validate failed: ${validateResp.status()} - ${JSON.stringify(validateBody)}`,
  ).toBeTruthy()
  const errors =
    validateBody?.data?.errors ??
    validateBody?.error?.details?.[0]?.errors ??
    validateBody?.errors ??
    []
  expect(
    errors.length,
    `Fixture failed validation. Errors: ${JSON.stringify(errors)}`,
  ).toBe(0)

  await page.goto(`/workbench?editTest=${testId}`)
  await page.evaluate(() => localStorage.clear())
  await page.goto(`/workbench?editTest=${testId}`)
  await waitForCanvasLoad(page)
  return testId
}

async function selectE2EEnv(page: Page): Promise<void> {
  await page.locator('[data-testid="environment-selector"]').click()
  const popover = page.locator('[data-testid="environment-popover"]')
  await expect(popover).toBeVisible()
  await popover.locator(`button:has-text("${E2E_ENV_NAME}")`).first().click()
  await expect(popover).not.toBeVisible()
}

type AdHocMenuItem =
  | 'Run Current'
  | 'Run from Here'
  | 'Debug Current'
  | 'Debug from Here'

async function rightClickAdHoc(
  page: Page,
  nodeId: string,
  item: AdHocMenuItem,
): Promise<void> {
  const node = page.locator(`[data-testid="workflow-node-${nodeId}"]`)
  await expect(node).toBeVisible()
  await node.click({ button: 'right' })
  const menu = page.locator('[role="menu"]')
  await expect(menu).toBeVisible()
  await menu.locator('[role="menuitem"]').filter({ hasText: item }).click()
  await expect(menu).not.toBeVisible()
}

async function rightClickEmptyCanvas(page: Page): Promise<void> {
  const canvas = page.locator('[data-testid="workflow-canvas"]')
  const box = await canvas.boundingBox()
  await page.mouse.click(box!.x + box!.width - 60, box!.y + 60, { button: 'right' })
}

async function togglePauseOnFirstBlockFromCanvas(page: Page): Promise<void> {
  await rightClickEmptyCanvas(page)
  const menu = page.locator('[role="menu"]')
  await expect(menu).toBeVisible()
  const item = menu.locator('[role="menuitemcheckbox"]').filter({ hasText: 'Pause on First Block' })
  await item.click()
  await expect(menu).not.toBeVisible()
}

async function waitForStatus(
  page: Page,
  expected: 'passed' | 'failed' | 'stopped' | 'paused' | 'running',
  timeout = 20_000,
): Promise<void> {
  const status = page.locator('[data-testid="workflow-status"]')
  await expect(status).toHaveAttribute('data-status', expected, { timeout })
}

async function getNodeExecStatus(page: Page, nodeId: string): Promise<string | null> {
  return page.locator(`[data-testid="workflow-node-${nodeId}"]`).getAttribute('data-execution-status')
}

// ---------------------------------------------------------------------------
// Test
// ---------------------------------------------------------------------------

test.describe('V-RUNADHOC-FUNCTIONAL: Ad-hoc Run/Debug End-to-End', () => {
  test('Run Current / Run from Here / Debug from Here + dirty-state gate', async ({ page }) => {
    await importAndOpen(page)
    await selectE2EEnv(page)

    // ----- P1: Run Current on log-target -------------------------------
    await test.step('Run Current on log-target: only that node runs', async () => {
      await rightClickAdHoc(page, 'log-target', 'Run Current')
      await waitForStatus(page, 'passed')

      // Target ran
      expect(await getNodeExecStatus(page, 'log-target')).toBe('success')

      // Pre-target nodes did NOT run
      for (const id of ['log-pre', 'log-step1']) {
        const s = await getNodeExecStatus(page, id)
        expect(
          s !== 'success' && s !== 'running',
          `Run Current should not execute upstream node ${id}, but got status=${s}`,
        ).toBeTruthy()
      }

      // Post-target nodes did NOT run
      for (const id of ['log-step3', 'log-step4', 'log-post']) {
        const s = await getNodeExecStatus(page, id)
        expect(
          s !== 'success' && s !== 'running',
          `Run Current should not execute downstream node ${id}, but got status=${s}`,
        ).toBeTruthy()
      }

      // Console contains only the target marker
      const logs = await getLogTexts(page)
      const all = logs.join('\n')
      expect(
        logs.some((m) => m.includes('adhoc-target')),
        `Expected "adhoc-target" in logs after Run Current. Got:\n${all}`,
      ).toBeTruthy()
      expect(
        logs.some((m) => m.includes('adhoc-pre')),
        `"adhoc-pre" must NOT be in logs after Run Current. Got:\n${all}`,
      ).toBeFalsy()
      expect(
        logs.some((m) => m.includes('adhoc-step3')),
        `"adhoc-step3" must NOT be in logs after Run Current. Got:\n${all}`,
      ).toBeFalsy()

      // Toast: completion wording. The in-house toast tags its root
      // div with `data-toast` and renders the message in a span/div inside.
      const toast = page.locator('[data-toast]', { hasText: "Block 'Log Target' ran successfully" })
      await expect(toast.first()).toBeVisible({ timeout: 5_000 })
    })

    // ----- P2: Run from Here on log-target ----------------------------
    await test.step('Run from Here on log-target: target + downstream run, upstream stays untouched', async () => {
      await rightClickAdHoc(page, 'log-target', 'Run from Here')
      await waitForStatus(page, 'passed')

      // Target + downstream success
      for (const id of ['log-target', 'log-step3', 'log-step4', 'log-post']) {
        expect(await getNodeExecStatus(page, id)).toBe('success')
      }

      // Pre-target still untouched
      for (const id of ['log-pre', 'log-step1']) {
        const s = await getNodeExecStatus(page, id)
        expect(
          s !== 'success' && s !== 'running',
          `Run from Here should not execute upstream node ${id}, but got status=${s}`,
        ).toBeTruthy()
      }

      // Console gained the downstream markers
      const logs = await getLogTexts(page)
      const all = logs.join('\n')
      for (const marker of ['adhoc-target', 'adhoc-step3', 'adhoc-step4', 'adhoc-post']) {
        expect(
          logs.some((m) => m.includes(marker)),
          `Expected "${marker}" in logs after Run from Here. Got:\n${all}`,
        ).toBeTruthy()
      }
      // Pre-markers must still be absent
      expect(
        logs.some((m) => m.includes('adhoc-pre')),
        `"adhoc-pre" must NOT be in logs after Run from Here. Got:\n${all}`,
      ).toBeFalsy()
    })

    // ----- P3: Debug from Here with Pause on First Block ---------------
    await test.step('Debug from Here pauses AT the start node when Pause on First Block is on', async () => {
      // Toggle Pause on First Block via the canvas right-click menu.
      await togglePauseOnFirstBlockFromCanvas(page)

      await rightClickAdHoc(page, 'log-target', 'Debug from Here')
      await waitForStatus(page, 'paused')

      // Engine paused AT log-target, not at a workflow root.
      const targetNode = page.locator('[data-testid="workflow-node-log-target"]')
      await expect(targetNode).toHaveAttribute('data-paused', 'true')

      // Continue drains the remaining downstream nodes.
      await page.locator('[data-testid="action-continue-button"]').click()
      await waitForStatus(page, 'passed')

      for (const id of ['log-target', 'log-step3', 'log-step4', 'log-post']) {
        expect(await getNodeExecStatus(page, id)).toBe('success')
      }

      // Pre nodes still absent.
      for (const id of ['log-pre', 'log-step1']) {
        const s = await getNodeExecStatus(page, id)
        expect(
          s !== 'success' && s !== 'running',
          `Debug from Here should not execute upstream node ${id}, but got status=${s}`,
        ).toBeTruthy()
      }
    })

    // ----- P4: Dirty ad-hoc Run fires directly (run-current) -----------
    await test.step('Dirty ad-hoc Run Current fires directly against the in-memory body (no run-confirm dialog)', async () => {
      // There is no run-confirm modal. A dirty ad-hoc Run
      // does not prompt to save - it runs the exact in-memory body.
      // Dirty the workflow without breaking the chain: right-click log-pre and
      // toggle Disable (flips data.disabled and sets isDirty=true). The chain
      // stays valid because the disabled node is bypassed at run time and the
      // ad-hoc target (log-target) is downstream of log-pre.
      const preNode = page.locator('[data-testid="workflow-node-log-pre"]')
      await preNode.click({ button: 'right' })
      const ctxMenu = page.locator('[role="menu"]')
      await expect(ctxMenu).toBeVisible()
      await ctxMenu.locator('[role="menuitem"]').filter({ hasText: 'Disable' }).click()
      await expect(ctxMenu).not.toBeVisible()

      // Right-click Run Current on the target. It must fire immediately - no
      // run-confirm dialog, no "Save and Run" / "Discard and Run" buttons.
      await rightClickAdHoc(page, 'log-target', 'Run Current')

      await expect(page.getByRole('button', { name: 'Save and Run' })).toHaveCount(0)
      await expect(page.getByRole('button', { name: 'Discard and Run' })).toHaveCount(0)

      await waitForStatus(page, 'passed')

      // log-target ran one more time as the ad-hoc target.
      expect(await getNodeExecStatus(page, 'log-target')).toBe('success')

      // The disable stays in the in-memory canvas (run-current did NOT save it),
      // so log-pre still renders ``data-disabled="true"``.
      await expect(preNode).toHaveAttribute('data-disabled', 'true')
    })
  })
})
