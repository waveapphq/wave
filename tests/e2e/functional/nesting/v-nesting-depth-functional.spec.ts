/**
 * V-NESTING-DEPTH-FUNCTIONAL: containers inside Remote Execution bodies, a depth-4 chain, a Function inside a Function
 * Wireframe: N/A (no visual surface)
 * Design Decisions: REMEX-1, REMEX-3, REMEX-4, FIO-10, SHRUN-1
 * REQ: REQ-3.1.1.4, REQ-3.4.1.3, REQ-3.2.1.1, REQ-3.1.2.1
 *
 * Every Remote Execution opens its session on the shared sshd host at the head of the Test
 * (connection-scoped, no remote writes). A Shell Script on WAVE prints the WAVE host name first.
 * Host probes are File I/O reads of /etc/hostname; worker probes are File I/O reads of
 * /proc/self/stat, whose parent pid field is the worker that started the request process.
 *
 * D.rx-body.<container>: wave-host -> Remote Execution outer (body: pid-before -> inner container
 * (marker, host probe, worker probe, Variable Setter) -> inner-then -> pid-after) -> outer-then.
 *   1. The graph imports with zero validation errors and run-context validation reports none
 *   2. The run verdict is passed; the inner sub-flow runs the expected number of times; untaken
 *      branch markers never run; siblings, inner-then, outer-then and the bookend run once
 *   3. No node is left running; no console ERROR line; nest_inner reads inner-<token> at the top
 *   4. The host probe inside the container reads wave-e2e-host, not the WAVE host name
 *   5. The worker probe inside the container reads the same worker pid as the probes before and
 *      after the container in the body
 *   6. The container carries the L locus badge; the remotable probes carry R (for a Function, the host probe is
 *      read in the drilled Function body)
 * D.rx-in-rx: a Remote Execution with its own session inside a Remote Execution body.
 *   Criteria 1-4 and 6; the inner body's worker pid differs from the outer body's, and the outer
 *   worker serves the outer body before and after the inner container.
 * D.depth4-chain: For > Try/Catch try > Parallel lane > Switch/Case case > Remote Execution body >
 *   File I/O read. Every level's then successor runs once per enclosing entry, the read lands on
 *   the Execution Host, the run passes with no node running and no ERROR line.
 * D.fn-in-fn: a Function whose For body calls a Function holding a Switch/Case and a Try/Catch.
 *   Every marker runs once per enclosing entry, untaken markers never run, nest_inner written in the
 *   inner Function reads at the top, the run passes with no node running and no ERROR line.
 * D.rx-first-to-finish: a Remote Execution body holds a Parallel set to first to finish; lane 1 holds a
 *   60 s HTTP request on the Execution Host (http-target), lane 2 waits on WAVE, records this connection's
 *   worker and request process pids, and finishes first; a File I/O read of /etc/hostname follows the
 *   Parallel in the same body.
 *   1. The run passes; the cut-off lane paints stopped; no node is left running; no console ERROR line
 *   2. The read after the Parallel runs on the Execution Host, and the body's then successor runs once
 *   3. The recording saw the worker and the held request's process, and every recorded pid reads gone
 *      after the run (polled to a bound)
 */

import { test, expect, type Page } from '../../helpers/playwright-fixtures'
import { HTTP_TARGET_SERVICE } from '../../helpers/config'
import { pluginNode } from '../../helpers/k8s-nodes'
import {
  CONTAINER_KINDS,
  DEFAULT_LOOP_ITERATIONS,
  DEFAULT_WAIT_ROUNDS,
  TOKEN_PLACEHOLDER,
  container,
  delayBlock,
  hostProbe,
  leaf,
  marker,
  setter,
  type ContainerKind,
  type NestLeaf,
  type NestStep,
} from '../../helpers/nesting-graph'
import { digIn } from '../../helpers/workbench'
import {
  expectDifferentWorkers,
  expectLocusBadge,
  expectReadOnExecutionHost,
  expectSameWorker,
  waveHostProbe,
  workerPidProbe,
} from './execution-host-probes'
import {
  deleteCellEntities,
  expectMarkerCount,
  expectNoErrorLines,
  expectNoNodeRunning,
  expectNodePaint,
  expectRanBefore,
  expectVariable,
  expectVerdict,
  openCell,
  runCell,
  type CellRun,
  type NestCell,
} from './nesting-harness'
import { deleteStopProbeTests, expectWorkersGone, workerPidRecorder } from './stop-probes'

