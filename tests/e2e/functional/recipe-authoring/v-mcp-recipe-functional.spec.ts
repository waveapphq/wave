/**
 * V-MCP-RECIPE-FUNCTIONAL: one-shot recipe authoring through the live MCP endpoint
 *
 * A recipe-authored test is a REAL test - import-free. The spec enables the
 * MCP listener until-restart via REST, drives the actual `validate_recipe` +
 * `create_test_from_recipe` tools with a one-shot python client (the `mcp`
 * SDK lives in the backend poetry env, same network namespace as the
 * listener), then opens the created test in the workbench, checks canvas
 * sanity, RUNS it via the UI, and asserts the execution behavior.
 * Design Decisions: strict save pipeline, findings as data, deterministic
 * layout + node-N ids, create envelope
 * REQ: REQ-5.2.7.3 / REQ-5.2.7.4 / REQ-5.2.7.5 / REQ-5.2.7.9
 *
 * Pass Criteria:
 * 1. validate_recipe dry-run returns valid=true with zero findings; nothing
 *    is persisted by the dry-run.
 * 2. create_test_from_recipe returns created=true, version 1.0.0, zero
 *    warnings; the persisted test passes POST /tests/{id}/validate with
 *    zero errors.
 * 3. `_fix_multi_edges`: every rejoin
 *    edge survives persistence - if/else tails into the next step
 *    (ingress_1) and three-branch if/elif/else tails into the for loop
 *    (ingress_1 + ingress_2). Parallel branches dead-end by design, so the
 *    assert hangs off the section's `then` egress instead.
 * 4. Canvas sanity: all 22 nodes + start node render, all 25 edges render,
 *    no two node bounding boxes overlap.
 * 5. Execution: taken branches log exactly once (then-branch, elif-branch,
 *    assert on_pass), the for body logs 3 times, both parallel branches log,
 *    the while loop leaves retries == 2 (2 iterations then labeled break),
 *    and the rejoin-downstream nodes EXECUTE (rcp-after-if-rejoin,
 *    rcp-final-downstream). Untaken branches never log. Session outcome is
 *    passed.
 * 6. The MCP listener is disabled again before the UI phase and left
 *    disabled at the end (v-mcp-02 precedent).
 */

import { execFileSync } from 'child_process'
import fs from 'fs'
import path from 'path'
import { test, expect, type Page } from '../../helpers/playwright-fixtures'
import { BACKEND_URL, BACKEND_PORT, ensureEnvironment } from '../../helpers/config'
import { waitForCanvasLoad } from '../../helpers/canvas'
import { getLogTexts } from '../../helpers/log-reader'
import { getActiveSessionId, getSessionVariables } from '../../helpers/fixture-import'
import { enableMcpUntilRestart, resetMcpSettings } from '../../helpers/mcp'
import { selectEnvironment } from '../../helpers/workbench'

// One MCP port per stack so host-mode parallel workers never collide (8765, 8766, ...).
const MCP_PORT = Number(BACKEND_PORT) + 765

const BASE_NAME = 'Recipe E2E Branch Loop Assert'

// Deterministic node-N ids (pre-order) for the compiled recipe.yaml.
const EXECUTED_NODES = [
  'node-1', // if
  'node-2', // log rcp-branch-healthy (then)
  'node-4', // log rcp-after-if-rejoin (if rejoin target)
  'node-5', // three-branch if/elif/else
  'node-7', // log rcp-elif-200 (elif branch)
  'node-9', // for (3-way rejoin target)
  'node-10', // log rcp-loop-tick
  'node-11', // while retry_loop
  'node-12', // set retries
  'node-13', // inner if
  'node-14', // break (fires on iteration 2)
  'node-15', // parallel
  'node-16', // log rcp-par-fast
  'node-17', // log rcp-par-slow
  'node-18', // assert (parallel then egress)
  'node-19', // log rcp-assert-pass
  'node-22', // log rcp-final-downstream (assert continuation)
]
const SKIPPED_NODES = [
  'node-3', // log rcp-branch-down (else)
  'node-6', // log rcp-if-404 (then branch)
  'node-8', // log rcp-else-fallback (else branch)
  'node-20', // log rcp-assert-fail (on_fail)
  'node-21', // halt (on_fail)
]
const NODE_COUNT = 22
const EDGE_COUNT = 25

interface McpToolResult {
  isError: boolean
  payload: Record<string, any>
}

function callMcpTool(tool: string, recipe: string): McpToolResult {
  const backendDir = path.resolve(__dirname, '../../../../backend')
  const clientPath = path.resolve(__dirname, 'mcp_recipe_client.py')
  const stdout = execFileSync(
    'poetry',
    ['run', 'python', clientPath, `http://127.0.0.1:${MCP_PORT}/mcp`, tool],
    { cwd: backendDir, input: recipe, timeout: 90_000, encoding: 'utf-8' },
  )
  const lastLine = stdout.trim().split('\n').pop() ?? ''
  return JSON.parse(lastLine) as McpToolResult
}

