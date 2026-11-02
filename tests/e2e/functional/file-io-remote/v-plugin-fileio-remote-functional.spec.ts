/**
 * V-PLUGIN-FILEIO-REMOTE-FUNCTIONAL: File I/O inside a Remote Execution body.
 * Wireframe: N/A (no new visual surface; the canvas badge is covered by the visual suite)
 * Design Decisions: FIO-10
 * REQ: REQ-3.4.1.10, REQ-3.4.1.3, REQ-5.1.5
 *
 * Two legs against the real `sshd` service of the E2E stack.
 *
 * `remote.fixture.json` - one SSH session to the real host, then a Remote
 * Execution body of seven File I/O blocks working under a per-run unique
 * directory on that host:
 *   seed-host          -> SSH Session Exec writes seed/marker.txt on the host
 *   container          -> pushes the bundle and opens one worker
 *     body:
 *       fio-create-folder -> create_folder <run>/deep
 *       fio-write         -> write <run>/deep/notes.txt
 *       fio-read          -> read it back
 *       fio-read-seed     -> read the marker the SSH session left on the host
 *       fio-stats         -> stats with size + sha256
 *       fio-list          -> list <run> recursively with sizes
 *       fio-delete        -> remove <run>, leaving the shared host clean
 *   then:
 *       probe-gone        -> SSH Session Exec proves the host directory is gone
 *
 * The proof of locus is the shared filesystem: the SSH session seeds a file on
 * the host and the body reads exactly that file, then writes beside it and
 * lists both in one listing. A body running on WAVE could not see the marker.
 *
 * `abort-scheme.fixture.json` - the same shape with a `testdata://` path on the
 * body's File I/O block. The test saves and validates clean; the run fails at
 * that block on the remote host with the remote-host refusal.
 *
 * Pass Criteria:
 * 1. POST /tests imports the remote fixture and POST /tests/{id}/validate
 *    reports zero errors
 * 2. Every File I/O block inside the body carries the R locus badge; no block
 *    outside the body carries any locus badge
 * 3. The run passes and every block ends successful
 * 4. The read returns the written payload byte for byte, and stats reports the
 *    remote file's size and sha256 of that payload
 * 5. The body read the marker the SSH session seeded on the host
 * 6. The listing holds the four remote entries, in path order, with the
 *    payload's size on the written file
 * 7. The plugin's own INFO lines name the absolute host paths
 * 8. The last block removed the directory: the host-side probe reports it gone
 * 9. A testdata:// path inside the body saves with zero validation errors, and
 *    the run fails at that block with the remote-host refusal; the then branch
 *    never runs
 *
 * Run: ./scripts/e2e-targeted-local.sh functional/file-io-remote/v-plugin-fileio-remote-functional.spec.ts
 */

import fs from 'fs'
import path from 'path'
import { createHash, randomUUID } from 'node:crypto'
import { test, expect, type Page } from '../../helpers/playwright-fixtures'
import { importValidateAndNavigate, getActiveSessionId, getSessionVariables } from '../../helpers/fixture-import'
import { validateTest } from '../../helpers/fn-seed'
import {
  expectNodeStatus,
  expectNodesSuccess,
  finishRun,
  finishRunAnyVerdict,
  startRun,
} from '../../helpers/k8s-run'
import {
  BACKEND_URL,
  SSH_FIXTURE_HOST_SENTINEL,
  SSH_MAIN_PORT,
  SSH_STACK_PASSWORD,
  SSH_STACK_USER,
} from '../../helpers/config'

// --- fixture shape -------------------------------------------------------
interface FixtureNode {
  id: string
  data: {
    label: string
    elementType: string
    config: { values: Record<string, unknown>; outputBindings: Record<string, string> }
  }
}

interface FixtureVariable {
  value: unknown
  type: string
  scope: string
}

interface Fixture {
  name: string
  workflow: { nodes: FixtureNode[]; edges: Array<Record<string, unknown>> }
  variables: Record<string, FixtureVariable>
  [key: string]: unknown
}

type WaveTable = { columns: Array<{ name: string; type: string }>; rows: unknown[][] }

function loadFixture(file: string): Fixture {
  return JSON.parse(fs.readFileSync(path.resolve(__dirname, file), 'utf-8')) as Fixture
}

function nodeOf(fixture: Fixture, id: string): FixtureNode {
  const found = fixture.workflow.nodes.find((entry) => entry.id === id)
  expect(found, `the fixture must declare a node "${id}"`).toBeTruthy()
  return found as FixtureNode
}

/** The SSH block must carry the harness constants, not a copy that drifted. */
function expectStackSshTarget(fixture: Fixture): void {
  const values = nodeOf(fixture, 'open-session').data.config.values
  expect(values.host, 'the fixture carries the host-mode sentinel the import helper rewrites').toBe(
    SSH_FIXTURE_HOST_SENTINEL,
  )
  expect(String(values.port), 'the fixture targets the stack sshd port').toBe(SSH_MAIN_PORT)
  expect(values.username, 'the fixture uses the stack SSH user').toBe(SSH_STACK_USER)
  expect(values.password, 'the fixture uses the stack SSH password').toBe(SSH_STACK_PASSWORD)
}

