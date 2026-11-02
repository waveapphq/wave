/**
 * Regression Variable Type Collision E2E Test
 *
 * Tests that adding a suite to a regression is rejected when it introduces
 * variable type conflicts with suites already in the regression.
 *
 * Scenario:
 * - Suite A has variable `timeout` with type integer
 * - Suite B has variable `timeout` with type string (different type - collision)
 * - A shared test is added to both suites
 * - A regression is created and Suite A is added (succeeds)
 * - Adding Suite B alongside Suite A triggers a 409 collision
 * - Suite C has `timeout` as integer (matching Suite A) - adding succeeds
 *
 * Run: ./scripts/e2e-targeted-local.sh functional/regression-variable-collision/v-regression-variable-collision.spec.ts
 */

import { test, expect, type APIRequestContext, type Page } from '../../helpers/playwright-fixtures'
import { BACKEND_URL } from '../../helpers/config'

test.describe('Regression Variable Type Collision', () => {
  let suiteAId: string
  let suiteBId: string
  let suiteCId: string
  let testId: string
  let regressionId: string

  test.afterAll(async ({ request }) => {
    // Cleanup: delete regression, test, and suites
    if (regressionId)
      await request.delete(`${BACKEND_URL}/regressions/${regressionId}`).catch(() => {})
    if (testId) await request.delete(`${BACKEND_URL}/tests/${testId}`).catch(() => {})
    if (suiteAId) await request.delete(`${BACKEND_URL}/suites/${suiteAId}`).catch(() => {})
    if (suiteBId) await request.delete(`${BACKEND_URL}/suites/${suiteBId}`).catch(() => {})
    if (suiteCId) await request.delete(`${BACKEND_URL}/suites/${suiteCId}`).catch(() => {})
  })

  test('rejects adding suite with conflicting variable types to regression', async ({
    request,
  }) => {
    // 1. Create a shared test
    const testResp = await request.post(`${BACKEND_URL}/tests`, {
      data: {
        name: 'Regression Collision Test',
        version: '1.0.0',
        workflow: { nodes: [], edges: [] },
        variables: {},
        metadata: {},
      },
    })
    expect(testResp.ok(), `Create test failed: ${testResp.status()}`).toBeTruthy()
    const testBody = await testResp.json()
    testId = testBody.data?.id || testBody.id

    // 2. Create Suite A with timeout:integer
    const suiteAResp = await request.post(`${BACKEND_URL}/suites`, {
      data: { name: 'Reg Collision Suite A', description: 'Suite A for regression collision test' },
    })
    expect(suiteAResp.ok(), `Create Suite A failed: ${suiteAResp.status()}`).toBeTruthy()
    const suiteABody = await suiteAResp.json()
    suiteAId = suiteABody.data.id

    // Set Suite A variables: timeout as integer
    const varsAResp = await request.put(`${BACKEND_URL}/suites/${suiteAId}/variables`, {
      data: { timeout: { type: 'integer', value: 30 } },
    })
    expect(varsAResp.ok(), `Set Suite A variables failed: ${varsAResp.status()}`).toBeTruthy()

    // Add test to Suite A
    const addTestAResp = await request.post(`${BACKEND_URL}/suites/${suiteAId}/tests`, {
      data: { test_id: testId },
    })
    expect(addTestAResp.ok(), `Add test to Suite A failed: ${addTestAResp.status()}`).toBeTruthy()

    // 3. Create Suite B with timeout:string (different type - collision)
    const suiteBResp = await request.post(`${BACKEND_URL}/suites`, {
      data: { name: 'Reg Collision Suite B', description: 'Suite B for regression collision test' },
    })
    expect(suiteBResp.ok(), `Create Suite B failed: ${suiteBResp.status()}`).toBeTruthy()
    const suiteBBody = await suiteBResp.json()
    suiteBId = suiteBBody.data.id

    // Set Suite B variables: timeout as string (different type)
    const varsBResp = await request.put(`${BACKEND_URL}/suites/${suiteBId}/variables`, {
      data: { timeout: { type: 'string', value: '30s' } },
    })
    expect(varsBResp.ok(), `Set Suite B variables failed: ${varsBResp.status()}`).toBeTruthy()

    // Add test to Suite B
    const addTestBResp = await request.post(`${BACKEND_URL}/suites/${suiteBId}/tests`, {
      data: { test_id: testId },
    })
    // Note: this may 409 at suite level if suite collision is active; handle gracefully
    if (!addTestBResp.ok()) {
      // Suite-level collision prevents adding the same test - create a second test for Suite B
      const test2Resp = await request.post(`${BACKEND_URL}/tests`, {
        data: {
          name: 'Regression Collision Test 2',
          version: '1.0.0',
          workflow: { nodes: [], edges: [] },
          variables: {},
          metadata: {},
        },
      })
      expect(test2Resp.ok()).toBeTruthy()
      const test2Body = await test2Resp.json()
      const test2Id = test2Body.data?.id || test2Body.id
      const addTest2BResp = await request.post(`${BACKEND_URL}/suites/${suiteBId}/tests`, {
        data: { test_id: test2Id },
      })
      expect(
        addTest2BResp.ok(),
        `Add test2 to Suite B failed: ${addTest2BResp.status()}`
      ).toBeTruthy()
    }

    // 4. Create a regression
    const regressionResp = await request.post(`${BACKEND_URL}/regressions`, {
      data: { name: 'Collision Regression' },
    })
    expect(
      regressionResp.ok(),
      `Create regression failed: ${regressionResp.status()}`
    ).toBeTruthy()
    const regressionBody = await regressionResp.json()
    regressionId = regressionBody.data.id

    // 5. Add Suite A to regression - should succeed
    const addSuiteAResp = await request.put(`${BACKEND_URL}/regressions/${regressionId}`, {
      data: { suites: [suiteAId] },
    })
    expect(
      addSuiteAResp.ok(),
      `Add Suite A to regression failed: ${addSuiteAResp.status()}`
    ).toBeTruthy()

    // 6. Add Suite B alongside Suite A - should fail with 409 (type collision)
    const addSuiteBResp = await request.put(`${BACKEND_URL}/regressions/${regressionId}`, {
      data: { suites: [suiteAId, suiteBId] },
    })
    expect(addSuiteBResp.status()).toBe(409)

    const errorBody = await addSuiteBResp.json()
    expect(errorBody.success).toBe(false)
    expect(errorBody.error?.code).toBeTruthy()
    expect(errorBody.error?.message.toLowerCase()).toContain('collision')
  })

  test('allows adding suite with matching variable types to regression', async ({ request }) => {
    // Regression and Suite A should exist from the previous test
    expect(regressionId, 'Regression should exist from prior test').toBeTruthy()
    expect(suiteAId, 'Suite A should exist from prior test').toBeTruthy()

    // Create Suite C with timeout:integer (matching Suite A)
    const suiteCResp = await request.post(`${BACKEND_URL}/suites`, {
      data: {
        name: 'Reg Collision Suite C',
        description: 'Suite C matching types for regression collision test',
      },
    })
    expect(suiteCResp.ok(), `Create Suite C failed: ${suiteCResp.status()}`).toBeTruthy()
    const suiteCBody = await suiteCResp.json()
    suiteCId = suiteCBody.data.id

    // Set Suite C variables: timeout as integer (matching Suite A)
    const varsCResp = await request.put(`${BACKEND_URL}/suites/${suiteCId}/variables`, {
      data: { timeout: { type: 'integer', value: 60 } },
    })
    expect(varsCResp.ok(), `Set Suite C variables failed: ${varsCResp.status()}`).toBeTruthy()

    // Add test to Suite C
    const addTestCResp = await request.post(`${BACKEND_URL}/suites/${suiteCId}/tests`, {
      data: { test_id: testId },
    })
    // If suite-level collision prevents this, use a separate test
    if (!addTestCResp.ok()) {
      const test3Resp = await request.post(`${BACKEND_URL}/tests`, {
        data: {
          name: 'Regression Collision Test 3',
          version: '1.0.0',
          workflow: { nodes: [], edges: [] },
          variables: {},
          metadata: {},
        },
      })
      expect(test3Resp.ok()).toBeTruthy()
      const test3Body = await test3Resp.json()
      const test3Id = test3Body.data?.id || test3Body.id
      const addTest3CResp = await request.post(`${BACKEND_URL}/suites/${suiteCId}/tests`, {
        data: { test_id: test3Id },
      })
      expect(
        addTest3CResp.ok(),
        `Add test3 to Suite C failed: ${addTest3CResp.status()}`
      ).toBeTruthy()
    }

    // Add Suite C alongside Suite A to regression - should succeed
    const addSuiteCResp = await request.put(`${BACKEND_URL}/regressions/${regressionId}`, {
      data: { suites: [suiteAId, suiteCId] },
    })
    expect(
      addSuiteCResp.ok(),
      `Add Suite C to regression failed: ${addSuiteCResp.status()}`
    ).toBeTruthy()
  })
})

