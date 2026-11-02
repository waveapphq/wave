/**
 * V-HELM-REPO-AUTH: the chart-repository credentials and the trust a chart
 * download runs under, against the real https + basic-auth chart listener.
 *
 * Phase: functional-workflow (parallel) - the test imports its own Test,
 * installs into the run's own namespace under release names of its own, and
 * tears the namespace down.
 * REQ: REQ-3.5.3.1, REQ-3.4.1.5
 * Design Decisions: HELM-5 (the Auth & TLS group), HELM-1
 *
 * One run, four legs on the same TLS listener, so the only thing that changes
 * between them is the Auth & TLS group. Every assertion reads a bound output -
 * the Result table's cells, the Status scalar, the Reason - or one exact INFO
 * line the verb printed. helm's own human text is never asserted.
 *
 * Pass Criteria:
 *   HL-5  Repository Username and Password with the lab CA as the Repository
 *         CA Certificate deploy the chart over TLS: Result is the one-row
 *         release table (Revision 1, Status deployed, Chart wave-demo-0.1.0,
 *         App Version 1.0.0), Status reads deployed, and the INFO line names
 *         the revision.
 *         A wrong Repository Password, under Record and continue, reports
 *         success false with Reason Forbidden, an empty Status and the release
 *         table with no row.
 *         The CA omitted with Verify Server Certificate on, under Record and
 *         continue, reports Reason Unreachable the same way.
 *         The CA omitted with Verify Server Certificate off deploys the same
 *         chart.
 *         Exactly two WARN lines, one per refused install, and the run passes.
 *         Both deployed releases are removed before the run ends.
 */

import { test, expect, type Page } from '../../helpers/playwright-fixtures'
import { getLogEntries } from '../../helpers/log-reader'
import { seedRun, type SeededRun } from '../../helpers/k8s-seed'
import { CA_CERT_PEM, CHART_REPO_PASSWORD, CHART_REPO_USER } from '../../helpers/config'
import {
  buildHelmFixture,
  CHART,
  CHART_REPO_TLS_URL,
  expectEmptyRelease,
  expectLegStatuses,
  expectLine,
  expectMarkers,
  expectRecorded,
  expectReleaseRow,
  installedLine,
  okVar,
  reasonVar,
  releaseName,
  runHelmFixture,
  statusOf,
  uninstallQuietly,
  uninstalledLine,
  type HelmLeg,
} from './cases-helm'

/** The bookend the run harvests its console against. */
const AUTH_MARKER = 'helm-repo-auth-done'

const V_0_1 = '0.1.0'
const CHART_0_1 = `${CHART.demo}-${V_0_1}`
const APP_1 = '1.0.0'
const DEPLOYED = 'deployed'

/** A password the listener's htpasswd file does not carry. */
const WRONG_PASSWORD = 'not-the-chart-secret'

/** The WARN line prefix a refused install writes, per Reason. */
const REFUSED = (reason: string): string => `Helm Install failed (${reason}): `

let run: SeededRun
let releases: { trusted: string; badpass: string; noca: string; noverify: string }

/** The four legs plus the two removals, on one chain. */
function authLegs(): HelmLeg[] {
  const source = {
    chart: CHART.demo,
    version: V_0_1,
    repo: CHART_REPO_TLS_URL,
    repo_username: CHART_REPO_USER,
  }
  return [
    {
      key: 'trusted',
      ids: ['HL-5'],
      what: 'install with the lab CA and the password',
      block: 'install',
      values: {
        ...source,
        release: releases.trusted,
        repo_password: CHART_REPO_PASSWORD,
        repo_ca_cert: CA_CERT_PEM,
      },
    },
    {
      key: 'badpass',
      ids: ['HL-5'],
      what: 'install with the wrong password',
      block: 'install',
      records: true,
      values: {
        ...source,
        release: releases.badpass,
        repo_password: WRONG_PASSWORD,
        repo_ca_cert: CA_CERT_PEM,
        on_error: 'record',
      },
      marker: `f'[HL-5] badpass ok={${okVar('badpass')}} reason={${reasonVar('badpass')}}'`,
    },
    {
      key: 'noca',
      ids: ['HL-5'],
      what: 'install with no CA, verification on',
      block: 'install',
      records: true,
      values: {
        ...source,
        release: releases.noca,
        repo_password: CHART_REPO_PASSWORD,
        repo_verify_ssl: true,
        on_error: 'record',
      },
      marker: `f'[HL-5] noca ok={${okVar('noca')}} reason={${reasonVar('noca')}}'`,
    },
    {
      key: 'noverify',
      ids: ['HL-5'],
      what: 'install with no CA, verification off',
      block: 'install',
      values: {
        ...source,
        release: releases.noverify,
        repo_password: CHART_REPO_PASSWORD,
        repo_verify_ssl: false,
      },
    },
    {
      key: 'droptrust',
      ids: ['HL-5'],
      what: 'remove the release the CA deployed',
      block: 'uninstall',
      values: { release: releases.trusted },
    },
    {
      key: 'dropskip',
      ids: ['HL-5'],
      what: 'remove the release verification off deployed',
      block: 'uninstall',
      values: { release: releases.noverify },
    },
  ]
}

