/**
 * V-HELM-IMPERSONATION: Impersonate User on a Helm Block, against the real
 * kwok cluster and the fixture chart repository.
 *
 * Phase: functional-workflow (parallel) - the test imports its own Test,
 * installs into the run's own namespace under release names of its own, and
 * tears the namespace down.
 * REQ: REQ-3.5.3.1, REQ-3.4.1.5, REQ-5.1.1
 * Design Decisions: HELM-1, HELM-4
 *
 * The cluster grants User wave-reader pods, pod logs and events and nothing
 * else, and no token maps to it (kwok/manifests/rbac-impersonation.yaml), so a
 * refusal naming wave-reader cannot come from the caller's own identity - that
 * is what makes the refusal proof rather than coincidence. The run opens with
 * the same install carrying no impersonation, so a broken install cannot be
 * mistaken for a refused one, and closes by reading the refused release, which
 * is missing: the impersonated install did nothing, it did not half-run.
 *
 * Pass Criteria:
 *   HL-10  a Helm Install whose Impersonate User is wave-reader, under Record
 *          and continue, reports success false with Reason Forbidden, an empty
 *          Status and the empty release table; its Error is the cluster's own
 *          explanation, naming wave-reader and never the caller; it writes
 *          exactly one WARN line, paints its Block amber and leaves the run
 *          passed; and a Helm Status on that release afterwards reports
 *          NotFound, so nothing was created. The unimpersonated control leg
 *          installs the same chart cleanly.
 */

import { test, expect, type Page } from '../../helpers/playwright-fixtures'
import { getLogEntries } from '../../helpers/log-reader'
import { seedRun, type SeededRun } from '../../helpers/k8s-seed'
import { K8S_IMPERSONATE_USER } from '../../helpers/config'
import {
  buildHelmFixture,
  CHART,
  CHART_REPO_URL,
  errorOf,
  expectEmptyRelease,
  expectLegStatuses,
  expectLine,
  expectMarkers,
  expectRecorded,
  expectReleaseRow,
  installedLine,
  nodeId,
  okVar,
  reasonVar,
  releaseName,
  runHelmFixture,
  statusOf,
  uninstalledLine,
  uninstallQuietly,
  type HelmLeg,
} from './cases-helm'

/** The bookend the run harvests its console against. */
const IMPERSONATION_MARKER = 'helm-impersonation-done'

const V_0_1 = '0.1.0'
const CHART_0_1 = `${CHART.demo}-${V_0_1}`
const APP_1 = '1.0.0'
const DEPLOYED = 'deployed'

/** The user the admin token authenticates as (kwok/tokens.csv). A refusal
 *  naming the impersonated subject may never name this one instead. */
const CALLER_USER = 'wave-admin'

/** The WARN line a recorded Helm Install failure opens with. */
const INSTALL_WARN_PREFIX = 'Helm Install failed (Forbidden): '

let run: SeededRun
let controlRelease: string
let deniedRelease: string

/** HL-10: the control install, the impersonated one, and the read that proves
 *  the refusal left nothing behind. */
function impersonationLegs(control: string, denied: string): HelmLeg[] {
  const chart = { chart: CHART.demo, version: V_0_1, repo: CHART_REPO_URL }
  return [
    {
      key: 'control',
      ids: ['HL-10'],
      what: 'install with no impersonation',
      block: 'install',
      values: { ...chart, release: control },
    },
    {
      key: 'denied',
      ids: ['HL-10'],
      what: 'install as wave-reader',
      block: 'install',
      records: true,
      values: {
        ...chart,
        release: denied,
        impersonate_user: K8S_IMPERSONATE_USER,
        on_error: 'record',
      },
      marker: `f'[HL-10] denied ok={${okVar('denied')}} reason={${reasonVar('denied')}}'`,
    },
    {
      key: 'absent',
      ids: ['HL-10'],
      what: 'read the release the refusal never made',
      block: 'status',
      records: true,
      values: { release: denied, on_error: 'record' },
      marker: `f'[HL-10] absent ok={${okVar('absent')}} reason={${reasonVar('absent')}}'`,
    },
    {
      key: 'gone',
      ids: ['HL-10'],
      what: 'uninstall the control release',
      block: 'uninstall',
      values: { release: control },
    },
  ]
}