// ============================================================================
// UI-level collision resolution modal tests (Tests 5A / 5B / 5C)
//
// These exercise the frontend's collision-decoding pipeline by driving the
// regression-detail page through the UI and asserting that the
// CollisionResolutionModal opens with the correct description, entity label,
// and (when applicable) the "Remove conflicting suites" fix button.
//
// Each test creates its own fixtures via API and cleans them up individually.
// ============================================================================

interface UiCollisionFixture {
  regressionId: string
  extraRegressionId?: string
  suiteIds: string[]
}

async function createSuiteWithVar(
  request: APIRequestContext,
  name: string,
  varName: string,
  varType: string,
  value: unknown,
): Promise<string> {
  const resp = await request.post(`${BACKEND_URL}/suites`, { data: { name } })
  expect(resp.ok(), `Create suite ${name} failed: ${resp.status()}`).toBeTruthy()
  const id: string = (await resp.json()).data.id
  const varsResp = await request.put(`${BACKEND_URL}/suites/${id}/variables`, {
    data: { [varName]: { type: varType, value } },
  })
  expect(
    varsResp.ok(),
    `Set ${varName} on suite ${name} failed: ${varsResp.status()}`,
  ).toBeTruthy()
  return id
}

async function createBareRegression(
  request: APIRequestContext,
  name: string,
): Promise<string> {
  const resp = await request.post(`${BACKEND_URL}/regressions`, { data: { name } })
  expect(resp.ok(), `Create regression ${name} failed: ${resp.status()}`).toBeTruthy()
  return (await resp.json()).data.id
}

