/**
 * V-HELM-LIFECYCLE: the Helm release lifecycle against the real kwok cluster
 * and the fixture chart repository.
 *
 * Phase: functional-workflow (parallel) - each test imports its own Test,
 * installs into the run's own namespace under a release name of its own, and
 * tears the namespace down.
 * REQ: REQ-3.5.3.1, REQ-3.5.3.3, REQ-3.5.3.4, REQ-3.5.3.5, REQ-3.4.1.5
 * Design Decisions: HELM-1, HELM-2, HELM-3, HELM-4
 *
 * Two runs, one per dependency chain: the install-read-uninstall round trip,
 * and the values and revision walk. Every assertion reads a bound output - the
 * Result table's cells, the Status scalar, the Reason - or one exact INFO line
 * the verb printed. helm's own human text is never asserted.
 *
 * Pass Criteria:
 *   HL-1  Helm Install creates the release from the chart repository: Result is
 *         the one-row release table (Name, Namespace, Revision 1, Updated,
 *         Status deployed, Chart wave-demo-0.1.0, App Version 1.0.0), Status
 *         reads deployed, and the INFO line names the revision. Helm Status
 *         reads the same row back. Helm Uninstall removes it and says so. A
 *         Helm Status after the uninstall, under Record and continue, reports
 *         success false with Reason NotFound, an empty Status, the release
 *         table with its columns and no row, exactly one WARN line, an amber
 *         Block and a passed run.
 *   HL-2  Helm Upgrade with Reuse Values keeps the install-time values and
 *         merges the new ones on top; with Reset Values it drops them back to
 *         the chart defaults. Helm Rollback with Revision empty lands one
 *         revision higher, carrying the previous revision's chart, deployed.
 *         Helm Status with Revision set reads that older revision's document.
 */

import { test, expect, type Page } from '../../helpers/playwright-fixtures'
import { getLogEntries } from '../../helpers/log-reader'
import { seedRun, type SeededRun } from '../../helpers/k8s-seed'
import {
  buildHelmFixture,
  CHART,
  CHART_REPO_URL,
  expectEmptyRelease,
  expectLegStatuses,
  expectLine,
  expectMarkers,
  expectNoAmber,
  expectRecorded,
  expectReleaseRow,
  installedLine,
  nodeId,
  readReleaseLine,
  releaseDoc,
  releaseName,
  reasonVar,
  rolledBackLine,
  okVar,
  statusOf,
  uninstallQuietly,
  uninstalledLine,
  upgradedLine,
  runHelmFixture,
  type HelmLeg,
  type HelmMaterial,
} from './cases-helm'

/** The bookend each run harvests its console against. */
const ROUNDTRIP_MARKER = 'helm-lifecycle-roundtrip-done'
const REVISIONS_MARKER = 'helm-lifecycle-revisions-done'

const V_0_1 = '0.1.0'
const V_0_2 = '0.2.0'
const CHART_0_1 = `${CHART.demo}-${V_0_1}`
const CHART_0_2 = `${CHART.demo}-${V_0_2}`
const APP_1 = '1.0.0'
const APP_2 = '2.0.0'
const DEPLOYED = 'deployed'

let run: SeededRun
let roundTripRelease: string
let revisionsRelease: string

function material(name: string, bookend: string): HelmMaterial {
  return { name, bookend, namespace: run.namespace }
}

/** HL-1: install, read back, uninstall, then read what is no longer there. */
function roundTripLegs(release: string): HelmLeg[] {
  return [
    {
      key: 'install',
      ids: ['HL-1'],
      what: 'install wave-demo 0.1.0',
      block: 'install',
      values: { release, chart: CHART.demo, version: V_0_1, repo: CHART_REPO_URL },
    },
    {
      key: 'read',
      ids: ['HL-1'],
      what: 'read the installed release back',
      block: 'status',
      values: { release },
    },
    {
      key: 'gone',
      ids: ['HL-1'],
      what: 'uninstall the release',
      block: 'uninstall',
      values: { release },
    },
    {
      key: 'absent',
      ids: ['HL-1'],
      what: 'read the release after the uninstall',
      block: 'status',
      records: true,
      values: { release, on_error: 'record' },
      marker: `f'[HL-1] absent ok={${okVar('absent')}} reason={${reasonVar('absent')}}'`,
    },
  ]
}

