/**
 * V-HELM-ATOMIC: Helm Install with Atomic against the real kwok cluster and the
 * fixture chart repository.
 *
 * Phase: functional-workflow (parallel) - the test imports its own Test,
 * installs into the run's own namespace under a release name of its own, and
 * tears the namespace down.
 * REQ: REQ-3.5.3.1, REQ-3.4.1.5
 * Design Decisions: HELM-1, HELM-2, HELM-3, HELM-4
 *
 * One run, one chain: a chart whose pod never leaves ContainerCreating is
 * installed with Atomic on and a short Timeout, so helm waits, gives up, and
 * removes what it created. The proof is the state the cluster is left in, read
 * back through two more blocks: the release is gone, and the namespace still
 * carries the events the attempt produced.
 *
 * helm 4 prints a deprecation line on stderr for every Atomic run, so nothing
 * here asserts helm's stderr. The assertions are the Reason a workflow branches
 * on and the effect on the cluster.
 *
 * Pass Criteria:
 *   HL-4  Helm Install with Atomic on, a short Timeout and Record and continue,
 *         against a release that can never become ready: success false, Reason
 *         Timeout, an empty Status and the release table with its columns and
 *         no row, one WARN line and an amber Block. A Helm Status on the same
 *         release afterwards, also under Record and continue, reports Reason
 *         NotFound, because Atomic removed the release it could not finish. A
 *         K8s Events read on the run namespace comes back with rows, so the
 *         attempt is still visible to whoever debugs it. The run passes.
 */

import { test, expect, type Page } from '../../helpers/playwright-fixtures'
import { getLogEntries } from '../../helpers/log-reader'
import { seedRun, type SeededRun } from '../../helpers/k8s-seed'
import {
  buildHelmFixture,
  CHART,
  CHART_REPO_URL,
  countOf,
  expectEmptyRelease,
  expectLegStatuses,
  expectMarkers,
  expectRecorded,
  okVar,
  reasonVar,
  releaseName,
  resultOf,
  runHelmFixture,
  statusOf,
  uninstallQuietly,
  type HelmLeg,
  type WaveTable,
} from './cases-helm'

/** The bookend the run harvests its console against. */
const ATOMIC_MARKER = 'helm-atomic-done'

const V_0_1 = '0.1.0'

/** Short enough that the wait is over well inside the block's own process
 *  deadline, long enough for helm to create the Deployment first. */
const ATOMIC_TIMEOUT_S = 20

/** The WARN lines the two recorded legs open with. */
const TIMED_OUT_PREFIX = 'Helm Install failed (Timeout): '
const NOT_FOUND_PREFIX = 'Helm Status failed (NotFound): '

let run: SeededRun
let stuckRelease: string

/** HL-4: the atomic install that cannot finish, then what it left behind. */
function atomicLegs(release: string): HelmLeg[] {
  return [
    {
      key: 'stuck',
      ids: ['HL-4'],
      what: 'install wave-demo-stuck, Atomic on',
      block: 'install',
      records: true,
      values: {
        release,
        chart: CHART.stuck,
        version: V_0_1,
        repo: CHART_REPO_URL,
        atomic: true,
        timeout: ATOMIC_TIMEOUT_S,
        on_error: 'record',
      },
      marker: `f'[HL-4] stuck ok={${okVar('stuck')}} reason={${reasonVar('stuck')}}'`,
    },
    {
      key: 'gone',
      ids: ['HL-4'],
      what: 'read the release Atomic removed',
      block: 'status',
      records: true,
      values: { release, on_error: 'record' },
      marker: `f'[HL-4] gone ok={${okVar('gone')}} reason={${reasonVar('gone')}}'`,
    },
    {
      key: 'events',
      ids: ['HL-4'],
      what: 'read the namespace events the attempt left',
      block: 'events',
      resultType: 'table',
      values: { timeout: 30, output_format: 'table' },
    },
  ]
}

/** The WARN lines the console carries, in order. */
async function warnings(page: Page): Promise<string[]> {
  const entries = await getLogEntries(page)
  return entries.filter((entry) => entry.level === 'WARN').map((entry) => entry.message)
}

test.describe('Helm atomic install (real kwok cluster + chart repository)', () => {
  test.beforeAll(async ({ request }) => {
    test.setTimeout(180_000)
    run = await seedRun(request, 'minimal')
    stuckRelease = releaseName('hl4', run.suffix)
  })

  test.afterAll(async ({ request }) => {
    if (run) await uninstallQuietly(request, { namespace: run.namespace, release: stuckRelease })
    await run?.teardown()
  })

  test('an atomic install that cannot finish removes what it created (HL-4)', async ({ page }) => {
    test.setTimeout(300_000)
    const release = stuckRelease
    const legs = atomicLegs(release)
    const fixture = buildHelmFixture(legs, {
      name: 'Helm Atomic Install E2E Test',
      bookend: ATOMIC_MARKER,
      namespace: run.namespace,
    })
    const { logs, all, vars } = await runHelmFixture(page, fixture, ATOMIC_MARKER)

    await test.step('every leg reported its ids and carried the status its case declares', async () => {
      expectMarkers(logs, legs)
      await expectLegStatuses(page, legs)
    })

    await test.step('HL-4: the install gives up on the wait and reports Timeout', () => {
      // helm's own words differ between the wait giving up and the process
      // deadline killing it, so only the Reason and the outputs are asserted.
      expectRecorded(vars, 'stuck', { reason: 'Timeout' })
      expect(statusOf(vars, 'stuck'), `a failed install reports no status.\n${all}`).toBe('')
      expectEmptyRelease(vars, 'stuck')
    })

    await test.step('HL-4: Atomic removed the release, so reading it back records NotFound', () => {
      expectRecorded(vars, 'gone', { reason: 'NotFound', contains: 'not found' })
      expect(statusOf(vars, 'gone'), `a release that is gone has no status.\n${all}`).toBe('')
      expectEmptyRelease(vars, 'gone')
    })

    await test.step('HL-4: the namespace still carries the events the attempt produced', () => {
      const found = resultOf(vars, 'events')
      expect(found.type, 'the events Result is a table').toBe('table')
      const table = found.value as WaveTable
      expect(table.columns.length, 'the events table declares its columns').toBeGreaterThan(0)
      expect(
        table.rows.length,
        `the attempt must leave events behind to debug with.\n${all}`,
      ).toBeGreaterThan(0)
      expect(countOf(vars, 'events'), 'the bound count matches the rows').toBe(table.rows.length)
    })

    await test.step('HL-4: each recorded leg wrote exactly one WARN line and the run still passed', async () => {
      const recorded = await warnings(page)
      expect(
        recorded.filter((line) => line.startsWith(TIMED_OUT_PREFIX)).length,
        `expected exactly one WARN line for the atomic install.\n${all}`,
      ).toBe(1)
      expect(
        recorded.filter((line) => line.startsWith(NOT_FOUND_PREFIX)).length,
        `expected exactly one WARN line for the read that found nothing.\n${all}`,
      ).toBe(1)
      await expect(page.locator('[data-testid="workflow-status"]')).toHaveAttribute(
        'data-status',
        'passed',
      )
    })
  })
})
