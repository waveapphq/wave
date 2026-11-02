/**
 * V-FN-VERSION-PIN (functional): two instances of the same library Function
 * pinned to DIFFERENT versions execute their respective version bodies.
 *
 * REQ: REQ-3.1.2.2 (Per-instance version pinning).
 *
 * Pass Criteria:
 *   1. Library has TWO versions of one Function: v1.0.0 (body emits
 *      "v1-line") and v2.0.0 (body emits "v2-line").
 *   2. Test seeds TWO instances of that Function: one pinned to v1.0.0,
 *      one pinned to v2.0.0.
 *   3. Running the Test produces BOTH log lines (one from each instance);
 *      both Function blocks end with execution-status passed.
 *   4. Switching the pin on one instance via the Version dropdown in the
 *      config modal updates `functionVersion` in the saved Test data.
 */

import { test, expect, type Page, type APIRequestContext } from '../../helpers/playwright-fixtures'
import { configSheet } from '../../helpers/workbench'
import { waitForCanvasLoad } from '../../helpers/canvas'
import { getLogEntries } from '../../helpers/log-reader'
import { BACKEND_URL, E2E_ENV_NAME, ensureEnvironment } from '../../helpers/config'
import { randomUUID } from 'node:crypto'

const FN_NODE_V1_ID = 'fn-pin-v1'
const FN_NODE_V2_ID = 'fn-pin-v2'

interface SeededFunction {
  functionId: string
  name: string
}

async function seedLibraryWithTwoVersions(request: APIRequestContext): Promise<SeededFunction> {
  const name = `PinFn ${randomUUID().slice(0, 6)}`
  // v1.0.0 body
  const v1Resp = await request.post(`${BACKEND_URL}/functions`, {
    data: {
      name,
      description: 'V-FN-VERSION-PIN library entry - v1.0.0 logs "v1-line"',
      tags: [],
      inputs: [],
      outputs: [],
      workflow: {
        nodes: [
          {
            id: 'inner-v1-log',
            type: 'workflowNode',
            position: { x: 200, y: 200 },
            data: {
              label: 'Log',
              elementType: 'log',
              nodeType: 'plugin',
              category: 'system',
              version: '1.0.0',
              expressionFields: ['message'],
              templateFields: [],
              variableExpressionKeys: [],
              config: {
                values: { message: "'v1-line'", level: 'INFO' },
                outputBindings: {},
                profileBindings: [],
              },
            },
          },
        ],
        edges: [{ id: 'e-start-v1', source: 'start-node', target: 'inner-v1-log' }],
      },
      version: '1.0.0',
      changelog: 'Initial release',
      details: 'V-FN-VERSION-PIN seed v1',
    },
  })
  expect(v1Resp.ok(), `POST /functions v1: ${v1Resp.status()}`).toBeTruthy()
  const v1Body = await v1Resp.json()
  const functionId = v1Body.data.id as string

  // v2.0.0 - add a second immutable library version through the
  // test-independent route (POST /functions/{id}/versions); the new body
  // (with the 'v2-line' Log) is supplied directly as the draft.
  const pubResp = await request.post(`${BACKEND_URL}/functions/${functionId}/versions`, {
    data: {
      source_version: '1.0.0',
      target_version: '2.0.0',
      draft_definition: {
        name,
        description: '',
        tags: [],
        inputs: [],
        outputs: [],
        dependencies: { functions: [], plugins: [] },
        workflow: {
          nodes: [
            {
              id: 'inner-v2-log',
              type: 'workflowNode',
              position: { x: 200, y: 200 },
              data: {
                label: 'Log',
                elementType: 'log',
                nodeType: 'plugin',
                category: 'system',
                version: '1.0.0',
                expressionFields: ['message'],
                templateFields: [],
                variableExpressionKeys: [],
                config: {
                  values: { message: "'v2-line'", level: 'INFO' },
                  outputBindings: {},
                  profileBindings: [],
                },
              },
            },
          ],
          edges: [{ id: 'e-start-v2', source: 'start-node', target: 'inner-v2-log' }],
        },
      },
      changelog: 'Major bump - new body line v2-line',
      description: '',
      tags: [],
      details: '',
    },
  })
  expect(pubResp.ok(), `publish v2: ${pubResp.status()} ${await pubResp.text()}`).toBeTruthy()

  return { functionId, name }
}

