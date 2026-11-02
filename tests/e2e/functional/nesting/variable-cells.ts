/** Matrix B7 cells: variables written, read and isolated at depth (see README.md). */

import { expect, type Page } from '../../helpers/playwright-fixtures'
import { markerNode } from '../../helpers/k8s-nodes'
import {
  CONTAINER_KINDS,
  DEFAULT_LOOP_ITERATIONS,
  DEFAULT_WAIT_ROUNDS,
  SLOT_CONTAINER,
  SLOT_KINDS,
  TOKEN_PLACEHOLDER,
  container,
  delayBlock,
  leaf,
  marker,
  setter,
  type ContainerKind,
  type ContainerOptions,
  type NestLeaf,
  type NestStep,
  type SlotKind,
  type VarDecl,
} from '../../helpers/nesting-graph'
import {
  expectMarkerCount,
  expectNoErrorLines,
  expectNoNodeRunning,
  expectRanBefore,
  expectVariable,
  expectVerdict,
  openCell,
  runCell,
  type CellRun,
  type NestCell,
} from './nesting-harness'
import { COUNTED_KINDS, KIND_TEXT, SLOT_TEXT, counterReset } from './signal-steps'

export const CELL_TIMEOUT_MS = 240_000

const D3_VARIABLE = 'nest_d3'
const INDEX_VARIABLE = 'o_idx'
const ITEM_VARIABLE = 'o_item'
const INDEX_SEED = -1
const ITEM_SEED = 'seed'
const THEN_MARKER = 'v-then'

export type LoopKind = 'for' | 'for-each' | 'while'
export const VARIABLE_LOOPS: readonly LoopKind[] = ['for', 'for-each', 'while']

export type FunctionIoCase = 'input' | 'output' | 'local'
export type FunctionPlacement = 'containers' | 'functions'
const FUNCTION_IO_CASES: readonly FunctionIoCase[] = ['input', 'output', 'local']
const FUNCTION_PLACEMENTS: readonly FunctionPlacement[] = ['containers', 'functions']

/** Run the checks every B7 cell shares: passed, the then marker and bookend once, nothing running, no ERROR line. */
function expectCleanRun(cell: NestCell, run: CellRun, thenMarker: string | null): void {
  expectVerdict(cell, run, 'passed')
  if (thenMarker) expectMarkerCount(cell, run, thenMarker, 1, 'the step after the nest runs once')
  expectMarkerCount(cell, run, cell.graph.bookendId, 1, 'the bookend runs once')
  expectNoNodeRunning(cell, run)
  expectNoErrorLines(cell, run)
}

function withVars(step: NestLeaf, vars: VarDecl[]): NestLeaf {
  return { ...step, vars: [...step.vars, ...vars] }
}

/** A Log whose message is an f-string expression; its variables are declared (imported into a Function). */
function reader(id: string, expression: string, vars: VarDecl[]): NestLeaf {
  return leaf(markerNode({ id, description: id, expression }), { vars })
}

// B7.set-d3: a Variable Setter three slots deep reads at the top.

export function setD3CellId(slot: SlotKind): string {
  return `B7.set-d3.${slot}`
}

/** v0(slot)[v1(slot)[v2(slot)[setter]]], all of the slot's container kind. */
export function setD3Chain(slot: SlotKind): NestStep[] {
  const kind = SLOT_CONTAINER[slot]
  const set = setter('v-set', {
    [D3_VARIABLE]: { value: `d3-${TOKEN_PLACEHOLDER}`, type: 'string', seed: '', flow: 'export' },
  })
  const v2 = container(kind, 'v2', [set], { slot })
  const v1 = container(kind, 'v1', [v2], { slot })
  return [container(kind, 'v0', [v1], { slot }), marker(THEN_MARKER)]
}

async function runSetD3Cell(page: Page, slot: SlotKind): Promise<void> {
  const cell = await openCell(page, setD3CellId(slot), { chain: setD3Chain(slot) })
  const run = await runCell(page, cell)
  expectCleanRun(cell, run, THEN_MARKER)
  expectVariable(cell, run, D3_VARIABLE, `d3-${cell.token}`, 'the variable written at depth 3 reads at the top')
}

