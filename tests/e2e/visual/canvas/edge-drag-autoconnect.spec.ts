/**
 * Edge Drag: Element Proximity Auto-Connect
 *
 * Tests T10 for automatic edge creation when dropping palette elements
 * near existing nodes (within ~100px proximity).
 *
 * REQ: REQ-3.1.1.2 Edge connections and relocation
 */

import { test, expect } from '../../helpers/playwright-fixtures'
import {
  resetWorkbench,
  expandPalette,
  collapsePalette,
} from '../../helpers/edge-drag'
import { waitForCanvasLoad } from '../../helpers/canvas'
import { BACKEND_PORT } from '../../helpers/config'

const BASE = `http://localhost:${BACKEND_PORT}`

function switchCase(id: string, label: string, value: string) {
  return {
    id,
    type: 'case',
    label,
    break: true,
    conditions: [
      {
        type: 'literal',
        variable: 'mode',
        value_type: 'string',
        operator: 'equals',
        reference_value: value,
        reference_is_expression: false,
        id: `ac-${id}`,
      },
    ],
  }
}

test.describe('Edge Drag: Auto-Connect', () => {
  test('T10: palette drop auto-connect and no-connect scenarios', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    await resetWorkbench(page)

    // Step 1: Drop an HTTP node near Start (onto the empty-state placeholder).
    // This should auto-connect Start -> HTTP
    await expandPalette(page)
    const searchInput = page.locator('[data-testid="palette-search-input"]')
    await searchInput.fill('http')
    await page.waitForTimeout(150)

    const startBox = await page.locator('[data-testid="start-node"]').boundingBox()
    expect(startBox).not.toBeNull()
    // Drop just below Start (within 100px proximity)
    const dropBelowStart = {
      x: startBox!.x + startBox!.width / 2,
      y: startBox!.y + startBox!.height + 60,
    }

    const httpItem = page.locator('[data-testid="palette-item-http-client"]')
    const httpBox = await httpItem.boundingBox()
    expect(httpBox).not.toBeNull()
    await page.mouse.move(httpBox!.x + httpBox!.width / 2, httpBox!.y + httpBox!.height / 2)
    await page.mouse.down()
    await page.mouse.move(dropBelowStart.x, dropBelowStart.y, { steps: 5 })
    await page.mouse.up()
    await page.waitForTimeout(400)

    await searchInput.fill('')
    await collapsePalette(page)

    // Verify: Start -> HTTP auto-connected
    const edgesAfterDrop1 = await page.locator('.react-flow__edge').count()
    expect(edgesAfterDrop1, 'T10 step 1: Start should auto-connect to HTTP').toBeGreaterThanOrEqual(1)


    // Step 2: Drop a Shell Script node far from everything (no auto-connect)
    await expandPalette(page)
    await searchInput.fill('shell script')
    await page.waitForTimeout(150)

    const shellItem = page.locator('[data-testid="palette-item-shell-script"]')
    const shellBox = await shellItem.boundingBox()
    expect(shellBox).not.toBeNull()
    // Drop far bottom-left corner, well away from Start/HTTP chain
    const canvasEl = page.locator('[data-testid="workflow-canvas"]')
    const canvasBox = await canvasEl.boundingBox()
    expect(canvasBox).not.toBeNull()
    const farDrop = {
      x: canvasBox!.x + 150,
      y: canvasBox!.y + canvasBox!.height - 50,
    }
    await page.mouse.move(shellBox!.x + shellBox!.width / 2, shellBox!.y + shellBox!.height / 2)
    await page.mouse.down()
    await page.mouse.move(farDrop.x, farDrop.y, { steps: 5 })
    await page.mouse.up()
    await page.waitForTimeout(400)

    await searchInput.fill('')
    await collapsePalette(page)

    // Edge count should NOT increase (no auto-connect)
    const edgesAfterDrop2 = await page.locator('.react-flow__edge').count()
    expect(edgesAfterDrop2, 'T10 step 2: Shell Script should NOT auto-connect').toBe(edgesAfterDrop1)
  })

  // ==========================================================================
  // T11: auto-connect wires the lane the pointer is under
  // ==========================================================================
  //
  // A drop under an outer lane of a wide Switch wires that lane, not lane 1.

  test('T11: dropping under the third lane wires that lane, not the first', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    await page.request.delete(`${BASE}/workbench/session/`).catch(() => {})

    const fixture = {
      name: `T11 auto-connect lane ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      version: '1.0.0',
      description: 'A wide Switch whose outer lanes must be reachable by proximity.',
      workflow: {
        nodes: [
          {
            id: 'sw',
            type: 'workflowNode',
            position: { x: 260, y: 160 },
            data: {
              label: 'Switch',
              elementType: 'switch-case',
              nodeType: 'control',
              category: 'conditional',
              version: '1.0.0',
              description: 'wide switch',
              expressionFields: [],
              templateFields: [],
              variableExpressionKeys: [],
              config: {
                values: {
                  branches: [
                    switchCase('branch_0', 'one', 'a'),
                    switchCase('branch_1', 'two', 'b'),
                    switchCase('branch_2', 'three', 'c'),
                  ],
                },
                outputBindings: {},
                profileBindings: [],
              },
            },
          },
          {
            id: 'log-free',
            type: 'workflowNode',
            position: { x: 260, y: 520 },
            data: {
              label: 'Log',
              elementType: 'log',
              nodeType: 'plugin',
              category: 'system',
              version: '1.0.0',
              description: 'unlinked block',
              expressionFields: ['message'],
              templateFields: [],
              variableExpressionKeys: [],
              config: {
                values: { message: "'auto-connect'", level: 'INFO' },
                outputBindings: {},
                profileBindings: [],
              },
            },
          },
        ],
        edges: [{ id: 'e-start', source: 'start-node', target: 'sw', type: 'default' }],
      },
      variables: { mode: { value: 'a', type: 'string', scope: 'test' } },
      metadata: {},
    }

    const createResp = await page.request.post(`${BASE}/tests`, { data: fixture })
    const createBody = await createResp.json().catch(() => null)
    expect(
      createResp.ok(),
      `POST /tests failed: ${createResp.status()} - ${JSON.stringify(createBody)}`,
    ).toBeTruthy()
    const testId = createBody.data?.id ?? createBody.id

    await page.goto(`/workbench?editTest=${testId}`)
    await page.evaluate(() => localStorage.clear())
    await page.goto(`/workbench?editTest=${testId}`)
    await waitForCanvasLoad(page)

    const thirdLane = page.locator('[data-testid="workflow-node-sw"] [data-testid="handle-output-branch_2"]')
    await expect(thirdLane).toBeVisible()
    const laneBox = await thirdLane.boundingBox()
    expect(laneBox, 'the third lane must be visible').not.toBeNull()

    // Drag the unlinked block so its TOP edge - the point proximity measures -
    // lands just under the THIRD lane.
    const freeNode = page.locator('[data-testid="workflow-node-log-free"]')
    await expect(freeNode).toBeVisible()
    const nodeBox = await freeNode.boundingBox()
    expect(nodeBox, 'the unlinked block must be visible').not.toBeNull()

    const laneCenter = { x: laneBox!.x + laneBox!.width / 2, y: laneBox!.y + laneBox!.height / 2 }
    const grab = { x: nodeBox!.x + nodeBox!.width / 2, y: nodeBox!.y + nodeBox!.height / 2 }
    const drop = {
      x: grab.x + (laneCenter.x - grab.x),
      y: grab.y + (laneCenter.y + 40 - nodeBox!.y),
    }

    await page.mouse.move(grab.x, grab.y)
    await page.mouse.down()
    for (let i = 1; i <= 10; i++) {
      await page.mouse.move(
        grab.x + ((drop.x - grab.x) * i) / 10,
        grab.y + ((drop.y - grab.y) * i) / 10,
      )
    }
    await page.waitForTimeout(400)
    await page.mouse.up()
    await page.waitForTimeout(500)

    const toolbarSave = page.locator('[data-testid="toolbar-save-button"]')
    await expect(toolbarSave).toBeEnabled({ timeout: 10_000 })
    await toolbarSave.click()
    await expect(toolbarSave).toBeDisabled({ timeout: 15_000 })

    const wfResp = await page.request.get(`${BASE}/tests/${testId}/workflow`)
    expect(wfResp.ok(), `GET workflow failed: ${wfResp.status()}`).toBeTruthy()
    const wfBody = (await wfResp.json()) as Record<string, unknown>
    const wfData = (wfBody.data ?? wfBody) as { edges?: Array<Record<string, unknown>> }
    const fromSwitch = (wfData.edges ?? []).filter((e) => e.source === 'sw')
    const summary = JSON.stringify(fromSwitch.map((e) => e.sourceHandle))

    expect(fromSwitch.length, `exactly one lane should have been wired: ${summary}`).toBe(1)
    expect(
      fromSwitch[0].sourceHandle,
      `the drop was under lane 3, so lane 3 owns the edge: ${summary}`,
    ).toBe('branch_2')
  })
})
