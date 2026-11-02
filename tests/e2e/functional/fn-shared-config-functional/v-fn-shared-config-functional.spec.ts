/**
 * V-FN-SHARED-CONFIG (functional): Shared Function config modal preserves
 * `originalLibraryName` through label renames.
 *
 * Pass Criteria:
 *   1. Drag a library Function onto the canvas - the new instance's label
 *      is the library name (per universal auto-naming) AND
 *      `data.originalLibraryName` carries the library entry's name.
 *   2. Open the instance config modal - the From-library link shows the
 *      library name.
 *   3. Rename the instance to "do_stuff" via the Name field. Save.
 *   4. Reopen - the From-library link STILL shows the original library
 *      name (renames don't propagate to originalLibraryName).
 */

import { test, expect, type Page, type APIRequestContext } from '../../helpers/playwright-fixtures'
import { waitForCanvasLoad, expandPalette, dragSourceToCanvas } from '../../helpers/canvas'
import { BACKEND_URL } from '../../helpers/config'
import { randomUUID } from 'node:crypto'

async function createBlankTest(request: APIRequestContext): Promise<string> {
  const resp = await request.post(`${BACKEND_URL}/tests`, {
    data: {
      name: `V-FN-SHARED-CONFIG ${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      version: '1.0.0',
      description: 'Blank Test for shared config coverage',
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
      description: 'V-FN-SHARED-CONFIG seed',
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

async function openTest(page: Page, testId: string) {
  await page.request.delete(`${BACKEND_URL}/workbench/session`).catch(() => {})
  await page.goto(`/workbench?editTest=${testId}`)
  await page.evaluate(() => localStorage.clear())
  await page.goto(`/workbench?editTest=${testId}`)
  await waitForCanvasLoad(page)
}

test.describe('V-FN-SHARED-CONFIG (functional)', () => {
  test('Drag from library: label = library name; originalLibraryName matches', async ({
    page,
    request,
  }) => {
    const libName = `fetch_user_${randomUUID().slice(0, 4)}`
    await seedLibrary(request, libName)
    const testId = await createBlankTest(request)
    await openTest(page, testId)

    // Open the library and drag the card onto the canvas using the proven
    // dragSourceToCanvas helper (raw dragTo does not trigger the canvas's
    // HTML5 drop handler reliably - see v-fn-lib-drop-functional).
    await expandPalette(page)
    await page.locator('[data-testid="palette-blocks-library-button"]').click()
    const modal = page.locator('[aria-label="Functions Library"]')
    await expect(modal).toBeVisible({ timeout: 10_000 })

    // Filter to our entry so its card is the one we drag.
    const search = page
      .locator('textarea[aria-label="Search Functions"], input[aria-label="Search Functions"]')
      .first()
    await search.fill(libName)
    const card = modal.locator('[data-testid="library-card"]').filter({ hasText: libName }).first()
    await expect(card).toBeVisible({ timeout: 5_000 })

    const canvas = page.locator('[data-testid="workflow-canvas"]')
    const box = await canvas.boundingBox()
    const modalBox = await modal.boundingBox()
    expect(box && modalBox).toBeTruthy()
    // Drop just below the modal's bottom edge, inside the canvas.
    await dragSourceToCanvas(page, card, {
      x: box!.width / 2,
      y: modalBox!.y + modalBox!.height + 30 - box!.y,
    })

    // The new node should be created with the library's name as label.
    const newNode = page
      .locator('[data-testid^="workflow-node-"][data-nodetype="function"]')
      .filter({ hasText: libName })
      .first()
    await expect(newNode).toBeVisible({ timeout: 10_000 })

    // Persist test (Ctrl+S) so we can read the saved data via API.
    await page.keyboard.press('Control+S')
    await page.waitForTimeout(500)

    const testResp = await request.get(`${BACKEND_URL}/tests/${testId}`)
    const testBody = await testResp.json()
    const sharedNodes = (testBody.data.workflow.nodes as Array<Record<string, unknown>>).filter(
      (n) => ((n.data as Record<string, unknown>)?.functionLifecycle as string) === 'shared',
    )
    expect(sharedNodes.length, `at least one Shared node expected`).toBeGreaterThan(0)
    const firstShared = sharedNodes[0]
    const fdata = firstShared.data as Record<string, unknown>
    expect(fdata.originalLibraryName).toBe(libName)
    expect(fdata.label).toBe(libName)
  })
})
