/**
 * V-RC-VARIABLE-EDITS: a variable edited between block runs
 * Wireframe: none (functional)
 * Design Decisions: VMGR-19, VMGR-63, VMGR-93, SECUI-1, SECUI-4
 * REQ: REQ-3.2.1.5, REQ-3.2.1.6, REQ-3.1.3.5, REQ-3.1.3.12, REQ-3.1.3.20
 *
 * Phase: functional-workflow. Each test imports one fixture of this folder and
 * drives the Variable Manager and Run Current through the UI.
 *
 * Pass Criteria:
 * 1. A variable added through the create window holds its preset 0, so the request
 *    refuses port 0; a pencil edit made after that run reaches the next Run Current,
 *    and so does the edit after it. A value a Variable Setter wrote outlives a later
 *    pencil edit until Reset.
 * 2. A Run Current inside a Function body binds the Function's input to the
 *    value of a Test variable edited after the last run.
 * 3. A Current-mode edit of an expression made after a run is evaluated by the
 *    next Run Current.
 * 4. A Current-mode edit of a Test expression made after a Run Scope on a
 *    Function is saved and reaches the next Run Current.
 * 5. Once a run has ended, the watcher's Current mode shows a pencil edit.
 * 6. A block output marked secret and bound to a plain variable stays masked in
 *    the next Run Current and in the panel.
 * 7. A variable a block filled and that is marked secret afterwards (the Save
 *    warning names it and is confirmed) is masked in the next Run Current.
 * 8. An integer variable declared with no value reads null in the null look; a
 *    Variable Setter that writes 0 to it makes its row show 0.
 * 9. A Current-mode edit staged before any run keeps a secret variable secret
 *    and runs a template as a template.
 */

import { leaveExpressionEditor } from '../../helpers/code-editor'
import { test, expect, type Locator, type Page } from '../../helpers/playwright-fixtures'
import { clickNodeKebabItem } from '../../helpers/canvas'
import {
  BACKEND_URL,
  HTTP_HEALTH_PORT,
  HTTP_TARGET_HOST,
  NETCAT_CLOSED_PORT,
} from '../../helpers/config'
import { getSessionVariables, injectHttpHost } from '../../helpers/fixture-import'
import {
  clearConsoleLogs,
  escapeRegExp,
  expectConsoleLine,
  formatEntries,
  getLogCopyTexts,
  getLogEntries,
  setConsoleMinimumLevel,
  type LogEntry,
} from '../../helpers/log-reader'
import { expectNullLook } from '../../helpers/null-look'
import { SECRET_MASK } from '../../helpers/secret-canary'
import {
  createSimpleVariable,
  openEditWindow,
  saveWindow,
  setWindowValue,
  valueSwitch,
  variableRow,
  windowSaveButton,
} from '../../helpers/variable-create'
import {
  confirmSecretPromotion,
  digIn,
  openBlockSheet,
  resetRun,
  saveBlockSheet,
  selectEnvironment,
} from '../../helpers/workbench'
import {
  closeInspector,
  importValidateOpen,
  openInspector,
  setMode,
} from '../var-current-edit/helpers'
import fs from 'fs'
import path from 'path'

type FixtureName = 'port' | 'logs' | 'secrets'
type RunEnd = { sessionId: string; verdict: string }

const STATUS = '[data-testid="workflow-status"]'
const TERMINAL = new Set(['passed', 'failed', 'stopped', 'skipped'])

// 9479 is the one port of the stack's published range that no service listens on.
const CLOSED_PORT = NETCAT_CLOSED_PORT

/** The body token http-echo answers on /secret-payload when the request names none. */
const BODY_TOKEN = 'cnr6-body-a1b2c3d4-epsilon-real-bytes'

const FIRST_SECRET = 'sk-first-111'
const STAGED_SECRET = 'sk-staged-222'

const healthUrl = (port: string): string => `http://${HTTP_TARGET_HOST}:${port}/health`

const PORT_REFUSAL_LINE = `Block 'Health Request' failed: URL port must be between 1 and 65535 (got '${healthUrl('0')}')`
const CLOSED_PORT_LINE = "Block 'Health Request' failed: [Errno 111] Connection refused"
const RESPONSE_OK = /^HTTP 200 OK \(\d+ms, \d+ B, application\/json\)$/

