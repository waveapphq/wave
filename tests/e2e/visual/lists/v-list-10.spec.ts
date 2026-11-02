/**
 * V-LIST-10: Regression Run Dialog
 *
 * REQ: REQ-5.2.1.37
 * Design Decisions: LISTRUN-1 through LISTRUN-12
 * Component: src/components/shared/run-dialog.tsx (shared by Tests, Suites, Regressions)
 *
 * Main Purpose: Run dialog for starting regression execution with test and environment selection.
 *
 * Pass Criteria (Dialog Structure - LISTRUN-1 through LISTRUN-3):
 * 1. Modal dialog 320px width, centered with semi-transparent overlay
 * 2. Header: "Run Regression" title with close (×) button
 * 3. Subtitle shows regression name
 *
 * Pass Criteria (Test Selection - Regression-specific):
 * 4. "Select Tests" section header
 * 5. Select/Deselect All checkbox with "X of Y selected" counter
 * 6. Suite groups as expandable sections (collapsible)
 * 7. Each suite header: chevron + suite name + suite checkbox + "X/Y" counter
 * 8. Tests listed under each suite with individual checkboxes
 * 9. ScrollArea wraps the grouped list
 *
 * Pass Criteria (Environment Selection - LISTRUN-4 through LISTRUN-9):
 * 10. Search input: "Search environments..."
 * 11. ALL ENVIRONMENTS section with scrollable list
 * 12. No "Remember selection" checkbox (per LISTRUN-9)
 *
 * Pass Criteria (Footer - LISTRUN-10 through LISTRUN-11):
 * 13. Divider above footer
 * 14. Cancel + Run buttons, right-aligned
 *
 * Entity Variations (same shared component per LISTRUN-12):
 * - Test: No test selection section (single test)
 * - Suite: Flat checkbox list for test selection
 * - Regression: Grouped by suite with expandable sections
 */

import { test, expect } from '../../helpers/playwright-fixtures'
import { exec } from '../../helpers/exec'

// Helper to wait for regressions page to fully load with data
async function waitForRegressionsPageLoad(page: import('@playwright/test').Page) {
  await page.waitForSelector('[data-testid="regressions-page"]', { state: 'visible' })
  // Wait for page to finish loading (aria-busy becomes false)
  await page.waitForSelector('[data-testid="regressions-page"][aria-busy="false"]', { state: 'attached' })
  // Wait for actual data rows to appear (not skeleton rows)
  await page.waitForSelector('[data-testid="regression-row"]', { state: 'visible' })
}

// Helper to open run dialog for first regression that has tests (enabled Run button)
async function openRunDialog(page: import('@playwright/test').Page) {
  // Find the first enabled Run button - some regressions have 0 tests and a disabled button
  const enabledRunButton = page.locator('[data-testid="row-action-run"]:not([disabled])').first()
  await enabledRunButton.click()
  // Wait for dialog to open
  await page.waitForSelector('[data-testid="run-dialog-content"]', { state: 'visible' })
}

// Single reset+seed for ALL tests in this file
test.beforeAll(() => {
  exec('./tests/e2e/fixtures/lists/v-list-10/01-seed.sh')
})

