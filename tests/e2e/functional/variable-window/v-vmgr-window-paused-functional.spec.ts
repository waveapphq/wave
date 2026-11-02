/**
 * V-VMGR-WINDOW-PAUSED: the one variable window while a run is paused, running or not yet started
 * Design Decisions: VMGR-19, VMGR-61, VMGR-64, VMGR-106, VMGR-107, VMGR-108, VMGR-111
 * REQ: REQ-3.2.1.6, REQ-3.2.1.5, REQ-3.1.3.11, REQ-3.1.3.24, REQ-3.1.3.12
 *
 * Phase: functional-workflow. Every test seeds its own Test through POST /tests, checks it
 * validates with zero errors, and drives the window, the run and the console through the UI.
 *
 * Pass Criteria:
 * 1. Paused at the root, the pencil and the row delete are enabled; the pencil opens `Edit variable`
 *    on the saved value; Cancel with a change asks Keep Editing / Close / Save and Close writes
 *    nothing; a window with no change closes at once; a Current value saved while paused is the
 *    live value and Continue logs it; a Current `null` is accepted and logged as `null`; the Initial
 *    value and the saved Test stay unchanged.
 * 2. Continue with an unsaved change in an open Edit window raises the run-conflict dialog, for a
 *    rename (Cancel keeps it, Drop Changes resets it) and for a Current value (Save Changes saves it
 *    and the run uses it).
 * 3. Run or Debug with an unsaved Current value, or with an unsaved rename and Initial value, raises
 *    the same dialog: Cancel runs nothing, Save Changes saves the window and the run uses what it
 *    saved, Drop Changes resets the window and runs with the old value; a Current value saved right
 *    after Reset is what the next run uses.
 * 4. While the run is running the pencil is locked with `Locked while the test is executing`, an
 *    open Edit window keeps its draft with Save locked the same way; once paused both work again.
 * 5. Paused: a rename saved with a Current value reaches the run under its new name; a renamed
 *    variable keeps its run value when a new variable takes its old name; a variable added while
 *    paused or after the run takes a Current value with no error and the next Run and Run Current use it.
 * 6. Before a run: Undo of a rename keeps the staged Current value on the restored name and Run uses
 *    it; an Undo that removes or retypes the variable drops its staged value and Run starts.
 * 7. Paused before a Function Block, a Current value of the Function's local reaches the Function's
 *    first Block and a Run Current from that session; paused inside the Function, a Current edit of
 *    the local is read by the next Block; the same-named Test variable keeps its value.
 */

import { randomUUID } from 'node:crypto'
import { test, expect, type Locator, type Page } from '../../helpers/playwright-fixtures'
import { clickNodeKebabItem } from '../../helpers/canvas'
import { BACKEND_URL } from '../../helpers/config'
import { getTest } from '../../helpers/element-types'
import { importValidateAndNavigate } from '../../helpers/fixture-import'
import { delayNode, localFunctionNode, logNode, releaseWorkbenchOwnership, startEdge } from '../../helpers/fn-seed'
import { getLogEntries, getLogTexts } from '../../helpers/log-reader'
import { expectNullLook } from '../../helpers/null-look'
import {
  cancelWindow,
  closeQuestion,
  createSimpleVariable,
  editPencil,
  expandVariableManager,
  expectWindowValue,
  openEditWindow,
  renameInWindow,
  renameNotice,
  retypeInWindow,
  saveWindow,
  setValueView,
  setWindowValue,
  valueSwitch,
  variableRow,
  windowCancelButton,
  windowSaveButton,
} from '../../helpers/variable-create'
import { clickUndo, digIn, resetRun, selectEnvironment, setBlockExpression } from '../../helpers/workbench'
import { deleteVariable } from '../var-manager-panel/references-helpers'
import {
  clickContinue,
  expectPausedAt,
  getSessionVariables,
  setBreakpoint,
  startDebugRun,
  startRun,
  stopImmediate,
  waitForStatus,
  type WorkflowStatus,
} from '../var-current-edit/helpers'

const LOCK_REASON = 'Locked while the test is executing'
const NOT_SAVED_TOAST = 'Current Value Not Saved'

