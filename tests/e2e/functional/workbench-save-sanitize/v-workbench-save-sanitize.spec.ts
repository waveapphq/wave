/**
 * V-WORKBENCH-SAVE-SANITIZE: workbench Save strips UI-only fields (E2E).
 *
 * A persisted test workflow carries no transient React Flow or UI-only field:
 * `node.selected`, `node.dragging`, `node.data.hasNewerVersion` and
 * `edge.selected` are all stripped by two pure boundary
 * helpers (`sanitizeNodesForSave`, `sanitizeEdgesForSave`) called at every save
 * site (direct save, save dialog, save-and-run, save-and-close, save-and-switch,
 * draft auto-save).
 *
 * This spec exercises one save path end-to-end through the UI:
 *   1. Open an existing test in the workbench.
 *   2. Drag a node so React Flow stamps `dragging` (cleared on drag end) and
 *      a fresh post-drag entry lands in the store.
 *   3. Click a node to set `selected:true`.
 *   4. Click an edge to set `selected:true`.
 *   5. Open a node's config modal, change its description and click Save - this
 *      forces `data.hasNewerVersion` onto the node via `use-config-modal.ts:185`.
 *   6. Click the toolbar Save button.
 *   7. Read the persisted workflow via `GET /tests/{id}/workflow` and assert
 *      none of the four UI-only fields appear on any node or edge.
 */

import { test, expect, type APIRequestContext } from '../../helpers/playwright-fixtures'
import { waitForCanvasLoad } from '../../helpers/canvas'
import { BACKEND_PORT } from '../../helpers/config'
import { configSheet } from '../../helpers/workbench'

const BASE = `http://localhost:${BACKEND_PORT}`

const FIXTURE = {
  name: 'save-sanitize fixture',
  version: '1.0.0',
  description: 'Two Log nodes chained off Start. We drag, select, save-config, then Save.',
  workflow: {
    nodes: [
      {
        id: 'log-a',
        type: 'workflowNode',
        position: { x: 200, y: 150 },
        data: {
          label: 'Log',
          elementType: 'log',
          nodeType: 'plugin',
          version: '1.0.0',
          description: 'Log A',
          hasNewerVersion: false,
          expressionFields: ['message'],
          templateFields: [],
          variableExpressionKeys: [],
          config: {
            values: { message: "'a'", level: 'INFO' },
            outputBindings: {},
            profileBindings: [],
          },
        },
        measured: { width: 120, height: 62 },
      },
      {
        id: 'log-b',
        type: 'workflowNode',
        position: { x: 200, y: 280 },
        data: {
          label: 'Log',
          elementType: 'log',
          nodeType: 'plugin',
          version: '1.0.0',
          description: 'Log B',
          hasNewerVersion: false,
          expressionFields: ['message'],
          templateFields: [],
          variableExpressionKeys: [],
          config: {
            values: { message: "'b'", level: 'INFO' },
            outputBindings: {},
            profileBindings: [],
          },
        },
        measured: { width: 120, height: 62 },
      },
    ],
    edges: [
      { id: 'e1', source: 'start-node', target: 'log-a', type: 'default' },
      { id: 'e2', source: 'log-a', target: 'log-b', type: 'default' },
    ],
  },
  variables: {},
  metadata: {},
  created_at: '2026-04-28T00:00:00.000000',
  updated_at: '2026-04-28T00:00:00.000000',
}

async function importFixture(request: APIRequestContext): Promise<string> {
  const resp = await request.post(`${BASE}/tests`, {
    data: { ...FIXTURE, name: `${FIXTURE.name} ${Date.now()}` },
  })
  expect(resp.ok(), `POST /tests failed: ${resp.status()}`).toBeTruthy()
  const body = (await resp.json()) as Record<string, unknown>
  const data = (body.data ?? body) as Record<string, unknown>
  return data.id as string
}

async function fetchWorkflow(
  request: APIRequestContext,
  testId: string,
): Promise<{ nodes: Array<Record<string, unknown>>; edges: Array<Record<string, unknown>> }> {
  const resp = await request.get(`${BASE}/tests/${testId}/workflow`)
  expect(resp.ok(), `GET /tests/${testId}/workflow failed: ${resp.status()}`).toBeTruthy()
  const body = (await resp.json()) as Record<string, unknown>
  const data = (body.data ?? body) as { nodes: unknown; edges: unknown }
  return {
    nodes: (data.nodes as Array<Record<string, unknown>>) ?? [],
    edges: (data.edges as Array<Record<string, unknown>>) ?? [],
  }
}

