/**
 * V-CANVAS-VALIDATION-ALERT: the node-validation-alert icon is a real
 * hover tooltip (ConditionalTooltip) with a bulleted per-issue body.
 *
 * Pass Criteria:
 *   1. Trigger a missing-required-param state on a Log node (Log without
 *      a `message` value).
 *   2. The alert badge is present and hoverable.
 *   3. Hovering surfaces a ConditionalTooltip (role=tooltip) with
 *      a title like "Configuration incomplete" + a bulleted list of
 *      per-issue messages naming the parameter (`message`).
 */

import { test, expect, type Page, type APIRequestContext } from '../../helpers/playwright-fixtures'
import { waitForCanvasLoad, dragPaletteItemToCanvas, expandPalette } from '../../helpers/canvas'
import { BACKEND_URL } from '../../helpers/config'

// POST /tests rejects a Log missing its required `message`
// (REQUIRED_PARAM_MISSING), so the broken node is built by DRAGGING a fresh
// Log from the palette - it lands unconfigured and surfaces the design-time
// validation alert without needing to save.
async function createBlankTest(request: APIRequestContext): Promise<string> {
  const resp = await request.post(`${BACKEND_URL}/tests`, {
    data: {
      name: `V-CANVAS-VALIDATION-ALERT ${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      version: '1.0.0',
      description: 'Blank Test - a Log is dragged in unconfigured',
      workflow: { nodes: [], edges: [] },
      variables: {},
      metadata: {},
    },
  })
  const body = await resp.json()
  expect(body?.success).toBeTruthy()
  return body.data.id
}

async function openTest(page: Page, testId: string) {
  await page.request.delete(`${BACKEND_URL}/workbench/session`).catch(() => {})
  await page.goto(`/workbench?editTest=${testId}`)
  await page.evaluate(() => localStorage.clear())
  await page.goto(`/workbench?editTest=${testId}`)
  await waitForCanvasLoad(page)
}

test.describe('V-CANVAS-VALIDATION-ALERT (visual): tooltip is hoverable + per-issue body', () => {
  test('Hovering the alert icon surfaces a tooltip with per-issue text', async ({
    page,
    request,
  }) => {
    const testId = await createBlankTest(request)
    await openTest(page, testId)

    // Drag a fresh Log onto the canvas; it lands without a `message`, so the
    // design-time validation alert appears.
    await expandPalette(page)
    const canvas = page.locator('[data-testid="workflow-canvas"]')
    const box = await canvas.boundingBox()
    expect(box).toBeTruthy()
    await dragPaletteItemToCanvas(page, 'log', {
      x: Math.round(box!.width * 0.5),
      y: Math.round(box!.height * 0.45),
    })
    const node = page.locator('[data-testid^="workflow-node-"][data-nodetype="plugin"]').first()
    await expect(node).toBeVisible()

    // The validation alert icon is part of the node status bar.
    const alert = node.locator('[data-testid="node-validation-alert"]').first()
    await expect(alert, 'node must surface validation alert when required param missing').toBeVisible({
      timeout: 5_000,
    })

    // Confirm the alert is hoverable (no pointer-events:none in its tree).
    const pe = await alert.evaluate((el) => window.getComputedStyle(el as Element).pointerEvents)
    expect(pe, `alert pointer-events must NOT be 'none'; got ${pe}`).not.toBe('none')

    await alert.hover()

    // ConditionalTooltip renders role=tooltip.
    const tooltip = page.locator('[role="tooltip"]').last()
    await expect(tooltip).toBeVisible({ timeout: 5_000 })
    const text = (await tooltip.textContent()) ?? ''
    expect(
      /Configuration incomplete|incomplete|missing/i.test(text),
      `tooltip should describe the validation issue; got "${text}"`,
    ).toBe(true)
    expect(
      /message/i.test(text),
      `tooltip body should name the parameter (message); got "${text}"`,
    ).toBe(true)
  })
})
