/**
 * V-RC-FUNCTIONAL (Run-Current): a dirty canvas runs its EXACT in-memory
 * body, not the last-saved backend state. One fixture
 * shape, four entry points:
 *
 *   A. Whole Test  - disable a node in-memory, Run; the disabled node's line is
 *      absent (the in-memory body ran, not the on-disk both-enabled body).
 *   B. Drilled scope - drill into a local Function, disable an inner node, Run
 *      Scope; the scoped run executes the EDITED inner body.
 *   C. In-Test edit mode - enter edit mode on a CLEAN published reference (so the
 *      on-disk node is NOT in edit mode), Run; the engine emits the edit-mode
 *      WARN, which proves run-current threaded the in-memory edit-mode state (a
 *      run by test_id of the clean on-disk ref would NOT warn).
 *   D. WARN log - a pre-seeded top-level edit-mode instance run by id emits
 *      exactly the edit-mode WARN line.
 *
 * Run-current carries no run-confirm modal: a dirty Run dispatches directly.
 *
 * REQ: REQ-3.2.1.1 (run to completion), REQ-3.2.1.2 (debug), REQ-3.1.2.2 (edit-mode WARN).
 * Phase: functional-workflow. Self-seeds via POST /tests + POST /functions.
 */

import { test, expect, type Page, type APIRequestContext } from '../../helpers/playwright-fixtures'
import {
  createValidTest,
  publishLibraryFunction,
  logNode,
  localFunctionNode,
  sharedNode,
  startEdge,
  openTest,
  type SeededLibraryFunction,
} from '../../helpers/fn-seed'
import { clickNodeKebabItem } from '../../helpers/canvas'
import { clickNodeContextMenuItem } from '../../helpers/workbench'
import { getLogEntries, getLogTexts } from '../../helpers/log-reader'
import { BACKEND_URL, E2E_ENV_NAME, ensureEnvironment } from '../../helpers/config'
import { randomUUID } from 'node:crypto'

// The edit-mode WARN line (function name interpolated at runtime).
const EDIT_MODE_WARN_RE =
  /Function '.+' is in edit mode: changes are not published and this instance is unlinked from the shared library/

async function selectEnvironment(page: Page): Promise<void> {
  await page.locator('[data-testid="environment-selector"]').click()
  const popover = page.locator('[data-testid="environment-popover"]')
  await expect(popover).toBeVisible()
  await popover.locator(`button:has-text("${E2E_ENV_NAME}")`).first().click()
  await expect(popover).not.toBeVisible()
}

/** Right-click a canvas node and toggle Disable (sets data.disabled + isDirty). */
async function disableNode(page: Page, nodeId: string): Promise<void> {
  // The shared helper retries the whole open+click: a single right-click can
  // race a canvas re-render and land before the menu mounts.
  await clickNodeContextMenuItem(page, nodeId, 'Disable')
  await expect(page.locator(`[data-testid="workflow-node-${nodeId}"]`)).toHaveAttribute(
    'data-disabled',
    'true',
  )
}

async function runToTerminal(page: Page): Promise<void> {
  // A dirty Run dispatches directly - no run-confirm modal ever appears.
  await page.locator('[data-testid="run-button"]').click()
  await expect(page.getByRole('button', { name: 'Save and Run' })).toHaveCount(0)
  const status = page.locator('[data-testid="workflow-status"]')
  await expect(status).not.toHaveAttribute('data-status', 'running', { timeout: 60_000 })
  await expect(status).toHaveAttribute('data-status', /passed|success/, { timeout: 10_000 })
}

