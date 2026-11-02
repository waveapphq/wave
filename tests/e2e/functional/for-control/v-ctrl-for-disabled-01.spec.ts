/**
 * V-CTRL-FOR-DISABLED-01: Disabled For loop is a pass-through.
 *
 * Sibling V-test to v-ctrl-assert-disabled-01 covering the SCOPED category
 * (For / For-Each / While / Try-Catch-Finally all behave the same: a
 * `body` egress and a `then` egress; `then` is the pass-through).
 *
 * Pass criteria:
 *   1. body Log does NOT fire (cascade-skipped)
 *   2. then Log DOES fire (pass-through via the `then` egress)
 *   3. session final status == "passed"
 */
import { test, expect, type APIRequestContext, type Page } from '../../helpers/playwright-fixtures'
import { BACKEND_PORT, E2E_ENV_NAME, ensureEnvironment } from '../../helpers/config'
import { waitForCanvasLoad } from '../../helpers/canvas'

const BASE = `http://localhost:${BACKEND_PORT}`

const FOR_ID = 'for-disabled'
const BODY_LOG_ID = 'body-log'
const THEN_LOG_ID = 'then-log'

function buildFixture(): Record<string, unknown> {
  return {
    name: `V-CTRL-FOR-DISABLED-01 ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    version: '1.0.0',
    description: 'Disabled For loop pass-through (then runs, body cascade-skips)',
    workflow: {
      nodes: [
        {
          id: FOR_ID,
          type: 'workflowNode',
          position: { x: 200, y: 200 },
          data: {
            label: 'For_1',
            elementType: 'for',
            nodeType: 'control',
            category: 'control',
            version: '1.0.0',
            disabled: true,
            config: {
              values: { start: 0, end: 3, step: 1, variable: 'i' },
              outputBindings: {},
              profileBindings: [],
            },
          },
        },
        {
          id: BODY_LOG_ID,
          type: 'workflowNode',
          position: { x: 100, y: 400 },
          data: {
            label: 'Body_Log',
            elementType: 'log',
            nodeType: 'plugin',
            version: '1.0.0',
            expressionFields: ['message'],
            templateFields: [],
            variableExpressionKeys: [],
            config: {
              values: { message: "'BODY-FIRED'", level: 'INFO' },
              profileBindings: [],
              outputBindings: {},
            },
          },
        },
        {
          id: THEN_LOG_ID,
          type: 'workflowNode',
          position: { x: 400, y: 400 },
          data: {
            label: 'Then_Log',
            elementType: 'log',
            nodeType: 'plugin',
            version: '1.0.0',
            expressionFields: ['message'],
            templateFields: [],
            variableExpressionKeys: [],
            config: {
              values: { message: "'THEN-FIRED'", level: 'INFO' },
              profileBindings: [],
              outputBindings: {},
            },
          },
        },
      ],
      edges: [
        { id: 'e-start-for', source: 'start-node', target: FOR_ID },
        { id: 'e-for-body', source: FOR_ID, target: BODY_LOG_ID, sourceHandle: 'body' },
        { id: 'e-for-then', source: FOR_ID, target: THEN_LOG_ID, sourceHandle: 'then' },
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

async function selectEnvironment(page: Page, envName: string) {
  const selector = page.locator('[data-testid="environment-selector"]')
  const popover = page.locator('[data-testid="environment-popover"]')
  // Retry the trigger open: under container-shard load a transient canvas overlay
  // can make the first click a no-op (15s actionability timeout otherwise).
  await expect(async () => {
    await selector.click({ timeout: 5000 })
    await expect(popover).toBeVisible({ timeout: 2000 })
  }).toPass({ timeout: 30000 })
  await popover.locator(`button:has-text("${envName}")`).first().click()
  await expect(popover).not.toBeVisible()
}

test.describe('V-CTRL-FOR-DISABLED-01: disabled For loop', () => {
  test('disabled For acts as pass-through: then runs, body cascade-skips', async ({ request, page }) => {
    await ensureEnvironment(request)
    const testId = await seedFixture(request)

    await page.setViewportSize({ width: 1280, height: 900 })
    // Clear any stale cross-worker workbench session first, else its recovery
    // modal ("Test not found") covers the toolbar and blocks the env selector.
    await page.request.delete(`${BASE}/workbench/session/`).catch(() => {})
    await page.goto(`/workbench?editTest=${testId}`)
    await page.evaluate(() => localStorage.clear())
    await page.goto(`/workbench?editTest=${testId}`)
    await waitForCanvasLoad(page)

    await selectEnvironment(page, E2E_ENV_NAME)
    const finalStatus = await runFromUiAndWaitTerminal(page)
    expect(finalStatus).toBe('passed')

    const nodeStatuses = await getNodeStatusMap(page)
    // body is on a cascade-skipped non-pass-through branch -> design-time
    // muted -> no execution-status attribute. `then` ran -> 'success'.
    if (nodeStatuses[BODY_LOG_ID] !== null || nodeStatuses[THEN_LOG_ID] !== 'success') {
      console.log('[diag] nodeStatuses=', JSON.stringify(nodeStatuses))
    }
    expect(nodeStatuses[BODY_LOG_ID], 'body must be muted when For loop is disabled (non-pass-through branch)').toBeNull()
    expect(nodeStatuses[THEN_LOG_ID], 'then must run as pass-through when For loop is disabled').toBe('success')
  })
})
