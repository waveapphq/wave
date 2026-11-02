/**
 * V-K8S-EXEC-COPY: the K8s Copy Block against the real kwok cluster.
 *
 * Phase: functional-workflow (parallel) - each test imports its own Test, runs
 * only against the run's own exec-fixture pod, and tears the namespace down.
 * REQ: REQ-5.1.1, REQ-3.4.1.5
 * Design Decisions: K8SEXEC-4, K8SEXEC-5, K8SEXEC-6, K8SEXEC-9, K8SEXEC-10
 *
 * Three runs, split by what a leg needs. The pull run seeds each source with a
 * K8s Exec Block immediately before the Copy Block that takes it, and ends on
 * the one source the pod does not hold. The push run is one dependent chain:
 * a File I/O Block writes an artifact, K8s Copy sends that artifact into the
 * pod, and a K8s Exec `cat` reads it back out - a push really does source a
 * file an earlier Block in the same test wrote. The limit run types Max size
 * (MiB) and Max files into two Copy sheets over the 256 / 10000 the fixture
 * carries, so both refusals happen only if the sheets saved what was typed.
 *
 * Copy declares two outputs outside the Record gate and both are read back on
 * every positive leg: the Summary table with its SOURCE / TARGET / SIZE cells
 * AND its row count, and success. The recorded leg adds error and reason and
 * keeps its declared columns with no rows.
 *
 * The TARGET cell of a pull is the resolved ABSOLUTE path on the WAVE server,
 * not the `artifact://` reference the Block was given, so it is matched by its
 * tail; the run's artifacts API is what proves the bytes landed.
 *
 * Pass Criteria:
 *   KE-15  pulling one file out of the pod reports one Summary row whose
 *          SOURCE is the pod path, whose TARGET is where it landed and whose
 *          SIZE is the file's size, reports success, and the artifact reads
 *          back with exactly what the pod held
 *   KE-16  pulling a directory reports one Summary row per file and no row for
 *          the directory itself, so the row count is the file count, and every
 *          file lands under the artifact the Block named
 *   KE-17  a source path the pod does not hold under Record and continue
 *          reports success false, the cluster's NonZeroExitCode reason, the
 *          command's own message in error, an empty Summary that still
 *          declares its three columns, one WARN line and an amber Block
 *   KE-18  a push sources an artifact an earlier Block in the same test wrote:
 *          Summary names the local file, the pod path and the size, and a
 *          K8s Exec `cat` in the pod reads the same bytes back
 *   KE-19  a pull over Max size (MiB) 1 reports success false, reason
 *          ArchiveTooLarge, the Max size (MiB) refusal with max 1, an empty Summary
 *          that still declares its three columns, one WARN line and an amber
 *          Block; the file an earlier pull landed where its first file lands
 *          reads back byte for byte, nothing new is left under limit-size and
 *          no `.<name>.<8 hex>.keep` file is left anywhere
 *   KE-20  a pull over Max files 2 reports reason ArchiveTooManyEntries and the
 *          Max files refusal with max 2, and leaves nothing under limit-files
 */

import { test, expect, type Page } from '../../helpers/playwright-fixtures'
import { getLogEntries } from '../../helpers/log-reader'
import {
  getActiveSessionId,
  getSessionVariables,
  importValidateAndNavigate,
} from '../../helpers/fixture-import'
import { finishRun, startRun } from '../../helpers/k8s-run'
import { seedRun, type SeededRun } from '../../helpers/k8s-seed'
import { K8S_ADMIN_TOKEN, K8S_CA_PEM } from '../../helpers/config'
import { waitForViewportSettled } from '../../helpers/canvas'
import { numberInput } from '../../helpers/config-sheet'
import { validateTest } from '../../helpers/fn-seed'
import {
  deleteTest,
  expandGroup,
  openConfig,
  persistedValues,
  saveConfig,
  saveWorkbench,
} from '../file-picker/picker'
import {
  ABSENT_FILE,
  artifactPath,
  BIG_FILES,
  buildExecFixture,
  CONTAINER_APP,
  copiedLine,
  copyRefused,
  copyRows,
  DIR_FILES,
  EXEC_POD,
  expectEmptyCopy,
  expectLegStatuses,
  expectLine,
  expectMarkers,
  expectRecordedCore,
  expectRecordedWarning,
  expectStreams,
  expectSuccess,
  FIXTURE_MAX_FILES,
  FIXTURE_MAX_SIZE_MIB,
  KEEP_NAME,
  LIMIT_FILES_ARTIFACT,
  LIMIT_SIZE_ARTIFACT,
  limitLegs,
  listArtifacts,
  nodeId,
  overFilesDetail,
  overSizeDetail,
  podDir,
  podFile,
  priorContent,
  PULL_FILE,
  pullContent,
  pullLegs,
  PUSH_FILE,
  pushContent,
  pushLegs,
  readArtifact,
  TOO_LARGE_REASON,
  TOO_MANY_REASON,
  TYPED_MAX_FILES,
  TYPED_MAX_SIZE_MIB,
  where,
  type ExecContext,
  type ExecMaterial,
  type SessionVariables,
} from './cases-exec'