// --- fixture node ids ----------------------------------------------------
/** The File I/O blocks inside the container body - all remotable, all R. */
const BODY_IDS = [
  'fio-create-folder',
  'fio-write',
  'fio-read',
  'fio-read-seed',
  'fio-stats',
  'fio-list',
  'fio-delete',
] as const

/** Everything outside the body: no locus badge is painted on any of them. */
const OUTSIDE_IDS = [
  'open-session',
  'seed-host',
  'log-seed',
  'container',
  'probe-gone',
  'log-results',
  'log-done',
] as const

const ALL_IDS = [...OUTSIDE_IDS, ...BODY_IDS]

const LOCUS_BADGE = '[data-testid="node-remote-locus-badge"]'
const BOOKEND = 'fileio-remote-done'
const ABORT_FILEIO_NODE = 'fio-testdata-read'

/** The run-time refusal of a WAVE-side scheme on a block running on the remote host (FIO-10). */
const SCHEME_MESSAGE =
  'testdata:// paths are not available on the remote host - use an absolute or relative path on the remote host'

/** Every File I/O block in the body shows one R badge; nothing else shows one. */
async function expectRemoteLocusBadges(page: Page): Promise<void> {
  for (const id of BODY_IDS) {
    const badge = page.locator(`[data-testid="workflow-node-${id}"] ${LOCUS_BADGE}`)
    await expect(badge, `${id} is a remotable block inside the body, so it carries one badge`).toHaveCount(1)
    await expect(badge, `${id} runs on the remote host`).toHaveAttribute('data-locus', 'R')
    await expect(badge).toHaveText('R')
  }
  for (const id of OUTSIDE_IDS) {
    await expect(
      page.locator(`[data-testid="workflow-node-${id}"] ${LOCUS_BADGE}`),
      `${id} sits outside the body, so it carries no locus badge`,
    ).toHaveCount(0)
  }
  await expect(
    page.locator(`${LOCUS_BADGE}[data-locus="L"]`),
    'every body member is remotable, so nothing is marked as running on WAVE',
  ).toHaveCount(0)
  await expect(page.locator(LOCUS_BADGE), 'one badge per body member').toHaveCount(BODY_IDS.length)
}

let createdTestId: string | null = null

