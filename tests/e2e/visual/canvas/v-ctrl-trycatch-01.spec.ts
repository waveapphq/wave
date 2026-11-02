/**
 * V-CTRL-TRYCATCH-01: Try/Catch Control - Visual Tests
 *
 * Validates the Try/Catch control's palette presence, canvas rendering,
 * handle configurations (4 combos of catch/finally on/off), config modal
 * parameters, metadata display, and scope isolation edge validation.
 *
 * Scenarios:
 * S1 - Palette search and canvas drop
 * S2 - Default handles (catch on, finally off) - 3 output handles
 * S3 - Enable finally via config - 4 output handles
 * S4 - Disable catch via config - 2 output handles (try + then)
 * S5 - Config modal parameters (enable_catch, enable_finally, outputs)
 * S6 - Version and metadata display (changelog + details with error schema)
 * S7 - Cross-scope edge rejected (try-path node to catch-path node)
 * S8 - Inner-to-outer edge rejected (try-path node to outer-flow node)
 * S9 - Intra-path connection allowed (same-scope edges accepted)
 *
 * REQ: REQ-3.2.2.6, REQ-3.2.2.9, REQ-3.2.2.10-12
 */

import { test, expect, type Page } from '../../helpers/playwright-fixtures'
import { dragPaletteItemToCanvas, waitForCanvasLoad } from '../../helpers/canvas'
import { BACKEND_PORT } from '../../helpers/config'
import { configSheet } from '../../helpers/workbench'
import fs from 'fs'
import path from 'path'

