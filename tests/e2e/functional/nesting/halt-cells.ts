/** Matrix B2 cells: a Halt at depth 2 and 3 inside each container kind, for each scope and status (see README.md). */

import type { Page } from '../../helpers/playwright-fixtures'
import {
  container,
  halt,
  marker,
  type ContainerKind,
  type HaltScope,
  type HaltStatus,
  type NestingGraph,
  type NestStep,
} from '../../helpers/nesting-graph'
import {
  expectMarkerCount,
  expectNoErrorLines,
  expectNoNodeRunning,
  expectRanBefore,
  expectVerdict,
  finishCell,
  openCell,
  startCellRun,
  type CellRun,
  type NestCell,
} from './nesting-harness'
import { graphWithoutEdgesFrom, openSignalCell } from './signal-cell-open'
import { COUNTED_KINDS, KIND_TEXT } from './signal-steps'

export const CELL_TIMEOUT_MS = 240_000
const HALT_ID = 'halt'
const TOP_THEN = 'top-then'

export const HALT_DEPTHS: readonly number[] = [2, 3]
export const HALT_SCOPES: readonly HaltScope[] = ['function', 'test', 'suite', 'regression']
export const HALT_STATUSES: readonly HaltStatus[] = ['passed', 'failed', 'skipped']

export function haltCellId(kind: ContainerKind, depth: number, scope: HaltScope, status: HaltStatus): string {
  return `B2.${kind}.d${depth}.${scope}.${status}`
}

function title(kind: ContainerKind, depth: number, scope: HaltScope, status: HaltStatus): string {
  const where = `at depth ${depth} inside ${KIND_TEXT[kind]}`
  const head = `${haltCellId(kind, depth, scope, status)}: a ${scope}-scope ${status} Halt ${where}`
  if (scope !== 'function') return `${head} ends the run ${status} and nothing after it runs`
  const inFunction = kind === 'function' ? '' : ' in a Function'
  if (status === 'failed') return `${head}${inFunction} fails the Function and the run`
  return `${head}${inFunction} ends only the innermost Function and the caller continues`
}

/** Level kinds, top first; a function-scope Halt needs a Function around it, so a top Function wraps other kinds. */
function levelKinds(kind: ContainerKind, depth: number, scope: HaltScope): ContainerKind[] {
  if (scope !== 'function' || kind === 'function') return Array.from({ length: depth }, () => kind)
  return ['function', ...Array.from({ length: depth - 1 }, () => kind)]
}

/** l<i>[l<i>-head, l<i+1>, l<i+1>-after]; the last level holds [head, Halt]. */
function level(kinds: readonly ContainerKind[], index: number, haltStep: NestStep): NestStep {
  const id = `l${index}`
  const kind = kinds[index]
  const content: NestStep[] =
    index === kinds.length - 1
      ? [marker(`${id}-head`), haltStep]
      : [marker(`${id}-head`), level(kinds, index + 1, haltStep), marker(`l${index + 1}-after`)]
  return container(kind, id, content, kind === 'try-catch' ? { options: { enableFinally: true } } : {})
}

/** Runs of the marker after level `j`: once only outside the Function that a function-scope passed or skipped Halt ends. */
function afterRuns(kinds: readonly ContainerKind[], j: number, scope: HaltScope, status: HaltStatus): number {
  if (scope !== 'function' || status === 'failed') return 0
  return j - 1 >= kinds.lastIndexOf('function') ? 0 : 1
}

