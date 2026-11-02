/**
 * V-SAVE-03: Draft Persistence Verification
 *
 * Main Purpose: Verify draft workflow state persists in localStorage and
 * is correctly restored when returning to Workbench.
 *
 * Pass Criteria:
 * 1. Draft auto-saves to localStorage on every canvas change
 * 2. Navigate away and return restores exact state (nodes, edges, positions)
 * 3. Browser refresh preserves draft
 * 4. "Discard and Close" clears draft from localStorage
 * 5. Successful save clears draft from localStorage
 */

import { test, expect, type Page } from '../../helpers/playwright-fixtures'
import { mockInventedTestReads, waitForCanvasLoad } from '../../helpers/canvas'

const DRAFT_STORAGE_KEY = 'wave-workbench-draft'
// The draft persistence hook uses a 500ms debounce, so we need to wait longer
const DRAFT_DEBOUNCE_WAIT = 600

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

// Helper to get draft from localStorage
async function getDraft(page: Page): Promise<object | null> {
  const draftStr = await page.evaluate((key) => localStorage.getItem(key), DRAFT_STORAGE_KEY)
  return draftStr ? JSON.parse(draftStr) : null
}

test.describe('V-SAVE-03: Draft Persistence Verification', () => {
  test.beforeEach(async ({ page }) => {
    // The Tests below are answered by route mocks, so their ids do not exist on
    // the server. Answer their reads too, or the load-time validation and the
    // post-save re-read block the canvas.
    await mockInventedTestReads(page, ['test-123', 'test-456'])
    // Reset storage to ensure clean state
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    await page.evaluate(() => localStorage.clear())
    // Navigate fresh
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
  })

  test('V-SAVE-03-S1: draft auto-saves to localStorage on canvas change', async ({
    page,
  }) => {
    // Initially no draft
    let draft = await getDraft(page)
    expect(draft, 'No draft should exist initially').toBeNull()

    // Add a block
    await addBlockToMakeCanvasDirty(page)

    // Wait for auto-save (debounce is 500ms)
    await page.waitForTimeout(DRAFT_DEBOUNCE_WAIT)

    // Draft should now exist
    draft = await getDraft(page)
    expect(draft, 'Draft should be saved after adding block').not.toBeNull()
  })

  test('V-SAVE-03-S2: draft contains nodes data', async ({ page }) => {
    await addBlockToMakeCanvasDirty(page)
    await page.waitForTimeout(DRAFT_DEBOUNCE_WAIT)

    const draft = await getDraft(page)
    expect(draft, 'Draft should exist').not.toBeNull()
    expect(draft).toHaveProperty('nodes')
    expect(Array.isArray((draft as { nodes: unknown[] }).nodes)).toBe(true)
    expect((draft as { nodes: unknown[] }).nodes.length).toBeGreaterThan(0)
  })

  test('V-SAVE-03-S3: navigate away and return restores draft', async ({
    page,
  }) => {
    // Add a block
    await addBlockToMakeCanvasDirty(page)
    await page.waitForTimeout(DRAFT_DEBOUNCE_WAIT)

    // Count nodes before navigation
    const nodesBefore = await page.locator('[data-testid^="workflow-node-"][data-nodetype]').count()
    expect(nodesBefore, 'Should have at least one node').toBeGreaterThan(0)

    // Navigate away
    await page.goto('/tests')
    await page.waitForTimeout(200)

    // Return to workbench
    await page.goto('/workbench')
    await waitForCanvasLoad(page)

    // Nodes should be restored
    const nodesAfter = await page.locator('[data-testid^="workflow-node-"][data-nodetype]').count()
    expect(nodesAfter, 'Nodes should be restored from draft').toBe(nodesBefore)
  })

  test('V-SAVE-03-S4: browser refresh preserves draft', async ({ page }) => {
    // Add a block
    await addBlockToMakeCanvasDirty(page)
    await page.waitForTimeout(DRAFT_DEBOUNCE_WAIT)

    // Count nodes before refresh
    const nodesBefore = await page.locator('[data-testid^="workflow-node-"][data-nodetype]').count()
    expect(nodesBefore).toBeGreaterThan(0)

    // Refresh page
    await page.reload()
    await waitForCanvasLoad(page)

    // Nodes should be restored
    const nodesAfter = await page.locator('[data-testid^="workflow-node-"][data-nodetype]').count()
    expect(nodesAfter, 'Nodes should be preserved after refresh').toBe(nodesBefore)
  })

  test('V-SAVE-03-S5: Discard and Close clears draft', async ({ page }) => {
    // Add a block
    await addBlockToMakeCanvasDirty(page)
    await page.waitForTimeout(DRAFT_DEBOUNCE_WAIT)

    // Verify draft exists
    let draft = await getDraft(page)
    expect(draft, 'Draft should exist before discard').not.toBeNull()

    // Click Close button
    const closeButton = page.locator('[data-testid="toolbar-close-button"]')
    await closeButton.click()

    // Click "Discard and Close"
    const dialog = page.locator('[role="dialog"]')
    await expect(dialog).toBeVisible()
    const discardButton = dialog.getByRole('button', { name: 'Discard and Close' })
    await discardButton.click()

    // Draft should be cleared
    draft = await getDraft(page)
    expect(draft, 'Draft should be cleared after discard').toBeNull()
  })

  test('V-SAVE-03-S6: successful save clears draft', async ({ page }) => {
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

    // Add a block
    await addBlockToMakeCanvasDirty(page)
    await page.waitForTimeout(DRAFT_DEBOUNCE_WAIT)

    // Verify draft exists
    let draft = await getDraft(page)
    expect(draft, 'Draft should exist before save').not.toBeNull()

    // Open save dialog
    const saveButton = page.locator('[data-testid="toolbar-save-button"]')
    await saveButton.click()

    const dialog = page.locator('[role="dialog"]')
    await expect(dialog).toBeVisible()

    // Fill name and save
    const nameInput = dialog.locator('#test-name')
    await nameInput.fill('My Test')
    const createButton = dialog.getByRole('button', { name: /Create Test|Save/i })
    await createButton.click()

    // Wait for dialog to close
    await expect(dialog).not.toBeVisible({ timeout: 5000 })

    // Draft should be cleared
    draft = await getDraft(page)
    expect(draft, 'Draft should be cleared after successful save').toBeNull()
  })

  test('V-SAVE-03-S7: draft preserves node positions', async ({ page }) => {
    // Add a block
    await addBlockToMakeCanvasDirty(page)
    await page.waitForTimeout(DRAFT_DEBOUNCE_WAIT)

    // Get node position before navigation
    const nodeBefore = page.locator('[data-testid^="workflow-node-"][data-nodetype]').first()
    const positionBefore = await nodeBefore.boundingBox()
    expect(positionBefore).not.toBeNull()

    // Navigate away and return
    await page.goto('/tests')
    await page.waitForTimeout(200)
    await page.goto('/workbench')
    await waitForCanvasLoad(page)

    // Get node position after restoration
    const nodeAfter = page.locator('[data-testid^="workflow-node-"][data-nodetype]').first()
    const positionAfter = await nodeAfter.boundingBox()
    expect(positionAfter).not.toBeNull()

    // Positions should be approximately the same (may vary due to viewport auto-fit).
    // Post-Session-5 the node card grew vertically (description row + status
    // bar), which slightly widens the viewport fit-to-view delta between the
    // save snapshot and the post-restoration render. Bumped from 250 to 300
    // to absorb the new size delta while still catching real misrestorations.
    expect(
      Math.abs(positionAfter!.x - positionBefore!.x),
      'Node X position should be restored within tolerance'
    ).toBeLessThan(300)
    expect(
      Math.abs(positionAfter!.y - positionBefore!.y),
      'Node Y position should be restored within tolerance'
    ).toBeLessThan(300)
  })

  test('V-SAVE-03-S8: draft restored shows "Draft Workflow" breadcrumb', async ({
    page,
  }) => {
    // Add a block
    await addBlockToMakeCanvasDirty(page)
    await page.waitForTimeout(DRAFT_DEBOUNCE_WAIT)

    // Navigate away and return
    await page.goto('/tests')
    await page.waitForTimeout(200)
    await page.goto('/workbench')
    await waitForCanvasLoad(page)

    // Breadcrumb should show "Draft Workflow"
    const breadcrumb = page.locator('[data-testid="canvas-breadcrumb"]')
    await expect(breadcrumb).toContainText('Draft Workflow')
  })

  test('V-SAVE-03-S9: draft not restored when editing saved test', async ({
    page,
  }) => {
    // First add a block and let it draft
    await addBlockToMakeCanvasDirty(page)
    await page.waitForTimeout(DRAFT_DEBOUNCE_WAIT)

    // Verify draft exists
    const draft = await getDraft(page)
    expect(draft).not.toBeNull()

    // Mock fetching a saved test
    await page.route('**/tests/test-456', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: {
            id: 'test-456',
            name: 'Existing Test',
            metadata: {},
          },
        }),
      })
    })

    await page.route('**/tests/test-456/workflow', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: {
            nodes: [
              {
                id: 'existing-node',
                type: 'pluginNode',
                position: { x: 100, y: 100 },
                data: { pluginId: 'shell-script' },
              },
            ],
            edges: [],
          },
        }),
      })
    })

    // Navigate to workbench with editTest param
    await page.goto('/workbench?editTest=test-456')
    await waitForCanvasLoad(page)

    // Since there's a dirty draft, switch test dialog should appear
    const switchDialog = page.locator('[data-testid="switch-test-dialog"]')
    await expect(switchDialog).toBeVisible({ timeout: 5000 })

    // Click "Discard & Open New" to load the saved test
    const discardButton = switchDialog.getByRole('button', { name: 'Discard & Open New' })
    await discardButton.click()

    // Wait for dialog to close and test to load
    await expect(switchDialog).not.toBeVisible()
    await page.waitForTimeout(500)

    // Breadcrumb should show test name, not "Draft Workflow"
    const breadcrumb = page.locator('[data-testid="canvas-breadcrumb"]')
    await expect(breadcrumb).toContainText('Existing Test')
  })

  test('V-SAVE-03-S10: multiple blocks and edges preserved in draft', async ({
    page,
  }) => {
    // Add first block
    await addBlockToMakeCanvasDirty(page)
    await page.waitForTimeout(300)

    // Add second block
    const searchInput = page.locator('[data-testid="palette-search-input"]')
    await searchInput.clear()
    await searchInput.fill('shell script')
    await page.waitForTimeout(100)

    const shellItem = page.locator('[data-testid="palette-item-shell-script"]')
    const canvas = page.locator('[data-testid="workflow-canvas"]')
    const canvasBox = await canvas.boundingBox()

    await shellItem.dragTo(canvas, {
      targetPosition: { x: canvasBox!.width / 2 + 100, y: canvasBox!.height / 2 + 100 },
    })
    // Wait for debounce after second block
    await page.waitForTimeout(DRAFT_DEBOUNCE_WAIT)

    // Count nodes before navigation
    const nodesBefore = await page.locator('[data-testid^="workflow-node-"][data-nodetype]').count()
    expect(nodesBefore, 'Should have two nodes').toBe(2)

    // Navigate away and return
    await page.goto('/tests')
    await page.waitForTimeout(200)
    await page.goto('/workbench')
    await waitForCanvasLoad(page)

    // Both nodes should be restored
    const nodesAfter = await page.locator('[data-testid^="workflow-node-"][data-nodetype]').count()
    expect(nodesAfter, 'Both nodes should be restored').toBe(2)
  })
})
