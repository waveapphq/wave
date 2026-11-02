/**
 * V-NULL-CHECK-ASSERT: a check treats null as holding nothing, every type and operator
 * Wireframe: none (functional)
 * Design Decisions: none
 * REQ: REQ-3.1.3.25, REQ-3.1.3.21
 *
 * Seeds (API): test 1 a blank zz- Test declaring `status` (string, null), `amount` (integer 5) and
 * `nothing` (integer, null); the five Asserts and their rows are built in the config sheet. Tests 2-10
 * import a generated zz- Test (one Single Assert per cell, built with `literalCondition` of
 * helpers/nesting-graph.ts, the row shape test 1 proves the sheet stores) and press Run. Every
 * Test is deleted after.
 *
 * Pass Criteria:
 * 1. Built in the sheet: on a null `status`, not equals 'done' and is null pass; equals 'done' and
 *    not null fail amber; the stored rows equal the generated row shape.
 * 2. A failing unary row prints `- status (string) is_not_null` then `actual: null`, never `None`.
 * 3. A compare-to expression giving null fails the Assert and names the checked variable:
 *    `The value compared with 'amount' is null`.
 * 4. For every type, every operator answers on a null value as the holds-nothing table says and on
 *    a held value as the value says: a true check paints success, a false one warning, none fails.
 * 5. is null and not null on a value of the wrong type ('abc' checked as integer) answer false and
 *    true with no error.
 * 6. A null compare-to value fails Assert, If/Else, Switch, While and Wait Until, names the checked
 *    variable, and nothing inside the block runs.
 */

import { test, expect, type Page } from '../../helpers/playwright-fixtures'
import { ensureEnvironment } from '../../helpers/config'
import { getTest } from '../../helpers/element-types'
import { createValidTest } from '../../helpers/fn-seed'
import {
  getActiveSessionId,
  getSessionVariables,
  importValidateAndNavigate,
  sessionValue,
} from '../../helpers/fixture-import'
import { expectNodeStatus, finishRun, startRun } from '../../helpers/k8s-run'
import {
  controlNode,
  edge,
  handleEdge,
  markerNode,
  stackNodes,
  tryCatchNode,
  type BranchHandle,
  type WorkflowEdge,
  type WorkflowNode,
} from '../../helpers/k8s-nodes'
import { expectConsoleLine, formatEntries, getLogCopyTexts, type LogEntry } from '../../helpers/log-reader'
import { literalCondition, type CheckValueType } from '../../helpers/nesting-graph'
import { runToEnd } from '../../helpers/workbench'
import { LANE_VIEWPORT, deleteTest, openLaneCanvas, saveCanvas } from '../canvas-lanes/lanes-helpers'
import { consoleEntriesFromCopy } from '../shell-blocks/shell-helpers'
import {
  assertChainFixture,
  buildAssertChain,
  expectCellStatuses,
  type CheckCell,
  type SheetRow,
} from './check-chain'

const SUMMARY = 'Assertion failed: 1 of 1 assertions failed'

function nullCompareTo(variable: string): string {
  return `The value compared with '${variable}' is null`
}