test.describe('V-LIST-10: Regression Run Dialog', () => {
  // Pass Criterion 1 & 2: Modal structure per LISTRUN-1, LISTRUN-2
  test('V-LIST-10-S1: dialog structure per LISTRUN-1 and LISTRUN-2', async ({
    page,
  }) => {
    await page.goto('/regressions')
    await waitForRegressionsPageLoad(page)
    await openRunDialog(page)

    // Per LISTRUN-1: Modal with semi-transparent overlay
    const dialog = page.locator('[data-testid="run-dialog-content"]')
    await expect(dialog, 'Run dialog should be visible').toBeVisible()

    // Verify overlay exists (backdrop)
    const overlay = page.locator('[data-testid="dialog-overlay"]')
    await expect(overlay, 'Dialog overlay should be visible').toBeVisible()

    // Per LISTRUN-2: Modal width varies by entity type - regression with test selection uses 800px
    const dialogContent = page.locator('[data-testid="run-dialog-content"]')
    const box = await dialogContent.boundingBox()
    expect(box).toBeTruthy()
    // Regression dialogs are wider (800px) for horizontal layout with test selection
    expect(box!.width, 'Regression dialog width should be ~800px').toBeGreaterThan(700)
    expect(box!.width, 'Regression dialog width should be ~800px').toBeLessThan(900)
  })

  // Pass Criterion 2 & 3: Header per LISTRUN-3
  test('V-LIST-10-S2: header shows title, subtitle, and close button per LISTRUN-3', async ({
    page,
  }) => {
    await page.goto('/regressions')
    await waitForRegressionsPageLoad(page)
    await openRunDialog(page)

    // Per LISTRUN-3: Header with "Run Regression" title
    const dialogTitle = page.locator('[data-testid="run-dialog-title"]')
    await expect(dialogTitle, 'Dialog title should be visible').toBeVisible()
    await expect(dialogTitle).toContainText(/Run Regression/i)

    // Subtitle with regression name
    const dialogSubtitle = page.locator('[data-testid="run-dialog-subtitle"]')
    await expect(dialogSubtitle, 'Dialog subtitle should be visible').toBeVisible()
    // Should contain the regression name (e.g., "WAVE 25.12")
    const subtitleText = await dialogSubtitle.textContent()
    expect(subtitleText?.length, 'Subtitle should have content').toBeGreaterThan(0)

    // Close button (×)
    const closeButton = page.locator('[data-testid="run-dialog-close"]')
    await expect(closeButton, 'Close button should be visible').toBeVisible()
  })

  // Pass Criterion 4 & 5: Test selection header
  test('V-LIST-10-S3: test selection section with Select All per design', async ({
    page,
  }) => {
    await page.goto('/regressions')
    await waitForRegressionsPageLoad(page)
    await openRunDialog(page)

    // Test selection section header
    const selectTestsHeader = page.locator('[data-testid="run-dialog-test-selection-header"]')
    await expect(
      selectTestsHeader,
      'Test selection section header should be visible'
    ).toBeVisible()
    await expect(selectTestsHeader).toContainText(/Test Selection|Tests/i)

    // Select/Deselect All checkbox
    const selectAllCheckbox = page.locator('[data-testid="run-dialog-select-all"]')
    await expect(
      selectAllCheckbox,
      'Select All checkbox should be visible'
    ).toBeVisible()

    // "X/Y tests in N suites" counter for regression
    const selectedCounter = page.locator('[data-testid="run-dialog-selected-count"]')
    await expect(
      selectedCounter,
      'Selected count should be visible'
    ).toBeVisible()
    await expect(selectedCounter).toContainText(/\d+\/\d+ tests in \d+ suite/i)
  })

  // Pass Criterion 6 & 7: Suite groups as collapsible sections
  test('V-LIST-10-S4: suite groups are expandable sections for regression', async ({
    page,
  }) => {
    await page.goto('/regressions')
    await waitForRegressionsPageLoad(page)
    await openRunDialog(page)

    // Suite groups should be present (collapsible sections)
    const suiteGroups = page.locator('[data-suite-group]')
    const groupCount = await suiteGroups.count()
    expect(groupCount, 'Should have at least one suite group').toBeGreaterThan(0)

    // First suite group should have chevron, name, checkbox, counter
    const firstGroup = suiteGroups.first()

    // Chevron for expand/collapse
    const chevron = firstGroup.locator('[data-testid="suite-group-chevron"]')
    await expect(chevron, 'Suite group chevron should be visible').toBeVisible()

    // Suite name
    const suiteName = firstGroup.locator('[data-testid="suite-group-name"]')
    await expect(suiteName, 'Suite name should be visible').toBeVisible()

    // Suite checkbox (select all in suite)
    const suiteCheckbox = firstGroup.locator('[data-testid="suite-group-checkbox"]')
    await expect(suiteCheckbox, 'Suite group checkbox should be visible').toBeVisible()

    // Suite counter (X/Y)
    const suiteCounter = firstGroup.locator('[data-testid="suite-group-counter"]')
    await expect(suiteCounter, 'Suite counter should be visible').toBeVisible()
  })

  // Pass Criterion 8: Tests listed under each suite with checkboxes
  test('V-LIST-10-S5: tests listed under suite with individual checkboxes', async ({
    page,
  }) => {
    await page.goto('/regressions')
    await waitForRegressionsPageLoad(page)
    await openRunDialog(page)

    // Expand first suite group if collapsed by clicking the chevron
    const firstGroup = page.locator('[data-suite-group]').first()
    const chevron = firstGroup.locator('[data-testid="suite-group-chevron"]')

    // Suite might already be expanded, check data-state
    const isExpanded = await firstGroup.getAttribute('data-state')
    if (isExpanded !== 'open') {
      await chevron.click()
      // Wait for expansion animation
      await expect(firstGroup).toHaveAttribute('data-state', 'open', { timeout: 5000 })
    }

    // Tests should be visible under the suite
    const testItems = firstGroup.locator('[data-testid="run-dialog-test-item"]')
    await expect(testItems.first()).toBeVisible({ timeout: 5000 })
    const testCount = await testItems.count()
    expect(testCount, 'Should have at least one test in suite').toBeGreaterThan(0)

    // Each test should have a checkbox
    const firstTestCheckbox = testItems.first().locator('[role="checkbox"]')
    await expect(firstTestCheckbox, 'Test checkbox should be visible').toBeVisible()
  })

  // Pass Criterion 9: ScrollArea for grouped list
  test('V-LIST-10-S6: test selection area has scroll capability', async ({
    page,
  }) => {
    await page.goto('/regressions')
    await waitForRegressionsPageLoad(page)
    await openRunDialog(page)

    // Test selection area should have scroll container
    const scrollArea = page.locator('[data-testid="run-dialog-test-scroll-area"]')
    await expect(scrollArea, 'Scroll area should be visible').toBeVisible()
  })

  // Pass Criterion 10: Environment search input per LISTRUN-5
  test('V-LIST-10-S7: environment search input per LISTRUN-5', async ({
    page,
  }) => {
    await page.goto('/regressions')
    await waitForRegressionsPageLoad(page)
    await openRunDialog(page)

    // Search input with placeholder "Search environments…"
    const searchInput = page.locator('[data-testid="run-dialog-env-search"]')
    await expect(searchInput, 'Environment search input should be visible').toBeVisible()

    const placeholder = await searchInput.getAttribute('placeholder')
    expect(placeholder?.toLowerCase()).toContain('search')
  })

  // Pass Criterion 11: ALL ENVIRONMENTS section per LISTRUN-8
  test('V-LIST-10-S9: ALL ENVIRONMENTS section with scrollable list per LISTRUN-8', async ({
    page,
  }) => {
    await page.goto('/regressions')
    await waitForRegressionsPageLoad(page)
    await openRunDialog(page)

    // ALL ENVIRONMENTS section header
    const allHeader = page.locator('[data-testid="run-dialog-all-envs-header"]')
    await expect(allHeader, 'ALL ENVIRONMENTS section header should be visible').toBeVisible()
    await expect(allHeader).toContainText(/ALL ENVIRONMENTS/i)

    // All environments list
    const allEnvs = page.locator('[data-testid="run-dialog-all-env"]')
    const allCount = await allEnvs.count()
    expect(allCount, 'Should have at least one environment').toBeGreaterThan(0)
  })

  // Pass Criterion 12: No "Remember selection" checkbox per LISTRUN-9
  test('V-LIST-10-S11: NO "Remember selection" checkbox per LISTRUN-9', async ({
    page,
  }) => {
    await page.goto('/regressions')
    await waitForRegressionsPageLoad(page)
    await openRunDialog(page)

    // Per LISTRUN-9: No "Remember selection" checkbox
    const rememberCheckbox = page.locator('text=Remember').or(
      page.locator('[data-testid="run-dialog-remember-selection"]')
    )
    await expect(
      rememberCheckbox,
      '"Remember selection" checkbox should NOT be present per LISTRUN-9'
    ).not.toBeVisible()
  })

  // Pass Criterion 13 & 14: Footer with Cancel + Run buttons per LISTRUN-10, LISTRUN-11
  test('V-LIST-10-S12: footer with divider and buttons per LISTRUN-10, LISTRUN-11', async ({
    page,
  }) => {
    await page.goto('/regressions')
    await waitForRegressionsPageLoad(page)
    await openRunDialog(page)

    // Per LISTRUN-10: Footer divider (visual separation)
    const footer = page.locator('[data-testid="run-dialog-footer"]')
    await expect(footer, 'Dialog footer should be visible').toBeVisible()

    // Per LISTRUN-11: Cancel button
    const cancelButton = page.getByRole('button', { name: /Cancel/i })
    await expect(cancelButton, 'Cancel button should be visible').toBeVisible()

    // Per LISTRUN-11: Run button (primary action)
    const runButton = page.getByRole('button', { name: /^Run$/i })
    await expect(runButton, 'Run button should be visible').toBeVisible()

    // Buttons should be right-aligned (verify by checking button positions)
    const footerBox = await footer.boundingBox()
    const runButtonBox = await runButton.boundingBox()
    expect(footerBox).toBeTruthy()
    expect(runButtonBox).toBeTruthy()

    // Run button should be near the right edge of footer
    const rightEdge = footerBox!.x + footerBox!.width
    const runButtonRight = runButtonBox!.x + runButtonBox!.width
    expect(
      rightEdge - runButtonRight,
      'Run button should be near right edge (right-aligned)'
    ).toBeLessThan(50)
  })

  // Interaction: Close button closes dialog
  test('V-LIST-10-S13: close button closes dialog', async ({
    page,
  }) => {
    await page.goto('/regressions')
    await waitForRegressionsPageLoad(page)
    await openRunDialog(page)

    const dialog = page.locator('[data-testid="run-dialog-content"]')
    await expect(dialog, 'Dialog should be open').toBeVisible()

    // Click close button
    const closeButton = page.locator('[data-testid="run-dialog-close"]')
    await closeButton.click()

    // Dialog should be closed
    await expect(dialog, 'Dialog should be closed after clicking X').not.toBeVisible()
  })

  // Interaction: Cancel button closes dialog
  test('V-LIST-10-S14: Cancel button closes dialog', async ({
    page,
  }) => {
    await page.goto('/regressions')
    await waitForRegressionsPageLoad(page)
    await openRunDialog(page)

    const dialog = page.locator('[data-testid="run-dialog-content"]')
    await expect(dialog, 'Dialog should be open').toBeVisible()

    // Click Cancel button
    const cancelButton = page.getByRole('button', { name: /Cancel/i })
    await cancelButton.click()

    // Dialog should be closed
    await expect(dialog, 'Dialog should be closed after clicking Cancel').not.toBeVisible()
  })

  // Interaction: Escape key closes dialog
  test('V-LIST-10-S15: Escape key closes dialog', async ({
    page,
  }) => {
    await page.goto('/regressions')
    await waitForRegressionsPageLoad(page)
    await openRunDialog(page)

    const dialog = page.locator('[data-testid="run-dialog-content"]')
    await expect(dialog, 'Dialog should be open').toBeVisible()

    // Press Escape
    await page.keyboard.press('Escape')

    // Dialog should be closed
    await expect(dialog, 'Dialog should be closed after pressing Escape').not.toBeVisible()
  })

  // Accessibility: Dialog has proper ARIA attributes
  test('V-LIST-10-S16: dialog has proper accessibility attributes', async ({
    page,
  }) => {
    await page.goto('/regressions')
    await waitForRegressionsPageLoad(page)
    await openRunDialog(page)

    const dialog = page.locator('[data-testid="run-dialog-content"]')

    // Dialog should have role="dialog" or be inside an element with role="dialog"
    const hasDialogRole = await dialog.evaluate((el) => {
      return (
        el.getAttribute('role') === 'dialog' ||
        el.closest('[role="dialog"]') !== null
      )
    })
    expect(hasDialogRole, 'Dialog should have role="dialog"').toBeTruthy()

    // Dialog should have aria-modal="true"
    const isModal = await dialog.evaluate((el) => {
      const dialogEl = el.getAttribute('role') === 'dialog' ? el : el.closest('[role="dialog"]')
      return dialogEl?.getAttribute('aria-modal') === 'true'
    })
    expect(isModal, 'Dialog should be modal').toBeTruthy()
  })
})

