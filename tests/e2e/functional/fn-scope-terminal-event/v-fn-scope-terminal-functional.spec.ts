/**
 * V-FN-SCOPE-TERMINAL (functional): Scoped Run / Debug broadcasts the
 * `execution_completed` event on the session's WebSocket topic, so the
 * FE action bar settles to its terminal state (Stop button replaced
 * with Run / Debug controls).
 *
 * The BE emits `_broadcast_event(session_id,
 * {type: "execution_completed", status})` on the success, failure, and
 * load-failure exits of `_run_scoped_function`.
 *
 * Pass Criteria:
 *   1. A passing scoped Run reaches terminal status `passed` via /status.
 *   2. A failing body (Assert that evaluates false) reaches `failed`.
 *   3. The session's WS topic receives `execution_completed` with the
 *      right status (subscribe BEFORE the run - no event replay).
 */

import { test, expect, type APIRequestContext } from '../../helpers/playwright-fixtures'
import { BACKEND_URL, FRONTEND_URL } from '../../helpers/config'
import { openSessionEventCollector } from '../../helpers/ws-events'

function buildInnerNodes(scenario: 'passing' | 'failing' | 'slow'): {
  nodes: Record<string, unknown>[]
  edges: Record<string, unknown>[]
} {
  const nodes: Record<string, unknown>[] = [
    {
      id: 'inner-log',
      type: 'workflowNode',
      position: { x: 200, y: 200 },
      data: {
        label: 'Log',
        elementType: 'log',
        nodeType: 'plugin',
        category: 'system',
        version: '1.0.0',
        expressionFields: ['message'],
        templateFields: [],
        variableExpressionKeys: [],
        config: {
          values: { message: "'scope-terminal-line'", level: 'INFO' },
          outputBindings: {},
          profileBindings: [],
        },
      },
    },
  ]
  const edges: Record<string, unknown>[] = [
    { id: 'e-start-inner', source: 'start-node', target: 'inner-log' },
  ]
  if (scenario === 'slow') {
    // A Delay control (duration in MILLISECONDS, category "timing") gives the
    // WS test time to subscribe after learning the session id but before the
    // terminal broadcast fires (there is no event replay).
    nodes.push({
      id: 'inner-delay',
      type: 'workflowNode',
      position: { x: 400, y: 200 },
      data: {
        label: 'Delay',
        elementType: 'delay',
        nodeType: 'control',
        category: 'timing',
        version: '1.0.0',
        expressionFields: [],
        templateFields: [],
        variableExpressionKeys: [],
        config: { values: { duration: 2500 }, outputBindings: {}, profileBindings: [] },
      },
    })
    edges.push({ id: 'e-log-delay', source: 'inner-log', target: 'inner-delay' })
  }
  if (scenario === 'failing') {
    // Assert control with a literal assertion that is always false:
    // 1 equals 2 -> assertion fails -> body fails.
    nodes.push({
      id: 'inner-assert',
      type: 'workflowNode',
      position: { x: 400, y: 200 },
      data: {
        label: 'Assert',
        elementType: 'assert',
        nodeType: 'control',
        category: 'flow',
        version: '1.0.0',
        expressionFields: [],
        templateFields: [],
        variableExpressionKeys: [],
        config: {
          values: {
            mode: 'single',
            assertions: [
              {
                type: 'literal',
                variable: '1',
                value_type: 'integer',
                operator: 'equals',
                reference_value: 2,
                reference_is_expression: false,
                id: 'a-fail',
              },
            ],
          },
          outputBindings: {},
          profileBindings: [],
        },
      },
    })
    edges.push({ id: 'e-log-assert', source: 'inner-log', target: 'inner-assert' })
  }
  return { nodes, edges }
}

