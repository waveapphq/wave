/**
 * V-CANVAS-01: Canvas Empty State Integration
 *
 * Design Decisions: CANVAS-29-32, CANVAS-33, CANVAS-34, SHELL-6, RUN-1 to RUN-6, DEBUG-1 to DEBUG-8
 *
 * Main Purpose: Integration test verifying all canvas foundation components
 * work together correctly when viewing an empty canvas.
 *
 * Pass Criteria:
 * 1. All V-CANVAS-01a criteria pass (page layout)
 * 2. All V-CANVAS-01b criteria pass (toolbar)
 * 3. All V-CANVAS-01c criteria pass (breadcrumb bar)
 * 4. All V-CANVAS-01h criteria pass (empty state)
 * 5. Components positioned correctly relative to each other
 * 6. No visual overlap between panels
 * 7. Correct z-index layering
 */

import { test, expect } from '../../helpers/playwright-fixtures'
import { exec } from '../../helpers/exec'
import {
  waitForCanvasLoad,
  waitForSidebarReady,
  waitForCanvasToolbar,
  waitForCanvasBreadcrumb,
  waitForCanvasEmptyState,
} from '../../helpers/canvas'

test.describe('V-CANVAS-01: Canvas Integration', () => {
  // Empty state test: relies on global setup reset, no individual reset needed
  // This test runs in the empty-state-desktop project phase (parallel)

  test('V-CANVAS-01: all canvas foundation components render together', async ({
    page,
  }) => {
    await page.goto('/tests/new')
    await waitForCanvasLoad(page)

    // Wait for all components to be ready
    await waitForSidebarReady(page)
    await waitForCanvasToolbar(page)
    await waitForCanvasBreadcrumb(page)
    await waitForCanvasEmptyState(page)

    // 1. V-CANVAS-01a: Page layout components
    const canvasPage = page.locator('[data-testid="canvas-page"]')
    await expect(canvasPage, 'Canvas page should be visible').toBeVisible()

    const sidebar = page.locator('[data-testid="sidebar"]')
    await expect(sidebar, 'Sidebar should be visible').toBeVisible()

    const blockPalette = page.locator('[data-testid="block-palette"]')
    await expect(blockPalette, 'Block palette should be visible').toBeVisible()

    const canvas = page.locator('[data-testid="workflow-canvas"]')
    await expect(canvas, 'Workflow canvas should be visible').toBeVisible()

    const consolePanel = page.locator('[data-testid="console-panel"]')
    await expect(consolePanel, 'Console panel should be visible').toBeVisible()

    const varManager = page.locator('[data-testid="variable-manager"]')
    await expect(varManager, 'Variable manager should be visible').toBeVisible()

    // 2. V-CANVAS-01b: Toolbar components
    const toolbar = page.locator('[data-testid="canvas-toolbar"]')
    await expect(toolbar, 'Toolbar should be visible').toBeVisible()

    const saveButton = page.locator('[data-testid="toolbar-save-button"]')
    await expect(saveButton, 'Save button should be visible').toBeVisible()

    const runButton = page.locator('[data-testid="run-button"]')
    await expect(runButton, 'Run button should be visible').toBeVisible()

    const debugButton = page.locator('[data-testid="debug-button"]')
    await expect(debugButton, 'Debug button should be visible').toBeVisible()

    const envSelector = page.locator('[data-testid="environment-selector"]')
    await expect(envSelector, 'Environment selector should be visible').toBeVisible()

    // 3. V-CANVAS-01c: Breadcrumb components
    const breadcrumb = page.locator('[data-testid="canvas-breadcrumb"]')
    await expect(breadcrumb, 'Breadcrumb should be visible').toBeVisible()

    // Note: Back arrow is hidden in Draft mode (per CANVAS-29 design)
    // It only shows when editing saved workflows with a parent to return to
    const backArrow = page.locator('[data-testid="breadcrumb-back-arrow"]')
    await expect(backArrow, 'Back arrow should be hidden in draft mode').toBeHidden()

    const pathText = page.locator('[data-testid="breadcrumb-path"]')
    await expect(pathText, 'Path should show Draft').toContainText(/Draft/i)

    const statusIndicator = page.locator('[data-testid="workflow-status"]')
    await expect(statusIndicator, 'Status should show Idle').toContainText(/Idle/i)

    // 4. V-CANVAS-01h: Empty state components
    const startNode = page.locator('[data-testid="start-node"]')
    await expect(startNode, 'Start node should be visible').toBeVisible()

    const placeholder = page.locator('[data-testid="onboarding-placeholder"]')
    await expect(placeholder, 'Onboarding placeholder should be visible').toBeVisible()
  })

  test('V-CANVAS-01-S1: components positioned correctly relative to each other', async ({
    page,
  }) => {
    await page.goto('/tests/new')
    await waitForCanvasLoad(page)
    await waitForSidebarReady(page)
    await waitForCanvasToolbar(page)
    await waitForCanvasBreadcrumb(page)

    // 5. Components positioned correctly relative to each other
    const breadcrumb = page.locator('[data-testid="canvas-breadcrumb"]')
    const toolbar = page.locator('[data-testid="canvas-toolbar"]')
    const canvas = page.locator('[data-testid="workflow-canvas"]')

    const breadcrumbBox = await breadcrumb.boundingBox()
    const toolbarBox = await toolbar.boundingBox()
    const canvasBox = await canvas.boundingBox()

    expect(breadcrumbBox, 'Breadcrumb should have bounding box').not.toBeNull()
    expect(toolbarBox, 'Toolbar should have bounding box').not.toBeNull()
    expect(canvasBox, 'Canvas should have bounding box').not.toBeNull()

    // Vertical order: Toolbar → Breadcrumb → Canvas (per actual UI implementation)
    expect(
      toolbarBox!.y,
      'Toolbar should be above breadcrumb'
    ).toBeLessThan(breadcrumbBox!.y)

    expect(
      breadcrumbBox!.y,
      'Breadcrumb should be above canvas'
    ).toBeLessThan(canvasBox!.y)

    // Verify toolbar is directly above breadcrumb (no gap more than a few pixels)
    const toolbarBottom = toolbarBox!.y + toolbarBox!.height
    expect(
      breadcrumbBox!.y - toolbarBottom,
      'Breadcrumb should be directly below toolbar'
    ).toBeLessThanOrEqual(2)

    // Verify breadcrumb is directly above canvas
    const breadcrumbBottom = breadcrumbBox!.y + breadcrumbBox!.height
    expect(
      canvasBox!.y - breadcrumbBottom,
      'Canvas should be directly below breadcrumb'
    ).toBeLessThanOrEqual(2)
  })

  test('V-CANVAS-01-S2: no visual overlap between panels', async ({
    page,
  }) => {
    await page.goto('/tests/new')
    await waitForCanvasLoad(page)

    // 6. No visual overlap between panels
    const sidebar = page.locator('[data-testid="sidebar"]')
    const palette = page.locator('[data-testid="block-palette"]')
    const canvas = page.locator('[data-testid="workflow-canvas"]')
    const varManager = page.locator('[data-testid="variable-manager"]')

    const sidebarBox = await sidebar.boundingBox()
    const paletteBox = await palette.boundingBox()
    const canvasBox = await canvas.boundingBox()
    const varManagerBox = await varManager.boundingBox()

    expect(sidebarBox, 'Sidebar should have bounding box').not.toBeNull()
    expect(paletteBox, 'Palette should have bounding box').not.toBeNull()
    expect(canvasBox, 'Canvas should have bounding box').not.toBeNull()
    expect(varManagerBox, 'VarManager should have bounding box').not.toBeNull()

    // Sidebar should not overlap with palette
    const sidebarRight = sidebarBox!.x + sidebarBox!.width
    expect(
      paletteBox!.x,
      'Palette should not overlap with sidebar'
    ).toBeGreaterThanOrEqual(sidebarRight - 1) // Allow 1px tolerance for borders

    // Palette should not overlap with canvas
    const paletteRight = paletteBox!.x + paletteBox!.width
    expect(
      canvasBox!.x,
      'Canvas should not overlap with palette'
    ).toBeGreaterThanOrEqual(paletteRight - 1)

    // Canvas should not overlap with variable manager
    const canvasRight = canvasBox!.x + canvasBox!.width
    expect(
      varManagerBox!.x,
      'Variable manager should not overlap with canvas'
    ).toBeGreaterThanOrEqual(canvasRight - 1)
  })

  test('V-CANVAS-01-S3: correct z-index layering', async ({
    page,
  }) => {
    await page.goto('/tests/new')
    await waitForCanvasLoad(page)
    await waitForCanvasToolbar(page)
    await waitForCanvasBreadcrumb(page)

    // 7. Correct z-index layering
    // Breadcrumb and toolbar should be above canvas content
    const breadcrumb = page.locator('[data-testid="canvas-breadcrumb"]')
    const toolbar = page.locator('[data-testid="canvas-toolbar"]')
    const canvas = page.locator('[data-testid="workflow-canvas"]')

    // Get computed z-index values
    const breadcrumbZIndex = await breadcrumb.evaluate(el => {
      const style = getComputedStyle(el)
      return parseInt(style.zIndex) || 0
    })

    const toolbarZIndex = await toolbar.evaluate(el => {
      const style = getComputedStyle(el)
      return parseInt(style.zIndex) || 0
    })

    const canvasZIndex = await canvas.evaluate(el => {
      const style = getComputedStyle(el)
      return parseInt(style.zIndex) || 0
    })

    // Toolbar and breadcrumb should have same or higher z-index than canvas
    // (or canvas should have lower z-index for proper stacking)
    expect(
      toolbarZIndex,
      'Toolbar z-index should be >= canvas z-index'
    ).toBeGreaterThanOrEqual(canvasZIndex)

    expect(
      breadcrumbZIndex,
      'Breadcrumb z-index should be >= canvas z-index'
    ).toBeGreaterThanOrEqual(canvasZIndex)
  })

  test('V-CANVAS-01-S4: page has no horizontal scroll', async ({
    page,
  }) => {
    await page.goto('/tests/new')
    await waitForCanvasLoad(page)

    // Verify no horizontal scroll (from V-CANVAS-01a)
    const hasHorizontalScroll = await page.evaluate(() => {
      return document.documentElement.scrollWidth > document.documentElement.clientWidth
    })

    expect(
      hasHorizontalScroll,
      'Page should not have horizontal scroll'
    ).toBe(false)
  })

  test('V-CANVAS-01-S5: interactive elements have correct enabled/disabled states', async ({
    page,
  }) => {
    await page.goto('/tests/new')
    await waitForCanvasLoad(page)
    await waitForCanvasToolbar(page)
    await waitForCanvasBreadcrumb(page)
    await waitForCanvasEmptyState(page)

    // Elements that should be ENABLED (always accessible)
    // Note: breadcrumb-back-arrow is hidden in draft mode (no parent to return to)
    const enabledElements = [
      '[data-testid="environment-selector"]',
      '[data-testid="debug-options-gear"]',
    ]

    for (const selector of enabledElements) {
      const element = page.locator(selector)
      await expect(
        element,
        `${selector} should be visible`
      ).toBeVisible()
      await expect(
        element,
        `${selector} should be enabled`
      ).toBeEnabled()
    }

    // Elements that should be DISABLED in empty canvas (no changes, no history)
    // Note: debug-button and run-button are always enabled - they show env dialog if no env selected (V-CANVAS-14)
    const disabledElements = [
      '[data-testid="toolbar-save-button"]',    // No changes to save
      '[data-testid="toolbar-undo-button"]',    // No history
      '[data-testid="toolbar-redo-button"]',    // No future
    ]

    for (const selector of disabledElements) {
      const element = page.locator(selector)
      await expect(
        element,
        `${selector} should be visible`
      ).toBeVisible()
      await expect(
        element,
        `${selector} should be disabled in empty canvas`
      ).toBeDisabled()
    }
  })
})
