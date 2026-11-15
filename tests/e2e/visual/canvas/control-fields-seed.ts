/**
 * Shared seed for the control Block field specs: one Test per surface holding the If/Else condition rows, the
 * Variable Setter rows or the Parallel lanes, each validated with zero errors and deleted afterwards.
 *
 * Imported by V-CTRL-CONDROW-01, V-CTRL-SETTER-01 and V-CTRL-PARALLEL-03.
 *
 * REQ: REQ-3.1.1.5, REQ-3.5.1.5, REQ-3.4.1.14, REQ-3.2.3.7
 */

import { randomUUID } from 'node:crypto'
import { expect, type APIRequestContext, type Locator, type Page, type TestInfo } from '../../helpers/playwright-fixtures'
import { BACKEND_URL } from '../../helpers/config'
import { controlBlock, setterBlock, type Rec } from '../../helpers/fn-block'
import { createValidTest, validateTest } from '../../helpers/fn-seed'
import { openBlockSheet } from '../../helpers/workbench'

export type Theme = 'dark' | 'light'
export const THEMES = ['dark', 'light'] as const satisfies readonly Theme[]

/** The window width of every condition control, the Setter and the Parallel (FIELD-16, PARALLEL-3). */
export const WIDE_WINDOW = 880

// --- If/Else: the condition rows ---

export const IF_ELSE_ID = 'route-by-health'
export const IF_ELSE_LABEL = 'Route by health'
export const IF_BRANCH = 'branch_0'
export const SLOW_BRANCH = 'branch_1'
export const ELSE_BRANCH = 'branch_2'
export const RETRIES_GROUP = 'group-retries'

/** Row paths inside each branch's list: operators take the odd places. */
export const CONDITION_PATHS = {
  ready: '0',
  expected: '2',
  latency: '0',
  retries: '2-0',
  region: '2-2',
  errors: '4',
} as const

const literal = (id: string, variable: string, valueType: string, operator: string, value: string): Rec => ({
  id,
  type: 'literal',
  variable,
  value_type: valueType,
  operator,
  reference_value: value,
})

const joinWith = (value: 'and' | 'or'): Rec => ({ type: 'operator', value })

function ifElseBlock(): Rec {
  return controlBlock(IF_ELSE_ID, IF_ELSE_LABEL, 'if-else', 'conditional', {
    position: { x: 320, y: 200 },
    values: {
      branches: [
        {
          id: IF_BRANCH,
          type: 'if',
          label: 'Healthy',
          conditions: [
            literal('c-ready', 'status', 'string', 'equals', 'ready'),
            joinWith('or'),
            { ...literal('c-expected', 'status', 'string', 'equals', 'expected_status'), reference_is_expression: true },
          ],
        },
        {
          id: SLOW_BRANCH,
          type: 'else_if',
          label: 'Slow',
          conditions: [
            literal('c-latency', 'latency_ms', 'integer', 'greater_than', '500'),
            joinWith('and'),
            {
              id: RETRIES_GROUP,
              type: 'group',
              items: [
                literal('c-retries', 'retries', 'integer', 'less_than', '3'),
                joinWith('or'),
                literal('c-region', 'region', 'string', 'starts_with', 'eu'),
              ],
            },
            joinWith('and'),
            { id: 'c-errors', type: 'expression', expression: 'len(errors) == 0' },
          ],
        },
        { id: ELSE_BRANCH, type: 'else', label: 'Fallback' },
      ],
    },
  })
}

const CONDITION_VARIABLES: Rec = {
  status: { value: 'ready', type: 'string', scope: 'test' },
  expected_status: { value: 'ready', type: 'string', scope: 'test' },
  region: { value: 'eu-west-1', type: 'string', scope: 'test' },
  latency_ms: { value: 600, type: 'integer', scope: 'test' },
  retries: { value: 2, type: 'integer', scope: 'test' },
  errors: { value: [], type: 'array', scope: 'test' },
}

// --- Variable Setter: one row per face ---

export const SETTER_ID = 'set-run-values'
export const SETTER_LABEL = 'Set run values'
export const SETTER_ROWS = ['greeting', 'next_attempt', 'summary', 'api_token', 'host_list', 'limits'] as const
/** The row Add puts under the seeded rows: a new target, so its value starts null. */
export const NEW_ROW = 'last_error'
export const HOST_LINE = '["web-1", "web-2", {{ backup_host }}]'

