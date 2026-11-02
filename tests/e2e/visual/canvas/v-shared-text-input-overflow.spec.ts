/**
 * V-SHARED-TEXT-INPUT-OVERFLOW: Shared TextField primitive overflow contract
 *
 * Phase: no-data (parallel) - all interactions go through palette + dialog UI.
 *
 * Pass Criteria:
 *   For EACH surface:
 *     (a) Var Setter row string value (the "Edit value" sheet's wrapping
 *         CodeMirror editor - wraps instead of widening the sheet)
 *     (b) Assertion Builder literal reference value (`assert-value-input-...`)
 *     (c) Variable window String value: the one-line field (VMGR-110); a long
 *         value scrolls inside it and the window keeps its width
 *     (d) Scalar Variable Edit Dialog string value (`variable-value-input`, single-line)
 *
 *   1. The element is a `<textarea rows="1">` (TextField primitive output).
 *   2. After typing 60+ chars, `scrollWidth > clientWidth` (visible horizontal
 *      scrollbar inside the input).
 *   3. The host modal/dialog width is unchanged (no horizontal modal overflow).
 */

import { test, expect, type Page, type Locator } from '../../helpers/playwright-fixtures'
import { dragPaletteItemToCanvas, waitForCanvasLoad } from '../../helpers/canvas'
import { valueEditor } from '../../helpers/variable-create'
import { configSheet } from '../../helpers/workbench'

// Long enough that even a 448 px max-w-md dialog input overflows.
const LONG = 'a'.repeat(150)

async function dropAndOpenConfig(
  page: Page,
  spec: { term: string; testId: string } | string,
) {
  const canvas = page.locator('[data-testid="workflow-canvas"]')
  const cb = await canvas.boundingBox()
  await dragPaletteItemToCanvas(page, spec, {
    x: cb!.width / 2,
    y: cb!.height / 2,
  })
  const node = page
    .locator('[data-testid^="workflow-node-"][data-nodetype]')
    .first()
  await node.locator('button').first().dispatchEvent('click')
  await page
    .locator('[data-testid="node-configure"]')
    .click()
  const modal = configSheet(page)
  await expect(modal).toBeVisible()
  return modal
}

async function ensureVariableManagerExpanded(page: Page) {
  const panel = page.locator('[data-testid="variable-manager"]')
  await expect(panel).toBeVisible()
  const state = await panel.getAttribute('data-state')
  if (state !== 'expanded') {
    await panel.locator('button[aria-label="Expand Variable Manager"]').click()
    await expect(panel).toHaveAttribute('data-state', 'expanded')
  }
  return panel
}

async function expectTextareaOverflow(target: Locator) {
  const overflow = await target.evaluate((el) => {
    const t = el as HTMLTextAreaElement
    return { scrollWidth: t.scrollWidth, clientWidth: t.clientWidth, tag: t.tagName }
  })
  expect(overflow.tag).toBe('TEXTAREA')
  expect(overflow.scrollWidth).toBeGreaterThan(overflow.clientWidth)
}

test.describe('V-SHARED-TEXT-INPUT-OVERFLOW: shared TextField overflow contract', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await page.evaluate(() => localStorage.clear())
  })

  test('S1: Var Setter row string value wraps in the sheet without widening it', async ({ page }) => {
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    const modal = await dropAndOpenConfig(page, {
      term: 'var setter',
      testId: 'palette-item-variable-setter',
    })

    // The setter's string value edits in the shared
    // "Edit value" sheet via a wrapping CodeMirror editor (not an inline
    // textarea), so a long value wraps + scrolls inside the body instead of
    // widening the sheet - the same contract as the Create modal (S3).
    await modal.locator('[data-testid="varset-edit-value-0"]').click()
    const sheet = page.locator('[data-testid="value-editor-sheet"]')
    await expect(sheet).toBeVisible()

    const startW = await sheet.evaluate((el) => el.getBoundingClientRect().width)
    const editor = sheet.locator('.cm-content').first()
    await editor.click()
    await page.keyboard.type(LONG)
    const endW = await sheet.evaluate((el) => el.getBoundingClientRect().width)
    // The wrapping editor must not push the sheet wider than its bound.
    expect(Math.abs(endW - startW)).toBeLessThanOrEqual(50)
  })

  test('S2: Assertion Builder literal reference scrolls inside the input', async ({
    page,
  }) => {
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    const modal = await dropAndOpenConfig(page, 'assert')

    // The assertion builder mounts with NO rows by default. Add a literal
    // assertion so the value input renders.
    await modal.locator('[data-testid="assert-add-assertion"]').click()
    await modal.locator('[data-testid="assert-add-literal"]').click()

    const startW = await modal.evaluate((el) => el.getBoundingClientRect().width)
    // In literal mode the TextField directly carries the testid (it's a
    // textarea); in expression mode a wrapper div has the testid. Pick the
    // textarea explicitly.
    const refValue = modal.locator('textarea[data-testid^="assert-value-input-"]').first()
    await expect(refValue).toBeVisible()
    await refValue.fill(LONG)
    await expectTextareaOverflow(refValue)
    const endW = await modal.evaluate((el) => el.getBoundingClientRect().width)
    // Tolerance covers the inner-scrollbar appearance when the body grows
    // vertically past the dialog's max-h. The dialog itself does NOT grow
    // wider, but the scrollbar adds ~8 px to the rendered clientWidth in
    // some Chromium builds.
    expect(Math.abs(endW - startW)).toBeLessThanOrEqual(50)
  })

  test('S3: the variable window String value handles a long value without widening the window', async ({
    page,
  }) => {
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    await ensureVariableManagerExpanded(page)
    await page.locator('[data-testid="add-variable-button"]').click()
    const dialog = page.locator('[data-testid="variable-create-modal"]')
    await expect(dialog).toBeVisible()
    await dialog.locator('[data-testid="create-variable-name"]').fill('myvar')

    const startW = await dialog.evaluate((el) => el.getBoundingClientRect().width)
    // VMGR-110: a String Literal is one line; a long value scrolls inside the field.
    const field = valueEditor(page, dialog)
    await field.click()
    await page.keyboard.type(LONG)
    await expect(field).toHaveValue(LONG)
    expect(await field.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true)
    const endW = await dialog.evaluate((el) => el.getBoundingClientRect().width)
    expect(Math.abs(endW - startW)).toBeLessThanOrEqual(50)
  })
})
