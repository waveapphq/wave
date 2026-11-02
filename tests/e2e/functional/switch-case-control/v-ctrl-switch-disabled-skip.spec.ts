/**
 * V-CTRL-SWITCH-DISABLED-SKIP: a Switch is a container, not a diverging node.
 *
 * Two consequences the engine must honor:
 *   1. A DISABLED Switch cascade-skips every case and the default and keeps
 *      going through `then` - it never picks a branch as a pass-through.
 *   2. Skip Block on a PAUSED Switch is accepted (it is not refused as a
 *      branching node): the cases and the default are skipped and the run
 *      re-pauses BEFORE the `then` successor.
 *
 * Both are asserted on what actually executed - the case bodies must leave no
 * log while `then` does - so a lost cascade cannot pass silently.
 *
 * REQ: REQ-3.5.1.20 (Switch/Case multi-branch decisions)
 */

import { test, expect, type APIRequestContext, type Page } from '../../helpers/playwright-fixtures'
import { BACKEND_PORT, ensureEnvironment } from '../../helpers/config'
import { waitForCanvasLoad } from '../../helpers/canvas'
import { clearPointerLock, selectEnvironment } from '../../helpers/workbench'
import { getLogTexts, waitForLogText } from '../../helpers/log-reader'

const BASE = `http://localhost:${BACKEND_PORT}`

const SWITCH_ID = 'sw-under-test'
const CASE_LOG_ID = 'log-case'
const DEFAULT_LOG_ID = 'log-default'
const THEN_LOG_ID = 'log-then'
const AFTER_LOG_ID = 'log-after'

function logNode(id: string, description: string, message: string, x: number, y: number) {
  return {
    id,
    type: 'workflowNode',
    position: { x, y },
    data: {
      label: 'Log',
      elementType: 'log',
      nodeType: 'plugin',
      category: 'system',
      version: '1.0.0',
      description,
      expressionFields: ['message'],
      templateFields: [],
      variableExpressionKeys: [],
      config: {
        values: { message: `'${message}'`, level: 'INFO' },
        outputBindings: {},
        profileBindings: [],
      },
    },
    measured: { width: 120, height: 62 },
  }
}