const CELL_TIMEOUT_MS = 300_000
const RUN_TIMEOUT_MS = 180_000
const INNER_VARIABLE = 'nest_inner'
const FIRST_SESSION_VARIABLE = 'first_sid'
const FIRST_PIDS_VARIABLE = 'first_pids'
// Long enough for lane 1's request to be in flight on the host before lane 2 records the pids.
const FAST_LANE_DELAY_MS = 3_000
const HELD_REQUEST_URL = `https://${HTTP_TARGET_SERVICE}:9443/delay/60`

const KIND_TITLE: Readonly<Record<ContainerKind, string>> = {
  'if-else': 'an If/Else',
  'switch-case': 'a Switch/Case',
  'assert-split': 'a split Assert',
  for: 'a For Loop',
  'for-each': 'a For Each',
  while: 'a While',
  'wait-until': 'a Wait Until',
  parallel: 'a Parallel',
  'try-catch': 'a Try/Catch',
  'remote-exec': 'a Remote Execution',
  function: 'a Function',
}

function innerSetter(id: string): NestStep {
  return setter(id, {
    [INNER_VARIABLE]: { value: `inner-${TOKEN_PLACEHOLDER}`, type: 'string', seed: '', flow: 'export' },
  })
}

/** Sub-flow runs for one entry of the container (LOOP:11, LOOP:41, LOOP:73, WU:53). */
function subFlowRuns(kind: ContainerKind): number {
  if (kind === 'for' || kind === 'for-each' || kind === 'while') return DEFAULT_LOOP_ITERATIONS
  if (kind === 'wait-until') return DEFAULT_WAIT_ROUNDS
  return 1
}

function expectEveryUntakenSilent(cell: NestCell, run: CellRun): void {
  for (const info of Object.values(cell.graph.containers)) {
    for (const id of info.untaken) expectMarkerCount(cell, run, id, 0, 'an untaken branch never runs')
  }
}

async function rxBodyCell(page: Page, kind: ContainerKind): Promise<void> {
  const cellId = `D.rx-body.${kind}`
  const inner = container(kind, 'inner', [
    marker('inner-body'),
    hostProbe('inner-host', 'host_inner'),
    workerPidProbe('inner-pid', 'pid_inner'),
    innerSetter('inner-set'),
  ])
  const outer = container('remote-exec', 'outer', [
    workerPidProbe('pid-before', 'pid_before'),
    inner,
    marker('inner-then'),
    workerPidProbe('pid-after', 'pid_after'),
  ])
  const cell = await openCell(page, cellId, { chain: [waveHostProbe('wave-host'), outer, marker('outer-then')] })
  const run = await runCell(page, cell, { timeoutMs: RUN_TIMEOUT_MS })
  const info = cell.graph.containers.inner

  expectVerdict(cell, run, 'passed')
  expectMarkerCount(cell, run, 'inner-body', subFlowRuns(kind), 'the inner sub-flow runs the expected number of times')
  expectEveryUntakenSilent(cell, run)
  for (const id of info.siblings) expectMarkerCount(cell, run, id, 1, 'the inner sibling lane runs once')
  expectMarkerCount(cell, run, 'inner-then', 1, 'the inner then successor (or rejoin) runs once')
  expectMarkerCount(cell, run, 'outer-then', 1, 'the outer then successor runs once')
  expectMarkerCount(cell, run, cell.graph.bookendId, 1, 'the bookend runs once')
  expectRanBefore(cell, run, 'inner-body', 'outer-then', 'the inner sub-flow runs inside the body')
  expectRanBefore(cell, run, 'inner-then', 'outer-then', 'the inner then successor runs inside the body')
  expectRanBefore(cell, run, 'outer-then', cell.graph.bookendId, 'the outer then successor runs before the bookend')
  expectNoNodeRunning(cell, run)
  expectNoErrorLines(cell, run)
  expectVariable(cell, run, INNER_VARIABLE, `inner-${cell.token}`, 'the variable written at the innermost depth reads at the top')

  expectReadOnExecutionHost(cell, run, 'host_inner', 'a remotable Block inside the container runs on the Execution Host')
  expectSameWorker(cell, run, 'pid_before', 'pid_inner', 'a remotable Block inside the container runs through the body worker')
  expectSameWorker(cell, run, 'pid_before', 'pid_after', 'the body worker still serves the body after the container')
  await expectLocusBadge(page, cell, 'inner', 'L', 'the container runs on WAVE')
  await expectLocusBadge(page, cell, 'pid-before', 'R', 'a remotable body Block runs on the host')
  if (kind === 'function') {
    await digIn(page, 'inner')
    await expect(
      page.locator('[data-testid="workflow-node-inner-host"]'),
      `${cellId}: the drilled Function body shows the host probe`,
    ).toBeVisible({ timeout: 15_000 })
  }
  await expectLocusBadge(page, cell, 'inner-host', 'R', 'a remotable Block inside the container runs on the host')
}

