/**
 * V-SESS-CONTINUITY-FUNCTIONAL: the workbench session belongs to the TAB, not
 * to the Workbench screen.
 *
 * Design Decisions: SESS-9, SESS-11
 * REQ: REQ-5.2.7.15
 *
 * Pass Criteria:
 * 1. The walk: hold the session, browse to Tests, reload there, come
 *    back - editable throughout, no mirror banner at any point, and a second
 *    watching context keeps mirroring the whole time.
 * 2. The holder keeps the session while it is away from the Workbench: the
 *    liveness signal still runs from another route, so the stale sweep can
 *    never reap a live tab.
 * 3. A mirroring tab that opens another test gets no unsaved-changes dialog -
 *    the other test's canvas simply loads, and the holder's draft is untouched.
 */

import { test, expect } from '../../helpers/playwright-fixtures'
import type { BrowserContext, Page } from '@playwright/test'
import { dragPaletteItemToCanvas } from '../../helpers/canvas'
import { createValidTest, logNode, startEdge } from '../../helpers/fn-seed'
import {
  SEL,
  nodeIds,
  openHolderAndMirror,
  openWorkbench,
  ownershipState,
  resetOwnership,
  waitUntilHeld,
} from '../../helpers/ownership'

const open: BrowserContext[] = []
const track = (context: BrowserContext) => open.push(context)

/** The canvas is this tab's to edit: present, and not marked read-only. */
async function expectEditable(page: Page, note: string) {
  await expect(page.locator(SEL.canvas), note).toBeVisible()
  await expect(page.locator(SEL.canvasReadOnly), note).toHaveCount(0)
  await expect(page.locator(SEL.banner), note).toHaveCount(0)
}

/** Drop a block and return its id, proving this tab can still mutate. */
async function dropBlock(page: Page): Promise<string> {
  const before = await nodeIds(page)
  const box = await page.locator(SEL.canvas).boundingBox()
  await dragPaletteItemToCanvas(page, 'shell script', { x: box!.width / 2, y: box!.height / 2 })
  const after = await nodeIds(page)
  const created = after.find((id) => !before.includes(id))
  expect(created, 'the holder could add a block').toBeTruthy()
  return created as string
}

async function goTo(page: Page, href: string, ready: string) {
  await page.locator(`a[href="${href}"]`).first().click()
  await expect(page.locator(ready)).toBeVisible({ timeout: 30_000 })
}

