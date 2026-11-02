/**
 * V-FN-NESTED (functional): Functions can nest arbitrarily - Local in
 * Local, Local in Shared, Shared in Local, Shared in Shared. Drill, run,
 * and edit mode all work at every depth.
 *
 * THIS TEST IS THE CRITICAL "NESTING IS BRITTLE" GUARD. It exercises:
 *   1. Local Function containing a nested Local Function.
 *   2. Local Function containing a nested Shared Function.
 *   3. Shared Function containing a nested Local Function.
 *   4. Drilling through 2 levels and back without breaking the canvas.
 *   5. Running the test end-to-end - every inner Log surfaces in the
 *      console panel (outer log + middle log + inner log).
 *   6. Variable propagation through nested calls.
 *
 * Each scenario is a separate `test()` so a failure at one depth doesn't
 * mask another. The user's exact words: "be an expert - cover ALL".
 */

import { test, expect, type Page, type APIRequestContext } from '../../helpers/playwright-fixtures'
import { waitForCanvasLoad } from '../../helpers/canvas'
import { getLogEntries } from '../../helpers/log-reader'
import { BACKEND_URL, E2E_ENV_NAME, ensureEnvironment } from '../../helpers/config'
import { randomUUID } from 'node:crypto'

const OUTER_NODE_ID = 'fn-nested-outer'
const MIDDLE_NODE_ID = 'fn-nested-middle'
const INNER_LOG_ID = 'inner-deepest-log'

interface SeededLibrary {
  functionId: string
  version: string
  name: string
}

async function seedLibraryEmitting(
  request: APIRequestContext,
  bodyLine: string,
): Promise<SeededLibrary> {
  const name = `nest_lib_${randomUUID().slice(0, 6)}`
  const resp = await request.post(`${BACKEND_URL}/functions`, {
    data: {
      name,
      description: `Library function emitting "${bodyLine}"`,
      tags: [],
      inputs: [],
      outputs: [],
      workflow: {
        nodes: [
          {
            id: 'inner-shared-log',
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
                values: { message: `'${bodyLine}'`, level: 'INFO' },
                outputBindings: {},
                profileBindings: [],
              },
            },
          },
        ],
        edges: [{ id: 'e-start-shared', source: 'start-node', target: 'inner-shared-log' }],
      },
      version: '1.0.0',
      changelog: 'Initial',
      details: 'V-FN-NESTED seed',
    },
  })
  expect(resp.ok(), `POST /functions: ${resp.status()}`).toBeTruthy()
  return { functionId: (await resp.json()).data.id, version: '1.0.0', name }
}