/** The DEBUG echo of a Log block's inputs in the print form, which holds the message the block printed. */
const inputsEcho = (message: string): RegExp =>
  new RegExp(`^Inputs: \\{.*"message":${escapeRegExp(JSON.stringify(message))}.*\\}$`)

/** The last DEBUG line of a block run: once it is rendered the run's console is complete. */
const completedLine = (blockName: string): string => `Completed '${blockName}'`

const requestLine = (port: string): RegExp =>
  new RegExp(`^HTTP GET ${escapeRegExp(healthUrl(port))} \\(timeout: [\\d.]+s\\)$`)

function loadFixture(name: FixtureName): Record<string, unknown> {
  const file = path.resolve(__dirname, `fixture-variable-edits-${name}.json`)
  return JSON.parse(fs.readFileSync(file, 'utf-8')) as Record<string, unknown>
}

/** Import a fixture, check it validates, open it, and pick the environment before any block menu. */
async function openFixture(page: Page, name: FixtureName): Promise<void> {
  await importValidateOpen(page, injectHttpHost(loadFixture(name)))
  await selectEnvironment(page)
}

const block = (page: Page, id: string): Locator =>
  page.locator(`[data-testid="workflow-node-${id}"]`)

const rowValue = (page: Page, name: string): Locator =>
  variableRow(page, name).locator('[data-testid^="variable-value-"]')

async function backendSession(page: Page): Promise<{ id: string; status: string }> {
  const response = await page.request.get(`${BACKEND_URL}/workbench/session`)
  const body = (await response.json().catch(() => null)) as {
    data?: { session_id?: string; status?: string }
  } | null
  return { id: body?.data?.session_id ?? '', status: body?.data?.status ?? '' }
}

async function emptyConsole(page: Page): Promise<void> {
  const clear = page
    .locator('[data-testid="console-panel-header"] button[aria-label="Clear console"]')
    .first()
  if ((await clear.count()) > 0 && (await clear.isEnabled())) await clearConsoleLogs(page)
}

/** Start a run on an empty console and wait until that run's own session ends. */
async function runToEnd(page: Page, what: string, start: () => Promise<void>): Promise<RunEnd> {
  const earlier = (await backendSession(page)).id
  await emptyConsole(page)
  await start()
  const end: RunEnd = { sessionId: '', verdict: '' }
  await expect
    .poll(
      async () => {
        const now = await backendSession(page)
        if (now.id !== earlier && TERMINAL.has(now.status)) {
          end.sessionId = now.id
          end.verdict = now.status
        }
        return end.verdict
      },
      { timeout: 60_000, intervals: [250, 500, 1_000], message: `${what} ends` },
    )
    .not.toBe('')
  await expect(page.locator(STATUS), `the page shows the verdict of ${what}`).toHaveAttribute(
    'data-status',
    end.verdict,
    { timeout: 15_000 },
  )
  return end
}

function runCurrent(page: Page, blockId: string): Promise<RunEnd> {
  return runToEnd(page, `Run Current on ${blockId}`, () =>
    clickNodeKebabItem(page, blockId, 'Run Current'),
  )
}

/** The console of the run that just ended, read once it carries `expected`. */
async function consoleWith(page: Page, expected: string | RegExp): Promise<LogEntry[]> {
  let entries: LogEntry[] = []
  await expect(async () => {
    entries = await getLogEntries(page)
    const found = entries.some((entry) =>
      typeof expected === 'string' ? entry.message === expected : expected.test(entry.message),
    )
    expect(found, `the console must carry ${String(expected)}.\n${formatEntries(entries)}`).toBe(true)
  }).toPass({ timeout: 15_000 })
  return entries
}

/** The sweep is only worth something if the DEBUG lines are rendered: one of them must match. */
function expectDebugLine(entries: readonly LogEntry[], pattern: RegExp): void {
  expect(
    entries.some((entry) => entry.level === 'DEBUG' && pattern.test(entry.message)),
    `the console must carry a DEBUG line matching ${String(pattern)}.\n${formatEntries(entries)}`,
  ).toBe(true)
}

function expectNoLine(entries: readonly LogEntry[], text: string, why: string): void {
  expect(
    entries.filter((entry) => entry.message.includes(text)).map((entry) => entry.message),
    why,
  ).toEqual([])
}

