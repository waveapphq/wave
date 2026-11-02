/** Planned expectations for the Matrix B signal cells: each cell builds its list once and checks it against the run. */

import type { NestingGraph } from '../../helpers/nesting-graph'
import {
  expectMarkerCount,
  expectNoNodeRunning,
  expectNodePaint,
  expectRanBefore,
  expectVariable,
  expectVerdict,
  type CellRun,
  type NestCell,
} from './nesting-harness'

export type Expectation =
  | { check: 'verdict'; verdict: string }
  | { check: 'count'; id: string; count: number; criterion: string }
  | { check: 'order'; earlier: string; later: string; criterion: string }
  | { check: 'paint'; id: string; status: string; criterion: string }
  | { check: 'variable'; name: string; value: unknown; criterion: string }
  | { check: 'no-running' }

export const verdictIs = (verdict: string): Expectation => ({ check: 'verdict', verdict })

export const runsTimes = (id: string, count: number, criterion: string): Expectation => ({
  check: 'count',
  id,
  count,
  criterion,
})

export const ranBefore = (earlier: string, later: string, criterion: string): Expectation => ({
  check: 'order',
  earlier,
  later,
  criterion,
})

export const paints = (id: string, status: string, criterion: string): Expectation => ({
  check: 'paint',
  id,
  status,
  criterion,
})

export const variableReads = (name: string, value: unknown, criterion: string): Expectation => ({
  check: 'variable',
  name,
  value,
  criterion,
})

export const NO_NODE_RUNNING: Expectation = { check: 'no-running' }

/** A paint expectation only for a node the Test's own canvas shows (a Function body is not on it). */
export function paintsOnCanvas(graph: NestingGraph, id: string, status: string, criterion: string): Expectation[] {
  return graph.testNodeIds.includes(id) ? [paints(id, status, criterion)] : []
}

/** Every generated marker of a slot the run is not routed into never runs. */
export function untakenNeverRun(graph: NestingGraph, containerIds: readonly string[]): Expectation[] {
  return containerIds.flatMap((id) =>
    (graph.containers[id]?.untaken ?? []).map((marker) => runsTimes(marker, 0, 'an untaken branch never runs')),
  )
}

/** Soft-check every planned expectation; each message names the cell and the criterion. */
export function applyExpectations(cell: NestCell, run: CellRun, expectations: readonly Expectation[]): void {
  for (const e of expectations) {
    switch (e.check) {
      case 'verdict':
        expectVerdict(cell, run, e.verdict)
        break
      case 'count':
        expectMarkerCount(cell, run, e.id, e.count, e.criterion)
        break
      case 'order':
        expectRanBefore(cell, run, e.earlier, e.later, e.criterion)
        break
      case 'paint':
        expectNodePaint(cell, run, e.id, e.status, e.criterion)
        break
      case 'variable':
        expectVariable(cell, run, e.name, e.value, e.criterion)
        break
      case 'no-running':
        expectNoNodeRunning(cell, run)
        break
    }
  }
}

/** One line per expectation, for the cell inventory. */
export function describeExpectation(e: Expectation): string {
  switch (e.check) {
    case 'verdict':
      return `verdict ${e.verdict}`
    case 'count':
      return `${e.id} x${e.count}`
    case 'order':
      return `${e.earlier} < ${e.later}`
    case 'paint':
      return `${e.id} paints ${e.status}`
    case 'variable':
      return `${e.name} = ${JSON.stringify(e.value)}`
    case 'no-running':
      return 'no node running'
  }
}
