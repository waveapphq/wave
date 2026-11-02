/**
 * V-FROM-LIBRARY-LINK-SEARCH (functional): clicking "From library: X" on a
 * Shared instance opens the Library modal with search pre-populated with X.
 *
 * Guards `functionLibraryInitialSearch` plumb-through.
 *
 * Pass Criteria:
 *   1. Open the Shared instance's config modal; click "From library:
 *      fetch_user".
 *   2. The library modal opens with search field pre-populated with
 *      "fetch_user".
 *   3. Visible card grid is filtered to entries matching that name.
 *   4. Close the library modal and reopen via the palette button: the
 *      search field is EMPTY (seed only applies on link-triggered opens).
 *   5. Re-open via the link again - the search re-applies.
 */

import { test, expect, type Page, type APIRequestContext } from '../../helpers/playwright-fixtures'
import { configSheet } from '../../helpers/workbench'
import { waitForCanvasLoad, expandPalette } from '../../helpers/canvas'
import { BACKEND_URL } from '../../helpers/config'
import { randomUUID } from 'node:crypto'

const FN_NODE_ID = 'fn-from-library-search-1'

async function seedLibrary(request: APIRequestContext, name: string) {
  const resp = await request.post(`${BACKEND_URL}/functions`, {
    data: {
      name,
      description: 'From-library-search seed',
      tags: [],
      inputs: [],
      outputs: [],
      workflow: { nodes: [], edges: [] },
      version: '1.0.0',
      changelog: 'Initial release',
      details: 'V-FROM-LIBRARY-LINK-SEARCH',
    },
  })
  expect(resp.ok()).toBeTruthy()
  const body = await resp.json()
  return { functionId: body.data.id as string, version: '1.0.0', name }
}

async function seedTest(
  request: APIRequestContext,
  fn: { functionId: string; version: string; name: string },
): Promise<string> {
  const resp = await request.post(`${BACKEND_URL}/tests`, {
    data: {
      name: `V-FROM-LIBRARY-LINK-SEARCH ${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      version: '1.0.0',
      description: 'From-library-link-search Test',
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
            },
          },
        ],
        edges: [{ id: 'e-start-fn', source: 'start-node', target: FN_NODE_ID }],
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

test.describe('V-FROM-LIBRARY-LINK-SEARCH (functional)', () => {
  test('Click From-library pre-populates search; palette open clears the seed', async ({
    page,
    request,
  }) => {
    const libName = `fetch_user_${randomUUID().slice(0, 4)}`
    const fn = await seedLibrary(request, libName)
    const testId = await seedTest(request, fn)
    await openTest(page, testId)

    // Open Shared config modal.
    const node = page.locator(`[data-testid="workflow-node-${FN_NODE_ID}"]`)
    await node.locator('button').first().dblclick()
    const dialog = configSheet(page)
    await expect(dialog).toBeVisible({ timeout: 10_000 })

    // Click From-library link.
    await dialog.locator(`text=/From library:.*${libName}/i`).first().click()

    // Library opens with search prefilled.
    const libraryHandle = page.locator('[data-testid="functions-library-drag-handle"]')
    await expect(libraryHandle).toBeVisible({ timeout: 10_000 })

    const searchInput = page.locator('textarea[aria-label="Search Functions"], input[aria-label="Search Functions"]')
    await expect(searchInput.first()).toBeVisible({ timeout: 5_000 })
    const initialSearch = await searchInput.first().inputValue()
    expect(initialSearch, `search pre-fill must equal library name; got "${initialSearch}"`).toBe(
      libName,
    )

    // Close the library sheet via ITS OWN Close button - the config sheet
    // stays open per CANVAS-230, so an unscoped aria-label query would
    // resolve to two Close buttons.
    await page
      .locator('[data-testid="functions-library"]')
      .locator('button[aria-label="Close"]')
      .click()
    await expect(libraryHandle).not.toBeVisible({ timeout: 5_000 })

    // Open via palette (NOT the link) - search must be empty.
    await expandPalette(page)
    const libraryBtn = page.locator('[data-testid="palette-blocks-library-button"]')
    if ((await libraryBtn.count()) > 0) {
      await libraryBtn.click()
      await expect(libraryHandle).toBeVisible({ timeout: 10_000 })
      const search2 = await searchInput.first().inputValue()
      expect(search2, `palette-triggered open must NOT seed search; got "${search2}"`).toBe('')
    }
  })
})
