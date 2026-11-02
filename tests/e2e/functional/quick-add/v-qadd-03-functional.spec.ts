/**
 * V-QADD-03 (functional): every published Function is reachable from Quick
 * Insert, however large the library is.
 *
 * Design Decisions: CANVAS-241, CANVAS-244, CANVAS-245, CANVAS-246,
 *                   CANVAS-247, PICKER-1
 * REQ: REQ-4.2.5
 *
 * The window pages through the whole library. This fixture publishes 110 Functions
 * under one prefix - more than one page - and drives the picker to the last of them.
 *
 * Pass Criteria:
 * 1. A search that matches all 110 shows the first 25, and the status line
 *    reads "110 Functions - refine your search to narrow down".
 * 2. The query narrows the built-in half too: no plugin, control or creator
 *    row survives it.
 * 3. Each scroll to the bottom of the list appends exactly one more page of
 *    25, alphabetically, up to 110; the line then reads "110 Functions".
 * 4. The search stays applied on every page - no non-matching row ever
 *    appears.
 * 5. PageDown from the middle of a page stops on the last row the user could
 *    read and reveals the page below it; PageUp from inside that page stops on
 *    its top row and reveals the page above it; neither steps over a row.
 *    Page-sized presses then walk the whole library without ever stepping past
 *    a row on screen, stop on the 110th Function, and Enter inserts it.
 * 6. Reaching the last loaded row with the arrow keys asks for the next page
 *    exactly as the mouse does.
 * 7. Changing the search restarts at the first page.
 */

import { randomUUID } from 'node:crypto'

import {
  test,
  expect,
  type APIRequestContext,
  type Page,
} from '../../helpers/playwright-fixtures'
import { waitForCanvasLoad } from '../../helpers/canvas'
import {
  applyQuickAddSearch,
  scrollQuickAddListToBottom,
  QUICK_ADD_LIST,
  QUICK_ADD_POPOVER,
  QUICK_ADD_ROWS,
  QUICK_ADD_STATUS,
} from '../../helpers/quick-add'
import { BACKEND_URL } from '../../helpers/config'

/** Past one page, with a clean last page. */
const SEEDED = 110
const PAGE_SIZE = 25
// The functional database is shared with every sibling spec that publishes
// Functions, so the fixture owns a per-run namespace and scopes the picker to
// it through the search box.
const PREFIX = `QADDP${randomUUID().slice(0, 8)}`
const HIGHLIGHTED = `${QUICK_ADD_POPOVER} [data-slot="command-item"][data-selected="true"]`

// Publishing costs time proportional to the library already held, so one
// request for the whole fixture grows past the default request timeout. Ten
// per request keeps the slowest one near two seconds.
const BATCH_CHUNK = 10
const BATCH_TIMEOUT_MS = 60_000
/** Enough rounds to drain 110 at 100 per listing, plus a retry for a bad chunk. */
const CLEANUP_ROUNDS = 5

/** Zero-padded so alphabetical order is numeric order. */
const fnName = (n: number): string => `${PREFIX} Fn ${String(n).padStart(3, '0')}`

const fixtureListUrl = (perPage: number): string =>
  `${BACKEND_URL}/functions?search=${encodeURIComponent(PREFIX)}&per_page=${perPage}`

/**
 * Remove every Function carrying this run's prefix, whatever the seeding
 * managed to report: a create that timed out may still have landed, and a
 * fixture left behind would break the sibling specs that assert on an
 * unmatched query.
 */
async function removeFixtureFunctions(request: APIRequestContext): Promise<void> {
  for (let round = 0; round < CLEANUP_ROUNDS; round++) {
    const listed = await request
      .get(fixtureListUrl(100), { timeout: BATCH_TIMEOUT_MS })
      .catch(() => null)
    if (!listed?.ok()) continue
    const ids = ((await listed.json()).data as Array<{ id: string }>).map((fn) => fn.id)
    if (ids.length === 0) return
    for (let first = 0; first < ids.length; first += BATCH_CHUNK) {
      // One failed chunk must not strand the rest; the next round retries it.
      await request
        .delete(`${BACKEND_URL}/functions/batch`, {
          data: { ids: ids.slice(first, first + BATCH_CHUNK), cascade: true },
          timeout: BATCH_TIMEOUT_MS,
        })
        .catch(() => undefined)
    }
  }
}

