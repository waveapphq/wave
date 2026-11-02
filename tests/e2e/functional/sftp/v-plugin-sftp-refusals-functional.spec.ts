/**
 * V-PLUGIN-SFTP-REFUSALS-FUNCTIONAL: what the SFTP block refuses, and how a refusal is recorded
 * Design Decisions: SFTP-1, SFTP-4, SFTP-6, SFTP-8
 * REQ: REQ-3.4.1.8
 *
 * The fixture carries the limit defaults (Max files 10000, Max size (MiB) 1024) on both limit
 * Downloads; the spec types Max files 2 and Max size (MiB) 1 into their sheets and saves, so
 * REF-1 and REF-2 refuse only with the saved rows. `{F}` is `e2e-sftp-refusals-<uuid>` in
 * wave's home; the workflow deletes it and a Stats proves it gone.
 *
 * Pass Criteria:
 * 1. REF-1: Download `{F}/three` to `artifact://three-copy/` with Max files 2 records the Max
 *    files refusal with count 3 and max 2, Reason `TooManyFiles`, a Summary with no rows; nothing
 *    under `three-copy`.
 * 2. REF-2: Download `{F}/big` to `artifact://big-copy/` with Max size (MiB) 1 records the Max
 *    size (MiB) refusal with total 2097152 and max 1, Reason `TooLarge`; nothing under `big-copy`.
 * 3. REF-3: Download `{F}/three/a.txt` to `testdata://sftp-three/a-copy.txt` records the
 *    read-only Test Data refusal, Reason `ReadOnly`; the Test's Test Data listing is identical
 *    before and after the run.
 * 4. REF-4: List after SSH Session Close on the same Session ID records the closed-session
 *    refusal, Reason `SessionClosed`, with WARN `List failed (SessionClosed): <that refusal>`.
 * 5. REF-5: List on a session to `SSH_TARGET_HOST`:`SSH_NO_SFTP_PORT` (Host key disabled)
 *    records the SFTP-unavailable refusal naming that host, Reason `SftpUnavailable`.
 * 6. REF-6: Download `{F}/nope.txt` under Fail the block inside a Try/Catch ends red, the caught
 *    error is the source-not-found refusal, and the run still passes.
 * 7. REF-7: every recorded failure above ends amber with Success false, Error = the message,
 *    Reason = the code and exactly one WARN failure line.
 * 8. REF-8: Browse on a Download Destination opens the save-as picker with no Test Data tab.
 */

import { test, expect, type Locator, type Page } from '../../helpers/playwright-fixtures'
import { SSH_TARGET_HOST } from '../../helpers/config'
import { numberInput } from '../../helpers/config-sheet'
import { waitForViewportSettled } from '../../helpers/canvas'
import { expectNodeStatus } from '../../helpers/k8s-run'
import { expectConsoleLine, formatEntries } from '../../helpers/log-reader'
import { listTestDataPaths } from '../../helpers/testdata'
import { listArtifacts } from '../k8s-exec/cases-exec'
import {
  deleteTest,
  expandGroup,
  expectRowValue,
  openConfig,
  openPicker,
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
  summaryRows,
  type RecordedFailure,
} from './sftp-cases'

const FIXTURE_FILE = 'fixture-refusals.json'

const NODE = {
  open: 'c4d136a3-d2f5-47a7-b054-bb0daf5b363c',
  upload: '10b12345-fee4-49c9-bfe0-403ab63c4b0c',
  makeBig: '0c785945-f189-47dd-b657-d1a47ab02a87',
  maxFiles: 'c97745b9-4a0f-4ec9-9659-215be8d151ca',
  maxSize: 'dc5cfcbb-508e-4424-8c01-4f6e0509e0ae',
  readOnly: '86e00e41-e138-4ecf-84bd-99a201ccfb0b',
  guard: 'd8bbb360-e43e-4c94-af71-7e690224303c',
  missing: 'd483ffe6-6c24-4c39-9ee1-bdc83f003e5e',
  caught: 'c6951811-eb23-45b9-ab41-4a609dfa550f',
  openNoSftp: '784b84b2-d114-44c5-aaac-4a669a784f8d',
  listNoSftp: '4fab865e-2e23-4cfb-b653-47d567e305a3',
  closeNoSftp: '3eb355bc-f8a1-476b-b6a9-aa568c66d6ae',
  deleteFolder: '88bb2978-6555-472c-b551-1e9dd636c698',
  statsFolder: '75805d59-87b0-41a1-9177-4c0a9c662a73',
  close: '2f948b51-72e0-4f5c-9fbf-ca72310086b5',
  listClosed: 'a2a00696-182a-4668-822a-d6f637a8d2b3',
  done: '9dcd9937-7709-4c93-841f-f81e66ea97e7',
} as const

