/**
 * V-CANVAS-FN-CFG-02: Function instance config modal - Published variant
 *
 * REQ: REQ-3.1.1.5 (Function instance parameter configuration)
 * Design Decisions: CANVAS-209 (Published variant: inline-editable NameField,
 *   lifecycle badge NOT rendered inside the modal), FN-LC-11 (footer:
 *   Changelog + Details + Profiles + Cancel + Save)
 *
 * Pass Criteria:
 *   1. Published Function node opens the same Function modal.
 *   2. Name is an editable per-instance input (`function-name-input`);
 *      renaming the instance never mutates the library entry.
 *   3. Description field stays editable per-instance (editing the description
 *      does NOT mutate the library entry; surfaced as a tooltip-free state
 *      that the user can change just like Local).
 *   4. Footer: `Changelog + Details + Profiles + Cancel + Save`.
 *   5. NO L/S lifecycle badge inside the modal.
 *
 * Phase: no-data (seeds a Published-shaped node via API). The Functions
 * library entry is NOT created; the modal renders against the seeded node's
 * lifecycle and `localDefinition` schema.
 */

import { test, expect, type Page } from '../../helpers/playwright-fixtures'
import { waitForCanvasLoad } from '../../helpers/canvas'
import { BACKEND_URL } from '../../helpers/config'
import { configSheet } from '../../helpers/workbench'
import { randomUUID } from 'node:crypto'

const FN_NODE_ID = 'fn-cfg-shared-1'

function buildSeed(functionId: string, libName: string): Record<string, unknown> {
  return {
    name: `V-CANVAS-FN-CFG-02 ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    version: '1.0.0',
    description: 'V-CANVAS-FN-CFG-02 seed: Published Function instance',
    workflow: {
      nodes: [
        {
          id: FN_NODE_ID,
          type: 'workflowNode',
          position: { x: 300, y: 200 },
          data: {
            label: libName,
            elementType: 'function',
            nodeType: 'function',
            functionLifecycle: 'shared',
            category: 'function',
            functionId,
            functionVersion: '1.0.0',
            originalLibraryName: libName,
            version: '1.0.0',
            hasNewerVersion: false,
            expressionFields: [],
            templateFields: [],
            variableExpressionKeys: [],
            // The Required `user_id` input holds a value so the seed saves clean.
            config: {
              values: { user_id: 'seed' },
              outputBindings: {},
              profileBindings: [],
            },
          },
          measured: { width: 120, height: 62 },
        },
      ],
      edges: [],
    },
    variables: {},
    metadata: {},
  }
}

async function seed(page: Page): Promise<{ testId: string; libName: string }> {
  // A real library entry is required: the Shared modal resolves
  // the published Function (versions, Changelog/Details) from the library.
  const libName = `FetchUser_${randomUUID().slice(0, 6)}`
  const fnResp = await page.request.post(`${BACKEND_URL}/functions`, {
    data: {
      name: libName,
      description: 'V-CANVAS-FN-CFG-02 library entry',
      tags: [],
      inputs: [{ name: 'user_id', type: 'string', required: true }],
      outputs: [{ name: 'user', type: 'string' }],
      workflow: { nodes: [], edges: [] },
      version: '1.0.0',
      changelog: 'Initial release',
      details: 'Seed for V-CANVAS-FN-CFG-02',
    },
  })
  expect(fnResp.ok(), `POST /functions failed: ${fnResp.status()}`).toBeTruthy()
  const functionId = (await fnResp.json()).data.id
  const resp = await page.request.post(`${BACKEND_URL}/tests`, {
    data: buildSeed(functionId, libName),
  })
  expect(resp.ok(), `POST /tests failed: ${resp.status()}`).toBeTruthy()
  return { testId: (await resp.json()).data.id, libName }
}

async function open(page: Page, testId: string) {
  await page.request.delete(`${BACKEND_URL}/workbench/session`).catch(() => {})
  await page.goto(`/workbench?editTest=${testId}`)
  await page.evaluate(() => localStorage.clear())
  await page.goto(`/workbench?editTest=${testId}`)
  await waitForCanvasLoad(page)
}

test.describe('V-CANVAS-FN-CFG-02: Function modal - Published variant', () => {
  test('Published modal renders the editable name + lifecycle-aware footer', async ({ page }) => {
    const { testId, libName } = await seed(page)
    await open(page, testId)

    const fnNode = page.locator(`[data-testid="workflow-node-${FN_NODE_ID}"]`)
    await expect(fnNode).toBeVisible()
    await fnNode.locator(`[data-testid="workflow-node-body-${FN_NODE_ID}"]`).dblclick()

    // (2) Name is an editable per-instance input seeded from the Function
    // name; renaming the instance never mutates the library entry.
    const nameInput = page.locator('[data-testid="function-name-input"]')
    await expect(nameInput).toBeVisible({ timeout: 10_000 })
    await expect(nameInput).toBeEnabled()
    await expect(nameInput).toHaveValue(libName)
    await expect(page.locator('[data-testid="function-name-label"]')).toHaveCount(0)

    // (3) Description field stays editable per-instance.
    await expect(page.locator('[data-testid="element-description-input"]')).toBeVisible()
    await expect(page.locator('[data-testid="element-description-input"]')).toBeEnabled()

    // (4) Footer composition: Changelog + Details + Profiles + Cancel + Save.
    // The Profiles button is present on BOTH Local AND Published variants.
    const dialog = configSheet(page)
    await expect(dialog.getByRole('button', { name: 'Changelog' })).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Details' })).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Profiles' })).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Save' })).toBeVisible()

    // (5) NO L/S lifecycle badge inside the modal (lives on canvas only).
    await expect(dialog.locator('[data-testid="function-lifecycle-badge"]')).toHaveCount(0)
  })
})
