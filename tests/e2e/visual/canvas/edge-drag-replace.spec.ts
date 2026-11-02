/**
 * Edge Drag: Relocate-with-Replace
 *
 * When the user drags an existing edge and drops it onto an ALREADY-OCCUPIED
 * ingress handle of another node, the previously-occupying edge must be
 * deleted (replaced), not preserved alongside the relocated edge.
 *
 * Scenario:
 *   1. Linear chain A->B->C
 *   2. Drag A's egress upward off B, drop it on C's default ingress handle
 *      (which is occupied by B->C).
 *   3. Expected: A->C is the only user edge that survives the drop; B->C is gone.
 *   4. Guarded failure: A->C is added and B->C remains, so C has two ingress.
 *
 * The drop exercises the snap-target path in
 * `connection-end-handler.ts::relocateToSnapTarget`: the user releases the
 * mouse over the target node's body rather than exactly on the handle's
 * 4x16 px hit-box, so React Flow's `onConnect` does NOT fire; instead
 * `processConnectEnd` finalizes via the snap target. The replace semantics
 * must therefore be applied in that handler.
 *
 * To keep the setup deterministic the chain is seeded via POST /tests and
 * loaded via `editTest=`, so the test exercises only the drag operation.
 */

import { test, expect, type Page } from '../../helpers/playwright-fixtures'
import { waitForCanvasLoad } from '../../helpers/canvas'
import { BACKEND_PORT } from '../../helpers/config'

const TEST_ID = 'abcde000-0000-0000-0000-000000000301'

function buildChainFixture() {
  const now = new Date().toISOString().replace('Z', '')
  const logNode = (id: string, x: number, y: number, description: string) => ({
    id,
    type: 'workflowNode',
    position: { x, y },
    data: {
      label: 'Log',
      elementType: 'log',
      nodeType: 'plugin',
      category: 'core',
      version: '1.0.0',
      description,
      hasNewerVersion: false,
      expressionFields: [],
      templateFields: [],
      variableExpressionKeys: [],
      config: {
        values: { message: '"hello"', level: 'INFO' },
        outputBindings: {},
        profileBindings: [],
      },
    },
  })
  return {
    name: `relocate-replace ${Date.now()}`,
    id: TEST_ID,
    version: '1.0.0',
    description: 'Linear chain A->B->C seeded for relocate-replace test',
    workflow: {
      nodes: [
        logNode('a', 200, 100, 'A'),
        logNode('b', 200, 300, 'B'),
        logNode('c', 500, 300, 'C'),
      ],
      edges: [
        { id: 'e-start-a', source: 'start-node', target: 'a', type: 'default' },
        { id: 'e-a-b', source: 'a', target: 'b', type: 'default' },
        { id: 'e-b-c', source: 'b', target: 'c', type: 'default' },
      ],
    },
    variables: {},
    metadata: {},
    created_at: now,
    updated_at: now,
  }
}

async function seedChain(page: Page): Promise<string> {
  await page.request.delete(`http://localhost:${BACKEND_PORT}/workbench/session`).catch(() => {})
  const resp = await page.request.post(`http://localhost:${BACKEND_PORT}/tests`, {
    data: buildChainFixture(),
  })
  const body = await resp.json().catch(() => null)
  expect(body?.success === true, `POST /tests failed: ${resp.status()} - ${JSON.stringify(body)}`).toBeTruthy()
  return body.data.id
}

