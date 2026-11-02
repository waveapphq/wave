/**
 * V-PLUGIN-HTTP-01 (Profile Binding): HTTP Client Profile Binding Tests
 *
 * Phase: fixture (serial) - needs seeded profiles for UUID-based assertions
 * Design Decisions: PROFILE-11, PROFILE-13, PROFILE-20, PROFILE-22, PROFILE-24
 * REQ: REQ-3.4.1.4 (HTTP/HTTPS client operations)
 *
 * Pass Criteria:
 * 1. Profile binding modal shows 3 seeded profiles by UUID
 * 2. Add profile + Done completes binding flow
 * 3. Profile alias variables appear in expression autocomplete
 * 4. Profile binding persists after save and reopen
 */

import { test, expect, type Page } from '../../helpers/playwright-fixtures'
import { dragPaletteItemToCanvas, waitForCanvasLoad } from '../../helpers/canvas'
import { exec } from '../../helpers/exec'
import { BACKEND_PORT } from '../../helpers/config'
import { configSheet } from '../../helpers/workbench'

// Helper to expand palette and search
async function setupPalette(page: Page) {
  const palette = page.locator('[data-testid="block-palette"]')
  const state = await palette.getAttribute('data-state')
  if (state === 'collapsed') {
    await page.locator('[data-testid="palette-expand-button"]').click()
    await expect(palette).toHaveAttribute('data-state', 'expanded')
  }
}

async function findItemBySearch(page: Page, searchTerm: string) {
  const searchInput = page.locator('[data-testid="palette-search-input"]')
  await searchInput.fill(searchTerm)
  await page.waitForTimeout(100)
}

// Helper to add an HTTP Client node and open its config modal
async function addHttpNodeAndOpenConfig(page: Page) {
  await setupPalette(page)
  await findItemBySearch(page, 'http')

  const canvas = page.locator('[data-testid="workflow-canvas"]')
  const canvasBox = await canvas.boundingBox()

  await dragPaletteItemToCanvas(page, 'http', { x: canvasBox!.width / 2, y: canvasBox!.height / 2 })
  await page.waitForTimeout(100)

  // Select the node
  const workflowNodes = page.locator(
    '[data-testid^="workflow-node-"][data-nodetype]'
  )
  const firstNode = workflowNodes.first()
  await firstNode.locator('button').first().dispatchEvent('click')
  await expect(firstNode).toHaveAttribute('data-selected', 'true')

  // Click gear button to open config modal
  const gearButton = page.locator(
    '[data-testid="node-configure"]'
  )
  await gearButton.click()

  // Wait for modal
  const modal = configSheet(page)
  await expect(modal).toBeVisible()
  return modal
}

// Helper to clear session state for a clean start
async function clearSession(page: Page) {
  await page.request
    .delete(`http://localhost:${BACKEND_PORT}/workbench/session`)
    .catch(() => {})
  await page.goto('/workbench')
  await page.evaluate(() => localStorage.clear())
  await page.goto('/workbench')
}