/** No rendered console line and no copied log text holds one of the clear values. */
async function expectNoClearValue(page: Page, values: readonly string[]): Promise<void> {
  const rendered = (await getLogEntries(page)).map((entry) => entry.message)
  const copied = await getLogCopyTexts(page)
  expect(rendered.length, 'the console holds the lines of the run').toBeGreaterThan(0)
  for (const value of values) {
    expect(
      rendered.filter((line) => line.includes(value)),
      `no rendered console line holds ${value}`,
    ).toEqual([])
    expect(
      copied.filter((line) => line.includes(value)),
      `no copied log text holds ${value}`,
    ).toEqual([])
  }
}

/** Replace an editor's whole text in one input, so quote and bracket pairing leaves it alone. */
async function replaceEditorText(page: Page, editor: Locator, text: string): Promise<void> {
  await editor.click()
  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.press('Delete')
  await page.keyboard.insertText(text)
  await expect(editor).toHaveText(text)
}

async function setExpressionParameter(
  page: Page,
  blockId: string,
  parameter: string,
  expression: string,
): Promise<void> {
  const sheet = await openBlockSheet(page, blockId)
  const editor = sheet.locator(`[data-testid="param-input-${parameter}"] .cm-content`)
  await replaceEditorText(page, editor, expression)
  await leaveExpressionEditor(editor)
  await saveBlockSheet(sheet)
}

/** Edit a number variable's definition with the row pencil: the Edit window opens on Initial. */
async function pencilEditNumber(page: Page, name: string, value: string): Promise<void> {
  const win = await openEditWindow(page, name)
  await expect(valueSwitch(win)).toHaveText('Initial')
  await setWindowValue(page, win, value)
  await saveWindow(page, win)
}

/** Open the variable's Edit window on its Current value and enter `text`; the window is left unsaved. */
async function draftCurrentEdit(page: Page, name: string, text: string): Promise<Locator> {
  const win = await openEditWindow(page, name, { view: 'Current' })
  await setWindowValue(page, win, text)
  return win
}

