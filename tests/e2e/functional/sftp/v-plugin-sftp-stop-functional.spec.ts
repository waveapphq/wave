/**
 * V-PLUGIN-SFTP-STOP-FUNCTIONAL: a Timeout and the canvas Stop end a 4 GiB download at once
 * Wireframe: N/A
 * Design Decisions: SFTP-7, SFTP-8
 * REQ: REQ-3.4.1.8
 *
 * Each test makes its own `{F}` = `e2e-sftp-stop-<uuid>` in wave's home holding the sparse
 * 4 GiB file `big-<uuid>.bin` (no disk used on the server) and downloads it with Max size (MiB)
 * 0. The fixture carries Timeout 300; test 1 types 1 into the Download's sheet and saves, so
 * STOP-1 times out only with the saved row. Test 1's workflow deletes `{F}` itself; the stopped
 * test 2 leaves it to the cleanup run, whose Stats proves the source untouched.
 *
 * Pass Criteria:
 * 1. STOP-1: test 1 (Record and continue) records `Download did not finish within 1 second`,
 *    Reason `Timeout`, a Summary with no rows, and no Download line.
 * 2. STOP-2: after test 1 no file named `big-<uuid>.bin` and no `.big-<uuid>.bin.<8 hex>.part`
 *    exists anywhere under `STORAGE_BASE_PATH`; the run passes.
 * 3. STOP-3: test 2 waits for a `.big-<uuid>.bin.<8 hex>.part` under `STORAGE_BASE_PATH`, then
 *    presses the canvas Stop, sees `Stop execution immediately?` and confirms `Stop Immediately`.
 * 4. STOP-4: the session ends stopped; within 5 seconds of the Stop neither `big-<uuid>.bin` nor
 *    any of its partial files remains under `STORAGE_BASE_PATH`.
 * 5. STOP-5: the cleanup run's Stats of `{F}/big-<uuid>.bin` before removal reports Size
 *    4294967296.
 */

import { test, expect } from '../../helpers/playwright-fixtures'
import { numberInput } from '../../helpers/config-sheet'
import { waitForViewportSettled } from '../../helpers/canvas'
import { expectNodeStatus } from '../../helpers/k8s-run'
import { formatEntries } from '../../helpers/log-reader'
import {
  deleteTest,
  expandGroup,
  openConfig,
  persistedValues,
  saveConfig,
  saveWorkbench,
} from '../file-picker/picker'
import {
  expectRecorded,
  importSftpTest,
  loadSftpFixture,
  newSftpRun,
  out,
  runCleanup,
  runSftpTest,
  sftpLine,
  sftpLines,
  startSftpRun,
  storageMatches,
  summaryRows,
  type SftpFixture,
  type SftpRun,
} from './sftp-cases'

const FIXTURE_FILE = 'fixture-stop.json'
const DOWNLOAD = 'Download the big file'
const FIXTURE_TIMEOUT = 300
// Page cache counts toward the 2g shard cap; 3 s lands about 1 GB here, 1 s about 300 MB.
const TYPED_TIMEOUT = 1
const BIG_BYTES = 4_294_967_296
const CLEAR_WINDOW_MS = 5_000

const runs: SftpRun[] = []
const createdTests: string[] = []

const bigName = (run: SftpRun): string => `big-${run.uuid}.bin`

function nodeIdOf(fixture: SftpFixture, name: string): string {
  const found = fixture.workflow.nodes.find((node) => node.data.label === name)
  expect(found, `${FIXTURE_FILE} holds a Block named "${name}"`).toBeTruthy()
  return found?.id as string
}

/** Every path left on WAVE for this run's file: the target and its partials. */
function leftOnWave(run: SftpRun): string[] {
  const { targets, partials } = storageMatches(bigName(run))
  return [...targets, ...partials]
}

