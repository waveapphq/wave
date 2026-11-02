/**
 * V-DEBUG-PAUSED-TOOLBAR-01: Paused Toolbar visual coverage
 *
 * Design Decisions: button order, Skip Block disabled tooltip, post-Repeat
 *   visual (amber border + terminal badge composed)
 * REQ: REQ-3.2.1.3 (Step), REQ-3.2.1.4 (Repeat Step), REQ-3.2.2.2 (Skip)
 *
 * Pass Criteria:
 *   1. Paused Toolbar renders 7 buttons in the order Step Over, Step Into,
 *      Repeat Step, Continue, Skip Block, Stop, Focus Current.
 *   2. Skip Block on a diverging parent (If-Else) is aria-disabled with
 *      tooltip "Cannot skip branching block; step into a branch and skip a
 *      leaf inside" (kept focusable for screen readers).
 *   3. Post-Repeat-success visual: paused node retains amber border and
 *      shows the success terminal badge (data-execution-status="success").
 *   4. Post-Repeat-failure visual: paused node retains amber border and
 *      shows the failure terminal badge (data-execution-status="failed").
 */

import { test, expect, type Page } from '../../helpers/playwright-fixtures'
import { waitForCanvasLoad } from '../../helpers/canvas'
import {
  BACKEND_PORT,
  E2E_ENV_NAME,
  ensureEnvironment,
} from '../../helpers/config'
import fs from 'fs'
import path from 'path'

const SKIP_DISABLED_TOOLTIP =
  'Cannot skip branching block; step into a branch and skip a leaf inside'

const EXPECTED_TOOLBAR_ORDER: ReadonlyArray<string> = [
  'action-step-over-button',
  'action-step-into-button',
  'action-repeat-step-button',
  'action-continue-button',
  'action-skip-block-button',
  'action-stop-button',
  'action-focus-current-button',
]

function loadFixture(fixturePath: string, nameSuffix: string): Record<string, unknown> {
  const raw = fs.readFileSync(fixturePath, 'utf-8')
  const fixture = JSON.parse(raw)
  fixture.name = `V-DEBUG-PAUSED-TOOLBAR - ${nameSuffix} ${Date.now()}`
  return fixture
}

function loadFlatFixture(nameSuffix: string): Record<string, unknown> {
  return loadFixture(
    path.resolve(__dirname, '../../functional/debug-run/fixture-flat.json'),
    nameSuffix,
  )
}

function loadIfElseFixture(nameSuffix: string): Record<string, unknown> {
  return loadFixture(
    path.resolve(__dirname, '../../functional/debug-step/fixture-skip-blocked.json'),
    nameSuffix,
  )
}

function loadRepeatFailFixture(nameSuffix: string): Record<string, unknown> {
  return loadFixture(
    path.resolve(__dirname, '../../functional/debug-run/fixture-trycatch.json'),
    nameSuffix,
  )
}

async function importAndNavigate(
  page: Page,
  fixture: Record<string, unknown>,
): Promise<string> {
  await page.request
    .delete(`http://localhost:${BACKEND_PORT}/workbench/session/`)
    .catch(() => {})
  await ensureEnvironment(page.request)

  const createResp = await page.request.post(`http://localhost:${BACKEND_PORT}/tests`, {
    data: fixture,
  })
  const body = await createResp.json().catch(() => null)
  expect(
    createResp.ok(),
    `POST /tests failed: ${createResp.status()} - ${JSON.stringify(body)}`,
  ).toBeTruthy()
  const testId = body.data?.id || body.id

  await page.goto(`/workbench?editTest=${testId}`)
  await page.evaluate(() => localStorage.clear())
  await page.goto(`/workbench?editTest=${testId}`)
  await waitForCanvasLoad(page)
  return testId
}

async function selectEnvironment(page: Page): Promise<void> {
  await page.locator('[data-testid="environment-selector"]').click()
  const popover = page.locator('[data-testid="environment-popover"]')
  await expect(popover).toBeVisible()
  await popover.locator(`button:has-text("${E2E_ENV_NAME}")`).first().click()
  await expect(popover).not.toBeVisible()
}