function token(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

async function consoleEntries(page: Page): Promise<LogEntry[]> {
  return consoleEntriesFromCopy(await getLogCopyTexts(page))
}

// ---------------------------------------------------------------------------
// The holds-nothing table and a held value per type
// ---------------------------------------------------------------------------

interface OperatorCase {
  operator: string
  reference: string | null
  /** Cell id suffix when one operator appears twice. */
  tag?: string
  onNull: boolean
  onHeld: boolean
}

interface TypeTable {
  type: CheckValueType
  held: unknown
  cases: readonly OperatorCase[]
}

const NULL_OPERATORS: readonly OperatorCase[] = [
  { operator: 'is_null', reference: null, onNull: true, onHeld: false },
  { operator: 'is_not_null', reference: null, onNull: false, onHeld: true },
]

function numberCases(held: number, below: string, above: string): OperatorCase[] {
  const at = String(held)
  return [
    { operator: 'equals', reference: at, onNull: false, onHeld: true },
    { operator: 'not_equals', reference: at, onNull: true, onHeld: false },
    { operator: 'less_than', reference: above, onNull: false, onHeld: true },
    { operator: 'greater_than', reference: below, onNull: false, onHeld: true },
    { operator: 'less_or_equal', reference: at, onNull: false, onHeld: true },
    { operator: 'greater_or_equal', reference: at, onNull: false, onHeld: true },
    ...NULL_OPERATORS,
  ]
}

const TABLES: readonly TypeTable[] = [
  { type: 'integer', held: 5, cases: numberCases(5, '4', '6') },
  { type: 'float', held: 2.5, cases: numberCases(2.5, '1.5', '3.5') },
  {
    type: 'string',
    held: 'abc',
    cases: [
      { operator: 'equals', reference: 'abc', onNull: false, onHeld: true },
      { operator: 'equals', reference: '', tag: 'empty', onNull: false, onHeld: false },
      { operator: 'not_equals', reference: 'abc', onNull: true, onHeld: false },
      { operator: 'not_equals', reference: '', tag: 'empty', onNull: true, onHeld: true },
      { operator: 'contains', reference: 'b', onNull: false, onHeld: true },
      { operator: 'does_not_contain', reference: 'b', onNull: true, onHeld: false },
      { operator: 'starts_with', reference: 'a', onNull: false, onHeld: true },
      { operator: 'ends_with', reference: 'c', onNull: false, onHeld: true },
      { operator: 'matches_regex', reference: '^a.c$', onNull: false, onHeld: true },
      { operator: 'matches_regex', reference: '^$', tag: 'empty', onNull: false, onHeld: false },
      ...NULL_OPERATORS,
    ],
  },
  {
    type: 'boolean',
    held: true,
    cases: [
      { operator: 'is_true', reference: null, onNull: false, onHeld: true },
      { operator: 'is_false', reference: null, onNull: false, onHeld: false },
      ...NULL_OPERATORS,
    ],
  },
  {
    type: 'array',
    held: [1, 2, 3],
    cases: [
      { operator: 'contains', reference: '2', onNull: false, onHeld: true },
      { operator: 'does_not_contain', reference: '2', onNull: true, onHeld: false },
      { operator: 'is_empty', reference: null, onNull: true, onHeld: false },
      { operator: 'is_not_empty', reference: null, onNull: false, onHeld: true },
      { operator: 'length_equals', reference: '0', tag: 'zero', onNull: true, onHeld: false },
      { operator: 'length_equals', reference: '3', tag: 'three', onNull: false, onHeld: true },
      ...NULL_OPERATORS,
    ],
  },
  {
    type: 'map',
    held: { k: 1 },
    cases: [
      { operator: 'has_key', reference: 'k', onNull: false, onHeld: true },
      { operator: 'does_not_have_key', reference: 'k', onNull: true, onHeld: false },
      { operator: 'is_empty', reference: null, onNull: true, onHeld: false },
      { operator: 'is_not_empty', reference: null, onNull: false, onHeld: true },
      ...NULL_OPERATORS,
    ],
  },
  {
    type: 'table',
    held: { columns: [{ name: 'host', type: 'string' }], rows: [['web'], ['db']] },
    cases: [
      ...NULL_OPERATORS,
      { operator: 'is_empty', reference: null, onNull: true, onHeld: false },
      { operator: 'is_not_empty', reference: null, onNull: false, onHeld: true },
    ],
  },
]

function cellsOf(table: TypeTable): CheckCell[] {
  return table.cases.flatMap((c) => {
    const name = c.tag ? `${c.operator}-${c.tag}` : c.operator
    return [
      { id: `${table.type}-null-${name}`, variable: `n_${table.type}`, valueType: table.type, operator: c.operator, reference: c.reference, holds: c.onNull },
      { id: `${table.type}-held-${name}`, variable: `h_${table.type}`, valueType: table.type, operator: c.operator, reference: c.reference, holds: c.onHeld },
    ]
  })
}

// ---------------------------------------------------------------------------
// Test 10: one check block of each kind with a null compare-to value, each on its own Try path
// ---------------------------------------------------------------------------

interface NullCompareCase {
  id: string
  name: string
  variable: string
  /** The block's values around its one condition row. */
  values: (row: Record<string, unknown>) => Record<string, unknown>
  elementType: string
  category: string
  /** Lanes that must never run. */
  lanes: BranchHandle[]
}

const NULL_COMPARE_CASES: readonly NullCompareCase[] = [
  {
    id: 'm1-assert',
    name: 'Assert',
    variable: 'm1_assert',
    elementType: 'assert',
    category: 'flow',
    values: (row) => ({ assertions: [row], mode: 'single', fail_current_scope: false }),
    lanes: [],
  },
  {
    id: 'm1-if-else',
    name: 'If/Else',
    variable: 'm1_if_else',
    elementType: 'if-else',
    category: 'conditional',
    values: (row) => ({
      branches: [
        { id: 'branch_0', type: 'if', label: 'if', conditions: [row] },
        { id: 'branch_1', type: 'else', label: 'else' },
      ],
    }),
    lanes: ['branch_0', 'branch_1'],
  },
  {
    id: 'm1-switch',
    name: 'Switch',
    variable: 'm1_switch',
    elementType: 'switch-case',
    category: 'conditional',
    values: (row) => ({
      branches: [
        { id: 'branch_0', type: 'case', label: 'hit', break: true, conditions: [row] },
        { id: 'branch_1', type: 'default', label: 'default' },
      ],
    }),
    lanes: ['branch_0', 'branch_1'],
  },
  {
    id: 'm1-while',
    name: 'While',
    variable: 'm1_while',
    elementType: 'while',
    category: 'loop',
    values: (row) => ({ mode: 'while-do', conditions: [row], max_iterations: 2 }),
    lanes: ['body'],
  },
  {
    id: 'm1-wait-until',
    name: 'Wait Until',
    variable: 'm1_wait_until',
    elementType: 'wait-until',
    category: 'timing',
    values: (row) => ({
      conditions: [row],
      timeout: 5000,
      check_interval: 200,
      message: 'm1-wait-until gave up',
      mode: 'watch',
      fail_current_scope: false,
    }),
    lanes: [],
  },
]

const NULL_COMPARE_DONE = 'null-compare-to-done'

function errorVar(c: NullCompareCase): string {
  return `err_${c.variable}`
}

function nullCompareFixture(): Record<string, unknown> {
  const main: WorkflowNode[] = []
  const side: WorkflowNode[] = []
  const edges: WorkflowEdge[] = []
  const variables: Record<string, unknown> = { nothing: { type: 'integer', scope: 'test', value: null } }
  let previous = 'start-node'
  for (const c of NULL_COMPARE_CASES) {
    const guard = `tc-${c.id}`
    // Per REQ-3.1.3.21: the compare-to value is a setting; an expression giving null fails the block.
    const row = { ...literalCondition(`${c.id}-row`, c.variable, 'integer', 'equals', 'nothing'), reference_is_expression: true }
    main.push(tryCatchNode({ id: guard, description: guard, errorBinding: errorVar(c) }))
    side.push(
      controlNode({ id: c.id, label: c.id, elementType: c.elementType, category: c.category, description: c.name, values: c.values(row) }),
      markerNode({ id: `${c.id}-caught`, description: 'catch', text: `caught ${c.id}` }),
      ...c.lanes.map((lane) => markerNode({ id: `${c.id}-${lane}`, description: lane, text: `${c.id} ran ${lane}` })),
    )
    edges.push(
      previous === 'start-node' ? { id: `edge-start-${guard}`, source: previous, target: guard } : handleEdge(previous, 'then', guard),
      handleEdge(guard, 'try', c.id),
      handleEdge(guard, 'catch', `${c.id}-caught`),
      ...c.lanes.map((lane) => handleEdge(c.id, lane, `${c.id}-${lane}`)),
    )
    variables[c.variable] = { type: 'integer', scope: 'test', value: 5 }
    variables[errorVar(c)] = { type: 'map', scope: 'test', value: null }
    previous = guard
  }
  const done = markerNode({ id: 'm1-done', description: 'bookend', text: NULL_COMPARE_DONE })
  main.push(done)
  edges.push(handleEdge(previous, 'then', done.id))
  return {
    name: 'zz-V-NULL-CHECK-ASSERT null compare-to',
    version: '1.0.0',
    description: 'A null compare-to value in each check block',
    workflow: { nodes: [...stackNodes(main), ...stackNodes(side, { x: 600 })], edges },
    variables,
    metadata: {},
  }
}

// ---------------------------------------------------------------------------

test.describe('V-NULL-CHECK-ASSERT: null holds nothing in every check', () => {
  test.use({ viewport: LANE_VIEWPORT })

  let testId: string | undefined

  test.afterEach(async ({ request }) => {
    await deleteTest(request, testId)
    testId = undefined
  })

  test('an Assert built in the sheet answers a null value as holding nothing and stores the generated row shape', async ({
    page,
    request,
  }) => {
    const rows: Array<SheetRow & { type: CheckValueType; status: string }> = [
      { variable: 'status', type: 'string', operator: 'not equals', reference: 'done', status: 'success' },
      { variable: 'status', type: 'string', operator: 'equals', reference: 'done', status: 'warning' },
      { variable: 'status', type: 'string', operator: 'is null', status: 'success' },
      { variable: 'status', type: 'string', operator: 'not null', status: 'warning' },
      { variable: 'amount', type: 'integer', operator: 'equals', expression: 'nothing', status: 'failed' },
    ]
    const wire: Record<string, string> = { 'not equals': 'not_equals', equals: 'equals', 'is null': 'is_null', 'not null': 'is_not_null' }
    let ids: string[] = []
    const names: string[] = []

    await test.step('a blank Test with status and nothing null and amount 5', async () => {
      await ensureEnvironment(request)
      testId = await createValidTest(request, {
        name: `zz-V-NULL-CHECK-ASSERT sheet ${token()}`,
        nodes: [],
        variables: {
          status: { type: 'string', scope: 'test', value: null },
          amount: { type: 'integer', scope: 'test', value: 5 },
          nothing: { type: 'integer', scope: 'test', value: null },
        },
      })
      await openLaneCanvas(page, testId)
    })

    await test.step('five Single Asserts built in the sheet, in a chain under Start', async () => {
      ids = await buildAssertChain(page, rows)
      await saveCanvas(page)
    })

    await test.step('each stored row has the shape the generated checks use', async () => {
      const stored = await getTest(request, testId!)
      for (const [index, row] of rows.entries()) {
        const node = (stored.workflow.nodes as Array<Record<string, any>>).find((n) => n.id === ids[index])
        names[index] = String(node?.data.label)
        const values = node?.data.config?.values ?? {}
        expect(values.mode, `Assert ${index} is Single`).toBe('single')
        const saved = values.assertions?.[0] as Record<string, unknown>
        const reference = row.reference ?? row.expression ?? null
        const expected = literalCondition(String(saved?.id), row.variable, row.type, wire[row.operator], reference)
        if (row.expression !== undefined) expected.reference_is_expression = true
        expect({ ...saved, reference_value: saved?.reference_value ?? null }, `stored row ${index}`).toEqual(expected)
      }
    })

    const run = await test.step('Run', async () => runToEnd(page))
    const entries = await consoleEntries(page)
    const consoleText = formatEntries(entries)

    await test.step('not equals and is null hold on null; equals and not null fail amber', async () => {
      for (const [index, row] of rows.slice(0, 4).entries()) {
        await expect(page.getByTestId(`workflow-node-${ids[index]}`), `${row.operator}\n${consoleText}`).toHaveAttribute(
          'data-execution-status',
          row.status,
        )
      }
    })

    await test.step('the failing not null row prints actual: null, never None', () => {
      const at = entries.findIndex((e) => e.message === '- status (string) is_not_null')
      expect(at, consoleText).toBeGreaterThan(0)
      expect(entries.slice(at - 1, at + 2).map((e) => [e.level, e.message]), consoleText).toEqual([
        ['WARN', SUMMARY],
        ['WARN', '- status (string) is_not_null'],
        ['WARN', 'actual: null'],
      ])
      expect(entries.filter((e) => /\bNone\b/.test(e.message)), 'no line prints None').toEqual([])
    })

    await test.step('a compare-to expression giving null fails the Assert and names amount', async () => {
      await expectNodeStatus(page, ids[4], 'failed')
      expect(run.verdict, consoleText).toBe('failed')
      expectConsoleLine(entries, 'ERROR', `Block '${names[4]}' failed: ${nullCompareTo('amount')}`)
    })
  })

  for (const table of TABLES) {
    test(`${table.type}: every operator on a null and on a held value answers as the holds-nothing table says`, async ({
      page,
    }) => {
      const cells = cellsOf(table)
      const bookend = `null-check-assert-${table.type}-done`
      const fixture = assertChainFixture(
        `zz-V-NULL-CHECK-ASSERT ${table.type}`,
        cells,
        {
          [`n_${table.type}`]: { type: table.type, scope: 'test', value: null },
          [`h_${table.type}`]: { type: table.type, scope: 'test', value: table.held },
        },
        bookend,
      )
      testId = await importValidateAndNavigate(page, fixture)
      await finishRun(page, await startRun(page), bookend)
      // Per REQ-3.1.3.25: a true check paints success, a false one warning; none fails the block.
      await expectCellStatuses(page, cells)
    })
  }

  test('is null and not null on a wrong-typed value answer with no error', async ({ page }) => {
    const cells: CheckCell[] = [
      { id: 'wrong-type-is_null', variable: 'code_text', valueType: 'integer', operator: 'is_null', reference: null, holds: false },
      { id: 'wrong-type-is_not_null', variable: 'code_text', valueType: 'integer', operator: 'is_not_null', reference: null, holds: true },
    ]
    const bookend = 'null-check-assert-wrong-type-done'
    testId = await importValidateAndNavigate(
      page,
      assertChainFixture('zz-V-NULL-CHECK-ASSERT wrong type', cells, { code_text: { type: 'string', scope: 'test', value: 'abc' } }, bookend),
    )
    await finishRun(page, await startRun(page), bookend)
    await expectCellStatuses(page, cells)
    const entries = await consoleEntries(page)
    expect(entries.filter((e) => e.message.includes('Cannot coerce')), formatEntries(entries)).toEqual([])
  })

  test('a null compare-to value fails Assert, If/Else, Switch, While and Wait Until and names the checked variable', async ({
    page,
  }) => {
    testId = await importValidateAndNavigate(page, nullCompareFixture())
    await finishRun(page, await startRun(page), NULL_COMPARE_DONE)
    const entries = await consoleEntries(page)
    const consoleText = formatEntries(entries)
    const variables = await getSessionVariables(page, await getActiveSessionId(page))

    for (const c of NULL_COMPARE_CASES) {
      await test.step(`${c.name} fails and names ${c.variable}`, async () => {
        const message = nullCompareTo(c.variable)
        await expectNodeStatus(page, c.id, 'failed')
        const caught = sessionValue(variables, errorVar(c)) as { message?: string; node_id?: string }
        expect(caught?.message, consoleText).toBe(message)
        expect(caught?.node_id, `${c.name} itself failed`).toBe(c.id)
        expectConsoleLine(entries, 'ERROR', `Block '${c.id}' failed: ${message}`)
        expectConsoleLine(entries, 'INFO', `caught ${c.id}`)
        for (const lane of c.lanes) {
          expect(entries.some((e) => e.message === `${c.id} ran ${lane}`), `${c.name} never runs its ${lane} lane`).toBe(false)
        }
      })
    }
  })
})
