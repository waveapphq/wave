/**
 * V-CTRL-HALT-FAILED-STATUS-01: Halt(status=failed) node renders as failed.
 *
 * Per REQ-3.5.1.14, a Halt with ``status=failed`` must render with the FAILED
 * visual treatment (red border / X icon). The session itself must end
 * ``failed``. Both at the root level and inside a Function body.
 *
 * The Halt node must not show as ``passed`` (green) when
 * the session halts with ``failed``. When the Halt sits inside a Function,
 * the Function block must not show as ``passed`` either.
 *
 * Pass criteria:
 *   1. Root case: Halt node ``data-execution-status === "failed"``;
 *      session ends ``failed``.
 *   2. Inner case: Halt inside Function -> Function node ``data-execution-status
 *      === "failed"`` (mapped from inner halt_status); session ends ``failed``.
 */
import { test, expect, type APIRequestContext, type Page } from '../../helpers/playwright-fixtures'
import { BACKEND_PORT, E2E_ENV_NAME, ensureEnvironment } from '../../helpers/config'
import { waitForCanvasLoad } from '../../helpers/canvas'

const BASE = `http://localhost:${BACKEND_PORT}`

const ROOT_HALT_ID = 'halt-root'
const FN_ID = 'fn-with-halt'
const INNER_HALT_ID = 'inner-halt'

function haltNode(id: string, position: { x: number; y: number }) {
  return {
    id,
    type: 'workflowNode',
    position,
    data: {
      label: 'Halt_1',
      elementType: 'halt',
      nodeType: 'control',
      category: 'control',
      version: '1.0.0',
      config: {
        values: { scope: 'test', status: 'failed', message: 'halted' },
        outputBindings: {},
        profileBindings: [],
      },
    },
  }
}

function buildRootFixture(name: string): Record<string, unknown> {
  return {
    name,
    version: '1.0.0',
    description: 'Halt(failed) at root',
    workflow: {
      nodes: [haltNode(ROOT_HALT_ID, { x: 200, y: 200 })],
      edges: [{ id: 'e-start-halt', source: 'start-node', target: ROOT_HALT_ID }],
    },
  }
}

function buildFnFixture(name: string): Record<string, unknown> {
  // Log_before -> Function -> Log_after.
  // Inside Function: Log_inner -> Halt(scope=test, status=failed).
  return {
    name,
    version: '1.0.0',
    description: 'Function with Log_inner -> Halt(failed); flanked by Log_before/Log_after',
    workflow: {
      nodes: [
        {
          id: 'log-before',
          type: 'workflowNode',
          position: { x: 100, y: 100 },
          data: {
            label: 'Log_before',
            elementType: 'log',
            nodeType: 'plugin',
            version: '1.0.0',
            expressionFields: ['message'],
            templateFields: [],
            variableExpressionKeys: [],
            config: {
              values: { message: "'BEFORE-FIRED'", level: 'INFO' },
              profileBindings: [],
              outputBindings: {},
            },
          },
        },
        {
          id: FN_ID,
          type: 'workflowNode',
          position: { x: 100, y: 250 },
          data: {
            label: 'Function_1',
            elementType: 'function',
            nodeType: 'function',
            functionLifecycle: 'local',
            category: 'function',
            version: '1.0.0',
            hasNewerVersion: false,
            expressionFields: [],
            templateFields: [],
            variableExpressionKeys: [],
            localDefinition: {
              name: 'Function_1',
              workflow: {
                nodes: [
                  {
                    id: 'inner-log',
                    type: 'workflowNode',
                    position: { x: 100, y: 80 },
                    data: {
                      label: 'Log_inner',
                      elementType: 'log',
                      nodeType: 'plugin',
                      version: '1.0.0',
                      expressionFields: ['message'],
                      templateFields: [],
                      variableExpressionKeys: [],
                      config: {
                        values: { message: "'INNER-FIRED'", level: 'INFO' },
                        profileBindings: [],
                        outputBindings: {},
                      },
                    },
                  },
                  haltNode(INNER_HALT_ID, { x: 100, y: 220 }),
                ],
                edges: [
                  { id: 'e-start-inner', source: 'start-node', target: 'inner-log' },
                  { id: 'e-inner-halt', source: 'inner-log', target: INNER_HALT_ID },
                ],
              },
              inputs: [],
              outputs: [],
              variables: [],
            },
          },
        },
        {
          id: 'log-after',
          type: 'workflowNode',
          position: { x: 100, y: 400 },
          data: {
            label: 'Log_after',
            elementType: 'log',
            nodeType: 'plugin',
            version: '1.0.0',
            expressionFields: ['message'],
            templateFields: [],
            variableExpressionKeys: [],
            config: {
              values: { message: "'AFTER-FIRED'", level: 'INFO' },
              profileBindings: [],
              outputBindings: {},
            },
          },
        },
      ],
      edges: [
        { id: 'e-start-before', source: 'start-node', target: 'log-before' },
        { id: 'e-before-fn', source: 'log-before', target: FN_ID },
        { id: 'e-fn-after', source: FN_ID, target: 'log-after' },
      ],
    },
  }
}

async function seed(request: APIRequestContext, fixture: Record<string, unknown>): Promise<string> {
  const resp = await request.post(`${BASE}/tests`, { data: fixture })
  const body = await resp.json().catch(() => null)
  expect(body?.success === true, `POST /tests failed: ${resp.status()} - ${JSON.stringify(body)}`).toBeTruthy()
  return body.data.id
}