/** HL-2: the values rules and the revision walk, on one release. */
function revisionLegs(release: string): HelmLeg[] {
  const chart = { release, chart: CHART.demo, repo: CHART_REPO_URL }
  return [
    {
      key: 'seed',
      ids: ['HL-2'],
      what: 'install 0.1.0 with install-time values',
      block: 'install',
      values: { ...chart, version: V_0_1, set: { marker: 'install-time', replicaCount: 2 } },
    },
    {
      key: 'reuse',
      ids: ['HL-2'],
      what: 'upgrade to 0.2.0, Reuse Values',
      block: 'upgrade',
      values: {
        ...chart,
        version: V_0_2,
        reuse_values: true,
        set: { marker: 'upgraded' },
        output_format: 'map',
      },
    },
    {
      key: 'reset',
      ids: ['HL-2'],
      what: 'upgrade to 0.1.0, Reset Values',
      block: 'upgrade',
      values: { ...chart, version: V_0_1, reset_values: true, output_format: 'map' },
    },
    {
      key: 'rolled',
      ids: ['HL-2'],
      what: 'roll back with Revision empty',
      block: 'rollback',
      values: { release },
    },
    {
      key: 'older',
      ids: ['HL-2'],
      what: 'read revision 2 back',
      block: 'status',
      values: { release, revision: 2 },
    },
  ]
}

/** The WARN lines the console carries, in order. */
async function warnings(page: Page): Promise<string[]> {
  const entries = await getLogEntries(page)
  return entries.filter((entry) => entry.level === 'WARN').map((entry) => entry.message)
}

