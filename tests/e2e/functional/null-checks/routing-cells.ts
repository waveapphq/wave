/** Matrix 2c: a null value of every type routed by If/Else, Switch, While and Wait Until (REQ-3.1.3.25). */

import { expect, type APIRequestContext, type Locator, type Page } from '../../helpers/playwright-fixtures'
import { ensureEnvironment } from '../../helpers/config'
import {
  addLiteralRow,
  pickConditionVariable,
  pickOperator,
  rowPath,
  setReference,
  setRootJoiner,
} from '../../helpers/condition-builder'
import { getNode } from '../../helpers/element-types'
import {
  getActiveSessionId,
  getSessionVariables,
  importValidateAndNavigate,
  sessionTable,
  sessionValue,
  type SessionVariables,
} from '../../helpers/fixture-import'
import { createValidTest } from '../../helpers/fn-seed'
import {
  controlNode,
  edge,
  handleEdge,
  markerNode,
  type BranchHandle,
  type NodePosition,
  type WorkflowEdge,
  type WorkflowNode,
} from '../../helpers/k8s-nodes'
import { formatEntries, type LogEntry } from '../../helpers/log-reader'
import { literalCondition } from '../../helpers/nesting-graph'
import { runToEnd, selectEnvironment } from '../../helpers/workbench'
import { openLaneCanvas, setLogText } from '../canvas-lanes/lanes-helpers'
import { dropUnder } from './check-chain'

export type CheckType = 'string' | 'integer' | 'float' | 'boolean' | 'array' | 'map' | 'table'

export const SCALAR_TYPES: readonly CheckType[] = ['string', 'integer', 'float', 'boolean']
export const COLLECTION_TYPES: readonly CheckType[] = ['array', 'map', 'table']

export const START = 'start-node'

/** One literal row: its operator wire name, its label in the operator select, its compare-to text. */
export interface Check {
  operator: string
  label: string
  reference: string | null
}

export interface RoutingCell {
  /** Unique within a run, e.g. `string-is-null`; prefixes every Block id of the cell. */
  id: string
  /** Variable-name form of `id`. */
  slug: string
  /** Console form, e.g. `string is null`. */
  name: string
  type: CheckType
  check: Check
  /** The check's answer on a null value. */
  holds: boolean
}

const IS_NULL: Check = { operator: 'is_null', label: 'is null', reference: null }
const NOT_NULL: Check = { operator: 'is_not_null', label: 'not null', reference: null }

// Per REQ-3.1.3.25: one operator per type that answers a null value without `is null`.
const HOLDS_NOTHING: Readonly<Record<CheckType, Check & { holds: boolean }>> = {
  string: { operator: 'not_equals', label: 'not equals', reference: 'x', holds: true },
  integer: { operator: 'not_equals', label: 'not equals', reference: '5', holds: true },
  float: { operator: 'not_equals', label: 'not equals', reference: '1.5', holds: true },
  boolean: { operator: 'is_false', label: 'is false', reference: null, holds: false },
  array: { operator: 'does_not_contain', label: 'does not contain', reference: 'x', holds: true },
  map: { operator: 'does_not_have_key', label: 'does not have key', reference: 'k', holds: true },
  table: { operator: 'is_empty', label: 'is empty', reference: null, holds: true },
}

/** A check that is false on null, so a Switch case holding it never catches a null (REQ-3.5.1.20). */
export const MISS_ON_NULL: Readonly<Record<CheckType, Check>> = {
  string: { operator: 'equals', label: 'equals', reference: 'x' },
  integer: { operator: 'equals', label: 'equals', reference: '5' },
  float: { operator: 'equals', label: 'equals', reference: '1.5' },
  boolean: { operator: 'is_true', label: 'is true', reference: null },
  array: { operator: 'contains', label: 'contains', reference: 'x' },
  map: { operator: 'has_key', label: 'has key', reference: 'k' },
  table: { operator: 'is_not_empty', label: 'is not empty', reference: null },
}

/** A held value per type, as a Variable Setter expression; once written, every true-on-null row of the type is false. */
export const HELD_VALUE: Readonly<Record<CheckType, string>> = {
  string: "'x'",
  integer: '5',
  float: '1.5',
  boolean: 'True',
  array: "['x']",
  map: "{'k': 1}",
  table: "Table.from_list([{'id': 1}])",
}