test.describe('V-PLUGIN-HTTP-01 (Profile Binding): Seeded Profile Tests', () => {
  test.beforeAll(() => {
    exec('chmod +x ./tests/e2e/fixtures/canvas/v-plugin-http-01/01-seed.sh')
    exec('./tests/e2e/fixtures/canvas/v-plugin-http-01/01-seed.sh')
  })

  test('V-PLUGIN-HTTP-01-S15: profile binding modal shows available profiles', async ({
    page,
  }) => {
    // Per PROFILE-20: Available profiles list
    await clearSession(page)
    await waitForCanvasLoad(page)
    const modal = await addHttpNodeAndOpenConfig(page)

    // Open profile modal
    const profilesButton = modal.getByRole('button', { name: 'Profiles' })
    await profilesButton.click()

    // Wait for profiles to load
    await expect(page.locator('[data-testid="profiles-loading"]')).not.toBeVisible({
      timeout: 5000,
    })

    // Should show the 3 seeded profiles
    await expect(
      page.locator('[data-testid="available-profile-aaa10001-0001-0001-0001-000000000001"]')
    ).toBeVisible()
    await expect(
      page.locator('[data-testid="available-profile-aaa10002-0002-0002-0002-000000000002"]')
    ).toBeVisible()
    await expect(
      page.locator('[data-testid="available-profile-aaa10003-0003-0003-0003-000000000003"]')
    ).toBeVisible()
  })

  test('V-PLUGIN-HTTP-01-S16: add profile and complete binding flow', async ({ page }) => {
    // Per PROFILE-22: Add profile, PROFILE-24: Done button
    await clearSession(page)
    await waitForCanvasLoad(page)
    const modal = await addHttpNodeAndOpenConfig(page)

    // Open profile modal
    const profilesButton = modal.getByRole('button', { name: 'Profiles' })
    await profilesButton.click()

    // Wait for profiles to load
    await expect(page.locator('[data-testid="profiles-loading"]')).not.toBeVisible({
      timeout: 5000,
    })

    // Add the first profile (Production API)
    const addButton = page
      .locator('[data-testid="available-profile-aaa10001-0001-0001-0001-000000000001"]')
      .getByRole('button', { name: /Add/ })
    await addButton.click()

    // Should now appear in bound profiles section
    await expect(
      page.locator('[data-testid="bound-profile-aaa10001-0001-0001-0001-000000000001"]')
    ).toBeVisible()

    // Click Done to close profile modal
    const doneButton = page.getByRole('button', { name: 'Done' })
    await doneButton.click()

    // Profile modal should close, element config modal should still be open
    // Use specific dialog selector since Radix may keep closed dialog in DOM
    const elementConfigModal = configSheet(page)
    await expect(elementConfigModal).toBeVisible()
  })

  test('V-PLUGIN-HTTP-01-S17: profile alias variables appear in expression autocomplete', async ({
    page,
  }) => {
    // Verifies end-to-end: bind profile -> alias fields show in autocomplete
    await clearSession(page)
    await waitForCanvasLoad(page)
    const modal = await addHttpNodeAndOpenConfig(page)

    // --- Bind the "Production API" profile ---
    const profilesButton = modal.getByRole('button', { name: 'Profiles' })
    await profilesButton.click()

    await expect(page.locator('[data-testid="profiles-loading"]')).not.toBeVisible({
      timeout: 5000,
    })

    // Add Production API profile
    const addButton = page
      .locator('[data-testid="available-profile-aaa10001-0001-0001-0001-000000000001"]')
      .getByRole('button', { name: /Add/ })
    await addButton.click()

    // Verify alias is auto-generated as "production_api"
    const aliasInput = page.locator(
      '[data-testid="alias-input-aaa10001-0001-0001-0001-000000000001"]'
    )
    await expect(aliasInput).toHaveValue('production_api')

    // Click Done to close profile modal
    await page.getByRole('button', { name: 'Done' }).click()

    // --- Toggle URL field to expression mode and type to trigger autocomplete ---
    const urlRow = modal.locator('[data-testid="param-row-url"]')
    await urlRow.scrollIntoViewIfNeeded()

    // URL is a string param - literal mode shows plain <Input>, not CodeMirror.
    // Toggle to expression mode to get CodeMirror with autocomplete.
    const exprToggle = urlRow.locator('[data-testid="expression-toggle"]')
    await exprToggle.click()

    const cmEditor = urlRow.locator('.cm-content')
    await cmEditor.click()

    // Type to trigger autocomplete (activateOnTyping: true)
    await page.keyboard.type('production_api.')

    // Wait for autocomplete dropdown (rendered at document.body level)
    const autocomplete = page.locator('.cm-tooltip-autocomplete')
    await expect(autocomplete).toBeVisible({ timeout: 5000 })

    // Check that profile field variables appear in the autocomplete list
    const labels = autocomplete.locator('.cm-completionLabel')
    const labelTexts = await labels.allTextContents()

    // Should contain dotted profile variables matching seed data fields (base_url, timeout)
    expect(labelTexts).toContain('production_api.base_url')
    expect(labelTexts).toContain('production_api.timeout')
  })

  test('V-PLUGIN-HTTP-01-S18: profile binding persists after save and reopen', async ({
    page,
  }) => {
    // Verifies: bind profile -> save -> close -> reopen -> binding still there
    // and autocomplete still shows profile variables
    await clearSession(page)
    await waitForCanvasLoad(page)

    // --- Step 1: Add node, bind profile, save ---
    const modal = await addHttpNodeAndOpenConfig(page)

    // Open profile modal and bind Production API
    const profilesButton = modal.getByRole('button', { name: 'Profiles' })
    await profilesButton.click()

    await expect(page.locator('[data-testid="profiles-loading"]')).not.toBeVisible({
      timeout: 5000,
    })

    page
      .locator('[data-testid="available-profile-aaa10001-0001-0001-0001-000000000001"]')
      .getByRole('button', { name: /Add/ })
      .click()

    await expect(
      page.locator('[data-testid="bound-profile-aaa10001-0001-0001-0001-000000000001"]')
    ).toBeVisible()

    // Click Done to close profile modal
    await page.getByRole('button', { name: 'Done' }).click()

    // Toggle URL field to expression mode, then fill with raw expression
    const urlRow = modal.locator('[data-testid="param-row-url"]')
    await urlRow.scrollIntoViewIfNeeded()
    const exprToggle = urlRow.locator('[data-testid="expression-toggle"]')
    await exprToggle.click()

    const cmEditor = urlRow.locator('.cm-content')
    await cmEditor.click()
    await page.keyboard.type('f"{production_api.base_url}/time"')

    // Save the config modal
    const saveButton = modal.getByRole('button', { name: 'Save' })
    await saveButton.click()

    // Modal should close
    await expect(modal).not.toBeVisible({ timeout: 3000 })

    // --- Step 2: Reopen and verify persistence ---
    // Select the node and open config again
    const workflowNodes = page.locator(
      '[data-testid^="workflow-node-"][data-nodetype]'
    )
    const firstNode = workflowNodes.first()
    await firstNode.locator('button').first().dispatchEvent('click')
    await expect(firstNode).toHaveAttribute('data-selected', 'true')

    const gearButton = page.locator(
      '[data-testid="node-configure"]'
    )
    await gearButton.click()

    const reopenedModal = configSheet(page)
    await expect(reopenedModal).toBeVisible()

    // Verify the url field contains the expression we saved
    // Expression mode persists after save, so CodeMirror editor should be present
    const reopenedUrlRow = reopenedModal.locator('[data-testid="param-row-url"]')
    await reopenedUrlRow.scrollIntoViewIfNeeded()
    const reopenedCm = reopenedUrlRow.locator('.cm-content')
    await expect(reopenedCm).toContainText('f"{production_api.base_url}/time"')

    // Open profiles modal and verify binding is still there
    const reopenedProfilesBtn = reopenedModal.getByRole('button', { name: 'Profiles' })
    await reopenedProfilesBtn.click()

    await expect(
      page.locator('[data-testid="bound-profile-aaa10001-0001-0001-0001-000000000001"]')
    ).toBeVisible()

    const aliasInput = page.locator(
      '[data-testid="alias-input-aaa10001-0001-0001-0001-000000000001"]'
    )
    await expect(aliasInput).toHaveValue('production_api')
  })
})
