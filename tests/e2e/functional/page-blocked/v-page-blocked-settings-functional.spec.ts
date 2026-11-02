/**
 * V-PAGE-BLOCKED-SETTINGS: a section nobody is looking at cannot block Settings
 *
 * Phase: functional-workflow. Settings is one route made of several sections.
 * Each section reads when it is opened, so a failed tag read cannot blur the page for
 * somebody reading About.
 *
 * Design Decisions: LIST-23 (a surface reads only for what it is showing),
 * LIST-10 (a failed supporting read blocks its surface).
 *
 * Pass Criteria:
 *  1. On About, with the environment tag read forced to fail, the read is never
 *     issued: no card, nothing inert, nothing blurred, and the About content is
 *     on screen.
 *  2. Opening the Environments section is what fires that read, and the failure
 *     blocks the page then.
 *  3. Try Again over a restored backend clears the card and Settings works.
 */

import { test, expect } from '../../helpers/playwright-fixtures'
import { ensureEnvironment } from '../../helpers/config'
import { countApiFetches, failApiRoute } from '../../helpers/api-route'
import {
  ENVIRONMENT_TAGS_ROUTE,
  blockedCard,
  expectBlockedWith,
  expectNotBlocked,
  isRouteContentInert,
  retryBlockedPage,
  startAtRoot,
} from '../../helpers/page-block'

const TAGS_DETAIL = 'Tag index unavailable'

// Long enough that a read fired on mount would have been issued and answered.
const SETTLE_MS = 2000

test.describe('V-PAGE-BLOCKED-SETTINGS: reads are scoped to the section on screen', () => {
  test.beforeAll(async ({ request }) => {
    await ensureEnvironment(request)
  })

  test('T1: a failed read for a section the user is not on never fires and never blocks', async ({
    page,
  }) => {
    let failing = true
    await startAtRoot(page)
    await failApiRoute(page, ENVIRONMENT_TAGS_ROUTE, () =>
      failing ? { detail: TAGS_DETAIL } : null,
    )
    const tagReads = countApiFetches(page, ENVIRONMENT_TAGS_ROUTE)

    await page.goto('/settings/about')
    await expect(page.getByTestId('settings-page')).toBeVisible({ timeout: 20000 })
    await expect(page.getByTestId('about-tab')).toBeVisible({ timeout: 20000 })

    // Give the page every chance to fire the read it must not fire.
    await page.waitForTimeout(SETTLE_MS)
    expect(tagReads(), 'a section nobody is on must not read').toBe(0)
    await expectNotBlocked(page)

    // Opening the section is what fires its read, and the failure lands then.
    await page.getByTestId('settings-nav-environments').click()
    await expectBlockedWith(page, 'Could not load tags')
    expect(tagReads(), 'entering the section is what fires its read').toBe(1)

    failing = false
    await retryBlockedPage(page)
    await expect(blockedCard(page)).toHaveCount(0)
    expect(await isRouteContentInert(page), 'inert must be lifted on recovery').toBe(false)
    await expect(page.getByTestId('settings-nav-about')).toBeEnabled()
  })
})