// B7.loop-vars: an outer loop's index and item read inside two nested containers.

export function loopVarsCellId(loop: LoopKind, inner: ContainerKind): string {
  return `B7.loop-vars.${loop}.${inner}`
}

/** Runs of one container's slot per entry, with its counter reset on entry. */
function slotRuns(kind: ContainerKind): number {
  if (kind === 'for' || kind === 'for-each' || kind === 'while') return DEFAULT_LOOP_ITERATIONS
  if (kind === 'wait-until') return DEFAULT_WAIT_ROUNDS
  return 1
}

function resetsFor(kind: ContainerKind, id: string): NestStep[] {
  return COUNTED_KINDS.includes(kind) ? [counterReset(id)] : []
}

/** v-start (seeds), v0 loop[v1 inner[v2 inner[readers]]], v-then. */
export function loopVarsChain(loop: LoopKind, inner: ContainerKind): NestStep[] {
  const withItem = loop === 'for-each'
  const readers: NestStep[] = [
    reader('v-read-index', `f"rd-{${INDEX_VARIABLE}}-${TOKEN_PLACEHOLDER}"`, [
      { name: INDEX_VARIABLE, type: 'integer', seed: INDEX_SEED, flow: 'import' },
    ]),
  ]
  if (withItem) {
    readers.push(
      reader('v-read-item', `f"it-{${ITEM_VARIABLE}['value']}-${TOKEN_PLACEHOLDER}"`, [
        { name: ITEM_VARIABLE, type: 'map', seed: { type: 'string', value: ITEM_SEED }, flow: 'import' },
      ]),
    )
  }
  const seeds: VarDecl[] = [{ name: INDEX_VARIABLE, type: 'integer', seed: INDEX_SEED }]
  if (withItem) seeds.push({ name: ITEM_VARIABLE, type: 'map', seed: { type: 'string', value: ITEM_SEED } })

  const v2 = container(inner, 'v2', readers)
  const v1 = container(inner, 'v1', [...resetsFor(inner, 'v2'), v2])
  const v0 = container(loop, 'v0', [...resetsFor(inner, 'v1'), v1], {
    options: {
      bindIndex: { name: INDEX_VARIABLE },
      ...(withItem ? { bindItem: { name: ITEM_VARIABLE } } : {}),
    },
  })
  return [withVars(marker('v-start'), seeds), v0, marker(THEN_MARKER)]
}

async function runLoopVarsCell(page: Page, loop: LoopKind, inner: ContainerKind): Promise<void> {
  const cell = await openCell(page, loopVarsCellId(loop, inner), { chain: loopVarsChain(loop, inner) })
  const run = await runCell(page, cell)
  const perIteration = slotRuns(inner) * slotRuns(inner)
  expectCleanRun(cell, run, THEN_MARKER)
  for (let i = 0; i < DEFAULT_LOOP_ITERATIONS; i += 1) {
    expectMarkerCount(cell, run, `rd-${i}`, perIteration, `the outer loop index reads ${i} in iteration ${i} at depth 3`)
    if (loop === 'for-each') {
      expectMarkerCount(cell, run, `it-item${i}`, perIteration, `the outer loop item reads item${i} in iteration ${i} at depth 3`)
    }
  }
  expectMarkerCount(cell, run, `rd-${INDEX_SEED}`, 0, 'no read at depth sees the unbound index seed')
  if (loop === 'for-each') {
    expectMarkerCount(cell, run, `it-${ITEM_SEED}`, 0, 'no read at depth sees the unbound item seed')
  }
}

// B7.fn-<case>.<placement>: a Function at depth keeps its input and output isolation.

export function functionIoCellId(ioCase: FunctionIoCase, placement: FunctionPlacement): string {
  return `B7.fn-${ioCase}.${placement}`
}

/** The Function `f0` at depth 2: inside a Switch case and a try path, or inside two Functions. */
function placeFunction(placement: FunctionPlacement, body: NestStep[]): NestStep {
  const fn = container('function', 'f0', body)
  if (placement === 'containers') return container('switch-case', 'p0', [container('try-catch', 'p1', [fn])])
  return container('function', 'p0', [container('function', 'p1', [fn])])
}

