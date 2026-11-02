/**
 * V-DEBUG-SKIP-BLOCKED-FUNCTIONAL: Skip Block on a diverging parent is
 * blocked by both the API (409 with anchored message) and the Paused
 * Toolbar (button is aria-disabled with the explanatory tooltip).
 *
 * Scenario:
 *   Workflow with If-Else (true branch: Log "T"; false branch: Log "F").
 *   Breakpoint on the If-Else. Attempt Skip Block via the API client ->
 *   expects 409 with the exact anchored message
 *   `^Cannot skip branching block 'if-else': step into a branch and skip a
 *    leaf instead$`. Verify the Paused Toolbar Skip button is disabled
 *   (aria-disabled="true") with the matching tooltip copy.
 *
 * REQ: REQ-3.2.2.2 (Skip blocks during runtime - diverging-parent rejection)
 */

import { test, expect } from '../../helpers/playwright-fixtures'
import { BACKEND_PORT } from '../../helpers/config'
import {
  importAndNavigate,
  selectEnvironment,
  toggleBreakpoint,
  startDebugRun,
  expectPausedAt,
  waitForStatus,
  clickStopImmediate,
  getActiveSessionId,
} from './helpers'
import fs from 'fs'
import path from 'path'

function loadFixture(): Record<string, unknown> {
  return JSON.parse(
    fs.readFileSync(path.resolve(__dirname, 'fixture-skip-blocked.json'), 'utf-8'),
  )
}

const SKIP_DISABLED_TOOLTIP =
  'Cannot skip branching block; step into a branch and skip a leaf inside'
const EXPECTED_API_MESSAGE_PATTERN =
  /^Cannot skip branching block 'if-else': step into a branch and skip a leaf instead$/

test.describe('V-DEBUG-SKIP-BLOCKED: Skip Block forbidden on If-Else', () => {
  test('API returns 409 with anchored message AND Paused Toolbar disables Skip Block', async ({
    page,
  }) => {
    await importAndNavigate(page, loadFixture())

    await toggleBreakpoint(page, 'if-else')

    await selectEnvironment(page)
    await startDebugRun(page)

    await expectPausedAt(page, 'if-else')

    // UI: the Paused Toolbar must render Skip Block as aria-disabled with
    // the tooltip text matching exactly. The HTML `disabled` attribute is
    // intentionally NOT set so the button stays focusable for screen
    // readers.
    const skipBtn = page.locator('[data-testid="action-skip-block-button"]')
    await expect(skipBtn).toBeVisible()
    await expect(skipBtn).toHaveAttribute('aria-disabled', 'true')
    // SHELL-7a: the reason comes from the shared tooltip, not a browser popup.
    await expect(skipBtn).not.toHaveAttribute('title', /.*/)
    await skipBtn.hover()
    await expect(page.locator('[data-slot="tooltip-content"]:not([data-state="closed"])')).toContainText(
      SKIP_DISABLED_TOOLTIP,
      { timeout: 5_000 },
    )
    await expect(skipBtn).not.toHaveAttribute('disabled', '')

    // API: a direct POST to /workbench/{sid}/skip-block must return 409
    // with the exact anchored error message.
    const sessionId = await getActiveSessionId(page.request)
    const skipResp = await page.request.post(
      `http://localhost:${BACKEND_PORT}/workbench/${sessionId}/skip-block`,
    )
    expect(
      skipResp.status(),
      `Expected 409 from skip-block on If-Else; got ${skipResp.status()}`,
    ).toBe(409)
    const body = await skipResp.json().catch(() => null)
    const errMessage =
      body?.error?.message ?? body?.detail ?? body?.message ?? body?.error ?? ''
    expect(
      errMessage,
      `Expected anchored message ${EXPECTED_API_MESSAGE_PATTERN}; got ${JSON.stringify(body)}`,
    ).toMatch(EXPECTED_API_MESSAGE_PATTERN)

    // Stop to clean up the paused session before next test.
    // Stop wraps to the row under Skip, where the open tooltip covers it until the pointer leaves Skip.
    await page.mouse.move(0, 0)
    await expect(page.locator('[data-slot="tooltip-content"]:not([data-state="closed"])')).toHaveCount(0)
    await clickStopImmediate(page)
    await waitForStatus(page, 'stopped')
  })
})
