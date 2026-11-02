/**
 * V-VMGR-05 (live): Variable Inspect Modal - Expression Evaluation Transition
 *
 * Design Decisions: VMGR-37 .. VMGR-40 (evaluated views render like literals;
 * cyan reserved for source; plain metric, no suffix). The engine realizes
 * expressions lazily on first reference and pushes them over WS; the FE
 * hasRuntimeValue bit IS the evaluation state.
 * REQ: REQ-3.1.3.13 (computed variables with expressions and runtime
 * evaluation), REQ-3.2.2.18 (live variable values display), REQ-3.1.3.11
 *
 * Functional coverage: the live scenario proves the
 * lazy-evaluation pipeline (engine realize -> WS push -> watcher overlay ->
 * full-value fetch for complex) end-to-end through the UI.
 *
 * Pass Criteria:
 * 1. The fixture passes POST /tests/{id}/validate with zero errors.
 * 2. With BOTH expression watchers open through the run, the ES watcher
 *    transitions from the "Not evaluated yet." empty state to the evaluated
 *    literal rendering: quoted string in the sky family, NOT cyan, with the
 *    plain `43 chars` metric (VMGR-37, VMGR-38).
 * 3. The EC watcher transitions from the empty state to the evaluated array
 *    rows (full-value fetch) with the `3 items` metric.
 * 4. The run reaches the passed terminal state and the evaluated values
 *    persist in the watchers.
 * 5. Flipping the ES watcher to the Expression view AFTER evaluation still
 *    shows the cyan raw source with the `expression` metric - never the
 *    value.
 */

import { test, expect, type Locator, type Page } from '../../helpers/playwright-fixtures'
import { waitForCanvasLoad } from '../../helpers/canvas'
import { BACKEND_PORT, ensureEnvironment } from '../../helpers/config'
import { selectEnvironment } from '../../helpers/workbench'
import fs from 'fs'
import path from 'path'

const FIXTURE_PATH = path.resolve(
  __dirname,
  '../../fixtures/canvas/v-vmgr-inspect/fixture-expression-views.json',
)

const API_URL_SOURCE = "'https://api.wave.test/v1/services/' + service_name"
// The evaluated literal string body renders raw (no quotes).
const EVALUATED_URL_RAW = 'https://api.wave.test/v1/services/discovery'

function loadFixture(nameSuffix: string): Record<string, unknown> {
  const fixture = JSON.parse(fs.readFileSync(FIXTURE_PATH, 'utf-8'))
  fixture.name = `V-VMGR-05 live ${nameSuffix} ${Date.now()}`
  return fixture
}

const content = (page: Page): Locator =>
  page.locator('[data-testid="variable-manager-content"]')

const rowFor = (page: Page, name: string): Locator =>
  content(page).locator(`[aria-label="Variable ${name}"]`)

const modalFor = (page: Page, name: string): Locator =>
  page.locator(`section[aria-label="Inspect variable ${name}"]`)

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

async function openInspector(page: Page, name: string): Promise<Locator> {
  await rowFor(page, name).locator('[data-testid^="expand-button-"]').click()
  const modal = modalFor(page, name)
  await expect(modal).toBeVisible()
  return modal
}

async function expectEmptyState(modal: Locator): Promise<void> {
  await expect(modal.locator('text="Not evaluated yet."')).toBeVisible()
  // An empty state carries no metric.
  await expect(modal.locator('[data-testid="inspect-metric"]')).toHaveCount(0)
}

test.describe('V-VMGR-05: live expression evaluation', () => {
  test('open watchers transition empty-state to evaluated values; Expression view keeps the source', async ({
    page,
  }) => {
    test.setTimeout(120_000)
    await importValidateAndOpen(page, 'evaluation')

    // Stage BOTH expression watchers while idle: each shows the empty state.
    const esModal = await openInspector(page, 'api_url')
    await expectEmptyState(esModal)
    const ecModal = await openInspector(page, 'service_matrix')
    await expectEmptyState(ecModal)

    // Run: the Log's message expression references both variables, so the
    // engine realizes them lazily and pushes the values over WS.
    await selectEnvironment(page)
    await page.locator('[data-testid="run-button"]').click()
    await expect(page.locator('[data-testid="workflow-status"]')).not.toHaveAttribute(
      'data-status',
      'idle',
      { timeout: 10_000 },
    )

    // EC watcher: the summary envelope resolves through the full-value fetch
    // to the evaluated array rows - typed, quoted, sky-tinted strings - with
    // the plain `3 items` metric.
    const ecRows = ecModal.locator('[data-testid="array-row"]')
    await expect(ecRows).toHaveCount(3, { timeout: 15_000 })
    const ecValueAt = (i: number) => ecRows.nth(i).locator('span').nth(1)
    await expect(ecValueAt(0)).toHaveText('"discovery"')
    await expect(ecValueAt(1)).toHaveText('"DISCOVERY"')
    await expect(ecValueAt(2)).toHaveText('"discovery-2"')
    expect(await ecValueAt(0).getAttribute('class')).toMatch(/sky/)
    await expect(ecModal.locator('[data-testid="inspect-metric"]')).toHaveText(
      '3 items',
    )
    await expect(ecModal.locator('text="Not evaluated yet."')).toHaveCount(0)

    // ES watcher: the empty state gave way to the evaluated literal
    // rendering - quoted, sky family, NOT cyan - with the plain `N chars`
    // metric (no "- evaluated" suffix).
    const esBody = esModal.locator('[data-testid="scalar-body"]')
    // The evaluated literal string renders raw through the line-numbered editor
    // (no quotes, no cyan source styling).
    await expect(esBody.locator('.cm-content')).toHaveText(EVALUATED_URL_RAW, {
      timeout: 15_000,
    })
    expect((await esBody.getAttribute('class')) ?? '').not.toMatch(/cyan/)
    await expect(esModal.locator('[data-testid="inspect-metric"]')).toHaveText(
      '43 chars',
    )
    await expect(esModal.locator('text="Not evaluated yet."')).toHaveCount(0)

    // Terminal state: the run passes and the evaluated values persist.
    await expect(page.locator('[data-testid="workflow-status"]')).toHaveAttribute(
      'data-status',
      'passed',
      { timeout: 30_000 },
    )
    await expect(esBody.locator('.cm-content')).toHaveText(EVALUATED_URL_RAW)
    await expect(ecRows).toHaveCount(3)

    // The cascaded EC watcher covers the ES footer - close it before
    // interacting with the ES View dropdown.
    await page.locator('button[aria-label="Close inspector for service_matrix"]').click()
    await expect(modalFor(page, 'service_matrix')).toHaveCount(0)

    // Expression view AFTER evaluation still shows the cyan raw source with NO
    // metric (a source is not a value) - never the evaluated value.
    await esModal.locator('[data-testid="view-dropdown"]').click()
    await page.getByRole('option', { name: 'Expression', exact: true }).click()
    await expect(esBody).toHaveText(API_URL_SOURCE)
    expect((await esBody.getAttribute('class')) ?? '').toMatch(/cyan/)
    await expect(esModal.locator('[data-testid="inspect-metric"]')).toHaveCount(0)
  })
})