test.describe('V-CTRL-TRYCATCH-01: Try/Catch Control', () => {
  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  async function setupPalette(page: Page) {
    const palette = page.locator('[data-testid="block-palette"]')
    const state = await palette.getAttribute('data-state')
    if (state === 'collapsed') {
      await page.locator('[data-testid="palette-expand-button"]').click()
      await expect(palette).toHaveAttribute('data-state', 'expanded')
    }
  }

  async function addTryCatchNode(page: Page) {
    await setupPalette(page)

    const searchInput = page.locator('[data-testid="palette-search-input"]')
    await searchInput.fill('try')
    await page.waitForTimeout(100)

    const tcItem = page.locator('[data-testid="palette-item-try-catch-finally"]')
    const canvas = page.locator('[data-testid="workflow-canvas"]')
    const canvasBox = await canvas.boundingBox()

    await dragPaletteItemToCanvas(page, 'try', { x: canvasBox!.width / 2, y: canvasBox!.height / 2 })
    await page.waitForTimeout(300)
  }

  async function selectNode(page: Page) {
    const workflowNodes = page.locator(
      '[data-testid^="workflow-node-"][data-nodetype]',
    )
    const node = workflowNodes.first()
    await node.locator('button').first().dispatchEvent('click')
    await expect(node).toHaveAttribute('data-selected', 'true')
    return node
  }

  async function openConfigModal(page: Page) {
    await selectNode(page)

    const gearButton = page.locator(
      '[data-testid="node-configure"]',
    )
    await expect(gearButton).toBeVisible({ timeout: 5000 })
    await gearButton.click()

    const modal = configSheet(page)
    await expect(modal).toBeVisible({ timeout: 10000 })
    return modal
  }

  async function closeModalWithCancel(modal: import('@playwright/test').Locator) {
    const page = modal.page()
    const cancelBtn = modal.locator('button:has-text("Cancel")')
    await cancelBtn.click()

    const unsavedClose = page.getByTestId('unsaved-close')
    if (await unsavedClose.isVisible({ timeout: 1000 }).catch(() => false)) {
      await unsavedClose.click()
    }

    await expect(modal).not.toBeVisible()
  }

  async function saveAndCloseModal(modal: import('@playwright/test').Locator) {
    const saveBtn = modal.locator('button:has-text("Save")')
    await expect(saveBtn).toBeEnabled()
    await saveBtn.click()
    await expect(modal).not.toBeVisible()
  }

  // Bare /workbench (S1-S6) restores the backend draft session; clear it so a prior spec's leftover nodes don't leak in.
  test.beforeEach(async ({ page }) => {
    await page.request.delete(`http://localhost:${BACKEND_PORT}/workbench/session/`).catch(() => {})
  })

  // ---------------------------------------------------------------------------
  // S1: Palette search and canvas drop
  // ---------------------------------------------------------------------------

  test('S1: palette search and canvas drop', async ({ page }) => {
    await page.goto('/workbench')
    await waitForCanvasLoad(page)

    await test.step('Search for "try" in palette and find Try/Catch item', async () => {
      await setupPalette(page)
      const searchInput = page.locator('[data-testid="palette-search-input"]')
      await searchInput.fill('try')
      await page.waitForTimeout(100)

      const tcItem = page.locator('[data-testid="palette-item-try-catch-finally"]')
      await expect(tcItem).toBeVisible()
    })

    await test.step('Drag Try/Catch onto canvas', async () => {
      const tcItem = page.locator('[data-testid="palette-item-try-catch-finally"]')
      const canvas = page.locator('[data-testid="workflow-canvas"]')
      const canvasBox = await canvas.boundingBox()

      await dragPaletteItemToCanvas(page, 'try', { x: canvasBox!.width / 2, y: canvasBox!.height / 2 })
      await page.waitForTimeout(300)
    })

    await test.step('Verify node appears with ShieldCheck icon and Try/Catch label', async () => {
      const workflowNodes = page.locator(
        '[data-testid^="workflow-node-"][data-nodetype]',
      )
      await expect(workflowNodes.first()).toBeVisible()

      const icon = workflowNodes.first().locator('[data-testid="workflow-node-icon"]')
      await expect(icon).toHaveAttribute('data-icon', 'shield-check')

      await expect(workflowNodes.first()).toContainText('Try / Catch')
    })
  })

  // ---------------------------------------------------------------------------
  // S2: Default handles (catch on, finally off) - 3 output handles
  // ---------------------------------------------------------------------------

  test('S2: default handles - try, catch, then (3 outputs)', async ({ page }) => {
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    await addTryCatchNode(page)

    await test.step('Verify input handle at top', async () => {
      const inputHandle = page.locator('[data-testid="handle-input"]')
      await expect(inputHandle).toBeVisible()
    })

    await test.step('Verify 3 output handles: try, catch, then', async () => {
      const tryHandle = page.locator('[data-testid="handle-output-try"]')
      const catchHandle = page.locator('[data-testid="handle-output-catch"]')
      const thenHandle = page.locator('[data-testid="handle-output-then"]')

      await expect(tryHandle).toBeVisible()
      await expect(catchHandle).toBeVisible()
      await expect(thenHandle).toBeVisible()

      // No finally handle by default
      const finallyHandle = page.locator('[data-testid="handle-output-finally"]')
      await expect(finallyHandle).not.toBeVisible()
    })

    await test.step('Verify handle accessible names for tooltip labels', async () => {
      await expect(page.locator('[data-testid="handle-output-try"]')).toHaveAttribute('aria-label', 'try')
      await expect(page.locator('[data-testid="handle-output-catch"]')).toHaveAttribute('aria-label', 'catch')
      await expect(page.locator('[data-testid="handle-output-then"]')).toHaveAttribute('aria-label', 'then')
    })
  })

  // ---------------------------------------------------------------------------
  // S3: Enable finally via config - 4 output handles
  // ---------------------------------------------------------------------------

  test('S3: enable finally - try, catch, finally, then (4 outputs)', async ({ page }) => {
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    await addTryCatchNode(page)

    const modal = await test.step('Open config modal', async () => {
      return await openConfigModal(page)
    })

    await test.step('Toggle FINALLY to Enabled', async () => {
      // Find the enable_finally param row and click its checkbox
      const finallyRow = modal.locator('[data-testid="param-row-enable_finally"]')
      await expect(finallyRow).toBeVisible()

      // Click the checkbox to enable finally (default is false/unchecked)
      const checkbox = finallyRow.locator('button[role="checkbox"]')
      await checkbox.click()
    })

    await test.step('Save config', async () => {
      await saveAndCloseModal(modal)
    })

    await test.step('Verify 4 output handles: try, catch, finally, then', async () => {
      const tryHandle = page.locator('[data-testid="handle-output-try"]')
      const catchHandle = page.locator('[data-testid="handle-output-catch"]')
      const finallyHandle = page.locator('[data-testid="handle-output-finally"]')
      const thenHandle = page.locator('[data-testid="handle-output-then"]')

      await expect(tryHandle).toBeVisible()
      await expect(catchHandle).toBeVisible()
      await expect(finallyHandle).toBeVisible()
      await expect(thenHandle).toBeVisible()

      await expect(finallyHandle).toHaveAttribute('aria-label', 'finally')
    })
  })

  // ---------------------------------------------------------------------------
  // S4: Disable catch via config - 2 output handles (try + then)
  // ---------------------------------------------------------------------------

  test('S4: disable catch - try, then only (2 outputs)', async ({ page }) => {
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    await addTryCatchNode(page)

    const modal = await test.step('Open config modal', async () => {
      return await openConfigModal(page)
    })

    await test.step('Toggle CATCH to Disabled', async () => {
      const catchRow = modal.locator('[data-testid="param-row-enable_catch"]')
      await expect(catchRow).toBeVisible()

      // Click the checkbox to uncheck it (default is true/checked)
      const checkbox = catchRow.locator('button[role="checkbox"]')
      await checkbox.click()
    })

    await test.step('Save config', async () => {
      await saveAndCloseModal(modal)
    })

    await test.step('Verify 2 output handles: try, then', async () => {
      const tryHandle = page.locator('[data-testid="handle-output-try"]')
      const thenHandle = page.locator('[data-testid="handle-output-then"]')

      await expect(tryHandle).toBeVisible()
      await expect(thenHandle).toBeVisible()

      // Catch and finally should NOT be visible
      const catchHandle = page.locator('[data-testid="handle-output-catch"]')
      const finallyHandle = page.locator('[data-testid="handle-output-finally"]')
      await expect(catchHandle).not.toBeVisible()
      await expect(finallyHandle).not.toBeVisible()
    })
  })

  // ---------------------------------------------------------------------------
  // S5: Config modal parameters
  // ---------------------------------------------------------------------------

  test('S5: config modal shows enable_catch, enable_finally, and output variables', async ({ page }) => {
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    await addTryCatchNode(page)

    const modal = await test.step('Open config modal', async () => {
      return await openConfigModal(page)
    })

    await test.step('Verify modal title is "Edit Config"', async () => {
      const title = modal.locator('[class*="DialogTitle"], h2').first()
      await expect(title).toContainText('Edit Config')
    })

    await test.step('Verify enable_catch parameter row exists', async () => {
      const catchRow = modal.locator('[data-testid="param-row-enable_catch"]')
      await expect(catchRow).toBeVisible()
      await expect(catchRow).toContainText('Catch')
    })

    await test.step('Verify enable_finally parameter row exists', async () => {
      const finallyRow = modal.locator('[data-testid="param-row-enable_finally"]')
      await expect(finallyRow).toBeVisible()
      await expect(finallyRow).toContainText('Finally')
    })

    await test.step('Verify output binding rows for error and caught', async () => {
      // Output binding rows should show error and caught
      const errorRow = modal.locator('[data-testid="output-row-error"]')
      await expect(errorRow).toBeVisible()
      const caughtRow = modal.locator('[data-testid="output-row-caught"]')
      await expect(caughtRow).toBeVisible()
    })

    await test.step('Close modal', async () => {
      await closeModalWithCancel(modal)
    })
  })

  // ---------------------------------------------------------------------------
  // S6: Version and metadata display
  // ---------------------------------------------------------------------------

  test('S6: version and metadata display', async ({ page }) => {
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    await addTryCatchNode(page)

    const modal = await test.step('Open config modal', async () => {
      return await openConfigModal(page)
    })

    await test.step('Verify version shows "1.0.0"', async () => {
      const versionSelector = modal.locator('[data-testid="version-selector"]')
      await expect(versionSelector).toBeVisible()
      await expect(versionSelector).toContainText('1.0.0')
    })

    await test.step('Click Changelog button and verify content', async () => {
      const changelogBtn = modal.locator('button:has-text("Changelog")')
      await expect(changelogBtn).toBeVisible()
      await changelogBtn.click()

      // Auto-naming labels the dropped node `Try / Catch_N` so the dialog
      // title is `Try / Catch_1 - Changelog`. Match the suffix.
      const changelogDialog = page.locator('[role="dialog"]').filter({ hasText: /Try \/ Catch.* - Changelog/ })
      await expect(changelogDialog).toBeVisible()

      // Verify key changelog entries from the 1.0.0 metadata
      await expect(changelogDialog).toContainText('dead-end path chains')
      await expect(changelogDialog).toContainText('catch path')

      await page.keyboard.press('Escape')
      await expect(changelogDialog).not.toBeVisible()
    })

    await test.step('Click Details button and verify error schema content', async () => {
      const detailsBtn = modal.locator('button:has-text("Details")')
      await expect(detailsBtn).toBeVisible()
      await detailsBtn.click()

      const detailsDialog = page.locator('[role="dialog"]').filter({ hasText: /Try \/ Catch.* - Documentation/ })
      await expect(detailsDialog).toBeVisible()

      // Verify error schema documentation is present
      await expect(detailsDialog).toContainText('Error Object Schema')
      await expect(detailsDialog).toContainText('is_retryable')
      await expect(detailsDialog).toContainText('stack_trace')

      await page.keyboard.press('Escape')
      await expect(detailsDialog).not.toBeVisible()
    })

    await test.step('Close config modal', async () => {
      await closeModalWithCancel(modal)
    })
  })

  // ---------------------------------------------------------------------------
  // S7: Cross-scope edge rejected (try-path node to catch-path node)
  // ---------------------------------------------------------------------------

  test('S7: cross-scope edge rejected between try-path and catch-path nodes', async ({ page }) => {
    // Import a fixture with try-catch + path nodes already connected
    // Then attempt to drag from try-path node to catch-path node
    await page.request.delete(`http://localhost:${BACKEND_PORT}/workbench/session/`).catch(() => {})

    const fixturePath = path.resolve(__dirname, '../../functional/try-catch-control/fixture.json')
    const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf-8'))
    fixture.name = 'TC Scope Test S7'

    const envName = 'TC-S7'
    const envResponse = await page.request.post(
      `http://localhost:${BACKEND_PORT}/environments/`,
      { data: { name: envName, description: 'scope test' } },
    )
    expect(envResponse.ok()).toBeTruthy()

    const createResponse = await page.request.post(
      `http://localhost:${BACKEND_PORT}/tests`,
      { data: fixture },
    )
    expect(createResponse.ok()).toBeTruthy()
    const created = await createResponse.json()
    const testId = created.data?.id || created.id

    await page.goto(`/workbench?editTest=${testId}`)
    await page.evaluate(() => localStorage.clear())
    await page.goto(`/workbench?editTest=${testId}`)
    await waitForCanvasLoad(page)

    // Try to drag an edge from try-path Log node's output to catch-path Log node's input
    // Both are already in their respective scopes via the fixture edges
    const tryLogNode = page.locator('[data-testid^="workflow-node-"][data-nodetype]:has-text("F1 Try Path")')
    const catchLogNode = page.locator('[data-testid^="workflow-node-"][data-nodetype]:has-text("F1 Catch Path")')

    await expect(tryLogNode).toBeVisible()
    await expect(catchLogNode).toBeVisible()

    const tryLogOutput = tryLogNode.locator('[data-testid="handle-output"]')
    const catchLogInput = catchLogNode.locator('[data-testid="handle-input"]')

    const tryLogOutputBox = await tryLogOutput.boundingBox()
    const catchLogInputBox = await catchLogInput.boundingBox()

    const edgesBefore = page.locator('.react-flow__edge')
    const countBefore = await edgesBefore.count()

    if (tryLogOutputBox && catchLogInputBox) {
      // Drag from try-path node output to catch-path node input
      await page.mouse.move(
        tryLogOutputBox.x + tryLogOutputBox.width / 2,
        tryLogOutputBox.y + tryLogOutputBox.height / 2,
      )
      await page.mouse.down()
      await page.mouse.move(
        catchLogInputBox.x + catchLogInputBox.width / 2,
        catchLogInputBox.y + catchLogInputBox.height / 2,
        { steps: 5 },
      )

      await page.mouse.up()
      await page.waitForTimeout(200)

      // Either the indicator was shown OR the edge was simply not created
      const edgesAfter = page.locator('.react-flow__edge')
      const countAfter = await edgesAfter.count()

      // Key assertion: no new edge was created (cross-scope rejected)
      expect(countAfter, 'Cross-scope edge should NOT be created').toBe(countBefore)
    }
  })

  // ---------------------------------------------------------------------------
  // S8: Inner-to-outer edge rejected (try-path node to outer-flow node)
  // ---------------------------------------------------------------------------

  test('S8: inner-to-outer edge rejected (scope leaking prevented)', async ({ page }) => {
    await page.request.delete(`http://localhost:${BACKEND_PORT}/workbench/session/`).catch(() => {})

    const fixturePath = path.resolve(__dirname, '../../functional/try-catch-control/fixture.json')
    const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf-8'))
    fixture.name = 'TC Scope Test S8'

    const envName = 'TC-S8'
    const envResponse = await page.request.post(
      `http://localhost:${BACKEND_PORT}/environments/`,
      { data: { name: envName, description: 'scope test' } },
    )
    expect(envResponse.ok()).toBeTruthy()

    const createResponse = await page.request.post(
      `http://localhost:${BACKEND_PORT}/tests`,
      { data: fixture },
    )
    expect(createResponse.ok()).toBeTruthy()
    const created = await createResponse.json()
    const testId = created.data?.id || created.id

    await page.goto(`/workbench?editTest=${testId}`)
    await page.evaluate(() => localStorage.clear())
    await page.goto(`/workbench?editTest=${testId}`)
    await waitForCanvasLoad(page)

    // Try to drag from try-path node output to outer-flow node (Log After TryCatch) input
    const tryLogNode = page.locator('[data-testid^="workflow-node-"][data-nodetype]:has-text("F1 Try Path")')
    const afterNode = page.locator('[data-testid^="workflow-node-"][data-nodetype]:has-text("Log After")')

    await expect(tryLogNode).toBeVisible()
    await expect(afterNode).toBeVisible()

    const tryLogOutput = tryLogNode.locator('[data-testid="handle-output"]')
    const afterInput = afterNode.locator('[data-testid="handle-input"]')

    const tryLogOutputBox = await tryLogOutput.boundingBox()
    const afterInputBox = await afterInput.boundingBox()

    const edgesBefore = page.locator('.react-flow__edge')
    const countBefore = await edgesBefore.count()

    if (tryLogOutputBox && afterInputBox) {
      await page.mouse.move(
        tryLogOutputBox.x + tryLogOutputBox.width / 2,
        tryLogOutputBox.y + tryLogOutputBox.height / 2,
      )
      await page.mouse.down()
      await page.mouse.move(
        afterInputBox.x + afterInputBox.width / 2,
        afterInputBox.y + afterInputBox.height / 2,
        { steps: 5 },
      )
      await page.mouse.up()
      await page.waitForTimeout(200)

      const edgesAfter = page.locator('.react-flow__edge')
      const countAfter = await edgesAfter.count()

      // Inner-to-outer edge should be rejected (target already has incoming edge from then handle)
      expect(countAfter, 'Inner-to-outer edge should NOT be created').toBe(countBefore)
    }
  })

  // S9 (intra-path connection) is covered by:
  // - Unit tests in use-connection-validator.test.ts (same-scope allowed)
  // - Functional tests F1-F8 which execute workflows with connected path chains
  // Manual edge dragging in Playwright is unreliable for multi-handle nodes
})
