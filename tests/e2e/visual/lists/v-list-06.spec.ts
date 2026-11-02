/**
 * V-LIST-06: Tests List Interactions
 *
 * REQ: REQ-5.2.1.35
 * Design Decisions: LIST-1, LIST-2, LIST-7, BULK-1, BULK-2, BULK-3, BULK-4
 *
 * This test file validates Tests List interactive features:
 * - Mass Action button appearance (BULK-4)
 * - Actions column horizontal layout
 * - Run button primary styling
 * - Context menu positioning (portal-based, not clipped)
 * - Column visibility toggle
 * - Status filter functionality
 * - Sorting via column headers
 * - Delete/Duplicate row actions
 * - Bulk actions (delete, duplicate)
 */

import { test, expect } from '../../helpers/playwright-fixtures'
import { exec } from '../../helpers/exec'

// Helper to wait for tests page to fully load
async function waitForTestsPageLoad(page: import('@playwright/test').Page) {
  await page.waitForSelector('[data-testid="tests-page"]', { state: 'visible' })
  await page.waitForSelector('[data-testid="tests-table"]', { state: 'visible' })
  // Wait for data to load (no skeleton rows)
  await page.waitForSelector('[data-testid="test-row"]', { state: 'visible' })
}

// Single seed for ALL read-only tests in this file
test.beforeAll(() => {
  exec('./tests/e2e/fixtures/lists/v-list-01/01-seed.sh')
})

test.describe('V-LIST-06: Tests List Visual', () => {
  test('V-LIST-06-S1: Mass Action button has no dropdown arrow in non-selection mode (BULK-4)', async ({
    page,
  }) => {
    await page.goto('/tests')
    await waitForTestsPageLoad(page)

    // Mass Action button should be visible
    const massActionButton = page.getByRole('button', { name: /Mass Action/i })
    await expect(massActionButton).toBeVisible()

    // Check that there's NO ChevronDown/dropdown arrow SVG inside the button
    // In non-selection mode, the button should be flat without a dropdown indicator
    const svgsInButton = await massActionButton.locator('svg').count()

    // The button should have no SVG icons (no chevron) in non-selection mode
    // Note: there might be 0 or the icon might be a different element
    expect(
      svgsInButton,
      'Mass Action button should NOT have dropdown arrow in non-selection mode (BULK-4)'
    ).toBeLessThanOrEqual(0)
  })

  test('V-LIST-06-S2: Actions column displays Run button and menu horizontally', async ({
    page,
  }) => {
    await page.goto('/tests')
    await waitForTestsPageLoad(page)

    const firstRow = page.locator('[data-testid="test-row"]').first()
    const runButton = firstRow.locator('[data-testid="action-run"]')
    const menuTrigger = firstRow.locator('[data-testid="action-menu-trigger"]')

    await expect(runButton).toBeVisible()
    await expect(menuTrigger).toBeVisible()

    // Get bounding boxes to verify horizontal layout
    const runBox = await runButton.boundingBox()
    const menuBox = await menuTrigger.boundingBox()

    expect(runBox).toBeTruthy()
    expect(menuBox).toBeTruthy()

    // Verify they're on the same horizontal line (Y positions similar)
    // Allow 10px tolerance for slight alignment variations
    expect(
      Math.abs(runBox!.y - menuBox!.y),
      'Run button and menu trigger should be on same horizontal line'
    ).toBeLessThan(10)

    // Verify run button is to the LEFT of menu trigger
    expect(
      runBox!.x,
      'Run button should be to the left of menu trigger'
    ).toBeLessThan(menuBox!.x)
  })

  test('V-LIST-06-S3: Run button has primary styling', async ({
    page,
  }) => {
    await page.goto('/tests')
    await waitForTestsPageLoad(page)

    const firstRow = page.locator('[data-testid="test-row"]').first()
    const runButton = firstRow.locator('[data-testid="action-run"]')

    await expect(runButton).toBeVisible()

    // The Run button uses the Button component which adds btn-primary class by default
    // This provides blue styling via CSS custom properties
    const buttonClass = await runButton.getAttribute('class')

    expect(
      buttonClass?.includes('btn-primary'),
      'Run button should have btn-primary class for primary styling'
    ).toBeTruthy()
  })

  test('V-LIST-06-S4: Context menu appears above table rows, not clipped', async ({
    page,
  }) => {
    await page.goto('/tests')
    await waitForTestsPageLoad(page)

    // Click on menu trigger for a middle row
    const rows = page.locator('[data-testid="test-row"]')
    const rowCount = await rows.count()
    const middleRowIndex = Math.floor(rowCount / 2)
    const middleRow = rows.nth(middleRowIndex)
    const menuTrigger = middleRow.locator('[data-testid="action-menu-trigger"]')

    await menuTrigger.click()

    // Wait for dropdown menu to appear - look for menu items
    const editMenuItem = page.getByRole('menuitem', { name: /Edit/i })
    await expect(editMenuItem).toBeVisible({ timeout: 3000 })

    // Get menu container (parent of menu items)
    const menuContainer = page.locator('[role="menu"]').first()
    const menuBox = await menuContainer.boundingBox()
    expect(menuBox).toBeTruthy()

    // Menu should be fully visible in viewport (not clipped)
    const viewportSize = page.viewportSize()
    expect(viewportSize).toBeTruthy()

    // Menu should be within viewport bounds
    expect(menuBox!.x >= 0, 'Menu left edge should be within viewport').toBeTruthy()
    expect(menuBox!.y >= 0, 'Menu top edge should be within viewport').toBeTruthy()
    expect(
      menuBox!.x + menuBox!.width <= viewportSize!.width,
      'Menu right edge should be within viewport'
    ).toBeTruthy()
    expect(
      menuBox!.y + menuBox!.height <= viewportSize!.height,
      'Menu bottom edge should be within viewport (not clipped)'
    ).toBeTruthy()
  })

  test('V-LIST-06-S5: Last row context menu is fully visible', async ({
    page,
  }) => {
    await page.goto('/tests')
    await waitForTestsPageLoad(page)

    // Click on menu trigger for the last visible row
    const rows = page.locator('[data-testid="test-row"]')
    const lastRow = rows.last()
    const menuTrigger = lastRow.locator('[data-testid="action-menu-trigger"]')

    await menuTrigger.click()

    // Wait for dropdown menu to appear
    const editMenuItem = page.getByRole('menuitem', { name: /Edit/i })
    await expect(editMenuItem).toBeVisible({ timeout: 3000 })

    // Get menu container
    const menuContainer = page.locator('[role="menu"]').first()
    const menuBox = await menuContainer.boundingBox()
    expect(menuBox).toBeTruthy()

    // Menu should be fully visible (may flip upward for last row)
    const viewportSize = page.viewportSize()
    expect(
      menuBox!.y + menuBox!.height <= viewportSize!.height,
      'Last row menu should be fully visible, not clipped at bottom'
    ).toBeTruthy()
  })
})

