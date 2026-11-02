/**
 * V-VMGR-WINDOW-FUNCTIONAL: a Test variable and a Function local edited through the one window
 * Design Decisions: VMGR-64, VMGR-97, VMGR-106, VMGR-108, VMGR-109, VMGR-110, VMGR-111, SECUI-1
 * REQ: REQ-3.1.3.5, REQ-3.1.3.11, REQ-3.1.3.13, REQ-3.1.3.14, REQ-3.1.3.20, REQ-3.1.3.24
 *
 * Pass Criteria:
 * 1. The pencil on a Test variable and on a Function local opens a window titled `Edit variable`
 *    showing the saved Name, Type, Kind and value on the Initial view; Save closes it, the row
 *    shows the new value, and the value is there after the Test save and a reload.
 * 2. A rename shows `Renaming updates all references to <old> across the test.` (`across the
 *    Function.` for a local); the saved Test holds the old name nowhere and both readers log the
 *    value under the new name.
 * 3. A retype asks `Change variable type?`; Cancel keeps the type and value; Change type resets the
 *    value to the new type's default, saved and logged.
 * 4. Set to null in Edit saves null and the run log prints `null`.
 * 5. Mark as secret on: the saved value reads back masked and the run log masks it; off: the value
 *    is cleared, the saved variable is plain and the run logs the empty value.
 * 6. Expression to Literal asks `Change variable kind?`; Cancel keeps the expression; Change kind
 *    shows `0` on Initial and Current, saves a Literal 0 and the run logs it; Literal to Expression
 *    asks the same and shows an empty expression box.
 * 7. A Current value set before a run is what the run logs; the saved Test keeps its Initial value.
 * 8. A Float field stops a 29th significant digit with no error, its /28 counter muted then red at
 *    the cap; an Integer field counts digits to /19; letters are refused as typed; a Boolean is a
 *    true / false control; the run logs each saved value exactly.
 * 9. With a 64-character name the rename notice keeps the old name inside its box, the window has no
 *    horizontal scrollbar, and Run over an unsaved Current value shows `Unsaved Current value` with
 *    the name inside the dialog; Cancel starts nothing.
 */

import {
  test,
  expect,
  type APIRequestContext,
  type Locator,
  type Page,
} from '../../helpers/playwright-fixtures'
import { BACKEND_URL } from '../../helpers/config'
import { importValidateAndNavigate } from '../../helpers/fixture-import'
import { openTest } from '../../helpers/fn-seed'
import { formatEntries, getLogCopyTexts, waitForLogText, type LogEntry } from '../../helpers/log-reader'
import {
  answerChangeConfirm,
  answerRemoveSecret,
  cancelWindow,
  expandVariableManager,
  expectWindowValue,
  makeSecretQuestion,
  openEditWindow,
  renameInWindow,
  renameNotice,
  saveWindow,
  setCreateKind,
  setCreateType,
  setValueView,
  setWindowCheckbox,
  setWindowValue,
  valueField,
  valueSwitch,
  variableRow,
  windowCheckbox,
  windowSaveButton,
} from '../../helpers/variable-create'
import {
  digIn,
  popToBreadcrumbSegment,
  saveTest,
  selectEnvironment,
  setCurrentValue,
} from '../../helpers/workbench'
import { blockSource, consoleEntriesFromCopy } from '../shell-blocks/shell-helpers'
import fs from 'fs'
import path from 'path'

const FN_ID = 'f8fa8daf-5b50-4377-97d6-2cf6fba917c4'
const TEST_NAME = /v-vmgr-window-functional/
const DONE = 'window-done'
const MASK = '********'
const TOKEN_CANARY = 'tok-canary-71x'
const OLD_SECRET_CANARY = 'old-canary-93z'
const LONG = 'a_long_variable_name_that_fills_every_one_of_its_sixty_four_char'
const FLOAT_28 = '1.234567890123456789012345678'
const INT_19 = '1234567890123456789'

type Rec = Record<string, unknown>

interface StoredTest {
  variables: Record<string, Rec>
  workflow: { nodes: Array<{ id: string; data: Rec & { label?: string; config?: { values?: Rec } } }> }
}