test.describe('V-SESS-CONTINUITY-FUNCTIONAL: a tab keeps its session', () => {
  test.beforeEach(async ({ request }) => {
    await resetOwnership(request)
  })

  test.afterEach(async ({ request }) => {
    for (const context of open.splice(0)) await context.close().catch(() => {})
    await resetOwnership(request)
  })

  test('holding survives browsing away, a reload, and coming back - with a watcher present', async ({
    browser,
    request,
  }) => {
    const { a, b } = await openHolderAndMirror(browser, request, track)
    const holderId = (await ownershipState(request)).holder!.id

    await expectEditable(a.page, 'the holder starts editable')

    // Browse to Tests, reload THERE, then come back to the Workbench: the tab
    // never abandoned anything.
    await goTo(a.page, '/tests', '[data-testid="tests-page"]')
    await a.page.reload()
    await expect(a.page.locator('[data-testid="tests-page"]')).toBeVisible({ timeout: 30_000 })

    // A reload announces departure and then resumes: the slot must still be
    // this tab's, not merely free.
    await expect
      .poll(async () => (await ownershipState(request)).holder?.id, {
        timeout: 20_000,
        message: 'the reloaded tab still holds the session',
      })
      .toBe(holderId)

    await goTo(a.page, '/workbench', SEL.canvas)
    await expectEditable(a.page, 'back on the Workbench it is still editable')

    // No dialog interrupted the return trip.
    await expect(a.page.locator('[data-testid="switch-test-dialog"]')).toHaveCount(0)
    await expect(a.page.locator('[role="alertdialog"]')).toHaveCount(0)

    // The watcher never stopped mirroring: it still names a person holder, and
    // the holder's next edit reaches it.
    await expect(b.page.locator(SEL.bannerPerson)).toBeVisible()
    await expect(b.page.locator(SEL.canvasReadOnly)).toBeVisible()
    const created = await dropBlock(a.page)
    await expect(b.page.locator(`[data-testid="workflow-node-${created}"]`)).toBeVisible({
      timeout: 15_000,
    })
  })

  test('the holder keeps the session while it is away from the Workbench', async ({
    browser,
    request,
  }) => {
    test.setTimeout(180_000)
    const { a, b } = await openHolderAndMirror(browser, request, track)
    const holderId = (await ownershipState(request)).holder!.id

    // Leave the Workbench and STAY away. Liveness stays asserted after this screen
    // unmounts, so the stale sweep does not reap the holder as abandoned.
    await goTo(a.page, '/settings', '[data-testid="settings-page"]')

    const beats: number[] = []
    a.page.on('request', (req) => {
      if (new URL(req.url()).pathname === '/workbench/ownership/heartbeat') {
        beats.push(Date.now())
      }
    })

    // One liveness interval is 15s; 25s of quiet is long enough that a tab
    // which had stopped signaling would show nothing at all here.
    await a.page.waitForTimeout(25_000)
    expect(
      beats.length,
      'the holder still asserts liveness from a non-Workbench route',
    ).toBeGreaterThan(0)

    // The server still names this tab, and the watcher never lost it.
    expect((await ownershipState(request)).holder?.id).toBe(holderId)
    await expect(b.page.locator(SEL.bannerPerson)).toBeVisible()
    await expect(b.page.locator(SEL.canvasReadOnly)).toBeVisible()

    // Come back and edit: still ours, and the edit still mirrors.
    await goTo(a.page, '/workbench', SEL.canvas)
    await expectEditable(a.page, 'the returning holder is still editable')
    const created = await dropBlock(a.page)
    await expect(b.page.locator(`[data-testid="workflow-node-${created}"]`)).toBeVisible({
      timeout: 15_000,
    })
  })

  test('a mirroring tab opens another test with no unsaved-changes dialog', async ({
    browser,
    request,
  }) => {
    const otherName = `V-SESS-other-${Date.now()}`
    const otherId = await createValidTest(request, {
      name: otherName,
      nodes: [logNode('other-log', 'OtherLog', "'other'")],
      edges: [startEdge('other-log')],
    })

    // The holder builds an UNSAVED draft; the watcher mirrors it (arriving
    // already dirty - work the watcher neither owns nor can save).
    const a = await openWorkbench(browser)
    track(a.context)
    await waitUntilHeld(request)
    const holderBlock = await dropBlock(a.page)

    const b = await openWorkbench(browser)
    track(b.context)
    await expect(b.page.locator(SEL.bannerPerson)).toBeVisible()
    await expect(b.page.locator(`[data-testid="workflow-node-${holderBlock}"]`)).toBeVisible({
      timeout: 15_000,
    })

    // The watcher opens a DIFFERENT test from the list.
    await goTo(b.page, '/tests', '[data-testid="tests-page"]')
    await b.page.locator('[data-testid="search-input"] input').fill(otherName)
    const cell = b.page.locator(
      `[data-testid="test-row"][data-row-id="${otherId}"] [data-testid="test-name"]`,
    )
    await expect(cell).toBeVisible({ timeout: 15_000 })
    await cell.click()

    // It opens straight away: the gate guards a holder's own work, and a
    // watcher has none of it.
    await expect(b.page.locator('[data-testid="switch-test-dialog"]')).toHaveCount(0)
    await expect(b.page.locator('[data-testid="workflow-node-other-log"]')).toBeVisible({
      timeout: 30_000,
    })
    await expect(b.page.locator('[data-testid="switch-test-dialog"]')).toHaveCount(0)

    // The holder's own draft is untouched by any of it.
    await expect(a.page.locator(`[data-testid="workflow-node-${holderBlock}"]`)).toBeVisible()
    await expectEditable(a.page, 'the holder still owns its draft')
  })
})
