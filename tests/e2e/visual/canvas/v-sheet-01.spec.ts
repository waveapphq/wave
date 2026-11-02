/**
 * V-SHEET-01: Config Sheet Chrome + Cascade
 *
 * Design Decisions: CANVAS-227, CANVAS-228, CANVAS-229
 * REQ: REQ-3.1.1.5
 *
 * Pass Criteria:
 * 1. Sheet header reads "<Name> - Edit Config" with the element icon and an
 *    X close button; the header is the drag handle.
 * 2. No backdrop: the page behind stays interactive (palette focusable) and
 *    click-outside never dismisses the sheet.
 * 3. Two sheets cascade +28px right/down per open-order slot.
 * 4. Pointer-down on a sheet brings it to front; ESC closes ONLY the
 *    front-most sheet.
 * 5. The shared right-edge resize handle widens the sheet (520-1200 clamp).
 * 6. The 11th open is refused with the cap toast; 10 sheets remain.
 */

import { test, expect, type Page, type APIRequestContext } from '../../helpers/playwright-fixtures'
import { createValidTest, logNode, startEdge, openTest } from '../../helpers/fn-seed'

const SHEET = '[data-testid="element-config-sheet"]'

function nodeIds(count: number): string[] {
  return Array.from({ length: count }, (_, i) => `log-${i + 1}`)
}

