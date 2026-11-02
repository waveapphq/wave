/**
 * V-FLOAT-PRECISION: the float Decimal pipeline, end-to-end (functional).
 * Design Decisions: VMGR-106, VMGR-108
 * REQ: REQ-3.1.3.14 (exact numeric precision for float variables - arbitrary precision, no
 * IEEE-754 rounding).
 *
 * Phase: functional-workflow (imports its own fixture via POST /tests, runs in Run + Debug, and
 * changes session state mid-run).
 *
 * Pass Criteria:
 * 1. A >17-significant-digit float survives storage -> realization -> WS -> display as the EXACT
 *    input string (no rounding, no E notation); an expression deriving from it stays exact within
 *    28 significant digits; an unchanged float shows NO Initial-vs-Current Compare delta.
 * 2. A Variable Setter overwriting a float mid-run updates the open watcher's Current value and
 *    Compare view (the variable_changed WS push carries a Decimal as a plain string).
 * 3. A rename in the variable's window persists, refactors references, and survives a reload, both
 *    from the Current view (the window opened from a Current watcher) and from the Initial view (the
 *    row pencil).
 * 4. A live Current float value set in the window applies and propagates downstream.
 */

import { test, expect } from '../../helpers/playwright-fixtures'
import { getLogTexts } from '../../helpers/log-reader'
import { valueSwitch } from '../../helpers/variable-create'
import fs from 'fs'
import path from 'path'
import {
  importValidateOpen,
  openTest,
  expandVariableManager,
  selectEnvironment,
  setBreakpoint,
  startDebugRun,
  startRun,
  waitForStatus,
  expectPausedAt,
  clickContinue,
  getActiveSessionId,
  getSessionVariables,
  getTest,
  getTestVariables,
  rowFor,
  openInspector,
  openInspectEditViaPencil,
  closeInspector,
  setMode,
  clickEdit,
  saveEdit,
  renameInModal,
  toolbarSave,
} from './helpers'

// The exact values declared / derived by fixture.json (kept in lockstep).
const PRICE = '-2123.123213123123699999' // > 17 significant digits (beyond double)
const TOTAL = '-2123.113213123123699999' // price + 0.01, exact within 28 sig digits
const RATE_INITIAL = '19.99'
const RATE_AFTER = '21.5892' // the Variable Setter overwrite

function loadFixture(): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(path.resolve(__dirname, 'fixture.json'), 'utf-8'))
}

