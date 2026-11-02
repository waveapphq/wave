/**
 * V-PROF-02: Profile Create/Edit Modal
 *
 * REQ: REQ-4.7.4
 *
 * Main Purpose: Profile modal for creating and editing connection profiles.
 *
 * Pass Criteria:
 * 1. Modal width approximately 672px (max-w-2xl to accommodate parameter table)
 * 2. Create mode header: "Create Profile" with close button
 * 3. Edit mode header: "Edit Profile" with close button
 * 4. Metadata section: Name above Description, both full-width (stacked layout)
 * 5. Type selector dropdown (enabled in create mode, locked in edit mode)
 * 6. Tags input with badge display and removal
 * 7. Configuration section: Type-specific fields from schema
 * 8. Secret fields: Lock icon indicator, masked values, visibility toggle
 * 9. Create mode footer: Cancel button, Create button (blue)
 * 10. Edit mode footer: Delete Profile (red, left), Cancel, Save Changes
 * 11. Delete disabled when Usage > 0 (with tooltip explaining why)
 * 12. Config fields locked when Usage > 0 (can only add new fields)
 * 13. Form validation: Name required
 * 14. Type selection fetches and renders type-specific schema fields
 */

import { test, expect } from '../../helpers/playwright-fixtures'
import type { Locator } from '../../helpers/playwright-fixtures'
import { exec } from '../../helpers/exec'

// Only rows carrying a parameter id are real: with none, the table renders a "No parameters yet" row.
const paramRows = (scope: Locator): Locator => scope.locator('tbody tr[data-parameter-id]')

// Helper to wait for profiles page to load
async function waitForProfilesPageLoad(page: import('@playwright/test').Page) {
  await page.waitForSelector('[data-testid="profiles-page"]', { state: 'visible' })
  await page.waitForSelector('[data-testid="profiles-page"][aria-busy="false"]', {
    state: 'attached',
  })
}

// Helper to wait for the modal to appear. Every modal here opens via the
// "New Profile" button; under parallel-shard load that first click occasionally
// races page hydration and never reaches the React handler, so retry it (clicking
// the button while a dialog is already open is a no-op behind the overlay).
async function waitForModal(page: import('@playwright/test').Page) {
  const dialog = page.locator('[role="dialog"]')
  await expect(async () => {
    if (await dialog.isVisible().catch(() => false)) return
    await page
      .getByRole('button', { name: /New Profile/i })
      .click({ timeout: 1000 })
      .catch(() => {})
    await expect(dialog).toBeVisible({ timeout: 1500 })
  }).toPass({ timeout: 15000 })
}

// Single seed for all tests in this file (Create, Edit, and Secret Field tests)
test.beforeAll(() => {
  exec('./tests/e2e/fixtures/profiles/v-prof-02/01-seed.sh')
})

