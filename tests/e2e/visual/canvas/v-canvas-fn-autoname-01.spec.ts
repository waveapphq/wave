/**
 * V-CANVAS-FN-AUTONAME-01: per-prefix auto-naming for canvas drops
 *
 * REQ: REQ-3.1.1.5 (canvas-block auto-naming)
 * Design Decisions: CANVAS-203 (Function instances auto-named `Function_N`,
 *   counter scoped to the sibling set)
 *
 * Pass Criteria:
 *   1. Dropping three Log nodes labels them ``Log_1``, ``Log_2``, ``Log_3``.
 *   2. Dropping a Shell Script node labels it ``Shell Script`` (counter is per-prefix).
 *   3. Dropping two new Local Functions labels them ``Function_1`` and
 *      ``Function_2``.
 *   4. Drilling into ``Function_1`` and dropping a Log labels it ``Log_1``
 *      (counter is scoped to the active sibling set, not the root tree).
 *
 * Phase: no-data (canvas + palette drops only; seeds via API for a fresh Test).
 */

import { test, expect, type Locator, type Page } from '../../helpers/playwright-fixtures'
import { waitForCanvasLoad, dragPaletteItemToCanvas, expandPalette } from '../../helpers/canvas'
import { BACKEND_URL } from '../../helpers/config'

async function createBlankTest(page: Page): Promise<string> {
  const name = `V-CANVAS-FN-AUTONAME-01 ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const resp = await page.request.post(`${BACKEND_URL}/tests`, {
    data: {
      name,
      version: '1.0.0',
      description: 'Auto-naming repro',
      workflow: { nodes: [], edges: [] },
      variables: {},
    },
  })
  expect(resp.ok(), `POST /tests failed: ${resp.status()}`).toBeTruthy()
  const body = await resp.json()
  return body.data.id
}

async function openTest(page: Page, testId: string) {
  await page.request.delete(`${BACKEND_URL}/workbench/session`).catch(() => {})
  await page.goto(`/workbench?editTest=${testId}`)
  await page.evaluate(() => localStorage.clear())
  await page.goto(`/workbench?editTest=${testId}`)
  await waitForCanvasLoad(page)
}

/**
 * Drag the "New Function" palette handle onto the canvas. Same retry
 * pattern as dragPaletteItemToCanvas so the synthetic DnD doesn't race a
 * React re-render under parallel sharding.
 */
async function dragNewFunctionOnto(page: Page, target: { x: number; y: number }) {
  await expandPalette(page)
  const newFnBtn = page.locator('[data-testid="palette-new-block-button"]')
  await expect(newFnBtn).toBeVisible({ timeout: 5_000 })

  const canvas = page.locator('[data-testid="workflow-canvas"]')
  const createdNodes = page.locator('[data-testid^="workflow-node-"][data-nodetype="function"]')
  const before = await createdNodes.count()

  for (let attempt = 0; attempt < 3; attempt++) {
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    )
    try {
      await newFnBtn.dragTo(canvas, {
        targetPosition: { x: Math.round(target.x), y: Math.round(target.y) },
        force: true,
      })
      await expect(createdNodes).toHaveCount(before + 1, { timeout: 3_000 })
      return
    } catch {
      await page.waitForTimeout(500)
    }
  }
  throw new Error('dragNewFunctionOnto: Function node did not appear after 3 attempts')
}

test.describe('V-CANVAS-FN-AUTONAME-01: per-prefix scoped auto-naming', () => {
  test('per-prefix counters across plugins, controls, and Functions', async ({ page }) => {
    const testId = await createBlankTest(page)
    await openTest(page, testId)
    await expandPalette(page)

    const canvas = page.locator('[data-testid="workflow-canvas"]')
    const box = await canvas.boundingBox()
    expect(box).toBeTruthy()
    const cx = box!.width * 0.5
    const cy = box!.height * 0.5

    // Drop three Log nodes - bare-first naming yields Log, Log_1, Log_2.
    // Spread them out so the node-status-bar action clusters don't overlap
    // (which can intercept later .click() actions on neighbor nodes).
    await dragPaletteItemToCanvas(page, 'log', { x: Math.round(cx - 220), y: Math.round(cy - 200) })
    await dragPaletteItemToCanvas(page, 'log', { x: Math.round(cx), y: Math.round(cy - 200) })
    await dragPaletteItemToCanvas(page, 'log', { x: Math.round(cx + 220), y: Math.round(cy - 200) })
    await expect(
      page.locator('[data-testid^="workflow-node-"]').getByText('Log', { exact: true }),
    ).toBeVisible()
    await expect(page.getByText('Log_1', { exact: true })).toBeVisible()
    await expect(page.getByText('Log_2', { exact: true })).toBeVisible()

    // Drop a Shell Script node - bare-first naming yields the bare "Shell Script" (own prefix).
    await dragPaletteItemToCanvas(page, 'shell script', { x: Math.round(cx - 220), y: Math.round(cy - 50) })
    await expect(
      page.locator('[data-testid^="workflow-node-"]').getByText('Shell Script', { exact: true }),
    ).toBeVisible()

    // Drop two new Local Functions - bare-first naming yields Function,
    // Function_1. Push them well apart so each Function's dig-in glyph is
    // the only thing under that part of the canvas.
    await dragNewFunctionOnto(page, { x: cx - 220, y: cy + 200 })
    await expect(
      page.locator('[data-testid^="workflow-node-"]').getByText('Function', { exact: true }),
    ).toBeVisible()
    await dragNewFunctionOnto(page, { x: cx + 220, y: cy + 200 })
    await expect(page.getByText('Function_1', { exact: true })).toBeVisible()

    // Drill into Function_1 and drop a Log - inside-Function counter is its
    // own, so the inner Log is labeled Log_1 (not Log_4 like the root tree
    // would predict). Use force: true so a transient pointer-events overlap
    // from an adjacent node's status bar doesn't flake the click.
    const fn1: Locator = page
      .locator('[data-testid^="workflow-node-"][data-nodetype="function"]')
      .filter({ hasText: 'Function_1' })
      .first()
    // Drilling can race the just-settled drop; retry the dig-in until the inner
    // (empty) canvas shows its onboarding hint (guarded so we don't re-click
    // once we've already drilled in and the root node is gone).
    const innerHint = page.locator('[data-testid="onboarding-hint"]')
    const digInGlyph = fn1.locator('[data-testid="node-dig-in"]')
    await expect(async () => {
      if (!(await innerHint.isVisible()) && (await digInGlyph.count())) {
        await digInGlyph.click({ force: true, timeout: 2000 })
      }
      await expect(innerHint).toBeVisible({ timeout: 2000 })
    }).toPass({ timeout: 15000 })

    await dragPaletteItemToCanvas(page, 'log', { x: Math.round(cx), y: Math.round(cy) })
    // Inside the Function only inner plugin nodes show; the subtree counter
    // is its own, so the first inner Log is the bare "Log".
    const innerPluginNodes = page.locator('[data-testid^="workflow-node-"][data-nodetype="plugin"]')
    await expect(innerPluginNodes).toHaveCount(1)
    await expect(innerPluginNodes.getByText('Log', { exact: true })).toBeVisible()
  })
})
