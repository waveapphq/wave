/**
 * F-SUITE-DELETE-CASCADE-01: Deleting a suite cascades it out of regressions
 *
 * Verifies the relations service's suite-to-regression cascade:
 *
 *   1. Create two suites (each with one test member).
 *   2. Create a regression that references both suites.
 *   3. DELETE one suite (no active execution).
 *   4. Reload the regression -> only the other suite remains in its
 *      `suites` list; the deleted suite id appears nowhere in the record.
 *   5. Tests that were members of the deleted suite still exist (the
 *      cascade does not nuke unrelated entities).
 */

import { test, expect, type APIRequestContext } from '../../helpers/playwright-fixtures'
import { BACKEND_URL } from '../../helpers/config'

async function createTest(
  request: APIRequestContext,
  name: string,
): Promise<string> {
  const response = await request.post(`${BACKEND_URL}/tests`, {
    data: {
      name,
      version: '1.0.0',
      description: 'F-SUITE-DELETE-CASCADE-01 test body',
      workflow: { nodes: [], edges: [] },
      variables: {},
      metadata: {},
    },
  })
  expect(response.ok(), `POST /tests failed: ${response.status()}`).toBeTruthy()
  const body = await response.json()
  const data = (body.data ?? body) as Record<string, unknown>
  return data.id as string
}

async function createSuite(
  request: APIRequestContext,
  name: string,
  testIds: string[],
): Promise<string> {
  const response = await request.post(`${BACKEND_URL}/suites`, {
    data: { name, description: 'F-SUITE-DELETE-CASCADE-01 suite', tests: testIds },
  })
  expect(response.ok(), `POST /suites failed: ${response.status()}`).toBeTruthy()
  const body = await response.json()
  const data = (body.data ?? body) as Record<string, unknown>
  return data.id as string
}

async function createRegression(
  request: APIRequestContext,
  name: string,
  suiteIds: string[],
): Promise<string> {
  const response = await request.post(`${BACKEND_URL}/regressions`, {
    data: { name, description: 'F-SUITE-DELETE-CASCADE-01 regression', suites: suiteIds },
  })
  expect(
    response.ok(),
    `POST /regressions failed: ${response.status()} ${await response.text()}`,
  ).toBeTruthy()
  const body = await response.json()
  const data = (body.data ?? body) as Record<string, unknown>
  return data.id as string
}

interface SuiteRef {
  id?: string
  suite_id?: string
}

function extractSuiteIds(regression: Record<string, unknown>): string[] {
  const raw = regression.suites
  if (!Array.isArray(raw)) return []
  return raw.map((entry) => {
    if (typeof entry === 'string') return entry
    if (entry && typeof entry === 'object') {
      const ref = entry as SuiteRef
      return (ref.id ?? ref.suite_id ?? '') as string
    }
    return ''
  })
}

test.describe('F-SUITE-DELETE-CASCADE-01: suite delete cascades out of regressions', () => {
  test('deleting a suite removes it from every referencing regression; member tests survive', async ({
    request,
  }) => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`

    const testInDeletedSuite = await createTest(request, `cascade-test-deleted-${suffix}`)
    const testInKeptSuite = await createTest(request, `cascade-test-kept-${suffix}`)

    const deletedSuiteId = await createSuite(
      request,
      `cascade-deleted-suite-${suffix}`,
      [testInDeletedSuite],
    )
    const keptSuiteId = await createSuite(
      request,
      `cascade-kept-suite-${suffix}`,
      [testInKeptSuite],
    )

    const regressionId = await createRegression(
      request,
      `cascade-regression-${suffix}`,
      [deletedSuiteId, keptSuiteId],
    )

    await test.step('Pre-condition: regression references both suites', async () => {
      const resp = await request.get(`${BACKEND_URL}/regressions/${regressionId}`)
      expect(resp.ok()).toBeTruthy()
      const body = await resp.json()
      const data = (body.data ?? body) as Record<string, unknown>
      const ids = extractSuiteIds(data)
      expect(
        new Set(ids),
        'Regression must reference both suites before the cascade',
      ).toEqual(new Set([deletedSuiteId, keptSuiteId]))
    })

    await test.step('Deleting the suite returns 204 and removes the suite', async () => {
      const deleteResp = await request.delete(`${BACKEND_URL}/suites/${deletedSuiteId}`)
      expect(
        deleteResp.status(),
        'DELETE on a suite with no active execution must return 204',
      ).toBe(204)

      const followupResp = await request.get(`${BACKEND_URL}/suites/${deletedSuiteId}`)
      expect(
        followupResp.status(),
        'GET on the deleted suite must return 404',
      ).toBe(404)
    })

    await test.step('Regression no longer references the deleted suite; the other suite is preserved', async () => {
      const resp = await request.get(`${BACKEND_URL}/regressions/${regressionId}`)
      expect(resp.ok()).toBeTruthy()
      const body = await resp.json()
      const data = (body.data ?? body) as Record<string, unknown>
      const ids = extractSuiteIds(data)
      expect(
        ids,
        'Regression suites must contain only the kept suite after cascade',
      ).toEqual([keptSuiteId])
      expect(
        ids,
        'Regression suites must NOT contain the deleted suite id anywhere',
      ).not.toContain(deletedSuiteId)
    })

    await test.step('Tests that lived inside the deleted suite still exist', async () => {
      const deletedMemberResp = await request.get(`${BACKEND_URL}/tests/${testInDeletedSuite}`)
      expect(
        deletedMemberResp.ok(),
        'Test that belonged to the deleted suite must still exist (cascade is suite -> regression only)',
      ).toBeTruthy()
      const keptMemberResp = await request.get(`${BACKEND_URL}/tests/${testInKeptSuite}`)
      expect(keptMemberResp.ok()).toBeTruthy()
    })
  })
})
