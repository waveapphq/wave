/**
 * V-PLUGIN-PYTHON-REMOTE-FUNCTIONAL: the Python block inside a Remote Execution body
 * Wireframe: none
 * Design Decisions: PYRUN-2, PYRUN-3, PYRUN-5, PYRUN-6, PYRUN-7, PYRUN-8, PYRUN-11, PYRUN-12,
 *   SHRUN-12
 * REQ: REQ-3.4.1.2, REQ-3.4.1.3, REQ-3.1.3.5, REQ-3.4.3.11
 *
 * Three runs against the real `sshd` service of the E2E stack.
 *
 * `fixture-remote.json` - a Shell Script reads WAVE's own hostname, an SSH session reads the
 * remote host's hostname and the version of its own `python3`, two File I/O blocks read the
 * Test Data files on WAVE, and a Remote Execution body then writes the helper and the plain
 * script onto the remote host and runs three Python blocks there.
 *
 * `fixture-remote-refusals.json` - three Python blocks in a body under Record and continue:
 * a missing interpreter, a `sys.exit` carrying text, and a `testdata://` Working Directory.
 *
 * `fixture-remote-secret.json` - one Python block in a body whose Stdout and Stderr are
 * marked secret and whose script exits non-zero.
 *
 * Pass Criteria:
 * 1. A Python block whose Script File is a `testdata://` path runs on the remote host: the
 *    file is read on WAVE and shipped, and `pyhelper`, sitting beside it in the same Test
 *    Data folder, imports by name from the Working Directory on the remote host.
 * 2. The interpreter is the sshd host's own `python3`: the printed version line has the
 *    shape `<major>.<minor>.<micro>` and equals what that host's own `python3` reports over
 *    the SSH session, while the script's host is the SSH host and not the WAVE host.
 * 3. Typed exports come back from the remote host: a table, a Decimal float, a map and an
 *    array all reach their bound WAVE variables with their declared types.
 * 4. A remote block's stream lines and `logging` records reach the console at their mapped
 *    levels, and they arrive when the block ends, not while it runs.
 * 5. A plain (non-`testdata://`) Script File resolves on the remote host, against the
 *    Working Directory there.
 * 6. A missing interpreter fails with `Interpreter not found on the remote host: nosuchpython`
 *    and reason StartFailed.
 * 7. The INFO start line of a remote Python block ends `on the remote host` and names the
 *    interpreter, the Script File as written, or the script without showing it.
 * 8. `sys.exit("text")` on the remote host puts the text on Stderr and fails with
 *    `Script exited with code 1: text`.
 * 9. A remote Python block honors the Secret box on Stdout and Stderr: no stream line
 *    reaches the console, the failure message stays bare, and no canary sits on the
 *    console, in the WS stream or in the session variables.
 * 10. A `testdata://` Working Directory is refused with
 *     `testdata:// paths are not available on the remote host` and reason StartFailed.
 * 11. After the run the worker's `/tmp/wave-worker-*` scratch dir, where the remote script ran,
 *     is no longer on the remote host.
 * 12. A remote Python block whose Working Directory is empty starts in the temp folder Python
 *     reports on the remote host: its `os.getcwd()` equals its `tempfile.gettempdir()`, and
 *     neither is empty.
 *
 * Run: ./scripts/e2e-targeted-local.sh functional/python-block/v-plugin-python-remote-functional.spec.ts
 */

import fs from 'fs'
import path from 'path'
import { randomUUID } from 'node:crypto'
import { test, expect, type Page } from '../../helpers/playwright-fixtures'
import { getActiveSessionId, getSessionVariables } from '../../helpers/fixture-import'
import { elapsedMs, getLogRows, type LogRow } from '../../helpers/log-reader'
import { expectNodeStatus, expectNodesSuccess, finishRun, startRun } from '../../helpers/k8s-run'
import { openSessionEventCollector } from '../../helpers/ws-events'
import { expectNoSecret, SECRET_MASK } from '../../helpers/secret-canary'
import { validateTest } from '../../helpers/fn-seed'
import { deleteTest, importWithTestData, type SeedFile } from '../file-picker/picker'
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
    elementType: string
    config: {
      values: Record<string, unknown>
      outputBindings: Record<string, string>
      outputSecretFields?: string[]
    }
  }
}

interface Fixture {
  name: string
  workflow: { nodes: FixtureNode[]; edges: Array<Record<string, unknown>> }
  variables: Record<string, { value: unknown; type: string; scope: string }>
  [key: string]: unknown
}

