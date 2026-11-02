/**
 * Suite Variable Collision via update_suite (PUT /suites/{id}) E2E Test
 *
 * Tests the PRIMARY collision path - the one the UI actually uses.
 * The UI calls PUT /suites/{id} for both variable edits and test
 * membership changes, NOT the dedicated composition endpoints.
 *
 * Run: ./scripts/e2e-targeted-local.sh functional/suite-variable-collision/v-suite-update-collision.spec.ts
 */

import { test, expect } from '../../helpers/playwright-fixtures'
import { BACKEND_URL } from '../../helpers/config'

test.describe('Suite Variable Collision via update_suite', () => {
  const createdIds: { suites: string[]; tests: string[] } = { suites: [], tests: [] }

  test.afterAll(async ({ request }) => {
    for (const tid of createdIds.tests) {
      await request.delete(`${BACKEND_URL}/tests/${tid}`).catch(() => {})
    }
    for (const sid of createdIds.suites) {
      await request.delete(`${BACKEND_URL}/suites/${sid}`).catch(() => {})
    }
  })

  test('rejects variable type change via PUT /suites/{id} when types conflict', async ({ request }) => {
    // Create shared test
    const testResp = await request.post(`${BACKEND_URL}/tests`, {
      data: { name: 'Update Collision Test', version: '1.0.0', workflow: { nodes: [], edges: [] }, variables: {}, metadata: {} },
    })
    expect(testResp.ok()).toBeTruthy()
    const testBody = await testResp.json()
    const testId = testBody.data?.id || testBody.id
    createdIds.tests.push(testId)

    // Create S1 with env:string and the test
    const s1Resp = await request.post(`${BACKEND_URL}/suites`, {
      data: { name: 'Update Collision S1', tests: [testId], variables: { env: { type: 'string', value: 'dev' } } },
    })
    expect(s1Resp.ok()).toBeTruthy()
    const s1 = (await s1Resp.json()).data
    createdIds.suites.push(s1.id)

    // Create S2 with env:string and the same test
    const s2Resp = await request.post(`${BACKEND_URL}/suites`, {
      data: { name: 'Update Collision S2', tests: [testId], variables: { env: { type: 'string', value: 'prod' } } },
    })
    expect(s2Resp.ok()).toBeTruthy()
    const s2 = (await s2Resp.json()).data
    createdIds.suites.push(s2.id)

    // Change S1's env from string to integer via PUT /suites/{id} - should 409
    const updateResp = await request.put(`${BACKEND_URL}/suites/${s1.id}`, {
      data: { variables: { env: { type: 'integer', value: 1 } } },
    })
    expect(updateResp.status()).toBe(409)

    const errorBody = await updateResp.json()
    expect(errorBody.error?.message).toContain('collision')
    expect(errorBody.error?.details?.collisions).toBeDefined()
    expect(errorBody.error?.details?.collisions[0]?.variable).toBe('env')
  })

  test('rejects test membership change via PUT /suites/{id} when types conflict', async ({ request }) => {
    // Create shared test
    const testResp = await request.post(`${BACKEND_URL}/tests`, {
      data: { name: 'Membership Collision Test', version: '1.0.0', workflow: { nodes: [], edges: [] }, variables: {}, metadata: {} },
    })
    expect(testResp.ok()).toBeTruthy()
    const testBody = await testResp.json()
    const testId = testBody.data?.id || testBody.id
    createdIds.tests.push(testId)

    // S1 has the test with env:integer
    const s1Resp = await request.post(`${BACKEND_URL}/suites`, {
      data: { name: 'Membership Collision S1', tests: [testId], variables: { env: { type: 'integer', value: 1 } } },
    })
    expect(s1Resp.ok()).toBeTruthy()
    createdIds.suites.push((await s1Resp.json()).data.id)

    // S2 has env:string but no tests
    const s2Resp = await request.post(`${BACKEND_URL}/suites`, {
      data: { name: 'Membership Collision S2', variables: { env: { type: 'string', value: 'dev' } } },
    })
    expect(s2Resp.ok()).toBeTruthy()
    const s2 = (await s2Resp.json()).data
    createdIds.suites.push(s2.id)

    // Add test to S2 via PUT /suites/{id} - should 409
    const updateResp = await request.put(`${BACKEND_URL}/suites/${s2.id}`, {
      data: { tests: [testId] },
    })
    expect(updateResp.status()).toBe(409)

    const errorBody = await updateResp.json()
    expect(errorBody.error?.message).toContain('collision')
    expect(errorBody.error?.details?.conflicting_test_ids).toBeDefined()
    expect(errorBody.error?.details?.conflicting_test_ids).toContain(testId)
  })

  test('allows variable update via PUT /suites/{id} when types match', async ({ request }) => {
    // Reuse suites from first test - both have env:string (S1 was rejected, still string)
    const s1Id = createdIds.suites[0]

    // Change S1's env value (same type) - should succeed
    const updateResp = await request.put(`${BACKEND_URL}/suites/${s1Id}`, {
      data: { variables: { env: { type: 'string', value: 'staging' } } },
    })
    expect(updateResp.ok(), `Expected success but got ${updateResp.status()}`).toBeTruthy()
  })
})
