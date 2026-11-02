/**
 * Shared helpers for edge drag interaction tests.
 *
 * Used by edge-drag-create and edge-drag-autoconnect test files.
 */

import { expect, type Page } from '@playwright/test'
import { waitForCanvasBoxStable, waitForCanvasLoad } from './canvas'
import { BACKEND_PORT } from './config'
import { configSheet, openNodeSheet } from './workbench'
import { setStringParam, stringParamBox } from './param-config'

export async function resetWorkbench(page: Page) {
  await page.request.delete(`http://localhost:${BACKEND_PORT}/workbench/session`).catch(() => {})
  await page.goto('/workbench')
  await page.evaluate(() => localStorage.clear())
  await waitForCanvasLoad(page)
}

export async function expandPalette(page: Page) {
  const palette = page.locator('[data-testid="block-palette"]')
  const state = await palette.getAttribute('data-state')
  if (state === 'collapsed') {
    await page.locator('[data-testid="palette-expand-button"]').click()
    await expect(palette).toHaveAttribute('data-state', 'expanded')
    // The palette shares the row with the canvas, so this resized the canvas.
    await waitForCanvasBoxStable(page)
  }
}

export async function collapsePalette(page: Page) {
  const palette = page.locator('[data-testid="block-palette"]')
  const state = await palette.getAttribute('data-state')
  if (state === 'expanded') {
    await page.locator('[data-testid="palette-collapse-button"]').click()
    await expect(palette).toHaveAttribute('data-state', 'collapsed')
    await waitForCanvasBoxStable(page)
  }
}

/**
 * Drag a Log from the palette to an ABSOLUTE page coordinate (the proximity
 * auto-connect tests measure their drop point off a node's own box, so they
 * cannot use the canvas-relative `dragPaletteItemToCanvas`).
 *
 * The drag is retried up to 3 times for the same reason that helper retries:
 * under CPU load the React scheduler can re-render the palette item between
 * dragstart and drop, the drag source is detached, and React Flow never
 * receives a drop, so no node is created at all. Each attempt re-fills the
 * search input and waits two animation frames so the filtered palette has
 * committed and painted before the drag starts.
 */
export async function dropLogAt(page: Page, absX: number, absY: number) {
  await expandPalette(page)
  const searchInput = page.locator('[data-testid="palette-search-input"]')
  const nodes = page.locator('[data-testid^="workflow-node-"][data-nodetype]')
  const nodesBefore = await nodes.count()

  let lastError: unknown
  for (let attempt = 0; attempt < 3; attempt++) {
    await searchInput.fill('log')
    const paletteItem = page.locator('[data-testid="palette-item-log"]')
    await expect(paletteItem).toBeVisible()
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
        )
    )
    const itemBox = await paletteItem.boundingBox()
    expect(itemBox, 'Log palette item must be visible').not.toBeNull()

    await page.mouse.move(itemBox!.x + itemBox!.width / 2, itemBox!.y + itemBox!.height / 2)
    await page.mouse.down()
    await page.mouse.move(absX, absY, { steps: 5 })
    await page.mouse.up()

    try {
      await expect(nodes).toHaveCount(nodesBefore + 1, { timeout: 3000 })
      lastError = undefined
      break
    } catch (e) {
      lastError = e
      await page.waitForTimeout(500)
    }
  }
  if (lastError !== undefined) throw lastError

  await searchInput.fill('')
  await collapsePalette(page)
}

export async function handleCenter(handle: ReturnType<Page['locator']>) {
  const box = await handle.boundingBox()
  expect(box, 'Handle must be visible').not.toBeNull()
  return { x: box!.x + box!.width / 2, y: box!.y + box!.height / 2 }
}

export async function nodeCenter(node: ReturnType<Page['locator']>) {
  const box = await node.boundingBox()
  expect(box, 'Node must be visible').not.toBeNull()
  return { x: box!.x + box!.width / 2, y: box!.y + box!.height / 2 }
}

export function getWorkflowNodes(page: Page) {
  return page.locator(
    '[data-testid^="workflow-node-"][data-nodetype]:not([data-testid="workflow-node-start"])'
  )
}

/**
 * Label a node by clicking the cog button to open the config modal, setting the
 * description, and saving. Double-click on a plugin/control
 * node does not open the config modal; the cog in the persistent status bar
 * is the canonical entry point.
 */