const setterRowIndex = (name: string): number => [...SETTER_ROWS, NEW_ROW].indexOf(name as (typeof SETTER_ROWS)[number])
/** A Setter row's value cell stem, `varset-value-<i>`. */
export const setterStem = (name: string): string => `varset-value-${setterRowIndex(name)}`
export const setterIndex = setterRowIndex

function setterRowsBlock(): Rec {
  return setterBlock(
    SETTER_ID,
    SETTER_LABEL,
    {
      greeting: 'hello world',
      next_attempt: 'attempt + 1',
      summary: 'Run {{ run_id }} done',
      api_token: 'tok-7f3a91c2',
      host_list: ['web-1', 'web-2', 'backup_host'],
      limits: { cpu: 2, mem: '4Gi' },
    },
    {
      position: { x: 320, y: 200 },
      expressionRows: ['next_attempt', 'host_list.2'],
      templateRows: ['summary'],
      secretRows: ['api_token'],
      entryTypes: { limits: { cpu: 'integer', mem: 'string' } },
    },
  )
}

const SETTER_VARIABLES: Rec = {
  greeting: { value: '', type: 'string', scope: 'test' },
  summary: { value: '', type: 'string', scope: 'test' },
  api_token: { value: 'tok-initial', type: 'string', scope: 'test', secret: true },
  run_id: { value: '7', type: 'string', scope: 'test' },
  backup_host: { value: 'db-2', type: 'string', scope: 'test' },
  next_attempt: { value: 0, type: 'integer', scope: 'test' },
  attempt: { value: 1, type: 'integer', scope: 'test' },
  host_list: { value: [], type: 'array', scope: 'test' },
  limits: { value: {}, type: 'map', scope: 'test' },
}

// --- Parallel: the lanes ---

export const RUN_CHECKS_ID = 'run-checks'
export const RUN_CHECKS_LABEL = 'Run checks'
/** The lanes of `Run checks`: ingest 30000, probe 5000, drain 15000. */
export const RUN_CHECKS_LANES = [
  { id: 'branch_1', name: 'ingest', limit: 30000 },
  { id: 'branch_2', name: 'probe', limit: 5000 },
  { id: 'branch_3', name: 'drain', limit: 15000 },
] as const

function runChecksBlock(): Rec {
  return controlBlock(RUN_CHECKS_ID, RUN_CHECKS_LABEL, 'parallel', 'flow', {
    position: { x: 320, y: 200 },
    values: {
      branches: RUN_CHECKS_LANES.map(({ id, name, limit }) => ({ id, name, time_limit: limit })),
      join: 'first',
      time_limit: 60000,
    },
  })
}

export const LANE_ROWS_ID = 'par-lanes'
export const LANE_ROWS_LABEL = 'Check lanes'
export const LANE_EXPRESSION = 'lane_limit * 2'
/** The lanes of the wide lane row: a number limit, an {x} limit and no limit. */
export const LANE_ROWS = [
  { id: 'branch_1', name: 'api' },
  { id: 'branch_2', name: 'database' },
  { id: 'branch_3', name: 'cache' },
] as const

function laneRowsBlock(): Rec {
  return controlBlock(LANE_ROWS_ID, LANE_ROWS_LABEL, 'parallel', 'flow', {
    position: { x: 320, y: 200 },
    expressionFields: ['branches.1.time_limit'],
    values: {
      branches: [
        { id: 'branch_1', name: 'api', time_limit: 5000 },
        { id: 'branch_2', name: 'database', time_limit: LANE_EXPRESSION },
        { id: 'branch_3', name: 'cache' },
      ],
      join: 'all',
    },
  })
}

// --- Seeding ---

export type Surface = 'condrow' | 'setter' | 'lanes' | 'lane-rows'

const SURFACES: Record<Surface, { block: () => Rec; variables: Rec }> = {
  condrow: { block: ifElseBlock, variables: CONDITION_VARIABLES },
  setter: { block: setterRowsBlock, variables: SETTER_VARIABLES },
  lanes: { block: runChecksBlock, variables: {} },
  'lane-rows': {
    block: laneRowsBlock,
    variables: { lane_limit: { value: 30000, type: 'integer', scope: 'test' } },
  },
}