function expectHaltOutcome(
  cell: NestCell,
  run: CellRun,
  kinds: readonly ContainerKind[],
  scope: HaltScope,
  status: HaltStatus,
): void {
  const depth = kinds.length
  const callerContinues = scope === 'function' && status !== 'failed'
  const verdict = scope === 'function' ? (status === 'failed' ? 'failed' : 'passed') : status

  expectVerdict(cell, run, verdict)
  for (let i = 0; i < depth; i += 1) {
    expectMarkerCount(cell, run, `l${i}-head`, 1, 'the path reaches the Halt once; no further iteration or round runs')
  }
  for (let j = 1; j < depth; j += 1) {
    const runs = afterRuns(kinds, j, scope, status)
    const criterion = runs === 0 ? 'nothing after the Halt runs inside the halted scope' : 'the caller of the halted Function continues'
    expectMarkerCount(cell, run, `l${j}-after`, runs, criterion)
  }
  const outside = callerContinues ? 1 : 0
  const outsideCriterion = callerContinues ? 'the Test continues after the Function' : 'nothing after the Halt runs'
  expectMarkerCount(cell, run, TOP_THEN, outside, outsideCriterion)
  expectMarkerCount(cell, run, cell.graph.bookendId, outside, outsideCriterion)
  for (const [id, info] of Object.entries(cell.graph.containers)) {
    for (const untaken of info.untaken) {
      expectMarkerCount(cell, run, untaken, 0, `an untaken slot of ${id} never runs; a catch path does not absorb a Halt`)
    }
  }
  if (callerContinues) {
    expectRanBefore(cell, run, `l${depth - 1}-head`, TOP_THEN, 'the halted Function runs before the Test continues')
  }
  expectNoNodeRunning(cell, run)
  if (status !== 'failed') expectNoErrorLines(cell, run)
}

export type HaltPlan = {
  kinds: ContainerKind[]
  chain: NestStep[]
  /** The Halt's own container appends a counter tail, so the edge from the Halt is removed before import. */
  innermostCounted: boolean
}

export function haltPlan(kind: ContainerKind, depth: number, scope: HaltScope, status: HaltStatus): HaltPlan {
  const kinds = levelKinds(kind, depth, scope)
  const innermostCounted = COUNTED_KINDS.includes(kinds[depth - 1])
  const haltLeaf = halt(HALT_ID, { scope, status, message: `${haltCellId(kind, depth, scope, status)} halted` })
  const haltStep = innermostCounted ? { ...haltLeaf, terminal: false } : haltLeaf
  return { kinds, chain: [level(kinds, 0, haltStep), marker(TOP_THEN)], innermostCounted }
}

/** Remove the edge the builder draws from the Halt into a counter tail, and the tail it leaves orphaned. */
export function withoutHaltEdges(graph: NestingGraph): NestingGraph {
  return graphWithoutEdgesFrom(graph, [HALT_ID])
}

export type HaltCellPlan = { kind: ContainerKind; depth: number; scope: HaltScope; status: HaltStatus; title: string }

export function haltDescribeTitle(kind: ContainerKind): string {
  return `Matrix B2: a Halt at depth inside ${KIND_TEXT[kind]}`
}

/** One cell per depth, scope and status for Halts inside `kind`, in registration order. */
export function haltCellPlans(kind: ContainerKind): HaltCellPlan[] {
  return HALT_DEPTHS.flatMap((depth) =>
    HALT_SCOPES.flatMap((scope) =>
      HALT_STATUSES.map((status) => ({ kind, depth, scope, status, title: title(kind, depth, scope, status) })),
    ),
  )
}

export async function runHaltCell(page: Page, { kind, depth, scope, status }: HaltCellPlan): Promise<void> {
  const cellId = haltCellId(kind, depth, scope, status)
  const { kinds, chain, innermostCounted } = haltPlan(kind, depth, scope, status)

  let cell: NestCell
  if (innermostCounted) {
    const opened = await openSignalCell(page, cellId, { chain }, {
      requireValid: true,
      rewrite: withoutHaltEdges,
    })
    if (opened.refusal !== null) return
    cell = opened.cell
  } else {
    cell = await openCell(page, cellId, { chain })
  }
  await startCellRun(page, cell)
  const run = await finishCell(page, cell, { awaitBookend: scope === 'function' && status !== 'failed' })
  expectHaltOutcome(cell, run, kinds, scope, status)
}