function cell(type: CheckType, check: Check, holds: boolean): RoutingCell {
  const id = `${type}-${check.label.replace(/ /g, '-')}`
  return { id, slug: id.replace(/-/g, '_'), name: `${type} ${check.label}`, type, check, holds }
}

/** The three rows of matrix 2c for each type, in type order. */
export function routingCells(types: readonly CheckType[]): RoutingCell[] {
  return types.flatMap((type) => {
    const { holds, ...check } = HOLDS_NOTHING[type]
    return [cell(type, IS_NULL, true), cell(type, NOT_NULL, false), cell(type, check, holds)]
  })
}

/** A Test variable declared with no value. */
export function nullVariable(type: CheckType): Record<string, unknown> {
  return { value: null, type, scope: 'test' }
}

export function stringVariable(value: string): Record<string, unknown> {
  return { value, type: 'string', scope: 'test' }
}

/** The variable a cell checks. */
export function checkedVariable(c: RoutingCell): string {
  return `v_${c.slug}`
}

/** One condition row in the stored shape the condition builder writes. */
export function conditionRow(id: string, variable: string, type: CheckType, check: Check): Record<string, unknown> {
  return literalCondition(id, variable, type, check.operator, check.reference)
}

/** A Variable Setter writing a literal string, the way a lane records that it ran. */
export function routeSetter(id: string, variable: string, value: string, position: NodePosition): WorkflowNode {
  return controlNode({
    id,
    label: 'Variable Setter',
    elementType: 'variable-setter',
    category: 'flow',
    description: id,
    values: { variables: { [variable]: value } },
    position,
  })
}

/** A Variable Setter writing a type's held value into a cell's checked variable. */
export function heldSetter(id: string, c: RoutingCell, position: NodePosition): WorkflowNode {
  const variable = checkedVariable(c)
  return controlNode({
    id,
    label: 'Variable Setter',
    elementType: 'variable-setter',
    category: 'flow',
    description: id,
    values: { variables: { [variable]: HELD_VALUE[c.type] } },
    variableExpressionKeys: [variable],
    position,
  })
}

export function logBlock(id: string, text: string, position: NodePosition): WorkflowNode {
  return markerNode({ id, description: id, text, position })
}

/** Where the next Block links from: a single exit, or a named lane. */
export interface Exit {
  source: string
  handle?: BranchHandle
}

export function linkFrom(from: Exit, target: string): WorkflowEdge {
  return from.handle === undefined ? edge(from.source, target) : handleEdge(from.source, from.handle, target)
}

/** A generated Test: its Blocks, links and variables. */
export interface RoutingGraph {
  nodes: WorkflowNode[]
  edges: WorkflowEdge[]
  variables: Record<string, unknown>
}

/** Import a generated Test (zero validation errors) and open it on the canvas; returns its id. */
export async function importGraph(page: Page, title: string, graph: RoutingGraph): Promise<string> {
  return importValidateAndNavigate(
    page,
    {
      name: `zz-${title}`,
      version: '1.0.0',
      description: title,
      workflow: { nodes: graph.nodes, edges: graph.edges },
      variables: graph.variables,
      metadata: {},
    },
    { rejectRepairs: true },
  )
}

export interface RoutingRun {
  verdict: string | null
  entries: LogEntry[]
  variables: SessionVariables
  /** `data-execution-status` by Block id. */
  statuses: Map<string, string | null>
}

/** Click Run, wait for the verdict and the run's closing line, then read the console, the Block paint and the session. */
export async function runRouting(page: Page): Promise<RoutingRun> {
  await selectEnvironment(page)
  const { verdict, entries } = await runToEnd(page)
  const painted = await page
    .locator('[data-testid^="workflow-node-"][data-nodetype]')
    .evaluateAll((els) =>
      els.map((el) => [
        (el.getAttribute('data-testid') ?? '').replace('workflow-node-', ''),
        el.getAttribute('data-execution-status'),
      ]),
    )
  const statuses = new Map(painted.map(([id, paint]) => [id as string, paint]))
  const variables = await getSessionVariables(page, await getActiveSessionId(page))
  return { verdict, entries, variables, statuses }
}

export function consoleDump(run: RoutingRun): string {
  return formatEntries(run.entries)
}

