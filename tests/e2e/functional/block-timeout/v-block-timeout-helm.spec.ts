/**
 * V-BLOCK-TIMEOUT-HELM: the Timeout row is the Helm Block's real wall-clock
 * bound, and Cleanup Timeout is the only thing that widens it.
 *
 * Phase: functional-workflow (parallel) - one Test, one run namespace of its
 * own, torn down at the end.
 * REQ: REQ-3.5.3.1 - REQ-3.5.3.5, REQ-3.4.1.5
 *
 * Every Helm Block runs a real helm process, and the Timeout row is the
 * deadline that process is killed at. All six verbs run against a cluster that
 * holds every answer for ten seconds with a Timeout of one, so each one is
 * killed and reports the deadline it was given.
 *
 * The one Block whose bound is not the typed Timeout alone is an Install or an
 * Upgrade that asked for cleanup room: with Atomic or Cleanup on Fail ticked,
 * helm gets its Timeout to do the work plus the Cleanup Timeout to undo it, and
 * the sentence names the sum. An unticked flag buys nothing.
 *
 * Pass Criteria:
 *   TO-13  Helm Install is killed at its Timeout and names it.
 *   TO-14  Helm Upgrade likewise.
 *   TO-15  Helm Rollback likewise.
 *   TO-16  Helm Uninstall likewise.
 *   TO-17  Helm Test likewise.
 *   TO-18  Helm Status likewise.
 *   TO-19  Install with Atomic on and Cleanup Timeout 2 is bounded at 3 s, the
 *          two rows added together, and the sentence names 3.
 *   TO-20  The same Cleanup Timeout with Atomic OFF still bounds at 1 s.
 *   TO-21  Under Record and continue the Block finishes amber with Success
 *          false, the same sentence and Reason Timeout.
 *   The whole run stays inside a wall-clock ceiling the family default could
 *   not have met.
 */

import { test, expect } from '../../helpers/playwright-fixtures'
import { seedRun, type SeededRun } from '../../helpers/k8s-seed'
import {
  helmInstallNode,
  helmRollbackNode,
  helmStatusNode,
  helmTestNode,
  helmUninstallNode,
  helmUpgradeNode,
} from '../../helpers/k8s-nodes'
import { CHART, CHART_REPO_URL, releaseName, uninstallQuietly } from '../helm/cases-helm'
import {
  buildTimeoutFixture,
  DELAY_PREFIX,
  expectLegStatuses,
  expectMarkers,
  expectRecordedTimeout,
  expectTimedOut,
  helmDeadlineMessage,
  runTimeoutFixture,
  SESSION_VARIABLE,
  SHORT_TIMEOUT,
  TIMEOUT_REASON,
  type TimeoutLeg,
} from './cases-timeout'

/** The bookend the console harvest gates on. */
const HELM_MARKER = 'block-timeout-helm-done'

/**
 * The ceiling the whole run must stay under. The nine legs cost about 12 s
 * (Helm Test makes two calls and the cleanup-room leg is bounded at three); on
 * the family default of 300 s a write they would have cost 9 x 300 = 2700 s.
 * The ceiling is a band with room for a loaded shard, not a stopwatch.
 */
const WALL_CLOCK_CEILING_SECONDS = 60

/** The cleanup room TO-19 and TO-20 both ask for, in seconds. */
const CLEANUP_SECONDS = 2

/** The bound an Install that asked for cleanup room actually runs under. */
const WITH_CLEANUP_SECONDS = SHORT_TIMEOUT + CLEANUP_SECONDS

const CHART_VERSION = '0.1.0'

let run: SeededRun
let installRelease: string
let cleanupRelease: string