async function setRegressionSuites(
  request: APIRequestContext,
  regressionId: string,
  suiteIds: string[],
): Promise<void> {
  const resp = await request.put(`${BACKEND_URL}/regressions/${regressionId}`, {
    data: { suites: suiteIds },
  })
  expect(
    resp.ok(),
    `Set suites on regression ${regressionId} failed: ${resp.status()}`,
  ).toBeTruthy()
}

async function setRegressionVariables(
  request: APIRequestContext,
  regressionId: string,
  variables: Record<string, unknown>,
): Promise<void> {
  const resp = await request.put(`${BACKEND_URL}/regressions/${regressionId}`, {
    data: { variables },
  })
  expect(
    resp.ok(),
    `Set vars on regression ${regressionId} failed: ${resp.status()}`,
  ).toBeTruthy()
}

async function cleanupFixture(
  request: APIRequestContext,
  fixture: UiCollisionFixture,
): Promise<void> {
  if (fixture.regressionId)
    await request.delete(`${BACKEND_URL}/regressions/${fixture.regressionId}`).catch(() => {})
  if (fixture.extraRegressionId)
    await request.delete(`${BACKEND_URL}/regressions/${fixture.extraRegressionId}`).catch(() => {})
  for (const id of fixture.suiteIds) {
    await request.delete(`${BACKEND_URL}/suites/${id}`).catch(() => {})
  }
}

/** Wait for the regression detail page to settle after navigation. */
async function waitForRegressionDetail(page: Page): Promise<void> {
  await expect(page.locator('[data-testid="regression-detail-page"]')).toBeVisible({
    timeout: 15000,
  })
  await expect(page.locator('[data-testid="regression-detail-loading"]')).toHaveCount(0)
}

/**
 * Drive the suite picker: enter edit mode, open the picker, check the row for
 * each given suite name, add them. Does NOT click Save - caller does that so
 * they can observe the collision response.
 */
async function addSuitesViaPicker(page: Page, suiteNames: string[]): Promise<void> {
  // If not already in edit mode, click Edit Suites.
  const editBtn = page.locator('[data-testid="edit-suites-btn"]')
  if (await editBtn.isVisible().catch(() => false)) {
    await editBtn.click()
  }
  await page.locator('[data-testid="add-suites-btn"]').click()
  const modal = page.locator('[data-testid="suite-picker-modal"]')
  await expect(modal).toBeVisible({ timeout: 10000 })

  for (const name of suiteNames) {
    const row = modal
      .locator('[data-testid="suite-picker-suite-row"]')
      .filter({ hasText: name })
      .first()
    await expect(row, `Suite row "${name}" should be visible in picker`).toBeVisible({
      timeout: 10000,
    })
    await row.click()
  }
  await modal.locator('[data-testid="suite-picker-add-btn"]').click()
  await expect(modal).toBeHidden({ timeout: 5000 })
}

