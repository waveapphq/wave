/**
 * V-FN-LIB-01: Functions Library modal - populated state (FN-LC-6..8)
 *
 * Design Decisions:
 *   - FN-LC-6, FN-LC-7 (EntityFilters-style Tags popover, responsive grid `auto-fill, minmax(220px, 1fr)`)
 *   - FN-LC-8 (card layout: icon + name + 1-line desc + tag chips, NO S badge)
 *
 * Pass Criteria:
 *   1. Modal opens via the palette "Library" button with seeded entries.
 *   2. Card grid renders one card per published Function with the exact
 *      grid template (auto-fill, minmax(220px, 1fr)).
 *   3. Each card shows icon + name + 1-line description + tag chips and NO
 *      S lifecycle badge.
 *   4. Search input filters by name (case-insensitive).
 *   5. Tags popover (single "Tags" button) lets the user multi-select tags
 *      with AND semantics. While active, the "Clear Filters" button appears.
 *   6. Filtered-empty state shows "No Functions match these filters." and
 *      the Clear Filters affordance.
 *   7. Modal drag handle moves the modal AND text-selection during drag is
 *      empty.
 *   8. The tag FILTER popover exposes its chosen rows to assistive tech:
 *      `aria-checked` + `data-state` per row, and a keyboard cursor
 *      (`aria-selected`) that is independent of the choice. The list carries
 *      the listbox role cmdk writes and declares no `aria-multiselectable`.
 *      This is the library filter, NOT the Publish dialog's Tags chip picker
 *      - that one is covered by V-FN-TAGS-01.
 *
 * Phase: fixture (seeds three library Functions via POST /functions; one
 * Test fixture is needed only so the workbench is reachable).
 */

import { test, expect, type Page } from '../../helpers/playwright-fixtures'
import { waitForCanvasLoad } from '../../helpers/canvas'
import { BACKEND_URL } from '../../helpers/config'
import { randomUUID } from 'node:crypto'

interface SeededFunction {
  id: string
  name: string
}

async function seedLibrary(page: Page): Promise<SeededFunction[]> {
  // Library Function names cap at 32 chars (FN-LC-1). Keep the test
  // discriminator short: 6 base36 chars (= ~2B combinations, ample for
  // sequentially-run tests inside a container) + a 2-char role suffix.
  const stamp = randomUUID().slice(0, 6)
  const seeds = [
    { name: `LIB-01 A ${stamp}`, description: 'First library entry', tags: ['demo', 'http'] },
    { name: `LIB-01 B ${stamp}`, description: 'Second library entry', tags: ['demo'] },
    { name: `LIB-01 G ${stamp}`, description: 'Third library entry', tags: ['network'] },
  ]
  const results: SeededFunction[] = []
  for (const seed of seeds) {
    const resp = await page.request.post(`${BACKEND_URL}/functions`, {
      data: {
        ...seed,
        inputs: [],
        outputs: [],
        dependencies: { functions: [], plugins: [] },
        workflow: { nodes: [], edges: [] },
        metadata: {},
      },
    })
    const body = await resp.json().catch(() => null)
    expect(
      resp.ok(),
      `POST /functions failed: ${resp.status()} ${JSON.stringify(body)}`,
    ).toBeTruthy()
    results.push({ id: body!.data.id, name: seed.name })
  }
  return results
}

