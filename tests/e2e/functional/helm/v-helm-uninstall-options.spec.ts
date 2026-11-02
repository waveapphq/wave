/**
 * V-HELM-UNINSTALL-OPTIONS: the three controls Helm Uninstall carries where
 * helm has the flag - Ignore Not Found, Keep History and Cascade - against the
 * real kwok cluster and the fixture chart repository.
 *
 * Phase: functional-workflow (parallel) - the test imports its own Test,
 * installs into the run's own namespace under release names of its own, and
 * tears the namespace down.
 * REQ: REQ-3.5.3.1, REQ-3.5.3.4, REQ-3.5.3.5, REQ-3.4.1.5
 * Design Decisions: HELM-10 (the Uninstall rows), HELM-9 (Helm Status)
 *
 * One run, eight legs: the two missing-release legs, then an install-and-remove
 * pair per option with the read that proves what the option left behind. Every
 * assertion reads a bound output - the Result table's cells, the Status scalar,
 * the Reason - or one exact INFO line the verb printed.
 *
 * Pass Criteria:
 *   HL-6  Ignore Not Found on a release that never existed passes: the block
 *         goes green, the verb prints its removal line, and nothing warns.
 *         The same uninstall with Ignore Not Found off, under Record and
 *         continue, reports success false with Reason NotFound.
 *         Keep History leaves the release readable: the Helm Status that
 *         follows succeeds and its Status scalar reads uninstalled.
 *         Cascade Foreground removes the release: the uninstall succeeds and
 *         the Helm Status that follows, under Record and continue, reports
 *         Reason NotFound with an empty Status and no row.
 *         Exactly one uninstall and one read warned, and the run passes.
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
  expectRecorded,
  expectReleaseRow,
  installedLine,
  okVar,
  readReleaseLine,
  reasonVar,
  releaseName,
  runHelmFixture,
  statusOf,
  uninstallQuietly,
  uninstalledLine,
  type HelmLeg,
} from './cases-helm'

/** The bookend the run harvests its console against. */
const OPTIONS_MARKER = 'helm-uninstall-options-done'

const V_0_1 = '0.1.0'
const CHART_0_1 = `${CHART.demo}-${V_0_1}`
const APP_1 = '1.0.0'
/** The status helm leaves on a release Keep History held on to. */
const UNINSTALLED = 'uninstalled'

let run: SeededRun
let releases: { ignored: string; strict: string; kept: string; cascaded: string }

/** The four proofs on one chain, in the order each one's state needs. */
function optionLegs(): HelmLeg[] {
  const source = { chart: CHART.demo, version: V_0_1, repo: CHART_REPO_URL }
  return [
    {
      key: 'ignored',
      ids: ['HL-6'],
      what: 'remove a missing release, Ignore Not Found on',
      block: 'uninstall',
      values: { release: releases.ignored, ignore_not_found: true },
    },
    {
      key: 'strict',
      ids: ['HL-6'],
      what: 'remove a missing release, Ignore Not Found off',
      block: 'uninstall',
      records: true,
      values: { release: releases.strict, ignore_not_found: false, on_error: 'record' },
      marker: `f'[HL-6] strict ok={${okVar('strict')}} reason={${reasonVar('strict')}}'`,
    },
    {
      key: 'kept',
      ids: ['HL-6'],
      what: 'install the release Keep History holds on to',
      block: 'install',
      values: { ...source, release: releases.kept },
    },
    {
      key: 'keptgone',
      ids: ['HL-6'],
      what: 'remove it with Keep History on',
      block: 'uninstall',
      values: { release: releases.kept, keep_history: true },
    },
    {
      key: 'keptread',
      ids: ['HL-6'],
      what: 'read what Keep History left behind',
      block: 'status',
      values: { release: releases.kept },
    },
    {
      key: 'cascaded',
      ids: ['HL-6'],
      what: 'install the release Cascade Foreground removes',
      block: 'install',
      values: { ...source, release: releases.cascaded },
    },
    {
      key: 'castgone',
      ids: ['HL-6'],
      what: 'remove it with Cascade Foreground',
      block: 'uninstall',
      values: { release: releases.cascaded, cascade: 'foreground' },
    },
    {
      key: 'castread',
      ids: ['HL-6'],
      what: 'read the release Cascade Foreground removed',
      block: 'status',
      records: true,
      values: { release: releases.cascaded, on_error: 'record' },
      marker: `f'[HL-6] castread ok={${okVar('castread')}} reason={${reasonVar('castread')}}'`,
    },
  ]
}