// ----------------------------------------------------------------------------
// Test 5A: regression-vs-other-regression
// ----------------------------------------------------------------------------

test.describe('Test 5A - regression-vs-regression collision modal', () => {
  let fixture: UiCollisionFixture

  test.afterAll(async ({ request }) => {
    await cleanupFixture(request, fixture)
  })

  test('saving conflicting variables on sibling regression opens modal without fix button', async ({
    page,
    request,
  }) => {
    // Two regressions share the same neutral suite. R1 has env:integer.
    // R2 has no variables yet; saving env:string on R2 must trigger a
    // cross-regression collision.
    const sharedSuiteId = await createSuiteWithVar(
      request,
      'Shared Neutral Suite 5A',
      'unused_marker',
      'string',
      'n/a',
    )
    const r1 = await createBareRegression(request, 'R-Share-5A')
    const r2 = await createBareRegression(request, 'R-Sibling-5A')
    await setRegressionSuites(request, r1, [sharedSuiteId])
    await setRegressionSuites(request, r2, [sharedSuiteId])
    await setRegressionVariables(request, r1, {
      env: { type: 'integer', value: 1, secret: false },
    })
    fixture = { regressionId: r2, extraRegressionId: r1, suiteIds: [sharedSuiteId] }

    // Drive the UI on R2.
    await page.goto(`/regressions/${r2}`)
    await waitForRegressionDetail(page)

    // Open Edit Variables dialog via the sidebar button.
    await page.locator('[data-testid="edit-variables-btn"]').click()
    const dialog = page.locator('[data-testid="edit-variables-dialog"]')
    await expect(dialog).toBeVisible({ timeout: 10000 })

    // Add one variable: env / string / "prod". Default type is string; the value
    // edits through the shared "Edit value" sheet.
    await dialog.locator('[data-testid="add-variable-btn"]').click()
    const row = dialog.locator('[data-testid="variable-editor-row"]').first()
    await row.locator('[data-testid="variable-name-input"]').fill('env')
    await row.locator('[data-testid^="entity-var-edit-"]').click()
    const valueSheet = page.locator('[data-testid="value-editor-sheet"]')
    await expect(valueSheet).toBeVisible()
    await valueSheet.locator('.cm-content').first().click()
    await page.keyboard.type('prod')
    await valueSheet.locator('[data-testid="value-editor-save-button"]').click()
    await valueSheet.locator('[data-testid="value-editor-cancel-button"]').click()
    await expect(valueSheet).toBeHidden()

    // Save and expect the collision modal to open.
    await dialog.locator('[data-testid="edit-dialog-save"]').click()
    const modal = page.locator('[data-testid="collision-resolution-modal"]')
    await expect(modal, 'Cross-regression collision should open modal').toBeVisible({
      timeout: 10000,
    })
    await expect(modal).toContainText('Another regression sharing the same suites')
    // Entity label must be "regression"; the conflict row names R-Share-5A.
    await expect(modal.locator('[data-testid="collision-details"]')).toContainText('R-Share-5A')
    // No fix button for regression-kind conflicts.
    await expect(modal.locator('[data-testid="collision-fix"]')).toHaveCount(0)
    await expect(modal.locator('[data-testid="collision-cancel"]')).toBeVisible()

    // Dismiss the modal; R2 should still have no variables persisted.
    await modal.locator('[data-testid="collision-cancel"]').click()
    const check = await request.get(`${BACKEND_URL}/regressions/${r2}`)
    const body = await check.json()
    expect(body.data.variables?.env).toBeUndefined()
  })
})

// ----------------------------------------------------------------------------
// Test 5B: regression-vs-member-suite
// ----------------------------------------------------------------------------

