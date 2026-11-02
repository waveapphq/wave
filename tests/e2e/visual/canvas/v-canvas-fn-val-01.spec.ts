/**
 * V-CANVAS-FN-VAL-01: validation badge fires on inner Function nodes
 *
 * REQ: REQ-3.1.2.4 (Function instance + inner-node validation - recursive
 * descent and ancestor alert propagation).
 *
 * Pass Criteria:
 *   1. The drilled-in canvas of a Local Function with an inner Log node
 *      that is missing its required `message` parameter shows the
 *      `NodeValidationAlert` badge on the inner Log node.
 *   2. The badge tooltip mentions the `message` parameter (canonical
 *      format `Configuration incomplete: message`).
 *
 * Note: the BE save validator rejects a Test that carries an inner Log
 * without a `message` (REQUIRED_PARAM_MISSING), so the bad-state cannot
 * be seeded via POST `/tests`. The test instead seeds an empty Function,
 * drills in, drops a fresh Log via the palette (no `message` set), and
 * verifies the FE `compute-node-issues` recursive walk surfaces the
 * NodeValidationAlert badge on the inner node.
 *
 * Phase: fixture (seeds a minimal Test via API; drives the canvas through
 * the browser to drop the inner Log and observe the live badge).
 */

import { test, expect, type Page } from '../../helpers/playwright-fixtures'
import { waitForCanvasLoad, dragPaletteItemToCanvas } from '../../helpers/canvas'
import { BACKEND_URL } from '../../helpers/config'

const OUTER_FN_ID = 'fn-val-1'

function buildSeed(name: string): Record<string, unknown> {
  return {
    name,
    version: '1.0.0',
    description: 'V-CANVAS-FN-VAL-01 seed: empty Local Function (inner Log dropped at runtime)',
    workflow: {
      nodes: [
        {
          id: OUTER_FN_ID,
          type: 'workflowNode',
          position: { x: 300, y: 200 },
          data: {
            label: 'Function_1',
            elementType: 'function',
            nodeType: 'function',
            functionLifecycle: 'local',
            category: 'function',
            version: '1.0.0',
            hasNewerVersion: false,
            expressionFields: [],
            templateFields: [],
            variableExpressionKeys: [],
            config: { values: {}, outputBindings: {}, profileBindings: [] },
            localDefinition: {
              name: 'Function_1',
              workflow: { nodes: [], edges: [] },
              inputs: [],
              outputs: [],
              variables: [],
            },
          },
          measured: { width: 120, height: 62 },
        },
      ],
      edges: [],
    },
    variables: {},
    metadata: {},
  }
}

async function seed(page: Page): Promise<string> {
  const name = `V-CANVAS-FN-VAL-01 ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const resp = await page.request.post(`${BACKEND_URL}/tests`, { data: buildSeed(name) })
  expect(resp.ok(), `POST /tests failed: ${resp.status()}`).toBeTruthy()
  const body = await resp.json()
  return body.data.id
}

async function open(page: Page, testId: string) {
  await page.request.delete(`${BACKEND_URL}/workbench/session`).catch(() => {})
  await page.goto(`/workbench?editTest=${testId}`)
  await page.evaluate(() => localStorage.clear())
  await page.goto(`/workbench?editTest=${testId}`)
  await waitForCanvasLoad(page)
}

test.describe('V-CANVAS-FN-VAL-01: inner-Function validation surfacing', () => {
  test('drilled-in inner Log shows REQUIRED_PARAM_MISSING badge', async ({ page }) => {
    const testId = await seed(page)
    await open(page, testId)

    // Drill into the empty Function. Its inner canvas is empty - the
    // onboarding hint should show.
    const outer = page.locator(`[data-testid="workflow-node-${OUTER_FN_ID}"]`)
    await expect(outer).toBeVisible()
    // Retry the dig-in: under parallel-shard load the synthetic click occasionally
    // does not drill in, so re-issue it until the inner onboarding hint appears.
    const onboardingHint = page.locator('[data-testid="onboarding-hint"]')
    await expect(async () => {
      if (await onboardingHint.isVisible().catch(() => false)) return
      await outer.locator('[data-testid="node-dig-in"]').click({ force: true }).catch(() => {})
      await expect(onboardingHint).toBeVisible({ timeout: 3000 })
    }).toPass({ timeout: 20000 })

    // Drop a fresh Log inside the Function via the palette. Drop midway
    // through the inner canvas so the new node is well clear of any palette
    // / breadcrumb overlay.
    const canvas = page.locator('[data-testid="workflow-canvas"]')
    const cBox = await canvas.boundingBox()
    expect(cBox).toBeTruthy()
    await dragPaletteItemToCanvas(page, 'log', {
      x: Math.round(cBox!.width * 0.5),
      y: Math.round(cBox!.height * 0.5),
    })

    // The inner Log just dropped has no `message`. The recursive
    // compute-node-issues walk must light the NodeValidationAlert
    // badge on the inner node.
    const innerLog = page
      .locator('[data-testid^="workflow-node-"][data-nodetype="plugin"]')
      .first()
    await expect(innerLog).toBeVisible()
    const badge = innerLog.locator('[data-testid="node-validation-alert"]')
    await expect(badge).toBeVisible({ timeout: 10_000 })
    await badge.hover()
    const tooltip = page.locator('[role="tooltip"]').last()
    await expect(tooltip).toBeVisible({ timeout: 5_000 })
    expect((await tooltip.textContent()) ?? '').toContain('message')
  })
})