function loadFixture(): Rec {
  return JSON.parse(fs.readFileSync(path.resolve(__dirname, 'vmgr-window-fixture.json'), 'utf-8')) as Rec
}

async function readStored(request: APIRequestContext, testId: string): Promise<StoredTest> {
  const resp = await request.get(`${BACKEND_URL}/tests/${testId}`)
  expect(resp.ok(), `GET /tests/${testId} failed: ${resp.status()}`).toBeTruthy()
  return (await resp.json()).data as StoredTest
}

function storedMessage(stored: StoredTest, label: string): unknown {
  const node = stored.workflow.nodes.find((entry) => entry.data.label === label)
  expect(node, `Block ${label} is stored`).toBeTruthy()
  return node?.data.config?.values?.message
}

function storedLocal(stored: StoredTest, name: string): Rec | undefined {
  const fn = stored.workflow.nodes.find((node) => node.id === FN_ID)
  const locals = ((fn?.data.localDefinition as Rec | undefined)?.variables ?? []) as Rec[]
  return locals.find((entry) => entry.name === name)
}

function rowValue(page: Page, name: string): Locator {
  return variableRow(page, name).locator('[data-testid^="variable-value-"]')
}

function rowBadge(page: Page, name: string, kind: 'type' | 'secret' | 'expr'): Locator {
  return variableRow(page, name).locator(`[data-testid^="${kind}-badge-"]`)
}

const numberBox = (win: Locator): Locator => valueField(win).getByTestId('scalar-edit-input')
const digitCounter = (win: Locator): Locator => valueField(win).getByTestId('scalar-edit-counter')
const typeSelect = (win: Locator): Locator => win.getByTestId('create-type-select')
const kindSelect = (win: Locator): Locator => win.getByTestId('create-kind-select')

/** The window shows a saved definition: its title, Type, Kind and the Initial view. */
async function expectSavedDefinition(win: Locator, type: string, kind: string): Promise<void> {
  await expect(win).toHaveAttribute('aria-label', 'Edit variable')
  await expect(typeSelect(win)).toHaveText(new RegExp(`^${type}`))
  await expect(kindSelect(win)).toHaveText(kind)
  await expect(valueSwitch(win)).toHaveText('Initial')
}

/** An open confirm by its title, with exactly this description. */
async function expectQuestion(page: Page, title: string, description: string): Promise<void> {
  const dialog = page.getByRole('alertdialog', { name: title })
  await expect(dialog.getByText(description, { exact: true })).toBeVisible()
}

/** Run the Test to its closing Log and return every console entry with its full source. */
async function runAndRead(page: Page): Promise<LogEntry[]> {
  await page.locator('[data-testid="run-button"]').click()
  await waitForLogText(page, DONE, 90_000)
  await expect(page.locator('[data-testid="workflow-status"]')).toHaveAttribute('data-status', 'passed')
  return consoleEntriesFromCopy(await getLogCopyTexts(page))
}

function logOf(entries: readonly LogEntry[], label: string): string[] {
  const source = blockSource('Log', label)
  return entries.filter((entry) => entry.source === source).map((entry) => entry.message)
}

/** The window body never scrolls sideways; the Name field's own scrollbar is by design. */
async function expectNoSidewaysScroll(win: Locator): Promise<void> {
  const overflowing = await win.getByTestId('create-variable-name').evaluate((field) => {
    const root = field.closest('[data-testid="variable-create-modal"]')
    const boxes: Element[] = []
    for (let el = field.parentElement; el && root?.contains(el); el = el.parentElement) boxes.push(el)
    return boxes
      .filter((el) => {
        const style = getComputedStyle(el)
        return ['auto', 'scroll'].includes(style.overflowX) && el.scrollWidth > el.clientWidth + 1
      })
      .map((el) => el.outerHTML.slice(0, 120))
  })
  expect(overflowing, 'the window body shows no horizontal scrollbar').toEqual([])
}