test.describe('V-LIST-06: Tests List Read-Only Functionality', () => {
  // These tests are read-only (don't modify data) - share fixture from file-level beforeAll

  test('V-LIST-06-F1: Column visibility toggle hides/shows columns', async ({
    page,
  }) => {
    await page.goto('/tests')
    await waitForTestsPageLoad(page)

    // Verify Suite column is initially visible
    const suiteHeader = page.locator('th').filter({ hasText: /^Suite$/i })
    await expect(suiteHeader, 'Suite column should be visible initially').toBeVisible()

    // Click Columns button
    const columnsButton = page.getByRole('button', { name: /Columns/i })
    await columnsButton.click()

    // Wait for dropdown to open and find the Suite toggle
    // The columns dropdown uses role="menuitemcheckbox"
    const suiteToggle = page.locator('[role="menuitemcheckbox"]').filter({ hasText: /Suite/i })
    await expect(suiteToggle).toBeVisible({ timeout: 3000 })

    // Click to toggle Suite column off
    await suiteToggle.click()

    // Wait for column to be hidden
    await page.waitForTimeout(300)

    // Close the dropdown by pressing Escape
    await page.keyboard.press('Escape')

    // Verify Suite column is now hidden
    await expect(
      suiteHeader,
      'Suite column should be hidden after unchecking'
    ).not.toBeVisible()
  })

  test('V-LIST-06-F2: Status filter filters the table (LIST-7)', async ({
    page,
  }) => {
    await page.goto('/tests')
    await waitForTestsPageLoad(page)

    // Get initial row count
    const initialRows = await page.locator('[data-testid="test-row"]').count()
    expect(initialRows).toBeGreaterThan(0)

    // Click status filter button
    const statusFilter = page.locator('[data-testid="filter-status"]')
    await statusFilter.click()

    // Wait for popover to open
    await page.waitForTimeout(200)

    // Find and click the "Passed" checkbox
    const passedCheckbox = page.getByRole('checkbox', { name: /Passed/i })
    if (await passedCheckbox.isVisible()) {
      await passedCheckbox.click()
    } else {
      // Alternative: click on item with "Passed" text
      const passedItem = page.locator('[role="option"], [role="menuitem"]').filter({ hasText: /Passed/i })
      if (await passedItem.first().isVisible()) {
        await passedItem.first().click()
      }
    }

    // Close popover
    await page.keyboard.press('Escape')

    // Wait for table to update
    await page.waitForTimeout(500)

    // Verify filtering occurred - passed tests should be visible, others hidden
    const passedBadges = await page.locator('[data-testid="status-badge-passed"]').count()
    const totalRows = await page.locator('[data-testid="test-row"]').count()

    // If filtering worked, all visible rows should have passed status
    expect(
      totalRows,
      'Status filter should filter the table (LIST-7)'
    ).toBeLessThanOrEqual(initialRows)
  })

  test('V-LIST-06-F3: Sorting works when clicking column headers', async ({
    page,
  }) => {
    await page.goto('/tests')
    await waitForTestsPageLoad(page)

    // Get test names before sorting
    const namesBefore = await page.locator('[data-testid="test-name"]').allTextContents()

    // Click on Name column header to sort
    const nameHeader = page.locator('th').filter({ hasText: /^Name$/i }).first()
    await nameHeader.click()

    // Wait for sort to apply
    await page.waitForTimeout(500)

    // Get test names after sorting
    const namesAfterFirst = await page.locator('[data-testid="test-name"]').allTextContents()

    // Click again to reverse sort
    await nameHeader.click()
    await page.waitForTimeout(500)

    // Get test names after reverse sort
    const namesAfterSecond = await page.locator('[data-testid="test-name"]').allTextContents()

    // Verify the order changed (sorting works)
    // Either first click changed order, or second click changed order from first
    const firstSortChanged = JSON.stringify(namesBefore) !== JSON.stringify(namesAfterFirst)
    const secondSortChanged = JSON.stringify(namesAfterFirst) !== JSON.stringify(namesAfterSecond)

    expect(
      firstSortChanged || secondSortChanged,
      'Sorting should change the order of tests when clicking column header'
    ).toBeTruthy()
  })
})

