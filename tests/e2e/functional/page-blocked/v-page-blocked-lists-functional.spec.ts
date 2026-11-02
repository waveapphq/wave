/**
 * V-PAGE-BLOCKED-LISTS: every non-primary read on a list page blocks that page
 *
 * Phase: functional-workflow. Each case forces one supporting read of one list
 * page to fail, and drives the page from blocked back to usable. The deep
 * inertness proof lives in v-page-blocked-inert-functional.spec.ts and is not
 * repeated here.
 *
 * Design Decisions: LIST-10 (two kinds of read, the supporting one blocks),
 * LIST-14 (the sidebar stays usable), LIST-16 (Try Again re-runs only what
 * failed), LIST-19 (a read the surface started for itself blocks too).
 *
 * Pass Criteria:
 *  1. Profiles, Suites, Functions, Tests, Regressions and Settings >
 *     Environments each block with the shared card when one supporting read
 *     fails, and the card names the read that failed.
 *  2. The sidebar still navigates out of every blocked page, and the block does
 *     not follow the user to the next page.
 *  3. Try Again over a restored backend clears the card and the page takes
 *     input again.
 *  4. Three failed reads produce ONE card that names each and drops no reason:
 *     nothing is hidden when more than one thing goes wrong.
 */

import { test, expect, type Page } from '../../helpers/playwright-fixtures'
import { ensureEnvironment } from '../../helpers/config'
import { failApiRoute, type ApiUrlMatcher } from '../../helpers/api-route'
import {
  ENVIRONMENT_NAMES_ROUTE,
  ENVIRONMENT_TAGS_ROUTE,
  FUNCTION_TAGS_ROUTE,
  PROFILE_TAGS_ROUTE,
  PROFILE_TYPES_ROUTE,
  REGRESSION_TAGS_ROUTE,
  SUITE_TAGS_ROUTE,
  TEST_TAGS_ROUTE,
  blockedCard,
  expectBlockedWith,
  expectSurfaceLive,
  openBlockedDetails,
  retryBlockedPage,
  startAtRoot,
} from '../../helpers/page-block'

const FAILURE_DETAIL = 'Supporting read refused'

const TYPES_DETAIL = 'Profile type registry unavailable'
const TYPES_REQUEST_ID = 'pblk-types-3333-cccc'
const TAGS_DETAIL = 'Tag index unavailable'
const TAGS_REQUEST_ID = 'pblk-tags-5555-eeee'
const ENVS_DETAIL = 'Environment registry unavailable'
const ENVS_REQUEST_ID = 'pblk-envs-4444-dddd'

interface ListCase {
  /** The route the page lives at. */
  route: string
  /** The supporting read forced to fail. */
  read: ApiUrlMatcher
  /** The exact title the card must carry. */
  title: string
}

/**
 * Block the page on one failed supporting read, leave through the sidebar, come
 * back to it still failing, then recover it with Try Again.
 */
async function driveBlockedListPage(page: Page, listCase: ListCase): Promise<void> {
  let failing = true
  await startAtRoot(page)
  await failApiRoute(page, listCase.read, () => (failing ? { detail: FAILURE_DETAIL } : null))

  await page.goto(listCase.route)
  await expectBlockedWith(page, listCase.title)

  // Leaving is the way out, so the sidebar must still work while blocked.
  const dashboardLink = page.locator('[data-testid="sidebar"] a[href="/dashboard"]')
  await expect(dashboardLink, 'sidebar link must be usable while blocked').toBeEnabled()
  await dashboardLink.click()
  await expect(page).toHaveURL(/\/dashboard$/)
  await expect(blockedCard(page), 'the block must not follow the user').toHaveCount(0)

  // Back to the still-failing page: it blocks again rather than degrading.
  await page.goto(listCase.route)
  await expectBlockedWith(page, listCase.title)

  failing = false
  await retryBlockedPage(page)
  await expect(blockedCard(page)).toHaveCount(0)
  await expectSurfaceLive(page)
}

