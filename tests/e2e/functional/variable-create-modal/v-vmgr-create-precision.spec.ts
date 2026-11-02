/**
 * V-VMGR-CREATE-PRECISION: a table int/float and a nested map float authored in
 * the New variable window's "Edit value" Code view survive save + RUN verbatim
 * (REQ-3.1.3.14). The backend realizes the table with exact
 * int coercion + Decimal floats, and a nested array/map from its verbatim JSON
 * text, so a 19-digit id, a 28-significant-digit decimal, and a high-precision
 * nested float all round-trip exactly through a real execution.
 *
 * Phase: functional-workflow (imports the runnable fixture, saves, runs).
 *
 * Pass Criteria:
 * 1. Author a table `nums` = [{id: <19 digits>, amt: <28 sig>}] and a map
 *    `nested` = {deep: [<28 sig float>]} via the "Edit value" Code view; both create cleanly.
 * 2. Save + run to a passing terminal state.
 * 3. GET /workbench/{sid}/variables returns the EXACT digit strings (no rounding
 *    to a JS double / no E-notation) for all three numbers.
 */

import { test, expect, type Page } from '../../helpers/playwright-fixtures'
import { BACKEND_PORT, ensureEnvironment } from '../../helpers/config'
import { selectEnvironment } from '../../helpers/workbench'
import { createValidTest, logNode, startEdge, openTest } from '../../helpers/fn-seed'
import {
  insertCreateCode,
  openCreateModal,
  saveWindow,
  setCreateName,
  setCreateType,
} from '../../helpers/variable-create'

const BIG_ID = '1234567890123456789' // 19 digits (at the integer cap)
const BIG_DECIMAL = '9.876543210987654321098765432' // 28 significant digits (at the float cap)
const NESTED_FLOAT = '1.234567890123456789012345678' // 28 significant digits, nested

/** Author a list / map / table in a New variable window through its "Edit value" Code view (VMGR-110). */
async function authorComplexViaCode(page: Page, name: string, type: string, json: string) {
  const win = await openCreateModal(page)
  await setCreateName(page, name, win)
  await setCreateType(page, type, win)
  await insertCreateCode(page, json, win)
  await saveWindow(page, win)
}

test.describe('V-VMGR-CREATE-PRECISION: table + nested float precision through save + run', () => {
  test('a 19-digit id, a 28-digit decimal, and a nested 28-digit float survive a real run verbatim', async ({
    page,
    request,
  }) => {
    test.setTimeout(180_000)
    await page.request.delete(`http://localhost:${BACKEND_PORT}/workbench/session/`).catch(() => {})
    await ensureEnvironment(request)
    // A single Log node makes the workflow runnable; the literal table / map vars
    // realize at run-start regardless of what the workflow does.
    const testId = await createValidTest(request, {
      name: `V-VMGR-CREATE-PRECISION ${Date.now()}`,
      nodes: [logNode('log1', 'Log', '"precision run"')],
      edges: [startEdge('log1')],
    })
    await openTest(page, testId)

    // Author the precise table + nested map via the "Edit value" Code view.
    await authorComplexViaCode(page, 'nums', 'table', `[{"id": ${BIG_ID}, "amt": ${BIG_DECIMAL}}]`)
    await authorComplexViaCode(page, 'nested', 'map', `{"deep": [${NESTED_FLOAT}]}`)

    // Save the test (persists the exact strings).
    const saveButton = page.locator('[data-testid="toolbar-save-button"]')
    await expect(saveButton).toBeEnabled()
    await saveButton.click()
    await expect(saveButton).toBeDisabled({ timeout: 10_000 })

    // Run to a passing terminal state.
    await selectEnvironment(page)
    await page.locator('[data-testid="run-button"]').click()
    await expect(page.locator('[data-testid="workflow-status"]')).toHaveAttribute(
      'data-status',
      'passed',
      { timeout: 30_000 },
    )

    // The session-variables endpoint must carry the EXACT digit strings - read
    // the RAW response text (parsing to JS would round a 19-digit int / a
    // 28-digit decimal).
    const sessionResp = await page.request.get(
      `http://localhost:${BACKEND_PORT}/workbench/session`,
    )
    const sessionId = (await sessionResp.json()).data.session_id as string
    const varsResp = await page.request.get(
      `http://localhost:${BACKEND_PORT}/workbench/${sessionId}/variables`,
    )
    const raw = await varsResp.text()
    expect(raw, 'the 19-digit id survives verbatim').toContain(BIG_ID)
    expect(raw, 'the 28-digit table decimal survives verbatim').toContain(BIG_DECIMAL)
    expect(raw, 'the nested 28-digit float survives verbatim').toContain(NESTED_FLOAT)
    // And no E-notation crept in.
    expect(raw).not.toContain('E+')
    expect(raw).not.toContain('e+')
  })
})
