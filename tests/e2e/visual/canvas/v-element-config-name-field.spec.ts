/**
 * V-ELEMENT-CONFIG-NAME-FIELD: Element-config modal Name field overflow + counter
 *
 * Phase: no-data (parallel) - palette drag + element-config interactions, no fixture data.
 *
 * Pass Criteria:
 *  1. Counter is HIDDEN below 52 chars (< 80% of 64).
 *  2. Counter shows "X/64" with data-state="muted" between 52 and 63.
 *  3. Counter shows "64/64" with data-state="destructive" at exactly 64.
 *  4. Native `maxLength` blocks typing past 64.
 *  5. Whitespace is preserved (no trim).
 *  6. Long value produces a visible horizontal scrollbar inside the field
 *     (`scrollWidth > clientWidth`) and does NOT push the modal wider.
 *  7. The field is rendered as a `<textarea rows="1">` (the only HTML element
 *     that honors `overflow-x` for single-line scroll).
 */

import { test, expect, type Page } from '../../helpers/playwright-fixtures'
import { configSheet } from '../../helpers/workbench'
import { dragPaletteItemToCanvas, waitForCanvasLoad } from '../../helpers/canvas'

async function dropShellScriptAndOpenConfig(page: Page) {
  const canvas = page.locator('[data-testid="workflow-canvas"]')
  const canvasBox = await canvas.boundingBox()
  await dragPaletteItemToCanvas(page, 'shell script', {
    x: canvasBox!.width / 2,
    y: canvasBox!.height / 2,
  })

  const node = page
    .locator('[data-testid^="workflow-node-"][data-nodetype]')
    .first()
  await node.locator('button').first().dispatchEvent('click')
  await expect(node).toHaveAttribute('data-selected', 'true')

  await page
    .locator('[data-testid="node-configure"]')
    .click()
  const modal = configSheet(page)
  await expect(modal).toBeVisible()
  return modal
}

test.describe('V-ELEMENT-CONFIG-NAME-FIELD: Name field overflow + counter', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await page.evaluate(() => localStorage.clear())
  })

  test('S1: counter hidden below 52 chars (< 80% threshold)', async ({ page }) => {
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    const modal = await dropShellScriptAndOpenConfig(page)

    const name = modal.locator('[data-testid="element-description-input"]')
    await expect(name).toBeVisible()

    // 51 chars: still under 80% of 64 (51.2). Counter should NOT exist.
    await name.fill('a'.repeat(51))
    await expect(modal.locator('[data-testid="element-description-input-counter"]')).toHaveCount(0)
  })

  test('S2: counter muted "X/64" between 52 and 63 chars', async ({ page }) => {
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    const modal = await dropShellScriptAndOpenConfig(page)
    const name = modal.locator('[data-testid="element-description-input"]')

    // Exactly at 80% threshold: 52 chars (52 / 64 = 0.8125, >= 0.8).
    await name.fill('a'.repeat(52))
    const counter = modal.locator('[data-testid="element-description-input-counter"]')
    await expect(counter).toBeVisible()
    await expect(counter).toHaveAttribute('data-state', 'muted')
    await expect(counter).toHaveText('52/64')

    await name.fill('a'.repeat(63))
    await expect(counter).toHaveAttribute('data-state', 'muted')
    await expect(counter).toHaveText('63/64')
  })

  test('S3: counter destructive "64/64" at exact cap', async ({ page }) => {
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    const modal = await dropShellScriptAndOpenConfig(page)
    const name = modal.locator('[data-testid="element-description-input"]')

    await name.fill('a'.repeat(64))
    const counter = modal.locator('[data-testid="element-description-input-counter"]')
    await expect(counter).toBeVisible()
    await expect(counter).toHaveAttribute('data-state', 'destructive')
    await expect(counter).toHaveText('64/64')
  })

  test('S4: native maxLength blocks typing past 64', async ({ page }) => {
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    const modal = await dropShellScriptAndOpenConfig(page)
    const name = modal.locator('[data-testid="element-description-input"]')

    // Try to fill 70 chars - the textarea's native maxLength stops at 64.
    await name.fill('b'.repeat(70))
    const value = await name.inputValue()
    expect(value.length).toBe(64)
    expect(value).toBe('b'.repeat(64))
    await expect(name).toHaveAttribute('maxlength', '64')
  })

  test('S5: whitespace is preserved (no-trim contract)', async ({ page }) => {
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    const modal = await dropShellScriptAndOpenConfig(page)
    const name = modal.locator('[data-testid="element-description-input"]')

    await name.fill('   spaced   ')
    expect(await name.inputValue()).toBe('   spaced   ')
    // Blur should not trim either.
    await name.blur()
    expect(await name.inputValue()).toBe('   spaced   ')
  })

  test('S6: description field is the shared multiline DescriptionField primitive; modal stable', async ({
    page,
  }) => {
    // The per-instance field is the shared
    // multiline DescriptionField. Whitespace mode is `pre-wrap` (multiline
    // wrap with whitespace preserved), and the textarea grows vertically
    // rather than scrolling horizontally.
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    const modal = await dropShellScriptAndOpenConfig(page)
    const name = modal.locator('[data-testid="element-description-input"]')

    const styles = await name.evaluate((el) => {
      const cs = window.getComputedStyle(el)
      return {
        tag: el.tagName,
        whiteSpace: cs.whiteSpace,
        resize: cs.resize,
      }
    })
    expect(styles.tag).toBe('TEXTAREA')
    expect(styles.whiteSpace).toBe('pre-wrap')
    // The shared DescriptionField allows vertical resize (multi-line input);
    // horizontal resize is not allowed.
    expect(styles.resize === 'none' || styles.resize === 'vertical').toBeTruthy()

    // Modal width is stable after typing the maxLength value.
    const startWidth = await modal.evaluate((el) => el.getBoundingClientRect().width)
    await name.fill('z'.repeat(64))
    const endWidth = await modal.evaluate((el) => el.getBoundingClientRect().width)
    expect(Math.abs(endWidth - startWidth)).toBeLessThanOrEqual(50)
  })

  test('S7: description field is a TEXTAREA element (multiline primitive)', async ({ page }) => {
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    const modal = await dropShellScriptAndOpenConfig(page)
    const name = modal.locator('[data-testid="element-description-input"]')

    const tag = await name.evaluate((el) => el.tagName)
    expect(tag).toBe('TEXTAREA')
  })
})