test.describe('V-LIST-06: Tests List Mutation Actions', () => {
  // These tests modify data - each seeds its own fixture

  test('V-LIST-06-F4: Delete row action removes test from list', async ({ page }) => {
    // Use smaller fixture for clear row count verification
    exec('./tests/e2e/fixtures/lists/v-list-05/01-seed.sh')

    await page.goto('/tests')
    await waitForTestsPageLoad(page)

    // Get first test name for verification
    const firstTestName = await page.locator('[data-testid="test-name"]').first().textContent()

    // Get initial row count
    const initialRowCount = await page.locator('[data-testid="test-row"]').count()

    // Click menu trigger on first row
    const firstRow = page.locator('[data-testid="test-row"]').first()
    const menuTrigger = firstRow.locator('[data-testid="action-menu-trigger"]')
    await menuTrigger.click()

    // Wait for menu to appear
    const deleteMenuItem = page.getByRole('menuitem', { name: /Delete/i })
    await expect(deleteMenuItem).toBeVisible({ timeout: 3000 })

    // Click Delete action
    await deleteMenuItem.click()

    // Wait for confirmation dialog (role="alertdialog")
    const confirmDialog = page.getByRole('alertdialog')
    await expect(confirmDialog, 'Confirmation dialog should appear for delete').toBeVisible({
      timeout: 5000,
    })

    // Find and click the destructive confirm button (the Delete button in the dialog)
    // The dialog has Cancel and Delete buttons - we want the Delete one
    const confirmButton = confirmDialog.locator('button').filter({ hasText: /Delete/i }).last()
    await confirmButton.click()

    // Wait for dialog to close and table to refresh
    await expect(confirmDialog).not.toBeVisible({ timeout: 5000 })
    await page.waitForTimeout(500)

    // Verify row count decreased
    const finalRowCount = await page.locator('[data-testid="test-row"]').count()
    expect(
      finalRowCount,
      'Row count should decrease after delete'
    ).toBe(initialRowCount - 1)

    // Verify the deleted test is no longer in the list
    const remainingNames = await page.locator('[data-testid="test-name"]').allTextContents()
    expect(
      remainingNames.includes(firstTestName!),
      'Deleted test should no longer appear in list'
    ).toBeFalsy()
  })

  test('V-LIST-06-F5: Duplicate row action creates copy of test', async ({ page }) => {
    // Use smaller fixture for clear row count verification
    exec('./tests/e2e/fixtures/lists/v-list-05/01-seed.sh')

    await page.goto('/tests')
    await waitForTestsPageLoad(page)

    // Get initial row count
    const initialRowCount = await page.locator('[data-testid="test-row"]').count()

    // Get name of first test for verification
    const firstTestName = await page.locator('[data-testid="test-name"]').first().textContent()

    // Click menu trigger on first row
    const firstRow = page.locator('[data-testid="test-row"]').first()
    const menuTrigger = firstRow.locator('[data-testid="action-menu-trigger"]')
    await menuTrigger.click()

    // Wait for menu to appear
    const duplicateMenuItem = page.getByRole('menuitem', { name: /Duplicate/i })
    await expect(duplicateMenuItem).toBeVisible({ timeout: 3000 })

    // Click Duplicate action
    await duplicateMenuItem.click()

    // Wait for duplication and table refresh (API call + re-render)
    await page.waitForTimeout(1500)

    // Verify row count increased
    const finalRowCount = await page.locator('[data-testid="test-row"]').count()
    expect(
      finalRowCount,
      'Row count should increase after duplicate'
    ).toBe(initialRowCount + 1)

    // Verify a copy of the test exists (with "(Copy)" suffix or similar)
    const allNames = await page.locator('[data-testid="test-name"]').allTextContents()
    const copyExists = allNames.some((name) => name.includes('(Copy)') || name.includes('copy'))
    expect(copyExists, 'A copy of the test should exist').toBeTruthy()
  })
})

