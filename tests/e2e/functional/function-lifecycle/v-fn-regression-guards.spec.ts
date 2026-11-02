/**
 * V-FN-REGRESSION-GUARDS: Guards that don't naturally
 * belong on a specific lifecycle wireframe.
 *
 * Coverage:
 *   - POST /tests with duplicate name returns 409 (not 500) with an
 *     anchored error payload.
 *   - GET /functions/tags returns a deduped sorted array of every tag
 *     across the library.
 *   - Select-all (Ctrl+A) followed by Delete removes ALL selected nodes
 *     from the canvas, not just the React Flow wrapper-bound subset.
 *
 * Phase: functional-workflow.
 */

import { test, expect, type Page } from '../../helpers/playwright-fixtures'
import { waitForCanvasLoad, dragSourceToCanvas, expandPalette } from '../../helpers/canvas'
import { BACKEND_PORT } from '../../helpers/config'
import { randomUUID } from 'node:crypto'

const BASE = `http://localhost:${BACKEND_PORT}`

async function openWorkbench(page: Page, testId: string) {
  await page.request.delete(`${BASE}/workbench/session`).catch(() => {})
  await page.goto(`/workbench?editTest=${testId}`)
  await page.evaluate(() => localStorage.clear())
  await page.goto(`/workbench?editTest=${testId}`)
  await waitForCanvasLoad(page)
}

test.describe('V-FN-REGRESSION-GUARDS', () => {
  test('POST /tests with a duplicate name returns 409 + anchored error (regression guard)', async ({
    request,
  }) => {
    // POST /tests with a duplicate name maps to 409 with a deterministic,
    // anchored message so the FE can surface a friendly error.
    const name = `V-FN-REGRESSION dup ${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
    const seed = {
      name,
      version: '1.0.0',
      description: 'regression guard - duplicate name',
      workflow: { nodes: [], edges: [] },
      variables: {},
      metadata: {},
    }
    const first = await request.post(`${BASE}/tests`, { data: seed })
    expect(first.ok(), `first POST /tests must succeed: ${first.status()}`).toBeTruthy()

    const second = await request.post(`${BASE}/tests`, { data: seed })
    expect(second.status()).toBe(409)
    const body = await second.json().catch(() => null)
    // Envelope shape: { success: false, error: { code, message } }
    expect(body?.success).toBe(false)
    expect(body?.error?.code).toBe('CONFLICT')
    expect(body?.error?.message ?? '').toMatch(/^Test with name '.+' already exists$/)
  })

  test('GET /functions/tags returns a deduped sorted tag list (regression guard)', async ({
    request,
  }) => {
    // GET /functions/tags returns the deduped sorted list; the BE caps per_page at
    // 100, so the modal cannot collect tags from a listing.
    // Library Function names cap at 32 chars.
    const stamp = randomUUID().slice(0, 6)
    const seeds = [
      { name: `tags A ${stamp}`, tags: ['alpha', 'shared'] },
      { name: `tags B ${stamp}`, tags: ['beta', 'shared'] },
    ]
    for (const seed of seeds) {
      const resp = await request.post(`${BASE}/functions`, {
        data: {
          ...seed,
          description: '',
          inputs: [],
          outputs: [],
          dependencies: { functions: [], plugins: [] },
          workflow: { nodes: [], edges: [] },
          metadata: {},
        },
      })
      expect(resp.ok(), `POST /functions failed: ${resp.status()}`).toBeTruthy()
    }

    const tagsResp = await request.get(`${BASE}/functions/tags`)
    expect(tagsResp.ok(), `GET /functions/tags failed: ${tagsResp.status()}`).toBeTruthy()
    const body = await tagsResp.json()
    const tags = body.data as string[]

    // Each seeded tag is present exactly once.
    for (const expected of ['alpha', 'beta', 'shared']) {
      expect(tags.filter((t) => t === expected)).toHaveLength(1)
    }
    // Sorted lexicographically.
    const sorted = [...tags].sort((a, b) => a.localeCompare(b))
    expect(tags).toEqual(sorted)
  })

  test('Ctrl+A then Delete removes all selected nodes (regression guard)', async ({
    request,
    page,
  }) => {
    // Delete goes through the global workbench shortcut bag, so Ctrl+A then Delete
    // works wherever focus is.
    const seedResp = await request.post(`${BASE}/tests`, {
      data: {
        name: `V-FN-REGRESSION delete ${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        version: '1.0.0',
        description: 'regression guard - Ctrl+A + Delete',
        workflow: { nodes: [], edges: [] },
        variables: {},
        metadata: {},
      },
    })
    expect(seedResp.ok()).toBeTruthy()
    const testId = (await seedResp.json()).data.id
    await openWorkbench(page, testId)

    // Drop two local Functions on the canvas so we have something to
    // select-all + delete.
    await expandPalette(page)
    const newFnBtn = page.locator('[data-testid="palette-new-block-button"]')
    const canvas = page.locator('[data-testid="workflow-canvas"]')
    const box = await canvas.boundingBox()
    expect(box).toBeTruthy()
    await dragSourceToCanvas(page, newFnBtn, { x: box!.width * 0.3, y: box!.height * 0.4 })
    await dragSourceToCanvas(page, newFnBtn, { x: box!.width * 0.6, y: box!.height * 0.4 })

    const nodes = page.locator('[data-testid^="workflow-node-"][data-nodetype="function"]')
    await expect(nodes).toHaveCount(2)

    // Focus the canvas (not the React Flow inner wrapper), select-all,
    // then Delete.
    await canvas.click({ position: { x: 50, y: 50 } })
    const isMac = process.platform === 'darwin'
    await page.keyboard.press(`${isMac ? 'Meta' : 'Control'}+A`)
    await page.keyboard.press('Delete')

    await expect(nodes).toHaveCount(0, { timeout: 5_000 })
  })
})