/** The WARN lines the console carries, in order. */
async function warnings(page: Page): Promise<string[]> {
  const entries = await getLogEntries(page)
  return entries.filter((entry) => entry.level === 'WARN').map((entry) => entry.message)
}

test.describe('Helm Install under impersonation (real kwok cluster)', () => {
  test.beforeAll(async ({ request }) => {
    test.setTimeout(180_000)
    run = await seedRun(request, 'minimal')
    controlRelease = releaseName('hl10c', run.suffix)
    deniedRelease = releaseName('hl10d', run.suffix)
  })

  test.afterAll(async ({ request }) => {
    if (run) {
      await uninstallQuietly(request, { namespace: run.namespace, release: controlRelease })
      await uninstallQuietly(request, { namespace: run.namespace, release: deniedRelease })
    }
    await run?.teardown()
  })

  test('impersonating wave-reader is refused, and the cluster says why (HL-10)', async ({
    page,
  }) => {
    test.setTimeout(300_000)
    const legs = impersonationLegs(controlRelease, deniedRelease)
    const fixture = buildHelmFixture(legs, {
      name: 'Helm Impersonation E2E Test',
      bookend: IMPERSONATION_MARKER,
      namespace: run.namespace,
    })
    const { logs, all, vars } = await runHelmFixture(page, fixture, IMPERSONATION_MARKER)

    await test.step('every leg reported its ids and carried the status its case declares', async () => {
      expectMarkers(logs, legs)
      await expectLegStatuses(page, legs)
    })

    await test.step('HL-10: the control leg installs the same chart cleanly', () => {
      expectReleaseRow(vars, 'control', {
        name: controlRelease,
        namespace: run.namespace,
        revision: 1,
        status: DEPLOYED,
        chart: CHART_0_1,
        appVersion: APP_1,
      })
      expect(statusOf(vars, 'control'), `the control Status scalar.\n${all}`).toBe(DEPLOYED)
      expectLine(logs, installedLine(controlRelease, 1))
    })

    await test.step('HL-10: the impersonated install is refused, and the message names wave-reader', () => {
      expectRecorded(vars, 'denied', { reason: 'Forbidden', contains: 'forbidden' })
      const message = errorOf(vars, 'denied')
      expect(
        message,
        `the cluster's own explanation must name the impersonated subject.\n${all}`,
      ).toContain(`User "${K8S_IMPERSONATE_USER}" cannot`)
      expect(
        message,
        'a refusal naming the caller would not prove impersonation reached the cluster',
      ).not.toContain(CALLER_USER)
      expect(statusOf(vars, 'denied'), `a refused install reports no status.\n${all}`).toBe('')
      expectEmptyRelease(vars, 'denied')
    })

    await test.step('HL-10: the refusal writes one WARN line, paints amber and leaves the run passed', async () => {
      const recorded = (await warnings(page)).filter((line) =>
        line.startsWith(INSTALL_WARN_PREFIX),
      )
      expect(
        recorded.length,
        `expected exactly one WARN line for the refused install.\n${all}`,
      ).toBe(1)
      expect(recorded[0]).toBe(`${INSTALL_WARN_PREFIX}${errorOf(vars, 'denied')}`)

      const badge = page.locator(
        `[data-testid="workflow-node-${nodeId(legs[1])}"] [data-testid="node-run-state-badge"]`,
      )
      await expect(badge).toHaveAttribute('data-state', 'warn')
      await expect(page.locator('[data-testid="workflow-status"]')).toHaveAttribute(
        'data-status',
        'passed',
      )
    })

    await test.step('HL-10: the refused install left nothing behind', () => {
      expectRecorded(vars, 'absent', { reason: 'NotFound', contains: 'not found' })
      expect(statusOf(vars, 'absent'), `a missing release reports no status.\n${all}`).toBe('')
      expectEmptyRelease(vars, 'absent')
    })

    await test.step('HL-10: the control release is removed again', () => {
      expectLine(logs, uninstalledLine(controlRelease))
    })
  })
})