const FIXTURE_MAX_FILES = 10000
const FIXTURE_MAX_SIZE_MIB = 1024
const TYPED_MAX_FILES = 2
const TYPED_MAX_SIZE_MIB = 1
const BIG_BYTES = 2_097_152

const run = newSftpRun('sftp-refusals')
const F = run.folder
const BOOKEND = `sftp-refusals-done-${run.uuid}`
const THREE = ['a.txt', 'b.txt', 'c.txt'].map((name) => ({
  folder: 'sftp-three',
  name,
  body: Buffer.from(`sftp-ref-${name}-${run.uuid}\n`),
}))
const READ_ONLY_MESSAGE = 'testdata:// paths are read-only. Cannot write, move, or delete testdata files.'

const createdTests: string[] = []

/** Type one Advanced limit row of an open sheet over the fixture's value, then save. */
async function typeLimit(
  sheet: Locator,
  row: 'max_files' | 'max_size_mib',
  from: number,
  to: number,
): Promise<void> {
  await expandGroup(sheet, 'Advanced')
  const input = numberInput(sheet, row)
  await expect(input, `${row} shows what the fixture carries`).toHaveValue(String(from))
  await input.fill(String(to))
  await expect(input).toHaveValue(String(to))
  await saveConfig(sheet)
}

async function openSheet(page: Page, nodeId: string): Promise<Locator> {
  await waitForViewportSettled(page)
  return openConfig(page, nodeId)
}