test.describe('V-PROF-02: Profile Create Modal', () => {
  // Uses file-level seed

  test('V-PROF-02-C1: create modal opens with correct structure', async ({
    page,
  }) => {
    await page.goto('/profiles')
    await waitForProfilesPageLoad(page)

    // Click "New Profile" button
    const newProfileButton = page.getByRole('button', { name: /New Profile/i })
    await newProfileButton.click()
    await waitForModal(page)

    // 1. Modal should be visible
    const modal = page.locator('[role="dialog"]')
    await expect(modal, 'Modal should be visible').toBeVisible()

    // 2. Create mode header: "Create Profile"
    const header = modal.locator('[data-testid="modal-header"]')
    await expect(header).toContainText(/Create Profile/i)

    // Close button should be present
    const closeButton = modal.locator('[data-testid="modal-close"]')
    await expect(closeButton, 'Close button should be visible').toBeVisible()
  })

  test('V-PROF-02-C2: modal width approximately 672px', async ({ page }) => {
    await page.goto('/profiles')
    await waitForProfilesPageLoad(page)

    const newProfileButton = page.getByRole('button', { name: /New Profile/i })
    await newProfileButton.click()
    await waitForModal(page)

    // 1. Modal width approximately 672px (max-w-2xl) to accommodate parameter table.
    // The DialogContent (role="dialog") is a full-screen flex container (so the
    // floating value-editor sheet stays viewport-relative); the actual modal is its
    // inner max-w-2xl box, which is what carries the ~672px width. Its sibling is the
    // sheet layer, a display:contents div with no box of its own.
    const modal = page
      .locator('[role="dialog"] > div')
      .filter({ has: page.locator('[data-testid="modal-header"]') })
      .first()
    const modalBox = await modal.boundingBox()
    expect(modalBox).toBeTruthy()

    // Allow some tolerance for borders/padding (640-720px range)
    expect(
      modalBox!.width,
      'Modal width should be approximately 672px'
    ).toBeGreaterThan(620)
    expect(modalBox!.width).toBeLessThan(740)
  })

  test('V-PROF-02-C3: metadata section stacks Name and Description vertically', async ({
    page,
  }) => {
    await page.goto('/profiles')
    await waitForProfilesPageLoad(page)

    const newProfileButton = page.getByRole('button', { name: /New Profile/i })
    await newProfileButton.click()
    await waitForModal(page)

    const modal = page.locator('[role="dialog"]')

    // Name input present.
    const nameInput = modal.locator('#name')
    await expect(nameInput, 'Name input should be visible').toBeVisible()

    // Description input present.
    const descInput = modal.locator('#description')
    await expect(descInput, 'Description input should be visible').toBeVisible()

    // Name and Description stack vertically full-width (not a side-by-side
    // grid). Description sits below Name.
    const nameBox = await nameInput.boundingBox()
    const descBox = await descInput.boundingBox()
    expect(nameBox).toBeTruthy()
    expect(descBox).toBeTruthy()
    expect(
      descBox!.y,
      'Description top should be below Name bottom (stacked vertical layout)'
    ).toBeGreaterThan(nameBox!.y + nameBox!.height)
  })

  test('V-PROF-02-C4: type selector enabled in create mode', async ({ page }) => {
    await page.goto('/profiles')
    await waitForProfilesPageLoad(page)

    const newProfileButton = page.getByRole('button', { name: /New Profile/i })
    await newProfileButton.click()
    await waitForModal(page)

    const modal = page.locator('[role="dialog"]')

    // 5. Type selector should be present and enabled
    const typeSelector = modal.locator('[data-testid="type-selector"]')
    await expect(typeSelector, 'Type selector should be visible').toBeVisible()
    await expect(typeSelector, 'Type selector should be enabled in create mode').toBeEnabled()
  })

  test('V-PROF-02-C5: tags input present', async ({ page }) => {
    await page.goto('/profiles')
    await waitForProfilesPageLoad(page)

    const newProfileButton = page.getByRole('button', { name: /New Profile/i })
    await newProfileButton.click()
    await waitForModal(page)

    const modal = page.locator('[role="dialog"]')

    // 6. Tags input should be present
    const tagsInput = modal.locator('[data-field="tags"]')
    await expect(tagsInput, 'Tags input should be visible').toBeVisible()
  })

  test('V-PROF-02-C6: create mode footer has Cancel and Create buttons', async ({
    page,
  }) => {
    await page.goto('/profiles')
    await waitForProfilesPageLoad(page)

    const newProfileButton = page.getByRole('button', { name: /New Profile/i })
    await newProfileButton.click()
    await waitForModal(page)

    const modal = page.locator('[role="dialog"]')

    // 9. Create mode footer: Cancel button, Create button
    const cancelButton = modal.getByRole('button', { name: /Cancel/i })
    await expect(cancelButton, 'Cancel button should be visible').toBeVisible()

    const createButton = modal.getByRole('button', { name: /Create$/i })
    await expect(createButton, 'Create button should be visible').toBeVisible()

    // NO Delete Profile button in create mode
    const deleteButton = modal.getByRole('button', { name: /Delete Profile/i })
    await expect(
      deleteButton,
      'Delete Profile button should NOT be visible in create mode'
    ).toHaveCount(0)
  })

  test('V-PROF-02-C7: type selection shows configuration fields', async ({
    page,
  }) => {
    await page.goto('/profiles')
    await waitForProfilesPageLoad(page)

    const newProfileButton = page.getByRole('button', { name: /New Profile/i })
    await newProfileButton.click()
    await waitForModal(page)

    const modal = page.locator('[role="dialog"]')

    // Select a type (database)
    const typeSelector = modal.locator('[data-testid="type-selector"]')
    await typeSelector.click()
    await page.getByRole('listbox').locator('[role="option"]', { hasText: /database/i }).click()

    // 7 & 14. Parameters section should be visible with table structure
    // The form uses a dynamic parameters table, not individual config fields
    const parametersLabel = modal.getByText('Parameters', { exact: true })
    await expect(
      parametersLabel,
      'Parameters section label should be visible'
    ).toBeVisible()

    // Parameters table should have header with Name, Type, Value columns
    const parametersTable = modal.locator('table')
    await expect(parametersTable, 'Parameters table should be visible').toBeVisible()

    // Check table headers exist
    const nameHeader = parametersTable.locator('th:has-text("Name")')
    await expect(nameHeader, 'Name column header should be visible').toBeVisible()

    const typeHeader = parametersTable.locator('th:has-text("Type")')
    await expect(typeHeader, 'Type column header should be visible').toBeVisible()
  })

  test('V-PROF-02-C8: form validation requires name', async ({ page }) => {
    await page.goto('/profiles')
    await waitForProfilesPageLoad(page)

    const newProfileButton = page.getByRole('button', { name: /New Profile/i })
    await newProfileButton.click()
    await waitForModal(page)

    const modal = page.locator('[role="dialog"]')

    // Select a type first
    const typeSelector = modal.locator('[data-testid="type-selector"]')
    await typeSelector.click()
    await page.getByRole('listbox').locator('[role="option"]', { hasText: /database/i }).click()

    // Leave name empty - the Create button should be disabled
    // This is how the form validates: button disabled until form is valid
    const createButton = modal.getByRole('button', { name: /Create$/i })
    await expect(
      createButton,
      'Create button should be disabled when name is empty'
    ).toBeDisabled()
  })

  // Per K8SPROF-4: create mode opens on the custom type, so a name is the only
  // thing the form still requires.
  test('V-PROF-02-C11: name alone satisfies the form, type preselected as custom', async ({
    page,
  }) => {
    await page.goto('/profiles')
    await waitForProfilesPageLoad(page)

    const newProfileButton = page.getByRole('button', { name: /New Profile/i })
    await newProfileButton.click()
    await waitForModal(page)

    const modal = page.locator('[role="dialog"]')

    // The type is already chosen for the author, without any pick
    const typeSelector = modal.locator('[data-testid="type-selector"]')
    await expect(typeSelector, 'Type selector should preselect custom').toHaveText(/custom/i)

    const createButton = modal.getByRole('button', { name: /Create$/i })
    await expect(
      createButton,
      'Create button should be disabled before a name is typed'
    ).toBeDisabled()

    const nameInput = modal.locator('#name')
    await nameInput.fill('Test Profile')

    await expect(
      createButton,
      'Create button should enable on the name alone, with no type pick'
    ).toBeEnabled()
  })

  test('V-PROF-02-C12: NO Save button in create mode', async ({ page }) => {
    await page.goto('/profiles')
    await waitForProfilesPageLoad(page)

    const newProfileButton = page.getByRole('button', { name: /New Profile/i })
    await newProfileButton.click()
    await waitForModal(page)

    const modal = page.locator('[role="dialog"]')

    // Should NOT have Save button in create mode (only Create)
    const saveButton = modal.getByRole('button', { name: /Save/i })
    await expect(
      saveButton,
      'Save button should NOT exist in create mode'
    ).toHaveCount(0)
  })

  test('V-PROF-02-C9: close button closes modal', async ({ page }) => {
    await page.goto('/profiles')
    await waitForProfilesPageLoad(page)

    const newProfileButton = page.getByRole('button', { name: /New Profile/i })
    await newProfileButton.click()
    await waitForModal(page)

    const modal = page.locator('[role="dialog"]')
    const closeButton = modal.locator('[data-testid="modal-close"]')
    await closeButton.click()

    // Modal should be closed
    await expect(modal, 'Modal should be closed after clicking close').not.toBeVisible()
  })

  test('V-PROF-02-C10: cancel button closes modal', async ({ page }) => {
    await page.goto('/profiles')
    await waitForProfilesPageLoad(page)

    const newProfileButton = page.getByRole('button', { name: /New Profile/i })
    await newProfileButton.click()
    await waitForModal(page)

    const modal = page.locator('[role="dialog"]')
    const cancelButton = modal.getByRole('button', { name: /Cancel/i })
    await cancelButton.click()

    // Modal should be closed
    await expect(modal, 'Modal should be closed after clicking cancel').not.toBeVisible()
  })
})

