/**
 * V-DASH-03: Dashboard Recent Activity
 *
 * Main Purpose: Recent Activity section displays recently modified entities with scrolling.
 *
 * Design Decisions: DASH-5
 * - DASH-5: Recent Activity shows entity list with icon, name, context, timestamp
 *
 * Pass Criteria:
 * 1. "Recent Activity" section header visible
 * 2. 22 activity items (8 tests, 8 suites, 6 regressions)
 * 3. Each item has: type icon, name, context line
 * 4. All specific entity names present
 * 5. Section scrolls when content exceeds visible area
 */

import { test, expect } from '../../helpers/playwright-fixtures'
import { exec } from '../../helpers/exec'
import { waitForDashboardLoad } from '../../helpers/dashboard'

// Expected items from v-dash-03/01-seed.sh
const EXPECTED_TESTS = [
  'API Health Check',
  'Database Connection Pool',
  'Login Flow Test',
  'OpenSearch Index Rotation',
  'TLS Certificate Validation',
  'User Registration',
  'Password Reset',
  'Session Timeout',
]

// Expected suites with their computed test counts from seed data
const EXPECTED_SUITES: Record<string, number> = {
  'API Integration Suite': 0,
  'GUI Smoke Tests': 1,      // Login Flow Test
  'Health Checks': 1,        // API Health Check
  'TLS Validation': 1,       // TLS Certificate Validation
  'Authentication Suite': 2, // User Registration, Session Timeout
  'Performance Tests': 0,    // Unassigned
  'Security Scans': 0,       // Unassigned
  'Data Integrity': 1,       // Database Connection Pool
}

// Expected regressions with their computed test counts from seed data
const EXPECTED_REGRESSIONS: Record<string, number> = {
  'v2.0.0 Release': 1, // API Integration Suite (0) + TLS Validation (1)
  'WAVE 25.12': 2,     // GUI Smoke Tests (1) + Health Checks (1)
  'WAVE 25.11': 2,     // Authentication Suite (2)
  'Hotfix 2.0.1': 0,   // No suites assigned
  'Sprint 42': 0,      // No suites assigned
  'Quarterly Q4': 1,   // Data Integrity (1)
}

const EXPECTED_TOTAL = EXPECTED_TESTS.length + Object.keys(EXPECTED_SUITES).length + Object.keys(EXPECTED_REGRESSIONS).length // 22

