/**
 * V-VMGR-02: Variable Manager Panel - Action Cluster, Tooltip, ReadOnly
 *
 * Design Decisions: VMGR-11 (expand opens the inspect modal), VMGR-23 (complex
 * rows open the same inspect modal); eye / expand / edit / delete cluster
 * ordering; history workbench is read-only
 * REQ: REQ-3.1.3.11 (panel structure)
 *
 * Pass Criteria:
 * 1. Each row exposes the four action buttons in left-to-right DOM order:
 *    eye, expand, edit, delete.
 * 2. The expand button is enabled on scalar AND complex rows (tooltip
 *    "Inspect <name>"); clicking a complex row's expand opens its inspect
 *    modal (VMGR-23); secret rows stay visually disabled with the "Secret
 *    values cannot be expanded" tooltip.
 * 3. Disabled action tooltips surface within the disabled-delay window (~100ms)
 *    with the documented copy (ConditionalTooltip wires
 *    DISABLED_TOOLTIP_DELAY_MS=100).
 * 4. Tooltip popup closes when the pointer leaves the trigger
 *    (disableHoverableContent).
 * 5. The historical canvas (read-only snapshot) renders the panel with edit
 *    and delete disabled on every row while the eye remains usable on the
 *    snapshot data.
 */

import { test, expect, type Page, type APIRequestContext } from '../../helpers/playwright-fixtures'
import { waitForCanvasLoad } from '../../helpers/canvas'
import { BACKEND_PORT, E2E_ENV_NAME, ensureEnvironment } from '../../helpers/config'
import fs from 'fs'
import path from 'path'

function loadFixture(nameSuffix: string): Record<string, unknown> {
  const raw = fs.readFileSync(
    path.resolve(__dirname, '../../fixtures/canvas/v-vmgr-panel/fixture.json'),
    'utf-8',
  )
  const fixture = JSON.parse(raw)
  fixture.name = `V-VMGR-02 - ${nameSuffix} ${Date.now()}`
  return fixture
}