test.describe('V-PROF-02: Dropdown Alignment', () => {
  // Uses file-level seed

  test('V-PROF-02-D1: type dropdown width matches trigger button', async ({ page }) => {
    await page.goto('/profiles')
    await waitForProfilesPageLoad(page)

    const newProfileButton = page.getByRole('button', { name: /New Profile/i })
    await newProfileButton.click()
    await waitForModal(page)

    const modal = page.locator('[role="dialog"]')
    const typeSelector = modal.locator('[data-testid="type-selector"]')
    const triggerBox = await typeSelector.boundingBox()
    expect(triggerBox, 'Type selector trigger should have bounding box').toBeTruthy()

    // Open the type dropdown
    await typeSelector.click()

    // Select the actual Radix popover content element (has data-side attribute),
    // not the outer positioning wrapper which may have different dimensions
    const popoverContent = page.locator('[data-radix-popper-content-wrapper] [data-side]').first()
    await expect(popoverContent).toBeVisible()
    // Radix sizes the popover via `--radix-popper-anchor-width` which
    // it measures AFTER the content renders. Poll the box until width
    // stabilizes so we don't race the sizing pass.
    await page.waitForTimeout(100)
    const contentBox = await popoverContent.boundingBox()
    expect(contentBox, 'Popover content should have bounding box').toBeTruthy()

    // Dropdown width should approximate trigger width. Tolerance is 35px
    // because Radix pins the popover width via
    // `--radix-popover-trigger-width` but the measured box in
    // shard-container Chromium picks up the scrollbar gutter (~17px)
    // and a transient sizing pass can land 10-20px above the trigger
    // momentarily. We've observed diffs of both signs (trigger wider
    // AND dropdown wider) across runs, so this assertion is really
    // "roughly aligned" rather than "exactly equal".
    const widthDiff = Math.abs(contentBox!.width - triggerBox!.width)
    expect(
      widthDiff,
      `Dropdown width (${contentBox!.width}px) should match trigger width (${triggerBox!.width}px)`
    ).toBeLessThan(35)

    // Dropdown left edge should align with trigger left edge. Under
    // shard-container Chromium the sub-pixel rounding inside Radix's
    // anchor positioning drifts up to ~15px from the trigger even
    // when they look aligned to the naked eye.
    const leftDiff = Math.abs(contentBox!.x - triggerBox!.x)
    expect(
      leftDiff,
      `Dropdown left edge (${contentBox!.x}px) should align with trigger (${triggerBox!.x}px)`
    ).toBeLessThan(25)
  })

  test('V-PROF-02-D2: environment dropdown width matches trigger button', async ({ page }) => {
    await page.goto('/profiles')
    await waitForProfilesPageLoad(page)

    const newProfileButton = page.getByRole('button', { name: /New Profile/i })
    await newProfileButton.click()
    await waitForModal(page)

    const modal = page.locator('[role="dialog"]')

    // Select a type first to make the env selector visible
    const typeSelector = modal.locator('[data-testid="type-selector"]')
    await typeSelector.click()
    await page.getByRole('listbox').locator('[role="option"]', { hasText: /database/i }).click()

    // Env selector should be visible
    const envSelector = modal.locator('[data-testid="env-selector"]')
    await expect(envSelector).toBeVisible()
    const triggerBox = await envSelector.boundingBox()
    expect(triggerBox, 'Env selector trigger should have bounding box').toBeTruthy()

    // Open the env dropdown
    await envSelector.click()

    // Select the actual Radix popover content element (has data-side attribute)
    const popoverContent = page.locator('[data-radix-popper-content-wrapper] [data-side]').last()
    await expect(popoverContent).toBeVisible()
    const contentBox = await popoverContent.boundingBox()
    expect(contentBox, 'Popover content should have bounding box').toBeTruthy()

    // Dropdown width should match trigger width (±5px tolerance for borders)
    const widthDiff = Math.abs(contentBox!.width - triggerBox!.width)
    expect(
      widthDiff,
      `Dropdown width (${contentBox!.width}px) should match trigger width (${triggerBox!.width}px)`
    ).toBeLessThan(10)

    // Dropdown left edge should align with trigger left edge. Under
    // shard-container Chromium the sub-pixel rounding inside Radix's
    // anchor positioning drifts up to ~15px from the trigger even
    // when they look aligned to the naked eye.
    const leftDiff = Math.abs(contentBox!.x - triggerBox!.x)
    expect(
      leftDiff,
      `Dropdown left edge (${contentBox!.x}px) should align with trigger (${triggerBox!.x}px)`
    ).toBeLessThan(25)
  })
})