async function rxInRxCell(page: Page): Promise<void> {
  const cellId = 'D.rx-in-rx'
  const inner = container(
    'remote-exec',
    'inner',
    [marker('inner-body'), hostProbe('inner-host', 'host_inner'), workerPidProbe('inner-pid', 'pid_inner'), innerSetter('inner-set')],
    { options: { sessionVar: 'nest_sid_inner' } },
  )
  const outer = container('remote-exec', 'outer', [
    workerPidProbe('outer-pid', 'pid_outer'),
    hostProbe('outer-host', 'host_outer'),
    inner,
    marker('inner-then'),
    workerPidProbe('outer-pid-after', 'pid_outer_after'),
  ])
  const cell = await openCell(page, cellId, { chain: [waveHostProbe('wave-host'), outer, marker('outer-then')] })
  expect(cell.graph.sshOpenIds.length, `${cellId}: the inner Remote Execution has its own Execution Host session`).toBe(2)
  const run = await runCell(page, cell, { timeoutMs: RUN_TIMEOUT_MS })

  expectVerdict(cell, run, 'passed')
  expectMarkerCount(cell, run, 'inner-body', 1, 'the inner body runs once')
  expectMarkerCount(cell, run, 'inner-then', 1, 'the inner then successor runs once')
  expectMarkerCount(cell, run, 'outer-then', 1, 'the outer then successor runs once')
  expectMarkerCount(cell, run, cell.graph.bookendId, 1, 'the bookend runs once')
  expectRanBefore(cell, run, 'inner-body', 'inner-then', 'the inner body runs before its then successor')
  expectRanBefore(cell, run, 'inner-then', 'outer-then', 'the inner then successor runs inside the outer body')
  expectNoNodeRunning(cell, run)
  expectNoErrorLines(cell, run)
  expectVariable(cell, run, INNER_VARIABLE, `inner-${cell.token}`, 'the variable written in the inner body reads at the top')

  expectReadOnExecutionHost(cell, run, 'host_outer', 'the outer body read runs on the Execution Host')
  expectReadOnExecutionHost(cell, run, 'host_inner', 'the inner body read runs on its Execution Host')
  expectDifferentWorkers(cell, run, 'pid_outer', 'pid_inner', 'the inner Remote Execution opens its own worker')
  expectSameWorker(cell, run, 'pid_outer', 'pid_outer_after', 'the outer worker serves the outer body after the inner container')
  await expectLocusBadge(page, cell, 'inner', 'L', 'the inner Remote Execution container runs on WAVE')
  await expectLocusBadge(page, cell, 'outer-host', 'R', 'a remotable outer body Block runs on the host')
  await expectLocusBadge(page, cell, 'inner-host', 'R', 'a remotable inner body Block runs on the host')
}

