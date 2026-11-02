/**
 * V-VMGR-EDITS-BETWEEN-RUNS: variable edits between block runs and while a run is paused
 * Wireframe: none (behavior of the existing Variable Manager rows and inspect view)
 * Design Decisions: VMGR-8, VMGR-9, VMGR-10, VMGR-12, VMGR-19, VMGR-93, VMGR-106, VMGR-107
 * REQ: REQ-3.2.1.5 (variable bootstrap of an ad-hoc run), REQ-3.2.1.6 (runtime variable override),
 *      REQ-3.1.3.20 (a declared variable with no value holds null)
 *
 * Phase: functional-workflow (each test imports its own fixture via POST /tests).
 *
 * Pass Criteria:
 * 1. A pencil edit of a variable a template reads drops the template's old result from its
 *    row; the next Run Current prints the new rendering and the row shows it.
 * 2. A pencil edit of the template source reaches the next Run Current.
 * 3. With no edit, two Run Current on a block that reads a per-evaluation value print the
 *    same value.
 * 4. After a run the Edit window's Current view shows the live value; a Current value given then
 *    to a variable a template reads shows on the row, leaves Initial unchanged and reaches the
 *    next Run Current.
 * 5. A Current value set before any run shows on the row, the next Run Current uses it,
 *    and Initial still shows the saved value.
 * 6. The Edit window's Current view of an evaluated expression shows its active source; a new
 *    Current source makes its row read "<not evaluated yet>"; the next Run Current prints the new
 *    result and the row shows it.
 * 7. A definition edited with the pencil while a run is paused (the pencil is enabled, VMGR-107):
 *    the row and Current keep the value the run started with and Continue prints it; the row's
 *    definition view and Initial show the edit; after the run ends the row shows the edit.
 * 8. A variable with no value that gets one while a run is paused: the row and Current read
 *    null in the null look, Initial shows the value, Continue prints Python's `slots=None`
 *    and the run passes; after the run ends the row and Current show the value.
 * 9. A row switched to the definition view stays there when a Current source edit drops the
 *    panel's last live value.
 */

import fs from 'fs'
import path from 'path'
import { test, expect, type Locator, type Page } from '../../helpers/playwright-fixtures'
import { clickNodeKebabItem } from '../../helpers/canvas'
import { releaseWorkbenchOwnership } from '../../helpers/fn-seed'
import { getLogTexts } from '../../helpers/log-reader'
import { expectNullLook } from '../../helpers/null-look'
import {
  cancelWindow,
  editPencil,
  expectWindowValue,
  openEditWindow,
  saveWindow,
  setWindowValue,
  valueSwitch,
} from '../../helpers/variable-create'
import { selectEnvironment, setCurrentValue } from '../../helpers/workbench'
import {
  clickContinue,
  clickEdit,
  closeInspector,
  expectPausedAt,
  importValidateOpen,
  openInspector,
  rowFor,
  saveEdit,
  setBreakpoint,
  setMode,
  startDebugRun,
  startRun,
  waitForStatus,
} from '../var-current-edit/helpers'

type FixtureName = 'template' | 'random' | 'expressions' | 'paused'

const NOT_EVALUATED = '<not evaluated yet>'

const TEMPLATE_SOURCE = 'http://api.example:{{ port }}/health'
const EDITED_TEMPLATE_SOURCE = 'https://api.example:{{ port }}/ready'
const GREETING_SOURCE = "'hello ' + name"
const GREETING_EDITED_SOURCE = "'hi ' + name"
const FAREWELL_SOURCE = "'bye ' + name"

const renderedUrl = (port: number): string => `http://api.example:${port}/health`

function loadFixture(name: FixtureName): Record<string, unknown> {
  const file = path.resolve(__dirname, `fixture-edits-between-runs-${name}.json`)
  return JSON.parse(fs.readFileSync(file, 'utf-8'))
}

/** Import a fixture, open it with the Variable Manager expanded, pick the environment. */
async function openFixture(page: Page, name: FixtureName): Promise<void> {
  await releaseWorkbenchOwnership(page.request)
  await importValidateOpen(page, loadFixture(name))
  await selectEnvironment(page)
}

const rowValue = (page: Page, name: string): Locator =>
  rowFor(page, name).locator('[data-testid^="variable-value-"]')

const eyeToggle = (page: Page, name: string): Locator =>
  rowFor(page, name).locator('[data-testid^="view-toggle-button-"]')