test.describe('Helm release lifecycle (real kwok cluster + chart repository)', () => {
  test.beforeAll(async ({ request }) => {
    test.setTimeout(180_000)
    run = await seedRun(request, 'minimal')
    roundTripRelease = releaseName('hl1', run.suffix)
    revisionsRelease = releaseName('hl2', run.suffix)
  })

  test.afterAll(async ({ request }) => {
    if (run) {
      await uninstallQuietly(request, { namespace: run.namespace, release: roundTripRelease })
      await uninstallQuietly(request, { namespace: run.namespace, release: revisionsRelease })
    }
    await run?.teardown()
  })

  test('install, read back, uninstall, and read what is no longer there (HL-1)', async ({
    page,
  }) => {
    test.setTimeout(300_000)
    const release = roundTripRelease
    const legs = roundTripLegs(release)
    const fixture = buildHelmFixture(
      legs,
      material('Helm Lifecycle Round Trip E2E Test', ROUNDTRIP_MARKER),
    )
    const { logs, all, vars } = await runHelmFixture(page, fixture, ROUNDTRIP_MARKER)
    const row = {
      name: release,
      namespace: run.namespace,
      revision: 1,
      status: DEPLOYED,
      chart: CHART_0_1,
      appVersion: APP_1,
    }

    await test.step('every leg reported its ids and carried the status its case declares', async () => {
      expectMarkers(logs, legs)
      await expectLegStatuses(page, legs)
    })

    await test.step('HL-1: the install lands the release, and Result names it whole', () => {
      expectReleaseRow(vars, 'install', row)
      expect(statusOf(vars, 'install'), `the Status scalar.\n${all}`).toBe(DEPLOYED)
      expectLine(logs, installedLine(release, 1))
    })

    await test.step('HL-1: Helm Status reads the same release back', () => {
      expectReleaseRow(vars, 'read', row)
      expect(statusOf(vars, 'read'), `the read-back Status scalar.\n${all}`).toBe(DEPLOYED)
      expectLine(logs, readReleaseLine(release, 1))
    })

    await test.step('HL-1: the uninstall removes it and says so', () => {
      expectLine(logs, uninstalledLine(release))
    })

    await test.step('HL-1: reading the removed release records NotFound and empties every output', async () => {
      expectRecorded(vars, 'absent', { reason: 'NotFound', contains: 'not found' })
      expect(statusOf(vars, 'absent'), `a failed read reports no status.\n${all}`).toBe('')
      expectEmptyRelease(vars, 'absent')

      const recorded = (await warnings(page)).filter((line) =>
        line.startsWith('Helm Status failed (NotFound): '),
      )
      expect(
        recorded.length,
        `expected exactly one WARN line for the recorded read.\n${all}`,
      ).toBe(1)

      const badge = page.locator(
        `[data-testid="workflow-node-${nodeId(legs[3])}"] [data-testid="node-run-state-badge"]`,
      )
      await expect(badge).toHaveAttribute('data-state', 'warn')
      await expect(page.locator('[data-testid="workflow-status"]')).toHaveAttribute(
        'data-status',
        'passed',
      )
    })
  })

  test('reuse, reset, roll back and read an older revision (HL-2)', async ({ page }) => {
    test.setTimeout(300_000)
    const release = revisionsRelease
    const legs = revisionLegs(release)
    const fixture = buildHelmFixture(
      legs,
      material('Helm Lifecycle Revisions E2E Test', REVISIONS_MARKER),
    )
    const { logs, all, vars } = await runHelmFixture(page, fixture, REVISIONS_MARKER)

    await test.step('every leg reported its ids and its Block went green', async () => {
      expectMarkers(logs, legs)
      await expectLegStatuses(page, legs)
      await expectNoAmber(page)
    })

    await test.step('HL-2: the install carries its own values into revision 1', () => {
      expectReleaseRow(vars, 'seed', {
        name: release,
        namespace: run.namespace,
        revision: 1,
        status: DEPLOYED,
        chart: CHART_0_1,
        appVersion: APP_1,
      })
      expectLine(logs, installedLine(release, 1))
    })

    await test.step('HL-2: Reuse Values keeps the install-time values and merges the new one on top', () => {
      const document = releaseDoc(vars, 'reuse')
      expect(document.version, `the upgrade is revision 2.\n${all}`).toBe(2)
      expect(document.chart?.metadata?.version, `the new chart version`).toBe(V_0_2)
      expect(document.chart?.metadata?.appVersion, `the new app version`).toBe(APP_2)
      expect(document.info?.status, `the upgraded release status`).toBe(DEPLOYED)
      expect(document.config?.marker, `the value the upgrade set`).toBe('upgraded')
      expect(document.config?.replicaCount, `the install-time value must survive`).toBe(2)
      expect(statusOf(vars, 'reuse'), 'the Status scalar').toBe(DEPLOYED)
      expectLine(logs, upgradedLine(release, 2))
    })

    await test.step('HL-2: Reset Values drops the install-time values back to the chart defaults', () => {
      const document = releaseDoc(vars, 'reset')
      expect(document.version, `the second upgrade is revision 3.\n${all}`).toBe(3)
      expect(document.chart?.metadata?.version, 'the chart it went back to').toBe(V_0_1)
      expect(
        (document.config ?? {}).marker,
        `Reset Values must drop the install-time marker.\n${all}`,
      ).toBeUndefined()
      expect(
        (document.config ?? {}).replicaCount,
        'Reset Values must drop every install-time value',
      ).toBeUndefined()
      expectLine(logs, upgradedLine(release, 3))
    })

    await test.step('HL-2: the rollback lands one revision higher, on the previous revision chart', () => {
      expectReleaseRow(vars, 'rolled', {
        name: release,
        namespace: run.namespace,
        revision: 4,
        status: DEPLOYED,
        chart: CHART_0_2,
        appVersion: APP_2,
      })
      expect(statusOf(vars, 'rolled'), `the rolled-back release is deployed.\n${all}`).toBe(
        DEPLOYED,
      )
      expectLine(logs, rolledBackLine(release, 4))
    })

    await test.step('HL-2: Revision reads that older revision, not the live one', () => {
      expectReleaseRow(vars, 'older', {
        name: release,
        namespace: run.namespace,
        revision: 2,
        status: 'superseded',
        chart: CHART_0_2,
        appVersion: APP_2,
      })
      expectLine(logs, readReleaseLine(release, 2))
    })
  })
})