async function dumpRunDiagnostics(page: Page): Promise<string> {
  const statuses = await page.evaluate(() =>
    Array.from(document.querySelectorAll('[data-testid^="workflow-node-"]')).map(
      (el) =>
        `${el.getAttribute('data-testid')}: ${el.getAttribute('data-execution-status')}`,
    ),
  )
  const logs = await getLogTexts(page)
  return `Node statuses:\n${statuses.join('\n')}\nLogs:\n${logs.join('\n')}`
}

test.describe('V-MCP-RECIPE-FUNCTIONAL: recipe-authored test via MCP', () => {
  test.beforeEach(async ({ page }) => {
    await resetMcpSettings(page)
  })

  test.afterEach(async ({ page }) => {
    // The spec must leave the listener disabled even if an assertion failed.
    await resetMcpSettings(page)
  })

  test('create via MCP tools, verify canvas, run via UI, assert behavior', async ({
    page,
  }) => {
    test.setTimeout(240_000)

    const uniqueName = `${BASE_NAME} ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const recipe = fs
      .readFileSync(path.resolve(__dirname, 'recipe.yaml'), 'utf-8')
      .replace(BASE_NAME, uniqueName)

    let testId = ''

    await test.step('Enable the MCP listener until-restart via REST', async () => {
      const url = await enableMcpUntilRestart(page, MCP_PORT)
      expect(url).toBe(`http://127.0.0.1:${MCP_PORT}/mcp`)
    })

    await test.step('validate_recipe dry-run is clean and persists nothing', async () => {
      const result = callMcpTool('validate_recipe', recipe)
      expect(result.isError).toBe(false)
      expect(
        result.payload.valid,
        `validate_recipe findings: ${JSON.stringify(result.payload.findings)}`,
      ).toBe(true)
      expect(result.payload.test_name).toBe(uniqueName)
      expect(result.payload.findings).toEqual([])

      const list = await page.request.get(
        `${BACKEND_URL}/tests?search=${encodeURIComponent(uniqueName)}`,
      )
      const listBody = await list.json()
      expect(listBody.data ?? []).toHaveLength(0)
    })

    await test.step('create_test_from_recipe persists through the strict pipeline', async () => {
      const result = callMcpTool('create_test_from_recipe', recipe)
      expect(result.isError).toBe(false)
      expect(
        result.payload.created,
        `create findings: ${JSON.stringify(result.payload.findings)}`,
      ).toBe(true)
      expect(result.payload.name).toBe(uniqueName)
      expect(result.payload.version).toBe('1.0.0')
      expect(result.payload.warnings).toEqual([])
      testId = result.payload.test_id
      expect(testId).toBeTruthy()
    })

    await test.step('persisted artifact passes platform validation', async () => {
      const validateResp = await page.request.post(`${BACKEND_URL}/tests/${testId}/validate`)
      const validateBody = await validateResp.json().catch(() => null)
      expect(validateResp.ok()).toBeTruthy()
      const errors =
        validateBody?.data?.errors ??
        validateBody?.error?.details?.[0]?.errors ??
        validateBody?.errors ??
        []
      expect(errors, `validation errors: ${JSON.stringify(errors)}`).toHaveLength(0)
    })

    await test.step('rejoin edges survived persistence (_fix_multi_edges guard)', async () => {
      const resp = await page.request.get(`${BACKEND_URL}/tests/${testId}`)
      const body = await resp.json()
      expect(resp.ok()).toBeTruthy()
      const workflow = body.data.workflow as {
        nodes: Array<{ id: string }>
        edges: Array<{ source: string; target: string; targetHandle?: string | null }>
      }
      expect(workflow.nodes).toHaveLength(NODE_COUNT)
      expect(workflow.edges).toHaveLength(EDGE_COUNT)

      const incoming = (target: string) =>
        workflow.edges
          .filter((e) => e.target === target)
          .map((e) => `${e.source}:${e.targetHandle ?? 'null'}`)
          .sort()
      // if/else tails -> rcp-after-if-rejoin log
      expect(incoming('node-4')).toEqual(['node-2:null', 'node-3:ingress_1'])
      // if/elif/else three branch tails -> for loop
      expect(incoming('node-9')).toEqual(['node-6:null', 'node-7:ingress_1', 'node-8:ingress_2'])
      // parallel leaves through its `then` egress; the branches dead-end
      expect(incoming('node-18')).toEqual(['node-15:null'])

      const variables = body.data.variables as Record<string, { type: string; value: unknown }>
      expect(variables.health).toMatchObject({ type: 'integer', value: 200 })
      expect(variables.retries).toMatchObject({ type: 'integer', value: 0 })
    })

    await test.step('disable the MCP listener before the UI phase', async () => {
      await resetMcpSettings(page)
      const status = await (await page.request.get(`${BACKEND_URL}/mcp/status`)).json()
      expect(status.running).toBe(false)
      expect(status.urls).toEqual([])
    })

    await test.step('open in the workbench', async () => {
      await page.request.delete(`${BACKEND_URL}/workbench/session/`).catch(() => {})
      await ensureEnvironment(page.request)
      await page.goto(`/workbench?editTest=${testId}`)
      await page.evaluate(() => localStorage.clear())
      await page.goto(`/workbench?editTest=${testId}`)
      await waitForCanvasLoad(page)
    })

    await test.step('canvas sanity: all nodes and edges render, no overlaps', async () => {
      await expect(page.locator('[data-testid="start-node"]')).toBeVisible()
      for (const id of [...EXECUTED_NODES, ...SKIPPED_NODES]) {
        await expect(page.locator(`[data-testid="workflow-node-${id}"]`)).toBeAttached()
      }
      await expect(page.locator('[data-testid^="workflow-node-node-"]')).toHaveCount(NODE_COUNT)
      // Guards against branch edges that exist in data but are not drawn (missing handles).
      await expect(page.locator('.react-flow__edge')).toHaveCount(EDGE_COUNT)

      const boxes: Array<{ id: string; x: number; y: number; w: number; h: number }> = []
      for (const id of [...EXECUTED_NODES, ...SKIPPED_NODES]) {
        const box = await page.locator(`[data-testid="workflow-node-${id}"]`).boundingBox()
        expect(box, `no bounding box for ${id}`).not.toBeNull()
        boxes.push({ id, x: box!.x, y: box!.y, w: box!.width, h: box!.height })
      }
      for (let i = 0; i < boxes.length; i++) {
        for (let j = i + 1; j < boxes.length; j++) {
          const a = boxes[i]
          const b = boxes[j]
          const overlaps =
            a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
          expect(overlaps, `${a.id} overlaps ${b.id}`).toBe(false)
        }
      }
    })

    await test.step('run via the UI to a passed outcome', async () => {
      await selectEnvironment(page)
      await page.locator('[data-testid="run-button"]').click()
      const status = page.locator('[data-testid="workflow-status"]')
      await expect(status).not.toHaveAttribute('data-status', 'idle', { timeout: 10_000 })
      await expect(status).not.toHaveAttribute('data-status', 'running', { timeout: 60_000 })
      const finalStatus = await status.getAttribute('data-status')
      expect(
        finalStatus,
        `expected passed, got ${finalStatus}.\n${await dumpRunDiagnostics(page)}`,
      ).toBe('passed')
    })

    await test.step('execution behavior: branch/loop/rejoin log evidence', async () => {
      const logs = await getLogTexts(page)
      const all = logs.join('\n')
      const count = (marker: string) => logs.filter((t) => t.includes(marker)).length
      const expectCount = (marker: string, n: number) =>
        expect(count(marker), `expected "${marker}" x${n} in logs.\n${all}`).toBe(n)

      expectCount('rcp-branch-healthy', 1)
      expectCount('rcp-after-if-rejoin', 1) // if rejoin target executed
      expectCount('rcp-elif-200', 1)
      expectCount('rcp-loop-tick', 3) // for count: 3
      expectCount('rcp-par-fast', 1)
      expectCount('rcp-par-slow', 1)
      expectCount('rcp-assert-pass', 1)
      expectCount('rcp-final-downstream', 1) // assert continuation executed

      expectCount('rcp-branch-down', 0)
      expectCount('rcp-if-404', 0)
      expectCount('rcp-else-fallback', 0)
      expectCount('rcp-assert-fail', 0)
    })

    await test.step('execution behavior: node statuses and while-loop variable', async () => {
      for (const id of EXECUTED_NODES) {
        await expect(
          page.locator(`[data-testid="workflow-node-${id}"]`),
          `expected ${id} to have executed`,
        ).toHaveAttribute('data-execution-status', 'success')
      }
      for (const id of SKIPPED_NODES) {
        const nodeStatus = await page
          .locator(`[data-testid="workflow-node-${id}"]`)
          .getAttribute('data-execution-status')
        expect(nodeStatus, `expected ${id} to be untaken, got ${nodeStatus}`).not.toBe('success')
      }

      const sessionId = await getActiveSessionId(page)
      const variables = await getSessionVariables(page, sessionId)
      expect(variables.retries?.value, 'while ran 2 iterations then broke').toBe(2)
      expect(variables.health?.value).toBe(200)
    })
  })
})