/** The WARN lines the console carries, in order. */
async function warnings(page: Page): Promise<string[]> {
  const entries = await getLogEntries(page)
  return entries.filter((entry) => entry.level === 'WARN').map((entry) => entry.message)
}

test.describe('Helm Uninstall options (real kwok cluster + chart repository)', () => {
  test.beforeAll(async ({ request }) => {
    test.setTimeout(180_000)
    run = await seedRun(request, 'minimal')
    releases = {
      ignored: releaseName('hl6ign', run.suffix),
      strict: releaseName('hl6str', run.suffix),
      kept: releaseName('hl6keep', run.suffix),
      cascaded: releaseName('hl6casc', run.suffix),
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

  test('ignore not found, keep history and cascade foreground (HL-6)', async ({ page }) => {
    test.setTimeout(300_000)
    const legs = optionLegs()
    const fixture = buildHelmFixture(legs, {
      name: 'Helm Uninstall Options E2E Test',
      bookend: OPTIONS_MARKER,
      namespace: run.namespace,
    })
    const { logs, all, vars } = await runHelmFixture(page, fixture, OPTIONS_MARKER)

    await test.step('every leg reported its ids and carried the status its case declares', async () => {
      expectMarkers(logs, legs)
      await expectLegStatuses(page, legs)
    })

    await test.step('HL-6: Ignore Not Found turns a release that never existed into a pass', () => {
      expectLine(logs, uninstalledLine(releases.ignored))
    })

    await test.step('HL-6: without it the same removal records NotFound', () => {
      expectRecorded(vars, 'strict', { reason: 'NotFound', contains: 'not found' })
    })

    await test.step('HL-6: Keep History leaves the release readable and marked uninstalled', () => {
      expectLine(logs, installedLine(releases.kept, 1))
      expectLine(logs, uninstalledLine(releases.kept))
      expectReleaseRow(vars, 'keptread', {
        name: releases.kept,
        namespace: run.namespace,
        revision: 1,
        status: UNINSTALLED,
        chart: CHART_0_1,
        appVersion: APP_1,
      })
      expect(statusOf(vars, 'keptread'), `the kept release still reports a status.\n${all}`).toBe(
        UNINSTALLED,
      )
      expectLine(logs, readReleaseLine(releases.kept, 1))
    })

    await test.step('HL-6: Cascade Foreground removes the release, and the read after it records NotFound', () => {
      expectLine(logs, installedLine(releases.cascaded, 1))
      expectLine(logs, uninstalledLine(releases.cascaded))
      expectRecorded(vars, 'castread', { reason: 'NotFound', contains: 'not found' })
      expect(statusOf(vars, 'castread'), `a failed read reports no status.\n${all}`).toBe('')
      expectEmptyRelease(vars, 'castread')
    })

    await test.step('HL-6: exactly one removal and one read warned, and the run still passed', async () => {
      const recorded = await warnings(page)
      const removals = recorded.filter((line) => line.startsWith('Helm Uninstall failed ('))
      expect(
        removals.length,
        `Ignore Not Found must warn about nothing, so only the strict removal warns.\n${all}`,
      ).toBe(1)
      expect(
        removals.filter((line) => line.startsWith('Helm Uninstall failed (NotFound): ')).length,
        `the strict removal must name NotFound.\n${removals.join('\n')}`,
      ).toBe(1)
      const reads = recorded.filter((line) => line.startsWith('Helm Status failed ('))
      expect(
        reads.length,
        `only the read after Cascade Foreground may warn.\n${all}`,
      ).toBe(1)
      expect(
        reads.filter((line) => line.startsWith('Helm Status failed (NotFound): ')).length,
        `the read after Cascade Foreground must name NotFound.\n${reads.join('\n')}`,
      ).toBe(1)
      await expect(page.locator('[data-testid="workflow-status"]')).toHaveAttribute(
        'data-status',
        'passed',
      )
    })
  })
})
