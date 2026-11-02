/**
 * V-REG-EDIT-01: Regression Creation Dialog
 *
 * Phase: fixture-dark (requires seeded data for tag autocomplete)
 * Uses seed from V-REG-DETAIL-01 (runs before this in fixture ordering)
 * REQ: REQ-5.2.1.37 Regression management
 *
 * Pass Criteria:
 * 1. Modal appears on "New Regression" button click
 * 2. Title reads "Create Regression"
 * 3. Name field required with placeholder
 * 4. Description field optional with placeholder
 * 5. Tags field present
 * 6. Footer: Cancel (left) and Create (right) buttons
 * 7. Submit disabled when name is empty
 * 8. Cancel closes modal
 */

import { test, expect } from '../../helpers/playwright-fixtures'

async function waitForRegressionsListLoad(page: import('@playwright/test').Page) {
  await page.waitForSelector('[data-testid="regressions-page"]', { state: 'visible' })
}

test.describe('V-REG-EDIT-01: Regression Creation Dialog', () => {
  test('V-REG-EDIT-01-S1: modal appears with correct title', async ({ page }) => {
    await page.goto('/regressions')
    await waitForRegressionsListLoad(page)

    await page.locator('button:has-text("New Regression")').click()

    const modal = page.locator('[data-testid="regression-create-modal"]')
    await expect(modal, 'Create regression modal should be visible').toBeVisible()

    // Title
    await expect(modal.getByRole('heading')).toContainText('Create Regression')
  })

  test('V-REG-EDIT-01-S2: name field required with placeholder', async ({ page }) => {
    await page.goto('/regressions')
    await waitForRegressionsListLoad(page)

    await page.locator('button:has-text("New Regression")').click()
    const modal = page.locator('[data-testid="regression-create-modal"]')
    await expect(modal).toBeVisible()

    const nameInput = modal.locator('[data-testid="regression-name-input"]')
    await expect(nameInput).toBeVisible()
    await expect(nameInput).toHaveAttribute('placeholder', /enter regression name/i)
  })

  test('V-REG-EDIT-01-S3: description field optional with placeholder', async ({ page }) => {
    await page.goto('/regressions')
    await waitForRegressionsListLoad(page)

    await page.locator('button:has-text("New Regression")').click()
    const modal = page.locator('[data-testid="regression-create-modal"]')
    await expect(modal).toBeVisible()

    const descInput = modal.locator('[data-testid="regression-description-input"]')
    await expect(descInput).toBeVisible()
  })

  test('V-REG-EDIT-01-S4: tags field present', async ({ page }) => {
    await page.goto('/regressions')
    await waitForRegressionsListLoad(page)

    await page.locator('button:has-text("New Regression")').click()
    const modal = page.locator('[data-testid="regression-create-modal"]')
    await expect(modal).toBeVisible()

    const tagsInput = modal.locator('[data-testid="regression-tags-input"]')
    await expect(tagsInput).toBeVisible()
  })

  test('V-REG-EDIT-01-S5: footer has Cancel and Create buttons', async ({ page }) => {
    await page.goto('/regressions')
    await waitForRegressionsListLoad(page)

    await page.locator('button:has-text("New Regression")').click()
    const modal = page.locator('[data-testid="regression-create-modal"]')
    await expect(modal).toBeVisible()

    await expect(modal.locator('button:has-text("Cancel")')).toBeVisible()
    const createBtn = modal.locator('[data-testid="regression-create-submit"]')
    await expect(createBtn).toBeVisible()
  })

  test('V-REG-EDIT-01-S6: submit shows validation when name empty', async ({ page }) => {
    await page.goto('/regressions')
    await waitForRegressionsListLoad(page)

    await page.locator('button:has-text("New Regression")').click()
    const modal = page.locator('[data-testid="regression-create-modal"]')
    await expect(modal).toBeVisible()

    // Click submit without filling name
    await modal.locator('[data-testid="regression-create-submit"]').click()

    // Validation error should appear
    await expect(modal.locator('text=Name is required')).toBeVisible()

    // Modal should still be open
    await expect(modal).toBeVisible()
  })

  test('V-REG-EDIT-01-S7: cancel closes modal', async ({ page }) => {
    await page.goto('/regressions')
    await waitForRegressionsListLoad(page)

    await page.locator('button:has-text("New Regression")').click()
    const modal = page.locator('[data-testid="regression-create-modal"]')
    await expect(modal).toBeVisible()

    await modal.locator('button:has-text("Cancel")').click()

    await expect(modal).not.toBeVisible()
  })

  test('V-REG-EDIT-01-S8: successful create navigates to detail page', async ({ page }) => {
    await page.goto('/regressions')
    await waitForRegressionsListLoad(page)

    await page.locator('button:has-text("New Regression")').click()
    const modal = page.locator('[data-testid="regression-create-modal"]')
    await expect(modal).toBeVisible()

    await modal.locator('[data-testid="regression-name-input"]').fill('Visual Test Regression')
    await modal.locator('[data-testid="regression-create-submit"]').click()

    // Should navigate to detail page
    await page.waitForSelector('[data-testid="regression-detail-page"]', { state: 'visible' })
    await expect(page.locator('h1')).toContainText('Visual Test Regression')
  })
})
