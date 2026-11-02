/**
 * V-CTRL-ASSERT-DUP-EGRESS-01: cannot create two edges from the SAME source to
 * the SAME target on a split-mode Assert.
 *
 * The canvas validator already rejects ``source+target`` duplicates for new
 * connections (``use-connection-validator.ts:isDuplicate``), but the
 * relocation/convergence paths in ``connection-on-connect.ts`` and
 * ``connection-end-handler.ts`` only rejected ``cross-scope`` - so a user
 * could relocate an existing edge's target onto a node that the SAME source
 * was already wired to, leaving both pass + fail aiming at one Log. The
 * runtime then no-ops the target because the non-matching branch's skip
 * cascade marks it skipped before the matching branch enqueues it.
 *
 * Pass criteria: after seeding a clean ``Assert(split) -> Log_1, Log_2``
 * graph, an attempt to drag the fail edge's target end onto Log_1 leaves
 * the edge attached to Log_2 (relocation rejected as duplicate). Total
 * edge count stays at 3.
 */
import { test, expect } from '../../helpers/playwright-fixtures'
import { waitForCanvasLoad } from '../../helpers/canvas'
import { getWorkflowNodes } from '../../helpers/edge-drag'
import { BACKEND_URL } from '../../helpers/config'

const ASSERT_ID = 'assert-dup'
const LOG1_ID = 'log-1'
const LOG2_ID = 'log-2'

function buildSeed(name: string): Record<string, unknown> {
  return {
    name,
    version: '1.0.0',
    description: 'Pre-wired Assert(split) -> Log_1 (pass), Log_2 (fail)',
    workflow: {
      nodes: [
        {
          id: ASSERT_ID,
          type: 'workflowNode',
          position: { x: 200, y: 150 },
          data: {
            label: 'Assert_1',
            elementType: 'assert',
            nodeType: 'control',
            category: 'control',
            version: '1.0.0',
            hasNewerVersion: false,
            expressionFields: [],
            templateFields: [],
            variableExpressionKeys: [],
            config: {
              values: {
                mode: 'split',
                assertions: [
                  { id: 'a1', kind: 'literal', expected: 'true', actual: 'true', comparator: 'equals' },
                ],
                fail_current_scope: false,
              },
              outputBindings: {},
              profileBindings: [],
            },
          },
        },
        {
          id: LOG1_ID,
          type: 'workflowNode',
          position: { x: 80, y: 400 },
          data: {
            label: 'Log_1',
            elementType: 'log',
            nodeType: 'plugin',
            version: '1.0.0',
            expressionFields: ['message'],
            templateFields: [],
            variableExpressionKeys: [],
            config: { values: { message: "'l1'", level: 'INFO' }, profileBindings: [], outputBindings: {} },
          },
        },
        {
          id: LOG2_ID,
          type: 'workflowNode',
          position: { x: 400, y: 400 },
          data: {
            label: 'Log_2',
            elementType: 'log',
            nodeType: 'plugin',
            version: '1.0.0',
            expressionFields: ['message'],
            templateFields: [],
            variableExpressionKeys: [],
            config: { values: { message: "'l2'", level: 'INFO' }, profileBindings: [], outputBindings: {} },
          },
        },
      ],
      edges: [
        { id: 'e-start-assert', source: 'start-node', target: ASSERT_ID },
        { id: 'e-assert-pass', source: ASSERT_ID, target: LOG1_ID, sourceHandle: 'pass' },
        { id: 'e-assert-fail', source: ASSERT_ID, target: LOG2_ID, sourceHandle: 'fail' },
      ],
    },
  }
}

