/**
 * V-VMGR-CURRENT-EDIT: runtime variable override while paused (functional).
 * REQ-3.2.1.6 (Runtime variable override during pause/stop - Workbench debug).
 *
 * Phase: functional-workflow (imports its own fixture via POST /tests, runs in
 * Debug, and mutates session state mid-run).
 *
 * Proves the Current-edit feature works end-to-end as a user would:
 *   - Pause on a breakpoint, override a scalar's Current value (literal) and an
 *     expression variable's Current source (re-armed), Continue, and the
 *     downstream Logs use the overridden values (count=7, derived=17).
 *   - The override survives an ad-hoc partial re-run (inherited) and a full Run
 *     All re-seeds it away.
 *   - The run-while-editing conflict dialog blocks a resume and its Cancel /
 *     Drop / Save branches behave.
 */

import { test, expect } from '../../helpers/playwright-fixtures'
import { getLogTexts } from '../../helpers/log-reader'
import { cancelWindow, expectWindowValue, setWindowValue } from '../../helpers/variable-create'
import { resetRun } from '../../helpers/workbench'
import fs from 'fs'
import path from 'path'
import {
  importValidateOpen,
  selectEnvironment,
  setBreakpoint,
  startDebugRun,
  startRun,
  waitForStatus,
  expectPausedAt,
  clickContinue,
  stopImmediate,
  getActiveSessionId,
  waitForNewSession,
  getSessionVariables,
  openInspector,
  closeInspector,
  setMode,
  setView,
  clickEdit,
  saveEdit,
} from './helpers'

function loadFixture(): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(path.resolve(__dirname, 'fixture.json'), 'utf-8'))
}

