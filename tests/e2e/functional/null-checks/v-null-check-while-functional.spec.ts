/**
 * V-NULL-CHECK-WHILE: While checks a null value by the check rule; false on null runs zero passes
 * Wireframe: none
 * Design Decisions: none (behavior per REQ-3.5.1.17)
 * REQ: REQ-3.1.3.25, REQ-3.5.1.17
 *
 * Seeds (API): test 1 - a blank zz- Test declaring `b_null` (boolean) and `f_null` (float) with no
 * value. Built through the UI: a While dropped under Start with the rows `b_null is false` OR
 * `f_null not null`, a Log dropped on its body lane and one on its then lane.
 * Tests 2 and 3 import a generated zz- Test (POST /tests): per cell a null variable of the type and
 * a While (while-do, at most 3 passes, index bound to `idx_<cell>` seeded 99) whose one condition
 * row is in the stored shape test 1 proves; its body is a Variable Setter writing a held value of
 * the type into the checked variable, then a Log `<cell> pass`; `then` chains the cells.
 *
 * Pass Criteria:
 * 1. The stored rows, OR between them, equal the generated rows.
 * 2. On null, `is false` OR `not null` is false: the body never runs and paints skipped, the then lane
 *    runs, the While paints success.
 * 3. For every type, `is null` holds on null: exactly one pass, the body writes the value, the
 *    check then fails, `idx_<cell>` reads 1.
 * 4. For every type, `not null` is false on null: zero passes, `idx_<cell>` reads 0, the variable
 *    stays null, the body Blocks never run and paint skipped.
 * 5. string / integer / float `not equals`, array `does not contain`, map `does not have key` and
 *    table `is empty` give one pass; boolean `is false` gives zero.
 * 6. Every While paints success and the run passes (no pass limit reached).
 */

import { test, expect } from '../../helpers/playwright-fixtures'
import { CHECK_BLOCK_PALETTE, conditionBody } from '../../helpers/condition-builder'
import { sessionValue } from '../../helpers/fixture-import'
import { controlNode, handleEdge } from '../../helpers/k8s-nodes'
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
  expectHeld,
  expectPaint,
  expectStillNull,
  generatedRows,
  heldSetter,
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
  type UiRow,
} from './routing-cells'

test.use({ viewport: LANE_VIEWPORT })

const ROWS: readonly UiRow[] = [
  { variable: 'b_null', type: 'boolean', check: { operator: 'is_false', label: 'is false', reference: null } },
  { variable: 'f_null', type: 'float', check: { operator: 'is_not_null', label: 'not null', reference: null } },
]

const GROUPS: ReadonlyArray<[string, readonly CheckType[]]> = [
  ['scalars', SCALAR_TYPES],
  ['collections', COLLECTION_TYPES],
]

/** A pass limit above the one pass a true-on-null row takes; reaching it fails the run. */
const MAX_PASSES = 3
const INDEX_SEED = 99

function indexVariable(c: RoutingCell): string {
  return `idx_${c.slug}`
}

function blockId(c: RoutingCell): string {
  return `wh-${c.id}`
}

function passText(c: RoutingCell): string {
  return `${c.name} pass`
}

/** One While per cell; the body writes the held value then logs a pass; `then` leads on. */
function whileGraph(cells: readonly RoutingCell[]): RoutingGraph {
  const graph: RoutingGraph = { nodes: [], edges: [], variables: {} }
  let from: Exit = { source: START }
  cells.forEach((c, index) => {
    const id = blockId(c)
    const y = index * 260
    graph.variables[checkedVariable(c)] = nullVariable(c.type)
    graph.variables[indexVariable(c)] = { value: INDEX_SEED, type: 'integer', scope: 'test' }
    graph.nodes.push(
      controlNode({
        id,
        label: 'While Loop',
        elementType: 'while',
        category: 'loop',
        description: c.name,
        values: {
          mode: 'while-do',
          conditions: [conditionRow(`${id}-c0`, checkedVariable(c), c.type, c.check)],
          max_iterations: MAX_PASSES,
        },
        outputBindings: { index: indexVariable(c) },
        position: { x: 300, y },
      }),
      heldSetter(`${id}-write`, c, { x: 550, y: y + 90 }),
      logBlock(`${id}-pass`, passText(c), { x: 550, y: y + 170 }),
    )
    graph.edges.push(
      linkFrom(from, id),
      handleEdge(id, 'body', `${id}-write`),
      linkFrom({ source: `${id}-write` }, `${id}-pass`),
    )
    from = { source: id, handle: 'then' }
  })
  return graph
}