/** Seed `zz-ctrl-fields-<surface>-<theme>` through POST /tests, check it validates with zero errors, return its id. */
export async function seedControlTest(request: APIRequestContext, surface: Surface, theme: Theme): Promise<string> {
  await request.delete(`${BACKEND_URL}/workbench/session/`).catch(() => undefined)
  const { block, variables } = SURFACES[surface]
  const node = block()
  const testId = await createValidTest(request, {
    // A short suffix keeps a leftover of an aborted run from blocking the name.
    name: `zz-ctrl-fields-${surface}-${theme}-${randomUUID().slice(0, 6)}`,
    nodes: [node],
    edges: [{ id: `e-start-${String(node.id)}`, source: 'start-node', target: String(node.id) }],
    variables,
  })
  const validation = await validateTest(request, testId)
  expect(validation.errors, `the seeded ${surface} Test validates with zero errors`).toEqual([])
  return testId
}

/** The stored data of one Block (GET /tests/{id}). */
export async function storedBlockData(request: APIRequestContext, testId: string, blockId: string): Promise<Rec> {
  const resp = await request.get(`${BACKEND_URL}/tests/${testId}`)
  expect(resp.ok(), `GET /tests/${testId} answered ${resp.status()}`).toBeTruthy()
  const nodes = ((await resp.json()).data?.workflow?.nodes ?? []) as Rec[]
  const node = nodes.find((n) => n.id === blockId)
  expect(node, `${blockId} is in the stored Test`).toBeTruthy()
  return (node?.data ?? {}) as Rec
}

/** Open a Block's window on the open Test and check its title; returns the window. */
export async function openControlWindow(page: Page, blockId: string, label: string): Promise<Locator> {
  const sheet = await openBlockSheet(page, blockId)
  await expect(sheet.locator('h2').first()).toHaveText(`${label} - Edit Config`)
  return sheet
}

export async function deleteControlTest(request: APIRequestContext, testId: string): Promise<void> {
  if (!testId) return
  await request.delete(`${BACKEND_URL}/workbench/session/`).catch(() => undefined)
  const resp = await request.delete(`${BACKEND_URL}/tests/${testId}`)
  expect([200, 204, 404], `DELETE /tests/${testId} answered ${resp.status()}`).toContain(resp.status())
}

export async function attachWindow(testInfo: TestInfo, name: string, sheet: Locator): Promise<void> {
  await testInfo.attach(name, { body: await sheet.screenshot(), contentType: 'image/png' })
}

// --- Geometry and computed style reads shared by the three specs ---

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export async function rectOf(target: Locator, what: string): Promise<Rect> {
  const found = await target.boundingBox()
  expect(found, `${what} has a box`).not.toBeNull()
  return found!
}

export const right = (rect: Rect): number => rect.x + rect.width
export const bottom = (rect: Rect): number => rect.y + rect.height
export const middle = (rect: Rect): number => rect.y + rect.height / 2

/** `actual` is within `tolerance` px of `expected` (1 px for boxes). */
export function near(actual: number, expected: number, what: string, tolerance = 1): void {
  expect.soft(Math.abs(actual - expected), `${what}: ${actual} vs ${expected}`).toBeLessThanOrEqual(tolerance)
}

/** One computed style property, as the browser serializes it. */
export const styleOf = (target: Locator, property: string): Promise<string> =>
  target.evaluate((el, prop) => getComputedStyle(el).getPropertyValue(prop), property)

/** The computed background a CSS color gets in this page, as the browser serializes it. */
export function fillOf(page: Page, cssColor: string): Promise<string> {
  return page.evaluate((color) => {
    const probe = document.createElement('span')
    probe.style.backgroundColor = color
    document.body.appendChild(probe)
    const computed = getComputedStyle(probe).backgroundColor
    probe.remove()
    return computed
  }, cssColor)
}

/** The code box's expression color (cyan-400 in the expression theme), the same in both themes. */
export const CODE_EXPRESSION_COLOR = '#22d3ee'

/** The pressed {x} and pressed null fill: the primary color at 10 percent (FIELD-1, FIELD-5). */
export const PRESSED_FILL = 'color-mix(in oklab, var(--primary) 10%, transparent)'

/** The line under a field: 12 px on a 16 px line, one line, not cut. */
export async function expectMessageLook(message: Locator, what: string): Promise<void> {
  const look = await message.evaluate((el) => {
    const style = getComputedStyle(el)
    return {
      fontSize: style.fontSize,
      lineHeight: style.lineHeight,
      height: el.getBoundingClientRect().height,
      cut: el.scrollWidth > el.clientWidth,
    }
  })
  expect.soft(look, `${what}: 12 / 16 px, one line, whole`).toEqual({
    fontSize: '12px',
    lineHeight: '16px',
    height: 16,
    cut: false,
  })
}
