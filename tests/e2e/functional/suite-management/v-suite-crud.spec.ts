/**
 * Suite Management Functional Tests
 *
 * End-to-end tests verifying suite CRUD operations against the real backend
 * and UI. Exercises: create via modal, detail page, edit/save/discard, navigation.
 *
 * Phase: Step 5 (Suite creation + detail/edit page)
 *
 * Tests:
 * - API CRUD: Create, read, update suite via API
 * - Create modal: Open from list, fill fields, submit
 * - Detail page: 2-panel layout, sidebar metadata, tests table
 * - Edit mode: Toggle, modify fields, save, discard
 * - Navigation: Back button, edit route redirect
 */

import { test, expect } from '../../helpers/playwright-fixtures'
import { BACKEND_URL } from '../../helpers/config'

// ============================================================================
// Helpers
// ============================================================================

async function clearSuites(page: import('@playwright/test').Page) {
  const listResp = await page.request.get(`${BACKEND_URL}/suites?per_page=100`)
  const body = await listResp.json()
  const suites = body.data ?? []
  for (const suite of suites) {
    await page.request.delete(`${BACKEND_URL}/suites/${suite.id}`)
  }
}

async function createSuiteViaApi(
  page: import('@playwright/test').Page,
  data: { name: string; description?: string; tags?: string[]; variables?: Record<string, unknown> }
) {
  const resp = await page.request.post(`${BACKEND_URL}/suites`, { data })
  expect(resp.ok()).toBeTruthy()
  const body = await resp.json()
  return body.data
}

async function waitForSuitesListLoad(page: import('@playwright/test').Page) {
  await page.waitForSelector('[data-testid="suites-page"]', { state: 'visible' })
}

async function waitForSuiteDetailLoad(page: import('@playwright/test').Page) {
  await page.waitForSelector('[data-testid="suite-detail-page"]', { state: 'visible' })
}

// ============================================================================
// API CRUD
// ============================================================================

test.describe('Suite API CRUD', () => {
  test.beforeEach(async ({ page }) => {
    await clearSuites(page)
  })

  test('POST creates suite and GET retrieves it', async ({ page }) => {
    const created = await createSuiteViaApi(page, {
      name: 'API Test Suite',
      description: 'Created via API',
      tags: ['api', 'test'],
    })

    expect(created.name).toBe('API Test Suite')
    expect(created.id).toBeTruthy()

    // Fetch it back
    const resp = await page.request.get(`${BACKEND_URL}/suites/${created.id}`)
    const body = await resp.json()
    expect(body.data.name).toBe('API Test Suite')
    expect(body.data.description).toBe('Created via API')
    expect(body.data.tags).toEqual(['api', 'test'])
  })

  test('PUT updates suite name', async ({ page }) => {
    const created = await createSuiteViaApi(page, { name: 'Original Name' })

    const resp = await page.request.put(`${BACKEND_URL}/suites/${created.id}`, {
      data: { name: 'Updated Name' },
    })
    expect(resp.ok()).toBeTruthy()

    const getResp = await page.request.get(`${BACKEND_URL}/suites/${created.id}`)
    const body = await getResp.json()
    expect(body.data.name).toBe('Updated Name')
  })
})

// ============================================================================
// Create Modal
// ============================================================================

