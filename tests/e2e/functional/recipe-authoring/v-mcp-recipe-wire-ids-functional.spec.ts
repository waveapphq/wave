/**
 * V-MCP-RECIPE-WIRE-IDS-FUNCTIONAL: every wire a recipe makes has its own id, so
 * several branches that meet the same next Block are all drawn
 * Wireframes: none (wiring of the existing canvas)
 * Design Decisions: none (compiled wire ids)
 * REQ: REQ-5.2.7.3
 *
 * Pass Criteria:
 * 1. create_test_from_recipe stores an If/Else whose IF, ELSE IF and ELSE hold no
 *    steps, followed by a Log, with a wire from each of the three branch handles
 *    into the Log, and no two stored wires share an id.
 * 2. On the canvas each stored wire into the Log is drawn once, under its own id,
 *    and its line leaves from the dot of its own branch.
 *
 * Run: ./scripts/e2e/e2e-targeted-local.sh functional/recipe-authoring/v-mcp-recipe-wire-ids-functional.spec.ts
 */

import { test, expect } from '../../helpers/playwright-fixtures'
import { BACKEND_PORT, BACKEND_URL, ensureEnvironment } from '../../helpers/config'
import { deleteTest, getTest, runToken } from '../../helpers/element-types'
import { openTest } from '../../helpers/fn-seed'
import { callTool, enableMcpUntilRestart, resetMcpSettings } from '../../helpers/mcp'
import { resetOwnership } from '../../helpers/ownership'
import { edgeOnCanvas, laneExit, lineStart } from '../canvas-lanes/lanes-helpers'

// One MCP port per stack so host-mode parallel workers never collide.
const MCP_PORT = Number(BACKEND_PORT) + 765

interface StoredWire {
  id: string
  source: string
  target: string
  sourceHandle?: string
  targetHandle?: string
}

/** An If/Else whose three branches hold no steps, then a Log every branch reaches. */
function recipeFor(name: string): string {
  return `test:
  name: ${name}
  description: Branches with no steps before a Log
variables:
  health: {type: integer, value: 200}
flow:
  - if:
      label: Route by health
      if_label: Healthy
      when: "health == 200"
      then: []
      elif:
        - label: Degraded
          when: "health == 500"
          then: []
      else_label: Down
      else: []
  - block: log
    label: After routing
    settings: {message: Routed}
`
}

test.describe('V-MCP-RECIPE-WIRE-IDS-FUNCTIONAL: branches that meet one Block each keep their wire', () => {
  let testId = ''

  test.beforeEach(async ({ request }) => {
    await resetOwnership(request)
  })

  test.afterEach(async ({ page, request }) => {
    await request.delete(`${BACKEND_URL}/workbench/session/`).catch(() => undefined)
    if (testId) await deleteTest(request, testId)
    testId = ''
    await resetOwnership(request)
    await resetMcpSettings(page)
  })

  test('each empty branch has its own wire into the Log, stored and drawn', async ({ page, request }) => {
    test.setTimeout(180_000)
    await ensureEnvironment(request)
    await enableMcpUntilRestart(page, MCP_PORT)

    let ifId = ''
    let logId = ''
    let into: StoredWire[] = []

    await test.step('the stored Test has one wire per branch and no repeated wire id', async () => {
      const created = callTool(MCP_PORT, 'create_test_from_recipe', {
        recipe: recipeFor(`zz-mcp-wire-ids-${runToken()}`),
      })
      expect(created.payload.created, JSON.stringify(created.payload)).toBe(true)
      testId = created.payload.test_id as string

      const workflow = (await getTest(request, testId)).workflow
      const nodes = workflow.nodes as Array<Record<string, any>>
      const wires = workflow.edges as StoredWire[]
      const ifNode = nodes.find((node) => node.data.elementType === 'if-else')
      const logNode = nodes.find((node) => node.data.elementType === 'log')
      expect(ifNode, 'the If/Else is stored').toBeTruthy()
      expect(logNode, 'the Log is stored').toBeTruthy()
      ifId = ifNode?.id as string
      logId = logNode?.id as string

      const ids = wires.map((wire) => wire.id)
      const repeated = ids.filter((id, index) => ids.indexOf(id) !== index)
      expect(repeated, `stored wires: ${JSON.stringify(wires)}`).toEqual([])

      const branches = (ifNode?.data.config.values.branches as Array<{ id: string }>).map((b) => b.id)
      expect(branches).toEqual(['branch_0', 'branch_1', 'branch_2'])
      into = wires.filter((wire) => wire.source === ifId && wire.target === logId)
      expect(into.map((wire) => wire.sourceHandle).sort(), JSON.stringify(into)).toEqual(branches)
    })

    await test.step('the canvas draws each of those wires from its own branch dot', async () => {
      await openTest(page, testId)
      await expect(page.locator(`[data-testid="workflow-node-${logId}"]`)).toBeVisible()
      await expect
        .soft(edgeOnCanvas(page, ifId, logId), 'one drawn wire per stored wire into the Log')
        .toHaveCount(into.length)
      for (const wire of into) {
        const drawn = page.locator(`[data-testid="rf__edge-${wire.id}"]`)
        await expect.soft(drawn, `wire ${wire.id} is drawn once`).toHaveCount(1)
        if ((await drawn.count()) !== 1) continue
        const start = await lineStart(drawn)
        const exit = await laneExit(page, ifId, wire.sourceHandle ?? null)
        expect
          .soft(
            Math.hypot(start.x - exit.x, start.y - exit.y),
            `wire ${wire.id} leaves the ${wire.sourceHandle} dot (${JSON.stringify(exit)}), not ${JSON.stringify(start)}`,
          )
          .toBeLessThanOrEqual(2)
      }
    })
  })
})