type SessionVariables = Record<string, { value: unknown; type: string }>
type WaveTable = { columns: Array<{ name: string; type: string }>; rows: unknown[][] }

const TESTDATA_DIR = 'testdata-remote'
const TESTDATA_PLACEHOLDER = '__TDATA__'

function loadFixture(file: string, dataFolder = ''): Fixture {
  const raw = fs.readFileSync(path.resolve(__dirname, file), 'utf-8')
  return JSON.parse(raw.split(TESTDATA_PLACEHOLDER).join(dataFolder)) as Fixture
}

function seedFile(folder: string, name: string): SeedFile {
  return {
    folder,
    name,
    body: fs.readFileSync(path.resolve(__dirname, TESTDATA_DIR, name)),
  }
}

function nodeOf(fixture: Fixture, id: string): FixtureNode {
  const found = fixture.workflow.nodes.find((entry) => entry.id === id)
  expect(found, `the fixture must declare a node "${id}"`).toBeTruthy()
  return found as FixtureNode
}

/** The SSH block must carry the harness constants, not a copy that drifted. */
function expectStackSshTarget(fixture: Fixture): void {
  const values = nodeOf(fixture, 'ssh-open').data.config.values
  expect(values.host, 'the fixture carries the host-mode sentinel the import helper rewrites').toBe(
    SSH_FIXTURE_HOST_SENTINEL,
  )
  expect(String(values.port), 'the fixture targets the stack sshd port').toBe(SSH_MAIN_PORT)
  expect(values.username, 'the fixture uses the stack SSH user').toBe(SSH_STACK_USER)
  expect(values.password, 'the fixture uses the stack SSH password').toBe(SSH_STACK_PASSWORD)
}

// --- console helpers -----------------------------------------------------
function dump(rows: readonly LogRow[]): string {
  return rows.map((row) => `[${row.level}] ${row.source}: ${row.message}`).join('\n')
}

function rowWith(rows: readonly LogRow[], message: string): LogRow {
  const hit = rows.find((row) => row.message === message)
  expect(hit, `the console must carry the line "${message}".\n${dump(rows)}`).toBeTruthy()
  return hit as LogRow
}

/** Drop the console to DEBUG before the run, so the mapped DEBUG record renders too. */
async function setConsoleDebug(page: Page): Promise<void> {
  const panel = page.locator('[data-testid="console-panel"]').first()
  if ((await panel.getAttribute('data-state')) === 'collapsed') {
    await page
      .locator('[data-testid="console-panel-header"] button[aria-label="Toggle console"]')
      .click()
  }
  await page.locator('button[aria-label="Minimum log level"]').click()
  await page.getByRole('option', { name: 'DEBUG' }).click()
}

function cell(variables: SessionVariables, name: string): { value: unknown; type: string } {
  expect(variables[name], `variable "${name}" is missing from the session`).toBeTruthy()
  return variables[name]
}

function text(variables: SessionVariables, name: string): string {
  return String(cell(variables, name).value).trim()
}

// --- fixture node ids ----------------------------------------------------
/** The blocks inside the container body - every one remotable, so every one R. */
const BODY_IDS = [
  'fio-mkdir',
  'fio-put-helper',
  'fio-put-plain',
  'py-main',
  'py-plain',
  'py-logs',
] as const

/** Everything outside the body: no locus badge is painted on any of them. */
const OUTSIDE_IDS = [
  'sh-wave-host',
  'ssh-open',
  'ssh-host-name',
  'ssh-host-python',
  'fio-load-helper',
  'fio-load-plain',
  'container',
  'ssh-cleanup',
  'ssh-worker-gone',
  'log-done',
] as const

const ALL_IDS = [...OUTSIDE_IDS, ...BODY_IDS]

const LOCUS_BADGE = '[data-testid="node-remote-locus-badge"]'
const REMOTE_LOCUS = 'on the remote host'
const PY_SOURCE = 'Python'

// Markers the Test Data scripts build from parts, so no script holds one verbatim.
const MARK_VERSION = 'pyrem-version'
const MARK_HELPER = 'pyrem-helper-ok'
const MARK_WHERE = 'pyrem-where'
const MARK_PLAIN = 'pyrem-plain-ok'
const MARK_EXIT_TEXT = 'pyrem-exit-text'
const MARK_SECRET_PLAIN = 'pyrem-secret-visible'
const BOOKEND = 'pyrem-remote-done'
const BOOKEND_REFUSALS = 'pyrem-refusals-done'
const BOOKEND_SECRET = 'pyrem-secret-done'

