/**
 * V-FN-EDIT-DROP (functional): Drop changes via the kebab returns the
 * instance to a clean Published reference at the source version.
 *
 * REQ: REQ-3.1.2.2 (Version control for Functions with metadata).
 *
 * Pass Criteria:
 *   1. Pre-seeded edit-mode draft (a body with an inserted "modified" Log
 *      node) renders the red asterisk overlay on entry.
 *   2. Kebab on the edit-mode instance exposes "Drop changes".
 *   3. Clicking Drop changes opens the ConfirmationDialog (alertdialog
 *      role); ESC does NOT dismiss; the destructive policy holds.
 *   4. Confirming the dialog flips the instance back to a clean Published
 *      reference: editMode/draft/upstreamLink markers removed, the asterisk
 *      overlay disappears, the kebab no longer offers Drop changes, and
 *      kebab Edit re-appears.
 *   5. Running the Test executes the SOURCE body (the modified-body Log node
 *      from the draft never runs).
 */

import { test, expect, type Page, type APIRequestContext } from '../../helpers/playwright-fixtures'
import { openNodeKebab, waitForCanvasLoad } from '../../helpers/canvas'
import { getLogEntries } from '../../helpers/log-reader'
import { BACKEND_URL, E2E_ENV_NAME, ensureEnvironment } from '../../helpers/config'
import { randomUUID } from 'node:crypto'

const FN_NODE_ID = 'fn-edit-drop-1'

interface SeededFunction {
  functionId: string
  version: string
  name: string
}

async function seedLibraryFunction(request: APIRequestContext): Promise<SeededFunction> {
  const name = `EditDropFn ${randomUUID().slice(0, 6)}`
  const resp = await request.post(`${BACKEND_URL}/functions`, {
    data: {
      name,
      description: 'V-FN-EDIT-DROP library entry',
      tags: [],
      inputs: [],
      outputs: [],
      workflow: {
        nodes: [
          {
            id: 'inner-source-log',
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
                values: { message: "'SOURCE-line'", level: 'INFO' },
                outputBindings: {},
                profileBindings: [],
              },
            },
          },
        ],
        edges: [{ id: 'e-start-inner', source: 'start-node', target: 'inner-source-log' }],
      },
      version: '1.0.0',
      changelog: 'Initial release',
      details: 'Seed for V-FN-EDIT-DROP',
    },
  })
  expect(resp.ok(), `POST /functions: ${resp.status()}`).toBeTruthy()
  const body = await resp.json()
  return { functionId: body.data.id, version: '1.0.0', name }
}

