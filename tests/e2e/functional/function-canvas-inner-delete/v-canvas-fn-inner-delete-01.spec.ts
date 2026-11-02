/**
 * V-CANVAS-FN-INNER-DELETE-01: Delete inner node + edges inside drilled-in Function
 *
 * Wireframes: none (existing canvas surface).
 * Design Decisions: none (canvas swap; Save persists nested)
 * REQ: REQ-3.1.1.4 (nested block composition)
 *
 * The drill-aware store helpers back `deleteSelected` + `use-node-actions` (ingressCount,
 * isUnreachable, hasConnections), so they all read the active subtree.
 *
 * Phase: functional-workflow.
 *
 * Pass Criteria:
 *   1. Drilling reveals two inner Log nodes connected by one edge.
 *   2. Both inner nodes render at full opacity - no muted/grayscale class
 *      (isUnreachable stays false).
 *   3. inner-1's kebab "Unlink" entry is enabled (NOT grayed) because the
 *      drill-aware `hasConnections` selector sees the inner edge.
 *   4. Pressing Del with inner-2 selected removes inner-2 AND the edge that
 *      targeted it. The root-shell sibling at the Test root is untouched
 *      (it doesn't exist on the inner canvas in the first place; popping
 *      back to root must still show it).
 */

import { test, expect, type Page, type APIRequestContext } from '../../helpers/playwright-fixtures'
import { waitForCanvasLoad } from '../../helpers/canvas'
import { BACKEND_PORT } from '../../helpers/config'
import fs from 'fs'
import path from 'path'

const BASE = `http://localhost:${BACKEND_PORT}`

function loadFixture(): Record<string, unknown> {
  const fixture = JSON.parse(fs.readFileSync(path.resolve(__dirname, 'fixture.json'), 'utf-8'))
  return { ...fixture, name: `V-CANVAS-FN-INNER-DELETE-01 ${Date.now()}-${Math.random().toString(36).slice(2, 8)}` }
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

test.describe('V-CANVAS-FN-INNER-DELETE-01: inner-Function delete + edges', () => {
  test('drill, verify inner state, delete inner-2, root tree intact', async ({ page, request }) => {
    const testId = await seedFixture(request)
    await openTest(page, testId)

    await page.locator('[data-testid="workflow-node-fn-1"] [data-testid="node-dig-in"]').click()

    const inner1 = page.locator('[data-testid="workflow-node-inner-1"]')
    const inner2 = page.locator('[data-testid="workflow-node-inner-2"]')
    await expect(inner1).toBeVisible()
    await expect(inner2).toBeVisible()

    // Outer Function and the sibling root-shell are not in the active subtree.
    await expect(page.locator('[data-testid="workflow-node-fn-1"]')).toHaveCount(0)
    await expect(page.locator('[data-testid="workflow-node-root-shell"]')).toHaveCount(0)

    // Inner nodes do NOT carry data-disabled (a muted look).
    await expect(inner1).not.toHaveAttribute('data-disabled', 'true')
    await expect(inner2).not.toHaveAttribute('data-disabled', 'true')

    // Inner edges: the seed wires start-node -> inner-1 (so the
    // NODE_UNREACHABLE validator passes on save) PLUS the inner-1 ->
    // inner-2 chain. Two edges total.
    await expect(page.locator('.react-flow__edge')).toHaveCount(2)

    // inner-1's kebab Unlink entry is enabled.
    await inner1.locator('button').first().dispatchEvent('click')
    await inner1.locator('[data-testid="node-kebab"]').click()
    const menu = page.locator('[role="menu"]')
    await expect(menu).toBeVisible()
    const unlink = menu.getByRole('menuitem', { name: 'Unlink' })
    await expect(unlink).toBeEnabled()
    await page.keyboard.press('Escape')

    // Select inner-2 and press Del. dispatchEvent('click') parks focus on
    // the inner-2 button, so we route Delete through the canvas wrapper
    // (which owns the keydown listener via tabIndex=0); page.keyboard.press
    // would send to the focused button and miss the handler.
    await inner2.locator('button').first().dispatchEvent('click')
    await expect(inner2).toHaveAttribute('data-selected', 'true')
    const wrapper = page.locator('[data-testid="workflow-canvas"]')
    await wrapper.press('Delete')

    // inner-2 vanishes; the edge that targeted it is gone. The seed's
    // start-node -> inner-1 edge stays.
    await expect(inner2).toHaveCount(0)
    await expect(inner1).toBeVisible()
    await expect(page.locator('.react-flow__edge')).toHaveCount(1)

    // Pop back to root - the sibling Shell Script is intact (drill-aware mutation
    // didn't bleed into the root tree).
    await page.locator('[data-testid="breadcrumb-back-arrow"]').click()
    await expect(page.locator('[data-testid="workflow-node-fn-1"]')).toBeVisible()
    await expect(page.locator('[data-testid="workflow-node-root-shell"]')).toBeVisible()
  })
})
