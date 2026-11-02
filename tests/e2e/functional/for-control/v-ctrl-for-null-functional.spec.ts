/**
 * V-CTRL-FOR-NULL: a For with a null count runs zero times; range mode refuses a null start, end or step
 * Wireframe: none
 * Design Decisions: none
 * REQ: REQ-3.5.1.15, REQ-3.1.3.25, REQ-3.1.3.21
 *
 * Seeds (API): one blank zz- Test per test. Test 1 declares `o_count` (integer, null) and `o_idx` (integer -1).
 * Test 2 declares `r_start` (integer, null), `r_end` (integer 3), `r_step` (integer 1) and `r_idx` (integer -1);
 * between its runs the seeds are changed with `PATCH /tests/{id}/variables` and the Test is opened again.
 * Built through the canvas: a For dropped under Start and configured in its sheet, a Log dropped on its body lane
 * and a Log dropped on its then lane.
 *
 * Pass Criteria:
 * 1. A For whose count is the expression `o_count` (null) runs zero times: the run passes, the For paints success,
 *    the console reads `[FOR] Starting loop (0 iterations)` and no ERROR line, the body Log never prints, the then
 *    Log prints `after idx=0`, and after the run `o_idx` reads 0 and `o_count` is still null. The Test stores the
 *    count as the expression.
 * 2. In range mode with start / end / step the expressions `r_start` / `r_end` / `r_step`, a null start, a null end
 *    and a null step each fail the For and the run, the console names the field (`Block '<For>' failed: 'start' is
 *    null`, `'end' is null`, `'step' is null`), and neither the body nor the then Log prints.
 * 3. With all three held (0, 3, 1) the same For passes, runs its body for 0, 1, 2 and then runs its then Log.
 */

import { test, expect, type APIRequestContext, type Page } from '../../helpers/playwright-fixtures'
import { BACKEND_URL, ensureEnvironment } from '../../helpers/config'
import { bindOutput, groupHeader, pickEnum, setRowExpression } from '../../helpers/config-sheet'
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

const intVar = (value: number | null) => ({ type: 'integer', value, scope: 'test' })

type RangeField = 'start' | 'end' | 'step'

type RangeRun = { field: RangeField | null; seeds: Record<string, number | null> }

// Each run changes only the seeds it names; the last run holds all three.
const RANGE_RUNS: readonly RangeRun[] = [
  { field: 'start', seeds: {} },
  { field: 'end', seeds: { r_start: 0, r_end: null } },
  { field: 'step', seeds: { r_end: 3, r_step: null } },
  { field: null, seeds: { r_step: 1 } },
]

const created: string[] = []

