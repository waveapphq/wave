/**
 * V-SESS-CANCEL-RACE: a cancel losing to an approval never claims the request
 * is still open
 *
 * Phase: functional-workflow. The requester cancels its take-over while the
 * holder is approving it. The approval lands first, so the requester becomes
 * the holder; the late cancel is refused by the server because the request
 * was already resolved. Telling the new holder "your request is still open
 * and can still be approved" would be factually wrong.
 *
 * Design Decisions: SESS-5..8 (take-over protocol); feedback states what
 * actually happened.
 *
 * Pass Criteria:
 *  1. The requester becomes the editable holder; the old holder mirrors.
 *  2. The held cancel answers 404 after the hand-over.
 *  3. No toast claims the request is still open and can still be approved.
 */

import { test, expect } from '../../helpers/playwright-fixtures'
import type { BrowserContext, Page } from '@playwright/test'
import { SEL, openHolderAndMirror, resetOwnership } from '../../helpers/ownership'
import { delayApiRoute } from '../../helpers/api-route'
import { OWNERSHIP_TAKEOVER_CANCEL_ROUTE } from '../../helpers/page-block'

const open: BrowserContext[] = []
const track = (context: BrowserContext) => open.push(context)

/** A named alertdialog on a page (survives dialog swaps without strict-mode clashes). */
const dialog = (page: Page, name: string) => page.getByRole('alertdialog', { name })

const FORBIDDEN_SENTENCE = 'Your request is still open and can still be approved'

interface ToastLog extends Window {
  __forbiddenToasts?: string[]
}

/**
 * Record every toast carrying the sentence from now on. Toasts dismiss
 * themselves after a few seconds, so reading the screen once at the end can
 * miss one that came and went.
 */
async function watchForbiddenToast(page: Page, sentence: string): Promise<void> {
  await page.evaluate((phrase) => {
    const seen: string[] = []
    ;(window as ToastLog).__forbiddenToasts = seen
    const scan = () => {
      for (const node of document.querySelectorAll('[data-toast]')) {
        const text = node.textContent ?? ''
        if (text.includes(phrase) && !seen.includes(text)) seen.push(text)
      }
    }
    new MutationObserver(scan).observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
    })
    scan()
  }, sentence)
}

function forbiddenToasts(page: Page): Promise<string[]> {
  return page.evaluate(() => (window as ToastLog).__forbiddenToasts ?? [])
}

test.describe('V-SESS-CANCEL-RACE: the losing cancel stays silent', () => {
  test.beforeEach(async ({ request }) => {
    await resetOwnership(request)
  })

  test.afterEach(async ({ request }) => {
    for (const context of open.splice(0)) await context.close().catch(() => {})
    await resetOwnership(request)
  })

  test('a cancel overtaken by the approval never announces an open request', async ({
    browser,
    request,
  }) => {
    const { a, b } = await openHolderAndMirror(browser, request, track)
    await watchForbiddenToast(b.page, FORBIDDEN_SENTENCE)

    // Hold B's cancel long enough for A's approval to land first.
    await delayApiRoute(b.page, OWNERSHIP_TAKEOVER_CANCEL_ROUTE, 4000, 'POST')

    await b.page.locator(SEL.takeOver).click()
    await expect(dialog(b.page, 'Waiting to take over')).toBeVisible()
    await expect(dialog(a.page, 'Another session wants to take over')).toBeVisible()

    const cancelAnswered = b.page.waitForResponse(
      (r) => OWNERSHIP_TAKEOVER_CANCEL_ROUTE(new URL(r.url())) && r.status() === 404,
      { timeout: 20000 },
    )
    await dialog(b.page, 'Waiting to take over').getByRole('button', { name: 'Cancel' }).click()
    await dialog(a.page, 'Another session wants to take over')
      .getByRole('button', { name: 'Hand over' })
      .click()

    // The approval won: B holds, A mirrors.
    await expect(b.page.locator(SEL.banner)).toHaveCount(0, { timeout: 15000 })
    await expect(b.page.locator(SEL.canvasReadOnly)).toHaveCount(0)
    await expect(a.page.locator(SEL.bannerPerson)).toBeVisible()

    // The late cancel is refused: the request no longer exists.
    await cancelAnswered
    await b.page.waitForTimeout(3000)

    // A tab that already holds the session may never be told its request is still open.
    expect(
      await forbiddenToasts(b.page),
      'the new holder was told its request is still open',
    ).toEqual([])
    await expect(
      b.page.locator('[data-toast]', { hasText: FORBIDDEN_SENTENCE }),
    ).toHaveCount(0)
  })
})