function buildFixture(disabled: boolean): Record<string, unknown> {
  return {
    name: `V-CTRL-SWITCH-DISABLED-SKIP ${disabled ? 'disabled' : 'skip'} ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    version: '1.0.0',
    description: 'Switch with two cases and a default; every lane wired, then continues.',
    workflow: {
      nodes: [
        {
          id: SWITCH_ID,
          type: 'workflowNode',
          position: { x: 400, y: 120 },
          data: {
            label: 'Switch',
            elementType: 'switch-case',
            nodeType: 'control',
            category: 'conditional',
            version: '1.0.0',
            description: 'Switch under test',
            ...(disabled ? { disabled: true } : {}),
            expressionFields: [],
            templateFields: [],
            variableExpressionKeys: [],
            config: {
              values: {
                branches: [
                  {
                    id: 'branch_0',
                    type: 'case',
                    label: 'always true',
                    break: true,
                    conditions: [
                      {
                        type: 'literal',
                        variable: 'sw',
                        value_type: 'string',
                        operator: 'equals',
                        reference_value: 'go',
                        reference_is_expression: false,
                        id: 'cond-0',
                      },
                    ],
                  },
                  { id: 'branch_1', type: 'default', label: 'fallback' },
                ],
              },
              outputBindings: {},
              profileBindings: [],
            },
          },
          measured: { width: 240, height: 62 },
        },
        logNode(CASE_LOG_ID, 'Case body', 'SWITCH-CASE-FIRED', 200, 300),
        logNode(DEFAULT_LOG_ID, 'Default body', 'SWITCH-DEFAULT-FIRED', 400, 300),
        logNode(THEN_LOG_ID, 'Then body', 'SWITCH-THEN-FIRED', 620, 300),
        logNode(AFTER_LOG_ID, 'After', 'SWITCH-AFTER', 620, 420),
      ],
      edges: [
        { id: 'e-start', source: 'start-node', target: SWITCH_ID, type: 'default' },
        { id: 'e-case', source: SWITCH_ID, sourceHandle: 'branch_0', target: CASE_LOG_ID, type: 'default' },
        { id: 'e-default', source: SWITCH_ID, sourceHandle: 'branch_1', target: DEFAULT_LOG_ID, type: 'default' },
        { id: 'e-then', source: SWITCH_ID, sourceHandle: 'then', target: THEN_LOG_ID, type: 'default' },
        { id: 'e-after', source: THEN_LOG_ID, target: AFTER_LOG_ID, type: 'default' },
      ],
    },
    variables: {
      sw: { value: 'go', type: 'string', scope: 'test' },
    },
    metadata: {},
  }
}

async function seedAndOpen(
  page: Page,
  request: APIRequestContext,
  fixture: Record<string, unknown>,
): Promise<void> {
  await ensureEnvironment(request)
  await page.request.delete(`${BASE}/workbench/session/`).catch(() => {})

  const resp = await request.post(`${BASE}/tests`, { data: fixture })
  const body = await resp.json().catch(() => null)
  expect(
    resp.ok(),
    `POST /tests failed: ${resp.status()} - ${JSON.stringify(body)}`,
  ).toBeTruthy()
  const testId = body.data?.id ?? body.id

  const validateResp = await request.post(`${BASE}/tests/${testId}/validate`)
  const validateBody = await validateResp.json().catch(() => null)
  const errors =
    validateBody?.data?.errors ?? validateBody?.error?.details?.[0]?.errors ?? []
  expect(errors.length, `Fixture failed validation: ${JSON.stringify(errors)}`).toBe(0)

  await page.goto(`/workbench?editTest=${testId}`)
  await page.evaluate(() => localStorage.clear())
  await page.goto(`/workbench?editTest=${testId}`)
  await waitForCanvasLoad(page)
}

test.describe('V-CTRL-SWITCH-DISABLED-SKIP: container semantics for disable and skip', () => {
  test('a disabled Switch skips every case and the default and continues via then', async ({
    page,
    request,
  }) => {
    await seedAndOpen(page, request, buildFixture(true))
    await selectEnvironment(page)

    await page.locator('[data-testid="run-button"]').click()
    const status = page.locator('[data-testid="workflow-status"]')
    await expect(status).not.toHaveAttribute('data-status', 'idle', { timeout: 10_000 })
    await expect(status).not.toHaveAttribute('data-status', 'running', { timeout: 30_000 })
    expect(await status.getAttribute('data-status')).toBe('passed')

    await waitForLogText(page, 'SWITCH-AFTER')
    const logs = await getLogTexts(page)
    const all = logs.join('\n')

    expect(
      logs.some((t) => t.includes('SWITCH-CASE-FIRED')),
      `A disabled Switch must not run its case body.\n${all}`,
    ).toBeFalsy()
    expect(
      logs.some((t) => t.includes('SWITCH-DEFAULT-FIRED')),
      `A disabled Switch must not run its default body.\n${all}`,
    ).toBeFalsy()
    expect(
      logs.some((t) => t.includes('SWITCH-THEN-FIRED')),
      `A disabled Switch must still continue through its then egress.\n${all}`,
    ).toBeTruthy()
  })

  test('Skip Block on a paused Switch cascades the lanes and re-pauses before then', async ({
    page,
    request,
  }) => {
    await seedAndOpen(page, request, buildFixture(false))

    // Pick the environment BEFORE the context menu: a just-closed Radix menu
    // leaves the toolbar re-laying-out, which the popover click races.
    await selectEnvironment(page)

    // Breakpoint on the Switch itself.
    const switchNode = page.locator(`[data-testid="workflow-node-${SWITCH_ID}"]`)
    await expect(switchNode).toBeVisible()
    const menu = page.locator('[role="menu"]')
    await expect(async () => {
      await switchNode.click({ button: 'right' })
      await menu.getByText('Toggle Breakpoint', { exact: true }).click({ timeout: 2000 })
    }).toPass({ timeout: 15_000 })
    await expect(menu).not.toBeVisible()
    await clearPointerLock(page)

    await page.locator('[data-testid="debug-button"]').click()

    const status = page.locator('[data-testid="workflow-status"]')
    await expect(status).toHaveAttribute('data-status', 'paused', { timeout: 30_000 })
    await expect(switchNode).toHaveAttribute('data-paused', 'true')

    // Switch left the diverging set, so Skip Block is offered, not refused.
    const skipBtn = page.locator('[data-testid="action-skip-block-button"]')
    await expect(skipBtn).toBeVisible()
    await expect(skipBtn).not.toHaveAttribute('aria-disabled', 'true')
    await skipBtn.click()

    // Re-pauses BEFORE the then successor rather than running it.
    const thenNode = page.locator(`[data-testid="workflow-node-${THEN_LOG_ID}"]`)
    await expect(status).toHaveAttribute('data-status', 'paused', { timeout: 30_000 })
    await expect(thenNode).toHaveAttribute('data-paused', 'true', { timeout: 15_000 })

    await page.locator('[data-testid="action-continue-button"]').click()
    await expect(status).not.toHaveAttribute('data-status', 'running', { timeout: 30_000 })
    await expect(status).not.toHaveAttribute('data-status', 'paused', { timeout: 30_000 })

    await waitForLogText(page, 'SWITCH-AFTER')
    const logs = await getLogTexts(page)
    const all = logs.join('\n')

    expect(
      logs.some((t) => t.includes('SWITCH-CASE-FIRED')),
      `Skip must cascade the case lane, not run it.\n${all}`,
    ).toBeFalsy()
    expect(
      logs.some((t) => t.includes('SWITCH-DEFAULT-FIRED')),
      `Skip must cascade the default lane, not run it.\n${all}`,
    ).toBeFalsy()
    expect(
      logs.some((t) => t.includes('SWITCH-THEN-FIRED')),
      `The then successor runs once the user continues past the re-pause.\n${all}`,
    ).toBeTruthy()
  })
})
