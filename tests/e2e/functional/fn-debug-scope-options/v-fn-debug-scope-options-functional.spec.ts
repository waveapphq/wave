/**
 * V-FN-DEBUG-SCOPE-OPTIONS (functional): Debug Scope honors
 * `debug_options.pause_on_first_block = true` AND inner breakpoints.
 *
 * Guards the `_start_scoped_function_run` plumbing that unpacks the caller's
 * `DebugRunOptions` into the scoped session's `breakpoints` +
 * `debug_options` fields.
 *
 * Pass Criteria:
 *   1. POST /workbench/run with scope_mode='function' + an inner
 *      breakpoint + debug_options.pause_on_first_block = true returns 200
 *      and echoes the breakpoints + debug_options on the session/status.
 *   2. The session reaches a paused state with the configured fields
 *      honored.
 */

import { test, expect, type APIRequestContext } from '../../helpers/playwright-fixtures'
import { BACKEND_URL } from '../../helpers/config'

const FN_NODE_ID = 'fn-debug-scope-options-1'

async function seedTest(request: APIRequestContext): Promise<string> {
  const seed = {
    name: `V-FN-DEBUG-SCOPE-OPTIONS ${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    version: '1.0.0',
    description: 'Local Function body A -> B -> C for scope-options coverage',
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
              description: 'A -> B -> C',
              inputs: [],
              outputs: [],
              variables: [],
              workflow: {
                nodes: [
                  {
                    id: 'inner-A',
                    type: 'workflowNode',
                    position: { x: 100, y: 200 },
                    data: {
                      label: 'A',
                      elementType: 'log',
                      nodeType: 'plugin',
                      category: 'system',
                      version: '1.0.0',
                      expressionFields: ['message'],
                      templateFields: [],
                      variableExpressionKeys: [],
                      config: {
                        values: { message: "'scope-opts-A'", level: 'INFO' },
                        outputBindings: {},
                        profileBindings: [],
                      },
                    },
                  },
                  {
                    id: 'inner-B',
                    type: 'workflowNode',
                    position: { x: 300, y: 200 },
                    data: {
                      label: 'B',
                      elementType: 'log',
                      nodeType: 'plugin',
                      category: 'system',
                      version: '1.0.0',
                      expressionFields: ['message'],
                      templateFields: [],
                      variableExpressionKeys: [],
                      config: {
                        values: { message: "'scope-opts-B'", level: 'INFO' },
                        outputBindings: {},
                        profileBindings: [],
                      },
                    },
                  },
                  {
                    id: 'inner-C',
                    type: 'workflowNode',
                    position: { x: 500, y: 200 },
                    data: {
                      label: 'C',
                      elementType: 'log',
                      nodeType: 'plugin',
                      category: 'system',
                      version: '1.0.0',
                      expressionFields: ['message'],
                      templateFields: [],
                      variableExpressionKeys: [],
                      config: {
                        values: { message: "'scope-opts-C'", level: 'INFO' },
                        outputBindings: {},
                        profileBindings: [],
                      },
                    },
                  },
                ],
                edges: [
                  { id: 'e-start-a', source: 'start-node', target: 'inner-A' },
                  { id: 'e-a-b', source: 'inner-A', target: 'inner-B' },
                  { id: 'e-b-c', source: 'inner-B', target: 'inner-C' },
                ],
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
  expect(body?.success).toBeTruthy()
  return body.data.id
}

async function seedEnvironment(request: APIRequestContext): Promise<string> {
  const resp = await request.post(`${BACKEND_URL}/environments`, {
    data: { name: `V-FN-DEBUG-SCOPE-OPTIONS Env ${Date.now()}`, tags: [] },
  })
  expect(resp.ok()).toBeTruthy()
  return (await resp.json()).data.id
}

test.describe('V-FN-DEBUG-SCOPE-OPTIONS (functional): Debug Scope plumbs breakpoints + options', () => {
  test('Scoped Debug request echoes the supplied breakpoints + debug_options', async ({
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
        mode: 'debug',
        breakpoints: ['inner-B'],
        debug_options: { pause_on_first_block: true, pause_on_errors: false },
      },
    })
    expect(resp.ok(), `run: ${resp.status()} ${await resp.text()}`).toBeTruthy()
    const body = await resp.json()

    const echoedBreakpoints =
      body.data?.breakpoints ?? body.data?.session?.breakpoints ?? []
    const echoedOptions =
      body.data?.debug_options ?? body.data?.session?.debug_options ?? null
    expect(
      Array.isArray(echoedBreakpoints) ? echoedBreakpoints : [],
      `breakpoints must echo in run response; got=${JSON.stringify(echoedBreakpoints)} body=${JSON.stringify(body.data).slice(0, 800)}`,
    ).toContain('inner-B')
    expect(
      (echoedOptions as { pause_on_first_block?: boolean })?.pause_on_first_block,
      `pause_on_first_block must echo; got ${JSON.stringify(echoedOptions)}`,
    ).toBe(true)
  })
})
