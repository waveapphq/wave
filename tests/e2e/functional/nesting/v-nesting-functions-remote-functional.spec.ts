/**
 * V-NESTING-FUNCTIONS-REMOTE-FUNCTIONAL: Functions and Remote Execution combined at more than one level
 * Wireframe: N/A (no visual surface)
 * Design Decisions: REMEX-3, REMEX-4, REMEX-5, REMEX-6, CANVAS-81
 * REQ: REQ-3.4.1.3, REQ-3.1.1.4, REQ-3.2.1.1, REQ-3.2.1.3, REQ-3.2.2.3
 *
 * Every Remote Execution opens its session on the shared sshd host at the head of the Test (connection-scoped).
 * Host probes are File I/O reads of /etc/hostname; worker probes are File I/O reads of /proc/self/stat, whose parent
 * pid field is the worker that started the request process. A Shell Script on WAVE prints the WAVE host name.
 *
 * F.fn-in-fn-in-body: Remote Execution body > Function > Function > host probe and worker probe.
 *   1. The graph imports with zero validation errors and run-context validation reports none
 *   2. The run passes; the Blocks after each Function and after the container run once, in order; no node is left
 *      running; no console ERROR line
 *   3. The deep host probe's output reaches the Test through both Functions and reads the remote host name
 *   4. The deep worker probe reads the same worker pid as the probes before and after the outer Function in the body
 *   5. The body probe carries R; drilled through both Functions, the deep probes carry R
 * F.rx-in-fn-in-body: outer Remote Execution body > Function > inner Remote Execution (its session a Function input).
 *   1-2 as above; the inner body reads the remote host name; the inner worker pid differs from the outer body's; the
 *   outer worker serves a probe after the Function; every worker pid either connection recorded reads gone after the
 *   run (polled to a bound)
 * F.containers-in-fn-in-body: Remote Execution body > Function > For Loop (2) > Parallel (2 lanes) > Try/Catch whose
 *   try path reads a file that exists on WAVE only and whose catch path holds a host probe and a worker probe.
 *   1-2 as above (the failing read excepted); the loop body runs twice; both lanes run; the catch path runs once
 *   and reads the remote host name; every worker probe (both loop iterations, both lanes, the catch path, after the
 *   Function) reads the body's worker pid
 * F.same-fn-two-calls: one library Function holding a host probe, called inside a Remote Execution body and outside it.
 *   1-2 as above; the call inside reads the remote host name, the call outside reads the WAVE host name; drilled
 *   from the inside instance the probe carries R. The badge drilled from the outside instance is recorded only.
 * F.rx-fn-in-loop-and-lane: a Function whose body holds a Remote Execution (session a Function input), called twice
 *   from a For Loop body and once from a Parallel lane.
 *   1-2 as above; every call reads the remote host name; each call's worker pid differs from every other call's;
 *   every worker pid the calls recorded reads gone after the run (polled to a bound)
 * F.session-through-two-fns: the session passes Test > outer Function input > inner Function input > Remote
 *   Execution Execution Host.
 *   1-2 as above; the inner body reads the remote host name through a worker
 * F.debug-in-fn-in-body: a breakpoint on a remotable echo request to http-target (resolvable only on the remote host)
 *   inside a Function inside a Remote Execution body.
 *   1. Debug pauses on the Function instance, then on the echo Block on the drilled canvas before it runs; it carries R
 *   2. Repeat Step sends the request once, re-pauses on the Block, paints it passed; the next Block has not run
 *   3. Step Over pauses on the next Block before it runs
 *   4. Continue finishes passed; the Blocks after the Function run once; a host probe later in the Function reads the
 *      remote host name through the body's worker; no node is left running; no console ERROR line
 * F.run-scope-fn-in-body: Run Current on the WAVE host probe, then on the SSH Session Open (the session stays open),
 *   then Run Scope drilled into a Function whose instance sits in a Remote Execution body.
 *   1. The scoped run passes and its host probe output reads the remote host name, not the WAVE host name
 * F.testdata-in-fn-in-body: a File I/O read of a testdata:// path inside a Function called from a Remote Execution body.
 *   1. The Test saves and validates with no errors in the import, load and run contexts
 *   2. The run fails; an ERROR line names the read and carries the remote host refusal message; the Block after the
 *      read, the Block after the Function and the Block after the container never run; the Function instance paints
 *      failed; no node is left running
 * F.library-fn-standalone: a library Function holding remotable Blocks, opened from the library with no Test.
 *   1. The read-only View opens and shows both Blocks. Their locus badges are recorded only.
 */

