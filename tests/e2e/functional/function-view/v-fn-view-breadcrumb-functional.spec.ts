/**
 * V-FN-VIEW-BREADCRUMB: the library View breadcrumb and back arrow go up one Function level
 * Design Decisions: FN-BC-3, FN-BC-4, VIEW-2
 * REQ: REQ-3.1.1.4
 *
 * Pass Criteria:
 * 1. Drilled into an inner Function inside the View, clicking the root Function segment shows the
 *    outer body again, drops the inner segment, and keeps the page on the View.
 * 2. Drilled into the inner Function, the back arrow shows the outer body again, drops the inner
 *    segment, and keeps the page on the View (it leaves the View only from the root level).
 * 3. Both hold with and without edit mode; in edit mode the outer draft stays in edit mode.
 *
 * Phase: functional-workflow. Self-seeds two published Functions via REST (no Test).
 */

import { test, expect, type Page, type APIRequestContext } from '../../helpers/playwright-fixtures'
import {
  publishLibraryFunction,
  openFunctionView,
  releaseWorkbenchOwnership,
  logNode,
  sharedNode,
  startEdge,
  type SeededLibraryFunction,
} from '../../helpers/fn-seed'
import { digIn, popToBreadcrumbSegment, breadcrumbFunctionSegments } from '../../helpers/workbench'
import { randomUUID } from 'node:crypto'

interface SeededPair {
  outer: SeededLibraryFunction
  inner: SeededLibraryFunction
}

/** An inner Function with one Log, and an outer Function whose body is a Log plus a Function Block calling the inner. */
async function seedPair(request: APIRequestContext): Promise<SeededPair> {
  const suffix = randomUUID().slice(0, 6)
  const inner = await publishLibraryFunction(request, {
    name: `BC-Inner-${suffix}`,
    workflow: {
      nodes: [logNode('inner-log', 'Inner Log', "'inner-line'", { x: 200, y: 200 })],
      edges: [startEdge('inner-log')],
    },
  })
  const outer = await publishLibraryFunction(request, {
    name: `BC-Outer-${suffix}`,
    workflow: {
      nodes: [
        logNode('outer-log', 'Outer Log', "'outer-line'", { x: 200, y: 160 }),
        sharedNode('inner-call', {
          functionId: inner.functionId,
          functionVersion: inner.version,
          label: inner.name,
          position: { x: 200, y: 320 },
        }),
      ],
      edges: [startEdge('outer-log'), { id: 'e-ol-ic', source: 'outer-log', target: 'inner-call' }],
    },
  })
  return { outer, inner }
}

const node = (page: Page, id: string) => page.locator(`[data-testid="workflow-node-${id}"]`)
const publishButton = (page: Page) => page.locator('[data-testid="action-bar-publish-button"]')

/** Open the outer Function in the View (optionally in edit mode) and drill into the inner Function Block. */
async function openAndDrill(page: Page, request: APIRequestContext, pair: SeededPair, editMode: boolean): Promise<void> {
  await releaseWorkbenchOwnership(request)
  await openFunctionView(page, pair.outer.functionId, pair.outer.version)
  await expect(node(page, 'outer-log')).toBeVisible({ timeout: 10_000 })
  if (editMode) {
    await page.locator('[data-testid="action-bar-edit-function-button"]').click()
    await expect(publishButton(page)).toBeVisible({ timeout: 15_000 })
  }
  await digIn(page, 'inner-call')
  await expect(node(page, 'inner-log')).toBeVisible({ timeout: 10_000 })
  await expect(node(page, 'outer-log')).toHaveCount(0)
  await expect(breadcrumbFunctionSegments(page)).toHaveCount(2)
}

/** The page is still the View of the outer Function, showing the outer body with only the outer segment. */
async function expectOuterBodyInView(page: Page, pair: SeededPair, editMode: boolean): Promise<void> {
  await expect(page).toHaveURL(new RegExp(`/workbench\\?viewFunction=${pair.outer.functionId}`))
  await expect(breadcrumbFunctionSegments(page)).toHaveCount(1)
  await expect(page.locator('[data-testid="breadcrumb-path"]')).toHaveText(pair.outer.name)
  await expect(node(page, 'outer-log')).toBeVisible()
  await expect(node(page, 'inner-call')).toBeVisible()
  await expect(node(page, 'inner-log')).toHaveCount(0)
  if (editMode) await expect(publishButton(page)).toBeVisible()
}

for (const editMode of [false, true]) {
  const mode = editMode ? 'edit mode' : 'read-only'

  test.describe(`V-FN-VIEW-BREADCRUMB (functional, ${mode}): one Function level up inside the View`, () => {
    test(`clicking the root Function segment shows the outer body (${mode})`, async ({ page, request }) => {
      const pair = await seedPair(request)
      await openAndDrill(page, request, pair, editMode)

      await popToBreadcrumbSegment(page, pair.outer.name)

      await expectOuterBodyInView(page, pair, editMode)
    })

    test(`the back arrow pops one level and stays in the View (${mode})`, async ({ page, request }) => {
      const pair = await seedPair(request)
      await openAndDrill(page, request, pair, editMode)

      await page.locator('[data-testid="breadcrumb-back-arrow"]').click()

      await expectOuterBodyInView(page, pair, editMode)
    })
  })
}
