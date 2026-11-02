/**
 * V-CTRL-IFELSE-DISABLED-01: Disabled If/Else is a pass-through to the first branch.
 *
 * Sibling V-test to v-ctrl-assert-disabled-01 covering the diverging
 * conditional category. By design, a disabled If/Else takes the
 * user's first declared branch (typically the ``if`` branch) as its
 * pass-through; the other branches cascade-skip.
 *
 * Pass criteria:
 *   1. The Log under the first branch ('if') DOES fire
 *   2. The Log under the second branch ('else') is cascade-skipped
 *   3. session final status == "passed"
 */
import { test, expect, type APIRequestContext, type Page } from '../../helpers/playwright-fixtures'
import { BACKEND_PORT, E2E_ENV_NAME, ensureEnvironment } from '../../helpers/config'
import { waitForCanvasLoad } from '../../helpers/canvas'

const BASE = `http://localhost:${BACKEND_PORT}`

const IFELSE_ID = 'ifelse-disabled'
const IF_LOG_ID = 'if-log'
const ELSE_LOG_ID = 'else-log'

function buildFixture(): Record<string, unknown> {
  return {
    name: `V-CTRL-IFELSE-DISABLED-01 ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    version: '1.0.0',
    description: 'Disabled If/Else pass-through (first branch runs)',
    workflow: {
      nodes: [
        {
          id: IFELSE_ID,
          type: 'workflowNode',
          position: { x: 200, y: 200 },
          data: {
            label: 'IfElse_1',
            elementType: 'if-else',
            nodeType: 'control',
            category: 'control',
            version: '1.0.0',
            disabled: true,
            config: {
              values: {
                branches: [
                  { id: 'branch_if', type: 'if', label: '', conditions: [] },
                  { id: 'branch_else', type: 'else', label: '' },
                ],
              },
              outputBindings: {},
              profileBindings: [],
            },
          },
        },
        {
          id: IF_LOG_ID,
          type: 'workflowNode',
          position: { x: 100, y: 400 },
          data: {
            label: 'If_Log',
            elementType: 'log',
            nodeType: 'plugin',
            version: '1.0.0',
            expressionFields: ['message'],
            templateFields: [],
            variableExpressionKeys: [],
            config: {
              values: { message: "'IF-FIRED'", level: 'INFO' },
              profileBindings: [],
              outputBindings: {},
            },
          },
        },
        {
          id: ELSE_LOG_ID,
          type: 'workflowNode',
          position: { x: 400, y: 400 },
          data: {
            label: 'Else_Log',
            elementType: 'log',
            nodeType: 'plugin',
            version: '1.0.0',
            expressionFields: ['message'],
            templateFields: [],
            variableExpressionKeys: [],
            config: {
              values: { message: "'ELSE-FIRED'", level: 'INFO' },
              profileBindings: [],
              outputBindings: {},
            },
          },
        },
      ],
      edges: [
        { id: 'e-start-if', source: 'start-node', target: IFELSE_ID },
        { id: 'e-if-branch', source: IFELSE_ID, target: IF_LOG_ID, sourceHandle: 'branch_if' },
        { id: 'e-else-branch', source: IFELSE_ID, target: ELSE_LOG_ID, sourceHandle: 'branch_else' },
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
  await page.locator('[data-testid="environment-selector"]').click()
  const popover = page.locator('[data-testid="environment-popover"]')
  await expect(popover).toBeVisible()
  await popover.locator(`button:has-text("${envName}")`).first().click()
  await expect(popover).not.toBeVisible()
}

test.describe('V-CTRL-IFELSE-DISABLED-01: disabled If/Else', () => {
  test('disabled If/Else acts as pass-through: first branch runs, others cascade-skip', async ({ request, page }) => {
    await ensureEnvironment(request)
    const testId = await seedFixture(request)

    await page.setViewportSize({ width: 1280, height: 900 })
    // Clear any active workbench session BEFORE navigating - otherwise the
    // session-recovery dialog ("Active Execution State") can intercept the
    // env-selector click.
    await page.request.delete(`${BASE}/workbench/session`).catch(() => {})
    await page.goto(`/workbench?editTest=${testId}`)
    await page.evaluate(() => localStorage.clear())
    await page.goto(`/workbench?editTest=${testId}`)
    await waitForCanvasLoad(page)

    await selectEnvironment(page, E2E_ENV_NAME)
    const finalStatus = await runFromUiAndWaitTerminal(page)
    expect(finalStatus).toBe('passed')

    const nodeStatuses = await getNodeStatusMap(page)
    // else-branch Log is on a non-pass-through branch -> design-time muted
    // -> no execution-status. The if-branch Log ran -> 'success'.
    if (nodeStatuses[IF_LOG_ID] !== 'success' || nodeStatuses[ELSE_LOG_ID] !== null) {
      console.log('[diag] nodeStatuses=', JSON.stringify(nodeStatuses))
    }
    expect(nodeStatuses[IF_LOG_ID], 'first branch (if) must run as pass-through when If/Else is disabled').toBe('success')
    expect(
      nodeStatuses[ELSE_LOG_ID],
      'second branch (else) must be muted when If/Else is disabled',
    ).toBeNull()
  })
})
