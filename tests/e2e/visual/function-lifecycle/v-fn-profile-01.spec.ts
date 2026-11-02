/**
 * V-FN-PROFILE-01: Profiles button on Function config modal (FN-LC-9..11)
 *
 * Design Decisions:
 *   - FN-LC-9 (Profiles on BOTH Local and Published variants, reusing the blue
 *     plugin Profiles affordance)
 *
 * Pass Criteria:
 *   1. Function config modal for a Local instance shows a Profiles button in
 *      the footer.
 *   2. Function config modal for a Published instance shows a Profiles button
 *      in the footer, plus Changelog + Details.
 *   3. Clicking Profiles opens the profile binding sheet.
 *
 * Phase: fixture - seeds one local Function and one shared Function (with a
 * library entry) so both variants can be exercised in one Test.
 */

import { test, expect, type Page } from '../../helpers/playwright-fixtures'
import { waitForCanvasLoad } from '../../helpers/canvas'
import { BACKEND_URL } from '../../helpers/config'
import { configSheet } from '../../helpers/workbench'
import { randomUUID } from 'node:crypto'

const FN_LOCAL = 'fn-local-prof'
const FN_SHARED = 'fn-shared-prof'

async function seedLibrary(page: Page): Promise<string> {
  const resp = await page.request.post(`${BACKEND_URL}/functions`, {
    data: {
      // Library Function names cap at 32 chars (FN-LC-1).
      name: `PROFILE ${randomUUID().slice(0, 8)}`,
      description: 'Library entry used by V-FN-PROFILE-01.',
      tags: [],
      inputs: [],
      outputs: [],
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

async function seedTest(page: Page, functionId: string): Promise<string> {
  const resp = await page.request.post(`${BACKEND_URL}/tests`, {
    data: {
      name: `V-FN-PROFILE-01 ${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      version: '1.0.0',
      description: 'V-FN-PROFILE-01 host with one local + one shared Function.',
      workflow: {
        nodes: [
          {
            id: FN_LOCAL,
            type: 'workflowNode',
            position: { x: 250, y: 200 },
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
          {
            id: FN_SHARED,
            type: 'workflowNode',
            position: { x: 500, y: 200 },
            data: {
              label: 'SharedFn',
              elementType: 'function',
              nodeType: 'function',
              functionLifecycle: 'shared',
              functionId,
              category: 'function',
              version: '1.0.0',
              hasNewerVersion: false,
              expressionFields: [],
              templateFields: [],
              variableExpressionKeys: [],
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

async function openConfigModal(page: Page, nodeId: string) {
  const node = page.locator(`[data-testid="workflow-node-${nodeId}"]`)
  await expect(node).toBeVisible()
  await node.locator(`[data-testid="workflow-node-body-${nodeId}"]`).dblclick()
  const dialog = configSheet(page)
  await expect(dialog).toBeVisible({ timeout: 10_000 })
  return dialog
}

test.describe('V-FN-PROFILE-01: Profiles button on Function config modal', () => {
  test('S1: Local variant footer contains Profiles + Cancel + Save', async ({ page }) => {
    const functionId = await seedLibrary(page)
    const testId = await seedTest(page, functionId)
    await openWorkbench(page, testId)

    const dialog = await openConfigModal(page, FN_LOCAL)
    await expect(dialog.getByRole('button', { name: 'Profiles' })).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Save' })).toBeVisible()
    // Changelog / Details remain Published-only.
    await expect(dialog.getByRole('button', { name: 'Changelog' })).toHaveCount(0)
    await expect(dialog.getByRole('button', { name: 'Details' })).toHaveCount(0)
  })

  test('S2: Published variant footer contains Changelog + Details + Profiles + Cancel + Save', async ({
    page,
  }) => {
    const functionId = await seedLibrary(page)
    const testId = await seedTest(page, functionId)
    await openWorkbench(page, testId)

    const dialog = await openConfigModal(page, FN_SHARED)
    await expect(dialog.getByRole('button', { name: 'Changelog' })).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Details' })).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Profiles' })).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Save' })).toBeVisible()
  })

  test('S3: clicking Profiles opens the profile binding sheet', async ({ page }) => {
    const functionId = await seedLibrary(page)
    const testId = await seedTest(page, functionId)
    await openWorkbench(page, testId)

    const dialog = await openConfigModal(page, FN_LOCAL)
    await dialog.getByRole('button', { name: 'Profiles' }).click()
    const bindingSheet = page.locator('[data-testid="profile-binding-sheet"]')
    await expect(bindingSheet).toBeVisible({ timeout: 10_000 })
  })
})
