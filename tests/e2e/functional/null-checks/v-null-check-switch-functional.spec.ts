/**
 * V-NULL-CHECK-SWITCH: Switch case conditions route a null value; a null falls to Default unless a case catches it
 * Wireframe: none
 * Design Decisions: none (behavior per REQ-3.5.1.20)
 * REQ: REQ-3.1.3.25, REQ-3.5.1.20
 *
 * Seeds (API): test 1 - a blank zz- Test declaring `m_null` (map) and `t_null` (table) with no
 * value. Built through the UI: a Switch dropped under Start, its first case `m_null has key k`, a
 * second case added with `t_null is empty`, a Default added, a Log dropped on each case and on
 * the Default lane.
 * Tests 2 and 3 import a generated zz- Test (POST /tests): per cell a null variable of the type and
 * a Switch with a first case that is false on null (equals / is true / contains / has key / is not
 * empty), a second case holding the cell's one condition row in the stored shape test 1 proves, and
 * a Default; each lane is a Variable Setter writing `route_<cell>` = `miss` / `case` / `default`;
 * `then` chains the cells.
 *
 * Pass Criteria:
 * 1. The stored case rows equal the generated rows, the cases and the Default in the built order.
 * 2. On null, `has key k` does not catch it and `is empty` does: only the second case's Log prints,
 *    the first case and the Default paint skipped.
 * 3. For every type, a first case that is false on null never catches the null.
 * 4. For every type, an `is null` case catches it: the `Branch taken` line names that case and
 *    `route_<cell>` reads `case`.
 * 5. For every type, a `not null` case does not: the null falls to Default.
 * 6. string / integer / float `not equals`, array `does not contain`, map `does not have key` and
 *    table `is empty` cases catch the null; a boolean `is false` case does not.
 * 7. The checked variable stays null, every Switch paints success and the run passes.
 */