test.describe('Test 5B - regression-vs-member-suite collision modal', () => {
  let fixture: UiCollisionFixture

  test.afterAll(async ({ request }) => {
    await cleanupFixture(request, fixture)
  })

  test('adding a suite whose var conflicts with regression var opens modal with fix button', async ({
    page,
    request,
  }) => {
    // Regression has env:string. Adding a suite with env:integer must
    // raise a reg-vs-suite collision (source='suites').
    const conflictingSuiteId = await createSuiteWithVar(
      request,
      'Suite Int Env 5B',
      'env',
      'integer',
      1,
    )
    const regressionId = await createBareRegression(request, 'R-RegVSSuite-5B')
    await setRegressionVariables(request, regressionId, {
      env: { type: 'string', value: 'dev', secret: false },
    })
    fixture = { regressionId, suiteIds: [conflictingSuiteId] }

    await page.goto(`/regressions/${regressionId}`)
    await waitForRegressionDetail(page)

    await addSuitesViaPicker(page, ['Suite Int Env 5B'])

    // Save suite edits - should raise the collision.
    await page.locator('[data-testid="save-suites-btn"]').click()

    const modal = page.locator('[data-testid="collision-resolution-modal"]')
    await expect(modal, 'Reg-vs-suite collision should open modal').toBeVisible({
      timeout: 10000,
    })
    await expect(modal).toContainText('member suite declares the same variable')
    await expect(modal.locator('[data-testid="collision-details"]')).toContainText(
      'Suite Int Env 5B',
    )
    // Fix button must be present for suite-side conflicts.
    const fixBtn = modal.locator('[data-testid="collision-fix"]')
    await expect(fixBtn).toBeVisible()
    await expect(fixBtn).toHaveText(/Remove conflicting suites/i)

    // Click fix and confirm the suite disappears from the edit-mode table.
    await fixBtn.click()
    await expect(modal).toBeHidden({ timeout: 5000 })
    const suitesTable = page.locator('[data-testid="regression-suites-table"]')
    await expect(suitesTable).not.toContainText('Suite Int Env 5B')

    // Back-end state is untouched (save never completed).
    const check = await request.get(`${BACKEND_URL}/regressions/${regressionId}`)
    const body = await check.json()
    expect(body.data.suites ?? []).toEqual([])
  })
})

// ----------------------------------------------------------------------------
// Test 5C: suite-pair inside regression
// ----------------------------------------------------------------------------

test.describe('Test 5C - suite-pair collision modal', () => {
  let fixture: UiCollisionFixture

  test.afterAll(async ({ request }) => {
    await cleanupFixture(request, fixture)
  })

  test('adding two suites with conflicting vars opens modal and fix removes both', async ({
    page,
    request,
  }) => {
    // Regression has NO variables so only the suite-pair collision path
    // fires (not regression-vs-suite). The two suites disagree on env type.
    const suiteStringId = await createSuiteWithVar(
      request,
      'Suite Str Env 5C',
      'env',
      'string',
      'dev',
    )
    const suiteBoolId = await createSuiteWithVar(
      request,
      'Suite Bool Env 5C',
      'env',
      'boolean',
      true,
    )
    const regressionId = await createBareRegression(request, 'R-Pair-5C')
    fixture = { regressionId, suiteIds: [suiteStringId, suiteBoolId] }

    await page.goto(`/regressions/${regressionId}`)
    await waitForRegressionDetail(page)

    await addSuitesViaPicker(page, ['Suite Str Env 5C', 'Suite Bool Env 5C'])
    await page.locator('[data-testid="save-suites-btn"]').click()

    const modal = page.locator('[data-testid="collision-resolution-modal"]')
    await expect(modal, 'Suite-pair collision should open modal').toBeVisible({
      timeout: 10000,
    })
    await expect(modal).toContainText('Two suites in this regression')
    // The backend pair-collision report names one suite as "this" and the
    // other as "other"; only the "other" label is surfaced in the modal
    // body. ``conflicting_suite_ids`` contains BOTH, which is what drives
    // the fix button to remove both.
    const details = modal.locator('[data-testid="collision-details"]')
    const detailsText = (await details.innerText()) ?? ''
    const namesInBody = ['Suite Str Env 5C', 'Suite Bool Env 5C'].filter((name) =>
      detailsText.includes(name),
    )
    expect(namesInBody.length, 'At least one of the conflicting suite names must appear').toBeGreaterThanOrEqual(1)

    const fixBtn = modal.locator('[data-testid="collision-fix"]')
    await expect(fixBtn).toBeVisible()
    await fixBtn.click()
    await expect(modal).toBeHidden({ timeout: 5000 })

    // Both suites should have been removed from the edit-mode table -
    // the fix action uses ``conflicting_suite_ids`` which contains both.
    const suitesTable = page.locator('[data-testid="regression-suites-table"]')
    await expect(suitesTable).not.toContainText('Suite Str Env 5C')
    await expect(suitesTable).not.toContainText('Suite Bool Env 5C')

    // Backend state: no suites persisted.
    const check = await request.get(`${BACKEND_URL}/regressions/${regressionId}`)
    const body = await check.json()
    expect(body.data.suites ?? []).toEqual([])
  })
})