test.describe('V-RC-VARIABLE-EDITS: a variable edited between block runs', () => {
  test('a pencil edit after a block run reaches the next Run Current; a written value outlives it until Reset', async ({
    page,
  }) => {
    test.setTimeout(240_000)
    await openFixture(page, 'port')

    await test.step('add lport on the create preset 0; use it in the request URL and the Setter row', async () => {
      await createSimpleVariable(page, 'lport', { type: 'integer' })
      await expect(
        rowValue(page, 'lport'),
        'the create window presets the integer default',
      ).toHaveText('0')

      await setExpressionParameter(
        page,
        'http-health',
        'url',
        `f'http://${HTTP_TARGET_HOST}:{lport}/health'`,
      )

      const sheet = await openBlockSheet(page, 'set-port')
      const target = sheet.locator('[data-testid="varset-name-input-0"]')
      await target.click()
      await target.fill('lport')
      await target.press('Tab')
      const written = sheet.locator('[data-testid="scalar-edit-input"]')
      await written.fill(HTTP_HEALTH_PORT)
      await expect(target).toHaveValue('lport')
      await expect(written).toHaveValue(HTTP_HEALTH_PORT)
      await saveBlockSheet(sheet)
    })

    await test.step('Run Current on the preset 0: the request refuses port 0', async () => {
      const run = await runCurrent(page, 'http-health')
      expect(run.verdict, 'a URL with port 0 fails the block').toBe('failed')
      await expect(block(page, 'http-health')).toHaveAttribute('data-execution-status', 'failed')
      await consoleWith(page, PORT_REFUSAL_LINE)
    })

    await test.step('pencil edit to the health port: the next Run Current uses it', async () => {
      await pencilEditNumber(page, 'lport', HTTP_HEALTH_PORT)
      const run = await runCurrent(page, 'http-health')
      expect(run.verdict, 'the edited port reaches the request').toBe('passed')
      await expect(block(page, 'http-health')).toHaveAttribute('data-execution-status', 'success')
      const entries = await consoleWith(page, RESPONSE_OK)
      expect(
        entries.some((entry) => requestLine(HTTP_HEALTH_PORT).test(entry.message)),
        `the request goes to the edited port.\n${formatEntries(entries)}`,
      ).toBe(true)
      expectNoLine(entries, 'URL port must be between', 'the port-0 refusal is gone')
    })

    await test.step('pencil edit to a closed port: the next Run Current uses that one', async () => {
      await pencilEditNumber(page, 'lport', CLOSED_PORT)
      const run = await runCurrent(page, 'http-health')
      expect(run.verdict, 'nothing answers on the closed port').toBe('failed')
      await expect(block(page, 'http-health')).toHaveAttribute('data-execution-status', 'failed')
      const entries = await consoleWith(page, CLOSED_PORT_LINE)
      expect(
        entries.some((entry) => requestLine(CLOSED_PORT).test(entry.message)),
        `the request goes to the closed port.\n${formatEntries(entries)}`,
      ).toBe(true)
      expectNoLine(entries, 'URL port must be between', 'the request left with the edited port')
      expectNoLine(entries, 'HTTP 200', 'no listener answered')
    })

    await test.step('a Variable Setter writes the port: a later pencil edit does not replace it', async () => {
      const write = await runCurrent(page, 'set-port')
      expect(write.verdict, 'the Setter runs').toBe('passed')
      await expect(rowValue(page, 'lport'), 'the row shows the written value').toHaveText(
        HTTP_HEALTH_PORT,
      )

      await pencilEditNumber(page, 'lport', '0')
      const run = await runCurrent(page, 'http-health')
      expect(run.verdict, 'the written port still reaches the request').toBe('passed')
      await expect(block(page, 'http-health')).toHaveAttribute('data-execution-status', 'success')
      const entries = await consoleWith(page, RESPONSE_OK)
      expect(
        entries.some((entry) => requestLine(HTTP_HEALTH_PORT).test(entry.message)),
        `the request goes to the written port.\n${formatEntries(entries)}`,
      ).toBe(true)
      expectNoLine(entries, 'URL port must be between', 'the pencil edit to 0 is not used yet')
    })

    await test.step('Reset: the next Run Current reads the edited definition again', async () => {
      await resetRun(page)
      const run = await runCurrent(page, 'http-health')
      expect(run.verdict, 'the definition holds 0 after Reset').toBe('failed')
      await expect(block(page, 'http-health')).toHaveAttribute('data-execution-status', 'failed')
      await consoleWith(page, PORT_REFUSAL_LINE)
    })
  })

  test('a Run Current inside a Function body reads a Test variable edited after the last run', async ({
    page,
  }) => {
    test.setTimeout(180_000)
    await openFixture(page, 'logs')

    await test.step('Run Current at the Test level starts the session with the first value', async () => {
      const run = await runCurrent(page, 'log-top')
      expect(run.verdict).toBe('passed')
      await consoleWith(page, 'top port=8080')
    })

    await test.step('pencil edit, drill in, Run Current on the inner block: the input holds the edit', async () => {
      await pencilEditNumber(page, 'lport', '9090')
      await digIn(page, 'fn-port')
      await expect(block(page, 'inner-log')).toBeVisible({ timeout: 10_000 })

      const run = await runCurrent(page, 'inner-log')
      expect(run.verdict).toBe('passed')
      const entries = await consoleWith(page, 'inner port=9090')
      expectNoLine(entries, 'inner port=8080', 'the Function input is not bound to the old value')
      expectNoLine(entries, 'inner port=7070', 'the Function input is bound, not defaulted')
    })
  })

  test('a Current-mode edit of an expression after a run is evaluated by the next Run Current', async ({
    page,
  }) => {
    test.setTimeout(180_000)
    await openFixture(page, 'logs')

    await test.step('Run Current evaluates the saved source', async () => {
      const run = await runCurrent(page, 'log-url')
      expect(run.verdict).toBe('passed')
      await consoleWith(page, 'url=http://b')
    })

    await test.step('Current mode, Edit, new source, Save, Run Current: the new result', async () => {
      const win = await draftCurrentEdit(page, 'url', "'https://' + host + '/v2'")
      await saveWindow(page, win)

      const run = await runCurrent(page, 'log-url')
      expect(run.verdict).toBe('passed')
      const entries = await consoleWith(page, 'url=https://b/v2')
      expectNoLine(entries, 'url=http://b', 'the edited source is not dropped')
    })
  })

  test('a Current-mode edit of a Test expression after a Run Scope on a Function is saved', async ({
    page,
  }) => {
    test.setTimeout(180_000)
    await openFixture(page, 'logs')

    await test.step('drill in, Run Scope, drill out', async () => {
      await digIn(page, 'fn-port')
      await expect(block(page, 'inner-log')).toBeVisible({ timeout: 10_000 })
      const run = await runToEnd(page, 'Run Scope on the Function', () =>
        page.locator('[data-testid="run-button"]').click(),
      )
      expect(run.verdict).toBe('passed')
      // No run came before it, so the input takes its declared default.
      await consoleWith(page, 'inner port=7070')

      await page.locator('[data-testid="breadcrumb-back-arrow"]').click()
      await expect(block(page, 'log-url')).toBeVisible({ timeout: 10_000 })
    })

    await test.step('Current-mode edit of the expression: the save is accepted, no error toast', async () => {
      const win = await draftCurrentEdit(page, 'url', "'https://' + host + '/v2'")
      const save = windowSaveButton(win)
      await expect(save).not.toHaveAttribute('aria-disabled', 'true')
      const saved = page.waitForResponse(
        (response) =>
          response.request().method() === 'PATCH' &&
          /\/workbench\/[^/]+\/variables\/url$/.test(new URL(response.url()).pathname),
      )
      await save.click()
      expect((await saved).status(), 'the session of the Function run takes the edit').toBe(200)
      await expect(win).toBeHidden()
      await expect(
        page.locator('[data-toast]', { hasText: 'Current Value Not Saved' }),
      ).toHaveCount(0)
    })

    await test.step('the next Run Current evaluates the saved source', async () => {
      const run = await runCurrent(page, 'log-url')
      expect(run.verdict).toBe('passed')
      await consoleWith(page, 'url=https://b/v2')
    })
  })

  test('the inspect view Current mode shows a pencil edit made after the run ended', async ({
    page,
  }) => {
    test.setTimeout(180_000)
    await openFixture(page, 'logs')

    const first = await runCurrent(page, 'log-retries')
    expect(first.verdict).toBe('passed')
    await consoleWith(page, 'retries=3')

    await pencilEditNumber(page, 'retries', '8')

    const modal = await openInspector(page, 'retries')
    await expect(modal.locator('[data-testid="mode-dropdown"]')).toContainText('Current')
    await expect(
      modal.locator('[data-testid="scalar-body"]'),
      'Current shows the value the next block run reads',
    ).toHaveText('8')
    await setMode(page, modal, 'Initial')
    await expect(modal.locator('[data-testid="scalar-body"]')).toHaveText('8')
    await closeInspector(page, 'retries')

    const second = await runCurrent(page, 'log-retries')
    expect(second.verdict).toBe('passed')
    await consoleWith(page, 'retries=8')
  })

  test('a secret block output bound to a plain variable stays masked in the next Run Current', async ({
    page,
  }) => {
    test.setTimeout(180_000)
    await openFixture(page, 'secrets')
    await setConsoleMinimumLevel(page, 'DEBUG')

    await test.step('Run Current on the request: the marked body is masked', async () => {
      const run = await runCurrent(page, 'http-marked')
      expect(run.verdict).toBe('passed')
      const entries = await consoleWith(page, completedLine('Marked Request'))
      expectDebugLine(entries, /^Outputs: \{.*"body":"\*{8}".*\}$/)
      await expectNoClearValue(page, [BODY_TOKEN])
      await expect(rowValue(page, 'marked_body')).toHaveText(SECRET_MASK)
    })

    await test.step('Run Current on the Log that prints the variable: still masked', async () => {
      const run = await runCurrent(page, 'log-marked')
      expect(run.verdict).toBe('passed')
      const entries = await consoleWith(page, completedLine('Print Marked'))
      expectConsoleLine(entries, 'INFO', `marked=${SECRET_MASK}`)
      expectDebugLine(entries, inputsEcho(`marked=${SECRET_MASK}`))
      await expectNoClearValue(page, [BODY_TOKEN])
      await expect(rowValue(page, 'marked_body'), 'the panel keeps the mask').toHaveText(
        SECRET_MASK,
      )
      const variables = await getSessionVariables(page, run.sessionId)
      expect(variables.marked_body.value, 'the session read is masked').toBe(SECRET_MASK)
    })
  })

  test('a variable a block filled and that is marked secret afterwards is masked in the next Run Current', async ({
    page,
  }) => {
    test.setTimeout(180_000)
    await openFixture(page, 'secrets')
    await setConsoleMinimumLevel(page, 'DEBUG')

    await test.step('Run Current on the request fills the plain variable', async () => {
      const run = await runCurrent(page, 'http-filled')
      expect(run.verdict).toBe('passed')
      const entries = await consoleWith(page, completedLine('Filled Request'))
      expectDebugLine(entries, new RegExp(`^Outputs: \\{.*${escapeRegExp(BODY_TOKEN)}.*\\}$`))
      const variables = await getSessionVariables(page, run.sessionId)
      expect(String(variables.filled_body.value), 'the plain variable is readable').toContain(
        BODY_TOKEN,
      )
    })

    await test.step('tick Secret on the output row that binds the variable', async () => {
      const sheet = await openBlockSheet(page, 'http-filled')
      const secret = sheet.locator('[data-testid="output-secret-body"]')
      await secret.click()
      await expect(secret).toHaveAttribute('aria-checked', 'true')
      // Per SECUI-12: the Save asks before it makes the plain variable secret.
      await sheet.getByRole('button', { name: 'Save', exact: true }).click()
      await confirmSecretPromotion(page, ['filled_body'])
      await expect(sheet, 'the confirmed Save closes the sheet').toHaveCount(0)
      await expect(
        variableRow(page, 'filled_body').locator('[data-testid^="secret-badge-"]'),
        'the bound variable is secret now (SECUI-4)',
      ).toBeVisible()
    })

    await test.step('Run Current on the Log that prints it: the value is masked', async () => {
      const run = await runCurrent(page, 'log-filled')
      expect(run.verdict).toBe('passed')
      const entries = await consoleWith(page, completedLine('Print Filled'))
      expectConsoleLine(entries, 'INFO', `filled=${SECRET_MASK}`)
      expectDebugLine(entries, inputsEcho(`filled=${SECRET_MASK}`))
      await expectNoClearValue(page, [BODY_TOKEN])
      await expect(rowValue(page, 'filled_body'), 'the panel masks it').toHaveText(SECRET_MASK)
      const variables = await getSessionVariables(page, run.sessionId)
      expect(variables.filled_body.value, 'the session read is masked').toBe(SECRET_MASK)
    })
  })

  test('a Variable Setter that writes 0 to a variable holding null shows 0 on its row', async ({
    page,
  }) => {
    test.setTimeout(120_000)
    await openFixture(page, 'logs')
    await expectNullLook(rowValue(page, 'count'), 'the count row declared with no value')

    const run = await runCurrent(page, 'set-zero')
    expect(run.verdict).toBe('passed')

    await expect(rowValue(page, 'count'), 'the written 0 is a live value').toHaveText('0')
    const variables = await getSessionVariables(page, run.sessionId)
    expect(variables.count.value).toBe(0)
  })

  test('a Current-mode edit staged before any run keeps a secret secret and runs a template as a template', async ({
    page,
  }) => {
    test.setTimeout(180_000)
    await openFixture(page, 'logs')

    await test.step('add a secret variable and print it, its tail and the template', async () => {
      await createSimpleVariable(page, 'api_key', { value: FIRST_SECRET, secret: true })
      await setExpressionParameter(
        page,
        'log-staged',
        'message',
        "'tok=' + api_key + ' tpl=' + tpl + ' tail=' + api_key[3:]",
      )
    })

    await test.step('no run yet: Current-mode edit of the secret and of the template source', async () => {
      await saveWindow(page, await draftCurrentEdit(page, 'api_key', STAGED_SECRET))
      await saveWindow(page, await draftCurrentEdit(page, 'tpl', 'wss://{{ host }}'))
    })

    await test.step('Run Current: the staged secret is masked, the staged template is rendered', async () => {
      await setConsoleMinimumLevel(page, 'DEBUG')
      const run = await runCurrent(page, 'log-staged')
      expect(run.verdict).toBe('passed')
      // The slice shows which value ran; a sliced secret is readable by design (REQ-3.1.3.5).
      const printed = `tok=${SECRET_MASK} tpl=wss://b tail=${STAGED_SECRET.slice(3)}`
      const entries = await consoleWith(page, completedLine('Print Staged'))
      expectConsoleLine(entries, 'INFO', printed)
      expectDebugLine(entries, inputsEcho(printed))
      await expectNoClearValue(page, [STAGED_SECRET, FIRST_SECRET])
      await expect(rowValue(page, 'api_key'), 'the panel masks the secret').toHaveText(SECRET_MASK)
    })
  })
})