// The secret canaries the secret script joins from parts (never verbatim in the script).
const CANARY_OUT = 'pysecret-out-a41c9d'
const CANARY_ERR = 'pysecret-err-a41c9d'
const CANARY_FAMILY = 'pysecret-'

// Exact refusals and failure messages, as the plugin and the bundle write them.
const INTERPRETER_MISSING = 'Interpreter not found on the remote host: nosuchpython'
const SCHEME_REFUSED = 'testdata:// paths are not available on the remote host'
const EXIT_WITH_TEXT = `Script exited with code 1: ${MARK_EXIT_TEXT}`
const SECRET_EXIT_BARE = 'Script exited with code 3'

/** The declared price input and the product the remote script hands back (PYRUN-5, PYRUN-6). */
const PRICE_IN = '1234.5678901234567891'
const PRICE_OUT = '3703.7036703703703673'

/** Every body member shows one R badge; nothing outside the body shows one. */
async function expectRemoteLocusBadges(page: Page): Promise<void> {
  for (const id of BODY_IDS) {
    const badge = page.locator(`[data-testid="workflow-node-${id}"] ${LOCUS_BADGE}`)
    await expect(badge, `${id} is a remotable block inside the body`).toHaveCount(1)
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
}

const createdTests: string[] = []

test.describe('V-PLUGIN-PYTHON-REMOTE-FUNCTIONAL: a Python block inside a Remote Execution body', () => {
  test.afterAll(async ({ request }) => {
    await request.delete(`${BACKEND_URL}/workbench/session/`).catch(() => undefined)
    for (const testId of createdTests.splice(0)) await deleteTest(request, testId)
  })

  test('the script, its helper and its interpreter are all the remote host\'s', async ({
    page,
  }) => {
    test.setTimeout(300_000)

    // The sshd host and the server are shared by every shard, so this run owns unique names.
    const unique = randomUUID().slice(0, 8)
    const dataFolder = `pyrem-${unique}`
    const runDir = `/tmp/wave-e2e-pyrem-${unique}`
    const fixture = loadFixture('fixture-remote.json', dataFolder)
    expectStackSshTarget(fixture)
    fixture.variables.run_dir.value = runDir

    const scriptFile = String(nodeOf(fixture, 'py-main').data.config.values.script_file)
    expect(scriptFile, 'the leg only means anything with a WAVE-side scheme on the block').toBe(
      `testdata://${dataFolder}/main.py`,
    )
    const plainFile = String(nodeOf(fixture, 'py-plain').data.config.values.script_file)
    expect(plainFile, 'the plain leg names a file with no scheme at all').toBe('remote_only.py')
    expect(
      nodeOf(fixture, 'py-logs').data.config.values.working_dir,
      'the start-folder leg only means anything with the Working Directory empty',
    ).toBeUndefined()

    const testId = await importWithTestData(
      page,
      fixture,
      [
        seedFile(dataFolder, 'main.py'),
        seedFile(dataFolder, 'pyhelper.py'),
        seedFile(dataFolder, 'remote_only.py'),
      ],
      { injectSsh: true },
    )
    createdTests.push(testId)

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

    await setConsoleDebug(page)
    const status = await startRun(page)
    await finishRun(page, status, BOOKEND, 240_000)
    const rows = await getLogRows(page)
    const variables = await getSessionVariables(page, await getActiveSessionId(page))

    const waveHost = text(variables, 'wave_host')
    const sshHost = text(variables, 'ssh_host')
    const sshPyVersion = text(variables, 'ssh_py_version')

    await test.step('every block ended successful', async () => {
      await expectNodesSuccess(page, ALL_IDS)
    })

    await test.step('the run really reached the stack host and its own python3', () => {
      expect(sshHost, 'the SSH session runs on the stack sshd container').toBe('wave-e2e-host')
      expect(waveHost, 'the Shell Script ran on WAVE, which is a different machine').not.toBe(
        sshHost,
      )
      expect(
        sshPyVersion,
        `the host's own python3 must report a three-part version. Got "${sshPyVersion}"`,
      ).toMatch(/^\d+\.\d+\.\d+$/)
      expect(String(cell(variables, 'rsid').value), 'the container binds a worker handle').toMatch(
        /^[0-9a-f]{32}$/,
      )
    })

    // Per PYRUN-2: sys.path[0] is the Working Directory, so only a helper written there imports.
    await test.step('the testdata:// script shipped and imported its helper from the Working Directory', () => {
      const helper = rowWith(rows, MARK_HELPER)
      expect(helper.level, 'a stdout line arrives at INFO while Log Output is on').toBe('INFO')
      expect(helper.source, 'the line is attributed to the Python block').toBe(PY_SOURCE)
      expect(
        text(variables, 'py_host_v'),
        'the shipped script ran where the helper was written',
      ).toBe(sshHost)
    })

    // Proof it is the remote interpreter: the version matches what the SSH session read from
    // that host's own python3, and the script's own host is the SSH host, never WAVE's.
    await test.step("the interpreter is the remote host's own python3", () => {
      const printed = rowWith(rows, `${MARK_VERSION} ${sshPyVersion}`)
      expect(printed.message, 'the printed version line keeps its shape').toMatch(
        new RegExp(`^${MARK_VERSION} \\d+\\.\\d+\\.\\d+$`),
      )
      expect(printed.level, 'the version line is a stdout line').toBe('INFO')
      expect(text(variables, 'py_version_v'), 'the export carries the same version').toBe(
        sshPyVersion,
      )
      expect(
        text(variables, 'py_host_v'),
        'the script ran on the SSH host, not on WAVE',
      ).toBe(sshHost)
      expect(text(variables, 'py_host_v'), 'and not on the WAVE server').not.toBe(waveHost)
      rowWith(rows, `${MARK_WHERE} ${sshHost}`)
    })

    await test.step('the typed exports come back as the types their variables declare', () => {
      const rowsVar = cell(variables, 'py_rows_v')
      expect(rowsVar.type, 'the table export binds a table').toBe('table')
      const table = rowsVar.value as WaveTable
      expect(
        table.columns,
        'the table keeps its columns and their types across the wire',
      ).toEqual([
        { name: 'name', type: 'string' },
        { name: 'temp_c', type: 'float' },
      ])
      expect(table.rows, 'the table keeps its rows').toEqual([
        ['alpha', '20.5'],
        ['beta', '21.25'],
      ])

      const price = cell(variables, 'py_price_v')
      expect(price.type, 'the Decimal export binds a float').toBe('float')
      expect(
        String(price.value),
        `a Decimal computed on the remote host survives exactly (${PRICE_IN} * 3)`,
      ).toBe(PRICE_OUT)

      const map = cell(variables, 'py_map_v')
      expect(map.type, 'the dict export binds a map').toBe('map')
      const facts = map.value as Record<string, unknown>
      expect(facts.host, 'the map was built on the remote host').toBe(sshHost)
      expect(facts.names, 'the script read the table as row dicts').toBe('alpha,beta')
      expect(facts.first_temp, 'a float cell keeps its exact text').toBe('20.5')
      expect(facts.cell_kind, 'a float cell reaches the remote script as a Decimal').toBe('Decimal')

      const list = cell(variables, 'py_list_v')
      expect(list.type, 'the list export binds an array').toBe('array')
      expect(list.value, 'the array keeps its members and their types').toEqual([
        'row-count',
        2,
        true,
      ])
    })

    // The file exists only under the run folder on the remote host, named relatively.
    await test.step('a plain Script File resolves on the remote host', () => {
      expect(text(variables, 'plain_mark_v'), 'the plain-path script ran').toBe(MARK_PLAIN)
      expect(
        text(variables, 'plain_host_v'),
        `${plainFile} was resolved against ${runDir} on the remote host`,
      ).toBe(sshHost)
    })

    await test.step('every remote Python block wrote its start line naming the remote host', () => {
      const started = (message: string): LogRow => {
        const row = rowWith(rows, message)
        expect(row.level, 'the start line is an INFO line').toBe('INFO')
        expect(row.source, 'the start line is the block\'s own').toBe(PY_SOURCE)
        expect(row.message.endsWith(REMOTE_LOCUS), `"${message}" must end with the locus`).toBe(true)
        return row
      }
      started(`Running ${scriptFile} under python3 ${REMOTE_LOCUS}`)
      started(`Running ${plainFile} under python3 ${REMOTE_LOCUS}`)
      started(`Running the script under python3 ${REMOTE_LOCUS}`)
      expect(
        rows.filter((row) => row.message === `Running the script under python3 ${REMOTE_LOCUS}`),
        'a typed script is never echoed and is named once per block',
      ).toHaveLength(1)
    })

    await test.step('the block\'s lines reach the console at their mapped levels', () => {
      const mapped: Array<[string, string]> = [
        ['pyrem-log-stdout', 'INFO'],
        ['pyrem-log-stderr', 'WARN'],
        ['pyrem-log-debug', 'DEBUG'],
        ['pyrem-log-info', 'INFO'],
        ['pyrem-log-warning', 'WARN'],
        ['pyrem-log-error', 'ERROR'],
        ['pyrem-log-critical', 'ERROR'],
      ]
      for (const [message, level] of mapped) {
        const row = rowWith(rows, message)
        expect(row.level, `"${message}" must arrive at ${level}`).toBe(level)
        expect(row.source, `"${message}" is the Python block's own line`).toBe(PY_SOURCE)
      }
    })

    // The script logs first and then holds the process 6 s, so a live line would be far earlier.
    await test.step('those lines arrive when the block ends, not while it runs', () => {
      const start = rowWith(rows, `Running the script under python3 ${REMOTE_LOCUS}`)
      const first = rowWith(rows, 'pyrem-log-stdout')
      expect(
        elapsedMs(start, first),
        'the script sleeps 6 s after logging, so a live line would be far earlier',
      ).toBeGreaterThanOrEqual(4_000)
    })

    await test.step('the run folder is gone from the remote host', () => {
      expect(
        text(variables, 'gone_probe'),
        `the then branch must leave the host without ${runDir}`,
      ).toBe('gone')
    })

    await test.step('the worker scratch dir is gone from the remote host after the run', () => {
      const workerDir = text(variables, 'py_worker_dir')
      expect(workerDir, 'the script ran under the worker scratch dir').toMatch(
        /^\/tmp\/wave-worker-[A-Za-z0-9_]+$/,
      )
      expect(text(variables, 'worker_probe'), `${workerDir} must leave the host with the worker`).toBe(
        'gone',
      )
    })

    await test.step("an empty Working Directory starts the block in the remote host's temp folder", () => {
      const systemTemp = text(variables, 'py_system_temp')
      expect(systemTemp, 'the remote host reported a temp folder').not.toBe('')
      expect(text(variables, 'py_start_dir'), 'py-logs started in that temp folder').toBe(systemTemp)
    })
  })

  test('a missing interpreter, a sys.exit text and a testdata:// Working Directory all fail on the remote host', async ({
    page,
  }) => {
    test.setTimeout(240_000)

    const fixture = loadFixture('fixture-remote-refusals.json')
    expectStackSshTarget(fixture)
    expect(
      nodeOf(fixture, 'py-testdata-wd').data.config.values.working_dir,
      'the leg only means anything with a WAVE-side scheme on the Working Directory',
    ).toBe('testdata://data')

    const testId = await importWithTestData(page, fixture, [], { injectSsh: true })
    createdTests.push(testId)

    await test.step('the imported workflow validates with zero errors', async () => {
      const result = await validateTest(page.request, testId, 'run')
      expect(result.status, `validate answered ${result.status}`).toBe(200)
      expect(
        result.errors,
        `a scheme on a remote-host block is not a save finding. Got: ${JSON.stringify(result.errors)}`,
      ).toHaveLength(0)
    })

    const status = await startRun(page)
    await finishRun(page, status, BOOKEND_REFUSALS, 180_000)
    const rows = await getLogRows(page)
    const variables = await getSessionVariables(page, await getActiveSessionId(page))

    await test.step('each recorded failure paints its block amber', async () => {
      for (const id of ['py-nointerp', 'py-exit-text', 'py-testdata-wd']) {
        await expectNodeStatus(page, id, 'warning')
      }
    })

    await test.step('a missing interpreter names the remote host', () => {
      expect(text(variables, 'ni_err'), 'the block names the interpreter it could not find').toBe(
        INTERPRETER_MISSING,
      )
      expect(text(variables, 'ni_reason'), 'nothing ever started').toBe('StartFailed')
      expect(cell(variables, 'ni_ok').value, 'the block did not pass').toBe(false)
      rowWith(rows, `Script failed (StartFailed): ${INTERPRETER_MISSING}`)
      // Per SHRUN-12 the start line precedes every resolution, so it precedes a start failure.
      const start = rowWith(rows, `Running the script under nosuchpython ${REMOTE_LOCUS}`)
      expect(start.level, 'the start line is an INFO line').toBe('INFO')
    })

    await test.step('sys.exit with text puts the text on Stderr and in the message', () => {
      expect(
        String(cell(variables, 'ex_stderr').value),
        'the exit value is written to Stderr, as CPython writes it',
      ).toBe(`${MARK_EXIT_TEXT}\n`)
      expect(text(variables, 'ex_err'), 'the message carries the last Stderr line').toBe(
        EXIT_WITH_TEXT,
      )
      expect(text(variables, 'ex_reason'), 'a value passed to sys.exit exits 1').toBe('NonZeroExit')
      expect(cell(variables, 'ex_code').value, 'the exit code is 1').toBe(1)
      rowWith(rows, `Script failed (NonZeroExit): ${EXIT_WITH_TEXT}`)
    })

    await test.step('a testdata:// Working Directory is refused on the remote host', () => {
      expect(text(variables, 'wd_err'), 'the refusal is the bundle\'s own').toBe(SCHEME_REFUSED)
      expect(text(variables, 'wd_reason'), 'nothing ever started').toBe('StartFailed')
      expect(cell(variables, 'wd_ok').value, 'the block did not pass').toBe(false)
      expect(String(cell(variables, 'wd_out').value), 'the script never ran').toBe('')
      rowWith(rows, `Script failed (StartFailed): ${SCHEME_REFUSED}`)
    })
  })

  test('a remote Python block honors the Secret box on Stdout and Stderr', async ({ page }) => {
    test.setTimeout(240_000)

    const fixture = loadFixture('fixture-remote-secret.json')
    expectStackSshTarget(fixture)
    expect(
      nodeOf(fixture, 'py-secret').data.config.outputSecretFields,
      'both streams carry the Secret box',
    ).toEqual(['stdout', 'stderr'])

    const testId = await importWithTestData(page, fixture, [], { injectSsh: true })
    createdTests.push(testId)

    // The leading Delay holds the run so the collector subscribes before any output flows.
    const status = await startRun(page)
    const sessionId = await getActiveSessionId(page)
    const collector = await openSessionEventCollector(page, sessionId, [
      `log:${sessionId}`,
      `variable:${sessionId}`,
    ])

    await finishRun(page, status, BOOKEND_SECRET, 180_000)
    const rows = await getLogRows(page)
    const events = await collector.harvest()
    await collector.close()
    const variables = await getSessionVariables(page, sessionId)

    await test.step('the block recorded its failure', async () => {
      await expectNodeStatus(page, 'py-secret', 'warning')
    })

    await test.step('the marked streams read the mask in the session variables', () => {
      expect(cell(variables, 'sec_out').value, 'the marked Stdout is masked').toBe(SECRET_MASK)
      expect(cell(variables, 'sec_err').value, 'the marked Stderr is masked').toBe(SECRET_MASK)
      expect(cell(variables, 'sec_code').value, 'the exit code is not a secret').toBe(3)
      expectNoSecret(
        JSON.stringify(variables),
        'session variables',
        [CANARY_OUT, CANARY_ERR],
        CANARY_FAMILY,
      )
    })

    await test.step('the failure message stays bare', () => {
      expect(
        text(variables, 'sec_error'),
        'a secret Stderr keeps its last line out of the exit message',
      ).toBe(SECRET_EXIT_BARE)
      expect(text(variables, 'sec_reason'), 'the block failed on its exit code').toBe('NonZeroExit')
      rowWith(rows, `Script failed (NonZeroExit): ${SECRET_EXIT_BARE}`)
    })

    await test.step('no stream line reaches the console, while the block\'s own log line does', () => {
      const plain = rowWith(rows, MARK_SECRET_PLAIN)
      expect(plain.source, 'the block did reach the console').toBe(PY_SOURCE)
      expect(
        rows.filter((row) => row.message === SECRET_MASK),
        `a masked stream line would read as the mask alone.\n${dump(rows)}`,
      ).toHaveLength(0)
      expectNoSecret(dump(rows), 'console log', [CANARY_OUT, CANARY_ERR], CANARY_FAMILY)
    })

    await test.step('nothing leaks through the WS stream either', () => {
      const messages = events
        .map((event) => event.message)
        .filter((message): message is string => typeof message === 'string')
      expectNoSecret(
        messages.join('\n'),
        'WS log stream',
        [CANARY_OUT, CANARY_ERR],
        CANARY_FAMILY,
      )
    })
  })
})
