/**
 * Edge Drag: Creation, Relocation, Convergence, Cycle Detection
 *
 * Tests T1-T5 for edge creation from handles, relocation to new targets,
 * dynamic ingress convergence, cycle detection, and relinking via "+" handle.
 *
 * REQ: REQ-3.1.1.2 Edge connections and relocation
 */

import { test, expect, type Page } from '../../helpers/playwright-fixtures'
import {
  setupTriangleLayout,
  handleCenter,
  dragNodeBy,
  deselectAll,
} from '../../helpers/edge-drag'
import { waitForCanvasLoad } from '../../helpers/canvas'
import { BACKEND_PORT } from '../../helpers/config'

const BASE = `http://localhost:${BACKEND_PORT}`

function logNode(id: string, x: number, y: number) {
  return {
    id,
    type: 'workflowNode',
    position: { x, y },
    data: {
      label: 'Log',
      elementType: 'log',
      nodeType: 'plugin',
      category: 'system',
      version: '1.0.0',
      description: id,
      expressionFields: ['message'],
      templateFields: [],
      variableExpressionKeys: [],
      config: {
        values: { message: `'${id}'`, level: 'INFO' },
        outputBindings: {},
        profileBindings: [],
      },
    },
  }
}

async function seedAndOpen(
  page: Page,
  name: string,
  nodes: Array<Record<string, unknown>>,
  edges: Array<Record<string, unknown>>,
): Promise<string> {
  await page.request.delete(`${BASE}/workbench/session/`).catch(() => {})
  const fixture = {
    name: `${name} ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    version: '1.0.0',
    description: name,
    workflow: { nodes, edges },
    variables: { mode: { value: 'go', type: 'string', scope: 'test' } },
    metadata: {},
  }
  const resp = await page.request.post(`${BASE}/tests`, { data: fixture })
  const body = await resp.json().catch(() => null)
  expect(resp.ok(), `POST /tests failed: ${resp.status()} - ${JSON.stringify(body)}`).toBeTruthy()
  const testId = body.data?.id ?? body.id

  await page.goto(`/workbench?editTest=${testId}`)
  await page.evaluate(() => localStorage.clear())
  await page.goto(`/workbench?editTest=${testId}`)
  await waitForCanvasLoad(page)
  return testId
}

async function saveWorkflow(page: Page): Promise<void> {
  const toolbarSave = page.locator('[data-testid="toolbar-save-button"]')
  await expect(toolbarSave).toBeEnabled({ timeout: 10_000 })
  await toolbarSave.click()
  await expect(toolbarSave).toBeDisabled({ timeout: 15_000 })
}

async function persistedEdges(
  page: Page,
  testId: string,
): Promise<Array<Record<string, unknown>>> {
  const resp = await page.request.get(`${BASE}/tests/${testId}/workflow`)
  expect(resp.ok(), `GET /tests/${testId}/workflow failed: ${resp.status()}`).toBeTruthy()
  const body = (await resp.json()) as Record<string, unknown>
  const data = (body.data ?? body) as { edges?: Array<Record<string, unknown>> }
  return data.edges ?? []
}

/** Drag from one point to another with enough steps that React Flow's
 *  connection state commits between press and release. */
async function dragBetween(
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
): Promise<void> {
  await page.mouse.move(from.x, from.y)
  await page.waitForTimeout(250)
  await page.mouse.down()
  await page.mouse.move(from.x, from.y + 20, { steps: 4 })
  await page.mouse.move(to.x, to.y, { steps: 15 })
  await page.waitForTimeout(300)
  await page.mouse.up()
  await page.waitForTimeout(400)
}

test.describe('Edge Drag: Creation & Relocation', () => {
  test('T1-T5: edge creation, relocation, convergence, cycle detection, relink via +', async ({ page }) => {
    test.setTimeout(90000)

    // Capture React Flow console errors. The "+" proximity handle's id is
    // the FUTURE stable `ingress_${ingressCount}` (see InputHandles); a transient token
    // would make React Flow log error #008 ("couldn't create edge for target handle")
    // after the convergence drop. The asserts at the end of the test fail if
    // any matching error fired during the convergence sequence below.
    const consoleErrors: string[] = []
    page.on('console', (msg) => {
      if (msg.type() !== 'error' && msg.type() !== 'warning') return
      const text = msg.text()
      if (/error\s*#?\s*008|couldn['']t create edge for target handle|couldn['']t create edge for source handle/i.test(text)) {
        consoleErrors.push(text)
      }
    })

    const { nodeA, nodeB, nodeC, cx, cy, cw, ch } = await setupTriangleLayout(page)

    const aOutput = nodeA.locator('[data-testid="handle-output"]')
    const bInput = nodeB.locator('[data-testid="handle-input"]')
    const cInput = nodeC.locator('[data-testid="handle-input"]')

    // ==================== T1: Edge creation and relocation ====================

    // Step 1: Drag A egress -> C ingress (first connection)
    const aOutPos = await handleCenter(aOutput)
    const cInPos = await handleCenter(cInput)

    await page.mouse.move(aOutPos.x, aOutPos.y)
    await page.mouse.down()
    await page.mouse.move(cInPos.x, cInPos.y, { steps: 15 })
    await page.waitForTimeout(300)
    await page.mouse.up()
    await page.waitForTimeout(300)

    const edgeCountAfterAC = await page.locator('.react-flow__edge').count()
    expect(edgeCountAfterAC, 'Should have edges after A->C').toBeGreaterThanOrEqual(1)

    // Step 2: Relocate from A's occupied egress to B
    const bInPos = await handleCenter(bInput)
    const aOutPos2 = await handleCenter(aOutput)

    await page.mouse.move(aOutPos2.x, aOutPos2.y)
    await page.mouse.down()
    await page.mouse.move(aOutPos2.x, aOutPos2.y + 30, { steps: 3 })
    await page.waitForTimeout(300)

    // Ghost edge X marker should be visible during relocation
    const xLabel = page.locator('.react-flow__edge-text').filter({ hasText: '\u2715' })
    expect(await xLabel.count(), 'Ghost edge should show X marker').toBeGreaterThan(0)

    // Drop on B's input to complete relocation
    await page.mouse.move(bInPos.x, bInPos.y, { steps: 10 })
    await page.waitForTimeout(200)
    await page.mouse.up()
    await page.waitForTimeout(300)

    // Edge count unchanged (relocated, not added)
    expect(await page.locator('.react-flow__edge').count(), 'Relocation: same edge count').toBe(edgeCountAfterAC)

    // Ghost X marker gone
    await expect(
      page.locator('.react-flow__edge-text').filter({ hasText: '\u2715' }),
      'Ghost X marker should disappear'
    ).toHaveCount(0)


    // ==================== T2: Dynamic ingress - add convergence C->B ====================

    // Drag B lower to make room for the convergence edge
    await dragNodeBy(page, nodeB, 0, 80)

    // Fit first, as T3 and T4 do: C's egress can sit below the pane edge, and a press
    // on a clipped handle lands on whatever is painted over it instead.
    await page.locator('.react-flow__controls-fitview').click()
    await page.waitForTimeout(500)

    // Get C's output handle
    const cOutput = nodeC.locator('[data-testid="handle-output"]')
    const cOutPos = await handleCenter(cOutput)

    // The gesture below is only a drag if it starts on the handle, not on whatever
    // is painted where a clipped handle reports itself to be.
    const cOutBox = await cOutput.boundingBox()
    expect(cOutBox, "C's egress handle must be visible").not.toBeNull()
    expect(
      cOutBox!.x >= cx && cOutBox!.x + cOutBox!.width <= cx + cw &&
        cOutBox!.y >= cy && cOutBox!.y + cOutBox!.height <= cy + ch,
      "C's egress handle must lie inside the canvas pane before the drag starts",
    ).toBe(true)

    // Get B's updated position for targeting
    const bBox = await nodeB.boundingBox()
    expect(bBox, 'B must be visible').not.toBeNull()
    const bTopCenter = { x: bBox!.x + bBox!.width / 2, y: bBox!.y }

    // Start dragging from C's egress
    await page.mouse.move(cOutPos.x, cOutPos.y)
    await page.mouse.down()

    // Move near B but OUTSIDE snap range, inside border trigger range.
    // Allow extra settle time under heavy container-shard load - the
    // proximity-detection effect needs the React Flow render to commit
    // before the "+" handle appears.
    await page.mouse.move(bTopCenter.x, bTopCenter.y - 10, { steps: 10 })
    await page.waitForTimeout(1000)

    // Check for the "+" ingress handle on B
    const addHandle = nodeB.locator('[data-testid="handle-input-add"]')
    const addHandleCount = await addHandle.count()

    expect(
      addHandleCount,
      '"+" ingress handle must appear on B during the C->B convergence drag',
    ).toBeGreaterThan(0)

    const addHandlePos = await handleCenter(addHandle)

    // Move onto "+" handle - should snap and pulsate green
    await page.mouse.move(addHandlePos.x, addHandlePos.y, { steps: 5 })
    await page.waitForTimeout(300)

    // This is a NEW-connection drag (no
    // existing edge is being relocated) toward B's "+" handle. The
    // proximity resolver must treat "+" as the snap candidate, NOT the
    // occupied default handle. If it falsely targets the A->B edge as
    // a replacement candidate, an X-marker would appear on A->B. The
    // assertion below catches that.
    const noSpuriousX = page.locator('.react-flow__edge-text').filter({ hasText: '✕' })
    expect(
      await noSpuriousX.count(),
      'No X-marker should appear during new-edge convergence drag',
    ).toBe(0)

    // Drag away from "+" handle - should unsnap
    await page.mouse.move(addHandlePos.x + 100, addHandlePos.y - 100, { steps: 5 })
    await page.waitForTimeout(300)

    // Drag further away - "+" handle should disappear
    await page.mouse.move(cOutPos.x, cOutPos.y - 50, { steps: 5 })
    await page.waitForTimeout(300)
    const addHandleGone = await addHandle.count()
    expect(addHandleGone, '"+" handle should disappear when far from B').toBe(0)

    // Move back to B and drop on the "+" handle. Longer settle timeout
    // because the "+" handle takes a full proximity cycle to re-appear
    // after the previous drag-away.
    await page.mouse.move(bTopCenter.x + 30, bTopCenter.y, { steps: 10 })
    await page.waitForTimeout(1000)

    const addHandleReappeared = nodeB.locator('[data-testid="handle-input-add"]')
    expect(await addHandleReappeared.count(), '"+" handle should reappear near B').toBeGreaterThan(0)

    const addPos = await handleCenter(addHandleReappeared)
    await page.mouse.move(addPos.x, addPos.y, { steps: 5 })
    await page.waitForTimeout(400)
    await page.mouse.up()
    await page.waitForTimeout(600)

    // Verify two edges on B: A->B and C->B. Poll because React Flow's
    // commit after the drop can lag a tick under container CI load.
    const bInputHandles = nodeB.locator('.react-flow__handle-top')
    await expect.poll(
      () => bInputHandles.count(),
      { timeout: 3000, message: 'B should have 2 input handles after convergence' },
    ).toBe(2)

    // Total edge count should have increased by 1
    const finalEdgeCount = await page.locator('.react-flow__edge').count()
    expect(finalEdgeCount, 'Should have one more edge after C->B').toBe(edgeCountAfterAC + 1)


    // ==================== T3: Relocate C-B ingress edge to A ====================

    // Fit first, as T4 does: a block left drifted under the pane edge by T1/T2
    // puts this drag's approach point inside the canvas auto-pan band.
    await page.locator('.react-flow__controls-fitview').click()
    await page.waitForTimeout(500)

    const edgeCountBeforeT3 = await page.locator('.react-flow__edge').count()

    // Grab B's 2nd ingress handle (ingress_1, the C-B edge)
    const bIngress1 = nodeB.locator('[data-testid="handle-input-ingress_1"]')
    const bIngress1Pos = await handleCenter(bIngress1)

    // Start drag from B's 2nd ingress (relocating C-B edge)
    await page.mouse.move(bIngress1Pos.x, bIngress1Pos.y)
    await page.mouse.down()
    await page.mouse.move(bIngress1Pos.x, bIngress1Pos.y - 30, { steps: 3 })
    await page.waitForTimeout(300)

    // Ghost edge should show gray X
    const xMarkerT3 = page.locator('.react-flow__edge-text').filter({ hasText: '\u2715' })
    expect(await xMarkerT3.count(), 'Ghost edge should show X during relocation').toBeGreaterThan(0)

    // Move toward A's top border
    const aBox = await nodeA.boundingBox()
    expect(aBox, 'A must be visible').not.toBeNull()

    const aNearTop = { x: aBox!.x + aBox!.width * 0.3, y: aBox!.y - 15 }
    await page.mouse.move(aNearTop.x, aNearTop.y, { steps: 15 })
    await page.waitForTimeout(500)

    // "+" handle should appear on A
    const aAddHandle = nodeA.locator('[data-testid="handle-input-add"]')

    expect(
      await aAddHandle.count(),
      '"+" ingress handle must appear on A during the C-B relocation drag',
    ).toBeGreaterThan(0)

    const aAddPos = await handleCenter(aAddHandle)
    await page.mouse.move(aAddPos.x, aAddPos.y, { steps: 5 })
    await page.waitForTimeout(300)

    // Drop on A's "+" handle
    await page.mouse.up()
    await page.waitForTimeout(500)

    // Edge count stays the same (relocated, not added)
    const edgeCountAfterT3 = await page.locator('.react-flow__edge').count()
    expect(edgeCountAfterT3, 'Edge count should stay same after relocation').toBe(edgeCountBeforeT3)

    // A should now have 2 ingress handles (Start->A + C->A)
    const aInputHandles = nodeA.locator('.react-flow__handle-top')
    expect(await aInputHandles.count(), 'A should have 2 input handles').toBe(2)

    // B should be back to 1 ingress handle
    const bInputHandlesAfter = nodeB.locator('.react-flow__handle-top')
    expect(await bInputHandlesAfter.count(), 'B should have 1 input handle after relocation').toBe(1)

    await deselectAll(page, cx, cy, cw, ch)


    // ==================== T4: Cycle detection visual feedback ====================

    await page.locator('.react-flow__controls-fitview').click()
    await page.waitForTimeout(500)

    const edgeCountBeforeT4 = await page.locator('.react-flow__edge').count()

    // Drag A's egress toward C (would create A->C->A cycle)
    const aOutPosT4 = await handleCenter(aOutput)

    await page.mouse.move(aOutPosT4.x, aOutPosT4.y)
    await page.waitForTimeout(100)
    await page.mouse.down()
    await page.mouse.move(aOutPosT4.x, aOutPosT4.y + 10, { steps: 3 })
    await page.waitForTimeout(300)

    const xMarkerT4 = page.locator('.react-flow__edge-text').filter({ hasText: '\u2715' })
    expect(await xMarkerT4.count(), 'Ghost edge X should appear during relocation').toBeGreaterThan(0)

    // Move near C's top border
    const cBoxT4 = await nodeC.boundingBox()
    expect(cBoxT4, 'C must be visible').not.toBeNull()
    await page.mouse.move(cBoxT4!.x + cBoxT4!.width * 0.3, cBoxT4!.y - 10, { steps: 15 })
    await page.waitForTimeout(500)

    // C should show red cycle indicator
    const cycleHandle = nodeC.locator('[data-testid="handle-input-cycle"]')
    expect(await cycleHandle.count(), 'C should show red cycle indicator for A->C').toBeGreaterThan(0)

    // Release - no change should happen
    await page.mouse.up()
    await page.waitForTimeout(300)

    const edgeCountAfterCycle = await page.locator('.react-flow__edge').count()
    expect(edgeCountAfterCycle, 'No edge change after cycle rejection').toBe(edgeCountBeforeT4)

    await expect(
      page.locator('.react-flow__edge-text').filter({ hasText: '\u2715' }),
      'Ghost X should disappear after canceled relocation'
    ).toHaveCount(0)

    // --- Test 2: Drag B's egress toward A (cycle: A->B->A) ---
    const bOutputT4 = nodeB.locator('[data-testid="handle-output"]')
    const bOutPosT4 = await handleCenter(bOutputT4)

    await page.mouse.move(bOutPosT4.x, bOutPosT4.y)
    await page.waitForTimeout(100)
    await page.mouse.down()
    await page.mouse.move(bOutPosT4.x, bOutPosT4.y - 10, { steps: 3 })
    await page.waitForTimeout(200)

    // Move toward A's first ingress handle area
    const aBoxT4 = await nodeA.boundingBox()
    expect(aBoxT4, 'A must be visible').not.toBeNull()
    await page.mouse.move(aBoxT4!.x + aBoxT4!.width * 0.3, aBoxT4!.y - 10, { steps: 15 })
    await page.waitForTimeout(500)

    // A should show red cycle indicator
    const aCycleHandle = nodeA.locator('[data-testid="handle-input-cycle"]')
    expect(await aCycleHandle.count(), 'A should show red cycle indicator for B->A').toBeGreaterThan(0)

    // Move toward A's second ingress handle
    await page.mouse.move(aBoxT4!.x + aBoxT4!.width * 0.7, aBoxT4!.y - 10, { steps: 10 })
    await page.waitForTimeout(500)

    expect(await aCycleHandle.count(), 'A should still show red cycle on 2nd handle area').toBeGreaterThan(0)

    await page.mouse.up()
    await page.waitForTimeout(300)

    const edgeCountAfterT4 = await page.locator('.react-flow__edge').count()
    expect(edgeCountAfterT4, 'No edge change after all T4 cycle tests').toBe(edgeCountBeforeT4)

    await deselectAll(page, cx, cy, cw, ch)


    // ==================== T5: Relink Start to C, then back to A via "+" ====================

    // Step 1: Relocate Start's egress from A to C
    const startNodeT5 = page.locator('[data-testid="start-node"]')
    const startBoxT5 = await startNodeT5.boundingBox()
    expect(startBoxT5, 'Start node must be visible').not.toBeNull()
    const startPosT5 = { x: startBoxT5!.x + startBoxT5!.width / 2, y: startBoxT5!.y + startBoxT5!.height }

    const startHandle = page.locator('[data-testid="start-node"] .react-flow__handle')
    const startPos = await handleCenter(startHandle)

    await page.mouse.move(startPosT5.x, startPosT5.y)
    await page.waitForTimeout(100)
    await page.mouse.down()
    await page.mouse.move(startPos.x, startPos.y + 10, { steps: 3 })
    await page.waitForTimeout(300)

    const cInputT5 = nodeC.locator('[data-testid="handle-input"]')
    const cInPosT5 = await handleCenter(cInputT5)

    await page.mouse.move(cInPosT5.x, cInPosT5.y, { steps: 15 })
    await page.waitForTimeout(300)
    await page.mouse.up()
    await page.waitForTimeout(500)

    // A should now have 1 ingress handle (only C->A remains)
    const aInputsAfterRelink = nodeA.locator('.react-flow__handle-top')
    expect(await aInputsAfterRelink.count(), 'A should have 1 ingress after Start relinked to C').toBe(1)

    // Step 2: Relocate Start's egress from C back to A
    const startBoxT5b = await startNodeT5.boundingBox()
    expect(startBoxT5b, 'Start node must be visible').not.toBeNull()
    const startPosT5b = { x: startBoxT5b!.x + startBoxT5b!.width / 2, y: startBoxT5b!.y + startBoxT5b!.height }

    await page.mouse.move(startPosT5b.x, startPosT5b.y)
    await page.waitForTimeout(100)
    await page.mouse.down()
    await page.mouse.move(startPosT5b.x, startPosT5b.y + 10, { steps: 3 })
    await page.waitForTimeout(300)

    // Move near A's top border to trigger "+" handle
    const aBoxT5 = await nodeA.boundingBox()
    expect(aBoxT5, 'A must be visible').not.toBeNull()
    await page.mouse.move(aBoxT5!.x + aBoxT5!.width * 0.3, aBoxT5!.y - 10, { steps: 15 })
    await page.waitForTimeout(500)

    // "+" handle should appear on A
    const aAddHandleT5 = nodeA.locator('[data-testid="handle-input-add"]')
    expect(await aAddHandleT5.count(), '"+" handle should appear on A').toBeGreaterThan(0)

    // Drop on the "+" handle
    const aAddPosT5 = await handleCenter(aAddHandleT5)
    await page.mouse.move(aAddPosT5.x, aAddPosT5.y, { steps: 5 })
    await page.waitForTimeout(200)
    await page.mouse.up()
    // Wait for updateNodeInternals + React Flow edge rendering
    await page.waitForTimeout(1000)

    // A should now have 2 ingress handles: C->A (default) + Start->A (ingress_1)
    const aInputsFinal = nodeA.locator('.react-flow__handle-top')
    expect(await aInputsFinal.count(), 'A should have 2 ingress handles after Start relinked via +').toBe(2)

    // Force React Flow to refresh edge rendering by triggering fitView
    await page.locator('.react-flow__controls-fitview').click()
    await page.waitForTimeout(500)

    // Verify flows: Start->A + C->A + A->B
    const finalEdges = await page.locator('.react-flow__edge').count()
    expect(finalEdges, `Should have 3 edges, got ${finalEdges}`).toBeGreaterThanOrEqual(3)

    await deselectAll(page, cx, cy, cw, ch)

    // === T1-T5 finalization: no React Flow handle-binding errors fired ===
    // With a transient "+" handle id, every convergence
    // drop above would emit error#008. With the stable ingress_${count} id
    // this list must remain empty for the whole test.
    expect(
      consoleErrors,
      `React Flow handle-binding errors fired during edge drag flow: ${consoleErrors.join(' | ')}`,
    ).toEqual([])
  })

  // ==========================================================================
  // T6: lane tooltip must not steal the connection drag
  // ==========================================================================
  //
  // Wrapping a named lane in a tooltip trigger put new pointer handlers on it.
  // Existing edge-drag coverage only ever dragged from the single unnamed
  // `handle-output`, so nothing would have noticed a lane losing its drag.

  test('T6: a named lane is still a connection source (Switch case + Try/Catch try)', async ({
    page,
  }) => {
    const testId = await seedAndOpen(
      page,
      'T6 named lane drag',
      [
        {
          id: 'sw',
          type: 'workflowNode',
          position: { x: 200, y: 120 },
          data: {
            label: 'Switch',
            elementType: 'switch-case',
            nodeType: 'control',
            category: 'conditional',
            version: '1.0.0',
            description: 'lane source',
            expressionFields: [],
            templateFields: [],
            variableExpressionKeys: [],
            config: {
              values: {
                branches: [
                  {
                    id: 'branch_0',
                    type: 'case',
                    label: 'Fast',
                    break: true,
                    conditions: [
                      {
                        type: 'literal',
                        variable: 'mode',
                        value_type: 'string',
                        operator: 'equals',
                        reference_value: 'fast',
                        reference_is_expression: false,
                        id: 't6-c0',
                      },
                    ],
                  },
                  {
                    id: 'branch_1',
                    type: 'case',
                    label: 'Slow',
                    break: true,
                    conditions: [
                      {
                        type: 'literal',
                        variable: 'mode',
                        value_type: 'string',
                        operator: 'equals',
                        reference_value: 'slow',
                        reference_is_expression: false,
                        id: 't6-c1',
                      },
                    ],
                  },
                ],
              },
              outputBindings: {},
              profileBindings: [],
            },
          },
        },
        {
          id: 'tc',
          type: 'workflowNode',
          position: { x: 700, y: 120 },
          data: {
            label: 'Try/Catch',
            elementType: 'try-catch-finally',
            nodeType: 'control',
            category: 'flow',
            version: '1.0.0',
            description: 'lane source 2',
            expressionFields: [],
            templateFields: [],
            variableExpressionKeys: [],
            config: {
              values: { enable_catch: true, enable_finally: false },
              outputBindings: {},
              profileBindings: [],
            },
          },
        },
        logNode('log-slow', 200, 340),
        logNode('log-try', 700, 340),
      ],
      [{ id: 'e-start', source: 'start-node', target: 'sw', type: 'default' }],
    )

    await test.step('Drag from the Switch "Slow" lane onto a block', async () => {
      const lane = page.locator('[data-testid="workflow-node-sw"] [data-testid="handle-output-branch_1"]')
      const target = page.locator('[data-testid="workflow-node-log-slow"] [data-testid="handle-input"]')
      await expect(lane).toHaveAttribute('aria-label', 'Slow')
      await dragBetween(page, await handleCenter(lane), await handleCenter(target))
    })

    await test.step('Drag from the Try/Catch "try" lane onto a block', async () => {
      const lane = page.locator('[data-testid="workflow-node-tc"] [data-testid="handle-output-try"]')
      const target = page.locator('[data-testid="workflow-node-log-try"] [data-testid="handle-input"]')
      await expect(lane).toHaveAttribute('aria-label', 'try')
      await dragBetween(page, await handleCenter(lane), await handleCenter(target))
    })

    await test.step('Both lanes carry their edge in the saved test', async () => {
      await saveWorkflow(page)
      const edges = await persistedEdges(page, testId)
      const summary = JSON.stringify(
        edges.map((e) => ({ s: e.source, h: e.sourceHandle, t: e.target })),
      )
      expect(
        edges.some(
          (e) => e.source === 'sw' && e.sourceHandle === 'branch_1' && e.target === 'log-slow',
        ),
        `the Switch "Slow" lane must own its edge: ${summary}`,
      ).toBeTruthy()
      expect(
        edges.some((e) => e.source === 'tc' && e.sourceHandle === 'try' && e.target === 'log-try'),
        `the Try/Catch "try" lane must own its edge: ${summary}`,
      ).toBeTruthy()
    })
  })

  // ==========================================================================
  // T7: selected node's resize edges must not swallow handle hover
  // ==========================================================================
  //
  // The resizer's inert top/bottom lines sit on the node border at a higher
  // layer; a SELECTED node must still give the handle its hover and drag.

  test('T7: a selected node keeps its handles reachable at their centers', async ({ page }) => {
    const testId = await seedAndOpen(
      page,
      'T7 selected handles',
      [logNode('log-a', 300, 140), logNode('log-b', 300, 380)],
      [{ id: 'e-start', source: 'start-node', target: 'log-a', type: 'default' }],
    )

    const nodeA = page.locator('[data-testid="workflow-node-log-a"]')
    await nodeA.locator('button').first().dispatchEvent('click')
    await expect(nodeA).toHaveAttribute('data-selected', 'true')
    await expect(page.locator('[data-testid="node-resize-wrapper"]')).toHaveCount(1)

    const ownsItsCenter = async (testid: string) => {
      const handle = nodeA.locator(`[data-testid="${testid}"]`)
      const center = await handleCenter(handle)
      return page.evaluate(
        ({ x, y, id }) => {
          const el = document.elementFromPoint(x, y)
          return !!el?.closest(`[data-testid="${id}"]`)
        },
        { ...center, id: testid },
      )
    }

    await test.step('The element at each handle center is the handle itself', async () => {
      expect(await ownsItsCenter('handle-input'), 'ingress handle center is covered').toBeTruthy()
      expect(await ownsItsCenter('handle-output'), 'egress handle center is covered').toBeTruthy()
    })

    await test.step('A drag started at the egress center opens a connection', async () => {
      const source = nodeA.locator('[data-testid="handle-output"]')
      const target = page.locator('[data-testid="workflow-node-log-b"] [data-testid="handle-input"]')
      const from = await handleCenter(source)
      const to = await handleCenter(target)

      await page.mouse.move(from.x, from.y)
      await page.mouse.down()
      await page.mouse.move(from.x, from.y + 25, { steps: 5 })
      await expect(page.locator('.react-flow__connection')).toHaveCount(1, { timeout: 3_000 })
      await page.mouse.move(to.x, to.y, { steps: 15 })
      await page.waitForTimeout(300)
      await page.mouse.up()
      await page.waitForTimeout(400)

      await saveWorkflow(page)
      const edges = await persistedEdges(page, testId)
      expect(
        edges.some((e) => e.source === 'log-a' && e.target === 'log-b'),
        `the drag from a selected node's handle must create the edge: ${JSON.stringify(edges)}`,
      ).toBeTruthy()
    })
  })
})