/** The six verbs, then the cleanup-room pair, then the recorded leg. */
function timeoutLegs(): TimeoutLeg[] {
  const bounded = { session: SESSION_VARIABLE, timeout: SHORT_TIMEOUT, on_error: 'fail' } as const
  const chart = { chart: CHART.demo, version: CHART_VERSION, repo: CHART_REPO_URL }
  return [
    {
      key: 'install',
      ids: ['TO-13'],
      what: 'Install a chart',
      message: helmDeadlineMessage('install', SHORT_TIMEOUT),
      node: (slot) =>
        helmInstallNode({ ...slot, values: { ...bounded, ...chart, release: installRelease } }),
    },
    {
      key: 'upgrade',
      ids: ['TO-14'],
      what: 'Upgrade the release',
      message: helmDeadlineMessage('upgrade', SHORT_TIMEOUT),
      node: (slot) =>
        helmUpgradeNode({ ...slot, values: { ...bounded, ...chart, release: installRelease } }),
    },
    {
      key: 'rollback',
      ids: ['TO-15'],
      what: 'Roll the release back',
      message: helmDeadlineMessage('rollback', SHORT_TIMEOUT),
      node: (slot) =>
        helmRollbackNode({ ...slot, values: { ...bounded, release: installRelease } }),
    },
    {
      key: 'uninstall',
      ids: ['TO-16'],
      what: 'Uninstall the release',
      message: helmDeadlineMessage('uninstall', SHORT_TIMEOUT),
      node: (slot) =>
        helmUninstallNode({ ...slot, values: { ...bounded, release: installRelease } }),
    },
    {
      key: 'test',
      ids: ['TO-17'],
      what: "Run the chart's test hooks",
      message: helmDeadlineMessage('test', SHORT_TIMEOUT),
      node: (slot) => helmTestNode({ ...slot, values: { ...bounded, release: installRelease } }),
    },
    {
      key: 'status',
      ids: ['TO-18'],
      what: 'Read the release',
      message: helmDeadlineMessage('status', SHORT_TIMEOUT),
      node: (slot) => helmStatusNode({ ...slot, values: { ...bounded, release: installRelease } }),
    },
    {
      key: 'cleanup',
      ids: ['TO-19'],
      what: 'Atomic install with cleanup room',
      message: helmDeadlineMessage('install', WITH_CLEANUP_SECONDS),
      node: (slot) =>
        helmInstallNode({
          ...slot,
          values: {
            ...bounded,
            ...chart,
            release: cleanupRelease,
            atomic: true,
            cleanup_timeout: CLEANUP_SECONDS,
          },
        }),
    },
    {
      key: 'noatomic',
      ids: ['TO-20'],
      what: 'the same room, Atomic off',
      message: helmDeadlineMessage('install', SHORT_TIMEOUT),
      node: (slot) =>
        helmInstallNode({
          ...slot,
          values: {
            ...bounded,
            ...chart,
            release: cleanupRelease,
            atomic: false,
            cleanup_timeout: CLEANUP_SECONDS,
          },
        }),
    },
    {
      key: 'recorded',
      ids: ['TO-21'],
      what: 'Status under Record and continue',
      message: helmDeadlineMessage('status', SHORT_TIMEOUT),
      records: true,
      reason: TIMEOUT_REASON,
      node: (slot) =>
        helmStatusNode({
          ...slot,
          values: {
            session: SESSION_VARIABLE,
            timeout: SHORT_TIMEOUT,
            on_error: 'record',
            release: installRelease,
          },
        }),
    },
  ]
}

test.describe('The Timeout row bounds every Helm Block', () => {
  test.beforeAll(async ({ request }) => {
    test.setTimeout(180_000)
    run = await seedRun(request, 'minimal')
    installRelease = releaseName('to13', run.suffix)
    cleanupRelease = releaseName('to19', run.suffix)
  })

  test.afterAll(async ({ request }) => {
    if (run) {
      await uninstallQuietly(request, { namespace: run.namespace, release: installRelease })
      await uninstallQuietly(request, { namespace: run.namespace, release: cleanupRelease })
    }
    await run?.teardown()
  })

  test('every Helm Block dies at its typed Timeout (TO-13 to TO-21)', async ({ page }) => {
    test.setTimeout(300_000)
    const legs = timeoutLegs()
    const fixture = buildTimeoutFixture(legs, {
      name: 'Helm Block Timeout E2E Test',
      bookend: HELM_MARKER,
      namespace: run.namespace,
      prefix: DELAY_PREFIX,
    })
    const { logs, all, vars, elapsedSeconds } = await runTimeoutFixture(page, fixture, HELM_MARKER)

    await test.step('every leg reported its ids', () => {
      expectMarkers(logs, legs)
    })

    for (const leg of legs.filter((entry) => !entry.records)) {
      await test.step(`${leg.ids.join('|')}: ${leg.what}`, () => {
        expectTimedOut(logs, leg)
      })
    }

    const recordedStep = 'TO-21: Record and continue reports the deadline and Reason Timeout'
    await test.step(recordedStep, async () => {
      const recorded = legs.find((leg) => leg.records) as TimeoutLeg
      expectRecordedTimeout(vars, recorded)
      await expectLegStatuses(page, legs)
    })

    await test.step('the whole run stayed inside its wall-clock ceiling', () => {
      expect(
        elapsedSeconds,
        `the run took ${elapsedSeconds}s, over the ${WALL_CLOCK_CEILING_SECONDS}s ceiling.\n${all}`,
      ).toBeLessThan(WALL_CLOCK_CEILING_SECONDS)
    })
  })
})
