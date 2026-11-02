/**
 * Connection Recovery Functional Test
 *
 * Verifies end-to-end that the FE's BE-outage handling actually works:
 *   1. A 502 from the backend trips the connection monitor (definitive
 *      signal, single failure).
 *   2. The bottom-right banner appears.
 *   3. When the backend starts answering 200 again, clicking "Retry"
 *      clears the banner.
 *   4. After recovery the route content remounts (via the connection
 *      monitor's dataEpoch counter) and re-fetches its data, WITHOUT a
 *      full window.location.reload.
 *
 * The browser-side `page.route` mock stands in for the real outage. The
 * route regex matches both Vite-proxied calls (dev: localhost:3000/api/...)
 * and direct calls (CI: VITE_API_BASE_URL points at localhost:8000), so
 * the test is portable across both modes.
 *
 * Client-side React Router navigation is used instead of `page.reload()`
 * - the latter races with Vite's dynamic-import HMR cache-busting and
 * produces a "Failed to fetch dynamically imported module" overlay that
 * has nothing to do with the feature under test.
 */

import { test, expect } from '../../helpers/playwright-fixtures'
import { BACKEND_PORT } from '../../helpers/config'

// Matches both /api/<path> (Vite proxy) and :<BE port>/<path> (direct).
const BE_API_ROUTE = new RegExp(
  `^https?://[^/]+(?::${BACKEND_PORT}/|/api/)`,
)
// Matches GET /tests list calls regardless of whether they go through
// the proxy or hit the BE directly.
const TESTS_LIST_PATH = new RegExp(
  `(?::${BACKEND_PORT}|/api)/tests(?:\\?|$)`,
)

test.describe('Connection recovery: outage banner + content remount', () => {
  test('502 trips the banner; recovery clears it and re-fetches list data', async ({
    page,
  }) => {
    // 1. Land on the dashboard with the real BE so the FE bundle and
    //    sidebar are fully hydrated before any mocks are installed.
    await page.goto('/dashboard')
    await page.waitForLoadState('networkidle')

    // Track every list fetch to /tests so we can prove the list
    // re-fetches after recovery.
    let testsListRequests = 0
    page.on('request', (req) => {
      if (TESTS_LIST_PATH.test(req.url())) {
        testsListRequests++
      }
    })

    // 2. Mock backend calls to 502.
    await page.route(BE_API_ROUTE, (route) =>
      route.fulfill({
        status: 502,
        contentType: 'application/json',
        body: JSON.stringify({
          error: {
            code: 'be_offline',
            message: `Cannot reach the backend at http://localhost:${BACKEND_PORT}`,
          },
        }),
      }),
    )

    // 3. Navigate to /tests via the sidebar (client-side React Router).
    //    The list hook fires GET .../tests, the mock answers 502, and
    //    the api-client trips the monitor with definitive=true.
    await page.getByRole('link', { name: /^tests$/i }).click()
    await expect(page).toHaveURL(/\/tests$/)

    // Banner appears.
    const banner = page.locator('output').filter({
      hasText: 'Backend offline. Reconnecting…',
    })
    await expect(banner).toBeVisible({ timeout: 10_000 })

    const requestsAtOutage = testsListRequests
    expect(requestsAtOutage).toBeGreaterThan(0)

    // 4. Simulate BE recovery: drop the 502 mock. The real BE now serves
    //    /health (probe will succeed) and /tests (re-fetch after the
    //    dataEpoch-driven remount).
    await page.unroute(BE_API_ROUTE)

    // 5. Click Retry to force an immediate probe (avoids the 5s probe
    //    interval wait).
    await banner.getByRole('button', { name: /retry/i }).click()

    // 6. Banner clears once the probe hits the real BE and reportSuccess
    //    fires.
    await expect(banner).toBeHidden({ timeout: 10_000 })

    // 7. The dataEpoch bump on offline -> online remounts the route
    //    content; the list hook re-runs on mount and fetches /tests
    //    again. Allow a short window for that request to fly.
    await expect.poll(
      () => testsListRequests,
      {
        timeout: 10_000,
        message: 'expected /tests refetch after reconnect',
      },
    ).toBeGreaterThan(requestsAtOutage)

    // 8. URL is unchanged - no window.location.reload happened.
    await expect(page).toHaveURL(/\/tests$/)
  })
})
