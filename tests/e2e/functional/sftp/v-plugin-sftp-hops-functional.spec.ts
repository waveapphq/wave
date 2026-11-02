/**
 * V-PLUGIN-SFTP-HOPS-FUNCTIONAL: SFTP on the last session of a three-hop chain
 * Wireframe: N/A
 * Design Decisions: SFTP-1, SFTP-5, SFTP-9
 * REQ: REQ-3.4.1.8, REQ-3.4.1.3
 *
 * B opens on `sshd` (Strict, seeded), C rides B to `sshd-no-sftp:22` (no SFTP subsystem) and
 * D rides C to `sshd:22`. The fixture carries D's Host as `sshd-no-sftp`, so D's SFTP would fail;
 * the spec sets it to `sshd` through D's sheet and saves. `{F}` = `e2e-sftp-hops-<uuid>`.
 *
 * Pass Criteria:
 * 1. HOP-1: right after D opens, B, C and D report connected true and hop_count 1, 2 and 3.
 * 2. HOP-2: Upload `testdata://orders.csv` on D to `{F}/d/orders.csv` logs the Upload line;
 *    Download on D to `artifact://d-copy.csv` logs the Saved artifact line then the Download line
 *    and the artifact equals the Test Data file.
 * 3. HOP-3: List on C under Record and continue gives Success false, Reason `SftpUnavailable`,
 *    Error `SFTP is not available on sshd-no-sftp through SSH session '<C>': Session request
 *    failed`, one WARN failure line, Count 0 and no entries; D's transfers ran on D's own channel.
 * 4. HOP-4: Download on D to `artifact://hop/orders.csv`, then Upload that artifact on B to
 *    `{F}/b/`: Summary `[<absolute WAVE path ending /hop/orders.csv>, {F}/b/orders.csv, <size>]`,
 *    the Upload line names `{F}/b/`, and a Stats on B gives Exists true, type file and the same
 *    Size.
 * 5. HOP-5: the Finally path on B deletes `{F}` (Delete line), a Stats proves it gone, closing B closes
 *    D, C and B child first; the run passes.
 */

import { test, expect } from '../../helpers/playwright-fixtures'
import { SSH_MAIN_SERVICE, SSH_NO_SFTP_SERVICE } from '../../helpers/config'
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
  runCleanup,
  runSftpTest,
  sftpLine,
  sftpLines,
  summaryRows,
} from './sftp-cases'

const FIXTURE_FILE = 'fixture-hops.json'

const NODE = {
  legs: '30ec2440-22b9-4085-9de4-ea16af2d18d4',
  openB: '3dc922dd-037d-4b45-85bc-434e82e0ca57',
  openC: 'b313a298-b040-41b2-9bdd-d823d910fbb9',
  openD: '79f847a5-6956-4c09-bf14-7054980d3e62',
  logChain: '004edc68-0519-4f1d-a01d-fa5eb2cf136a',
  upD: '960f340c-cbe4-45a8-b4c7-bf4c314b8041',
  copyD: '5ee5a483-e430-4d96-af2e-fb8cb26e28db',
  listC: 'b74d3e54-9ee1-44d9-ab4b-1c384f886035',
  hopD: 'dc6fcba6-0d62-4f0a-8908-46b1e71c35b1',
  upB: 'b9ed1bbc-2dd4-4dbc-b603-ae5accc42510',
  statsB: 'd7173ca8-26dc-4f28-831a-f6c78caa5f81',
  deleteF: 'b77d52be-0ad5-4d46-bf19-68e791f40a44',
  goneF: '938f1080-b140-4a41-9432-4f701226b257',
  closeB: '9ccd0f1d-d76b-4806-85cc-61db1bd0983d',
  logCleanup: '59379a75-8a41-452f-bf8c-c6fa8fee1021',
  done: '20b740a2-2a8e-4dbf-a8fe-035f1d5a615c',
} as const

const run = newSftpRun('sftp-hops')
const F = run.folder
const ORDERS = ordersCsv(`sftp-hops-${run.uuid}`)
const ORDERS_BYTES = Buffer.byteLength(ORDERS)
const BOOKEND = `sftp-hops-done-${run.uuid}`

const createdTests: string[] = []

