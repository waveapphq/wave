/**
 * V-VMGR-03 (live update): Variable Inspect Modal - Functional Runtime Overlay
 *
 * Design Decisions: VMGR-19 (Current = runtime overlay); watcher staged
 * before a run; live view
 * REQ: REQ-3.2.2.18 (live variable values display), REQ-3.1.3.11
 *
 * Functional coverage (UI surface - the live-update scenario stands
 * in for a plugin fixture family).
 *
 * Pass Criteria:
 * 1. The fixture passes POST /tests/{id}/validate with zero errors.
 * 2. A watcher opened while idle shows definition parity: Current and
 *    Initial render the identical definition value.
 * 3. Running the workflow (Var Setter mutates `greeting`, Delay holds the
 *    run open, Log reads the variable) updates the watcher's Current body
 *    to the runtime value, full and untruncated, with the metric tracking
 *    the displayed value.
 * 4. Initial keeps the persisted definition throughout the run.
 * 5. The run reaches the passed terminal state and the runtime overlay
 *    persists in Current until Reset.
 * 6. Breadcrumb Reset clears the execution state: the watcher returns to
 *    definition parity.
 */

import { test, expect, type Locator, type Page } from '../../helpers/playwright-fixtures'
import { waitForCanvasLoad } from '../../helpers/canvas'
import { BACKEND_PORT, ensureEnvironment } from '../../helpers/config'
import { selectEnvironment } from '../../helpers/workbench'
import fs from 'fs'
import path from 'path'

const FIXTURE_PATH = path.resolve(
  __dirname,
  '../../fixtures/canvas/v-vmgr-inspect/fixture-live.json',
)

function loadFixture(): Record<string, unknown> {
  const fixture = JSON.parse(fs.readFileSync(FIXTURE_PATH, 'utf-8'))
  fixture.name = `V-VMGR-03 live ${Date.now()}`
  return fixture
}

const modal = (page: Page): Locator =>
  page.locator('section[aria-label="Inspect variable greeting"]')

async function switchMode(page: Page, label: 'Initial' | 'Current'): Promise<void> {
  const trigger = modal(page).locator('[data-testid="mode-dropdown"]')
  await trigger.click()
  await page.getByRole('option', { name: label, exact: true }).click()
  await expect(trigger).toContainText(label)
}

async function importValidateAndOpen(page: Page): Promise<void> {
  await page.request
    .delete(`http://localhost:${BACKEND_PORT}/workbench/session/`)
    .catch(() => {})
  await ensureEnvironment(page.request)

  const createResp = await page.request.post(
    `http://localhost:${BACKEND_PORT}/tests`,
    { data: loadFixture() },
  )
  const body = await createResp.json().catch(() => null)
  expect(
    createResp.ok(),
    `POST /tests failed: ${createResp.status()} - ${JSON.stringify(body)}`,
  ).toBeTruthy()
  const testId = (body.data?.id ?? body.id) as string

  // Validation gate: the fixture must be zero-error before it is run.
  const validateResp = await page.request.post(
    `http://localhost:${BACKEND_PORT}/tests/${testId}/validate`,
  )
  expect(
    validateResp.ok(),
    `POST /tests/{id}/validate failed: ${validateResp.status()}`,
  ).toBeTruthy()
  const validateBody = await validateResp.json()
  const errors = validateBody?.data?.errors ?? validateBody?.errors ?? []
  expect(errors, `validation errors: ${JSON.stringify(errors)}`).toEqual([])

  await page.goto(`/workbench?editTest=${testId}`)
  await page.evaluate(() => localStorage.clear())
  await page.goto(`/workbench?editTest=${testId}`)
  await waitForCanvasLoad(page)

  const panel = page.locator('[data-testid="variable-manager"]')
  const state = await panel.getAttribute('data-state')
  if (state === 'collapsed') {
    await panel.locator('button[aria-label="Expand Variable Manager"]').click()
    await expect(panel).toHaveAttribute('data-state', 'expanded')
  }
}

test.describe('V-VMGR-03: inspect modal live update', () => {
  test('Current follows the runtime overlay during a run; Initial keeps the definition; Reset restores parity', async ({
    page,
  }) => {
    test.setTimeout(120_000)
    await importValidateAndOpen(page)

    // Stage the watcher BEFORE the run: expand the greeting row.
    await page
      .locator('[aria-label="Variable greeting"]')
      .locator('[data-testid^="expand-button-"]')
      .click()
    await expect(modal(page)).toBeVisible()

    const body = modal(page).locator('[data-testid="scalar-body"]')
    const bodyText = body.locator('.cm-content')
    const metric = modal(page).locator('[data-testid="inspect-metric"]')

    // Idle parity: Current (default) and Initial render the same definition.
    // A string renders raw (no quotes) through the line-numbered editor; the
    // Initial pane dims via opacity.
    await expect(bodyText).toHaveText('hello')
    expect((await body.getAttribute('class')) ?? '').not.toMatch(/opacity-70/)
    await expect(metric).toHaveText('5 chars')
    await switchMode(page, 'Initial')
    await expect(bodyText).toHaveText('hello')
    expect((await body.getAttribute('class')) ?? '').toMatch(/opacity-70/)
    await switchMode(page, 'Current')

    // Run: Var Setter writes the new literal, the Delay holds the session
    // open so the watcher observes the live overlay mid-run.
    await selectEnvironment(page)
    await page.locator('[data-testid="run-button"]').click()
    const status = page.locator('[data-testid="workflow-status"]')
    await expect(status).not.toHaveAttribute('data-status', 'idle', {
      timeout: 10_000,
    })

    // Current updates to the runtime value (WS push, full + untruncated);
    // the metric tracks the displayed value.
    await expect(bodyText).toHaveText('hello from runtime', { timeout: 15_000 })
    await expect(metric).toHaveText('18 chars')

    // Initial keeps the persisted definition while the overlay is live.
    await switchMode(page, 'Initial')
    await expect(bodyText).toHaveText('hello')
    expect((await body.getAttribute('class')) ?? '').toMatch(/opacity-70/)
    await switchMode(page, 'Current')
    await expect(bodyText).toHaveText('hello from runtime')

    // The run reaches the passed terminal state; the overlay persists in
    // Current until Reset. The panel row carries the same propagated value.
    await expect(status).toHaveAttribute('data-status', 'passed', {
      timeout: 30_000,
    })
    await expect(bodyText).toHaveText('hello from runtime')
    await expect(
      page
        .locator('[aria-label="Variable greeting"]')
        .locator('[data-testid^="variable-value-"]'),
    ).toHaveText('hello from runtime')

    // Reset clears the execution state: definition parity returns.
    // A zero-artifact session resets INSTANTLY - no confirmation dialog.
    await page.locator('[data-testid="breadcrumb-reset-link"]').click()
    await expect(bodyText).toHaveText('hello', { timeout: 10_000 })
    await expect(page.getByRole('alertdialog')).toHaveCount(0)
    await expect(metric).toHaveText('5 chars')
  })
})
