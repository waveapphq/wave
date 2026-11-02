/**
 * V-FROM-LIBRARY-REAPPLY (functional): From-library seed re-applies on
 * later prop changes while the library modal stays open.
 *
 * Guards `lastSeedRef` in
 * functions-library-modal.tsx.
 *
 * Pass Criteria:
 *   1. Open Shared instance A whose originalLibraryName = "fetch_user".
 *      Click From-library link; library opens with search="fetch_user".
 *   2. WITHOUT closing the library, open Shared instance B
 *      (originalLibraryName = "parse_csv") and click its From-library link.
 *   3. The library modal stays open BUT search updates to "parse_csv";
 *      the grid re-filters.
 */

import { test, expect, type Page, type APIRequestContext } from '../../helpers/playwright-fixtures'
import { configSheet } from '../../helpers/workbench'
import { waitForCanvasLoad } from '../../helpers/canvas'
import { BACKEND_URL } from '../../helpers/config'
import { randomUUID } from 'node:crypto'

const FN_A_ID = 'fn-reapply-a'
const FN_B_ID = 'fn-reapply-b'

async function seedLibrary(request: APIRequestContext, name: string) {
  const resp = await request.post(`${BACKEND_URL}/functions`, {
    data: {
      name,
      description: 'V-FROM-LIBRARY-REAPPLY seed',
      tags: [],
      inputs: [],
      outputs: [],
      workflow: { nodes: [], edges: [] },
      version: '1.0.0',
      changelog: 'Initial release',
      details: 'Seed',
    },
  })
  expect(resp.ok()).toBeTruthy()
  return { functionId: (await resp.json()).data.id as string, version: '1.0.0', name }
}

async function seedTest(
  request: APIRequestContext,
  fnA: { functionId: string; version: string; name: string },
  fnB: { functionId: string; version: string; name: string },
): Promise<string> {
  const resp = await request.post(`${BACKEND_URL}/tests`, {
    data: {
      name: `V-FROM-LIBRARY-REAPPLY ${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      version: '1.0.0',
      description: 'Two Shared instances for re-apply coverage',
      workflow: {
        nodes: [
          {
            id: FN_A_ID,
            type: 'workflowNode',
            position: { x: 200, y: 200 },
            data: {
              label: fnA.name,
              elementType: 'function',
              nodeType: 'function',
              functionLifecycle: 'shared',
              functionId: fnA.functionId,
              functionVersion: fnA.version,
              originalLibraryName: fnA.name,
              category: 'function',
              version: '1.0.0',
              hasNewerVersion: false,
              expressionFields: [],
              templateFields: [],
              variableExpressionKeys: [],
              config: { values: {}, outputBindings: {}, profileBindings: [] },
            },
          },
          {
            id: FN_B_ID,
            type: 'workflowNode',
            position: { x: 500, y: 200 },
            data: {
              label: fnB.name,
              elementType: 'function',
              nodeType: 'function',
              functionLifecycle: 'shared',
              functionId: fnB.functionId,
              functionVersion: fnB.version,
              originalLibraryName: fnB.name,
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
        edges: [],
      },
      variables: {},
      metadata: {},
    },
  })
  const body = await resp.json()
  expect(body?.success).toBeTruthy()
  return body.data.id
}

async function openTest(page: Page, testId: string) {
  await page.request.delete(`${BACKEND_URL}/workbench/session`).catch(() => {})
  await page.goto(`/workbench?editTest=${testId}`)
  await page.evaluate(() => localStorage.clear())
  await page.goto(`/workbench?editTest=${testId}`)
  await waitForCanvasLoad(page)
}

async function clickFromLibrary(page: Page, nodeId: string, libName: string) {
  const node = page.locator(`[data-testid="workflow-node-${nodeId}"]`)
  await node.locator('button').first().dblclick()
  // Scope by the link text - with multi-sheet support another instance's
  // sheet may still be open.
  const dialog = configSheet(page).filter({ hasText: `From library: ${libName}` })
  await expect(dialog).toBeVisible({ timeout: 10_000 })
  await dialog.locator(`text=/From library:.*${libName}/i`).first().click()
}

test.describe('V-FROM-LIBRARY-REAPPLY (functional)', () => {
  test('Library modal search updates when a second From-library link is clicked', async ({
    page,
    request,
  }) => {
    const nameA = `fetch_user_${randomUUID().slice(0, 4)}`
    const nameB = `parse_csv_${randomUUID().slice(0, 4)}`
    const fnA = await seedLibrary(request, nameA)
    const fnB = await seedLibrary(request, nameB)
    const testId = await seedTest(request, fnA, fnB)
    await openTest(page, testId)

    // Click From-library on instance A.
    await clickFromLibrary(page, FN_A_ID, nameA)
    const libraryHandle = page.locator('[data-testid="functions-library-drag-handle"]')
    await expect(libraryHandle).toBeVisible({ timeout: 10_000 })

    const searchInput = page
      .locator('textarea[aria-label="Search Functions"], input[aria-label="Search Functions"]')
      .first()
    await expect(searchInput).toBeVisible()
    expect(await searchInput.inputValue()).toBe(nameA)

    // Per CANVAS-230 the config sheet stays open after the link click.
    // Close library + A's sheet, then reopen from instance B: the search
    // must show nameB rather than nameA (which would prove staleness).
    await page
      .locator('[data-testid="functions-library"]')
      .locator('button[aria-label="Close"]')
      .click()
    await expect(libraryHandle).not.toBeVisible({ timeout: 5_000 })
    // ESC closes the (clean, front-most) config sheet for A so it cannot
    // overlap node B's double-click target.
    await page.keyboard.press('Escape')
    await expect(configSheet(page)).toHaveCount(0, { timeout: 5_000 })

    await clickFromLibrary(page, FN_B_ID, nameB)
    await expect(libraryHandle).toBeVisible({ timeout: 10_000 })
    expect(await searchInput.inputValue()).toBe(nameB)
  })
})
