/**
 * V-RUNM-LATE-DEPARTURE-FUNCTIONAL: the departure beacon of the page a watcher
 * reloaded away from can land after the reloaded page is back; it must leave
 * the reloaded page's live link to the holder alone.
 * Wireframes: none of its own
 * Design Decisions: RUNM-1; SESS-1..4
 * REQ: REQ-5.2.7.15
 *
 * Pass Criteria:
 * 1. The old page's own beacon, landing after the reload, keeps the reloaded
 *    watcher on the roster's Watching list and in the watcher count.
 * 2. A holder run started afterwards reaches the reloaded watcher: its banner
 *    says the holder "is running a test in the workbench", then goes back to
 *    "holds the workbench" when the run ends.
 */

import type { APIRequestContext, BrowserContext } from '@playwright/test'
import { test, expect, type Page } from '../../helpers/playwright-fixtures'
import { BACKEND_URL } from '../../helpers/config'
import { selectEnvironment } from '../../helpers/workbench'
import { waitForCanvasLoad } from '../../helpers/canvas'
import { SEL, resetOwnership, waitUntilHeld, ownershipState } from '../../helpers/ownership'
import {
  loadFixture,
  importFixture,
  openHolderWithTest,
  openWatcher,
  allowRunAttach,
} from './helpers'

const open: BrowserContext[] = []

async function watchingIds(request: APIRequestContext): Promise<string[]> {
  const resp = await request.get(`${BACKEND_URL}/server/status`)
  expect(resp.ok(), `GET /server/status failed: ${resp.status()}`).toBeTruthy()
  return ((await resp.json()) as { watching_session_ids: string[] }).watching_session_ids
}

/** Resolves once a socket the page opens after this call is on the draft topic. */
function nextDraftLink(page: Page): Promise<void> {
  return new Promise((resolve) => {
    page.on('websocket', (socket) => {
      socket.on('framereceived', (frame) => {
        const text = String(frame.payload)
        if (text.includes('"subscribed"') && text.includes('workbench:draft')) resolve()
      })
    })
  })
}

test.describe('V-RUNM-LATE-DEPARTURE-FUNCTIONAL: a late departure beacon spares the reloaded page', () => {
  test.beforeEach(async ({ request }) => {
    await resetOwnership(request)
  })

  test.afterEach(async ({ request }) => {
    for (const context of open.splice(0)) await context.close().catch(() => {})
    await resetOwnership(request)
  })

  test('the beacon of the page a watcher left lands after the reload and changes nothing', async ({
    browser,
    request,
  }) => {
    const testA = await importFixture(request, loadFixture())
    const testB = await importFixture(request, loadFixture())

    const a = await openHolderWithTest(browser, testA, (c) => open.push(c))
    await waitUntilHeld(request)
    const b = await openWatcher(browser, (c) => open.push(c))
    await expect(b.locator(SEL.bannerPerson)).toBeVisible()

    const beacon = b.waitForRequest((r) => r.url().endsWith('/workbench/ownership/leaving'))
    const linked = nextDraftLink(b)
    await b.goto(`/workbench?editTest=${testB}`)
    const departure = (await beacon).postData() ?? ''
    const tabId = (JSON.parse(departure) as { holder_id: string }).holder_id
    await waitForCanvasLoad(b)
    await expect(b.locator(SEL.banner)).toContainText('holds the workbench')
    await linked
    await expect.poll(() => watchingIds(request)).toContain(tabId)

    // The old page's own beacon, landing after the reloaded page is back.
    const late = await request.post(`${BACKEND_URL}/workbench/ownership/leaving`, {
      data: departure,
      headers: { 'Content-Type': 'text/plain' },
    })
    expect(late.ok()).toBeTruthy()
    expect(await watchingIds(request), 'the reloaded page keeps its live link').toContain(tabId)
    expect((await ownershipState(request)).watchers).toBe(1)

    await allowRunAttach(b)
    await selectEnvironment(a)
    await a.locator(SEL.runButton).click()
    await expect(b.locator(SEL.banner)).toContainText('is running a test in the workbench', {
      timeout: 15_000,
    })
    // It hears the run end too, and no run is left announced for the next test.
    await expect(b.locator(SEL.banner)).toContainText('holds the workbench', { timeout: 30_000 })
  })
})
