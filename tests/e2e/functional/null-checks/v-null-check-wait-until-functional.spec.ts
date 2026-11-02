/**
 * V-NULL-CHECK-WAIT-UNTIL: Wait Until checks a null value by the check rule
 * Wireframe: none
 * Design Decisions: none (behavior per REQ-3.5.4.3)
 * REQ: REQ-3.1.3.25, REQ-3.5.4.3, REQ-3.5.4.4
 *
 * Seeds (API): test 1 - a blank zz- Test declaring `a_null` (array) with no value. Built through the
 * UI: a Wait Until dropped under Start, Retry, Timeout 600 ms, Check Interval 200 ms, the rows
 * `a_null not null` OR `a_null contains x`, a Log dropped on its retry lane and one on its then lane.
 * Tests 2 and 3 import a generated zz- Test (POST /tests): per cell a null variable of the type and a
 * Wait Until (Retry, 600 ms, every 200 ms, Fail Current Scope off, passed / elapsed bound to null
 * seeded variables) whose one condition row is in the stored shape test 1 proves; its retry lane is
 * a Log `<cell> round`; `then` chains the cells.
 *
 * Pass Criteria:
 * 1. The stored rows, OR between them, equal the generated rows; the stored mode is retry, the
 *    timeout 600 and the check interval 200.
 * 2. On null, `not null` OR `contains x` is false: the wait keeps waiting to its timeout, runs its
 *    retry lane, logs `[WAIT] Gave up after <N> ms: condition not met` at WARN with N >= 600, paints
 *    amber (warning) and leaves by then; the run still passes.
 * 3. For every type, `is null` passes in round one: passed true, elapsed under one check interval,
 *    the retry lane never runs and paints skipped, the block paints success.
 * 4. For every type, `not null` keeps waiting to its timeout: passed false, elapsed >= 600, at
 *    least one retry round, the gave-up line after the cell's last round, the block paints warning.
 * 5. string / integer / float `not equals`, array `does not contain`, map `does not have key` and
 *    table `is empty` pass in round one; boolean `is false` keeps waiting.
 * 6. One gave-up line per waiting cell, one `[WAIT] Condition met` line per passing cell; the
 *    checked variable stays null and the run passes.
 */

import { test, expect } from '../../helpers/playwright-fixtures'
import { CHECK_BLOCK_PALETTE, conditionBody, setWaitTiming } from '../../helpers/condition-builder'
import { sessionValue } from '../../helpers/fixture-import'
import { controlNode, handleEdge } from '../../helpers/k8s-nodes'
import { type LogEntry } from '../../helpers/log-reader'
import { LANE_VIEWPORT, deleteTest, openConfig, saveCanvas, saveConfig } from '../canvas-lanes/lanes-helpers'
import { dropUnderStart } from './check-chain'
import {
  COLLECTION_TYPES,
  SCALAR_TYPES,
  START,
  buildRows,
  checkedVariable,
  conditionRow,
  consoleDump,
  dropLaneLog,
  expectPaint,
  expectStillNull,
  generatedRows,
  importGraph,
  linesWith,
  linkFrom,
  logBlock,
  nullVariable,
  routingCells,
  runRouting,
  seedBlankTest,
  storedValues,
  withoutIds,
  type CheckType,
  type Exit,
  type RoutingCell,
  type RoutingGraph,
  type RoutingRun,
  type UiRow,
} from './routing-cells'

test.use({ viewport: LANE_VIEWPORT })

const TIMEOUT_MS = 600
const INTERVAL_MS = 200
const GAVE_UP = /^\[WAIT\] Gave up after (\d+) ms: condition not met$/
const CONDITION_MET = /^\[WAIT\] Condition met after \d+ ms$/

const ROWS: readonly UiRow[] = [
  { variable: 'a_null', type: 'array', check: { operator: 'is_not_null', label: 'not null', reference: null } },
  { variable: 'a_null', type: 'array', check: { operator: 'contains', label: 'contains', reference: 'x' } },
]

const GROUPS: ReadonlyArray<[string, readonly CheckType[]]> = [
  ['scalars', SCALAR_TYPES],
  ['collections', COLLECTION_TYPES],
]