export function functionIoChain(ioCase: FunctionIoCase, placement: FunctionPlacement): NestStep[] {
  if (ioCase === 'input') {
    const read = reader('iso-in-read', 'f"iso-{iso_in}"', [
      { name: 'iso_in', type: 'string', seed: `in-${TOKEN_PLACEHOLDER}`, flow: 'import' },
    ])
    return [placeFunction(placement, [read]), marker(THEN_MARKER)]
  }
  if (ioCase === 'output') {
    const write = setter('iso-out-set', {
      iso_out: { value: `out-${TOKEN_PLACEHOLDER}`, type: 'string', seed: '', flow: 'export' },
    })
    return [placeFunction(placement, [write]), marker(THEN_MARKER)]
  }
  const declare = withVars(marker('iso-declare'), [
    { name: 'iso_local', type: 'string', seed: `outer-${TOKEN_PLACEHOLDER}` },
  ])
  const write = setter('iso-local-set', {
    iso_local: { value: `inner-${TOKEN_PLACEHOLDER}`, type: 'string', seed: '', flow: 'local' },
  })
  return [declare, placeFunction(placement, [write, marker('iso-local-ran')]), marker(THEN_MARKER)]
}

async function runFunctionIoCell(page: Page, ioCase: FunctionIoCase, placement: FunctionPlacement): Promise<void> {
  const cell = await openCell(page, functionIoCellId(ioCase, placement), { chain: functionIoChain(ioCase, placement) })
  const run = await runCell(page, cell)
  expectCleanRun(cell, run, THEN_MARKER)
  if (ioCase === 'input') {
    expectMarkerCount(cell, run, 'iso-in', 1, 'the caller value reaches the Function body at depth through its input')
  } else if (ioCase === 'output') {
    expectVariable(cell, run, 'iso_out', `out-${cell.token}`, 'a declared output bound at the call site reaches the top')
  } else {
    expectMarkerCount(cell, run, 'iso-local-ran', 1, 'the Function body at depth ran its local write')
    expectVariable(cell, run, 'iso_local', `outer-${cell.token}`, 'a Function-local write never reaches the same-named Test variable')
  }
}

function placementText(placement: FunctionPlacement): string {
  return placement === 'containers' ? 'inside a Switch/Case case and a try path' : 'inside two Functions'
}

const FUNCTION_IO_TEXT: Readonly<Record<FunctionIoCase, string>> = {
  input: 'reads the caller value only through its input',
  output: 'returns a value only through a bound output',
  local: 'keeps a local write away from the same-named Test variable',
}

export type VariableCellPlan =
  | { group: 'set-d3'; slot: SlotKind; title: string }
  | { group: 'loop-vars'; loop: LoopKind; inner: ContainerKind; title: string }
  | { group: 'function-io'; ioCase: FunctionIoCase; placement: FunctionPlacement; title: string }

export const VARIABLE_DESCRIBE = 'Matrix B7: variables at depth'

/** Every B7 variables-at-depth cell, in registration order. */
export function variableCellPlans(): VariableCellPlan[] {
  const setD3 = SLOT_KINDS.map((slot): VariableCellPlan => ({
    group: 'set-d3',
    slot,
    title: `${setD3CellId(slot)}: a variable set three levels deep in ${SLOT_TEXT[slot]} reads at the top`,
  }))
  const loopVars = VARIABLE_LOOPS.flatMap((loop) =>
    CONTAINER_KINDS.map((inner): VariableCellPlan => {
      const reads = loop === 'for-each' ? 'index and item read' : 'index reads'
      const where = `${KIND_TEXT[inner]} nested in ${KIND_TEXT[inner]}`
      return {
        group: 'loop-vars',
        loop,
        inner,
        title: `${loopVarsCellId(loop, inner)}: ${KIND_TEXT[loop]} ${reads} correctly inside ${where}`,
      }
    }),
  )
  const functionIo = FUNCTION_IO_CASES.flatMap((ioCase) =>
    FUNCTION_PLACEMENTS.map((placement): VariableCellPlan => ({
      group: 'function-io',
      ioCase,
      placement,
      title: `${functionIoCellId(ioCase, placement)}: a Function at depth ${placementText(placement)} ${FUNCTION_IO_TEXT[ioCase]}`,
    })),
  )
  return [...setD3, ...loopVars, ...functionIo]
}

