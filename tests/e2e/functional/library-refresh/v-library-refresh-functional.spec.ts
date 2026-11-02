/**
 * V-LIBRARY-REFRESH (functional): library modal re-fetches catalog on
 * publish AND on the manual Refresh button click.
 *
 * Guards `workflow-store.functionLibraryRevision` plumbing.
 *
 * Pass Criteria:
 *   1. Open the library modal in tab A. The visible grid lists the seeded
 *      Functions.
 *   2. Publish a new Function from a SECOND browser (or REST) call.
 *   3. Clicking the modal's Refresh button (data-testid
 *      `functions-library-refresh-button`) re-fetches and the new entry
 *      appears.
 */

import { test, expect, type Page, type APIRequestContext } from '../../helpers/playwright-fixtures'
import { waitForCanvasLoad } from '../../helpers/canvas'
import { BACKEND_URL } from '../../helpers/config'
import { randomUUID } from 'node:crypto'

async function createBlankTest(request: APIRequestContext): Promise<string> {
  const resp = await request.post(`${BACKEND_URL}/tests`, {
    data: {
      name: `V-LIBRARY-REFRESH ${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      version: '1.0.0',
      description: 'Blank Test for library-refresh coverage',
      workflow: { nodes: [], edges: [] },
      variables: {},
    },
  })
  expect(resp.ok()).toBeTruthy()
  return (await resp.json()).data.id
}

async function seedLibrary(request: APIRequestContext, name: string) {
  const resp = await request.post(`${BACKEND_URL}/functions`, {
    data: {
      name,
      description: 'V-LIBRARY-REFRESH seed',
      tags: [],
      inputs: [],
      outputs: [],
      workflow: { nodes: [], edges: [] },
      version: '1.0.0',
      changelog: 'Initial release',
      details: 'Seed',
    },
  })
  expect(resp.ok(), `POST /functions: ${resp.status()}`).toBeTruthy()
  return (await resp.json()).data.id as string
}

async function openTest(page: Page, testId: string) {
  await page.request.delete(`${BACKEND_URL}/workbench/session`).catch(() => {})
  await page.goto(`/workbench?editTest=${testId}`)
  await page.evaluate(() => localStorage.clear())
  await page.goto(`/workbench?editTest=${testId}`)
  await waitForCanvasLoad(page)
}

test.describe('V-LIBRARY-REFRESH (functional): library re-fetches on publish + manual', () => {
  // NOTE: the library modal fetches `per_page=100` and filters
  // CLIENT-side, and the admin reset has no "functions" category, so a
  // long-lived dev backend accumulates entries and can page a freshly-seeded
  // one out of view. In CI each container starts with an empty library so
  // this passes; locally, clear the library first if it has grown past ~100.
  test('Manual Refresh button picks up a Function created externally', async ({
    page,
    request,
  }) => {
    const initialFnName = `prev_${randomUUID().slice(0, 4)}`
    await seedLibrary(request, initialFnName)

    const testId = await createBlankTest(request)
    await openTest(page, testId)

    // Open the library modal via palette.
    const expandBtn = page.locator('[data-testid="palette-expand-button"]')
    if ((await expandBtn.count()) > 0) await expandBtn.click().catch(() => {})
    const libraryBtn = page.locator('[data-testid="palette-blocks-library-button"]')
    await libraryBtn.click()

    const libraryHandle = page.locator('[data-testid="functions-library-drag-handle"]')
    await expect(libraryHandle).toBeVisible({ timeout: 10_000 })

    // Search for the initial entry to filter the grid down to it.
    const searchInput = page
      .locator('textarea[aria-label="Search Functions"], input[aria-label="Search Functions"]')
      .first()
    await searchInput.fill(initialFnName)
    const grid = page.locator('[data-testid="functions-library-grid"]')
    await expect(grid.locator(`text=${initialFnName}`).first()).toBeVisible({ timeout: 10_000 })

    // Externally publish a NEW library entry while the modal stays open.
    const newFnName = `refresh_${randomUUID().slice(0, 4)}`
    await seedLibrary(request, newFnName)

    // Click the Refresh button; then filter to the new entry.
    await page.locator('[data-testid="functions-library-refresh-button"]').click()
    await searchInput.fill(newFnName)
    await expect(grid.locator(`text=${newFnName}`).first()).toBeVisible({ timeout: 10_000 })
  })
})
