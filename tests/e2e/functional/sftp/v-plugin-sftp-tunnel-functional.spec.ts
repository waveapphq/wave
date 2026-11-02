/**
 * V-PLUGIN-SFTP-TUNNEL-FUNCTIONAL: SFTP on a session opened through an SSH tunnel
 * Wireframe: N/A
 * Design Decisions: SSH-8, SFTP-1, SFTP-9
 * REQ: REQ-3.4.1.8, REQ-5.1.5
 *
 * B opens on `sshd` (Strict, trusted). T1 forwards an auto-assigned Local Port on B to `sshd:22`
 * and S2 opens on `localhost:<t1_port>`; T2 forwards to `sshd-no-fwd:22`, which is not in WAVE's
 * trusted hosts list, and S3 opens on `localhost:<t2_port>` inside a Try/Catch. The fixture carries S2's and
 * S3's Host key verification as `disabled`; the spec sets both to `strict` through their sheets
 * and saves. `{F}` = `e2e-sftp-tunnel-<uuid>`.
 *
 * Pass Criteria:
 * 1. TUN-1: T1's Local Port is above 0; S2 connects under Strict (connected true, one hop) and its
 *    console carries the tunnel host-key line `SSH tunnel detected on local port <t1_port>: the
 *    host key is checked and recorded for sshd:22`.
 * 2. TUN-2: SFTP on S2 uploads `testdata://orders.csv` to `{F}/orders.csv` (Upload line) and
 *    downloads it back to `artifact://tunnel-copy.csv` (Saved artifact line, Download line); the
 *    artifact equals the Test Data file.
 * 3. TUN-3: S3 never connects: the Try/Catch catches the tunnel host-key refusal `SSH host key
 *    verification failed for sshd-no-fwd:22 through the SSH tunnel on localhost:<t2_port>: the
 *    host is not in WAVE's trusted hosts list and the host key policy is 'strict'. Add it in
 *    Settings > Network > SSH Hosts`, S3 ends failed with no Connected line.
 * 4. TUN-4: the Finally path deletes `{F}` on B (Delete line), a Stats proves it gone, and closes S2, T1,
 *    T2 and B; the run passes.
 */

