/**
 * V-LOG-001 through V-LOG-004: Log Plugin Configuration
 *
 * Design Decisions: CANVAS-105 through CANVAS-110
 * REQ: REQ-3.4.1.17
 *
 * Pass Criteria:
 * V-LOG-001:
 * 1. Log message parameter renders as expression input (not plain text)
 * 2. Expression input accepts Python expressions in expression mode
 *
 * V-LOG-002:
 * 1. Log config modal shows version 1.0.0 in version selector
 * 2. Log plugin has only 1 version available (1.0.0)
 *
 * V-LOG-003:
 * 1. Log config modal details section renders markdown properly
 * 2. Bold text renders as <strong> not **text**
 * 3. Code renders as <code> not `code`
 * 4. Details contain use cases and log level documentation
 *
 * V-LOG-004:
 * 1. Log config modal changelog shows 4 items
 * 2. Changelog includes: Initial release, Log level config, Expression evaluation, Artifact integration
 */

import { test, expect } from '../../helpers/playwright-fixtures'
import { dragPaletteItemToCanvas, expandPalette, waitForCanvasLoad } from '../../helpers/canvas'
import { configSheet } from '../../helpers/workbench'

test.describe('V-LOG: Log Plugin Configuration', () => {
  // No backend data needed - plugin metadata is hardcoded (REQ-3.4.1.17)
  // Runs in parallel no-data phase

  test.beforeEach(async ({ page }) => {
    // Clear localStorage workbench state for a fresh canvas
    // NOTE: Do NOT delete /workbench/session - it's shared with fixture-phase tests
    await page.goto('/')
    await page.evaluate(() => localStorage.clear())
  })

  // Helper to fill CodeMirror input (used for expression inputs)
  async function fillCodeMirrorInput(locator: import('@playwright/test').Locator, text: string) {
    // CodeMirror inputs need click + keyboard type, not fill()
    await locator.click()
    // Clear any existing content
    await locator.page().keyboard.press('Control+a')
    await locator.page().keyboard.type(text)
  }

  // Helper to search and find item
  async function findItemBySearch(page: import('@playwright/test').Page, searchTerm: string) {
    const searchInput = page.locator('[data-testid="palette-search-input"]')
    await searchInput.fill(searchTerm)
    await page.waitForTimeout(100)
  }

  // Helper to drop Log plugin on canvas and select it
  async function dropLogAndSelect(page: import('@playwright/test').Page) {
    await expandPalette(page)
    await findItemBySearch(page, 'log')

    const item = page.locator('[data-testid="palette-item-log"]')
    // Wait for the palette item to be fully visible before dragging
    await expect(item).toBeVisible({ timeout: 5000 })

    const canvas = page.locator('[data-testid="workflow-canvas"]')
    const canvasBox = await canvas.boundingBox()

    // Count nodes before drop so we can detect when the new one appears
    const nodesBefore = await page.locator(
      '[data-testid^="workflow-node-"][data-nodetype]'
    ).count()

    await dragPaletteItemToCanvas(page, 'log', { x: canvasBox!.width / 2, y: canvasBox!.height / 2 })

    // Wait for the new node to appear (count increases by 1)
    const workflowNodes = page.locator(
      '[data-testid^="workflow-node-"][data-nodetype]'
    )
    await expect(workflowNodes).toHaveCount(nodesBefore + 1, { timeout: 10000 })

    // Select the newly dropped node (last in DOM order)
    const logNode = workflowNodes.last()
    await logNode.locator('button').first().click()
    await expect(logNode).toHaveAttribute('data-selected', 'true', { timeout: 5000 })

    return logNode
  }

  // Helper to open config modal for selected node
  async function openConfigModal(page: import('@playwright/test').Page) {
    const gearButton = page.locator(
      '[data-testid="node-configure"]'
    )
    // Wait for button to be enabled (node selection may lag under parallel load)
    await expect(gearButton).toBeEnabled({ timeout: 5000 })
    await gearButton.click()
    const modal = configSheet(page)
    await expect(modal).toBeVisible()
    return modal
  }

  // ==========================================================================
  // V-LOG-001: Log message parameter renders as expression input
  // ==========================================================================

  test.describe('V-LOG-001: Message Parameter Expression Input', () => {
    test('V-LOG-001-S1: message parameter has expression input field', async ({ page }) => {
      await page.goto('/workbench')
      await waitForCanvasLoad(page)
      await dropLogAndSelect(page)
      const modal = await openConfigModal(page)

      // Message parameter should be visible (allow time for modal content to render under load)
      const messageRow = modal.locator('[data-testid="param-row-message"]')
      await expect(messageRow).toBeVisible({ timeout: 10000 })

      // FIELD-1: a literal string row is the one value field, with its expand.
      const messageInput = messageRow.locator('[data-slot="input-group"] input')
      await expect(messageInput).toBeVisible()
      await expect(messageInput).toBeEditable()
      await expect(modal.getByRole('button', { name: 'Open editor for Message', exact: true })).toBeVisible()
    })

    test('V-LOG-001-S2: message input accepts Python expressions in expression mode', async ({ page }) => {
      await page.goto('/workbench')
      await waitForCanvasLoad(page)
      await dropLogAndSelect(page)
      const modal = await openConfigModal(page)

      // Toggle message to expression mode
      const messageRow = modal.locator('[data-testid="param-row-message"]')
      const exprToggle = messageRow.locator('[data-testid="expression-toggle"]')
      await exprToggle.click()

      // Fill in a message with a raw Python f-string expression
      const messageInput = modal.locator('[data-testid="param-input-message"]')
      await fillCodeMirrorInput(messageInput, 'f"Processing item {itemId} of {total}"')

      // Verify the value was accepted (CodeMirror stores content in text, not value attribute)
      await expect(messageInput).toContainText('f"Processing item {itemId} of {total}"')
    })

    test('V-LOG-001-S3: level parameter has enum dropdown', async ({ page }) => {
      await page.goto('/workbench')
      await waitForCanvasLoad(page)
      await dropLogAndSelect(page)
      const modal = await openConfigModal(page)

      // Level parameter should be visible with dropdown
      const levelRow = modal.locator('[data-testid="param-row-level"]')
      await expect(levelRow).toBeVisible()

      // Should have select/dropdown for enum type (SelectTrigger button within the row)
      const levelSelectTrigger = levelRow.locator('button[role="combobox"]')
      await expect(levelSelectTrigger).toBeVisible()

      // Click to open dropdown
      await levelSelectTrigger.click()

      // Wait for dropdown to be visible
      const listbox = page.locator('[role="listbox"]')
      await expect(listbox).toBeVisible()

      // Verify all 5 log levels are present (may also have default/placeholder option)
      await expect(page.locator('[role="option"]', { hasText: 'DEBUG' })).toBeVisible()
      await expect(page.locator('[role="option"]', { hasText: 'INFO' })).toBeVisible()
      await expect(page.locator('[role="option"]', { hasText: 'WARN' })).toBeVisible()
      await expect(page.locator('[role="option"]', { hasText: 'ERROR' })).toBeVisible()
      await expect(page.locator('[role="option"]', { hasText: 'FATAL' })).toBeVisible()
    })
  })

  // ==========================================================================
  // V-LOG-002: Log config modal shows version 1.0.0
  // ==========================================================================

  test.describe('V-LOG-002: Version 1.0.0', () => {
    test('V-LOG-002-S1: version selector shows 1.0.0', async ({ page }) => {
      await page.goto('/workbench')
      await waitForCanvasLoad(page)
      await dropLogAndSelect(page)
      const modal = await openConfigModal(page)

      // Version selector should show 1.0.0
      const versionSelector = modal.locator('[data-testid="version-selector"]')
      await expect(versionSelector).toContainText('1.0.0')
    })

    test('V-LOG-002-S2: Log has only 1 version available', async ({ page }) => {
      await page.goto('/workbench')
      await waitForCanvasLoad(page)
      await dropLogAndSelect(page)
      const modal = await openConfigModal(page)

      // Open version dropdown
      const versionSelector = modal.locator('[data-testid="version-selector"]')
      await versionSelector.click()
      const dropdown = versionSelector.locator('..').locator('ul')
      await expect(dropdown).toBeVisible()

      // Should have exactly 1 option (1.0.0)
      const options = dropdown.locator('li button')
      await expect(options).toHaveCount(1)
      await expect(options.first()).toContainText('1.0.0')
    })

    test('V-LOG-002-S3: no green arrow since only 1 version exists', async ({ page }) => {
      await page.goto('/workbench')
      await waitForCanvasLoad(page)
      await dropLogAndSelect(page)
      const modal = await openConfigModal(page)

      // No green arrow (version-update-available) should be visible
      const updateIndicator = modal.locator('[data-testid="version-update-available"]')
      await expect(updateIndicator).not.toBeVisible()
    })
  })

  // ==========================================================================
  // V-LOG-003: Log config modal details section renders properly
  // ==========================================================================

  test.describe('V-LOG-003: Details Section', () => {
    test('V-LOG-003-S1: details dialog opens and shows documentation', async ({ page }) => {
      await page.goto('/workbench')
      await waitForCanvasLoad(page)
      await dropLogAndSelect(page)
      const modal = await openConfigModal(page)

      // Open details dialog
      const detailsBtn = modal.getByRole('button', { name: 'Details' })
      await detailsBtn.click()

      // Wait for details dialog
      const detailsDialog = page.locator('[role="dialog"]').first()
      await expect(detailsDialog).toBeVisible()

      // Title should indicate documentation
      await expect(detailsDialog.getByText(/Documentation/)).toBeVisible()
    })

    test('V-LOG-003-S2: details shows version badge', async ({ page }) => {
      await page.goto('/workbench')
      await waitForCanvasLoad(page)
      await dropLogAndSelect(page)
      const modal = await openConfigModal(page)

      const detailsBtn = modal.getByRole('button', { name: 'Details' })
      await detailsBtn.click()

      const detailsDialog = page.locator('[role="dialog"]').first()
      await expect(detailsDialog).toBeVisible()

      // Version badge should show 1.0.0
      const versionBadge = detailsDialog.getByText('1.0.0')
      await expect(versionBadge).toBeVisible()
    })

    test('V-LOG-003-S3: markdown bold renders correctly', async ({ page }) => {
      await page.goto('/workbench')
      await waitForCanvasLoad(page)
      await dropLogAndSelect(page)
      const modal = await openConfigModal(page)

      const detailsBtn = modal.getByRole('button', { name: 'Details' })
      await detailsBtn.click()

      const detailsDialog = page.locator('[role="dialog"]').first()
      await expect(detailsDialog).toBeVisible()

      // Bold text should render as <strong> not literal **text**
      // Check that "Use Cases:" is bold
      const boldText = detailsDialog.locator('strong', { hasText: 'Use Cases:' })
      await expect(boldText).toBeVisible()

      // Should NOT contain literal asterisks
      const content = await detailsDialog.textContent()
      expect(content).not.toContain('**')
    })

    test('V-LOG-003-S4: markdown code renders correctly', async ({ page }) => {
      await page.goto('/workbench')
      await waitForCanvasLoad(page)
      await dropLogAndSelect(page)
      const modal = await openConfigModal(page)

      const detailsBtn = modal.getByRole('button', { name: 'Details' })
      await detailsBtn.click()

      const detailsDialog = page.locator('[role="dialog"]').first()
      await expect(detailsDialog).toBeVisible()

      // Inline code should render as <code> not literal `code`
      const codeElement = detailsDialog.locator('code', { hasText: 'message' })
      await expect(codeElement).toBeVisible()
    })

    test('V-LOG-003-S5: details contain use cases documentation', async ({ page }) => {
      await page.goto('/workbench')
      await waitForCanvasLoad(page)
      await dropLogAndSelect(page)
      const modal = await openConfigModal(page)

      const detailsBtn = modal.getByRole('button', { name: 'Details' })
      await detailsBtn.click()

      const detailsDialog = page.locator('[role="dialog"]').first()
      await expect(detailsDialog).toBeVisible()

      // Should contain Log plugin-specific content
      await expect(detailsDialog.getByText(/Debug workflow execution/)).toBeVisible()
    })

    test('V-LOG-003-S6: details contain log level documentation', async ({ page }) => {
      await page.goto('/workbench')
      await waitForCanvasLoad(page)
      await dropLogAndSelect(page)
      const modal = await openConfigModal(page)

      const detailsBtn = modal.getByRole('button', { name: 'Details' })
      await detailsBtn.click()

      const detailsDialog = page.locator('[role="dialog"]').first()
      await expect(detailsDialog).toBeVisible()

      // Should contain log level descriptions
      await expect(detailsDialog.getByText(/Log Levels:/)).toBeVisible()
      await expect(detailsDialog.getByText(/DEBUG.*Detailed diagnostic/)).toBeVisible()
    })
  })

  // ==========================================================================
  // V-LOG-004: Log config modal changelog shows 4 items
  // ==========================================================================

  test.describe('V-LOG-004: Changelog', () => {
    test('V-LOG-004-S1: changelog dialog opens', async ({ page }) => {
      await page.goto('/workbench')
      await waitForCanvasLoad(page)
      await dropLogAndSelect(page)
      const modal = await openConfigModal(page)

      // Open changelog dialog
      const changelogBtn = modal.getByRole('button', { name: 'Changelog' })
      await changelogBtn.click()

      // Wait for changelog dialog
      const changelogDialog = page.locator('[role="dialog"]').first()
      await expect(changelogDialog).toBeVisible()
    })

    test('V-LOG-004-S2: changelog shows exactly 4 items', async ({ page }) => {
      await page.goto('/workbench')
      await waitForCanvasLoad(page)
      await dropLogAndSelect(page)
      const modal = await openConfigModal(page)

      const changelogBtn = modal.getByRole('button', { name: 'Changelog' })
      await changelogBtn.click()

      const changelogDialog = page.locator('[role="dialog"]').first()
      await expect(changelogDialog).toBeVisible()

      // Should show 4 changelog entries
      // Per control-metadata.ts: Log writing, Configurable log level, Expression evaluation, Integration
      const changelogItems = changelogDialog.locator('li')
      await expect(changelogItems).toHaveCount(4)
    })

    test('V-LOG-004-S3: changelog contains log writing entry', async ({ page }) => {
      await page.goto('/workbench')
      await waitForCanvasLoad(page)
      await dropLogAndSelect(page)
      const modal = await openConfigModal(page)

      const changelogBtn = modal.getByRole('button', { name: 'Changelog' })
      await changelogBtn.click()

      const changelogDialog = page.locator('[role="dialog"]').first()
      await expect(changelogDialog).toBeVisible()

      await expect(
        changelogDialog.getByText(/Write messages to the execution log/)
      ).toBeVisible()
    })

    test('V-LOG-004-S4: changelog contains log level configuration', async ({ page }) => {
      await page.goto('/workbench')
      await waitForCanvasLoad(page)
      await dropLogAndSelect(page)
      const modal = await openConfigModal(page)

      const changelogBtn = modal.getByRole('button', { name: 'Changelog' })
      await changelogBtn.click()

      const changelogDialog = page.locator('[role="dialog"]').first()
      await expect(changelogDialog).toBeVisible()

      await expect(
        changelogDialog.getByText(/Configurable log level/)
      ).toBeVisible()
    })

    test('V-LOG-004-S5: changelog contains expression evaluation', async ({ page }) => {
      await page.goto('/workbench')
      await waitForCanvasLoad(page)
      await dropLogAndSelect(page)
      const modal = await openConfigModal(page)

      const changelogBtn = modal.getByRole('button', { name: 'Changelog' })
      await changelogBtn.click()

      const changelogDialog = page.locator('[role="dialog"]').first()
      await expect(changelogDialog).toBeVisible()

      await expect(
        changelogDialog.getByText(/Expression evaluation/)
      ).toBeVisible()
    })

    test('V-LOG-004-S6: changelog contains artifact integration', async ({ page }) => {
      await page.goto('/workbench')
      await waitForCanvasLoad(page)
      await dropLogAndSelect(page)
      const modal = await openConfigModal(page)

      const changelogBtn = modal.getByRole('button', { name: 'Changelog' })
      await changelogBtn.click()

      const changelogDialog = page.locator('[role="dialog"]').first()
      await expect(changelogDialog).toBeVisible()

      await expect(
        changelogDialog.getByText(/Integration with execution artifact/)
      ).toBeVisible()
    })

    test('V-LOG-004-S7: changelog shows release date', async ({ page }) => {
      await page.goto('/workbench')
      await waitForCanvasLoad(page)
      await dropLogAndSelect(page)
      const modal = await openConfigModal(page)

      const changelogBtn = modal.getByRole('button', { name: 'Changelog' })
      await changelogBtn.click()

      const changelogDialog = page.locator('[role="dialog"]').first()
      await expect(changelogDialog).toBeVisible()

      // Released date renders as a human date, not the raw ISO string.
      await expect(changelogDialog.getByText(/Released:/)).toBeVisible()
      await expect(changelogDialog.getByText('Jan 12, 2026')).toBeVisible()
    })
  })
})
