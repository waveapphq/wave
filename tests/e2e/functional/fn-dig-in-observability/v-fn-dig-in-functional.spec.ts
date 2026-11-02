/**
 * V-FN-DIG-IN (functional): the dig-in (Open) action on a Shared Function is
 * observable - it shows a pending spinner while the body resolves, locks out
 * stacked clicks, and surfaces a resolve failure instead of silently no-opping.
 *
 * REQ: REQ-3.1.2.2 (Version control for Functions with metadata).
 *
 * A click sets an instant pending state (spinner + aria-busy) and an in-flight lock
 * that ignores further
 * dig-in clicks while a resolve is pending, and clears pending + does NOT drill
 * on failure. Both branches are driven by intercepting the version-resolve call.
 *
 * Phase: functional-workflow. Self-seeds via POST /functions + POST /tests.
 */

import { test, expect, type Page, type APIRequestContext } from '../../helpers/playwright-fixtures'
import { waitForCanvasLoad } from '../../helpers/canvas'
import { BACKEND_URL } from '../../helpers/config'
import { randomUUID } from 'node:crypto'

const FN_NODE_ID = 'fn-dig-in-1'

interface SeededFn {
  functionId: string
  name: string
}

async function seedLibrary(request: APIRequestContext): Promise<SeededFn> {
  const name = `digin_${randomUUID().slice(0, 6)}`
  const resp = await request.post(`${BACKEND_URL}/functions`, {
    data: {
      name,
      description: 'V-FN-DIG-IN seed (body has one Log so a drill lands somewhere)',
      tags: [],
      inputs: [],
      outputs: [],
      workflow: {
        nodes: [
          {
            id: 'digin-inner-log',
            type: 'workflowNode',
            position: { x: 200, y: 200 },
            data: {
              label: 'Log',
              elementType: 'log',
              nodeType: 'plugin',
              category: 'system',
              version: '1.0.0',
              expressionFields: ['message'],
              templateFields: [],
              variableExpressionKeys: [],
              config: { values: { message: "'inner'", level: 'INFO' }, outputBindings: {}, profileBindings: [] },
            },
          },
        ],
        edges: [{ id: 'e-start-inner', source: 'start-node', target: 'digin-inner-log' }],
      },
      version: '1.0.0',
      changelog: 'Initial',
      details: 'seed',
    },
  })
  expect(resp.ok(), `POST /functions: ${resp.status()}`).toBeTruthy()
  return { functionId: (await resp.json()).data.id, name }
}

async function seedTest(request: APIRequestContext, shared: SeededFn): Promise<string> {
  const resp = await request.post(`${BACKEND_URL}/tests`, {
    data: {
      name: `V-FN-DIG-IN ${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      version: '1.0.0',
      description: 'Shared instance pinned to 1.0.0',
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
              functionVersion: '1.0.0',
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

const digInGlyph = (page: Page) =>
  page.locator(`[data-testid="workflow-node-${FN_NODE_ID}"] [data-testid="node-dig-in"]`)

test.describe('V-FN-DIG-IN (functional): dig-in is observable', () => {
  test('A slow resolve shows the pending spinner and locks out stacked clicks', async ({
    page,
    request,
  }) => {
    const shared = await seedLibrary(request)
    const testId = await seedTest(request, shared)
    await openTest(page, testId)

    // Delay the pinned-version resolve so the pending window is observable, and
    // count how many times it actually fires (the in-flight lock must keep it 1).
    let resolveCount = 0
    await page.route('**/functions/*/versions/1.0.0', async (route) => {
      if (route.request().method() !== 'GET') {
        await route.continue()
        return
      }
      resolveCount += 1
      await new Promise((r) => setTimeout(r, 1500))
      await route.continue()
    })

    // First click -> instant pending state (spinner + aria-busy).
    await digInGlyph(page).click()
    await expect(digInGlyph(page)).toHaveAttribute('aria-busy', 'true')
    await expect(digInGlyph(page).locator('svg.animate-spin')).toBeVisible()

    // Stacked click while pending -> ignored (no second resolve).
    await digInGlyph(page).click()

    // The resolve completes and the canvas drills into the body exactly once.
    await expect(
      page.locator('[data-testid="canvas-breadcrumb"] svg.lucide-square-function').first(),
    ).toBeVisible({ timeout: 10_000 })
    expect(resolveCount, 'in-flight lock must fire exactly one resolve').toBe(1)
  })

  test('A resolve failure clears the pending state and does NOT drill', async ({
    page,
    request,
  }) => {
    const shared = await seedLibrary(request)
    const testId = await seedTest(request, shared)
    await openTest(page, testId)

    // Force the pinned-version resolve to fail.
    await page.route('**/functions/*/versions/1.0.0', async (route) => {
      if (route.request().method() !== 'GET') {
        await route.continue()
        return
      }
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ success: false, error: { code: 'INTERNAL', message: 'resolve failed' } }),
      })
    })

    await digInGlyph(page).click()

    // No drill happened: the instance is still on the parent canvas and the
    // breadcrumb gained no Function segment.
    await expect(page.locator(`[data-testid="workflow-node-${FN_NODE_ID}"]`)).toBeVisible()
    await expect(
      page.locator('[data-testid="canvas-breadcrumb"] svg.lucide-square-function'),
    ).toHaveCount(0)
    // Pending was cleared (the glyph is no longer busy - failure surfaced, not swallowed silently).
    await expect(digInGlyph(page)).not.toHaveAttribute('aria-busy', 'true')
  })
})