const GATE = '79b02b22-97a1-4dfc-8fd1-1ec23b23a592'
const READ_COUNT = 'e30ed89c-1983-4e03-b4c1-dc645c8f705c'
const GATE_TWO = '91a7cf47-58c3-4be6-a92d-ed987cf2c9c0'
const READ_FACTOR = '01f16b9e-5fc7-4b7a-bdad-b49cc57a1c68'
const SHOW_SLOTS = '66f91799-1c93-4196-9702-5ea10e71b60e'
const PROBE = '0ecaa84d-578c-48a9-9757-2f94f8adb9cf'
const HOLD = 'c0159d78-0264-467f-8b86-4f8382cb5f5e'
const FN = '4ef240ae-f211-4824-9ff5-4c13d1acae04'
const FN_FIRST = 'e940a988-42e8-4d92-a467-c573b61bfa85'
const FN_SECOND = '09b1248c-4358-4462-95ee-2efcd3c35ca1'
const AFTER_FN = 'e635859a-6942-4a0a-b635-3bb8fa38b75e'

const SHOW_SLOTS_SOURCE = 'Log : Show Slots'

/** Save Changes before a run, besides Run with a held Current value. */
const SAVE_CHANGES_CASES = [
  { start: 'Debug', change: 'current' },
  { start: 'Run', change: 'definition' },
  { start: 'Debug', change: 'definition' },
] as const

type Fixture = Record<string, unknown>

const edge = (source: string, target: string): Record<string, unknown> => ({
  id: `e-${source.slice(0, 8)}-${target.slice(0, 8)}`,
  source,
  target,
})

const intVar = (value: number | string): Record<string, unknown> => ({ value, type: 'integer', scope: 'test' })

/** A chain of Blocks run in order from Start. */
function chain(nodes: Array<Record<string, unknown>>): { nodes: Array<Record<string, unknown>>; edges: Array<Record<string, unknown>> } {
  const ids = nodes.map((node) => node.id as string)
  const edges = [startEdge(ids[0]), ...ids.slice(1).map((id, at) => edge(ids[at], id))]
  return { nodes: nodes.map((node, at) => ({ ...node, position: { x: 320, y: 120 + at * 120 } })), edges }
}

/** Test variables count, factor, slots and an unused spare; each Log prints one of them. */
function rootFixture(): Fixture {
  return {
    name: 'v-vmgr-window-paused-root',
    version: '1.0.0',
    description: 'Gate, count, second gate, factor, slots (printed as WAVE prints it) and a probe Log.',
    workflow: chain([
      logNode(GATE, 'Gate', "'gate'"),
      logNode(READ_COUNT, 'Read Count', "f'count={count}'"),
      logNode(GATE_TWO, 'Gate Two', "'gate-two'"),
      logNode(READ_FACTOR, 'Read Factor', "f'factor={factor}'"),
      logNode(SHOW_SLOTS, 'Show Slots', 'slots'),
      logNode(PROBE, 'Probe', "'probe'"),
    ]),
    variables: {
      count: intVar(3),
      factor: intVar(10),
      slots: intVar(4),
      spare: { value: 'unused', type: 'string', scope: 'test' },
    },
    metadata: {},
  }
}

/** A Delay between two gates keeps the run running long enough to look at the locks. */
function lockFixture(): Fixture {
  return {
    name: 'v-vmgr-window-paused-lock',
    version: '1.0.0',
    description: 'Gate, a 20 s Delay, a second gate and a Log of count.',
    workflow: chain([
      logNode(GATE, 'Gate', "'gate'"),
      delayNode(HOLD, 'Hold', 20_000),
      logNode(GATE_TWO, 'Gate Two', "'gate-two'"),
      logNode(READ_COUNT, 'Read Count', "f'count={count}'"),
    ]),
    variables: { count: intVar(3) },
    metadata: {},
  }
}

/** A Test variable n and a Local Function whose own local n is printed by two Blocks. */
function functionFixture(): Fixture {
  const body = chain([
    logNode(FN_FIRST, 'Fn First', "f'fn-first={n}'"),
    logNode(FN_SECOND, 'Fn Second', "f'fn-second={n}'"),
  ])
  return {
    name: 'v-vmgr-window-paused-fn',
    version: '1.0.0',
    description: 'Gate, a Local Function with its own local n, then a Log of the Test variable n.',
    workflow: chain([
      logNode(GATE, 'Gate', "'gate'"),
      localFunctionNode(FN, 'Scope_Fn', {
        ...body,
        variables: [{ id: randomUUID(), name: 'n', type: 'integer', value: 1 }],
      }),
      logNode(AFTER_FN, 'After Fn', "f'root-n={n}'"),
    ]),
    variables: { n: intVar(5) },
    metadata: {},
  }
}

