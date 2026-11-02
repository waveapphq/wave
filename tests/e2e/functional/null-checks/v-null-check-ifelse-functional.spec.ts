/**
 * V-NULL-CHECK-IFELSE: If/Else routes a null value by the check rule
 * Wireframe: none
 * Design Decisions: none
 * REQ: REQ-3.1.3.25, REQ-3.5.1.1, REQ-3.5.1.6
 *
 * Seeds (API): test 1 - a blank zz- Test declaring `i_null` (integer) and `s_null` (string) with no
 * value. Built through the UI: an If/Else dropped under Start, its If branch `i_null not null`, an
 * Else If branch added with `s_null not equals x`, a Log dropped on each of its three lanes.
 * Tests 2 and 3 import a generated zz- Test (POST /tests): per cell a null variable of the type and
 * an If/Else whose If branch holds the cell's one condition row in the stored shape test 1 proves;
 * a Variable Setter on each lane writes `route_<cell>` = `if` / `else`; both lanes rejoin into the
 * next cell.
 *
 * Pass Criteria:
 * 1. The stored If and Else If rows equal the generated rows (variable, value type, operator,
 *    compare-to value, expression flag).
 * 2. On null, `not null` is not taken and `not equals x` is: only the Else If Log prints, the If
 *    and Else Logs never run (no status).
 * 3. For every type, `is null` takes the If branch: the `Branch taken` line names it, the If lane
 *    runs, `route_<cell>` reads `if`.
 * 4. For every type, `not null` takes Else.
 * 5. string / integer / float `not equals`, array `does not contain`, map `does not have key` and
 *    table `is empty` take If on null; boolean `is false` takes Else.
 * 6. The checked variable stays null, every If/Else paints success and the run passes.
 */

import { test, expect } from '../../helpers/playwright-fixtures'
import { CHECK_BLOCK_PALETTE, openConditionBody } from '../../helpers/condition-builder'
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
  expectPaint,
  expectStillNull,
  generatedRows,
  importGraph,
  linesWith,
  linkFrom,
  nullVariable,
  routeSetter,
  routingCells,
  runRouting,
  seedBlankTest,
  storedValues,
  stringVariable,
  withoutIds,
  type CheckType,
  type Exit,
  type RoutingCell,
  type RoutingGraph,
  type UiRow,
} from './routing-cells'

test.use({ viewport: LANE_VIEWPORT })

const IF_ROW: UiRow = { variable: 'i_null', type: 'integer', check: { operator: 'is_not_null', label: 'not null', reference: null } }
const ELIF_ROW: UiRow = { variable: 's_null', type: 'string', check: { operator: 'not_equals', label: 'not equals', reference: 'x' } }

const GROUPS: ReadonlyArray<[string, readonly CheckType[]]> = [
  ['scalars', SCALAR_TYPES],
  ['collections', COLLECTION_TYPES],
]

function routeVariable(c: RoutingCell): string {
  return `route_${c.slug}`
}

function blockId(c: RoutingCell): string {
  return `ie-${c.id}`
}

/** One If/Else per cell; both lanes rejoin into the next cell's If/Else. */
function ifElseGraph(cells: readonly RoutingCell[]): RoutingGraph {
  const graph: RoutingGraph = { nodes: [], edges: [], variables: {} }
  let incoming: Exit[] = [{ source: START }]
  cells.forEach((c, index) => {
    const id = blockId(c)
    const y = index * 240
    graph.variables[checkedVariable(c)] = nullVariable(c.type)
    graph.variables[routeVariable(c)] = stringVariable('none')
    graph.nodes.push(
      controlNode({
        id,
        label: 'If/Else',
        elementType: 'if-else',
        category: 'conditional',
        description: c.name,
        values: {
          branches: [
            {
              type: 'if',
              id: 'branch_0',
              label: `${c.name} if`,
              conditions: [conditionRow(`${id}-c0`, checkedVariable(c), c.type, c.check)],
            },
            { type: 'else', id: 'branch_1', label: `${c.name} else` },
          ],
        },
        position: { x: 300, y },
      }),
      routeSetter(`${id}-if`, routeVariable(c), 'if', { x: 100, y: y + 110 }),
      routeSetter(`${id}-else`, routeVariable(c), 'else', { x: 500, y: y + 110 }),
    )
    // A second link into one Block lands on its own ingress handle, as the canvas draws it.
    incoming.forEach((from, i) => {
      const link = linkFrom(from, id)
      graph.edges.push(i === 0 ? link : { ...link, targetHandle: `ingress_${i}` })
    })
    graph.edges.push(handleEdge(id, 'branch_0', `${id}-if`), handleEdge(id, 'branch_1', `${id}-else`))
    incoming = [{ source: `${id}-if` }, { source: `${id}-else` }]
  })
  return graph
}

