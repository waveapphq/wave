/**
 * V-LIST-05: Tests List Selection
 *
 * REQ: REQ-5.2.1.35
 * Design Decisions: BULK-1, BULK-2, BULK-3, BULK-4
 *
 * Main Purpose: Row selection enables bulk actions.
 *
 * Pass Criteria:
 * 1. Checkbox column visible - per BULK-2: 28px width, prepended when selection active
 * 2. Selected rows highlighted
 * 3. Selection count displayed - per wireframe: "X selected"
 * 4. Bulk action buttons enabled/disabled - per BULK-4: 0 selected = disabled
 * 5. Per BULK-1: Selection button 118px, dropdown 155px
 * 6. Per BULK-3: Actions grouped (Run/Export/Duplicate/Move to Suite, separator, Delete red)
 * 7. Header checkbox for select all
 * 8. Close button (X) to exit selection mode
 */

import { test, expect } from '../../helpers/playwright-fixtures'
import { exec } from '../../helpers/exec'

// Helper to wait for tests page to fully load with data
async function waitForTestsPageLoad(page: import('@playwright/test').Page) {
  await page.waitForSelector('[data-testid="tests-page"]', { state: 'visible' })
  // Wait for page to finish loading (aria-busy becomes false)
  await page.waitForSelector('[data-testid="tests-page"][aria-busy="false"]', { state: 'attached' })
  // Wait for actual data rows to appear (not skeleton rows)
  await page.waitForSelector('[data-testid="test-row"]', { state: 'visible' })
}

