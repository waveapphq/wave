/**
 * V-MCP-RECIPE-START-LINE-FUNCTIONAL: the line from Start to the first Block of a recipe-built Test is straight
 * Wireframe: none (the existing Start node and Block card)
 * Design Decisions: CANVAS-248
 * REQ: REQ-5.2.7.4, REQ-3.1.1.12.2
 *
 * Seed: one Test made with `create_test_from_recipe` and one with `build_test_from_recipe`; both deleted after.
 * A Delay of RUN_DELAY_MS before the last Block keeps each run playing while it is measured.
 *
 * Pass Criteria:
 * 1. In a Test from `create_test_from_recipe`, Start's bottom handle and the first Block's top handle are
 *    within 1 px in x, in the edit canvas.
 * 2. The same for a Test saved from `build_test_from_recipe`.
 * 3. The same after a save and a reload, the last Block's Message first set to an expression.
 * 4. The same in each read-only canvas view of the Test: a second tab watching the tab that holds the Test;
 *    a run the assistant starts with `start_execution`, as the holding tab and the watching tab mirror it
 *    while it plays; the finished run's history canvas; and the holding tab's own Run while it plays.
 */

import type { BrowserContext } from '@playwright/test'
import { test, expect, type Page } from '../../helpers/playwright-fixtures'
import { BACKEND_URL, E2E_ENV_NAME, ensureEnvironment } from '../../helpers/config'
import { clearSettledWorkbenchSession, openRunHistory } from '../../helpers/k8s-run'
import { deleteTest } from '../../helpers/element-types'
import { openTest } from '../../helpers/fn-seed'
import { expectSameX, handleCenterX, startHandle, topHandle } from '../../helpers/flow-geometry'
import { callToolAsync, enableMcpUntilRestart, resetMcpSettings } from '../../helpers/mcp'
import { SEL, openWorkbench, resetOwnership, waitUntilHeld } from '../../helpers/ownership'
import { saveTest, selectEnvironment, setBlockExpression } from '../../helpers/workbench'
import {
  MCP_PORT,
  createFromRecipe,
  expectStoredExpression,
  storedTestDoc,
  tool,
  uniqueName,
  type Doc,
} from './recipe-tool-helpers'

const RUN_DELAY_MS = 15_000
const RUN_STATUS = '[data-testid="workflow-status"]'
const TERMINAL = ['passed', 'failed', 'stopped', 'skipped']

/** The stored status of a tracked execution. */
async function executionStatus(request: Parameters<typeof storedTestDoc>[0], executionId: string): Promise<string> {
  const resp = await request.get(`${BACKEND_URL}/executions/${executionId}`)
  return String(((await resp.json()).data ?? {}).status ?? '')
}

function recipeOf(name: string): string {
  return `test:
  name: ${name}
  description: The first Block hangs straight under Start
flow:
  - block: log
    label: Announce the check
    settings: {message: start}
  - block: log
    settings: {message: middle}
  - delay: ${RUN_DELAY_MS}
  - block: log
    label: Close the check
    settings: {message: end}
`
}

/** The id of the Block Start wires to, as stored. */
async function firstBlock(request: Parameters<typeof storedTestDoc>[0], testId: string): Promise<string> {
  const edges = ((await storedTestDoc(request, testId)).workflow.edges ?? []) as Doc[]
  const wire = edges.find((edge) => edge.source === 'start-node')
  expect(wire, 'Start is wired to the first Block').toBeTruthy()
  return String(wire?.target)
}

async function expectStraight(page: Page, blockId: string, where: string): Promise<void> {
  expectSameX(await handleCenterX(topHandle(page, blockId)), await handleCenterX(startHandle(page)), where)
}

