/**
 * V-CANVAS-LOAD-01: Loading Overlay During Canvas Preparation
 *
 * Wireframe: N/A (behavioral spec in design doc)
 * Design Decisions: REQ-3.1.1.12.1, REQ-3.1.1.12.3
 * REQ: REQ-3.1.1.12 (Workbench Loading Experience)
 *
 * Pass Criteria:
 * 1. Loading overlay visible when canvas page mounts
 * 2. Overlay contains spinner (Loader2 40px with animate-spin)
 * 3. Overlay shows contextual message ("Preparing workbench…" for blank canvas)
 * 4. Overlay covers only canvas area (not toolbar, breadcrumb, palette)
 * 5. Overlay fades out with 200ms transition when canvas is ready
 * 6. After ready, overlay has opacity-0 and pointer-events-none
 * 7. "Loading test…" message shown when fetching existing test
 */

import { test, expect, type Page } from '../../helpers/playwright-fixtures'
import { waitForCanvasLoad, waitForCanvasEmptyState, waitForCanvasReady } from '../../helpers/canvas'

/**
 * Helper to ensure a clean workbench state by clearing all localStorage
 * from a non-workbench page and intercepting session recovery to prevent
 * stale sessions from interfering with canvas readiness.
 */
async function ensureCleanState(page: Page): Promise<void> {
  await page.goto('/tests')
  await page.evaluate(() => localStorage.clear())
  // Intercept session recovery API to prevent stale sessions from triggering
  // a failed test load that blocks canvas readiness
  await page.route('**/workbench/session', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: null }) })
  )
}

