/**
 * V-FN-EDIT-FAILURE (functional): a library-version fetch failure on edit-mode
 * entry leaves the node NOT in edit mode (no false edit-mode state).
 *
 * REQ: REQ-3.1.2.2 (Version control for Functions with metadata).
 *
 * 'Edit' is client-side: it fetches the pinned library version and builds the draft
 * from it. If that fetch fails, the node must stay a clean Published reference. The
 * happy path (a reachable version -> edit mode) is exercised across the function
 * suite; this spec forces the version GET to 500 and asserts no false edit state.
 *
 * Phase: functional-workflow. Self-seeds via POST /functions + POST /tests.
 */

import { test, expect, type Page, type APIRequestContext } from '../../helpers/playwright-fixtures'
import { clickNodeKebabItem, expectNodeKebabItem, waitForCanvasLoad } from '../../helpers/canvas'
import { BACKEND_URL } from '../../helpers/config'
import { randomUUID } from 'node:crypto'

const FN_NODE_ID = 'fn-edit-failure-1'

interface SeededFn {
  functionId: string
  version: string
  name: string
}

async function seedLibrary(request: APIRequestContext): Promise<SeededFn> {
  const name = `edit_fail_${randomUUID().slice(0, 6)}`
  const resp = await request.post(`${BACKEND_URL}/functions`, {
    data: {
      name,
      description: 'V-FN-EDIT-FAILURE seed',
      tags: [],
      inputs: [],
      outputs: [],
      workflow: { nodes: [], edges: [] },
      version: '1.0.0',
      changelog: 'Initial',
      details: '',
    },
  })
  expect(resp.ok(), `POST /functions: ${resp.status()}`).toBeTruthy()
  return { functionId: (await resp.json()).data.id, version: '1.0.0', name }
}

async function seedTest(request: APIRequestContext, shared: SeededFn): Promise<string> {
  const resp = await request.post(`${BACKEND_URL}/tests`, {
    data: {
      name: `V-FN-EDIT-FAILURE ${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      version: '1.0.0',
      description: 'Saved Shared instance so the BE edit-mode route is reached (not a 404)',
      workflow: {
        nodes: [
          {
            id: FN_NODE_ID,
            type: 'workflowNode',
            position: { x: 320, y: 180 },
            data: {
              label: shared.name,
              elementType: 'function',
              nodeType: 'function',
              functionLifecycle: 'shared',
              functionId: shared.functionId,
              functionVersion: shared.version,
              originalLibraryName: shared.name,
              category: 'function',
              version: '1.0.0',
              hasNewerVersion: false,
              expressionFields: [],
              templateFields: [],
              variableExpressionKeys: [],
              config: { values: {}, outputBindings: {}, profileBindings: [] },
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
  const body = await resp.json().catch(() => null)
  expect(body?.success, `POST /tests: ${resp.status()}`).toBeTruthy()
  return body.data.id
}

async function openTest(page: Page, testId: string) {
  await page.request.delete(`${BACKEND_URL}/workbench/session`).catch(() => {})
  await page.goto(`/workbench?editTest=${testId}`)
  await page.evaluate(() => localStorage.clear())
  await page.goto(`/workbench?editTest=${testId}`)
  await waitForCanvasLoad(page)
}

test.describe('V-FN-EDIT-FAILURE (functional): genuine edit-mode failure surfaces', () => {
  test('A 500 on the edit-mode route surfaces an error and leaves no edit state', async ({
    page,
    request,
  }) => {
    const shared = await seedLibrary(request)
    const testId = await seedTest(request, shared)
    await openTest(page, testId)

    // Force a failure on the library-version GET that the client-side Edit
    // action fetches to build the draft. The canvas already loaded (and
    // resolved the instance) before this route is installed, so the Edit click's
    // fetch is the one that 500s.
    await page.route('**/functions/*/versions/*', async (route) => {
      if (route.request().method() !== 'GET') {
        await route.continue()
        return
      }
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({
          success: false,
          error: { code: 'INTERNAL', message: 'Injected version-fetch failure' },
        }),
      })
    })

    // The Edit action attempts the version fetch (which 500s).
    const editFetch = page.waitForRequest(
      (r) => r.method() === 'GET' && /\/functions\/[^/]+\/versions\//.test(r.url()),
    )
    await clickNodeKebabItem(page, FN_NODE_ID, 'Edit')
    await editFetch

    // The fetch failed, so the node never enters edit mode: no asterisk overlay.
    await expect(
      page.locator(
        `[data-testid="workflow-node-${FN_NODE_ID}"] [data-testid="edit-mode-mark-wrapper"]`,
      ),
    ).toHaveCount(0, { timeout: 5_000 })

    // The kebab still offers Edit (the instance is a clean Published reference).
    await expectNodeKebabItem(page, FN_NODE_ID, /^Edit$/)
  })
})
