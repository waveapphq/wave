/**
 * V-FN-VIEW-RENAV (functional): the library View must not touch the Test draft store.
 *
 * The View owns its readiness (requestFitView) and never reads or writes the workbench
 * draft, so browsing away and back shows no leftover Test draft over the synthetic root.
 *
 * REQ: REQ-3.2.1.1
 *
 * Pass Criteria:
 *   1. Opening the View does NOT auto-save a `wave-workbench-draft`.
 *   2. View -> Tests -> View keeps the drilled body, clears the loading overlay,
 *      and preserves any real Test draft (neither restored over the View nor
 *      overwritten).
 *
 * Phase: functional-workflow. Self-seeds a published Function via REST.
 */

import { test, expect } from '../../helpers/playwright-fixtures'
import { publishLibraryFunction, openFunctionView, logNode, startEdge } from '../../helpers/fn-seed'
import { BACKEND_URL } from '../../helpers/config'
import { randomUUID } from 'node:crypto'

const DRAFT_KEY = 'wave-workbench-draft'

/** A leftover Test draft a user might have, with a recognizable marker node. */
const REAL_DRAFT = JSON.stringify({
  nodes: [
    { id: 'start-node', type: 'workflowNode', position: { x: 100, y: 100 }, data: { label: 'Start', elementType: 'start', nodeType: 'control' } },
    {
      id: 'draft-marker',
      type: 'workflowNode',
      position: { x: 100, y: 260 },
      data: {
        label: 'DRAFT-MARKER',
        elementType: 'log',
        nodeType: 'plugin',
        version: '1.0.0',
        displayName: 'DRAFT-MARKER',
        expressionFields: [],
        templateFields: [],
        variableExpressionKeys: [],
        config: { values: {}, profileBindings: [], outputBindings: {} },
      },
    },
  ],
  edges: [],
  viewport: { x: 0, y: 0, zoom: 1 },
  testId: null,
  testName: null,
  isDirty: true,
  variables: [],
})

test.describe('V-FN-VIEW-RENAV (functional): View never touches the Test draft store', () => {
  test('opening the View does not auto-save its synthetic root as a draft', async ({ page, request }) => {
    const fn = await publishLibraryFunction(request, {
      name: `View-Renav-${randomUUID().slice(0, 6)}`,
      workflow: { nodes: [logNode('inner-log', 'Body', "'hi'")], edges: [startEdge('inner-log')] },
    })
    // openFunctionView clears localStorage, so the draft starts empty.
    await openFunctionView(page, fn.functionId, fn.version)
    await expect(page.locator('[data-testid="workflow-node-inner-log"]')).toBeVisible()
    // Give any rogue auto-save effect time to fire before asserting it did not.
    await page.waitForTimeout(1500)
    const draft = await page.evaluate((k) => localStorage.getItem(k), DRAFT_KEY)
    expect(draft, 'the View must not auto-save a workbench draft').toBeNull()
  })

  test('View -> Tests -> View keeps the body and preserves a real Test draft', async ({ page, request }) => {
    const fn = await publishLibraryFunction(request, {
      name: `View-Renav2-${randomUUID().slice(0, 6)}`,
      workflow: { nodes: [logNode('inner-log', 'Body', "'hi'")], edges: [startEdge('inner-log')] },
    })
    const viewUrl = `/workbench?viewFunction=${fn.functionId}&version=${fn.version}`

    // Seed a real Test draft, then open the View WITHOUT clearing localStorage.
    await page.request.delete(`${BACKEND_URL}/workbench/session`).catch(() => {})
    await page.goto('/workbench')
    await page.evaluate(([k, d]) => localStorage.setItem(k, d), [DRAFT_KEY, REAL_DRAFT])
    await page.goto(viewUrl)
    await expect(page.locator('[data-testid="workflow-node-inner-log"]')).toBeVisible({ timeout: 20_000 })
    // The View shows ITS body, not the leftover draft marker.
    await expect(page.locator('[data-testid="workflow-node-draft-marker"]')).toHaveCount(0)

    // Round trip: View -> Tests -> View.
    await page.goto('/tests')
    await expect(page.locator('[data-testid="tests-page"]')).toBeVisible()
    await page.goto(viewUrl)
    await expect(page.locator('[data-testid="workflow-node-inner-log"]')).toBeVisible({ timeout: 20_000 })
    await expect(page.locator('[data-testid="workflow-node-draft-marker"]')).toHaveCount(0)
    // The loading overlay cleared (the View owns its readiness).
    await expect(page.locator('[data-testid="canvas-loading-overlay"]')).toHaveClass(/pointer-events-none/, {
      timeout: 15_000,
    })
    // The real Test draft is preserved across the round trip (not clobbered).
    const draftAfter = await page.evaluate((k) => localStorage.getItem(k), DRAFT_KEY)
    expect(draftAfter, 'the real Test draft must survive the round trip').toContain('draft-marker')
  })
})
