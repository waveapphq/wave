/**
 * V-SHELL-CONN-01: Connection-status banner visual layout
 *
 * Verifies the offline banner that surfaces a BE outage:
 * - Hidden when BE is reachable
 * - Visible at the bottom-right of the viewport when /api/* returns 502
 * - Carries a pulsing red dot, a WifiOff icon, the "Backend offline" copy,
 *   and a "Retry" button
 *
 * Implementation: frontend/src/components/connection-status-banner.tsx
 *
 * Pass Criteria:
 * 1. Banner is NOT in the DOM on initial load when BE responds normally.
 * 2. After backend calls are mocked to 502 and a fetch is triggered, the
 *    banner becomes visible within ~10s (one 502 trips the monitor with
 *    definitive=true).
 * 3. Banner is positioned at the bottom-right (CSS `position: fixed`).
 * 4. Banner does NOT cover the full viewport width (occupies <50%).
 * 5. Banner exposes an aria-live polite live region.
 * 6. Banner text reads "Backend offline. Reconnecting…".
 * 7. Banner exposes a "Retry" button.
 */

import { test, expect } from '../../helpers/playwright-fixtures'
import { BACKEND_PORT } from '../../helpers/config'

// Match either Vite-proxied calls (dev: localhost:3000/api/...) or
// direct calls (CI: VITE_API_BASE_URL=http://localhost:8000).
const BE_API_ROUTE = new RegExp(
  `^https?://[^/]+(?::${BACKEND_PORT}/|/api/)`,
)

test.describe('V-SHELL-CONN-01: Connection status banner', () => {
  test('hidden when BE is reachable, visible bottom-right on 502', async ({
    page,
  }) => {
    await page.goto('/dashboard')

    // 1. Banner must not be visible initially
    await expect(
      page.getByText('Backend offline. Reconnecting…'),
    ).toHaveCount(0)

    // 2. Simulate a BE outage at the browser-network level: any fetch
    //    that targets the backend (direct OR via proxy) returns 502 with
    //    the same JSON envelope Vite's proxy error handler produces in
    //    real life.
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

    // Trigger a fetch by navigating to /tests via the sidebar (client-
    // side React Router; avoids racing with Vite's HMR cache-busting).
    await page.getByRole('link', { name: /^tests$/i }).click()

    const banner = page.locator('output').filter({
      hasText: 'Backend offline. Reconnecting…',
    })
    await expect(banner).toBeVisible({ timeout: 10_000 })

    // 3. Position: bottom-right pill, not a full-width header
    const box = await banner.boundingBox()
    expect(box).toBeTruthy()
    const viewport = page.viewportSize()
    expect(viewport).toBeTruthy()
    // 4. Width occupies less than half the viewport (compact pill)
    expect(box!.width).toBeLessThan(viewport!.width * 0.5)
    // Right edge sits within the right ~third
    const rightEdge = box!.x + box!.width
    expect(rightEdge).toBeGreaterThan(viewport!.width * 0.66)
    // Bottom edge sits within the bottom ~third
    const bottomEdge = box!.y + box!.height
    expect(bottomEdge).toBeGreaterThan(viewport!.height * 0.66)

    // CSS `position: fixed`
    const position = await banner.evaluate((el) => getComputedStyle(el).position)
    expect(position).toBe('fixed')

    // 5. aria-live polite for accessibility
    expect(await banner.getAttribute('aria-live')).toBe('polite')

    // 7. Retry button
    await expect(
      banner.getByRole('button', { name: /retry/i }),
    ).toBeVisible()
  })
})
