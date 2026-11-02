/**
 * V-SESS-TAKEOVER-FUNCTIONAL: Take-over protocol (request / approve / deny /
 * force / cancel) + holder-leaves inheritance.
 * Design Decisions: SESS-5..8
 * REQ: REQ-5.2.7.16
 *
 * Pass Criteria:
 * 1. Request -> the holder approves -> roles flip; the requester becomes the
 *    editable holder (its edits mirror back) and sees the granted outcome.
 * 2. Request -> the holder denies -> the requester stays a read-only mirror
 *    and sees the denied outcome; the holder keeps the session.
 * 3. Force replaces the holder's OPEN approval modal with the taken-over
 *    outcome modal (no toast) and flips the holder to read-only.
 * 4. Cancel retracts the pending request (the holder's approval modal closes)
 *    and a fresh request is accepted (no "already pending" lockout).
 * 5. The holder leaving promotes NOBODY: every watcher detaches to the
 *    amber no-holder banner, stays read-only, and becomes the holder only by
 *    pressing Take Session. A second watcher is never dragged onto the new
 *    holder's surface.
 *
 * Every assertion anchors on observable state (banner, data-readonly canvas,
 * outcome-modal copy, mirrored node, backend holder), never mere presence.
 */

import { test, expect } from '../../helpers/playwright-fixtures'
import type { BrowserContext, Page } from '@playwright/test'
import { dragPaletteItemToCanvas } from '../../helpers/canvas'
import {
  SEL,
  leaveOwnership,
  nodeIds,
  openHolderAndMirror,
  openWorkbench,
  ownershipState,
  resetOwnership,
} from '../../helpers/ownership'

const open: BrowserContext[] = []
const track = (context: BrowserContext) => open.push(context)

/** A named alertdialog on a page (survives dialog swaps without strict-mode clashes). */
const dialog = (page: Page, name: string) => page.getByRole('alertdialog', { name })

/** Drop a node in `editor` and prove it appears in `mirror` (edit propagation). */
async function proveEditPropagates(editor: Page, mirror: Page): Promise<void> {
  const before = await nodeIds(editor)
  const box = await editor.locator(SEL.canvas).boundingBox()
  await dragPaletteItemToCanvas(editor, 'shell script', { x: box!.width / 2, y: box!.height / 2 })
  const after = await nodeIds(editor)
  const newId = after.find((id) => !before.includes(id))
  expect(newId, 'the editor could add a node').toBeTruthy()
  await expect(mirror.locator(`[data-testid="workflow-node-${newId}"]`)).toBeVisible({
    timeout: 10_000,
  })
}

