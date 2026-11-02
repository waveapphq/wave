/**
 * V-FN-TAGS-01: Publish dialog Tags CHIP PICKER - chosen-state contract
 *
 * This is the chip picker inside the Publish dialog. It is NOT the Functions
 * Library tag FILTER popover (that one is covered by V-FN-LIB-01 S7).
 *
 * Design Decisions:
 *   - FN-LC-3 (Tags is a first-class publish-dialog field)
 *
 * Pass Criteria:
 *   1. Choosing a row marks THAT row checked on both `aria-checked` and
 *      `data-state` and gives it the check icon; every other row reports
 *      unchecked on both and carries no icon; the list carries the listbox
 *      role cmdk writes and declares no `aria-multiselectable`.
 *   2. The keyboard cursor (`aria-selected`) is a different thing from the
 *      choice: moving the cursor off the chosen row leaves the choice alone,
 *      exactly one row is the cursor, and the search box's
 *      `aria-activedescendant` equals the cursor row's `id`.
 *   3. Multi-select: a second choice in the same open popover adds a second
 *      chip and the popover stays open; re-clicking the first choice clears
 *      only that one.
 *   4. Over every row the check icon is present exactly when the row is
 *      checked. A row is checked AND the cursor only when the cursor is
 *      parked on the chosen row, and the tick survives that. No row carries
 *      a `data-highlighted` attribute.
 *
 * Phase: fixture. Seeds three published library Functions (the tag universe)
 * plus one Test holding a local Function so the Publish dialog is reachable.
 */

import { randomUUID } from 'node:crypto'

import {
  test,
  expect,
  type APIRequestContext,
  type Locator,
  type Page,
} from '../../helpers/playwright-fixtures'
import { clickNodeKebabItem } from '../../helpers/canvas'
import {
  createValidTest,
  localFunctionNode,
  openTest,
  publishLibraryFunction,
} from '../../helpers/fn-seed'

const FN_NODE_ID = 'fn-tags-1'
const CHECK_ICON = '[data-testid="check-icon"]'

interface TagUniverse {
  stamp: string
  tags: string[]
}

/** Seed three library Functions carrying three stamped tags. The shard's tag
 *  list is shared, so the stamp is what makes "the second row" deterministic:
 *  `GET /functions/tags` sorts A-Z, and the bare stamp is an exact match of
 *  the search text, which keeps the "Create" row out of the filtered list. */
async function seedTagUniverse(request: APIRequestContext): Promise<TagUniverse> {
  const stamp = randomUUID().slice(0, 8)
  const tags = [stamp, `${stamp}-b`, `${stamp}-c`]
  for (const [index, tag] of tags.entries()) {
    await publishLibraryFunction(request, {
      name: `FN-TAGS ${stamp} ${index}`,
      description: 'V-FN-TAGS-01 tag universe entry',
      tags: [tag],
    })
  }
  return { stamp, tags }
}

async function seedHostTest(request: APIRequestContext): Promise<string> {
  return createValidTest(request, {
    name: `V-FN-TAGS-01 host ${Date.now()}-${randomUUID().slice(0, 6)}`,
    nodes: [localFunctionNode(FN_NODE_ID, 'TagPickerHost', { nodes: [], edges: [] })],
  })
}

interface Picker {
  tagsInput: Locator
  popover: Locator
  search: Locator
  rows: Locator
}

async function openTagPicker(page: Page, stamp: string): Promise<Picker> {
  await clickNodeKebabItem(page, FN_NODE_ID, 'Publish to Library')
  const dialog = page.locator('[role="dialog"]', { hasText: 'Publish Function' })
  await expect(dialog).toBeVisible({ timeout: 10_000 })
  // The kebab menu hands focus back to its trigger when it finally unmounts,
  // and a non-modal popover closes on that; let the menu go before opening one.
  await expect(page.locator('[role="menu"]')).toHaveCount(0)

  const tagsInput = dialog.locator('[data-testid="tags-input"]')
  await tagsInput.locator('[data-testid="tags-trigger"]').click()

  // The popover is portaled to the body, so it is a sibling of the dialog.
  // Scope by the popover and pick the list by role: both tag listboxes in the
  // product share the same accessible name.
  const popover = page.locator('[role="dialog"]', { has: page.getByPlaceholder('Search tags…') })
  await expect(popover).toBeVisible()

  const search = popover.getByPlaceholder('Search tags…')
  await search.fill(stamp)
  const rows = popover.locator('[role="option"]')
  await expect(rows).toHaveCount(3)
  return { tagsInput, popover, search, rows }
}

/** Park the cursor on the last row: three moves clamp there from any start. */
async function cursorToLastRow(search: Locator): Promise<void> {
  await search.press('ArrowDown')
  await search.press('ArrowDown')
  await search.press('ArrowDown')
}

async function expectTickMatchesChecked(rows: Locator): Promise<void> {
  const total = await rows.count()
  for (let index = 0; index < total; index++) {
    const row = rows.nth(index)
    const checked = await row.getAttribute('aria-checked')
    const ticks = await row.locator(CHECK_ICON).count()
    expect(ticks, `row ${index} tick count while aria-checked=${checked}`).toBe(
      checked === 'true' ? 1 : 0,
    )
  }
}