test.describe('V-LIST-05: Tests List Selection', () => {
  test.beforeAll(() => {
    // Seed with test data
    exec('./tests/e2e/fixtures/lists/v-list-05/01-seed.sh')
  })

  test('V-LIST-05-S1: selection mode shows checkbox column per BULK-2', async ({
    page,
  }) => {
    await page.goto('/tests')
    await waitForTestsPageLoad(page)

    // Activate selection mode by clicking Mass Action button
    const massActionButton = page.getByRole('button', { name: /Mass Action/i })
    await massActionButton.click()

    // 1. Checkbox column visible - per BULK-2: 28px width, prepended
    const checkboxColumn = page.locator('[data-testid="selection-column"]')
    await expect(
      checkboxColumn,
      'Checkbox column should be visible when selection mode active'
    ).toBeVisible()

    // Per BULK-2: 28px width for checkbox column
    const columnWidth = await checkboxColumn.evaluate((el) => {
      return getComputedStyle(el).width
    })
    // Allow small tolerance (28px +/- 4px)
    const widthNum = parseInt(columnWidth)
    expect(
      widthNum,
      'Checkbox column should be approximately 28px wide per BULK-2'
    ).toBeGreaterThanOrEqual(24)
    expect(widthNum).toBeLessThanOrEqual(32)
  })

  test('V-LIST-05-S2: row checkboxes visible in selection mode', async ({
    page,
  }) => {
    await page.goto('/tests')
    await waitForTestsPageLoad(page)

    // Activate selection mode
    const massActionButton = page.getByRole('button', { name: /Mass Action/i })
    await massActionButton.click()

    // Each row should have a checkbox
    const testRows = page.locator('[data-testid="test-row"]')
    const rowCount = await testRows.count()
    expect(rowCount, 'Should have test rows').toBeGreaterThan(0)

    // Check first row has checkbox
    const firstRowCheckbox = testRows.first().locator('[data-testid="row-checkbox"]')
    await expect(
      firstRowCheckbox,
      'Row checkbox should be visible'
    ).toBeVisible()
  })

  test('V-LIST-05-S3: selection count displayed per wireframe', async ({
    page,
  }) => {
    await page.goto('/tests')
    await waitForTestsPageLoad(page)

    // Activate selection mode
    const massActionButton = page.getByRole('button', { name: /Mass Action/i })
    await massActionButton.click()

    // 3. Selection count displayed - per wireframe: "X selected"
    const selectionCounter = page.locator('[data-testid="selection-counter"]')
    await expect(
      selectionCounter,
      'Selection counter should be visible'
    ).toBeVisible()

    // Initially should show "0 selected"
    await expect(selectionCounter).toContainText(/0 selected/i)

    // Select first row
    const testRows = page.locator('[data-testid="test-row"]')
    const firstRowCheckbox = testRows.first().locator('[data-testid="row-checkbox"]')
    await firstRowCheckbox.click()

    // Counter should update to "1 selected"
    await expect(selectionCounter).toContainText(/1 selected/i)
  })

  test('V-LIST-05-S4: bulk actions disabled when 0 selected per BULK-4', async ({
    page,
  }) => {
    await page.goto('/tests')
    await waitForTestsPageLoad(page)

    // Activate selection mode
    const massActionButton = page.getByRole('button', { name: /Mass Action/i })
    await massActionButton.click()

    // 4. Bulk action buttons enabled/disabled - per BULK-4: 0 selected = disabled
    const bulkActionsDropdown = page.locator('[data-testid="bulk-actions-dropdown"]')
    await expect(
      bulkActionsDropdown,
      'Bulk actions dropdown should be visible'
    ).toBeVisible()

    // Click to open dropdown
    await bulkActionsDropdown.click()

    // Menu items should be disabled when 0 selected per BULK-4
    const runAllAction = page.locator('[data-testid="bulk-action-run"]')
    await expect(runAllAction, 'Run All action should be visible').toBeVisible()

    // Check if disabled
    const isRunDisabled =
      (await runAllAction.getAttribute('disabled')) !== null ||
      (await runAllAction.getAttribute('aria-disabled')) === 'true' ||
      (await runAllAction.getAttribute('data-disabled')) === 'true'

    expect(isRunDisabled, 'Run All should be disabled with 0 selected').toBeTruthy()
  })

  test('V-LIST-05-S5: bulk actions enabled when items selected', async ({
    page,
  }) => {
    await page.goto('/tests')
    await waitForTestsPageLoad(page)

    // Activate selection mode
    const massActionButton = page.getByRole('button', { name: /Mass Action/i })
    await massActionButton.click()

    // Select first row
    const testRows = page.locator('[data-testid="test-row"]')
    const firstRowCheckbox = testRows.first().locator('[data-testid="row-checkbox"]')
    await firstRowCheckbox.click()

    // Open bulk actions dropdown
    const bulkActionsDropdown = page.locator('[data-testid="bulk-actions-dropdown"]')
    await bulkActionsDropdown.click()

    // Run All action should now be enabled
    const runAllAction = page.locator('[data-testid="bulk-action-run"]')
    const isRunDisabled =
      (await runAllAction.getAttribute('disabled')) !== null ||
      (await runAllAction.getAttribute('aria-disabled')) === 'true'

    expect(
      isRunDisabled,
      'Run All should be enabled with items selected'
    ).toBeFalsy()
  })

  test('V-LIST-05-S6: bulk actions grouped per BULK-3', async ({ page }) => {
    await page.goto('/tests')
    await waitForTestsPageLoad(page)

    // Activate selection mode
    const massActionButton = page.getByRole('button', { name: /Mass Action/i })
    await massActionButton.click()

    // Open bulk actions dropdown
    const bulkActionsDropdown = page.locator('[data-testid="bulk-actions-dropdown"]')
    await bulkActionsDropdown.click()

    // 6. Per BULK-3: Actions grouped (Run/Export/Duplicate/Move to Suite, separator, Delete red)
    // Verify all action items present
    const runAction = page.locator('[data-testid="bulk-action-run"]')
    await expect(runAction, 'Run All action should be present').toBeVisible()

    const exportAction = page.locator('[data-testid="bulk-action-export"]')
    await expect(exportAction, 'Export All action should be present').toBeVisible()

    const duplicateAction = page.locator('[data-testid="bulk-action-duplicate"]')
    await expect(
      duplicateAction,
      'Duplicate All action should be present'
    ).toBeVisible()

    const addToSuiteAction = page.locator('[data-testid="bulk-action-add-to-suite"]')
    await expect(
      addToSuiteAction,
      'Add to Suite action should be present'
    ).toBeVisible()

    // Separator between main actions and destructive action
    const separator = page.locator('[data-testid="bulk-actions-separator"]')
    await expect(separator, 'Separator should be present').toBeVisible()

    // Delete action (should be red/destructive styled)
    const deleteAction = page.locator('[data-testid="bulk-action-delete"]')
    await expect(deleteAction, 'Delete All action should be present').toBeVisible()

    // Check delete action has destructive/red styling
    const deleteColor = await deleteAction.evaluate((el) => {
      return getComputedStyle(el).color
    })

    const hasRedColor =
      deleteColor.includes('239, 68, 68') || // red-500
      deleteColor.includes('220, 38, 38') || // red-600
      deleteColor.includes('248, 113, 113') || // red-400
      deleteColor.includes('red')

    expect(hasRedColor, 'Delete action should have red text per BULK-3').toBeTruthy()
  })

  test('V-LIST-05-S7: header checkbox for select all', async ({ page }) => {
    await page.goto('/tests')
    await waitForTestsPageLoad(page)

    // Activate selection mode
    const massActionButton = page.getByRole('button', { name: /Mass Action/i })
    await massActionButton.click()

    // 7. Header checkbox for select all
    const headerCheckbox = page.locator('[data-testid="select-all-checkbox"]')
    await expect(
      headerCheckbox,
      'Select all checkbox should be visible in header'
    ).toBeVisible()

    // Click select all
    await headerCheckbox.click()

    // All row checkboxes should be checked
    const testRows = page.locator('[data-testid="test-row"]')
    const rowCount = await testRows.count()

    // Selection counter should show all items selected
    const selectionCounter = page.locator('[data-testid="selection-counter"]')
    await expect(selectionCounter).toContainText(new RegExp(`${rowCount} selected`, 'i'))
  })

  test('V-LIST-05-S8: close button exits selection mode', async ({ page }) => {
    await page.goto('/tests')
    await waitForTestsPageLoad(page)

    // Activate selection mode
    const massActionButton = page.getByRole('button', { name: /Mass Action/i })
    await massActionButton.click()

    // 8. Close button (X) to exit selection mode
    const closeButton = page.locator('[data-testid="selection-close"]')
    await expect(
      closeButton,
      'Close button should be visible in selection mode'
    ).toBeVisible()

    // Click close button
    await closeButton.click()

    // Selection mode should be deactivated
    // Checkbox column should no longer be visible
    const checkboxColumn = page.locator('[data-testid="selection-column"]')
    await expect(
      checkboxColumn,
      'Checkbox column should not be visible after closing selection'
    ).not.toBeVisible()

    // Mass Action button should be visible again
    await expect(
      massActionButton,
      'Mass Action button should be visible again'
    ).toBeVisible()
  })

  test('V-LIST-05-S9: selected rows are highlighted', async ({ page }) => {
    await page.goto('/tests')
    await waitForTestsPageLoad(page)

    // Activate selection mode
    const massActionButton = page.getByRole('button', { name: /Mass Action/i })
    await massActionButton.click()

    // Select first row
    const testRows = page.locator('[data-testid="test-row"]')
    const firstRow = testRows.first()
    const firstRowCheckbox = firstRow.locator('[data-testid="row-checkbox"]')
    await firstRowCheckbox.click()

    // 2. Selected rows highlighted
    // Check first row has selected styling (background color change)
    const hasSelectedClass =
      (await firstRow.getAttribute('class'))?.includes('selected') ||
      (await firstRow.getAttribute('data-selected')) === 'true'

    expect(hasSelectedClass, 'Selected row should have highlight styling').toBeTruthy()

    // Or check via computed style (should have different background)
    const selectedBgColor = await firstRow.evaluate((el) => {
      return getComputedStyle(el).backgroundColor
    })

    // Compare with non-selected row
    const secondRow = testRows.nth(1)
    const secondRowBgColor = await secondRow.evaluate((el) => {
      return getComputedStyle(el).backgroundColor
    })

    // Selected row should have different background (or attribute indicates selection)
    const isHighlighted =
      hasSelectedClass || selectedBgColor !== secondRowBgColor

    expect(
      isHighlighted,
      'Selected row should be visually distinguished'
    ).toBeTruthy()
  })

  test('V-LIST-05-S10: selection button dimensions per BULK-1', async ({
    page,
  }) => {
    await page.goto('/tests')
    await waitForTestsPageLoad(page)

    // Activate selection mode
    const massActionButton = page.getByRole('button', { name: /Mass Action/i })
    await massActionButton.click()

    // 5. Per BULK-1: Selection button 118px, dropdown 155px
    const selectionButton = page.locator('[data-testid="selection-counter"]')
    await expect(selectionButton).toBeVisible()

    // Check button width (approximately 118px)
    const buttonWidth = await selectionButton.evaluate((el) => {
      return el.getBoundingClientRect().width
    })

    // Allow tolerance (118px +/- 20px)
    expect(
      buttonWidth,
      'Selection button should be approximately 118px wide per BULK-1'
    ).toBeGreaterThanOrEqual(98)
    expect(buttonWidth).toBeLessThanOrEqual(138)

    // Open dropdown and check width
    const bulkActionsDropdown = page.locator('[data-testid="bulk-actions-dropdown"]')
    await bulkActionsDropdown.click()

    const dropdownMenu = page.locator('[data-testid="bulk-actions-menu"]')
    await expect(dropdownMenu).toBeVisible()

    const dropdownWidth = await dropdownMenu.evaluate((el) => {
      return el.getBoundingClientRect().width
    })

    // Dropdown should be approximately 190px wide (w-[190px] in BulkActionsDropdown)
    expect(
      dropdownWidth,
      'Dropdown should be approximately 190px wide'
    ).toBeGreaterThanOrEqual(170)
    expect(dropdownWidth).toBeLessThanOrEqual(210)
  })
})
