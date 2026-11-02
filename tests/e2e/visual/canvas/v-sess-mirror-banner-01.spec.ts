/**
 * V-SESS-MIRROR-BANNER-01: Session-mirror banner appearance
 * Design Decisions: SESS-1..4; WSRV-9 (person See Connection); RUNM-1..4
 * REQ: REQ-5.2.7.15
 *
 * Pass Criteria:
 * 1. A person-held mirror shows the indigo banner naming the holder by its
 *    connection identity ("another session on {browser} ({os})"), never a raw
 *    per-tab id, WITH the See Connection affordance (ungated for a person
 *    holder).
 * 2. An assistant-held mirror shows the violet MCP banner naming the client
 *    "(MCP)" WITH the See connection affordance.
 * 3. In both variants the canvas is read-only and Take Over is present.
 * 4. With an announced run the trailing phrase reads exactly
 *    "read-only, running live" for BOTH holder kinds, and the toolbar right
 *    side swaps to the run's env readout plus Focus Current only.
 *
 * The holder states are driven by intercepting GET /workbench/ownership -
 * the assistant (mcp) holder is not reachable from a browser-only session.
 */

import { test, expect } from '../../helpers/playwright-fixtures'
import { stubSessionRecovery, waitForCanvasLoad } from '../../helpers/canvas'
import { FRONTEND_URL } from '../../helpers/config'
import { SEL, mockOwnershipHolder, type MirroredRunWire } from '../../helpers/ownership'

const MOCK_RUN: MirroredRunWire = {
  session_id: 'e2e-run-session-1',
  test_id: 'e2e-run-test-1',
  test_name: 'Mirrored Run Test',
  environment_id: 'e2e-env-1',
  environment_name: 'Staging',
  status: 'running',
}

test.describe('V-SESS-MIRROR-BANNER-01: mirror banner variants', () => {
  test('person-held mirror: indigo banner naming the connection, with See Connection', async ({
    browser,
  }) => {
    const context = await browser.newContext({ baseURL: FRONTEND_URL })
    const page = await context.newPage()
    await stubSessionRecovery(page)
    // A person holder is named by its connection identity ("{browser} ({os})").
    await mockOwnershipHolder(page, { id: 'e2e-person-1', label: 'Chrome (macOS)', kind: 'person' })
    await page.goto('/workbench')
    await waitForCanvasLoad(page)

    await expect(page.locator(SEL.bannerPerson)).toBeVisible()
    const banner = page.locator(SEL.banner)
    await expect(banner).toContainText('another session on Chrome (macOS)')
    await expect(banner).toContainText('read-only, updates as they edit')
    await expect(banner, 'a person holder is never named by a raw tab id').not.toContainText('Tab')
    await expect(
      page.locator(SEL.seeConnection),
      'See Connection is ungated for a person holder (WSRV-9)',
    ).toBeVisible()
    await expect(page.locator(SEL.takeOver)).toBeVisible()
    await expect(page.locator(SEL.canvasReadOnly)).toBeVisible()

    await context.close()
  })

  test('assistant-held mirror: violet MCP banner with See connection', async ({ browser }) => {
    const context = await browser.newContext({ baseURL: FRONTEND_URL })
    const page = await context.newPage()
    await stubSessionRecovery(page)
    await mockOwnershipHolder(page, { id: 'e2e-mcp-1', label: 'Claude Code (MCP)', kind: 'mcp' })
    await page.goto('/workbench')
    await waitForCanvasLoad(page)

    await expect(page.locator(SEL.bannerMcp)).toBeVisible()
    const banner = page.locator(SEL.banner)
    await expect(banner).toContainText('Claude Code (MCP)')
    await expect(banner).toContainText('read-only, building live')
    await expect(page.locator(SEL.seeConnection)).toBeVisible()
    await expect(page.locator(SEL.takeOver)).toBeVisible()
    await expect(page.locator(SEL.canvasReadOnly)).toBeVisible()

    await context.close()
  })

  // Per RUNM-2/3/4: the run variant is a phrase change plus the env-readout
  // toolbar swap, identical for person and assistant holders.
  for (const holder of [
    { id: 'e2e-person-run', label: 'Chrome (macOS)', kind: 'person' as const },
    { id: 'e2e-mcp-run', label: 'Claude Code (MCP)', kind: 'mcp' as const },
  ]) {
    test(`${holder.kind}-held mirror with an announced run: running-live banner + env readout`, async ({
      browser,
    }) => {
      const context = await browser.newContext({ baseURL: FRONTEND_URL })
      const page = await context.newPage()
      await stubSessionRecovery(page)
      await mockOwnershipHolder(page, holder, 1, MOCK_RUN)
      await page.goto('/workbench')
      await waitForCanvasLoad(page)

      const banner = page.locator(SEL.banner)
      await expect(banner).toBeVisible()
      await expect(banner).toHaveAttribute('data-holder-kind', holder.kind)
      await expect(banner).toContainText('read-only, running live')
      await expect(banner).not.toContainText('building live')
      await expect(banner).not.toContainText('updates as they edit')

      // Toolbar right side: the RUN's env readout (disabled) + Focus Current
      // only; no run control of any kind for a watcher.
      const readout = page.locator(SEL.envSelector)
      await expect(readout).toContainText('Env:')
      await expect(readout).toContainText('Staging')
      await expect(readout).toBeDisabled()
      await expect(page.locator(SEL.focusCurrent)).toBeVisible()
      await expect(
        page.locator(SEL.focusCurrent),
        'no current block is known from a null session',
      ).toBeDisabled()
      await expect(page.locator(SEL.runButton)).toHaveCount(0)
      await expect(page.locator(SEL.debugButton)).toHaveCount(0)
      await expect(page.locator(SEL.canvasReadOnly)).toBeVisible()

      await context.close()
    })
  }
})