export async function runVariableCell(page: Page, plan: VariableCellPlan): Promise<void> {
  if (plan.group === 'set-d3') return runSetD3Cell(page, plan.slot)
  if (plan.group === 'loop-vars') return runLoopVarsCell(page, plan.loop, plan.inner)
  return runFunctionIoCell(page, plan.ioCase, plan.placement)
}

// B7.fn-<by-value|concurrent>.lanes: Functions called from Parallel lanes keep their inputs, locals and outputs apart.

export type LaneIsolationCase = 'by-value' | 'concurrent'
export const LANE_ISOLATION_CASES: readonly LaneIsolationCase[] = ['by-value', 'concurrent']

const CALLER_WRITE_DELAY_MS = 1_500
const FUNCTION_HOLD_MS = 4_000
const CONCURRENT_CALLS = [
  { who: 'alpha', other: 'beta' },
  { who: 'beta', other: 'alpha' },
] as const

export function laneIsolationCellId(ioCase: LaneIsolationCase): string {
  return `B7.fn-${ioCase}.lanes`
}

/** Lane 1 calls a Function that reads its input, holds and reads it again; lane 2 writes the bound caller variable meanwhile. */
export function functionByValueChain(): NestStep[] {
  const input: VarDecl = { name: 'bv_in', type: 'string', seed: '', flow: 'import' }
  const fn = container(
    'function',
    'bv-fn',
    [
      reader('bv-start-read', 'f"bv-start-{bv_in}"', [input]),
      delayBlock('bv-hold', FUNCTION_HOLD_MS),
      reader('bv-read', 'f"bv-{bv_in}"', [input]),
    ],
    { uses: { fields: { bv_in: 'bv_src' } } },
  )
  const write = setter('bv-write', {
    bv_src: { value: `after-${TOKEN_PLACEHOLDER}`, type: 'string', seed: `before-${TOKEN_PLACEHOLDER}` },
  })
  const callerLane: NestStep[] = [delayBlock('bv-wait', CALLER_WRITE_DELAY_MS), write, reader('bv-src-read', 'f"src-{bv_src}"', [])]
  return [container('parallel', 'bv-par', [fn], { lanes: [callerLane] }), marker(THEN_MARKER)]
}

/** One library Function called from two Parallel lanes with different inputs and output bindings. */
export function concurrentCallsChain(): NestStep[] {
  const who: VarDecl = { name: 'cc_who', type: 'string', seed: '', flow: 'import' }
  const keep = setter('cc-keep', { cc_mine: { value: 'cc_who', expression: true, type: 'string', seed: '' } })
  const body: NestStep[] = [
    withVars(keep, [who]),
    reader('cc-start', `f"cc-start-{cc_who}-{cc_mine}-${TOKEN_PLACEHOLDER}"`, [who]),
    delayBlock('cc-hold', FUNCTION_HOLD_MS),
    reader('cc-read', `f"cc-read-{cc_who}-{cc_mine}-${TOKEN_PLACEHOLDER}"`, [who]),
    setter('cc-out-set', {
      cc_out: { value: `cc_mine + '-${TOKEN_PLACEHOLDER}'`, expression: true, type: 'string', seed: '', flow: 'export' },
    }),
  ]
  const alpha = container('function', 'cc-alpha', body, {
    uses: { fields: { cc_who: "'alpha'" }, outputs: { cc_out: 'cc_out_alpha' } },
  })
  const beta = container('function', 'cc-beta', [], {
    uses: { of: 'cc-alpha', fields: { cc_who: "'beta'" }, outputs: { cc_out: 'cc_out_beta' } },
  })
  return [container('parallel', 'cc-par', [alpha], { lanes: [[beta]] }), marker(THEN_MARKER)]
}

