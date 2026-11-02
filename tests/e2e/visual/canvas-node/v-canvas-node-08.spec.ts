/**
 * V-CANVAS-NODE-08: Note edit-mode chrome morph
 *
 * Design Decisions: Note Control (edit-mode is the single allowed chrome morph).
 *
 * Phase: no-data (parallel) - drops a Note, double-clicks to enter edit mode.
 *
 * Pass Criteria:
 *   1. Double-clicking the note enters edit mode (textarea visible).
 *   2. Status bar shows the color picker (left) + accept (green) + cancel (red) (right).
 *   3. Body border switches to solid 2 px blue (`[data-edit-border="true"]`).
 *   4. Double-click does NOT zoom the canvas.
 *   5. Pressing Escape, clicking Cancel, or clicking Accept all return the note to idle.
 *   6. After Accept/Cancel the note re-receives focus so Backspace immediately unlinks.
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

async function enterEditMode(note: ReturnType<Page['locator']>) {
  // Double-click on the note text area; the dblclick listener calls stopPropagation
  // + preventDefault before enterEditMode so React Flow's canvas-zoom does NOT fire.
  await note.locator('[data-testid="note-text-display"]').dblclick()
  await expect(note.locator('[data-testid="note-text-editor"]')).toBeVisible()
}

test.describe('V-CANVAS-NODE-08: note edit-mode chrome morph', () => {
  test.beforeEach(async ({ page }) => {
    await page.request.delete(`http://localhost:${BACKEND_PORT}/workbench/session`).catch(() => {})
    await page.goto('/')
    await page.evaluate(() => localStorage.clear())
  })

  test('S1: double-click enters edit mode; textarea is visible', async ({ page }) => {
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    const note = await dropNote(page)
    await enterEditMode(note)

    await expect(note.locator('[data-testid="note-text-editor"]')).toBeVisible()
    await expect(note.locator('[data-testid="note-text-display"]')).toHaveCount(0)
  })

  test('S2: status bar morphs - accept + cancel appear on the right, color picker on left', async ({ page }) => {
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    const note = await dropNote(page)
    await enterEditMode(note)

    await expect(note.locator('[data-testid="note-edit-accept"]')).toBeVisible()
    await expect(note.locator('[data-testid="note-edit-cancel"]')).toBeVisible()
    // Color picker trigger lives in the left cluster of the morphed status bar.
    await expect(note.locator('[data-testid="node-status-bar-left"] button').first()).toBeVisible()
    // Kebab is hidden during edit.
    await expect(note.locator('[data-testid="node-kebab"]')).toHaveCount(0)
  })

  test('S3: body border switches to solid blue (data-edit-border="true")', async ({ page }) => {
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    const note = await dropNote(page)
    await enterEditMode(note)

    const editBorder = note.locator('[data-edit-border="true"]')
    await expect(editBorder).toBeVisible()
    await expect(editBorder).toHaveClass(/border-blue-500/)
    await expect(editBorder).toHaveClass(/border-2/)
  })

  test('S4: double-click does NOT zoom the canvas', async ({ page }) => {
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    const note = await dropNote(page)

    // Sample the React Flow viewport transform before dblclick. Then dblclick
    // to enter edit mode. The transform must NOT have changed.
    const viewportBefore = await page
      .locator('.react-flow__viewport')
      .first()
      .evaluate((el) => (el as HTMLElement).style.transform)
    await enterEditMode(note)
    const viewportAfter = await page
      .locator('.react-flow__viewport')
      .first()
      .evaluate((el) => (el as HTMLElement).style.transform)

    expect(viewportAfter).toBe(viewportBefore)
  })

  test('S5: Escape exits edit mode back to idle', async ({ page }) => {
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    const note = await dropNote(page)
    await enterEditMode(note)

    await page.keyboard.press('Escape')
    await expect(note.locator('[data-testid="note-text-editor"]')).toHaveCount(0)
    await expect(note.locator('[data-testid="note-text-display"]')).toBeVisible()
    // Kebab is back on the bar after exit.
    await expect(note.locator('[data-testid="node-kebab"]')).toBeVisible()
  })

  test('S6: Cancel button exits edit mode', async ({ page }) => {
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    const note = await dropNote(page)
    await enterEditMode(note)

    await note.locator('[data-testid="note-edit-cancel"]').click()
    await expect(note.locator('[data-testid="note-text-editor"]')).toHaveCount(0)
  })

  test('S7: Accept button exits edit mode and commits the text', async ({ page }) => {
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    const note = await dropNote(page)
    await enterEditMode(note)

    const textarea = note.locator('[data-testid="note-text-editor"]')
    await textarea.fill('hello world')
    await note.locator('[data-testid="note-edit-accept"]').click()

    await expect(note.locator('[data-testid="note-text-editor"]')).toHaveCount(0)
    await expect(note.locator('[data-testid="note-text-display"]')).toHaveText('hello world')
  })
})