async function selectEnvironment(page: Page, envName: string) {
  await page.locator('[data-testid="environment-selector"]').click()
  const popover = page.locator('[data-testid="environment-popover"]')
  await expect(popover).toBeVisible()
  await popover.locator(`button:has-text("${envName}")`).first().click()
  await expect(popover).not.toBeVisible()
}

async function runAndWait(page: Page): Promise<string> {
  await page.locator('[data-testid="run-button"]').click()
  const status = page.locator('[data-testid="workflow-status"]')
  await expect(status).not.toHaveAttribute('data-status', 'idle', { timeout: 5_000 })
  await expect(status).not.toHaveAttribute('data-status', 'running', { timeout: 15_000 })
  return (await status.getAttribute('data-status')) ?? 'unknown'
}

async function getNodeStatusMap(page: Page): Promise<Record<string, string | null>> {
  return page.evaluate(() => {
    const out: Record<string, string | null> = {}
    document.querySelectorAll('[data-testid^="workflow-node-"][data-nodetype]').forEach((n) => {
      const testId = n.getAttribute('data-testid') ?? ''
      out[testId.replace(/^workflow-node-/, '')] = n.getAttribute('data-execution-status')
    })
    return out
  })
}

async function openCanvas(page: Page, testId: string) {
  await page.setViewportSize({ width: 1280, height: 900 })
  // Clear any active workbench session BEFORE navigating - otherwise the
  // session-recovery dialog ("Active Execution State") intercepts pointer
  // events and the env-selector click times out.
  await page.request.delete(`${BASE}/workbench/session`).catch(() => {})
  await page.goto(`/workbench?editTest=${testId}`)
  await page.evaluate(() => localStorage.clear())
  await page.goto(`/workbench?editTest=${testId}`)
  await waitForCanvasLoad(page)
}

test.describe('V-CTRL-HALT-FAILED-STATUS-01', () => {
  test('Halt(status=failed) at root renders the Halt node as "failed"', async ({ request, page }) => {
    await ensureEnvironment(request)
    const name = `V-CTRL-HALT-FAILED-STATUS root ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const testId = await seed(request, buildRootFixture(name))

    await openCanvas(page, testId)
    await selectEnvironment(page, E2E_ENV_NAME)
    const finalStatus = await runAndWait(page)
    expect(finalStatus, 'session must end "failed" (halt_status=failed)').toBe('failed')

    const nodeStatuses = await getNodeStatusMap(page)
    if (nodeStatuses[ROOT_HALT_ID] !== 'failed') {
      console.log('[diag root] nodeStatuses=', JSON.stringify(nodeStatuses))
    }
    expect(
      nodeStatuses[ROOT_HALT_ID],
      'Halt node must render as "failed" (red border / X icon per design REQ-3.5.1.14)',
    ).toBe('failed')
  })

  test('Halt(status=failed) inside Function renders Function as "failed"', async ({ request, page }) => {
    await ensureEnvironment(request)
    const name = `V-CTRL-HALT-FAILED-STATUS fn ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const testId = await seed(request, buildFnFixture(name))

    await openCanvas(page, testId)
    await selectEnvironment(page, E2E_ENV_NAME)
    const finalStatus = await runAndWait(page)
    expect(finalStatus, 'session must end "failed"').toBe('failed')

    const nodeStatuses = await getNodeStatusMap(page)
    // Also inspect the badge text + data-state so we know what's actually
    // shown to the user.
    const badges = await page.evaluate(() => {
      const out: Record<string, { state: string | null; text: string | null }> = {}
      document.querySelectorAll('[data-testid^="workflow-node-"][data-nodetype]').forEach((n) => {
        const testId = n.getAttribute('data-testid') ?? ''
        const nodeId = testId.replace(/^workflow-node-/, '')
        const badge = n.querySelector('[data-testid="node-run-state-badge"]')
        out[nodeId] = {
          state: badge?.getAttribute('data-state') ?? null,
          text: badge?.textContent?.trim() ?? null,
        }
      })
      return out
    })
    expect(
      nodeStatuses[FN_ID],
      'Function whose body halted with status=failed must render as "failed"',
    ).toBe('failed')
    expect(
      badges[FN_ID]?.state,
      'Function badge data-state must be "fail" not "pass"',
    ).toBe('fail')

    // Drill into the Function and check the inner Halt's badge.
    // Function drill-in: click the chevron on the right side of the node.
    const fnNode = page.locator(`[data-testid="workflow-node-${FN_ID}"]`)
    const drillBtn = fnNode.locator('[data-testid="function-drill-in"], [aria-label*="Open" i]').first()
    if ((await drillBtn.count()) > 0) {
      await drillBtn.click()
      await page.waitForTimeout(500)
      const innerBadges = await page.evaluate(() => {
        const out: Record<string, { state: string | null; text: string | null; exec: string | null }> = {}
        document.querySelectorAll('[data-testid^="workflow-node-"][data-nodetype]').forEach((n) => {
          const testId = n.getAttribute('data-testid') ?? ''
          const nodeId = testId.replace(/^workflow-node-/, '')
          const badge = n.querySelector('[data-testid="node-run-state-badge"]')
          out[nodeId] = {
            state: badge?.getAttribute('data-state') ?? null,
            text: badge?.textContent?.trim() ?? null,
            exec: n.getAttribute('data-execution-status'),
          }
        })
        return out
      })
      expect(
        innerBadges[INNER_HALT_ID]?.state,
        'inner Halt(status=failed) badge data-state must be "fail" not "pass"',
      ).toBe('fail')
    } else {
      console.log('[diag fn] no drill-in button found, skipping inner badge check')
    }
  })
})
