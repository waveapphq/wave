/**
 * V-CANVAS-FN-DRILL-01: Drill-down into local Functions
 *
 * Design Decisions: none
 * REQ: REQ-3.1.1.4 (nested block composition)
 *
 * Phase: functional-workflow (seeds a Test with nested local Functions via POST /tests).
 *
 * Pass Criteria:
 *   1. Clicking the drill glyph on a local Function node swaps the canvas to
 *      the inner subtree (the outer Function node disappears; the inner Helper
 *      node becomes visible).
 *   2. The canvas breadcrumb gains a violet "Function_1" segment (lucide
 *      FunctionSquare icon, #A78BFA color).
 *   3. Drilling deeper via the inner Helper's drill glyph appends a second
 *      violet "Helper_1" segment; the breadcrumb path now reads
 *      Test name / Function_1 / Helper_1.
 *   4. Cmd/Ctrl+Enter on a single-selected local Function node drills in (same
 *      result as clicking the glyph).
 *   5. Clicking the parent (Test) breadcrumb segment pops drill state back to
 *      the Test root; the outer Function node is visible again.
 *   6. Clicking the back arrow while drilled in pops ONE drill level (not the
 *      usual navigate-to-backHref).
 */

import { test, expect, type Page, type APIRequestContext } from '../../helpers/playwright-fixtures'
import { waitForCanvasLoad } from '../../helpers/canvas'
import { BACKEND_PORT } from '../../helpers/config'
import fs from 'fs'
import path from 'path'

const BASE = `http://localhost:${BACKEND_PORT}`

function loadFixture(): Record<string, unknown> {
  const fixture = JSON.parse(fs.readFileSync(path.resolve(__dirname, 'fixture.json'), 'utf-8'))
  return { ...fixture, name: `V-CANVAS-FN-DRILL-01 ${Date.now()}-${Math.random().toString(36).slice(2, 8)}` }
}

async function seedFixture(request: APIRequestContext): Promise<string> {
  const resp = await request.post(`${BASE}/tests`, { data: loadFixture() })
  const body = await resp.json().catch(() => null)
  expect(body?.success === true, `POST /tests failed: ${resp.status()} - ${JSON.stringify(body)}`).toBeTruthy()
  return body.data.id
}

async function openTest(page: Page, testId: string) {
  await page.request.delete(`${BASE}/workbench/session`).catch(() => {})
  await page.goto(`/workbench?editTest=${testId}`)
  await page.evaluate(() => localStorage.clear())
  await page.goto(`/workbench?editTest=${testId}`)
  await waitForCanvasLoad(page)
}

