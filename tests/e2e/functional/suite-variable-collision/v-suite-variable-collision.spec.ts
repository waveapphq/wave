/**
 * Suite Variable Type Collision E2E Test
 *
 * Tests backend collision validation that prevents the same variable name
 * from having different types across suites that share tests.
 *
 * Scenario:
 * - Suite A has variable `timeout` with type integer
 * - Suite B has variable `timeout` with type string
 * - A test is added to Suite A (succeeds)
 * - Adding the same test to Suite B triggers a 409 collision
 * - Suite C has `timeout` as integer (matching Suite A) - adding succeeds
 *
 * Run: ./scripts/e2e-targeted-local.sh functional/suite-variable-collision/v-suite-variable-collision.spec.ts
 */

import { test, expect } from '../../helpers/playwright-fixtures'
import { BACKEND_URL } from '../../helpers/config'

test.describe('Suite Variable Type Collision', () => {
  let suiteAId: string
  let suiteBId: string
  let testId: string

  test.afterAll(async ({ request }) => {
    // Cleanup: delete test and suites (order matters - test first to avoid dangling refs)
    if (testId) await request.delete(`${BACKEND_URL}/tests/${testId}`).catch(() => {})
    if (suiteAId) await request.delete(`${BACKEND_URL}/suites/${suiteAId}`).catch(() => {})
    if (suiteBId) await request.delete(`${BACKEND_URL}/suites/${suiteBId}`).catch(() => {})
  })

  test('rejects adding test to suite when variable types conflict', async ({ request }) => {
    // 1. Create Suite A with timeout:integer
    const suiteAResp = await request.post(`${BACKEND_URL}/suites`, {
      data: { name: 'Collision Suite A', description: 'Suite A for collision test' },
    })
    expect(suiteAResp.ok(), `Create Suite A failed: ${suiteAResp.status()}`).toBeTruthy()
    const suiteABody = await suiteAResp.json()
    suiteAId = suiteABody.data.id

    // Set Suite A variables: timeout as integer
    const varsAResp = await request.put(`${BACKEND_URL}/suites/${suiteAId}/variables`, {
      data: { timeout: { type: 'integer', value: 30 } },
    })
    expect(varsAResp.ok(), `Set Suite A variables failed: ${varsAResp.status()}`).toBeTruthy()

    // 2. Create Suite B with timeout:string
    const suiteBResp = await request.post(`${BACKEND_URL}/suites`, {
      data: { name: 'Collision Suite B', description: 'Suite B for collision test' },
    })
    expect(suiteBResp.ok(), `Create Suite B failed: ${suiteBResp.status()}`).toBeTruthy()
    const suiteBBody = await suiteBResp.json()
    suiteBId = suiteBBody.data.id

    // Set Suite B variables: timeout as string (different type)
    const varsBResp = await request.put(`${BACKEND_URL}/suites/${suiteBId}/variables`, {
      data: { timeout: { type: 'string', value: '30s' } },
    })
    expect(varsBResp.ok(), `Set Suite B variables failed: ${varsBResp.status()}`).toBeTruthy()

    // 3. Create a minimal test fixture
    const testResp = await request.post(`${BACKEND_URL}/tests`, {
      data: {
        name: 'Collision Test',
        version: '1.0.0',
        workflow: { nodes: [], edges: [] },
        variables: {},
        metadata: {},
      },
    })
    expect(testResp.ok(), `Create test failed: ${testResp.status()}`).toBeTruthy()
    const testBody = await testResp.json()
    testId = testBody.data?.id || testBody.id

    // 4. Add test to Suite A - should succeed
    const addAResp = await request.post(`${BACKEND_URL}/suites/${suiteAId}/tests`, {
      data: { test_id: testId },
    })
    expect(addAResp.ok(), `Add test to Suite A failed: ${addAResp.status()}`).toBeTruthy()

    // 5. Add test to Suite B - should fail with 409 (type collision)
    const addBResp = await request.post(`${BACKEND_URL}/suites/${suiteBId}/tests`, {
      data: { test_id: testId },
    })
    expect(addBResp.status()).toBe(409)

    const errorBody = await addBResp.json()
    // The error message is in error.message (standard WAVE error envelope)
    const errorMessage = errorBody.error?.message || ''
    expect(errorMessage.toLowerCase()).toContain('collision')
  })

  test('allows adding test when variable types match', async ({ request }) => {
    // Suite A and test should exist from the previous test
    expect(suiteAId, 'Suite A should exist from prior test').toBeTruthy()
    expect(testId, 'Test should exist from prior test').toBeTruthy()

    // Create Suite C with timeout:integer (same type as Suite A)
    const suiteCResp = await request.post(`${BACKEND_URL}/suites`, {
      data: { name: 'Collision Suite C', description: 'Suite C matching types' },
    })
    expect(suiteCResp.ok(), `Create Suite C failed: ${suiteCResp.status()}`).toBeTruthy()
    const suiteCBody = await suiteCResp.json()
    const suiteCId = suiteCBody.data.id

    // Set Suite C variables: timeout as integer (matching Suite A)
    const varsCResp = await request.put(`${BACKEND_URL}/suites/${suiteCId}/variables`, {
      data: { timeout: { type: 'integer', value: 60 } },
    })
    expect(varsCResp.ok(), `Set Suite C variables failed: ${varsCResp.status()}`).toBeTruthy()

    // Add test to Suite C - should succeed (same type as Suite A)
    const addCResp = await request.post(`${BACKEND_URL}/suites/${suiteCId}/tests`, {
      data: { test_id: testId },
    })
    expect(addCResp.ok(), `Add test to Suite C failed: ${addCResp.status()}`).toBeTruthy()

    // Cleanup Suite C
    await request.delete(`${BACKEND_URL}/suites/${suiteCId}`).catch(() => {})
  })
})
