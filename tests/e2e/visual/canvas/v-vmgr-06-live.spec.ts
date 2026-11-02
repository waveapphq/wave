/**
 * V-VMGR-06 (live): Variable Inspect Modal - Compare Mode live delta
 *
 * Design Decisions: VMGR-43, VMGR-45 (two panes; delta metric family; Current
 * pane = runtime overlay + full-value fetch; Initial pane is the persisted
 * definition and never fetches)
 * REQ: REQ-3.2.2.18 (live variable values display), REQ-3.1.3.12
 * (auto-refresh watched variables on change), REQ-3.1.3.11
 *
 * Functional coverage: the Compare Current pane rides the
 * same runtime overlay + summary-envelope full-value fetch pipeline as single
 * Current mode, so the live delta proves the panes are wired to the engine
 * end-to-end (WS push -> overlay -> full-value fetch) while the Initial pane
 * stays pinned to the definition.
 *
 * Pass Criteria:
 * 1. The fixture passes POST /tests/{id}/validate with zero errors.
 * 2. A watcher staged in Compare while idle renders the definition in BOTH
 *    panes with the `2 -> 2 items` metric (idle Current degrades to the
 *    definition).
 * 3. After the run produces the variable, the Current pane resolves the FULL
 *    six-element runtime array while the Initial pane stays at the two-element
 *    definition; the metric flips to `2 -> 6 items`.
 * 4. When the value changes mid-run, the Current pane re-fetches in place to
 *    the three-element value and the metric flips to `2 -> 3 items`; the
 *    Initial pane is unchanged.
 * 5. The run reaches the passed terminal state and the final delta persists.
 */

import { test, expect, type Locator, type Page } from '../../helpers/playwright-fixtures'
import { waitForCanvasLoad } from '../../helpers/canvas'
import { BACKEND_PORT, ensureEnvironment } from '../../helpers/config'
import { selectEnvironment } from '../../helpers/workbench'
import fs from 'fs'
import path from 'path'

const FIXTURE_PATH = path.resolve(
  __dirname,
  '../../fixtures/canvas/v-vmgr-inspect/fixture-live-complex.json',
)

function loadFixture(nameSuffix: string): Record<string, unknown> {
  const fixture = JSON.parse(fs.readFileSync(FIXTURE_PATH, 'utf-8'))
  fixture.name = `V-VMGR-06 live ${nameSuffix} ${Date.now()}`
  return fixture
}

const content = (page: Page): Locator =>
  page.locator('[data-testid="variable-manager-content"]')

const rowFor = (page: Page, name: string): Locator =>
  content(page).locator(`[aria-label="Variable ${name}"]`)

const modalFor = (page: Page, name: string): Locator =>
  page.locator(`section[aria-label="Inspect variable ${name}"]`)

const initialPane = (modal: Locator): Locator =>
  modal.locator('[data-testid="compare-pane-initial"]')

const currentPane = (modal: Locator): Locator =>
  modal.locator('[data-testid="compare-pane-current"]')

async function importValidateAndOpen(page: Page, nameSuffix: string): Promise<void> {
  await page.request
    .delete(`http://localhost:${BACKEND_PORT}/workbench/session/`)
    .catch(() => {})
  await ensureEnvironment(page.request)

  const createResp = await page.request.post(
    `http://localhost:${BACKEND_PORT}/tests`,
    { data: loadFixture(nameSuffix) },
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

async function openInCompare(page: Page, name: string): Promise<Locator> {
  await rowFor(page, name).locator('[data-testid^="expand-button-"]').click()
  const modal = modalFor(page, name)
  await expect(modal).toBeVisible()
  const trigger = modal.locator('[data-testid="mode-dropdown"]')
  await trigger.click()
  await page.getByRole('option', { name: 'Compare', exact: true }).click()
  await expect(trigger).toContainText('Compare')
  return modal
}

test.describe('V-VMGR-06: Compare mode, live delta', () => {
  test('Current pane rides the runtime overlay + full-value fetch; Initial pane stays the definition', async ({
    page,
  }) => {
    test.setTimeout(120_000)
    await importValidateAndOpen(page, 'compare-delta')

    const modal = await openInCompare(page, 'metrics')
    const initialRows = initialPane(modal).locator('[data-testid="array-row"]')
    const currentRows = currentPane(modal).locator('[data-testid="array-row"]')
    const metric = modal.locator('[data-testid="inspect-metric"]')

    // Idle: both panes render the two-element definition; equal-count delta.
    await expect(initialRows).toHaveCount(2)
    await expect(currentRows).toHaveCount(2)
    await expect(metric).toHaveText('2 -> 2 items')

    await selectEnvironment(page)
    await page.locator('[data-testid="run-button"]').click()
    await expect(page.locator('[data-testid="workflow-status"]')).not.toHaveAttribute(
      'data-status',
      'idle',
      { timeout: 10_000 },
    )

    // The Current pane resolves the FULL six-element runtime array; the Initial
    // pane stays at the two-element definition. The delta flips to 2 -> 6.
    await expect(currentRows).toHaveCount(6, { timeout: 15_000 })
    const currentValueAt = (i: number) => currentRows.nth(i).locator('span').nth(1)
    await expect(currentValueAt(0)).toHaveText('"alpha"')
    await expect(currentValueAt(5)).toHaveText('"zeta"')
    await expect(initialRows).toHaveCount(2)
    await expect(metric).toHaveText('2 -> 6 items')

    // Mid-run mutation: the Current pane re-fetches in place to the new
    // three-element value; the delta flips to 2 -> 3; the Initial pane holds.
    await expect(currentRows).toHaveCount(3, { timeout: 15_000 })
    await expect(currentValueAt(0)).toHaveText('"omega"')
    await expect(initialRows).toHaveCount(2)
    await expect(metric).toHaveText('2 -> 3 items')

    // Terminal state: the final delta persists.
    await expect(page.locator('[data-testid="workflow-status"]')).toHaveAttribute(
      'data-status',
      'passed',
      { timeout: 30_000 },
    )
    await expect(currentRows).toHaveCount(3)
    await expect(initialRows).toHaveCount(2)
    await expect(metric).toHaveText('2 -> 3 items')
  })
})