/** Free the workbench slot, import the fixture (zero validation errors), open it with the panel and environment ready. */
async function openFixture(page: Page, fixture: Fixture): Promise<string> {
  await releaseWorkbenchOwnership(page.request)
  const testId = await importValidateAndNavigate(page, fixture)
  await expandVariableManager(page)
  await selectEnvironment(page)
  return testId
}

const rowValue = (page: Page, name: string) => variableRow(page, name).locator('[data-testid^="variable-value-"]')

const conflictDialog = (page: Page) => page.locator('[data-testid="current-edit-run-conflict-dialog"]')

const notSavedToast = (page: Page) => page.locator('[data-toast]', { hasText: NOT_SAVED_TOAST })

/** The workbench session the backend holds right now (id '' when none). */
async function backendSession(page: Page): Promise<{ id: string; status: string }> {
  const response = await page.request.get(`${BACKEND_URL}/workbench/session`)
  const body = (await response.json().catch(() => null)) as {
    data?: { session_id?: string; status?: string } | null
  } | null
  return { id: body?.data?.session_id ?? '', status: body?.data?.status ?? '' }
}

async function backendSessionId(page: Page): Promise<string> {
  return (await backendSession(page)).id
}

/** Wait until the run started after the session `earlier` ends with `verdict`; an earlier verdict never counts. */
async function runEnds(page: Page, earlier: string, verdict: WorkflowStatus = 'passed'): Promise<string> {
  let sessionId = ''
  await expect
    .poll(
      async () => {
        const now = await backendSession(page)
        sessionId = now.id
        return now.id === '' || now.id === earlier ? 'not started' : now.status
      },
      { timeout: 60_000, intervals: [250, 500, 1_000], message: 'the new run ends' },
    )
    .toBe(verdict)
  await waitForStatus(page, verdict)
  return sessionId
}

/** The console lines starting with `prefix` are exactly `expected`, in order. */
async function expectLines(page: Page, prefix: string, expected: readonly string[]): Promise<void> {
  await expect
    .poll(async () => (await getLogTexts(page)).filter((text) => text.startsWith(prefix)), {
      timeout: 20_000,
      message: `console lines starting with "${prefix}"`,
    })
    .toEqual([...expected])
}

/** Leave the Function for the Test's own canvas, where the Gate Block shows. */
async function backToRoot(page: Page): Promise<void> {
  const gate = page.locator(`[data-testid="workflow-node-${GATE}"]`)
  if (!(await gate.isVisible())) await page.locator('[data-testid="breadcrumb-back-arrow"]').click()
  await expect(gate).toBeVisible({ timeout: 15_000 })
}

async function expectTooltip(page: Page, target: Locator, text: string): Promise<void> {
  // A tooltip opens on the pointer entering, so the pointer leaves first.
  await page.mouse.move(0, 0)
  await target.hover({ force: true })
  await expect(page.getByRole('tooltip')).toHaveText(text)
  await page.mouse.move(0, 0)
}

