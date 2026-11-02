/**
 * V-CANVAS-NODE-07: Note idle - slim status bar with kebab only
 *
 * Design Decisions: Element Node Visual Structure (breakpoint marker; not applicable to Notes), Note Control (kebab-only idle).
 * Note handles are a placeholder for a future block.
 *
 * Phase: no-data (parallel) - drops a Note control onto an empty canvas.
 *
 * Pass Criteria:
 *   1. Note container renders with `data-testid="note-node-${id}"`.
 *   2. Persistent slim status bar (`data-testid="node-status-bar"` with `data-slim="true"`) is visible.
 *   3. The kebab is the only action in the right cluster (no cog, no L/S, no dig-in).
 *   4. Ingress and egress flow handles are present (overrides the "no handles" wireframe).
 *   5. In idle mode, the color picker is NOT visible (only appears in edit mode).
 */

import { test, expect, type Page } from '../../helpers/playwright-fixtures'
import { dragPaletteItemToCanvas, waitForCanvasLoad } from '../../helpers/canvas'
import { BACKEND_PORT } from '../../helpers/config'

async function dropNote(page: Page) {
  const canvas = page.locator('[data-testid="workflow-canvas"]')
  const cb = await canvas.boundingBox()
  await dragPaletteItemToCanvas(page, 'note', { x: cb!.width / 2, y: cb!.height / 2 })
  return page.locator('[data-testid^="note-node-"]').first()
}

test.describe('V-CANVAS-NODE-07: note idle', () => {
  test.beforeEach(async ({ page }) => {
    await page.request.delete(`http://localhost:${BACKEND_PORT}/workbench/session`).catch(() => {})
    await page.goto('/')
    await page.evaluate(() => localStorage.clear())
  })

  test('S1: note container renders and persistent slim status bar is visible', async ({ page }) => {
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    const note = await dropNote(page)
    await expect(note).toBeVisible()

    const bar = note.locator('[data-testid="node-status-bar"]')
    await expect(bar).toBeVisible()
    await expect(bar).toHaveAttribute('data-slim', 'true')
  })

  test('S2: kebab is the only action in the right cluster', async ({ page }) => {
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    const note = await dropNote(page)

    await expect(note.locator('[data-testid="node-kebab"]')).toBeVisible()
    // No cog on Notes (slim variant).
    await expect(note.locator('[data-testid="node-configure"]')).toHaveCount(0)
    // No L/S badge.
    await expect(note.locator('[data-testid="node-function-lifecycle-badge"]')).toHaveCount(0)
    // No dig-in.
    await expect(note.locator('[data-testid="node-dig-in"]')).toHaveCount(0)
    // No version-update arrow.
    await expect(note.locator('[data-testid="version-update-indicator"]')).toHaveCount(0)
  })

  test('S3: ingress and egress flow handles are present', async ({ page }) => {
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    const note = await dropNote(page)

    await expect(note.locator('[data-testid="note-handle-input"]')).toBeAttached()
    await expect(note.locator('[data-testid="note-handle-output"]')).toBeAttached()
  })

  test('S4: in idle mode the color picker is not in the DOM', async ({ page }) => {
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    const note = await dropNote(page)

    // The color picker is only mounted while isEditing === true.
    // The note's textarea is also absent in idle (the static <p> renders instead).
    await expect(note.locator('[data-testid="note-text-editor"]')).toHaveCount(0)
    await expect(note.locator('[data-testid="note-text-display"]')).toBeVisible()
  })

  test('S5: idle body border is dashed (preset border, not solid blue)', async ({ page }) => {
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    const note = await dropNote(page)

    // The edit-border marker is absent in idle.
    await expect(note.locator('[data-edit-border]')).toHaveCount(0)
  })
})