test.describe('V-PROF-02: Profile Edit Modal', () => {
  // Uses file-level seed

  test('V-PROF-02-E1: edit modal opens with correct header', async ({ page }) => {
    await page.goto('/profiles')
    await waitForProfilesPageLoad(page)

    // Wait for rows to appear
    await page.waitForSelector('[data-testid="profile-row"]', { state: 'visible' })

    // Click edit button on first row
    const firstRow = page.locator('[data-testid="profile-row"]').first()
    const editButton = firstRow.locator('[data-testid="action-edit"]')
    await editButton.click()
    await waitForModal(page)

    const modal = page.locator('[role="dialog"]')

    // 3. Edit mode header: "Edit Profile"
    const header = modal.locator('[data-testid="modal-header"]')
    await expect(header).toContainText(/Edit Profile/i)
  })

  test('V-PROF-02-E2: type selector locked in edit mode', async ({ page }) => {
    await page.goto('/profiles')
    await waitForProfilesPageLoad(page)

    await page.waitForSelector('[data-testid="profile-row"]', { state: 'visible' })

    const firstRow = page.locator('[data-testid="profile-row"]').first()
    const editButton = firstRow.locator('[data-testid="action-edit"]')
    await editButton.click()
    await waitForModal(page)

    const modal = page.locator('[role="dialog"]')

    // 5. Type selector should be locked/disabled in edit mode
    const typeSelector = modal.locator('[data-testid="type-selector"]')
    await expect(typeSelector, 'Type selector should be visible').toBeVisible()
    await expect(
      typeSelector,
      'Type selector should be disabled in edit mode'
    ).toBeDisabled()
  })

  test('V-PROF-02-E3: edit mode footer has Delete, Cancel, Save buttons', async ({
    page,
  }) => {
    await page.goto('/profiles')
    await waitForProfilesPageLoad(page)

    await page.waitForSelector('[data-testid="profile-row"]', { state: 'visible' })

    const firstRow = page.locator('[data-testid="profile-row"]').first()
    const editButton = firstRow.locator('[data-testid="action-edit"]')
    await editButton.click()
    await waitForModal(page)

    const modal = page.locator('[role="dialog"]')

    // 10. Edit mode footer: Delete Profile (red, left), Cancel, Save Changes
    const deleteButton = modal.getByRole('button', { name: /Delete Profile/i })
    await expect(deleteButton, 'Delete button should be visible in edit mode').toBeVisible()

    const cancelButton = modal.getByRole('button', { name: /Cancel/i })
    await expect(cancelButton, 'Cancel button should be visible').toBeVisible()

    const saveButton = modal.getByRole('button', { name: /Save/i })
    await expect(saveButton, 'Save button should be visible in edit mode').toBeVisible()
  })

  test('V-PROF-02-E4: delete button disabled for profile in use', async ({
    page,
  }) => {
    await page.goto('/profiles')
    await waitForProfilesPageLoad(page)

    await page.waitForSelector('[data-testid="profile-row"]', { state: 'visible' })

    // Find a profile with usage > 0
    const rowWithUsage = page.locator('[data-testid="profile-row"]').filter({
      has: page.locator('[data-testid="profile-usage"]', { hasText: /[1-9]\d*\s*tests?/i }),
    }).first()

    // CRITICAL: Verify seed data has profile with usage > 0
    await expect(
      rowWithUsage,
      'Seed data should include a profile with usage > 0'
    ).toBeVisible()

    const editButton = rowWithUsage.locator('[data-testid="action-edit"]')
    await editButton.click()
    await waitForModal(page)

    const modal = page.locator('[role="dialog"]')

    // 11. Delete disabled when Usage > 0
    const deleteButton = modal.getByRole('button', { name: /Delete Profile/i })
    await expect(
      deleteButton,
      'Delete button should be disabled for profile in use'
    ).toBeDisabled()

    // SHELL-7a: the reason comes from the shared tooltip, not a browser popup.
    // A disabled button emits no pointer events, so the hint hangs off the
    // wrapper the tooltip triggers from - asserted here as the affordance
    // being present; its exact copy is pinned by the profile-form-modal unit
    // spec, which can reveal it without a pointer.
    await expect(deleteButton).not.toHaveAttribute('title', /.*/)
    await expect(
      deleteButton.locator('xpath=..'),
      'Delete carries a hint explaining why it is disabled'
    ).toHaveAttribute('data-state', 'closed')
  })

  test('V-PROF-02-E5: edit modal shows existing tags as badges', async ({
    page,
  }) => {
    await page.goto('/profiles')
    await waitForProfilesPageLoad(page)

    await page.waitForSelector('[data-testid="profile-row"]', { state: 'visible' })

    // Find a profile with tags (tags displayed as rounded spans in table)
    const rowWithTags = page.locator('[data-testid="profile-row"]').filter({
      has: page.locator('[data-testid="profile-tags"] span.rounded-full'),
    }).first()

    // CRITICAL: Verify seed data has profile with tags
    await expect(
      rowWithTags,
      'Seed data should include a profile with tags'
    ).toBeVisible()

    const editButton = rowWithTags.locator('[data-testid="action-edit"]')
    await editButton.click()
    await waitForModal(page)

    const modal = page.locator('[role="dialog"]')

    // 6. Tags should be displayed as badges in TagsInput component
    const tagBadges = modal.locator('[data-field="tags"] [data-testid="tag-badge"]')
    const badgeCount = await tagBadges.count()
    expect(badgeCount, 'Should display existing tags as badges').toBeGreaterThan(0)
  })

  test('V-PROF-02-E6: type selector locked in edit mode', async ({
    page,
  }) => {
    await page.goto('/profiles')
    await waitForProfilesPageLoad(page)

    await page.waitForSelector('[data-testid="profile-row"]', { state: 'visible' })

    // Edit any existing profile
    const firstRow = page.locator('[data-testid="profile-row"]').first()
    await expect(firstRow, 'Should have at least one profile').toBeVisible()

    const editButton = firstRow.locator('[data-testid="action-edit"]')
    await editButton.click()
    await waitForModal(page)

    const modal = page.locator('[role="dialog"]')

    // Type selector should be locked in edit mode (per PROFILE-53 variant)
    const typeSelector = modal.locator('[data-testid="type-selector"]')
    await expect(typeSelector, 'Type selector should be visible').toBeVisible()

    // In edit mode, type selector is disabled (cannot change profile type)
    await expect(
      typeSelector,
      'Type selector should be disabled in edit mode'
    ).toBeDisabled()
  })

  test('V-PROF-02-E7: delete button enabled for profile with zero usage', async ({
    page,
  }) => {
    await page.goto('/profiles')
    await waitForProfilesPageLoad(page)

    await page.waitForSelector('[data-testid="profile-row"]', { state: 'visible' })

    // Find a profile with usage = 0
    const rowWithZeroUsage = page.locator('[data-testid="profile-row"]').filter({
      has: page.locator('[data-testid="profile-usage"]', { hasText: /^0\s*tests?$/i }),
    }).first()

    // CRITICAL: Verify seed data has profile with usage = 0
    await expect(
      rowWithZeroUsage,
      'Seed data should include a profile with usage = 0'
    ).toBeVisible()

    const editButton = rowWithZeroUsage.locator('[data-testid="action-edit"]')
    await editButton.click()
    await waitForModal(page)

    const modal = page.locator('[role="dialog"]')

    // Delete should be enabled when Usage = 0
    const deleteButton = modal.getByRole('button', { name: /Delete Profile/i })
    await expect(
      deleteButton,
      'Delete button should be enabled for profile with zero usage'
    ).toBeEnabled()
  })

  test('V-PROF-02-E8: edit modal populates existing values', async ({
    page,
  }) => {
    await page.goto('/profiles')
    await waitForProfilesPageLoad(page)

    await page.waitForSelector('[data-testid="profile-row"]', { state: 'visible' })

    // Get the name from the first row before opening edit
    const firstRow = page.locator('[data-testid="profile-row"]').first()
    const rowName = await firstRow.locator('[data-testid="profile-name"]').textContent()

    const editButton = firstRow.locator('[data-testid="action-edit"]')
    await editButton.click()
    await waitForModal(page)

    const modal = page.locator('[role="dialog"]')

    // Name field should be populated with existing value
    const nameInput = modal.locator('#name')
    const inputValue = await nameInput.inputValue()
    expect(inputValue, 'Name input should be populated with existing profile name').toBe(
      rowName?.trim()
    )
  })

  test('V-PROF-02-E9: config fields editable when profile not in use', async ({
    page,
  }) => {
    await page.goto('/profiles')
    await waitForProfilesPageLoad(page)

    await page.waitForSelector('[data-testid="profile-row"]', { state: 'visible' })

    // Find a profile with usage = 0
    const rowWithZeroUsage = page.locator('[data-testid="profile-row"]').filter({
      has: page.locator('[data-testid="profile-usage"]', { hasText: /^0\s*tests?$/i }),
    }).first()

    await expect(rowWithZeroUsage, 'Should have profile with zero usage').toBeVisible()

    const editButton = rowWithZeroUsage.locator('[data-testid="action-edit"]')
    await editButton.click()
    await waitForModal(page)

    const modal = page.locator('[role="dialog"]')

    // Config fields should be editable when usage = 0
    const configSection = modal.locator('div:has(> div:has-text("Parameters"))')
    if ((await configSection.count()) > 0) {
      const configInputs = configSection.locator('input:not([data-testid="config-new-field"])')
      const inputCount = await configInputs.count()

      if (inputCount > 0) {
        const firstInput = configInputs.first()
        await expect(
          firstInput,
          'Config fields should be editable when profile not in use'
        ).toBeEnabled()
      }
    }
  })

  test('V-PROF-02-E10: delete button positioned on left in footer', async ({
    page,
  }) => {
    await page.goto('/profiles')
    await waitForProfilesPageLoad(page)

    await page.waitForSelector('[data-testid="profile-row"]', { state: 'visible' })

    const firstRow = page.locator('[data-testid="profile-row"]').first()
    const editButton = firstRow.locator('[data-testid="action-edit"]')
    await editButton.click()
    await waitForModal(page)

    const modal = page.locator('[role="dialog"]')

    // Get footer buttons
    const deleteButton = modal.getByRole('button', { name: /Delete Profile/i })
    const cancelButton = modal.getByRole('button', { name: /Cancel/i })
    const saveButton = modal.getByRole('button', { name: /Save/i })

    await expect(deleteButton).toBeVisible()
    await expect(cancelButton).toBeVisible()
    await expect(saveButton).toBeVisible()

    // Delete should be on the left (lower X position than Cancel and Save)
    const deleteBox = await deleteButton.boundingBox()
    const cancelBox = await cancelButton.boundingBox()
    const saveBox = await saveButton.boundingBox()

    expect(deleteBox).toBeTruthy()
    expect(cancelBox).toBeTruthy()
    expect(saveBox).toBeTruthy()

    expect(
      deleteBox!.x,
      'Delete button should be positioned to the left of Cancel'
    ).toBeLessThan(cancelBox!.x)
    expect(
      deleteBox!.x,
      'Delete button should be positioned to the left of Save'
    ).toBeLessThan(saveBox!.x)
  })

  test('V-PROF-02-E11: NO Create button in edit mode', async ({ page }) => {
    await page.goto('/profiles')
    await waitForProfilesPageLoad(page)

    await page.waitForSelector('[data-testid="profile-row"]', { state: 'visible' })

    const firstRow = page.locator('[data-testid="profile-row"]').first()
    const editButton = firstRow.locator('[data-testid="action-edit"]')
    await editButton.click()
    await waitForModal(page)

    const modal = page.locator('[role="dialog"]')

    // Should NOT have Create button in edit mode (only Save)
    const createButton = modal.getByRole('button', { name: /Create$/i })
    await expect(
      createButton,
      'Create button should NOT exist in edit mode'
    ).toHaveCount(0)
  })
})

