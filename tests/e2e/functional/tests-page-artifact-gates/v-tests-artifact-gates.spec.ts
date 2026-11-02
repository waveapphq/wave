/**
 * V-TESTS-ARTIFACT-GATES: tests-page teardown gates over session artifacts
 * Design Decisions: warn matrix, callout copy
 * REQ: REQ-5.2.1.23 (Workbench Session Artifacts)
 *
 * Pass Criteria:
 *  1. With a clean canvas + a terminal session holding artifacts, the
 *     tests-page New Test button opens the switch dialog (Active Execution
 *     State variant) WITH the artifact-loss callout; Reset & Create Test
 *     proceeds to the New Test dialog AND clears the backend session
 *  2. With a clean canvas + NO session, New Test goes straight to the
 *     New Test dialog (no switch dialog)
 *  3. Opening a different test over a terminal artifact-holding
 *     session shows the switch dialog at /tests with the callout; the
 *     cancel path preserves the artifacts
 *  4. The running-session blocker (Test is Running) NEVER shows the
 *     callout, even while the running session already holds artifacts
 */

import { test, expect, type APIRequestContext, type Page } from '../../helpers/playwright-fixtures'
import { waitForCanvasLoad } from '../../helpers/canvas'
import { BACKEND_URL, E2E_ENV_NAME, ensureEnvironment } from '../../helpers/config'
import { validateTest } from '../../helpers/fn-seed'

const CALLOUT_COPY = '2 session artifacts will be permanently deleted.'
const CALLOUT_HINT = 'Download anything you need from the Artifacts panel first.'

function fileIoWriteNode(id: string, description: string, artifactPath: string, y: number) {
  return {
    id,
    type: 'workflowNode',
    position: { x: 400, y },
    data: {
      label: 'File I/O',
      elementType: 'file-io',
      nodeType: 'plugin',
      category: 'system',
      version: '1.0.0',
      description,
      hasNewerVersion: false,
      expressionFields: [],
      templateFields: [],
      config: {
        values: {
          operation: 'write',
          path: artifactPath,
          content: '{"gate": "artifact"}',
          if_exists: 'overwrite',
        },
        outputBindings: {},
        profileBindings: [],
      },
    },
    measured: { width: 120, height: 62 },
  }
}

