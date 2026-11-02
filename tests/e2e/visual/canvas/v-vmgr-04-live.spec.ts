/**
 * V-VMGR-04 (live): Variable Inspect Modal - Full Complex Runtime Values
 *
 * Design Decisions: VMGR-33 (first-fetch skeleton, stale-while-revalidate,
 * event-driven re-fetch), VMGR-23/24/27 (typed body for the fetched value);
 * summary-envelope fetch trigger; secret masking on the session variables
 * endpoint
 * REQ: REQ-3.2.2.18 (live variable values display), REQ-3.1.3.12
 * (auto-refresh watched variables on change), REQ-3.1.3.11
 *
 * Functional coverage (the live scenarios prove the
 * endpoint + WS-envelope + fetch hook + typed-body pipeline end-to-end).
 *
 * Pass Criteria:
 * 1. The fixture passes POST /tests/{id}/validate with zero errors.
 * 2. A complex watcher staged while idle renders the definition value; once
 *    the run produces the variable, the watcher shows the FULL runtime
 *    array (all six elements, untruncated, typed rows) - not the panel's
 *    summary - after a first-fetch skeleton (aria-busy).
 * 3. When the value changes mid-run, the open watcher re-fetches off the
 *    change summary and updates in place (stale-while-revalidate - no
 *    second skeleton) to the new 3-element value.
 * 4. The run reaches the passed terminal state; the final value persists in
 *    the watcher; GET /workbench/{session_id}/variables serves the full
 *    runtime array.
 * 5. A declared-secret variable is masked everywhere: the row shows ********,
 *    the SECRET badge appears, the expand button is disabled with the exact
 *    tooltip, and after a run the session variables endpoint masks the value
 *    while non-secret variables stay unmasked.
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
  fixture.name = `V-VMGR-04 live ${nameSuffix} ${Date.now()}`
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

async function runWorkflow(page: Page): Promise<void> {
  await selectEnvironment(page)
  await page.locator('[data-testid="run-button"]').click()
  await expect(page.locator('[data-testid="workflow-status"]')).not.toHaveAttribute(
    'data-status',
    'idle',
    { timeout: 10_000 },
  )
}

async function getActiveSessionId(page: Page): Promise<string> {
  const resp = await page.request.get(
    `http://localhost:${BACKEND_PORT}/workbench/session`,
  )
  const body = await resp.json().catch(() => null)
  expect(
    resp.ok(),
    `GET /workbench/session failed: ${resp.status()} - ${JSON.stringify(body)}`,
  ).toBeTruthy()
  const sessionId = body?.data?.session_id ?? body?.session_id ?? null
  expect(sessionId, `expected an active session_id, got ${JSON.stringify(body)}`).toBeTruthy()
  return sessionId as string
}

async function getSessionVariables(
  page: Page,
  sessionId: string,
): Promise<Record<string, { value: unknown; type: string }>> {
  const resp = await page.request.get(
    `http://localhost:${BACKEND_PORT}/workbench/${sessionId}/variables`,
  )
  const body = await resp.json().catch(() => null)
  expect(
    resp.ok(),
    `GET /workbench/{sid}/variables failed: ${resp.status()} - ${JSON.stringify(body)}`,
  ).toBeTruthy()
  return body.data.variables
}

test.describe('V-VMGR-04: live complex values', () => {
  test('open watcher resolves summaries to FULL values: skeleton, six typed rows, in-place mid-run refresh, endpoint parity', async ({
    page,
  }) => {
    test.setTimeout(120_000)
    await importValidateAndOpen(page, 'full-value')

    // Stage the watcher BEFORE the run: the definition renders two rows.
    await rowFor(page, 'metrics').locator('[data-testid^="expand-button-"]').click()
    const modal = modalFor(page, 'metrics')
    await expect(modal).toBeVisible()
    const body = modal.locator('[data-testid="array-body"]')
    const rows = body.locator('[data-testid="array-row"]')
    const metric = modal.locator('[data-testid="inspect-metric"]')
    await expect(rows).toHaveCount(2)
    await expect(metric).toHaveText('2 items')

    await runWorkflow(page)

    // First full-value fetch shows the aria-busy skeleton (VMGR-33); the
    // first Delay holds the run so the windows below are deterministic.
    const skeleton = modal.locator('[data-testid="inspect-body-skeleton"]')
    await expect(skeleton).toBeVisible({ timeout: 15_000 })
    await expect(skeleton).toHaveAttribute('aria-busy', 'true')

    // The watcher renders the FULL six-element runtime array - typed rows,
    // untruncated, nested map as one-line JSON - not the panel's summary.
    await expect(rows).toHaveCount(6, { timeout: 15_000 })
    const valueAt = (i: number) => rows.nth(i).locator('span').nth(1)
    await expect(valueAt(0)).toHaveText('"alpha"')
    await expect(valueAt(1)).toHaveText('42')
    await expect(valueAt(2)).toHaveText('true')
    await expect(valueAt(3)).toHaveText('{"retries":3,"host":"srv-a"}')
    await expect(valueAt(4)).toHaveText('null')
    await expect(valueAt(5)).toHaveText('"zeta"')
    await expect(metric).toHaveText('6 items')

    // Mid-run mutation: the change summary triggers an event-driven
    // re-fetch and the body updates IN PLACE to the new 3-element value
    // (stale-while-revalidate - no second skeleton).
    await expect(rows).toHaveCount(3, { timeout: 15_000 })
    await expect(valueAt(0)).toHaveText('"omega"')
    await expect(valueAt(1)).toHaveText('99')
    await expect(valueAt(2)).toHaveText('false')
    await expect(metric).toHaveText('3 items')
    await expect(skeleton).toHaveCount(0)

    // Terminal state: the final value persists in the watcher; the panel
    // row keeps its summary form while the watcher holds the full value.
    await expect(page.locator('[data-testid="workflow-status"]')).toHaveAttribute(
      'data-status',
      'passed',
      { timeout: 30_000 },
    )
    await expect(rows).toHaveCount(3)
    await expect(
      rowFor(page, 'metrics').locator('[data-testid^="variable-value-"]'),
    ).toHaveText('[3 items]')

    // Endpoint parity: the session variables endpoint serves the same full
    // runtime array (a completed session still serves its final values).
    const sessionId = await getActiveSessionId(page)
    const variables = await getSessionVariables(page, sessionId)
    expect(variables.metrics).toBeTruthy()
    expect(variables.metrics.type).toBe('array')
    expect(variables.metrics.value).toEqual(['omega', 99, false])
  })

  test('a declared-secret variable is masked in the row and by the session endpoint', async ({
    page,
  }) => {
    test.setTimeout(120_000)
    // Secret masking: a secret variable must be masked
    // everywhere - the row value, the SECRET badge, the disabled expand
    // affordance, and the live session variables endpoint. (Secret is a
    // create-time attribute; the inspect-modal edit has no secret toggle.)
    await importValidateAndOpen(page, 'secret-mask')

    const tokenRow = rowFor(page, 'token')
    const tokenValue = tokenRow.locator('[data-testid^="variable-value-"]')
    const tokenExpand = tokenRow.locator('[data-testid^="expand-button-"]')

    // The declared secret is masked from the start: value, badge, disabled
    // expand with the exact tooltip.
    await expect(tokenValue).toHaveText('********')
    await expect(tokenRow.locator('[data-testid^="secret-badge-"]')).toHaveText(
      'SECRET',
    )
    await expect(tokenExpand).toHaveAttribute('aria-disabled', 'true')
    const expandClass = (await tokenExpand.getAttribute('class')) ?? ''
    expect(expandClass).toMatch(/opacity-50/)
    expect(expandClass).toMatch(/cursor-not-allowed/)
    await page.mouse.move(0, 0)
    await tokenExpand.hover()
    await expect(
      page.getByRole('tooltip', {
        name: 'Secret values cannot be expanded',
        exact: true,
      }),
    ).toBeVisible({ timeout: 2000 })

    // After a run the session variables endpoint masks the secret while
    // non-secret variables stay unmasked.
    await runWorkflow(page)
    await expect(page.locator('[data-testid="workflow-status"]')).toHaveAttribute(
      'data-status',
      'passed',
      { timeout: 30_000 },
    )

    const sessionId = await getActiveSessionId(page)
    const variables = await getSessionVariables(page, sessionId)
    expect(variables.token).toBeTruthy()
    expect(variables.token.value).toBe('********')
    expect(variables.token.type).toBe('string')
    expect(variables.metrics.value).toEqual(['omega', 99, false])
  })
})