test.describe('V-FLOAT-PRECISION: float Decimal pipeline', () => {
  test('a long float survives exact end-to-end; the derived expression is exact; an unchanged float shows no Compare delta while a setter-changed float does', async ({
    page,
  }) => {
    test.setTimeout(120_000)
    await importValidateOpen(page, loadFixture())

    // Stage the rate watcher BEFORE the run so the live WS push (not a post-run GET) updates its Current value.
    const rateModal = await openInspector(page, 'rate')
    await expect(rateModal.locator('[data-testid="scalar-body"]')).toHaveText(RATE_INITIAL)

    await selectEnvironment(page)
    await startRun(page)
    await waitForStatus(page, 'passed')

    await test.step('the Variable Setter overwrite reached the open watcher as a plain string (WS push)', async () => {
      await expect(rateModal.locator('[data-testid="scalar-body"]')).toHaveText(RATE_AFTER)
      // Compare reflects the change: Initial run-start value vs the new Current.
      await setMode(page, rateModal, 'Compare')
      await expect(rateModal.locator('[data-testid="compare-pane-initial"]')).toContainText(
        RATE_INITIAL,
      )
      await expect(rateModal.locator('[data-testid="compare-pane-current"]')).toContainText(
        RATE_AFTER,
      )
      await closeInspector(page, 'rate')
    })

    await test.step('the long float renders un-rounded and shows NO Compare delta (unchanged)', async () => {
      const priceModal = await openInspector(page, 'price')
      // Current (default) shows the realized value, exact, on the watcher.
      await expect(priceModal.locator('[data-testid="scalar-body"]')).toHaveText(PRICE)
      await setMode(page, priceModal, 'Compare')
      // Both panes show the same exact value and a float carries no delta metric.
      await expect(priceModal.locator('[data-testid="compare-pane-initial"]')).toContainText(PRICE)
      await expect(priceModal.locator('[data-testid="compare-pane-current"]')).toContainText(PRICE)
      await expect(priceModal.locator('[data-testid="inspect-metric"]')).toHaveCount(0)
      await closeInspector(page, 'price')
    })

    await test.step('storage + realization are exact (GET variables) and plain (no E notation)', async () => {
      const sid = await getActiveSessionId(page)
      const vars = await getSessionVariables(page, sid)
      // The declared exact-string float survives verbatim (no rounding, no E).
      expect(vars.price.value).toBe(PRICE)
      expect(vars.price.type).toBe('float')
      // A low-precision setter literal may serialize as a JS number; the value and type still match.
      expect(String(vars.rate.value)).toBe(RATE_AFTER)
      expect(vars.rate.type).toBe('float')
    })

    await test.step('the reads prove exact propagation through the engine', async () => {
      const logs = await getLogTexts(page)
      const all = logs.join('\n')
      // Exact match == plain notation (no rounding, no E) at the display layer.
      expect(logs.some((m) => m === `price=${PRICE}`), `expected price=${PRICE}\n${all}`).toBeTruthy()
      expect(
        logs.some((m) => m === `total=${TOTAL}`),
        `expected the derived expression total=${TOTAL}\n${all}`,
      ).toBeTruthy()
      expect(logs.some((m) => m === `rate=${RATE_AFTER}`), `expected rate=${RATE_AFTER}\n${all}`).toBeTruthy()
    })
  })

  test('a rename in the window persists, refactors references, and survives a reload, from the Current view and from the Initial view', async ({
    page,
  }) => {
    test.setTimeout(120_000)
    const testId = await importValidateOpen(page, loadFixture())

    // A live session opens the watcher on Current, so the window opens on Current too.
    await selectEnvironment(page)
    await startRun(page)
    await waitForStatus(page, 'passed')

    await test.step('a rename made on the Current view is kept', async () => {
      // `total` is read only by the read-total node; its own `price` reference stays valid.
      const totalModal = await openInspector(page, 'total')
      await expect(totalModal.locator('[data-testid="mode-dropdown"]')).toContainText('Current')
      const win = await clickEdit(totalModal)
      await expect(valueSwitch(win)).toHaveText('Current')
      await renameInModal(win, 'grand_total')
      await saveEdit(win)
      await expect(rowFor(page, 'grand_total')).toBeVisible()
      await expect(rowFor(page, 'total')).toHaveCount(0)
    })

    await test.step('the rename persists, refactors node references, and survives a reload', async () => {
      await toolbarSave(page)
      const persisted = await getTest(page, testId)
      expect(persisted.variables).toHaveProperty('grand_total')
      expect(persisted.variables).not.toHaveProperty('total')
      expect(persisted.variables.grand_total.type).toBe('float')
      // The read-total Log node's message now reads the new name.
      const readTotal = persisted.workflow.nodes.find((n: any) => n.id === 'read-total')
      expect(readTotal.data.config.values.message).toContain('grand_total')

      await openTest(page, testId)
      await expandVariableManager(page)
      await expect(rowFor(page, 'grand_total')).toBeVisible()
    })

    await test.step('a rename made on the Initial view persists too', async () => {
      const win = await openInspectEditViaPencil(page, 'grand_total')
      await expect(valueSwitch(win)).toHaveText('Initial')
      await renameInModal(win, 'final_total')
      await saveEdit(win)
      await expect(rowFor(page, 'final_total')).toBeVisible()
      await expect(rowFor(page, 'grand_total')).toHaveCount(0)
      await toolbarSave(page)
      const persisted = await getTestVariables(page, testId)
      expect(persisted).toHaveProperty('final_total')
      expect(persisted).not.toHaveProperty('grand_total')
    })
  })

  test('a live Current float value set in the window applies, keys to the variable, and propagates downstream', async ({
    page,
  }) => {
    test.setTimeout(120_000)
    await importValidateOpen(page, loadFixture())
    // Select the environment before toggling the breakpoint: the node kebab used
    // by setBreakpoint leaves a transient overlay that can block the env popover.
    await selectEnvironment(page)
    await setBreakpoint(page, 'gate')
    await startDebugRun(page)
    await expectPausedAt(page, 'gate')

    const priceModal = await openInspector(page, 'price')
    // Paused before any read: Current is anchored to the exact run-start value.
    await expect(priceModal.locator('[data-testid="scalar-body"]')).toHaveText(PRICE)
    const win = await clickEdit(priceModal)
    await expect(valueSwitch(win)).toHaveText('Current')
    await win.locator('[data-testid="scalar-edit-input"]').fill('-1.5')
    await saveEdit(win)
    // The literal Current value is pushed back to the live session immediately.
    await expect(priceModal.locator('[data-testid="scalar-body"]')).toHaveText('-1.5')

    const sid = await getActiveSessionId(page)
    expect((await getSessionVariables(page, sid)).price.value).toBe('-1.5')
    await closeInspector(page, 'price')

    await clickContinue(page)
    await waitForStatus(page, 'passed')
    const logs = await getLogTexts(page)
    const all = logs.join('\n')
    // The new value reached the read AND re-evaluated the derived expression (-1.5 + 0.01 = -1.49) exactly.
    expect(logs.some((m) => m === 'price=-1.5'), `expected price=-1.5\n${all}`).toBeTruthy()
    expect(logs.some((m) => m === 'total=-1.49'), `expected total=-1.49\n${all}`).toBeTruthy()
  })
})