function blockId(c: RoutingCell): string {
  return `wu-${c.id}`
}

function roundText(c: RoutingCell): string {
  return `${c.name} round`
}

function passedVariable(c: RoutingCell): string {
  return `passed_${c.slug}`
}

function elapsedVariable(c: RoutingCell): string {
  return `elapsed_${c.slug}`
}

function gaveUpLines(entries: readonly LogEntry[]): LogEntry[] {
  return entries.filter((entry) => entry.level === 'WARN' && GAVE_UP.test(entry.message))
}

function waitedMs(entry: LogEntry): number {
  return Number(GAVE_UP.exec(entry.message)?.[1])
}

/** The cell's gave-up line comes after its last retry round and before any later cell's round. */
function gaveUpAfterOwnRounds(run: RoutingRun, c: RoutingCell, rounds: ReadonlySet<string>): boolean {
  const own = roundText(c)
  const last = run.entries.map((entry) => entry.message).lastIndexOf(own)
  if (last < 0) return false
  const after = run.entries.slice(last + 1)
  const gaveUp = after.findIndex((entry) => entry.level === 'WARN' && GAVE_UP.test(entry.message))
  const otherRound = after.findIndex((entry) => rounds.has(entry.message) && entry.message !== own)
  return gaveUp >= 0 && (otherRound < 0 || gaveUp < otherRound)
}

/** One Wait Until per cell: Retry with a round marker on the retry lane; `then` leads on. */
function waitGraph(cells: readonly RoutingCell[]): RoutingGraph {
  const graph: RoutingGraph = { nodes: [], edges: [], variables: {} }
  let from: Exit = { source: START }
  cells.forEach((c, index) => {
    const id = blockId(c)
    const y = index * 220
    graph.variables[checkedVariable(c)] = nullVariable(c.type)
    graph.variables[passedVariable(c)] = nullVariable('boolean')
    graph.variables[elapsedVariable(c)] = nullVariable('integer')
    graph.nodes.push(
      controlNode({
        id,
        label: 'Wait Until',
        elementType: 'wait-until',
        category: 'timing',
        description: c.name,
        values: {
          conditions: [conditionRow(`${id}-c0`, checkedVariable(c), c.type, c.check)],
          timeout: TIMEOUT_MS,
          check_interval: INTERVAL_MS,
          mode: 'retry',
          fail_current_scope: false,
        },
        outputBindings: { passed: passedVariable(c), elapsed: elapsedVariable(c) },
        position: { x: 300, y },
      }),
      logBlock(`${id}-round`, roundText(c), { x: 550, y: y + 100 }),
    )
    graph.edges.push(linkFrom(from, id), handleEdge(id, 'retry', `${id}-round`))
    from = { source: id, handle: 'then' }
  })
  return graph
}

