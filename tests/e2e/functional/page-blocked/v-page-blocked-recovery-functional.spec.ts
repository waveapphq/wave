/**
 * V-PAGE-BLOCKED-RECOVERY: Try Again, the newest failure, and the details panel
 *
 * Phase: functional-workflow. Forces GET /environments/names to fail so the
 * Profiles page blocks, then drives the card's only two controls.
 *
 * Design Decisions: LIST-16 (Try Again re-runs only the read that failed and
 * carries the newest failure), LIST-17 (folded details, height cap, copy
 * control).
 *
 * Pass Criteria:
 *  1. Try Again over a restored backend removes the card, lifts inert, and the
 *     page works again - without re-reading anything that had not failed.
 *  2. Try Again that fails again keeps the card, shows a busy state while it
 *     runs, and replaces the reason with the newest one.
 *  3. Details are folded by default, the copy control exists only while they
 *     are open, the panel scrolls on both axes inside a card that still fits
 *     the window, the control holds its corner while the panel scrolls, and it
 *     copies the whole payload rather than the visible part.
 */

import { test, expect, type Page } from '../../helpers/playwright-fixtures'
import { ensureEnvironment } from '../../helpers/config'
import { countApiFetches, type ApiFailure } from '../../helpers/api-route'
import {
  ENVIRONMENT_NAMES_ROUTE,
  PROFILES_LIST_ROUTE,
  blockedCard,
  failEnvironmentNames,
  isRouteContentInert,
  openBlockedDetails,
} from '../../helpers/page-block'

const FIRST_DETAIL = 'Environment registry unavailable'
const FIRST_REQUEST_ID = 'pblk-request-1111-aaaa'
const SECOND_DETAIL = 'Registry replica lost quorum'
const SECOND_REQUEST_ID = 'pblk-request-2222-bbbb'

const TRACE_SENTINEL = 'PBLK-TRACE-LAST-LINE'
const WIDE_LINE = `W${'i'.repeat(400)}de`
const LONG_MESSAGE = [
  FIRST_DETAIL,
  ...Array.from({ length: 200 }, (_, i) => `  at registry layer ${i}`),
  WIDE_LINE,
  TRACE_SENTINEL,
].join('\n')

async function startAtRoot(page: Page): Promise<void> {
  await page.goto('/')
  await page.evaluate(() => localStorage.clear())
}

/** Measure the panel's scroll container without depending on which node carries it. */
async function panelScrollState(page: Page): Promise<{
  vertical: boolean
  horizontal: boolean
  atTop: boolean
  offScreenRatio: number
} | null> {
  return page.getByTestId('page-blocked-details-panel').evaluate((root) => {
    const nodes = [root, ...Array.from(root.querySelectorAll('*'))] as HTMLElement[]
    const scroller = nodes.find((node) => node.scrollHeight > node.clientHeight + 1)
    if (!scroller) return null
    return {
      vertical: true,
      horizontal: nodes.some((node) => node.scrollWidth > node.clientWidth + 1),
      atTop: scroller.scrollTop === 0,
      offScreenRatio: (scroller.scrollHeight - scroller.clientHeight) / scroller.scrollHeight,
    }
  })
}