test.describe('V-NULL-CHECK-IFELSE: If/Else on a null value', () => {
  const created: string[] = []

  test.afterAll(async ({ request }) => {
    for (const id of created) await deleteTest(request, id)
  })

  test('the sheet stores the rows the generator writes, and a null takes the Else If lane', async ({ page, request }) => {
    test.setTimeout(240_000)
    const ids = { test: '', block: '', ifLog: '', elifLog: '', elseLog: '' }

    await test.step('a blank Test declaring i_null and s_null with no value', async () => {
      ids.test = await seedBlankTest(page, request, 'V-NULL-CHECK-IFELSE ui', { i_null: 'integer', s_null: 'string' })
      created.push(ids.test)
    })

    await test.step('If i_null not null, Else If s_null not equals x, Else', async () => {
      ids.block = await dropUnderStart(page, CHECK_BLOCK_PALETTE['if-else'])
      const sheet = await openConfig(page, ids.block)
      await buildRows(page, await openConditionBody(sheet, 'if-else', 'branch_0'), [IF_ROW])
      await sheet.locator('[data-testid="add-else-if-button"]').click()
      await buildRows(page, await openConditionBody(sheet, 'if-else', 'branch_2'), [ELIF_ROW])
      await saveConfig(sheet)
    })

    await test.step('a Log on each lane, then the toolbar Save', async () => {
      ids.ifLog = await dropLaneLog(page, ids.block, 'branch_0', 'ui if')
      ids.elifLog = await dropLaneLog(page, ids.block, 'branch_2', 'ui else if')
      ids.elseLog = await dropLaneLog(page, ids.block, 'branch_1', 'ui else')
      await saveCanvas(page)
    })

    await test.step('the stored rows are the generated rows', async () => {
      const branches = (await storedValues(request, ids.test, ids.block)).branches as Array<Record<string, unknown>>
      expect(branches.map((b) => [b.id, b.type])).toEqual([
        ['branch_0', 'if'],
        ['branch_2', 'else_if'],
        ['branch_1', 'else'],
      ])
      expect(withoutIds(branches[0].conditions), 'the If row').toEqual(withoutIds(generatedRows([IF_ROW])))
      expect(withoutIds(branches[1].conditions), 'the Else If row').toEqual(withoutIds(generatedRows([ELIF_ROW])))
    })

    const run = await test.step('Run', () => runRouting(page))

    await test.step('not null skips a null, not equals x catches it', async () => {
      expect(run.verdict, consoleDump(run)).toBe('passed')
      expect(linesWith(run, 'ui else if'), consoleDump(run)).toHaveLength(1)
      expect(linesWith(run, 'ui if'), consoleDump(run)).toHaveLength(0)
      expect(linesWith(run, 'ui else'), consoleDump(run)).toHaveLength(0)
      expectPaint(run, ids.block, 'success', 'the If/Else')
      expectPaint(run, ids.elifLog, 'success', 'the Else If lane')
      expectPaint(run, ids.ifLog, null, 'the If lane')
      expectPaint(run, ids.elseLog, null, 'the Else lane')
    })
  })

  for (const [group, types] of GROUPS) {
    test(`${group}: is null, not null and the holds-nothing check route a null ${types.join(', ')}`, async ({ page }) => {
      const cells = routingCells(types)
      created.push(await importGraph(page, `V-NULL-CHECK-IFELSE ${group}`, ifElseGraph(cells)))
      const run = await runRouting(page)
      expect(run.verdict, consoleDump(run)).toBe('passed')

      for (const c of cells) {
        await test.step(`${c.name} ${c.holds ? 'takes If' : 'takes Else'}`, () => {
          const [taken, other] = c.holds ? ['if', 'else'] : ['else', 'if']
          expect.soft(linesWith(run, `Branch taken: ${c.name} ${taken}`), `${c.name}: the ${taken} branch is taken`).toHaveLength(1)
          expect.soft(linesWith(run, `Branch taken: ${c.name} ${other}`), `${c.name}: the ${other} branch is not taken`).toHaveLength(0)
          expectPaint(run, blockId(c), 'success', c.name)
          expectPaint(run, `${blockId(c)}-${taken}`, 'success', `${c.name}: the ${taken} lane`)
          expectPaint(run, `${blockId(c)}-${other}`, null, `${c.name}: the ${other} lane`)
          expect.soft(sessionValue(run.variables, routeVariable(c)), `${c.name}: route`).toBe(taken)
          expectStillNull(run, c)
        })
      }
    })
  }
})
