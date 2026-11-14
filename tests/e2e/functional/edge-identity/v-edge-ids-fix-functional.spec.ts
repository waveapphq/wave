/**
 * V-EDGE-IDS-FIX-FUNCTIONAL: the Fix endpoint refuses a stored Test whose wires repeat an id
 *
 * REQ: REQ-5.2.4.3 (Fix Endpoint; Error Code Taxonomy: DUPLICATE_EDGE_ID has no automatic fix and
 *      nothing else is repaired first, because the repairs find wires by their id)
 *
 * Pass Criteria:
 * 1. The stored Test names the repeated id and a cross-scope wire that carries it, the cross-scope
 *    finding with its Fix action, so the Fix has a repair it could run.
 * 2. POST /tests/{id}/fix refuses the Test as stored: 422 with the DUPLICATE_EDGE_ID finding
 *    "Edge ID 'e-shared' is used by more than one edge" in `error.details`, the same envelope
 *    a refused save answers with.
 * 3. The stored Test keeps every Block and every wire as it was; the Fix drops no wire, the wire
 *    from Start that shares the id with the cross-scope wire included.
 */

import { test, expect } from '../../helpers/playwright-fixtures'
import { BACKEND_URL } from '../../helpers/config'
import { cleanUp, storedTest } from '../../helpers/fn-block'
import { rawPersistTest } from '../../helpers/fn-seed'
import { DUPLICATE_EDGE_ID, answerOf, fixture, repeatedIdMessage, uniqueName, wireRows, type Wire } from './edge-ids'

const SHARED_ID = 'e-shared'
const CROSS_SCOPE = 'CROSS_SCOPE_EDGE'

interface Finding {
  code: string
  message: string
  path?: string
  fix_action?: string | null
}

test.describe('V-EDGE-IDS-FIX-FUNCTIONAL: the Fix refuses a repeated wire id and drops no wire', () => {
  const testIds: string[] = []

  test.afterEach(async ({ request }) => {
    await cleanUp(request, testIds)
  })

  test('the Fix refuses a stored Test whose wires repeat an id and leaves every wire in place', async ({
    request,
  }) => {
    const doc = fixture('fixture-fix-cross-scope.json')
    // The save refuses this Test, so it is stored through the admin bulk route.
    const testId = await rawPersistTest(request, {
      name: uniqueName('fix'),
      nodes: doc.workflow.nodes,
      edges: doc.workflow.edges,
      variables: doc.variables,
    })
    testIds.push(testId)

    await test.step('The stored Test names the repeated id and the cross-scope wire that carries it', async () => {
      const resp = await request.post(`${BACKEND_URL}/tests/${testId}/validate?context=load`)
      const body = await resp.json().catch(() => null)
      expect(resp.status(), `POST /tests/${testId}/validate: ${JSON.stringify(body)}`).toBe(422)
      const errors = (body?.error?.details?.[0]?.errors ?? []) as Finding[]
      expect(
        errors.filter((e) => e.code === DUPLICATE_EDGE_ID).map((e) => e.message),
        'the load validation names the repeated id',
      ).toEqual([repeatedIdMessage(SHARED_ID)])
      expect(
        errors.filter((e) => e.code === CROSS_SCOPE).map((e) => [e.path, e.fix_action]),
        'the cross-scope wire is named by its id and carries a Fix action',
      ).toEqual([[`workflow.edges.${SHARED_ID}`, 'Remove the cross-scope edge']])
    })

    await test.step('POST /tests/{id}/fix refuses the Test as stored, naming the repeated id', async () => {
      const answer = await answerOf(await request.post(`${BACKEND_URL}/tests/${testId}/fix`))
      expect
        .soft(answer.status, `POST /tests/${testId}/fix answered ${answer.status}: ${JSON.stringify(answer.body)}`)
        .toBe(422)
      expect
        .soft(
          answer.findings.filter(([code]) => code === DUPLICATE_EDGE_ID),
          `the Fix refusal names the repeated id: ${JSON.stringify(answer.body)}`,
        )
        .toEqual([[DUPLICATE_EDGE_ID, repeatedIdMessage(SHARED_ID)]])
    })

    await test.step('The stored Test keeps every Block and every wire', async () => {
      const workflow = (await storedTest(request, testId)).workflow as {
        nodes: Array<{ id: string }>
        edges: Wire[]
      }
      expect(wireRows(workflow.edges), 'the Fix drops no wire').toEqual(wireRows(doc.workflow.edges))
      expect(
        workflow.nodes.map((n) => n.id),
        'the Fix removes no Block',
      ).toEqual(doc.workflow.nodes.map((n) => String(n.id)))
    })
  })
})
