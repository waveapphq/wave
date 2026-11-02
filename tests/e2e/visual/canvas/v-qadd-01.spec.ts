/**
 * V-QADD-01: Quick Insert Window Anatomy
 *
 * Design Decisions: CANVAS-231..237, CANVAS-242, CANVAS-244, CANVAS-247
 * REQ: REQ-4.2.5
 *
 * Pass Criteria:
 * 1. Ctrl+Space opens a movable window top-center over the canvas area, with a
 *    header bar carrying the "Quick Insert" title and a close control; no
 *    backdrop, search input autofocused.
 * 2. Grouped catalog: PLUGINS / CONTROLS / FUNCTIONS headings; FUNCTIONS
 *    always LEADS with the "New Function" creator row ("empty Local Function"),
 *    and the status line under the list is never blank.
 * 3. The first result is highlighted on open and after every query change.
 * 4. Library Function rows carry the mono version badge.
 * 5. Footer hints: navigate, Enter add after last block, Ctrl+Enter add at
 *    center, PgUp/PgDn page, Esc close, plus two pointer badges (click a row,
 *    drag a row). Alt+Enter is gone.
 * 6. With exactly one block selected the Enter hint reads "add after selection".
 * 7. Substring filter narrows rows and hides empty group headings; no-match
 *    shows the empty state with the footer still present.
 * 8. The header drags the window; the close control and Esc both dismiss it;
 *    a press on the header returns the caret to the search box.
 * 9. The shortcut never fires from a text input (focus guard).
 */

import { test, expect, type Page } from '../../helpers/playwright-fixtures'
import { expandPalette, waitForCanvasLoad } from '../../helpers/canvas'
import { publishLibraryFunction } from '../../helpers/fn-seed'
import { applyQuickAddSearch, QUICK_ADD_STATUS } from '../../helpers/quick-add'
import { BACKEND_URL } from '../../helpers/config'
import { randomUUID } from 'node:crypto'

/** S3's fixture prefix. S4 asserts no Function name contains "del", so the
 *  suffix alphabet must be hex - "l" is not a hex digit. */
const BADGE_PREFIX = 'qadd_badge_'

const POPOVER = '[data-testid="quick-add-popover"]'
const HANDLE = '[data-testid="quick-add-popover-drag-handle"]'

/** Every line the status strip is allowed to show (CANVAS-242). */
const STATUS_LINE = new RegExp(
  '^(Loading Functions…|Loading more Functions…|No Functions published yet|' +
    'No Functions match|\\d+ Functions( - refine your search to narrow down)?)$',
)

async function openWorkbench(page: Page) {
  await page.request.delete(`${BACKEND_URL}/workbench/session`).catch(() => {})
  await page.goto('/workbench')
  await page.evaluate(() => localStorage.clear())
  await page.goto('/workbench')
  await waitForCanvasLoad(page)
}

async function openQuickAdd(page: Page) {
  // Focus must NOT be in a text input; the canvas page body is fine.
  await page.locator('[data-testid="workflow-canvas"]').click({ position: { x: 40, y: 40 } })
  await page.keyboard.press('Control+Space')
  await expect(page.locator(POPOVER)).toBeVisible({ timeout: 5_000 })
}

/** The testid of the row cmdk currently highlights. */
async function highlightedRow(page: Page): Promise<string | null> {
  return page
    .locator(`${POPOVER} [data-slot="command-item"][data-selected="true"]`)
    .first()
    .getAttribute('data-testid')
}

