/**
 * V-CTRL-ASSERT-FN-PROPAGATE-01: a failed Function halts the parent test.
 *
 * When a Function body fails - including the
 * scope-fail case from inner ``Assert(fail_current_scope=True)`` - the
 * Function block must propagate the failure as an exception. The parent
 * engine then halts the rest of the test, exactly like any other failed
 * plugin / control. A wrapping ``Try/Catch`` catches the exception, routes
 * into ``catch``, and the test ends ``passed``.
 *
 * Pass criteria:
 *   Part 1 - no Try/Catch: ``Log_before`` runs, Function fails, ``Log_after``
 *     does NOT run, session ends ``failed``.
 *   Part 2 - Try/Catch wraps the Function: ``Log_caught`` runs, ``Log_after``
 *     (sibling-after the Try/Catch) runs, session ends ``passed``.
 */
import { test, expect, type APIRequestContext, type Page } from '../../helpers/playwright-fixtures'
import { BACKEND_PORT, E2E_ENV_NAME, ensureEnvironment } from '../../helpers/config'
import { waitForCanvasLoad } from '../../helpers/canvas'
import { getLogTexts } from '../../helpers/log-reader'

const BASE = `http://localhost:${BACKEND_PORT}`

function logNode(id: string, label: string, msg: string, position: { x: number; y: number }) {
  return {
    id,
    type: 'workflowNode',
    position,
    data: {
      label,
      elementType: 'log',
      nodeType: 'plugin',
      version: '1.0.0',
      expressionFields: ['message'],
      templateFields: [],
      variableExpressionKeys: [],
      config: {
        values: { message: `'${msg}'`, level: 'INFO' },
        profileBindings: [],
        outputBindings: {},
      },
    },
  }
}

function failingAssertNode(id: string, position: { x: number; y: number }) {
  return {
    id,
    type: 'workflowNode',
    position,
    data: {
      label: 'Assert_Fail',
      elementType: 'assert',
      nodeType: 'control',
      category: 'control',
      version: '1.0.0',
      config: {
        values: {
          mode: 'single',
          // An expression that evaluates False - a single-mode failure fails the block.
          assertions: [{ type: 'expression', expression: 'False' }],
          fail_current_scope: true,
        },
        outputBindings: {},
        profileBindings: [],
      },
    },
  }
}

function functionWithFailingAssert(id: string, position: { x: number; y: number }) {
  return {
    id,
    type: 'workflowNode',
    position,
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
          nodes: [failingAssertNode('inner-assert', { x: 200, y: 100 })],
          edges: [{ id: 'e-start-inner', source: 'start-node', target: 'inner-assert' }],
        },
        inputs: [],
        outputs: [],
        variables: [],
      },
    },
  }
}

function buildPlainFixture(name: string): Record<string, unknown> {
  // Start -> Log_before -> Function (inner Assert fails) -> Log_after
  return {
    name,
    version: '1.0.0',
    description: 'Failed Function halts parent (no Try/Catch).',
    workflow: {
      nodes: [
        logNode('log-before', 'Log_before', 'BEFORE-FIRED', { x: 100, y: 100 }),
        functionWithFailingAssert('fn', { x: 100, y: 250 }),
        logNode('log-after', 'Log_after', 'AFTER-FIRED', { x: 100, y: 400 }),
      ],
      edges: [
        { id: 'e-start-before', source: 'start-node', target: 'log-before' },
        { id: 'e-before-fn', source: 'log-before', target: 'fn' },
        { id: 'e-fn-after', source: 'fn', target: 'log-after' },
      ],
    },
  }
}

function buildTryCatchFixture(name: string): Record<string, unknown> {
  // Start -> Log_before -> Try/Catch(try=Function-fails, catch=Log_caught, then=Log_after)
  return {
    name,
    version: '1.0.0',
    description: 'Try/Catch absorbs failed Function exception.',
    workflow: {
      nodes: [
        logNode('log-before', 'Log_before', 'BEFORE-FIRED', { x: 100, y: 80 }),
        {
          id: 'tc',
          type: 'workflowNode',
          position: { x: 100, y: 220 },
          data: {
            label: 'TryCatch',
            elementType: 'try-catch-finally',
            nodeType: 'control',
            category: 'control',
            version: '1.0.0',
            config: {
              values: { enable_catch: true, enable_finally: false },
              outputBindings: {},
              profileBindings: [],
            },
          },
        },
        functionWithFailingAssert('fn', { x: 50, y: 360 }),
        logNode('log-caught', 'Log_caught', 'CAUGHT-FIRED', { x: 250, y: 360 }),
        logNode('log-after', 'Log_after', 'AFTER-FIRED', { x: 100, y: 500 }),
      ],
      edges: [
        { id: 'e-start-before', source: 'start-node', target: 'log-before' },
        { id: 'e-before-tc', source: 'log-before', target: 'tc' },
        { id: 'e-tc-try', source: 'tc', target: 'fn', sourceHandle: 'try' },
        { id: 'e-tc-catch', source: 'tc', target: 'log-caught', sourceHandle: 'catch' },
        { id: 'e-tc-then', source: 'tc', target: 'log-after', sourceHandle: 'then' },
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

async function runAndWaitTerminal(page: Page): Promise<string> {
  await page.locator('[data-testid="run-button"]').click()
  const status = page.locator('[data-testid="workflow-status"]')
  await expect(status).not.toHaveAttribute('data-status', 'idle', { timeout: 5_000 })
  await expect(status).not.toHaveAttribute('data-status', 'running', { timeout: 20_000 })
  return (await status.getAttribute('data-status')) ?? 'unknown'
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

test.describe('V-CTRL-ASSERT-FN-PROPAGATE-01', () => {
  test('failed Function (inner Assert scope-fail) HALTS the parent test - Log_after does NOT run', async ({
    request,
    page,
  }) => {
    await ensureEnvironment(request)
    const name = `V-CTRL-ASSERT-FN-PROPAGATE plain ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const testId = await seed(request, buildPlainFixture(name))

    await openCanvas(page, testId)
    await selectEnvironment(page, E2E_ENV_NAME)
    const finalStatus = await runAndWaitTerminal(page)
    expect(finalStatus, 'session must end "failed" - inner scope-fail propagated as exception').toBe('failed')

    const logs = await getLogTexts(page)
    const joined = logs.join('\n')
    expect(joined, 'Log_before must have fired').toContain('BEFORE-FIRED')
    expect(
      joined,
      'Log_after must NOT have fired - failed Function should halt the parent flow',
    ).not.toContain('AFTER-FIRED')
  })

  test('Try/Catch wrapping a failed Function catches it and the test ends passed', async ({
    request,
    page,
  }) => {
    await ensureEnvironment(request)
    const name = `V-CTRL-ASSERT-FN-PROPAGATE trycatch ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const testId = await seed(request, buildTryCatchFixture(name))

    await openCanvas(page, testId)
    await selectEnvironment(page, E2E_ENV_NAME)
    const finalStatus = await runAndWaitTerminal(page)
    expect(finalStatus, 'Try/Catch must absorb the Function exception - test ends "passed"').toBe('passed')

    const logs = await getLogTexts(page)
    const joined = logs.join('\n')
    expect(joined, 'Log_before must have fired').toContain('BEFORE-FIRED')
    expect(joined, 'catch branch (Log_caught) must have fired').toContain('CAUGHT-FIRED')
    expect(joined, 'Log_after (then-egress) must have fired').toContain('AFTER-FIRED')
  })
})
