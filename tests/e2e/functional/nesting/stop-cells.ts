/** Matrix B6 cells: an Immediate Stop while a Shell Script at depth 3 runs, the same container kind at every level. */

import { expect, type Page } from '../../helpers/playwright-fixtures'
import { getLogTexts } from '../../helpers/log-reader'
import {
  CONTAINER_KINDS,
  buildNestingGraph,
  container,
  hostProbe,
  type ContainerKind,
  type ContainerOptions,
  type NestingGraphSpec,
  type NestStep,
} from '../../helpers/nesting-graph'
import { clickStopImmediate } from '../debug-step/helpers'
import { finishCell, openCell, startCellRun } from './nesting-harness'
import {
  applyExpectations,
  NO_NODE_RUNNING,
  paintsOnCanvas,
  runsTimes,
  untakenNeverRun,
  variableReads,
  verdictIs,
  type Expectation,
} from './signal-expectations'
import { KIND_TEXT } from './signal-steps'
import {
  expectTreeGone,
  expectWorkersGone,
  readyText,
  treeHoldScript,
  treeProbe,
  workerPidRecorder,
} from './stop-probes'

export const CELL_TIMEOUT_MS = 300_000
const READY_TIMEOUT_MS = 90_000
const STOP_BOUND_MS = 10_000
const STOPPED_RUN_SETTLE_MS = 60_000
const HELD_WAIT_TIMEOUT_MS = 180_000
const SESSION_VARIABLE = 'b6_sid'
const TREE_PROBE_ID = 'b6-probe'
const TREE_VARIABLE = 'stop_probe'
const WORKER_VARIABLE = 'probe_during'
const CONTAINER_IDS = ['k1', 'k2', 'k3'] as const

/** If/Else and split Assert hand their branch to the main flow, so they are not in flight while it runs. */
const DIVERGING_KINDS: readonly ContainerKind[] = ['if-else', 'assert-split']

export type StopCellPlan = {
  cellId: string
  title: string
  spec: Omit<NestingGraphSpec, 'name'>
  probesWorkers: boolean
  expectations: Expectation[]
}

export function stopCellId(kind: ContainerKind): string {
  return `B6.${kind}`
}

function levelOptions(kind: ContainerKind): ContainerOptions {
  if (kind === 'wait-until') return { timeoutMs: HELD_WAIT_TIMEOUT_MS }
  if (kind === 'remote-exec') return { sessionVar: SESSION_VARIABLE }
  return {}
}

export function stopPlan(kind: ContainerKind): StopCellPlan {
  const cellId = stopCellId(kind)
  const probesWorkers = kind === 'remote-exec'
  const options = levelOptions(kind)
  const depth3: NestStep[] = probesWorkers
    ? [
        hostProbe('b6-host', 'b6_host'),
        workerPidRecorder('b6-workers', SESSION_VARIABLE, WORKER_VARIABLE),
        treeHoldScript('b6-script'),
      ]
    : [treeHoldScript('b6-script')]
  const k3 = container(kind, 'k3', depth3, { options })
  const k2 = container(kind, 'k2', [k3], { options })
  const k1 = container(kind, 'k1', [k2], { options })
  const spec: Omit<NestingGraphSpec, 'name'> = { chain: [k1, treeProbe(TREE_PROBE_ID, TREE_VARIABLE)] }

  const graph = buildNestingGraph({ ...spec, name: cellId })
  const expectations: Expectation[] = [
    verdictIs('stopped'),
    ...untakenNeverRun(graph, CONTAINER_IDS),
    variableReads(TREE_VARIABLE, '', 'nothing after the Stop runs (the tree probe after the containers)'),
    runsTimes(graph.bookendId, 0, 'nothing after the Stop runs (the bookend)'),
    ...paintsOnCanvas(graph, 'b6-script', 'stopped', 'the running Shell Script paints stopped'),
    NO_NODE_RUNNING,
  ]
  if (!DIVERGING_KINDS.includes(kind)) {
    for (const id of CONTAINER_IDS) {
      expectations.push(
        ...paintsOnCanvas(graph, id, 'stopped', `the in-flight ${id} (${KIND_TEXT[kind]}) around the running Block paints stopped`),
      )
    }
  }

  return {
    cellId,
    title: `${cellId}: an Immediate Stop while a Shell Script runs at depth 3 inside ${KIND_TEXT[kind]} nested three deep`,
    spec,
    probesWorkers,
    expectations,
  }
}

export function stopPlans(): StopCellPlan[] {
  return CONTAINER_KINDS.map(stopPlan)
}

export const STOP_DESCRIBE = 'Matrix B6: an Immediate Stop at depth 3 inside each container kind'

export async function runStopCell(page: Page, plan: StopCellPlan): Promise<void> {
  const cell = await openCell(page, plan.cellId, plan.spec)
  await startCellRun(page, cell)
  const ready = readyText(cell.token)
  await expect
    .poll(async () => (await getLogTexts(page)).some((text) => text.includes(ready)), {
      timeout: READY_TIMEOUT_MS,
      message: `${plan.cellId}: the Shell Script at depth 3 prints its ready line before the Stop`,
    })
    .toBe(true)

  await clickStopImmediate(page)
  await expect
    .soft(page.locator('[data-testid="workflow-status"]'), `${plan.cellId}: the run reaches stopped within 10 s of the Immediate Stop`)
    .toHaveAttribute('data-status', 'stopped', { timeout: STOP_BOUND_MS })
  const run = await finishCell(page, cell, { timeoutMs: STOPPED_RUN_SETTLE_MS, awaitBookend: false })
  applyExpectations(cell, run, plan.expectations)

  await expectTreeGone(page, cell, TREE_PROBE_ID, TREE_VARIABLE)
  if (plan.probesWorkers) await expectWorkersGone(page, cell, run, WORKER_VARIABLE)
}