/** Lines whose message is exactly `message` (any level). */
export function linesWith(run: RoutingRun, message: string): LogEntry[] {
  return run.entries.filter((entry) => entry.message === message)
}

/** A Block's paint after the run; null is a Block that never got a status (it never ran). */
export function expectPaint(run: RoutingRun, id: string, paint: string | null, what: string): void {
  expect.soft(run.statuses.get(id), `${what}: ${id} paints ${paint ?? 'no status'}`).toBe(paint)
}

export function expectStillNull(run: RoutingRun, c: RoutingCell): void {
  expect.soft(sessionValue(run.variables, checkedVariable(c)), `${c.name}: the check leaves its variable null`).toBeNull()
}

/** The checked variable holds the type's held value a Variable Setter wrote. */
export function expectHeld(run: RoutingRun, c: RoutingCell): void {
  const name = checkedVariable(c)
  const what = `${c.name}: ${name} holds the written value`
  if (c.type === 'table') {
    expect.soft(sessionTable(run.variables, name).rows, what).toEqual([[1]])
    return
  }
  const value = sessionValue(run.variables, name)
  const expected: Record<Exclude<CheckType, 'table'>, unknown> = {
    string: 'x',
    integer: 5,
    float: 1.5,
    boolean: true,
    array: ['x'],
    map: { k: 1 },
  }
  if (c.type === 'float') expect.soft(Number(value), what).toBe(1.5)
  else expect.soft(value, what).toEqual(expected[c.type])
}

// ---------------------------------------------------------------------------
// The UI path: a check block built through its sheet
// ---------------------------------------------------------------------------

/** A Test with only the listed null variables, opened on a clean canvas; returns its id. */
export async function seedBlankTest(
  page: Page,
  request: APIRequestContext,
  title: string,
  variables: Record<string, CheckType>,
): Promise<string> {
  await ensureEnvironment(request)
  const declared = Object.fromEntries(Object.entries(variables).map(([name, type]) => [name, nullVariable(type)]))
  const testId = await createValidTest(request, {
    name: `zz-${title} ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    nodes: [],
    edges: [],
    variables: declared,
  })
  await openLaneCanvas(page, testId)
  return testId
}

/** Drop a Log under one lane dot of `source` (the drop draws that lane) and give it its text. */
export async function dropLaneLog(page: Page, source: string, handle: string, text: string): Promise<string> {
  const id = await dropUnder(page, source, handle, 'log')
  await setLogText(page, id, text)
  return id
}

/** A row the UI test types: a variable picked, an operator picked, a compare-to value typed when there is one. */
export interface UiRow {
  variable: string
  type: CheckType
  check: Check
}

/** Build the rows in a condition list joined by `joiner`. */
export async function buildRows(page: Page, body: Locator, rows: readonly UiRow[], joiner: 'and' | 'or' = 'and'): Promise<void> {
  for (const [index, row] of rows.entries()) {
    const path = rowPath(index)
    await addLiteralRow(body)
    await pickConditionVariable(page, body, path, row.variable)
    await pickOperator(page, body, path, row.check.label)
    if (row.check.reference !== null) await setReference(body, path, row.check.reference)
  }
  for (let n = 1; n < rows.length; n++) await setRootJoiner(body, n, joiner)
}

/** The generated form of the rows `buildRows` types, joiners included. */
export function generatedRows(rows: readonly UiRow[], joiner: 'and' | 'or' = 'and'): Array<Record<string, unknown>> {
  return rows.flatMap((row, index) => {
    const item = conditionRow(`ui-${index}`, row.variable, row.type, row.check)
    return index === 0 ? [item] : [{ type: 'operator', value: joiner }, item]
  })
}

/** A condition list without its row ids, which the sheet makes up. */
export function withoutIds(items: unknown): unknown {
  if (Array.isArray(items)) return items.map(withoutIds)
  if (items && typeof items === 'object') {
    const out: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(items as Record<string, unknown>)) {
      if (key !== 'id') out[key] = withoutIds(value)
    }
    return out
  }
  return items
}

/** The stored `config.values` of one Block. */
export async function storedValues(request: APIRequestContext, testId: string, nodeId: string): Promise<Record<string, any>> {
  const node = await getNode(request, testId, nodeId)
  return (node.data?.config?.values ?? {}) as Record<string, any>
}
