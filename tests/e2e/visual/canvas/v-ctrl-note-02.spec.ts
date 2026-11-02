/**
 * V-CTRL-NOTE-02: Note Control Behavior
 *
 * Covers:
 *   S1 Element config modal stays closed for notes (notes use inline editing).
 *   S2 The gear icon opens the inline editor, not the element config modal.
 *   S3 The inline textarea accepts whitespace and newlines (parent listener
 *      must not call preventDefault for events bubbling from the textarea).
 *   S4 Color presets apply real Tailwind classes (bg-yellow-50, bg-pink-50, ...
 *      must be statically detectable so the JIT keeps them in production).
 *   S5 Deleting via the kebab/context menu does NOT log React Flow error 012
 *      ("Node with id X does not exist") - the delete is deferred so it lands
 *      after the menu close / click drain.
 */

import { test, expect, type Page, type Locator } from '../../helpers/playwright-fixtures'
import { dragPaletteItemToCanvas, waitForCanvasLoad } from '../../helpers/canvas'

const RF_MISSING_NODE = /Node with id .* does not exist/i

async function setupPalette(page: Page) {
  const palette = page.locator('[data-testid="block-palette"]')
  const state = await palette.getAttribute('data-state')
  if (state === 'collapsed') {
    await page.locator('[data-testid="palette-expand-button"]').click()
    await expect(palette).toHaveAttribute('data-state', 'expanded')
  }
}

async function dropNote(page: Page): Promise<Locator> {
  await setupPalette(page)
  const canvas = page.locator('[data-testid="workflow-canvas"]')
  const canvasBox = await canvas.boundingBox()
  expect(canvasBox, 'Canvas must be measurable').not.toBeNull()
  await dragPaletteItemToCanvas(
    page,
    { term: 'note', testId: 'palette-item-note' },
    { x: canvasBox!.width * 0.5, y: canvasBox!.height * 0.45 },
  )
  const note = page.locator('[data-testid^="note-node-"]').first()
  await expect(note, 'Note node should appear').toBeVisible()
  return note
}

/** Capture all console errors so the test can assert on what was logged. */
function captureConsoleErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text())
  })
  page.on('pageerror', (err) => {
    errors.push(err.message)
  })
  return errors
}