const inspectBody = (modal: Locator): Locator => modal.locator('[data-testid="scalar-body"]')

/** The inspect view's body text for a whole null (VMGR-93). */
const inspectNull = (modal: Locator): Locator => modal.getByText('null', { exact: true })

/** Wait until the console holds exactly `count` lines starting with `prefix`, in order. */
async function consoleLines(page: Page, prefix: string, count: number): Promise<string[]> {
  let lines: string[] = []
  await expect
    .poll(
      async () => {
        lines = (await getLogTexts(page)).filter((text) => text.startsWith(prefix))
        return lines.length
      },
      { timeout: 30_000, message: `expected ${count} console line(s) starting with "${prefix}"` },
    )
    .toBe(count)
  return lines
}

async function runCurrent(page: Page, nodeId: string): Promise<void> {
  await clickNodeKebabItem(page, nodeId, 'Run Current')
}

/** The row pencil: the Edit window opened on the definition (Initial). */
async function openPencil(page: Page, name: string): Promise<Locator> {
  const win = await openEditWindow(page, name)
  await expect(valueSwitch(win)).toHaveText('Initial')
  return win
}

async function pencilSetInteger(page: Page, name: string, value: string): Promise<void> {
  const win = await openPencil(page, name)
  await setWindowValue(page, win, value)
  await saveWindow(page, win)
}

async function pencilSetSource(page: Page, name: string, source: string): Promise<void> {
  const win = await openPencil(page, name)
  await setWindowValue(page, win, source)
  await saveWindow(page, win)
}

/** Open the inspect view, which starts in Current mode. */
async function openCurrent(page: Page, name: string): Promise<Locator> {
  const modal = await openInspector(page, name)
  await expect(modal.locator('[data-testid="mode-dropdown"]')).toHaveText('Current')
  return modal
}

/** Give an expression a new Current source from its watcher; the Edit window first shows the active one. */
async function setCurrentSource(page: Page, name: string, activeSource: string, source: string): Promise<void> {
  const watcher = await openCurrent(page, name)
  const win = await clickEdit(watcher)
  await expectWindowValue(win, activeSource)
  await setWindowValue(page, win, source)
  await saveEdit(win)
  await closeInspector(page, name)
}

/** The pencil is enabled while a run is paused (VMGR-107): it edits the definition on Initial. */
async function setInitialIntegerWhilePaused(page: Page, name: string, value: string): Promise<void> {
  await expect(editPencil(page, name)).not.toHaveAttribute('aria-disabled', 'true')
  const win = await openPencil(page, name)
  await setWindowValue(page, win, value)
  await saveWindow(page, win)
}

test.describe('V-VMGR-EDITS-BETWEEN-RUNS: an edit makes a computed variable evaluate again (REQ-3.2.1.5)', () => {
  test('a pencil edit of a variable a template reads reaches the next Run Current', async ({
    page,
  }) => {
    test.setTimeout(120_000)
    await openFixture(page, 'template')

    await startRun(page)
    expect(await consoleLines(page, 'base_url=', 1)).toEqual([`base_url=${renderedUrl(8080)}`])
    await waitForStatus(page, 'passed')
    await expect(rowValue(page, 'base_url')).toHaveText(renderedUrl(8080))

    await pencilSetInteger(page, 'port', '9090')
    await expect(rowValue(page, 'port')).toHaveText('9090')
    // The old rendering is dropped at the edit; a template row then reads its source.
    await expect(rowValue(page, 'base_url')).toHaveText(TEMPLATE_SOURCE)

    await runCurrent(page, 'log-url')
    expect(await consoleLines(page, 'base_url=', 2)).toEqual([
      `base_url=${renderedUrl(8080)}`,
      `base_url=${renderedUrl(9090)}`,
    ])
    await expect(rowValue(page, 'base_url')).toHaveText(renderedUrl(9090))
  })

  test('a pencil edit of the template source reaches the next Run Current', async ({ page }) => {
    test.setTimeout(120_000)
    await openFixture(page, 'template')

    await startRun(page)
    expect(await consoleLines(page, 'base_url=', 1)).toEqual([`base_url=${renderedUrl(8080)}`])
    await waitForStatus(page, 'passed')

    await pencilSetSource(page, 'base_url', EDITED_TEMPLATE_SOURCE)

    await runCurrent(page, 'log-url')
    expect(await consoleLines(page, 'base_url=', 2)).toEqual([
      `base_url=${renderedUrl(8080)}`,
      'base_url=https://api.example:8080/ready',
    ])
    await expect(rowValue(page, 'base_url')).toHaveText('https://api.example:8080/ready')
  })

  test('with no edit, two Run Current read the same per-evaluation value', async ({ page }) => {
    test.setTimeout(120_000)
    await openFixture(page, 'random')

    await runCurrent(page, 'log-token')
    const [first] = await consoleLines(page, 'token=', 1)
    // Three object addresses: an evaluation that ran again would print other ones.
    expect(first).toMatch(/^token=\[(<map object at 0x[0-9a-f]+>(, )?){3}\]$/)
    await waitForStatus(page, 'passed')

    await runCurrent(page, 'log-token')
    const lines = await consoleLines(page, 'token=', 2)
    expect(lines[1]).toBe(first)
  })

  test('a Current value of a variable a template reads reaches the next Run Current', async ({
    page,
  }) => {
    test.setTimeout(120_000)
    await openFixture(page, 'template')

    await startRun(page)
    expect(await consoleLines(page, 'base_url=', 1)).toEqual([`base_url=${renderedUrl(8080)}`])
    await waitForStatus(page, 'passed')

    // The ended run's live value is what the window's Current view starts from.
    const win = await openEditWindow(page, 'port', { view: 'Current' })
    await expectWindowValue(win, 8080)
    await setWindowValue(page, win, 7070)
    await saveWindow(page, win)
    await expect(rowValue(page, 'port')).toHaveText('7070')
    const reopened = await openPencil(page, 'port')
    await expectWindowValue(reopened, 8080)
    await cancelWindow(page, reopened)

    await runCurrent(page, 'log-url')
    expect(await consoleLines(page, 'base_url=', 2)).toEqual([
      `base_url=${renderedUrl(8080)}`,
      `base_url=${renderedUrl(7070)}`,
    ])
  })
})

