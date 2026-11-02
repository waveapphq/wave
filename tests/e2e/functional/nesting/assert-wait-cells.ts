/** Matrix B4 cells: a single-mode Assert and a Wait Until timeout, each with Fail current scope on, inside each container kind. */

import { test, type Page } from '../../helpers/playwright-fixtures'
import {
  CONTAINER_KINDS,
  assertBlock,
  buildNestingGraph,
  container,
  marker,
  type ContainerKind,
  type NestingGraphSpec,
  type NestStep,
} from '../../helpers/nesting-graph'
import { openCell, runCell } from './nesting-harness'
import {
  applyExpectations,
  NO_NODE_RUNNING,
  paintsOnCanvas,
  ranBefore,
  runsTimes,
  untakenNeverRun,
  verdictIs,
  type Expectation,
} from './signal-expectations'
import { KIND_TEXT } from './signal-steps'

export const CELL_TIMEOUT_MS = 240_000
const SIGNAL_WAIT_TIMEOUT_MS = 1_500

/** `assert-<boundary>`: the scope boundary around the container (root Test, Function body, Try/Catch try path). */
export const SCOPE_SIGNALS = ['assert-test', 'assert-function', 'assert-try', 'wait-timeout'] as const
export type ScopeSignal = (typeof SCOPE_SIGNALS)[number]

/** The scope boundaries a Wait Until timeout cell puts around the container besides the root Test. */
export const WAIT_TIMEOUT_BOUNDARIES = ['function', 'try'] as const
export type WaitTimeoutBoundary = (typeof WAIT_TIMEOUT_BOUNDARIES)[number]

export type ScopeSignalPlan = {
  cellId: string
  title: string
  spec: Omit<NestingGraphSpec, 'name'>
  expectations: Expectation[]
  /** The bookend runs in every settled outcome, so the console is read once it has logged. */
  bookendRuns: boolean
}

/** Containers whose instance node paints failed around a block failure in its slot. */
const FAILS_AT_ITS_NODE: readonly ContainerKind[] = ['parallel', 'function']

export function scopeSignalCellId(kind: ContainerKind, signal: ScopeSignal, waitBoundary?: WaitTimeoutBoundary): string {
  return waitBoundary === undefined ? `B4.${kind}.${signal}` : `B4.${kind}.${signal}-${waitBoundary}`
}

type Boundary = 'test' | 'function' | 'try'

function boundaryOf(signal: ScopeSignal, waitBoundary?: WaitTimeoutBoundary): Boundary {
  if (signal === 'assert-function' || waitBoundary === 'function') return 'function'
  if (signal === 'assert-try' || waitBoundary === 'try') return 'try'
  return 'test'
}

/** The outcome past the container once the block failure has left it: caught by the container, or uncaught. */
function outcomeExpectations(boundary: Boundary, caughtByX: boolean, bookend: string): Expectation[] {
  if (caughtByX) {
    const past = [runsTimes('x-then', 1, "the container's then successor runs once"), runsTimes(bookend, 1, 'the bookend runs once')]
    if (boundary === 'function') return [...past, runsTimes('scope-then', 1, 'the node after the enclosing Function runs once'), verdictIs('passed')]
    if (boundary === 'try') return [...past, runsTimes('top-catch', 0, 'the top-level catch path never runs for a caught failure'), verdictIs('passed')]
    return [...past, verdictIs('passed')]
  }
  const stopped = [runsTimes('x-then', 0, "the container's then successor never runs")]
  if (boundary === 'try') {
    return [
      ...stopped,
      runsTimes('top-catch', 1, 'the top-level catch path catches the block failure'),
      ranBefore('before', 'top-catch', 'the top-level catch runs after the failure'),
      runsTimes(bookend, 1, "the top-level Try/Catch's then successor (the bookend) runs once"),
      ranBefore('top-catch', bookend, 'the top-level catch runs before the then successor'),
      verdictIs('passed'),
    ]
  }
  if (boundary === 'function') {
    return [
      ...stopped,
      runsTimes('scope-then', 0, 'the node after the failed enclosing Function never runs'),
      runsTimes(bookend, 0, 'nothing after the failure runs (the bookend)'),
      verdictIs('failed'),
    ]
  }
  return [...stopped, runsTimes(bookend, 0, 'nothing after the failure runs (the bookend)'), verdictIs('failed')]
}