async function seedTest(
  request: APIRequestContext,
  scenario: 'passing' | 'failing' | 'slow',
): Promise<string> {
  const body = buildInnerNodes(scenario)
  const seed = {
    name: `V-FN-SCOPE-TERMINAL-${scenario} ${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    version: '1.0.0',
    description: `Scoped run terminal event coverage (${scenario})`,
    variables: {},
    workflow: {
      nodes: [
        {
          id: 'fn-scope-terminal-1',
          type: 'workflowNode',
          position: { x: 300, y: 200 },
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
            config: { values: {}, outputBindings: {}, profileBindings: [] },
            localDefinition: {
              name: 'Function_1',
              description: 'Scope-terminal-event body',
              inputs: [],
              outputs: [],
              variables: [],
              workflow: { nodes: body.nodes, edges: body.edges },
            },
          },
        },
      ],
      edges: [{ id: 'e-start-fn', source: 'start-node', target: 'fn-scope-terminal-1' }],
    },
    metadata: {},
  }
  const resp = await request.post(`${BACKEND_URL}/tests`, { data: seed })
  const respBody = await resp.json().catch(() => null)
  expect(respBody?.success, `POST /tests ${scenario}: ${resp.status()} - ${JSON.stringify(respBody)}`).toBeTruthy()
  return respBody.data.id
}

async function seedEnvironment(request: APIRequestContext): Promise<string> {
  const resp = await request.post(`${BACKEND_URL}/environments`, {
    data: { name: `V-FN-SCOPE-TERMINAL Env ${Date.now()}`, tags: [] },
  })
  expect(resp.ok()).toBeTruthy()
  return (await resp.json()).data.id
}

async function pollTerminal(
  request: APIRequestContext,
  sessionId: string,
  maxIter = 150,
): Promise<string | null> {
  for (let i = 0; i < maxIter; i += 1) {
    const s = await request.get(`${BACKEND_URL}/workbench/${sessionId}/status`)
    if (s.status() === 200) {
      const sb = await s.json()
      if (['passed', 'failed', 'skipped'].includes(sb.data?.status)) {
        return sb.data.status
      }
    }
    await new Promise((r) => setTimeout(r, 100))
  }
  return null
}

async function startScopedRun(
  request: APIRequestContext,
  testId: string,
  envId: string,
): Promise<string> {
  const resp = await request.post(`${BACKEND_URL}/workbench/run`, {
    data: {
      test_id: testId,
      environment_id: envId,
      scope_mode: 'function',
      scoped_function_node_id: 'fn-scope-terminal-1',
    },
  })
  expect(resp.ok(), `run: ${resp.status()} ${await resp.text()}`).toBeTruthy()
  return (await resp.json()).data.session_id
}

test.describe('V-FN-SCOPE-TERMINAL (functional): execution_completed broadcasts', () => {
  test('Passing scoped run reaches terminal status `passed`', async ({ request }) => {
    const testId = await seedTest(request, 'passing')
    const envId = await seedEnvironment(request)
    await request.delete(`${BACKEND_URL}/workbench/session`).catch(() => {})
    const resp = await request.post(`${BACKEND_URL}/workbench/run`, {
      data: {
        test_id: testId,
        environment_id: envId,
        scope_mode: 'function',
        scoped_function_node_id: 'fn-scope-terminal-1',
      },
    })
    expect(resp.ok()).toBeTruthy()
    const sessionId = (await resp.json()).data.session_id
    expect(await pollTerminal(request, sessionId)).toBe('passed')
  })

  test('Failing scoped run (false Assert) reaches terminal status `failed`', async ({
    request,
  }) => {
    const testId = await seedTest(request, 'failing')
    const envId = await seedEnvironment(request)
    await request.delete(`${BACKEND_URL}/workbench/session`).catch(() => {})
    const resp = await request.post(`${BACKEND_URL}/workbench/run`, {
      data: {
        test_id: testId,
        environment_id: envId,
        scope_mode: 'function',
        scoped_function_node_id: 'fn-scope-terminal-1',
      },
    })
    expect(resp.ok()).toBeTruthy()
    const sessionId = (await resp.json()).data.session_id
    expect(await pollTerminal(request, sessionId)).toBe('failed')
  })

  test('WS topic receives execution_completed with status passed (subscribe before terminal)', async ({
    request,
    page,
  }) => {
    // Slow body (2s Delay) so subscribe lands after the run starts but
    // before the terminal broadcast fires - there is no event replay.
    const testId = await seedTest(request, 'slow')
    const envId = await seedEnvironment(request)
    await request.delete(`${BACKEND_URL}/workbench/session`).catch(() => {})

    // Page must be on the app origin so the in-page WebSocket can open.
    await page.goto(`${FRONTEND_URL}/`)

    const sessionId = await startScopedRun(request, testId, envId)
    const collector = await openSessionEventCollector(page, sessionId)

    const completed = await collector.waitForType('execution_completed', 30_000)
    expect(completed.status).toBe('passed')
    await collector.close()
  })
})
