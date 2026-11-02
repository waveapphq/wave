/**
 * V-PAGE-BLOCKED-TAGS-RETRY: recovery re-runs the tags read, never replays a
 * stored reason
 *
 * Phase: functional-workflow. Settings > Environments loads its records and
 * its tags. When both fail, the primary error state wins. Recovering the
 * primary via its own Try Again must re-run the tags read and show only what
 * that fresh attempt comes back with - a reason remembered from the earlier
 * load may never be replayed.
 *
 * Design Decisions: LIST-24 (every retry re-runs each failed read and shows
 * only what the fresh attempts come back with; no reason is replayed from
 * memory), LIST-20 (primary failure wins), LIST-16.
 *
 * Pass Criteria:
 *  1. Both reads fail: the section shows its own error state, one tags read
 *     was issued, nothing is blocked.
 *  2. Both healed + Try Again: the table loads, the tags read ran again, and
 *     no card appears.
 *  3. Only the list healed + Try Again: the card carries the FRESH tags
 *     reason and request id, never the stored ones, and the tags read ran
 *     again.
 */

import { test, expect, type Page } from '../../helpers/playwright-fixtures'
import { countApiFetches, failApiRoute, type ApiFailure } from '../../helpers/api-route'
import {
  ENVIRONMENTS_LIST_ROUTE,
  ENVIRONMENT_TAGS_ROUTE,
  blockedCard,
  blockedTitle,
  expectNotBlocked,
  openBlockedDetails,
  startAtRoot,
} from '../../helpers/page-block'

const STALE_DETAIL = 'Tag index unavailable'
const STALE_REQUEST_ID = 'pblk-tags-stale-0001'
const FRESH_DETAIL = 'Tag index still unavailable (fresh)'
const FRESH_REQUEST_ID = 'pblk-tags-fresh-0002'

interface FailState {
  listFailing: boolean
  tagsFailure: ApiFailure | null
}

/** Land on the section with both reads failing and its error state up. */
async function startWithBothFailing(
  page: Page,
  state: FailState,
): Promise<() => number> {
  await startAtRoot(page)
  await failApiRoute(page, ENVIRONMENTS_LIST_ROUTE, () =>
    state.listFailing ? { detail: 'Record store unavailable' } : null,
  )
  await failApiRoute(page, ENVIRONMENT_TAGS_ROUTE, () => state.tagsFailure)
  const tagReads = countApiFetches(page, ENVIRONMENT_TAGS_ROUTE)

  await page.goto('/settings/environments')
  await expect(page.getByTestId('environments-error')).toBeVisible({ timeout: 20000 })
  await expect.poll(() => tagReads(), { timeout: 10000 }).toBe(1)
  await expectNotBlocked(page)
  return tagReads
}

function sectionTryAgain(page: Page) {
  return page.getByTestId('environments-error').getByRole('button', { name: 'Try Again' })
}

test.describe('V-PAGE-BLOCKED-TAGS-RETRY: no stored reason survives a recovery', () => {
  test('primary recovery re-runs a hidden tags read instead of replaying it', async ({
    page,
  }) => {
    const state: FailState = {
      listFailing: true,
      tagsFailure: { detail: STALE_DETAIL, requestId: STALE_REQUEST_ID },
    }
    const tagReads = await startWithBothFailing(page, state)

    state.listFailing = false
    state.tagsFailure = null
    await sectionTryAgain(page).click()

    await expect(page.getByTestId('environments-table')).toBeVisible({ timeout: 20000 })
    await page.waitForTimeout(2000)
    // Nothing may be replayed from the failed first load: the tags read re-ran and succeeded.
    expect(
      await blockedCard(page).allInnerTexts(),
      'the recovered page carries a card from the earlier load',
    ).toEqual([])
    expect(tagReads(), 'the recovery must re-run the tags read').toBe(2)
    await expectNotBlocked(page)
  })

  test('the reason shown after recovery is fresh, never the stored one', async ({ page }) => {
    const state: FailState = {
      listFailing: true,
      tagsFailure: { detail: STALE_DETAIL, requestId: STALE_REQUEST_ID },
    }
    const tagReads = await startWithBothFailing(page, state)

    state.listFailing = false
    state.tagsFailure = { detail: FRESH_DETAIL, requestId: FRESH_REQUEST_ID }
    await sectionTryAgain(page).click()

    await expect(blockedCard(page)).toBeVisible({ timeout: 20000 })
    await expect(blockedTitle(page)).toHaveText('Could not load tags')
    // The card must carry the attempt just made, not the remembered one.
    const panel = await openBlockedDetails(page)
    await expect(panel).toContainText(FRESH_DETAIL)
    await expect(panel).toContainText(FRESH_REQUEST_ID)
    await expect(panel).not.toContainText(STALE_REQUEST_ID)
    expect(tagReads(), 'the recovery must re-run the tags read').toBe(2)
  })
})