test.describe('V-CANVAS-FN-DRILL-01: drill-down into local Functions', () => {
  test('S1: drill glyph swaps canvas to inner subtree, breadcrumb gains violet Function segment', async ({
    page,
    request,
  }) => {
    const testId = await seedFixture(request)
    await openTest(page, testId)

    const outer = page.locator('[data-testid="workflow-node-fn-outer"]')
    await expect(outer).toBeVisible()
    await expect(outer).toHaveAttribute('data-nodetype', 'function')

    // Drill in via the glyph on the outer Function.
    await outer.locator('[data-testid="node-dig-in"]').click()

    // Inner subtree is now active.
    await expect(page.locator('[data-testid="workflow-node-fn-inner"]')).toBeVisible()
    await expect(page.locator('[data-testid="workflow-node-fn-outer"]')).toHaveCount(0)

    // Breadcrumb shows the violet Function segment.
    const bc = page.locator('[data-testid="canvas-breadcrumb"]')
    await expect(bc).toBeVisible()
    await expect(bc.getByText('Function_1', { exact: true })).toBeVisible()
    // FunctionSquare icon (lucide-react v0.555+ renders the class
    // `lucide-square-function`) signals the violet drill segment.
    await expect(bc.locator('svg.lucide-square-function').first()).toBeVisible()
  })

  test('S2: drilling deeper appends a second violet Function segment', async ({ page, request }) => {
    const testId = await seedFixture(request)
    await openTest(page, testId)

    await page.locator('[data-testid="workflow-node-fn-outer"] [data-testid="node-dig-in"]').click()
    await expect(page.locator('[data-testid="workflow-node-fn-inner"]')).toBeVisible()
    await page.locator('[data-testid="workflow-node-fn-inner"] [data-testid="node-dig-in"]').click()

    // Inner empty-state placeholder confirms we are in Helper_1's empty body.
    const onboardingHint = page.locator('[data-testid="onboarding-hint"]')
    await expect(onboardingHint).toBeVisible()
    await expect(onboardingHint).toContainText('Drag a plugin to define')

    const bc = page.locator('[data-testid="canvas-breadcrumb"]')
    await expect(bc.getByText('Function_1', { exact: true })).toBeVisible()
    await expect(bc.getByText('Helper_1', { exact: true })).toBeVisible()
    await expect(bc.locator('svg.lucide-square-function')).toHaveCount(2)
  })

  test('S3: Cmd/Ctrl+Enter on a single-selected Function node drills in', async ({ page, request }) => {
    const testId = await seedFixture(request)
    await openTest(page, testId)

    const outer = page.locator('[data-testid="workflow-node-fn-outer"]')
    // Select the node (click the body, not an action button).
    await outer.locator('button').first().dispatchEvent('click')
    await expect(outer).toHaveAttribute('data-selected', 'true')

    // The keydown handler lives on the React Flow wrapper (tabIndex=0). After
    // dispatchEvent('click') focus is parked on the node body's <button>,
    // which consumes the Enter key as a button activation instead of letting
    // it propagate. Dispatch the key on the wrapper itself so the canvas
    // interaction hook sees it. Control+Enter is the cross-platform shortcut
    // (the implementation accepts both metaKey and ctrlKey).
    const wrapper = page.locator('[data-testid="workflow-canvas"]')
    await wrapper.press('Control+Enter')

    await expect(page.locator('[data-testid="workflow-node-fn-inner"]')).toBeVisible()
    await expect(page.locator('[data-testid="workflow-node-fn-outer"]')).toHaveCount(0)
  })

  test('S4: clicking the parent Test breadcrumb segment pops drill back to root', async ({
    page,
    request,
  }) => {
    const testId = await seedFixture(request)
    await openTest(page, testId)

    await page.locator('[data-testid="workflow-node-fn-outer"] [data-testid="node-dig-in"]').click()
    await expect(page.locator('[data-testid="workflow-node-fn-inner"]')).toBeVisible()

    // The Test segment is now an intermediate (clickable) segment in the
    // breadcrumb. Find it by exact name and click - the live wrapper maps
    // the synthetic `#drill-0` href to popDrillTo(0).
    const bc = page.locator('[data-testid="canvas-breadcrumb"]')
    const testSegmentLink = bc.locator('a').filter({ hasText: /V-CANVAS-FN-DRILL-01/ }).first()
    await expect(testSegmentLink).toBeVisible()
    await testSegmentLink.click()

    // Back at the Test root: the outer Function reappears, the inner subtree
    // disappears.
    await expect(page.locator('[data-testid="workflow-node-fn-outer"]')).toBeVisible()
    await expect(page.locator('[data-testid="workflow-node-fn-inner"]')).toHaveCount(0)
  })

  test('S5: back arrow pops one drill level when drilled in', async ({ page, request }) => {
    const testId = await seedFixture(request)
    await openTest(page, testId)

    // Drill in twice (outer then inner) so we have two function segments.
    await page.locator('[data-testid="workflow-node-fn-outer"] [data-testid="node-dig-in"]').click()
    await expect(page.locator('[data-testid="workflow-node-fn-inner"]')).toBeVisible()
    await page.locator('[data-testid="workflow-node-fn-inner"] [data-testid="node-dig-in"]').click()
    const bc = page.locator('[data-testid="canvas-breadcrumb"]')
    await expect(bc.locator('svg.lucide-square-function')).toHaveCount(2)

    // Pop one level via back arrow.
    await page.locator('[data-testid="breadcrumb-back-arrow"]').click()

    // Now drilled into Function_1 only; one function segment, Helper_1 gone
    // from the breadcrumb path.
    await expect(bc.locator('svg.lucide-square-function')).toHaveCount(1)
    await expect(bc.getByText('Function_1', { exact: true })).toBeVisible()
    await expect(bc.getByText('Helper_1', { exact: true })).toHaveCount(0)
    // Inner Helper node is visible (canvas now shows Function_1's inner workflow).
    await expect(page.locator('[data-testid="workflow-node-fn-inner"]')).toBeVisible()
  })
})