import { test, expect, type Page } from '../../helpers/playwright-fixtures'
import { openFunctionView, openTest, validateTest } from '../../helpers/fn-seed'
import { getSessionVariables } from '../../helpers/fixture-import'
import {
  container,
  hostProbe,
  leaf,
  marker,
  TOKEN_PLACEHOLDER,
  type NestStep,
} from '../../helpers/nesting-graph'
import { markerNode } from '../../helpers/k8s-nodes'
import { clickNodeContextMenuItem, digIn, selectEnvironment } from '../../helpers/workbench'
import { clickContinue, clickRepeatStep, clickStepOver, toggleBreakpoint } from '../debug-step/helpers'
import { continueToTerminal, expectLiveMarkerCount, expectPausedOn } from './debug-adhoc-drive'
import {
  EXECUTION_HOST_NAME,
  WAVE_HOST_VARIABLE,
  expectDifferentWorkers,
  expectLocusBadge,
  expectReadOnExecutionHost,
  expectSameWorker,
  probeText,
  waveHostProbe,
  workerPid,
  workerPidProbe,
} from './execution-host-probes'
import {
  appended,
  appendTo,
  deleteLibraryOnlyFunctions,
  literalRead,
  liveEchoCount,
  locusBadgeOf,
  openCanvasCell,
  parentPid,
  publishFunctionsOnly,
  readPathFrom,
  recordedPids,
  recordUnsettled,
  remoteEcho,
  runAdHoc,
  waveOnlyFile,
  withVariable,
} from './functions-remote-probes'
import {
  deleteCellEntities,
  expectMarkerCount,
  expectNoErrorLines,
  expectNoNodeRunning,
  expectNodePaint,
  expectRanBefore,
  expectVerdict,
  finishCell,
  openCell,
  runCell,
  startCellDebug,
  type CellRun,
  type NestCell,
} from './nesting-harness'
import { deleteStopProbeTests, expectWorkersGone, workerPidRecorder } from './stop-probes'

const CELL_TIMEOUT_MS = 300_000
const RUN_TIMEOUT_MS = 180_000
const DRILL_TIMEOUT_MS = 15_000
const LIVE_SETTLE_MS = 10_000
const TESTDATA_PATH = 'testdata://f-remote-probe.txt'
const TESTDATA_REFUSAL =
  'testdata:// paths are not available on the remote host - use an absolute or relative path on the remote host'

async function drillInto(page: Page, cell: NestCell, functionId: string, shows: string): Promise<void> {
  await digIn(page, functionId)
  await expect(
    page.locator(`[data-testid="workflow-node-${shows}"]`),
    `${cell.cellId}: the drilled ${functionId} body shows ${shows}`,
  ).toBeVisible({ timeout: DRILL_TIMEOUT_MS })
}

function expectBlockOrder(cell: NestCell, run: CellRun, ids: readonly string[]): void {
  for (const id of ids) expectMarkerCount(cell, run, id, 1, `${id} runs once`)
  for (let i = 1; i < ids.length; i++) expectRanBefore(cell, run, ids[i - 1], ids[i], `${ids[i - 1]} runs before ${ids[i]}`)
}

function expectEveryWorkerIs(cell: NestCell, run: CellRun, reference: string, lines: readonly string[], criterion: string): void {
  const want = workerPid(run, reference)
  expect.soft(want, `${cell.cellId}: ${criterion} (${reference} read a worker pid)`).not.toBeNull()
  expect.soft(lines.map(parentPid), `${cell.cellId}: ${criterion} (every read names worker ${want})`).toEqual(lines.map(() => want))
}

