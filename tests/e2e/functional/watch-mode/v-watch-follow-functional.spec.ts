/**
 * V-WATCH-FOLLOW-FUNCTIONAL: the watch banner's Follow
 * Changes toggle (`mirror-follow-changes-button`), the per-change violet pulse
 * (`node-change-pulse-<id>`), and the mirror variable cue. Works with TWO
 * PERSON TABS - no MCP required: tab 1 holds and edits, tab 2 mirrors read-only
 * and follows.
 *
 * REQ-5.2.7.17 / WATCH-3/4.
 *
 * Pass Criteria:
 *  1. Following, the watcher recenters on every holder edit, the changed block
 *     pulses, a REPEATED change to the same block re-fires (change tick),
 *     panning does NOT stop following, and Stop Following does.
 *  2. A person watch shows the pulse only - no steady mirror-active border.
 *  3. A nested change drills the follower INTO the Function (follow at depth).
 *  4. Variable rows are clean by default; a modified variable shows a temporary
 *     violet bar + pulse and does NOT move a following watcher.
 */

import { test, expect, type Page } from '../../helpers/playwright-fixtures'
import type { Browser, BrowserContext, APIRequestContext } from '@playwright/test'
import fs from 'fs'
import path from 'path'
import { dragNodeBy, digIn } from '../../helpers/workbench'
import { createSimpleVariable, expandVariableManager, variableRow } from '../../helpers/variable-create'
import { SEL, resetOwnership, waitUntilHeld } from '../../helpers/ownership'
import {
  importFixture,
  openHolder,
  openWatcher,
  viewportTransform,
  waitForViewportIdle,
  functionSegments,
  expectNodeCentered,
  panCanvas,
} from './helpers'

const FOLLOW = '[data-testid="mirror-follow-changes-button"]'

function loadFixture(): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(path.resolve(__dirname, 'fixture-follow.json'), 'utf-8'))
}

const open: BrowserContext[] = []
const track = (c: BrowserContext): void => {
  open.push(c)
}

async function holderAndWatcher(
  browser: Browser,
  request: APIRequestContext,
): Promise<{ holder: Page; watcher: Page }> {
  const testId = await importFixture(request, loadFixture())
  const holder = await openHolder(browser, testId, track)
  await waitUntilHeld(request)
  const watcher = await openWatcher(browser, track)
  await expect(watcher.locator(SEL.bannerPerson)).toBeVisible()
  return { holder, watcher }
}

async function engageFollow(watcher: Page): Promise<void> {
  const btn = watcher.locator(FOLLOW)
  await expect(btn).toBeVisible()
  await btn.click()
  await expect(btn).toHaveAttribute('aria-pressed', 'true')
}

test.describe('V-WATCH-FOLLOW-FUNCTIONAL: Follow Changes, change pulse, and the variable cue', () => {
  test.beforeEach(async ({ request }) => {
    await resetOwnership(request)
  })
  test.afterEach(async ({ request }) => {
    for (const context of open.splice(0)) await context.close().catch(() => {})
    await resetOwnership(request)
  })

  test('follows every change, re-fires on a repeated same-block change, keeps following through a pan, and stops on Stop Following', async ({
    browser,
    request,
  }) => {
    const { holder, watcher } = await holderAndWatcher(browser, request)
    await engageFollow(watcher)

    // Holder moves the top-level block far -> watcher follows + the block pulses.
    await dragNodeBy(holder, 'top-a', { dx: 260, dy: 200 })
    await expect(watcher.locator('[data-testid="node-change-pulse-top-a"]')).toBeVisible({
      timeout: 10_000,
    })
    await expectNodeCentered(watcher, 'top-a')
    // Person watch = pulse only, no steady MCP active border.
    await expect(watcher.locator('[data-testid="workflow-node-top-a"]')).not.toHaveAttribute(
      'data-mirror-active',
      'true',
    )

    // Pan the follower away, then repeat a change to the SAME block: the change
    // tick re-fires the follow, moving the viewport back to center top-a. Proves
    // both "repeated same-block change re-fires" and "panning does not stop
    // following" - asserted on the viewport transform, which is deterministic.
    await panCanvas(watcher, -360, 260)
    const panned = await viewportTransform(watcher)
    await dragNodeBy(holder, 'top-a', { dx: 150, dy: -120 })
    await expect.poll(async () => viewportTransform(watcher), { timeout: 8_000 }).not.toBe(panned)
    await expectNodeCentered(watcher, 'top-a')

    // Stop Following: a later holder edit must NOT move the viewport.
    const followBtn = watcher.locator(FOLLOW)
    await followBtn.click()
    await expect(followBtn).toHaveAttribute('aria-pressed', 'false')
    await panCanvas(watcher, 340, -240)
    const stopped = await viewportTransform(watcher)
    await dragNodeBy(holder, 'top-a', { dx: -140, dy: 100 })
    await watcher.waitForTimeout(1500) // allow the mirror to apply the move
    expect(await viewportTransform(watcher)).toBe(stopped)
  })

  test('follows a nested change by drilling into the Function', async ({ browser, request }) => {
    const { holder, watcher } = await holderAndWatcher(browser, request)
    await engageFollow(watcher)

    // Holder drills into the Function and moves an inner block.
    await digIn(holder, 'fn-1')
    await dragNodeBy(holder, 'inner-a', { dx: 160, dy: 120 })

    // The watcher follows INTO the Function (breadcrumb gains a segment) and
    // centers the nested block, which pulses.
    await expect(functionSegments(watcher)).toHaveCount(1, { timeout: 10_000 })
    await expect(watcher.locator('[data-testid="node-change-pulse-inner-a"]')).toBeVisible()
    await expect(watcher.locator('[data-testid="workflow-node-inner-a"]')).toBeVisible()
    await expectNodeCentered(watcher, 'inner-a')
  })

  test('keeps variable rows clean by default and pulses only the modified variable, without moving a follower', async ({
    browser,
    request,
  }) => {
    const { holder, watcher } = await holderAndWatcher(browser, request)
    await engageFollow(watcher)

    // The watcher opens the Variable Manager: pre-existing rows are CLEAN
    // (no all-rows bar) while mirroring.
    await expandVariableManager(watcher)
    const existing = variableRow(watcher, 'existing_a')
    await expect(existing).toBeVisible()
    await expect(existing).not.toHaveClass(/animate-variable-mirror-pulse/)
    await expect(existing).not.toHaveClass(/violet/)

    // Let the engage-time fitView fully settle, then record the follower
    // viewport - a variable-only change must NOT move it.
    await waitForViewportIdle(watcher)
    const before = await viewportTransform(watcher)

    // Holder adds a variable -> the watcher's new row pulses violet, temporarily.
    await createSimpleVariable(holder, 'pulsed_var', { value: 'ping' })
    const pulsedRow = variableRow(watcher, 'pulsed_var')
    await expect(pulsedRow).toBeVisible({ timeout: 10_000 })
    await expect(pulsedRow).toHaveClass(/animate-variable-mirror-pulse/)
    // Pre-existing rows never join a pulse - no all-rows bar.
    await expect(existing).not.toHaveClass(/animate-variable-mirror-pulse/)
    // The violet cue is temporary - it fades.
    await expect(pulsedRow).not.toHaveClass(/animate-variable-mirror-pulse/, { timeout: 4_000 })

    // A variable-only change never moves a following watcher.
    expect(await viewportTransform(watcher)).toBe(before)
  })
})