test.describe('V-NULL-CHECK-WAIT-UNTIL: Wait Until on a null value', () => {
  const created: string[] = []

  test.afterAll(async ({ request }) => {
    for (const id of created) await deleteTest(request, id)
  })

  test('the sheet stores the rows the generator writes, and a check false on null waits to its timeout', async ({
    page,
    request,
  }) => {
    test.setTimeout(240_000)
    const ids = { test: '', block: '', roundLog: '', thenLog: '' }

    await test.step('a blank Test declaring a_null with no value', async () => {
      ids.test = await seedBlankTest(page, request, 'V-NULL-CHECK-WAIT-UNTIL ui', { a_null: 'array' })
      created.push(ids.test)
    })

    await test.step('Wait Until Retry, 600 ms, every 200 ms, a_null not null OR a_null contains x', async () => {
      ids.block = await dropUnderStart(page, CHECK_BLOCK_PALETTE['wait-until'])
      const sheet = await openConfig(page, ids.block)
      await setWaitTiming(sheet, 'retry', TIMEOUT_MS, INTERVAL_MS)
      await buildRows(page, conditionBody(sheet, 'wait-until'), ROWS, 'or')
      await saveConfig(sheet)
    })

    await test.step('a Log on the retry lane and one on the then lane, then the toolbar Save', async () => {
      ids.roundLog = await dropLaneLog(page, ids.block, 'retry', 'ui round')
      ids.thenLog = await dropLaneLog(page, ids.block, 'then', 'ui then')
      await saveCanvas(page)
    })

    await test.step('the stored rows are the generated rows; Retry, 600 ms, every 200 ms', async () => {
      const values = await storedValues(request, ids.test, ids.block)
      expect(withoutIds(values.conditions)).toEqual(withoutIds(generatedRows(ROWS, 'or')))
      expect(values.mode).toBe('retry')
      expect(Number(values.timeout)).toBe(TIMEOUT_MS)
      expect(Number(values.check_interval)).toBe(INTERVAL_MS)
    })

    const run = await test.step('Run', () => runRouting(page))

    await test.step('the wait keeps waiting to its timeout and ends amber', async () => {
      expect(run.verdict, consoleDump(run)).toBe('passed')
      const gaveUp = gaveUpLines(run.entries)
      expect(gaveUp, consoleDump(run)).toHaveLength(1)
      expect(waitedMs(gaveUp[0]), consoleDump(run)).toBeGreaterThanOrEqual(TIMEOUT_MS)
      expect(linesWith(run, 'ui round').length, consoleDump(run)).toBeGreaterThanOrEqual(1)
      expect(linesWith(run, 'ui then'), consoleDump(run)).toHaveLength(1)
      expectPaint(run, ids.block, 'warning', 'the Wait Until')
      expectPaint(run, ids.thenLog, 'success', 'the then Log')
    })
  })

  for (const [group, types] of GROUPS) {
    test(`${group}: is null passes in round one, a check false on null waits to its timeout, over a null ${types.join(', ')}`, async ({
      page,
    }) => {
      const cells = routingCells(types)
      created.push(await importGraph(page, `V-NULL-CHECK-WAIT-UNTIL ${group}`, waitGraph(cells)))
      const run = await runRouting(page)
      expect(run.verdict, consoleDump(run)).toBe('passed')

      const waiting = cells.filter((c) => !c.holds)
      const rounds = new Set(cells.map(roundText))
      const gaveUp = gaveUpLines(run.entries)
      expect.soft(gaveUp, `one gave-up line per waiting cell.\n${consoleDump(run)}`).toHaveLength(waiting.length)
      for (const line of gaveUp) expect.soft(waitedMs(line), `waited to the timeout: ${line.message}`).toBeGreaterThanOrEqual(TIMEOUT_MS)
      expect
        .soft(run.entries.filter((entry) => entry.level === 'INFO' && CONDITION_MET.test(entry.message)), 'one met line per passing cell')
        .toHaveLength(cells.length - waiting.length)

      for (const c of cells) {
        await test.step(`${c.name} ${c.holds ? 'passes in round one' : 'waits to its timeout'}`, () => {
          const elapsed = Number(sessionValue(run.variables, elapsedVariable(c)))
          expect.soft(sessionValue(run.variables, passedVariable(c)), `${c.name}: passed`).toBe(c.holds)
          expectStillNull(run, c)
          if (c.holds) {
            expect.soft(linesWith(run, roundText(c)), `${c.name}: no retry round`).toHaveLength(0)
            expect.soft(elapsed, `${c.name}: elapsed under one check interval`).toBeLessThan(INTERVAL_MS)
            expectPaint(run, blockId(c), 'success', c.name)
            expectPaint(run, `${blockId(c)}-round`, 'skipped', `${c.name}: the retry lane`)
            return
          }
          expect.soft(linesWith(run, roundText(c)).length, `${c.name}: retry rounds`).toBeGreaterThanOrEqual(1)
          expect.soft(elapsed, `${c.name}: elapsed reaches the timeout`).toBeGreaterThanOrEqual(TIMEOUT_MS)
          expect.soft(gaveUpAfterOwnRounds(run, c, rounds), `${c.name}: the gave-up line follows its rounds.\n${consoleDump(run)}`).toBe(true)
          expectPaint(run, blockId(c), 'warning', c.name)
          expectPaint(run, `${blockId(c)}-round`, 'success', `${c.name}: the retry lane`)
        })
      }
    })
  }
})