test.describe('V-QADD-01: Quick Insert window anatomy', () => {
  // The Function library outlives the container's DB resets, so S3's entry
  // would otherwise reach every later spec in the shard.
  test.afterAll(async ({ request }) => {
    const listed = await request.get(
      `${BACKEND_URL}/functions?search=${BADGE_PREFIX}&per_page=100`,
    )
    expect(listed.ok(), `cleanup list failed: ${listed.status()}`).toBeTruthy()
    const left = (await listed.json()).data as Array<{ id: string; name: string }>
    for (const fn of left) {
      const deleted = await request.delete(`${BACKEND_URL}/functions/${fn.id}?cascade=true`)
      expect(deleted.ok(), `cleanup delete of ${fn.name} failed: ${deleted.status()}`).toBeTruthy()
    }
    const after = await request.get(
      `${BACKEND_URL}/functions?search=${BADGE_PREFIX}&per_page=100`,
    )
    expect((await after.json()).pagination.total, 'S3 fixtures left behind').toBe(0)
  })

  test('S1: Ctrl+Space opens a titled window top-center over the canvas, input focused, no backdrop', async ({
    page,
  }) => {
    await openWorkbench(page)
    await openQuickAdd(page)

    const popover = page.locator(POPOVER)

    // Top-center over the canvas area (CANVAS-231): horizontally centered, sat
    // near the top of the canvas - never over the viewport center, which is
    // where a centered insert lands.
    const canvasBox = await page.locator('[data-testid="workflow-canvas"]').boundingBox()
    const popBox = await popover.boundingBox()
    const viewport = page.viewportSize()!
    const popCenterX = popBox!.x + popBox!.width / 2
    expect(Math.abs(popCenterX - viewport.width / 2)).toBeLessThanOrEqual(10)
    expect(popBox!.y - canvasBox!.y, 'sits at the top of the canvas').toBeLessThanOrEqual(80)

    // Header bar: title at the left, close control at the right edge.
    const header = page.locator(HANDLE)
    await expect(header.getByText('Quick Insert', { exact: true })).toBeVisible()
    const close = header.getByRole('button', { name: 'Close' })
    await expect(close).toBeVisible()
    const titleBox = await header.getByText('Quick Insert', { exact: true }).boundingBox()
    const closeBox = await close.boundingBox()
    expect(titleBox!.x).toBeLessThan(closeBox!.x)

    // Search input autofocused.
    const input = popover.locator('input')
    await expect(input).toBeFocused()
    await expect(input).toHaveAttribute('placeholder', 'Search blocks…')

    // Non-blocking, no backdrop: clicking the canvas pane behind neither
    // errors nor dismisses the window (only Esc / close / insert close it).
    await page.locator('.react-flow__pane').click({ position: { x: 60, y: 300 } })
    await expect(popover).toBeVisible()

    // The close control dismisses it.
    await close.click()
    await expect(popover).toHaveCount(0)

    // ESC dismisses it too.
    await openQuickAdd(page)
    await page.keyboard.press('Escape')
    await expect(popover).toHaveCount(0)
  })

  test('S2: grouped catalog, first row highlighted, New Function creator row', async ({
    page,
  }) => {
    await openWorkbench(page)
    await openQuickAdd(page)
    const popover = page.locator(POPOVER)

    // Group headings (CANVAS-232).
    await expect(popover.getByText('PLUGINS', { exact: true })).toBeVisible()
    await expect(popover.getByText('CONTROLS', { exact: true })).toBeVisible()
    await expect(popover.getByText('FUNCTIONS', { exact: true })).toBeVisible()

    // Representative row: colored icon + name + right-aligned category label.
    const httpRow = popover.locator('[data-testid="quick-add-item-http-client"]')
    await expect(httpRow).toBeVisible()
    await expect(httpRow).toContainText('HTTP')
    await expect(httpRow).toContainText('Network')
    await expect(httpRow.locator('svg')).toBeVisible()

    // The first row is highlighted on open.
    expect(await highlightedRow(page)).toBe('quick-add-item-http-client')

    // New Function creator row, LEADING the FUNCTIONS group (CANVAS-244): the
    // bottom of the list is what asks for the next page of published
    // Functions, so the creator row can never sit there.
    const functionsGroup = popover
      .locator('[data-slot="command-group"]')
      .filter({ has: page.locator('[cmdk-group-heading]:text-is("FUNCTIONS")') })
    await expect(functionsGroup.locator('[data-slot="command-item"]').first()).toHaveAttribute(
      'data-testid',
      'quick-add-item-new-function',
    )
    const newFnRow = popover.locator('[data-testid="quick-add-item-new-function"]')
    await newFnRow.scrollIntoViewIfNeeded()
    await expect(newFnRow).toBeVisible()
    await expect(newFnRow).toContainText('New Function')
    await expect(newFnRow).toContainText('empty Local Function')

    // CANVAS-242: the status line under the list always describes the Function
    // half and is never blank, whatever the ambient library happens to hold.
    await expect(popover.locator(QUICK_ADD_STATUS)).toHaveText(STATUS_LINE)

    await page.keyboard.press('Escape')
  })

  test('S3: library Function row carries the version badge', async ({ page, request }) => {
    const fn = await publishLibraryFunction(request, {
      name: `${BADGE_PREFIX}${randomUUID().slice(0, 8)}`,
    })
    await openWorkbench(page)
    await openQuickAdd(page)
    const popover = page.locator(POPOVER)

    // Narrow to the seeded entry so the row is in view regardless of catalog size.
    await popover.locator('input').fill(fn.name)
    const fnRow = popover.locator(`[data-testid="quick-add-item-${fn.functionId}"]`)
    await expect(fnRow).toBeVisible()
    await expect(fnRow).toContainText(fn.name)
    const badge = fnRow.locator('span.font-mono')
    await expect(badge).toBeVisible()
    await expect(badge).toHaveText('v1.0.0')

    await page.keyboard.press('Escape')
  })

  test('S4: substring filter narrows rows, hides empty groups, no-match keeps the footer', async ({
    page,
  }) => {
    await openWorkbench(page)
    await openQuickAdd(page)
    const popover = page.locator(POPOVER)
    const rows = popover.locator('[data-slot="command-item"]')

    // "del" is a substring of the NAME - exactly K8s Delete and Delay, in
    // catalog order (plugins before controls), and the FUNCTIONS group hides.
    // The Function half is searched on the server (CANVAS-241), so the count
    // is only meaningful once that answer has landed: on the built-ins beat it
    // reads 2 whatever the server would have said.
    const delFunctions = await applyQuickAddSearch(page, 'del')
    expect(
      delFunctions.names,
      'a sibling spec published a Function whose name contains "del"',
    ).toEqual([])
    // CANVAS-247: the heading a zero-row group cannot show, the line carries.
    await expect(popover.locator(QUICK_ADD_STATUS)).toHaveText('No Functions match')
    await expect(rows).toHaveCount(2)
    await expect(rows.nth(0)).toHaveAttribute('data-testid', 'quick-add-item-k8s-delete')
    await expect(rows.nth(1)).toHaveAttribute('data-testid', 'quick-add-item-delay')
    await expect(popover.getByText('FUNCTIONS', { exact: true })).toHaveCount(0)
    // The first remaining row is highlighted after the query change.
    expect(await highlightedRow(page)).toBe('quick-add-item-k8s-delete')

    // No match: the empty state shows and the footer hints stay put.
    await popover.locator('input').fill('zzzz-no-such-item')
    await expect(popover.getByText('No matching items')).toBeVisible()
    await expect(popover.getByText('close', { exact: true })).toBeVisible()

    await page.keyboard.press('Escape')
    await expect(popover).toHaveCount(0)
  })

  test('S5: footer names the anchor in force and carries both pointer badges', async ({
    page,
  }) => {
    await openWorkbench(page)
    await openQuickAdd(page)
    const popover = page.locator(POPOVER)

    // Nothing selected on a clean canvas: Enter adds after the last block.
    for (const label of [
      'navigate',
      'add after last block',
      'add at center',
      'page',
      'close',
      'click a row to add',
      'drag a row onto the canvas',
    ]) {
      await expect(popover.getByText(label, { exact: true })).toBeVisible()
    }
    const kbdTexts = await popover.locator('kbd').allTextContents()
    expect(kbdTexts).toContain('Enter')
    expect(kbdTexts).toContain('Ctrl+Enter')
    expect(kbdTexts).toContain('PgUp')
    expect(kbdTexts).toContain('PgDn')
    expect(kbdTexts).toContain('Tab')
    expect(kbdTexts).toContain('Esc')
    // The removed insert mode is named nowhere.
    expect(kbdTexts).not.toContain('Alt+Enter')
    await expect(popover.getByText('add after selection', { exact: true })).toHaveCount(0)

    // Both pointer affordances lead with a mouse badge.
    for (const testId of ['quick-add-hint-click', 'quick-add-hint-pointer']) {
      const hint = popover.locator(`[data-testid="${testId}"]`)
      await expect(hint.locator('kbd svg')).toBeVisible()
    }

    // Insert a Log from the clean canvas: the placed block becomes the selection.
    await popover.locator('input').fill('log')
    await page.keyboard.press('Enter')
    await expect(popover).toHaveCount(0)
    await expect(
      page.locator('[data-testid^="workflow-node-"][data-nodetype][data-selected="true"]'),
    ).toHaveCount(1)

    // With one block selected the Enter hint names that anchor instead.
    await page.keyboard.press('Control+Space')
    await expect(popover).toBeVisible()
    await expect(popover.getByText('add after selection', { exact: true })).toBeVisible()
    await expect(popover.getByText('add after last block', { exact: true })).toHaveCount(0)

    await page.keyboard.press('Escape')
  })

  test('S6: the header drags the window and a press on it returns the caret', async ({
    page,
  }) => {
    await openWorkbench(page)
    await openQuickAdd(page)
    const popover = page.locator(POPOVER)
    const before = await popover.boundingBox()

    // The header bar is the drag handle.
    const handle = page.locator(HANDLE)
    const handleBox = await handle.boundingBox()
    await page.mouse.move(handleBox!.x + 40, handleBox!.y + handleBox!.height / 2)
    await page.mouse.down()
    for (let i = 1; i <= 5; i++) {
      await page.mouse.move(
        handleBox!.x + 40 + (120 * i) / 5,
        handleBox!.y + handleBox!.height / 2 + (60 * i) / 5,
      )
    }
    await page.mouse.up()
    const after = await popover.boundingBox()
    expect(Math.abs(after!.x - before!.x)).toBeGreaterThan(40)
    expect(Math.abs(after!.y - before!.y)).toBeGreaterThan(20)

    // The drag cancels the mouse event, so the caret is restored from the
    // pointer event - typing after a header press still reaches the search box.
    await expect(popover.locator('input')).toBeFocused()
    await page.keyboard.type('log')
    await expect(popover.locator('input')).toHaveValue('log')

    await page.keyboard.press('Escape')
  })

  test('S7: shortcut is focus-guarded - never fires from a text input', async ({ page }) => {
    await openWorkbench(page)
    await expandPalette(page)
    const search = page.locator('[data-testid="palette-search-input"]')
    await search.click()
    await expect(search).toBeFocused()
    await page.keyboard.press('Control+Space')
    // Give a would-be open a beat to render before asserting absence.
    await page.waitForTimeout(300)
    await expect(page.locator(POPOVER)).toHaveCount(0)
  })
})
