/**
 * V-FN-VAL-SCHEMA-01: top-level Shared instance schema resolution.
 * REQ: REQ-3.1.2.4.
 *
 * A reference to a Published Function reads its input fields from the PINNED
 * version, and those fields go through the one field check every Block gets.
 * A top-level Shared Function Block with a Required input left empty is refused
 * on Save; a literal whose type disagrees with the declared type is refused; a
 * Block that gives the input a value is clean.
 *
 * Pass Criteria:
 *   1. Required input with no value -> POST /tests 422 + REQUIRED_PARAM_MISSING
 *      `Required parameter 'user_id' is missing` (exact).
 *   2. Required input given a value -> validate clean AND POST /tests succeeds.
 *   3. Literal of the wrong type -> validate 422 + INVALID_SETTING_TYPE
 *      `Setting 'user_id' of block '<Function name>' expects string, got integer` (exact).
 */

import { test, expect } from '../../helpers/playwright-fixtures'
import { BACKEND_URL } from '../../helpers/config'
import {
  publishLibraryFunction,
  rawPersistTest,
  createValidTest,
  sharedNode,
  startEdge,
  validateTest,
  codesOf,
} from '../../helpers/fn-seed'

const REQUIRED_INPUT = [{ name: 'user_id', type: 'string', required: true }]
const OUTPUT = [{ name: 'token', type: 'string' }]

test.describe('V-FN-VAL-SCHEMA-01: top-level Shared instance contract checks', () => {
  test('a Required input with no value is refused; a given value is clean; a literal of the wrong type is refused', async ({
    request,
  }) => {
    const fn = await publishLibraryFunction(request, {
      name: `zz-11541-r1-auth-${Date.now() % 100_000_000}`,
      inputs: REQUIRED_INPUT,
      outputs: OUTPUT,
    })
    const testIds: string[] = []
    try {
      // 1. A Required input with no value -> the Save is refused and names it.
      const unboundSave = await request.post(`${BACKEND_URL}/tests`, {
        data: {
          name: `zz-11541-r1-val-schema-unbound-${Date.now()}`,
          version: '1.0.0',
          description: '',
          workflow: {
            nodes: [
              sharedNode('auth-unbound-save', {
                functionId: fn.functionId,
                functionVersion: '1.0.0',
                label: 'Authenticate',
                originalLibraryName: fn.name,
              }),
            ],
            edges: [startEdge('auth-unbound-save')],
          },
          variables: {},
          metadata: {},
        },
      })
      expect(unboundSave.status(), 'a Required input with no value blocks Save (422)').toBe(422)
      const refusal = (await unboundSave.json()).error?.details ?? []
      expect(
        refusal.filter((e: Record<string, unknown>) => e.code === 'REQUIRED_PARAM_MISSING').map((e: Record<string, unknown>) => e.message),
        JSON.stringify(refusal),
      ).toEqual(["Required parameter 'user_id' is missing"])

      // 2. The Required input given a value -> clean, and the write path accepts it.
      const boundId = await createValidTest(request, {
        name: `zz-11541-r1-val-schema-bound-${Date.now()}`,
        nodes: [
          sharedNode('auth-bound', {
            functionId: fn.functionId,
            functionVersion: '1.0.0',
            label: 'Authenticate',
            originalLibraryName: fn.name,
            values: { user_id: 'abc' },
          }),
        ],
        edges: [startEdge('auth-bound')],
      })
      testIds.push(boundId)
      const bound = await validateTest(request, boundId, 'run')
      expect(bound.status, `a given Required input is clean (200): ${codesOf(bound.errors).join(',')}`).toBe(200)
      expect(bound.errors).toEqual([])

      // 3. A literal whose type disagrees with the declared type is refused.
      const mismatchId = await rawPersistTest(request, {
        name: `zz-11541-r1-val-schema-mismatch-${Date.now()}`,
        nodes: [
          sharedNode('auth-mismatch', {
            functionId: fn.functionId,
            functionVersion: '1.0.0',
            label: 'Authenticate',
            originalLibraryName: fn.name,
            // user_id is declared 'string' but holds an integer.
            values: { user_id: 123 },
          }),
        ],
        edges: [startEdge('auth-mismatch')],
      })
      testIds.push(mismatchId)
      const mismatch = await validateTest(request, mismatchId, 'run')
      expect(mismatch.status, 'a literal of the wrong type blocks (422)').toBe(422)
      expect(
        mismatch.errors.filter((e) => e.code === 'INVALID_SETTING_TYPE').map((e) => e.message),
        codesOf(mismatch.errors).join(','),
      ).toEqual([`Setting 'user_id' of block '${fn.name}' expects string, got integer`])
    } finally {
      for (const id of testIds) await request.delete(`${BACKEND_URL}/tests/${id}`).catch(() => undefined)
      await request.delete(`${BACKEND_URL}/functions/${fn.functionId}?cascade=true`).catch(() => undefined)
    }
  })
})