async function seedBlankTest(
  request: APIRequestContext,
  label: string,
  variables: Record<string, unknown>,
): Promise<string> {
  await ensureEnvironment(request)
  const testId = await createValidTest(request, {
    name: `zz-V-CTRL-FOR-NULL ${label} ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    nodes: [],
    edges: [],
    variables,
  })
  created.push(testId)
  return testId
}

/** A node of the saved Test: its Name, settings and expression fields. */
async function storedNode(
  page: Page,
  testId: string,
  nodeId: string,
): Promise<{ label: string; values: Record<string, unknown>; expressionFields: string[] }> {
  const resp = await page.request.get(`${BACKEND_URL}/tests/${testId}`)
  expect(resp.ok(), `GET /tests/${testId} answered ${resp.status()}`).toBeTruthy()
  const body = await resp.json()
  const nodes = ((body.data ?? body).workflow?.nodes ?? []) as Array<{ id: string; data: Record<string, unknown> }>
  const node = nodes.find((n) => n.id === nodeId)
  expect(node, `the saved Test holds the For ${nodeId}`).toBeTruthy()
  return {
    label: String(node!.data.label),
    values: (node!.data.config as { values: Record<string, unknown> }).values,
    expressionFields: (node!.data.expressionFields ?? []) as string[],
  }
}

async function patchSeeds(request: APIRequestContext, testId: string, seeds: Record<string, number | null>): Promise<void> {
  const variables = Object.fromEntries(Object.entries(seeds).map(([name, value]) => [name, intVar(value)]))
  const resp = await request.patch(`${BACKEND_URL}/tests/${testId}/variables`, { data: { variables, merge: true } })
  expect(resp.ok(), `PATCH /tests/${testId}/variables answered ${resp.status()} ${await resp.text()}`).toBeTruthy()
}

function messages(entries: readonly LogEntry[], pattern: RegExp): string[] {
  return entries.map((entry) => entry.message).filter((message) => pattern.test(message))
}

test.describe('V-CTRL-FOR-NULL: a For on null', () => {
  test.afterAll(async ({ request }) => {
    for (const testId of created.splice(0)) await deleteTest(request, testId)
  })

  test('a For with a null count runs zero times, its then path runs, index reads 0 and the start line reads 0 iterations', async ({
    page,
  }) => {
    test.setTimeout(240_000)
    const ids = { forLoop: '', body: '', after: '' }
    const testId = await seedBlankTest(page.request, 'count', { o_count: intVar(null), o_idx: intVar(-1) })

    await test.step('For under Start: count is the expression o_count, Index bound to o_idx', async () => {
      await openLaneCanvas(page, testId)
      ids.forLoop = await dropUnderStart(page, 'for')
      const sheet = await openConfig(page, ids.forLoop)
      await setRowExpression(page, sheet, 'count', 'o_count')
      await bindOutput(sheet, 'index', 'o_idx')
      await saveConfig(sheet)
    })

    await test.step('a Log on the body lane and a Log on the then lane', async () => {
      ids.body = await dropUnderLane(page, ids.forLoop, 'body', 'log')
      await setBlockExpression(page, ids.body, 'message', "'for-body-ran'")
      ids.after = await dropUnderLane(page, ids.forLoop, 'then', 'log')
      await setBlockExpression(page, ids.after, 'message', 'f"after idx={o_idx}"')
      await saveCanvas(page)
    })

    await test.step('the Test stores the count as the expression', async () => {
      const node = await storedNode(page, testId, ids.forLoop)
      expect(node.values.count, 'the stored count').toBe('o_count')
      expect(node.expressionFields, 'the count is stored as an expression').toContain('count')
    })

    const { verdict, entries } = await test.step('Run', () => runToEnd(page))

    await test.step('the For ran zero times without a crash and its then path ran', async () => {
      expect(verdict, `the run passes.\n${formatEntries(entries)}`).toBe('passed')
      await expectNodeStatus(page, ids.forLoop, 'success')
      expectConsoleLine(entries, 'INFO', '[FOR] Starting loop (0 iterations)')
      expect(entries.filter((e) => e.level === 'ERROR'), `no ERROR line.\n${formatEntries(entries)}`).toEqual([])
      expect(messages(entries, /^for-body-ran$/), 'the body Log never prints').toEqual([])
      expectConsoleLine(entries, 'INFO', 'after idx=0')
    })

    await test.step('index reads 0', async () => {
      const variables = await getSessionVariables(page, await getActiveSessionId(page))
      expect(sessionValue(variables, 'o_idx'), 'o_idx after the run').toBe(0)
      expect(sessionValue(variables, 'o_count'), 'o_count stays null').toBeNull()
    })
  })

  test('range mode with a null start, end or step fails the For and names the field', async ({ page }) => {
    test.setTimeout(360_000)
    const ids = { forLoop: '', body: '', after: '' }
    const testId = await seedBlankTest(page.request, 'range', {
      r_start: intVar(null),
      r_end: intVar(3),
      r_step: intVar(1),
      r_idx: intVar(-1),
    })

    await test.step('For under Start in range mode: start, end and step are expressions, Index bound to r_idx', async () => {
      await openLaneCanvas(page, testId)
      ids.forLoop = await dropUnderStart(page, 'for')
      const sheet = await openConfig(page, ids.forLoop)
      await pickEnum(page, sheet, 'mode', 'range')
      await setRowExpression(page, sheet, 'start', 'r_start')
      await setRowExpression(page, sheet, 'end', 'r_end')
      const advanced = groupHeader(sheet, 'Advanced')
      if ((await advanced.getAttribute('aria-expanded')) !== 'true') await advanced.click()
      await setRowExpression(page, sheet, 'step', 'r_step')
      await bindOutput(sheet, 'index', 'r_idx')
      await saveConfig(sheet)
    })

    await test.step('a Log on the body lane and a Log on the then lane', async () => {
      ids.body = await dropUnderLane(page, ids.forLoop, 'body', 'log')
      await setBlockExpression(page, ids.body, 'message', 'f"range-body-{r_idx}"')
      ids.after = await dropUnderLane(page, ids.forLoop, 'then', 'log')
      await setBlockExpression(page, ids.after, 'message', "'range-then'")
      await saveCanvas(page)
    })

    const stored = await test.step('the Test stores range mode with the three expressions', async () => {
      const node = await storedNode(page, testId, ids.forLoop)
      expect(node.values, 'the stored range settings').toMatchObject({
        mode: 'range',
        start: 'r_start',
        end: 'r_end',
        step: 'r_step',
      })
      expect(node.expressionFields, 'start, end and step are stored as expressions').toEqual(
        expect.arrayContaining(['start', 'end', 'step']),
      )
      return node
    })

    for (const [index, run] of RANGE_RUNS.entries()) {
      const what = run.field === null ? 'all three held' : `a null ${run.field}`
      await test.step(`run with ${what}`, async () => {
        if (index > 0) {
          await patchSeeds(page.request, testId, run.seeds)
          await openLaneCanvas(page, testId)
        }
        const { verdict, entries } = await runToEnd(page)
        if (run.field === null) {
          expect(verdict, `the run passes.\n${formatEntries(entries)}`).toBe('passed')
          await expectNodeStatus(page, ids.forLoop, 'success')
          expectConsoleLine(entries, 'INFO', '[FOR] Starting loop (3 iterations)')
          expect(messages(entries, /^range-body-/), 'the body runs for 0, 1, 2').toEqual([
            'range-body-0',
            'range-body-1',
            'range-body-2',
          ])
          expectConsoleLine(entries, 'INFO', 'range-then')
          return
        }
        expect(verdict, `the run fails.\n${formatEntries(entries)}`).toBe('failed')
        await expectNodeStatus(page, ids.forLoop, 'failed')
        expectConsoleLine(entries, 'ERROR', `Block '${stored.label}' failed: '${run.field}' is null`)
        expect(messages(entries, /^range-(body-.*|then)$/), 'neither the body nor the then Log prints').toEqual([])
      })
    }
  })
})
