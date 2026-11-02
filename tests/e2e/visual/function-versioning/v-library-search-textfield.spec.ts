/**
 * V-LIBRARY-SEARCH-TEXTFIELD (visual): Functions Library search input is
 * a TextField (textarea-rows=1, single-line) with placeholder "Search
 * Functions...". Swap from raw shadcn Input to canonical shared
 * TextField.
 *
 * Pass Criteria:
 *   1. Open the Functions Library.
 *   2. Search input renders as a <textarea> (TextField primitive) with
 *      aria-label "Search Functions".
 *   3. Placeholder is exactly "Search Functions…".
 */

import { test, expect, type APIRequestContext } from '../../helpers/playwright-fixtures'
import { waitForCanvasLoad, expandPalette } from '../../helpers/canvas'
import { BACKEND_URL } from '../../helpers/config'

async function createBlankTest(request: APIRequestContext): Promise<string> {
  const resp = await request.post(`${BACKEND_URL}/tests`, {
    data: {
      name: `V-LIBRARY-SEARCH-TEXTFIELD ${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      version: '1.0.0',
      description: 'Blank Test',
      workflow: { nodes: [], edges: [] },
      variables: {},
    },
  })
  return (await resp.json()).data.id
}

test.describe('V-LIBRARY-SEARCH-TEXTFIELD (visual)', () => {
  test('Library search renders as TextField (textarea) with the canonical placeholder', async ({
    page,
    request,
  }) => {
    const testId = await createBlankTest(request)
    await page.request.delete(`${BACKEND_URL}/workbench/session`).catch(() => {})
    await page.goto(`/workbench?editTest=${testId}`)
    await page.evaluate(() => localStorage.clear())
    await page.goto(`/workbench?editTest=${testId}`)
    await waitForCanvasLoad(page)

    await expandPalette(page)
    await page.locator('[data-testid="palette-blocks-library-button"]').click()
    const libraryHandle = page.locator('[data-testid="functions-library-drag-handle"]')
    await expect(libraryHandle).toBeVisible({ timeout: 10_000 })

    // Search field is a textarea (TextField).
    const searchTextarea = page.locator('textarea[aria-label="Search Functions"]').first()
    await expect(searchTextarea).toBeVisible({ timeout: 5_000 })
    const tagName = await searchTextarea.evaluate((el) => (el as HTMLElement).tagName.toLowerCase())
    expect(tagName, `search field must be a <textarea>, got ${tagName}`).toBe('textarea')
    expect(await searchTextarea.getAttribute('placeholder')).toBe('Search Functions…')
  })
})