test.describe('File I/O inside a Remote Execution body', () => {
  test.beforeEach(() => {
    createdTestId = null
  })

  test.afterEach(async ({ request }) => {
    if (!createdTestId) return
    await request.delete(`${BACKEND_URL}/workbench/session/`).catch(() => {})
    const resp = await request.delete(`${BACKEND_URL}/tests/${createdTestId}`)
    expect(
      [204, 404],
      `teardown must remove the imported Test, got ${resp.status()}`,
    ).toContain(resp.status())
    createdTestId = null
  })

  test('File I/O runs on the SSH host: round trip, stats, listing and cleanup all land there', async ({
    page,
  }) => {
    test.setTimeout(240_000)

    const fixture = loadFixture('remote.fixture.json')
    expectStackSshTarget(fixture)

    // The stack is shared across parallel shards, so every run owns its own
    // directory on the host and removes it with its own last block.
    const runDir = `/tmp/wave-e2e-fio-${randomUUID().slice(0, 8)}`
    fixture.variables.run_dir.value = runDir

    const payload = String(fixture.variables.payload.value)
    const seedText = String(fixture.variables.seed_text.value)
    const payloadBytes = Buffer.byteLength(payload, 'utf8')
    const seedBytes = Buffer.byteLength(seedText, 'utf8')
    const notesPath = `${runDir}/deep/notes.txt`
    const markerPath = `${runDir}/seed/marker.txt`

    const testId = await importValidateAndNavigate(page, fixture, { injectSsh: true })
    createdTestId = testId

    await test.step('the imported workflow validates with zero errors', async () => {
      const result = await validateTest(page.request, testId, 'run')
      expect(result.status, `validate answered ${result.status}`).toBe(200)
      expect(
        result.errors,
        `the remote fixture must validate clean. Got: ${JSON.stringify(result.errors)}`,
      ).toHaveLength(0)
    })

    await test.step('the canvas marks every body block as running on the remote host', async () => {
      await expectRemoteLocusBadges(page)
    })

    const status = await startRun(page)
    const logs = await finishRun(page, status, BOOKEND, 150_000)
    const all = logs.join('\n')

    const assertLine = (line: string) =>
      expect(
        logs.some((text) => text === line),
        `expected the console line "${line}".\n${all}`,
      ).toBeTruthy()

    await test.step('every block ended successful', async () => {
      await expectNodesSuccess(page, ALL_IDS)
    })

    const vars = await getSessionVariables(page, await getActiveSessionId(page))

    await test.step('the container really opened a worker on the host', () => {
      expect(
        String(vars.seed_host.value).trim(),
        'the SSH session runs on the stack sshd container',
      ).toBe('wave-e2e-host')
      expect(
        String(vars.rsid.value),
        'the container binds a remote session handle',
      ).toMatch(/^[0-9a-f]{32}$/)
    })

    await test.step('the read returns what the remote write wrote', () => {
      expect(
        vars.read_back.value,
        `the body must read back exactly what it wrote.\n${all}`,
      ).toBe(payload)
      assertLine(`Wrote ${payload.length} characters to ${notesPath}`)
      assertLine(`Read ${payload.length} characters from ${notesPath}`)
      assertLine(`Created folder ${runDir}/deep`)
    })

    await test.step('the body reads the file the SSH session left on the host', () => {
      expect(
        vars.seed_read.value,
        `only a body running on the host can read ${markerPath}.\n${all}`,
      ).toBe(seedText)
      assertLine(`Read ${seedText.length} characters from ${markerPath}`)
    })

    await test.step('stats reports the remote file, down to its checksum', () => {
      expect(vars.notes_stats.type, 'stats binds a map in map output format').toBe('map')
      const stats = vars.notes_stats.value as Record<string, unknown>
      expect(stats.exists, 'the remote file is there').toBe(true)
      expect(stats.type, 'the remote path is a file').toBe('file')
      expect(stats.size, 'the remote file holds the payload').toBe(payloadBytes)
      expect(stats.checksum, 'the remote bytes are the payload bytes').toBe(
        createHash('sha256').update(payload, 'utf8').digest('hex'),
      )
      expect(String(stats.modified), 'the remote file carries a modification time').not.toBe('')
      assertLine(`Reported stats for ${notesPath}`)
    })

    await test.step('the listing holds the remote entries in path order', () => {
      expect(vars.listing.type, 'list binds a table').toBe('table')
      const listing = vars.listing.value as WaveTable
      expect(
        listing.columns.map((column) => column.name),
        'Size adds a fifth column',
      ).toEqual(['name', 'path', 'type', 'modified', 'size'])
      expect(
        listing.rows.map((row) => String(row[1])),
        'the recursive listing is sorted by path',
      ).toEqual(['deep', 'deep/notes.txt', 'seed', 'seed/marker.txt'])
      const rowFor = (relative: string): unknown[] => {
        const row = listing.rows.find((entry) => String(entry[1]) === relative)
        expect(row, `the listing must hold ${relative}`).toBeTruthy()
        return row as unknown[]
      }
      expect(rowFor('deep')[2], 'the folder the body created').toBe('folder')
      expect(rowFor('deep/notes.txt')[2], 'the file the body wrote').toBe('file')
      expect(rowFor('deep/notes.txt')[4], 'sized as the payload').toBe(payloadBytes)
      expect(rowFor('deep/notes.txt')[0], 'named as written').toBe('notes.txt')
      expect(rowFor('seed/marker.txt')[4], 'sized as the host marker').toBe(seedBytes)
      expect(vars.listing_count.value, 'four entries below the run folder').toBe(4)
      assertLine(`Listed 4 entries in ${runDir}`)
    })

    await test.step('the last block removed the directory from the host', () => {
      assertLine(`Deleted ${runDir}`)
      expect(
        String(vars.gone_probe.value).trim(),
        `the host must no longer hold ${runDir}.\n${all}`,
      ).toBe('gone')
    })
  })

  test('a testdata:// path inside the body saves, then fails on the remote host at run time', async ({
    page,
  }) => {
    test.setTimeout(180_000)

    const fixture = loadFixture('abort-scheme.fixture.json')
    expectStackSshTarget(fixture)

    const values = nodeOf(fixture, ABORT_FILEIO_NODE).data.config.values
    expect(values.path, 'the leg only means anything with a WAVE-side scheme on the block').toBe(
      'testdata://orders.csv',
    )

    const testId = await importValidateAndNavigate(page, fixture, { injectSsh: true })
    createdTestId = testId

    await test.step('the test saved and validates with zero errors', async () => {
      const result = await validateTest(page.request, testId, 'run')
      expect(result.status, `validate answered ${result.status}`).toBe(200)
      expect(
        result.errors,
        `a scheme on a remote-host block is not a save finding. Got: ${JSON.stringify(result.errors)}`,
      ).toHaveLength(0)
    })

    const status = await startRun(page)
    const { verdict, logs } = await finishRunAnyVerdict(page, status, SCHEME_MESSAGE, 150_000)
    const all = logs.join('\n')

    await test.step('the run fails at the File I/O block with the remote-host refusal', async () => {
      expect(verdict, `the run must fail.\n${all}`).toBe('failed')
      expect(
        logs.some((line) => line.endsWith(SCHEME_MESSAGE)),
        `the console must carry the refusal verbatim.\n${all}`,
      ).toBeTruthy()
      await expectNodeStatus(page, ABORT_FILEIO_NODE, 'failed')
    })

    await test.step('nothing after the failed body ran', () => {
      expect(logs, 'the then branch never runs after a failed body').not.toContain(
        'abort-scheme-then',
      )
    })
  })
})
