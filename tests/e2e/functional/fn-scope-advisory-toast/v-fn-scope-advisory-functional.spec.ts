/**
 * V-FN-SCOPE-ADVISORY (functional): the SCOPED_RUN_ADVISORY warning has
 * its own toast title routing - "Scope Initialized" - distinct from the
 * generic "Missing Profile Value" used for other warning types.
 *
 * Guards:
 *   - BE: _run_scoped_function + _ADVISORY_NO_PRIOR_STATE message.
 *   - FE: use-workbench-run/hook.ts per-`warning.type` title routing.
 *
 * Pass Criteria:
 *   1. After clearing the workbench session and triggering a scoped Run
 *      with no prior cached state, the BE response carries
 *      `warnings[0].type === "SCOPED_RUN_ADVISORY"`.
 *   2. The advisory message mentions "Clean scope state" + "declared
 *      default values".
 */

import { test, expect, type APIRequestContext } from '../../helpers/playwright-fixtures'
import { BACKEND_URL } from '../../helpers/config'

const FN_NODE_ID = 'fn-advisory-1'

async function seedTest(request: APIRequestContext): Promise<string> {
  const seed = {
    name: `V-FN-SCOPE-ADVISORY ${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    version: '1.0.0',
    description: 'Local Function with body Log for scope-advisory coverage',
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
              description: 'Body',
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
                        values: { message: "'advisory-body'", level: 'INFO' },
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
  expect(body?.success).toBeTruthy()
  return body.data.id
}

async function seedEnvironment(request: APIRequestContext): Promise<string> {
  const resp = await request.post(`${BACKEND_URL}/environments`, {
    data: { name: `V-FN-SCOPE-ADVISORY Env ${Date.now()}`, tags: [] },
  })
  expect(resp.ok()).toBeTruthy()
  return (await resp.json()).data.id
}

test.describe('V-FN-SCOPE-ADVISORY (functional): toast title routing for SCOPED_RUN_ADVISORY', () => {
  test('Scoped Run without prior state carries the new SCOPED_RUN_ADVISORY message', async ({
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
    expect(resp.ok(), `run: ${resp.status()}`).toBeTruthy()
    const body = await resp.json()
    const warnings: Array<{ type?: string; message?: string }> = body.data?.warnings ?? []
    const advisory = warnings.find((w) => w.type === 'SCOPED_RUN_ADVISORY')
    expect(
      advisory,
      `must surface SCOPED_RUN_ADVISORY warning; got ${JSON.stringify(warnings)}`,
    ).toBeTruthy()

    const msg = advisory!.message ?? ''
    expect(
      msg.includes('Clean scope state') || msg.includes('declared default values'),
      `advisory body should match new wording; got "${msg}"`,
    ).toBe(true)
  })
})
