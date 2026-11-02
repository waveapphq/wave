/**
 * V-CTRL-FOREACH-NESTED-EMPTY: a For Each that runs zero times inside another loop leaves its item untouched
 * Wireframe: N/A
 * Design Decisions: none
 * REQ: REQ-3.5.1.16, REQ-3.1.3.25
 *
 * Seeds (API): a blank zz- Test declaring the map variable `o_item` = {"held": "seed"}. A map, because
 * the For Each item output is a map and the outputs table refuses to bind it to any other type.
 * Built through the canvas: For (count 1) dropped under Start, For Each dropped on the For body lane
 * (collection `[]`, Item bound to `o_item`), a Log dropped on the For then lane printing `o_item`.
 *
 * Pass Criteria:
 * 1. The run passes; the For Each reports zero iterations.
 * 2. After the run `o_item` still holds its seed, never `{}`.
 * 3. The Log after the For prints `item=seed`.
 */

import { test, expect, type Locator, type Page } from '../../helpers/playwright-fixtures'
import { numberInput, setRowExpression } from '../../helpers/config-sheet'
import { ensureEnvironment } from '../../helpers/config'
import { createValidTest } from '../../helpers/fn-seed'
import { getActiveSessionId, getSessionVariables, sessionValue } from '../../helpers/fixture-import'
import { expectNodeStatus } from '../../helpers/k8s-run'
import { expectConsoleLine, formatEntries, getLogEntries, waitForLogText } from '../../helpers/log-reader'
import {
  LANE_VIEWPORT,
  deleteTest,
  dropUnderLane,
  dropUnderStart,
  openConfig,
  openLaneCanvas,
  saveCanvas,
  saveConfig,
} from '../canvas-lanes/lanes-helpers'

test.use({ viewport: LANE_VIEWPORT })

const SEED = { held: 'seed' }
const LOG_MESSAGE = "'item=' + str(o_item.get('held'))"

/** Bind an output to an existing variable typed into its Assign to field. */
async function assignExisting(page: Page, sheet: Locator, label: string, name: string): Promise<void> {
  const assign = sheet.getByRole('combobox', { name: `Assign ${label} to`, exact: true })
  await assign.scrollIntoViewIfNeeded()
  await assign.fill(name)
  await expect(page.getByTestId('output-new-var-hint'), `${name} is an existing variable`).toHaveCount(0)
  await assign.press('Escape')
  await expect(sheet).toBeVisible()
  await expect(assign).toHaveValue(name)
}

test.describe('V-CTRL-FOREACH-NESTED-EMPTY: a For Each over nothing inside a For', () => {
  let testId: string | undefined

  test.afterAll(async ({ request }) => {
    await deleteTest(request, testId)
  })

  test('a For Each over an empty list inside a For leaves the item untouched', async ({ page, request }) => {
    test.setTimeout(240_000)
    const ids = { forLoop: '', forEach: '', log: '' }

    await test.step('a blank Test declaring o_item, open on the canvas', async () => {
      await ensureEnvironment(request)
      testId = await createValidTest(request, {
        name: `zz-V-CTRL-FOREACH-NESTED-EMPTY ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        nodes: [],
        edges: [],
        variables: { o_item: { type: 'map', value: SEED, scope: 'test' } },
      })
      await openLaneCanvas(page, testId)
    })

    await test.step('For with count 1 under Start', async () => {
      ids.forLoop = await dropUnderStart(page, 'for')
      const sheet = await openConfig(page, ids.forLoop)
      await numberInput(sheet, 'count').fill('1')
      await expect(numberInput(sheet, 'count')).toHaveValue('1')
      await saveConfig(sheet)
    })

    await test.step('For Each on the For body lane: collection [], Item bound to o_item', async () => {
      ids.forEach = await dropUnderLane(page, ids.forLoop, 'body', 'for each')
      const sheet = await openConfig(page, ids.forEach)
      await setRowExpression(page, sheet, 'collection', '[]')
      await assignExisting(page, sheet, 'Item', 'o_item')
      await saveConfig(sheet)
    })

    await test.step('Log on the For then lane printing o_item', async () => {
      ids.log = await dropUnderLane(page, ids.forLoop, 'then', 'log')
      const sheet = await openConfig(page, ids.log)
      await setRowExpression(page, sheet, 'message', LOG_MESSAGE)
      await saveConfig(sheet)
      await saveCanvas(page)
    })

    const entries = await test.step('Run', async () => {
      await page.locator('[data-testid="run-button"]').click()
      const status = page.locator('[data-testid="workflow-status"]')
      await expect(status).toHaveAttribute('data-status', /passed|failed|stopped|skipped/, { timeout: 120_000 })
      await waitForLogText(page, 'item=', 30_000)
      const harvested = await getLogEntries(page)
      expect(await status.getAttribute('data-status'), `the run passes.\n${formatEntries(harvested)}`).toBe('passed')
      return harvested
    })

    await test.step('the For Each ran zero times', async () => {
      await expectNodeStatus(page, ids.forLoop, 'success')
      await expectNodeStatus(page, ids.forEach, 'success')
      expectConsoleLine(entries, 'INFO', '[FOR-EACH] Starting loop (0 iterations)')
    })

    await test.step('o_item keeps its seed', async () => {
      const variables = await getSessionVariables(page, await getActiveSessionId(page))
      expect(sessionValue(variables, 'o_item'), `o_item after the run.\n${formatEntries(entries)}`).toEqual(SEED)
      expectConsoleLine(entries, 'INFO', 'item=seed')
    })
  })
})