test.describe('V-CANVAS-LOAD-01: Loading Overlay', () => {
  test.beforeEach(async ({ page }) => {
    await ensureCleanState(page)
  })

  // ==========================================================================
  // Overlay Visibility and Structure
  // ==========================================================================

  test('V-CANVAS-LOAD-01-S1: overlay visible on canvas page mount', async ({ page }) => {
    // Per REQ-3.1.1.12.1: Overlay appears immediately when canvas page mounts
    await page.goto('/workbench')

    // The overlay should be visible on mount (before canvas is ready)
    const overlay = page.locator('[data-testid="canvas-loading-overlay"]')
    await expect(overlay, 'Loading overlay should be visible on mount').toBeVisible()
  })

  test('V-CANVAS-LOAD-01-S2: overlay contains spinner with animate-spin', async ({ page }) => {
    // Per REQ-3.1.1.12.1: Large spinner (40px) from feedback patterns
    await page.goto('/workbench')

    const spinner = page.locator('[data-testid="canvas-loading-spinner"]')
    await expect(spinner, 'Spinner should be visible').toBeVisible()

    // Spinner should have animate-spin class
    await expect(spinner, 'Spinner should have animate-spin').toHaveClass(/animate-spin/)

    // Spinner should be 40px (h-10 w-10 = 2.5rem = 40px)
    await expect(spinner, 'Spinner should have h-10 class').toHaveClass(/h-10/)
    await expect(spinner, 'Spinner should have w-10 class').toHaveClass(/w-10/)
  })

  test('V-CANVAS-LOAD-01-S3: overlay shows "Preparing workbench…" for blank canvas', async ({ page }) => {
    // Per REQ-3.1.1.12.1: Contextual message for blank canvas scenario
    await page.goto('/workbench')

    const overlay = page.locator('[data-testid="canvas-loading-overlay"]')
    await expect(overlay, 'Overlay should show preparing message').toContainText('Preparing workbench…')
  })

  test('V-CANVAS-LOAD-01-S4: overlay covers only canvas area, not toolbar/breadcrumb/palette', async ({ page }) => {
    // Per REQ-3.1.1.12.1: Overlay sits above canvas content within canvas panel boundaries
    // It does not cover toolbar, breadcrumb bar, palette, or variable manager
    await page.goto('/workbench')
    await expect(page.locator('[data-testid="canvas-page"]')).toBeVisible()

    const overlay = page.locator('[data-testid="canvas-loading-overlay"]')
    await expect(overlay).toBeVisible()

    // Toolbar should still be visible (not covered by overlay)
    const toolbar = page.locator('[data-testid="canvas-toolbar"]')
    await expect(toolbar, 'Toolbar should be visible above overlay').toBeVisible()

    // Breadcrumb bar should still be visible
    const breadcrumb = page.locator('[data-testid="canvas-breadcrumb"]')
    await expect(breadcrumb, 'Breadcrumb should be visible above overlay').toBeVisible()

    // Palette should still be visible
    const palette = page.locator('[data-testid="block-palette"]')
    await expect(palette, 'Palette should be visible beside overlay').toBeVisible()

    // Overlay should be positioned within the canvas content area (absolute within relative parent)
    await expect(overlay, 'Overlay should have absolute positioning').toHaveClass(/absolute/)
    await expect(overlay, 'Overlay should have inset-0').toHaveClass(/inset-0/)
  })

  // ==========================================================================
  // Overlay Dismissal and Transition
  // ==========================================================================

  test('V-CANVAS-LOAD-01-S5: overlay dismissed after canvas is ready', async ({ page }) => {
    // Per REQ-3.1.1.12.3: Overlay fades out when canvas is fully ready
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    await waitForCanvasReady(page)

    // After ready, overlay should have opacity-0 (faded out)
    const overlay = page.locator('[data-testid="canvas-loading-overlay"]')
    await expect(overlay, 'Overlay should have opacity-0 when ready').toHaveClass(/opacity-0/)
  })

  test('V-CANVAS-LOAD-01-S6: overlay has pointer-events-none after dismissal', async ({ page }) => {
    // Per REQ-3.1.1.12.3: After transition, overlay should not intercept clicks
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    await waitForCanvasReady(page)

    const overlay = page.locator('[data-testid="canvas-loading-overlay"]')
    await expect(
      overlay,
      'Overlay should have pointer-events-none when ready'
    ).toHaveClass(/pointer-events-none/)
  })

  test('V-CANVAS-LOAD-01-S7: overlay has CSS transition properties for fade-out', async ({ page }) => {
    // Per REQ-3.1.1.12.3: 200ms ease-out crossfade from feedback patterns
    await page.goto('/workbench')

    const overlay = page.locator('[data-testid="canvas-loading-overlay"]')
    await expect(overlay).toBeVisible()

    // Overlay should have transition-opacity and duration-200 classes
    await expect(overlay, 'Overlay should have transition-opacity').toHaveClass(/transition-opacity/)
    await expect(overlay, 'Overlay should have duration-200').toHaveClass(/duration-200/)
    await expect(overlay, 'Overlay should have ease-out').toHaveClass(/ease-out/)
  })

  // ==========================================================================
  // Contextual Message for Test Loading
  // ==========================================================================

  test('V-CANVAS-LOAD-01-S8: overlay shows "Loading test…" when fetching test', async ({ page }) => {
    // Per REQ-3.1.1.12.1: "Loading test…" message when fetching existing test

    // Intercept test API calls with a delay to keep overlay visible
    await page.route('**/tests/test-load-01', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 3000))
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: { id: 'test-load-01', name: 'Test Load', metadata: {} },
        }),
      })
    })

    await page.route('**/tests/test-load-01/workflow', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 3000))
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: { nodes: [], edges: [] },
        }),
      })
    })

    // Navigate with editTest param to trigger test loading
    await page.goto('/workbench?editTest=test-load-01')

    // Overlay should show "Loading test…" for fetch scenario
    const overlay = page.locator('[data-testid="canvas-loading-overlay"]')
    await expect(overlay, 'Overlay should show loading test message').toContainText('Loading test…')
  })

  // ==========================================================================
  // Overlay Z-Index (above canvas, below dialogs)
  // ==========================================================================

  test('V-CANVAS-LOAD-01-S9: overlay has high z-index to sit above canvas content', async ({ page }) => {
    // Per REQ-3.1.1.12.1: Overlay sits above canvas content
    await page.goto('/workbench')

    const overlay = page.locator('[data-testid="canvas-loading-overlay"]')
    await expect(overlay).toBeVisible()

    // Verify z-50 class for proper stacking
    await expect(overlay, 'Overlay should have z-50 for stacking').toHaveClass(/z-50/)
  })

  // ==========================================================================
  // Overlay Background
  // ==========================================================================

  test('V-CANVAS-LOAD-01-S10: overlay uses bg-card token for background', async ({ page }) => {
    // Per REQ-3.1.1.12.1: Backdrop uses --color-bg-card at high opacity
    await page.goto('/workbench')

    const overlay = page.locator('[data-testid="canvas-loading-overlay"]')
    await expect(overlay).toBeVisible()

    // Verify bg-card class for themed background
    await expect(overlay, 'Overlay should use bg-card for background').toHaveClass(/bg-card/)
  })
})
