/**
 * V-PROFILE-PARAMETER-NAME-VALIDATION: Parameter name field validates as Python identifier
 *
 * Phase: no-data (parallel) - opens the profile create dialog directly.
 * Parameter names (parameter-row.tsx) ARE Python variable names,
 * so they get NameField + the same validation as variable manager / output vars.
 *
 * Pass Criteria:
 *  1. Parameter name field has maxLength=64 (MAX_VARIABLE_NAME_LENGTH) and
 *     the standard counter (muted at >=80%, destructive at the cap).
 *  2. Typing `bad name` (with space) shows inline `Must start with letter/underscore...`.
 *  3. Typing `class` (Python keyword) shows inline `"class" is a Python keyword`.
 *  4. Typing `suite` (reserved namespace) shows inline reserved-namespace error.
 *  5. Adding two rows with the same valid name shows the duplicate error on
 *     the second row.
 *  6. A freshly added row with an empty name shows "Name is required" inline and
 *     blocks Create (an unnamed parameter is silently dropped on save, so an empty
 *     name blocks Save and surfaces inline).
 *  7. Typing a name with trailing whitespace (`myvar `) shows the inline
 *     whitespace error and disables the Create button (canSubmit gates on
 *     parameter validity).
 *  8. Typing a name with leading whitespace (` myvar`) shows the same error.
 */

import { test, expect, type Page } from '../../helpers/playwright-fixtures'
import { ensureEnvironment } from '../../helpers/config'
import { openProfileCreateDialog } from '../../helpers/profiles'

async function openProfileCreateAndAddParameter(page: Page) {
  const dialog = await openProfileCreateDialog(page)

  // Add a parameter row.
  await dialog.locator('[data-testid="add-parameter-btn"]').click()
  return dialog
}

function nameField(dialog: ReturnType<Page['locator']>, rowIndex = 0) {
  return dialog
    .locator('textarea[aria-label="Parameter name"]')
    .nth(rowIndex)
}

test.describe('V-PROFILE-PARAMETER-NAME-VALIDATION: profile parameter name follows variable rules', () => {
  test.beforeEach(async ({ page }) => {
    // Profile create dialog is gated on "at least one environment exists"
    // (use-profiles-actions.ts handleNewProfile). Seed the shared E2E env so
    // the click opens the modal instead of showing a warning toast.
    await ensureEnvironment(page.request)
    await page.goto('/')
    await page.evaluate(() => localStorage.clear())
  })

  test('S1: parameter name caps at 64 with destructive counter at the cap', async ({
    page,
  }) => {
    const dialog = await openProfileCreateAndAddParameter(page)
    const name = nameField(dialog)
    await expect(name).toBeVisible()
    await expect(name).toHaveAttribute('maxlength', '64')

    await name.fill('a'.repeat(70))
    expect((await name.inputValue()).length).toBe(64)

    const counter = dialog.locator('span[aria-live="polite"]').last()
    await expect(counter).toBeVisible()
    await expect(counter).toHaveAttribute('data-state', 'destructive')
    await expect(counter).toHaveText('64/64')
  })

  test('S2: invalid identifier (space) shows inline pattern error', async ({ page }) => {
    const dialog = await openProfileCreateAndAddParameter(page)
    const name = nameField(dialog)

    await name.fill('bad name')
    await expect(
      dialog.getByText(/letter\/underscore/i).first(),
    ).toBeVisible()
  })

  test('S3: Python keyword shows inline keyword error', async ({ page }) => {
    const dialog = await openProfileCreateAndAddParameter(page)
    const name = nameField(dialog)

    await name.fill('class')
    await expect(dialog.getByText(/Python keyword/i).first()).toBeVisible()
  })

  test('S4: reserved namespace name shows inline namespace error', async ({ page }) => {
    const dialog = await openProfileCreateAndAddParameter(page)
    const name = nameField(dialog)

    await name.fill('suite')
    await expect(
      dialog.getByText(/reserved for namespace access/i).first(),
    ).toBeVisible()
  })

  test('S5: two rows with the same valid name shows duplicate error on the second row', async ({
    page,
  }) => {
    const dialog = await openProfileCreateAndAddParameter(page)
    await nameField(dialog, 0).fill('shared_param')

    // Add a second parameter row.
    await dialog.locator('[data-testid="add-parameter-btn"]').click()
    await nameField(dialog, 1).fill('shared_param')

    await expect(
      dialog.getByText(/A variable with this name already exists/i).first(),
    ).toBeVisible()
  })

  test('S6: empty name shows "Name is required" on a fresh row and blocks Create', async ({
    page,
  }) => {
    const dialog = await openProfileCreateAndAddParameter(page)
    // An unnamed parameter is silently dropped on save (parametersToConfig skips
    // blank names), so an empty name surfaces "Name is required" inline AND
    // blocks Save (use-profile-form canSubmit).
    await expect(dialog.getByText(/Name is required/i).first()).toBeVisible()
    await expect(nameField(dialog)).toBeVisible()

    // With the required profile fields filled, Create is gated solely by the empty
    // parameter name; naming it clears the error and enables Create.
    await dialog.locator('#name').fill('required_name_profile')
    await dialog.locator('[data-testid="type-selector"]').click()
    await page.getByRole('listbox').locator('[role="option"]', { hasText: /^custom$/i }).click()
    await expect(dialog.getByRole('button', { name: /Create$/i })).toBeDisabled()

    await nameField(dialog).fill('named')
    await expect(dialog.getByText(/Name is required/i)).toHaveCount(0)
    await expect(dialog.getByRole('button', { name: /Create$/i })).toBeEnabled()
  })

  test('S7: trailing whitespace shows whitespace error and disables Create', async ({
    page,
  }) => {
    const dialog = await openProfileCreateAndAddParameter(page)

    // Fill required profile fields so Create is gated only by the parameter.
    await dialog.locator('#name').fill('whitespace_profile')
    await dialog.locator('[data-testid="type-selector"]').click()
    await page.getByRole('listbox').locator('[role="option"]', { hasText: /^custom$/i }).click()

    await nameField(dialog).fill('myvar ')
    await expect(
      dialog.getByText(/cannot have leading or trailing whitespace/i).first(),
    ).toBeVisible()

    await expect(
      dialog.getByRole('button', { name: /Create$/i }),
      'Create button should be disabled when a parameter name has trailing whitespace',
    ).toBeDisabled()

    // Removing the trailing space clears the error and re-enables Create.
    await nameField(dialog).fill('myvar')
    await expect(
      dialog.getByText(/cannot have leading or trailing whitespace/i),
    ).toHaveCount(0)
    await expect(
      dialog.getByRole('button', { name: /Create$/i }),
    ).toBeEnabled()
  })

  test('S8: leading whitespace shows whitespace error', async ({ page }) => {
    const dialog = await openProfileCreateAndAddParameter(page)

    await nameField(dialog).fill(' myvar')
    await expect(
      dialog.getByText(/cannot have leading or trailing whitespace/i).first(),
    ).toBeVisible()
  })
})