async function depthFourCell(page: Page): Promise<void> {
  const cellId = 'D.depth4-chain'
  const rx = container('remote-exec', 'd4-rx', [hostProbe('d4-read', 'd4_host'), marker('d4-body')])
  const sw = container('switch-case', 'd4-switch', [rx, marker('d4-rx-then')])
  const par = container('parallel', 'd4-par', [sw, marker('d4-switch-then')])
  const tc = container('try-catch', 'd4-try', [par, marker('d4-par-then')])
  const loop = container('for', 'd4-for', [tc, marker('d4-try-then')])
  const cell = await openCell(page, cellId, { chain: [waveHostProbe('wave-host'), loop, marker('d4-for-then')] })
  const run = await runCell(page, cell, { timeoutMs: RUN_TIMEOUT_MS })
  const iterations = DEFAULT_LOOP_ITERATIONS

  expectVerdict(cell, run, 'passed')
  expectMarkerCount(cell, run, 'd4-body', iterations, 'the Remote Execution body runs once per loop iteration')
  expectMarkerCount(cell, run, 'd4-rx-then', iterations, 'the Remote Execution then successor runs inside the case')
  expectMarkerCount(cell, run, 'd4-switch-then', iterations, 'the Switch/Case then successor runs inside the lane')
  expectMarkerCount(cell, run, 'd4-par-then', iterations, 'the Parallel then successor runs inside the try path')
  expectMarkerCount(cell, run, 'd4-try-then', iterations, 'the Try/Catch then successor runs inside the loop body')
  for (const id of cell.graph.containers['d4-par'].siblings) {
    expectMarkerCount(cell, run, id, iterations, 'the second lane runs once per loop iteration')
  }
  expectEveryUntakenSilent(cell, run)
  expectMarkerCount(cell, run, 'd4-for-then', 1, 'the For then successor runs once')
  expectMarkerCount(cell, run, cell.graph.bookendId, 1, 'the bookend runs once')
  expectRanBefore(cell, run, 'd4-body', 'd4-for-then', 'the body runs inside the loop, before the For then successor')
  expectRanBefore(cell, run, 'd4-try-then', 'd4-for-then', 'the loop body runs before the For then successor')
  expectRanBefore(cell, run, 'd4-for-then', cell.graph.bookendId, 'the For then successor runs before the bookend')
  expectNoNodeRunning(cell, run)
  expectNoErrorLines(cell, run)
  expectReadOnExecutionHost(cell, run, 'd4_host', 'the File I/O read at the bottom of the chain runs on the Execution Host')
  await expectLocusBadge(page, cell, 'd4-read', 'R', 'the File I/O read in the body runs on the host')
}

async function functionInFunctionCell(page: Page): Promise<void> {
  const cellId = 'D.fn-in-fn'
  const innerFn = container('function', 'fn-inner', [
    container('switch-case', 'fn-switch', [marker('fn-case-body'), innerSetter('fn-set')]),
    marker('fn-switch-then'),
    container('try-catch', 'fn-try', [marker('fn-try-body')]),
    marker('fn-try-then'),
  ])
  const outerFn = container('function', 'fn-outer', [
    marker('fn-outer-body'),
    container('for', 'fn-for', [innerFn, marker('fn-inner-after')]),
    marker('fn-for-then'),
  ])
  const cell = await openCell(page, cellId, { chain: [outerFn, marker('outer-then')] })
  const run = await runCell(page, cell, { timeoutMs: RUN_TIMEOUT_MS })
  const iterations = DEFAULT_LOOP_ITERATIONS

  expectVerdict(cell, run, 'passed')
  expectMarkerCount(cell, run, 'fn-outer-body', 1, 'the outer Function body runs once')
  for (const id of ['fn-case-body', 'fn-switch-then', 'fn-try-body', 'fn-try-then', 'fn-inner-after']) {
    expectMarkerCount(cell, run, id, iterations, 'the inner Function and its containers run once per loop iteration')
  }
  expectEveryUntakenSilent(cell, run)
  expectMarkerCount(cell, run, 'fn-for-then', 1, 'the For then successor inside the outer Function runs once')
  expectMarkerCount(cell, run, 'outer-then', 1, 'the node after the outer Function runs once')
  expectMarkerCount(cell, run, cell.graph.bookendId, 1, 'the bookend runs once')
  expectRanBefore(cell, run, 'fn-outer-body', 'fn-case-body', 'the outer Function body runs before the loop it holds')
  expectRanBefore(cell, run, 'fn-inner-after', 'fn-for-then', 'the loop body runs before the For then successor')
  expectRanBefore(cell, run, 'fn-for-then', 'outer-then', 'the outer Function body runs before its sibling-after')
  expectNoNodeRunning(cell, run)
  expectNoErrorLines(cell, run)
  expectVariable(cell, run, INNER_VARIABLE, `inner-${cell.token}`, 'the output written in the inner Function reads at the top')
}