test.describe('V-CTRL-NOTE-02: Note control bug regressions', () => {
  test('S1: double-click a note does NOT open the element config modal', async ({ page }) => {
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    const note = await dropNote(page)

    // Double-click should enter inline edit mode (textarea), not the modal.
    await note.dblclick({ position: { x: 50, y: 20 }, force: true })
    await page.waitForTimeout(200)

    // Inline editor visible - inline editing is the only configuration UI for notes.
    await expect(
      page.locator('[data-testid="note-text-editor"]'),
      'Inline textarea should appear on double-click',
    ).toBeVisible()

    // Element config surface must not be present (the config shell is a
    // DraggableSheet since CANVAS-228, so check both shapes).
    await expect(
      page.locator('[data-testid="element-config-sheet"]'),
      'Element config sheet must NOT open for notes',
    ).toHaveCount(0)
    await expect(
      page.locator('[role="dialog"][data-state="open"]'),
      'No dialog must open for notes',
    ).toHaveCount(0)
  })

  test('S2: Note has no gear and double-click opens the inline editor', async ({ page }) => {
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    const note = await dropNote(page)

    // Select the note so its slim status bar is visible.
    await note.click({ position: { x: 50, y: 20 }, force: true })
    await page.waitForTimeout(200)

    // Notes have NO cog. Only kebab is in
    // the right cluster of the slim status bar.
    await expect(note.locator('[data-testid="node-configure"]')).toHaveCount(0)
    await expect(note.locator('[data-testid="node-kebab"]')).toBeVisible()

    // Double-click on the note body enters inline edit mode.
    await note.locator('[data-testid="note-text-display"]').dblclick()
    await expect(
      page.locator('[data-testid="note-text-editor"]'),
      'Double-click should open inline editor',
    ).toBeVisible()
    await expect(
      page.locator('[data-testid="element-config-sheet"]'),
      'Double-click must NOT open the element config sheet',
    ).toHaveCount(0)
    await expect(
      page.locator('[role="dialog"][data-state="open"]'),
      'Double-click must NOT open any dialog',
    ).toHaveCount(0)
  })

  test('S3: typing space and Enter in the textarea inserts whitespace and newlines', async ({ page }) => {
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    const note = await dropNote(page)

    // Enter inline edit mode.
    await note.dblclick({ position: { x: 50, y: 20 }, force: true })
    const textarea = page.locator('[data-testid="note-text-editor"]')
    await expect(textarea).toBeVisible()

    // Clear any selection / pre-fill, then type whitespace + multi-line content.
    await textarea.fill('')
    await textarea.click()
    await page.keyboard.type('hello world')
    await page.keyboard.press('Enter')
    await page.keyboard.type('next line')
    await page.keyboard.press(' ')
    await page.keyboard.type('end')

    // Read the textarea value directly - it must contain the literal space and
    // newline characters. If the parent listener stole the events, the value
    // would collapse to "helloworldnextlineend".
    await expect(textarea).toHaveValue('hello world\nnext line end')

    // Commit the edit and verify the persisted display also has the whitespace.
    await note.locator('[data-testid="note-edit-accept"]').click()
    await page.waitForTimeout(200)
    const display = note.locator('[data-testid="note-text-display"]')
    await expect(display).toContainText('hello world')
    await expect(display).toContainText('next line end')
  })

  test('S4: color presets apply real Tailwind background classes', async ({ page }) => {
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    const note = await dropNote(page)

    // The color picker is only mounted in EDIT mode.
    // Enter edit mode first via double-click.
    await note.locator('[data-testid="note-text-display"]').dblclick()
    await expect(note.locator('[data-testid="note-text-editor"]')).toBeVisible()

    // The note body is the inner div that owns the bg color class. In edit
    // mode it carries `data-edit-border="true"`, which uniquely identifies it.
    const body = note.locator('[data-edit-border="true"]').first()

    // Pick "yellow" from the color picker (now in the edit-mode slim bar).
    const picker = note.locator('[data-testid="note-color-picker"]')
    await picker.click()
    await page.locator('[data-testid="note-color-yellow"]').click()
    await page.waitForTimeout(200)

    // The bg-yellow-50 class must be applied AND it must produce a non-default
    // background-color (proving the class wasn't purged from the CSS bundle).
    await expect(body).toHaveClass(/bg-yellow-50/)
    const yellowBg = await body.evaluate((el) => getComputedStyle(el).backgroundColor)
    expect(yellowBg, 'yellow background must resolve to a real color').not.toBe('rgba(0, 0, 0, 0)')
    expect(yellowBg, 'yellow background must resolve to a real color').not.toBe('transparent')

    // Switch to pink and confirm the class swaps and the computed color changes.
    await picker.click()
    await page.locator('[data-testid="note-color-pink"]').click()
    await page.waitForTimeout(200)
    await expect(body).toHaveClass(/bg-pink-50/)
    await expect(body).not.toHaveClass(/bg-yellow-50/)
    const pinkBg = await body.evaluate((el) => getComputedStyle(el).backgroundColor)
    expect(pinkBg).not.toBe(yellowBg)
  })

  test('S5: deleting a note via kebab menu does not log React Flow error 012', async ({ page }) => {
    const errors = captureConsoleErrors(page)

    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    const note = await dropNote(page)

    // Select the note so the kebab in the slim status bar is interactive.
    await note.click({ position: { x: 50, y: 20 }, force: true })
    await page.waitForTimeout(200)

    // Open kebab and click Delete (Note uses the shared node-kebab testid).
    await note.locator('[data-testid="node-kebab"]').click()
    await page.locator('[data-testid="note-action-delete"]').click()

    // Wait long enough for the deferred delete + any RF onNodeClick drain.
    await page.waitForTimeout(300)

    // Note should be gone.
    await expect(
      page.locator('[data-testid^="note-node-"]'),
      'Note should be removed from the canvas',
    ).toHaveCount(0)

    // No "Node with id X does not exist" error must have been logged.
    const offenders = errors.filter((e) => RF_MISSING_NODE.test(e))
    expect(
      offenders,
      `Expected zero RF "missing node" errors after menu delete, got:\n${offenders.join('\n')}`,
    ).toEqual([])
  })

  test('S5b: deleting a note via right-click context menu does not log RF error 012', async ({ page }) => {
    const errors = captureConsoleErrors(page)

    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    const note = await dropNote(page)

    // Right-click the note to open the context menu, then click Delete.
    await note.click({ position: { x: 50, y: 20 }, force: true, button: 'right' })
    await page.waitForTimeout(200)

    // Context menu items don't have data-testids; locate by role + name.
    const deleteItem = page.getByRole('menuitem', { name: /^Delete$/i }).first()
    await expect(deleteItem).toBeVisible()
    await deleteItem.click()

    await page.waitForTimeout(300)

    await expect(
      page.locator('[data-testid^="note-node-"]'),
      'Note should be removed via context menu',
    ).toHaveCount(0)

    const offenders = errors.filter((e) => RF_MISSING_NODE.test(e))
    expect(
      offenders,
      `Expected zero RF "missing node" errors after context-menu delete, got:\n${offenders.join('\n')}`,
    ).toEqual([])
  })
})
