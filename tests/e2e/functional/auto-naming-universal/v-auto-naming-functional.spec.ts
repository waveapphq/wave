/**
 * V-AUTO-NAMING (functional): Universal "bare base first, _N afterwards"
 * auto-naming across plugins / controls / local Functions / shared
 * Functions.
 *
 * Pass Criteria:
 *   1. Empty canvas: first plugin Log -> label "Log", second -> "Log_1".
 *   2. Control If-Else (first) -> "If-Else", second -> "If-Else_1".
 *   3. Library Function fetch_user (first) -> "fetch_user",
 *      data.originalLibraryName = "fetch_user"; second -> "fetch_user_1",
 *      data.originalLibraryName still "fetch_user".
 *   4. New local Function (first) -> "Function"; second -> "Function_1".
 *   5. Canvas-wide collision: a plugin labeled "Function" before the local
 *      Function makes the local Function land as "Function_1".
 */

import { test, expect, type Page } from '../../helpers/playwright-fixtures'
import {
  waitForCanvasLoad,
  dragPaletteItemToCanvas,
  dragSourceToCanvas,
  expandPalette,
} from '../../helpers/canvas'
import { BACKEND_URL } from '../../helpers/config'

async function createBlankTest(page: Page): Promise<string> {
  const resp = await page.request.post(`${BACKEND_URL}/tests`, {
    data: {
      name: `V-AUTO-NAMING ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      version: '1.0.0',
      description: 'Universal auto-naming repro',
      workflow: { nodes: [], edges: [] },
      variables: {},
    },
  })
  expect(resp.ok(), `POST /tests: ${resp.status()}`).toBeTruthy()
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

test.describe('V-AUTO-NAMING (functional): universal bare-first then _N labeling', () => {
  test('First instance of any base name lands with the bare base; second gets _1', async ({
    page,
  }) => {
    const testId = await createBlankTest(page)
    await openTest(page, testId)
    await expandPalette(page)

    const canvas = page.locator('[data-testid="workflow-canvas"]')
    const box = await canvas.boundingBox()
    expect(box).toBeTruthy()
    const cx = box!.width * 0.5
    const cy = box!.height * 0.4

    // Scope label assertions to canvas nodes (the palette also renders these
    // labels, which would trip strict-mode locators).
    const canvasNodes = page.locator('[data-testid^="workflow-node-body-"]')

    // First plugin Log -> bare "Log".
    await dragPaletteItemToCanvas(page, 'log', { x: Math.round(cx - 220), y: Math.round(cy) })
    await expect(canvasNodes.filter({ hasText: /^Log$/ })).toHaveCount(1)
    // Second -> "Log_1".
    await dragPaletteItemToCanvas(page, 'log', { x: Math.round(cx), y: Math.round(cy) })
    await expect(canvasNodes.filter({ hasText: /^Log_1$/ })).toHaveCount(1)

    // First If/Else -> "If / Else" (control display name from registry).
    await dragPaletteItemToCanvas(page, 'if', { x: Math.round(cx - 220), y: Math.round(cy + 200) })
    await expect(canvasNodes.filter({ hasText: /^If \/ Else$/ })).toHaveCount(1)
    // Second -> "If / Else_1".
    await dragPaletteItemToCanvas(page, 'if', { x: Math.round(cx), y: Math.round(cy + 200) })
    await expect(canvasNodes.filter({ hasText: /^If \/ Else_1$/ })).toHaveCount(1)
  })

  test('Local Function first -> "Function"; second -> "Function_1"', async ({ page }) => {
    const testId = await createBlankTest(page)
    await openTest(page, testId)
    await expandPalette(page)

    const canvas = page.locator('[data-testid="workflow-canvas"]')
    const box = await canvas.boundingBox()
    expect(box).toBeTruthy()
    const cx = box!.width * 0.5
    const cy = box!.height * 0.5

    const newFnBtn = page.locator('[data-testid="palette-new-block-button"]')
    await expect(newFnBtn).toBeVisible({ timeout: 5_000 })

    await dragSourceToCanvas(page, newFnBtn, { x: Math.round(cx - 200), y: Math.round(cy) })
    await expect(page.getByText('Function', { exact: true }).first()).toBeVisible()
    await dragSourceToCanvas(page, newFnBtn, { x: Math.round(cx + 200), y: Math.round(cy) })
    await expect(page.getByText('Function_1', { exact: true })).toBeVisible()
  })

  test('Canvas-wide collision: plugin named Function bumps next local Fn to Function_1', async ({
    page,
  }) => {
    // Seed a Test with a node already labeled "Function" so the predicate-
    // free collision check forces the next NEW local Function to "Function_1".
    const seedResp = await page.request.post(`${BACKEND_URL}/tests`, {
      data: {
        name: `V-AUTO-NAMING-COLLIDE ${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        version: '1.0.0',
        description: 'Pre-seeded with a Log node labeled "Function"',
        workflow: {
          nodes: [
            {
              id: 'preseed-log',
              type: 'workflowNode',
              position: { x: 100, y: 100 },
              data: {
                label: 'Function',
                elementType: 'log',
                nodeType: 'plugin',
                category: 'system',
                version: '1.0.0',
                expressionFields: ['message'],
                templateFields: [],
                variableExpressionKeys: [],
                config: { values: { message: "'preseed'", level: 'INFO' }, outputBindings: {}, profileBindings: [] },
              },
            },
          ],
          edges: [{ id: 'e-start-preseed', source: 'start-node', target: 'preseed-log' }],
        },
        variables: {},
      },
    })
    expect(seedResp.ok()).toBeTruthy()
    const testId = (await seedResp.json()).data.id
    await openTest(page, testId)
    await expandPalette(page)

    const canvas = page.locator('[data-testid="workflow-canvas"]')
    const box = await canvas.boundingBox()
    expect(box).toBeTruthy()

    const newFnBtn = page.locator('[data-testid="palette-new-block-button"]')
    await dragSourceToCanvas(page, newFnBtn, {
      x: Math.round(box!.width * 0.65),
      y: Math.round(box!.height * 0.5),
    })

    // Canvas-wide collision: the new local Function lands at "Function_1".
    await expect(page.getByText('Function_1', { exact: true })).toBeVisible()
  })
})
