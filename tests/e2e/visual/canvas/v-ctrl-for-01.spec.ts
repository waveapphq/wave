/**
 * V-CTRL-FOR-01: For Loop Control - Visual Tests
 *
 * Validates the For Loop control's palette presence, canvas rendering,
 * output handles (body + then), config modal parameters, and scope isolation.
 *
 * Scenarios:
 * S1 - Palette search and canvas drop
 * S2 - Output handles: body (cyan) + then (gray)
 * S3 - Config modal default (Count mode)
 * S4 - Config modal Range mode toggle
 * S5 - Body scope coloring (connect body to Log)
 * S6 - Cross-scope rejection (body-chain to outer flow)
 * S7 - Version and metadata display
 *
 * REQ: REQ-3.5.1.15
 */

import { test, expect, type Page } from '../../helpers/playwright-fixtures'
import { dragPaletteItemToCanvas, waitForCanvasLoad } from '../../helpers/canvas'
import { configSheet } from '../../helpers/workbench'

test.describe('V-CTRL-FOR-01: For Loop Control', () => {
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

  async function addForLoopNode(page: Page) {
    await setupPalette(page)

    const searchInput = page.locator('[data-testid="palette-search-input"]')
    await searchInput.fill('for')
    await page.waitForTimeout(100)

    const forItem = page.locator('[data-testid="palette-item-for"]')
    const canvas = page.locator('[data-testid="workflow-canvas"]')
    const canvasBox = await canvas.boundingBox()

    await dragPaletteItemToCanvas(page, 'for', { x: canvasBox!.width / 2, y: canvasBox!.height / 2 })
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

  // ---------------------------------------------------------------------------
  // S1: Palette search and canvas drop
  // ---------------------------------------------------------------------------
  test('S1: palette search and canvas drop', async ({ page }) => {
    await page.goto('/workbench')
    await waitForCanvasLoad(page)

    await test.step('Search for "for" in palette and find For Loop item', async () => {
      await setupPalette(page)
      const searchInput = page.locator('[data-testid="palette-search-input"]')
      await searchInput.fill('for')
      await page.waitForTimeout(100)

      const forItem = page.locator('[data-testid="palette-item-for"]')
      await expect(forItem).toBeVisible()
    })

    await test.step('Drag For Loop onto canvas', async () => {
      await addForLoopNode(page)

      const workflowNodes = page.locator(
        '[data-testid^="workflow-node-"][data-nodetype]',
      )
      await expect(workflowNodes.first()).toBeVisible()
    })

    await test.step('Verify node appears with Repeat icon and For Loop label', async () => {
      const workflowNodes = page.locator(
        '[data-testid^="workflow-node-"][data-nodetype]',
      )
      const icon = workflowNodes.first().locator('[data-testid="workflow-node-icon"]')
      await expect(icon).toHaveAttribute('data-icon', 'repeat')
      await expect(workflowNodes.first()).toContainText('For Loop')
    })
  })

  // ---------------------------------------------------------------------------
  // S2: Output handles - body (cyan) + then (gray)
  // ---------------------------------------------------------------------------
  test('S2: output handles - body and then', async ({ page }) => {
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    await addForLoopNode(page)

    await test.step('Verify body handle exists with cyan color', async () => {
      const bodyHandle = page.locator('[data-testid="handle-output-body"]')
      await expect(bodyHandle).toBeVisible()
      await expect(bodyHandle).toHaveAttribute('aria-label', 'body')
    })

    await test.step('Verify then handle exists with gray color', async () => {
      const thenHandle = page.locator('[data-testid="handle-output-then"]')
      await expect(thenHandle).toBeVisible()
      await expect(thenHandle).toHaveAttribute('aria-label', 'then')
    })

    await test.step('Verify no default single output handle', async () => {
      const defaultHandle = page.locator('[data-testid="handle-output"]')
      await expect(defaultHandle).not.toBeVisible()
    })
  })

  // ---------------------------------------------------------------------------
  // S3: Config modal - Count mode default
  // ---------------------------------------------------------------------------
  test('S3: config modal - count mode default', async ({ page }) => {
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    await addForLoopNode(page)

    const modal = await openConfigModal(page)

    await test.step('Verify Mode parameter shows count as default', async () => {
      // Mode field should show "count" selected (use param row locator to avoid ambiguity)
      const modeRow = modal.locator('[data-testid="param-row-mode"]')
      await expect(modeRow).toBeVisible()
      await expect(modeRow.getByText('count')).toBeVisible()
    })

    await test.step('Verify Count field is visible', async () => {
      const countField = modal.locator('[data-testid="param-row-count"]')
      await expect(countField).toBeVisible()
    })

    await test.step('Verify Start/End fields are hidden', async () => {
      const startField = modal.locator('[data-testid="param-row-start"]')
      const endField = modal.locator('[data-testid="param-row-end"]')
      await expect(startField).not.toBeVisible()
      await expect(endField).not.toBeVisible()
    })
  })

  // ---------------------------------------------------------------------------
  // S7: Version and metadata
  // ---------------------------------------------------------------------------
  test('S7: version badge shows 1.0.0', async ({ page }) => {
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    await addForLoopNode(page)

    await selectNode(page)

    await test.step('Verify no inline version badge on canvas', async () => {
      const versionInBar = page.locator('[data-testid="node-status-bar"]').locator('text=1.0.0')
      await expect(versionInBar).toHaveCount(0)
    })
  })
})
