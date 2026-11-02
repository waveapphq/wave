/**
 * V-RUNM-PERSON-FUNCTIONAL: a person-held run is mirrored live to watchers.
 * Design Decisions: RUNM-1, RUNM-2, RUNM-3, RUNM-4, RUNM-9; SESS-1..4
 * REQ: REQ-5.2.7.15
 *
 * Pass Criteria:
 * 1. While the holder's run is in flight the watcher banner reads
 *    "read-only, running live" (person holder).
 * 2. The watcher toolbar swaps to the run's env readout (showing the RUN's
 *    environment while the watcher's own local selection differed) plus
 *    Focus Current only - no Run/Debug/Stop/step controls anywhere.
 * 3. Console lines arrive progressively (>= 3 distinct arrival times spread
 *    across the run), never as one end-of-run dump.
 * 4. A watcher joining mid-run receives the backlog already produced.
 * 5. Run state paints the watcher canvas (running -> success) and live
 *    variable values reach the watcher.
 * 6. Entries and painted states persist on the watcher after the run ends.
 * 7. A take-over mid-run follows the person approval protocol; the run
 *    continues unaffected and reaches its terminal state.
 */

import type { BrowserContext } from '@playwright/test'
import { test, expect, type Page } from '../../helpers/playwright-fixtures'
import { E2E_ENV_NAME } from '../../helpers/config'
import { selectEnvironment } from '../../helpers/workbench'
import { expandVariableManager } from '../../helpers/variable-create'
import { getLogEntries } from '../../helpers/log-reader'
import { SEL, resetOwnership, waitUntilHeld, ownershipState } from '../../helpers/ownership'
import {
  loadFixture,
  importFixture,
  openHolderWithTest,
  openWatcher,
  openWatcherDuringRun,
  allowRunAttach,
  ensureConsoleExpanded,
  consoleRows,
  sampleConsoleArrivals,
  expectProgressiveArrivals,
} from './helpers'

const open: BrowserContext[] = []

const ALL_LINES = [
  'runm-line-1-start',
  'runm-line-2-early',
  'runm-line-3-midpoint',
  'runm-line-4-late',
  'runm-line-5-final',
]

async function watcherStatus(page: Page): Promise<string> {
  return (await page.locator('[data-testid="workflow-status"]').getAttribute('data-status')) ?? ''
}

async function watcherTerminal(page: Page): Promise<boolean> {
  return ['passed', 'failed', 'stopped', 'skipped'].includes(await watcherStatus(page))
}

