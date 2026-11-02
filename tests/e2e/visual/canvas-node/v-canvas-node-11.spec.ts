/**
 * V-CANVAS-NODE-11: Egress handle positioning
 *
 * The egress handle sits on the card border.
 *
 * Phase: no-data (parallel) - drops a Shell Script plugin onto an empty canvas and
 * measures the handle bounding boxes against the card wrapper.
 *
 * Pass Criteria:
 *   1. Egress (`handle-output`) bounding-box vertical center is within +/- 2 px
 *      of the card wrapper's bottom border (NOT 36 px below).
 *   2. Ingress (`handle-input`) bounding-box vertical center is within +/- 2 px
 *      of the card wrapper's top border (mirror of the egress).
 *   3. Both ingress and egress are horizontally centered on the card wrapper.
 */

import { test, expect, type Page } from '../../helpers/playwright-fixtures'
import { dragPaletteItemToCanvas, waitForCanvasLoad } from '../../helpers/canvas'
import { BACKEND_PORT } from '../../helpers/config'

const PX_TOLERANCE = 2

async function dropShellScript(page: Page) {
  const canvas = page.locator('[data-testid="workflow-canvas"]')
  const cb = await canvas.boundingBox()
  await dragPaletteItemToCanvas(page, 'shell script', { x: cb!.width / 2, y: cb!.height / 2 })
  return page.locator('[data-testid^="workflow-node-"][data-nodetype]').first()
}

test.describe('V-CANVAS-NODE-11: egress handle positioning regression', () => {
  test.beforeEach(async ({ page }) => {
    await page.request.delete(`http://localhost:${BACKEND_PORT}/workbench/session`).catch(() => {})
    await page.goto('/')
    await page.evaluate(() => localStorage.clear())
  })

  test('S1: egress handle vertical center sits on the card bottom border (+/- 2 px)', async ({
    page,
  }) => {
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    const node = await dropShellScript(page)
    await expect(node).toBeVisible()

    const handle = node.locator('[data-testid="handle-output"]')
    await expect(handle).toBeVisible()

    const cardBox = await node.boundingBox()
    const handleBox = await handle.boundingBox()
    expect(cardBox).not.toBeNull()
    expect(handleBox).not.toBeNull()

    const handleCenterY = handleBox!.y + handleBox!.height / 2
    const cardBottom = cardBox!.y + cardBox!.height
    expect(
      Math.abs(handleCenterY - cardBottom),
      `egress center (${handleCenterY}) must be within ${PX_TOLERANCE} px of card bottom (${cardBottom})`,
    ).toBeLessThanOrEqual(PX_TOLERANCE)
  })

  test('S2: ingress handle vertical center sits on the card top border (+/- 2 px)', async ({
    page,
  }) => {
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    const node = await dropShellScript(page)

    const handle = node.locator('[data-testid="handle-input"]')
    await expect(handle).toBeVisible()

    const cardBox = await node.boundingBox()
    const handleBox = await handle.boundingBox()
    expect(cardBox).not.toBeNull()
    expect(handleBox).not.toBeNull()

    const handleCenterY = handleBox!.y + handleBox!.height / 2
    const cardTop = cardBox!.y
    expect(
      Math.abs(handleCenterY - cardTop),
      `ingress center (${handleCenterY}) must be within ${PX_TOLERANCE} px of card top (${cardTop})`,
    ).toBeLessThanOrEqual(PX_TOLERANCE)
  })

  test('S3: both handles are horizontally centered on the card (+/- 2 px)', async ({ page }) => {
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    const node = await dropShellScript(page)

    const ingress = node.locator('[data-testid="handle-input"]')
    const egress = node.locator('[data-testid="handle-output"]')
    await expect(ingress).toBeVisible()
    await expect(egress).toBeVisible()

    const cardBox = await node.boundingBox()
    const inBox = await ingress.boundingBox()
    const outBox = await egress.boundingBox()
    expect(cardBox).not.toBeNull()
    expect(inBox).not.toBeNull()
    expect(outBox).not.toBeNull()

    const cardCenterX = cardBox!.x + cardBox!.width / 2
    const inCenterX = inBox!.x + inBox!.width / 2
    const outCenterX = outBox!.x + outBox!.width / 2

    expect(
      Math.abs(inCenterX - cardCenterX),
      `ingress horizontal center (${inCenterX}) must be within ${PX_TOLERANCE} px of card center (${cardCenterX})`,
    ).toBeLessThanOrEqual(PX_TOLERANCE)
    expect(
      Math.abs(outCenterX - cardCenterX),
      `egress horizontal center (${outCenterX}) must be within ${PX_TOLERANCE} px of card center (${cardCenterX})`,
    ).toBeLessThanOrEqual(PX_TOLERANCE)
  })
})
