/**
 * V-CTRL-ASSERT-DISABLED-01: Disabled split-mode Assert is a pass-through.
 *
 * Test = ``Start -> Assert(split, disabled) -> [pass_log, fail_log]``.
 *
 * Expected: a disabled Assert acts as a pass-through. Its semantic default
 * (the success branch / "pass" handle) runs; the other branch cascade-skips.
 * This matches the general "disabled = pass-through" expectation users have
 * for any block - skip the action, keep the happy-path flow alive.
 *
 * Pass criteria:
 *   1. ``pass_log`` data-execution-status == ``"success"`` (pass branch runs)
 *   2. ``fail_log`` data-execution-status == ``"skipped"`` (fail branch cascade-skips)
 *   3. session final status == ``"passed"``
 */
import { test, expect, type APIRequestContext, type Page } from '../../helpers/playwright-fixtures'
import { BACKEND_PORT, E2E_ENV_NAME, ensureEnvironment } from '../../helpers/config'
import { waitForCanvasLoad } from '../../helpers/canvas'

const BASE = `http://localhost:${BACKEND_PORT}`

const ASSERT_ID = 'assert-disabled'
const PASS_LOG_ID = 'pass-log'
const FAIL_LOG_ID = 'fail-log'

function buildFixture(): Record<string, unknown> {
  return {
    name: `V-CTRL-ASSERT-DISABLED-01 ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    version: '1.0.0',
    description: 'Disabled split Assert pass-through repro',
    workflow: {
      nodes: [
        {
          id: ASSERT_ID,
          type: 'workflowNode',
          position: { x: 200, y: 200 },
          data: {
            label: 'Assert_1',
            elementType: 'assert',
            nodeType: 'control',
            category: 'control',
            version: '1.0.0',
            disabled: true,
            config: {
              values: {
                mode: 'split',
                assertions: [
                  {
                    id: 'assert-row-1',
                    kind: 'literal',
                    expected: 'true',
                    actual: 'true',
                    comparator: 'equals',
                  },
                ],
                fail_current_scope: false,
              },
              outputBindings: {},
              profileBindings: [],
            },
          },
        },
        {
          id: PASS_LOG_ID,
          type: 'workflowNode',
          position: { x: 100, y: 400 },
          data: {
            label: 'Pass_Log',
            elementType: 'log',
            nodeType: 'plugin',
            version: '1.0.0',
            expressionFields: ['message'],
            templateFields: [],
            variableExpressionKeys: [],
            config: {
              values: { message: "'PASS-BRANCH-FIRED'", level: 'INFO' },
              profileBindings: [],
              outputBindings: {},
            },
          },
        },
        {
          id: FAIL_LOG_ID,
          type: 'workflowNode',
          position: { x: 400, y: 400 },
          data: {
            label: 'Fail_Log',
            elementType: 'log',
            nodeType: 'plugin',
            version: '1.0.0',
            expressionFields: ['message'],
            templateFields: [],
            variableExpressionKeys: [],
            config: {
              values: { message: "'FAIL-BRANCH-FIRED'", level: 'INFO' },
              profileBindings: [],
              outputBindings: {},
            },
          },
        },
      ],
      edges: [
        { id: 'e-start-assert', source: 'start-node', target: ASSERT_ID },
        { id: 'e-assert-pass', source: ASSERT_ID, target: PASS_LOG_ID, sourceHandle: 'pass' },
        { id: 'e-assert-fail', source: ASSERT_ID, target: FAIL_LOG_ID, sourceHandle: 'fail' },
      ],
    },
  }
}

async function seedFixture(request: APIRequestContext): Promise<string> {
  const resp = await request.post(`${BASE}/tests`, { data: buildFixture() })
  const body = await resp.json().catch(() => null)
  expect(body?.success === true, `POST /tests failed: ${resp.status()} - ${JSON.stringify(body)}`).toBeTruthy()
  return body.data.id
}


async function runFromUiAndWaitTerminal(page: Page): Promise<string> {
  await page.locator('[data-testid="run-button"]').click()
  const status = page.locator('[data-testid="workflow-status"]')
  await expect(status).not.toHaveAttribute('data-status', 'idle', { timeout: 5_000 })
  await expect(status).not.toHaveAttribute('data-status', 'running', { timeout: 15_000 })
  const statusVal = await status.getAttribute('data-status')
  return statusVal ?? 'unknown'
}

async function getNodeStatusMap(page: Page): Promise<Record<string, string | null>> {
  return page.evaluate(() => {
    const out: Record<string, string | null> = {}
    document.querySelectorAll('[data-testid^="workflow-node-"][data-nodetype]').forEach((n) => {
      const testId = n.getAttribute('data-testid') ?? ''
      const nodeId = testId.replace(/^workflow-node-/, '')
      out[nodeId] = n.getAttribute('data-execution-status')
    })
    return out
  })
}

async function selectEnvironment(page: Page, envName: string) {
  await page.locator('[data-testid="environment-selector"]').click()
  const popover = page.locator('[data-testid="environment-popover"]')
  await expect(popover).toBeVisible()
  await popover.locator(`button:has-text("${envName}")`).first().click()
  await expect(popover).not.toBeVisible()
}

test.describe('V-CTRL-ASSERT-DISABLED-01: disabled split-mode Assert', () => {
  test('disabled Assert acts as pass-through: pass branch runs, fail branch cascade-skips', async ({ request, page }) => {
    await ensureEnvironment(request)
    const testId = await seedFixture(request)

    await page.setViewportSize({ width: 1280, height: 900 })
    // Clear any active workbench session BEFORE navigating - the session-
    // recovery dialog otherwise intercepts the env-selector click.
    await page.request.delete(`${BASE}/workbench/session`).catch(() => {})
    await page.goto(`/workbench?editTest=${testId}`)
    await page.evaluate(() => localStorage.clear())
    await page.goto(`/workbench?editTest=${testId}`)
    await waitForCanvasLoad(page)

    await selectEnvironment(page, E2E_ENV_NAME)
    const finalStatus = await runFromUiAndWaitTerminal(page)

    // Disabled is a no-op; nothing failed, nothing halted -> session passes.
    expect(finalStatus, 'disabled is a no-op - session must end "passed"').toBe('passed')

    const nodeStatuses = await getNodeStatusMap(page)
    // Pass-through semantics: pass branch RUNS, fail branch cascade-skips.
    //   * Pass_Log has ``data-execution-status="success"`` (it ran).
    //   * Fail_Log has NO data-execution-status (the design-time muting
    //     for non-pass-through descendants of a disabled control sets
    //     ``isMuted=true``, which clears ``executionStatus`` -
    //     node.tsx:239: ``executionStatus = isMuted ? undefined : rawExecutionStatus``).
    //   * Assert itself: same - disabled/muted clears its execution badge.
    if (nodeStatuses[PASS_LOG_ID] !== 'success' || nodeStatuses[FAIL_LOG_ID] !== null) {
      console.log('[diag] nodeStatuses=', JSON.stringify(nodeStatuses))
    }
    expect(nodeStatuses[PASS_LOG_ID], 'pass branch must run as pass-through when Assert is disabled').toBe('success')
    expect(
      nodeStatuses[FAIL_LOG_ID],
      'fail branch must be muted (no execution status) when Assert is disabled',
    ).toBeNull()

    // Edge styling: the cascade-skipped fail edge must render DIMMED, NOT
    // red ('failed'). The pass-branch edge that ran is green ('#22C55E', traversed).
    // Reload the page to exercise the session-recovery path: block_states
    // come back from GET /workbench/session as a flat ``{node_id: status}``
    // dict and the edge colorizer re-runs against them.
    await page.reload()
    await waitForCanvasLoad(page)

    const edgeStyles = await page.evaluate(() => {
      const result: Record<string, string | null> = {}
      document.querySelectorAll('.react-flow__edge').forEach((g) => {
        const id = g.getAttribute('data-id') ?? ''
        const path = g.querySelector('path.react-flow__edge-path') as SVGPathElement | null
        result[id] = path?.style.stroke || path?.getAttribute('stroke') || null
      })
      return result
    })
    // Find Assert -> pass-log and Assert -> fail-log edges.
    const passEdge = Object.entries(edgeStyles).find(([id]) => id.includes('e-assert-pass'))
    const failEdge = Object.entries(edgeStyles).find(([id]) => id.includes('e-assert-fail'))
    expect(passEdge, 'assert -> pass-log edge must exist').toBeDefined()
    expect(failEdge, 'assert -> fail-log edge must exist').toBeDefined()
    const passColor = passEdge![1]?.toLowerCase()
    const failColor = failEdge![1]?.toLowerCase()
    // Pass edge: green '#22c55e' (rgb(34, 197, 94)).
    expect(passColor, 'pass edge must be green (traversed) when pass branch ran').toMatch(/22c55e|rgb\(34,\s*197,\s*94\)/)
    // Fail edge: dimmed gray '#71717a' (rgb(113, 113, 122)) - NOT red.
    expect(failColor, 'fail edge must be DIMMED (gray), not red, when fail branch cascade-skipped').not.toMatch(/ef4444|rgb\(239,\s*68,\s*68\)/)
  })

  test('disabled Assert mutes its non-pass-through branch descendants at design time', async ({
    request,
    page,
  }) => {
    // Sibling case: BEFORE any run, a disabled split-mode Assert should
    // visually mute every node reachable only through its non-'pass'
    // branch. Same treatment as a topologically-disconnected node
    // (``data-muted="true"`` on the status bar; no execution badge); the
    // pass-branch descendant stays interactive because that branch IS
    // the disabled control's pass-through.
    await ensureEnvironment(request)
    const testId = await seedFixture(request)

    await page.setViewportSize({ width: 1280, height: 900 })
    // Clear any active workbench session BEFORE navigating - the session-
    // recovery dialog otherwise intercepts pointer events and the
    // node-querying evaluate() finds zero nodes (because the canvas is
    // still showing the previous test's overlay).
    await page.request.delete(`${BASE}/workbench/session`).catch(() => {})
    await page.goto(`/workbench?editTest=${testId}`)
    await page.evaluate(() => localStorage.clear())
    await page.goto(`/workbench?editTest=${testId}`)
    await waitForCanvasLoad(page)

    // Read data-muted from each Log's status bar. Status bar testid is
    // ``node-status-bar``; it lives inside the node wrapper.
    const muted = await page.evaluate(() => {
      const out: Record<string, string | null> = {}
      document.querySelectorAll('[data-testid^="workflow-node-"][data-nodetype]').forEach((n) => {
        const testId = n.getAttribute('data-testid') ?? ''
        const nodeId = testId.replace(/^workflow-node-/, '')
        const bar = n.querySelector('[data-testid="node-status-bar"]')
        out[nodeId] = bar?.getAttribute('data-muted') ?? null
      })
      return out
    })

    if (muted[FAIL_LOG_ID] !== 'true' || muted[PASS_LOG_ID] !== null) {
      console.log('[diag] muted=', JSON.stringify(muted))
    }
    // pass-branch descendant: NOT muted (pass is the disabled Assert's pass-through).
    expect(muted[PASS_LOG_ID], 'pass-branch Log should NOT be muted').toBeNull()
    // fail-branch descendant: muted (cascade-skipped at design time).
    expect(muted[FAIL_LOG_ID], 'fail-branch Log must be muted - it cannot execute while Assert is disabled').toBe('true')
  })
})
