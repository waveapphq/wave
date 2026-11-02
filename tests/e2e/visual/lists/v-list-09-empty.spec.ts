/**
 * V-LIST-09: Regressions List Empty State Tests
 *
 * These tests require an empty database (no regressions seeded).
 * They are run in the empty-state phase.
 */

import { test, expect } from '../../helpers/playwright-fixtures'

test.describe('V-LIST-09: Regressions List Empty State', () => {
  // Per LIST-6: Entity-specific icon, encouraging message, primary CTA
  test('V-LIST-09-E1: empty state displays icon and message per LIST-6', async ({
    page,
  }) => {
    await page.goto('/regressions')
    await page.waitForSelector('[data-testid="regressions-page"]', { state: 'visible' })

    // Empty state container
    const emptyStateContainer = page.locator('[data-testid="empty-state"]')
    await expect(
      emptyStateContainer,
      'Empty state container should be visible'
    ).toBeVisible()

    // Per LIST-6: Entity-specific icon (purple layers for regressions)
    const emptyStateIcon = emptyStateContainer.locator(
      '[data-testid="empty-state-icon"]'
    )
    await expect(
      emptyStateIcon,
      'Empty state icon should be visible'
    ).toBeVisible()

    // "No regressions yet" message
    const emptyStateTitle = emptyStateContainer.locator(
      '[data-testid="empty-state-title"]'
    )
    await expect(emptyStateTitle, 'Empty state title should be visible').toBeVisible()
    await expect(emptyStateTitle).toContainText(/No regressions yet/i)
  })

  // CTA button
  test('V-LIST-09-E2: empty state has primary CTA button per LIST-6', async ({
    page,
  }) => {
    await page.goto('/regressions')
    await page.waitForSelector('[data-testid="regressions-page"]', { state: 'visible' })

    // "Create Your First Regression" CTA button
    const ctaButton = page.getByRole('button', {
      name: /Create Your First Regression|Create Regression/i,
    })
    await expect(ctaButton, 'CTA button should be visible').toBeVisible()
    await expect(ctaButton, 'CTA button should be enabled').toBeEnabled()

    // Should have primary button styling
    const isPrimary =
      (await ctaButton.getAttribute('class'))?.includes('primary') ||
      (await ctaButton.getAttribute('data-variant'))?.includes('primary') ||
      (await ctaButton.evaluate((el) => {
        const bgColor = getComputedStyle(el).backgroundColor
        return (
          bgColor.includes('59, 130, 246') ||
          bgColor.includes('37, 99, 235') ||
          bgColor.includes('14, 165, 233')
        )
      }))

    expect(isPrimary, 'CTA button should have primary styling').toBeTruthy()
  })

  // Header still shows title and button in empty state
  test('V-LIST-09-E3: page header still shows title and New Regression button in empty state', async ({
    page,
  }) => {
    await page.goto('/regressions')
    await page.waitForSelector('[data-testid="regressions-page"]', { state: 'visible' })

    // Page title should still be "Regressions"
    const pageTitle = page.getByRole('heading', { name: 'Regressions', level: 1 })
    await expect(pageTitle, 'Page title should be "Regressions"').toBeVisible()

    // "+ New Regression" button should still be visible
    const newRegressionButton = page.getByRole('button', { name: /New Regression/i })
    await expect(
      newRegressionButton,
      '"+ New Regression" button should be visible'
    ).toBeVisible()
  })
})