function expectInputByValue(cell: NestCell, run: CellRun): void {
  expectMarkerCount(cell, run, 'bv-start-before', 1, 'the Function body reads the caller value bound at the call')
  expectMarkerCount(cell, run, 'src-after', 1, 'the other lane writes the bound caller variable while the Function runs')
  expectRanBefore(cell, run, 'bv-start-before', 'src-after', 'the caller write lands after the Function started')
  expectRanBefore(cell, run, 'src-after', 'bv-before', 'the Function body reads its input again after the caller write')
  expectMarkerCount(cell, run, 'bv-before', 1, 'the input keeps the value copied at the call')
  expectMarkerCount(cell, run, 'bv-after', 0, 'a caller write during the Function run never reaches its input')
  expectVariable(cell, run, 'bv_src', `after-${cell.token}`, 'the caller write took effect in the Test')
}

function expectConcurrentCallsApart(cell: NestCell, run: CellRun): void {
  for (const { who, other } of CONCURRENT_CALLS) {
    expectMarkerCount(cell, run, `cc-start-${who}-${who}`, 1, `the ${who} call copies its own input into its own local`)
    expectRanBefore(
      cell,
      run,
      `cc-start-${who}-${who}`,
      `cc-read-${other}-${other}`,
      `both calls run at once (the ${who} call starts before the ${other} call reads again)`,
    )
    expectMarkerCount(cell, run, `cc-read-${who}-${who}`, 1, `the ${who} call still reads its own input and local after both ran at once`)
    expectMarkerCount(cell, run, `cc-read-${who}-${other}`, 0, 'no call reads one call input beside the other call local')
    expectVariable(cell, run, `cc_out_${who}`, `${who}-${cell.token}`, `the ${who} call output reaches only its own call-site binding`)
  }
}

export type LaneIsolationCellPlan = { ioCase: LaneIsolationCase; title: string }

export async function runLaneIsolationCell(page: Page, { ioCase }: LaneIsolationCellPlan): Promise<void> {
  const cellId = laneIsolationCellId(ioCase)
  const chain = ioCase === 'by-value' ? functionByValueChain() : concurrentCallsChain()
  const cell = await openCell(page, cellId, { chain })
  if (ioCase === 'concurrent') {
    expect(cell.graph.functions.length, `${cellId}: both calls use one library Function`).toBe(1)
  }
  const run = await runCell(page, cell)
  expectCleanRun(cell, run, THEN_MARKER)
  if (ioCase === 'by-value') expectInputByValue(cell, run)
  else expectConcurrentCallsApart(cell, run)
}

const LANE_ISOLATION_TEXT: Readonly<Record<LaneIsolationCase, string>> = {
  'by-value': 'a Function in a Parallel lane keeps the input value copied at the call while the other lane changes the caller variable',
  concurrent: "one library Function called in two Parallel lanes at once keeps each call's input, local and output apart",
}

export const LANE_ISOLATION_DESCRIBE = 'Matrix B7: Function inputs by value and concurrent calls of one Function'

/** The B7 cells for Function inputs by value and concurrent calls of one Function, in registration order. */
export function laneIsolationCellPlans(): LaneIsolationCellPlan[] {
  return LANE_ISOLATION_CASES.map((ioCase) => ({ ioCase, title: `${laneIsolationCellId(ioCase)}: ${LANE_ISOLATION_TEXT[ioCase]}` }))
}

// B7.loop-null and B7.zero-run: a container that runs its lane zero times (REQ-3.1.3.25, REQ-3.5.1.15-17).

export type LoopNullCase = 'for-each' | 'for' | 'for-each-empty'
export const LOOP_NULL_CASES: readonly LoopNullCase[] = ['for-each', 'for', 'for-each-empty']

export type ZeroRunKind =
  | LoopNullCase
  | 'for-count-0'
  | 'for-each-empty-map'
  | 'while-false-at-start'
  | 'wait-until-met-at-once'