test.describe('V-PLUGIN-SFTP-HOPS-FUNCTIONAL: SFTP on the last session of a three-hop chain', () => {
  test.afterAll(async ({ request }) => {
    await runCleanup(request, { account: 'wave', paths: [F] })
    for (const testId of createdTests.splice(0)) await deleteTest(request, testId)
  })

  test('HOP-1..HOP-5: D transfers on its own channel past a middle hop with no SFTP', async ({
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

    await test.step("D's Host is set to sshd through its sheet and saved", async () => {
      const stored = (await getNode(request, testId, NODE.openD)).data.config.values
      expect(stored.host, 'the fixture points D at the host with no SFTP').toBe(SSH_NO_SFTP_SERVICE)

      const sheet = await openConfig(page, NODE.openD)
      await fillTextRow(page, sheet, 'host', SSH_MAIN_SERVICE)
      await saveConfig(sheet)
      await saveWorkbench(page)

      const saved = (await getNode(request, testId, NODE.openD)).data.config.values
      expect(saved.host, "D's saved Host").toBe(SSH_MAIN_SERVICE)
      expect(saved.use_parent, 'D still rides C').toBe(true)
      expect(saved.parent_session_id, "D's Parent Session").toBe('c_sid')
    })

    const { vars, entries } = await runSftpTest(page, testId, BOOKEND)
    const consoleText = formatEntries(entries)
    const cSession = out(vars, 'c_sid') as string

    await test.step('HOP-1: B, C and D are connected with hop counts 1, 2 and 3', () => {
      // Close flips Connected to false, so the Log right after D opens carries the proof.
      expectConsoleLine(entries, 'INFO', 'sftp-hops chain b=True/1 c=True/2 d=True/3')
      expect(cSession, 'C bound a session id').toMatch(/^ssh_session_[0-9a-f]{12}$/)
    })

    await test.step('HOP-2: Upload on D, then Download on D gives back the Test Data bytes', async () => {
      expect(sftpLines(entries, 'Upload the orders on D'), consoleText).toEqual([
        sftpLine.uploaded(1, ORDERS_BYTES, 'testdata://orders.csv', `${F}/d/orders.csv`),
      ])
      const [up, ...moreUp] = summaryRows(vars, 'd_up_summary')
      expect(moreUp, 'one Upload row').toEqual([])
      expect(up.source, 'an absolute WAVE path to orders.csv').toMatch(/^\/.*\/orders\.csv$/)
      expect(up.destination).toBe(`${F}/d/orders.csv`)
      expect(up.size).toBe(ORDERS_BYTES)

      const [copy, ...moreCopy] = summaryRows(vars, 'd_copy_summary')
      expect(moreCopy, 'one Download row').toEqual([])
      expect(copy.source).toBe(`${F}/d/orders.csv`)
      expect(copy.destination, 'an absolute WAVE path to d-copy.csv').toMatch(/^\/.*\/d-copy\.csv$/)
      expect(copy.size).toBe(ORDERS_BYTES)
      expect(sftpLines(entries, 'Download the copy on D'), consoleText).toEqual([
        sftpLine.saved('d-copy.csv', copy.destination, ORDERS_BYTES),
        sftpLine.downloaded(1, ORDERS_BYTES, `${F}/d/orders.csv`, 'artifact://d-copy.csv'),
      ])
      await expectArtifactText(page, 'd-copy.csv', ORDERS)
    })

    await test.step('HOP-3: SFTP on the middle hop C is refused as unavailable', async () => {
      expectRecorded(vars, entries, {
        key: 'c_list',
        name: 'List on the middle hop',
        operation: 'List',
        reason: 'SftpUnavailable',
        message: `SFTP is not available on ${SSH_NO_SFTP_SERVICE} through SSH session '${cSession}': Session request failed`,
      })
      expect(out(vars, 'c_list_count'), 'Count under a recorded failure').toBe(0)
      expect(entryRows(vars, 'c_list_entries'), 'no entries').toEqual([])
      expect(sftpLines(entries, 'List on the middle hop'), 'no INFO line from the refused List').toEqual([])
      await expectNodeStatus(page, NODE.listC, 'warning')
    })

    await test.step('HOP-4: a file goes from D to B through WAVE', async () => {
      const [down, ...moreDown] = summaryRows(vars, 'hop_down_summary')
      expect(moreDown, 'one Download row').toEqual([])
      expect(down.source).toBe(`${F}/d/orders.csv`)
      expect(down.destination, 'an absolute WAVE path ending /hop/orders.csv').toMatch(/^\/.*\/hop\/orders\.csv$/)
      expect(down.size).toBe(ORDERS_BYTES)
      expect(sftpLines(entries, 'Download for the hop on D'), consoleText).toEqual([
        sftpLine.saved('hop/orders.csv', down.destination, ORDERS_BYTES),
        sftpLine.downloaded(1, ORDERS_BYTES, `${F}/d/orders.csv`, 'artifact://hop/orders.csv'),
      ])
      await expectArtifactText(page, 'hop/orders.csv', ORDERS)

      expect(summaryRows(vars, 'b_up_summary'), 'the Upload on B Summary').toEqual([
        { source: down.destination, destination: `${F}/b/orders.csv`, size: ORDERS_BYTES },
      ])
      expect(sftpLines(entries, 'Upload the hop copy on B'), consoleText).toEqual([
        sftpLine.uploaded(1, ORDERS_BYTES, 'artifact://hop/orders.csv', `${F}/b/`),
      ])

      expect(out(vars, 'b_stats_exists'), 'Exists on B').toBe(true)
      expect(out(vars, 'b_stats_type'), 'Type on B').toBe('file')
      expect(out(vars, 'b_stats_size'), 'Size on B').toBe(ORDERS_BYTES)
      expect(sftpLines(entries, 'Stats of the hop copy on B'), consoleText).toEqual([
        sftpLine.stats(`${F}/b/orders.csv`),
      ])
    })

    await test.step('HOP-5: the Finally path on B removes the folder and closes the chain', async () => {
      expect(sftpLines(entries, 'Delete the spec folder on B'), consoleText).toEqual([sftpLine.deleted(F)])
      expect(out(vars, 'gone_delete_success')).toBe(true)
      expect(sftpLines(entries, 'Stats of the spec folder on B'), consoleText).toEqual([sftpLine.stats(F)])
      expect(out(vars, 'gone_exists'), 'the spec folder is gone').toBe(false)
      expect(out(vars, 'gone_type'), 'no type for a missing path').toBe('')
      expect(out(vars, 'hops_closed'), 'closing B closes D, C and B, child first').toEqual([
        out(vars, 'd_sid'),
        cSession,
        out(vars, 'b_sid'),
      ])
      expectConsoleLine(entries, 'INFO', 'sftp-hops cleanup exists=False closed=3')
      expect(out(vars, 'run_caught'), 'nothing failed on the Try path').toBe(false)
      for (const id of Object.values(NODE).filter((id) => id !== NODE.listC)) {
        await expectNodeStatus(page, id, 'success')
      }
    })
  })
})
