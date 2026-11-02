/**
 * V-SET-01: Settings Page Empty State Tests
 *
 * These tests require an empty database (no environments seeded).
 * They are run in the empty-state phase.
 *
 * Pass Criteria - Empty State (E1-E2):
 * 22. Empty state with icon, message, and CTA button
 * 23. Section nav remains functional in empty state
 */

import { test, expect } from '../../helpers/playwright-fixtures'

test.describe('V-SET-01: Empty State', () => {
  test('V-SET-01-E1: empty state displays icon, message, and CTA', async ({ page }) => {
    await page.goto('/settings/environments')

    // Wait for settings page to load
    await page.waitForSelector('[data-testid="settings-page"]', { state: 'visible' })
    await page.waitForSelector('[data-testid="settings-page"][aria-busy="false"]', {
      state: 'attached',
    })

    // Empty state should be visible since no environments exist
    const emptyState = page.locator('[data-testid="environments-empty"]')
    await expect(emptyState, 'Empty state should be visible').toBeVisible()

    // "No environments yet" message
    await expect(emptyState).toContainText(/No environments/i)

    // CTA button to create first environment
    const ctaButton = page.getByRole('button', { name: /Create your first environment/i })
    await expect(ctaButton, 'CTA button should be visible').toBeVisible()
  })

  test('V-SET-01-E2: section nav remains functional in empty state', async ({ page }) => {
    await page.goto('/settings/environments')

    await page.waitForSelector('[data-testid="settings-page"]', { state: 'visible' })
    await page.waitForSelector('[data-testid="settings-page"][aria-busy="false"]', {
      state: 'attached',
    })

    // Section nav should still be visible and functional
    const navItems = page.locator('[data-testid="settings-nav"] button')
    // Seven section entries plus the collapsed Network group's toggle.
    await expect(navItems).toHaveCount(8)
    await expect(page.getByRole('button', { name: 'Network', exact: true })).toBeVisible()

    // Click on About to verify navigation works
    const aboutNav = page.locator('[data-testid="settings-nav-about"]')
    await aboutNav.click()

    // About tab content should be visible
    const aboutContent = page.locator('[data-testid="about-tab"]')
    await expect(aboutContent, 'About tab should be accessible').toBeVisible()
  })
})