export const ZERO_RUN_KINDS: readonly ZeroRunKind[] = [
  ...LOOP_NULL_CASES,
  'for-count-0',
  'for-each-empty-map',
  'while-false-at-start',
  'wait-until-met-at-once',
]

const NULL_LIST_VARIABLE = 'lp_list'
const NULL_COUNT_VARIABLE = 'lp_count'
const ITEM_SEED_ENVELOPE = { type: 'string', value: ITEM_SEED }
const FOR_ZERO_LINE = '[FOR] Starting loop (0 iterations)'
const FOR_EACH_ZERO_LINE = '[FOR-EACH] Starting loop (0 iterations)'

type ZeroRunSpec = {
  kind: ContainerKind
  text: string
  /** The loop binds `o_idx` (and a For Each `o_item`); the then path prints them. */
  binds: 'none' | 'index' | 'item'
  options: ContainerOptions
  nulls: VarDecl[]
  startLine: string | null
}

// While and Wait Until take `iterations: 0`: a While false at its first check, a Wait Until met at its first check.
const ZERO_RUN: Readonly<Record<ZeroRunKind, ZeroRunSpec>> = {
  'for-each': {
    kind: 'for-each',
    text: 'a For Each over null',
    binds: 'item',
    options: { collection: NULL_LIST_VARIABLE },
    nulls: [{ name: NULL_LIST_VARIABLE, type: 'array', seed: null }],
    startLine: FOR_EACH_ZERO_LINE,
  },
  for: {
    kind: 'for',
    text: 'a For with a null count',
    binds: 'index',
    options: { countExpression: NULL_COUNT_VARIABLE },
    nulls: [{ name: NULL_COUNT_VARIABLE, type: 'integer', seed: null }],
    startLine: FOR_ZERO_LINE,
  },
  'for-each-empty': {
    kind: 'for-each',
    text: 'a For Each over an empty list',
    binds: 'item',
    options: { collection: '[]' },
    nulls: [],
    startLine: FOR_EACH_ZERO_LINE,
  },
  'for-count-0': {
    kind: 'for',
    text: 'a For with count 0',
    binds: 'index',
    options: { iterations: 0 },
    nulls: [],
    startLine: FOR_ZERO_LINE,
  },
  'for-each-empty-map': {
    kind: 'for-each',
    text: 'a For Each over an empty map',
    binds: 'item',
    options: { collection: '{}' },
    nulls: [],
    startLine: FOR_EACH_ZERO_LINE,
  },
  'while-false-at-start': {
    kind: 'while',
    text: 'a While false at its first check',
    binds: 'none',
    options: { iterations: 0 },
    nulls: [],
    startLine: null,
  },
  'wait-until-met-at-once': {
    kind: 'wait-until',
    text: 'a Wait Until met at its first check',
    binds: 'none',
    options: { iterations: 0 },
    nulls: [],
    startLine: null,
  },
}

/** lp-seed (declares the bound variables and the null), the loop lp[lp-body], then lp-read unless `withThen` is off. */
function zeroRunSteps(zeroRun: ZeroRunKind, withThen: boolean): NestStep[] {
  const spec = ZERO_RUN[zeroRun]
  // Exported, so inside a Function body the call binds them back to the Test.
  const seeds: VarDecl[] = []
  const options: ContainerOptions = { ...spec.options }
  if (spec.binds !== 'none') {
    seeds.push({ name: INDEX_VARIABLE, type: 'integer', seed: INDEX_SEED, flow: 'export' })
    options.bindIndex = { name: INDEX_VARIABLE, flow: 'export' }
  }
  if (spec.binds === 'item') {
    seeds.push({ name: ITEM_VARIABLE, type: 'map', seed: ITEM_SEED_ENVELOPE, flow: 'export' })
    options.bindItem = { name: ITEM_VARIABLE, flow: 'export' }
  }
  const steps: NestStep[] = [
    withVars(marker('lp-seed'), [...seeds, ...spec.nulls]),
    container(spec.kind, 'lp', [marker('lp-body')], { options }),
  ]
  if (withThen) steps.push(reader('lp-read', `f"${keptText(zeroRun)}-${TOKEN_PLACEHOLDER}"`, []))
  return steps
}