/** A remotable HTTP request the host holds open for 60 s. */
function heldRemoteRequest(id: string): NestLeaf {
  return leaf(
    pluginNode({
      id,
      label: 'HTTP',
      elementType: 'http-client',
      category: 'network',
      description: id,
      values: { method: 'GET', url: HELD_REQUEST_URL, timeout: 120, retry_count: 0, verify_ssl: false },
    }),
  )
}

async function firstToFinishCell(page: Page): Promise<void> {
  const cellId = 'D.rx-first-to-finish'
  const par = container('parallel', 'first-par', [heldRemoteRequest('held-request')], {
    options: { join: 'first' },
    lanes: [
      [
        delayBlock('fast-delay', FAST_LANE_DELAY_MS),
        workerPidRecorder('fast-pids', FIRST_SESSION_VARIABLE, FIRST_PIDS_VARIABLE, 'workers-and-requests'),
      ],
    ],
  })
  const rx = container('remote-exec', 'first-rx', [par, hostProbe('after-read', 'host_after'), marker('after-par')], {
    options: { sessionVar: FIRST_SESSION_VARIABLE },
  })
  const cell = await openCell(page, cellId, { chain: [waveHostProbe('wave-host'), rx, marker('rx-then')] })
  const run = await runCell(page, cell, { timeoutMs: RUN_TIMEOUT_MS })

  expectVerdict(cell, run, 'passed')
  expectNodePaint(cell, run, 'held-request', 'stopped', 'the lane cut off by the first to finish paints stopped')
  expectMarkerCount(cell, run, 'after-par', 1, 'the body goes on after the Parallel')
  expectMarkerCount(cell, run, 'rx-then', 1, 'the Remote Execution then successor runs once')
  expectRanBefore(cell, run, 'after-par', 'rx-then', 'the body ends before its then successor')
  expectNoNodeRunning(cell, run)
  expectNoErrorLines(cell, run)
  expectReadOnExecutionHost(cell, run, 'host_after', 'a remotable Block after the cut-off lane still runs on the Execution Host')
  const recorded = String(run.variables[FIRST_PIDS_VARIABLE]?.value ?? '').trim()
  expect
    .soft(recorded.split(' ').filter(Boolean).length, `${cellId}: the recording saw the worker and the held request's process (pids ${recorded})`)
    .toBeGreaterThanOrEqual(2)
  await expectWorkersGone(page, cell, run, FIRST_PIDS_VARIABLE, 'the run')
}

test.describe('Matrix D: every container kind inside a Remote Execution body', () => {
  test.afterEach(async ({ request }, testInfo) => deleteCellEntities(request, testInfo))
  for (const kind of CONTAINER_KINDS.filter((k) => k !== 'remote-exec')) {
    test(`D.rx-body.${kind}: ${KIND_TITLE[kind]} inside a Remote Execution body steers on WAVE while its remotable Blocks use the body worker`, async ({
      page,
    }) => {
      test.setTimeout(CELL_TIMEOUT_MS)
      await rxBodyCell(page, kind)
    })
  }
})

test.describe('Matrix D: depth and nested bodies', () => {
  test.afterEach(async ({ request }, testInfo) => deleteCellEntities(request, testInfo))
  test('D.rx-in-rx: a Remote Execution inside a Remote Execution body opens its own worker on its own Execution Host', async ({
    page,
  }) => {
    test.setTimeout(CELL_TIMEOUT_MS)
    await rxInRxCell(page)
  })

  test('D.depth4-chain: For > Try/Catch > Parallel lane > Switch/Case > Remote Execution body > File I/O read on the host', async ({
    page,
  }) => {
    test.setTimeout(CELL_TIMEOUT_MS)
    await depthFourCell(page)
  })

  test('D.fn-in-fn: a Function inside a Function body holding containers runs as at Test level', async ({ page }) => {
    test.setTimeout(CELL_TIMEOUT_MS)
    await functionInFunctionCell(page)
  })
})

test.describe('Matrix D: a lane cut off inside a Remote Execution body', () => {
  test.afterEach(async ({ request }, testInfo) => deleteCellEntities(request, testInfo))
  test.afterEach(async ({ request }, testInfo) => deleteStopProbeTests(request, testInfo))
  test('D.rx-first-to-finish: a remotable Block after a first-to-finish Parallel still runs on the Execution Host and no worker is left', async ({
    page,
  }) => {
    test.setTimeout(CELL_TIMEOUT_MS)
    await firstToFinishCell(page)
  })
})