function baseFixture(name: string, nodes: unknown[], edges: unknown[]) {
  return {
    name: `${name} ${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    version: '1.0.0',
    description: 'Tests-page artifact gate fixture.',
    workflow: { nodes, edges },
    variables: {},
    metadata: {},
    created_at: '2026-07-01T00:00:00.000000',
    updated_at: '2026-07-01T00:00:00.000000',
  }
}

/** Two File I/O writes (one nested) - the artifact-holding session. */
function buildArtifactFixture() {
  return baseFixture(
    'Gate Artifacts',
    [
      fileIoWriteNode('fio-report', 'Write Report', 'artifact://report.json', 150),
      fileIoWriteNode('fio-nested', 'Write Nested', 'artifact://output/data.json', 250),
    ],
    [
      { id: 'e1', source: 'start-node', target: 'fio-report', type: 'default' },
      { id: 'e2', source: 'fio-report', target: 'fio-nested', type: 'default' },
    ],
  )
}

/** Plain Log test - the row clicked for the switch gesture. */
function buildLogFixture() {
  return baseFixture(
    'Gate Target',
    [
      {
        id: 'log-node',
        type: 'workflowNode',
        position: { x: 400, y: 150 },
        data: {
          label: 'Log',
          elementType: 'log',
          nodeType: 'plugin',
          category: 'system',
          version: '1.0.0',
          description: 'Target Log',
          hasNewerVersion: false,
          expressionFields: [],
          templateFields: [],
          config: {
            values: { message: 'target', level: 'INFO' },
            outputBindings: {},
            profileBindings: [],
          },
        },
        measured: { width: 120, height: 62 },
      },
    ],
    [{ id: 'e1', source: 'start-node', target: 'log-node', type: 'default' }],
  )
}

/** File I/O write followed by a long Delay - a RUNNING session with artifacts. */
function buildRunningFixture() {
  return baseFixture(
    'Gate Running',
    [
      fileIoWriteNode('fio-early', 'Write Early', 'artifact://early.json', 150),
      {
        id: 'delay-node',
        type: 'workflowNode',
        position: { x: 400, y: 250 },
        data: {
          label: 'Delay',
          elementType: 'delay',
          nodeType: 'control',
          category: 'timing',
          version: '1.0.0',
          description: 'Hold Running',
          hasNewerVersion: false,
          expressionFields: [],
          templateFields: [],
          config: {
            values: { duration: 15000 },
            outputBindings: {},
            profileBindings: [],
          },
        },
        measured: { width: 120, height: 62 },
      },
    ],
    [
      { id: 'e1', source: 'start-node', target: 'fio-early', type: 'default' },
      { id: 'e2', source: 'fio-early', target: 'delay-node', type: 'default' },
    ],
  )
}

async function importFixture(
  request: APIRequestContext,
  fixture: Record<string, any>,
): Promise<{ id: string; name: string }> {
  const response = await request.post(`${BACKEND_URL}/tests`, { data: fixture })
  expect(response.ok(), `POST /tests failed: ${response.status()}`).toBeTruthy()
  const body = await response.json()
  const data = (body.data ?? body) as Record<string, unknown>
  const validation = await validateTest(request, data.id as string, 'run')
  expect(validation.errors, 'fixture must pass validation with zero errors').toHaveLength(0)
  return { id: data.id as string, name: fixture.name as string }
}

async function selectEnvironment(page: Page) {
  await page.locator('[data-testid="environment-selector"]').click()
  const popover = page.locator('[data-testid="environment-popover"]')
  await expect(popover).toBeVisible()
  await popover.locator(`button:has-text("${E2E_ENV_NAME}")`).first().click()
  await expect(popover).not.toBeVisible()
}

async function openAndRunToPassed(page: Page, testId: string) {
  await page.goto(`/workbench?editTest=${testId}`)
  await page.evaluate(() => localStorage.clear())
  await page.goto(`/workbench?editTest=${testId}`)
  await waitForCanvasLoad(page)
  await selectEnvironment(page)
  await page.locator('[data-testid="run-button"]').click()
  const status = page.locator('[data-testid="workflow-status"]')
  await expect(status).not.toHaveAttribute('data-status', 'idle', { timeout: 10_000 })
  await expect(status).toHaveAttribute('data-status', 'passed', { timeout: 20_000 })
}

async function gotoTestsPage(page: Page) {
  await page.goto('/tests')
  await expect(page.locator('[data-testid="tests-page"]')).toBeVisible({ timeout: 10_000 })
}

async function expectBackendSessionCleared(page: Page) {
  await expect(async () => {
    const resp = await page.request.get(`${BACKEND_URL}/workbench/session`)
    expect(resp.status()).toBe(200)
    expect((await resp.json()).data).toBeNull()
  }).toPass({ timeout: 10_000 })
}

test.describe('tests-page gates over session artifacts', () => {
  test.beforeEach(async ({ page }) => {
    await page.request.delete(`${BACKEND_URL}/workbench/session`).catch(() => {})
  })

  test('New Test over a terminal artifact session warns, then resets and proceeds', async ({
    page,
    request,
  }) => {
    await ensureEnvironment(request)
    const artifactTest = await importFixture(request, buildArtifactFixture())
    await openAndRunToPassed(page, artifactTest.id)

    await gotoTestsPage(page)
    await page.getByRole('button', { name: 'New Test' }).click()

    // Clean canvas + terminal session -> the switch dialog (Active
    // Execution State variant) opens AT /tests with the exact callout copy.
    const dialog = page.locator('[data-testid="switch-test-dialog"]')
    await expect(dialog).toBeVisible()
    await expect(page).toHaveURL(/\/tests(\?[^?]*)?$/)
    await expect(dialog).toContainText('Active Execution State')
    await expect(dialog).toContainText(CALLOUT_COPY)
    await expect(dialog).toContainText(CALLOUT_HINT)

    // Discarding proceeds to the New Test dialog and clears the session.
    await dialog.getByRole('button', { name: 'Reset & Create Test' }).click()
    await expect(dialog).toHaveCount(0)
    await expect(
      page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'New Test' }) }),
      'the New Test form dialog opens after the reset',
    ).toBeVisible()
    await expectBackendSessionCleared(page)
  })

  test('New Test with no session goes straight to the New Test dialog', async ({ page }) => {
    await gotoTestsPage(page)
    await page.getByRole('button', { name: 'New Test' }).click()

    await expect(
      page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'New Test' }) }),
    ).toBeVisible()
    // No session + clean canvas -> no switch dialog in between.
    await expect(page.locator('[data-testid="switch-test-dialog"]')).toHaveCount(0)
  })

  test('opening another test over a terminal artifact session shows the callout', async ({
    page,
    request,
  }) => {
    await ensureEnvironment(request)
    const artifactTest = await importFixture(request, buildArtifactFixture())
    const targetTest = await importFixture(request, buildLogFixture())
    await openAndRunToPassed(page, artifactTest.id)

    await gotoTestsPage(page)
    const targetRow = page.locator(`[data-testid="test-row"][data-row-id="${targetTest.id}"]`)
    await expect(targetRow).toBeVisible()
    await targetRow.locator('[data-testid="test-name"]').click()

    // The switch dialog opens AT /tests with the callout.
    const dialog = page.locator('[data-testid="switch-test-dialog"]')
    await expect(dialog).toBeVisible()
    await expect(page).toHaveURL(/\/tests(\?[^?]*)?$/)
    await expect(dialog).toContainText('Active Execution State')
    await expect(dialog).toContainText(CALLOUT_COPY)
    await expect(dialog.getByRole('button', { name: 'Reset & Open New' })).toBeVisible()

    // The cancel path (View Pending Workflow) preserves every artifact.
    await dialog.getByRole('button', { name: 'View Pending Workflow' }).click()
    await expect(dialog).toHaveCount(0)
    const listResp = await page.request.get(`${BACKEND_URL}/workbench/session/artifacts`)
    expect(listResp.ok(), 'session artifacts survive the cancel path').toBeTruthy()
    const paths = ((await listResp.json()).items as Array<{ path: string }>).map((i) => i.path)
    expect(paths).toContain('report.json')
    expect(paths).toContain('output/data.json')
  })

  test('the running-session blocker never shows the callout', async ({ page, request }) => {
    await ensureEnvironment(request)
    const runningTest = await importFixture(request, buildRunningFixture())

    await page.goto(`/workbench?editTest=${runningTest.id}`)
    await page.evaluate(() => localStorage.clear())
    await page.goto(`/workbench?editTest=${runningTest.id}`)
    await waitForCanvasLoad(page)
    await selectEnvironment(page)
    await page.locator('[data-testid="run-button"]').click()
    const status = page.locator('[data-testid="workflow-status"]')
    await expect(status).toHaveAttribute('data-status', 'running', { timeout: 10_000 })

    // The running session already wrote an artifact - the blocker must
    // still not warn: nothing is destroyed by the stop-first notice.
    await expect(async () => {
      const resp = await page.request.get(`${BACKEND_URL}/workbench/session/artifacts`)
      expect(resp.ok()).toBeTruthy()
      expect(((await resp.json()).items as unknown[]).length).toBeGreaterThan(0)
    }).toPass({ timeout: 10_000 })

    await gotoTestsPage(page)
    await page.getByRole('button', { name: 'New Test' }).click()

    // The isRunning blocker variant - no callout, no destructive action.
    const dialog = page.locator('[data-testid="switch-test-dialog"]')
    await expect(dialog).toBeVisible()
    await expect(dialog).toContainText('Test is Running')
    await expect(dialog).not.toContainText('will be permanently deleted')
    await expect(dialog.getByRole('button', { name: 'Go to Workbench' })).toBeVisible()
    await dialog.getByRole('button', { name: 'Cancel' }).click()
    await expect(dialog).toHaveCount(0)

    // Drain the held run so the next spec starts from a settled backend.
    await expect(async () => {
      const resp = await page.request.get(`${BACKEND_URL}/workbench/session`)
      const data = (await resp.json()).data as { status?: string } | null
      expect(data?.status ?? 'gone').toMatch(/^(passed|failed|stopped|gone)$/)
    }).toPass({ timeout: 30_000 })
  })
})
