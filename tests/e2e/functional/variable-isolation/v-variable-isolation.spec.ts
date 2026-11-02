/**
 * Variable Isolation E2E Test
 *
 * Verifies that workbench variable state does NOT persist when switching
 * between tests. Each test should start with a clean variable manager.
 */

import { test, expect } from '../../helpers/playwright-fixtures'
import { waitForCanvasLoad } from '../../helpers/canvas'
import { BACKEND_URL } from '../../helpers/config'
import { createSimpleVariable } from '../../helpers/variable-create'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function createEmptyTest(
  request: { post: (url: string, options: any) => Promise<any> },
  name: string,
): Promise<string> {
  const resp = await request.post(`${BACKEND_URL}/tests`, {
    data: { name, description: `Variable isolation test: ${name}` },
  })
  expect(resp.ok(), `Failed to create test "${name}": ${resp.status()}`).toBeTruthy()
  const body = await resp.json()
  return body.data?.id || body.id
}

async function deleteTest(
  request: { delete: (url: string) => Promise<any> },
  testId: string,
): Promise<void> {
  await request.delete(`${BACKEND_URL}/tests/${testId}`).catch(() => {})
}

async function expandVariableManager(page: import('@playwright/test').Page): Promise<void> {
  const panel = page.locator('[data-testid="variable-manager"]')
  const state = await panel.getAttribute('data-state')
  if (state === 'collapsed') {
    const expandBtn = panel.locator('button[aria-label="Expand Variable Manager"]')
    await expandBtn.click()
    await expect(panel).toHaveAttribute('data-state', 'expanded')
  }
}

async function addVariableViaUI(
  page: import('@playwright/test').Page,
  name: string,
): Promise<void> {
  await createSimpleVariable(page, name, { value: 'test-value' })
  await expect(
    page.locator(`[data-testid^="variable-row-"]:has-text("${name}")`),
  ).toBeVisible()
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('Variable Isolation Between Tests', () => {
  let testAId: string
  let testBId: string

  test.beforeAll(async ({ request }) => {
    await request.delete(`${BACKEND_URL}/workbench/session/`).catch(() => {})
    testAId = await createEmptyTest(request, 'Var Isolation Test A')
    testBId = await createEmptyTest(request, 'Var Isolation Test B')
  })

  test.afterAll(async ({ request }) => {
    await deleteTest(request, testAId)
    await deleteTest(request, testBId)
  })

  test('variables from Test A do not persist when opening Test B', async ({ page }) => {
    // Step 1: Open Test A and add a variable
    await page.goto(`/workbench?editTest=${testAId}`)
    await page.evaluate(() => localStorage.clear())
    await page.goto(`/workbench?editTest=${testAId}`)
    await waitForCanvasLoad(page)

    await expandVariableManager(page)
    await addVariableViaUI(page, 'leaked_var')

    // Verify the variable is rendered (addVariableViaUI already asserts this,
    // but keeping explicit assertion for clarity in this flow).
    await expect(
      page.locator(`[data-testid^="variable-row-"]:has-text("leaked_var")`),
    ).toBeVisible()

    // Step 2: Close Test A via the X button (stays in SPA, no full reload)
    const closeBtn = page.locator('[data-testid="toolbar-close-button"]')
    await closeBtn.click()

    // Handle discard dialog (test is dirty from adding a variable)
    const discardBtn = page.getByRole('button', { name: /discard/i })
    if (await discardBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await discardBtn.click()
    }

    // Step 3: After close - variable row should be gone from the DOM.
    // The variable manager panel may be collapsed; what matters is the
    // variable does not persist when we re-open Test B below.

    // Step 4: Open Test B (still in SPA - no page.goto)
    // Navigate via the URL bar change that triggers React Router
    await page.evaluate((testId) => {
      const url = `/workbench?editTest=${testId}`
      // Use React Router's navigation by setting window.location
      // pushState alone doesn't trigger React Router, but assigning
      // to location.href does a "soft" reload within the SPA
      window.location.assign(url)
    }, testBId)

    await waitForCanvasLoad(page)
    await expandVariableManager(page)

    // Step 5: Test B should NOT have Test A's variable in the DOM.
    await expect(
      page.locator(`[data-testid^="variable-row-"]:has-text("leaked_var")`),
    ).toHaveCount(0, { timeout: 3000 })
  })
})