test.describe('Suite Create Modal', () => {
  test.beforeEach(async ({ page }) => {
    await clearSuites(page)
  })

  test('opens modal from list page, creates suite, navigates to detail', async ({ page }) => {
    await page.goto('/suites')
    await waitForSuitesListLoad(page)

    // Click "New Suite" button
    await page.locator('button:has-text("New Suite")').click()

    // Modal should appear
    await expect(page.locator('[data-testid="suite-create-modal"]')).toBeVisible()

    // Fill in name
    await page.locator('[data-testid="suite-name-input"]').fill('My New Suite')

    // Fill in description
    await page.locator('[data-testid="suite-description-input"]').fill('A test suite description')

    // Submit
    await page.locator('[data-testid="suite-create-submit"]').click()

    // Should navigate to the suite detail page
    await waitForSuiteDetailLoad(page)

    // Suite name should be visible in the header
    await expect(page.locator('h1')).toContainText('My New Suite')
  })

  test('shows validation error when name is empty', async ({ page }) => {
    await page.goto('/suites')
    await waitForSuitesListLoad(page)

    await page.locator('button:has-text("New Suite")').click()
    await expect(page.locator('[data-testid="suite-create-modal"]')).toBeVisible()

    // Submit without filling name
    await page.locator('[data-testid="suite-create-submit"]').click()

    // Validation error should appear
    await expect(page.locator('text=Name is required')).toBeVisible()

    // Modal should still be open (not navigated away)
    await expect(page.locator('[data-testid="suite-create-modal"]')).toBeVisible()
  })

  test('cancel button closes modal', async ({ page }) => {
    await page.goto('/suites')
    await waitForSuitesListLoad(page)

    await page.locator('button:has-text("New Suite")').click()
    await expect(page.locator('[data-testid="suite-create-modal"]')).toBeVisible()

    await page.locator('button:has-text("Cancel")').click()

    // Modal should close
    await expect(page.locator('[data-testid="suite-create-modal"]')).not.toBeVisible()
  })
})

// ============================================================================
// Detail Page
// ============================================================================

test.describe('Suite Detail Page', () => {
  let suiteId: string

  test.beforeEach(async ({ page }) => {
    await clearSuites(page)
    const suite = await createSuiteViaApi(page, {
      name: 'Detail Test Suite',
      description: 'For detail page testing',
      tags: ['e2e', 'detail'],
      variables: {
        base_url: { type: 'string', value: 'http://localhost:8080', secret: false },
        api_key: { type: 'string', value: 'secret123', secret: true },
      },
    })
    suiteId = suite.id
  })

  test('displays 2-panel layout with sidebar and content', async ({ page }) => {
    await page.goto(`/suites/${suiteId}`)
    await waitForSuiteDetailLoad(page)

    // Sidebar should show metadata
    await expect(page.locator('[data-testid="suite-metadata-sidebar"]')).toBeVisible()

    // Suite name in header
    await expect(page.locator('h1')).toContainText('Detail Test Suite')

    // Description in sidebar
    await expect(page.locator('[data-testid="sidebar-description-display"]')).toContainText(
      'For detail page testing'
    )

    // Tags displayed in sidebar
    const tagsDisplay = page.locator('[data-testid="sidebar-tags-display"]')
    await expect(tagsDisplay.getByText('e2e')).toBeVisible()
    await expect(tagsDisplay.getByText('detail')).toBeVisible()

    // Variables table visible
    await expect(page.locator('[data-testid="variable-readonly-table"]')).toBeVisible()
    await expect(page.locator('text=base_url')).toBeVisible()
  })

  test('back button navigates to suites list', async ({ page }) => {
    await page.goto(`/suites/${suiteId}`)
    await waitForSuiteDetailLoad(page)

    await page.locator('[data-testid="detail-back-btn"]').click()

    await waitForSuitesListLoad(page)
    expect(page.url()).toContain('/suites')
  })

  test('empty tests shows empty state', async ({ page }) => {
    await page.goto(`/suites/${suiteId}`)
    await waitForSuiteDetailLoad(page)

    // No tests added - should show empty state in the DataTable
    await expect(page.getByText('No tests in this suite')).toBeVisible()
  })
})

// ============================================================================
// Edit Mode
// ============================================================================