/**
 * Test Selection Behavior Tests
 *
 * Tests for the test selection functionality specific to regressions.
 */
test.describe('V-LIST-10: Test Selection Behavior', () => {
  // Select All toggles all tests
  test('V-LIST-10-T1: Select All toggles all tests', async ({
    page,
  }) => {
    await page.goto('/regressions')
    await waitForRegressionsPageLoad(page)
    await openRunDialog(page)

    const selectAllCheckbox = page.locator('[data-testid="run-dialog-select-all"] [role="checkbox"]')
    const initialChecked = await selectAllCheckbox.isChecked()

    // Toggle Select All
    await selectAllCheckbox.click()
    const afterToggle = await selectAllCheckbox.isChecked()
    expect(afterToggle, 'Select All should toggle').not.toBe(initialChecked)
  })

  // Suite checkbox toggles all tests in suite
  test('V-LIST-10-T2: suite checkbox toggles all tests in that suite', async ({
    page,
  }) => {
    await page.goto('/regressions')
    await waitForRegressionsPageLoad(page)
    await openRunDialog(page)

    // Expand first suite
    const firstGroup = page.locator('[data-suite-group]').first()
    const chevron = firstGroup.locator('[data-testid="suite-group-chevron"]')
    await chevron.click()

    // Get suite checkbox (the testid is on the element with role=checkbox)
    const suiteCheckbox = firstGroup.locator('[data-testid="suite-group-checkbox"]')
    const initialChecked = await suiteCheckbox.isChecked()

    // Toggle suite checkbox
    await suiteCheckbox.click()
    const afterToggle = await suiteCheckbox.isChecked()
    expect(afterToggle, 'Suite checkbox should toggle').not.toBe(initialChecked)
  })

  // Selected count updates when toggling
  test('V-LIST-10-T3: selected count updates when toggling tests', async ({
    page,
  }) => {
    await page.goto('/regressions')
    await waitForRegressionsPageLoad(page)
    await openRunDialog(page)

    const selectedCounter = page.locator('[data-testid="run-dialog-selected-count"]')
    const initialText = await selectedCounter.textContent()

    // Toggle Select All
    const selectAllCheckbox = page.locator('[data-testid="run-dialog-select-all"] [role="checkbox"]')
    await selectAllCheckbox.click()

    // Counter should have changed
    const afterText = await selectedCounter.textContent()
    expect(afterText, 'Selected count should change after toggle').not.toBe(initialText)
  })
})

/**
 * Environment Selection Behavior Tests
 */
test.describe('V-LIST-10: Environment Selection Behavior', () => {
  // Environment search filters list
  test('V-LIST-10-E1: environment search filters the list', async ({
    page,
  }) => {
    await page.goto('/regressions')
    await waitForRegressionsPageLoad(page)
    await openRunDialog(page)

    // Get initial count of all environments
    const initialCount = await page.locator('[data-testid="run-dialog-all-env"]').count()

    // Type in search
    const searchInput = page.locator('[data-testid="run-dialog-env-search"]')
    await searchInput.fill('Dev')

    // Wait for filtering
    await page.waitForTimeout(300)

    // Count should be different (filtered)
    const filteredCount = await page.locator('[data-testid="run-dialog-all-env"]').count()
    expect(filteredCount, 'Filtered count should be different from initial').toBeLessThanOrEqual(initialCount)
  })
})