test.describe('V-RUNM-PERSON-FUNCTIONAL: watcher mirrors a person-held run', () => {
  test.beforeEach(async ({ request }) => {
    await resetOwnership(request)
  })

  test.afterEach(async ({ request }) => {
    for (const context of open.splice(0)) await context.close().catch(() => {})
    await resetOwnership(request)
  })

  test('banner, env readout, progressive stream, backlog join, paint and persistence', async ({
    browser,
    request,
  }) => {
    const testId = await importFixture(request, loadFixture())

    const a = await openHolderWithTest(browser, testId, (c) => open.push(c))
    const holder = await waitUntilHeld(request)
    expect(holder.kind).toBe('person')

    const b = await openWatcher(browser, (c) => open.push(c))
    await expect(b.locator(SEL.bannerPerson)).toBeVisible()
    await expect(b.locator(SEL.banner)).toContainText('read-only, updates as they edit')

    // The watcher's own local selection differs from the run env before the
    // run starts - a value that happens to already be right proves nothing.
    await expect(b.locator(SEL.envSelector)).not.toContainText(E2E_ENV_NAME)

    await ensureConsoleExpanded(b)
    await allowRunAttach(b)
    await selectEnvironment(a)
    await a.locator(SEL.runButton).click()

    await test.step('banner flips to running live and the run is announced', async () => {
      await expect(b.locator(SEL.banner)).toContainText('read-only, running live', {
        timeout: 15_000,
      })
      const announced = (await ownershipState(request)).run
      expect(announced, 'ownership projects the announced run').toBeTruthy()
      expect(announced!.environment_name).toBe(E2E_ENV_NAME)
      expect(announced!.status).toBe('running')
    })

    await test.step('watcher toolbar: run env readout + Focus Current only', async () => {
      const readout = b.locator(SEL.envSelector)
      await expect(readout).toContainText('Env:')
      await expect(readout).toContainText(E2E_ENV_NAME)
      await expect(readout).toBeDisabled()
      await expect(b.locator(SEL.focusCurrent)).toBeVisible()
      await expect(b.locator(SEL.runButton)).toHaveCount(0)
      await expect(b.locator(SEL.debugButton)).toHaveCount(0)
      await expect(b.locator('[data-testid^="action-stop"]')).toHaveCount(0)
      await expect(b.locator('[data-testid="action-step-over-button"]')).toHaveCount(0)
      await expect(b.locator('[data-testid="toolbar-save-button"]')).toBeDisabled()
      await expect(b.locator('[data-testid="toolbar-edit-button"]')).toBeDisabled()
    })

    let midRunWatcher: Page | null = null

    await test.step('console lines arrive progressively; a third tab joins mid-run', async () => {
      let joined = false
      const samples = await sampleConsoleArrivals(b, async () => {
        if (!joined && (await consoleRows(b).count()) >= 1) {
          joined = true
          midRunWatcher = await openWatcherDuringRun(browser, (c) => open.push(c))
        }
        return watcherTerminal(b)
      })
      expectProgressiveArrivals(samples, 3, 2_000)
      expect(joined, 'the mid-run watcher joined while the run was in flight').toBe(true)
    })

    await test.step('the mid-run joiner received the backlog and the live tail', async () => {
      expect(midRunWatcher).toBeTruthy()
      const c = midRunWatcher!
      await ensureConsoleExpanded(c)
      // The console virtualizes, so read the whole list rather than waiting on
      // one row to be rendered: lines produced BEFORE this tab existed must be
      // there (backlog), followed by the live tail.
      await expect
        .poll(
          async () => (await getLogEntries(c)).map((entry) => entry.message),
          { timeout: 30_000, message: 'the joiner should receive backlog + tail' },
        )
        .toEqual(expect.arrayContaining(ALL_LINES))
    })

    await test.step('run paint + live variable values reach the watcher', async () => {
      const painted = b.locator(
        '[data-testid^="workflow-node-"][data-execution-status="success"]',
      )
      await expect(painted.first()).toBeVisible({ timeout: 15_000 })

      await expandVariableManager(b)
      const row = b.locator('[data-testid^="variable-row-"]', { hasText: 'runm_progress' })
      await expect(row).toBeVisible()
      await expect(row.locator('[data-testid^="variable-value-"]')).toContainText('halfway')
    })

    await test.step('after the run: entries and paint persist, banner returns to build phrase', async () => {
      await expect
        .poll(async () => watcherStatus(b), { timeout: 30_000 })
        .toBe('passed')
      await expect(b.locator(SEL.banner)).toContainText('read-only, updates as they edit')
      const watcherMessages = (await getLogEntries(b)).map((entry) => entry.message)
      expect(watcherMessages).toEqual(expect.arrayContaining(ALL_LINES))
      await expect(
        b.locator('[data-testid^="workflow-node-"][data-execution-status="success"]').first(),
      ).toBeVisible()
    })
  })

  test('take-over mid-run follows the approval protocol and the run continues', async ({
    browser,
    request,
  }) => {
    const testId = await importFixture(request, loadFixture())

    const a = await openHolderWithTest(browser, testId, (c) => open.push(c))
    await waitUntilHeld(request)
    const b = await openWatcher(browser, (c) => open.push(c))
    await expect(b.locator(SEL.bannerPerson)).toBeVisible()

    await allowRunAttach(b)
    await selectEnvironment(a)
    await a.locator(SEL.runButton).click()
    await expect(b.locator(SEL.banner)).toContainText('read-only, running live', {
      timeout: 15_000,
    })

    // A person run-holder keeps the approval protocol (immediate grant is
    // reserved for assistant run-holders).
    await b.locator(SEL.takeOver).click()
    await expect(b.getByRole('alertdialog', { name: 'Waiting to take over' })).toBeVisible()
    const approval = a.getByRole('alertdialog', { name: 'Another session wants to take over' })
    await expect(approval).toBeVisible({ timeout: 10_000 })
    await approval.getByRole('button', { name: 'Hand over' }).click()

    const granted = b.getByRole('alertdialog', { name: 'You now hold the session' })
    await expect(granted).toBeVisible({ timeout: 10_000 })
    await granted.getByRole('button', { name: 'Start editing' }).click()
    await expect(b.locator(SEL.banner)).toHaveCount(0)

    // The former holder flips to watching and the run continues to terminal.
    await expect(a.locator(SEL.bannerPerson)).toBeVisible({ timeout: 10_000 })
    await ensureConsoleExpanded(a)
    // The run continues to completion: its last line still reaches the former
    // holder after the hand-over.
    await expect
      .poll(async () => (await getLogEntries(a)).map((entry) => entry.message), {
        timeout: 30_000,
        message: 'the run continues after the hand-over',
      })
      .toContain('runm-line-5-final')
  })
})
