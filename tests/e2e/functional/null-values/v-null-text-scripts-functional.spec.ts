/**
 * V-NULL-TEXT-SCRIPTS-FUNCTIONAL: null in text pieces, script entries and script exports
 * Wireframe: none
 * Design Decisions: SHRUN-4, SHRUN-5, SHRUN-9, PYRUN-4, PYRUN-5, PYRUN-6, PYRUN-7, FIELD-13
 * REQ: REQ-3.1.3.21, REQ-3.1.3.22, REQ-3.1.3.23, REQ-3.4.1.1, REQ-3.4.1.2
 *
 * One run of `fixture-text-scripts.json` against the real `http-echo` and `sshd` services of
 * the E2E stack. Every permutation that must fail sits in its own Try/Catch whose catch path
 * logs the caught message, so the one run covers all of them and passes.
 *
 * Pass Criteria:
 * 1. A null `{{ }}` piece in an HTTP URL fails the block with `'{{ nothing }}' in 'url' is null`
 *    and no request is sent: the echo service's retry counter for the run's own key still
 *    answers attempt 1 to the next request, and no request line for the URL reaches the console.
 * 2. A Log message prints a null piece as `null`, a boolean piece as `true` and a list piece
 *    with a null item as `[1,null,2]`.
 * 3. Shell Script: an input variable given None fails with `'TOKEN' in 'input_vars' is null`
 *    and an argument row given None with `Row 2 in 'arguments' is null`, on WAVE and inside a
 *    Remote Execution body on sshd (where it runs on WAVE); the script never started, so its
 *    marker file was never written.
 * 4. A list `[1, None, 2]` reaches a Shell Script input variable and argument as `[1,null,2]`.
 * 5. Python: an environment entry given None fails with `'TEAM' in 'environment' is null` and
 *    an argument row given None with `Row 2 in 'arguments' is null`, on WAVE and inside a Remote
 *    Execution body on sshd. On the remote path the failure names the host and nothing reaches
 *    it: the script never started and no marker file is on the host.
 * 6. A Python input variable given None is seen by the script as `None`.
 * 7. A Python export `None` bound to an integer variable makes the variable null and an export
 *    that fits binds, on WAVE and on sshd.
 * 8. A Python export "abc" bound to an integer variable fails with
 *    `Script variable 'n_bad' is not a valid integer`, reason OutputVariable, and binds nothing,
 *    on WAVE and on sshd alike.
 * 9. A Variable Setter expression row writing None sets the integer variable to null.
 * 10. Shell Script with input variable TOKEN and argument row 2 in expression mode giving empty
 *     text: the script sees two arguments, the second empty, and TOKEN set and empty; the same
 *     inside a Remote Execution body on sshd.
 * 11. Python with environment entry TEAM and argument row 2 given empty text the same way prints
 *     `['a', '']` and `''`, on WAVE and inside a Remote Execution body on sshd.
 * 12. A Test save holding those entries in expression mode with nothing typed is refused naming
 *     each entry: `Row 2 in 'arguments' is required` with `'TOKEN' in 'input_vars' is required`
 *     (Shell Script) or `'TEAM' in 'environment' is required` (Python), and stores nothing.
 * 13. Rows and entries stored as a literal null through the API reach the Block as null, like
 *     None: the stored Test holds the nulls, and Shell Script fails with
 *     `'TOKEN' in 'input_vars' is null` and Python with `'TEAM' in 'environment' is null` before
 *     the script starts, on WAVE and inside a Remote Execution body (on sshd the failure names the
 *     host); the marker files of those scripts are missing.
 * 14. The run passes.
 */