test.describe('V-SESS-TAKEOVER-FUNCTIONAL: take-over protocol', () => {
  test.beforeEach(async ({ request }) => {
    await resetOwnership(request)
  })

  test.afterEach(async ({ request }) => {
    for (const context of open.splice(0)) await context.close().catch(() => {})
    await resetOwnership(request)
  })

  test('holder hands over: roles flip and the requester sees the granted outcome', async ({
    browser,
    request,
  }) => {
    const { a, b } = await openHolderAndMirror(browser, request, track)

    await b.page.locator(SEL.takeOver).click()
    await expect(dialog(b.page, 'Waiting to take over')).toContainText(
      'Another session is being asked to hand over',
    )
    await expect(dialog(a.page, 'Another session wants to take over')).toContainText(
      'You switch to watching, read-only',
    )

    await dialog(a.page, 'Another session wants to take over')
      .getByRole('button', { name: 'Hand over' })
      .click()

    // Requester becomes the editable holder and sees the granted outcome.
    await expect(dialog(b.page, 'You now hold the session')).toContainText(
      'the previous holder is watching',
    )
    await dialog(b.page, 'You now hold the session').getByRole('button', { name: 'Start editing' }).click()
    await expect(b.page.locator(SEL.banner)).toHaveCount(0)
    await expect(b.page.locator(SEL.canvasReadOnly)).toHaveCount(0)

    // Former holder flips to a read-only mirror.
    await expect(a.page.locator(SEL.bannerPerson)).toBeVisible()
    await expect(a.page.locator(SEL.canvasReadOnly)).toBeVisible()

    // Strongest proof: the new holder edits and it mirrors back to the old one.
    await proveEditPropagates(b.page, a.page)
  })

  test('holder denies: the requester stays a read-only mirror', async ({ browser, request }) => {
    const { a, b } = await openHolderAndMirror(browser, request, track)

    await b.page.locator(SEL.takeOver).click()
    await expect(dialog(a.page, 'Another session wants to take over')).toBeVisible()
    await dialog(a.page, 'Another session wants to take over')
      .getByRole('button', { name: 'Deny' })
      .click()

    // Requester sees the denied outcome and stays read-only.
    await expect(dialog(b.page, 'Take-over denied')).toContainText('still watching, read-only')
    await dialog(b.page, 'Take-over denied').getByRole('button', { name: 'OK' }).click()
    await expect(b.page.locator(SEL.bannerPerson)).toBeVisible()
    await expect(b.page.locator(SEL.canvasReadOnly)).toBeVisible()

    // The holder keeps the session (editable, no banner) and stays the server holder.
    await expect(a.page.locator(SEL.banner)).toHaveCount(0)
    await expect(a.page.locator(SEL.canvasReadOnly)).toHaveCount(0)
    expect((await ownershipState(request)).holder?.kind).toBe('person')
  })

  test('force replaces the holder approval modal with the taken-over outcome (no toast)', async ({
    browser,
    request,
  }) => {
    const { a, b } = await openHolderAndMirror(browser, request, track)

    await b.page.locator(SEL.takeOver).click()
    await expect(dialog(a.page, 'Another session wants to take over')).toBeVisible()

    // Requester forces from the waiting dialog.
    await dialog(b.page, 'Waiting to take over')
      .getByRole('button', { name: 'Force Take Over' })
      .click()

    // Former holder: the approval modal is REPLACED by the taken-over outcome; now read-only.
    await expect(dialog(a.page, 'Session taken over')).toContainText('now watching, read-only')
    await expect(
      dialog(a.page, 'Another session wants to take over'),
      'the stale approval modal is gone',
    ).toHaveCount(0)
    await expect(a.page.locator(SEL.bannerPerson)).toBeVisible()
    await expect(a.page.locator(SEL.canvasReadOnly)).toBeVisible()

    // Requester is the editable holder whose edits mirror back to the old holder.
    await expect(b.page.locator(SEL.banner)).toHaveCount(0)
    await expect(b.page.locator(SEL.canvasReadOnly)).toHaveCount(0)
    await proveEditPropagates(b.page, a.page)
  })

  test('cancel retracts the pending request and the holder can be re-requested', async ({
    browser,
    request,
  }) => {
    const { a, b } = await openHolderAndMirror(browser, request, track)

    await b.page.locator(SEL.takeOver).click()
    await expect(dialog(a.page, 'Another session wants to take over')).toBeVisible()

    // Requester cancels: the holder's approval modal closes and it keeps editing.
    await dialog(b.page, 'Waiting to take over').getByRole('button', { name: 'Cancel' }).click()
    await expect(dialog(a.page, 'Another session wants to take over')).toHaveCount(0)
    await expect(a.page.locator(SEL.banner)).toHaveCount(0)
    await expect(a.page.locator(SEL.canvasReadOnly)).toHaveCount(0)

    // No "already pending" lockout: a fresh request reaches the waiting + approval modals again.
    await b.page.locator(SEL.takeOver).click()
    await expect(dialog(b.page, 'Waiting to take over')).toBeVisible()
    await expect(dialog(a.page, 'Another session wants to take over')).toBeVisible()
  })

  test('the holder leaving promotes nobody: every watcher detaches and can Take Session', async ({
    browser,
    request,
  }) => {
    const { a, b } = await openHolderAndMirror(browser, request, track)
    // A SECOND watcher, so other watchers being dragged onto a new holder's surface is in play.
    const c = await openWorkbench(browser)
    track(c.context)
    await expect(c.page.locator(SEL.bannerPerson)).toBeVisible()

    const holderId = (await ownershipState(request)).holder!.id
    const cNodesBefore = await nodeIds(c.page)

    // The holder tab closes; its departure reserves the slot briefly and then
    // frees it. The /leaving beacon a real close sends is replayed as a
    // deterministic backstop.
    await a.context.close()
    await leaveOwnership(request, holderId)
    await expect
      .poll(async () => (await ownershipState(request)).holder, {
        timeout: 20_000,
        message: 'the slot frees once the reservation lapses',
      })
      .toBeNull()

    // Nobody is promoted. Both watchers detach: amber, no holder named,
    // still read-only, and no outcome dialog claiming they were handed it.
    for (const page of [b.page, c.page]) {
      const banner = page.locator('[data-testid="mirror-banner"][data-holder-kind="none"]')
      await expect(banner).toBeVisible({ timeout: 20_000 })
      await expect(banner).toHaveClass(/amber/)
      await expect(banner).toContainText('nobody holds the workbench')
      await expect(page.locator(SEL.canvasReadOnly)).toBeVisible()
      await expect(page.locator(SEL.takeOver)).toContainText('Take Session')
      await expect(dialog(page, 'You now hold the session')).toHaveCount(0)

      // The two pills that need a session to act on are inert, and say why -
      // the disabled control IS how a tab learns nobody is driving.
      for (const [selector, hint] of [
        [SEL.watchSession, 'No active session to watch'],
        [SEL.seeConnection, 'No active session to show'],
      ] as const) {
        const pill = page.locator(selector)
        await expect(pill).toHaveAttribute('aria-disabled', 'true')
        await pill.hover()
        await expect(page.locator('[data-slot="tooltip-content"]:not([data-state="closed"])')).toContainText(hint, { timeout: 5_000 })
        await page.mouse.move(2, 2)
        await expect(page.locator('[data-slot="tooltip-content"]:not([data-state="closed"])')).toHaveCount(0)
      }
    }

    // Only an explicit Take Session claims it.
    await b.page.locator(SEL.takeOver).click()
    await expect(b.page.locator(SEL.banner)).toHaveCount(0, { timeout: 15_000 })
    await expect(b.page.locator(SEL.canvasReadOnly)).toHaveCount(0)
    await expect
      .poll(async () => (await ownershipState(request)).holder?.id, {
        timeout: 15_000,
        message: 'the tab that pressed Take Session becomes the holder',
      })
      .not.toBe(holderId)

    // The OTHER watcher is not dragged onto the new holder's surface: it stays
    // detached and read-only, showing exactly what it was showing before.
    const before = await nodeIds(b.page)
    const box = await b.page.locator(SEL.canvas).boundingBox()
    await dragPaletteItemToCanvas(b.page, 'shell script', { x: box!.width / 2, y: box!.height / 2 })
    expect((await nodeIds(b.page)).length, 'the new holder edits its own draft').toBeGreaterThan(
      before.length,
    )
    await expect(c.page.locator(SEL.canvasReadOnly)).toBeVisible()
    expect(await nodeIds(c.page), 'a detached watcher does not follow the new holder').toEqual(
      cNodesBefore,
    )
    // It rejoins only on Watch Session, which is live again now there is a holder.
    await expect(c.page.locator(SEL.watchSession)).not.toHaveAttribute('aria-disabled', 'true')
  })
})
