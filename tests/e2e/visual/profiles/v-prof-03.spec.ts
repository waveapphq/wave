/**
 * V-PROF-03: Profile Copy Values - Tag Search & Tooltip
 *
 * Environment copy: Profile values
 *
 * Design Decisions: PROFILE-44, PROFILE-45, PROFILE-46, PROFILE-48
 *
 * Pass Criteria:
 * 1. Copy Values modal shows Recommended section with tag match count (PROFILE-45)
 * 2. Tag match count badge shows "N tags match" text (PROFILE-46)
 * 3. Hovering tag match badge shows tooltip with matching tag names
 * 4. Other section shows environments with fewer matching tags (PROFILE-48)
 * 5. Search by tag name filters environments correctly (PROFILE-44)
 * 6. Tag search is case-insensitive (PROFILE-44)
 * 7. Empty search state shows appropriate message
 */

import { test, expect } from '../../helpers/playwright-fixtures'
import { exec } from '../../helpers/exec'

// Helper to wait for profiles page to load
async function waitForProfilesPageLoad(page: import('@playwright/test').Page) {
  await page.waitForSelector('[data-testid="profiles-page"]', { state: 'visible' })
  await page.waitForSelector('[data-testid="profiles-page"][aria-busy="false"]', {
    state: 'attached',
  })
}

// Helper to wait for modal to appear
async function waitForModal(page: import('@playwright/test').Page) {
  await page.waitForSelector('[role="dialog"]', { state: 'visible' })
}

// Helper to open Copy Values modal for the Database Config profile with Staging selected
async function openCopyValuesModal(page: import('@playwright/test').Page) {
  await page.goto('/profiles')
  await waitForProfilesPageLoad(page)
  await page.waitForSelector('[data-testid="profile-row"]', { state: 'visible' })

  // Click edit on "Database Config" profile
  const dbRow = page.locator('[data-testid="profile-row"]').filter({
    has: page.locator('[data-testid="profile-name"]', { hasText: 'Database Config' }),
  })
  await expect(dbRow, 'Database Config profile should exist in seed data').toBeVisible()
  await dbRow.locator('[data-testid="action-edit"]').click()
  await waitForModal(page)

  const modal = page.locator('[role="dialog"]').first()

  // Select Staging environment from the dropdown
  const envCombobox = modal.getByTestId('env-selector')
  await envCombobox.click()

  // Wait for popover dropdown to appear
  const envPopover = page.locator('[role="dialog"]').filter({
    has: page.locator('[role="listbox"]'),
  })
  await expect(envPopover).toBeVisible()

  // Click on Staging
  const stagingOption = envPopover.locator('[role="listbox"] button').filter({ hasText: 'Staging' })
  await stagingOption.click()

  // Click "Copy Values" button
  const copyBtn = modal.getByRole('button', { name: /Copy Values/i })
  await expect(copyBtn, 'Copy Values button should be enabled').toBeEnabled()
  await copyBtn.click()

  // Wait for the Copy Values modal to appear (it's a second dialog)
  await page.waitForSelector('text=Copy Values From', { state: 'visible' })
}

// Single seed for all tests in this file
test.beforeAll(() => {
  exec('./tests/e2e/fixtures/profiles/v-prof-03/01-seed.sh')
})

