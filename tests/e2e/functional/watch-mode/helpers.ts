/**
 * Shared helpers for the watch-mode functional suite:
 * two-tab holder/watcher setup, fixture import+validate, viewport/centering
 * probes, and a deterministic canvas pan. Self-contained per the per-dir
 * helper convention used by debug-step / function-debug-halt.
 */

import { expect, type Page } from '../../helpers/playwright-fixtures'
import type { Browser, BrowserContext, APIRequestContext } from '@playwright/test'
import { BACKEND_URL, FRONTEND_URL, ensureEnvironment } from '../../helpers/config'
import { stubSessionRecovery, waitForCanvasLoad } from '../../helpers/canvas'

/** Import a fixture via POST /tests (unique name), assert zero validation errors, return the new id. */
export async function importFixture(
  request: APIRequestContext,
  fixture: Record<string, unknown>,
): Promise<string> {
  await ensureEnvironment(request)
  const baseName = (fixture as { name?: string }).name ?? 'Watch Mode Test'
  const unique = {
    ...fixture,
    name: `${baseName} ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  }
  const createResp = await request.post(`${BACKEND_URL}/tests`, { data: unique })
  const body = await createResp.json().catch(() => null)
  expect(
    createResp.ok(),
    `POST /tests failed: ${createResp.status()} - ${JSON.stringify(body)}`,
  ).toBeTruthy()
  const testId = body.data?.id || body.id

  const validateResp = await request.post(`${BACKEND_URL}/tests/${testId}/validate`)
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
  expect(errors.length, `Fixture failed validation: ${JSON.stringify(errors)}`).toBe(0)
  return testId
}

/** Open a fresh browser tab as the editing holder with a test loaded (editTest). */
export async function openHolder(
  browser: Browser,
  testId: string,
  track: (c: BrowserContext) => void,
): Promise<Page> {
  const context = await browser.newContext({ baseURL: FRONTEND_URL })
  track(context)
  const page = await context.newPage()
  await stubSessionRecovery(page)
  await page.goto(`/workbench?editTest=${testId}`)
  await page.evaluate(() => localStorage.clear())
  await page.goto(`/workbench?editTest=${testId}`)
  await waitForCanvasLoad(page)
  return page
}

/** Open a fresh browser tab that mirrors the current holder (read-only watcher). */
export async function openWatcher(
  browser: Browser,
  track: (c: BrowserContext) => void,
): Promise<Page> {
  const context = await browser.newContext({ baseURL: FRONTEND_URL })
  track(context)
  const page = await context.newPage()
  await stubSessionRecovery(page)
  await page.goto('/workbench')
  await waitForCanvasLoad(page)
  return page
}

/** The React Flow viewport transform (pan/zoom); a stable id for "did the viewport move". */
export async function viewportTransform(page: Page): Promise<string> {
  return page
    .locator('.react-flow__viewport')
    .first()
    .evaluate((el) => (el as HTMLElement).style.transform || '')
}

/** Poll until the viewport transform stops changing, so a fitView/pan animation
 *  has fully settled before a "did the viewport move" baseline is captured. */
export async function waitForViewportIdle(page: Page, timeout = 8_000): Promise<void> {
  await expect
    .poll(
      async () => {
        const a = await viewportTransform(page)
        await page.waitForTimeout(200)
        return a !== '' && a === (await viewportTransform(page))
      },
      { timeout, message: 'viewport did not settle' },
    )
    .toBe(true)
}

/** Breadcrumb Function segments == current drill depth. */
export function functionSegments(page: Page) {
  return page.locator('[data-testid="canvas-breadcrumb"]').locator('svg.lucide-square-function')
}

/** Poll until the node's bounding-box center sits near the viewport center (lenient by default). */
export async function expectNodeCentered(
  page: Page,
  nodeId: string,
  tolerance = 0.4,
): Promise<void> {
  await expect
    .poll(
      async () => {
        const canvas = await page.locator('[data-testid="workflow-canvas"]').boundingBox()
        const node = await page.locator(`[data-testid="workflow-node-${nodeId}"]`).boundingBox()
        if (!canvas || !node) return false
        const cx = canvas.x + canvas.width / 2
        const cy = canvas.y + canvas.height / 2
        const nx = node.x + node.width / 2
        const ny = node.y + node.height / 2
        return (
          Math.abs(nx - cx) < canvas.width * tolerance &&
          Math.abs(ny - cy) < canvas.height * tolerance
        )
      },
      { timeout: 6_000, message: `node ${nodeId} should be centered in ${page.url()}` },
    )
    .toBe(true)
}

/** Pan the canvas by a screen delta, grabbing an empty near-corner so no node is hit. */
export async function panCanvas(page: Page, dx: number, dy: number): Promise<void> {
  const box = await page.locator('[data-testid="workflow-canvas"]').boundingBox()
  if (!box) throw new Error('canvas has no bounding box')
  const sx = box.x + 48
  const sy = box.y + box.height - 48
  await page.mouse.move(sx, sy)
  await page.mouse.down()
  await page.mouse.move(sx + dx, sy + dy, { steps: 12 })
  await page.mouse.up()
}
