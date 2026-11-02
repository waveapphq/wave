/**
 * V-SAVE-02: Close Confirmation Dialog
 *
 * Main Purpose: Verify Close button behavior and confirmation dialog
 * when canvas has unsaved changes.
 *
 * Pass Criteria:
 * 1. Close button disabled when canvas is clean (empty/no changes)
 * 2. Close button enabled when canvas is dirty (has changes)
 * 3. Clicking Close on dirty canvas shows confirmation dialog
 * 4. Dialog has "Unsaved Changes" title with warning icon
 * 5. Dialog has "Save and Close" and "Discard and Close" buttons
 * 6. "Save and Close" opens Save dialog, then resets canvas
 * 7. "Discard and Close" resets canvas immediately
 * 8. Both actions keep user in Workbench (URL remains /workbench)
 * 9. Both actions result in blank "Draft Workflow" canvas
 */

import { test, expect, type Page } from '../../helpers/playwright-fixtures'
import { mockInventedTestReads, waitForCanvasLoad } from '../../helpers/canvas'
import { BACKEND_PORT } from '../../helpers/config'

// Helper to add a block to make canvas dirty
async function addBlockToMakeCanvasDirty(page: Page): Promise<void> {
  // Expand palette
  const palette = page.locator('[data-testid="block-palette"]')
  const state = await palette.getAttribute('data-state')
  if (state === 'collapsed') {
    await page.locator('[data-testid="palette-expand-button"]').click()
    await expect(palette).toHaveAttribute('data-state', 'expanded')
  }

  // Search for HTTP Client and drag to canvas
  const searchInput = page.locator('[data-testid="palette-search-input"]')
  await searchInput.fill('http')
  await page.waitForTimeout(100)

  const httpClientItem = page.locator('[data-testid="palette-item-http-client"]')
  const canvas = page.locator('[data-testid="workflow-canvas"]')
  const canvasBox = await canvas.boundingBox()

  await httpClientItem.dragTo(canvas, {
    targetPosition: { x: canvasBox!.width / 2, y: canvasBox!.height / 2 },
  })
  await page.waitForTimeout(200)
}

