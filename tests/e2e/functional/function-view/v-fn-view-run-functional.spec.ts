/**
 * V-FN-VIEW-RUN (functional): standalone Run / Debug of a published Function
 * from the read-only library View.
 *
 * Design: standalone scratch invocation.
 * REQ: REQ-3.2.1.1 (run to completion), REQ-3.2.1.2 (debug), REQ-3.1.2.2 (publish).
 *
 * Covers the full View run lifecycle as a real user experiences it:
 *   1. Run the published version standalone - no caller binds the inputs, so the
 *      body runs against the DECLARED DEFAULTS and the console shows the log.
 *   2. Enter Edit; Run dispatches the in-memory DRAFT path (not the pinned
 *      published version) and the body executes end-to-end.
 *   3. Publish a patch from the View (single-outcome confirm) - the library
 *      gains 1.0.1 and the View returns to a clean read-only state.
 *   4. Guard: the read-only View hides the Create-Parameter affordance.
 *
 * Phase: functional-workflow. Self-seeds a published Function via REST.
 */

import { test, expect, type Page, type APIRequestContext } from '../../helpers/playwright-fixtures'
import {
  publishLibraryFunction,
  openFunctionView,
  logNode,
  startEdge,
  type SeededLibraryFunction,
} from '../../helpers/fn-seed'
import { getLogTexts } from '../../helpers/log-reader'
import { BACKEND_URL, E2E_ENV_NAME, ensureEnvironment } from '../../helpers/config'
import { randomUUID } from 'node:crypto'

/** A published Function whose body Log echoes its declared-default input. */
function seedViewFunction(request: APIRequestContext): Promise<SeededLibraryFunction> {
  return publishLibraryFunction(request, {
    name: `View-Run-${randomUUID().slice(0, 6)}`,
    inputs: [{ name: 'greeting', type: 'string', required: false, default: 'view-default' }],
    workflow: {
      // message expression is the bare input name `greeting` (NOT a literal).
      nodes: [logNode('inner-log', 'Body', 'greeting')],
      edges: [startEdge('inner-log')],
    },
  })
}

async function selectEnvironment(page: Page): Promise<void> {
  await page.locator('[data-testid="environment-selector"]').click()
  const popover = page.locator('[data-testid="environment-popover"]')
  await expect(popover).toBeVisible()
  await popover.locator(`button:has-text("${E2E_ENV_NAME}")`).first().click()
  await expect(popover).not.toBeVisible()
}

/** Click Run and poll the console until the body marker appears. */
async function runAndExpectLog(page: Page, marker: string): Promise<void> {
  await page.locator('[data-testid="run-button"]').click()
  await expect
    .poll(async () => (await getLogTexts(page)).join(' | '), {
      timeout: 30_000,
      message: `standalone run did not log "${marker}"`,
    })
    .toContain(marker)
}

test.describe('V-FN-VIEW-RUN (functional): standalone run from the library View', () => {
  test('Run executes the body with declared-default inputs', async ({ page, request }) => {
    await ensureEnvironment(request)
    const fn = await seedViewFunction(request)
    await openFunctionView(page, fn.functionId, fn.version)
    await selectEnvironment(page)

    // Nothing binds `greeting`, so the scratch run falls back to its
    // declared default and the body Log emits it.
    await runAndExpectLog(page, 'view-default')
  })

  test('edit mode dispatches the standalone DRAFT run, and the body executes', async ({
    page,
    request,
  }) => {
    await ensureEnvironment(request)
    const fn = await seedViewFunction(request)
    await openFunctionView(page, fn.functionId, fn.version)
    await selectEnvironment(page)

    // Enter edit mode; Run must now dispatch the in-memory DRAFT, not the pinned
    // published version.
    await page.locator('[data-testid="action-bar-edit-function-button"]').click()
    await expect(page.locator('[data-testid="action-bar-publish-button"]')).toBeVisible({ timeout: 15_000 })

    const runReq = page.waitForRequest(
      (r) => r.method() === 'POST' && r.url().includes(`/functions/${fn.functionId}/run`),
    )
    await page.locator('[data-testid="run-button"]').click()
    const body = (await runReq).postDataJSON()
    expect(body.draft, 'edit-mode Run carries the draft body').toBeTruthy()
    expect(body.version, 'the draft names the version it was made from').toBe(fn.version)

    // The dispatched draft executes end-to-end (declared-default input -> console).
    await expect
      .poll(async () => (await getLogTexts(page)).join(' | '), { timeout: 30_000 })
      .toContain('view-default')
  })

  test('Publish a patch from the View - library gains 1.0.1 and the View returns to read-only', async ({
    page,
    request,
  }) => {
    const fn = await seedViewFunction(request)
    await openFunctionView(page, fn.functionId, fn.version)

    // Enter edit mode and publish (a body-only patch; no structural change).
    await page.locator('[data-testid="action-bar-edit-function-button"]').click()
    await page.locator('[data-testid="action-bar-publish-button"]').click()
    const meta = page.locator('[role="dialog"]', { hasText: 'Publish edit-mode draft' })
    await expect(meta).toBeVisible({ timeout: 15_000 })
    await meta.locator('[data-testid="publish-edit-mode-changelog-input"]').fill('view patch publish')
    await meta.locator('[data-testid="publish-edit-mode-details-input"]').fill('details from the View')
    await meta.getByRole('button', { name: 'Publish' }).click()

    // Single-outcome confirm (1.0.0 -> 1.0.1).
    const confirm = page.locator('[role="alertdialog"]', { hasText: 'Publish a new version?' })
    await expect(confirm).toBeVisible({ timeout: 10_000 })
    await confirm.locator('[data-testid="publish-outcome-single-confirm"]').click()
    await expect(confirm).toBeHidden({ timeout: 15_000 })

    // The library gained 1.0.1 ...
    const versionsResp = await request.get(`${BACKEND_URL}/functions/${fn.functionId}/versions`)
    const versions = (await versionsResp.json()).data.versions.map((v: { version: string }) => v.version)
    expect(versions).toContain('1.0.1')
    // ... and the View switched back to a clean read-only state (edit mode exited).
    await expect(page.locator('[data-testid="action-bar-edit-function-button"]')).toBeVisible({ timeout: 15_000 })
  })

  test('read-only View hides the Create-Parameter affordance', async ({ page, request }) => {
    const fn = await seedViewFunction(request)
    await openFunctionView(page, fn.functionId, fn.version)

    // Expand the Var Manager only if collapsed (the View may open it expanded).
    const varPanel = page.locator('[data-testid="variable-manager"]')
    if ((await varPanel.getAttribute('data-state')) === 'collapsed') {
      await page.locator('[aria-label="Expand Variable Manager"]').first().click()
    }
    await expect(page.locator('[data-testid="variable-manager-content"]')).toBeVisible({ timeout: 10_000 })

    // A read-only drilled scope offers no +Add (structural edits blocked).
    await expect(page.locator('[data-testid="add-variable-button"]')).toHaveCount(0)
    await expect(page.locator('[data-testid="add-variable-dropdown-trigger"]')).toHaveCount(0)
  })
})
