/**
 * V-PAGE-BLOCKED-CONFIG-ANSWER: a capability that is switched off is an
 * answer, and a genuine failure is a toast, never a block
 *
 * Phase: functional-workflow. The secret-masking flags are read once on every
 * app boot from an admin API that a default install legitimately has switched
 * off. Reading that "not enabled" answer as a failure would blur every page of
 * the product on every boot. A genuine failure of the same read is still worth
 * saying, but it belongs in a toast: nothing the user asked for is missing
 * from the page in front of them.
 *
 * Design Decisions: LIST-25 (a supported answer is an answer, not a failure),
 * LIST-26 (a background read reports without taking the surface away).
 *
 * Pass Criteria:
 *  1. With the admin read answering "not enabled", the read really is issued
 *     and no page blocks, boot after boot and page after page.
 *  2. That answer raises no toast either: nothing went wrong.
 *  3. A genuine failure of the same read raises the "Could Not Load Masking
 *     Settings" toast carrying the server's reason, and still blocks nothing.
 */

import { test, expect } from '../../helpers/playwright-fixtures'
import { apiPathMatcher, countApiFetches, failApiRoute } from '../../helpers/api-route'
import { expectNotBlocked, startAtRoot } from '../../helpers/page-block'

const ADMIN_MASKING_ROUTE = apiPathMatcher('/admin/secret-masking')
const NOT_ENABLED_DETAIL = 'Admin API is not enabled on this server'
const FAILURE_DETAIL = 'Masking settings store unavailable'
const MASKING_TOAST = 'Could Not Load Masking Settings'

// Long enough for a toast that was going to be raised to have been raised.
const SETTLE_MS = 1000

test.describe('V-PAGE-BLOCKED-CONFIG-ANSWER: the off switch never blurs the product', () => {
  test('CA1: a not-enabled admin read blocks nothing and says nothing', async ({ page }) => {
    await startAtRoot(page)
    await failApiRoute(page, ADMIN_MASKING_ROUTE, {
      status: 403,
      detail: NOT_ENABLED_DETAIL,
    })
    const maskingReads = countApiFetches(page, ADMIN_MASKING_ROUTE)

    await page.goto('/dashboard')
    await expect(page.getByTestId('dashboard-page')).toBeVisible({ timeout: 20000 })

    // Without this the spec would pass on a read that never happened.
    await expect
      .poll(maskingReads, { timeout: 15000, message: 'the masking read must be issued on boot' })
      .toBeGreaterThan(0)
    await expectNotBlocked(page)
    await page.waitForTimeout(SETTLE_MS)
    await expect(
      page.locator('[data-toast]', { hasText: MASKING_TOAST }),
      'a capability being off is not something to report',
    ).toHaveCount(0)

    // The answer follows the user around without taking anything away.
    await page.locator('[data-testid="sidebar"] a[href="/tests"]').click()
    await expect(page.getByTestId('tests-page')).toBeVisible({ timeout: 20000 })
    await expectNotBlocked(page)

    const readsBeforeReboot = maskingReads()
    await page.goto('/profiles')
    await expect(page.getByTestId('profiles-page')).toBeVisible({ timeout: 20000 })
    await expect
      .poll(maskingReads, { timeout: 15000, message: 'a fresh boot must read again' })
      .toBeGreaterThan(readsBeforeReboot)
    await expectNotBlocked(page)
  })

  test('CA2: a genuine failure of the same read is a toast, not a block', async ({ page }) => {
    await startAtRoot(page)
    await failApiRoute(page, ADMIN_MASKING_ROUTE, { detail: FAILURE_DETAIL })

    await page.goto('/dashboard')
    await expect(page.getByTestId('dashboard-page')).toBeVisible({ timeout: 20000 })

    const toast = page.locator('[data-toast]', { hasText: MASKING_TOAST })
    await expect(toast).toBeVisible({ timeout: 15000 })
    await expect(toast).toContainText(FAILURE_DETAIL)
    await expectNotBlocked(page)
  })
})
