/**
 * V-RUNM-BROWSE-FUNCTIONAL: a watcher that navigates itself becomes a free
 * read-only browser; Watch Session rejoins the holder's surface.
 * Wireframes: none of its own
 * Design Decisions: RUNM-1, RUNM-2; SESS-1..4 (browse-away refinement)
 * REQ: REQ-5.2.7.15
 *
 * Pass Criteria:
 * 1. Opening another test while someone holds the workbench shows the
 *    browsing banner ("Read-only ... holds the workbench") with the Watch
 *    Session pill and no Follow Changes.
 * 2. Holder edits never move the browsed view.
 * 3. A holder run leaves the browsing tab in place; the banner hints the
 *    holder "is running a test in the workbench".
 * 4. Watch Session mid-run attaches into the live run (running-live banner,
 *    streaming console, run surface converged).
 * 5. Closing the mirrored test flips the watcher to browsing over an empty
 *    canvas; holder edits do not snap it back.
 */

import type { BrowserContext } from '@playwright/test'
import { test, expect } from '../../helpers/playwright-fixtures'
import { selectEnvironment } from '../../helpers/workbench'
import { waitForCanvasLoad } from '../../helpers/canvas'
import { createSimpleVariable, variableRow } from '../../helpers/variable-create'
import { SEL, resetOwnership, waitUntilHeld, nodeIds } from '../../helpers/ownership'
import {
  loadFixture,
  importFixture,
  openHolderWithTest,
  openWatcher,
  allowRunAttach,
  ensureConsoleExpanded,
  consoleRows,
} from './helpers'

const open: BrowserContext[] = []

test.describe('V-RUNM-BROWSE-FUNCTIONAL: browsing watcher, holder runs, Watch Session rejoin', () => {
  test.beforeEach(async ({ request }) => {
    await resetOwnership(request)
  })

  test.afterEach(async ({ request }) => {
    for (const context of open.splice(0)) await context.close().catch(() => {})
    await resetOwnership(request)
  })

  test('browsing is free-standing; the holder run streams in only via Watch Session', async ({
    browser,
    request,
  }) => {
    const testA = await importFixture(request, loadFixture())
    const testB = await importFixture(request, loadFixture())

    const a = await openHolderWithTest(browser, testA, (c) => open.push(c))
    await waitUntilHeld(request)
    const b = await openWatcher(browser, (c) => open.push(c))
    await expect(b.locator(SEL.bannerPerson)).toBeVisible()
    await expect(b.locator(`[data-testid="workflow-node-log-1"]`)).toBeVisible({ timeout: 10_000 })
    const fixtureNodeCount = (await nodeIds(a)).length
    expect(fixtureNodeCount, 'the holder rendered the fixture graph').toBeGreaterThan(0)

    await test.step('opening another test flips to the browsing banner', async () => {
      await b.goto(`/workbench?editTest=${testB}`)
      await waitForCanvasLoad(b)
      await expect(b.locator(SEL.banner)).toContainText('Read-only')
      await expect(b.locator(SEL.banner)).toContainText('holds the workbench')
      await expect(b.locator(SEL.watchSession)).toBeVisible()
      await expect(b.locator(SEL.followChanges)).toHaveCount(0)
      await expect(b.locator(SEL.canvasReadOnly)).toBeVisible()
      expect((await nodeIds(b)).length).toBe(fixtureNodeCount)
    })

    await test.step('holder edits do not move the browsed view', async () => {
      await createSimpleVariable(a, 'browse_probe_var', { value: 'holder-edit' })
      await b.waitForTimeout(1_500)
      expect((await nodeIds(b)).length, 'browsed view unchanged by a holder edit').toBe(
        fixtureNodeCount,
      )
      await expect(
        variableRow(b, 'browse_probe_var'),
        'the holder draft never reaches a browsing watcher',
      ).toHaveCount(0)
    })

    await test.step('a holder run leaves the browsing tab in place', async () => {
      await allowRunAttach(b)
      await selectEnvironment(a)
      await a.locator(SEL.runButton).click()
      await expect(b.locator(SEL.banner)).toContainText('is running a test in the workbench', {
        timeout: 15_000,
      })
      expect((await nodeIds(b)).length, 'browsing tab stays put during the run').toBe(
        fixtureNodeCount,
      )
      await expect(b.locator(SEL.focusCurrent)).toHaveCount(0)
    })

    await test.step('Watch Session mid-run attaches into the live run', async () => {
      await b.locator(SEL.watchSession).click()
      await expect(b.locator(SEL.banner)).toContainText('read-only, running live', {
        timeout: 15_000,
      })
      // The run's surface wins: the holder's draft (fixture + the added node).
      await expect(b.locator(`[data-testid="workflow-node-log-1"]`)).toBeVisible({
        timeout: 10_000,
      })
      expect((await nodeIds(b)).length).toBeGreaterThanOrEqual(fixtureNodeCount)
      await ensureConsoleExpanded(b)
      await expect
        .poll(async () => consoleRows(b).count(), { timeout: 20_000 })
        .toBeGreaterThan(0)
    })
  })

  test('closing the mirrored test flips to browsing with no snap-back', async ({
    browser,
    request,
  }) => {
    const testA = await importFixture(request, loadFixture())

    const a = await openHolderWithTest(browser, testA, (c) => open.push(c))
    await waitUntilHeld(request)
    const b = await openWatcher(browser, (c) => open.push(c))
    await expect(b.locator(SEL.bannerPerson)).toBeVisible()
    await expect(b.locator(`[data-testid="workflow-node-log-1"]`)).toBeVisible({ timeout: 10_000 })

    await b.locator('[data-testid="toolbar-close-button"]').click()
    await expect(b.locator(SEL.banner)).toContainText('holds the workbench')
    await expect(b.locator(SEL.watchSession)).toBeVisible()
    expect((await nodeIds(b)).length, 'closing leaves an empty browsed canvas').toBe(0)

    await createSimpleVariable(a, 'browse_probe_var', { value: 'holder-edit' })
    await b.waitForTimeout(1_500)
    expect((await nodeIds(b)).length, 'holder edits never snap the browser back').toBe(0)
  })
})