test.describe('V-PLUGIN-SFTP-REFUSALS-FUNCTIONAL: SFTP refusals and recorded failures', () => {
  test.afterAll(async ({ request }) => {
    await runCleanup(request, { account: 'wave', paths: [F] })
    for (const testId of createdTests.splice(0)) await deleteTest(request, testId)
  })

  test('REF-1..REF-8: limits, read-only Test Data, a closed session, no SFTP subsystem, a caught failure', async ({
    page,
    request,
  }) => {
    test.setTimeout(240_000)

    const testId = await test.step('import the fixture with sftp-three in its Test Data', async () => {
      const id = await importSftpTest(page, loadSftpFixture(__dirname, FIXTURE_FILE, run), { files: THREE })
      createdTests.push(id)
      return id
    })

    await test.step('REF-8: Browse on a Download Destination offers the Artifacts only', async () => {
      const sheet = await openSheet(page, NODE.maxFiles)
      const picker = await openPicker(page, sheet, 'destination', 'save-as')
      await expect(picker.testDataTab, 'no Test Data tab').toHaveCount(0)
      await expect(picker.scheme, 'the Reference line is under the artifact scheme').toHaveText('artifact://')
      await picker.cancel.click()
      await expect(picker.sheet).toBeHidden({ timeout: 10_000 })
      await expectRowValue(sheet, 'destination', 'artifact://three-copy/')
      await typeLimit(sheet, 'max_files', FIXTURE_MAX_FILES, TYPED_MAX_FILES)
    })

    await test.step('Max size (MiB) 1 is typed into the other sheet and both are saved', async () => {
      await typeLimit(await openSheet(page, NODE.maxSize), 'max_size_mib', FIXTURE_MAX_SIZE_MIB, TYPED_MAX_SIZE_MIB)
      await saveWorkbench(page)
      const values = await persistedValues(request, testId)
      expect(values[NODE.maxFiles].max_files, 'the saved Max files').toBe(TYPED_MAX_FILES)
      expect(values[NODE.maxFiles].max_size_mib, 'Max size (MiB) kept').toBe(FIXTURE_MAX_SIZE_MIB)
      expect(values[NODE.maxFiles].destination, 'the canceled picker changed nothing').toBe(
        'artifact://three-copy/',
      )
      expect(values[NODE.maxSize].max_size_mib, 'the saved Max size (MiB)').toBe(TYPED_MAX_SIZE_MIB)
      expect(values[NODE.maxSize].max_files, 'Max files kept').toBe(FIXTURE_MAX_FILES)
    })

    const testDataBefore = await listTestDataPaths(request, testId)
    const { vars, entries } = await runSftpTest(page, testId, BOOKEND)
    const consoleText = formatEntries(entries)
    const artifacts = (await listArtifacts(page)).map((item) => item.path)

    // REF-7: amber, Success false, Error and Reason bound, exactly one WARN failure line.
    const recorded = async (nodeId: string, failure: RecordedFailure): Promise<void> => {
      expectRecorded(vars, entries, failure)
      await expectNodeStatus(page, nodeId, 'warning')
    }

    await test.step('the setup legs ran: the upload and the two MiB file', () => {
      expect(out(vars, 'up_success'), 'the upload of sftp-three').toBe(true)
      expect(out(vars, 'big_exit'), `head -c exit code: ${String(out(vars, 'big_stderr'))}`).toBe(0)
    })

    await test.step('REF-1: Max files 2 refuses the three-file folder', async () => {
      await recorded(NODE.maxFiles, {
        key: 'files',
        name: 'Download three with Max files',
        operation: 'Download',
        reason: 'TooManyFiles',
        message: `Download of ${F}/three holds 3 files, more than the ${TYPED_MAX_FILES} Max files allows; download fewer files or raise Max files`,
      })
      expect(summaryRows(vars, 'files_summary'), 'Summary').toEqual([])
      expect(
        artifacts.filter((item) => item.startsWith('three-copy')),
        'nothing under three-copy',
      ).toEqual([])
    })

    await test.step('REF-2: Max size (MiB) 1 refuses the two MiB folder', async () => {
      await recorded(NODE.maxSize, {
        key: 'size',
        name: 'Download big with Max size',
        operation: 'Download',
        reason: 'TooLarge',
        message: `Download of ${F}/big is ${BIG_BYTES} bytes, larger than the ${TYPED_MAX_SIZE_MIB} MiB Max size (MiB) allows; download a narrower path or raise Max size (MiB)`,
      })
      expect(summaryRows(vars, 'size_summary'), 'Summary').toEqual([])
      expect(
        artifacts.filter((item) => item.startsWith('big-copy')),
        'nothing under big-copy',
      ).toEqual([])
    })

    await test.step('REF-3: a testdata:// Destination is refused and Test Data is unchanged', async () => {
      await recorded(NODE.readOnly, {
        key: 'ro',
        name: 'Download into Test Data',
        operation: 'Download',
        reason: 'ReadOnly',
        message: READ_ONLY_MESSAGE,
      })
      expect(await listTestDataPaths(request, testId), 'the Test Data listing').toEqual(testDataBefore)
    })

    await test.step('REF-6: a missing source under Fail the block is caught by the Try/Catch', async () => {
      await expectNodeStatus(page, NODE.missing, 'failed')
      const message = `Source not found on the SFTP server: ${F}/nope.txt`
      expect(out(vars, 'miss_caught'), 'the Try/Catch caught the failure').toBe(true)
      const caught = out(vars, 'miss_error') as Record<string, unknown>
      expect(caught?.message, 'the caught error').toBe(message)
      expect(caught?.node_id, 'the caught error points at the Download').toBe(NODE.missing)
      expectConsoleLine(entries, 'WARN', 'sftp-refusals-caught')
    })

    await test.step('REF-5: a server with no SFTP subsystem is refused and recorded', async () => {
      const session = out(vars, 'nosftp_session') as string
      expect(session, 'the no-SFTP session opened').not.toBe('')
      await recorded(NODE.listNoSftp, {
        key: 'nosftp',
        name: 'List without SFTP',
        operation: 'List',
        reason: 'SftpUnavailable',
        message: `SFTP is not available on ${SSH_TARGET_HOST} through SSH session '${session}': Session request failed`,
      })
    })

    await test.step('the workflow removed its folder', () => {
      expect(sftpLines(entries, 'Delete the spec folder'), consoleText).toEqual([sftpLine.deleted(F)])
      expect(out(vars, 'gone_exists'), 'Stats of the spec folder after the delete').toBe(false)
    })

    await test.step('REF-4: List on a closed session is refused and recorded', async () => {
      const session = out(vars, 'ref_session') as string
      const message = `SSH session '${session}' not found or already closed`
      await recorded(NODE.listClosed, {
        key: 'closed',
        name: 'List on the closed session',
        operation: 'List',
        reason: 'SessionClosed',
        message,
      })
    })

    await test.step('every other Block ended success', async () => {
      const notGreen: string[] = [
        NODE.maxFiles,
        NODE.maxSize,
        NODE.readOnly,
        NODE.guard,
        NODE.missing,
        NODE.listNoSftp,
        NODE.listClosed,
      ]
      for (const id of Object.values(NODE).filter((id) => !notGreen.includes(id))) {
        await expectNodeStatus(page, id, 'success')
      }
    })
  })
})
