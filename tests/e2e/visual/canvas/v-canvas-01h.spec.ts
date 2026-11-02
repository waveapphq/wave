/**
 * V-CANVAS-01h: Canvas Empty State
 *
 * Design Decisions: CANVAS-29, CANVAS-30, CANVAS-31, CANVAS-32
 *
 * Main Purpose: Verify canvas empty state displays onboarding components:
 * start node, dashed connector edge, and placeholder with hint text.
 *
 * Pass Criteria:
 * 1. Start node visible with green play icon and "Start" label
 * 2. Start node positioned in upper-center of canvas
 * 3. Placeholder block with dashed border below the start node
 * 4. Hint text inside placeholder ("Drag a block from the palette…")
 * 5. Start node has subtle pulse animation (no outgoing connection)
 */

import { test, expect } from '../../helpers/playwright-fixtures'
import { waitForCanvasLoad, waitForCanvasEmptyState } from '../../helpers/canvas'

test.describe('V-CANVAS-01h: Canvas Empty State', () => {
  // Empty state test: relies on global setup reset, no individual reset needed
  // This test runs in the empty-state-desktop project phase (parallel)

  test('V-CANVAS-01h: start node visible with play icon and label', async ({
    page,
  }) => {
    await page.goto('/tests/new')
    await waitForCanvasLoad(page)
    await waitForCanvasEmptyState(page)

    // 1. Start node visible with green play icon and "Start" label (per CANVAS-29)
    const startNode = page.locator('[data-testid="start-node"]')
    await expect(startNode, 'Start node should be visible').toBeVisible()

    // Start node should contain play icon
    const playIcon = startNode.locator('[data-testid="start-node-icon"]')
    await expect(playIcon, 'Start node should have play icon').toBeVisible()

    // Start node should have "Start" label
    const startLabel = startNode.locator('[data-testid="start-node-label"]')
    await expect(startLabel, 'Start node should have label').toBeVisible()
    await expect(
      startLabel,
      'Start node label should say "Start"'
    ).toContainText(/Start/i)

    // Start node should have green/success styling
    await expect(
      startNode,
      'Start node should have success/green styling'
    ).toHaveAttribute('data-variant', 'success')
  })

  test('V-CANVAS-01h-S1: start node positioned in upper-center of canvas', async ({
    page,
  }) => {
    await page.goto('/tests/new')
    await waitForCanvasLoad(page)
    await waitForCanvasEmptyState(page)

    // 2. Start node positioned in upper-center of canvas
    const canvas = page.locator('[data-testid="workflow-canvas"]')
    const startNode = page.locator('[data-testid="start-node"]')

    const canvasBox = await canvas.boundingBox()
    const startBox = await startNode.boundingBox()

    expect(canvasBox, 'Canvas should have bounding box').not.toBeNull()
    expect(startBox, 'Start node should have bounding box').not.toBeNull()

    // Start node should be horizontally centered
    const canvasCenterX = canvasBox!.x + canvasBox!.width / 2
    const startCenterX = startBox!.x + startBox!.width / 2
    const horizontalOffset = Math.abs(canvasCenterX - startCenterX)

    expect(
      horizontalOffset,
      'Start node should be horizontally centered in canvas'
    ).toBeLessThan(50) // Allow some tolerance for centering

    // Start node should be in upper portion of canvas (top third)
    const canvasTopThird = canvasBox!.y + canvasBox!.height / 3
    expect(
      startBox!.y,
      'Start node should be in upper portion of canvas'
    ).toBeLessThan(canvasTopThird)
  })

  test('V-CANVAS-01h-S3: placeholder block with dashed border visible below start node', async ({
    page,
  }) => {
    await page.goto('/tests/new')
    await waitForCanvasLoad(page)
    await waitForCanvasEmptyState(page)

    // Placeholder block with dashed border below start node (per CANVAS-32).
    // The dashed connector itself is a React Flow edge rendered on the SVG
    // layer (not DOM-addressable by testid); its visual presence is covered
    // by the snapshot assertion elsewhere.
    const placeholder = page.locator('[data-testid="onboarding-placeholder"]')
    await expect(placeholder, 'Placeholder should be visible').toBeVisible()

    await expect(
      placeholder,
      'Placeholder should have dashed border'
    ).toHaveAttribute('data-border', 'dashed')

    const startNode = page.locator('[data-testid="start-node"]')
    const startBox = await startNode.boundingBox()
    const placeholderBox = await placeholder.boundingBox()

    expect(startBox, 'Start node should have bounding box').not.toBeNull()
    expect(placeholderBox, 'Placeholder should have bounding box').not.toBeNull()

    expect(
      placeholderBox!.y,
      'Placeholder should be below start node bottom'
    ).toBeGreaterThanOrEqual(startBox!.y + startBox!.height - 10)
  })

  test('V-CANVAS-01h-S4: hint text inside placeholder', async ({
    page,
  }) => {
    await page.goto('/tests/new')
    await waitForCanvasLoad(page)
    await waitForCanvasEmptyState(page)

    // 5. Hint text inside placeholder (per CANVAS-30)
    // Wireframe shows: "Drag a plugin from the palette to add your first step"
    const placeholder = page.locator('[data-testid="onboarding-placeholder"]')
    const hintText = placeholder.locator('[data-testid="onboarding-hint"]')

    await expect(hintText, 'Hint text should be visible').toBeVisible()

    // Hint should match wireframe text pattern
    await expect(
      hintText,
      'Hint should mention dragging from palette'
    ).toContainText(/drag.*plugin.*palette/i)
  })

  test('V-CANVAS-01h-S6: start node has pulse animation', async ({
    page,
  }) => {
    await page.goto('/tests/new')
    await waitForCanvasLoad(page)
    await waitForCanvasEmptyState(page)

    // 7. Start node has subtle pulse animation when no outgoing connection
    const startNode = page.locator('[data-testid="start-node"]')
    await expect(startNode, 'Start node should be visible').toBeVisible()

    // Start node should have pulse animation class/attribute
    await expect(
      startNode,
      'Start node should have pulse animation when disconnected'
    ).toHaveAttribute('data-animate', 'pulse')
  })

  test('V-CANVAS-01h-S7: empty state components have correct z-ordering', async ({
    page,
  }) => {
    await page.goto('/tests/new')
    await waitForCanvasLoad(page)
    await waitForCanvasEmptyState(page)

    // Top-to-bottom order: Start node → Placeholder.
    const startNode = page.locator('[data-testid="start-node"]')
    const placeholder = page.locator('[data-testid="onboarding-placeholder"]')

    const startBox = await startNode.boundingBox()
    const placeholderBox = await placeholder.boundingBox()

    expect(startBox, 'Start node should have bounding box').not.toBeNull()
    expect(placeholderBox, 'Placeholder should have bounding box').not.toBeNull()

    expect(
      startBox!.y,
      'Start node should be above placeholder'
    ).toBeLessThan(placeholderBox!.y)
  })
})
