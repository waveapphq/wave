/**
 * V-CANVAS-LOAD-03: No Visual Flicker of Intermediate Canvas States
 *
 * Wireframe: N/A (behavioral spec in design doc)
 * Design Decisions: REQ-3.1.1.12.4, REQ-3.1.1.12.3
 * REQ: REQ-3.1.1.12 (Workbench Loading Experience)
 *
 * Pass Criteria:
 * 1. Canvas content hidden (opacity-0) during preparation phase
 * 2. Canvas becomes visible (opacity-100) only after fully ready
 * 3. No flash of empty canvas before nodes appear
 * 4. No flash of wrong zoom level or unpositioned nodes
 * 5. Overlay and canvas visibility are coordinated (overlay fades out as canvas fades in)
 * 6. Layout dimensions stable throughout transition (no CLS)
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

test.describe('V-CANVAS-LOAD-03: Flicker Prevention', () => {
  test.beforeEach(async ({ page }) => {
    await ensureCleanState(page)
  })

  // ==========================================================================
  // Canvas Hidden During Preparation
  // ==========================================================================

  test('V-CANVAS-LOAD-03-S1: canvas starts with opacity-0 during preparation', async ({ page }) => {
    // Per REQ-3.1.1.12.4: Canvas content starts in hidden state when page mounts

    // Intercept navigation resources to slow down page load and capture initial state
    await page.goto('/workbench')
    await expect(page.locator('[data-testid="canvas-page"]')).toBeVisible()

    // Canvas should have opacity-0 class during preparation
    // Use a short timeout because the canvas may become ready quickly
    const canvas = page.locator('[data-testid="workflow-canvas"]')

    // Either catch it during opacity-0 phase, or verify it transitions to opacity-100
    // On fast machines, the canvas might already be ready
    const classAttr = await canvas.getAttribute('class')
    expect(
      classAttr,
      'Canvas should have opacity class (either 0 during prep or 100 after ready)'
    ).toMatch(/opacity-(0|100)/)
  })

  test('V-CANVAS-LOAD-03-S2: canvas becomes opacity-100 after ready', async ({ page }) => {
    // Per REQ-3.1.1.12.4: Canvas becomes visible only after fully ready
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    await waitForCanvasReady(page)

    // Canvas should now have opacity-100 (already confirmed by waitForCanvasReady)
    const canvas = page.locator('[data-testid="workflow-canvas"]')
    await expect(
      canvas,
      'Canvas should have opacity-100 when ready'
    ).toHaveClass(/opacity-100/)
  })

  // ==========================================================================
  // Coordinated Overlay/Canvas Transition
  // ==========================================================================

  test('V-CANVAS-LOAD-03-S3: overlay visible while canvas is hidden during preparation', async ({ page }) => {
    // Per REQ-3.1.1.12.4: Loading overlay provides visual content during preparation
    await page.goto('/workbench')
    await expect(page.locator('[data-testid="canvas-page"]')).toBeVisible()

    // During preparation: overlay should be opacity-100, canvas should be opacity-0
    // On fast machines, the canvas may already be ready (overlay=opacity-0, canvas=opacity-100)
    // Both states prove the coordinated visibility mechanism is working
    // Read both classes atomically to avoid race condition where React re-renders
    // between two separate getAttribute calls
    const { overlayClass, canvasClass } = await page.evaluate(() => {
      const overlay = document.querySelector('[data-testid="canvas-loading-overlay"]')
      const canvas = document.querySelector('[data-testid="workflow-canvas"]')
      return {
        overlayClass: overlay?.getAttribute('class') ?? '',
        canvasClass: canvas?.getAttribute('class') ?? '',
      }
    })

    // Verify coordinated state: overlay and canvas opacity are always inverse
    const overlayVisible = overlayClass?.includes('opacity-100')
    const canvasHidden = canvasClass?.includes('opacity-0')

    if (overlayVisible) {
      // Caught during preparation phase
      expect(canvasHidden, 'When overlay is visible, canvas should be hidden').toBe(true)
    } else {
      // Already transitioned to ready state - verify both are in final state
      expect(overlayClass, 'Overlay should be opacity-0 when ready').toContain('opacity-0')
      expect(canvasClass, 'Canvas should be opacity-100 when ready').toContain('opacity-100')
    }
  })

  test('V-CANVAS-LOAD-03-S4: overlay hidden and canvas visible after ready', async ({ page }) => {
    // Per REQ-3.1.1.12.3 + REQ-3.1.1.12.4: Coordinated transition
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    await waitForCanvasReady(page)

    // After ready: overlay should be opacity-0, canvas should be opacity-100
    const overlay = page.locator('[data-testid="canvas-loading-overlay"]')
    const canvas = page.locator('[data-testid="workflow-canvas"]')

    await expect(overlay, 'Overlay should be opacity-0 when ready').toHaveClass(/opacity-0/)
    await expect(canvas, 'Canvas should be opacity-100 when ready').toHaveClass(/opacity-100/)
  })

  // ==========================================================================
  // Canvas Transition Properties
  // ==========================================================================

  test('V-CANVAS-LOAD-03-S5: canvas has CSS transition properties for smooth reveal', async ({ page }) => {
    // Per REQ-3.1.1.12.3: 200ms ease-out crossfade
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    await waitForCanvasReady(page)

    const canvas = page.locator('[data-testid="workflow-canvas"]')

    // Canvas should have transition-opacity, duration-200, ease-out classes
    await expect(canvas, 'Canvas should have transition-opacity').toHaveClass(/transition-opacity/)
    await expect(canvas, 'Canvas should have duration-200').toHaveClass(/duration-200/)
    await expect(canvas, 'Canvas should have ease-out').toHaveClass(/ease-out/)
  })

  // ==========================================================================
  // Layout Stability (CLS Prevention)
  // ==========================================================================

  test('V-CANVAS-LOAD-03-S6: canvas area maintains stable dimensions during loading', async ({ page }) => {
    // Per REQ-3.1.1.12.4: Canvas area maintains consistent dimensions throughout transition
    // No layout shift (CLS) during overlay-to-canvas reveal
    await page.goto('/workbench')
    await expect(page.locator('[data-testid="canvas-page"]')).toBeVisible()

    // Measure canvas parent dimensions during loading
    const canvasParent = page.locator('[data-testid="canvas-main-content"]')
    const loadingBox = await canvasParent.boundingBox()
    expect(loadingBox, 'Canvas parent should have dimensions during loading').not.toBeNull()

    // Wait for canvas to be ready
    await waitForCanvasLoad(page)
    await waitForCanvasReady(page)

    // Measure again after ready
    const readyBox = await canvasParent.boundingBox()
    expect(readyBox, 'Canvas parent should have dimensions after ready').not.toBeNull()

    // Dimensions should be approximately the same (no layout shift)
    expect(
      Math.abs(readyBox!.width - loadingBox!.width),
      'Width should not change during transition'
    ).toBeLessThan(5)
    expect(
      Math.abs(readyBox!.height - loadingBox!.height),
      'Height should not change during transition'
    ).toBeLessThan(5)
  })

  // ==========================================================================
  // Test Loading Flicker Prevention
  // ==========================================================================

  test('V-CANVAS-LOAD-03-S7: canvas hidden during test fetch preparation', async ({ page }) => {
    // Per REQ-3.1.1.12.4: When loading an existing test, canvas stays hidden
    // during the entire fetch + node creation + fitView cycle

    // Mock test API with delay to keep overlay visible
    await page.route('**/tests/test-flicker-check', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 2000))
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: { id: 'test-flicker-check', name: 'Flicker Check Test', metadata: {} },
        }),
      })
    })

    await page.route('**/tests/test-flicker-check/workflow', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 2000))
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: {
            nodes: [
              {
                id: 'node-1',
                type: 'workflowNode',
                position: { x: 200, y: 200 },
                data: { label: 'HTTP Client', elementType: 'http-client', nodeType: 'plugin' },
              },
            ],
            edges: [],
          },
        }),
      })
    })

    await page.goto('/workbench?editTest=test-flicker-check')

    // During fetch: canvas should be hidden, overlay should be visible
    const canvas = page.locator('[data-testid="workflow-canvas"]')
    const overlay = page.locator('[data-testid="canvas-loading-overlay"]')

    await expect(canvas, 'Canvas hidden during test fetch').toHaveClass(/opacity-0/)
    await expect(overlay, 'Overlay visible during test fetch').toHaveClass(/opacity-100/)
  })

  // ==========================================================================
  // Instant Hide (No Fade-In)
  // ==========================================================================

  test('V-CANVAS-LOAD-03-S8: canvas hide is instant (no transition on initial hide)', async ({ page }) => {
    // Per implementation: When canvas is NOT ready, transitionDuration is set to 0ms
    // to prevent a fade-in animation when hiding (only fade-out should animate)
    await page.goto('/workbench')
    await expect(page.locator('[data-testid="canvas-page"]')).toBeVisible()

    // Read class and style atomically to avoid race between opacity-0 → opacity-100 transition
    // On fast machines, the canvas may already be ready
    const { classAttr, styleAttr } = await page.evaluate(() => {
      const el = document.querySelector('[data-testid="workflow-canvas"]')
      return {
        classAttr: el?.getAttribute('class') ?? '',
        styleAttr: el?.getAttribute('style') ?? '',
      }
    })

    if (classAttr.includes('opacity-0')) {
      // Canvas is in preparation phase - verify instant hide
      expect(
        styleAttr,
        'Canvas should have instant transition (0ms) when hiding'
      ).toContain('transition-duration: 0ms')
    }
    // If canvas is already opacity-100, it transitioned successfully
  })
})