test.describe('V-VMGR-EDITS-BETWEEN-RUNS: a Current edit shows on the row (REQ-3.2.1.6, VMGR-8)', () => {
  test('a Current value set before any run shows on the row and the next Run Current uses it', async ({
    page,
  }) => {
    test.setTimeout(120_000)
    await openFixture(page, 'template')
    await waitForStatus(page, 'idle')
    await expect(rowValue(page, 'port')).toHaveText('8080')

    const modal = await setCurrentValue(page, 'port', '7070')
    await expect(inspectBody(modal)).toHaveText('7070')
    await setMode(page, modal, 'Initial')
    await expect(inspectBody(modal)).toHaveText('8080')
    await closeInspector(page, 'port')
    await expect(rowValue(page, 'port')).toHaveText('7070')

    await runCurrent(page, 'log-port')
    expect(await consoleLines(page, 'port=', 1)).toEqual(['port=7070'])
  })

  test('a Current source edit after a run reads as not evaluated yet until the next Run Current', async ({
    page,
  }) => {
    test.setTimeout(120_000)
    await openFixture(page, 'expressions')

    await startRun(page)
    expect(await consoleLines(page, 'greeting=', 1)).toEqual(['greeting=hello Ada'])
    expect(await consoleLines(page, 'farewell=', 1)).toEqual(['farewell=bye Ada'])
    await waitForStatus(page, 'passed')
    await expect(rowValue(page, 'greeting')).toHaveText('hello Ada')

    await setCurrentSource(page, 'greeting', GREETING_SOURCE, GREETING_EDITED_SOURCE)
    await expect(rowValue(page, 'greeting')).toHaveText(NOT_EVALUATED)
    await expect(rowValue(page, 'farewell')).toHaveText('bye Ada')

    await runCurrent(page, 'log-greeting')
    expect(await consoleLines(page, 'greeting=', 2)).toEqual([
      'greeting=hello Ada',
      'greeting=hi Ada',
    ])
    await expect(rowValue(page, 'greeting')).toHaveText('hi Ada')
  })
})