test.describe('V-CTRL-ASSERT-DUP-EGRESS-01', () => {
  test('relocating the fail edge onto Log_1 is rejected (Assert.pass already there)', async ({ page }) => {
    const seedName = `V-CTRL-ASSERT-DUP-EGRESS ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const createResp = await page.request.post(`${BACKEND_URL}/tests`, { data: buildSeed(seedName) })
    expect(createResp.ok()).toBeTruthy()
    const testId: string = (await createResp.json()).data.id

    await page.setViewportSize({ width: 1280, height: 900 })
    await page.goto(`/workbench?editTest=${testId}`)
    await page.evaluate(() => localStorage.clear())
    await page.goto(`/workbench?editTest=${testId}`)
    await waitForCanvasLoad(page)

    // Sanity: three edges in the workflow (start->assert, assert.pass->Log_1,
    // assert.fail->Log_2).
    await expect(page.locator('.react-flow__edge')).toHaveCount(3)

    // Identify the fail edge's source-side anchor: the Assert's fail handle.
    // It lives on the Assert node and is exposed via the
    // ``handle-output-fail`` testid. Grab its center.
    const failHandle = page.locator('[data-testid="handle-output-fail"]')
    const failBox = await failHandle.boundingBox()
    expect(failBox).not.toBeNull()
    const failHandleCenter = {
      x: failBox!.x + failBox!.width / 2,
      y: failBox!.y + failBox!.height / 2,
    }

    // Find Log_1's center as the relocation drop target.
    const log1 = getWorkflowNodes(page).filter({ hasText: 'Log_1' }).first()
    const log1Box = await log1.boundingBox()
    expect(log1Box).not.toBeNull()
    const log1Center = { x: log1Box!.x + log1Box!.width / 2, y: log1Box!.y + log1Box!.height / 2 }

    // Drag from the Assert.fail handle to Log_1's center. The drop must not relocate
    // the fail edge from Log_2 to Log_1 (a second edge with the same source+target as
    // the existing Assert.pass->Log_1).
    await page.mouse.move(failHandleCenter.x, failHandleCenter.y)
    await page.mouse.down()
    await page.mouse.move(log1Center.x, log1Center.y, { steps: 15 })
    await page.waitForTimeout(200)
    await page.mouse.up()
    await page.waitForTimeout(400)

    // Edge count must STILL be 3 - the relocation must be rejected because
    // Assert.pass->Log_1 already exists and adding Assert.fail->Log_1 would
    // be a duplicate (same source+target).
    await expect(
      page.locator('.react-flow__edge'),
      'duplicate-target relocation must be rejected; edge count stays at 3',
    ).toHaveCount(3)

    // Save the test and fetch via API to verify the fail edge is still
    // wired to Log_2 (NOT relocated onto Log_1). React Flow's edge id is
    // regenerated with a timestamp during relocation so id comparison is
    // brittle; we verify via the persisted target id instead.
    const saveBtn = page.locator('[data-testid="toolbar-save-button"]')
    if (await saveBtn.isEnabled()) {
      await saveBtn.click()
      await expect(saveBtn).toBeDisabled({ timeout: 10_000 })
    }
    const fetched = await page.request.get(`${BACKEND_URL}/tests/${testId}`)
    expect(fetched.ok()).toBeTruthy()
    const wf = (await fetched.json()).data.workflow as {
      edges: Array<{ source: string; target: string; sourceHandle?: string | null }>
    }
    const failEdges = wf.edges.filter((e) => e.source === ASSERT_ID && e.sourceHandle === 'fail')
    expect(failEdges.length, 'exactly one fail-handle edge').toBe(1)
    expect(failEdges[0].target, 'fail edge must still target Log_2').toBe(LOG2_ID)
  })

  // NOTE: the REPLACE flow (drop ON the existing edge's ingress handle so
  // the existing edge is removed and the dragged edge takes its slot) is
  // exempted from the duplicate rejection by ``isValidConnection``,
  // ``createOnConnectHandler``, and ``relocateToSnapTarget`` (each excludes
  // the replaced edge's id from the duplicate check). It's verified
  // manually rather than from Playwright because React Flow's snap-on-
  // handle detection relies on hover events that synthetic mouse moves
  // don't reliably reproduce.
})