test.describe('V-SAVE-02: Close Confirmation Dialog', () => {
  test.beforeEach(async ({ page }) => {
    // The saves below are answered by a route mock, so the id they hand back
    // does not exist on the server. Answer its reads too, or the post-save
    // re-read blocks the canvas.
    await mockInventedTestReads(page, ['test-123'])

    // Clear any backend execution session that might exist from parallel tests
    // This prevents session recovery from showing stale execution states
    await page.request.delete(`http://localhost:${BACKEND_PORT}/workbench/session`).catch(() => {
      // Ignore errors - session may not exist
    })

    // Reset storage to ensure clean state
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    await page.evaluate(() => localStorage.clear())
    // Navigate fresh
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
  })

  test('V-SAVE-02-S1: Close button disabled when canvas is clean', async ({
    page,
  }) => {
    // On empty canvas, Close button should be disabled
    const closeButton = page.locator('[data-testid="toolbar-close-button"]')
    await expect(closeButton, 'Close button should be visible').toBeVisible()
    await expect(closeButton, 'Close button should be disabled on clean canvas').toBeDisabled()
  })

  test('V-SAVE-02-S2: Close button enabled when canvas is dirty', async ({
    page,
  }) => {
    // Make canvas dirty
    await addBlockToMakeCanvasDirty(page)

    // Close button should now be enabled
    const closeButton = page.locator('[data-testid="toolbar-close-button"]')
    await expect(closeButton, 'Close button should be enabled when canvas is dirty').toBeEnabled()
  })

  test('V-SAVE-02-S3: clicking Close on dirty canvas shows confirmation dialog', async ({
    page,
  }) => {
    await addBlockToMakeCanvasDirty(page)

    const closeButton = page.locator('[data-testid="toolbar-close-button"]')
    await closeButton.click()

    // Dialog should appear
    const dialog = page.locator('[role="dialog"]')
    await expect(dialog, 'Close confirmation dialog should be visible').toBeVisible()
  })

  test('V-SAVE-02-S4: dialog has "Unsaved Changes" title', async ({ page }) => {
    await addBlockToMakeCanvasDirty(page)

    const closeButton = page.locator('[data-testid="toolbar-close-button"]')
    await closeButton.click()

    const dialog = page.locator('[role="dialog"]')
    await expect(dialog).toBeVisible()

    // Title should be "Unsaved Changes" (or "Unsaved Changes & Execution State" if running)
    const title = dialog.locator('h2')
    await expect(title).toHaveText(/^Unsaved Changes/)
  })

  test('V-SAVE-02-S5: dialog has warning icon', async ({ page }) => {
    await addBlockToMakeCanvasDirty(page)

    const closeButton = page.locator('[data-testid="toolbar-close-button"]')
    await closeButton.click()

    const dialog = page.locator('[role="dialog"]')
    await expect(dialog).toBeVisible()

    // Warning icon container should be present (rounded-full bg-warning/10)
    const warningIcon = dialog.locator('.bg-warning\\/10')
    await expect(warningIcon, 'Warning icon container should be visible').toBeVisible()
  })

  test('V-SAVE-02-S6: dialog has Save and Close and Discard and Close buttons', async ({
    page,
  }) => {
    await addBlockToMakeCanvasDirty(page)

    const closeButton = page.locator('[data-testid="toolbar-close-button"]')
    await closeButton.click()

    const dialog = page.locator('[role="dialog"]')
    await expect(dialog).toBeVisible()

    // "Save and Close" button
    const saveAndCloseButton = dialog.getByRole('button', { name: 'Save and Close' })
    await expect(saveAndCloseButton, 'Save and Close button should be visible').toBeVisible()

    // "Discard and Close" button
    const discardButton = dialog.getByRole('button', { name: 'Discard and Close' })
    await expect(discardButton, 'Discard and Close button should be visible').toBeVisible()
  })

  test('V-SAVE-02-S7: Save and Close opens Save dialog', async ({ page }) => {
    await addBlockToMakeCanvasDirty(page)

    const closeButton = page.locator('[data-testid="toolbar-close-button"]')
    await closeButton.click()

    const closeDialog = page.locator('[role="dialog"]')
    await expect(closeDialog).toBeVisible()

    // Click "Save and Close"
    const saveAndCloseButton = closeDialog.getByRole('button', { name: 'Save and Close' })
    await saveAndCloseButton.click()

    // Close confirmation dialog should close
    await expect(closeDialog.locator('h2').filter({ hasText: 'Unsaved Changes' })).not.toBeVisible()

    // Save dialog should open
    const saveDialog = page.getByRole('dialog', { name: 'New Test' })
    await expect(saveDialog).toBeVisible()

    // Save dialog should have "New Test" title
    const saveDialogTitle = saveDialog.locator('h2')
    await expect(saveDialogTitle).toHaveText('New Test')
  })

  test('V-SAVE-02-S8: Discard and Close resets canvas immediately', async ({
    page,
  }) => {
    await addBlockToMakeCanvasDirty(page)

    // Verify there are nodes on canvas
    const workflowNodes = page.locator('[data-testid^="workflow-node-"][data-nodetype]')
    await expect(workflowNodes).toHaveCount(1)

    const closeButton = page.locator('[data-testid="toolbar-close-button"]')
    await closeButton.click()

    const dialog = page.locator('[role="dialog"]')
    await expect(dialog).toBeVisible()

    // Click "Discard and Close"
    const discardButton = dialog.getByRole('button', { name: 'Discard and Close' })
    await discardButton.click()

    // Dialog should close
    await expect(dialog).not.toBeVisible()

    // Canvas should be empty (no workflow nodes)
    await expect(workflowNodes).toHaveCount(0)
  })

  test('V-SAVE-02-S9: Discard and Close keeps user in Workbench', async ({
    page,
  }) => {
    await addBlockToMakeCanvasDirty(page)

    const closeButton = page.locator('[data-testid="toolbar-close-button"]')
    await closeButton.click()

    const dialog = page.locator('[role="dialog"]')
    await expect(dialog).toBeVisible()

    // Click "Discard and Close"
    const discardButton = dialog.getByRole('button', { name: 'Discard and Close' })
    await discardButton.click()

    // URL should remain /workbench
    await expect(page).toHaveURL('/workbench')
  })

  test('V-SAVE-02-S10: Discard and Close shows "Draft Workflow" breadcrumb', async ({
    page,
  }) => {
    await addBlockToMakeCanvasDirty(page)

    const closeButton = page.locator('[data-testid="toolbar-close-button"]')
    await closeButton.click()

    const dialog = page.locator('[role="dialog"]')
    await expect(dialog).toBeVisible()

    // Click "Discard and Close"
    const discardButton = dialog.getByRole('button', { name: 'Discard and Close' })
    await discardButton.click()

    // Breadcrumb should show "Draft Workflow"
    const breadcrumb = page.locator('[data-testid="canvas-breadcrumb"]')
    await expect(breadcrumb).toContainText('Draft Workflow')
  })

  test('V-SAVE-02-S11: Save and Close flow results in blank canvas', async ({
    page,
  }) => {
    // Mock successful save
    await page.route('**/tests', async (route) => {
      if (route.request().method() === 'POST') {
        await route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify({
            data: {
              id: 'test-123',
              name: 'My Test',
              workflow: { nodes: [], edges: [] },
            },
          }),
        })
      } else {
        await route.continue()
      }
    })

    await addBlockToMakeCanvasDirty(page)

    // Verify there are nodes on canvas
    const workflowNodes = page.locator('[data-testid^="workflow-node-"][data-nodetype]')
    await expect(workflowNodes).toHaveCount(1)

    const closeButton = page.locator('[data-testid="toolbar-close-button"]')
    await closeButton.click()

    const closeDialog = page.locator('[role="dialog"]')
    await expect(closeDialog).toBeVisible()

    // Click "Save and Close"
    const saveAndCloseButton = closeDialog.getByRole('button', { name: 'Save and Close' })
    await saveAndCloseButton.click()

    // Wait for save dialog
    const saveDialog = page.getByRole('dialog', { name: 'New Test' })
    await expect(saveDialog.locator('h2').filter({ hasText: 'New Test' })).toBeVisible()

    // Fill name and save
    const nameInput = saveDialog.locator('#test-name')
    await nameInput.fill('My Test')
    const createButton = saveDialog.getByRole('button', { name: /Create Test|Save/i })
    await createButton.click()

    // Wait for dialog to close
    await expect(saveDialog).not.toBeVisible({ timeout: 5000 })

    // Canvas should be empty
    await expect(workflowNodes).toHaveCount(0)
  })

  test('V-SAVE-02-S12: Save and Close flow keeps user in Workbench', async ({
    page,
  }) => {
    // Mock successful save
    await page.route('**/tests', async (route) => {
      if (route.request().method() === 'POST') {
        await route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify({
            data: {
              id: 'test-123',
              name: 'My Test',
              workflow: { nodes: [], edges: [] },
            },
          }),
        })
      } else {
        await route.continue()
      }
    })

    await addBlockToMakeCanvasDirty(page)

    const closeButton = page.locator('[data-testid="toolbar-close-button"]')
    await closeButton.click()

    const closeDialog = page.locator('[role="dialog"]')
    const saveAndCloseButton = closeDialog.getByRole('button', { name: 'Save and Close' })
    await saveAndCloseButton.click()

    // Complete save
    const saveDialog = page.getByRole('dialog', { name: 'New Test' })
    const nameInput = saveDialog.locator('#test-name')
    await nameInput.fill('My Test')
    const createButton = saveDialog.getByRole('button', { name: /Create Test|Save/i })
    await createButton.click()

    // Wait for dialog to close
    await expect(saveDialog).not.toBeVisible({ timeout: 5000 })

    // URL should remain /workbench
    await expect(page).toHaveURL('/workbench')
  })

  test('V-SAVE-02-S13: Cancel button closes dialog', async ({ page }) => {
    await addBlockToMakeCanvasDirty(page)

    const closeButton = page.locator('[data-testid="toolbar-close-button"]')
    await closeButton.click()

    const dialog = page.locator('[role="dialog"]')
    await expect(dialog).toBeVisible()

    // Click Cancel button
    const cancelButton = dialog.getByRole('button', { name: 'Cancel' })
    await cancelButton.click()

    // Dialog should close
    await expect(dialog).not.toBeVisible()

    // Canvas should still have nodes (not discarded)
    const workflowNodes = page.locator('[data-testid^="workflow-node-"][data-nodetype]')
    await expect(workflowNodes).toHaveCount(1)
  })

  test('V-SAVE-02-S14: Escape key closes dialog', async ({ page }) => {
    await addBlockToMakeCanvasDirty(page)

    const closeButton = page.locator('[data-testid="toolbar-close-button"]')
    await closeButton.click()

    const dialog = page.locator('[role="dialog"]')
    await expect(dialog).toBeVisible()

    // Press Escape
    await page.keyboard.press('Escape')

    // Dialog should close
    await expect(dialog).not.toBeVisible()

    // Canvas should still have nodes (not discarded)
    const workflowNodes = page.locator('[data-testid^="workflow-node-"][data-nodetype]')
    await expect(workflowNodes).toHaveCount(1)
  })
})