test.describe('V-VMGR-EDITS-BETWEEN-RUNS: a paused run keeps the value it started with (VMGR-19)', () => {
  test('a definition edited while paused: the row and Current keep the run value and Continue uses it', async ({
    page,
  }) => {
    test.setTimeout(120_000)
    await openFixture(page, 'paused')
    await setBreakpoint(page, 'gate')
    await startDebugRun(page)
    await expectPausedAt(page, 'gate')

    const modal = await openCurrent(page, 'port')
    await expect(inspectBody(modal)).toHaveText('8080')
    await setInitialIntegerWhilePaused(page, 'port', '9090')
    await expect(inspectBody(modal)).toHaveText('8080')
    await setMode(page, modal, 'Initial')
    await expect(inspectBody(modal)).toHaveText('9090')
    await setMode(page, modal, 'Current')
    await expect(inspectBody(modal)).toHaveText('8080')
    await closeInspector(page, 'port')

    await expect(rowValue(page, 'port')).toHaveText('8080')
    await eyeToggle(page, 'port').click()
    await expect(rowValue(page, 'port')).toHaveText('9090')
    await eyeToggle(page, 'port').click()
    await expect(rowValue(page, 'port')).toHaveText('8080')

    await clickContinue(page)
    await waitForStatus(page, 'passed')
    expect(await consoleLines(page, 'port=', 1)).toEqual(['port=8080'])
    await expect(rowValue(page, 'port')).toHaveText('9090')
  })

  test('a variable with no value given one while paused reads null until the run ends', async ({
    page,
  }) => {
    test.setTimeout(120_000)
    await openFixture(page, 'paused')
    await setBreakpoint(page, 'gate')
    await startDebugRun(page)
    await expectPausedAt(page, 'gate')
    await expectNullLook(rowValue(page, 'slots'), 'the slots row while paused')

    const modal = await openCurrent(page, 'slots')
    await expectNullLook(inspectNull(modal), 'the slots watcher in Current mode')
    await setInitialIntegerWhilePaused(page, 'slots', '5')
    await expectNullLook(inspectNull(modal), 'the slots watcher still in Current mode')
    await setMode(page, modal, 'Initial')
    await expect(inspectBody(modal)).toHaveText('5')
    await setMode(page, modal, 'Current')
    await expectNullLook(inspectNull(modal), 'the slots watcher back in Current mode')
    await closeInspector(page, 'slots')
    await expectNullLook(rowValue(page, 'slots'), 'the slots row after the Initial edit')

    await clickContinue(page)
    await waitForStatus(page, 'passed')
    // The run started with slots null; a Python f-string writes it as None.
    expect(await consoleLines(page, 'slots=', 1)).toEqual(['slots=None'])

    await expect(rowValue(page, 'slots')).toHaveText('5')
    const after = await openCurrent(page, 'slots')
    await expect(inspectBody(after)).toHaveText('5')
  })
})

test.describe('V-VMGR-EDITS-BETWEEN-RUNS: the eye toggles outlive the last live value (VMGR-10)', () => {
  test('a row in the definition view stays there when a Current source edit drops the last live value', async ({
    page,
  }) => {
    test.setTimeout(120_000)
    await openFixture(page, 'expressions')

    // Only greeting is evaluated, so its result is the panel's only live value.
    await runCurrent(page, 'log-greeting')
    expect(await consoleLines(page, 'greeting=', 1)).toEqual(['greeting=hello Ada'])
    await waitForStatus(page, 'passed')
    await expect(rowValue(page, 'greeting')).toHaveText('hello Ada')
    await expect(rowValue(page, 'farewell')).toHaveText(NOT_EVALUATED)

    await eyeToggle(page, 'farewell').click()
    await expect(rowValue(page, 'farewell')).toHaveText(FAREWELL_SOURCE)
    await expect(rowValue(page, 'farewell')).toHaveClass(/(^|\s)italic(\s|$)/)

    await setCurrentSource(page, 'greeting', GREETING_SOURCE, GREETING_EDITED_SOURCE)
    await expect(rowValue(page, 'greeting')).not.toHaveText('hello Ada')
    await expect(rowValue(page, 'farewell')).toHaveText(FAREWELL_SOURCE)
    await expect(rowValue(page, 'farewell')).toHaveClass(/(^|\s)italic(\s|$)/)
    await expect(eyeToggle(page, 'farewell').locator('svg.lucide-eye-off')).toHaveCount(1)

    // With a live value back in the panel the two views of farewell differ again.
    await runCurrent(page, 'log-greeting')
    expect(await consoleLines(page, 'greeting=', 2)).toEqual([
      'greeting=hello Ada',
      'greeting=hi Ada',
    ])
    await expect(rowValue(page, 'greeting')).toHaveText('hi Ada')
    await expect(rowValue(page, 'farewell')).toHaveText(FAREWELL_SOURCE)
    await eyeToggle(page, 'farewell').click()
    await expect(rowValue(page, 'farewell')).toHaveText(NOT_EVALUATED)
  })
})