test.describe('Edge Drag: Relocate with Replace', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await page.evaluate(() => localStorage.clear())
  })

  test('relocating an edge onto an occupied handle deletes the existing edge', async ({ page }) => {
    test.setTimeout(60000)

    const testId = await seedChain(page)
    await page.goto(`/workbench?editTest=${testId}`)
    await waitForCanvasLoad(page)

    const nodeA = page.locator('[data-testid="workflow-node-a"]')
    const nodeB = page.locator('[data-testid="workflow-node-b"]')
    const nodeC = page.locator('[data-testid="workflow-node-c"]')
    await expect(nodeA).toBeVisible()
    await expect(nodeB).toBeVisible()
    await expect(nodeC).toBeVisible()

    // Sanity: 3 user edges seeded (start->a, a->b, b->c).
    const edges = page.locator('.react-flow__edge')
    await expect.poll(() => edges.count(), { timeout: 5000 }).toBe(3)

    // ==== ACT: drag A's egress edge onto C's default ingress handle ====
    //
    // The dynamic multi-handle layout shifts C's default handle once the
    // relocation drag enters C's proximity: while only B->C is connected
    // (`ingressCount=1`) the handle sits centered at 50%, but the moment
    // proximity engages a "+" companion handle appears and the default
    // handle slides to (1/(2+1)) = 33%. A screen X computed from C's bounding
    // box lands a few pixels off the handle's hitbox, and the snap fires only
    // when the cursor is over the post-shift handle's DOM box.
    //
    // We solve the targeting problem by driving the drag in two phases:
    //   1. Phase A: move toward an approximate left-of-C target so that
    //      `connection-mousemove-handlers.ts` ticks the relocation
    //      proximity path and the layout shift renders.
    //   2. Phase B: re-locate the default handle's DOM element now that
    //      it has been repositioned, and move the cursor to its visual
    //      center. This guarantees the snap-to-occupied-handle path
    //      fires regardless of any sub-pixel rounding in the leftPct math.
    const aOut = nodeA.locator('[data-testid="handle-output"]')
    const aOutBox = await aOut.boundingBox()
    expect(aOutBox).not.toBeNull()
    const aOutCenter = { x: aOutBox!.x + aOutBox!.width / 2, y: aOutBox!.y + aOutBox!.height / 2 }

    const nodeCBox = await nodeC.boundingBox()
    expect(nodeCBox).not.toBeNull()
    // Phase-A target: well into the left half of C's top border. This is
    // far enough inside C that the proximity check engages, but to the
    // left of where the post-shift handle ends up so we deliberately
    // miss it on this pass.
    const cProximityTarget = {
      x: nodeCBox!.x + nodeCBox!.width * 0.2,
      y: nodeCBox!.y + 2,
    }

    await page.mouse.move(aOutCenter.x, aOutCenter.y)
    await page.mouse.down()
    await page.mouse.move(
      (aOutCenter.x + cProximityTarget.x) / 2,
      (aOutCenter.y + cProximityTarget.y) / 2,
      { steps: 10 },
    )
    await page.waitForTimeout(300)
    await page.mouse.move(cProximityTarget.x, cProximityTarget.y, { steps: 10 })
    await page.waitForTimeout(300)

    // Phase-B: now that the layout has shifted, re-locate C's default
    // ingress handle and move the cursor exactly to its center. The
    // `handle-input` testid is rendered for the FIRST input handle
    // (no `ingress_N` suffix on the default handle - per
    // input-handles.tsx:111 + L48 the first handle's testid is
    // unconditionally `handle-input`).
    const cDefaultHandle = nodeC.locator('[data-testid="handle-input"]')
    await cDefaultHandle.waitFor({ state: 'visible', timeout: 2000 })
    const cHandleBox = await cDefaultHandle.boundingBox()
    expect(cHandleBox, 'C default-ingress handle should have a bounding box mid-drag').not.toBeNull()
    const cHandleCenter = {
      x: cHandleBox!.x + cHandleBox!.width / 2,
      y: cHandleBox!.y + cHandleBox!.height / 2,
    }
    await page.mouse.move(cHandleCenter.x, cHandleCenter.y, { steps: 6 })
    await page.waitForTimeout(300)

    // === MID-DRAG: TWO X-markers visible (both edges are ghosts) ===
    // Before releasing the mouse: the relocating A->B edge AND the
    // about-to-be-replaced B->C edge must both render as muted dashed
    // ghosts with an X label. This is the visual cue the user described
    // as "both edges turn ghost"; without it the user can't tell the
    // existing edge is doomed before they commit the drop.
    const xMarkers = page.locator('.react-flow__edge-text').filter({ hasText: '✕' })
    await expect.poll(
      () => xMarkers.count(),
      { timeout: 2000, message: 'Both relocating edge and replacement edge should show X mid-drag' },
    ).toBe(2)

    await page.mouse.up()
    await page.waitForTimeout(500)

    // ==== ASSERT: B->C deleted, A->C took over ====
    // Two edges total: start->a and a->c.
    await expect.poll(() => edges.count(), { timeout: 5000 }).toBe(2)

    // C has exactly ONE ingress handle (the default) - no convergence handle.
    const cInputHandles = nodeC.locator('.react-flow__handle-top')
    expect(await cInputHandles.count(), 'C should have a single ingress after replace').toBe(1)

    // B has exactly ONE ingress handle and B->C is gone (B is now a leaf
    // with no outgoing edge in the workflow).
    const bInputHandles = nodeB.locator('.react-flow__handle-top')
    expect(await bInputHandles.count(), 'B should have a single ingress handle').toBe(1)
  })
})