test.describe('V-PROF-03: Copy Values Tag Sections', () => {
  test('V-PROF-03-S1: Recommended section shows environment with highest tag match', async ({
    page,
  }) => {
    await openCopyValuesModal(page)

    // Per PROFILE-45: Recommended section with highest tag overlap
    const recommendedHeader = page.getByText('Recommended', { exact: false })
    await expect(
      recommendedHeader,
      'Recommended section header should be visible'
    ).toBeVisible()

    // Integration has 2 matching tags with Staging (testing, staging)
    // It should appear in the Recommended section
    const recommendedSection = page.locator('div').filter({ hasText: /^Recommended$/ }).first().locator('..')
    const integrationBtn = recommendedSection.locator('button', { hasText: 'Integration' })
    await expect(
      integrationBtn,
      'Integration should appear in Recommended section'
    ).toBeVisible()

    // Per PROFILE-46: Badge should show "2 tags match"
    const badge = integrationBtn.locator('span', { hasText: /2 tags match/ })
    await expect(badge, 'Integration badge should show "2 tags match"').toBeVisible()
  })

  test('V-PROF-03-S2: Other section shows environments with fewer tag matches', async ({
    page,
  }) => {
    await openCopyValuesModal(page)

    // Per PROFILE-48: Other section for remaining environments
    const otherHeader = page.getByText('Other', { exact: false })
    await expect(otherHeader, 'Other section header should be visible').toBeVisible()

    // QA has 1 match, Development 0, Production 0
    const otherSection = page.locator('div').filter({ hasText: /^Other$/ }).first().locator('..')

    const qaBtn = otherSection.locator('button', { hasText: 'QA' })
    await expect(qaBtn, 'QA should appear in Other section').toBeVisible()

    // QA badge: "1 tag matches"
    const qaBadge = qaBtn.locator('span', { hasText: /1 tag matches/ })
    await expect(qaBadge, 'QA badge should show "1 tag matches"').toBeVisible()

    // Development and Production should also be in Other with 0 tags match
    const devBtn = otherSection.locator('button', { hasText: 'Development' })
    await expect(devBtn, 'Development should appear in Other section').toBeVisible()

    const prodBtn = otherSection.locator('button', { hasText: 'Production' })
    await expect(prodBtn, 'Production should appear in Other section').toBeVisible()
  })

  test('V-PROF-03-S3: tag match badge tooltip shows matching tag names on hover', async ({
    page,
  }) => {
    await openCopyValuesModal(page)

    // Find the Recommended section's Integration badge
    const recommendedSection = page.locator('div').filter({ hasText: /^Recommended$/ }).first().locator('..')
    const integrationBadge = recommendedSection.locator('button', { hasText: 'Integration' })
      .locator('span', { hasText: /2 tags match/ })

    await expect(integrationBadge).toBeVisible()

    // Hover over badge to trigger tooltip
    await integrationBadge.hover()

    // Tooltip should appear with matching tag names
    const tooltip = page.locator('[role="tooltip"]')
    await expect(tooltip, 'Tooltip should appear on hover').toBeVisible({ timeout: 5000 })

    // Tooltip should contain the matching tag names: "testing" and "staging"
    await expect(tooltip, 'Tooltip should show "testing" tag').toContainText('testing')
    await expect(tooltip, 'Tooltip should show "staging" tag').toContainText('staging')
  })

  test('V-PROF-03-S4: Other section tag badge tooltip shows matching tags when count > 0', async ({
    page,
  }) => {
    await openCopyValuesModal(page)

    // Find QA in Other section - has 1 matching tag
    const otherSection = page.locator('div').filter({ hasText: /^Other$/ }).first().locator('..')
    const qaBadge = otherSection.locator('button', { hasText: 'QA' })
      .locator('span', { hasText: /1 tag matches/ })

    await expect(qaBadge).toBeVisible()

    // Hover to trigger tooltip
    await qaBadge.hover()

    const tooltip = page.locator('[role="tooltip"]')
    await expect(tooltip, 'Tooltip should appear on QA badge hover').toBeVisible({ timeout: 5000 })

    // QA shares "testing" tag with Staging
    await expect(tooltip, 'Tooltip should show "testing" tag').toContainText('testing')
  })
})

test.describe('V-PROF-03: Copy Values Tag Search (PROFILE-44)', () => {
  test('V-PROF-03-S5: search by tag name filters environments', async ({ page }) => {
    await openCopyValuesModal(page)

    // Scope to the Copy Values modal (second dialog)
    const copyModal = page.locator('[role="dialog"]').filter({ hasText: 'Copy Values From' })

    // Search for "qa" - should match QA environment by tag
    const searchInput = copyModal.getByPlaceholder(/Search environments/i)
    await searchInput.fill('qa')

    // QA should be visible (tag match)
    const qaItem = copyModal.locator('button', { hasText: 'QA' })
    await expect(qaItem, 'QA should be visible when searching "qa"').toBeVisible()

    // Integration should NOT be visible (no "qa" tag)
    const integrationItem = copyModal.locator('button', { hasText: 'Integration' })
    await expect(
      integrationItem,
      'Integration should be hidden when searching "qa"'
    ).not.toBeVisible()

    // Development should NOT be visible
    const devItem = copyModal.locator('button', { hasText: 'Development' })
    await expect(devItem, 'Development should be hidden').not.toBeVisible()
  })

  test('V-PROF-03-S6: tag search is case-insensitive', async ({ page }) => {
    await openCopyValuesModal(page)

    // Scope to the Copy Values modal (second dialog)
    const copyModal = page.locator('[role="dialog"]').filter({ hasText: 'Copy Values From' })

    // Search "TESTING" (uppercase) - should match environments tagged "testing"
    const searchInput = copyModal.getByPlaceholder(/Search environments/i)
    await searchInput.fill('TESTING')

    // Integration and QA both have "testing" tag
    const integrationItem = copyModal.locator('button', { hasText: 'Integration' })
    await expect(
      integrationItem,
      'Integration should be visible (has "testing" tag)'
    ).toBeVisible()

    const qaItem = copyModal.locator('button', { hasText: 'QA' })
    await expect(qaItem, 'QA should be visible (has "testing" tag)').toBeVisible()

    // Development and Production do NOT have "testing" tag
    const devItem = copyModal.locator('button', { hasText: 'Development' })
    await expect(devItem, 'Development should be hidden').not.toBeVisible()

    const prodItem = copyModal.locator('button', { hasText: 'Production' })
    await expect(prodItem, 'Production should be hidden').not.toBeVisible()
  })

  test('V-PROF-03-S7: empty search result shows message', async ({ page }) => {
    await openCopyValuesModal(page)

    const searchInput = page.getByPlaceholder(/Search environments/i)
    await searchInput.fill('zzznomatch')

    // Should show empty state message
    const emptyMessage = page.getByText('No environments match your search')
    await expect(
      emptyMessage,
      'Empty state message should appear for non-matching search'
    ).toBeVisible()
  })
})