/** A clean, session-free workbench canvas (only the Start node). */
async function openCleanCanvas(page: Page) {
  await page.request.delete(`${BACKEND_URL}/workbench/session`).catch(() => {})
  await page.goto('/workbench')
  await page.evaluate(() => localStorage.clear())
  await page.goto('/workbench')
  await waitForCanvasLoad(page)
}

async function openQuickAdd(page: Page) {
  await page.keyboard.press('Control+Space')
  await expect(page.locator(QUICK_ADD_POPOVER)).toBeVisible({ timeout: 5_000 })
  await expect(page.locator(`${QUICK_ADD_POPOVER} input`)).toBeFocused()
}

/** The rows the user can read right now: shown whole inside the list box. */
async function onScreenRowIds(page: Page): Promise<string[]> {
  return page.locator(QUICK_ADD_ROWS).evaluateAll((els, listSelector) => {
    const list = document.querySelector(listSelector) as HTMLElement
    const top = list.getBoundingClientRect().top + list.clientTop
    const bottom = top + list.clientHeight
    return els
      .filter((el) => {
        const box = el.getBoundingClientRect()
        return box.height > 0 && box.top >= top && box.bottom <= bottom
      })
      .map((el) => el.getAttribute('data-testid') as string)
  }, QUICK_ADD_LIST)
}

/** The row the keyboard is on right now. */
async function highlightedRowId(page: Page): Promise<string> {
  return (await page.locator(HIGHLIGHTED).getAttribute('data-testid')) as string
}

/** The two screenfuls a page press joins must run together with no gap. */
function expectUnbrokenRun(loaded: string[], before: string[], after: string[]) {
  const seen = loaded.filter((id) => before.includes(id) || after.includes(id))
  expect(
    loaded.indexOf(seen[seen.length - 1]) - loaded.indexOf(seen[0]) + 1,
    'the rows on screen before and after the press are one unbroken run',
  ).toBe(seen.length)
}

/**
 * What a page press owes the user: a boxful of rows, at most one of them
 * carried over from the last one, and no row passed over in between.
 */
function expectPageRevealed(loaded: string[], before: string[], after: string[]) {
  expect(after.length, 'the press left a full box of rows on screen').toBeGreaterThan(4)
  expect(
    after.filter((id) => before.includes(id)).length,
    'at most the row it stepped from is carried over: the rest of the box is new',
  ).toBeLessThanOrEqual(1)
  expectUnbrokenRun(loaded, before, after)
}