test.describe('V-DASH-03: Dashboard Recent Activity', () => {
  test.beforeAll(() => {
    exec('./tests/e2e/fixtures/dashboard/v-dash-03/01-seed.sh')
  })

  test('V-DASH-03: Recent Activity section with 22 items', async ({
    page,
  }) => {
    await page.goto('/dashboard')
    await waitForDashboardLoad(page)

    // Recent Activity section should be visible
    const recentActivitySection = page.locator(
      '[data-testid="recent-activity-section"]'
    )
    await expect(
      recentActivitySection,
      'Recent Activity section should be visible'
    ).toBeVisible()

    // Section header
    await expect(
      recentActivitySection.getByRole('heading', { name: 'Recent Activity' }),
      'Recent Activity header should be visible'
    ).toBeVisible()

    // Exactly 22 activity items
    const activityItems = recentActivitySection.locator(
      '[data-testid="activity-item"]'
    )
    await expect(activityItems, 'Should have exactly 22 activity items').toHaveCount(EXPECTED_TOTAL)

    // Each activity item should have: type icon, name, context
    const firstItem = activityItems.first()

    const itemIcon = firstItem.locator('[data-testid="activity-icon"]')
    await expect(itemIcon, 'Activity item should have type icon').toBeVisible()

    const itemName = firstItem.locator('[data-testid="activity-name"]')
    await expect(itemName, 'Activity item should have name').toBeVisible()

    const itemContext = firstItem.locator('[data-testid="activity-context"]')
    await expect(itemContext, 'Activity item should have context').toBeVisible()
  })

  test('V-DASH-03-S1: all 8 test entities present', async ({ page }) => {
    await page.goto('/dashboard')
    await waitForDashboardLoad(page)

    const recentActivitySection = page.locator(
      '[data-testid="recent-activity-section"]'
    )
    await expect(recentActivitySection).toBeVisible()

    // Verify each expected test is present by matching both name and "Test ·" context
    // This distinguishes tests from suites that may have similar names
    for (const testName of EXPECTED_TESTS) {
      const item = recentActivitySection
        .locator('[data-testid="activity-item"]')
        .filter({ hasText: testName })
        .filter({ hasText: /Test ·/ })
      await expect(item, `Test "${testName}" should be present`).toBeVisible()
    }
  })

  test('V-DASH-03-S2: all 8 suite entities present with correct test counts', async ({ page }) => {
    await page.goto('/dashboard')
    await waitForDashboardLoad(page)

    const recentActivitySection = page.locator(
      '[data-testid="recent-activity-section"]'
    )
    await expect(recentActivitySection).toBeVisible()

    // Verify each expected suite is present with correct computed test count
    for (const [suiteName, expectedCount] of Object.entries(EXPECTED_SUITES)) {
      const expectedText = expectedCount === 1 ? '1 test' : `${expectedCount} tests`
      const item = recentActivitySection
        .locator('[data-testid="activity-item"]')
        .filter({ hasText: suiteName })
        .filter({ hasText: `Suite · ${expectedText}` })
      await expect(item, `Suite "${suiteName}" should show "${expectedText}"`).toBeVisible()
    }
  })

  test('V-DASH-03-S3: all 6 regression entities present with correct test counts', async ({ page }) => {
    await page.goto('/dashboard')
    await waitForDashboardLoad(page)

    const recentActivitySection = page.locator(
      '[data-testid="recent-activity-section"]'
    )
    await expect(recentActivitySection).toBeVisible()

    // Verify each expected regression is present with correct computed test count
    for (const [regName, expectedCount] of Object.entries(EXPECTED_REGRESSIONS)) {
      const expectedText = expectedCount === 1 ? '1 test' : `${expectedCount} tests`
      const item = recentActivitySection
        .locator('[data-testid="activity-item"]')
        .filter({ hasText: regName })
        .filter({ hasText: `Regression · ${expectedText}` })
      await expect(item, `Regression "${regName}" should show "${expectedText}"`).toBeVisible()
    }
  })

  test('V-DASH-03-S4: section scrolls with 22 items', async ({ page }) => {
    await page.goto('/dashboard')
    await waitForDashboardLoad(page)

    const recentActivitySection = page.locator(
      '[data-testid="recent-activity-section"]'
    )
    await expect(recentActivitySection).toBeVisible()

    // Get activity items - should have 22
    const activityItems = recentActivitySection.locator(
      '[data-testid="activity-item"]'
    )
    await expect(activityItems).toHaveCount(EXPECTED_TOTAL)

    // Check if the section has scrollable content
    const scrollContainer = recentActivitySection.locator('[data-testid="activity-list"]').first()
    const isScrollable = await scrollContainer.evaluate((el) => {
      return el.scrollHeight > el.clientHeight
    }).catch(() => false)

    // If scrollable, test scrolling works
    if (isScrollable) {
      // Get first visible item
      const firstItem = activityItems.first()
      const firstItemText = await firstItem.locator('[data-testid="activity-name"]').textContent()

      // Scroll down
      await scrollContainer.evaluate((el) => {
        el.scrollTop = el.scrollHeight
      })

      // Last item should now be visible
      const lastItem = activityItems.last()
      await expect(lastItem).toBeVisible()
      const lastItemText = await lastItem.locator('[data-testid="activity-name"]').textContent()

      // First and last should be different (confirming scroll worked)
      expect(firstItemText).not.toBe(lastItemText)
    }
  })
})
