/** Matrix B3 cells: a failing Block at depth 2, inner container inside outer container, one test per cell. */

import type { Page } from '../../helpers/playwright-fixtures'
import type { WorkflowEdge, WorkflowNode } from '../../helpers/k8s-nodes'
import {
  CONTAINER_KINDS,
  buildNestingGraph,
  container,
  failBlock,
  marker,
  type ContainerKind,
  type ContainerOptions,
  type NestingGraph,
  type NestingGraphSpec,
  type NestStep,
  type PublishedFunctions,
  type SlotKind,
} from '../../helpers/nesting-graph'
import { openCell, runCell } from './nesting-harness'
import { openSignalCell } from './signal-cell-open'
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
const FAILURE_WAIT_TIMEOUT_MS = 5_000

export const FAILURE_WRAPS = ['trycatch', 'bare'] as const
export type FailureWrap = (typeof FAILURE_WRAPS)[number]

export const THEN_VARIANTS = ['then', 'nothen'] as const
export type ThenVariant = (typeof THEN_VARIANTS)[number]

export type FailureCellPlan = {
  cellId: string
  title: string
  spec: Omit<NestingGraphSpec, 'name'>
  /** The Test carries no bookend, so the outermost container has no then successor. */
  withoutBookend: boolean
  expectations: Expectation[]
}

type Workflow = { nodes: WorkflowNode[]; edges: WorkflowEdge[] }

/** The same graph with the bookend Log and every edge into it removed. */
export function graphWithoutBookend(graph: NestingGraph): NestingGraph {
  const drop = graph.bookendId
  const fixture = (published: PublishedFunctions): Record<string, unknown> => {
    const doc = graph.fixture(published)
    const workflow = doc.workflow as Workflow
    return {
      ...doc,
      workflow: {
        nodes: workflow.nodes.filter((node) => node.id !== drop),
        edges: workflow.edges.filter((e) => e.target !== drop),
      },
    }
  }
  return { ...graph, fixture, testNodeIds: graph.testNodeIds.filter((id) => id !== drop) }
}

export function failureCellId(outer: ContainerKind, inner: ContainerKind, wrap: FailureWrap, then: ThenVariant): string {
  return `B3.${outer}.${inner}.${wrap}.${then}`
}

/** A Try/Catch fails through its catch path (a failing try is caught by that Try/Catch itself). */
function placement(kind: ContainerKind): { slot?: SlotKind; options?: ContainerOptions } {
  if (kind === 'try-catch') return { slot: 'catch' }
  if (kind === 'wait-until') return { options: { timeoutMs: FAILURE_WAIT_TIMEOUT_MS } }
  return {}
}

const FAILS_AT_ITS_NODE: readonly ContainerKind[] = ['parallel', 'function']

export function failurePlan(
  outer: ContainerKind,
  inner: ContainerKind,
  wrap: FailureWrap,
  then: ThenVariant,
): FailureCellPlan {
  const cellId = failureCellId(outer, inner, wrap, then)
  const withThen = then === 'then'
  const innerStep = container(inner, 'inner', [marker('before-fail'), failBlock('fail'), marker('after-fail')], placement(inner))
  const outerBody: NestStep[] = withThen ? [innerStep, marker('inner-then')] : [innerStep]
  const outerStep = container(outer, 'outer', outerBody, placement(outer))
  const chain: NestStep[] = withThen ? [outerStep, marker('outer-then')] : [outerStep]
  const spec: Omit<NestingGraphSpec, 'name'> =
    wrap === 'trycatch' ? { chain, topTry: { catchBody: [marker('top-catch')] } } : { chain }

  const built = buildNestingGraph({ ...spec, name: cellId })
  const graph = withThen ? built : graphWithoutBookend(built)
  const bookend = graph.bookendId

  const expectations: Expectation[] = [...untakenNeverRun(graph, ['outer', 'inner']), NO_NODE_RUNNING]
  // A block failure inside a Wait Until retry lane has no settled outcome, so those cells check routing only.
  if (outer !== 'wait-until' && inner !== 'wait-until') {
    expectations.push(
      runsTimes('before-fail', 1, 'the failing slot runs once: the failure ends every container around it'),
      runsTimes('after-fail', 0, 'the Block after the failing Block never runs'),
      ...paintsOnCanvas(graph, 'fail', 'failed', 'the failing Block paints failed'),
    )
    for (const [id, kind] of [['inner', inner], ['outer', outer]] as const) {
      if (FAILS_AT_ITS_NODE.includes(kind)) {
        expectations.push(...paintsOnCanvas(graph, id, 'failed', `${KIND_TEXT[kind]} around the failure paints failed`))
      }
    }
    if (withThen) {
      expectations.push(
        runsTimes('inner-then', 0, "the inner container's then successor never runs"),
        runsTimes('outer-then', 0, "the outer container's then successor never runs"),
      )
    }
    if (wrap === 'bare') {
      expectations.push(verdictIs('failed'))
      if (withThen) expectations.push(runsTimes(bookend, 0, 'nothing after the failure runs (the bookend)'))
    } else {
      expectations.push(
        verdictIs('passed'),
        runsTimes('top-catch', 1, 'the top-level catch path runs once'),
        ranBefore('before-fail', 'top-catch', 'the catch runs after the failure'),
      )
      if (withThen) {
        expectations.push(
          runsTimes(bookend, 1, "the top-level Try/Catch's then successor (the bookend) runs once"),
          ranBefore('top-catch', bookend, 'the catch runs before the then successor'),
        )
      }
    }
  }

  const around = wrap === 'trycatch' ? 'inside a top-level Try/Catch' : 'with no Try/Catch around it'
  const thens = withThen ? 'every container has a then successor' : 'no container has a then successor'
  return {
    cellId,
    title: `${cellId}: a failing Block inside ${KIND_TEXT[inner]} inside ${KIND_TEXT[outer]}, ${around}, ${thens}`,
    spec,
    withoutBookend: !withThen,
    expectations,
  }
}

/** Every B3 cell whose outer container is `outer`, in registration order. */
export function failurePlans(outer: ContainerKind): FailureCellPlan[] {
  return CONTAINER_KINDS.flatMap((inner) =>
    FAILURE_WRAPS.flatMap((wrap) => THEN_VARIANTS.map((then) => failurePlan(outer, inner, wrap, then))),
  )
}

export function failureDescribeTitle(outer: ContainerKind): string {
  return `Matrix B3: a failing Block at depth 2 inside ${KIND_TEXT[outer]}`
}

export async function runFailureCell(page: Page, plan: FailureCellPlan): Promise<void> {
  if (plan.withoutBookend) {
    const opened = await openSignalCell(page, plan.cellId, plan.spec, { requireValid: true, rewrite: graphWithoutBookend })
    if (!opened.cell) return
    const run = await runCell(page, opened.cell, { awaitBookend: false })
    applyExpectations(opened.cell, run, plan.expectations)
    return
  }
  const cell = await openCell(page, plan.cellId, plan.spec)
  const run = await runCell(page, cell)
  applyExpectations(cell, run, plan.expectations)
}