async function seedLogs(request: APIRequestContext, count: number): Promise<string> {
  const ids = nodeIds(count)
  const nodes = ids.map((id, i) =>
    logNode(id, `Log ${String.fromCharCode(65 + i)}`, "'x'", {
      x: 120 + (i % 4) * 220,
      y: 120 + Math.floor(i / 4) * 160,
    }),
  )
  return createValidTest(request, {
    name: `V-SHEET-01 ${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    nodes,
    edges: [startEdge(ids[0])],
  })
}

/** Open a node's config sheet via select + gear, dispatching events so the
 *  open is immune to already-open sheets covering the node (hit-test-free). */
async function openSheetForNode(page: Page, nodeId: string) {
  const node = page.locator(`[data-testid="workflow-node-${nodeId}"]`)
  await node.locator('button').first().dispatchEvent('click')
  await expect(node).toHaveAttribute('data-selected', 'true')
  await node.locator('[data-testid="node-configure"]').dispatchEvent('click')
}

test.describe('V-SHEET-01: config sheet chrome + cascade', () => {
  test('S1: header title, icon, X close, drag handle, no backdrop', async ({
    page,
    request,
  }) => {
    const testId = await seedLogs(request, 2)
    await openTest(page, testId)

    await openSheetForNode(page, 'log-1')
    const sheet = page.locator(SHEET)
    await expect(sheet).toBeVisible()

    // CANVAS-228 header anatomy.
    const heading = sheet.getByRole('heading', { name: 'Log A - Edit Config' })
    await expect(heading).toBeVisible()
    await expect(heading.locator('svg')).toBeVisible()
    const dragHandle = sheet.locator('[data-testid="element-config-sheet-drag-handle"]')
    await expect(dragHandle).toBeVisible()
    await expect(dragHandle).toHaveCSS('cursor', 'grab')
    await expect(dragHandle.locator('button[aria-label="Close"]')).toBeVisible()

    // Header title live-follows the Name field.
    await sheet.locator('[data-testid="element-name-input"]').fill('Renamed Log')
    await expect(
      sheet.getByRole('heading', { name: 'Renamed Log - Edit Config' }),
    ).toBeVisible()

    // No backdrop (CANVAS-227): the palette behind is still interactive and
    // click-outside never dismisses the sheet.
    await page.locator('.react-flow__pane').click({ position: { x: 60, y: 60 }, force: true })
    await expect(sheet).toBeVisible()
    const paletteSearch = page.locator('[data-testid="palette-search-input"]')
    if (await paletteSearch.isVisible().catch(() => false)) {
      await paletteSearch.click()
      await expect(paletteSearch).toBeFocused()
    }
    await expect(sheet).toBeVisible()
  })

  test('S2: two sheets cascade +28px; bring-to-front; ESC closes front-most only', async ({
    page,
    request,
  }) => {
    const testId = await seedLogs(request, 2)
    await openTest(page, testId)

    await openSheetForNode(page, 'log-1')
    await openSheetForNode(page, 'log-2')
    const sheets = page.locator(SHEET)
    await expect(sheets).toHaveCount(2)

    // Cascade: the second sheet sits +28px right/down from the first.
    const boxA = await sheets.nth(0).boundingBox()
    const boxB = await sheets.nth(1).boundingBox()
    expect(Math.round(boxB!.x - boxA!.x)).toBe(28)
    expect(Math.round(boxB!.y - boxA!.y)).toBe(28)

    // The later-opened sheet is front-most.
    const zOf = (i: number) =>
      sheets.nth(i).evaluate((el) => Number((el as HTMLElement).style.zIndex))
    expect(await zOf(1)).toBeGreaterThan(await zOf(0))

    // Pointer-down on sheet A brings it to front (CANVAS-227).
    await sheets.nth(0).dispatchEvent('pointerdown')
    await expect
      .poll(async () => (await zOf(0)) - (await zOf(1)))
      .toBeGreaterThan(0)

    // ESC closes ONLY the front-most sheet (now A = "Log A").
    await page.keyboard.press('Escape')
    await expect(sheets).toHaveCount(1)
    await expect(
      sheets.first().getByRole('heading', { name: 'Log B - Edit Config' }),
    ).toBeVisible()

    await page.keyboard.press('Escape')
    await expect(sheets).toHaveCount(0)
  })

  test('S3: right-edge resize handle widens the sheet', async ({ page, request }) => {
    const testId = await seedLogs(request, 1)
    await openTest(page, testId)
    await openSheetForNode(page, 'log-1')
    const sheet = page.locator(SHEET)
    await expect(sheet).toBeVisible()

    const handle = sheet.locator('[data-testid="dialog-resize-handle"]')
    await expect(handle).toBeAttached()

    const before = (await sheet.boundingBox())!.width
    // Retry the whole drag: under shard CPU contention a synthetic mouse
    // sequence can land before the handle's listener is committed.
    await expect(async () => {
      const hb = await handle.boundingBox()
      await page.mouse.move(hb!.x + hb!.width / 2, hb!.y + hb!.height / 2)
      await page.mouse.down()
      await page.mouse.move(hb!.x + hb!.width / 2 + 120, hb!.y + hb!.height / 2, { steps: 6 })
      await page.mouse.up()
      const width = (await sheet.boundingBox())!.width
      expect(width).toBeGreaterThan(before)
    }).toPass({ timeout: 15_000 })

    const after = (await sheet.boundingBox())!.width
    expect(after).toBeGreaterThan(before)
    expect(after).toBeLessThanOrEqual(1200)
  })

  test('S4: the 11th open is refused with the cap toast (CANVAS-229)', async ({
    page,
    request,
  }) => {
    const testId = await seedLogs(request, 11)
    await openTest(page, testId)

    const ids = nodeIds(11)
    for (const id of ids.slice(0, 10)) {
      await openSheetForNode(page, id)
    }
    await expect(page.locator(SHEET)).toHaveCount(10)

    // The cap toast lives on the double-click open path (the canvas
    // layer); dispatch the dblclick so the covering sheets cannot block it.
    await page
      .locator(`[data-testid="workflow-node-${ids[10]}"]`)
      .locator('button')
      .first()
      .dispatchEvent('dblclick')
    const toast = page
      .locator('[data-toast]')
      .filter({ hasText: '10 config sheets open. Close one to open another.' })
    await expect(toast.first()).toBeVisible({ timeout: 5_000 })
    await expect(page.locator(SHEET)).toHaveCount(10)
  })
})
