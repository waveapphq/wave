/**
 * V-PLUGIN-SFTP-DROPZONE-FUNCTIONAL: SFTP on the chrooted, SFTP-only dropzone account
 * Wireframe: N/A
 * Design Decisions: SFTP-1, SFTP-4, SFTP-5, SFTP-8, SFTP-9
 * REQ: REQ-3.4.1.8
 *
 * The fixture's SSH Session Open carries `wave` / `wave-secret`; the spec sets the dropzone
 * login through the block's sheet and saves, so the jail proofs below pass only with the saved
 * rows. The account is jailed in `/srv/sftp/dropzone` (seen as `/`) with writable `/inbound`
 * and `/outbound` and `ForceCommand internal-sftp`, so the cleanup run deletes over SFTP.
 *
 * Pass Criteria:
 * 1. DZ-1: the session as `dropzone` connects: right after Open it reports connected true and
 *    one hop.
 * 2. DZ-2: List `/` gives exactly `inbound` and `outbound`, type `folder`, paths `/inbound` and
 *    `/outbound`, Count 2, and logs `Listed 2 entries in /`.
 * 3. DZ-3: Create folder `/inbound/{F}` logs `Created folder /inbound/{F}`; Upload
 *    `testdata://orders.csv` to `/inbound/{F}/` logs the Upload line naming `/inbound/{F}/` and
 *    its Summary row lands at `/inbound/{F}/orders.csv`.
 * 4. DZ-4: Move to `/outbound/{F}/orders.csv` (missing parent created) logs the Move line.
 * 5. DZ-5: Download with Destination empty lands `artifact://orders.csv`, byte for byte the Test
 *    Data file; the Saved artifact line precedes the Download line `... to the run's files`.
 * 6. DZ-6: Create folder `/{F}` at the jail root under Record and continue ends amber with
 *    Success false, Error `Permission denied on the SFTP server: /{F}`, Reason
 *    `PermissionDenied` and exactly one WARN failure line.
 * 7. DZ-7: both folders are deleted (Delete line), a List of `/inbound` holds no `{F}` entry, the run
 *    passes.
 */

import { test, expect } from '../../helpers/playwright-fixtures'
import { SSH_DROPZONE_PASSWORD, SSH_DROPZONE_USER, SSH_STACK_USER } from '../../helpers/config'
import { getNode } from '../../helpers/element-types'
import { expectNodeStatus } from '../../helpers/k8s-run'
import { expectConsoleLine, formatEntries } from '../../helpers/log-reader'
import { deleteTest, openConfig, saveConfig, saveWorkbench } from '../file-picker/picker'
import {
  entryRows,
  expectArtifactText,
  expectRecorded,
  fillTextRow,
  importSftpTest,
  loadSftpFixture,
  newSftpRun,
  ordersCsv,
  out,
  replaceSecretRow,
  runCleanup,
  runSftpTest,
  sftpLine,
  sftpLines,
  summaryRows,
} from './sftp-cases'

const FIXTURE_FILE = 'fixture-dropzone.json'

const NODE = {
  open: 'be6bf618-bf52-4eec-9d76-246eaa82cdda',
  report: '84ac8b8f-4acc-4226-8bbe-033b96336856',
  listRoot: '5e686c15-7a5f-42d0-9aa4-2c3dad7be8f7',
  mkdirIn: '5744bfdf-9adf-4a4c-8039-4c439c6dbe10',
  upload: '88061fda-8d6c-4b7d-88b3-d832151d0eaa',
  move: '1ea540f0-7737-461c-bd08-e094232c067c',
  download: 'bb5e1f8f-0345-48f5-b451-aa8b428b0398',
  mkdirRoot: 'bc4c11af-8791-4f17-a52d-2d4979b525b5',
  deleteIn: '709beb0d-4b27-43b6-bf49-e0a8371df787',
  deleteOut: 'c7a924f1-26da-4201-bb5f-e8943806c0a0',
  listIn: '29306299-3e50-494f-b177-14dca76ac5a6',
  close: '3397abab-093d-4756-91d8-38db7c13f7f1',
  done: 'ca29d565-056c-4e92-b347-39ab5cc5619a',
} as const

const run = newSftpRun('sftp-dropzone')
const F = run.folder
const INBOUND = `/inbound/${F}`
const OUTBOUND = `/outbound/${F}`
const ORDERS = ordersCsv(`sftp-dz-${run.uuid}`)
const ORDERS_BYTES = Buffer.byteLength(ORDERS)
const BOOKEND = `sftp-dropzone-done-${run.uuid}`

const createdTests: string[] = []

