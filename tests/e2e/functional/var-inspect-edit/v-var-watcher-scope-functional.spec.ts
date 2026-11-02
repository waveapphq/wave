/**
 * V-VAR-WATCHER-SCOPE: a watcher belongs to its variable's scope, not to its name
 * REQ: REQ-3.1.3.11 (Variable watching UI panel), REQ-3.1.3.1 (Variable scoping)
 *
 * Phase: functional-workflow (no run). API seed (POST /tests): a Test variable `shared_name` holding
 * `from the test` and a Local Function `Scope_Fn` whose own local is also named `shared_name`, holding
 * `from the function`. Validated with zero errors.
 *
 * Pass Criteria:
 * 1. Watching the Test variable opens its watcher showing `from the test`; its row is marked watched.
 * 2. Drilled into the Function, the same-named local row is not marked watched and the Test
 *    variable's watcher stays open with its own value.
 * 3. Expanding the local opens a second watcher showing `from the function`; its row is marked.
 * 4. Back at the root both watchers stay open, each with its own value, and the Test row is marked.
 * 5. Closing the Test variable's watcher unmarks only the Test row: drilled again, the local row is
 *    still marked and its watcher still open.
 */

import { randomUUID } from 'node:crypto'
import { test, expect, type Locator, type Page } from '../../helpers/playwright-fixtures'
import { BACKEND_URL } from '../../helpers/config'
import { createValidTest, localFunctionNode, logNode, openTest, startEdge, validateTest } from '../../helpers/fn-seed'
import { expandVariableManager, variableRow } from '../../helpers/variable-create'
import { digIn } from '../../helpers/workbench'

const FN_ID = 'watch-scope-fn'
const FN_LABEL = 'Scope_Fn'
const NAME = 'shared_name'
const TEST_VALUE = 'from the test'
const LOCAL_VALUE = 'from the function'
const WATCHED = /text-indigo-400/

function expandButton(page: Page): Locator {
  return variableRow(page, NAME).locator('[data-testid^="expand-button-"]')
}

function watchers(page: Page): Locator {
  return page.locator(`section[aria-label="Inspect variable ${NAME}"]`)
}

function watcherOf(page: Page, value: string): Locator {
  return watchers(page).filter({ has: page.locator('.cm-content', { hasText: value }) })
}

/** The values the open watchers of `shared_name` show, sorted. */
async function expectWatchedValues(page: Page, values: string[]): Promise<void> {
  await expect(watchers(page)).toHaveCount(values.length)
  await expect
    .poll(async () => (await watchers(page).locator('.cm-content').allTextContents()).sort())
    .toEqual([...values].sort())
}

async function openWatcher(page: Page): Promise<void> {
  await variableRow(page, NAME).hover()
  await expandButton(page).click()
}

async function drillIn(page: Page): Promise<void> {
  await digIn(page, FN_ID)
  await expect(page.getByTestId('canvas-breadcrumb')).toContainText(FN_LABEL)
  await expect(page.getByTestId('workflow-node-watch-inner-log')).toBeVisible()
}

let testId: string | undefined

test.describe('V-VAR-WATCHER-SCOPE: one watcher per variable per scope', () => {
  test.afterEach(async ({ request }) => {
    if (testId) await request.delete(`${BACKEND_URL}/tests/${testId}`).catch(() => undefined)
    testId = undefined
  })

  test('a Test variable watcher and a same-named Function local watcher stay with their own scopes', async ({
    page,
    request,
  }) => {
    testId = await createValidTest(request, {
      name: `zz-watcher-scope-${randomUUID().slice(0, 8)}`,
      variables: { [NAME]: { type: 'string', value: TEST_VALUE } },
      nodes: [
        localFunctionNode(FN_ID, FN_LABEL, {
          variables: [{ name: NAME, type: 'string', value: LOCAL_VALUE }],
          nodes: [logNode('watch-inner-log', 'Inner log', NAME, { x: 200, y: 160 })],
          edges: [{ id: 'e-start-inner', source: 'start-node', target: 'watch-inner-log' }],
        }),
        logNode('watch-root-log', 'Root log', NAME, { x: 300, y: 340 }),
      ],
      edges: [startEdge(FN_ID), { id: 'e-fn-root-log', source: FN_ID, target: 'watch-root-log' }],
    })
    const validation = await validateTest(request, testId, 'run')
    expect(validation.errors, JSON.stringify(validation.errors)).toHaveLength(0)
    await openTest(page, testId)
    await expandVariableManager(page)

    await test.step('watching the Test variable marks its row', async () => {
      await expect(expandButton(page)).not.toHaveClass(WATCHED)
      await openWatcher(page)
      await expectWatchedValues(page, [TEST_VALUE])
      await expect(expandButton(page)).toHaveClass(WATCHED)
    })

    await test.step('drilled in, the same-named local is not watched and the Test watcher stays', async () => {
      await drillIn(page)
      await expect(variableRow(page, NAME)).toContainText(LOCAL_VALUE)
      await expect(expandButton(page)).not.toHaveClass(WATCHED)
      await expectWatchedValues(page, [TEST_VALUE])
    })

    await test.step('expanding the local opens a second watcher with its own value', async () => {
      await openWatcher(page)
      await expectWatchedValues(page, [TEST_VALUE, LOCAL_VALUE])
      await expect(expandButton(page)).toHaveClass(WATCHED)
    })

    await test.step('back at the root both watchers stay, each with its own value', async () => {
      await page.getByTestId('breadcrumb-back-arrow').click()
      await expect(page.getByTestId('workflow-node-watch-root-log')).toBeVisible()
      await expect(variableRow(page, NAME)).toContainText(TEST_VALUE)
      await expect(expandButton(page)).toHaveClass(WATCHED)
      await expectWatchedValues(page, [TEST_VALUE, LOCAL_VALUE])
    })

    await test.step("closing the Test variable's watcher leaves the local's watcher and mark alone", async () => {
      await watcherOf(page, TEST_VALUE).getByRole('button', { name: `Close inspector for ${NAME}`, exact: true }).click()
      await expectWatchedValues(page, [LOCAL_VALUE])
      await expect(expandButton(page)).not.toHaveClass(WATCHED)
      await drillIn(page)
      await expect(expandButton(page)).toHaveClass(WATCHED)
      await expectWatchedValues(page, [LOCAL_VALUE])
    })
  })
})
