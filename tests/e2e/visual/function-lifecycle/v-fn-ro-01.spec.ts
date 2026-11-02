/**
 * V-FN-RO-01: Read-only action bar chrome on drilled-into Published (FN-LC-12..14)
 *
 * Design Decisions:
 *   - FN-LC-12 (chrome lives in the action bar, NOT the breadcrumb bar)
 *   - FN-LC-14 (Edit Function button enters edit mode)
 *
 * Pass Criteria:
 *   1. The READ-ONLY pill + Edit button + bracketing splitters are HIDDEN
 *      on the Test canvas.
 *   2. The READ-ONLY pill + Edit button + bracketing splitters are HIDDEN
 *      when drilled into a Local Function.
 *   3. The READ-ONLY pill + Edit button + bracketing splitters are SHOWN
 *      when drilled into a Published Function.
 *   4. Edit button has aria-label `Edit Function` and is not disabled.
 *   5. Edit Function click enters edit mode; the chrome morphs in
 *      place and the click must not crash or navigate.
 *   6. Two bracketing splitters render (one on each side of the chrome).
 *
 * Phase: fixture - seeds a library Function via POST /functions and a Test
 * that references it via POST /tests.
 */

import { test, expect, type Page } from '../../helpers/playwright-fixtures'
import { waitForCanvasLoad } from '../../helpers/canvas'
import { BACKEND_URL } from '../../helpers/config'
import { randomUUID } from 'node:crypto'

const FN_SHARED = 'fn-shared-ro'
const FN_LOCAL = 'fn-local-ro'

async function seedLibrary(page: Page): Promise<string> {
  const resp = await page.request.post(`${BACKEND_URL}/functions`, {
    data: {
      // Library Function names cap at 32 chars (FN-LC-1).
      name: `RO ${randomUUID().slice(0, 8)}`,
      description: 'Library entry inspected by V-FN-RO-01.',
      tags: [],
      // Optional input: a pinned (functionVersion) shared instance with an
      // unbound REQUIRED input fails save-validation; this chrome test does not
      // exercise input binding, so keep it optional.
      inputs: [{ name: 'msg', type: 'string', required: false, default: '', description: '' }],
      outputs: [{ name: 'out', type: 'string', description: '' }],
      dependencies: { functions: [], plugins: [] },
      workflow: { nodes: [], edges: [] },
      metadata: {},
    },
  })
  const body = await resp.json().catch(() => null)
  expect(
    resp.ok(),
    `POST /functions failed: ${resp.status()} ${JSON.stringify(body)}`,
  ).toBeTruthy()
  return body!.data.id
}