/** `inner` lies inside `outer` from left to right. */
async function expectInside(inner: Locator, outer: Locator, what: string): Promise<void> {
  const a = await inner.boundingBox()
  const b = await outer.boundingBox()
  if (!a || !b) throw new Error(`${what}: both boxes must render`)
  expect(a.x, `${what}: left edge`).toBeGreaterThanOrEqual(b.x - 0.5)
  expect(a.x + a.width, `${what}: right edge`).toBeLessThanOrEqual(b.x + b.width + 0.5)
}

test.describe('V-VMGR-WINDOW-FUNCTIONAL: a Test variable through the one window', () => {
  let testId = ''

  test.afterEach(async ({ request }) => {
    await request.delete(`${BACKEND_URL}/workbench/session/`).catch(() => undefined)
    if (testId) await request.delete(`${BACKEND_URL}/tests/${testId}`).catch(() => undefined)
    testId = ''
  })

  test('rename, retype, Set to null, Mark as secret on and off, a Kind change and a Function local: saved, reloaded and run', async ({
    page,
    request,
  }) => {
    test.setTimeout(300_000)
    testId = await importValidateAndNavigate(page, loadFixture())
    await expandVariableManager(page)

    await test.step('VMGR-106: the pencil opens Edit variable on the saved definition; a rename and a value save together', async () => {
      const win = await openEditWindow(page, 'item_id')
      await expectSavedDefinition(win, 'Integer', 'Literal')
      await expectWindowValue(win, '7')
      await renameInWindow(win, 'part_id')
      await expect(renameNotice(win)).toHaveText('Renaming updates all references to item_id across the test.')
      await setWindowValue(page, win, 8)
      await saveWindow(page, win)
      await expect(rowValue(page, 'part_id')).toHaveText('8')
      await expect(variableRow(page, 'item_id')).toHaveCount(0)
    })

    await test.step('VMGR-108: a retype asks first; Cancel keeps the value, Change type resets it', async () => {
      const win = await openEditWindow(page, 'retyped')
      await expectWindowValue(win, 'abc')
      const question = 'Changing type to integer will clear 1 existing string value. This cannot be undone.'
      await setCreateType(page, 'integer', win)
      await expectQuestion(page, 'Change variable type?', question)
      await answerChangeConfirm(page, 'Cancel')
      await expect(typeSelect(win)).toHaveText(/^String/)
      await expectWindowValue(win, 'abc')

      await setCreateType(page, 'integer', win)
      await expectQuestion(page, 'Change variable type?', question)
      await answerChangeConfirm(page, 'Change type')
      await expect(typeSelect(win)).toHaveText(/^Integer/)
      await expectWindowValue(win, '0')
      await saveWindow(page, win)
      await expect(rowValue(page, 'retyped')).toHaveText('0')
      await expect(rowBadge(page, 'retyped', 'type')).toHaveText('integer')
    })

    await test.step('VMGR-97: Set to null in Edit saves null', async () => {
      const win = await openEditWindow(page, 'maybe')
      await expectWindowValue(win, 'present')
      await setWindowValue(page, win, null)
      await expectWindowValue(win, null)
      await saveWindow(page, win)
      await expect(rowValue(page, 'maybe')).toHaveText('null')
    })

    await test.step('VMGR-109: Mark as secret on asks at Save, then the variable is a secret', async () => {
      const win = await openEditWindow(page, 'token')
      await setWindowCheckbox(win, 'secret', true)
      await windowSaveButton(win).click()
      const question = makeSecretQuestion(page)
      await expect(
        question.getByText(
          'Saving makes the plain variable token a secret. Its value is masked from then on. Making it plain again clears its value.',
          { exact: true },
        ),
      ).toBeVisible()
      await question.getByRole('button', { name: 'Make secret and save', exact: true }).click()
      await expect(win).toBeHidden()
      await expect(rowBadge(page, 'token', 'secret')).toBeVisible()
    })

    await test.step('VMGR-109: Mark as secret off on a saved secret asks, then clears the value', async () => {
      const win = await openEditWindow(page, 'old_secret')
      await windowCheckbox(win, 'secret').click()
      await expectQuestion(
        page,
        'Remove Secret Protection?',
        'Removing secret protection will permanently delete the stored value. This action cannot be undone.',
      )
      await answerRemoveSecret(page, 'Remove & Delete Value')
      await expect(windowCheckbox(win, 'secret')).toHaveAttribute('data-state', 'unchecked')
      await expectWindowValue(win, '')
      await saveWindow(page, win)
      await expect(rowBadge(page, 'old_secret', 'secret')).toHaveCount(0)
      await expect(rowValue(page, 'old_secret')).toHaveText('')
    })

    await test.step('VMGR-108: Expression to Literal asks; Cancel keeps the expression; Change kind shows 0 on both values', async () => {
      const win = await openEditWindow(page, 'calc')
      await expect(kindSelect(win)).toHaveText('Expression')
      await expectWindowValue(win, '2 + 3')
      const toLiteral = 'Changing kind to literal will clear the existing expression. This cannot be undone.'

      await setCreateKind(page, 'Literal', win)
      await expectQuestion(page, 'Change variable kind?', toLiteral)
      await answerChangeConfirm(page, 'Cancel')
      await expect(kindSelect(win)).toHaveText('Expression')
      await expectWindowValue(win, '2 + 3')

      await setCreateKind(page, 'Literal', win)
      await expectQuestion(page, 'Change variable kind?', toLiteral)
      await answerChangeConfirm(page, 'Change kind')
      await expect(kindSelect(win)).toHaveText('Literal')
      await expectWindowValue(win, '0')
      await setValueView(page, win, 'Current')
      await expectWindowValue(win, '0')
      await setValueView(page, win, 'Initial')

      await setCreateKind(page, 'Expression', win)
      await expectQuestion(
        page,
        'Change variable kind?',
        'Changing kind to expression will clear 1 existing integer value. This cannot be undone.',
      )
      await answerChangeConfirm(page, 'Change kind')
      await expect(kindSelect(win)).toHaveText('Expression')
      await expectWindowValue(win, '')

      await setCreateKind(page, 'Literal', win)
      await answerChangeConfirm(page, 'Change kind')
      await expectWindowValue(win, '0')
      await saveWindow(page, win)
      await expect(rowValue(page, 'calc')).toHaveText('0')
      await expect(rowBadge(page, 'calc', 'expr')).toHaveCount(0)
    })

    await test.step('VMGR-106: a Function local opens the same window; its rename notice names the Function', async () => {
      await digIn(page, FN_ID)
      const win = await openEditWindow(page, 'fn_count')
      await expectSavedDefinition(win, 'Integer', 'Literal')
      await expectWindowValue(win, '5')
      await renameInWindow(win, 'fn_total')
      await expect(renameNotice(win)).toHaveText('Renaming updates all references to fn_count across the Function.')
      await renameInWindow(win, 'fn_count')
      await expect(renameNotice(win)).toHaveCount(0)
      await setWindowValue(page, win, 6)
      await saveWindow(page, win)
      await expect(rowValue(page, 'fn_count')).toHaveText('6')
      await popToBreadcrumbSegment(page, TEST_NAME)
    })

    await test.step('the saved Test holds every change and the old name nowhere', async () => {
      await saveTest(page)
      const stored = await readStored(request, testId)
      const vars = stored.variables
      expect(
        JSON.stringify({ workflow: stored.workflow, variables: vars }),
        'the old name survives nowhere',
      ).not.toContain('item_id')
      expect(vars.part_id.type).toBe('integer')
      expect(String(vars.part_id.value)).toBe('8')
      expect(storedMessage(stored, 'Read Item')).toBe('f"item={part_id}"')
      expect(storedMessage(stored, 'Item Template')).toBe('tmpl item={{ part_id }}')
      expect(vars.retyped.type).toBe('integer')
      expect(String(vars.retyped.value)).toBe('0')
      expect(vars.maybe).toMatchObject({ type: 'string', value: null })
      expect(vars.token).toMatchObject({ type: 'string', secret: true, value: MASK })
      expect(vars.old_secret).toMatchObject({ type: 'string', value: '' })
      expect(vars.old_secret.secret ?? false, 'old_secret is plain').toBe(false)
      expect(vars.calc.type).toBe('integer')
      expect(String(vars.calc.value)).toBe('0')
      expect(vars.calc.isExpression ?? false, 'calc is a Literal').toBe(false)
      expect(String(vars.staged.value)).toBe('1')
      const fnCount = storedLocal(stored, 'fn_count')
      expect(fnCount?.type).toBe('integer')
      expect(String(fnCount?.value)).toBe('6')
    })

    await test.step('after a reload every value is still there', async () => {
      await openTest(page, testId)
      await expandVariableManager(page)
      await expect(rowValue(page, 'part_id')).toHaveText('8')
      await expect(rowValue(page, 'retyped')).toHaveText('0')
      await expect(rowValue(page, 'maybe')).toHaveText('null')
      await expect(rowValue(page, 'token')).toHaveText(MASK)
      await expect(rowValue(page, 'old_secret')).toHaveText('')
      await expect(rowValue(page, 'calc')).toHaveText('0')
      const win = await openEditWindow(page, 'part_id')
      await expectWindowValue(win, '8')
      await cancelWindow(page, win)
    })

    await test.step('VMGR-108: a Current value set before the run is staged', async () => {
      await setCurrentValue(page, 'staged', 42)
      await expect(rowValue(page, 'staged')).toHaveText('42')
    })

    await test.step('REQ-3.1.3.5, REQ-3.1.3.24: the run reads every saved change and the staged Current value', async () => {
      await selectEnvironment(page)
      const entries = await runAndRead(page)
      const consoleText = formatEntries(entries)
      expect(logOf(entries, 'Read Item'), consoleText).toEqual(['item=8'])
      expect(logOf(entries, 'Item Template'), consoleText).toEqual(['tmpl item=8'])
      expect(logOf(entries, 'Read Retyped'), consoleText).toEqual(['retyped=0'])
      expect(logOf(entries, 'Print Maybe'), consoleText).toEqual(['null'])
      expect(logOf(entries, 'Read Staged'), consoleText).toEqual(['staged=42'])
      expect(logOf(entries, 'Print Token'), consoleText).toEqual([MASK])
      expect(logOf(entries, 'Read Old Secret'), consoleText).toEqual(['old_secret=[]'])
      expect(logOf(entries, 'Read Calc'), consoleText).toEqual(['calc=0'])
      expect(logOf(entries, 'Read Fn Count'), consoleText).toEqual(['fn_count=6'])
      expect(consoleText).not.toContain(TOKEN_CANARY)
      expect(consoleText).not.toContain(OLD_SECRET_CANARY)
      const stored = await readStored(request, testId)
      expect(String(stored.variables.staged.value), 'the Current value never reaches the saved Test').toBe('1')
    })
  })

  test('number and true / false fields, and a 64-character name in the window and the run question', async ({
    page,
    request,
  }) => {
    test.setTimeout(240_000)
    testId = await importValidateAndNavigate(page, loadFixture())
    await expandVariableManager(page)

    await test.step('REQ-3.1.3.14: a Float field takes 28 significant digits and stops the 29th with no error', async () => {
      const win = await openEditWindow(page, 'ratio')
      const box = numberBox(win)
      await expect(box).toHaveValue('1.5')
      await box.fill('')
      await box.pressSequentially(FLOAT_28.slice(0, 23))
      await expect(digitCounter(win), 'hidden under 80% of the cap').toHaveCount(0)
      await box.pressSequentially(FLOAT_28.slice(23, 24))
      await expect(digitCounter(win)).toHaveText('23/28')
      await expect(digitCounter(win)).toHaveClass(/text-muted-foreground/)
      await box.pressSequentially(FLOAT_28.slice(24))
      await expect(digitCounter(win)).toHaveText('28/28')
      await expect(digitCounter(win)).toHaveClass(/text-destructive/)
      await box.pressSequentially('9x')
      await expect(box, 'a 29th digit and a letter are dropped').toHaveValue(FLOAT_28)
      await expect(win.getByTestId('create-validation')).toHaveCount(0)
      await saveWindow(page, win)
      await expect(rowValue(page, 'ratio')).toHaveText(FLOAT_28)
    })

    await test.step('REQ-3.1.3.14: an Integer field counts digits to 19 and refuses letters', async () => {
      const win = await openEditWindow(page, 'big_count')
      const box = numberBox(win)
      await box.fill('')
      await box.pressSequentially(INT_19.slice(0, 15))
      await expect(digitCounter(win)).toHaveCount(0)
      await box.pressSequentially(INT_19.slice(15, 16))
      await expect(digitCounter(win)).toHaveText('16/19')
      await expect(digitCounter(win)).toHaveClass(/text-muted-foreground/)
      await box.pressSequentially(INT_19.slice(16))
      await expect(digitCounter(win)).toHaveText('19/19')
      await expect(digitCounter(win)).toHaveClass(/text-destructive/)
      await box.pressSequentially('0abc')
      await expect(box, 'a 20th digit and letters are dropped').toHaveValue(INT_19)
      await saveWindow(page, win)
      await expect(rowValue(page, 'big_count')).toHaveText(INT_19)
    })

    await test.step('VMGR-110: a Boolean is a true / false control', async () => {
      const win = await openEditWindow(page, 'flag')
      const group = valueField(win).getByRole('group', { name: 'Value', exact: true })
      await expect(group.getByRole('button')).toHaveText(['true', 'false'])
      await expectWindowValue(win, false)
      await setWindowValue(page, win, true)
      await expect(group.getByRole('button', { name: 'true', exact: true })).toHaveAttribute('aria-pressed', 'true')
      await saveWindow(page, win)
      await expect(rowValue(page, 'flag')).toHaveText('true')
      await saveTest(page)
    })

    await test.step('a 64-character name stays inside the rename notice and the window', async () => {
      const win = await openEditWindow(page, LONG)
      await renameInWindow(win, `${LONG.slice(0, -1)}s`)
      await expect(renameNotice(win)).toHaveText(`Renaming updates all references to ${LONG} across the test.`)
      await expectInside(renameNotice(win).locator('code'), renameNotice(win), 'the old name inside its tinted box')
      await expectNoSidewaysScroll(win)
      await renameInWindow(win, LONG)
      await expect(renameNotice(win)).toHaveCount(0)
    })

    await test.step('VMGR-64: Run over an unsaved Current value asks first, the name inside the dialog', async () => {
      const win = await openEditWindow(page, LONG)
      await setValueView(page, win, 'Current')
      await setWindowValue(page, win, 5)
      await selectEnvironment(page)
      await page.locator('[data-testid="run-button"]').click()
      const dialog = page.getByTestId('current-edit-run-conflict-dialog')
      await expect(dialog.getByRole('heading')).toHaveText('Unsaved Current value')
      const name = dialog.getByText(LONG, { exact: true })
      await expect(name).toBeVisible()
      await expectInside(name, dialog, 'the name inside the dialog')
      await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
      await expect(dialog).toHaveCount(0)
      await expect(page.locator('[data-testid="workflow-status"]')).toHaveAttribute('data-status', 'idle')
      await expectWindowValue(win, '5')
      await cancelWindow(page, win, 'Close')
    })

    await test.step('REQ-3.1.3.14: the run logs each saved number and the boolean exactly', async () => {
      const entries = await runAndRead(page)
      const consoleText = formatEntries(entries)
      expect(logOf(entries, 'Read Numbers'), consoleText).toEqual([`ratio=${FLOAT_28} big=${INT_19}`])
      expect(logOf(entries, 'Print Flag'), consoleText).toEqual(['true'])
      expect(logOf(entries, 'Read Long'), consoleText).toEqual(['long=1'])
      const stored = await readStored(request, testId)
      expect(stored.variables.ratio.type).toBe('float')
      expect(String(stored.variables.ratio.value)).toBe(FLOAT_28)
      expect(String(stored.variables.big_count.value)).toBe(INT_19)
      expect(stored.variables.flag).toMatchObject({ type: 'boolean', value: true })
    })
  })
})