test.describe('V-MCP-RECIPE-START-LINE-FUNCTIONAL: Start lines up with the first Block', () => {
  const created: string[] = []
  const contexts: BrowserContext[] = []

  test.beforeEach(async ({ page, request }) => {
    await resetOwnership(request)
    await ensureEnvironment(request)
    await enableMcpUntilRestart(page, MCP_PORT)
  })

  test.afterEach(async ({ page, request }) => {
    for (const context of contexts.splice(0)) await context.close().catch(() => undefined)
    for (const id of created.splice(0)) await deleteTest(request, id)
    await resetOwnership(request)
    await resetMcpSettings(page)
  })

  test('create, build, save and reload, and every read-only view draw the line straight', async ({ page, request, browser }) => {
    test.setTimeout(420_000)
    const testId = createFromRecipe(recipeOf(uniqueName('zz-b29-start-line-create')))
    created.push(testId)
    const first = await firstBlock(request, testId)

    await test.step('1. create_test_from_recipe, in the edit canvas', async () => {
      await openTest(page, testId)
      await expectStraight(page, first, 'created Test')
    })

    await test.step('2. build_test_from_recipe', async () => {
      await page.goto('/tests')
      await resetOwnership(request)
      const built = await callToolAsync(MCP_PORT, 'build_test_from_recipe', {
        recipe: recipeOf(uniqueName('zz-b29-start-line-build')),
      })
      expect(built.isError, JSON.stringify(built.payload)).toBe(false)
      expect(built.payload.built, JSON.stringify(built.payload)).toBe(true)
      const builtId = String(built.payload.test_id)
      created.push(builtId)
      await openTest(page, builtId)
      await expectStraight(page, await firstBlock(request, builtId), 'built Test')
    })

    await test.step('3. after a save and a reload', async () => {
      await openTest(page, testId)
      const edges = ((await storedTestDoc(request, testId)).workflow.edges ?? []) as Doc[]
      const last = edges.map((edge) => String(edge.target)).find((id) => !edges.some((edge) => edge.source === id))
      // Per FIELD-7: Message holds a plain value, so the helper answers the switch warning with Clear.
      await setBlockExpression(page, String(last), 'message', "'end saved'")
      await saveTest(page)
      await expectStoredExpression(request, testId, String(last), 'message', "'end saved'")
      await openTest(page, testId)
      await expectStraight(page, first, 'after save and reload')
    })

    await test.step('4. in the read-only view of a watching tab', async () => {
      await openTest(page, testId)
      await waitUntilHeld(request)
      const watcher = await openWorkbench(browser)
      contexts.push(watcher.context)
      await expect(watcher.page.locator(SEL.bannerPerson)).toBeVisible({ timeout: 15_000 })
      await expect(watcher.page.locator(SEL.canvasReadOnly)).toBeVisible()
      await expect(topHandle(watcher.page, first)).toBeVisible({ timeout: 15_000 })
      await expectStraight(watcher.page, first, 'watching tab')

      await test.step('4b. while an assistant run plays, mirrored in the holding and the watching tab', async () => {
        // The watcher stubbed session recovery on open; a mirrored run attaches through it.
        await watcher.page.unroute('**/workbench/session')
        const started = tool('start_execution', { entity_type: 'test', ref: testId, environment: E2E_ENV_NAME })
        expect(started.mirrored, `a clean idle holder yields to the run: ${JSON.stringify(started)}`).toBe(true)
        const executionId = String(started.execution_id)
        for (const [tab, where] of [
          [page, 'holding tab, assistant run'],
          [watcher.page, 'watching tab, assistant run'],
        ] as const) {
          await expect(tab.locator(SEL.bannerMcp)).toContainText('read-only, running live', { timeout: 15_000 })
          await expect(tab.locator(SEL.canvasReadOnly)).toBeVisible()
          await expect(topHandle(tab, first)).toBeVisible({ timeout: 15_000 })
          await expectStraight(tab, first, where)
        }
        expect(await executionStatus(request, executionId), 'measured while the run plays').toBe('running')
        await expect
          .poll(async () => TERMINAL.includes(await executionStatus(request, executionId)), {
            timeout: RUN_DELAY_MS + 60_000,
            message: `execution ${executionId} reaches a terminal state`,
          })
          .toBe(true)

        await test.step('4c. on the finished run history canvas', async () => {
          await openRunHistory(page, executionId)
          await expect(topHandle(page, first)).toBeVisible({ timeout: 15_000 })
          await expectStraight(page, first, 'history canvas')
        })
      })
    })

    await test.step('4d. while the holding tab plays its own Run, the canvas locked', async () => {
      await resetOwnership(request)
      await openTest(page, testId)
      await waitUntilHeld(request)
      await selectEnvironment(page)
      await page.locator(SEL.runButton).click()
      const status = page.locator(RUN_STATUS)
      await expect(status).toHaveAttribute('data-status', 'running', { timeout: 15_000 })
      await expectStraight(page, first, 'own Run playing')
      await expect(status, 'measured while the run plays').toHaveAttribute('data-status', 'running')
      await expect(status).toHaveAttribute('data-status', /passed|success/, { timeout: RUN_DELAY_MS + 60_000 })
      await clearSettledWorkbenchSession(request)
    })
  })
})