import { test, expect } from '../../helpers/playwright-fixtures'
import { CHECK_BLOCK_PALETTE, addSwitchCase, addSwitchDefault, openConditionBody } from '../../helpers/condition-builder'
import { sessionValue } from '../../helpers/fixture-import'
import { controlNode, handleEdge } from '../../helpers/k8s-nodes'
import { LANE_VIEWPORT, deleteTest, openConfig, saveCanvas, saveConfig } from '../canvas-lanes/lanes-helpers'
import { dropUnderStart } from './check-chain'
import {
  COLLECTION_TYPES,
  MISS_ON_NULL,
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

const FIRST_CASE: UiRow = { variable: 'm_null', type: 'map', check: MISS_ON_NULL.map }
const SECOND_CASE: UiRow = { variable: 't_null', type: 'table', check: { operator: 'is_empty', label: 'is empty', reference: null } }

const GROUPS: ReadonlyArray<[string, readonly CheckType[]]> = [
  ['scalars', SCALAR_TYPES],
  ['collections', COLLECTION_TYPES],
]

const LANES = ['miss', 'case', 'default'] as const

function routeVariable(c: RoutingCell): string {
  return `route_${c.slug}`
}

function blockId(c: RoutingCell): string {
  return `sw-${c.id}`
}

/** One Switch per cell: a case false on null, the cell's case, the Default; `then` leads on. */
function switchGraph(cells: readonly RoutingCell[]): RoutingGraph {
  const graph: RoutingGraph = { nodes: [], edges: [], variables: {} }
  let from: Exit = { source: START }
  cells.forEach((c, index) => {
    const id = blockId(c)
    const y = index * 240
    const variable = checkedVariable(c)
    graph.variables[variable] = nullVariable(c.type)
    graph.variables[routeVariable(c)] = stringVariable('none')
    graph.nodes.push(
      controlNode({
        id,
        label: 'Switch',
        elementType: 'switch-case',
        category: 'conditional',
        description: c.name,
        values: {
          branches: [
            {
              id: 'branch_0',
              type: 'case',
              label: `${c.name} miss`,
              conditions: [conditionRow(`${id}-c0`, variable, c.type, MISS_ON_NULL[c.type])],
              break: true,
            },
            {
              id: 'branch_1',
              type: 'case',
              label: `${c.name} case`,
              conditions: [conditionRow(`${id}-c1`, variable, c.type, c.check)],
              break: true,
            },
            { id: 'branch_2', type: 'default', label: `${c.name} default` },
          ],
        },
        position: { x: 300, y },
      }),
    )
    LANES.forEach((lane, i) => {
      graph.nodes.push(routeSetter(`${id}-${lane}`, routeVariable(c), lane, { x: 50 + i * 250, y: y + 110 }))
      graph.edges.push(handleEdge(id, `branch_${i}`, `${id}-${lane}`))
    })
    graph.edges.push(linkFrom(from, id))
    from = { source: id, handle: 'then' }
  })
  return graph
}

test.describe('V-NULL-CHECK-SWITCH: Switch cases on a null value', () => {
  const created: string[] = []

  test.afterAll(async ({ request }) => {
    for (const id of created) await deleteTest(request, id)
  })

  test('the sheet stores the rows the generator writes, and a null passes a case that cannot catch it', async ({
    page,
    request,
  }) => {
    test.setTimeout(240_000)
    const ids = { test: '', block: '', firstLog: '', secondLog: '', defaultLog: '' }

    await test.step('a blank Test declaring m_null and t_null with no value', async () => {
      ids.test = await seedBlankTest(page, request, 'V-NULL-CHECK-SWITCH ui', { m_null: 'map', t_null: 'table' })
      created.push(ids.test)
    })

    await test.step('case m_null has key k, case t_null is empty, Default', async () => {
      ids.block = await dropUnderStart(page, CHECK_BLOCK_PALETTE.switch)
      const sheet = await openConfig(page, ids.block)
      await buildRows(page, await openConditionBody(sheet, 'switch', 'branch_0'), [FIRST_CASE])
      await buildRows(page, await addSwitchCase(sheet, 'branch_1'), [SECOND_CASE])
      await addSwitchDefault(sheet, 'branch_2')
      await saveConfig(sheet)
    })

    await test.step('a Log on each case lane and on the Default lane, then the toolbar Save', async () => {
      ids.firstLog = await dropLaneLog(page, ids.block, 'branch_0', 'ui first case')
      ids.secondLog = await dropLaneLog(page, ids.block, 'branch_1', 'ui second case')
      ids.defaultLog = await dropLaneLog(page, ids.block, 'branch_2', 'ui default')
      await saveCanvas(page)
    })

    await test.step('the stored rows are the generated rows', async () => {
      const branches = (await storedValues(request, ids.test, ids.block)).branches as Array<Record<string, unknown>>
      expect(branches.map((b) => [b.id, b.type])).toEqual([
        ['branch_0', 'case'],
        ['branch_1', 'case'],
        ['branch_2', 'default'],
      ])
      expect(withoutIds(branches[0].conditions), 'the first case row').toEqual(withoutIds(generatedRows([FIRST_CASE])))
      expect(withoutIds(branches[1].conditions), 'the second case row').toEqual(withoutIds(generatedRows([SECOND_CASE])))
    })

    const run = await test.step('Run', () => runRouting(page))

    await test.step('has key passes the null by, is empty catches it', async () => {
      expect(run.verdict, consoleDump(run)).toBe('passed')
      expect(linesWith(run, 'ui second case'), consoleDump(run)).toHaveLength(1)
      expect(linesWith(run, 'ui first case'), consoleDump(run)).toHaveLength(0)
      expect(linesWith(run, 'ui default'), consoleDump(run)).toHaveLength(0)
      expectPaint(run, ids.block, 'success', 'the Switch')
      expectPaint(run, ids.secondLog, 'success', 'the second case lane')
      expectPaint(run, ids.firstLog, 'skipped', 'the first case lane')
      expectPaint(run, ids.defaultLog, 'skipped', 'the Default lane')
    })
  })

  for (const [group, types] of GROUPS) {
    test(`${group}: is null, not null and the holds-nothing case route a null ${types.join(', ')}`, async ({ page }) => {
      const cells = routingCells(types)
      created.push(await importGraph(page, `V-NULL-CHECK-SWITCH ${group}`, switchGraph(cells)))
      const run = await runRouting(page)
      expect(run.verdict, consoleDump(run)).toBe('passed')

      for (const c of cells) {
        await test.step(`${c.name} ${c.holds ? 'is caught by its case' : 'falls to Default'}`, () => {
          const taken = c.holds ? 'case' : 'default'
          for (const lane of LANES) {
            const runs = lane === taken
            expect
              .soft(linesWith(run, `Branch taken: ${c.name} ${lane}`), `${c.name}: the ${lane} lane ${runs ? 'is' : 'is not'} taken`)
              .toHaveLength(runs ? 1 : 0)
            expectPaint(run, `${blockId(c)}-${lane}`, runs ? 'success' : 'skipped', `${c.name}: the ${lane} lane`)
          }
          expectPaint(run, blockId(c), 'success', c.name)
          expect.soft(sessionValue(run.variables, routeVariable(c)), `${c.name}: route`).toBe(taken)
          expectStillNull(run, c)
        })
      }
    })
  }
})
