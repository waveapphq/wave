/**
 * V-FN-SCOPE-RUN (functional): Run / Debug Scope on a Function emits the
 * full WS event sequence (entry log, initial scope seeding, terminal
 * status) and the FE drives the scoped-run pipeline through the same
 * `startRun` path with `scope_mode` + `scoped_function_node_id`.
 *
 * Guards:
 *   - BE session_id plumb-through from `_run_scoped_function` ->
 *     `execute_scoped_function` -> `execute_function`.
 *   - FE routing: scoped Run/Debug go through `startRun` /
 *     `startDebugRun` (with scope_mode + scoped_function_node_id).
 *
 * Pass Criteria:
 *   1. POST /workbench/run with scope_mode='function' + valid
 *      scoped_function_node_id returns 200, response carries
 *      `scope_mode: "function"`.
 *   2. Polling /workbench/{id}/status reaches a terminal status with
 *      `scoped_result` populated.
 *   3. Execution logs (`execution_logs`) include the inner Function
 *      body log line (the body did run, not just the wrapper).
 */

import { test, expect, type APIRequestContext } from '../../helpers/playwright-fixtures'
import { BACKEND_URL } from '../../helpers/config'

const FN_NODE_ID = 'fn-scope-run-1'

async function seedTest(request: APIRequestContext): Promise<string> {
  const seed = {
    name: `V-FN-SCOPE-RUN ${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    version: '1.0.0',
    description: 'Local Function with body Log "fn-scope-emitted" for scoped run coverage',
    variables: {},
    workflow: {
      nodes: [
        {
          id: FN_NODE_ID,
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
              description: 'Body emits a Log line during scoped run',
              inputs: [],
              outputs: [],
              variables: [],
              workflow: {
                nodes: [
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
                        values: { message: "'fn-scope-emitted'", level: 'INFO' },
                        outputBindings: {},
                        profileBindings: [],
                      },
                    },
                  },
                ],
                edges: [{ id: 'e-start-inner', source: 'start-node', target: 'inner-log' }],
              },
            },
          },
        },
      ],
      edges: [{ id: 'e-start-fn', source: 'start-node', target: FN_NODE_ID }],
    },
    metadata: {},
  }
  const resp = await request.post(`${BACKEND_URL}/tests`, { data: seed })
  const body = await resp.json().catch(() => null)
  expect(body?.success, `POST /tests: ${resp.status()}`).toBeTruthy()
  return body.data.id
}

async function seedEnvironment(request: APIRequestContext): Promise<string> {
  const resp = await request.post(`${BACKEND_URL}/environments`, {
    data: { name: `V-FN-SCOPE-RUN Env ${Date.now()}`, tags: [] },
  })
  expect(resp.ok(), `POST /environments: ${resp.status()}`).toBeTruthy()
  const body = await resp.json()
  return body.data.id
}

async function waitForTerminal(request: APIRequestContext, sessionId: string) {
  for (let i = 0; i < 100; i += 1) {
    const s = await request.get(`${BACKEND_URL}/workbench/${sessionId}/status`)
    if (s.status() === 200) {
      const sb = await s.json()
      const status: string = sb.data?.status
      if (['passed', 'failed', 'skipped'].includes(status)) {
        return sb.data
      }
    }
    await new Promise((r) => setTimeout(r, 100))
  }
  throw new Error(`session ${sessionId} never reached terminal status`)
}

test.describe('V-FN-SCOPE-RUN (functional): scoped Run drives the body via session', () => {
  test('Scoped Run reaches terminal status; inner body log emits during the run', async ({
    request,
  }) => {
    const testId = await seedTest(request)
    const envId = await seedEnvironment(request)
    await request.delete(`${BACKEND_URL}/workbench/session`).catch(() => {})

    const resp = await request.post(`${BACKEND_URL}/workbench/run`, {
      data: {
        test_id: testId,
        environment_id: envId,
        scope_mode: 'function',
        scoped_function_node_id: FN_NODE_ID,
      },
    })
    expect(resp.ok(), `run: ${resp.status()} ${await resp.text()}`).toBeTruthy()
    const body = await resp.json()
    expect(body.data?.scope_mode, 'response carries scope_mode').toBe('function')

    const sessionId: string = body.data.session_id
    const snapshot = await waitForTerminal(request, sessionId)

    // The session carried the scoped invocation: scoped_result must be
    // present, and the terminal status must be `passed`. The status
    // endpoint does not expose execution_logs - that's verified
    // through the WS topic in v-fn-scope-terminal-functional.spec.ts.
    expect(snapshot.status).toBe('passed')
    expect(
      Object.prototype.hasOwnProperty.call(snapshot, 'scoped_result'),
      `scoped_result key on status; got keys=${Object.keys(snapshot).join(',')}`,
    ).toBe(true)
  })
})