test.describe('V-FN-TAGS-01: Publish dialog Tags chip picker', () => {
  test('S1: the chosen row is the checked row, and the list declares no aria-multiselectable', async ({
    page,
    request,
  }) => {
    const { stamp, tags } = await seedTagUniverse(request)
    const testId = await seedHostTest(request)
    await openTest(page, testId)
    const { popover, rows } = await openTagPicker(page, stamp)

    await expect(rows).toHaveText(tags)

    // The SECOND row on purpose: the picker parks its keyboard cursor on row
    // zero, so a chosen state wired to the cursor would pass on the first row.
    await rows.nth(1).click()

    const chosen = rows.nth(1)
    await expect(chosen).toHaveAttribute('aria-checked', 'true')
    await expect(chosen).toHaveAttribute('data-state', 'checked')
    await expect(chosen.locator(CHECK_ICON)).toHaveCount(1)

    for (const index of [0, 2]) {
      const other = rows.nth(index)
      await expect(other).toHaveAttribute('aria-checked', 'false')
      await expect(other).toHaveAttribute('data-state', 'unchecked')
      await expect(other.locator(CHECK_ICON)).toHaveCount(0)
    }

    // The chosen state rides on the rows; the list declares nothing.
    await expect(popover.locator('[role="listbox"]')).toHaveCount(1)
    await expect(popover.locator('[role="listbox"]')).not.toHaveAttribute(
      'aria-multiselectable',
    )
  })

  test('S2: the keyboard cursor moves without moving the choice', async ({ page, request }) => {
    const { stamp } = await seedTagUniverse(request)
    const testId = await seedHostTest(request)
    await openTest(page, testId)
    const { popover, search, rows } = await openTagPicker(page, stamp)

    await rows.nth(1).click()
    await expect(rows.nth(1)).toHaveAttribute('aria-checked', 'true')

    await cursorToLastRow(search)

    const cursor = rows.nth(2)
    await expect(cursor).toHaveAttribute('aria-selected', 'true')
    await expect(popover.locator('[role="option"][aria-selected="true"]')).toHaveCount(1)
    await expect(cursor).toHaveAttribute('aria-checked', 'false')
    await expect(cursor.locator(CHECK_ICON)).toHaveCount(0)

    // The choice stayed where the user put it, and is no longer the cursor.
    await expect(rows.nth(1)).toHaveAttribute('aria-checked', 'true')
    await expect(rows.nth(1)).toHaveAttribute('aria-selected', 'false')

    const cursorId = await cursor.getAttribute('id')
    expect(cursorId, 'the cursor row carries an id').toBeTruthy()
    await expect(search).toHaveAttribute('aria-activedescendant', cursorId!)
  })

  test('S3: a second choice adds a chip; re-clicking the first clears only that one', async ({
    page,
    request,
  }) => {
    const { stamp, tags } = await seedTagUniverse(request)
    const testId = await seedHostTest(request)
    await openTest(page, testId)
    const { tagsInput, popover, rows } = await openTagPicker(page, stamp)

    await rows.nth(1).click()
    await rows.nth(2).click()

    await expect(rows.nth(1)).toHaveAttribute('aria-checked', 'true')
    await expect(rows.nth(2)).toHaveAttribute('aria-checked', 'true')
    await expect(tagsInput.locator('[data-testid="tag-badge"]')).toHaveCount(2)
    await expect(
      tagsInput.locator(`[data-remove-tag][data-tag-name="${tags[1]}"]`),
    ).toHaveCount(1)
    await expect(
      tagsInput.locator(`[data-remove-tag][data-tag-name="${tags[2]}"]`),
    ).toHaveCount(1)
    await expect(popover).toBeVisible()

    await rows.nth(1).click()

    await expect(rows.nth(1)).toHaveAttribute('aria-checked', 'false')
    await expect(rows.nth(1)).toHaveAttribute('data-state', 'unchecked')
    await expect(rows.nth(1).locator(CHECK_ICON)).toHaveCount(0)
    await expect(
      tagsInput.locator(`[data-remove-tag][data-tag-name="${tags[1]}"]`),
    ).toHaveCount(0)

    // The other choice is untouched.
    await expect(rows.nth(2)).toHaveAttribute('aria-checked', 'true')
    await expect(rows.nth(2).locator(CHECK_ICON)).toHaveCount(1)
    await expect(
      tagsInput.locator(`[data-remove-tag][data-tag-name="${tags[2]}"]`),
    ).toHaveCount(1)
    await expect(tagsInput.locator('[data-testid="tag-badge"]')).toHaveCount(1)
    await expect(popover).toBeVisible()
  })

  test('S4: the tick follows the choice on every row, never the cursor', async ({
    page,
    request,
  }) => {
    const { stamp } = await seedTagUniverse(request)
    const testId = await seedHostTest(request)
    await openTest(page, testId)
    const { popover, search, rows } = await openTagPicker(page, stamp)

    await rows.nth(1).click()
    await expect(rows.nth(1)).toHaveAttribute('aria-checked', 'true')
    await expectTickMatchesChecked(rows)

    // Cursor off the chosen row.
    await cursorToLastRow(search)
    await expect(rows.nth(2)).toHaveAttribute('aria-selected', 'true')
    await expect(rows.nth(2)).toHaveAttribute('aria-checked', 'false')
    await expectTickMatchesChecked(rows)

    // Cursor back on the chosen row: checked AND cursor, and the tick stays.
    await search.press('ArrowUp')
    await expect(rows.nth(1)).toHaveAttribute('aria-selected', 'true')
    await expect(rows.nth(1)).toHaveAttribute('aria-checked', 'true')
    await expect(rows.nth(1).locator(CHECK_ICON)).toHaveCount(1)
    await expect(popover.locator('[role="option"][aria-selected="true"]')).toHaveCount(1)
    await expectTickMatchesChecked(rows)

    // The picker carries no second highlight of its own.
    await expect(popover.locator('[role="option"][data-highlighted]')).toHaveCount(0)
  })
})
