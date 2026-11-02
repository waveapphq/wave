/**
 * V-CTRL-FOREACH-NULL: a For Each over null or over an empty list runs zero times; a null item reaches the body as null
 * Wireframe: none
 * Design Decisions: none
 * REQ: REQ-3.5.1.16, REQ-3.1.3.25
 *
 * Seeds (API): one blank zz- Test per test, declaring `o_list` (array, null), `o_item` (map
 * {type: string, value: seed}; the Item output is a map and binds only to a map) and `o_idx` (integer -1).
 * Built through the canvas: a For Each dropped under Start and configured in its sheet, a Log dropped on its
 * body lane and a Log dropped on its then lane.
 *
 * Pass Criteria:
 * 1. A For Each whose collection picker names the null variable `o_list` runs zero times: the run passes, the
 *    console reads `[FOR-EACH] Starting loop (0 iterations)`, the body Log never prints, the then Log prints
 *    `after idx=0 item=seed`, and after the run `o_idx` reads 0, `o_item` keeps its seed (never `{}`) and
 *    `o_list` is still null. The Test stores the picked name as the collection.
 * 2. The same holds for a collection typed as the expression `[]`.
 * 3. A collection `['a', None, 'c']` runs three times and the body reads the middle item as null:
 *    `item-a`, `item-null`, `item-c` in that order, never `item-None`.
 */

import { test, expect, type APIRequestContext, type Page } from '../../helpers/playwright-fixtures'
import { BACKEND_URL, ensureEnvironment } from '../../helpers/config'
import { bindOutput, pickVariableRef, setRowExpression } from '../../helpers/config-sheet'
import { createValidTest } from '../../helpers/fn-seed'
import { getActiveSessionId, getSessionVariables, sessionValue } from '../../helpers/fixture-import'
import { expectNodeStatus } from '../../helpers/k8s-run'
import { expectConsoleLine, formatEntries, type LogEntry } from '../../helpers/log-reader'
import { runToEnd, setBlockExpression } from '../../helpers/workbench'
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

const ITEM_SEED = { type: 'string', value: 'seed' }
const BODY_TEXT = 'fe-body-ran'
const AFTER_EXPRESSION = `f"after idx={o_idx} item={o_item.get('value')}"`
const AFTER_TEXT = 'after idx=0 item=seed'
const ZERO_RUNS = '[FOR-EACH] Starting loop (0 iterations)'

type Collection = { pick: string } | { expression: string }

type ZeroRunCase = { title: string; collection: Collection }

const ZERO_RUN_CASES: readonly ZeroRunCase[] = [
  {
    title: 'a For Each over a null variable runs zero times, its then path runs, index reads 0 and the item keeps its seed',
    collection: { pick: 'o_list' },
  },
  {
    title: 'a For Each over an empty list runs zero times, its then path runs, index reads 0 and the item keeps its seed',
    collection: { expression: '[]' },
  },
]

const created: string[] = []

