/**
 * V-HELM-HOST: which helm a Block runs when it runs on the WAVE server.
 *
 * Phase: functional-workflow (parallel) - one Test, one run namespace of its
 * own, torn down at the end.
 * REQ: REQ-3.5.3.1, REQ-3.5.3.4, REQ-3.4.1.5
 * Design Decisions: HELM-1
 *
 * Every other Helm spec leaves Helm Path empty and never says so out loud.
 * This one does: no Block here sits inside a Remote Execution container, so
 * every leg runs on the WAVE server's own machine, and the three legs are the
 * three things the Helm Path row can be. An empty row runs the helm the
 * machine has on its PATH - the default every author starts from, and the
 * whole claim that WAVE ships no helm of its own. A row with a real path runs
 * that file, as given. A row with a path that is not there refuses, in the
 * LOCAL wording, which carries no host name - the one difference between this
 * message and the one V-HELM-REMOTE asserts.
 *
 * Pass Criteria:
 *   HL-14a  Helm Path empty installs the fixture chart: the one-row release
 *           table (Name, Namespace, Revision 1, Updated, Status deployed,
 *           Chart wave-demo-0.1.0, App Version 1.0.0), Status deployed, and
 *           the INFO line naming the revision.
 *   HL-14b  Helm Path set to the machine's real helm installs identically, so
 *           an explicit path is executed as given.
 *   HL-14c  Helm Path set to a path that is not there refuses under Fail the
 *           block with exactly
 *           `helm not found: /nonexistent/helm. Set Helm Path or install helm`.
 *   HL-14d  The same row under Record and continue refuses with the same
 *           sentence: a missing helm is a plain Block failure, never a
 *           recorded one, so no Block paints amber.
 */

import { test, expect } from '../../helpers/playwright-fixtures'
import { seedRun, type SeededRun } from '../../helpers/k8s-seed'
import {
  buildHelmFixture,
  caughtPrefix,
  CHART,
  CHART_REPO_URL,
  expectLegStatuses,
  expectLine,
  expectMarkers,
  expectNoAmber,
  expectCaught,
  expectReleaseRow,
  HELM_ON_PATH,
  installedLine,
  releaseName,
  runHelmFixture,
  SSH_REMOTE_HOSTNAME,
  statusOf,
  uninstallQuietly,
  type HelmLeg,
} from './cases-helm'

/** The bookend the console harvest gates on. */
const HOST_MARKER = 'helm-host-done'

const V_0_1 = '0.1.0'
const CHART_0_1 = `${CHART.demo}-${V_0_1}`
const APP_1 = '1.0.0'
const DEPLOYED = 'deployed'

/** A path no machine in the stack has, so the row can only refuse. */
const MISSING_HELM_PATH = '/nonexistent/helm'

/** Per B14b, the WAVE-side wording: what was tried, and what to do. No host
 *  clause, because the Block ran here. */
const MISSING_HELM_LOCAL = `helm not found: ${MISSING_HELM_PATH}. Set Helm Path or install helm`

let run: SeededRun
let onPathRelease: string
let setPathRelease: string

/** HL-14: the three things the Helm Path row can be, on one run. */
function hostLegs(): HelmLeg[] {
  const chart = { chart: CHART.demo, version: V_0_1, repo: CHART_REPO_URL }
  return [
    {
      key: 'onpath',
      ids: ['HL-14'],
      what: 'install with Helm Path empty',
      block: 'install',
      values: { ...chart, release: onPathRelease, helm_path: '' },
    },
    {
      key: 'setpath',
      ids: ['HL-14'],
      what: 'install with Helm Path set',
      block: 'install',
      values: { ...chart, release: setPathRelease, helm_path: HELM_ON_PATH },
    },
    {
      key: 'gonefail',
      ids: ['HL-14'],
      what: 'no helm there, Fail the block',
      block: 'status',
      guarded: true,
      values: { release: onPathRelease, helm_path: MISSING_HELM_PATH, on_error: 'fail' },
    },
    {
      key: 'gonerec',
      ids: ['HL-14'],
      what: 'no helm there, Record and continue',
      block: 'status',
      guarded: true,
      values: { release: onPathRelease, helm_path: MISSING_HELM_PATH, on_error: 'record' },
    },
  ]
}

/** The refusal one guarded leg carried, as the console rendered it. */
function caughtLine(logs: readonly string[], leg: HelmLeg): string {
  return logs.find((text) => text.startsWith(caughtPrefix(leg))) ?? ''
}

test.describe('Helm Blocks on the WAVE server, and the Helm Path row', () => {
  test.beforeAll(async ({ request }) => {
    test.setTimeout(180_000)
    run = await seedRun(request, 'minimal')
    onPathRelease = releaseName('h14a', run.suffix)
    setPathRelease = releaseName('h14b', run.suffix)
  })

  test.afterAll(async ({ request }) => {
    if (run) {
      await uninstallQuietly(request, { namespace: run.namespace, release: onPathRelease })
      await uninstallQuietly(request, { namespace: run.namespace, release: setPathRelease })
    }
    await run?.teardown()
  })

  test('an empty Helm Path, a real one and one that is not there (HL-14)', async ({ page }) => {
    test.setTimeout(300_000)
    const legs = hostLegs()
    const fixture = buildHelmFixture(legs, {
      name: 'Helm Host Executable E2E Test',
      bookend: HOST_MARKER,
      namespace: run.namespace,
    })
    const { logs, all, vars } = await runHelmFixture(page, fixture, HOST_MARKER)

    await test.step('every leg reported its ids and carried the status its case declares', async () => {
      expectMarkers(logs, legs)
      await expectLegStatuses(page, legs)
    })

    await test.step('HL-14a: an empty Helm Path runs the helm the machine has on its PATH', () => {
      expectReleaseRow(vars, 'onpath', {
        name: onPathRelease,
        namespace: run.namespace,
        revision: 1,
        status: DEPLOYED,
        chart: CHART_0_1,
        appVersion: APP_1,
      })
      expect(statusOf(vars, 'onpath'), `the Status scalar.\n${all}`).toBe(DEPLOYED)
      expectLine(logs, installedLine(onPathRelease, 1))
    })

    await test.step('HL-14b: a Helm Path that names the real executable installs identically', () => {
      expectReleaseRow(vars, 'setpath', {
        name: setPathRelease,
        namespace: run.namespace,
        revision: 1,
        status: DEPLOYED,
        chart: CHART_0_1,
        appVersion: APP_1,
      })
      expect(statusOf(vars, 'setpath'), `the Status scalar.\n${all}`).toBe(DEPLOYED)
      expectLine(logs, installedLine(setPathRelease, 1))
    })

    await test.step('HL-14c: a Helm Path that is not there refuses in the local wording', () => {
      expectCaught(logs, legs[2], { message: MISSING_HELM_LOCAL })
      expect(
        caughtLine(logs, legs[2]),
        `a Block that ran on WAVE must not name an execution host.\n${all}`,
      ).not.toContain(SSH_REMOTE_HOSTNAME)
    })

    await test.step('HL-14d: Record and continue does not soften it', async () => {
      expectCaught(logs, legs[3], { message: MISSING_HELM_LOCAL })
      expect(
        caughtLine(logs, legs[3]),
        `a Block that ran on WAVE must not name an execution host.\n${all}`,
      ).not.toContain(SSH_REMOTE_HOSTNAME)
      // A missing helm is a plain Block failure on both settings (B14a), so
      // nothing recorded it and nothing painted amber.
      await expectNoAmber(page)
    })
  })
})
