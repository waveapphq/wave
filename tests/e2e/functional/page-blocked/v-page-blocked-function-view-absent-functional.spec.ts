/**
 * V-PAGE-BLOCKED-FUNCTION-VIEW-ABSENT: a deleted Function is an answer, not a
 * failed read
 *
 * Phase: functional-workflow. A stale library View URL names a Function the
 * backend no longer stores. The 404 is the server answering "gone", so the
 * View must not block on it: the boot completes and the canvas stages the
 * missing entry so the user can see what is gone and move on.
 *
 * Design Decisions: LIST-25 (a supported answer is an answer, not a failure).
 *
 * Pass Criteria:
 *  1. Booting the View on an unknown Function id raises no blocked card and
 *     the route content stays live.
 *  2. The canvas stages the missing Function's root so the absence is shown
 *     as an answer.
 */

import { test, expect } from '../../helpers/playwright-fixtures'
import { BACKEND_URL } from '../../helpers/config'
import { releaseWorkbenchOwnership } from '../../helpers/fn-seed'
import {
  blockedCard,
  expectNotBlocked,
  functionVersionRoute,
} from '../../helpers/page-block'
import type { Page } from '../../helpers/playwright-fixtures'

const GONE_ID = 'e2e-gone-function'
const GONE_VERSION = '1.0.0'
const VIEW_URL = `/workbench?viewFunction=${GONE_ID}&version=${GONE_VERSION}`

/** Boot the library View on the unknown id and wait for the backend's 404 answer. */
async function bootAbsentView(page: Page): Promise<void> {
  await releaseWorkbenchOwnership(page.request)
  await page.request.delete(`${BACKEND_URL}/workbench/session`).catch(() => {})
  await page.goto(VIEW_URL)
  await page.evaluate(() => localStorage.clear())
  const answered = page.waitForResponse(
    (r) => functionVersionRoute(GONE_ID, GONE_VERSION)(new URL(r.url())) && r.status() === 404,
    { timeout: 20000 },
  )
  await page.goto(VIEW_URL)
  await answered
  await page.waitForTimeout(500)
}

test.describe('V-PAGE-BLOCKED-FUNCTION-VIEW-ABSENT: the View answers instead of blocking', () => {
  test('a deleted Function does not block the library View', async ({ page }) => {
    await bootAbsentView(page)
    expect(
      await blockedCard(page).allInnerTexts(),
      'the 404 answer was reported as a failed read',
    ).toEqual([])
    await expectNotBlocked(page)
  })

  test('the missing Function is staged on the canvas as an answer', async ({ page }) => {
    await bootAbsentView(page)
    // The boot completes by staging the shared root stamped missing.
    await expect(page.locator('[data-testid="workflow-node-view-shared-root"]')).toBeVisible({
      timeout: 10000,
    })
    await expectNotBlocked(page)
  })
})
