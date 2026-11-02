/**
 * V-HELM-TEST-HOOKS: Helm Test against the real kwok cluster and the fixture
 * chart repository.
 *
 * Phase: functional-workflow (parallel) - the test imports its own Test,
 * installs into the run's own namespace under release names of its own, and
 * tears the namespace down.
 * REQ: REQ-3.5.3.2, REQ-3.4.1.5
 * Design Decisions: HELM-1, HELM-2, HELM-3, HELM-4
 *
 * One run, one chain: a chart whose hook passes, then a chart whose hook fails,
 * run twice so both Failure Handling settings are proved on the same release.
 * The point of the case is the failing run under Record and continue: Helm Test
 * still fills Result and Logs when the hook failed, because those two outputs
 * are what the block exists to produce. Every assertion reads a bound output or
 * one exact INFO line the verb printed; helm's own human text is asserted only
 * where the case names the sentence.
 *
 * Pass Criteria:
 *   HL-3  Helm Test with Logs on, against a release whose hook passes: Result
 *         is the one-row hook table (Name the hook pod, Kind Pod, Phase
 *         Succeeded), Logs carries helm's own POD LOGS: header and the pod log
 *         the cluster serves, and the INFO line reports one hook ran.
 *         The same block against a release whose hook fails: under Fail the
 *         block it raises, and the caught message is helm's own sentence naming
 *         the hook pod; under Record and continue it reports success false with
 *         Reason Failed, writes exactly one WARN line, paints its Block amber,
 *         and STILL fills Result (the row, Phase Failed) and STILL fills Logs.
 */

import { test, expect, type Page } from '../../helpers/playwright-fixtures'
import { getLogEntries } from '../../helpers/log-reader'
import { seedRun, type SeededRun } from '../../helpers/k8s-seed'
import {
  buildHelmFixture,
  CHART,
  CHART_REPO_URL,
  expectCaught,
  expectLegStatuses,
  expectLine,
  expectMarkers,
  expectRecorded,
  expectReleaseRow,
  expectTestRows,
  installedLine,
  logsOf,
  okVar,
  ranTestsLine,
  reasonVar,
  releaseName,
  runHelmFixture,
  statusOf,
  uninstallQuietly,
  type HelmLeg,
} from './cases-helm'

/** The bookend the run harvests its console against. */
const HOOKS_MARKER = 'helm-test-hooks-done'

const V_0_1 = '0.1.0'
const APP_1 = '1.0.0'
const DEPLOYED = 'deployed'
const CHART_DEMO_0_1 = `${CHART.demo}-${V_0_1}`

/** helm's own header above each test pod's log, which is what Logs starts at. */
const POD_LOGS_HEADER = 'POD LOGS:'
/** The first line kwok serves as any unnamed container's log. */
const KWOK_LOG_LINE = 'kwok-log-line-1'

/** The WARN line a recorded Helm Test failure opens with. */
const RECORDED_PREFIX = 'Helm Test failed (Failed): '

let run: SeededRun
let passingRelease: string
let failingRelease: string

/** The hook pod each chart renders, which is the Name cell of its one row. */
const passingHook = (release: string): string => `${release}-${CHART.demo}-test`
const failingHook = (release: string): string => `${release}-${CHART.badTest}-test`

/** HL-3: a passing hook with Logs on, then a failing hook under both On error
 *  settings, all on one chain. */
function hookLegs(passing: string, failing: string): HelmLeg[] {
  return [
    {
      key: 'seed',
      ids: ['HL-3'],
      what: 'install wave-demo 0.1.0',
      block: 'install',
      values: { release: passing, chart: CHART.demo, version: V_0_1, repo: CHART_REPO_URL },
    },
    {
      key: 'hooks',
      ids: ['HL-3'],
      what: 'run the passing hook, Logs on',
      block: 'test',
      bindLogs: true,
      values: { release: passing, logs: true },
    },
    {
      key: 'bad',
      ids: ['HL-3'],
      what: 'install wave-demo-badtest 0.1.0',
      block: 'install',
      values: { release: failing, chart: CHART.badTest, version: V_0_1, repo: CHART_REPO_URL },
    },
    {
      key: 'raise',
      ids: ['HL-3'],
      what: 'the failing hook, Fail the block',
      block: 'test',
      guarded: true,
      values: { release: failing, logs: true, on_error: 'fail' },
    },
    {
      key: 'record',
      ids: ['HL-3'],
      what: 'the failing hook, Record and continue',
      block: 'test',
      records: true,
      bindLogs: true,
      values: { release: failing, logs: true, on_error: 'record' },
      marker: `f'[HL-3] record ok={${okVar('record')}} reason={${reasonVar('record')}}'`,
    },
  ]
}

