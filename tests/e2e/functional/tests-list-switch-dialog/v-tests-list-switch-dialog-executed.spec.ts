/**
 * V-TESTS-LIST-SWITCH-DIALOG-EXECUTED: the switch dialog opens at the Tests list.
 *
 * When the workbench holds a clean-but-executed test (saved + terminal
 * status), clicking another test row in the Tests list surfaces the switch
 * dialog at the tests-list boundary (`use-test-crud.ts::handleOpenInWorkbench`,
 * gated on `getCurrentSession()` with the predicate `isDirty || session`),
 * never after navigating to `/workbench`. The container.tsx caller passes
 * `executionActive={!!session}` so the dialog renders the
 * "Active Execution State" title for the executed-only branch.
 *
 * This spec drives a real end-to-end run, navigates to /tests, clicks a
 * different test row, and asserts:
 *   - the dialog opens AT /tests (URL unchanged - timing fix);
 *   - the dialog title is "Active Execution State";
 *   - "Reset & Open New" lands on /workbench with the new test loaded
 *     (the ?editTest param itself is consumed-and-stripped on arrival).
 */

import { test, expect, type APIRequestContext, type Page } from '../../helpers/playwright-fixtures'
import { waitForCanvasLoad } from '../../helpers/canvas'
import { BACKEND_PORT, E2E_ENV_NAME, ensureEnvironment } from '../../helpers/config'

const BASE = `http://localhost:${BACKEND_PORT}`

function buildLogFixture(description: string, message: string) {
  return {
    name: `bug02 ${description} ${Date.now()}`,
    version: '1.0.0',
    description: 'Single Log node, runs to passed quickly.',
    workflow: {
      nodes: [
        {
          id: 'log-node',
          type: 'workflowNode',
          position: { x: 200, y: 150 },
          data: {
            label: 'Log',
            elementType: 'log',
            nodeType: 'plugin',
            category: 'system',
            version: '1.0.0',
            description,
            hasNewerVersion: false,
            expressionFields: ['message'],
            templateFields: [],
            variableExpressionKeys: [],
            config: {
              values: { message: `'${message}'`, level: 'INFO' },
              outputBindings: {},
              profileBindings: [],
            },
          },
          measured: { width: 120, height: 62 },
        },
      ],
      edges: [
        { id: 'e1', source: 'start-node', target: 'log-node', type: 'default' },
      ],
    },
    variables: {},
    metadata: {},
    created_at: '2026-04-28T00:00:00.000000',
    updated_at: '2026-04-28T00:00:00.000000',
  }
}

async function importFixture(
  request: APIRequestContext,
  payload: Record<string, unknown>,
): Promise<string> {
  const resp = await request.post(`${BASE}/tests`, { data: payload })
  expect(resp.ok(), `POST /tests failed: ${resp.status()}`).toBeTruthy()
  const body = (await resp.json()) as Record<string, unknown>
  const data = (body.data ?? body) as Record<string, unknown>
  return data.id as string
}

async function selectEnvironment(page: Page) {
  await page.locator('[data-testid="environment-selector"]').click()
  const popover = page.locator('[data-testid="environment-popover"]')
  await expect(popover).toBeVisible()
  await popover.locator(`button:has-text("${E2E_ENV_NAME}")`).first().click()
  await expect(popover).not.toBeVisible()
}

async function runToTerminal(page: Page) {
  await page.locator('[data-testid="run-button"]').click()
  const statusIndicator = page.locator('[data-testid="workflow-status"]')
  await expect(statusIndicator).not.toHaveAttribute('data-status', 'idle', { timeout: 5_000 })
  await expect(statusIndicator).not.toHaveAttribute('data-status', 'running', { timeout: 15_000 })
  const statusVal = await statusIndicator.getAttribute('data-status')
  expect(statusVal, 'workflow ran to a terminal status').toMatch(/^(passed|failed|stopped|skipped)$/)
}

