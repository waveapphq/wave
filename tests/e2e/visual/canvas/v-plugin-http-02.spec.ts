/**
 * V-PLUGIN-HTTP-02: Profile Binding End-to-End Execution
 *
 * Pass Criteria:
 * 1. Custom profile can be bound to HTTP plugin node
 * 2. Profile alias appears in autocomplete as a top-level variable
 * 3. Typing alias + "." shows profile field sub-completions
 * 4. Expression alias.field resolves at runtime
 * 5. HTTP plugin executes successfully using resolved profile URL
 *
 * Seed: 1 environment, 1 custom profile (url=localhost/health), 1 test with HTTP node
 */

import { test, expect } from '../../helpers/playwright-fixtures'
import { waitForCanvasLoad, waitForCanvasToolbar } from '../../helpers/canvas'
import { exec } from '../../helpers/exec'
import { BACKEND_PORT } from '../../helpers/config'
import { configSheet } from '../../helpers/workbench'

const TEST_ID = 'ab020003-0003-0003-0003-000000000003'
const PROFILE_ID = 'ab020002-0002-0002-0002-000000000002'

test.describe('V-PLUGIN-HTTP-02: Profile Binding E2E', () => {
  test.beforeAll(() => {
    exec('chmod +x ./tests/e2e/fixtures/canvas/v-plugin-http-02/01-seed.sh')
    exec('./tests/e2e/fixtures/canvas/v-plugin-http-02/01-seed.sh')
  })

  test('V-PLUGIN-HTTP-02-S1: bind custom profile, verify autocomplete, run test', async ({
    page,
  }) => {
    // ===== Setup: Load the seeded test =====
    await page.request
      .delete(`http://localhost:${BACKEND_PORT}/workbench/session`)
      .catch(() => {})
    await page.goto('/workbench')
    await page.evaluate(() => localStorage.clear())
    await page.goto(`/workbench?editTest=${TEST_ID}`)
    await waitForCanvasLoad(page)
    await waitForCanvasToolbar(page)

    // Wait for the HTTP node to render
    await expect(
      page.locator('[data-testid="workflow-node-http-node-1"]')
    ).toBeVisible({ timeout: 10000 })

    // ===== Select HTTP node and open config modal =====
    const httpNode = page.locator('[data-testid="workflow-node-http-node-1"]')
    await httpNode.locator('button').first().dispatchEvent('click')
    await expect(httpNode).toHaveAttribute('data-selected', 'true')

    const gearButton = page.locator(
      '[data-testid="node-configure"]'
    )
    await gearButton.click()

    const configModal = configSheet(page)
    await expect(configModal).toBeVisible()

    // ===== Open the Profiles sheet and search for the custom profile =====
    const profilesButton = configModal.getByRole('button', { name: 'Profiles' })
    await profilesButton.click()

    const profilesModal = page.locator('[data-testid="profile-binding-sheet"]')
    await expect(profilesModal).toBeVisible()

    await expect(page.locator('[data-testid="profiles-loading"]')).not.toBeVisible({
      timeout: 5000,
    })

    // Search for "My Server" (custom profile)
    const searchInput = page.locator('[data-testid="profile-search"]')
    await searchInput.fill('My Server')
    await page.waitForTimeout(100)

    // ===== Bind the custom profile =====
    const profileRow = page.locator(`[data-testid="available-profile-${PROFILE_ID}"]`)
    await expect(profileRow).toBeVisible()
    await profileRow.getByRole('button', { name: /Add/ }).click()

    const boundProfile = page.locator(`[data-testid="bound-profile-${PROFILE_ID}"]`)
    await expect(boundProfile).toBeVisible()

    // ===== Set alias to 'my_srv' =====
    const aliasInput = page.locator(`[data-testid="alias-input-${PROFILE_ID}"]`)
    await aliasInput.clear()
    await aliasInput.fill('my_srv')
    await expect(aliasInput).toHaveValue('my_srv')

    // ===== Click Done =====
    await page.getByRole('button', { name: 'Done' }).click()
    await expect(profilesModal).not.toBeVisible({ timeout: 3000 })
    await expect(configModal).toBeVisible()

    // ===== Toggle URL to expression mode, then trigger autocomplete =====
    const urlRow = configModal.locator('[data-testid="param-row-url"]')
    await urlRow.scrollIntoViewIfNeeded()
    const exprToggle = urlRow.locator('[data-testid="expression-toggle"]')
    await exprToggle.click()
    // FIELD-7: the URL holds the seeded value, so the switch asks first; Clear empties the {x} box.
    const switchDialog = page.locator('[data-testid="switch-mode-dialog"]')
    await expect(switchDialog).toHaveAccessibleName('Switch the field to an expression?')
    await switchDialog.getByRole('button', { name: 'Clear', exact: true }).click()
    await expect(switchDialog).toHaveCount(0)

    const cmEditor = urlRow.locator('.cm-content')
    await cmEditor.click()

    // Clear any pre-populated URL value so autocomplete shows all completions
    await page.keyboard.press('Control+a')
    await page.keyboard.press('Backspace')
    await page.waitForTimeout(100)

    // Trigger autocomplete with Ctrl+Space (no ${} prefix needed in expression mode)
    await page.keyboard.press('Control+Space')
    await page.waitForTimeout(200)

    // Autocomplete dropdown should appear
    const autocomplete = page.locator('.cm-tooltip-autocomplete')
    await expect(autocomplete).toBeVisible({ timeout: 5000 })

    // "Profiles" section header must be present
    await expect(autocomplete.locator('text=Profiles')).toBeVisible()

    // The alias 'my_srv' must appear (under Profiles section)
    const labels = autocomplete.locator('.cm-completionLabel')
    const labelTexts = await labels.allTextContents()
    expect(labelTexts).toContain('my_srv')

    // Dotted field names must NOT appear in initial list (only via dot-completion)
    expect(labelTexts).not.toContain('my_srv.url')

    // ===== Select my_srv =====
    const mySrvOption = autocomplete.locator('.cm-completionLabel', {
      hasText: /^my_srv$/,
    })
    await mySrvOption.click()
    await page.waitForTimeout(100)

    // ===== Type dot to see sub-field completions =====
    await cmEditor.click()
    await page.keyboard.press('Control+a')
    await page.keyboard.type('my_srv.')
    await page.waitForTimeout(200)

    const dotAutocomplete = page.locator('.cm-tooltip-autocomplete')
    await expect(dotAutocomplete).toBeVisible({ timeout: 5000 })

    const dotLabels = dotAutocomplete.locator('.cm-completionLabel')
    const dotLabelTexts = await dotLabels.allTextContents()
    expect(dotLabelTexts).toContain('my_srv.url')

    // ===== Select url sub-field =====
    const urlOption = dotAutocomplete.locator('.cm-completionLabel', {
      hasText: /^my_srv\.url$/,
    })
    await urlOption.click()
    await page.waitForTimeout(100)

    await expect(cmEditor).toContainText('my_srv.url')

    // ===== Save config modal =====
    const saveButton = configModal.getByRole('button', { name: 'Save' })
    await saveButton.click()
    await expect(configModal).not.toBeVisible({ timeout: 3000 })

    // ===== Select environment =====
    const envSelector = page.locator('[data-testid="environment-selector"]')
    await envSelector.click()

    const envPopover = page.locator('[data-testid="environment-popover"]')
    await expect(envPopover).toBeVisible()

    const envButton = envPopover.locator('button:has-text("Local Dev")').first()
    await envButton.click()
    await expect(envPopover).not.toBeVisible()

    // Save test before running to avoid "Unsaved Changes" dialog
    const toolbarSave = page.locator('[data-testid="toolbar-save-button"]')
    await toolbarSave.click()
    await page.waitForTimeout(500)

    // ===== Run the test =====
    const runButton = page.locator('[data-testid="run-button"]')
    await runButton.click()

    // ===== Verify test passes =====
    const statusIndicator = page.locator('[data-testid="workflow-status"]')
    await expect(statusIndicator).toHaveAttribute('data-status', 'passed', {
      timeout: 15000,
    })

    // Verify the HTTP node executed successfully
    const httpNodeAfter = page.locator('[data-testid="workflow-node-http-node-1"]')
    await expect
      .poll(
        async () => {
          return await httpNodeAfter.getAttribute('data-execution-status')
        },
        { timeout: 10000 }
      )
      .toBe('success')
  })
})
