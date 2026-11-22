/**
 * V-CANVAS-START-01: Start is 100 px wide, its label centered, its center on flow x 0
 * Design Decisions: CANVAS-248
 * REQ: REQ-3.1.1.12.2, REQ-5.2.7.4
 *
 * Phase: no-data. Seed (API, POST /tests): one `zz-b29-` Test holding one Log under Start; deleted after.
 *
 * Pass Criteria:
 * 1. In an open Test, Start measures 100 px wide and its content (the play glyph and the "Start" label)
 *    is centered in it within 1 px.
 * 2. Start's center is flow x 0 within 1 px.
 * 3. On a new empty Test, Start is the same, and the onboarding placeholder's center matches Start's
 *    center within 1 px.
 */

import { randomUUID } from 'node:crypto'
import { test, expect, type Page } from '../../helpers/playwright-fixtures'
import { BACKEND_URL } from '../../helpers/config'
import { waitForCanvasEmptyState, waitForCanvasLoad } from '../../helpers/canvas'
import { createValidTest, logNode, openTest, startEdge } from '../../helpers/fn-seed'
import { centerX, expectSameX, flowBoxOf, nodeFlowBox, nodeWrapper } from '../../helpers/flow-geometry'

const START_WIDTH = 100

/** Start's drawn width, its center and the center of its content. */
async function expectStart(page: Page, where: string): Promise<number> {
  const start = await nodeFlowBox(page, 'start-node')
  expect(Math.round(start.width), `${where}: Start is ${START_WIDTH} px wide`).toBe(START_WIDTH)
  const card = await flowBoxOf(page.locator('[data-testid="start-node"]'))
  expect(Math.round(card.width), `${where}: the Start card fills the node`).toBe(START_WIDTH)

  const icon = await flowBoxOf(page.locator('[data-testid="start-node-icon"]'))
  const label = await flowBoxOf(page.locator('[data-testid="start-node-label"]'))
  await expect(page.locator('[data-testid="start-node-label"]')).toHaveText('Start')
  const contentCenter = (icon.x + label.x + label.width) / 2
  expectSameX(contentCenter, centerX(card), `${where}: the Start content is centered`)
  expectSameX(centerX(start), 0, `${where}: Start's center is flow x 0`)
  return centerX(start)
}

test.describe('V-CANVAS-START-01: the Start node geometry', () => {
  const created: string[] = []

  test.afterAll(async ({ request }) => {
    await request.delete(`${BACKEND_URL}/workbench/session`).catch(() => undefined)
    for (const id of created.splice(0)) await request.delete(`${BACKEND_URL}/tests/${id}`).catch(() => undefined)
  })

  test('1 and 2. an open Test: Start is 100 px wide, content centered, centered on x 0', async ({ page, request }) => {
    const testId = await createValidTest(request, {
      name: `zz-b29-start-${randomUUID().slice(0, 8)}`,
      nodes: [logNode('start-01-log', 'First', "'first'", { x: -80, y: 140 })],
      edges: [startEdge('start-01-log')],
    })
    created.push(testId)
    await openTest(page, testId)
    await expectStart(page, 'open Test')
  })

  test('3. a new empty Test: the onboarding placeholder is centered under Start', async ({ page }) => {
    await page.request.delete(`${BACKEND_URL}/workbench/session`).catch(() => undefined)
    await page.goto('/workbench')
    await page.evaluate(() => localStorage.clear())
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    await waitForCanvasEmptyState(page)
    const startCenter = await expectStart(page, 'empty Test')
    await expect(nodeWrapper(page, 'onboarding-placeholder')).toBeVisible()
    const placeholder = await nodeFlowBox(page, 'onboarding-placeholder')
    expectSameX(centerX(placeholder), startCenter, 'the onboarding placeholder is centered under Start')
  })
})