async function fnInFnInBodyCell(page: Page): Promise<void> {
  const cellId = 'F.fn-in-fn-in-body'
  const inner = container('function', 'fn-inner', [hostProbe('deep-host', 'host_deep'), workerPidProbe('deep-pid', 'pid_deep')])
  const outer = container('function', 'fn-outer', [inner, marker('inner-fn-then')])
  const rx = container('remote-exec', 'rx', [
    workerPidProbe('pid-before', 'pid_before'),
    outer,
    marker('outer-fn-then'),
    workerPidProbe('pid-after', 'pid_after'),
  ])
  const cell = await openCanvasCell(page, cellId, { chain: [waveHostProbe('wave-host'), rx, marker('rx-then')] })
  const run = await runCell(page, cell, { timeoutMs: RUN_TIMEOUT_MS })

  expectVerdict(cell, run, 'passed')
  expectBlockOrder(cell, run, ['inner-fn-then', 'outer-fn-then', 'rx-then', cell.graph.bookendId])
  expectNoNodeRunning(cell, run)
  expectNoErrorLines(cell, run)
  expectReadOnExecutionHost(cell, run, 'host_deep', 'a remotable Block two Functions deep in the body runs on the remote host')
  expectSameWorker(cell, run, 'pid_before', 'pid_deep', 'a remotable Block two Functions deep runs through the body worker')
  expectSameWorker(cell, run, 'pid_before', 'pid_after', 'the body worker still serves the body after the Functions')
  await expectLocusBadge(page, cell, 'pid-before', 'R', 'a remotable body Block runs on the remote host')
  await drillInto(page, cell, 'fn-outer', 'fn-inner')
  await drillInto(page, cell, 'fn-inner', 'deep-host')
  await expectLocusBadge(page, cell, 'deep-host', 'R', 'drilled through both Functions, the host probe shows it runs on the remote host')
  await expectLocusBadge(page, cell, 'deep-pid', 'R', 'drilled through both Functions, the worker probe shows it runs on the remote host')
}

async function rxInFnInBodyCell(page: Page): Promise<void> {
  const cellId = 'F.rx-in-fn-in-body'
  const innerRx = container(
    'remote-exec',
    'rx-inner',
    [
      marker('inner-body'),
      hostProbe('inner-host', 'host_inner'),
      workerPidProbe('inner-pid', 'pid_inner'),
      workerPidRecorder('inner-pids', 'nest_sid_inner', 'inner_workers'),
    ],
    { options: { sessionVar: 'nest_sid_inner' } },
  )
  const fn = container('function', 'fn', [innerRx, marker('inner-rx-then')])
  const outerRx = container('remote-exec', 'rx-outer', [
    workerPidProbe('outer-pid', 'pid_outer'),
    hostProbe('outer-host', 'host_outer'),
    fn,
    marker('fn-then'),
    workerPidProbe('outer-pid-after', 'pid_outer_after'),
    workerPidRecorder('outer-pids', 'nest_sid', 'outer_workers'),
  ])
  const cell = await openCell(page, cellId, { chain: [waveHostProbe('wave-host'), outerRx, marker('rx-then')] })
  expect(cell.graph.sshOpenIds.length, `${cellId}: the inner Remote Execution has its own Execution Host session`).toBe(2)
  const run = await runCell(page, cell, { timeoutMs: RUN_TIMEOUT_MS })

  expectVerdict(cell, run, 'passed')
  expectBlockOrder(cell, run, ['inner-body', 'inner-rx-then', 'fn-then', 'rx-then', cell.graph.bookendId])
  expectNoNodeRunning(cell, run)
  expectNoErrorLines(cell, run)
  expectReadOnExecutionHost(cell, run, 'host_outer', 'the outer body read runs on the remote host')
  expectReadOnExecutionHost(cell, run, 'host_inner', 'the inner body read runs on its remote host')
  expectDifferentWorkers(cell, run, 'pid_outer', 'pid_inner', 'the inner Remote Execution inside the Function opens its own worker')
  expectSameWorker(cell, run, 'pid_outer', 'pid_outer_after', 'the outer body worker serves a probe after the Function')

  const pids = new Set([
    ...recordedPids(run, 'inner_workers'),
    ...recordedPids(run, 'outer_workers'),
    ...[workerPid(run, 'pid_inner'), workerPid(run, 'pid_outer')].filter((pid): pid is number => pid !== null),
  ])
  await expectWorkersGone(page, cell, withVariable(run, 'f_all_workers', [...pids].join(' ')), 'f_all_workers', 'the run')
}

