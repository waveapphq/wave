/**
 * V-FILE-PICKER-HELM: Helm Install runs from a chart archive picked out of the
 * test's own Test Data.
 *
 * Wireframe: N/A
 * Design Decisions: TDATA-8, TDATA-9
 * REQ: REQ-3.4.2.2, REQ-3.4.3.2, REQ-3.5.3.1
 *
 * Phase: functional-workflow (parallel) - the test imports its own Test, uploads
 * its own chart archive, installs into the run's own namespace under a release
 * name of its own, and tears both down.
 *
 * The Chart row is imported holding a repository chart name nobody picked. The
 * spec replaces it through Browse with the archive it uploaded, saves, and runs:
 * the proof is helm's own release document, which can only carry
 * `wave-demo-0.1.0` if the reference resolved to the uploaded file.
 *
 * Pass Criteria:
 *  FP-10  Helm Install's Chart opens the picker in `file-or-folder` mode on the
 *         Test Data tab with an empty path under `testdata://` (the repository
 *         chart name is under neither scheme); picking the uploaded archive puts
 *         `wave-demo-0.1.0.tgz` in the path and stores
 *         `testdata://wave-demo-0.1.0.tgz` on the Block.
 *  FP-11  The run installs from that reference: the INFO line names revision 1
 *         and the release table reports Chart `wave-demo-0.1.0`, App Version
 *         `1.0.0` and Status `deployed` in the run's own namespace.
 *
 * Run: ./scripts/e2e-targeted-local.sh functional/file-picker/v-file-picker-helm.spec.ts
 */

import fs from 'node:fs'
import path from 'node:path'
import { test, expect } from '../../helpers/playwright-fixtures'
import { ensureEnvironment } from '../../helpers/config'
import { finishRun, startRun } from '../../helpers/k8s-run'
import { seedRun, type SeededRun } from '../../helpers/k8s-seed'
import { getActiveSessionId, getSessionVariables } from '../../helpers/fixture-import'
import {
  buildHelmFixture,
  expectLegStatuses,
  expectLine,
  expectMarkers,
  expectReleaseRow,
  installedLine,
  releaseName,
  uninstallQuietly,
  type HelmLeg,
  type SessionVariables,
} from '../helm/cases-helm'
import {
  confirmPicker,
  deleteTest,
  expectReference,
  expectRowValue,
  importWithTestData,
  openConfig,
  openPicker,
  persistedValues,
  saveConfig,
  saveWorkbench,
  type SeedFile,
} from './picker'

const BOOKEND = 'file-picker-helm-done'

/** The archive the chart repository also serves; here it travels as test data. */
const CHART_ARCHIVE = 'wave-demo-0.1.0.tgz'
const CHART_REFERENCE = `testdata://${CHART_ARCHIVE}`
const CHART_NAME = 'wave-demo-0.1.0'
const APP_VERSION = '1.0.0'
const DEPLOYED = 'deployed'

/** The repository chart name the Block is imported with, so the picked value is
 *  provably what the run used. */
const NOT_PICKED = 'wave-demo-not-picked'

const CHART_FILE: SeedFile = {
  folder: '',
  name: CHART_ARCHIVE,
  body: fs.readFileSync(path.resolve(__dirname, `../../services/tls-lab/charts/${CHART_ARCHIVE}`)),
}

let run: SeededRun
let release: string
let testId = ''

function installLeg(): HelmLeg {
  return {
    key: 'chart',
    ids: ['FP-11'],
    what: 'install from the picked archive',
    block: 'install',
    values: { release, chart: NOT_PICKED },
  }
}

test.describe('V-FILE-PICKER-HELM: an install that runs from a picked chart archive', () => {
  test.beforeAll(async ({ request }) => {
    test.setTimeout(180_000)
    await ensureEnvironment(request)
    run = await seedRun(request, 'minimal')
    release = releaseName('fp', run.suffix)
  })

  test.afterAll(async ({ request }) => {
    if (run) await uninstallQuietly(request, { namespace: run.namespace, release })
    await run?.teardown()
    if (testId) await deleteTest(request, testId)
  })

  test('Helm Install picks an uploaded chart archive and installs from it', async ({
    page,
    request,
  }) => {
    test.setTimeout(300_000)
    const legs = [installLeg()]
    const fixture = buildHelmFixture(legs, {
      name: 'File Picker Helm Chart E2E Test',
      bookend: BOOKEND,
      namespace: run.namespace,
    })
    testId = await importWithTestData(page, fixture, [CHART_FILE], { injectHttp: true })

    await test.step('FP-10: the Chart row browses Test Data and takes the archive', async () => {
      const dialog = await openConfig(page, 'install-chart')
      await expectRowValue(dialog, 'chart', NOT_PICKED)

      const picker = await openPicker(page, dialog, 'chart', 'file-or-folder')
      await expect(picker.testDataTab).toHaveAttribute('aria-pressed', 'true')
      // The row holds a repository chart name, under neither scheme: the path starts empty.
      await expectReference(picker, 'testdata://', '')
      await picker.file(CHART_ARCHIVE).click()
      await expectReference(picker, 'testdata://', CHART_ARCHIVE)
      await confirmPicker(picker)

      await expectRowValue(dialog, 'chart', CHART_REFERENCE)
      await saveConfig(dialog)
      await saveWorkbench(page)

      const values = await persistedValues(request, testId)
      expect(values['install-chart'].chart).toBe(CHART_REFERENCE)
    })

    const status = await startRun(page)
    const logs = await finishRun(page, status, BOOKEND, 240_000)

    await test.step('FP-11: helm installed the chart the reference resolved to', async () => {
      expectMarkers(logs, legs)
      await expectLegStatuses(page, legs)
      expectLine(logs, installedLine(release, 1))

      const vars = (await getSessionVariables(page, await getActiveSessionId(page))) as SessionVariables
      expectReleaseRow(vars, 'chart', {
        name: release,
        namespace: run.namespace,
        revision: 1,
        status: DEPLOYED,
        chart: CHART_NAME,
        appVersion: APP_VERSION,
      })
    })
  })
})