import fs from 'fs'
import path from 'path'
import { test, expect, type Page } from '../../helpers/playwright-fixtures'
import {
  getActiveSessionId,
  getSessionVariables,
  importValidateAndNavigate,
  sessionValue,
  type SessionVariables,
} from '../../helpers/fixture-import'
import { expectNodeStatus, finishRun, startRun } from '../../helpers/k8s-run'
import {
  expectConsoleLine,
  formatEntries,
  getLogEntries,
  type LogEntry,
} from '../../helpers/log-reader'
import {
  BACKEND_URL,
  SSH_FIXTURE_HOST_SENTINEL,
  SSH_MAIN_PORT,
  SSH_STACK_PASSWORD,
  SSH_STACK_USER,
  SSH_TARGET_HOST,
} from '../../helpers/config'
import { saveBtn } from '../../helpers/workbench'
import { deleteTest, persistedValues } from '../file-picker/picker'
import { newToken, withToken } from '../shell-blocks/shell-helpers'
import { findingRows, refusedBlockSave } from './null-entry-helpers'

interface FixtureNode {
  id: string
  data: { label: string; config: { values: Record<string, unknown> } }
}

interface Fixture {
  name: string
  workflow: { nodes: FixtureNode[]; edges: Array<Record<string, unknown>> }
  variables: Record<string, unknown>
  [key: string]: unknown
}

type CaughtError = { message: string; node_id: string }

// Block Names as the fixture declares them.
const SH_EMPTY = 'Shell entries left empty'
const SH_LIT = 'Shell entries stored null'
const SH_LIST = 'Shell list with a null item'
const PY_EMPTY = 'Python entries left empty'
const PY_LIT = 'Python entries stored null'
const PY_MAYBE = 'Python input variable null'
const PY_EXPORTS = 'Python exports that fit'
const PY_BAD = 'Python export abc into integer'
const LOG_PIECE = 'Log null piece'
const VS_NULL = 'Set vs_target to None'
const LOG_VS = 'Log vs_target'
const SH_TOKEN = 'Shell TOKEN given None'
const SH_ROW = 'Shell row 2 given None'
const PY_TEAM = 'Python TEAM given None'
const PY_ROW = 'Python row 2 given None'
const HTTP_NULL = 'HTTP null URL piece'
const PROBE_1 = 'HTTP retry probe 1'
const PROBE_2 = 'HTTP retry probe 2'
const SSH_OPEN = 'Open sshd'
const RX_MAIN = 'Remote body that runs'
const SH_BODY_EMPTY = 'Body shell entries left empty'
const SH_BODY_LIT = 'Body shell entries stored null'
const PY_BODY_EMPTY = 'Remote Python entries left empty'
const PY_BODY_LIT = 'Remote Python entries stored null'
const PY_BODY_BAD = 'Remote Python export abc into integer'
const PY_BODY_EXPORTS = 'Remote Python exports that fit'
const RX_SH_TOKEN = 'Body shell TOKEN given None'
const RX_SH_ROW = 'Body shell row 2 given None'
const RX_PY_TEAM = 'Remote Python TEAM given None'
const RX_PY_ROW = 'Remote Python row 2 given None'
const PROBE_LOCAL = 'Probe WAVE markers'
const PROBE_REMOTE = 'Probe sshd markers'
const SSH_CLOSE = 'Close sshd'
const BOOKEND_NODE = 'Bookend'

/** The Remote Execution container a failing body block sits in. */
function containerOf(blockName: string): string {
  return `Remote body for ${blockName}`
}

// Exact run-time messages (REQ-3.1.3.22, PYRUN-6).
const NULL_PIECE = "'{{ nothing }}' in 'url' is null"
const NULL_TOKEN = "'TOKEN' in 'input_vars' is null"
const NULL_TEAM = "'TEAM' in 'environment' is null"
const NULL_ROW_2 = "Row 2 in 'arguments' is null"
const BLANK_ROW_2 = "Row 2 in 'arguments' is required"
const BLANK_TOKEN = "'TOKEN' in 'input_vars' is required"
const BLANK_TEAM = "'TEAM' in 'environment' is required"
const EXPORT_REFUSED = "Script variable 'n_bad' is not a valid integer"
const HOST_FAILED = `Remote Execution failed on host '${SSH_TARGET_HOST}': `
const REMOTE_START_LINE = 'Running the script under python3 on the remote host'

