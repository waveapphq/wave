/**
 * V-FN-INPUT-WRITE (functional): writing to a Function input from inside
 * the body is blocked - inputs are read-only inside the body.
 *
 * Pass Criteria:
 *   1. Local Function declares input `x` (string, required).
 *   2. Body contains a Log node that ALSO has an outputBinding mapping a
 *      raw output to `x` (writing back to the input).
 *   3. Validate flags `INPUT_WRITE_FORBIDDEN`; save / run blocked.
 */

import { test, expect } from '../../helpers/playwright-fixtures'
import { BACKEND_URL } from '../../helpers/config'

const FN_NODE_ID = 'fn-input-write-1'

async function buildSeedThatViolatesRule(): Promise<Record<string, unknown>> {
  return {
    name: `V-FN-INPUT-WRITE ${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    version: '1.0.0',
    description: 'Local Function whose body attempts to write to input `x`',
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
            config: { values: { x: 'foo' }, outputBindings: {}, profileBindings: [] },
            localDefinition: {
              name: 'Function_1',
              description: 'Body writes to input x via outputBindings - must be blocked',
              inputs: [{ name: 'x', type: 'string', required: true }],
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
                        values: { message: "'attempting input write'", level: 'INFO' },
                        outputBindings: { line: 'x' },
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
    variables: {},
    metadata: {},
  }
}

test.describe('V-FN-INPUT-WRITE (functional): writes to a Function input are blocked', () => {
  test('POST /tests rejects with INPUT_WRITE_FORBIDDEN when body writes to a Function input', async ({
    request,
  }) => {
    const seed = await buildSeedThatViolatesRule()
    const resp = await request.post(`${BACKEND_URL}/tests`, { data: seed })
    expect(
      resp.status(),
      `expected 422 from POST /tests; got ${resp.status()}`,
    ).toBe(422)
    const body = await resp.json().catch(() => null)
    const errors =
      ((body?.error?.details ?? body?.data?.errors ?? body?.errors ?? []) as Array<
        Record<string, unknown>
      >) ?? []
    const hit = errors.some(
      (e) =>
        (e.code as string) === 'INPUT_WRITE_FORBIDDEN' ||
        (((e.message as string) ?? '').toLowerCase().includes('input') &&
          ((e.message as string) ?? '').toLowerCase().includes('read-only')),
    )
    expect(
      hit,
      `expected INPUT_WRITE_FORBIDDEN in validation errors; got ${JSON.stringify(errors)}`,
    ).toBe(true)
  })
})