/** What lp-read prints: index 0 and the item seed, as f-string source for the Log and as the expected text. */
function keptText(zeroRun: ZeroRunKind, expected = false): string {
  const binds = ZERO_RUN[zeroRun].binds
  if (binds === 'none') return 'lp-after'
  const index = expected ? '0' : `{${INDEX_VARIABLE}}`
  if (binds === 'index') return `lp-${index}`
  return `lp-${index}-${expected ? ITEM_SEED : `{${ITEM_VARIABLE}.get('value')}`}`
}

/** The checks every zero-run cell shares; `entries` is how many times the loop's slot runs. */
function expectZeroRun(cell: NestCell, run: CellRun, zeroRun: ZeroRunKind, entries: number, withThen: boolean): void {
  const spec = ZERO_RUN[zeroRun]
  expectCleanRun(cell, run, THEN_MARKER)
  expectMarkerCount(cell, run, 'lp-body', 0, 'the lane never runs')
  if (withThen) {
    expectMarkerCount(cell, run, keptText(zeroRun, true), entries, 'the then path runs on every entry, reading index 0 and the item seed')
  }
  if (spec.binds !== 'none' && withThen) {
    expectMarkerCount(cell, run, `lp-${INDEX_SEED}${spec.binds === 'item' ? `-${ITEM_SEED}` : ''}`, 0, 'the index never keeps its seed')
  }
  if (spec.binds === 'item' && withThen) expectMarkerCount(cell, run, 'lp-0-None', 0, 'the item is never emptied to {}')
  if (spec.startLine !== null) {
    const started = run.entries.filter((entry) => entry.message === spec.startLine).length
    expect.soft(started, `${cell.cellId}: the loop reports ${spec.startLine} on every entry`).toBe(entries)
  }
  if (spec.binds !== 'none') expectVariable(cell, run, INDEX_VARIABLE, 0, 'index reads 0 after the loop ran zero times')
  if (spec.binds === 'item') expectVariable(cell, run, ITEM_VARIABLE, ITEM_SEED_ENVELOPE, 'the bound item keeps its seed, never {}')
}

export function loopNullCellId(loopCase: LoopNullCase, slot: SlotKind): string {
  return `B7.loop-null.${loopCase}.${slot}`
}

/** v0(slot)[lp-seed, lp loop[lp-body], lp-read], v-then. */
export function loopNullChain(loopCase: LoopNullCase, slot: SlotKind): NestStep[] {
  return [container(SLOT_CONTAINER[slot], 'v0', zeroRunSteps(loopCase, true), { slot }), marker(THEN_MARKER)]
}

async function runLoopNullCell(page: Page, loopCase: LoopNullCase, slot: SlotKind): Promise<void> {
  const cell = await openCell(page, loopNullCellId(loopCase, slot), { chain: loopNullChain(loopCase, slot) })
  const run = await runCell(page, cell)
  expectZeroRun(cell, run, loopCase, slotRuns(SLOT_CONTAINER[slot]), true)
}

export type LoopNullCellPlan = { loopCase: LoopNullCase; slot: SlotKind; title: string }

export const LOOP_NULL_DESCRIBE = 'Matrix B7: a loop that runs zero times inside every slot kind'

/** Every B7.loop-null cell, in registration order (case, then slot). */
export function loopNullCellPlans(): LoopNullCellPlan[] {
  return LOOP_NULL_CASES.flatMap((loopCase) =>
    SLOT_KINDS.map((slot): LoopNullCellPlan => {
      const keeps = loopCase === 'for' ? 'index reads 0' : 'index reads 0 and the item keeps its seed'
      return {
        loopCase,
        slot,
        title: `${loopNullCellId(loopCase, slot)}: ${ZERO_RUN[loopCase].text} inside ${SLOT_TEXT[slot]} runs zero times, its then path runs, ${keeps}`,
      }
    }),
  )
}

export async function runLoopNullPlan(page: Page, plan: LoopNullCellPlan): Promise<void> {
  return runLoopNullCell(page, plan.loopCase, plan.slot)
}

