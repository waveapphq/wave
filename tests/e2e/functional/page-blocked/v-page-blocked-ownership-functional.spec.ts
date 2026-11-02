/**
 * V-PAGE-BLOCKED-OWNERSHIP: a card belongs to the surface that raised it
 *
 * Phase: functional-workflow. The live workbench is the reachable place where
 * two independent surfaces read at the same time: the canvas reads the system
 * variables, and the run hook restores the workbench session. Each owns what it
 * reported, so one of them landing clean never takes the other one's card away,
 * and a card that names two failed reads narrows to whichever is still failing.
 *
 * Design Decisions: LIST-21 (a block belongs to whoever raised it), LIST-22
 * (every failed read is named), LIST-16 (Try Again re-runs what failed).
 *
 * Pass Criteria:
 *  1. With the system-variables read failing and the session read held back,
 *     the card is up BEFORE the session read lands, and the session read
 *     landing clean afterwards leaves the card exactly as it was.
 *  2. With both reads failing, one card names both and its details carry both
 *     reasons.
 *  3. A Try Again that fixes only the session read leaves the card up naming
 *     only the system variables, and the page stays inert.
 *  4. Fixing the second read clears the last entry, the card goes and inert is
 *     lifted.
 */

import { test, expect, type Page } from '../../helpers/playwright-fixtures'
import { BACKEND_URL } from '../../helpers/config'
import { delayApiRoute, failApiRoute } from '../../helpers/api-route'
import {
  SYSTEM_VARIABLES_ROUTE,
  WORKBENCH_SESSION_ROUTE,
  blockedCard,
  blockedTitle,
  expectBlockedWith,
  isRouteContentInert,
  openBlockedDetails,
  retryBlockedPage,
  startAtRoot,
} from '../../helpers/page-block'
import { releaseWorkbenchOwnership } from '../../helpers/fn-seed'

const SYSTEM_VARS_DETAIL = 'System variable store unavailable'
const SESSION_DETAIL = 'Session store unavailable'

// Held long enough that the card the canvas raised is provably already up when
// the other surface's clean read lands.
const SESSION_DELAY_MS = 8000

/** Free the single workbench slot and drop any leftover session. */
async function freeWorkbench(page: Page): Promise<void> {
  await releaseWorkbenchOwnership(page.request)
  await page.request.delete(`${BACKEND_URL}/workbench/session`).catch(() => undefined)
}

/** Report whether the session read has come back yet. */
function watchSessionRead(page: Page): () => boolean {
  let landed = false
  page.on('response', (response) => {
    if (response.request().method() !== 'GET') return
    if (WORKBENCH_SESSION_ROUTE(new URL(response.url()))) landed = true
  })
  return () => landed
}

test.describe('V-PAGE-BLOCKED-OWNERSHIP: one surface never clears another surface card', () => {
  test('O1: a clean read on another surface does not clear a card already raised', async ({
    page,
  }) => {
    await freeWorkbench(page)
    await startAtRoot(page)
    await failApiRoute(page, SYSTEM_VARIABLES_ROUTE, { detail: SYSTEM_VARS_DETAIL })
    await delayApiRoute(page, WORKBENCH_SESSION_ROUTE, SESSION_DELAY_MS)
    const sessionLanded = watchSessionRead(page)

    await page.goto('/workbench')
    await expectBlockedWith(page, 'Could not load system variables')

    // Without this the ordering proves nothing: the clean read must still be
    // in flight at the moment the card is up.
    expect(sessionLanded(), 'the session read must still be held when the card appears').toBe(
      false,
    )

    await expect
      .poll(sessionLanded, {
        message: 'the held session read must come back',
        timeout: 30000,
      })
      .toBe(true)
    await page.waitForTimeout(1000)

    // The clean read belongs to the run hook, so it clears the run hook's
    // reads and nothing else.
    await expectBlockedWith(page, 'Could not load system variables')
  })

  test('O2: two owners block together and the card narrows to whoever is still failing', async ({
    page,
  }) => {
    let sessionFailing = true
    let systemVarsFailing = true
    await freeWorkbench(page)
    await startAtRoot(page)
    await failApiRoute(page, SYSTEM_VARIABLES_ROUTE, () =>
      systemVarsFailing ? { detail: SYSTEM_VARS_DETAIL } : null,
    )
    await failApiRoute(page, WORKBENCH_SESSION_ROUTE, () =>
      sessionFailing ? { detail: SESSION_DETAIL } : null,
    )

    await page.goto('/workbench')
    await expect(blockedCard(page)).toBeVisible({ timeout: 20000 })

    // One card, both reads named. The order the two surfaces report in is not
    // fixed, so the assertion is on what is named, not on the sequence.
    const title = blockedTitle(page)
    await expect(title).toHaveText(/^Could not load /)
    await expect(title).toContainText('system variables')
    await expect(title).toContainText('workbench session')

    // Neither reason is summarized away.
    const panel = await openBlockedDetails(page)
    await expect(panel).toContainText(SYSTEM_VARS_DETAIL)
    await expect(panel).toContainText(SESSION_DETAIL)

    // One read recovers. Its owner drops its own entry and leaves the other.
    const retry = page.getByTestId('page-blocked-retry')
    sessionFailing = false
    await retryBlockedPage(page)
    await expect(retry, 'the attempt must finish before the next one').toBeEnabled({
      timeout: 30000,
    })
    await expect(title).toHaveText('Could not load system variables')
    expect(
      await isRouteContentInert(page),
      'the surviving card must keep the page inert',
    ).toBe(true)

    systemVarsFailing = false
    await retryBlockedPage(page)
    await expect(blockedCard(page)).toHaveCount(0, { timeout: 30000 })
    expect(
      await isRouteContentInert(page),
      'inert must be lifted once the last read recovers',
    ).toBe(false)
  })
})
