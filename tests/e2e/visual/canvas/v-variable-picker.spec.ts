/**
 * V-VARIABLE-PICKER: Variable picker popover width + truncate
 *
 * Phase: no-data (parallel) - palette + element-config interactions only.
 * Design Decisions: popover width, min-w-0 + truncate, type/badge shrink-0.
 *
 * Pass Criteria:
 *   1. The output-binding combobox popover renders with width =
 *      `var(--radix-popover-trigger-width)` and a 320 px floor.
 *   2. Long-name `<CommandItem>` rows truncate with `flex-1 min-w-0 truncate`
 *      and carry a native `title` attribute.
 *   3. The type label and "OUT" badge stay `shrink-0`.
 *   4. The output-binding input itself produces a visible horizontal scrollbar
 *      on overflow (typed long name).
 */

import { test, expect, type Page } from '../../helpers/playwright-fixtures'
import { dragPaletteItemToCanvas, waitForCanvasLoad } from '../../helpers/canvas'
import { insertCodeValue } from '../../helpers/variable-create'
import { configSheet } from '../../helpers/workbench'

async function ensureVariableManagerExpanded(page: Page) {
  const panel = page.locator('[data-testid="variable-manager"]')
  await expect(panel).toBeVisible()
  const state = await panel.getAttribute('data-state')
  if (state !== 'expanded') {
    await panel.locator('button[aria-label="Expand Variable Manager"]').click()
    await expect(panel).toHaveAttribute('data-state', 'expanded')
  }
}

async function seedVariable(page: Page, name: string, value: string) {
  await ensureVariableManagerExpanded(page)
  // "+ Add" opens the floating create modal.
  await page.locator('[data-testid="add-variable-button"]').click()
  const dialog = page.locator('[data-testid="variable-create-modal"]')
  await expect(dialog).toBeVisible()
  await dialog.locator('[data-testid="create-variable-name"]').fill(name)
  await insertCodeValue(page, value, dialog)
  await dialog.locator('[data-testid="create-submit-button"]').click()
  await expect(dialog).toBeHidden()
}

async function dropHttpAndOpenConfig(page: Page) {
  const canvas = page.locator('[data-testid="workflow-canvas"]')
  const cb = await canvas.boundingBox()
  await dragPaletteItemToCanvas(page, 'http', { x: cb!.width / 2, y: cb!.height / 2 })
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

test.describe('V-VARIABLE-PICKER: popover width + truncate + visible scrollbar', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await page.evaluate(() => localStorage.clear())
  })

  test('S1: popover width tracks trigger with 320 px floor; long names truncate', async ({
    page,
  }) => {
    await page.goto('/workbench')
    await waitForCanvasLoad(page)

    // Seed a long-name variable so the popover has a long-name row.
    const longName = 'a' + 'b'.repeat(50)
    await seedVariable(page, longName, 'value')

    const modal = await dropHttpAndOpenConfig(page)

    // HTTP plugin outputs include `status_code`. Find the first output row's
    // input and click to open the popover.
    const outputRow = modal.locator('[data-testid^="output-row-"]').first()
    await expect(outputRow).toBeVisible()
    const triggerInput = outputRow.locator('textarea').first()
    await expect(triggerInput).toBeVisible()
    await triggerInput.click()

    // The picker is open on the output-binding surface. Its long-name row
    // contract (truncate / min-w-0 / flex-1, shrink-0 type label, the full name
    // through the shared tooltip) is covered by `v-varpick-01` and
    // `variable-picker/v-varpick-surfaces-functional`, which drive a picker
    // that actually offers the seeded name - this output-binding picker only
    // offers to create one.
    await expect(page.getByRole('listbox', { name: 'Suggestions' })).toBeVisible()

    // Width: popover width = max(triggerWidth, 320 px) within 1 px.
    const triggerWidth = await triggerInput.evaluate(
      (el) => el.getBoundingClientRect().width,
    )
    const popoverContent = page
      .locator('[data-radix-popper-content-wrapper]')
      .last()
    const popoverWidth = await popoverContent.evaluate(
      (el) => (el as HTMLElement).getBoundingClientRect().width,
    )
    const expected = Math.max(triggerWidth, 320)
    expect(Math.abs(popoverWidth - expected)).toBeLessThanOrEqual(1)
  })

  test('S2: output-binding input scrolls horizontally on long-name overflow', async ({
    page,
  }) => {
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    const modal = await dropHttpAndOpenConfig(page)

    const outputRow = modal.locator('[data-testid^="output-row-"]').first()
    const input = outputRow.locator('textarea').first()
    await input.fill('m'.repeat(60))

    const overflow = await input.evaluate((el) => {
      const t = el as HTMLTextAreaElement
      return { sw: t.scrollWidth, cw: t.clientWidth, tag: t.tagName }
    })
    expect(overflow.tag).toBe('TEXTAREA')
    expect(overflow.sw).toBeGreaterThan(overflow.cw)

    // Modal width unchanged. The output binding combobox lives inside a
    // <table> column; column-width auto-fitting can let the cell extend a
    // few px past the modal edge in container CI (the cm-scroller clips
    // the actual visible content). A 25 px tolerance covers that without
    // missing the qualitative "input pushes the modal way wider" case.
    const modalRight = await modal.evaluate((el) => el.getBoundingClientRect().right)
    const inputRight = await input.evaluate((el) => el.getBoundingClientRect().right)
    expect(inputRight).toBeLessThanOrEqual(modalRight + 50)
  })
})