// B7.zero-run.<kind>.<placement>.<then|no-then>: the same zero runs at the Test level, in a For body, and in a
// Function body directly, in a Function in a Function, in a For body or a try path inside a Function, with and
// without a Block on the loop's then lane.

export type ZeroRunPlacement =
  | 'top-level'
  | 'for-body'
  | 'function-body'
  | 'nested-function'
  | 'for-body-in-function'
  | 'try-in-function'
export const ZERO_RUN_PLACEMENTS: readonly ZeroRunPlacement[] = [
  'top-level',
  'for-body',
  'function-body',
  'nested-function',
  'for-body-in-function',
  'try-in-function',
]

const PLACEMENT_TEXT: Readonly<Record<ZeroRunPlacement, string>> = {
  'top-level': 'on the Test flow',
  'for-body': 'in a For Loop body',
  'function-body': 'in a Function body',
  'nested-function': 'in a Function inside a Function',
  'for-body-in-function': 'in a For Loop body inside a Function',
  'try-in-function': 'in a try path inside a Function',
}

/** How many times the loop's place runs per run of the Test. */
function placementRuns(placement: ZeroRunPlacement): number {
  return placement === 'for-body' || placement === 'for-body-in-function' ? DEFAULT_LOOP_ITERATIONS : 1
}

function placeZeroRun(placement: ZeroRunPlacement, steps: NestStep[]): NestStep[] {
  if (placement === 'top-level') return [...steps, marker(THEN_MARKER)]
  if (placement === 'for-body') return [container('for', 'v0', steps), marker(THEN_MARKER)]
  if (placement === 'function-body') return [container('function', 'v0', steps), marker(THEN_MARKER)]
  const innerKind: ContainerKind =
    placement === 'nested-function' ? 'function' : placement === 'for-body-in-function' ? 'for' : 'try-catch'
  return [container('function', 'v0', [container(innerKind, 'v1', steps)]), marker(THEN_MARKER)]
}

export function zeroRunCellId(zeroRun: ZeroRunKind, placement: ZeroRunPlacement, withThen: boolean): string {
  return `B7.zero-run.${zeroRun}.${placement}.${withThen ? 'then' : 'no-then'}`
}

export type ZeroRunCellPlan = { zeroRun: ZeroRunKind; placement: ZeroRunPlacement; withThen: boolean; title: string }

export const ZERO_RUN_DESCRIBE = 'Matrix B7: a lane that runs zero times never runs, in and out of Functions'

/** Every B7.zero-run cell, in registration order; the loop-null cells' shapes are left out. */
export function zeroRunCellPlans(): ZeroRunCellPlan[] {
  return ZERO_RUN_KINDS.flatMap((zeroRun) =>
    ZERO_RUN_PLACEMENTS.flatMap((placement) =>
      [true, false].flatMap((withThen): ZeroRunCellPlan[] => {
        // The builder always puts the bookend after a top-level step, so a top-level loop always has a then lane.
        if (placement === 'top-level' && !withThen) return []
        const inLoopNull =
          (LOOP_NULL_CASES as readonly string[]).includes(zeroRun) &&
          (placement === 'for-body' || placement === 'function-body') &&
          withThen
        if (inLoopNull) return []
        const lane = withThen ? 'with a Block on its then lane' : 'last on its lane'
        return [
          {
            zeroRun,
            placement,
            withThen,
            title: `${zeroRunCellId(zeroRun, placement, withThen)}: ${ZERO_RUN[zeroRun].text} ${PLACEMENT_TEXT[placement]}, ${lane}, never runs its lane and the flow goes on`,
          },
        ]
      }),
    ),
  )
}

export async function runZeroRunPlan(page: Page, plan: ZeroRunCellPlan): Promise<void> {
  const { zeroRun, placement, withThen } = plan
  const chain = placeZeroRun(placement, zeroRunSteps(zeroRun, withThen))
  const cell = await openCell(page, zeroRunCellId(zeroRun, placement, withThen), { chain })
  const run = await runCell(page, cell)
  expectZeroRun(cell, run, zeroRun, placementRuns(placement), withThen)
}
