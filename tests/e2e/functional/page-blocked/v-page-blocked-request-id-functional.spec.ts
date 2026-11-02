/**
 * V-PAGE-BLOCKED-REQUEST-ID: the details panel carries the real backend
 * correlation id
 *
 * Phase: functional-workflow. Every other page-blocked spec injects the id
 * through a faked error envelope, so none of them proves the id the user can
 * quote back is the one the server actually issued. Here a supporting read is
 * pointed at a record the backend really does not have, so the whole envelope
 * (reason, status, correlation id) comes from the running server, and the
 * correlation header is proven readable by the browser across origins.
 *
 * Design Decisions: LIST-17 (the details disclosure names the request that
 * failed and its id).
 *
 * Pass Criteria:
 *  1. A failed cross-origin read carries its correlation id in a header page
 *     script can read, and that header holds the same id the error body
 *     reports, so a client can always quote one id for a failed request.
 *  2. A genuinely failed supporting read blocks Profiles, and the details
 *     panel carries that response's own request id, its 404, the path that
 *     failed and the server's own reason.
 */

import { test, expect, type Route } from '../../helpers/playwright-fixtures'
import { BACKEND_URL } from '../../helpers/config'
import {
  ENVIRONMENT_NAMES_ROUTE,
  expectBlockedWith,
  openBlockedDetails,
  startAtRoot,
} from '../../helpers/page-block'

// A well-formed id the store never held, so the backend answers a real 404.
const MISSING_ENVIRONMENT_ID = '00000000-0000-4000-8000-0000000004a4'

test.describe('V-PAGE-BLOCKED-REQUEST-ID: the id on the card is the server\'s own', () => {
  test('RQ1: the correlation header is readable by page script across origins', async ({
    page,
  }) => {
    await startAtRoot(page)
    await page.goto('/dashboard')

    const seen = await page.evaluate(async (url) => {
      const response = await fetch(url)
      const body = (await response.json().catch(() => null)) as {
        meta?: { request_id?: string }
      } | null
      return {
        status: response.status,
        headerId: response.headers.get('X-Request-ID'),
        bodyId: body?.meta?.request_id ?? '',
      }
    }, `${BACKEND_URL}/environments/${MISSING_ENVIRONMENT_ID}`)

    expect(seen.status, 'the probe must reach a real backend failure').toBe(404)
    expect(seen.bodyId, 'the backend must issue a correlation id').toBeTruthy()
    expect(
      seen.headerId,
      'X-Request-ID must be readable across origins, and must be the id the body reports',
    ).toBe(seen.bodyId)
  })

  test('RQ2: a real backend failure puts its own request id on the card', async ({ page }) => {
    let backendStatus = 0
    let backendRequestId = ''

    // The read is pointed at a missing record, so the server answers for itself.
    await page.route(ENVIRONMENT_NAMES_ROUTE, async (route: Route) => {
      if (route.request().method() !== 'GET') {
        await route.fallback()
        return
      }
      const requested = new URL(route.request().url())
      const prefix = requested.pathname.startsWith('/api/') ? '/api' : ''
      const response = await route.fetch({
        url: `${requested.origin}${prefix}/environments/${MISSING_ENVIRONMENT_ID}`,
      })
      backendStatus = response.status()
      const body = (await response.json().catch(() => null)) as {
        meta?: { request_id?: string }
      } | null
      backendRequestId = body?.meta?.request_id ?? ''
      await route.fulfill({ response })
    })

    await startAtRoot(page)
    await page.goto('/profiles')
    await expectBlockedWith(page, 'Could not load environments')

    expect(backendStatus, 'the rerouted read must have failed at the backend').toBe(404)
    expect(backendRequestId, 'the backend must issue a correlation id').toBeTruthy()

    const panel = await openBlockedDetails(page)
    await expect(panel, 'the panel must carry the id the server issued').toContainText(
      `request ${backendRequestId}`,
    )
    await expect(panel, 'the panel must name the read that failed').toContainText(
      '/environments/names',
    )
    await expect(panel, 'the panel must carry the real status').toContainText('404')
    await expect(panel, 'the reason must be the server\'s own').toContainText(
      MISSING_ENVIRONMENT_ID,
    )
  })
})