function buildTwoInstanceTest(fn: SeededFunction): Record<string, unknown> {
  return {
    name: `V-FN-VERSION-PIN ${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    version: '1.0.0',
    description: 'Two instances of the same library Function pinned to v1.0.0 and v2.0.0',
    workflow: {
      nodes: [
        {
          id: FN_NODE_V1_ID,
          type: 'workflowNode',
          position: { x: 200, y: 200 },
          data: {
            label: `${fn.name}_a`,
            elementType: 'function',
            nodeType: 'function',
            functionLifecycle: 'shared',
            functionId: fn.functionId,
            functionVersion: '1.0.0',
            originalLibraryName: fn.name,
            category: 'function',
            version: '1.0.0',
            hasNewerVersion: false,
            expressionFields: [],
            templateFields: [],
            variableExpressionKeys: [],
            config: { values: {}, outputBindings: {}, profileBindings: [] },
          },
          measured: { width: 120, height: 62 },
        },
        {
          id: FN_NODE_V2_ID,
          type: 'workflowNode',
          position: { x: 500, y: 200 },
          data: {
            label: `${fn.name}_b`,
            elementType: 'function',
            nodeType: 'function',
            functionLifecycle: 'shared',
            functionId: fn.functionId,
            functionVersion: '2.0.0',
            originalLibraryName: fn.name,
            category: 'function',
            version: '1.0.0',
            hasNewerVersion: false,
            expressionFields: [],
            templateFields: [],
            variableExpressionKeys: [],
            config: { values: {}, outputBindings: {}, profileBindings: [] },
          },
          measured: { width: 120, height: 62 },
        },
      ],
      edges: [
        { id: 'e-start-v1', source: 'start-node', target: FN_NODE_V1_ID },
        { id: 'e-v1-v2', source: FN_NODE_V1_ID, target: FN_NODE_V2_ID },
      ],
    },
    variables: {},
    metadata: {},
  }
}

async function openTest(page: Page, testId: string) {
  await page.request.delete(`${BACKEND_URL}/workbench/session`).catch(() => {})
  await page.goto(`/workbench?editTest=${testId}`)
  await page.evaluate(() => localStorage.clear())
  await page.goto(`/workbench?editTest=${testId}`)
  await waitForCanvasLoad(page)
}

async function selectEnvironment(page: Page) {
  const envSelector = page.locator('[data-testid="environment-selector"]')
  await envSelector.click()
  const envPopover = page.locator('[data-testid="environment-popover"]')
  await expect(envPopover).toBeVisible()
  await envPopover.locator(`button:has-text("${E2E_ENV_NAME}")`).first().click()
  await expect(envPopover).not.toBeVisible()
}

test.describe('V-FN-VERSION-PIN (functional): per-instance version pinning', () => {
  test('Two instances pinned to v1.0.0 and v2.0.0 each execute their own body', async ({
    page,
    request,
  }) => {
    await ensureEnvironment(request)
    const fn = await seedLibraryWithTwoVersions(request)

    const seed = buildTwoInstanceTest(fn)
    const seedResp = await request.post(`${BACKEND_URL}/tests`, { data: seed })
    const seedBody = await seedResp.json().catch(() => null)
    expect(seedBody?.success, `POST /tests: ${seedResp.status()}`).toBeTruthy()
    const testId = seedBody.data.id
    await openTest(page, testId)

    // Both nodes render on the canvas.
    await expect(page.locator(`[data-testid="workflow-node-${FN_NODE_V1_ID}"]`)).toBeVisible()
    await expect(page.locator(`[data-testid="workflow-node-${FN_NODE_V2_ID}"]`)).toBeVisible()

    // Run.
    await selectEnvironment(page)
    await page.locator('[data-testid="run-button"]').click()
    const statusIndicator = page.locator('[data-testid="workflow-status"]')
    await expect(statusIndicator).not.toHaveAttribute('data-status', 'running', { timeout: 60_000 })
    await expect(statusIndicator).toHaveAttribute('data-status', /passed|success/, { timeout: 10_000 })

    // Each instance reports its own passed status.
    await expect(page.locator(`[data-testid="workflow-node-${FN_NODE_V1_ID}"]`)).toHaveAttribute(
      'data-execution-status',
      /passed|success/,
      { timeout: 5_000 },
    )
    await expect(page.locator(`[data-testid="workflow-node-${FN_NODE_V2_ID}"]`)).toHaveAttribute(
      'data-execution-status',
      /passed|success/,
      { timeout: 5_000 },
    )

    // Both log lines surface in the console.
    const logs = await getLogEntries(page)
    const sawV1 = logs.some((l) => l.message.includes('v1-line'))
    const sawV2 = logs.some((l) => l.message.includes('v2-line'))
    expect(sawV1, `v1-line must surface; got ${JSON.stringify(logs)}`).toBe(true)
    expect(sawV2, `v2-line must surface; got ${JSON.stringify(logs)}`).toBe(true)
  })

  test('Switching the version pin via the config modal dropdown persists', async ({
    page,
    request,
  }) => {
    await ensureEnvironment(request)
    const fn = await seedLibraryWithTwoVersions(request)
    const seed = buildTwoInstanceTest(fn)
    const seedResp = await request.post(`${BACKEND_URL}/tests`, { data: seed })
    const seedBody = await seedResp.json()
    const testId = seedBody.data.id
    await openTest(page, testId)

    // Open config modal on the v1.0.0 instance and switch pin to v2.0.0.
    const node = page.locator(`[data-testid="workflow-node-${FN_NODE_V1_ID}"]`)
    await node.locator('button').first().dblclick()
    const dialog = configSheet(page)
    await expect(dialog).toBeVisible({ timeout: 10_000 })

    // Open the Version dropdown (in pick mode for Published functions).
    const trigger = dialog.locator('[data-testid="version-dropdown-trigger"]')
    await expect(trigger).toBeVisible()
    await trigger.click()
    const menu = dialog.locator('[data-testid="version-dropdown-menu"]')
    await expect(menu).toBeVisible()
    // Pick v2.0.0 row.
    await menu.getByRole('menuitemradio', { name: /2\.0\.0/ }).click()
    // Save the modal.
    await dialog.getByRole('button', { name: 'Save' }).click()
    await expect(dialog).toBeHidden({ timeout: 10_000 })

    // Save the Test (Ctrl+S).
    await page.keyboard.press('Control+S')
    // Give save a moment to land.
    await page.waitForTimeout(500)

    // BE confirms the new pin.
    const testResp = await request.get(`${BACKEND_URL}/tests/${testId}`)
    expect(testResp.ok()).toBeTruthy()
    const testBody = await testResp.json()
    const node1 = (testBody.data.workflow.nodes as Array<Record<string, unknown>>).find(
      (n) => n.id === FN_NODE_V1_ID,
    ) as { data?: Record<string, unknown> } | undefined
    expect(node1!.data?.functionVersion).toBe('2.0.0')
  })
})