const SHELL_EMPTY_OUT = 'n=2 1=[a] 2=[] token=set[]'
const PYTHON_EMPTY_OUT = "['a', '']\n''\n"
const LOCAL_PROBE_OUT =
  'sh-ok=present sh-lit=absent py-ok=present py-lit=absent body-sh-ok=present ' +
  'body-sh-lit=absent sh-token=absent sh-arg=absent py-team=absent py-arg=absent ' +
  'body-sh-token=absent body-sh-arg=absent dir=gone'
const REMOTE_PROBE_OUT = 'py-ok=present py-lit=absent py-team=absent py-arg=absent dir=gone'

function loadFixture(token: string): Fixture {
  const raw = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, 'fixture-text-scripts.json'), 'utf-8'),
  ) as Fixture
  return withToken(raw, token)
}

function nodeNamed(fixture: Fixture, name: string): FixtureNode {
  const found = fixture.workflow.nodes.filter((node) => node.data.label === name)
  expect(found, `the fixture must declare exactly one block named "${name}"`).toHaveLength(1)
  return found[0]
}

/** The SSH block must carry the harness constants, not a copy that drifted. */
function expectStackSshTarget(fixture: Fixture): void {
  const values = nodeNamed(fixture, SSH_OPEN).data.config.values
  expect(values.host, 'the fixture carries the host-mode sentinel the import helper rewrites').toBe(
    SSH_FIXTURE_HOST_SENTINEL,
  )
  expect(String(values.port), 'the fixture targets the stack sshd port').toBe(SSH_MAIN_PORT)
  expect(values.username, 'the fixture uses the stack SSH user').toBe(SSH_STACK_USER)
  expect(values.password, 'the fixture uses the stack SSH password').toBe(SSH_STACK_PASSWORD)
}

function caught(variables: SessionVariables, name: string): CaughtError {
  const value = sessionValue(variables, name)
  expect(value, `${name} must hold the caught error map`).toBeTruthy()
  return value as CaughtError
}

function text(variables: SessionVariables, name: string): string {
  return String(sessionValue(variables, name))
}

function linesWith(entries: readonly LogEntry[], message: string): LogEntry[] {
  return entries.filter((entry) => entry.message === message)
}