test.describe('V-QADD-03: Quick Insert reaches every published Function', () => {
  test.beforeAll(async ({ request }) => {
    let created = 0
    for (let first = 1; first <= SEEDED; first += BATCH_CHUNK) {
      const items = Array.from(
        { length: Math.min(BATCH_CHUNK, SEEDED - first + 1) },
        (_, index) => ({
          name: fnName(first + index),
          description: 'V-QADD-03 paging fixture',
          tags: [],
          inputs: [],
          outputs: [],
          dependencies: { functions: [], plugins: [] },
          workflow: { nodes: [], edges: [] },
          version: '1.0.0',
          changelog: 'Initial release',
          details: '',
        }),
      )
      const resp = await request.post(`${BACKEND_URL}/functions/batch`, {
        data: { items },
        timeout: BATCH_TIMEOUT_MS,
      })
      expect(resp.ok(), `POST /functions/batch failed: ${resp.status()}`).toBeTruthy()
      const body = await resp.json()
      expect(body.data.failed, 'every fixture Function must publish').toEqual([])
      created += (body.data.created as unknown[]).length
    }
    expect(created, 'the whole fixture must be published').toBe(SEEDED)
  })

  test.afterAll(async ({ request }) => {
    await removeFixtureFunctions(request)
    const left = await request.get(fixtureListUrl(1), { timeout: BATCH_TIMEOUT_MS })
    expect(left.ok(), `GET /functions failed: ${left.status()}`).toBeTruthy()
    expect(
      (await left.json()).pagination.total,
      'fixture Functions leaked into the shared database',
    ).toBe(0)
  })

  test('the whole library pages in on scroll and the last entry inserts', async ({ page }) => {
    await openCleanCanvas(page)
    await openQuickAdd(page)
    const popover = page.locator(QUICK_ADD_POPOVER)
    const rows = page.locator(QUICK_ADD_ROWS)

    const applied = await applyQuickAddSearch(page, PREFIX)
    expect(applied.total, 'the fixture owns every match for its prefix').toBe(SEEDED)

    // 1. One page of 25, and the line names the whole set as a refine signal.
    await expect(rows).toHaveCount(PAGE_SIZE)
    await expect(page.locator(`${QUICK_ADD_POPOVER} ${QUICK_ADD_STATUS}`)).toHaveText(
      `${SEEDED} Functions - refine your search to narrow down`,
    )

    // 2. The query narrows the built-in half too.
    await expect(popover.getByText('PLUGINS', { exact: true })).toHaveCount(0)
    await expect(popover.getByText('CONTROLS', { exact: true })).toHaveCount(0)
    await expect(popover.locator('[data-testid="quick-add-item-new-function"]')).toHaveCount(0)

    // 3. Each scroll to the bottom appends exactly one more page.
    for (const expected of [50, 75, 100, SEEDED]) {
      await scrollQuickAddListToBottom(page)
      await expect(rows).toHaveCount(expected)
    }
    await expect(page.locator(`${QUICK_ADD_POPOVER} ${QUICK_ADD_STATUS}`)).toHaveText(
      `${SEEDED} Functions`,
    )

    // Alphabetical across every page boundary (CANVAS-245).
    await expect(rows.nth(0)).toContainText(fnName(1))
    await expect(rows.nth(PAGE_SIZE)).toContainText(fnName(PAGE_SIZE + 1))
    await expect(rows.nth(2 * PAGE_SIZE)).toContainText(fnName(2 * PAGE_SIZE + 1))
    await expect(rows.nth(SEEDED - 1)).toContainText(fnName(SEEDED))

    // 4. The search stayed applied on every page.
    const texts = await rows.allInnerTexts()
    expect(
      texts.filter((text) => !text.includes(PREFIX)),
      'a row that does not match the applied search reached a later page',
    ).toEqual([])

    // 5. The entry past the single-page cap is reachable by keyboard and
    //    inserts like any other row. PgDn from the middle of a page stops on
    //    the last row shown and reveals the page below it, PgUp mirrors it, and
    //    page-sized presses walk the whole library and stop on its last row.
    const loaded = await rows.evaluateAll((els) =>
      els.map((el) => el.getAttribute('data-testid') as string),
    )
    // Scrolling for the pages left the list far from the highlight, which is
    // still on the first row; a page key measures the box, not that distance.
    await page.locator(QUICK_ADD_LIST).evaluate((el) => {
      el.scrollTop = 0
    })
    // Mid-page, which is where the highlight sits after a few arrow presses
    // and the only place the step can be wrong.
    for (let press = 0; press < 3; press++) {
      await page.keyboard.press('ArrowDown')
    }
    const before = await onScreenRowIds(page)
    expect(before.length, 'the list box holds a page worth stepping over').toBeGreaterThan(4)
    expect(
      before.indexOf(await highlightedRowId(page)),
      'the press starts mid-page, not on the last row shown',
    ).toBeLessThan(before.length - 1)

    await page.keyboard.press('PageDown')

    const after = await onScreenRowIds(page)
    expect(
      await highlightedRowId(page),
      'the press stops on the last row the user could read, never past it',
    ).toBe(before[before.length - 1])
    expect(after[0], 'and it stops there at the top, so the page below it shows').toBe(
      before[before.length - 1],
    )
    expectPageRevealed(loaded, before, after)

    // The mirror: from inside that page PageUp stops on its top row and
    // reveals the page above it, which is what the down key does inverted.
    for (let press = 0; press < 3; press++) {
      await page.keyboard.press('ArrowDown')
    }
    const beforeUp = await onScreenRowIds(page)
    expect(
      beforeUp.indexOf(await highlightedRowId(page)),
      'the press starts below the top row shown, where it must still move',
    ).toBeGreaterThan(0)

    await page.keyboard.press('PageUp')

    const afterUp = await onScreenRowIds(page)
    expect(
      await highlightedRowId(page),
      'the press stops on the top row the user could read, never above it',
    ).toBe(beforeUp[0])
    expect(
      afterUp[afterUp.length - 1],
      'and it stops there at the bottom, so the page above it shows',
    ).toBe(beforeUp[0])
    expectPageRevealed(loaded, beforeUp, afterUp)

    const lastRow = loaded[loaded.length - 1]
    let presses = 1
    while (presses < SEEDED && (await highlightedRowId(page)) !== lastRow) {
      const onScreen = await onScreenRowIds(page)
      await page.keyboard.press('PageDown')
      presses++
      expect(
        loaded.indexOf(await highlightedRowId(page)),
        'no press in the walk steps past the last row the user could read',
      ).toBeLessThanOrEqual(loaded.indexOf(onScreen[onScreen.length - 1]) + 1)
    }
    await expect(
      page.locator(HIGHLIGHTED),
      'page presses walk the whole library',
    ).toHaveAttribute('data-testid', lastRow)
    expect(presses, 'a page press moves a page of rows, not one row').toBeLessThan(SEEDED / 2)
    // Clamped: the key stops on the last row, and it stopped there in sight.
    expect(await onScreenRowIds(page), 'the row it stopped on is one the user can read').toContain(
      lastRow,
    )
    await page.keyboard.press('PageDown')
    await expect(page.locator(HIGHLIGHTED)).toHaveAttribute('data-testid', lastRow)
    await expect(page.locator(HIGHLIGHTED)).toContainText(fnName(SEEDED))
    await page.keyboard.press('Enter')
    await expect(popover).toHaveCount(0)
    const placed = page.locator('[data-testid^="workflow-node-"][data-nodetype="function"]')
    await expect(placed).toHaveCount(1)
    await expect(placed).toContainText(fnName(SEEDED))
  })

  test('arrowing to the last loaded row pages too, and a changed search restarts', async ({
    page,
  }) => {
    await openCleanCanvas(page)
    await openQuickAdd(page)
    const rows = page.locator(QUICK_ADD_ROWS)

    const applied = await applyQuickAddSearch(page, PREFIX)
    expect(applied.total).toBe(SEEDED)
    await expect(rows).toHaveCount(PAGE_SIZE)

    // 6. Quick Insert is keyboard-first: arrowing onto the last loaded row
    //    scrolls the list to its bottom, which is what asks for the next page.
    for (let press = 0; press < PAGE_SIZE - 1; press++) {
      await page.keyboard.press('ArrowDown')
    }
    await expect(rows).toHaveCount(2 * PAGE_SIZE)
    const texts = await rows.allInnerTexts()
    expect(
      texts.filter((text) => !text.includes(PREFIX)),
      'the search stays applied on the page the keyboard asked for',
    ).toEqual([])

    // 7. A changed search restarts at the first page: "Fn 01" matches ten.
    const narrowed = await applyQuickAddSearch(page, `${PREFIX} Fn 01`)
    expect(narrowed.total).toBe(10)
    await expect(rows).toHaveCount(10)
    await expect(page.locator(`${QUICK_ADD_POPOVER} ${QUICK_ADD_STATUS}`)).toHaveText(
      '10 Functions',
    )
    await expect(rows.nth(0)).toContainText(fnName(10))
    await expect(rows.nth(9)).toContainText(fnName(19))

    await page.keyboard.press('Escape')
    await expect(page.locator(QUICK_ADD_POPOVER)).toHaveCount(0)
  })
})