test.describe('V-RC-FUNCTIONAL: run-current executes the in-memory body', () => {
  test('A: a dirty whole Test runs its in-memory (post-disable) body', async ({ page, request }) => {
    await ensureEnvironment(request)
    const testId = await createValidTest(request, {
      name: `V-RC-WHOLE ${randomUUID().slice(0, 8)}`,
      nodes: [
        logNode('log-keep', 'Keep', "'rc-keep'", { x: 200, y: 160 }),
        logNode('log-drop', 'Drop', "'rc-drop'", { x: 200, y: 300 }),
      ],
      edges: [startEdge('log-keep'), { id: 'e-keep-drop', source: 'log-keep', target: 'log-drop' }],
    })
    await openTest(page, testId)

    // Edit the canvas in-memory: disable log-drop (canvas becomes dirty).
    await disableNode(page, 'log-drop')

    await selectEnvironment(page)
    await runToTerminal(page)

    const logs = await getLogTexts(page)
    const all = logs.join('\n')
    expect(logs.some((m) => m.includes('rc-keep')), `rc-keep must run\n${all}`).toBe(true)
    expect(
      logs.some((m) => m.includes('rc-drop')),
      `rc-drop is disabled in-memory and must NOT run (proves run-current)\n${all}`,
    ).toBe(false)
  })

  test('B: a drilled scoped Run executes the EDITED inner body', async ({ page, request }) => {
    await ensureEnvironment(request)
    const testId = await createValidTest(request, {
      name: `V-RC-SCOPE ${randomUUID().slice(0, 8)}`,
      nodes: [
        localFunctionNode(
          'fn-outer',
          'Function_1',
          {
            nodes: [
              logNode('inner-keep', 'Keep', "'rc-scope-keep'", { x: 200, y: 160 }),
              logNode('inner-drop', 'Drop', "'rc-scope-drop'", { x: 200, y: 300 }),
            ],
            edges: [
              startEdge('inner-keep'),
              { id: 'e-ik-idd', source: 'inner-keep', target: 'inner-drop' },
            ],
          },
          { x: 320, y: 200 },
        ),
      ],
      edges: [startEdge('fn-outer')],
    })
    await openTest(page, testId)

    // Drill into the Function via the dig-in chevron, then disable an inner node.
    await page.locator('[data-testid="workflow-node-fn-outer"] [data-testid="node-dig-in"]').click()
    await expect(page.locator('[data-testid="workflow-node-inner-keep"]')).toBeVisible({ timeout: 10_000 })
    await disableNode(page, 'inner-drop')

    await selectEnvironment(page)

    // Run Scope (primary Run while drilled). It must carry scope_mode='function'
    // AND the in-memory workflow so the BE runs the EDITED scoped body.
    const runReq = page.waitForRequest(
      (r) => r.method() === 'POST' && r.url().endsWith('/workbench/run'),
    )
    await runToTerminal(page)
    const body = (await runReq).postDataJSON()
    expect(body.scope_mode, 'scoped Run dispatches scope_mode=function').toBe('function')
    expect(body.workflow, 'scoped Run carries the in-memory workflow (run-current)').toBeTruthy()

    const logs = await getLogTexts(page)
    const all = logs.join('\n')
    expect(logs.some((m) => m.includes('rc-scope-keep')), `inner keep must run\n${all}`).toBe(true)
    expect(
      logs.some((m) => m.includes('rc-scope-drop')),
      `inner drop is disabled in-memory and must NOT run (proves scoped run-current)\n${all}`,
    ).toBe(false)
  })

  test('C: entering edit mode in-memory then running emits the edit-mode WARN (run-current threaded edit state)', async ({
    page,
    request,
  }) => {
    await ensureEnvironment(request)
    const lib = await seedLibraryFn(request)
    const testId = await createValidTest(request, {
      name: `V-RC-EDIT ${randomUUID().slice(0, 8)}`,
      // CLEAN published reference on disk (NOT edit mode). A run by test_id of
      // this would NOT warn - so the WARN below proves the in-memory edit state ran.
      nodes: [sharedNode('fn-ref', { functionId: lib.functionId, functionVersion: lib.version, label: lib.name, position: { x: 320, y: 200 } })],
      edges: [startEdge('fn-ref')],
    })
    await openTest(page, testId)

    // Enter edit mode via the kebab (client-side) - the node becomes dirty.
    await clickNodeKebabItem(page, 'fn-ref', 'Edit')
    await expect(
      page.locator(`[data-testid="workflow-node-fn-ref"] [data-testid="edit-mode-mark-wrapper"]`),
    ).toBeVisible({ timeout: 10_000 })

    await selectEnvironment(page)
    await runToTerminal(page)

    const entries = await getLogEntries(page)
    expect(
      entries.some((e) => EDIT_MODE_WARN_RE.test(e.message)),
      `edit-mode WARN must surface (proves run-current sent the in-memory edit state)\n${JSON.stringify(entries)}`,
    ).toBe(true)
  })

  test('D: running a Test that contains an edit-mode Function emits the WARN', async ({
    page,
    request,
  }) => {
    await ensureEnvironment(request)
    const lib = await seedLibraryFn(request)
    // Pre-seeded TOP-LEVEL edit-mode instance: run by id (clean) still warns.
    const seed = {
      name: `V-RC-WARN ${randomUUID().slice(0, 8)}`,
      version: '1.0.0',
      description: 'Pre-seeded top-level edit-mode instance for the edit-mode WARN guard',
      workflow: {
        nodes: [
          {
            id: 'fn-warn',
            type: 'workflowNode',
            position: { x: 320, y: 200 },
            data: {
              label: lib.name,
              elementType: 'function',
              nodeType: 'function',
              functionLifecycle: 'shared',
              functionId: lib.functionId,
              functionVersion: lib.version,
              originalLibraryName: lib.name,
              category: 'function',
              version: '1.0.0',
              hasNewerVersion: false,
              expressionFields: [],
              templateFields: [],
              variableExpressionKeys: [],
              config: { values: {}, outputBindings: {}, profileBindings: [] },
              editMode: true,
              upstreamLink: { functionId: lib.functionId, sourceVersion: lib.version },
              draft: {
                name: lib.name,
                description: '',
                tags: [],
                inputs: [],
                outputs: [],
                dependencies: { functions: [], plugins: [] },
                workflow: {
                  nodes: [logNode('inner-warn', 'Body', "'rc-warn-body'", { x: 200, y: 200 })],
                  edges: [startEdge('inner-warn')],
                },
              },
            },
            measured: { width: 120, height: 62 },
          },
        ],
        edges: [startEdge('fn-warn')],
      },
      variables: {},
      metadata: {},
    }
    const resp = await request.post(`${BACKEND_URL}/tests`, { data: seed })
    const body = await resp.json().catch(() => null)
    expect(body?.success, `POST /tests: ${resp.status()} ${JSON.stringify(body)}`).toBeTruthy()
    await openTest(page, body.data.id)

    await selectEnvironment(page)
    // Clean canvas (just loaded) - run by test_id.
    await page.locator('[data-testid="run-button"]').click()
    const status = page.locator('[data-testid="workflow-status"]')
    await expect(status).not.toHaveAttribute('data-status', 'running', { timeout: 60_000 })
    await expect(status).toHaveAttribute('data-status', /passed|success/, { timeout: 10_000 })

    const entries = await getLogEntries(page)
    const warns = entries.filter((e) => EDIT_MODE_WARN_RE.test(e.message))
    expect(warns.length, `exactly one edit-mode WARN expected\n${JSON.stringify(entries)}`).toBe(1)
  })
})

/** A published library Function whose body logs a literal so the run emits output. */
function seedLibraryFn(request: APIRequestContext): Promise<SeededLibraryFunction> {
  return publishLibraryFunction(request, {
    name: `RC-Lib-${randomUUID().slice(0, 6)}`,
    workflow: {
      nodes: [logNode('lib-body', 'Body', "'rc-lib-body'", { x: 200, y: 200 })],
      edges: [startEdge('lib-body')],
    },
  })
}
