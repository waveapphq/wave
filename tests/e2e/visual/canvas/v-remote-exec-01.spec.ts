/**
 * V-REMOTE-EXEC-01: Remote Execution container node + config + R/L locus badge
 *
 * Phase: no-data (palette drag for the node/config; POST /tests seed for the
 * badge - no DB reset).
 * Design Decisions: REMEX-1..4, mixed-locus R/L badge
 * REQ: REQ-3.4.1.3
 *
 * Pass Criteria:
 * 1. The container node renders the For-Loop-style scoped egress: a cyan `body`
 *    handle + a zinc `then` handle, and NOT the default single output handle.
 * 2. Its config sheet has exactly one input (Session ID, required) and one
 *    output (Remote Session ID).
 * 3. The per-block R/L locus badge: a remotable block (HTTP) inside the body
 *    shows `R` (cyan); a non-remotable block (JSON / Log) inside the body shows
 *    `L` (slate); the same remotable block OUTSIDE the container shows no badge.
 */

import { test, expect, type Page } from '../../helpers/playwright-fixtures'
import { dragPaletteItemToCanvas, waitForCanvasLoad } from '../../helpers/canvas'
import { configSheet, openSelectedBlockSheet } from '../../helpers/workbench'
import { BACKEND_PORT } from '../../helpers/config'

async function addRemoteExecNode(page: Page) {
  const canvas = page.locator('[data-testid="workflow-canvas"]')
  const box = await canvas.boundingBox()
  await dragPaletteItemToCanvas(
    page,
    { term: 'Remote Execution', testId: 'palette-item-remote-execution' },
    { x: box!.width / 2, y: box!.height / 2 }
  )
  return page.locator('[data-testid^="workflow-node-"][data-nodetype]').first()
}

// A container riding an (unresolved) session with a mixed body + one external
// HTTP. Only the graph shape matters for the badge (membership + remotable flag);
// it is never run, so node configs stay minimal.
const BADGE_FIXTURE = {
  name: 'Remote Locus Badge Fixture',
  version: '1.0.0',
  description: '',
  workflow: {
    nodes: [
      node('container', 'Remote Execution', 'remote-execution', 'plugin', 'remote', {
        values: { session_id: 'sid' },
        outputBindings: { remote_session_id: 'rsid' },
        profileBindings: [],
      }, ['session_id'], { width: 160, height: 62 }),
      node('http-in', 'HTTP', 'http-client', 'plugin', 'network', {
        values: { url: 'http://127.0.0.1/health', method: 'GET' },
        outputBindings: {},
        profileBindings: [],
      }),
      node('json-in', 'JSON Parser', 'json-parser', 'plugin', 'data', {
        values: { json_content: '{"n": 1}', queries: { n: '$.n' }, output_mode: 'combined' },
        outputBindings: {},
        profileBindings: [],
      }),
      node('log-in', 'Log', 'log', 'plugin', 'system', {
        values: { message: "'in-body'", level: 'INFO' },
        outputBindings: {},
        profileBindings: [],
      }, ['message']),
      node('http-out', 'HTTP', 'http-client', 'plugin', 'network', {
        values: { url: 'http://127.0.0.1/health', method: 'GET' },
        outputBindings: {},
        profileBindings: [],
      }),
    ],
    edges: [
      { id: 'e0', source: 'start-node', target: 'container' },
      { id: 'e1', source: 'container', sourceHandle: 'body', target: 'http-in', type: 'default' },
      { id: 'e2', source: 'http-in', target: 'json-in' },
      { id: 'e3', source: 'json-in', target: 'log-in' },
      { id: 'e4', source: 'container', sourceHandle: 'then', target: 'http-out', type: 'default' },
    ],
  },
  variables: {
    sid: { value: '', type: 'string', scope: 'test' },
    rsid: { value: '', type: 'string', scope: 'test' },
  },
  metadata: { tags: [], suite_id: null, parent_suite: null },
}

function node(
  id: string,
  label: string,
  elementType: string,
  nodeType: string,
  category: string,
  config: Record<string, unknown>,
  expressionFields: string[] = [],
  measured: { width: number; height: number } = { width: 120, height: 62 }
) {
  return {
    id,
    type: 'workflowNode',
    position: { x: -75, y: 100 },
    data: {
      label,
      elementType,
      nodeType,
      category,
      version: '1.0.0',
      description: label,
      hasNewerVersion: false,
      expressionFields,
      templateFields: [],
      config,
    },
    measured,
  }
}

test.describe('V-REMOTE-EXEC-01: Remote Execution container', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await page.evaluate(() => localStorage.clear())
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
  })

  test('V-REMOTE-EXEC-01-S1: container renders cyan body + zinc then, not the default handle', async ({ page }) => {
    const node = await addRemoteExecNode(page)
    await expect(node).toBeVisible()

    // Scoped container egress (mirrors For Loop): body + then, no default output.
    await expect(node.locator('[data-testid="handle-output-body"]')).toBeVisible()
    await expect(node.locator('[data-testid="handle-output-then"]')).toBeVisible()
    await expect(node.locator('[data-testid="handle-output"]')).toHaveCount(0)
  })

  test('V-REMOTE-EXEC-01-S2: config sheet has Session ID (required) input + Remote Session ID output', async ({ page }) => {
    const node = await addRemoteExecNode(page)
    await node.locator('button').first().dispatchEvent('click')
    await expect(node).toHaveAttribute('data-selected', 'true')
    await openSelectedBlockSheet(page)
    const modal = configSheet(page)
    await expect(modal).toBeVisible()

    const sessionRow = modal.locator('[data-testid="param-row-session_id"]')
    await expect(sessionRow).toBeVisible()
    await expect(sessionRow).toContainText('*')

    await expect(modal.locator('[data-testid="output-row-remote_session_id"]')).toBeVisible()
  })

  test('V-REMOTE-EXEC-01-S3: R/L locus badge - R on remotable body block, L on non-remotable, none outside', async ({ page }) => {
    const createResp = await page.request.post(`http://localhost:${BACKEND_PORT}/tests`, { data: BADGE_FIXTURE })
    const createBody = await createResp.json().catch(() => null)
    expect(createResp.ok(), `POST /tests failed: ${createResp.status()} - ${JSON.stringify(createBody)}`).toBeTruthy()
    const testId = createBody.data?.id || createBody.id

    await page.goto(`/workbench?editTest=${testId}`)
    await page.evaluate(() => localStorage.clear())
    await page.goto(`/workbench?editTest=${testId}`)
    await waitForCanvasLoad(page)

    const badge = (nodeId: string) =>
      page.locator(`[data-testid="workflow-node-${nodeId}"] [data-testid="node-remote-locus-badge"]`)

    // Remotable HTTP inside the body -> R (cyan).
    await expect(badge('http-in')).toHaveAttribute('data-locus', 'R')
    // Non-remotable JSON / Log inside the body -> L (slate).
    await expect(badge('json-in')).toHaveAttribute('data-locus', 'L')
    await expect(badge('log-in')).toHaveAttribute('data-locus', 'L')
    // The same remotable HTTP OUTSIDE the container -> no badge at all.
    await expect(badge('http-out')).toHaveCount(0)
    // The container itself is not a body member -> no badge.
    await expect(badge('container')).toHaveCount(0)
  })
})