test.describe('Suite Edit Mode', () => {
  let suiteId: string

  test.beforeEach(async ({ page }) => {
    await clearSuites(page)
    const suite = await createSuiteViaApi(page, {
      name: 'Edit Test Suite',
      description: 'Original description',
      tags: ['original'],
    })
    suiteId = suite.id
  })

  test('Edit details button opens edit dialog with Save/Cancel', async ({ page }) => {
    await page.goto(`/suites/${suiteId}`)
    await waitForSuiteDetailLoad(page)

    // Click Edit details
    await page.locator('[data-testid="edit-details-btn"]').click()

    // Edit dialog should open with Save and Cancel
    await expect(page.locator('[data-testid="edit-details-dialog"]')).toBeVisible()
    await expect(page.locator('[data-testid="edit-dialog-save"]')).toBeVisible()
    await expect(page.locator('[data-testid="edit-dialog-cancel"]')).toBeVisible()

    // Editable inputs should appear in dialog
    await expect(page.locator('[data-testid="edit-details-name"]')).toBeVisible()
    await expect(page.locator('[data-testid="edit-details-description"]')).toBeVisible()
  })

  test('edit name, save, and verify persistence', async ({ page }) => {
    await page.goto(`/suites/${suiteId}`)
    await waitForSuiteDetailLoad(page)

    // Open edit details dialog
    await page.locator('[data-testid="edit-details-btn"]').click()
    await expect(page.locator('[data-testid="edit-details-dialog"]')).toBeVisible()

    // Change name
    const nameInput = page.locator('[data-testid="edit-details-name"]')
    await nameInput.clear()
    await nameInput.fill('Updated Suite Name')

    // Save
    await page.locator('[data-testid="edit-dialog-save"]').click()

    // Dialog should close
    await expect(page.locator('[data-testid="edit-details-dialog"]')).not.toBeVisible()

    // Name should be updated in header
    await expect(page.locator('h1')).toContainText('Updated Suite Name')

    // Verify via API
    const resp = await page.request.get(`${BACKEND_URL}/suites/${suiteId}`)
    const body = await resp.json()
    expect(body.data.name).toBe('Updated Suite Name')
  })

  test('cancel without changes closes dialog immediately', async ({ page }) => {
    await page.goto(`/suites/${suiteId}`)
    await waitForSuiteDetailLoad(page)

    await page.locator('[data-testid="edit-details-btn"]').click()
    await expect(page.locator('[data-testid="edit-details-dialog"]')).toBeVisible()

    await page.locator('[data-testid="edit-dialog-cancel"]').click()

    // Dialog should close without confirmation
    await expect(page.locator('[data-testid="edit-details-dialog"]')).not.toBeVisible()
  })

  test('cancel with changes shows confirmation dialog', async ({ page }) => {
    await page.goto(`/suites/${suiteId}`)
    await waitForSuiteDetailLoad(page)

    // Open edit dialog
    await page.locator('[data-testid="edit-details-btn"]').click()
    await expect(page.locator('[data-testid="edit-details-dialog"]')).toBeVisible()

    // Make a change
    const nameInput = page.locator('[data-testid="edit-details-name"]')
    await nameInput.clear()
    await nameInput.fill('Changed Name')

    // Click cancel
    await page.locator('[data-testid="edit-dialog-cancel"]').click()

    // Confirmation dialog should appear
    await expect(page.locator('[data-testid="unsaved-changes-dialog"]')).toBeVisible()
  })

  test('variables editor appears in edit variables dialog', async ({ page }) => {
    // Create suite with variables
    const suite = await createSuiteViaApi(page, {
      name: 'Vars Edit Suite',
      variables: {
        env: { type: 'string', value: 'staging', secret: false },
      },
    })

    await page.goto(`/suites/${suite.id}`)
    await waitForSuiteDetailLoad(page)

    // Detail mode: variables table in sidebar
    await expect(page.locator('[data-testid="variable-readonly-table"]')).toBeVisible()

    // Open variables edit dialog
    await page.locator('[data-testid="edit-variables-btn"]').click()

    // Variables editor dialog should show
    await expect(page.locator('[data-testid="edit-variables-dialog"]')).toBeVisible()
    await expect(page.locator('[data-testid="variable-editor"]')).toBeVisible()
    await expect(page.locator('[data-testid="add-variable-btn"]')).toBeVisible()
  })
})

// ============================================================================
// Route Redirects
// ============================================================================

test.describe('Suite Route Handling', () => {
  test('/suites/new redirects to /suites', async ({ page }) => {
    await page.goto('/suites/new')
    await waitForSuitesListLoad(page)
    expect(page.url()).toContain('/suites')
    expect(page.url()).not.toContain('/new')
  })

  test('/suites/:id/edit renders the same detail page', async ({ page }) => {
    await clearSuites(page)
    const suite = await createSuiteViaApi(page, { name: 'Route Test Suite' })

    await page.goto(`/suites/${suite.id}/edit`)
    await waitForSuiteDetailLoad(page)
    await expect(page.locator('h1')).toContainText('Route Test Suite')
  })
})