test.describe('workbench Save sanitizes UI-only React Flow fields', () => {
  test.beforeEach(async ({ page }) => {
    await page.request.delete(`${BASE}/workbench/session`).catch(() => {})
  })

  test('persisted workflow has no selected/dragging/hasNewerVersion after a UI Save', async ({
    page,
    request,
  }) => {
    const testId = await importFixture(request)

    await page.goto(`/workbench?editTest=${testId}`)
    await page.evaluate(() => localStorage.clear())
    await page.goto(`/workbench?editTest=${testId}`)
    await waitForCanvasLoad(page)

    const logA = page.locator('[data-testid="workflow-node-log-a"]')
    const logB = page.locator('[data-testid="workflow-node-log-b"]')
    await expect(logA).toBeVisible()
    await expect(logB).toBeVisible()

    // 1. Drag log-a 60px right + 30px down. React Flow stamps `dragging`
    //    during the drag and clears it on drag-stop, but the test-store
    //    boundary still has to strip stale flags on save in case React's
    //    commit order leaves a residual value.
    const startBox = await logA.boundingBox()
    expect(startBox).toBeTruthy()
    const grab = { x: startBox!.x + startBox!.width / 2, y: startBox!.y + startBox!.height / 2 }
    await page.mouse.move(grab.x, grab.y)
    await page.mouse.down()
    await page.mouse.move(grab.x + 30, grab.y + 15)
    await page.mouse.move(grab.x + 60, grab.y + 30)
    await page.mouse.up()

    // 2. Click log-b to set node.selected = true.
    await logB.click()
    await expect(logB).toHaveAttribute('data-selected', 'true')

    // 3. Click an edge to set edge.selected = true.
    const edges = page.locator('.react-flow__edge')
    await expect(edges.first()).toBeVisible()
    const edgePath = edges.first().locator('.react-flow__edge-interaction')
    const edgeBox = await edgePath.boundingBox()
    expect(edgeBox).toBeTruthy()
    await page.mouse.click(
      edgeBox!.x + edgeBox!.width / 2,
      edgeBox!.y + edgeBox!.height / 2,
    )

    // 4. Open log-a's config modal, change the description so Save is alive, and
    //    save - the act of saving writes data.hasNewerVersion via use-config-modal.ts.
    await logA.dblclick()
    const modal = configSheet(page)
    await expect(modal).toBeVisible({ timeout: 5000 })
    await modal.locator('[data-testid="element-description-input"]').fill('sanitize probe')
    await modal.getByRole('button', { name: /^Save$/ }).click()
    await expect(modal).toBeHidden({ timeout: 5000 })

    // 5. Click the toolbar Save button. The save path runs through
    //    sanitizeNodesForSave + sanitizeEdgesForSave before POSTing.
    const saveBtn = page.locator('[data-testid="toolbar-save-button"]')
    await expect(saveBtn).toBeEnabled()
    await saveBtn.click()
    await expect(saveBtn).toBeDisabled({ timeout: 10_000 })

    // 6. Read the persisted workflow and assert nothing leaks.
    const { nodes, edges: persistedEdges } = await fetchWorkflow(request, testId)
    expect(nodes.length, 'workflow has nodes after save').toBeGreaterThan(0)
    expect(persistedEdges.length, 'workflow has edges after save').toBeGreaterThan(0)

    for (const node of nodes) {
      expect(
        node,
        `node ${String(node.id)} must not carry top-level "selected"`,
      ).not.toHaveProperty('selected')
      expect(
        node,
        `node ${String(node.id)} must not carry top-level "dragging"`,
      ).not.toHaveProperty('dragging')
      const data = (node.data ?? {}) as Record<string, unknown>
      expect(
        data,
        `node ${String(node.id)}.data must not carry "hasNewerVersion"`,
      ).not.toHaveProperty('hasNewerVersion')
    }

    for (const edge of persistedEdges) {
      expect(
        edge,
        `edge ${String(edge.id)} must not carry top-level "selected"`,
      ).not.toHaveProperty('selected')
    }
  })
})
