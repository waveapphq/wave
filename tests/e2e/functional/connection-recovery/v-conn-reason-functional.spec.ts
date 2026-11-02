/**
 * V-CONN-REASON: an unreachable backend and a rejected origin are reported
 * differently, and both name the address
 *
 * Phase: functional-workflow. A backend that is not listening and a request
 * the browser blocked for origin policy raise the same opaque network error.
 * The app probes the address to tell them apart, so the reason on the blocked
 * card is actionable rather than generic.
 *
 * Design Decisions: LIST-17 (the details disclosure names the read that
 * failed and its reason).
 *
 * Pass Criteria:
 *  1. With nothing answering at the backend address, the reason names that
 *     address: "Cannot reach the backend at <address>".
 *  2. With the address answering but requests blocked, the reason instead
 *     says the backend is running and rejected this origin, and names both
 *     the address and the origin. The two reasons are not the same text.
 *  3. Neither reason prints a missing HTTP status - no "undefined", no "NaN".
 */

import { test, expect, type Page, type Route } from '../../helpers/playwright-fixtures'
import { BACKEND_URL, FRONTEND_URL } from '../../helpers/config'
import {
  ENVIRONMENT_NAMES_ROUTE,
  expectBlockedWith,
  openBlockedDetails,
  startAtRoot,
} from '../../helpers/page-block'

const BACKEND_ORIGIN = new URL(BACKEND_URL).origin
const FRONTEND_ORIGIN = new URL(FRONTEND_URL).origin

/** The diagnosis probe and the monitor's recovery probe share this path. */
function isHealthProbe(url: URL): boolean {
  const onBackend = url.origin === BACKEND_ORIGIN
  const onProxy = url.origin === FRONTEND_ORIGIN && url.pathname.startsWith('/api/')
  return (onBackend || onProxy) && url.pathname.endsWith('/health')
}

/**
 * Kill the one supporting read the Profiles page blocks on, at the network
 * level so the client asks for a diagnosis, and return the reason the card
 * reports. Every other read still reaches the real backend, so the shell and
 * the route render normally.
 */
async function reasonOnBlockedCard(page: Page): Promise<string> {
  await page.route(ENVIRONMENT_NAMES_ROUTE, (route: Route) =>
    route.request().method() === 'GET' ? route.abort() : route.fallback(),
  )
  await page.goto('/profiles')
  await expectBlockedWith(page, 'Could not load environments')
  const panel = await openBlockedDetails(page)
  return panel.innerText()
}

test.describe('V-CONN-REASON: the outage reason names the address', () => {
  test('CR1: nothing answering at the address reports it as unreachable', async ({ page }) => {
    await startAtRoot(page)

    // The probe finds nothing at the address either.
    await page.route(
      (url) => isHealthProbe(url),
      (route: Route) => route.abort(),
    )

    const reason = await reasonOnBlockedCard(page)

    expect(reason, 'the reason must name the address the app could not reach').toContain(
      `Cannot reach the backend at ${BACKEND_URL}`,
    )
    expect(reason, 'a reason must never print a missing status').not.toMatch(/undefined|NaN/)
  })

  test('CR2: an address that answers but refuses this origin says so', async ({ page }) => {
    await startAtRoot(page)

    // The diagnosis probe only asks whether anything answered at the address.
    // Letting the probe through while the real read fails is exactly the shape
    // of an origin rejection. The reason is captured on the error the moment
    // the read fails, so the monitor recovering afterwards cannot rewrite it.
    await page.route(
      (url) => isHealthProbe(url),
      (route: Route) => route.fulfill({ status: 200, body: '' }),
    )

    const reason = await reasonOnBlockedCard(page)

    expect(reason, 'the reason must say the backend answered').toContain(
      `The backend at ${BACKEND_URL} is running but rejected requests from ${FRONTEND_ORIGIN}`,
    )
    expect(reason, 'the reason must name the origin to allow').toContain(
      `Add ${FRONTEND_ORIGIN} to its allowed origins.`,
    )
    expect(reason, 'the two outages must not report the same text').not.toContain(
      `Cannot reach the backend at ${BACKEND_URL}`,
    )
    expect(reason, 'a reason must never print a missing status').not.toMatch(/undefined|NaN/)
  })
})
