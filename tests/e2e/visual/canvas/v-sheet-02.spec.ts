/**
 * V-SHEET-02: Functions Library on the DraggableSheet primitive
 *
 * Design Decisions: CANVAS-227, CANVAS-230, FN-LC-6
 * REQ: REQ-5.2.1.38
 *
 * Pass Criteria:
 * 1. The library sheet carries the shared right-edge resize handle and
 *    its chrome is otherwise unchanged (search, refresh, grid).
 * 2. Header drag still moves the sheet; adjusted geometry is restored when
 *    the sheet is reopened in the same session.
 * 3. The From-library link opens the library SIDE BY SIDE with the config
 *    sheet (config sheet stays open - CANVAS-230), search seeded.
 */

import { test, expect, type Page } from '../../helpers/playwright-fixtures'
import { expandPalette, waitForCanvasLoad } from '../../helpers/canvas'
import { configSheet } from '../../helpers/workbench'
import {
  createValidTest,
  openTest,
  publishLibraryFunction,
  sharedNode,
  startEdge,
} from '../../helpers/fn-seed'
import { randomUUID } from 'node:crypto'

const LIBRARY = '[data-testid="functions-library"]'
const HANDLE = '[data-testid="functions-library-drag-handle"]'

async function openWorkbench(page: Page) {
  await page.goto('/workbench')
  await page.evaluate(() => localStorage.clear())
  await page.goto('/workbench')
  await waitForCanvasLoad(page)
}

async function openLibraryFromPalette(page: Page) {
  await expandPalette(page)
  await page.locator('[data-testid="palette-blocks-library-button"]').click()
  await expect(page.locator(LIBRARY)).toBeVisible({ timeout: 10_000 })
}

test.describe('V-SHEET-02: library sheet on the DraggableSheet primitive', () => {
  test('S1: resize handle present; chrome unchanged; drag works; geometry restored on reopen', async ({
    page,
    request,
  }) => {
    // Seed a function so the library is non-empty (an empty library renders
    // EMPTY_COPY with no search input); S1 must not rely on cross-test pollution.
    await publishLibraryFunction(request, {
      name: `sheet02s1_${randomUUID().slice(0, 6)}`,
    })
    await openWorkbench(page)
    await openLibraryFromPalette(page)
    const library = page.locator(LIBRARY)

    // The shared resize handle is part of the sheet shell.
    await expect(library.locator('[data-testid="dialog-resize-handle"]')).toBeAttached()

    // Library chrome unchanged by the migration (baseline parity).
    await expect(
      library.locator('textarea[aria-label="Search Functions"], input[aria-label="Search Functions"]').first(),
    ).toBeVisible({ timeout: 10_000 })
    await expect(library.locator('[data-testid="functions-library-refresh-button"]')).toBeVisible()
    await expect(library.locator(HANDLE)).toBeVisible()

    // Drag via the header handle (primitive-owned drag + clamping).
    const before = await library.boundingBox()
    const hb = await page.locator(HANDLE).boundingBox()
    // Grab a button-free spot on the handle (buttons stop pointerdown).
    const grabX = hb!.x + 30
    const grabY = hb!.y + hb!.height / 2
    await page.mouse.move(grabX, grabY)
    await page.mouse.down()
    await page.mouse.move(grabX - 120, grabY - 60, { steps: 8 })
    await page.mouse.up()
    const after = await library.boundingBox()
    expect(Math.round(after!.x - before!.x)).toBe(-120)
    expect(Math.round(after!.y - before!.y)).toBe(-60)

    // Close + reopen restores the adjusted position (session memory).
    await library.locator('button[aria-label="Close"]').click()
    await expect(library).toHaveCount(0)
    await openLibraryFromPalette(page)
    const reopened = await page.locator(LIBRARY).boundingBox()
    expect(Math.abs(reopened!.x - after!.x)).toBeLessThanOrEqual(2)
    expect(Math.abs(reopened!.y - after!.y)).toBeLessThanOrEqual(2)
  })

  test('S2: From-library opens the library side by side with the config sheet, search seeded', async ({
    page,
    request,
  }) => {
    const fn = await publishLibraryFunction(request, {
      name: `sheet02_${randomUUID().slice(0, 6)}`,
    })
    const testId = await createValidTest(request, {
      name: `V-SHEET-02 ${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      nodes: [
        sharedNode('fn-1', {
          functionId: fn.functionId,
          functionVersion: fn.version,
          label: fn.name,
          originalLibraryName: fn.name,
          position: { x: 200, y: 160 },
        }),
      ],
      edges: [startEdge('fn-1')],
    })
    await openTest(page, testId)

    // Open the Shared instance config sheet.
    const node = page.locator('[data-testid="workflow-node-fn-1"]')
    await node.locator('button').first().dblclick()
    const sheet = configSheet(page)
    await expect(sheet).toBeVisible({ timeout: 10_000 })

    // From-library opens the library WITHOUT closing the config sheet.
    await sheet.locator('[data-testid="function-from-library-link"]').click()
    const library = page.locator(LIBRARY)
    await expect(library).toBeVisible({ timeout: 10_000 })
    await expect(sheet).toBeVisible()

    // Library search is seeded with the source entry's name.
    const search = library
      .locator('textarea[aria-label="Search Functions"], input[aria-label="Search Functions"]')
      .first()
    await expect(search).toHaveValue(fn.name)

    // The focused library stacks above the config sheet (focusSheet path).
    const zLibrary = await library.evaluate((el) => Number((el as HTMLElement).style.zIndex))
    const zSheet = await sheet.evaluate((el) => Number((el as HTMLElement).style.zIndex))
    expect(zLibrary).toBeGreaterThan(zSheet)
  })
})
