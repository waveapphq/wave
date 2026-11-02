/**
 * VI-INT-05: Zoom/Pan Canvas
 *
 * Design Decisions: Canvas Navigation (pan/zoom)
 * REQ: REQ-3.1.1.1 (Drag-and-drop interface), REQ-4.2.3 (Intuitive drag-drop interface)
 *
 * Pass Criteria:
 * 1. Mouse wheel zooms the canvas in/out
 * 2. Click-drag on canvas background pans the view
 * 3. Fit-to-screen button fits all nodes in viewport
 * 4. Zoom level is displayed/accessible
 * 5. Pan and zoom work together smoothly
 */

import { test, expect } from '../../helpers/playwright-fixtures'
import { waitForCanvasLoad } from '../../helpers/canvas'

test.describe('VI-INT-05: Zoom/Pan Canvas', () => {
  // Clear localStorage before each test to ensure clean viewport state
  test.beforeEach(async ({ page }) => {
    // Go to a page to enable localStorage access, then clear it
    await page.goto('/')
    await page.evaluate(() => localStorage.clear())
    // Now navigate to workbench with clean state
  })

  async function getCanvasTransform(page: import('@playwright/test').Page) {
    // React Flow stores viewport state - get it from the viewport transform
    const viewport = page.locator('[data-testid="workflow-canvas"] .react-flow__viewport')
    const transform = await viewport.evaluate((el) => {
      return window.getComputedStyle(el).transform
    })
    return transform
  }

  /** Parse zoom % from the viewport CSS transform matrix. */
  async function getZoomLevel(page: import('@playwright/test').Page) {
    const transform = await getCanvasTransform(page)
    const match = transform.match(/matrix\(([^,]+)/)
    return match ? Math.round(parseFloat(match[1]) * 100) : 100
  }

  /**
   * Poll until zoom level changes from `fromLevel` in the expected direction.
   * Replaces fragile waitForTimeout - React Flow animations vary in duration.
   */
  async function waitForZoomChange(
    page: import('@playwright/test').Page,
    fromLevel: number,
    direction: 'increase' | 'decrease'
  ) {
    await page.waitForFunction(
      ({ from, dir }) => {
        const vp = document.querySelector(
          '[data-testid="workflow-canvas"] .react-flow__viewport'
        )
        if (!vp) return false
        const t = window.getComputedStyle(vp).transform
        const m = t.match(/matrix\(([^,]+)/)
        const zoom = m ? Math.round(parseFloat(m[1]) * 100) : 100
        return dir === 'increase' ? zoom > from : zoom < from
      },
      { from: fromLevel, dir: direction },
      { timeout: 5000 }
    )
  }

  /**
   * Zoom out from MAX_ZOOM using React Flow's built-in zoom-out button.
   * More reliable than mouse.wheel under parallel test load.
   */
  async function zoomOutViaButton(page: import('@playwright/test').Page, clicks = 3) {
    const zoomOutButton = page.locator('button.react-flow__controls-zoomout')
    await expect(zoomOutButton).toBeVisible()
    // Wait for button to be enabled (canvas may still be initializing under parallel load)
    await expect(zoomOutButton).toBeEnabled({ timeout: 5000 })
    for (let i = 0; i < clicks; i++) {
      // Skip if button became disabled (hit min zoom)
      if (await zoomOutButton.isDisabled()) break
      const before = await getZoomLevel(page)
      await zoomOutButton.click()
      // Only wait for change on first click (may already be at min on later clicks)
      if (i === 0) await waitForZoomChange(page, before, 'decrease')
    }
  }

  test('VI-INT-05: mouse wheel zooms canvas', async ({ page }) => {
    // Per REQ-3.1.1.1: Mouse wheel controls zoom
    await page.goto('/workbench')
    await waitForCanvasLoad(page)

    // Use zoom-out button to reliably move away from MAX_ZOOM first
    await zoomOutViaButton(page, 3)
    const baseline = await getZoomLevel(page)
    expect(baseline, 'Should be below MAX_ZOOM after button zoom-out').toBeLessThan(200)

    // Position mouse over canvas center for wheel events
    const canvas = page.locator('[data-testid="workflow-canvas"]')
    const canvasBox = await canvas.boundingBox()
    expect(canvasBox).not.toBeNull()
    await page.mouse.move(
      canvasBox!.x + canvasBox!.width / 2,
      canvasBox!.y + canvasBox!.height / 2
    )

    // Zoom in with mouse wheel (scroll up)
    await page.mouse.wheel(0, -300) // Negative deltaY = zoom in
    await waitForZoomChange(page, baseline, 'increase')

    const zoomedInLevel = await getZoomLevel(page)
    expect(zoomedInLevel, 'Zoom should increase on scroll up').toBeGreaterThan(baseline)

    // Zoom out with mouse wheel (scroll down)
    await page.mouse.wheel(0, 300) // Positive deltaY = zoom out
    await waitForZoomChange(page, zoomedInLevel, 'decrease')

    const zoomedOutLevel = await getZoomLevel(page)
    expect(zoomedOutLevel, 'Zoom should decrease on scroll down').toBeLessThan(zoomedInLevel)
  })

  test('VI-INT-05-S1: click-drag pans canvas', async ({ page }) => {
    // Per REQ-3.1.1.1: Click-drag for panning
    await page.goto('/workbench')
    await waitForCanvasLoad(page)

    const canvas = page.locator('[data-testid="workflow-canvas"]')
    const canvasBox = await canvas.boundingBox()
    expect(canvasBox).not.toBeNull()

    // Get initial transform
    const initialTransform = await getCanvasTransform(page)

    // Click-drag on canvas (away from nodes)
    const startX = canvasBox!.x + 50
    const startY = canvasBox!.y + 50

    await page.mouse.move(startX, startY)
    await page.mouse.down()
    await page.mouse.move(startX + 100, startY + 100, { steps: 10 })
    await page.mouse.up()

    // Wait for pan animation
    await page.waitForTimeout(100)

    // Verify transform changed (indicating pan occurred)
    const newTransform = await getCanvasTransform(page)
    expect(newTransform, 'Transform should change after pan').not.toBe(initialTransform)
  })

  test('VI-INT-05-S2: fit-to-screen button works', async ({ page }) => {
    // Per REQ-3.1.1.1: Fit-to-screen control
    await page.goto('/workbench')
    await waitForCanvasLoad(page)

    // Disturb the view using zoom-out button + pan
    await zoomOutViaButton(page, 5)

    const canvas = page.locator('[data-testid="workflow-canvas"]')
    const canvasBox = await canvas.boundingBox()
    expect(canvasBox).not.toBeNull()

    // Pan to offset the view
    await page.mouse.move(canvasBox!.x + 100, canvasBox!.y + 100)
    await page.mouse.down()
    await page.mouse.move(canvasBox!.x + 300, canvasBox!.y + 300)
    await page.mouse.up()
    await page.waitForTimeout(100)

    const disturbedTransform = await getCanvasTransform(page)

    // Click fit-to-screen button (React Flow's built-in control)
    const fitButton = page.locator('button.react-flow__controls-fitview')
    await expect(fitButton).toBeVisible()
    await fitButton.click()

    // Wait for fit animation to change the transform
    await page.waitForFunction(
      (prevTransform) => {
        const vp = document.querySelector(
          '[data-testid="workflow-canvas"] .react-flow__viewport'
        )
        if (!vp) return false
        return window.getComputedStyle(vp).transform !== prevTransform
      },
      disturbedTransform,
      { timeout: 5000 }
    )

    // Verify transform changed
    const fittedTransform = await getCanvasTransform(page)
    expect(fittedTransform, 'Transform should change after fit-to-screen').not.toBe(
      disturbedTransform
    )

    // Verify React Flow nodes container is present (Start node is always there)
    const reactFlowNodes = page.locator('.react-flow__nodes')
    await expect(reactFlowNodes).toBeVisible()
  })

  test('VI-INT-05-S3: zoom controls buttons work', async ({ page }) => {
    // Per design: Zoom in/out buttons available
    await page.goto('/workbench')
    await waitForCanvasLoad(page)

    // Zoom out via button to ensure zoom-in button is enabled
    // (fitView on empty canvas may set zoom to MAX_ZOOM which disables zoom-in)
    await zoomOutViaButton(page, 3)
    const afterZoomOut = await getZoomLevel(page)

    // Click zoom in button (React Flow's built-in control)
    const zoomInButton = page.locator('button.react-flow__controls-zoomin')
    await expect(zoomInButton).toBeVisible()
    await zoomInButton.click()
    await waitForZoomChange(page, afterZoomOut, 'increase')

    const zoomedInLevel = await getZoomLevel(page)
    expect(zoomedInLevel, 'Zoom in button should increase zoom').toBeGreaterThan(afterZoomOut)

    // Click zoom out button (React Flow's built-in control)
    const zoomOutButton = page.locator('button.react-flow__controls-zoomout')
    await expect(zoomOutButton).toBeVisible()
    await zoomOutButton.click()
    await waitForZoomChange(page, zoomedInLevel, 'decrease')

    const zoomedOutLevel = await getZoomLevel(page)
    expect(zoomedOutLevel, 'Zoom out button should decrease zoom').toBeLessThan(zoomedInLevel)
  })

  test('VI-INT-05-S4: zoom has min/max limits', async ({ page }) => {
    // Per design: Zoom should have reasonable limits
    await page.goto('/workbench')
    await waitForCanvasLoad(page)

    // Test max zoom using zoom-in button (more reliable than wheel)
    // Button becomes disabled at MAX_ZOOM - stop clicking when that happens
    const zoomInButton = page.locator('button.react-flow__controls-zoomin')
    await expect(zoomInButton).toBeVisible()
    for (let i = 0; i < 15; i++) {
      if (await zoomInButton.isDisabled()) break
      await zoomInButton.click()
    }
    await page.waitForTimeout(300)

    const maxZoom = await getZoomLevel(page)
    expect(maxZoom, 'Max zoom should be limited').toBeLessThanOrEqual(400)

    // Test min zoom using zoom-out button
    // Button becomes disabled at MIN_ZOOM - stop clicking when that happens
    const zoomOutButton = page.locator('button.react-flow__controls-zoomout')
    for (let i = 0; i < 30; i++) {
      if (await zoomOutButton.isDisabled()) break
      await zoomOutButton.click()
    }
    await page.waitForTimeout(300)

    const minZoom = await getZoomLevel(page)
    expect(minZoom, 'Min zoom should be limited').toBeGreaterThanOrEqual(10)
  })

  test('VI-INT-05-S5: pan and zoom work together', async ({ page }) => {
    // Per REQ-3.1.1.1: Smooth combined operation
    await page.goto('/workbench')
    await waitForCanvasLoad(page)

    // Zoom out via button first (fitView on empty canvas sets MAX_ZOOM=200%)
    await zoomOutViaButton(page, 3)

    const canvas = page.locator('[data-testid="workflow-canvas"]')
    const canvasBox = await canvas.boundingBox()
    expect(canvasBox).not.toBeNull()

    // Pan
    await page.mouse.move(canvasBox!.x + 100, canvasBox!.y + 100)
    await page.mouse.down()
    await page.mouse.move(canvasBox!.x + 200, canvasBox!.y + 200, { steps: 5 })
    await page.mouse.up()
    await page.waitForTimeout(100)

    // Zoom back in via button
    const afterPan = await getZoomLevel(page)
    const zoomInButton = page.locator('button.react-flow__controls-zoomin')
    await zoomInButton.click()
    await waitForZoomChange(page, afterPan, 'increase')

    // Verify page is stable and React Flow nodes container is still present
    const reactFlowNodes = page.locator('.react-flow__nodes')
    await expect(reactFlowNodes).toBeVisible()
  })

  test('VI-INT-05-S6: pan does not select nodes', async ({ page }) => {
    // Per design: Panning should not accidentally select
    await page.goto('/workbench')
    await waitForCanvasLoad(page)

    const canvas = page.locator('[data-testid="workflow-canvas"]')
    const canvasBox = await canvas.boundingBox()
    expect(canvasBox).not.toBeNull()

    // Start panning from canvas background (away from any nodes)
    await page.mouse.move(canvasBox!.x + 30, canvasBox!.y + 30)
    await page.mouse.down()
    await page.mouse.move(canvasBox!.x + 130, canvasBox!.y + 130, { steps: 5 })
    await page.mouse.up()

    // Verify no custom workflow nodes got selected during pan
    // Note: Start node and onboarding node are not selectable by design
    const selectedNodes = page.locator('.react-flow__node.selected')
    const selectedCount = await selectedNodes.count()
    expect(selectedCount, 'No nodes should be selected after pan').toBe(0)
  })
})
