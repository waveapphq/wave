/**
 * V-WATCH-FOCUS-CURRENT (functional): Focus Current is the
 * run-controls button `action-focus-current-button` (shown while Running or
 * Paused). It centers the paused/running block AND navigates ACROSS FUNCTION
 * LEVELS - drilling into the Function when the target is nested, popping out
 * when it is above the current scope, and just re-centering on the same level.
 * There is NO `f` shortcut and NO on-canvas control.
 *
 * REQ-5.2.7.17 / FOCUS-1/2.
 *
 * Pass Criteria:
 *  1. Paused on an inner Function block while viewing the top level -> Focus
 *     Current DRILLS INTO the Function (breadcrumb gains a Function segment)
 *     and centers the inner block.
 *  2. On the same level -> Focus Current just re-centers, no drill change.
 *  3. Paused on a top-level block while viewing inside the Function -> Focus
 *     Current POPS OUT (Function segments drop to 0) and centers it.
 */

import { test, expect, type Page } from '../../helpers/playwright-fixtures'
import fs from 'fs'
import path from 'path'
import {
  importAndNavigate,
  selectEnvironment,
  toggleBreakpoint,
  startDebugRun,
  expectPausedAt,
  clickContinue,
  clickStepInto,
} from '../debug-step/helpers'
import { digIn } from '../../helpers/workbench'
import { functionSegments, expectNodeCentered, panCanvas } from './helpers'

const FOCUS = '[data-testid="action-focus-current-button"]'
const BACK = '[data-testid="breadcrumb-back-arrow"]'

function loadFixture(): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(path.resolve(__dirname, 'fixture-focus-levels.json'), 'utf-8'))
}

async function clickFocusCurrent(page: Page): Promise<void> {
  const btn = page.locator(FOCUS)
  await expect(btn).toBeVisible()
  await btn.click()
}

test.describe('V-WATCH-FOCUS-CURRENT (functional): Focus Current navigates across Function levels then centers', () => {
  test('drills in, re-centers on the same level, and pops out - always centering the current block', async ({
    page,
  }) => {
    await importAndNavigate(page, loadFixture())
    // Break on the Function node AND the top-level after-Log: the first gives a
    // pause INSIDE the Function (via Step Into), the second a later pause at TOP.
    await toggleBreakpoint(page, 'fn-1')
    await toggleBreakpoint(page, 'after')
    await selectEnvironment(page)
    await startDebugRun(page)

    // --- 1: paused INSIDE the Function, viewing root -> Focus drills IN ---------
    await expectPausedAt(page, 'fn-1') // paused on the Function node (top level)
    await clickStepInto(page)
    await expectPausedAt(page, 'inner-a') // descended into the body; canvas auto-drilled in
    await expect(functionSegments(page)).toHaveCount(1)

    // Navigate OUT to the top level; the pause stays on inner-a.
    await page.locator(BACK).click()
    await expect(functionSegments(page)).toHaveCount(0)
    await expect(page.locator('[data-testid="workflow-node-inner-a"]')).toHaveCount(0)

    // Focus Current -> drills BACK into the Function and centers inner-a.
    await clickFocusCurrent(page)
    await expect(functionSegments(page)).toHaveCount(1)
    await expect(page.locator('[data-testid="workflow-node-inner-a"]')).toBeVisible()
    await expectNodeCentered(page, 'inner-a')

    // --- 2: same level (still inside the Function, still paused on inner-a) -----
    // Pan the view away, then Focus Current re-centers without changing scope.
    await panCanvas(page, 360, -260)
    await clickFocusCurrent(page)
    await expect(functionSegments(page)).toHaveCount(1) // no drill change
    await expectNodeCentered(page, 'inner-a')

    // --- 3: paused at the TOP level, viewing INSIDE the Function -> pop OUT -----
    await clickContinue(page)
    await expectPausedAt(page, 'after') // resumed, re-paused on the top-level block
    await expect(functionSegments(page)).toHaveCount(0) // auto-popped to root on resume

    // Manually drill INTO the Function so the paused block is ABOVE the view.
    await digIn(page, 'fn-1')
    await expect(functionSegments(page)).toHaveCount(1)
    await expect(page.locator('[data-testid="workflow-node-after"]')).toHaveCount(0)

    // Focus Current -> pops OUT to root and centers the top-level block.
    await clickFocusCurrent(page)
    await expect(functionSegments(page)).toHaveCount(0)
    await expect(page.locator('[data-testid="workflow-node-after"]')).toBeVisible()
    await expectNodeCentered(page, 'after')
  })
})