test.describe('V-VMGR-WINDOW-PAUSED: the variable window around a run', () => {
  test('paused at the root: a Current value, null included, reaches the run; Cancel writes nothing', async ({
    page,
  }) => {
    test.setTimeout(180_000)
    const testId = await openFixture(page, rootFixture())
    await setBreakpoint(page, GATE)
    await startDebugRun(page)
    await expectPausedAt(page, GATE)
    const sessionId = await backendSessionId(page)

    await test.step('the pencil and the row delete are enabled while paused (VMGR-107)', async () => {
      await expect(editPencil(page, 'count')).not.toHaveAttribute('aria-disabled', 'true')
      await expect(editPencil(page, 'count')).toHaveAttribute('aria-label', 'Edit count')
      await expectTooltip(page, editPencil(page, 'count'), 'Edit variable')
      await deleteVariable(page, 'spare')
    })

    await test.step('the pencil opens Edit variable on the saved value; Current shows the live value', async () => {
      const win = await openEditWindow(page, 'count')
      await expect(win).toHaveAttribute('aria-label', 'Edit variable')
      await expect(valueSwitch(win)).toHaveText('Initial')
      await expectWindowValue(win, 3)
      await setValueView(page, win, 'Current')
      await expectWindowValue(win, 3)

      await setWindowValue(page, win, 8)
      await windowCancelButton(win).click()
      await expect(closeQuestion(page)).toBeVisible()
      await expect(closeQuestion(page).locator('[data-testid="unsaved-keep-editing"]')).toHaveText('Keep Editing')
      await expect(closeQuestion(page).locator('[data-testid="unsaved-close"]')).toHaveText('Close')
      await expect(closeQuestion(page).locator('[data-testid="unsaved-save"]')).toHaveText('Save')
      await closeQuestion(page).locator('[data-testid="unsaved-keep-editing"]').click()
      await expect(closeQuestion(page)).toBeHidden()
      await expectWindowValue(win, 8)
      await cancelWindow(page, win, 'Close')
      await expect(rowValue(page, 'count'), 'Close wrote nothing to the row').toHaveText('3')
      expect((await getSessionVariables(page, sessionId)).count.value, 'Close wrote nothing to the run').toBe(3)

      const untouched = await openEditWindow(page, 'count')
      await cancelWindow(page, untouched)
      await expect(closeQuestion(page), 'a window with no change closes at once').toHaveCount(0)
    })

    await test.step('a Current value saved while paused is the live value; Initial keeps the saved one', async () => {
      const win = await openEditWindow(page, 'count', { view: 'Current' })
      await setWindowValue(page, win, 7)
      await saveWindow(page, win)
      await expect(rowValue(page, 'count')).toHaveText('7')
      expect((await getSessionVariables(page, sessionId)).count.value).toBe(7)

      const reopened = await openEditWindow(page, 'count')
      await expect(valueSwitch(reopened)).toHaveText('Initial')
      await expectWindowValue(reopened, 3)
      await setValueView(page, reopened, 'Current')
      await expectWindowValue(reopened, 7)
      await cancelWindow(page, reopened)
    })

    await test.step('a Current null while paused is accepted (VMGR-111)', async () => {
      const win = await openEditWindow(page, 'slots', { view: 'Current' })
      await setWindowValue(page, win, null)
      await saveWindow(page, win)
      await expectNullLook(rowValue(page, 'slots'), 'the slots row after a Current null')
      expect((await getSessionVariables(page, sessionId)).slots.value).toBeNull()
      await expect(notSavedToast(page)).toHaveCount(0)
    })

    await test.step('Continue: the run logs count=7 and null; the saved Test is unchanged', async () => {
      await clickContinue(page)
      await waitForStatus(page, 'passed')
      await expectLines(page, 'count=', ['count=7'])
      await expect
        .poll(async () =>
          (await getLogEntries(page)).filter((entry) => entry.source === SHOW_SLOTS_SOURCE).map((entry) => entry.message),
        )
        .toEqual(['null'])
      const saved = await getTest(page.request, testId)
      expect(saved.variables.count.value, 'the saved Test keeps count').toBe(3)
      expect(saved.variables.slots.value, 'the saved Test keeps slots').toBe(4)
    })
  })

  test('Continue with an unsaved rename or Current value raises the run-conflict dialog (VMGR-64)', async ({
    page,
  }) => {
    test.setTimeout(180_000)
    await openFixture(page, rootFixture())
    await setBreakpoint(page, GATE)
    await setBreakpoint(page, GATE_TWO)
    await startDebugRun(page)
    await expectPausedAt(page, GATE)

    const win = await openEditWindow(page, 'count')
    const nameField = win.locator('[data-testid="create-variable-name"]')

    await test.step('a rename held in the window: Cancel keeps it and the run stays paused', async () => {
      await renameInWindow(win, 'total')
      await expect(renameNotice(win)).toHaveText('Renaming updates all references to count across the test.')
      await clickContinue(page)
      await expect(conflictDialog(page)).toBeVisible()
      await expect(conflictDialog(page).getByRole('heading')).toHaveText('Unsaved changes')
      await expect(conflictDialog(page)).toContainText('This variable has unsaved changes: count.')
      await conflictDialog(page).getByRole('button', { name: 'Cancel', exact: true }).click()
      await expect(conflictDialog(page)).toBeHidden()
      await expectPausedAt(page, GATE)
      await expect(nameField).toHaveValue('total')
    })

    await test.step('Drop Changes resets the window and the run goes on under the old name', async () => {
      await clickContinue(page)
      await expect(conflictDialog(page)).toBeVisible()
      await conflictDialog(page).getByRole('button', { name: 'Drop Changes', exact: true }).click()
      await expectPausedAt(page, GATE_TWO)
      await expect(nameField).toHaveValue('count')
      await expect(variableRow(page, 'total')).toHaveCount(0)
      await expectLines(page, 'count=', ['count=3'])
      await cancelWindow(page, win)
    })

    await test.step('a Current value held in the window: Save Changes saves it and the run uses it', async () => {
      const factor = await openEditWindow(page, 'factor', { view: 'Current' })
      await setWindowValue(page, factor, 20)
      await clickContinue(page)
      await expect(conflictDialog(page)).toBeVisible()
      await expect(conflictDialog(page).getByRole('heading')).toHaveText('Unsaved Current value')
      await expect(conflictDialog(page)).toContainText('This variable has an unsaved Current-value edit: factor.')
      await conflictDialog(page).getByRole('button', { name: 'Save Changes', exact: true }).click()
      await expect(factor).toBeHidden()
      await waitForStatus(page, 'passed')
      await expectLines(page, 'factor=', ['factor=20'])
    })
  })

  test('Run with an unsaved Current value raises the dialog: Cancel runs nothing, Save Changes runs the new value (VMGR-64)', async ({
    page,
  }) => {
    test.setTimeout(180_000)
    await openFixture(page, rootFixture())

    const win = await openEditWindow(page, 'count', { view: 'Current' })
    await setWindowValue(page, win, 9)

    await test.step('Cancel: nothing runs and the window keeps its value', async () => {
      await startRun(page)
      await expect(conflictDialog(page)).toBeVisible()
      await expect(conflictDialog(page).getByRole('heading')).toHaveText('Unsaved Current value')
      await expect(conflictDialog(page)).toContainText('This variable has an unsaved Current-value edit: count.')
      await conflictDialog(page).getByRole('button', { name: 'Cancel', exact: true }).click()
      await expect(conflictDialog(page)).toBeHidden()
      await expect(page.locator('[data-testid="workflow-status"]')).toHaveAttribute('data-status', 'idle')
      expect(await backendSessionId(page), 'no run started').toBe('')
      await expectWindowValue(win, 9)
    })

    await test.step('Save Changes: the window saves and the run uses the new value', async () => {
      await startRun(page)
      await expect(conflictDialog(page)).toBeVisible()
      await conflictDialog(page).getByRole('button', { name: 'Save Changes', exact: true }).click()
      await expect(win).toBeHidden()
      await runEnds(page, '')
      await expectLines(page, 'count=', ['count=9'])
    })
  })

  for (const { start, change } of SAVE_CHANGES_CASES) {
    const held = change === 'definition' ? 'a rename and an Initial value' : 'a Current value'
    test(`${start} with ${held} held in the window: Save Changes saves it and the run uses it (VMGR-64)`, async ({
      page,
    }) => {
      test.setTimeout(120_000)
      await openFixture(page, rootFixture())
      const win = await openEditWindow(page, 'count')
      if (change === 'definition') {
        await renameInWindow(win, 'total')
        await setWindowValue(page, win, 11)
      } else {
        await setValueView(page, win, 'Current')
        await setWindowValue(page, win, 9)
      }

      await (start === 'Run' ? startRun(page) : startDebugRun(page))
      await expect(conflictDialog(page)).toBeVisible()
      await expect(conflictDialog(page).getByRole('heading')).toHaveText(
        change === 'definition' ? 'Unsaved changes' : 'Unsaved Current value',
      )
      await conflictDialog(page).getByRole('button', { name: 'Save Changes', exact: true }).click()
      await expect(win).toBeHidden()
      const sessionId = await runEnds(page, '')

      if (change === 'definition') {
        const variables = await getSessionVariables(page, sessionId)
        expect(variables.total?.value, 'the run holds the renamed variable with its new value').toBe(11)
        expect(variables.count, 'the run holds no variable under the old name').toBeUndefined()
        await expectLines(page, 'count=', ['count=11'])
      } else {
        await expectLines(page, 'count=', ['count=9'])
      }
    })
  }

  test('right after Reset: Drop Changes runs the old value and a saved Current value is what the next run uses', async ({
    page,
  }) => {
    test.setTimeout(180_000)
    await openFixture(page, rootFixture())
    await startRun(page)
    await runEnds(page, '')
    await expectLines(page, 'count=', ['count=3'])

    await test.step('Drop Changes resets the window and the run uses the old value', async () => {
      await resetRun(page)
      const dropped = await openEditWindow(page, 'count', { view: 'Current' })
      await expectWindowValue(dropped, 3)
      await setWindowValue(page, dropped, 6)
      await startRun(page)
      await expect(conflictDialog(page)).toBeVisible()
      await conflictDialog(page).getByRole('button', { name: 'Drop Changes', exact: true }).click()
      await runEnds(page, '')
      await expectLines(page, 'count=', ['count=3'])
      await expectWindowValue(dropped, 3)
      await cancelWindow(page, dropped)
    })

    await test.step('a Current value saved right after Reset is what the next run uses', async () => {
      await resetRun(page)
      const staged = await openEditWindow(page, 'count', { view: 'Current' })
      await setWindowValue(page, staged, 8)
      await saveWindow(page, staged)
      await expect(rowValue(page, 'count')).toHaveText('8')
      await startRun(page)
      await runEnds(page, '')
      await expectLines(page, 'count=', ['count=8'])
    })
  })

  test('while the run is running the pencil and Save are locked; the draft is kept for the pause', async ({ page }) => {
    test.setTimeout(180_000)
    await openFixture(page, lockFixture())
    await setBreakpoint(page, GATE)
    await setBreakpoint(page, GATE_TWO)
    await startDebugRun(page)
    await expectPausedAt(page, GATE)

    const win = await openEditWindow(page, 'count', { view: 'Current' })
    await expectWindowValue(win, 3)

    await test.step('running: the pencil and the open window Save are locked with the reason', async () => {
      const status = page.locator('[data-testid="workflow-status"]')
      await clickContinue(page)
      await waitForStatus(page, 'running')
      await setWindowValue(page, win, 12)
      const save = windowSaveButton(win)
      await expect(save).toHaveAttribute('aria-disabled', 'true')
      // force: a person can click a held Save; Playwright would wait for it to unlock.
      await save.click({ force: true })
      await expect(status, 'the click on Save lands while the run runs').toHaveAttribute('data-status', 'running')
      await expect(win, 'a locked Save keeps the window open').toBeVisible()
      await expectWindowValue(win, 12)
      await expectTooltip(page, save, LOCK_REASON)

      await expect(editPencil(page, 'count')).toHaveAttribute('aria-disabled', 'true')
      await expect(editPencil(page, 'count')).toHaveAttribute('aria-label', 'Locked: edit count')
      await expectTooltip(page, editPencil(page, 'count'), LOCK_REASON)
      await expect(status, 'every lock was seen while the run runs').toHaveAttribute('data-status', 'running')
    })

    await test.step('paused again: the pencil and Save work and the draft is the value the run reads', async () => {
      await expectPausedAt(page, GATE_TWO)
      await expect(editPencil(page, 'count')).not.toHaveAttribute('aria-disabled', 'true')
      await expectWindowValue(win, 12)
      await saveWindow(page, win)
      await expect(rowValue(page, 'count')).toHaveText('12')
      await clickContinue(page)
      await waitForStatus(page, 'passed')
      await expectLines(page, 'count=', ['count=12'])
    })
  })

  test('paused: renamed and added variables take Current values; the next Run and Run Current use them', async ({
    page,
  }) => {
    test.setTimeout(240_000)
    await openFixture(page, rootFixture())
    await setBreakpoint(page, GATE)
    await startDebugRun(page)
    await expectPausedAt(page, GATE)
    const sessionId = await backendSessionId(page)

    await test.step('a rename saved with a Current value lands on the run under the new name', async () => {
      const win = await openEditWindow(page, 'factor')
      await renameInWindow(win, 'scale')
      await setValueView(page, win, 'Current')
      await setWindowValue(page, win, 20)
      await saveWindow(page, win)
      await expect(variableRow(page, 'factor')).toHaveCount(0)
      await expect(rowValue(page, 'scale')).toHaveText('20')
    })

    await test.step('count renamed to total, then a new count takes a Current value', async () => {
      const renamed = await openEditWindow(page, 'count')
      await renameInWindow(renamed, 'total')
      await saveWindow(page, renamed)
      await expect(variableRow(page, 'total')).toHaveCount(1)

      await createSimpleVariable(page, 'count', { type: 'integer', value: '50' })
      const added = await openEditWindow(page, 'count', { view: 'Current' })
      await setWindowValue(page, added, 60)
      await saveWindow(page, added)
      await expect(notSavedToast(page)).toHaveCount(0)
    })

    await test.step('a variable added while paused takes a Current value with no error', async () => {
      await createSimpleVariable(page, 'extra', { type: 'integer', value: '1' })
      const win = await openEditWindow(page, 'extra', { view: 'Current' })
      await setWindowValue(page, win, 77)
      await saveWindow(page, win)
      await expect(rowValue(page, 'extra')).toHaveText('77')
      await expect(notSavedToast(page)).toHaveCount(0)

      const live = await getSessionVariables(page, sessionId)
      expect(live.count.value, 'the run keeps its own count').toBe(3)
      expect(live.factor.value, 'the run reads the renamed variable under its run name').toBe(20)
      expect(live.extra, 'the live run gets no new variable').toBeUndefined()
    })

    await test.step('Continue: total keeps its run value and the run reads the renamed Current value', async () => {
      await clickContinue(page)
      await waitForStatus(page, 'passed')
      await expectLines(page, 'count=', ['count=3'])
      await expectLines(page, 'factor=', ['factor=20'])
    })

    await test.step('the next Run uses the new count and the added variable', async () => {
      await setBlockExpression(page, PROBE, 'message', "f'probe={count}:{extra}'")
      await startRun(page)
      await runEnds(page, sessionId)
      await expectLines(page, 'probe=', ['probe=60:77'])
    })

    await test.step('a variable added after the run takes a Current value that Run Current uses', async () => {
      await createSimpleVariable(page, 'late', { type: 'integer', value: '1' })
      const win = await openEditWindow(page, 'late', { view: 'Current' })
      await setWindowValue(page, win, 88)
      await saveWindow(page, win)
      await expect(rowValue(page, 'late')).toHaveText('88')
      await expect(notSavedToast(page)).toHaveCount(0)

      await setBlockExpression(page, PROBE, 'message', "f'probe-late={late}'")
      const earlier = await backendSessionId(page)
      await clickNodeKebabItem(page, PROBE, 'Run Current')
      await runEnds(page, earlier)
      await expectLines(page, 'probe-late=', ['probe-late=88'])
    })
  })

  test('before a run: Undo keeps a staged Current value on a restored name and drops it with the variable', async ({
    page,
  }) => {
    test.setTimeout(240_000)
    await openFixture(page, rootFixture())

    await test.step('stage a Current value, rename, Undo: the restored name holds the value and Run uses it', async () => {
      const staged = await openEditWindow(page, 'count', { view: 'Current' })
      await setWindowValue(page, staged, 7)
      await saveWindow(page, staged)
      await expect(rowValue(page, 'count')).toHaveText('7')

      const renamed = await openEditWindow(page, 'count')
      await renameInWindow(renamed, 'total')
      await saveWindow(page, renamed)
      await expect(variableRow(page, 'count')).toHaveCount(0)

      await clickUndo(page)
      await expect(variableRow(page, 'total')).toHaveCount(0)
      await expect(rowValue(page, 'count')).toHaveText('7')

      await startRun(page)
      await runEnds(page, '')
      await expectLines(page, 'count=', ['count=7'])
    })

    await test.step('an Undo that removes the variable drops its staged value and Run starts', async () => {
      await resetRun(page)
      await createSimpleVariable(page, 'extra', { type: 'integer', value: '1' })
      const win = await openEditWindow(page, 'extra', { view: 'Current' })
      await setWindowValue(page, win, 5)
      await saveWindow(page, win)
      await expect(rowValue(page, 'extra')).toHaveText('5')

      await clickUndo(page)
      await expect(variableRow(page, 'extra')).toHaveCount(0)
      const earlier = await backendSessionId(page)
      await startRun(page)
      await runEnds(page, earlier)
      await expectLines(page, 'count=', ['count=3'])
    })

    await test.step('an Undo that retypes the variable drops its staged value and Run starts', async () => {
      await resetRun(page)
      const win = await openEditWindow(page, 'factor')
      await retypeInWindow(page, win, 'string')
      await setWindowValue(page, win, 'ten')
      await saveWindow(page, win)
      await expect(rowValue(page, 'factor')).toHaveText('ten')

      const current = await openEditWindow(page, 'factor', { view: 'Current' })
      await setWindowValue(page, current, 'twenty')
      await saveWindow(page, current)
      await expect(rowValue(page, 'factor')).toHaveText('twenty')

      await clickUndo(page)
      await expect(rowValue(page, 'factor')).toHaveText('10')
      const earlier = await backendSessionId(page)
      await startRun(page)
      await runEnds(page, earlier)
      await expectLines(page, 'factor=', ['factor=10'])
    })
  })

  test('a Function local Current value: set before the Function and inside it; the Test variable keeps its own', async ({
    page,
  }) => {
    test.setTimeout(240_000)
    await openFixture(page, functionFixture())
    const fnFirst = page.locator(`[data-testid="workflow-node-${FN_FIRST}"]`)

    await digIn(page, FN)
    await expect(fnFirst).toBeVisible({ timeout: 15_000 })
    await setBreakpoint(page, FN_SECOND)
    await backToRoot(page)
    await setBreakpoint(page, GATE)

    await test.step('paused before the Function, then stopped: Run Current on its first Block uses the value', async () => {
      await startDebugRun(page)
      await expectPausedAt(page, GATE)
      await digIn(page, FN)
      await expect(fnFirst).toBeVisible({ timeout: 15_000 })
      const win = await openEditWindow(page, 'n', { view: 'Current' })
      await setWindowValue(page, win, 6)
      await saveWindow(page, win)
      await expect(rowValue(page, 'n')).toHaveText('6')
      await expect(notSavedToast(page)).toHaveCount(0)

      await stopImmediate(page)
      await waitForStatus(page, 'stopped')
      await expect(fnFirst).toBeVisible()
      const earlier = await backendSessionId(page)
      await clickNodeKebabItem(page, FN_FIRST, 'Run Current')
      await runEnds(page, earlier)
      await expectLines(page, 'fn-first=', ['fn-first=6'])
      await backToRoot(page)
    })

    await test.step('paused before the Function: Continue and its first Block logs the value', async () => {
      await startDebugRun(page)
      await expectPausedAt(page, GATE)
      await digIn(page, FN)
      await expect(fnFirst).toBeVisible({ timeout: 15_000 })
      const win = await openEditWindow(page, 'n', { view: 'Current' })
      await setWindowValue(page, win, 7)
      await saveWindow(page, win)
      await expect(notSavedToast(page)).toHaveCount(0)

      await clickContinue(page)
      await expectPausedAt(page, FN_SECOND)
      await expectLines(page, 'fn-first=', ['fn-first=6', 'fn-first=7'])
    })

    await test.step('paused inside the Function: the next Block reads the new value; the Test n keeps 5', async () => {
      const win = await openEditWindow(page, 'n', { view: 'Current' })
      await expectWindowValue(win, 7)
      await setWindowValue(page, win, 9)
      await saveWindow(page, win)
      await expect(rowValue(page, 'n')).toHaveText('9')

      await clickContinue(page)
      await waitForStatus(page, 'passed')
      await expectLines(page, 'fn-second=', ['fn-second=9'])
      await expectLines(page, 'root-n=', ['root-n=5'])
      await backToRoot(page)
      await expect(rowValue(page, 'n'), 'the Test variable n keeps its own value').toHaveText('5')
    })
  })
})