/** The bookend each run harvests its console against. */
const PULL_MARKER = 'k8s-exec-pull-done'
const PUSH_MARKER = 'k8s-exec-push-done'
const LIMIT_MARKER = 'k8s-exec-limit-done'

/** The reason the cluster's own tar gives for a path it cannot open. */
const NON_ZERO_REASON = 'NonZeroExitCode'

let run: SeededRun
let ctx: ExecContext
const createdTests: string[] = []

function material(
  overrides: Partial<ExecMaterial> & Pick<ExecMaterial, 'name' | 'bookend'>,
): ExecMaterial {
  return {
    adminToken: K8S_ADMIN_TOKEN,
    caCert: K8S_CA_PEM,
    namespace: run.namespace,
    ...overrides,
  }
}

/** Import the built fixture and open it on the canvas; the spec deletes it after. */
async function importFixture(page: Page, fixture: Record<string, unknown>): Promise<string> {
  const testId = await importValidateAndNavigate(page, fixture, { injectHttp: true })
  createdTests.push(testId)
  return testId
}

/** Import the built fixture, run it, and read back everything a proof needs. */
async function runFixture(
  page: Page,
  fixture: Record<string, unknown>,
  marker: string,
  runTimeout = 240_000,
): Promise<{ logs: string[]; all: string; vars: SessionVariables }> {
  await importFixture(page, fixture)
  return runOpened(page, marker, runTimeout)
}

/** Run the Test open on the canvas and read back everything a proof needs. */
async function runOpened(
  page: Page,
  marker: string,
  runTimeout = 240_000,
): Promise<{ logs: string[]; all: string; vars: SessionVariables }> {
  const status = await startRun(page)
  const logs = await finishRun(page, status, marker, runTimeout)
  const sessionId = await getActiveSessionId(page)
  const vars = (await getSessionVariables(page, sessionId)) as SessionVariables
  return { logs, all: logs.join('\n'), vars }
}

/** Open a Copy Block's sheet, type one Advanced limit row over the fixture's value, save. */
async function typeLimit(
  page: Page,
  node: string,
  row: 'max_size_mib' | 'max_files',
  from: number,
  to: number,
): Promise<void> {
  await waitForViewportSettled(page)
  const dialog = await openConfig(page, node)
  await expandGroup(dialog, 'Advanced')
  const input = numberInput(dialog, row)
  await expect(input, `${node} ${row} shows what the fixture carries`).toHaveValue(String(from))
  await input.fill(String(to))
  await expect(input).toHaveValue(String(to))
  await saveConfig(dialog)
}