test.describe('V-PLUGIN-SFTP-DROPZONE-FUNCTIONAL: SFTP on the chrooted dropzone account', () => {
  test.afterAll(async ({ request }) => {
    await runCleanup(request, { account: 'dropzone', paths: [INBOUND, OUTBOUND] })
    for (const testId of createdTests.splice(0)) await deleteTest(request, testId)
  })

  test('DZ-1..DZ-7: the jail root, a round trip through /inbound and /outbound, a refused root write', async ({
    page,
    request,
  }) => {
    const testId = await test.step('import the fixture with orders.csv in its Test Data', async () => {
      const fixture = loadSftpFixture(__dirname, FIXTURE_FILE, run)
      const id = await importSftpTest(page, fixture, {
        files: [{ folder: '', name: 'orders.csv', body: Buffer.from(ORDERS) }],
      })
      createdTests.push(id)
      return id
    })

    await test.step('the dropzone login is typed into the Session Open sheet and saved', async () => {
      const stored = (await getNode(request, testId, NODE.open)).data.config.values
      expect(stored.username, 'the fixture logs in as wave').toBe(SSH_STACK_USER)
      const sealedBefore = stored.password

      const sheet = await openConfig(page, NODE.open)
      await fillTextRow(page, sheet, 'username', SSH_DROPZONE_USER)
      await replaceSecretRow(page, sheet, 'password', SSH_DROPZONE_PASSWORD)
      await saveConfig(sheet)
      await saveWorkbench(page)

      const saved = (await getNode(request, testId, NODE.open)).data.config.values
      expect(saved.username, 'the saved Username').toBe(SSH_DROPZONE_USER)
      expect(saved.password, 'the saved Password is a new sealed value').not.toBe(sealedBefore)
      expect(saved.password, 'the Password is never stored in clear').not.toBe(SSH_DROPZONE_PASSWORD)
    })

    const { vars, entries } = await runSftpTest(page, testId, BOOKEND)
    const consoleText = formatEntries(entries)

    await test.step('DZ-1: the session as dropzone connects', () => {
      // Close flips Connected to false, so the Log right after Open carries the proof.
      expectConsoleLine(entries, 'INFO', 'dz-session connected=True hops=1')
    })

    await test.step('DZ-2: the jail root holds only inbound and outbound', () => {
      const rows = entryRows(vars, 'root_entries').map(({ name, path, type }) => [name, path, type])
      expect(rows).toEqual([
        ['inbound', '/inbound', 'folder'],
        ['outbound', '/outbound', 'folder'],
      ])
      expect(out(vars, 'root_count'), 'Count').toBe(2)
      expect(sftpLines(entries, 'List the jail root'), consoleText).toEqual([sftpLine.listed(2, '/')])
    })

    await test.step('DZ-3: Create folder under /inbound, then Upload into it', () => {
      expect(sftpLines(entries, 'Create the inbound folder'), consoleText).toEqual([
        sftpLine.createdFolder(INBOUND),
      ])
      expect(sftpLines(entries, 'Upload the orders'), consoleText).toEqual([
        sftpLine.uploaded(1, ORDERS_BYTES, 'testdata://orders.csv', `${INBOUND}/`),
      ])
      const [row, ...rest] = summaryRows(vars, 'up_summary')
      expect(rest, 'one Summary row').toEqual([])
      expect(row.source, 'an absolute WAVE path to orders.csv').toMatch(/^\/.*\/orders\.csv$/)
      expect(row.destination).toBe(`${INBOUND}/orders.csv`)
      expect(row.size).toBe(ORDERS_BYTES)
    })

    await test.step('DZ-4: Move to /outbound creates the missing parent', () => {
      expect(sftpLines(entries, 'Move the orders to outbound'), consoleText).toEqual([
        sftpLine.moved(`${INBOUND}/orders.csv`, `${OUTBOUND}/orders.csv`),
      ])
      expect(out(vars, 'move_success')).toBe(true)
    })

    await test.step('DZ-5: Download with no Destination lands the file in the run artifacts', async () => {
      const [row, ...rest] = summaryRows(vars, 'down_summary')
      expect(rest, 'one Summary row').toEqual([])
      expect(row.source).toBe(`${OUTBOUND}/orders.csv`)
      expect(row.destination, 'an absolute WAVE path to orders.csv').toMatch(/^\/.*\/orders\.csv$/)
      expect(row.size).toBe(ORDERS_BYTES)
      expect(sftpLines(entries, 'Download the orders'), consoleText).toEqual([
        sftpLine.saved('orders.csv', row.destination, ORDERS_BYTES),
        sftpLine.downloaded(1, ORDERS_BYTES, `${OUTBOUND}/orders.csv`, "the run's files"),
      ])
      await expectArtifactText(page, 'orders.csv', ORDERS)
    })

    await test.step('DZ-6: Create folder at the jail root is refused and recorded', async () => {
      expectRecorded(vars, entries, {
        key: 'root_mkdir',
        name: 'Create a folder at the jail root',
        operation: 'Create folder',
        reason: 'PermissionDenied',
        message: `Permission denied on the SFTP server: /${F}`,
      })
      await expectNodeStatus(page, NODE.mkdirRoot, 'warning')
    })

    await test.step('DZ-7: both folders are deleted and /inbound no longer lists the spec folder', async () => {
      expect(sftpLines(entries, 'Delete the inbound folder'), consoleText).toEqual([sftpLine.deleted(INBOUND)])
      expect(sftpLines(entries, 'Delete the outbound folder'), consoleText).toEqual([
        sftpLine.deleted(OUTBOUND),
      ])
      const names = entryRows(vars, 'inbound_entries').map((entry) => entry.name)
      expect(names, 'the spec folder is gone from /inbound').not.toContain(F)
      for (const id of Object.values(NODE).filter((id) => id !== NODE.mkdirRoot)) {
        await expectNodeStatus(page, id, 'success')
      }
    })
  })
})