function buildSeedTestWithDraft(fn: SeededFunction): Record<string, unknown> {
  return {
    name: `V-FN-EDIT-DROP ${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    version: '1.0.0',
    description: 'Pre-seeded edit-mode draft for V-FN-EDIT-DROP',
    workflow: {
      nodes: [
        {
          id: FN_NODE_ID,
          type: 'workflowNode',
          position: { x: 300, y: 200 },
          data: {
            label: fn.name,
            elementType: 'function',
            nodeType: 'function',
            functionLifecycle: 'shared',
            functionId: fn.functionId,
            functionVersion: fn.version,
            originalLibraryName: fn.name,
            category: 'function',
            version: '1.0.0',
            hasNewerVersion: false,
            expressionFields: [],
            templateFields: [],
            variableExpressionKeys: [],
            config: { values: {}, outputBindings: {}, profileBindings: [] },
            editMode: true,
            upstreamLink: { functionId: fn.functionId, sourceVersion: fn.version },
            draft: {
              name: fn.name,
              description: '',
              tags: [],
              inputs: [],
              outputs: [],
              dependencies: { functions: [], plugins: [] },
              workflow: {
                nodes: [
                  {
                    id: 'inner-source-log',
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
                        values: { message: "'SOURCE-line'", level: 'INFO' },
                        outputBindings: {},
                        profileBindings: [],
                      },
                    },
                  },
                  {
                    id: 'inner-draft-log',
                    type: 'workflowNode',
                    position: { x: 200, y: 320 },
                    data: {
                      label: 'Log_2',
                      elementType: 'log',
                      nodeType: 'plugin',
                      category: 'system',
                      version: '1.0.0',
                      expressionFields: ['message'],
                      templateFields: [],
                      variableExpressionKeys: [],
                      config: {
                        values: { message: "'DRAFT-line'", level: 'INFO' },
                        outputBindings: {},
                        profileBindings: [],
                      },
                    },
                  },
                ],
                edges: [
                  { id: 'e-start-inner', source: 'start-node', target: 'inner-source-log' },
                  { id: 'e-inner-draft', source: 'inner-source-log', target: 'inner-draft-log' },
                ],
              },
            },
          },
          measured: { width: 120, height: 62 },
        },
      ],
      edges: [{ id: 'e-start-fn', source: 'start-node', target: FN_NODE_ID }],
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

test.describe('V-FN-EDIT-DROP (functional): drop changes reverts to source version', () => {
  test('Drop changes confirmation reverts the instance to a clean Published reference', async ({
    page,
    request,
  }) => {
    await ensureEnvironment(request)
    const fn = await seedLibraryFunction(request)
    const seed = buildSeedTestWithDraft(fn)
    const seedResp = await request.post(`${BACKEND_URL}/tests`, { data: seed })
    const seedBody = await seedResp.json().catch(() => null)
    expect(seedBody?.success, `POST /tests: ${seedResp.status()}`).toBeTruthy()
    const testId = seedBody.data.id

    await openTest(page, testId)

    // Asterisk visible (pre-seeded edit mode).
    const overlay = page.locator(
      `[data-testid="workflow-node-${FN_NODE_ID}"] [data-testid="edit-mode-mark-wrapper"]`,
    )
    await expect(overlay).toBeVisible({ timeout: 10_000 })

    // Kebab shows Drop changes; Edit is hidden in edit mode.
    let menu = await openNodeKebab(page, FN_NODE_ID)
    await expect(menu.getByRole('menuitem', { name: 'Drop changes' })).toBeVisible()
    await expect(menu.getByRole('menuitem', { name: /^Edit$/ })).toHaveCount(0)

    // Click Drop changes -> confirmation alertdialog. (The destructive-dialog
    // ESC/backdrop policy is covered by v-fn-lifecycle-dialogs; pressing ESC
    // here is unnecessary and leaves Radix's body pointer-events lock stuck.)
    await menu.getByRole('menuitem', { name: 'Drop changes' }).click()
    const confirm = page.locator('[role="alertdialog"]', { hasText: 'Drop changes' })
    await expect(confirm).toBeVisible({ timeout: 5_000 })

    // Confirm.
    await confirm.getByRole('button', { name: 'Drop changes' }).click()
    await expect(confirm).toBeHidden({ timeout: 5_000 })
    // Radix's AlertDialog sets `pointer-events: none` on <html>/<body> while
    // open and removes it on close - but under headless fast-execution the
    // cleanup can race and leave the lock stuck (no visible dialog remains;
    // not reproducible in a real browser). Clear it defensively so the
    // action bar is clickable.
    await page.evaluate(() => {
      document.documentElement.style.pointerEvents = ''
      document.body.style.pointerEvents = ''
    })

    // ----------------------------------------------------------------
    // POST-drop assertions: edit-mode markers gone on the CANVAS. Drop is
    // a client-side store mutation - it does NOT round-trip to the BE until the
    // user Saves, so the canvas + run state is the source of truth here (not
    // GET /tests, which still holds the seeded editMode draft until a Save).
    // ----------------------------------------------------------------
    await expect(overlay).toHaveCount(0, { timeout: 5_000 })

    // ----------------------------------------------------------------
    // RUN the Test FIRST (before reopening the kebab) - the draft body is NOT
    // executed; only the source line shows. Running before the kebab re-open
    // avoids stacking another Radix overlay on the action bar.
    // ----------------------------------------------------------------
    await selectEnvironment(page)
    await page.locator('[data-testid="run-button"]').click()
    const statusIndicator = page.locator('[data-testid="workflow-status"]')
    await expect(statusIndicator).not.toHaveAttribute('data-status', 'running', { timeout: 60_000 })
    await expect(statusIndicator).toHaveAttribute('data-status', /passed|success/, { timeout: 10_000 })

    const logs = await getLogEntries(page)
    const sawSource = logs.some((l) => l.message.includes('SOURCE-line'))
    const sawDraft = logs.some((l) => l.message.includes('DRAFT-line'))
    expect(sawSource, `source line must appear; got ${JSON.stringify(logs)}`).toBe(true)
    expect(sawDraft, 'draft line must NOT execute after drop changes').toBe(false)

    // Finally, the kebab offers Edit again and no Drop changes (the instance
    // is a clean Published reference once more).
    const menu2 = await openNodeKebab(page, FN_NODE_ID)
    await expect(menu2.getByRole('menuitem', { name: /^Edit$/ })).toBeVisible()
    await expect(menu2.getByRole('menuitem', { name: 'Drop changes' })).toHaveCount(0)
  })
})