test.describe('K8s Copy Block (real kwok cluster)', () => {
  test.beforeAll(async ({ request }) => {
    test.setTimeout(180_000)
    run = await seedRun(request, 'exec')
    ctx = { namespace: run.namespace, suffix: run.suffix }
  })

  test.afterAll(async ({ request }) => {
    while (createdTests.length > 0) await deleteTest(request, createdTests.pop() as string)
    await run?.teardown()
  })

  test('a file and a directory out of the pod, and a source that is not there (KE-15 to KE-17)', async ({
    page,
  }) => {
    test.setTimeout(240_000)
    const legs = pullLegs(ctx)
    const fixture = buildExecFixture(
      legs,
      material({ name: 'K8s Copy Pull E2E Test', bookend: PULL_MARKER }),
    )
    const { logs, all, vars } = await runFixture(page, fixture, PULL_MARKER)
    const artifacts = await listArtifacts(page)

    await test.step('every leg reported its ids and carried the status its case declares', async () => {
      expectMarkers(logs, legs)
      await expectLegStatuses(page, legs)
    })

    await test.step('KE-15: one file comes out, and the artifact holds what the pod held', async () => {
      const content = pullContent(ctx)
      const source = podFile(ctx, PULL_FILE)
      const landed = artifactPath(ctx, PULL_FILE)
      const rows = copyRows(vars, 'pullfile')
      expect(rows.length, `one file is one row.\n${all}`).toBe(1)
      expect(rows[0].source, 'the SOURCE cell is the pod path').toBe(source)
      expect(
        rows[0].target.endsWith(`/${landed}`),
        `the TARGET cell must be where the file landed: ${rows[0].target}`,
      ).toBeTruthy()
      expect(rows[0].size, 'the SIZE cell is the file size').toBe(Buffer.byteLength(content))
      expectSuccess(vars, 'pullfile')
      expectLine(logs, copiedLine(source, rows[0].target))

      const entry = artifacts.find((item) => item.path === landed)
      expect(entry, `${landed} is missing from ${JSON.stringify(artifacts)}`).toBeTruthy()
      expect(entry!.size_bytes).toBe(Buffer.byteLength(content))
      expect(await readArtifact(page, landed)).toBe(content)
    })

    await test.step('KE-16: a directory comes out whole, one row per file', () => {
      const dir = podDir(ctx)
      const root = artifactPath(ctx, 'dir')
      const rows = copyRows(vars, 'pulldir').sort((a, b) => a.source.localeCompare(b.source))
      expect(rows.length, `the row count is the file count.\n${all}`).toBe(DIR_FILES.length)
      expect(
        rows.map((row) => ({ source: row.source, size: row.size })),
        'every file is named with its own size, and the directory itself is not a row',
      ).toEqual(
        DIR_FILES.map(([name, content]) => ({
          source: `${dir}/${name}`,
          size: Buffer.byteLength(content),
        })),
      )
      for (const [index, [name, content]] of DIR_FILES.entries()) {
        expect(
          rows[index].target.endsWith(`/${root}/${name}`),
          `${name} must land under the artifact the Block named: ${rows[index].target}`,
        ).toBeTruthy()
        const entry = artifacts.find((item) => item.path === `${root}/${name}`)
        expect(entry, `${root}/${name} is missing from ${JSON.stringify(artifacts)}`).toBeTruthy()
        expect(entry!.size_bytes).toBe(Buffer.byteLength(content))
      }
      expectSuccess(vars, 'pulldir')
    })

    await test.step('KE-17: a source the pod does not hold is recorded, not raised', async () => {
      const message = expectRecordedCore(vars, 'badpull', NON_ZERO_REASON)
      expect(
        message.startsWith(
          copyRefused('from', where(EXEC_POD, CONTAINER_APP, run.namespace), ''),
        ),
        `the refusal must name the pod and container it targeted.\n${all}`,
      ).toBeTruthy()
      expect(
        message,
        `the refusal must name the path it could not read.\n${all}`,
      ).toContain(podFile(ctx, ABSENT_FILE))
      expectEmptyCopy(vars, 'badpull')

      expectRecordedWarning(await getLogEntries(page), 'Copy', NON_ZERO_REASON, message, all)
      await expect(page.locator('[data-testid="workflow-status"]')).toHaveAttribute(
        'data-status',
        'passed',
      )
    })
  })

  test('a push sources an artifact an earlier Block wrote, and the pod reads it back (KE-18)', async ({
    page,
  }) => {
    test.setTimeout(240_000)
    const legs = pushLegs(ctx)
    const fixture = buildExecFixture(
      legs,
      material({ name: 'K8s Copy Push E2E Test', bookend: PUSH_MARKER }),
    )
    const { logs, all, vars } = await runFixture(page, fixture, PUSH_MARKER)
    const content = pushContent(ctx)
    const target = podFile(ctx, PUSH_FILE)

    await test.step('every leg reported its ids and its Block went green', async () => {
      expectMarkers(logs, legs)
      await expectLegStatuses(page, legs)
    })

    await test.step('KE-18: Summary names the artifact, the pod path and the size', () => {
      const rows = copyRows(vars, 'push')
      expect(rows.length, `one file is one row.\n${all}`).toBe(1)
      expect(
        rows[0].source.endsWith(`/${artifactPath(ctx, PUSH_FILE)}`),
        `the SOURCE cell must be the resolved artifact: ${rows[0].source}`,
      ).toBeTruthy()
      expect(rows[0].target, 'the TARGET cell is the pod path').toBe(target)
      expect(rows[0].size, 'the SIZE cell is the file size').toBe(Buffer.byteLength(content))
      expectSuccess(vars, 'push')
      expectLine(logs, copiedLine(rows[0].source, target))
    })

    await test.step('KE-18: the pod holds the bytes the artifact held', () => {
      expectStreams(vars, 'readback', { stdout: content, stderr: '', exitCode: 0 })
    })
  })

  test('a pull over Max size (MiB) or Max files is refused and puts back what it replaced (KE-19, KE-20)', async ({
    page,
    request,
  }) => {
    test.setTimeout(240_000)
    const legs = limitLegs(ctx)
    const leg = (key: string) => legs.find((item) => item.key === key)!
    const fixture = buildExecFixture(
      legs,
      material({ name: 'K8s Copy Limits E2E Test', bookend: LIMIT_MARKER }),
    )
    const testId = await importFixture(page, fixture)
    const sizeNode = nodeId(leg('sizepull'))
    const filesNode = nodeId(leg('filespull'))

    await test.step('the two sheets save the limit rows typed into them', async () => {
      await typeLimit(page, sizeNode, 'max_size_mib', FIXTURE_MAX_SIZE_MIB, TYPED_MAX_SIZE_MIB)
      await typeLimit(page, filesNode, 'max_files', FIXTURE_MAX_FILES, TYPED_MAX_FILES)
      await saveWorkbench(page)
      const values = await persistedValues(request, testId)
      expect(values[sizeNode].max_size_mib, 'the size pull saved Max size (MiB)').toBe(TYPED_MAX_SIZE_MIB)
      expect(values[sizeNode].max_files, 'the size pull kept its Max files').toBe(FIXTURE_MAX_FILES)
      expect(values[filesNode].max_files, 'the files pull saved Max files').toBe(TYPED_MAX_FILES)
      expect(values[filesNode].max_size_mib, 'the files pull kept its Max size (MiB)').toBe(
        FIXTURE_MAX_SIZE_MIB,
      )
      const validation = await validateTest(request, testId, 'run')
      expect(validation.errors, 'the saved Test validates for a run').toEqual([])
    })

    const { logs, all, vars } = await runOpened(page, LIMIT_MARKER)
    const artifacts = await listArtifacts(page)
    const entries = await getLogEntries(page)
    const locus = where(EXEC_POD, CONTAINER_APP, run.namespace)
    const sizeRoot = `${LIMIT_SIZE_ARTIFACT}/`

    await test.step('every leg reported its ids and carried the status its case declares', async () => {
      expectMarkers(logs, legs)
      await expectLegStatuses(page, legs)
      await expect(page.locator('[data-testid="workflow-status"]')).toHaveAttribute(
        'data-status',
        'passed',
      )
    })

    await test.step('KE-19: an earlier pull landed known bytes where the size pull lands', () => {
      expectSuccess(vars, 'prior')
      expect(
        copyRows(vars, 'prior').map((row) => row.size).sort(),
        `the earlier pull wrote both files.\n${all}`,
      ).toEqual(BIG_FILES.map((name) => Buffer.byteLength(priorContent(ctx, name))).sort())
    })

    await test.step('KE-19: the pull over Max size (MiB) is recorded with the Max size (MiB) refusal', () => {
      const message = expectRecordedCore(vars, 'sizepull', TOO_LARGE_REASON)
      expect(message).toBe(copyRefused('from', locus, overSizeDetail(TYPED_MAX_SIZE_MIB)))
      expectEmptyCopy(vars, 'sizepull')
      expectRecordedWarning(entries, 'Copy', TOO_LARGE_REASON, message, all)
    })

    await test.step('KE-19: the files the refused pull replaced read back as they were', async () => {
      expect(
        artifacts.filter((item) => item.path.startsWith(sizeRoot)),
        'nothing new is left under limit-size',
      ).toEqual(
        BIG_FILES.map((name) => ({
          path: `${sizeRoot}${name}`,
          size_bytes: Buffer.byteLength(priorContent(ctx, name)),
        })).map((expected) => expect.objectContaining(expected)),
      )
      for (const name of BIG_FILES) {
        expect(await readArtifact(page, `${sizeRoot}${name}`), `${name} byte for byte`).toBe(
          priorContent(ctx, name),
        )
      }
      expect(
        artifacts.filter((item) => KEEP_NAME.test(item.path)).map((item) => item.path),
        'no kept-aside file is left in the artifacts',
      ).toEqual([])
    })

    await test.step('KE-20: the pull over Max files is recorded with the Max files refusal', () => {
      const message = expectRecordedCore(vars, 'filespull', TOO_MANY_REASON)
      expect(message).toBe(copyRefused('from', locus, overFilesDetail(TYPED_MAX_FILES)))
      expectEmptyCopy(vars, 'filespull')
      expectRecordedWarning(entries, 'Copy', TOO_MANY_REASON, message, all)
      expect(
        artifacts.filter((item) => item.path.startsWith(`${LIMIT_FILES_ARTIFACT}/`)),
        'nothing is left under limit-files',
      ).toEqual([])
    })
  })
})