test.describe('switch dialog opens AT /tests for clean-but-executed workbench', () => {
  test.beforeEach(async ({ page }) => {
    await page.request.delete(`${BASE}/workbench/session`).catch(() => {})
  })

  test('clicking a different test row opens the dialog at /tests with the executed-only title', async ({
    page,
    request,
  }) => {
    await ensureEnvironment(request)

    // Two tests: the workbench will load test-A, run it, and then we'll
    // click test-B in the list. test-B is a separate identity so the
    // tests-list handler can't short-circuit on `testId === editingTestId`.
    const testAId = await importFixture(request, buildLogFixture('Test A', 'a-run'))
    const fixtureB = buildLogFixture('Test B', 'b-not-yet')
    const testBId = await importFixture(request, fixtureB)

    // Open Test A in the workbench, run to terminal status. After this,
    // the workbench session held by `getCurrentSession()` carries
    // status=passed and test_id=testAId.
    await page.goto(`/workbench?editTest=${testAId}`)
    await page.evaluate(() => localStorage.clear())
    await page.goto(`/workbench?editTest=${testAId}`)
    await waitForCanvasLoad(page)

    await selectEnvironment(page)
    await runToTerminal(page)

    // The workbench is clean (no edits) AND has a terminal session.
    await expect(page.locator('[data-testid="toolbar-save-button"]')).toBeDisabled()

    // Navigate to the Tests list. We use page.goto rather than a sidebar
    // click so this test does not depend on sidebar collapse state across
    // viewports.
    await page.goto('/tests')
    await expect(page.locator('[data-testid="tests-page"]')).toBeVisible({ timeout: 10_000 })

    // Click Test B's name cell (the data-testid is `test-name` on the
    // clickable button rendered inside the row whose data-row-id is testBId).
    const testBRow = page.locator(`[data-testid="test-row"][data-row-id="${testBId}"]`)
    await expect(testBRow).toBeVisible()
    await testBRow.locator('[data-testid="test-name"]').click()

    // Timing assertion: the dialog opens BEFORE navigation. URL
    // must still be /tests when the dialog renders.
    const dialog = page.locator('[data-testid="switch-test-dialog"]')
    await expect(dialog).toBeVisible({ timeout: 5_000 })
    await expect(page).toHaveURL(/\/tests(\?[^?]*)?$/)

    // Title assertion: the executed-only branch (clean + session)
    // must render "Active Execution State". The default branch
    // ("Unsaved Changes in Workbench") would mean the container did not
    // pass executionActive=true even though the gate fired.
    await expect(dialog).toContainText('Active Execution State')

    // The footer button for the executed-only branch is "Reset & Open New".
    const resetBtn = dialog.getByRole('button', { name: /Reset & Open New/i })
    await expect(resetBtn).toBeVisible()
    await resetBtn.click()

    // Reset & Open New opens test B in the workbench. The ?editTest param is
    // consumed-and-stripped on arrival, so assert the post-strip outcome.
    await expect(page).toHaveURL(/\/workbench/, { timeout: 10_000 })
    await waitForCanvasLoad(page)
    await expect(page.locator('[data-testid="canvas-breadcrumb"]')).toContainText(fixtureB.name)
  })

  test('clicking a different test row navigates directly when the workbench is truly idle', async ({
    page,
    request,
  }) => {
    // Sanity check: the gate must not over-correct. With no
    // editingTestId and no session, clicking a row should navigate
    // directly with no dialog.
    const fixtureA = buildLogFixture('Idle A', 'a')
    const testAId = await importFixture(request, fixtureA)
    await importFixture(request, buildLogFixture('Idle B', 'b'))

    await page.goto('/tests')
    await expect(page.locator('[data-testid="tests-page"]')).toBeVisible({ timeout: 10_000 })

    const testARow = page.locator(`[data-testid="test-row"][data-row-id="${testAId}"]`)
    await expect(testARow).toBeVisible()
    await testARow.locator('[data-testid="test-name"]').click()

    await expect(page).toHaveURL(/\/workbench/, { timeout: 10_000 })
    await expect(page.locator('[data-testid="switch-test-dialog"]')).toHaveCount(0)
    await waitForCanvasLoad(page)
    await expect(page.locator('[data-testid="canvas-breadcrumb"]')).toContainText(fixtureA.name)
  })
})