export async function labelNode(page: Page, node: ReturnType<Page['locator']>, name: string) {
  // Select the node so its bar is interactive.
  await node.locator('button').first().dispatchEvent('click')
  // Click the per-node cog (always visible in the status bar).
  await openNodeSheet(page, node)

  const description = page.locator('[data-testid="element-description-input"]')
  await expect(description).toBeVisible()
  await description.fill(name)

  // Fill the required Message field so Save is enabled, only when the row is there and empty.
  const sheet = configSheet(page)
  const message = stringParamBox(sheet, 'message')
  if ((await message.count()) > 0 && (await message.inputValue()) === '') {
    await setStringParam(sheet, page, 'message', name)
  }

  // The sheet mounts in the page's sheet layer, which sits before the toolbar, so
  // the modal's Save has to be taken from the sheet and not by page order.
  await sheet.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(description).not.toBeVisible({ timeout: 5000 })
}

/**
 * Drag a node to a new position by offset from its current center.
 */
export async function dragNodeBy(page: Page, node: ReturnType<Page['locator']>, dx: number, dy: number) {
  const center = await nodeCenter(node)
  await page.mouse.move(center.x, center.y)
  await page.mouse.down()
  await page.mouse.move(center.x + dx, center.y + dy, { steps: 10 })
  await page.mouse.up()
  await page.waitForTimeout(300)
}

/**
 * Set up a triangle layout with 3 Log nodes (A, B, C) and connect Start->A.
 * Returns the nodes and canvas bounds for use in tests.
 */
export async function setupTriangleLayout(page: Page) {
  await page.setViewportSize({ width: 1280, height: 900 })
  await resetWorkbench(page)

  // Collapse variable manager. It shares a resizable row with the canvas, so
  // every coordinate below is stale until the collapse has committed AND the
  // canvas has finished growing into the freed width.
  await page.locator('button[aria-label="Collapse Variable Manager"]').click()
  await expect(page.locator('[data-testid="variable-manager"]')).toHaveAttribute(
    'data-state',
    'collapsed',
  )
  await waitForCanvasBoxStable(page)

  // Get canvas bounds
  const canvas = page.locator('[data-testid="workflow-canvas"]')
  // Read while the palette is still collapsed, so the three dropLogAt calls below are
  // computed against the pre-expansion canvas and the triangle sits left of nominal center.
  const cBox = await canvas.boundingBox()
  expect(cBox, 'Canvas must be visible').not.toBeNull()
  const cx = cBox!.x
  const cy = cBox!.y
  const cw = cBox!.width
  const ch = cBox!.height

  // Triangle layout:
  //    Start
  //      |
  //      A        (centered)
  //     / \
  //    B   C      (B=left, C=right)
  const midX = cx + cw / 2
  const spacingL = Math.min(180, cw * 0.2)
  const spacingR = Math.min(280, cw * 0.3)
  await dropLogAt(page, midX, cy + ch * 0.42)                // A - center
  await dropLogAt(page, midX - spacingL, cy + ch * 0.82)     // B - bottom-left
  await dropLogAt(page, midX + spacingR, cy + ch * 0.82)     // C - bottom-right

  const nodes = getWorkflowNodes(page)
  expect(await nodes.count(), 'Expected 3 Log nodes').toBe(3)

  const nodeA = nodes.nth(0)
  const nodeB = nodes.nth(1)
  const nodeC = nodes.nth(2)

  // Label nodes A, B, C
  await labelNode(page, nodeA, 'A')
  await labelNode(page, nodeB, 'B')
  await labelNode(page, nodeC, 'C')

  // Deselect all by clicking empty canvas area
  await page.mouse.click(cx + cw * 0.9, cy + ch * 0.2)
  await page.waitForTimeout(200)

  // Connect Start -> A
  const startHandle = page.locator('[data-testid="start-node"] .react-flow__handle')
  const aInput = nodeA.locator('[data-testid="handle-input"]')
  const startPos = await handleCenter(startHandle)
  const aInPos = await handleCenter(aInput)
  await page.mouse.move(startPos.x, startPos.y)
  await page.mouse.down()
  await page.mouse.move(aInPos.x, aInPos.y, { steps: 10 })
  await page.waitForTimeout(200)
  await page.mouse.up()
  await page.waitForTimeout(300)

  return { nodeA, nodeB, nodeC, cx, cy, cw, ch }
}

/**
 * Click an empty canvas area to deselect all nodes.
 */
export async function deselectAll(page: Page, cx: number, cy: number, cw: number, ch: number) {
  await page.mouse.click(cx + cw * 0.9, cy + ch * 0.2)
  await page.waitForTimeout(200)
}