async function seedHostTest(page: Page): Promise<string> {
  const resp = await page.request.post(`${BACKEND_URL}/tests`, {
    data: {
      name: `V-FN-LIB-01 host ${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      version: '1.0.0',
      description: 'Empty host Test used to open the workbench for V-FN-LIB-01.',
      workflow: { nodes: [], edges: [] },
      variables: {},
      metadata: {},
    },
  })
  expect(resp.ok(), `POST /tests failed: ${resp.status()}`).toBeTruthy()
  const body = await resp.json()
  return body.data.id
}

async function open(page: Page, testId: string) {
  await page.request.delete(`${BACKEND_URL}/workbench/session`).catch(() => {})
  await page.goto(`/workbench?editTest=${testId}`)
  await page.evaluate(() => localStorage.clear())
  await page.goto(`/workbench?editTest=${testId}`)
  await waitForCanvasLoad(page)
}

async function openLibraryModal(page: Page) {
  // The palette has a Library button. Expand the palette first.
  const palette = page.locator('[data-testid="block-palette"]')
  await expect(palette).toBeVisible()
  const state = await palette.getAttribute('data-state')
  if (state === 'collapsed') {
    await page.locator('[data-testid="palette-expand-button"]').click()
    await expect(palette).toHaveAttribute('data-state', 'expanded')
  }
  await page.locator('[data-testid="palette-blocks-library-button"]').click()
  const modal = page.locator('[aria-label="Functions Library"]')
  await expect(modal).toBeVisible({ timeout: 10_000 })
  return modal
}

test.describe('V-FN-LIB-01: Functions Library modal - populated', () => {
  test('S1: cards render with the documented layout + grid template', async ({ page }) => {
    const seeded = await seedLibrary(page)
    const testId = await seedHostTest(page)
    await open(page, testId)

    const modal = await openLibraryModal(page)

    // Grid uses the canonical auto-fill, minmax(220px, 1fr).
    const grid = modal.locator('[data-testid="functions-library-grid"]')
    await expect(grid).toBeVisible()
    const gridTemplate = await grid.evaluate(
      (el) => (el as HTMLElement).style.gridTemplateColumns,
    )
    expect(gridTemplate).toContain('220px')

    // The shard's BE storage is persistent, so the grid may include cards
    // from prior tests as well. Filter to OUR seeded entries by name.
    const cards = grid.locator('[data-testid="library-card"]')
    const alphaCard = cards.filter({ hasText: seeded[0].name }).first()
    await expect(alphaCard).toBeVisible()

    // First seeded card: icon + name + tag chips; NO S lifecycle badge.
    await expect(alphaCard.locator('svg').first()).toBeVisible()
    await expect(alphaCard).toContainText(seeded[0].name)
    await expect(alphaCard.locator('[data-testid="library-card-tags"]')).toBeVisible()
    await expect(alphaCard.locator('[data-testid="node-function-lifecycle-badge"]')).toHaveCount(0)
  })

  test('S2: search filters by name; Clear Filters appears after typing (AND with tags)', async ({
    page,
  }) => {
    const seeded = await seedLibrary(page)
    const testId = await seedHostTest(page)
    await open(page, testId)
    const modal = await openLibraryModal(page)

    const search = modal.getByLabel('Search Functions')
    // Search the unique stamp of our seeded entries: it cannot appear in
    // any prior shard's seeds. The stamp is the suffix after the role
    // letter (e.g. "LIB-01 A {stamp}" - extract {stamp}).
    const stamp = seeded[0].name.replace(/^LIB-01 [ABG] /, '')
    await search.fill(`LIB-01 A ${stamp}`)
    const cards = modal.locator('[data-testid="library-card"]')
    await expect(cards).toHaveCount(1)
    await expect(cards.first()).toContainText(seeded[0].name)

    // Clear Filters affordance appears (filters now non-empty).
    await expect(modal.getByRole('button', { name: 'Clear Filters' })).toBeVisible()
  })

  test('S3: Tags popover supports multi-select with AND semantics', async ({ page }) => {
    const seeded = await seedLibrary(page)
    const testId = await seedHostTest(page)
    await open(page, testId)
    const modal = await openLibraryModal(page)

    // Pre-filter the cards to OUR seeded entries (the BE storage may
    // already hold entries from other tests). Use the stamp suffix so the
    // assertions are about this test's seeds only.
    const stamp = seeded[0].name.replace(/^LIB-01 [ABG] /, '')

    await modal.getByRole('button', { name: 'Tags' }).click()
    const popover = page.locator('[role="dialog"]', { has: page.getByPlaceholder('Search tags…') })
    await expect(popover).toBeVisible()

    // Select 'demo' - among our seeded entries A + B are demo, G is not.
    await popover.locator('[role="option"]', { hasText: 'demo' }).click()
    // Add 'http' in the same popover open - AND with demo narrows OUR
    // seeds to A only. We deliberately do NOT press Escape between
    // selections: the modal's own Escape handler closes the WHOLE modal
    // (not just the popover), which would hide the grid we want to check.
    await popover.locator('[role="option"]', { hasText: 'http' }).click()
    // Close the popover by clicking the Tags trigger again (toggle).
    await modal.getByRole('button', { name: /tags/i }).click()
    await expect(popover).toBeHidden()
    const matches = modal
      .locator('[data-testid="library-card"]')
      .filter({ hasText: stamp })
    await expect(matches).toHaveCount(1)
    await expect(matches.first()).toContainText(`LIB-01 A ${stamp}`)
  })

  test('S4: filtered-empty state shows canonical copy + Clear Filters', async ({ page }) => {
    await seedLibrary(page)
    const testId = await seedHostTest(page)
    await open(page, testId)
    const modal = await openLibraryModal(page)

    await modal.getByLabel('Search Functions').fill('zzz-no-match')
    await expect(modal.getByText('No Functions match these filters.')).toBeVisible()
    await expect(modal.getByRole('button', { name: 'Clear Filters' })).toBeVisible()
  })

  test('S6: viewport clamping keeps the modal reachable when content resizes (regression guard)', async ({
    page,
  }) => {
    // When the user drags the modal near the top of the
    // viewport and the result count grows (or shrinks), the modal's
    // ResizeObserver re-clamps the offset so the top edge stays >= 0.
    // Without the clamp, dragging the modal up while a search narrowed the
    // grid and then clearing the search pushed the header off-screen.
    const seeded = await seedLibrary(page)
    const stamp = seeded[0].name.replace(/^LIB-01 [ABG] /, '')
    const testId = await seedHostTest(page)
    await open(page, testId)
    const modal = await openLibraryModal(page)

    // Step 1: filter the grid down to a single card so the modal shrinks.
    await modal.getByLabel('Search Functions').fill(`LIB-01 A ${stamp}`)
    await expect(modal.locator('[data-testid="library-card"]')).toHaveCount(1)

    // Step 2: drag the modal up against the top of the viewport.
    const handle = modal.locator('[data-testid="functions-library-drag-handle"]')
    const before = await modal.boundingBox()
    await handle.hover()
    await page.mouse.down()
    await page.mouse.move(before!.x, before!.y - 600, { steps: 10 })
    await page.mouse.up()

    // Step 3: clear the filter so the grid grows back. The modal must
    // NOT travel above the viewport edge - the ResizeObserver clamp keeps
    // the top edge in bounds.
    await modal.getByLabel('Search Functions').fill('')
    await expect(
      modal.locator('[data-testid="library-card"]').filter({ hasText: stamp }),
    ).toHaveCount(3)

    // The ResizeObserver re-clamp runs async after the grid grows; poll the
    // modal's top edge until the clamp settles it back into the viewport.
    await expect(async () => {
      const after = await modal.boundingBox()
      expect(after, 'modal still on screen').not.toBeNull()
      expect(after!.y).toBeGreaterThanOrEqual(0)
    }).toPass({ timeout: 5000 })
  })

  test('S5: drag handle moves the modal and does NOT select text (regression guard)', async ({
    page,
  }) => {
    // Dragging the modal selects no card / header text.
    await seedLibrary(page)
    const testId = await seedHostTest(page)
    await open(page, testId)
    const modal = await openLibraryModal(page)

    const handle = modal.locator('[data-testid="functions-library-drag-handle"]')
    const before = await modal.boundingBox()
    expect(before, 'modal bounding box').not.toBeNull()

    // Drag the handle 80px right + 40px down.
    await handle.hover()
    await page.mouse.down()
    await page.mouse.move(before!.x + 250, before!.y + 60, { steps: 8 })
    await page.mouse.up()

    const after = await modal.boundingBox()
    expect(after, 'modal moved').not.toBeNull()
    expect(Math.abs((after!.x - before!.x)) + Math.abs((after!.y - before!.y))).toBeGreaterThan(10)

    // No text selected anywhere on the page after the drag.
    const isSelectionCollapsed = await page.evaluate(() => {
      const sel = window.getSelection()
      return !sel || sel.isCollapsed
    })
    expect(isSelectionCollapsed, 'getSelection().isCollapsed after drag').toBe(true)
  })

  test('S7: the tag FILTER popover exposes chosen rows independently of the cursor', async ({
    page,
  }) => {
    // The library tag FILTER, not the Publish dialog's Tags chip picker.
    await seedLibrary(page)
    const testId = await seedHostTest(page)
    await open(page, testId)
    const modal = await openLibraryModal(page)

    await modal.getByRole('button', { name: 'Tags' }).click()
    const popover = page.locator('[role="dialog"]', { has: page.getByPlaceholder('Search tags…') })
    await expect(popover).toBeVisible()

    // Anchored names: the popover lists every tag in the shard, so a
    // substring match could hit a neighboring tag from another spec.
    const demo = popover.locator('[role="option"]', { hasText: /^demo$/ })
    const http = popover.locator('[role="option"]', { hasText: /^http$/ })
    const network = popover.locator('[role="option"]', { hasText: /^network$/ })

    await demo.click()
    await http.click()

    // Both chosen rows report checked, and nothing else in the list does.
    await expect(demo).toHaveAttribute('aria-checked', 'true')
    await expect(demo).toHaveAttribute('data-state', 'checked')
    await expect(demo.locator('[data-testid="check-icon"]')).toHaveCount(1)
    await expect(http).toHaveAttribute('aria-checked', 'true')
    await expect(http).toHaveAttribute('data-state', 'checked')
    await expect(popover.locator('[role="option"][aria-checked="true"]')).toHaveCount(2)
    await expect(network).toHaveAttribute('aria-checked', 'false')
    await expect(network).toHaveAttribute('data-state', 'unchecked')
    await expect(network.locator('[data-testid="check-icon"]')).toHaveCount(0)

    // The chosen state rides on the rows; the list declares nothing.
    await expect(popover.locator('[role="listbox"]')).toHaveCount(1)
    await expect(popover.locator('[role="listbox"]')).not.toHaveAttribute(
      'aria-multiselectable',
    )

    // Exactly one row is the keyboard cursor, and its checked state is its
    // own: the cursor sitting on an unchosen row does not check it, and the
    // chosen rows stay checked while they are not the cursor.
    await network.hover()
    await expect(network).toHaveAttribute('aria-selected', 'true')
    await expect(popover.locator('[role="option"][aria-selected="true"]')).toHaveCount(1)
    await expect(network).toHaveAttribute('aria-checked', 'false')
    await expect(demo).toHaveAttribute('aria-selected', 'false')
    await expect(demo).toHaveAttribute('aria-checked', 'true')
    await expect(http).toHaveAttribute('aria-selected', 'false')
    await expect(http).toHaveAttribute('aria-checked', 'true')
  })
})