async function seedBlankTest(request: APIRequestContext, label: string): Promise<string> {
  await ensureEnvironment(request)
  const testId = await createValidTest(request, {
    name: `zz-V-CTRL-FOREACH-NULL ${label} ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    nodes: [],
    edges: [],
    variables: {
      o_list: { type: 'array', value: null, scope: 'test' },
      o_item: { type: 'map', value: ITEM_SEED, scope: 'test' },
      o_idx: { type: 'integer', value: -1, scope: 'test' },
    },
  })
  created.push(testId)
  return testId
}

/** The stored For Each node's collection and whether it is stored as an expression. */
async function storedCollection(page: Page, testId: string, nodeId: string): Promise<{ value: unknown; expression: boolean }> {
  const resp = await page.request.get(`${BACKEND_URL}/tests/${testId}`)
  expect(resp.ok(), `GET /tests/${testId} answered ${resp.status()}`).toBeTruthy()
  const body = await resp.json()
  const nodes = ((body.data ?? body).workflow?.nodes ?? []) as Array<{ id: string; data: Record<string, unknown> }>
  const node = nodes.find((n) => n.id === nodeId)
  expect(node, `the saved Test holds the For Each ${nodeId}`).toBeTruthy()
  const config = node!.data.config as { values: Record<string, unknown> }
  const fields = (node!.data.expressionFields ?? []) as string[]
  return { value: config.values.collection, expression: fields.includes('collection') }
}

function messages(entries: readonly LogEntry[], pattern: RegExp): string[] {
  return entries.map((entry) => entry.message).filter((message) => pattern.test(message))
}

test.describe('V-CTRL-FOREACH-NULL: a For Each over nothing', () => {
  test.afterAll(async ({ request }) => {
    for (const testId of created.splice(0)) await deleteTest(request, testId)
  })

  for (const zeroRun of ZERO_RUN_CASES) {
    test(zeroRun.title, async ({ page }) => {
      test.setTimeout(240_000)
      const ids = { forEach: '', body: '', after: '' }
      const testId = await seedBlankTest(page.request, 'pick' in zeroRun.collection ? 'null' : 'empty')

      await test.step('For Each under Start: collection, Item bound to o_item, Index bound to o_idx', async () => {
        await openLaneCanvas(page, testId)
        ids.forEach = await dropUnderStart(page, 'for each')
        const sheet = await openConfig(page, ids.forEach)
        if ('pick' in zeroRun.collection) await pickVariableRef(page, sheet, 'collection', zeroRun.collection.pick)
        else await setRowExpression(page, sheet, 'collection', zeroRun.collection.expression)
        await bindOutput(sheet, 'item', 'o_item')
        await bindOutput(sheet, 'index', 'o_idx')
        await saveConfig(sheet)
      })

      await test.step('a Log on the body lane and a Log on the then lane', async () => {
        ids.body = await dropUnderLane(page, ids.forEach, 'body', 'log')
        await setBlockExpression(page, ids.body, 'message', `'${BODY_TEXT}'`)
        ids.after = await dropUnderLane(page, ids.forEach, 'then', 'log')
        await setBlockExpression(page, ids.after, 'message', AFTER_EXPRESSION)
        await saveCanvas(page)
      })

      await test.step('the Test stores the collection as it was set in the sheet', async () => {
        const stored = await storedCollection(page, testId, ids.forEach)
        if ('pick' in zeroRun.collection) {
          expect(stored, 'the picked variable is stored by name').toEqual({ value: zeroRun.collection.pick, expression: false })
        } else {
          expect(stored, 'the typed collection is stored as an expression').toEqual({
            value: zeroRun.collection.expression,
            expression: true,
          })
        }
      })

      const { verdict, entries } = await test.step('Run', () => runToEnd(page))

      await test.step('the loop ran zero times and its then path ran', async () => {
        expect(verdict, `the run passes.\n${formatEntries(entries)}`).toBe('passed')
        await expectNodeStatus(page, ids.forEach, 'success')
        expectConsoleLine(entries, 'INFO', ZERO_RUNS)
        expect(messages(entries, new RegExp(`^${BODY_TEXT}$`)), 'the body Log never prints').toEqual([])
        expectConsoleLine(entries, 'INFO', AFTER_TEXT)
        expect(entries.filter((e) => e.level === 'ERROR'), `no ERROR line.\n${formatEntries(entries)}`).toEqual([])
      })

      await test.step('index reads 0 and the item keeps its seed', async () => {
        const variables = await getSessionVariables(page, await getActiveSessionId(page))
        expect(sessionValue(variables, 'o_idx'), 'o_idx after the run').toBe(0)
        expect(sessionValue(variables, 'o_item'), 'o_item after the run, never {}').toEqual(ITEM_SEED)
        expect(sessionValue(variables, 'o_list'), 'o_list stays null').toBeNull()
      })
    })
  }

  test('a null item inside a list reaches the body as null, never as text', async ({ page }) => {
    test.setTimeout(240_000)
    const ids = { forEach: '', body: '' }
    const testId = await seedBlankTest(page.request, 'item')

    await test.step("For Each under Start over ['a', None, 'c'], Item bound to o_item", async () => {
      await openLaneCanvas(page, testId)
      ids.forEach = await dropUnderStart(page, 'for each')
      const sheet = await openConfig(page, ids.forEach)
      await setRowExpression(page, sheet, 'collection', "['a', None, 'c']")
      await bindOutput(sheet, 'item', 'o_item')
      await saveConfig(sheet)
    })

    await test.step('a Log on the body lane naming a null item', async () => {
      ids.body = await dropUnderLane(page, ids.forEach, 'body', 'log')
      await setBlockExpression(
        page,
        ids.body,
        'message',
        "'item-null' if o_item.get('value') is None else 'item-' + o_item.get('value')",
      )
      await saveCanvas(page)
    })

    const { verdict, entries } = await test.step('Run', () => runToEnd(page))

    await test.step('the body read a, null, c', async () => {
      expect(verdict, `the run passes.\n${formatEntries(entries)}`).toBe('passed')
      expectConsoleLine(entries, 'INFO', '[FOR-EACH] Starting loop (3 iterations)')
      expect(messages(entries, /^item-/), `the body saw the null item as null.\n${formatEntries(entries)}`).toEqual([
        'item-a',
        'item-null',
        'item-c',
      ])
    })
  })
})