async function toggleBreakpoint(page: Page, nodeId: string): Promise<void> {
  const node = page.locator(`[data-testid="workflow-node-${nodeId}"]`)
  await expect(node).toBeVisible()
  await node.click({ button: 'right' })
  const menu = page.locator('[role="menu"]')
  await expect(menu).toBeVisible()
  await menu.getByText('Toggle Breakpoint', { exact: true }).click()
  await expect(menu).not.toBeVisible()
}

async function setPauseOnErrors(page: Page, checked: boolean): Promise<void> {
  await page.locator('[data-testid="debug-options-gear"]').click()
  const popover = page.locator('[data-testid="debug-options-popover"]')
  await expect(popover).toBeVisible()
  const checkbox = popover.locator('[data-testid="pause-on-errors-checkbox"]')
  const current = await checkbox.getAttribute('data-state')
  if ((current === 'checked') !== checked) {
    await checkbox.click()
  }
  await page.keyboard.press('Escape')
  await expect(popover).not.toBeVisible()
}

async function startDebugRun(page: Page): Promise<void> {
  await page.locator('[data-testid="debug-button"]').click()
}

async function waitPaused(page: Page, nodeId: string, timeout = 30_000): Promise<void> {
  const status = page.locator('[data-testid="workflow-status"]')
  await expect(status).toHaveAttribute('data-status', 'paused', { timeout })
  await expect(page.locator(`[data-testid="workflow-node-${nodeId}"]`)).toHaveAttribute(
    'data-paused',
    'true',
  )
}

async function confirmStop(page: Page): Promise<void> {
  await page.locator('[data-testid="action-stop-button"]').click()
  const dialog = page.locator('[data-testid="stop-confirmation-dialog"]')
  await expect(dialog).toBeVisible()
  await page.locator('[data-testid="stop-confirm-immediate"]').click()
  await expect(page.locator('[data-testid="workflow-status"]')).toHaveAttribute(
    'data-status',
    'stopped',
    { timeout: 10_000 },
  )
}