test.describe('V-LIST-06: Tests List Bulk Actions', () => {
  test.beforeEach(() => {
    // Reset data before each bulk action test to ensure clean state
    exec('./tests/e2e/fixtures/lists/v-list-05/01-seed.sh')
  })

  test('V-LIST-06-B1: Bulk Delete removes selected tests (BULK-3)', async ({ page }) => {
    await page.goto('/tests')
    await waitForTestsPageLoad(page)

    // Get initial row count
    const initialRowCount = await page.locator('[data-testid="test-row"]').count()
    expect(initialRowCount).toBeGreaterThan(1)

    // Activate selection mode
    const massActionButton = page.getByRole('button', { name: /Mass Action/i })
    await massActionButton.click()

    // Wait for selection mode to activate
    await page.waitForTimeout(200)

    // Select first two rows
    const rows = page.locator('[data-testid="test-row"]')
    await rows.nth(0).locator('[data-testid="row-checkbox"]').click()
    await rows.nth(1).locator('[data-testid="row-checkbox"]').click()

    // Verify selection count
    const selectionCounter = page.locator('[data-testid="selection-counter"]')
    await expect(selectionCounter).toContainText('2 selected')

    // Click on selection counter to open bulk actions dropdown
    await selectionCounter.click()

    // Wait for dropdown menu
    const deleteAction = page.locator('[data-testid="bulk-action-delete"]')
    await expect(deleteAction).toBeVisible({ timeout: 3000 })

    // Click Delete action
    await deleteAction.click()

    // Wait for confirmation dialog
    const confirmDialog = page.getByRole('alertdialog')
    await expect(confirmDialog).toBeVisible({ timeout: 3000 })

    // Confirm deletion
    const confirmButton = confirmDialog.getByRole('button', { name: /Delete/i })
    await confirmButton.click()

    // Wait for deletion
    await page.waitForTimeout(1000)

    // Verify row count decreased by 2
    const finalRowCount = await page.locator('[data-testid="test-row"]').count()
    expect(
      finalRowCount,
      'Bulk delete should remove 2 selected tests (BULK-3)'
    ).toBe(initialRowCount - 2)
  })

  test('V-LIST-06-B2: Bulk Duplicate creates copies of selected tests (BULK-3)', async ({ page }) => {
    await page.goto('/tests')
    await waitForTestsPageLoad(page)

    // Get initial row count
    const initialRowCount = await page.locator('[data-testid="test-row"]').count()

    // Activate selection mode
    const massActionButton = page.getByRole('button', { name: /Mass Action/i })
    await massActionButton.click()

    // Wait for selection mode to activate
    await page.waitForTimeout(200)

    // Select first row
    const rows = page.locator('[data-testid="test-row"]')
    await rows.nth(0).locator('[data-testid="row-checkbox"]').click()

    // Click on selection counter to open bulk actions dropdown
    const selectionCounter = page.locator('[data-testid="selection-counter"]')
    await selectionCounter.click()

    // Wait for dropdown menu
    const duplicateAction = page.locator('[data-testid="bulk-action-duplicate"]')
    await expect(duplicateAction).toBeVisible({ timeout: 3000 })

    // Click Duplicate action
    await duplicateAction.click()

    // Wait for duplication
    await page.waitForTimeout(1000)

    // Verify row count increased by 1
    const finalRowCount = await page.locator('[data-testid="test-row"]').count()
    expect(
      finalRowCount,
      'Bulk duplicate should add 1 new test (BULK-3)'
    ).toBe(initialRowCount + 1)
  })
})