/** `waitBoundary` moves a `wait-timeout` cell from the root Test into a Function body or a top-level try path. */
export function scopeSignalPlan(kind: ContainerKind, signal: ScopeSignal, waitBoundary?: WaitTimeoutBoundary): ScopeSignalPlan {
  if (waitBoundary !== undefined && signal !== 'wait-timeout') {
    throw new Error(`a scope boundary override applies to wait-timeout cells only (${signal})`)
  }
  const cellId = scopeSignalCellId(kind, signal, waitBoundary)
  const boundary = boundaryOf(signal, waitBoundary)
  const signalStep: NestStep =
    signal === 'wait-timeout'
      ? container('wait-until', 'signal', [], {
          options: { neverSatisfied: true, failScope: true, timeoutMs: SIGNAL_WAIT_TIMEOUT_MS },
        })
      : assertBlock('signal', { pass: false, failScope: true })
  // A block failure in a Try/Catch try path is caught by that Try/Catch's own catch path.
  const caughtByX = kind === 'try-catch'
  const x = container(
    kind,
    'x',
    [marker('before'), signalStep, marker('after')],
    caughtByX ? { slots: { catch: [marker('x-catch')] } } : {},
  )
  const inScope: NestStep[] = [x, marker('x-then')]
  let spec: Omit<NestingGraphSpec, 'name'>
  if (boundary === 'function') {
    spec = { chain: [container('function', 'scope', inScope), marker('scope-then')] }
  } else if (boundary === 'try') {
    spec = { chain: inScope, topTry: { catchBody: [marker('top-catch')] } }
  } else {
    spec = { chain: inScope }
  }

  const graph = buildNestingGraph({ ...spec, name: cellId })
  const bookend = graph.bookendId
  const signalName = signal === 'wait-timeout' ? 'the timed-out Wait Until' : 'the failed Assert'
  const bookendRuns = caughtByX || boundary === 'try'
  // A lane-2 marker races a lane-1 Assert that fails at once; a 1.5 s wait leaves it time to run.
  const siblingsRun = kind !== 'parallel' || signal === 'wait-timeout'
  const expectations: Expectation[] = [
    ...untakenNeverRun(graph, ['x']),
    runsTimes('after', 0, `the flow stops at ${signalName}: the Block after it never runs`),
    ...paintsOnCanvas(graph, 'signal', 'failed', `${signalName} paints failed`),
    NO_NODE_RUNNING,
  ]
  expectations.push(
    runsTimes('before', 1, 'the slot runs once: the block failure ends every container around it'),
    ...(siblingsRun
      ? (graph.containers.x?.siblings ?? []).map((id) => runsTimes(id, 1, 'a sibling slot of the container runs once'))
      : []),
    ...outcomeExpectations(boundary, caughtByX, bookend),
  )
  if (FAILS_AT_ITS_NODE.includes(kind)) {
    expectations.push(...paintsOnCanvas(graph, 'x', 'failed', `${KIND_TEXT[kind]} around the failure paints failed`))
  }
  if (boundary === 'function' && !caughtByX) {
    expectations.push(...paintsOnCanvas(graph, 'scope', 'failed', 'the enclosing Function reports failed at its instance'))
  }
  if (caughtByX) {
    expectations.push(
      runsTimes('x-catch', 1, "the Try/Catch's own catch path catches the block failure"),
      ranBefore('before', 'x-catch', 'the catch runs after the failure'),
      ranBefore('x-catch', 'x-then', "the catch runs before the Try/Catch's then successor"),
    )
  }

  const where =
    boundary === 'function'
      ? 'inside a Function body'
      : boundary === 'try'
        ? 'inside a top-level Try/Catch try path'
        : 'on the Test'
  const what =
    signal === 'wait-timeout'
      ? 'a Wait Until that fails its block on timeout'
      : 'a single-mode Assert that fails its block'
  return {
    cellId,
    title: `${cellId}: ${what} inside ${KIND_TEXT[kind]} ${where}`,
    spec,
    expectations,
    bookendRuns,
  }
}

export function scopeSignalPlans(): ScopeSignalPlan[] {
  return CONTAINER_KINDS.flatMap((kind) => SCOPE_SIGNALS.map((signal) => scopeSignalPlan(kind, signal)))
}

/** The Wait Until timeout cells at the Function body and top-level try path boundaries. */
export function waitTimeoutScopePlans(): ScopeSignalPlan[] {
  return CONTAINER_KINDS.flatMap((kind) =>
    WAIT_TIMEOUT_BOUNDARIES.map((boundary) => scopeSignalPlan(kind, 'wait-timeout', boundary)),
  )
}

export async function runScopeSignalCell(page: Page, plan: ScopeSignalPlan): Promise<void> {
  const cell = await openCell(page, plan.cellId, plan.spec)
  const run = await runCell(page, cell, { awaitBookend: plan.bookendRuns })
  applyExpectations(cell, run, plan.expectations)
}

export const SCOPE_SIGNAL_DESCRIBE =
  'Matrix B4: a failing single-mode Assert and a Wait Until timeout, with Fail current scope on, inside each container kind'

export const WAIT_TIMEOUT_SCOPE_DESCRIBE =
  'Matrix B4: a Wait Until timeout inside each container kind inside a Function body or a top-level try path'