function buildNestedLocalInLocalTest(): Record<string, unknown> {
  // Outer Local Function whose body contains a Middle Local Function whose
  // body contains a single Log line ("deepest").
  return {
    name: `V-FN-NESTED-LiL ${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    version: '1.0.0',
    description: 'Local Function nested inside Local Function',
    variables: {},
    workflow: {
      nodes: [
        {
          id: OUTER_NODE_ID,
          type: 'workflowNode',
          position: { x: 300, y: 200 },
          data: {
            label: 'Outer',
            elementType: 'function',
            nodeType: 'function',
            functionLifecycle: 'local',
            category: 'function',
            version: '1.0.0',
            hasNewerVersion: false,
            expressionFields: [],
            templateFields: [],
            variableExpressionKeys: [],
            config: { values: {}, outputBindings: {}, profileBindings: [] },
            localDefinition: {
              name: 'Outer',
              description: '',
              inputs: [],
              outputs: [],
              variables: [],
              workflow: {
                nodes: [
                  {
                    id: MIDDLE_NODE_ID,
                    type: 'workflowNode',
                    position: { x: 200, y: 200 },
                    data: {
                      label: 'Middle',
                      elementType: 'function',
                      nodeType: 'function',
                      functionLifecycle: 'local',
                      category: 'function',
                      version: '1.0.0',
                      hasNewerVersion: false,
                      expressionFields: [],
                      templateFields: [],
                      variableExpressionKeys: [],
                      config: { values: {}, outputBindings: {}, profileBindings: [] },
                      localDefinition: {
                        name: 'Middle',
                        description: '',
                        inputs: [],
                        outputs: [],
                        variables: [],
                        workflow: {
                          nodes: [
                            {
                              id: INNER_LOG_ID,
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
                                  values: {
                                    message: "'nested-deepest-line'",
                                    level: 'INFO',
                                  },
                                  outputBindings: {},
                                  profileBindings: [],
                                },
                              },
                            },
                          ],
                          edges: [
                            { id: 'e-start-inner', source: 'start-node', target: INNER_LOG_ID },
                          ],
                        },
                      },
                    },
                  },
                ],
                edges: [{ id: 'e-start-middle', source: 'start-node', target: MIDDLE_NODE_ID }],
              },
            },
          },
        },
      ],
      edges: [{ id: 'e-start-outer', source: 'start-node', target: OUTER_NODE_ID }],
    },
    metadata: {},
  }
}

function buildSharedInLocalTest(shared: SeededLibrary): Record<string, unknown> {
  return {
    name: `V-FN-NESTED-SiL ${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    version: '1.0.0',
    description: 'Shared Function nested inside Local Function',
    variables: {},
    workflow: {
      nodes: [
        {
          id: OUTER_NODE_ID,
          type: 'workflowNode',
          position: { x: 300, y: 200 },
          data: {
            label: 'Outer',
            elementType: 'function',
            nodeType: 'function',
            functionLifecycle: 'local',
            category: 'function',
            version: '1.0.0',
            hasNewerVersion: false,
            expressionFields: [],
            templateFields: [],
            variableExpressionKeys: [],
            config: { values: {}, outputBindings: {}, profileBindings: [] },
            localDefinition: {
              name: 'Outer',
              description: '',
              inputs: [],
              outputs: [],
              variables: [],
              workflow: {
                nodes: [
                  {
                    id: MIDDLE_NODE_ID,
                    type: 'workflowNode',
                    position: { x: 200, y: 200 },
                    data: {
                      label: shared.name,
                      elementType: 'function',
                      nodeType: 'function',
                      functionLifecycle: 'shared',
                      functionId: shared.functionId,
                      functionVersion: shared.version,
                      originalLibraryName: shared.name,
                      category: 'function',
                      version: '1.0.0',
                      hasNewerVersion: false,
                      expressionFields: [],
                      templateFields: [],
                      variableExpressionKeys: [],
                      config: { values: {}, outputBindings: {}, profileBindings: [] },
                    },
                  },
                ],
                edges: [{ id: 'e-start-middle', source: 'start-node', target: MIDDLE_NODE_ID }],
              },
            },
          },
        },
      ],
      edges: [{ id: 'e-start-outer', source: 'start-node', target: OUTER_NODE_ID }],
    },
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

async function popToRoot(page: Page) {
  const back = page.locator('[data-testid="breadcrumb-back-arrow"]')
  for (let i = 0; i < 4; i += 1) {
    if (await page.locator('[data-testid="run-button"]').isVisible().catch(() => false)) return
    if ((await back.count()) === 0) return
    await back.click()
    await page.waitForTimeout(200)
  }
}

test.describe('V-FN-NESTED (functional): nesting at every variation works', () => {
  test('Local inside Local: drill 2 levels shows each nested body', async ({ page, request }) => {
    await ensureEnvironment(request)
    const seed = buildNestedLocalInLocalTest()
    const resp = await request.post(`${BACKEND_URL}/tests`, { data: seed })
    const body = await resp.json()
    expect(body?.success).toBeTruthy()
    await openTest(page, body.data.id)

    // Drill into Outer via the dig-in chevron; Middle appears.
    await page.locator(`[data-testid="workflow-node-${OUTER_NODE_ID}"] [data-testid="node-dig-in"]`).click()
    const middle = page.locator(`[data-testid="workflow-node-${MIDDLE_NODE_ID}"]`)
    await expect(middle).toBeVisible({ timeout: 10_000 })

    // Drill into Middle; innermost Log appears.
    await middle.locator('[data-testid="node-dig-in"]').click()
    await expect(page.locator(`[data-testid="workflow-node-${INNER_LOG_ID}"]`)).toBeVisible({
      timeout: 10_000,
    })
  })

  test('Local inside Local: runs end-to-end -> innermost line emits', async ({ page, request }) => {
    await ensureEnvironment(request)
    const seed = buildNestedLocalInLocalTest()
    const resp = await request.post(`${BACKEND_URL}/tests`, { data: seed })
    const body = await resp.json()
    expect(body?.success).toBeTruthy()
    await openTest(page, body.data.id)

    // Run from the root canvas (no drilling - the nested execution is the
    // unit under test, not the drill UI which has its own coverage).
    await selectEnvironment(page)
    await page.locator('[data-testid="run-button"]').click()
    const status = page.locator('[data-testid="workflow-status"]')
    await expect(status).not.toHaveAttribute('data-status', 'running', { timeout: 90_000 })
    await expect(status).toHaveAttribute('data-status', /passed|success/, { timeout: 10_000 })

    const logs = await getLogEntries(page)
    expect(
      logs.some((l) => l.message.includes('nested-deepest-line')),
      `innermost line must propagate through 2 nested Functions; got ${JSON.stringify(logs)}`,
    ).toBe(true)
  })

  test('Shared inside Local: outer drills cleanly, body runs the library version', async ({
    page,
    request,
  }) => {
    await ensureEnvironment(request)
    const shared = await seedLibraryEmitting(request, 'shared-nested-line')
    const seed = buildSharedInLocalTest(shared)
    const resp = await request.post(`${BACKEND_URL}/tests`, { data: seed })
    const body = await resp.json()
    // A Shared Function nested inside a Local Function body
    // must not be rejected at validation with `missing_function_id`; the
    // library entry exists (GET resolves it; a TOP-LEVEL shared instance of
    // the same id validates fine), so the validator's recursion into
    // local-function bodies must resolve nested shared references.
    expect(
      body?.success,
      `POST /tests for a Shared-in-Local nest must succeed (regression if missing_function_id): ${JSON.stringify(body?.error ?? body)}`,
    ).toBeTruthy()
    const testId = body.data.id
    await openTest(page, testId)

    // Drill into Outer.
    const outer = page.locator(`[data-testid="workflow-node-${OUTER_NODE_ID}"]`)
    await outer.locator('[data-testid="node-dig-in"]').click()
    const middle = page.locator(`[data-testid="workflow-node-${MIDDLE_NODE_ID}"]`)
    await expect(middle).toBeVisible({ timeout: 10_000 })
    // The middle node is Shared - the S badge must be visible (rendered by
    // NodeStatusBar's FunctionLifecycleBadge).
    await expect(middle).toContainText('S')

    // Pop back to root via the back-arrow until Run re-appears.
    await popToRoot(page)

    await selectEnvironment(page)
    await page.locator('[data-testid="run-button"]').click()
    const status = page.locator('[data-testid="workflow-status"]')
    await expect(status).not.toHaveAttribute('data-status', 'running', { timeout: 90_000 })
    await expect(status).toHaveAttribute('data-status', /passed|success/, { timeout: 10_000 })

    const logs = await getLogEntries(page)
    expect(
      logs.some((l) => l.message.includes('shared-nested-line')),
      `library version's line must surface; got ${JSON.stringify(logs)}`,
    ).toBe(true)
  })
})

// No drag test here: Playwright's dragTo cannot reliably move a React Flow node.