/** The WARN lines the console carries, in order. */
async function warnings(page: Page): Promise<string[]> {
  const entries = await getLogEntries(page)
  return entries.filter((entry) => entry.level === 'WARN').map((entry) => entry.message)
}

test.describe('Helm chart-repository auth and TLS (real https + basic-auth listener)', () => {
  test.beforeAll(async ({ request }) => {
    test.setTimeout(180_000)
    run = await seedRun(request, 'minimal')
    releases = {
      trusted: releaseName('hl5ca', run.suffix),
      badpass: releaseName('hl5pw', run.suffix),
      noca: releaseName('hl5noca', run.suffix),
      noverify: releaseName('hl5skip', run.suffix),
    }
  })

  test.afterAll(async ({ request }) => {
    if (run) {
      for (const release of Object.values(releases)) {
        await uninstallQuietly(request, { namespace: run.namespace, release })
      }
    }
    await run?.teardown()
  })

  test('credentials and trust decide whether the chart downloads (HL-5)', async ({ page }) => {
    test.setTimeout(300_000)
    const legs = authLegs()
    const fixture = buildHelmFixture(legs, {
      name: 'Helm Repository Auth E2E Test',
      bookend: AUTH_MARKER,
      namespace: run.namespace,
    })
    const { logs, all, vars } = await runHelmFixture(page, fixture, AUTH_MARKER)

    const row = (name: string) => ({
      name,
      namespace: run.namespace,
      revision: 1,
      status: DEPLOYED,
      chart: CHART_0_1,
      appVersion: APP_1,
    })

    await test.step('every leg reported its ids and carried the status its case declares', async () => {
      expectMarkers(logs, legs)
      await expectLegStatuses(page, legs)
    })

    await test.step('HL-5: the lab CA and the right password deploy the chart over TLS', () => {
      expectReleaseRow(vars, 'trusted', row(releases.trusted))
      expect(statusOf(vars, 'trusted'), `the Status scalar.\n${all}`).toBe(DEPLOYED)
      expectLine(logs, installedLine(releases.trusted, 1))
    })

    await test.step('HL-5: a wrong repository password is refused with Forbidden', () => {
      expectRecorded(vars, 'badpass', { reason: 'Forbidden' })
      expect(statusOf(vars, 'badpass'), `a refused install reports no status.\n${all}`).toBe('')
      expectEmptyRelease(vars, 'badpass')
    })

    await test.step('HL-5: omitting the CA with verification on is refused with Unreachable', () => {
      expectRecorded(vars, 'noca', { reason: 'Unreachable' })
      expect(statusOf(vars, 'noca'), `a refused install reports no status.\n${all}`).toBe('')
      expectEmptyRelease(vars, 'noca')
    })

    await test.step('HL-5: turning verification off deploys the same chart without the CA', () => {
      expectReleaseRow(vars, 'noverify', row(releases.noverify))
      expect(statusOf(vars, 'noverify'), `the Status scalar.\n${all}`).toBe(DEPLOYED)
      expectLine(logs, installedLine(releases.noverify, 1))
    })

    await test.step('HL-5: only the two refused installs warned, and the run still passed', async () => {
      const recorded = (await warnings(page)).filter((line) =>
        line.startsWith('Helm Install failed ('),
      )
      expect(recorded.length, `expected one WARN line per refused install.\n${all}`).toBe(2)
      expect(
        recorded.filter((line) => line.startsWith(REFUSED('Forbidden'))).length,
        `the wrong password must warn once, naming Forbidden.\n${recorded.join('\n')}`,
      ).toBe(1)
      expect(
        recorded.filter((line) => line.startsWith(REFUSED('Unreachable'))).length,
        `the missing CA must warn once, naming Unreachable.\n${recorded.join('\n')}`,
      ).toBe(1)
      await expect(page.locator('[data-testid="workflow-status"]')).toHaveAttribute(
        'data-status',
        'passed',
      )
    })

    await test.step('HL-5: both deployed releases are removed before the run ends', () => {
      expectLine(logs, uninstalledLine(releases.trusted))
      expectLine(logs, uninstalledLine(releases.noverify))
    })
  })
})
