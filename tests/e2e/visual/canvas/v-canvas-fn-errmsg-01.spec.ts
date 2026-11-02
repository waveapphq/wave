/**
 * V-CANVAS-FN-ERRMSG-01: save validation error envelope format
 *
 * REQ: REQ-3.1.2.4 (Function instance + outer-Test validation).
 *
 * Pass Criteria:
 *   1. POST `/tests` with a Log at the root that has no `message` returns
 *      422 with a detail entry shaped:
 *      `{ code: 'REQUIRED_PARAM_MISSING', node_label: 'Log_1',
 *         message: "Required parameter 'message' is missing" }`.
 *   2. POST `/tests` with a Log INSIDE a Local Function body that has no
 *      `message` returns 422 with the SAME shape PLUS a `function_path`
 *      trail (root-to-leaf) so the UI can prefix the error with the
 *      enclosing Function's name.
 *
 * Phase: no-data (asserts purely on the BE 422 envelope; no UI interaction).
 */

import { test, expect } from '../../helpers/playwright-fixtures'
import { BACKEND_URL } from '../../helpers/config'

interface ValidationDetail {
  code?: string
  message?: string
  node_id?: string
  node_label?: string
  function_path?: Array<{ node_id?: string; label?: string; element_type?: string }>
}

interface SaveErrorEnvelope {
  success: false
  error: {
    code: string
    message: string
    details: ValidationDetail[]
  }
}

function rootLogTest(name: string): Record<string, unknown> {
  return {
    name,
    version: '1.0.0',
    description: 'V-CANVAS-FN-ERRMSG-01 root Log w/ no message',
    workflow: {
      nodes: [
        {
          id: 'root-log-1',
          type: 'workflowNode',
          position: { x: 200, y: 200 },
          data: {
            label: 'Log_1',
            elementType: 'log',
            nodeType: 'plugin',
            category: 'system',
            version: '1.0.0',
            expressionFields: ['message'],
            templateFields: [],
            variableExpressionKeys: [],
            // No `message` -> REQUIRED_PARAM_MISSING at save time.
            config: { values: { level: 'INFO' }, outputBindings: {}, profileBindings: [] },
          },
          measured: { width: 120, height: 62 },
        },
      ],
      edges: [{ id: 'e-start-log', source: 'start-node', target: 'root-log-1' }],
    },
    variables: {},
    metadata: {},
  }
}

function innerLogInFunctionTest(name: string): Record<string, unknown> {
  return {
    name,
    version: '1.0.0',
    description: 'V-CANVAS-FN-ERRMSG-01 inner Log w/ no message inside Local Function',
    workflow: {
      nodes: [
        {
          id: 'fn-1',
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
              workflow: {
                nodes: [
                  {
                    id: 'inner-log-1',
                    type: 'workflowNode',
                    position: { x: 200, y: 200 },
                    data: {
                      label: 'InnerLog_1',
                      elementType: 'log',
                      nodeType: 'plugin',
                      category: 'system',
                      version: '1.0.0',
                      expressionFields: ['message'],
                      templateFields: [],
                      variableExpressionKeys: [],
                      config: { values: { level: 'INFO' }, outputBindings: {}, profileBindings: [] },
                    },
                    measured: { width: 120, height: 62 },
                  },
                ],
                edges: [],
              },
              inputs: [],
              outputs: [],
              variables: [],
            },
          },
          measured: { width: 120, height: 62 },
        },
      ],
      edges: [],
    },
    variables: {},
    metadata: {},
  }
}

test.describe('V-CANVAS-FN-ERRMSG-01: save validation error envelope', () => {
  test('root Log w/ no message: REQUIRED_PARAM_MISSING + node_label', async ({ request }) => {
    const name = `V-CANVAS-FN-ERRMSG-01-root ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const resp = await request.post(`${BACKEND_URL}/tests`, { data: rootLogTest(name) })
    expect(resp.status(), 'expected 422 for missing required param').toBe(422)
    const envelope = (await resp.json()) as SaveErrorEnvelope
    expect(envelope.success).toBe(false)
    expect(envelope.error.code).toBe('VALIDATION_ERROR')
    expect(Array.isArray(envelope.error.details)).toBe(true)

    const detail = envelope.error.details.find((d) => d.code === 'REQUIRED_PARAM_MISSING')
    expect(detail, 'one REQUIRED_PARAM_MISSING entry expected').toBeTruthy()
    expect(detail!.node_label).toBe('Log_1')
    expect(detail!.message).toBe("Required parameter 'message' is missing")
    // Root Log is NOT inside a Function - no enclosing-Function path trail.
    expect(detail!.function_path).toBeUndefined()
  })

  test('inner Log w/ no message inside Function: detail entry carries function_node_*', async ({
    request,
  }) => {
    const name = `V-CANVAS-FN-ERRMSG-01-inner ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const resp = await request.post(`${BACKEND_URL}/tests`, { data: innerLogInFunctionTest(name) })
    expect(resp.status(), 'expected 422 for missing required param inside Function').toBe(422)
    const envelope = (await resp.json()) as SaveErrorEnvelope
    expect(envelope.success).toBe(false)
    expect(envelope.error.code).toBe('VALIDATION_ERROR')

    // The inner Log's missing `message` produces an entry. Look for the entry
    // whose code matches AND whose function_path trail names Function_1.
    const detail = envelope.error.details.find(
      (d) =>
        d.code === 'REQUIRED_PARAM_MISSING' &&
        (d.function_path ?? []).some((s) => s.label === 'Function_1'),
    )
    expect(detail, 'inner REQUIRED_PARAM_MISSING with a function_path trail expected').toBeTruthy()
    expect(detail!.node_label).toBe('InnerLog_1')
    expect(detail!.message).toBe("Required parameter 'message' is missing")
    expect(detail!.function_path?.[0]?.node_id).toBe('fn-1')
  })
})