/** The WARN lines the console carries, in order. */
async function warnings(page: Page): Promise<string[]> {
  const entries = await getLogEntries(page)
  return entries.filter((entry) => entry.level === 'WARN').map((entry) => entry.message)
}

test.describe('Helm test hooks (real kwok cluster + chart repository)', () => {
  test.beforeAll(async ({ request }) => {
    test.setTimeout(180_000)
    run = await seedRun(request, 'minimal')
    passingRelease = releaseName('hl3a', run.suffix)
    failingRelease = releaseName('hl3b', run.suffix)
  })

  test.afterAll(async ({ request }) => {
    if (run) {
      await uninstallQuietly(request, { namespace: run.namespace, release: passingRelease })
      await uninstallQuietly(request, { namespace: run.namespace, release: failingRelease })
    }
    await run?.teardown()
  })

  test('run a passing hook, then a failing one under both On error settings (HL-3)', async ({
    page,
  }) => {
    test.setTimeout(300_000)
    const passing = passingRelease
    const failing = failingRelease
    const legs = hookLegs(passing, failing)
    const fixture = buildHelmFixture(legs, {
      name: 'Helm Test Hooks E2E Test',
      bookend: HOOKS_MARKER,
      namespace: run.namespace,
    })
    const { logs, all, vars } = await runHelmFixture(page, fixture, HOOKS_MARKER)
    // helm's own sentence for a hook pod that ended Failed, which both failing
    // legs must report: one as the raised message, one as the recorded Error.
    const refusal = `pod ${failingHook(failing)} failed`

    await test.step('every leg reported its ids and carried the status its case declares', async () => {
      expectMarkers(logs, legs)
      await expectLegStatuses(page, legs)
    })

    await test.step('HL-3: the release the passing hook belongs to is installed', () => {
      expectReleaseRow(vars, 'seed', {
        name: passing,
        namespace: run.namespace,
        revision: 1,
        status: DEPLOYED,
        chart: CHART_DEMO_0_1,
        appVersion: APP_1,
      })
      expectLine(logs, installedLine(passing, 1))
    })

    await test.step('HL-3: the passing hook fills Result with its one row', () => {
      expectTestRows(vars, 'hooks', [
        { name: passingHook(passing), kind: 'Pod', phase: 'Succeeded' },
      ])
      expectLine(logs, ranTestsLine(1, passing))
    })

    await test.step("HL-3: Logs carries helm's header and the pod log the cluster served", () => {
      const collected = logsOf(vars, 'hooks')
      expect(collected.length, `Logs must not be empty when Logs is on.\n${all}`).toBeGreaterThan(0)
      expect(collected, "Logs must open on helm's own pod header").toContain(POD_LOGS_HEADER)
      expect(collected, 'Logs must carry the hook pod log itself').toContain(KWOK_LOG_LINE)
    })

    await test.step('HL-3: the release the failing hook belongs to is installed', () => {
      expect(statusOf(vars, 'bad'), `the badtest release is deployed.\n${all}`).toBe(DEPLOYED)
      expectLine(logs, installedLine(failing, 1))
    })

    await test.step("HL-3: Fail the block raises helm's own sentence about the hook pod", () => {
      expectCaught(logs, legs[3], { contains: refusal })
    })

    await test.step('HL-3: Record and continue still fills Result and Logs on a failed hook', async () => {
      expectRecorded(vars, 'record', { reason: 'Failed', contains: refusal })
      // The row and the log are the whole point of the case: a hook that failed
      // is exactly when the operator needs them.
      expectTestRows(vars, 'record', [
        { name: failingHook(failing), kind: 'Pod', phase: 'Failed' },
      ])
      const collected = logsOf(vars, 'record')
      expect(
        collected.length,
        `a failed hook must still hand back its log.\n${all}`,
      ).toBeGreaterThan(0)
      expect(collected, "the failed run's Logs must carry helm's pod header").toContain(
        POD_LOGS_HEADER,
      )
      expect(collected, "the failed run's Logs must carry the hook pod log").toContain(
        KWOK_LOG_LINE,
      )

      const recorded = (await warnings(page)).filter((line) => line.startsWith(RECORDED_PREFIX))
      expect(recorded.length, `expected exactly one WARN line for the recorded run.\n${all}`).toBe(
        1,
      )
      await expect(page.locator('[data-testid="workflow-status"]')).toHaveAttribute(
        'data-status',
        'passed',
      )
    })
  })
})