test.describe('V-NULL-TEXT-SCRIPTS-FUNCTIONAL: null in text pieces, script entries and script exports', () => {
  let testId: string | undefined

  test.afterAll(async ({ request }) => {
    await request.delete(`${BACKEND_URL}/workbench/session/`).catch(() => undefined)
    if (testId) await deleteTest(request, testId)
  })

  test('null pieces, script entries and exports on WAVE and on sshd', async ({ page }: { page: Page }) => {
    test.setTimeout(480_000)
    const token = newToken()
    const fixture = loadFixture(token)
    expectStackSshTarget(fixture)
    const id = (name: string): string => nodeNamed(fixture, name).id

    testId = await importValidateAndNavigate(page, fixture, { injectSsh: true, injectHttp: true })

    await test.step('the stored Test holds the literal nulls the API seeded', async () => {
      const stored = await persistedValues(page.request, testId as string)
      for (const name of [SH_LIT, SH_BODY_LIT]) {
        expect(stored[id(name)].input_vars, `${name} stores TOKEN as a literal null`).toEqual({
          TOKEN: null,
        })
        expect(stored[id(name)].arguments, `${name} stores row 2 as a literal null`).toEqual([
          { value: 'a' },
          { value: null },
        ])
      }
      for (const name of [PY_LIT, PY_BODY_LIT]) {
        expect(stored[id(name)].environment, `${name} stores TEAM as a literal null`).toEqual({
          TEAM: null,
        })
        expect(stored[id(name)].arguments, `${name} stores row 2 as a literal null`).toEqual([
          { value: 'a' },
          { value: null },
        ])
      }
      await expect(
        saveBtn(page),
        'the canvas holds the stored Test unchanged, so the run reads the nulls from storage',
      ).toBeDisabled()
    })

    await test.step('a save holding expression entries with nothing typed is refused naming each entry', async () => {
      const blank = (setting: string, key: string) => (data: Record<string, any>) => {
        data.config.values.arguments[1].value = ''
        data.config.values[setting][key] = ''
      }
      const shell = await refusedBlockSave(page.request, testId as string, id(SH_EMPTY), blank('input_vars', 'TOKEN'))
      expect(findingRows(shell).sort()).toEqual(
        [
          ['REQUIRED_PARAM_EMPTY', BLANK_ROW_2, id(SH_EMPTY)],
          ['REQUIRED_PARAM_EMPTY', BLANK_TOKEN, id(SH_EMPTY)],
        ].sort(),
      )
      const python = await refusedBlockSave(page.request, testId as string, id(PY_EMPTY), blank('environment', 'TEAM'))
      expect(findingRows(python).sort()).toEqual(
        [
          ['REQUIRED_PARAM_EMPTY', BLANK_ROW_2, id(PY_EMPTY)],
          ['REQUIRED_PARAM_EMPTY', BLANK_TEAM, id(PY_EMPTY)],
        ].sort(),
      )
    })

    const status = await startRun(page)
    await finishRun(page, status, `nulltext-done-${token}`, 360_000)
    const entries = await getLogEntries(page)
    const variables = await getSessionVariables(page, await getActiveSessionId(page))

    await test.step('every block that must pass passed, and the recorded exports painted amber', async () => {
      for (const name of [
        SH_EMPTY, SH_LIST, PY_EMPTY, PY_MAYBE, PY_EXPORTS, LOG_PIECE, VS_NULL, LOG_VS, PROBE_1,
        PROBE_2, SSH_OPEN, RX_MAIN, SH_BODY_EMPTY, PY_BODY_EMPTY, PY_BODY_EXPORTS, PROBE_LOCAL,
        PROBE_REMOTE, SSH_CLOSE, BOOKEND_NODE,
      ]) {
        await expectNodeStatus(page, id(name), 'success')
      }
      for (const name of [PY_BAD, PY_BODY_BAD]) {
        await expectNodeStatus(page, id(name), 'warning')
      }
    })

    await test.step('a null URL piece fails the HTTP block and no request is sent', async () => {
      const error = caught(variables, 'e_http')
      expect(error.message).toBe(NULL_PIECE)
      expect(error.node_id, 'the HTTP block itself failed').toBe(id(HTTP_NULL))
      await expectNodeStatus(page, id(HTTP_NULL), 'failed')
      expectConsoleLine(entries, 'ERROR', `Block '${HTTP_NULL}' failed: ${NULL_PIECE}`)
      expectConsoleLine(entries, 'WARN', `caught http-null: ${NULL_PIECE}`)
      expect(
        entries.filter((entry) => entry.message.includes('probe=')),
        `no request line for the null-piece URL may reach the console.\n${formatEntries(entries)}`,
      ).toHaveLength(0)
      // The echo service counts per key: a sent null-piece request would make this attempt 2.
      expect(sessionValue(variables, 'probe1_status'), 'the first probe is the first request').toBe(502)
      expect(JSON.parse(text(variables, 'probe1_body'))).toEqual({
        attempt: 1,
        fail_count: 1,
        message: 'Simulated failure 1/1',
      })
      expect(sessionValue(variables, 'probe2_status'), 'the counter really counts').toBe(200)
      expect(JSON.parse(text(variables, 'probe2_body'))).toEqual({
        attempt: 2,
        fail_count: 1,
        message: 'Success after retries',
      })
    })

    await test.step('a Log message prints a null piece as null', () => {
      expectConsoleLine(entries, 'INFO', 'null-piece nothing=null flag=true items=[1,null,2]')
    })

    await test.step('a Variable Setter expression row writing None sets null', () => {
      expect(sessionValue(variables, 'vs_target'), 'vs_target started at 9').toBeNull()
      expectConsoleLine(entries, 'INFO', 'vs_target=null')
    })

    await test.step('a Shell Script entry or row given None fails before the script starts', async () => {
      const cases: Array<[string, string, string, string]> = [
        ['e_sh_token', SH_TOKEN, 'sh-token', NULL_TOKEN],
        ['e_sh_arg', SH_ROW, 'sh-arg', NULL_ROW_2],
      ]
      for (const [variable, name, key, message] of cases) {
        const error = caught(variables, variable)
        expect(error.message, `${name} names what is null`).toBe(message)
        expect(error.node_id, `${name} itself failed`).toBe(id(name))
        await expectNodeStatus(page, id(name), 'failed')
        expectConsoleLine(entries, 'ERROR', `Block '${name}' failed: ${message}`)
        expectConsoleLine(entries, 'WARN', `caught ${key}: ${message}`)
      }
    })

    await test.step('inside a Remote Execution body the Shell Script fails the same way on WAVE', async () => {
      const cases: Array<[string, string, string, string]> = [
        ['e_rx_sh_token', RX_SH_TOKEN, 'rx-sh-token', NULL_TOKEN],
        ['e_rx_sh_arg', RX_SH_ROW, 'rx-sh-arg', NULL_ROW_2],
      ]
      for (const [variable, name, key, message] of cases) {
        expect(caught(variables, variable).message, `${name} names what is null`).toBe(message)
        await expectNodeStatus(page, id(name), 'failed')
        await expectNodeStatus(page, id(containerOf(name)), 'failed')
        expectConsoleLine(entries, 'ERROR', `Block '${name}' failed: ${message}`)
        expectConsoleLine(entries, 'ERROR', `Block '${containerOf(name)}' failed: ${message}`)
        expectConsoleLine(entries, 'WARN', `caught ${key}: ${message}`)
      }
    })

    await test.step('a Python environment entry or row given None fails before the script starts', async () => {
      const cases: Array<[string, string, string, string]> = [
        ['e_py_team', PY_TEAM, 'py-team', NULL_TEAM],
        ['e_py_arg', PY_ROW, 'py-arg', NULL_ROW_2],
      ]
      for (const [variable, name, key, message] of cases) {
        const error = caught(variables, variable)
        expect(error.message, `${name} names what is null`).toBe(message)
        expect(error.node_id, `${name} itself failed`).toBe(id(name))
        await expectNodeStatus(page, id(name), 'failed')
        expectConsoleLine(entries, 'ERROR', `Block '${name}' failed: ${message}`)
        expectConsoleLine(entries, 'WARN', `caught ${key}: ${message}`)
      }
    })

    await test.step('on sshd a Python entry or row given None fails on WAVE and nothing reaches the host', async () => {
      const cases: Array<[string, string, string, string]> = [
        ['e_rx_py_team', RX_PY_TEAM, 'rx-py-team', NULL_TEAM],
        ['e_rx_py_arg', RX_PY_ROW, 'rx-py-arg', NULL_ROW_2],
      ]
      for (const [variable, name, key, message] of cases) {
        expect(caught(variables, variable).message, `${name} names the host and what is null`).toBe(
          HOST_FAILED + message,
        )
        await expectNodeStatus(page, id(name), 'failed')
        await expectNodeStatus(page, id(containerOf(name)), 'failed')
        expectConsoleLine(entries, 'ERROR', `Block '${name}' failed: ${message}`)
        expectConsoleLine(
          entries,
          'ERROR',
          `Block '${containerOf(name)}' failed: ${HOST_FAILED}${message}`,
        )
        expectConsoleLine(entries, 'WARN', `caught ${key}: ${HOST_FAILED}${message}`)
      }
      // Each of the six remote Python Blocks announces its start; the marker files below show which ran.
      expect(
        linesWith(entries, REMOTE_START_LINE),
        `every remote Python Block writes one start line.\n${formatEntries(entries)}`,
      ).toHaveLength(6)
    })

    await test.step('entries stored as a literal null fail like None, on WAVE and inside a body', async () => {
      const cases: Array<[string, string, string, string, boolean]> = [
        ['e_sh_lit', SH_LIT, 'sh-lit', NULL_TOKEN, false],
        ['e_py_lit', PY_LIT, 'py-lit', NULL_TEAM, false],
        ['e_rx_sh_lit', SH_BODY_LIT, 'rx-sh-lit', NULL_TOKEN, true],
        ['e_rx_py_lit', PY_BODY_LIT, 'rx-py-lit', NULL_TEAM, true],
      ]
      for (const [variable, name, key, message, inBody] of cases) {
        const onHost = name === PY_BODY_LIT ? HOST_FAILED : ''
        expect(caught(variables, variable).message, `${name} names what is null`).toBe(onHost + message)
        await expectNodeStatus(page, id(name), 'failed')
        expectConsoleLine(entries, 'ERROR', `Block '${name}' failed: ${message}`)
        expectConsoleLine(entries, 'WARN', `caught ${key}: ${onHost}${message}`)
        if (inBody) {
          await expectNodeStatus(page, id(containerOf(name)), 'failed')
          expectConsoleLine(entries, 'ERROR', `Block '${containerOf(name)}' failed: ${onHost}${message}`)
        }
      }
    })

    await test.step('no script given None ever started: its marker file is missing', () => {
      expect(text(variables, 'local_probe'), 'markers on WAVE; the probe also removes them').toBe(
        LOCAL_PROBE_OUT,
      )
      expect(text(variables, 'remote_probe'), 'markers on sshd; the probe also removes them').toBe(
        REMOTE_PROBE_OUT,
      )
    })

    await test.step('a list with a null item reaches the script as JSON text', () => {
      expect(text(variables, 'sh_list_out')).toBe('[1,null,2]|[1,null,2]')
    })

    await test.step('Shell Script entries giving empty text arrive as empty text, on WAVE and in the body', () => {
      expect(text(variables, 'sh_empty_out'), 'two arguments, the second empty; TOKEN set and empty').toBe(
        SHELL_EMPTY_OUT,
      )
      expect(text(variables, 'sh_body_empty_out'), 'the same inside the body').toBe(SHELL_EMPTY_OUT)
    })

    await test.step('Python entries giving empty text arrive as empty text, on WAVE and on sshd', () => {
      expect(text(variables, 'py_empty_out'), 'sys.argv[1:] and repr of TEAM').toBe(PYTHON_EMPTY_OUT)
      expect(text(variables, 'py_body_empty_out'), 'the same on the remote host').toBe(
        PYTHON_EMPTY_OUT,
      )
    })

    await test.step('a Python input variable given None is None in the script', () => {
      expect(text(variables, 'py_maybe_out')).toBe('None\n')
      expect(text(variables, 'maybe_kind_v')).toBe('NoneType')
    })

    await test.step('a None export binds null and an export that fits binds, on WAVE and on sshd', () => {
      expect(sessionValue(variables, 'fit_v'), 'on WAVE the fitting export binds').toBe(42)
      expect(sessionValue(variables, 'none_v'), 'on WAVE the None export binds null').toBeNull()
      expect(sessionValue(variables, 'fit_rv'), 'on sshd the fitting export binds').toBe(42)
      expect(sessionValue(variables, 'none_rv'), 'on sshd the None export binds null').toBeNull()
    })

    await test.step('an export that does not fit fails the same way on WAVE and on sshd', () => {
      const sides: Array<[string, string, string, string, string]> = [
        [PY_BAD, 'bad_v', 'bad_err', 'bad_reason', 'bad_ok'],
        [PY_BODY_BAD, 'bad_rv', 'bad_rerr', 'bad_rreason', 'bad_rok'],
      ]
      for (const [name, bound, error, reason, ok] of sides) {
        expect(text(variables, error), `${name} names the export and the type`).toBe(EXPORT_REFUSED)
        expect(text(variables, reason), `${name} fails on its export`).toBe('OutputVariable')
        expect(sessionValue(variables, ok), `${name} did not pass`).toBe(false)
        expect(sessionValue(variables, bound), `${name} binds nothing: the variable keeps 7`).toBe(7)
      }
      expect(
        linesWith(entries, `Script failed (OutputVariable): ${EXPORT_REFUSED}`).filter(
          (entry) => entry.level === 'WARN',
        ),
        `one recorded failure line on WAVE and one on sshd.\n${formatEntries(entries)}`,
      ).toHaveLength(2)
    })
  })
})
