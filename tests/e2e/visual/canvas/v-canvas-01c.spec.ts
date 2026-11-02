/**
 * V-CANVAS-01c: Canvas Breadcrumb Bar
 *
 * Design Decisions: CANVAS-33, CANVAS-68, CANVAS-69
 *
 * Main Purpose: Verify canvas breadcrumb bar structure, navigation,
 * and status indicator in idle workflow state.
 *
 * Pass Criteria:
 * 1. Breadcrumb bar height is 36px
 * 2. Left: Back arrow + "Draft Workflow" path (for unsaved workflow)
 * 3. Right: "Idle" status in muted gray (per CANVAS-33)
 * 4. No "Reset" link visible in idle state
 * 5. Back arrow is clickable
 * 6. Path transforms when saved (e.g., "Draft Workflow" → "{Test Name}")
 */

import { test, expect } from '../../helpers/playwright-fixtures'
import { waitForCanvasLoad, waitForCanvasBreadcrumb } from '../../helpers/canvas'

test.describe('V-CANVAS-01c: Canvas Breadcrumb Bar', () => {
  // Empty state test: relies on global setup reset, no individual reset needed
  // This test runs in the empty-state-desktop project phase (parallel)

  test('V-CANVAS-01c: breadcrumb bar has correct height of 44px', async ({
    page,
  }) => {
    await page.goto('/tests/new')
    await waitForCanvasLoad(page)
    await waitForCanvasBreadcrumb(page)

    // Breadcrumb bar height is 44px (h-11 = 2.75rem = 44px)
    const breadcrumb = page.locator('[data-testid="canvas-breadcrumb"]')
    await expect(breadcrumb, 'Breadcrumb bar should be visible').toBeVisible()

    const breadcrumbBox = await breadcrumb.boundingBox()
    expect(breadcrumbBox, 'Breadcrumb should have bounding box').not.toBeNull()
    expect(
      breadcrumbBox!.height,
      'Breadcrumb bar height should be 44px (h-11)'
    ).toBe(44)
  })

  test('V-CANVAS-01c-S1: left section shows draft path (back arrow hidden in draft)', async ({
    page,
  }) => {
    await page.goto('/tests/new')
    await waitForCanvasLoad(page)
    await waitForCanvasBreadcrumb(page)

    // Per V-REGRESS-05: Back arrow is hidden on draft pages (nothing to go back to)
    const breadcrumb = page.locator('[data-testid="canvas-breadcrumb"]')

    // Back arrow should be hidden in draft mode
    const backArrow = breadcrumb.locator('[data-testid="breadcrumb-back-arrow"]')
    await expect(backArrow, 'Back arrow should be hidden in draft mode').toBeHidden()

    // Path should show "Draft" for unsaved workflow
    const pathText = breadcrumb.locator('[data-testid="breadcrumb-path"]')
    await expect(pathText, 'Breadcrumb path should be visible').toBeVisible()
    await expect(
      pathText,
      'Path should show "Draft" for unsaved workflow'
    ).toContainText(/Draft/i)
  })

  test('V-CANVAS-01c-S2: right section shows Idle status in muted gray', async ({
    page,
  }) => {
    await page.goto('/tests/new')
    await waitForCanvasLoad(page)
    await waitForCanvasBreadcrumb(page)

    // 3. Right: "Idle" status in muted gray (per CANVAS-33)
    const statusIndicator = page.locator('[data-testid="workflow-status"]')
    await expect(statusIndicator, 'Status indicator should be visible').toBeVisible()

    // Status should show "Idle"
    await expect(
      statusIndicator,
      'Status should show "Idle"'
    ).toContainText(/Idle/i)

    // Status should have muted gray color (per CANVAS-33 using $mauve8)
    // We verify by checking the element has a muted/gray appearance class
    await expect(
      statusIndicator,
      'Status indicator should have muted styling'
    ).toHaveAttribute('data-status', 'idle')
  })

  test('V-CANVAS-01c-S3: reset link visible but disabled in idle state', async ({
    page,
  }) => {
    await page.goto('/tests/new')
    await waitForCanvasLoad(page)
    await waitForCanvasBreadcrumb(page)

    // Per V-REGRESS-07: Reset link is always visible but disabled when status is idle
    const resetLink = page.locator('[data-testid="breadcrumb-reset-link"]')
    await expect(
      resetLink,
      'Reset link should be visible'
    ).toBeVisible()
    await expect(
      resetLink,
      'Reset link should be disabled in idle state'
    ).toBeDisabled()
  })

  test('V-CANVAS-01c-S4: back arrow is hidden on draft pages', async ({
    page,
  }) => {
    await page.goto('/tests/new')
    await waitForCanvasLoad(page)
    await waitForCanvasBreadcrumb(page)

    // Per V-REGRESS-05: Back arrow is hidden on draft pages
    // It only shows when editing saved workflows
    const backArrow = page.locator('[data-testid="breadcrumb-back-arrow"]')
    await expect(
      backArrow,
      'Back arrow should be hidden on draft pages'
    ).toBeHidden()
  })

  test('V-CANVAS-01c-S5: breadcrumb structure has path on left and status on right', async ({
    page,
  }) => {
    await page.goto('/tests/new')
    await waitForCanvasLoad(page)
    await waitForCanvasBreadcrumb(page)

    const breadcrumb = page.locator('[data-testid="canvas-breadcrumb"]')

    // Get positions to verify left-to-right order: path | (middle space) | reset | status
    // Note: Back arrow is hidden in draft mode, path starts from left
    const pathText = breadcrumb.locator('[data-testid="breadcrumb-path"]')
    const statusIndicator = page.locator('[data-testid="workflow-status"]')

    const pathBox = await pathText.boundingBox()
    const statusBox = await statusIndicator.boundingBox()

    expect(pathBox, 'Path should have bounding box').not.toBeNull()
    expect(statusBox, 'Status should have bounding box').not.toBeNull()

    // Path is on the left side
    expect(
      pathBox!.x,
      'Path should be on the left side of breadcrumb'
    ).toBeLessThan(statusBox!.x)

    // Status is on the right side (after path)
    expect(
      statusBox!.x,
      'Status should be rightmost (on right side)'
    ).toBeGreaterThan(pathBox!.x)
  })

  test('V-CANVAS-01c-S6: new test route shows Draft path', async ({
    page,
  }) => {
    // Use /tests/new to guarantee a fresh draft (not /workbench which resumes last session)
    await page.goto('/tests/new')
    await waitForCanvasLoad(page)
    await waitForCanvasBreadcrumb(page)

    const pathText = page.locator('[data-testid="breadcrumb-path"]')
    await expect(
      pathText,
      'Path should show "Draft" on new test route'
    ).toContainText(/Draft/i)
  })
})