test.describe('V-PLUGIN-SFTP-STOP-FUNCTIONAL: Timeout and Stop end a 4 GiB download', () => {
  test.describe.configure({ mode: 'serial' })

  test.afterAll(async ({ request }) => {
    if (runs.length > 0) {
      await runCleanup(request, { account: 'wave', paths: runs.map((run) => run.folder) })
    }
    for (const testId of createdTests.splice(0)) await deleteTest(request, testId)
  })

  test('STOP-1, STOP-2: a Timeout of 1 ends the download and leaves nothing on WAVE', async ({
    page,
    request,
  }) => {
    test.setTimeout(240_000)
    const run = newSftpRun('sftp-stop')
    runs.push(run)
    const fixture = loadSftpFixture(__dirname, FIXTURE_FILE, run)
    const downloadId = nodeIdOf(fixture, DOWNLOAD)
    const testId = await importSftpTest(page, fixture)
    createdTests.push(testId)

    await test.step('Timeout 1 is typed into the Download sheet and saved', async () => {
      await waitForViewportSettled(page)
      const sheet = await openConfig(page, downloadId)
      await expandGroup(sheet, 'Advanced')
      const input = numberInput(sheet, 'timeout')
      await expect(input, 'Timeout shows what the fixture carries').toHaveValue(String(FIXTURE_TIMEOUT))
      await input.fill(String(TYPED_TIMEOUT))
      await expect(input).toHaveValue(String(TYPED_TIMEOUT))
      await saveConfig(sheet)
      await saveWorkbench(page)
      const values = await persistedValues(request, testId)
      expect(values[downloadId].timeout, 'the saved Timeout').toBe(TYPED_TIMEOUT)
      expect(values[downloadId].max_size_mib, 'Max size (MiB) 0 kept').toBe(0)
    })

    const { vars, entries } = await runSftpTest(page, testId, `sftp-stop-done-${run.uuid}`)
    const consoleText = formatEntries(entries)

    await test.step('the sparse file was made on the server', () => {
      expect(out(vars, 'make_exit'), `python3 exit code: ${String(out(vars, 'make_stderr'))}`).toBe(0)
    })

    await test.step('STOP-1: the Timeout is recorded with no Summary row and no Download line', async () => {
      expectRecorded(vars, entries, {
        key: 'big',
        name: DOWNLOAD,
        operation: 'Download',
        reason: 'Timeout',
        message: `Download did not finish within ${TYPED_TIMEOUT} second`,
      })
      await expectNodeStatus(page, downloadId, 'warning')
      expect(summaryRows(vars, 'big_summary'), 'Summary').toEqual([])
      expect(
        sftpLines(entries, DOWNLOAD).filter((line) => line.startsWith('Downloaded ')),
        consoleText,
      ).toEqual([])
    })

    await test.step('STOP-2: nothing of the download is left under the storage root', () => {
      expect(leftOnWave(run), `${bigName(run)} and its partial files`).toEqual([])
      expect(sftpLines(entries, 'Delete the stop folder'), consoleText).toEqual([sftpLine.deleted(run.folder)])
      expect(out(vars, 'gone_exists'), 'Stats of the folder after the delete').toBe(false)
    })
  })

  test('STOP-3..STOP-5: the canvas Stop ends the download, nothing is left, the source is untouched', async ({
    page,
    request,
  }) => {
    test.setTimeout(240_000)
    const run = newSftpRun('sftp-stop')
    runs.push(run)
    const testId = await importSftpTest(page, loadSftpFixture(__dirname, FIXTURE_FILE, run))
    createdTests.push(testId)

    const status = await startSftpRun(page, testId)

    const stoppedAt = await test.step('STOP-3: a partial file appears, then Stop is confirmed', async () => {
      await expect
        .poll(() => storageMatches(bigName(run)).partials.length, {
          timeout: 60_000,
          intervals: [100],
          message: `a .${bigName(run)}.<8 hex>.part file under the storage root`,
        })
        .toBeGreaterThan(0)
      await page.getByTestId('action-stop-button').click()
      const dialog = page.getByTestId('stop-confirmation-dialog')
      await expect(dialog).toBeVisible()
      await expect(dialog).toContainText('Stop execution immediately?')
      await dialog.getByRole('button', { name: 'Stop Immediately', exact: true }).click()
      return Date.now()
    })

    await test.step('STOP-4: nothing is left within 5 seconds and the session ends stopped', async () => {
      await expect
        .poll(() => leftOnWave(run), {
          timeout: CLEAR_WINDOW_MS,
          intervals: [100],
          message: `${bigName(run)} and its partial files gone within 5 s of the Stop`,
        })
        .toEqual([])
      expect(Date.now() - stoppedAt, 'cleared within 5 s of the Stop').toBeLessThanOrEqual(CLEAR_WINDOW_MS)
      await expect(status).toHaveAttribute('data-status', 'stopped', { timeout: 15_000 })
    })

    await test.step('STOP-5: the cleanup Stats finds the source untouched', async () => {
      const cleanup = await runCleanup(request, {
        account: 'wave',
        paths: [run.folder],
        probe: `${run.folder}/${bigName(run)}`,
      })
      expect(cleanup.probe, 'Stats of the source before removal').toEqual({
        exists: true,
        type: 'file',
        size: BIG_BYTES,
      })
    })
  })
})