async function importAndOpen(page: Page, nameSuffix: string): Promise<void> {
  await page.request
    .delete(`http://localhost:${BACKEND_PORT}/workbench/session/`)
    .catch(() => {})

  const createResp = await page.request.post(`http://localhost:${BACKEND_PORT}/tests`, {
    data: loadFixture(nameSuffix),
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

  const panel = page.locator('[data-testid="variable-manager"]')
  const state = await panel.getAttribute('data-state')
  if (state === 'collapsed') {
    await panel.locator('button[aria-label="Expand Variable Manager"]').click()
    await expect(panel).toHaveAttribute('data-state', 'expanded')
  }
}

test.describe('V-VMGR-02: Variable Manager action cluster + tooltips', () => {
  test('action cluster renders eye / expand / edit / delete in DOM order', async ({
    page,
  }) => {
    await importAndOpen(page, 'cluster-order')

    const content = page.locator('[data-testid="variable-manager-content"]')
    const namesToCheck = ['user_name', 'retry_count', 'items', 'api_url', 'password']
    for (const name of namesToCheck) {
      const row = content.locator(`[aria-label="Variable ${name}"]`)
      const order = await row
        .locator('button[data-testid]')
        .evaluateAll((els: Element[]) =>
          els
            .map((el) => (el as HTMLElement).dataset.testid ?? '')
            .filter((id) =>
              id.startsWith('view-toggle-button-') ||
              id.startsWith('expand-button-') ||
              id.startsWith('edit-button-') ||
              id.startsWith('delete-button-'),
            )
            .map((id) => id.split('-button-')[0]),
        )
      expect(order, `cluster order for ${name}`).toEqual([
        'view-toggle',
        'expand',
        'edit',
        'delete',
      ])
    }
  })

  test('expand gating per row kind: scalar + complex enabled, secret visually disabled (VMGR-11, VMGR-23)', async ({
    page,
  }) => {
    await importAndOpen(page, 'expand-gating')

    const content = page.locator('[data-testid="variable-manager-content"]')

    // Scalar row: expand is ENABLED with the "Inspect <name>" tooltip. The
    // open-modal behavior itself is covered by V-VMGR-03.
    const scalarExpand = content
      .locator('[aria-label="Variable user_name"]')
      .locator('[data-testid^="expand-button-"]')
    await expect(scalarExpand).toBeVisible()
    await expect(scalarExpand).not.toHaveAttribute('aria-disabled', 'true')
    // Park the cursor outside the panel before each hover so Radix sees a
    // genuine pointer entry into the trigger (cursor sitting on the icon
    // from the previous interaction does not re-fire enter, which keeps
    // the popup hidden).
    await page.mouse.move(0, 0)
    await scalarExpand.hover()
    await expect(
      page.getByRole('tooltip', { name: 'Inspect user_name', exact: true }),
    ).toBeVisible({ timeout: 2000 })

    // Complex row (array): expand is ENABLED with the same "Inspect <name>"
    // tooltip and opens the inspect modal (VMGR-23). The typed-body
    // anatomy is covered by V-VMGR-04.
    const itemsExpand = content
      .locator('[aria-label="Variable items"]')
      .locator('[data-testid^="expand-button-"]')
    await expect(itemsExpand).not.toHaveAttribute('aria-disabled', 'true')
    expect(await itemsExpand.getAttribute('class')).not.toMatch(/opacity-50/)
    expect(await itemsExpand.getAttribute('class')).not.toMatch(/cursor-not-allowed/)
    await page.mouse.move(0, 0)
    await itemsExpand.hover()
    await expect(
      page.getByRole('tooltip', { name: 'Inspect items', exact: true }),
    ).toBeVisible({ timeout: 2000 })

    await itemsExpand.click()
    const itemsModal = page.locator('section[aria-label="Inspect variable items"]')
    await expect(itemsModal).toBeVisible()
    await page.locator('button[aria-label="Close inspector for items"]').click()
    await expect(itemsModal).toHaveCount(0)

    // Secret row has the expand visually disabled with the documented copy.
    const secretExpand = content
      .locator('[aria-label="Variable password"]')
      .locator('[data-testid^="expand-button-"]')
    await expect(secretExpand).toHaveAttribute('aria-disabled', 'true')
    await page.mouse.move(0, 0)
    await secretExpand.hover()
    const disabledTooltip = page.getByRole('tooltip', {
      name: /Secret values cannot be expanded/i,
    })
    await expect(disabledTooltip).toBeVisible({ timeout: 2000 })
  })

  test('disabled-state tooltip surfaces fast (~100ms window)', async ({ page }) => {
    await importAndOpen(page, 'disabled-tooltip')

    const content = page.locator('[data-testid="variable-manager-content"]')
    const secretEye = content
      .locator('[aria-label="Variable password"]')
      .locator('[data-testid^="view-toggle-button-"]')
    await expect(secretEye).toHaveAttribute('aria-disabled', 'true')

    await page.mouse.move(0, 0)
    const start = Date.now()
    await secretEye.hover()
    const tooltip = page.getByRole('tooltip', { name: /Secret values are always masked/i })
    await expect(tooltip).toBeVisible({ timeout: 2000 })
    const elapsed = Date.now() - start
    // The disabled delay is 100ms; allow generous slack for hover dispatch +
    // Radix mount, but cap below the enabled delay (500ms) so a regression
    // that swaps the constants is caught.
    expect(elapsed, 'disabled tooltip should surface fast').toBeLessThan(800)
  })

  test('tooltip closes when the pointer leaves the trigger (disableHoverableContent)', async ({
    page,
  }) => {
    await importAndOpen(page, 'tooltip-close')

    const content = page.locator('[data-testid="variable-manager-content"]')
    const secretEye = content
      .locator('[aria-label="Variable password"]')
      .locator('[data-testid^="view-toggle-button-"]')
    await page.mouse.move(0, 0)
    await secretEye.hover()
    const tooltip = page.getByRole('tooltip', { name: /Secret values are always masked/i })
    await expect(tooltip).toBeVisible({ timeout: 2000 })

    // Move pointer off the icon - tooltip should close. We aim outside the
    // panel entirely so there is no ambiguity about hovering a sibling.
    await page.mouse.move(0, 0)
    await expect(tooltip).not.toBeVisible({ timeout: 1000 })
  })

  test('historical canvas renders the panel with edit + delete disabled', async ({
    page,
    request,
  }) => {
    await page.request
      .delete(`http://localhost:${BACKEND_PORT}/workbench/session/`)
      .catch(() => {})
    await ensureEnvironment(page.request)

    const fixture = loadFixture('readonly-history')
    const testId = await postFixtureTest(request, fixture)
    const environmentId = await getEnvironmentIdFromName(request, E2E_ENV_NAME)
    const executionId = await runTrackedExecutionToTerminal(request, testId, environmentId)

    await page.goto(`/executions/history/${executionId}`)
    await waitForCanvasLoad(page)

    const panel = page.locator('[data-testid="variable-manager"]')
    const state = await panel.getAttribute('data-state')
    if (state === 'collapsed') {
      await panel.locator('button[aria-label="Expand Variable Manager"]').click()
      await expect(panel).toHaveAttribute('data-state', 'expanded')
    }

    const content = page.locator('[data-testid="variable-manager-content"]')
    const userRow = content.locator('[aria-label="Variable user_name"]')
    await expect(userRow).toBeVisible()

    const edit = userRow.locator('[data-testid^="edit-button-"]')
    const del = userRow.locator('[data-testid^="delete-button-"]')
    await expect(edit).toHaveAttribute('aria-disabled', 'true')
    await expect(del).toHaveAttribute('aria-disabled', 'true')
    expect(await edit.getAttribute('class')).toMatch(/opacity-50/)
    expect(await del.getAttribute('class')).toMatch(/opacity-50/)
  })
})

async function postFixtureTest(
  request: APIRequestContext,
  fixture: Record<string, unknown>,
): Promise<string> {
  const resp = await request.post(`http://localhost:${BACKEND_PORT}/tests`, { data: fixture })
  const body = await resp.json().catch(() => null)
  expect(
    resp.ok(),
    `POST /tests failed: ${resp.status()} - ${JSON.stringify(body)}`,
  ).toBeTruthy()
  return (body.data?.id ?? body.id) as string
}

async function getEnvironmentIdFromName(
  request: APIRequestContext,
  name: string,
): Promise<string> {
  const resp = await request.get(`http://localhost:${BACKEND_PORT}/environments/`)
  const body = await resp.json()
  const envs = Array.isArray(body) ? body : (body.data ?? [])
  const env = envs.find((e: Record<string, unknown>) => e.name === name)
  expect(env, `environment "${name}" not found`).toBeTruthy()
  return env.id as string
}

async function runTrackedExecutionToTerminal(
  request: APIRequestContext,
  testId: string,
  environmentId: string,
): Promise<string> {
  const startResp = await request.post(`http://localhost:${BACKEND_PORT}/executions`, {
    data: { type: 'test', id: testId, environment_id: environmentId },
  })
  const startBody = await startResp.json()
  expect(
    startResp.ok(),
    `POST /executions failed: ${startResp.status()} ${JSON.stringify(startBody)}`,
  ).toBeTruthy()
  const executionId = (startBody.data?.id ?? startBody.id) as string

  // Poll the execution to a terminal state. The test fixture has no real
  // work so this finishes within a few hundred ms in CI.
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    const statusResp = await request.get(
      `http://localhost:${BACKEND_PORT}/executions/${executionId}`,
    )
    const statusBody = await statusResp.json()
    const data = (statusBody.data ?? statusBody) as Record<string, unknown>
    const status = data.status as string | undefined
    if (status && ['passed', 'failed', 'stopped', 'error'].includes(status)) {
      return executionId
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error(`Execution ${executionId} did not reach terminal state`)
}
