/**
 * Suite Namespace Autocomplete E2E Test
 *
 * Tests that suite variables appear in expression autocomplete under the
 * `suite.` namespace when editing a test in the workbench.
 *
 * Scenario:
 * - Create a suite with variables (api_host:string, max_retries:integer)
 * - Create a test with a Log node whose message is in expression mode
 * - Add the test to the suite
 * - Open the test in the workbench
 * - Click the Log node, open config modal
 * - Type 'suite.' in the expression editor
 * - Verify autocomplete shows suite.api_host and suite.max_retries
 *
 * Run: ./scripts/e2e-targeted-local.sh functional/suite-namespace-autocomplete/v-suite-namespace-autocomplete.spec.ts
 */

import { test, expect } from '../../helpers/playwright-fixtures'
import { waitForCanvasLoad } from '../../helpers/canvas'
import { BACKEND_URL } from '../../helpers/config'
import { configSheet } from '../../helpers/workbench'

test.describe('Suite Namespace Autocomplete', () => {
  let suiteId: string
  let testId: string

  test.afterAll(async ({ request }) => {
    if (testId) await request.delete(`${BACKEND_URL}/tests/${testId}`).catch(() => {})
    if (suiteId) await request.delete(`${BACKEND_URL}/suites/${suiteId}`).catch(() => {})
  })

  test('shows suite variables in expression autocomplete', async ({ page, request }) => {
    // ================================================================
    // STEP 1: Create a suite with variables via API
    // ================================================================
    const suiteResp = await request.post(`${BACKEND_URL}/suites`, {
      data: { name: 'Autocomplete Test Suite', description: 'For autocomplete E2E' },
    })
    expect(suiteResp.ok(), `Create suite failed: ${suiteResp.status()}`).toBeTruthy()
    const suiteBody = await suiteResp.json()
    suiteId = suiteBody.data.id

    const varsResp = await request.put(`${BACKEND_URL}/suites/${suiteId}/variables`, {
      data: {
        api_host: { type: 'string', value: 'localhost' },
        max_retries: { type: 'integer', value: 3 },
      },
    })
    expect(varsResp.ok(), `Set suite variables failed: ${varsResp.status()}`).toBeTruthy()

    // ================================================================
    // STEP 2: Create a test with one Log node via API
    // ================================================================
    const fixture = {
      name: 'Suite Autocomplete Test',
      version: '1.0.0',
      workflow: {
        nodes: [
          {
            id: 'log-node',
            type: 'workflowNode',
            position: { x: 400, y: 200 },
            data: {
              label: 'Log',
              elementType: 'log',
              nodeType: 'plugin',
              category: 'system',
              version: '1.0.0',
              description: 'Log Expression',
              hasNewerVersion: false,
              expressionFields: ['message'],
              templateFields: [],
              config: {
                values: { message: "'test'", level: 'INFO' },
                outputBindings: {},
                profileBindings: [],
              },
            },
            measured: { width: 120, height: 62 },
          },
        ],
        edges: [
          {
            id: 'e1',
            source: 'start-node',
            target: 'log-node',
            type: 'default',
          },
        ],
      },
      variables: {},
      metadata: {},
    }

    const testResp = await request.post(`${BACKEND_URL}/tests`, { data: fixture })
    expect(testResp.ok(), `Create test failed: ${testResp.status()}`).toBeTruthy()
    const testBody = await testResp.json()
    testId = testBody.data?.id || testBody.id

    // ================================================================
    // STEP 3: Add test to suite
    // ================================================================
    const addResp = await request.post(`${BACKEND_URL}/suites/${suiteId}/tests`, {
      data: { test_id: testId },
    })
    expect(addResp.ok(), `Add test to suite failed: ${addResp.status()}`).toBeTruthy()

    // ================================================================
    // STEP 4: Navigate to workbench with the test
    // ================================================================
    // Clear any existing session
    await page.request
      .delete(`${BACKEND_URL}/workbench/session/`)
      .catch(() => {})

    await page.goto(`/workbench?editTest=${testId}`)
    await page.evaluate(() => localStorage.clear())
    await page.goto(`/workbench?editTest=${testId}`)
    await waitForCanvasLoad(page)

    // ================================================================
    // STEP 5: Click the Log node and open config modal
    // ================================================================
    // Find workflow nodes (excluding internal elements like icons)
    const workflowNodes = page.locator(
      '[data-testid^="workflow-node-"][data-nodetype]'
    )
    const logNode = workflowNodes.first()
    await logNode.scrollIntoViewIfNeeded()
    await logNode.locator('button').first().dispatchEvent('click')
    await expect(logNode).toHaveAttribute('data-selected', 'true')

    // Open config modal via gear button
    const gearButton = page.locator(
      '[data-testid="node-configure"]'
    )
    await gearButton.click()
    const modal = configSheet(page)
    await expect(modal).toBeVisible({ timeout: 5000 })

    // ================================================================
    // STEP 6: Ensure expression mode for the message parameter
    // ================================================================
    const messageRow = modal.locator('[data-testid="param-row-message"]')
    await expect(messageRow).toBeVisible({ timeout: 5000 })

    // The message field should already be in expression mode (expressionFields includes "message"),
    // but verify and toggle if needed
    const messageInput = modal.locator('[data-testid="param-input-message"]')
    const cmContent = messageInput.locator('.cm-content')
    const isCmVisible = await cmContent.isVisible({ timeout: 2000 }).catch(() => false)

    if (!isCmVisible) {
      // Toggle to expression mode
      const expressionToggle = messageRow.locator('[data-testid="expression-toggle"]')
      await expressionToggle.click()
      await page.waitForTimeout(200)
    }

    // ================================================================
    // STEP 7: Type 'suite.' to trigger namespace autocomplete
    // ================================================================
    await cmContent.click()
    // Clear existing content
    await page.keyboard.press('Control+a')
    await page.keyboard.type('suite.', { delay: 50 })
    await page.waitForTimeout(500)

    // ================================================================
    // STEP 8: Verify autocomplete shows suite variables
    // ================================================================
    const autocomplete = page.locator('.cm-tooltip-autocomplete')
    await expect(
      autocomplete,
      'Autocomplete dropdown should appear for suite namespace'
    ).toBeVisible({ timeout: 5000 })

    // Verify suite variables appear in the autocomplete list
    await expect(
      autocomplete.getByText('api_host'),
      'Autocomplete should show api_host variable'
    ).toBeVisible({ timeout: 3000 })
    await expect(
      autocomplete.getByText('max_retries'),
      'Autocomplete should show max_retries variable'
    ).toBeVisible({ timeout: 3000 })
  })
})