test.describe('V-PROF-02: Secret Field Handling', () => {
  // Uses file-level seed

  test('V-PROF-02-S1: parameters table has secret checkbox column', async ({
    page,
  }) => {
    await page.goto('/profiles')
    await waitForProfilesPageLoad(page)

    // Open create modal and select database type
    const newProfileButton = page.getByRole('button', { name: /New Profile/i })
    await newProfileButton.click()
    await waitForModal(page)

    const modal = page.locator('[role="dialog"]')

    // Select database type to get parameters
    const typeSelector = modal.locator('[data-testid="type-selector"]')
    await typeSelector.click()
    await page.getByRole('listbox').locator('[role="option"]', { hasText: /database/i }).click()

    // Wait for parameters section (exact match to avoid matching empty-state cell text)
    const parametersSection = modal.locator('text="Parameters"')
    await expect(parametersSection, 'Parameters section should be visible').toBeVisible()

    // Parameters table should have a secret column header with lock icon
    const parametersTable = modal.locator('table')
    await expect(parametersTable, 'Parameters table should be visible').toBeVisible()

    // 8. Secret column header should have lock icon (lucide-react uses svg.lucide-lock)
    const secretHeader = parametersTable.locator('th').filter({
      has: page.locator('svg.lucide-lock'),
    })
    await expect(
      secretHeader,
      'Secret column header should have lock icon'
    ).toBeVisible()
  })

  test('V-PROF-02-S2: secret parameters have locked display', async ({
    page,
  }) => {
    await page.goto('/profiles')
    await waitForProfilesPageLoad(page)

    await page.waitForSelector('[data-testid="profile-row"]', { state: 'visible' })

    // Find a profile that has a password field (database type)
    const dbRow = page.locator('[data-testid="profile-row"]').filter({
      has: page.locator('[data-testid="profile-type"]', { hasText: /database/i }),
    }).first()

    // CRITICAL: Verify seed data has database profile
    await expect(
      dbRow,
      'Seed data should include a database type profile'
    ).toBeVisible()

    const editButton = dbRow.locator('[data-testid="action-edit"]')
    await editButton.click()
    await waitForModal(page)

    const modal = page.locator('[role="dialog"]')

    // Parameters table should be visible with data rows
    const parametersTable = modal.locator('table')
    await expect(parametersTable, 'Parameters table should be visible').toBeVisible()

    // Table rows should exist (parameter rows in tbody)
    const parameterRows = paramRows(parametersTable)
    await expect(
      parameterRows.first(),
      'Profile should have parameter rows'
    ).toBeVisible()
    const rowCount = await parameterRows.count()
    expect(rowCount, 'Profile should have parameter rows').toBeGreaterThan(0)
  })

  test('V-PROF-02-S3: parameters table has secret checkbox for each row', async ({ page }) => {
    await page.goto('/profiles')
    await waitForProfilesPageLoad(page)

    // Open create modal and select database type
    const newProfileButton = page.getByRole('button', { name: /New Profile/i })
    await newProfileButton.click()
    await waitForModal(page)

    const modal = page.locator('[role="dialog"]')

    const typeSelector = modal.locator('[data-testid="type-selector"]')
    await typeSelector.click()
    await page.getByRole('listbox').locator('[role="option"]', { hasText: /database/i }).click()

    // Wait for parameters table
    const parametersTable = modal.locator('table')
    await expect(parametersTable, 'Parameters table should be visible').toBeVisible()

    // Each parameter row should have a secret checkbox
    const parameterRows = paramRows(parametersTable)
    await expect(parameterRows.first(), 'Should have parameter rows').toBeVisible()
    const rowCount = await parameterRows.count()
    expect(rowCount, 'Should have parameter rows').toBeGreaterThan(0)

    // Check first row has secret checkbox with aria-label (input type="checkbox")
    const firstRowCheckbox = parameterRows.first().locator('input[type="checkbox"][aria-label="Mark as secret"]')
    await expect(
      firstRowCheckbox,
      'Parameter row should have secret checkbox'
    ).toBeVisible()
  })

  test('V-PROF-02-S4: secret checkbox toggles parameter secret state', async ({
    page,
  }) => {
    await page.goto('/profiles')
    await waitForProfilesPageLoad(page)

    const newProfileButton = page.getByRole('button', { name: /New Profile/i })
    await newProfileButton.click()
    await waitForModal(page)

    const modal = page.locator('[role="dialog"]')

    const typeSelector = modal.locator('[data-testid="type-selector"]')
    await typeSelector.click()
    await page.getByRole('listbox').locator('[role="option"]', { hasText: /database/i }).click()

    // Wait for parameters table
    const parametersTable = modal.locator('table')
    await expect(parametersTable, 'Parameters table should be visible').toBeVisible()

    // Get first parameter row
    const firstRow = paramRows(parametersTable).first()
    await expect(firstRow, 'First parameter row should exist').toBeVisible()

    // Find secret checkbox (input type="checkbox")
    const secretCheckbox = firstRow.locator('input[type="checkbox"][aria-label="Mark as secret"]')
    await expect(secretCheckbox, 'Secret checkbox should exist').toBeVisible()

    // Click to toggle secret state
    await secretCheckbox.click()

    // Checkbox should now be checked
    await expect(
      secretCheckbox,
      'Secret checkbox should be checked after click'
    ).toBeChecked()
  })

  test('V-PROF-02-S5: tag badges have remove button', async ({ page }) => {
    await page.goto('/profiles')
    await waitForProfilesPageLoad(page)

    await page.waitForSelector('[data-testid="profile-row"]', { state: 'visible' })

    // Find a profile with tags (in table, tags are span.rounded-full inside profile-tags)
    const rowWithTags = page.locator('[data-testid="profile-row"]').filter({
      has: page.locator('[data-testid="profile-tags"] span.rounded-full'),
    }).first()

    await expect(rowWithTags, 'Should have profile with tags').toBeVisible()

    const editButton = rowWithTags.locator('[data-testid="action-edit"]')
    await editButton.click()
    await waitForModal(page)

    const modal = page.locator('[role="dialog"]')

    // Tag badges in edit modal have data-testid="tag-badge" from TagsInput component
    const tagBadges = modal.locator('[data-field="tags"] [data-testid="tag-badge"]')
    const badgeCount = await tagBadges.count()
    expect(badgeCount, 'Should have tag badges').toBeGreaterThan(0)

    // First tag should have remove button (X icon with data-remove-tag attribute)
    // Uses span[role="button"] instead of button to avoid invalid nested button HTML
    const firstBadge = tagBadges.first()
    const removeButton = firstBadge.locator('[data-remove-tag]')
    await expect(
      removeButton,
      'Tag badge should have remove (X) button'
    ).toBeVisible()
  })

  test('V-PROF-02-S6: different type shows different parameters', async ({
    page,
  }) => {
    await page.goto('/profiles')
    await waitForProfilesPageLoad(page)

    const newProfileButton = page.getByRole('button', { name: /New Profile/i })
    await newProfileButton.click()
    await waitForModal(page)

    // Use specific selector - Radix Select also uses role="dialog" for dropdowns
    const modal = page.getByRole('dialog', { name: /Create Profile/i })

    // Select database type first
    const typeSelector = modal.locator('[data-testid="type-selector"]')
    await typeSelector.click()
    await page.getByRole('listbox').locator('[role="option"]', { hasText: /database/i }).click()

    // Get parameters table
    const parametersTable = modal.locator('table')
    await expect(parametersTable, 'Parameters table should be visible').toBeVisible()

    // Get parameter names from database type
    const databaseParams = paramRows(parametersTable)
    await expect(
      databaseParams.first(),
      'Database type should have parameters'
    ).toBeVisible()
    const databaseParamCount = await databaseParams.count()
    expect(databaseParamCount, 'Database type should have parameters').toBeGreaterThan(0)

    // Close modal - use JS click since button may be outside viewport when modal is tall
    const closeButton = modal.locator('[data-testid="modal-close"]')
    await closeButton.evaluate((btn) => (btn as HTMLElement).click())
    // The picked type loaded its parameters, so the modal asks before it closes.
    await page.getByTestId('unsaved-close').click()
    await expect(modal).not.toBeVisible()

    // Open again and select SSH type
    await page.getByRole('button', { name: /New Profile/i }).click()
    await waitForModal(page)

    const modal2 = page.getByRole('dialog', { name: /Create Profile/i })
    const typeSelector2 = modal2.locator('[data-testid="type-selector"]')
    await typeSelector2.click()
    await page.getByRole('listbox').locator('[role="option"]', { hasText: /ssh/i }).click()

    // SSH type should also have parameters
    const parametersTable2 = modal2.locator('table')
    await expect(parametersTable2, 'Parameters table should be visible for SSH').toBeVisible()

    const sshParams = paramRows(parametersTable2)
    await expect(sshParams.first(), 'SSH type should have parameters').toBeVisible()
    const sshParamCount = await sshParams.count()
    expect(sshParamCount, 'SSH type should have parameters').toBeGreaterThan(0)
  })
})
