/**
 * V-PAGE-BLOCKED-PRIMARY-TIMING: a failed record read reports without waiting
 * on a held supporting read
 *
 * Phase: functional-workflow. A list page starts its record read and its
 * supporting reads together. When the records fail, the page's own error state
 * must be up the moment that read settles: a supporting read still in flight
 * may not hold the failure back behind a loading skeleton. The companion spec
 * v-page-blocked-load-order guards the same rule on the workbench; this one
 * guards it on the two list surfaces.
 *
 * Design Decisions: LIST-20 (a failed record read wins outright and is never
 * gated on anything else), LIST-5 (the list error state), LIST-10 (records are
 * primary, every other read is supporting).
 *
 * Pass Criteria:
 *  1. Tests: with the record read failing and the suite-names read held 15s,
 *     "Unable to load tests" is up while that read has still not landed, and
 *     nothing is blocked.
 *  2. When the held read finally lands, the page is unchanged: still the one
 *     error state, still no card.
 *  3. Profiles behaves the same way with the environments read held.
 */

import { test, expect, type Page } from '../../helpers/playwright-fixtures'
import { ensureEnvironment } from '../../helpers/config'
import { delayApiRoute, failApiRoute, type ApiUrlMatcher } from '../../helpers/api-route'
import {
  ENVIRONMENT_NAMES_ROUTE,
  PROFILES_LIST_ROUTE,
  SUITE_NAMES_ROUTE,
  TESTS_LIST_ROUTE,
  expectNotBlocked,
  startAtRoot,
} from '../../helpers/page-block'

const FAILURE_DETAIL = 'Record store unavailable'

// Long enough that a page which waited for it would still be on its skeleton.
const HOLD_MS = 15000

interface TimingCase {
  route: string
  /** The records read the page exists to show. */
  primary: ApiUrlMatcher
  /** A supporting read of the same load, held back. */
  held: ApiUrlMatcher
  errorTitle: string
}

/** Counts the responses that actually landed for one read. */
function countLandedReads(page: Page, matcher: ApiUrlMatcher): () => number {
  let landed = 0
  page.on('response', (response) => {
    if (response.request().method() !== 'GET') return
    if (matcher(new URL(response.url()))) landed += 1
  })
  return () => landed
}

async function driveHeldSupportingRead(page: Page, timingCase: TimingCase): Promise<void> {
  await startAtRoot(page)
  await failApiRoute(page, timingCase.primary, { detail: FAILURE_DETAIL })
  await delayApiRoute(page, timingCase.held, HOLD_MS)
  const heldLanded = countLandedReads(page, timingCase.held)

  const primaryFailed = page.waitForResponse(
    (response) =>
      response.request().method() === 'GET' &&
      timingCase.primary(new URL(response.url())) &&
      response.status() === 500,
    { timeout: 20000 },
  )
  await page.goto(timingCase.route)
  await primaryFailed

  // The records settled failed, so the page's own error state is due now.
  const errorState = page.getByTestId('error-state')
  await expect(errorState).toBeVisible({ timeout: 8000 })
  await expect(page.getByTestId('error-state-title')).toHaveText(timingCase.errorTitle)
  await expect(page.getByTestId('error-state-description')).toContainText(FAILURE_DETAIL)

  // The proof: the supporting read has still not come back.
  expect(
    heldLanded(),
    'the record failure must be reported before the held supporting read lands',
  ).toBe(0)
  await expectNotBlocked(page)

  // The held read lands late and changes nothing.
  await expect
    .poll(heldLanded, {
      timeout: HOLD_MS + 15000,
      message: 'the held supporting read must eventually land',
    })
    .toBeGreaterThan(0)
  await page.waitForTimeout(1000)
  await expect(errorState).toBeVisible()
  await expectNotBlocked(page)
}

test.describe('V-PAGE-BLOCKED-PRIMARY-TIMING: the record failure is never held back', () => {
  test.beforeAll(async ({ request }) => {
    await ensureEnvironment(request)
  })

  test('PT1: the Tests list reports its failed record read while the suite read is held', async ({
    page,
  }) => {
    await driveHeldSupportingRead(page, {
      route: '/tests',
      primary: TESTS_LIST_ROUTE,
      held: SUITE_NAMES_ROUTE,
      errorTitle: 'Unable to load tests',
    })
  })

  test('PT2: the Profiles list reports its failed record read while the environments read is held', async ({
    page,
  }) => {
    await driveHeldSupportingRead(page, {
      route: '/profiles',
      primary: PROFILES_LIST_ROUTE,
      held: ENVIRONMENT_NAMES_ROUTE,
      errorTitle: 'Unable to load profiles',
    })
  })
})