test.describe('V-PAGE-BLOCKED-LISTS: a failed supporting read blocks its list page', () => {
  test.beforeAll(async ({ request }) => {
    await ensureEnvironment(request)
  })

  test('L1: Profiles blocks when the profile types read fails', async ({ page }) => {
    await driveBlockedListPage(page, {
      route: '/profiles',
      read: PROFILE_TYPES_ROUTE,
      title: 'Could not load profile types',
    })
  })

  test('L2: Suites blocks when the tag read fails', async ({ page }) => {
    await driveBlockedListPage(page, {
      route: '/suites',
      read: SUITE_TAGS_ROUTE,
      title: 'Could not load tags',
    })
  })

  test('L3: Functions blocks when the tag read fails', async ({ page }) => {
    await driveBlockedListPage(page, {
      route: '/functions',
      read: FUNCTION_TAGS_ROUTE,
      title: 'Could not load tags',
    })
  })

  test('L4: Settings > Environments blocks when the tag read fails', async ({ page }) => {
    await driveBlockedListPage(page, {
      route: '/settings/environments',
      read: ENVIRONMENT_TAGS_ROUTE,
      title: 'Could not load tags',
    })
  })

  test('L5: three failed reads give one card that names each and keeps every reason', async ({
    page,
  }) => {
    let failing = true
    await startAtRoot(page)
    await failApiRoute(page, PROFILE_TYPES_ROUTE, () =>
      failing ? { detail: TYPES_DETAIL, requestId: TYPES_REQUEST_ID } : null,
    )
    await failApiRoute(page, PROFILE_TAGS_ROUTE, () =>
      failing ? { detail: TAGS_DETAIL, requestId: TAGS_REQUEST_ID } : null,
    )
    await failApiRoute(page, ENVIRONMENT_NAMES_ROUTE, () =>
      failing ? { detail: ENVS_DETAIL, requestId: ENVS_REQUEST_ID } : null,
    )

    await page.goto('/profiles')
    await expectBlockedWith(page, 'Could not load profile types, tags and environments')

    // No failure is summarized away: the panel carries all three in full.
    const panel = await openBlockedDetails(page)
    await expect(panel).toContainText('profile types')
    await expect(panel).toContainText(TYPES_DETAIL)
    await expect(panel).toContainText(TYPES_REQUEST_ID)
    await expect(panel).toContainText('/profiles/types')
    await expect(panel).toContainText(TAGS_DETAIL)
    await expect(panel).toContainText(TAGS_REQUEST_ID)
    await expect(panel).toContainText('/profiles/tags')
    await expect(panel).toContainText(ENVS_DETAIL)
    await expect(panel).toContainText(ENVS_REQUEST_ID)
    await expect(panel).toContainText('/environments/names')

    // One Try Again recovers all three.
    failing = false
    await retryBlockedPage(page)
    await expect(blockedCard(page)).toHaveCount(0)
    await expectSurfaceLive(page)

    // The environment read really was applied: the create dialog is gated on it.
    // Re-click only while the dialog is still closed, so an open modal never
    // eats a second click.
    const dialog = page.locator('[role="dialog"]').first()
    await expect(async () => {
      if (!(await dialog.isVisible())) {
        await page.getByTestId('new-profile-button').click()
      }
      await expect(dialog).toBeVisible({ timeout: 2000 })
    }).toPass({ timeout: 20000 })
  })

  test('L6: Tests blocks when the tag read fails', async ({ page }) => {
    await driveBlockedListPage(page, {
      route: '/tests',
      read: TEST_TAGS_ROUTE,
      title: 'Could not load tags',
    })
  })

  test('L7: Regressions blocks when the tag read fails', async ({ page }) => {
    await driveBlockedListPage(page, {
      route: '/regressions',
      read: REGRESSION_TAGS_ROUTE,
      title: 'Could not load tags',
    })
  })
})