test.describe('V-NULL-CHECK-WHILE: While on a null value', () => {
  const created: string[] = []

  test.afterAll(async ({ request }) => {
    for (const id of created) await deleteTest(request, id)
  })

  test('the sheet stores the rows the generator writes, and a check false on null runs zero passes', async ({
    page,
    request,
  }) => {
    test.setTimeout(240_000)
    const ids = { test: '', block: '', bodyLog: '', thenLog: '' }

    await test.step('a blank Test declaring b_null and f_null with no value', async () => {
      ids.test = await seedBlankTest(page, request, 'V-NULL-CHECK-WHILE ui', { b_null: 'boolean', f_null: 'float' })
      created.push(ids.test)
    })

    await test.step('While b_null is false OR f_null not null', async () => {
      ids.block = await dropUnderStart(page, CHECK_BLOCK_PALETTE.while)
      const sheet = await openConfig(page, ids.block)
      await buildRows(page, conditionBody(sheet, 'while'), ROWS, 'or')
      await saveConfig(sheet)
    })

    await test.step('a Log on the body lane and one on the then lane, then the toolbar Save', async () => {
      ids.bodyLog = await dropLaneLog(page, ids.block, 'body', 'ui pass')
      ids.thenLog = await dropLaneLog(page, ids.block, 'then', 'ui then')
      await saveCanvas(page)
    })

    await test.step('the stored rows are the generated rows', async () => {
      const values = await storedValues(request, ids.test, ids.block)
      expect(withoutIds(values.conditions)).toEqual(withoutIds(generatedRows(ROWS, 'or')))
    })

    const run = await test.step('Run', () => runRouting(page))

    await test.step('zero passes, then the then lane', async () => {
      expect(run.verdict, consoleDump(run)).toBe('passed')
      expect(linesWith(run, 'ui pass'), consoleDump(run)).toHaveLength(0)
      expect(linesWith(run, 'ui then'), consoleDump(run)).toHaveLength(1)
      expectPaint(run, ids.block, 'success', 'the While')
      expectPaint(run, ids.bodyLog, 'skipped', 'the body Log')
      expectPaint(run, ids.thenLog, 'success', 'the then Log')
    })
  })

  for (const [group, types] of GROUPS) {
    test(`${group}: is null, not null and the holds-nothing check decide the passes over a null ${types.join(', ')}`, async ({
      page,
    }) => {
      const cells = routingCells(types)
      created.push(await importGraph(page, `V-NULL-CHECK-WHILE ${group}`, whileGraph(cells)))
      const run = await runRouting(page)
      expect(run.verdict, consoleDump(run)).toBe('passed')

      for (const c of cells) {
        const passes = c.holds ? 1 : 0
        await test.step(`${c.name} runs ${passes} pass${passes === 1 ? '' : 'es'}`, () => {
          expect.soft(linesWith(run, passText(c)), `${c.name}: passes`).toHaveLength(passes)
          expect.soft(sessionValue(run.variables, indexVariable(c)), `${c.name}: index`).toBe(passes)
          expectPaint(run, blockId(c), 'success', c.name)
          for (const body of ['write', 'pass']) {
            expectPaint(run, `${blockId(c)}-${body}`, c.holds ? 'success' : 'skipped', `${c.name}: the body ${body} Block`)
          }
          if (c.holds) expectHeld(run, c)
          else expectStillNull(run, c)
        })
      }
    })
  }
})