async function seedHostTest(page: Page, functionId: string): Promise<string> {
  const resp = await page.request.post(`${BACKEND_URL}/tests`, {
    data: {
      name: `V-FN-RO-01 ${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      version: '1.0.0',
      description: 'V-FN-RO-01 host: one shared ref + one local Function.',
      workflow: {
        nodes: [
          {
            id: FN_SHARED,
            type: 'workflowNode',
            position: { x: 250, y: 200 },
            data: {
              label: 'SharedFn',
              elementType: 'function',
              nodeType: 'function',
              functionLifecycle: 'shared',
              functionId,
              // Client-side Edit needs the pinned version on the node (a real
              // published instance always carries it).
              functionVersion: '1.0.0',
              category: 'function',
              version: '1.0.0',
              hasNewerVersion: false,
              expressionFields: [],
              templateFields: [],
              variableExpressionKeys: [],
            },
            measured: { width: 120, height: 62 },
          },
          {
            id: FN_LOCAL,
            type: 'workflowNode',
            position: { x: 500, y: 200 },
            data: {
              label: 'LocalFn',
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
                name: 'LocalFn',
                description: '',
                workflow: { nodes: [], edges: [] },
                inputs: [],
                outputs: [],
                variables: [],
              },
            },
            measured: { width: 120, height: 62 },
          },
        ],
        edges: [],
      },
      variables: {},
      metadata: {},
    },
  })
  expect(resp.ok(), `POST /tests failed: ${resp.status()}`).toBeTruthy()
  return (await resp.json()).data.id
}

async function openWorkbench(page: Page, testId: string) {
  await page.request.delete(`${BACKEND_URL}/workbench/session`).catch(() => {})
  await page.goto(`/workbench?editTest=${testId}`)
  await page.evaluate(() => localStorage.clear())
  await page.goto(`/workbench?editTest=${testId}`)
  await waitForCanvasLoad(page)
}

async function drillIntoSharedViaKebab(page: Page) {
  const node = page.locator(`[data-testid="workflow-node-${FN_SHARED}"]`)
  await expect(node).toBeVisible()
  await node.locator('button').first().dispatchEvent('click')
  await node.locator('[data-testid="node-kebab"]').click()
  const menu = page.locator('[role="menu"]')
  await menu.getByRole('menuitem', { name: 'Open' }).click()
  // After the kebab Open fires, the action bar should reveal the read-only
  // chrome. Wait for the pill as the open signal.
  await expect(page.getByLabel('Read-only inspect mode')).toBeVisible({ timeout: 10_000 })
}

async function drillIntoLocalViaKebab(page: Page) {
  const node = page.locator(`[data-testid="workflow-node-${FN_LOCAL}"]`)
  await expect(node).toBeVisible()
  await node.locator('button').first().dispatchEvent('click')
  await node.locator('[data-testid="node-kebab"]').click()
  const menu = page.locator('[role="menu"]')
  await menu.getByRole('menuitem', { name: 'Open' }).click()
  // The breadcrumb should now show the LocalFn segment (drilled).
  await expect(page.locator('[data-testid="canvas-breadcrumb"]')).toContainText('LocalFn', {
    timeout: 10_000,
  })
}

test.describe('V-FN-RO-01: Read-only action bar chrome', () => {
  test('S1: chrome is HIDDEN at the Test canvas', async ({ page }) => {
    const functionId = await seedLibrary(page)
    const testId = await seedHostTest(page, functionId)
    await openWorkbench(page, testId)

    await expect(page.getByLabel('Read-only inspect mode')).toHaveCount(0)
    await expect(page.getByLabel('Edit Function')).toHaveCount(0)
  })

  test('S2: chrome is HIDDEN when drilled into a Local Function', async ({ page }) => {
    const functionId = await seedLibrary(page)
    const testId = await seedHostTest(page, functionId)
    await openWorkbench(page, testId)

    await drillIntoLocalViaKebab(page)

    await expect(page.getByLabel('Read-only inspect mode')).toHaveCount(0)
    await expect(page.getByLabel('Edit Function')).toHaveCount(0)
  })

  test('S3: chrome is SHOWN when drilled into a Published Function', async ({ page }) => {
    const functionId = await seedLibrary(page)
    const testId = await seedHostTest(page, functionId)
    await openWorkbench(page, testId)

    await drillIntoSharedViaKebab(page)

    await expect(page.getByLabel('Read-only inspect mode')).toBeVisible()
    const editBtn = page.getByLabel('Edit Function')
    await expect(editBtn).toBeVisible()
    await expect(editBtn).toBeEnabled()

    // (6) Two bracketing splitters render.
    const splitters = page.locator('[data-testid="action-bar-readonly-splitter"]')
    await expect(splitters).toHaveCount(2)
  })

  test('S4: Edit Function click enters edit mode', async ({ page }) => {
    const functionId = await seedLibrary(page)
    const testId = await seedHostTest(page, functionId)
    await openWorkbench(page, testId)

    await drillIntoSharedViaKebab(page)
    const editBtn = page.getByLabel('Edit Function')
    const urlBefore = page.url()
    await editBtn.click()
    // The chrome morphs in place from read-only to the edit-mode variant
    // (no navigation).
    await expect(page.getByLabel('Edit-mode inspect')).toBeVisible()
    await expect(page.getByLabel('Drop changes')).toBeVisible()
    expect(page.url()).toBe(urlBefore)
  })
})