async function containersInFnInBodyCell(page: Page): Promise<void> {
  const cellId = 'F.containers-in-fn-in-body'
  const loop = container(
    'for',
    'fn-loop',
    [marker('loop-body'), workerPidProbe('loop-pid', 'pid_loop'), appendTo('loop-acc', { acc_loop: 'pid_loop' }, 'export')],
    { options: { iterations: 2 } },
  )
  const par = container('parallel', 'fn-par', [workerPidProbe('lane1-pid', 'pid_lane1'), marker('lane-1-end')], {
    lanes: [[workerPidProbe('lane2-pid', 'pid_lane2'), marker('lane-2-end')]],
  })
  const tryCatch = container('try-catch', 'fn-try', [readPathFrom('try-read', 'wave_only_path'), marker('try-after-read')], {
    slots: { catch: [hostProbe('catch-host', 'host_catch'), workerPidProbe('catch-pid', 'pid_catch'), marker('catch-ran')] },
  })
  const fn = container('function', 'fn', [
    loop,
    marker('loop-then'),
    par,
    marker('par-then'),
    tryCatch,
    marker('try-then'),
  ])
  const rx = container('remote-exec', 'rx', [
    workerPidProbe('pid-before', 'pid_before'),
    fn,
    marker('fn-then'),
    workerPidProbe('pid-after', 'pid_after'),
  ])
  const cell = await openCell(page, cellId, {
    chain: [waveOnlyFile('wave-file', 'wave_only_path'), waveHostProbe('wave-host'), rx, marker('rx-then')],
  })
  const run = await runCell(page, cell, { timeoutMs: RUN_TIMEOUT_MS })

  expectVerdict(cell, run, 'passed')
  expectMarkerCount(cell, run, 'loop-body', 2, 'the For Loop inside the Function runs its body twice')
  expectMarkerCount(cell, run, 'lane-1-end', 1, 'lane 1 runs')
  expectMarkerCount(cell, run, 'lane-2-end', 1, 'lane 2 runs')
  expectMarkerCount(cell, run, 'try-after-read', 0, 'the Block after the failing read never runs')
  expectMarkerCount(cell, run, 'catch-ran', 1, 'the catch path runs once: the read failed on the remote host')
  expectBlockOrder(cell, run, ['loop-then', 'par-then', 'try-then', 'fn-then', 'rx-then', cell.graph.bookendId])
  expectRanBefore(cell, run, 'catch-ran', 'try-then', 'the catch path runs before the Try/Catch then successor')
  expectNoNodeRunning(cell, run)
  expectNoErrorLines(cell, run)
  expect.soft(probeText(run, 'wave_only_path'), `${cellId}: the WAVE-only file path was printed`).toMatch(/^\//)
  expectReadOnExecutionHost(cell, run, 'host_catch', 'the catch path host probe runs on the remote host')

  const loopReads = appended(run, 'acc_loop')
  expect.soft(loopReads.length, `${cellId}: both loop iterations recorded a worker read (${loopReads.join(' / ')})`).toBe(2)
  const reads = [...loopReads, probeText(run, 'pid_lane1'), probeText(run, 'pid_lane2'), probeText(run, 'pid_catch'), probeText(run, 'pid_after')]
  expectEveryWorkerIs(cell, run, 'pid_before', reads, 'every remotable Block in the loop, both lanes, the catch path and after the Function runs through the body worker')
}

async function sameFunctionTwoCallsCell(page: Page): Promise<void> {
  const cellId = 'F.same-fn-two-calls'
  const inside = container('function', 'fn-in', [hostProbe('fn-host', 'host_fn')], { uses: { outputs: { host_fn: 'host_in' } } })
  const outside = container('function', 'fn-out', [], { uses: { of: 'fn-in', outputs: { host_fn: 'host_out' } } })
  const rx = container('remote-exec', 'rx', [inside, marker('in-then')])
  const cell = await openCanvasCell(page, cellId, {
    chain: [waveHostProbe('wave-host'), rx, marker('rx-then'), outside, marker('out-then')],
  })
  expect(cell.graph.functions.length, `${cellId}: both instances call one library Function`).toBe(1)
  const run = await runCell(page, cell, { timeoutMs: RUN_TIMEOUT_MS })

  expectVerdict(cell, run, 'passed')
  expectBlockOrder(cell, run, ['in-then', 'rx-then', 'out-then', cell.graph.bookendId])
  expectNoNodeRunning(cell, run)
  expectNoErrorLines(cell, run)
  expectReadOnExecutionHost(cell, run, 'host_in', 'the call inside the body runs its remotable Block on the remote host')
  const waveHost = probeText(run, WAVE_HOST_VARIABLE)
  expect.soft(waveHost, `${cellId}: the WAVE host probe printed a host name`).not.toBe('')
  expect.soft(probeText(run, 'host_out'), `${cellId}: the call outside any body runs its Block on WAVE (reads the WAVE host name)`).toBe(waveHost)
  expect.soft(probeText(run, 'host_out'), `${cellId}: the call outside any body never reads the remote host name`).not.toBe(EXECUTION_HOST_NAME)

  await drillInto(page, cell, 'fn-in', 'fn-host')
  await expectLocusBadge(page, cell, 'fn-host', 'R', 'drilled from the instance inside the body, the probe shows it runs on the remote host')
  await openTest(page, cell.testId)
  await drillInto(page, cell, 'fn-out', 'fn-host')
  recordUnsettled(cellId, `drilled from the instance outside any body, fn-host shows badge ${await locusBadgeOf(page, 'fn-host')}`)
}

async function rxFunctionInLoopAndLaneCell(page: Page): Promise<void> {
  const cellId = 'F.rx-fn-in-loop-and-lane'
  const rxBody: NestStep[] = [
    hostProbe('fn-host', 'host_fn'),
    workerPidProbe('fn-pid', 'pid_fn'),
    workerPidRecorder('fn-pids', 'nest_sid', 'pids_fn'),
  ]
  const loopCall = container('function', 'fn-rx', [container('remote-exec', 'fn-rx-body', rxBody)])
  const loop = container(
    'for',
    'loop',
    [loopCall, appendTo('loop-acc', { acc_host: 'host_fn', acc_pid: 'pid_fn', acc_workers: 'pids_fn' }), marker('loop-after-call')],
    { options: { iterations: 2 } },
  )
  const laneCall = container('function', 'fn-lane', [], {
    uses: { of: 'fn-rx', outputs: { host_fn: 'host_lane', pid_fn: 'pid_lane', pids_fn: 'pids_lane' } },
  })
  const par = container('parallel', 'par', [laneCall, marker('lane-after-call')])
  const cell = await openCell(page, cellId, {
    chain: [waveHostProbe('wave-host'), loop, marker('loop-then'), par, marker('par-then')],
  })
  expect(cell.graph.sshOpenIds.length, `${cellId}: every call uses the one session opened at the head`).toBe(1)
  const run = await runCell(page, cell, { timeoutMs: RUN_TIMEOUT_MS })

  expectVerdict(cell, run, 'passed')
  expectMarkerCount(cell, run, 'loop-after-call', 2, 'the loop body calls the Function twice')
  expectMarkerCount(cell, run, 'lane-after-call', 1, 'the lane calls the Function once')
  for (const id of cell.graph.containers.par.siblings) expectMarkerCount(cell, run, id, 1, 'the second lane runs once')
  expectBlockOrder(cell, run, ['loop-then', 'par-then', cell.graph.bookendId])
  expectNoNodeRunning(cell, run)
  expectNoErrorLines(cell, run)

  const hosts = appended(run, 'acc_host')
  expect.soft(hosts, `${cellId}: both loop calls read the remote host name`).toEqual([EXECUTION_HOST_NAME, EXECUTION_HOST_NAME])
  expectReadOnExecutionHost(cell, run, 'host_lane', 'the lane call reads the remote host name')
  const callWorkers = [...appended(run, 'acc_pid').map(parentPid), workerPid(run, 'pid_lane')]
  expect.soft(callWorkers.length, `${cellId}: three calls recorded a worker read`).toBe(3)
  expect.soft(callWorkers.every((pid) => pid !== null), `${cellId}: every call read a worker pid (${callWorkers.join(' ')})`).toBe(true)
  expect.soft(new Set(callWorkers).size, `${cellId}: each call opens its own worker (pids ${callWorkers.join(' ')})`).toBe(callWorkers.length)

  const pids = new Set([
    ...recordedPids(run, 'acc_workers'),
    ...recordedPids(run, 'pids_lane'),
    ...callWorkers.filter((pid): pid is number => pid !== null),
  ])
  await expectWorkersGone(page, cell, withVariable(run, 'f_all_workers', [...pids].join(' ')), 'f_all_workers', 'the run')
}

async function sessionThroughTwoFunctionsCell(page: Page): Promise<void> {
  const cellId = 'F.session-through-two-fns'
  const rx = container('remote-exec', 'rx', [hostProbe('deep-host', 'host_deep'), workerPidProbe('deep-pid', 'pid_deep')], {
    options: { sessionVar: 'sid_rx' },
  })
  const inner = container('function', 'fn-inner', [rx, marker('rx-then')], { uses: { fields: { sid_rx: 'sid_mid' } } })
  const outerHead = leaf(markerNode({ id: 'outer-body', description: 'outer-body', text: `outer-body-${TOKEN_PLACEHOLDER}` }), {
    vars: [{ name: 'sid_mid', type: 'string', seed: '', flow: 'import' }],
  })
  const outer = container('function', 'fn-outer', [outerHead, inner, marker('inner-fn-then')], {
    uses: { fields: { sid_mid: 'sid_rx' } },
  })
  const cell = await openCell(page, cellId, { chain: [waveHostProbe('wave-host'), outer, marker('outer-fn-then')] })
  expect(cell.graph.sshOpenIds, `${cellId}: one session opens at the head of the Test`).toHaveLength(1)
  const run = await runCell(page, cell, { timeoutMs: RUN_TIMEOUT_MS })

  expectVerdict(cell, run, 'passed')
  expectBlockOrder(cell, run, ['outer-body', 'rx-then', 'inner-fn-then', 'outer-fn-then', cell.graph.bookendId])
  expectNoNodeRunning(cell, run)
  expectNoErrorLines(cell, run)
  expectReadOnExecutionHost(cell, run, 'host_deep', 'the session passed through both Function inputs routes the inner body to the remote host')
  expect.soft(workerPid(run, 'pid_deep'), `${cellId}: a worker on the remote host served the inner body`).not.toBeNull()
}

async function debugInFnInBodyCell(page: Page): Promise<void> {
  const cellId = 'F.debug-in-fn-in-body'
  const fn = container('function', 'fn', [
    remoteEcho('bp-echo'),
    marker('fn-next'),
    hostProbe('fn-host', 'host_fn'),
    workerPidProbe('fn-pid', 'pid_fn'),
  ])
  const rx = container('remote-exec', 'rx', [workerPidProbe('pid-before', 'pid_before'), fn, marker('fn-then')])
  const cell = await openCanvasCell(page, cellId, { chain: [waveHostProbe('wave-host'), rx, marker('rx-then')] })

  await toggleBreakpoint(page, 'fn')
  await startCellDebug(page, cell)
  await expectPausedOn(page, cell, 'fn', 'the breakpoint on the Function instance in the body pauses')
  await drillInto(page, cell, 'fn', 'bp-echo')
  await toggleBreakpoint(page, 'bp-echo')
  await clickContinue(page)

  await expectPausedOn(page, cell, 'bp-echo', 'the breakpoint on the remotable Block inside the Function pauses on the drilled canvas')
  await expectLocusBadge(page, cell, 'bp-echo', 'R', 'the paused Block inside the Function in the body runs on the remote host')
  await expectLiveEchoCount(page, cell, 'bp-echo', 0, 'the pause lands before the request is sent')

  await clickRepeatStep(page)
  await expectLiveEchoCount(page, cell, 'bp-echo', 1, 'Repeat Step sends the request once')
  await expectPausedOn(page, cell, 'bp-echo', 'Repeat Step re-pauses on the same Block')
  await expect
    .soft(page.locator('[data-testid="workflow-node-bp-echo"]'), `${cellId}: the re-run passes, so it ran where http-target resolves (the remote host)`)
    .toHaveAttribute('data-execution-status', 'success', { timeout: 10_000 })
  await expectLiveMarkerCount(page, cell, 'fn-next', 0, 'Repeat Step reruns only the paused Block')

  await clickStepOver(page)
  await expectPausedOn(page, cell, 'fn-next', 'Step Over pauses on the next Block in the Function')
  await expectLiveMarkerCount(page, cell, 'fn-next', 0, 'the pause lands before the next Block runs')

  await continueToTerminal(page, cell)
  const run = await finishCell(page, cell)
  expectVerdict(cell, run, 'passed')
  expectBlockOrder(cell, run, ['fn-next', 'fn-then', 'rx-then', cell.graph.bookendId])
  expectNoNodeRunning(cell, run)
  expectNoErrorLines(cell, run)
  expectReadOnExecutionHost(cell, run, 'host_fn', 'a host probe after the debugged Block runs on the remote host')
  expectSameWorker(cell, run, 'pid_before', 'pid_fn', 'the Function body keeps using the body worker after the pauses')
}

async function expectLiveEchoCount(page: Page, cell: NestCell, id: string, count: number, criterion: string): Promise<void> {
  const deadline = Date.now() + LIVE_SETTLE_MS
  let seen = await liveEchoCount(page, cell, id)
  while (seen !== count && Date.now() < deadline) {
    await page.waitForTimeout(500)
    seen = await liveEchoCount(page, cell, id)
  }
  expect.soft(seen, `${cell.cellId}: ${criterion} (expected ${id} to have sent ${count} request(s))`).toBe(count)
}

async function runScopeFnInBodyCell(page: Page): Promise<void> {
  const cellId = 'F.run-scope-fn-in-body'
  const fn = container('function', 'fn', [hostProbe('scope-host', 'host_scope')])
  const rx = container('remote-exec', 'rx', [fn, marker('fn-then')])
  const cell = await openCanvasCell(page, cellId, { chain: [waveHostProbe('wave-host'), rx, marker('rx-then')] })
  const sshOpen = cell.graph.sshOpenIds[0]
  await selectEnvironment(page)

  const waveRun = await runAdHoc(page, cell, 'Run Current on the WAVE host probe', () =>
    clickNodeContextMenuItem(page, 'wave-host', 'Run Current'),
  )
  expect(waveRun.status, `${cellId}: Run Current on the WAVE host probe passes`).toBe('passed')
  const waveHost = String((await getSessionVariables(page, waveRun.sessionId))[WAVE_HOST_VARIABLE]?.value ?? '').trim()
  expect(waveHost, `${cellId}: the WAVE host probe printed a host name`).not.toBe('')

  const openRun = await runAdHoc(page, cell, 'Run Current on the SSH Session Open', () =>
    clickNodeContextMenuItem(page, sshOpen, 'Run Current'),
  )
  expect(openRun.status, `${cellId}: Run Current on the SSH Session Open passes and leaves the session open`).toBe('passed')

  await drillInto(page, cell, 'fn', 'scope-host')
  const scoped = await runAdHoc(page, cell, 'Run Scope drilled into the Function', async () => {
    await page.locator('[data-testid="run-button-dropdown"]').click()
    await page.locator('[data-testid="run-current-option"]').click()
  })
  await test.info().attach(`${cellId}-scoped.json`, { body: JSON.stringify(scoped, null, 2), contentType: 'application/json' })
  expect.soft(scoped.status, `${cellId}: the Run Scope of the Function in the body passes`).toBe('passed')
  const read = String(scoped.scopedResult?.outputs?.host_scope ?? '').trim()
  expect.soft(read, `${cellId}: the Run Scope runs the remotable Block on the remote host (host_scope reads the remote host name)`).toBe(EXECUTION_HOST_NAME)
  expect.soft(read, `${cellId}: the Run Scope never runs the remotable Block on WAVE (host_scope differs from ${waveHost})`).not.toBe(waveHost)
}

async function testdataInFnInBodyCell(page: Page): Promise<void> {
  const cellId = 'F.testdata-in-fn-in-body'
  const fn = container('function', 'fn', [literalRead('td-read', TESTDATA_PATH, 'td_content'), marker('fn-after-read')])
  const rx = container('remote-exec', 'rx', [fn, marker('fn-then')])
  const cell = await openCell(page, cellId, { chain: [rx, marker('rx-then')] })
  for (const context of ['import', 'load'] as const) {
    const result = await validateTest(page.request, cell.testId, context)
    expect.soft(result.errors, `${cellId}: ${context}-context validation reports no errors`).toEqual([])
    expect.soft(result.status, `${cellId}: ${context}-context validation status`).toBe(200)
  }
  const run = await runCell(page, cell, { timeoutMs: RUN_TIMEOUT_MS, awaitBookend: false })

  expectVerdict(cell, run, 'failed')
  const refusal = run.entries.filter(
    (e) => e.level === 'ERROR' && (e.source.endsWith('td-read') || e.message.includes("'td-read'")) && e.message.includes(TESTDATA_REFUSAL),
  )
  expect
    .soft(
      refusal.length,
      `${cellId}: an ERROR line names td-read and carries "${TESTDATA_REFUSAL}"\n${run.entries.filter((e) => e.level === 'ERROR').map((e) => `[${e.source}] ${e.message}`).join('\n')}`,
    )
    .toBeGreaterThan(0)
  expectMarkerCount(cell, run, 'fn-after-read', 0, 'the Block after the refused read never runs')
  expectMarkerCount(cell, run, 'fn-then', 0, 'the failed Function stops its caller in the body')
  expectMarkerCount(cell, run, 'rx-then', 0, 'the failed body stops the flow after the container')
  expectMarkerCount(cell, run, cell.graph.bookendId, 0, 'nothing after the failure runs')
  expectNodePaint(cell, run, 'fn', 'failed', 'the Function instance paints failed')
  expectNoNodeRunning(cell, run)
}

async function libraryFunctionStandaloneCell(page: Page): Promise<void> {
  const cellId = 'F.library-fn-standalone'
  const { functions } = await publishFunctionsOnly(page, cellId, {
    chain: [container('function', 'lib-fn', [hostProbe('lib-host', 'host_lib'), workerPidProbe('lib-pid', 'pid_lib')])],
  })
  const published = functions['lib-fn']
  await openFunctionView(page, published.functionId, published.version)
  for (const id of ['lib-host', 'lib-pid']) {
    await expect(page.locator(`[data-testid="workflow-node-${id}"]`), `${cellId}: the library View shows ${id}`).toBeVisible({
      timeout: DRILL_TIMEOUT_MS,
    })
    recordUnsettled(cellId, `opened from the library with no Test, ${id} shows badge ${await locusBadgeOf(page, id)}`)
  }
}

test.describe('Functions and Remote Execution combined: routing through Function levels', () => {
  test.afterEach(async ({ request }, testInfo) => deleteCellEntities(request, testInfo))
  test.afterEach(async ({ request }, testInfo) => deleteStopProbeTests(request, testInfo))

  test('F.fn-in-fn-in-body: a remotable Block two Functions deep in a Remote Execution body runs on the body worker and shows R drilled', async ({
    page,
  }) => {
    test.setTimeout(CELL_TIMEOUT_MS)
    await fnInFnInBodyCell(page)
  })

  test('F.rx-in-fn-in-body: a Remote Execution inside a Function inside a body opens its own worker and leaves none behind', async ({
    page,
  }) => {
    test.setTimeout(CELL_TIMEOUT_MS)
    await rxInFnInBodyCell(page)
  })

  test('F.containers-in-fn-in-body: a loop, lanes and a catch path inside a Function in a body run on the body worker', async ({
    page,
  }) => {
    test.setTimeout(CELL_TIMEOUT_MS)
    await containersInFnInBodyCell(page)
  })

  test('F.same-fn-two-calls: one library Function runs on the remote host when called in a body and on WAVE when called outside', async ({
    page,
  }) => {
    test.setTimeout(CELL_TIMEOUT_MS)
    await sameFunctionTwoCallsCell(page)
  })

  test('F.rx-fn-in-loop-and-lane: a Function holding a Remote Execution opens a worker per call from a loop and a lane', async ({
    page,
  }) => {
    test.setTimeout(CELL_TIMEOUT_MS)
    await rxFunctionInLoopAndLaneCell(page)
  })

  test('F.session-through-two-fns: a session passed through two Function inputs reaches the inner Remote Execution', async ({
    page,
  }) => {
    test.setTimeout(CELL_TIMEOUT_MS)
    await sessionThroughTwoFunctionsCell(page)
  })
})

test.describe('Functions and Remote Execution combined: debug, Run Scope, paths and the library View', () => {
  test.afterEach(async ({ request }, testInfo) => deleteCellEntities(request, testInfo))
  test.afterEach(async ({ request }, testInfo) => deleteLibraryOnlyFunctions(request, testInfo))

  test('F.debug-in-fn-in-body: a breakpoint inside a Function in a body pauses, repeats on the remote host, steps and continues', async ({
    page,
  }) => {
    test.setTimeout(CELL_TIMEOUT_MS)
    await debugInFnInBodyCell(page)
  })

  test('F.run-scope-fn-in-body: Run Scope of a Function whose instance sits in a body runs its remotable Block on the remote host', async ({
    page,
  }) => {
    test.setTimeout(CELL_TIMEOUT_MS)
    await runScopeFnInBodyCell(page)
  })

  test('F.testdata-in-fn-in-body: a testdata:// read inside a Function called from a body saves clean and fails at run time', async ({
    page,
  }) => {
    test.setTimeout(CELL_TIMEOUT_MS)
    await testdataInFnInBodyCell(page)
  })

  test('F.library-fn-standalone: a library Function holding remotable Blocks opens from the library with no Test', async ({
    page,
  }) => {
    test.setTimeout(CELL_TIMEOUT_MS)
    await libraryFunctionStandaloneCell(page)
  })
})
