/**
 * V-SAVE-01: Save Test Dialog
 *
 * Main Purpose: Verify Save Test Dialog structure, fields, validation, and behavior
 * when saving a new workflow from the Workbench.
 *
 * Pass Criteria:
 * 1. Dialog opens when Save button is clicked
 * 2. Modal shows "New Test" title (Save mode) or "Edit Test" (Edit mode)
 * 3. Test name field is required with validation
 * 4. Description textarea is optional
 * 5. Tags field supports free-form input (Enter/comma to add, X to remove)
 * 6. Suite selector shows skeleton during load, then searchable dropdown
 * 7. Cancel and Save buttons in footer
 * 8. Save button shows spinner during save
 * 9. Validation errors display inline below fields
 * 10. API errors display in footer area
 * 11. After save, breadcrumbs update to show test name
 * 12. Duplicate name shows error message
 */

import { test, expect, type Page } from '../../helpers/playwright-fixtures'
import { mockInventedTestReads, waitForCanvasLoad } from '../../helpers/canvas'

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

test.describe('V-SAVE-01: Save Test Dialog', () => {
  test.beforeEach(async ({ page }) => {
    // The saves below are answered by a route mock, so the id they hand back
    // does not exist on the server. Answer its reads too, or the post-save
    // re-read blocks the canvas.
    await mockInventedTestReads(page, ['test-123'])
    // Reset storage to ensure clean state
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    await page.evaluate(() => localStorage.clear())
    // Navigate fresh
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
  })

  test('V-SAVE-01-S1: dialog opens when Save button is clicked on dirty canvas', async ({
    page,
  }) => {
    // Make canvas dirty by adding a block
    await addBlockToMakeCanvasDirty(page)

    // Save button should be enabled now
    const saveButton = page.locator('[data-testid="toolbar-save-button"]')
    await expect(saveButton).toBeEnabled()

    // Click Save button
    await saveButton.click()

    // Dialog should open
    const dialog = page.locator('[role="dialog"]')
    await expect(dialog, 'Save dialog should be visible').toBeVisible()
  })

  test('V-SAVE-01-S2: dialog shows "New Test" title for new workflow', async ({
    page,
  }) => {
    await addBlockToMakeCanvasDirty(page)

    const saveButton = page.locator('[data-testid="toolbar-save-button"]')
    await saveButton.click()

    const dialog = page.locator('[role="dialog"]')
    await expect(dialog).toBeVisible()

    // Title should be "New Test" for new workflow
    const title = dialog.locator('h2')
    await expect(title).toHaveText('New Test')
  })

  test('V-SAVE-01-S3: dialog has test name field (required)', async ({
    page,
  }) => {
    await addBlockToMakeCanvasDirty(page)

    const saveButton = page.locator('[data-testid="toolbar-save-button"]')
    await saveButton.click()

    const dialog = page.locator('[role="dialog"]')
    await expect(dialog).toBeVisible()

    // Name field with label
    const nameLabel = dialog.locator('label').filter({ hasText: 'Test Name' })
    await expect(nameLabel, 'Name label should be visible').toBeVisible()

    // Required indicator
    const requiredIndicator = nameLabel.locator('.text-destructive')
    await expect(requiredIndicator, 'Required asterisk should be visible').toBeVisible()

    // Name input
    const nameInput = dialog.locator('#test-name')
    await expect(nameInput, 'Name input should be visible').toBeVisible()
    await expect(nameInput, 'Name input should have placeholder').toHaveAttribute(
      'placeholder',
      'Enter test name…'
    )
  })

  test('V-SAVE-01-S4: dialog has description field (optional)', async ({
    page,
  }) => {
    await addBlockToMakeCanvasDirty(page)

    const saveButton = page.locator('[data-testid="toolbar-save-button"]')
    await saveButton.click()

    const dialog = page.locator('[role="dialog"]')
    await expect(dialog).toBeVisible()

    // Description label (no asterisk = optional)
    const descLabel = dialog.locator('label').filter({ hasText: 'Description' })
    await expect(descLabel, 'Description label should be visible').toBeVisible()

    // Should NOT have required indicator
    const requiredIndicator = descLabel.locator('.text-destructive')
    await expect(requiredIndicator, 'Description should not have required asterisk').not.toBeVisible()

    // Description textarea
    const descTextarea = dialog.locator('#test-description')
    await expect(descTextarea, 'Description textarea should be visible').toBeVisible()
    await expect(descTextarea).toHaveAttribute('placeholder', 'Enter description (optional)…')
  })

  test('V-SAVE-01-S5: dialog has tags input for free-form tags', async ({
    page,
  }) => {
    await addBlockToMakeCanvasDirty(page)

    const saveButton = page.locator('[data-testid="toolbar-save-button"]')
    await saveButton.click()

    const dialog = page.locator('[role="dialog"]')
    await expect(dialog).toBeVisible()

    // Tags label
    const tagsLabel = dialog.locator('label').filter({ hasText: 'Tags' })
    await expect(tagsLabel, 'Tags label should be visible').toBeVisible()

    // Tags input container
    const tagsInput = dialog.locator('[data-testid="tags-input"]')
    await expect(tagsInput, 'Tags input should be visible').toBeVisible()
  })

  test('V-SAVE-01-S6: tags can be added with Enter key', async ({ page }) => {
    await addBlockToMakeCanvasDirty(page)

    const saveButton = page.locator('[data-testid="toolbar-save-button"]')
    await saveButton.click()

    const dialog = page.locator('[role="dialog"]')
    await expect(dialog).toBeVisible()

    // Click tags trigger to open the popover
    await dialog.locator('[data-testid="tags-trigger"]').click()

    // Type in the popover's search input
    const tagInputField = page.locator('input[placeholder="Search tags…"]')
    await tagInputField.fill('api-test')
    await tagInputField.press('Enter')

    // Tag badge should appear on the trigger
    const tagBadge = dialog.locator('[data-testid="tag-badge"]').filter({ hasText: 'api-test' })
    await expect(tagBadge, 'Tag badge should be created').toBeVisible()
  })

  test('V-SAVE-01-S7: multiple tags can be added sequentially', async ({ page }) => {
    await addBlockToMakeCanvasDirty(page)

    const saveButton = page.locator('[data-testid="toolbar-save-button"]')
    await saveButton.click()

    const dialog = page.locator('[role="dialog"]')
    await expect(dialog).toBeVisible()

    // Click tags trigger to open the popover
    await dialog.locator('[data-testid="tags-trigger"]').click()

    // Add first tag via Enter
    const tagInputField = page.locator('input[placeholder="Search tags…"]')
    await tagInputField.fill('integration')
    await tagInputField.press('Enter')

    // First tag should appear
    const tag1 = dialog.locator('[data-testid="tag-badge"]').filter({ hasText: 'integration' })
    await expect(tag1, 'First tag badge should be created').toBeVisible()

    // Add second tag - popover should still be open
    await tagInputField.fill('smoke')
    await tagInputField.press('Enter')

    // Second tag should appear
    const tag2 = dialog.locator('[data-testid="tag-badge"]').filter({ hasText: 'smoke' })
    await expect(tag2, 'Second tag badge should be created').toBeVisible()
  })

  test('V-SAVE-01-S8: tags can be removed with X button', async ({ page }) => {
    await addBlockToMakeCanvasDirty(page)

    const saveButton = page.locator('[data-testid="toolbar-save-button"]')
    await saveButton.click()

    const dialog = page.locator('[role="dialog"]')
    await expect(dialog).toBeVisible()

    // Click tags trigger and add a tag
    await dialog.locator('[data-testid="tags-trigger"]').click()
    const tagInputField = page.locator('input[placeholder="Search tags…"]')
    await tagInputField.fill('removeme')
    await tagInputField.press('Enter')

    // Tag should exist
    const tagBadge = dialog.locator('[data-testid="tag-badge"]').filter({ hasText: 'removeme' })
    await expect(tagBadge).toBeVisible()

    // Click remove button on the tag
    const removeButton = tagBadge.locator('button')
    await removeButton.click()

    // Tag should be gone
    await expect(tagBadge).not.toBeVisible()
  })

  test('V-SAVE-01-S11: dialog has Cancel and Save buttons', async ({ page }) => {
    await addBlockToMakeCanvasDirty(page)

    const saveButton = page.locator('[data-testid="toolbar-save-button"]')
    await saveButton.click()

    const dialog = page.locator('[role="dialog"]')
    await expect(dialog).toBeVisible()

    // Cancel button
    const cancelButton = dialog.getByRole('button', { name: 'Cancel' })
    await expect(cancelButton, 'Cancel button should be visible').toBeVisible()

    // Save/Create button
    const createButton = dialog.getByRole('button', { name: /Create Test|Save/i })
    await expect(createButton, 'Create Test button should be visible').toBeVisible()
  })

  test('V-SAVE-01-S12: Cancel button closes dialog', async ({ page }) => {
    await addBlockToMakeCanvasDirty(page)

    const saveButton = page.locator('[data-testid="toolbar-save-button"]')
    await saveButton.click()

    const dialog = page.locator('[role="dialog"]')
    await expect(dialog).toBeVisible()

    // Click Cancel
    const cancelButton = dialog.getByRole('button', { name: 'Cancel' })
    await cancelButton.click()

    // Dialog should close
    await expect(dialog).not.toBeVisible()
  })

  test('V-SAVE-01-S13: name validation shows error when empty', async ({
    page,
  }) => {
    await addBlockToMakeCanvasDirty(page)

    const saveButton = page.locator('[data-testid="toolbar-save-button"]')
    await saveButton.click()

    const dialog = page.locator('[role="dialog"]')
    await expect(dialog).toBeVisible()

    // Click Create Test without entering name
    const createButton = dialog.getByRole('button', { name: /Create Test|Save/i })
    await createButton.click()

    // Error message should appear
    const errorMessage = dialog.locator('.text-destructive').filter({ hasText: /required/i })
    await expect(errorMessage, 'Name required error should be visible').toBeVisible()
  })

  test('V-SAVE-01-S14: Save button shows spinner during save', async ({
    page,
  }) => {
    // Mock the API to add delay
    await page.route('**/tests', async (route) => {
      if (route.request().method() === 'POST') {
        await new Promise((resolve) => setTimeout(resolve, 500))
        await route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify({
            data: {
              id: 'test-123',
              name: 'Test',
              workflow: { nodes: [], edges: [] },
            },
          }),
        })
      } else {
        await route.continue()
      }
    })

    await addBlockToMakeCanvasDirty(page)

    const saveButton = page.locator('[data-testid="toolbar-save-button"]')
    await saveButton.click()

    const dialog = page.locator('[role="dialog"]')
    await expect(dialog).toBeVisible()

    // Fill in name
    const nameInput = dialog.locator('#test-name')
    await nameInput.fill('My Test')

    // Click Create Test
    const createButton = dialog.getByRole('button', { name: /Create Test|Save/i })
    await createButton.click()

    // Spinner should appear
    const spinner = dialog.locator('[data-testid="save-spinner"]')
    await expect(spinner, 'Save spinner should be visible during save').toBeVisible()
  })

  test('V-SAVE-01-S15: Escape key closes dialog (when not saving)', async ({
    page,
  }) => {
    await addBlockToMakeCanvasDirty(page)

    const saveButton = page.locator('[data-testid="toolbar-save-button"]')
    await saveButton.click()

    const dialog = page.locator('[role="dialog"]')
    await expect(dialog).toBeVisible()

    // Press Escape
    await page.keyboard.press('Escape')

    // Dialog should close
    await expect(dialog).not.toBeVisible()
  })

  test('V-SAVE-01-S16: successful save closes dialog', async ({ page }) => {
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

    const saveButton = page.locator('[data-testid="toolbar-save-button"]')
    await saveButton.click()

    const dialog = page.locator('[role="dialog"]')
    await expect(dialog).toBeVisible()

    // Fill in name
    const nameInput = dialog.locator('#test-name')
    await nameInput.fill('My Test')

    // Click Create Test
    const createButton = dialog.getByRole('button', { name: /Create Test|Save/i })
    await createButton.click()

    // Dialog should close
    await expect(dialog).not.toBeVisible({ timeout: 5000 })
  })

  test('V-SAVE-01-S17: breadcrumbs update after successful save', async ({
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
              name: 'My Saved Test',
              workflow: { nodes: [], edges: [] },
            },
          }),
        })
      } else {
        await route.continue()
      }
    })

    // Before save, breadcrumbs show "Draft Workflow"
    const breadcrumb = page.locator('[data-testid="canvas-breadcrumb"]')
    await expect(breadcrumb).toContainText('Draft Workflow')

    await addBlockToMakeCanvasDirty(page)

    const saveButton = page.locator('[data-testid="toolbar-save-button"]')
    await saveButton.click()

    const dialog = page.locator('[role="dialog"]')
    await expect(dialog).toBeVisible()

    // Fill in name
    const nameInput = dialog.locator('#test-name')
    await nameInput.fill('My Saved Test')

    // Click Create Test
    const createButton = dialog.getByRole('button', { name: /Create Test|Save/i })
    await createButton.click()

    // Wait for dialog to close
    await expect(dialog).not.toBeVisible({ timeout: 5000 })

    // Breadcrumbs should now show test name
    await expect(breadcrumb).toContainText('My Saved Test')
  })

  test('V-SAVE-01-S18: duplicate name shows error', async ({ page }) => {
    // Mock API to return duplicate name error
    await page.route('**/tests', async (route) => {
      if (route.request().method() === 'POST') {
        await route.fulfill({
          status: 409,
          contentType: 'application/json',
          body: JSON.stringify({
            detail: "Test with name 'Existing Test' already exists",
          }),
        })
      } else {
        await route.continue()
      }
    })

    await addBlockToMakeCanvasDirty(page)

    const saveButton = page.locator('[data-testid="toolbar-save-button"]')
    await saveButton.click()

    const dialog = page.locator('[role="dialog"]')
    await expect(dialog).toBeVisible()

    // Fill in duplicate name
    const nameInput = dialog.locator('#test-name')
    await nameInput.fill('Existing Test')

    // Click Create Test
    const createButton = dialog.getByRole('button', { name: /Create Test|Save/i })
    await createButton.click()

    // Error should appear (inline or in footer)
    const errorText = dialog.locator('.text-destructive')
    await expect(
      errorText.filter({ hasText: /already exists/i }),
      'Duplicate name error should be visible'
    ).toBeVisible({ timeout: 5000 })
  })

  test('V-SAVE-01-S19: API error shows in footer', async ({ page }) => {
    // Mock API error
    await page.route('**/tests', async (route) => {
      if (route.request().method() === 'POST') {
        await route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({
            detail: 'Internal server error',
          }),
        })
      } else {
        await route.continue()
      }
    })

    await addBlockToMakeCanvasDirty(page)

    const saveButton = page.locator('[data-testid="toolbar-save-button"]')
    await saveButton.click()

    const dialog = page.locator('[role="dialog"]')
    await expect(dialog).toBeVisible()

    // Fill in name
    const nameInput = dialog.locator('#test-name')
    await nameInput.fill('Test Name')

    // Click Create Test
    const createButton = dialog.getByRole('button', { name: /Create Test|Save/i })
    await createButton.click()

    // API error should appear
    const apiError = dialog.locator('[data-testid="api-error"]')
    await expect(apiError, 'API error should be visible in footer').toBeVisible({ timeout: 5000 })
  })

  test('V-SAVE-01-S21: dialog accessible with aria attributes', async ({
    page,
  }) => {
    await addBlockToMakeCanvasDirty(page)

    const saveButton = page.locator('[data-testid="toolbar-save-button"]')
    await saveButton.click()

    const dialog = page.locator('[role="dialog"]')
    await expect(dialog).toBeVisible()

    // Check aria-modal
    await expect(dialog).toHaveAttribute('aria-modal', 'true')

    // Check aria-labelledby (title)
    const titleId = await dialog.getAttribute('aria-labelledby')
    expect(titleId, 'Dialog should have aria-labelledby').toBeTruthy()
  })

  test('V-SAVE-01-S22: name field has aria-invalid when error', async ({
    page,
  }) => {
    await addBlockToMakeCanvasDirty(page)

    const saveButton = page.locator('[data-testid="toolbar-save-button"]')
    await saveButton.click()

    const dialog = page.locator('[role="dialog"]')
    await expect(dialog).toBeVisible()

    // Click Create without name
    const createButton = dialog.getByRole('button', { name: /Create Test|Save/i })
    await createButton.click()

    // Name input should have aria-invalid
    const nameInput = dialog.locator('#test-name')
    await expect(nameInput).toHaveAttribute('aria-invalid', 'true')
  })
})