import { test, expect, type Page } from '../../helpers/playwright-fixtures'
import { SSH_MAIN_SERVICE, SSH_NO_FWD_SERVICE, SSH_STACK_USER } from '../../helpers/config'
import { pickEnum } from '../../helpers/config-sheet'
import { getNode } from '../../helpers/element-types'
import { expectNodeStatus } from '../../helpers/k8s-run'
import { expectConsoleLine, formatEntries, type LogEntry } from '../../helpers/log-reader'
import { deleteTest, expandGroup, openConfig, saveConfig, saveWorkbench } from '../file-picker/picker'
import { blockSource } from '../shell-blocks/shell-helpers'
import {
  expectArtifactText,
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

const FIXTURE_FILE = 'fixture-tunnel.json'

const NODE = {
  legs: 'd2af5da5-8f95-48f0-8dfe-bd88a182ae04',
  openB: 'a45f5bfe-1de8-4ee8-99a4-caff322bbd9a',
  tunnelT1: '4464210c-f7ff-4125-90bb-ac7df681cf1d',
  tunnelT2: '674d9ebf-9324-421a-936d-5b8cfcca03b1',
  openS2: 'c093d058-b634-4115-98bf-1910fdd9d76f',
  logS2: 'c8c77959-1a01-4a94-8bf6-ac3217b54ea3',
  upS2: '343bfa66-af3b-4c03-b79e-75f58a1b8e33',
  downS2: '93e81320-548d-4d89-ad7e-7b3d3294f701',
  guardS3: 'daef9300-ecf0-4bc2-944f-45a2c2cc2ae9',
  openS3: '363928dd-c6f6-4842-a17d-a3a95ba6852e',
  logS3: 'df9520f9-4292-4956-9819-379d6e653a77',
  deleteF: 'fee1c3df-2f94-4820-805c-0d7fb2d2e9c1',
  goneF: 'c1d11219-47f7-40e6-a6bf-7a954c9ee0bc',
  closeS2: '08fead1c-ea80-434d-bbd5-05a4132ae73d',
  closeT1: '5f52d5f7-9772-4907-805b-98001a392616',
  closeT2: '18222c84-4923-4352-ba00-bf77abc17b18',
  closeB: '84a8b3cc-e0f3-4c92-b2ab-c239f64b91c0',
  logCloses: 'a4564a09-141e-4acc-b988-c557f774b891',
  done: '25d14302-ecfe-4e5d-8db4-1fd68036a035',
} as const

const LOOPBACK_HOST = 'localhost'
const FAR_PORT = 22
const S2_NAME = 'Open S2 through T1'
const S3_NAME = 'Open S3 through T2'

const run = newSftpRun('sftp-tunnel')
const F = run.folder
const ORDERS = ordersCsv(`sftp-tunnel-${run.uuid}`)
const ORDERS_BYTES = Buffer.byteLength(ORDERS)
const BOOKEND = `sftp-tunnel-done-${run.uuid}`

const createdTests: string[] = []

/** The tunnel host-key line: a session on a tunnel's Local Port is checked under the far host (SSH-8). */
const tunnelDetected = (port: number, farHost: string): string =>
  `SSH tunnel detected on local port ${port}: the host key is checked and recorded for ${farHost}:${FAR_PORT}`

/** The INFO lines the SSH Session Open block named `name` wrote, in console order. */
function sessionOpenLines(entries: readonly LogEntry[], name: string): string[] {
  const source = blockSource('SSH Session Open', name)
  return entries.filter((entry) => entry.source === source && entry.level === 'INFO').map((entry) => entry.message)
}

async function setStrict(page: Page, nodeId: string): Promise<void> {
  const sheet = await openConfig(page, nodeId)
  await expandGroup(sheet, 'Advanced')
  await pickEnum(page, sheet, 'host_key_verification', 'strict')
  await saveConfig(sheet)
}

test.describe('V-PLUGIN-SFTP-TUNNEL-FUNCTIONAL: SFTP on a session opened through an SSH tunnel', () => {
  test.afterAll(async ({ request }) => {
    await runCleanup(request, { account: 'wave', paths: [F] })
    for (const testId of createdTests.splice(0)) await deleteTest(request, testId)
  })

  test('TUN-1..TUN-4: Strict host keys under the far host, SFTP through the tunnel, the unrecorded far host refused', async ({
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

    await test.step("S2's and S3's Host key verification is set to strict through their sheets and saved", async () => {
      for (const id of [NODE.openS2, NODE.openS3]) {
        const stored = (await getNode(request, testId, id)).data.config.values
        expect(stored.host_key_verification, 'the fixture skips the host key check').toBe('disabled')
        expect(stored.host, 'the fixture dials the loopback name the import leaves alone').toBe(LOOPBACK_HOST)
      }
      await setStrict(page, NODE.openS2)
      await setStrict(page, NODE.openS3)
      await saveWorkbench(page)
      for (const id of [NODE.openS2, NODE.openS3]) {
        const saved = (await getNode(request, testId, id)).data.config.values
        expect(saved.host_key_verification, 'the saved Host key verification').toBe('strict')
        expect(saved.username, 'the login is untouched').toBe(SSH_STACK_USER)
      }
    })

    const { vars, entries } = await runSftpTest(page, testId, BOOKEND)
    const consoleText = formatEntries(entries)
    const t1Port = out(vars, 't1_port') as number
    const t2Port = out(vars, 't2_port') as number

    await test.step('TUN-1: S2 connects under Strict through T1, checked under sshd:22', () => {
      expect(t1Port, "T1's Local Port").toBeGreaterThan(0)
      expect(t2Port, "T2's Local Port").toBeGreaterThan(0)
      expect(t2Port, 'two tunnels, two ports').not.toBe(t1Port)
      // Close flips Connected to false, so the Log right after S2 opens carries the proof.
      expectConsoleLine(entries, 'INFO', 'sftp-tunnel s2 connected=True hops=1')
      const lines = sessionOpenLines(entries, S2_NAME)
      expect(lines[0], consoleText).toBe(tunnelDetected(t1Port, SSH_MAIN_SERVICE))
      expect(lines.filter((line) => line.startsWith('SSH tunnel detected')), 'one tunnel host-key line').toHaveLength(1)
    })

    await test.step('TUN-2: Upload and Download on S2 give back the Test Data bytes', async () => {
      expect(sftpLines(entries, 'Upload the orders on S2'), consoleText).toEqual([
        sftpLine.uploaded(1, ORDERS_BYTES, 'testdata://orders.csv', `${F}/orders.csv`),
      ])
      const [up, ...moreUp] = summaryRows(vars, 'up_summary')
      expect(moreUp, 'one Upload row').toEqual([])
      expect(up.source, 'an absolute WAVE path to orders.csv').toMatch(/^\/.*\/orders\.csv$/)
      expect(up.destination).toBe(`${F}/orders.csv`)
      expect(up.size).toBe(ORDERS_BYTES)

      const [down, ...moreDown] = summaryRows(vars, 'down_summary')
      expect(moreDown, 'one Download row').toEqual([])
      expect(down.source).toBe(`${F}/orders.csv`)
      expect(down.destination, 'an absolute WAVE path to tunnel-copy.csv').toMatch(/^\/.*\/tunnel-copy\.csv$/)
      expect(down.size).toBe(ORDERS_BYTES)
      expect(sftpLines(entries, 'Download the copy on S2'), consoleText).toEqual([
        sftpLine.saved('tunnel-copy.csv', down.destination, ORDERS_BYTES),
        sftpLine.downloaded(1, ORDERS_BYTES, `${F}/orders.csv`, 'artifact://tunnel-copy.csv'),
      ])
      await expectArtifactText(page, 'tunnel-copy.csv', ORDERS)
    })

    await test.step("TUN-3: S3 is refused for a far host not in WAVE's trusted hosts list", async () => {
      const refusal =
        `SSH host key verification failed for ${SSH_NO_FWD_SERVICE}:${FAR_PORT} through the SSH tunnel ` +
        `on ${LOOPBACK_HOST}:${t2Port}: the host is not in WAVE's trusted hosts list and the host key ` +
        "policy is 'strict'. Add it in Settings > Network > SSH Hosts"
      expect(out(vars, 's3_caught'), 'the Try/Catch caught the refusal').toBe(true)
      const error = out(vars, 's3_error') as Record<string, unknown>
      expect(error.message, 'the tunnel host-key refusal').toBe(refusal)
      expect(error.node_id, 'the error points at S3').toBe(NODE.openS3)
      expect(out(vars, 's3_conn'), 'S3 never connected').toBe(false)
      expect(out(vars, 's3_sid'), 'S3 bound no session').toBe('')
      expectConsoleLine(entries, 'WARN', `Try-path error caught: ${refusal}`)
      expectConsoleLine(entries, 'WARN', 'sftp-tunnel s3 caught=True connected=False')
      const lines = sessionOpenLines(entries, S3_NAME)
      expect(lines[0], consoleText).toBe(tunnelDetected(t2Port, SSH_NO_FWD_SERVICE))
      expect(lines.filter((line) => line.startsWith('Connected to')), 'no Connected line from S3').toEqual([])
      await expectNodeStatus(page, NODE.openS3, 'failed')
      await expectNodeStatus(page, NODE.logS3, 'success')
    })

    await test.step('TUN-4: the Finally path removes the folder and closes T1, T2, S2 and B', async () => {
      expect(sftpLines(entries, 'Delete the spec folder on B'), consoleText).toEqual([sftpLine.deleted(F)])
      expect(out(vars, 'gone_delete_success')).toBe(true)
      expect(sftpLines(entries, 'Stats of the spec folder on B'), consoleText).toEqual([sftpLine.stats(F)])
      expect(out(vars, 'gone_exists'), 'the spec folder is gone').toBe(false)
      expect(out(vars, 'gone_type'), 'no type for a missing path').toBe('')
      expect(out(vars, 's2_closed'), 'Close S2').toEqual([out(vars, 's2_sid')])
      expect(out(vars, 't1_closed'), 'Close T1').toBe(true)
      expect(out(vars, 't2_closed'), 'Close T2').toBe(true)
      expect(out(vars, 'b_closed'), 'Close B').toEqual([out(vars, 'b_sid')])
      expectConsoleLine(entries, 'INFO', 'sftp-tunnel closes t1=True t2=True s2=1 b=1 exists=False')
      expect(out(vars, 'run_caught'), 'nothing failed on the Try path').toBe(false)
      const refused: string[] = [NODE.openS3]
      for (const id of Object.values(NODE).filter((id) => !refused.includes(id))) {
        await expectNodeStatus(page, id, 'success')
      }
    })
  })
})