test.describe('V-VMGR-CURRENT-EDIT: runtime variable override', () => {
  test('Current override (literal + expression) propagates downstream; Initial edit never moves Current', async ({
    page,
  }) => {
    test.setTimeout(120_000)
    await importValidateOpen(page, loadFixture())
    await setBreakpoint(page, 'gate')
    await selectEnvironment(page)
    await startDebugRun(page)
    await expectPausedAt(page, 'gate')

    await test.step('A node keeps its kebab AND right-click menu while paused (mutations disabled, Toggle Breakpoint enabled)', async () => {
      const gate = page.locator('[data-testid="workflow-node-gate"]')
      // Kebab present during execution; Toggle Breakpoint enabled, Delete disabled.
      const kebab = gate.locator('[data-testid="node-kebab"]')
      await expect(kebab).toBeVisible() // kebab not removed during pause
      await kebab.click()
      const kebabMenu = page.locator('[role="menu"]')
      await expect(kebabMenu).toBeVisible()
      await expect(
        kebabMenu.getByRole('menuitem', { name: 'Toggle Breakpoint' }),
      ).not.toHaveAttribute('aria-disabled', 'true') // breakpoint toggle stays enabled mid-pause
      await expect(kebabMenu.getByRole('menuitem', { name: 'Delete' })).toHaveAttribute(
        'aria-disabled',
        'true',
      ) // mutations disabled mid-pause
      await page.keyboard.press('Escape')
      await expect(kebabMenu).not.toBeVisible()

      // Right-click context menu mirrors the kebab during execution.
      await gate.click({ button: 'right' })
      const ctxMenu = page.locator('[role="menu"]')
      await expect(ctxMenu).toBeVisible() // right-click menu present mid-pause
      await expect(
        ctxMenu.getByRole('menuitem', { name: 'Toggle Breakpoint' }),
      ).not.toHaveAttribute('aria-disabled', 'true')
      await expect(ctxMenu.getByRole('menuitem', { name: 'Delete' })).toHaveAttribute(
        'aria-disabled',
        'true',
      )
      await page.keyboard.press('Escape')
      await expect(ctxMenu).not.toBeVisible()
    })

    await test.step('Editing the Initial definition while paused does not move the Current value', async () => {
      const modal = await openInspector(page, 'factor')
      // Current (default) is anchored to the run-start session value (10).
      await expect(modal.locator('[data-testid="scalar-body"]')).toHaveText('10')
      await setMode(page, modal, 'Initial')
      const win = await clickEdit(modal)
      await expectWindowValue(win, 10)
      await setWindowValue(page, win, 99)
      await saveEdit(win)
      // Back in Current: the live/session value is still 10, NOT the edited 99.
      await setMode(page, modal, 'Current')
      await expect(modal.locator('[data-testid="scalar-body"]')).toHaveText('10')
      await closeInspector(page, 'factor')
    })

    await test.step('literal override applies to the live session and re-edit resumes from it', async () => {
      const modal = await openInspector(page, 'count')
      await expect(modal.locator('[data-testid="scalar-body"]')).toHaveText('3')
      const win = await clickEdit(modal)
      await setWindowValue(page, win, 7)
      await saveEdit(win)
      // The literal override pushes the new value back immediately.
      await expect(modal.locator('[data-testid="scalar-body"]')).toHaveText('7')
      const sid = await getActiveSessionId(page)
      const vars = await getSessionVariables(page, sid)
      expect(vars.count.value).toBe(7)

      // Re-opening Edit resumes from the active override (7), not the definition (3).
      const again = await clickEdit(modal)
      await expectWindowValue(again, 7)
      await cancelWindow(page, again)
      await closeInspector(page, 'count')
    })

    await test.step('expression override re-arms the source; the Expression view shows the new formula', async () => {
      const modal = await openInspector(page, 'derived')
      const win = await clickEdit(modal)
      // The Current view shows the active source before any override.
      await expectWindowValue(win, 'count * factor')
      await setWindowValue(page, win, 'count + factor')
      await saveEdit(win)

      // The Current source shows the NEW overridden formula, not the definition.
      await setView(page, modal, 'Expression')
      await expect(modal.locator('[data-testid="scalar-body"]')).toContainText(
        'count + factor',
      )

      // Re-edit resumes from the override source.
      const again = await clickEdit(modal)
      await expectWindowValue(again, 'count + factor')
      await cancelWindow(page, again)

      // The Expression view choice survives an edit (it does not snap back).
      await expect(modal.locator('[data-testid="view-dropdown"]')).toContainText('Expression')
      await closeInspector(page, 'derived')
    })

    await test.step('Continue: the downstream Logs use BOTH overrides', async () => {
      await clickContinue(page)
      await waitForStatus(page, 'passed')
      const logs = await getLogTexts(page)
      const all = logs.join('\n')
      // Literal override propagated: count=7 (not the seeded 3).
      expect(logs.some((m) => m === 'count=7'), `expected count=7\n${all}`).toBeTruthy()
      expect(logs.some((m) => m === 'count=3'), `count=3 must not appear\n${all}`).toBeFalsy()
      // Expression override propagated: derived re-evaluated count + factor = 7 + 10 = 17
      // (not the definition's count * factor = 70, nor the un-overridden 30).
      expect(logs.some((m) => m === 'derived=17'), `expected derived=17\n${all}`).toBeTruthy()
      expect(
        logs.some((m) => m === 'derived=70' || m === 'derived=30'),
        `derived must reflect BOTH overrides\n${all}`,
      ).toBeFalsy()
    })
  })

  test('override survives an ad-hoc partial re-run; a full Run All discards it', async ({
    page,
  }) => {
    test.setTimeout(120_000)
    await importValidateOpen(page, loadFixture())
    await setBreakpoint(page, 'gate')
    await selectEnvironment(page)

    let terminalSid = ''
    await test.step('pause, override count to 7, Continue to a terminal session', async () => {
      await startDebugRun(page)
      await expectPausedAt(page, 'gate')
      const modal = await openInspector(page, 'count')
      const win = await clickEdit(modal)
      await setWindowValue(page, win, 7)
      await saveEdit(win)
      await closeInspector(page, 'count')
      await clickContinue(page)
      await waitForStatus(page, 'passed')
      terminalSid = await getActiveSessionId(page)
      expect((await getSessionVariables(page, terminalSid)).count.value).toBe(7)
    })

    await test.step('an ad-hoc Run Current inherits the override (count stays 7)', async () => {
      // The override lives in the terminal session; an ad-hoc partial run
      // inherits its variable space, so count is still 7 in the new session.
      const node = page.locator('[data-testid="workflow-node-read-count"]')
      const kebab = node.locator('[data-testid="node-kebab"]')
      await expect(async () => {
        await kebab.click()
        await page
          .locator('[role="menu"]')
          .getByRole('menuitem', { name: 'Run Current', exact: true })
          .click({ timeout: 2000 })
      }).toPass({ timeout: 15_000 })
      // A re-run keeps the status 'passed', so wait for the NEW session id.
      const sid = await waitForNewSession(page, terminalSid)
      terminalSid = sid
      await waitForStatus(page, 'passed')
      expect((await getSessionVariables(page, sid)).count.value).toBe(7)
    })

    await test.step('a full Run All re-seeds from the definition (count back to 3)', async () => {
      await startRun(page)
      const sid = await waitForNewSession(page, terminalSid)
      await waitForStatus(page, 'passed')
      expect((await getSessionVariables(page, sid)).count.value).toBe(3)
    })
  })

  test('run-while-editing conflict dialog blocks the resume (Cancel / Drop / Save)', async ({
    page,
  }) => {
    test.setTimeout(120_000)
    await importValidateOpen(page, loadFixture())
    await setBreakpoint(page, 'gate')
    await selectEnvironment(page)

    await test.step('Cancel: the dialog appears, names the variable, and the run stays paused', async () => {
      await startDebugRun(page)
      await expectPausedAt(page, 'gate')
      const modal = await openInspector(page, 'count')
      const win = await clickEdit(modal)
      await setWindowValue(page, win, 8)
      await clickContinue(page)
      const dialog = page.locator('[data-testid="current-edit-run-conflict-dialog"]')
      await expect(dialog).toBeVisible()
      await expect(dialog).toContainText('count') // names the dirty variable
      await dialog.getByRole('button', { name: 'Cancel' }).click()
      await expect(dialog).not.toBeVisible()
      // Cancel aborts the resume: still paused, the window still holds the edit.
      await waitForStatus(page, 'paused')
      await expectWindowValue(win, 8)
      await cancelWindow(page, win, 'Close')
      await closeInspector(page, 'count')
      await stopImmediate(page)
      await waitForStatus(page, 'stopped')
    })

    await test.step('Drop: discards the edit and proceeds (override NOT applied, count stays 3)', async () => {
      await startDebugRun(page)
      await expectPausedAt(page, 'gate')
      const modal = await openInspector(page, 'count')
      const win = await clickEdit(modal)
      await setWindowValue(page, win, 6)
      await clickContinue(page)
      const dialog = page.locator('[data-testid="current-edit-run-conflict-dialog"]')
      await expect(dialog).toBeVisible()
      await dialog.getByRole('button', { name: 'Drop Changes' }).click()
      await waitForStatus(page, 'passed')
      // Drop resets the window to the value the run had.
      await expectWindowValue(win, 3)
      await cancelWindow(page, win)
      const logs = await getLogTexts(page)
      // The dropped edit never applied: the run used the seeded count=3, not 6.
      expect(logs.some((m) => m === 'count=3'), `Drop must discard the edit\n${logs.join('\n')}`).toBeTruthy()
      expect(logs.some((m) => m === 'count=6')).toBeFalsy()
      await closeInspector(page, 'count')
    })

    await test.step('Save: applies the override then proceeds (count=5 downstream)', async () => {
      await startDebugRun(page)
      await expectPausedAt(page, 'gate')
      const modal = await openInspector(page, 'count')
      const win = await clickEdit(modal)
      await setWindowValue(page, win, 5)
      await clickContinue(page)
      const dialog = page.locator('[data-testid="current-edit-run-conflict-dialog"]')
      await expect(dialog).toBeVisible()
      await dialog.getByRole('button', { name: 'Save Changes' }).click()
      await expect(win).toBeHidden()
      await waitForStatus(page, 'passed')
      const sid = await getActiveSessionId(page)
      expect((await getSessionVariables(page, sid)).count.value).toBe(5)
      const logs = await getLogTexts(page)
      expect(logs.some((m) => m === 'count=5'), `Save must apply the override\n${logs.join('\n')}`).toBeTruthy()
    })
  })

  test('Stop and Reset clear the paused halo', async ({ page }) => {
    test.setTimeout(120_000)
    await importValidateOpen(page, loadFixture())
    await setBreakpoint(page, 'gate')
    await selectEnvironment(page)
    const gate = page.locator('[data-testid="workflow-node-gate"]')

    await startDebugRun(page)
    await expectPausedAt(page, 'gate')
    await expect(gate).toHaveAttribute('data-paused', 'true')

    // Stop clears the paused halo (Stop unsubscribes before the terminal
    // WS event, so the run hook clears pausedNodeId directly).
    await stopImmediate(page)
    await waitForStatus(page, 'stopped')
    await expect(gate).not.toHaveAttribute('data-paused', 'true')

    // Reset (only reachable from a terminal state) also clears pausedNodeId,
    // leaving no residual paused halo on the idle canvas.
    await resetRun(page)
    await waitForStatus(page, 'idle')
    await expect(gate).not.toHaveAttribute('data-paused', 'true')
  })
})