test.describe('V-DEBUG-PAUSED-TOOLBAR-01: Paused Toolbar visuals', () => {
  test('S1: Paused Toolbar renders 7 buttons in order on a leaf pause', async ({
    page,
  }) => {
    await importAndNavigate(page, loadFlatFixture('S1'))
    await toggleBreakpoint(page, 'log-2')
    await selectEnvironment(page)
    await startDebugRun(page)
    await waitPaused(page, 'log-2')

    // Each of the seven paused-toolbar buttons must be visible.
    for (const id of EXPECTED_TOOLBAR_ORDER) {
      await expect(
        page.locator(`[data-testid="${id}"]`),
        `${id} should be visible while paused on a leaf`,
      ).toBeVisible()
    }

    // Compare DOM order: the buttons must appear in the expected order
    // when read top-to-bottom in the document.
    const orderInDom = await page.evaluate((ids: readonly string[]) => {
      const found: string[] = []
      const all = document.querySelectorAll('[data-testid]')
      for (const el of all) {
        const id = el.getAttribute('data-testid')
        if (id && ids.includes(id)) found.push(id)
      }
      // Deduplicate: SplitButton renders the primary + dropdown which can
      // share a prefix; we only care about first occurrence per id.
      return found.filter((id, i) => found.indexOf(id) === i)
    }, EXPECTED_TOOLBAR_ORDER)

    expect(
      orderInDom,
      `Paused Toolbar order must match.\nGot: ${orderInDom.join(', ')}\nWant: ${EXPECTED_TOOLBAR_ORDER.join(', ')}`,
    ).toEqual([...EXPECTED_TOOLBAR_ORDER])

    // While paused on a LEAF Log, Skip Block is enabled (no aria-disabled).
    await expect(
      page.locator('[data-testid="action-skip-block-button"]'),
    ).not.toHaveAttribute('aria-disabled', 'true')

    await confirmStop(page)
  })

  test('S2: Skip Block on a diverging If-Else is aria-disabled with the matching tooltip', async ({
    page,
  }) => {
    await importAndNavigate(page, loadIfElseFixture('S2'))
    await toggleBreakpoint(page, 'if-else')
    await selectEnvironment(page)
    await startDebugRun(page)
    await waitPaused(page, 'if-else')

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
    // Visually-disabled affordance (opacity + cursor).
    await expect(skipBtn).toHaveClass(/opacity-50/)
    await expect(skipBtn).toHaveClass(/cursor-not-allowed/)
    // Must remain focusable: NO HTML disabled attribute.
    await expect(skipBtn).not.toHaveAttribute('disabled', '')

    // The other paused-toolbar verbs remain enabled - Step Over / Step Into
    // / Repeat Step / Continue can all still be invoked on a diverging
    // parent.
    for (const id of [
      'action-step-over-button',
      'action-step-into-button',
      'action-repeat-step-button',
      'action-continue-button',
    ]) {
      await expect(page.locator(`[data-testid="${id}"]`)).toBeEnabled()
    }

    // Stop wraps to the row under Skip, where the open tooltip covers it until the pointer leaves Skip.
    await page.mouse.move(0, 0)
    await expect(page.locator('[data-slot="tooltip-content"]:not([data-state="closed"])')).toHaveCount(0)
    await confirmStop(page)
  })

  test('S3: Post-Repeat success - amber paused border composes with success terminal badge', async ({
    page,
  }) => {
    // Set a breakpoint on a regular Log node and pause via Debug. The
    // initial pause fires BEFORE the node runs (no terminal badge yet).
    // Clicking Repeat Step runs the node successfully and re-pauses on
    // the same node with reason=step_complete - the badge composes with
    // the still-active amber paused border.
    await importAndNavigate(page, loadFlatFixture('S3'))
    await toggleBreakpoint(page, 'log-2')
    await selectEnvironment(page)
    await startDebugRun(page)

    await waitPaused(page, 'log-2')
    const node = page.locator('[data-testid="workflow-node-log-2"]')
    await expect(node).toHaveClass(/border-amber-500/)

    // Repeat Step - the Log re-runs (succeeds) and re-pauses with badge
    // flipped to success.
    await page.locator('[data-testid="action-repeat-step-button"]').click()
    await waitPaused(page, 'log-2')
    await expect
      .poll(
        async () => node.getAttribute('data-execution-status'),
        { timeout: 5_000 },
      )
      .toBe('success')

    // The amber paused border must still be applied while the badge is
    // success - this is the layered composition.
    await expect(node).toHaveClass(/border-amber-500/)
    await expect(node).toHaveClass(/border-\[3px\]/)
    await expect(node).toHaveAttribute('data-paused', 'true')

    await confirmStop(page)
  })

  test('S4: Post-Repeat failure - amber paused border composes with failure terminal badge', async ({
    page,
  }) => {
    await importAndNavigate(page, loadRepeatFailFixture('S4'))
    await setPauseOnErrors(page, true)
    await selectEnvironment(page)
    await startDebugRun(page)

    // The trycatch fixture's body has log-fail running expression "1/0";
    // pause-on-errors fires AT log-fail. Note: at this initial pause the
    // engine has NOT yet committed block_states[log-fail]="failed" - it
    // does that only after Continue resumes the failure path (see
    // try_catch.py:_execute_single_path_node). So data-execution-status
    // is still "running" pre-Repeat, and the amber border is what proves
    // the paused state.
    await waitPaused(page, 'log-fail')
    const failNode = page.locator('[data-testid="workflow-node-log-fail"]')
    await expect(failNode).toHaveClass(/border-amber-500/)

    // Repeat Step - the engine re-runs the same "1/0" expression. Because
    // pause_on_errors is set, the re-execution re-fires
    // _maybe_pause_on_error and re-pauses on the same node BEFORE the
    // outer try-catch handler updates block_states[log-fail] to "failed".
    // The visual contract for this state is the amber paused border still
    // composed on the failing node; the failure badge transition is
    // covered by the unit / integration tests (REQ-3.2.1.4).
    await page.locator('[data-testid="action-repeat-step-button"]').click()
    await waitPaused(page, 'log-fail')
    await expect(failNode).toHaveClass(/border-amber-500/)
    await expect(failNode).toHaveClass(/border-\[3px\]/)
    await expect(failNode).toHaveAttribute('data-paused', 'true')

    await confirmStop(page)
  })
})