test.describe('V-PAGE-BLOCKED-RECOVERY: the blocked card recovers, re-blocks and explains', () => {
  test.beforeAll(async ({ request }) => {
    await ensureEnvironment(request)
  })

  test('R1: Try Again clears the block and re-runs only the read that failed', async ({
    page,
  }) => {
    let failing = true
    await startAtRoot(page)
    await failEnvironmentNames(page, () => (failing ? { detail: FIRST_DETAIL } : null))

    const profileReads = countApiFetches(page, PROFILES_LIST_ROUTE)
    const environmentReads = countApiFetches(page, ENVIRONMENT_NAMES_ROUTE)

    await page.goto('/profiles')
    await expect(blockedCard(page)).toBeVisible({ timeout: 20000 })
    expect(await isRouteContentInert(page), 'route content must be inert').toBe(true)

    const profileReadsBefore = profileReads()
    const environmentReadsBefore = environmentReads()

    failing = false
    await page.getByTestId('page-blocked-retry').click()

    await expect(blockedCard(page)).toHaveCount(0)
    expect(await isRouteContentInert(page), 'inert must be lifted on recovery').toBe(false)
    expect(environmentReads(), 'Try Again must re-run the failed read exactly once').toBe(
      environmentReadsBefore + 1,
    )
    expect(
      profileReads(),
      'Try Again must not re-read the records the page already has',
    ).toBe(profileReadsBefore)

    // The page is fully usable again: the create dialog is gated on knowing the
    // environments, so it opening proves the recovered read was applied.
    await page.getByTestId('new-profile-button').click()
    await expect(page.locator('[role="dialog"]').first()).toBeVisible()
  })

  test('R2: a failing Try Again keeps the card, shows busy, and carries the newest reason', async ({
    page,
  }) => {
    let failure: ApiFailure = { detail: FIRST_DETAIL, requestId: FIRST_REQUEST_ID }
    await startAtRoot(page)
    await failEnvironmentNames(page, () => failure)

    await page.goto('/profiles')
    await expect(blockedCard(page)).toBeVisible({ timeout: 20000 })

    const panel = await openBlockedDetails(page)
    await expect(panel).toContainText(FIRST_DETAIL)
    await expect(panel).toContainText(FIRST_REQUEST_ID)

    failure = {
      status: 503,
      detail: SECOND_DETAIL,
      requestId: SECOND_REQUEST_ID,
      delayMs: 1500,
    }

    const retry = page.getByTestId('page-blocked-retry')
    await retry.click()
    await expect(retry, 'Try Again must be disabled while it runs').toBeDisabled()
    await expect(retry, 'Try Again must come back once the attempt lands').toBeEnabled({
      timeout: 20000,
    })

    await expect(blockedCard(page), 'a failed retry must keep the card').toBeVisible()
    expect(
      await isRouteContentInert(page),
      'the page must stay inert after a failed retry',
    ).toBe(true)

    const reopened = await openBlockedDetails(page)
    await expect(reopened).toContainText(SECOND_DETAIL)
    await expect(reopened).toContainText(SECOND_REQUEST_ID)
    await expect(reopened, 'attempts must not accumulate').not.toContainText(FIRST_DETAIL)
    await expect(reopened, 'attempts must not accumulate').not.toContainText(FIRST_REQUEST_ID)
  })

  test('R3: details fold away, scroll inside a capped card, and copy the whole payload', async ({
    page,
  }) => {
    // The real clipboard is a browser primitive; recording its argument is what
    // proves the card hands over the whole payload.
    await page.addInitScript(() => {
      const recorder = window as unknown as { __pblkCopied: string[] }
      recorder.__pblkCopied = []
      if (navigator.clipboard) {
        Object.defineProperty(navigator.clipboard, 'writeText', {
          configurable: true,
          writable: true,
          value: async (text: string) => {
            recorder.__pblkCopied.push(text)
          },
        })
      }
    })

    await startAtRoot(page)
    await failEnvironmentNames(page, { detail: LONG_MESSAGE, requestId: FIRST_REQUEST_ID })

    await page.goto('/profiles')
    const card = blockedCard(page)
    await expect(card).toBeVisible({ timeout: 20000 })
    await expect(card).toHaveAttribute('role', 'alert')
    await expect(page.getByTestId('page-blocked-title')).toHaveText(
      'Could not load environments',
    )
    await expect(page.getByTestId('page-blocked-description')).toHaveText(
      'This page cannot be used until it loads.',
    )
    await expect
      .poll(
        () =>
          card.evaluate(
            (el) => el === document.activeElement || el.contains(document.activeElement),
          ),
        { message: 'the card must take focus when it appears' },
      )
      .toBe(true)

    // 1. Folded by default, and the copy control does not exist yet.
    const panel = page.getByTestId('page-blocked-details-panel')
    const copy = page.getByTestId('page-blocked-copy')
    await expect(page.getByTestId('page-blocked-details-trigger')).toBeVisible()
    await expect(panel, 'details must be folded by default').toBeHidden()
    await expect(copy, 'the copy control must not exist while details are folded').toBeHidden()

    // 2. Opening reveals the payload and the copy control.
    await openBlockedDetails(page)
    await expect(copy).toBeVisible()
    await expect(panel).toContainText('/environments/names')
    await expect(panel).toContainText(FIRST_REQUEST_ID)
    await expect(panel).toContainText(FIRST_DETAIL)

    // 3. The panel scrolls on both axes and the card still fits the window.
    const scrolling = await panelScrollState(page)
    expect(scrolling, 'the details panel must have a scroll container').not.toBeNull()
    expect(scrolling!.vertical, 'the details panel must be height-capped and scroll').toBe(true)
    expect(scrolling!.horizontal, 'the details panel must scroll horizontally').toBe(true)
    expect(scrolling!.atTop, 'the panel must open scrolled to the top').toBe(true)
    expect(
      scrolling!.offScreenRatio,
      'most of the payload must be out of view, or copying it proves nothing',
    ).toBeGreaterThan(0.5)

    const viewport = page.viewportSize()
    const cardBox = await card.boundingBox()
    expect(cardBox, 'the card must be laid out').toBeTruthy()
    expect(viewport, 'the viewport size must be known').toBeTruthy()
    expect(cardBox!.y, 'the card must not overflow the top of the window').toBeGreaterThanOrEqual(
      -2,
    )
    expect(
      cardBox!.y + cardBox!.height,
      'the card must not grow past the bottom of the window',
    ).toBeLessThanOrEqual(viewport!.height + 2)

    // 4. Copy takes the whole payload in the exact shape the panel renders.
    await copy.click()
    await expect(page.getByTestId('page-blocked-copy-success')).toBeVisible()
    const copied = await page.evaluate(
      () => (window as unknown as { __pblkCopied: string[] }).__pblkCopied,
    )
    expect(copied, 'exactly one copy must have been made').toHaveLength(1)
    expect(copied[0], 'method and path share the first line').toMatch(
      /^GET\s+\/environments\/names$/m,
    )
    expect(copied[0], 'status and reason share a line').toMatch(/^500\s/m)
    expect(copied[0], 'the duration is reported in whole milliseconds').toMatch(/^\d+ ms$/m)
    expect(copied[0], 'the request id is reported').toMatch(
      new RegExp(`^request ${FIRST_REQUEST_ID}$`, 'm'),
    )
    expect(copied[0], 'the timestamp is local wall-clock time').toMatch(
      /^\d{2}:\d{2}:\d{2} local$/m,
    )
    expect(copied[0], 'the copied payload must reach the last trace line').toContain(
      TRACE_SENTINEL,
    )

    // 5. The control holds its corner while the panel scrolls, because it is not
    //    inside the scrolling area. Assert the structure, not only the outcome.
    const sticky = await panel.evaluate((root) => {
      const nodes = [root, ...Array.from(root.querySelectorAll('*'))] as HTMLElement[]
      const scroller = nodes.find((node) => node.scrollHeight > node.clientHeight + 1)
      const control = document.querySelector('[data-testid="page-blocked-copy"]')
      if (!scroller || !control) return null
      const before = control.getBoundingClientRect().top
      scroller.scrollTop = scroller.scrollHeight
      const after = control.getBoundingClientRect()
      const panelBox = root.getBoundingClientRect()
      return {
        scrolled: scroller.scrollTop > 0,
        insideScroller: scroller.contains(control),
        moved: Math.abs(after.top - before),
        overPanel:
          after.top >= panelBox.top - 2 &&
          after.bottom <= panelBox.bottom + 2 &&
          after.right <= panelBox.right + 2,
      }
    })
    expect(sticky, 'the panel must have a scroller and a copy control').not.toBeNull()
    expect(sticky!.scrolled, 'the panel must have actually scrolled').toBe(true)
    expect(
      sticky!.insideScroller,
      'the copy control must sit outside the scrolling area, which is what keeps it put',
    ).toBe(false)
    expect(sticky!.moved, 'the copy control must stay put while the panel scrolls').toBeLessThanOrEqual(2)
    expect(
      sticky!.overPanel,
      'the copy control must still sit in the top-right of the panel after scrolling',
    ).toBe(true)

    // 6. Folding the details takes the copy control away again.
    await page.getByTestId('page-blocked-details-trigger').click()
    await expect(panel).toBeHidden()
    await expect(copy, 'the copy control must exist only while details are open').toBeHidden()
  })
})
