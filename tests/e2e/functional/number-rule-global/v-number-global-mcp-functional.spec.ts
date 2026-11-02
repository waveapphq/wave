/**
 * V-NUMBER-GLOBAL-MCP-FUNCTIONAL: a Global variable keeps every digit from MCP to the browser and back
 * Wireframe: none (functional)
 * Design Decisions: FIELD-1, FIELDERR-1
 * REQ: REQ-3.1.3.14
 *
 * Stack-wide state: two `zz_11541_s8_*` System variables set through the live MCP `update_variables` tool (its
 * arguments written as raw JSON, so the integer travels with all 19 digits), edited in Settings > System Variables
 * and read by a run. A third, unsaved row is typed into. Every variable is removed afterwards.
 *
 * Pass Criteria:
 * 1. `update_variables` sets an integer System variable to 1234567890123456789; the stored value holds all 19 digits.
 * 2. The System Variables dialog shows `1234567890123456789` in the row's number box.
 * 3. Saving the dialog from the browser keeps every digit of the row left as it was, and stores the 19 digits typed
 *    into the other row.
 * 4. A run reads the variable as that exact integer: `system.<name> + 1` logs `1234567890123456790`.
 * 5. A new System variable row of type Integer typed `-` shows `Enter a valid integer value` under it and holds the
 *    dialog's Save until the text is a number.
 */

import { test, expect, type APIRequestContext, type Locator } from '../../helpers/playwright-fixtures'
import { BACKEND_URL, ensureEnvironment } from '../../helpers/config'
import {
  entityVariableRow,
  newEntityVariableRow,
  openSystemVariables,
  openSystemVariablesOnNewRow,
  saveVariablesDialog,
  setEntityRowType,
  variablesDialog,
} from '../../helpers/entity-variables'
import { runToken } from '../../helpers/element-types'
import { importValidateAndNavigate } from '../../helpers/fixture-import'
import { finishRun, startRun } from '../../helpers/k8s-run'
import { enableMcpUntilRestart, resetMcpSettings } from '../../helpers/mcp'
import { callToolRaw, closeUnsavedQuestion, deleteTestQuietly, NUMBER_MCP_PORT, typeNumber } from '../../helpers/number-rule'

const BIG = '1234567890123456789'
const BIG_EDITED = '1234567890123456788'

/** A System variable's stored value exactly as the JSON text holds it. */
async function storedSystemValue(request: APIRequestContext, name: string): Promise<string> {
  const resp = await request.get(`${BACKEND_URL}/variables/system`)
  expect(resp.ok(), `GET /variables/system: ${resp.status()}`).toBeTruthy()
  const text = await resp.text()
  const at = text.indexOf(`"${name}"`)
  expect(at, `${name} is stored`).toBeGreaterThan(-1)
  const value = /"value"\s*:\s*("?)(-?\d+)\1/.exec(text.slice(at))
  expect(value, `${name} holds a number`).toBeTruthy()
  return (value as RegExpExecArray)[2]
}

const rowNumberBox = (row: Locator): Locator => row.locator('[data-testid="scalar-edit-input"]')

/** A run that logs `system.<name> + 1`, then its bookend. */
function readerTest(name: string): Record<string, unknown> {
  const log = (id: string, label: string, message: string, y: number) => ({
    id,
    type: 'workflowNode',
    position: { x: 300, y },
    data: {
      label,
      elementType: 'log',
      nodeType: 'plugin',
      category: 'system',
      version: '1.0.0',
      description: label,
      hasNewerVersion: false,
      expressionFields: ['message'],
      templateFields: [],
      variableExpressionKeys: [],
      config: { values: { message, level: 'INFO' }, outputBindings: {}, profileBindings: [] },
    },
    measured: { width: 140, height: 62 },
  })
  const read = 'c8f0a7b2-5d14-4e3a-9b61-11541008a101'
  const done = 'c8f0a7b2-5d14-4e3a-9b61-11541008a102'
  return {
    name: `zz-11541-s8-global-reader-${runToken()}`,
    version: '1.0.0',
    description: 'Reads a System variable past 2^53',
    workflow: {
      nodes: [
        log(read, 'Read Global', `f'global={system.${name} + 1}'`, 100),
        log(done, 'Global Done', "'number-global-done'", 210),
      ],
      edges: [
        { id: 'e-start-read', source: 'start-node', target: read },
        { id: 'e-read-done', source: read, target: done },
      ],
    },
    variables: {},
    metadata: {},
  }
}

test.describe('V-NUMBER-GLOBAL-MCP-FUNCTIONAL: a Global variable keeps every digit', () => {
  const token = runToken().replace(/-/g, '_')
  const kept = `zz_11541_s8_kept_${token}`
  const edited = `zz_11541_s8_edited_${token}`
  let testId = ''

  test.afterEach(async ({ page, request }) => {
    for (const name of [kept, edited]) {
      await request.delete(`${BACKEND_URL}/variables/system/${name}`).catch(() => undefined)
    }
    await request.delete(`${BACKEND_URL}/workbench/session/`).catch(() => undefined)
    await deleteTestQuietly(request, testId)
    await resetMcpSettings(page)
  })

  test('MCP update_variables, the System Variables dialog and a run keep all 19 digits', async ({ page, request }) => {
    test.setTimeout(240_000)
    await ensureEnvironment(request)
    await enableMcpUntilRestart(page, NUMBER_MCP_PORT)

    await test.step('update_variables stores both integers with every digit', async () => {
      const args = `{"scope": "system", "set": {"${kept}": {"type": "integer", "value": ${BIG}}, "${edited}": {"type": "integer", "value": ${BIG}}}}`
      const result = callToolRaw(NUMBER_MCP_PORT, 'update_variables', args)
      expect(result.payload.updated, JSON.stringify(result.payload)).toBe(true)
      expect(await storedSystemValue(request, kept)).toBe(BIG)
      expect(await storedSystemValue(request, edited)).toBe(BIG)
    })

    await test.step('the dialog shows every digit and a browser save keeps them', async () => {
      const dialog = await openSystemVariables(page)
      await expect(rowNumberBox(await entityVariableRow(dialog, kept))).toHaveValue(BIG)
      const editedBox = rowNumberBox(await entityVariableRow(dialog, edited))
      await expect(editedBox).toHaveValue(BIG)
      await typeNumber(page, editedBox, BIG_EDITED)
      await saveVariablesDialog(dialog)
      expect(await storedSystemValue(request, kept), 'the row left as it was keeps its digits').toBe(BIG)
      expect(await storedSystemValue(request, edited), 'the typed 19 digits are stored as typed').toBe(BIG_EDITED)
      const reopened = await openSystemVariables(page)
      await expect(rowNumberBox(await entityVariableRow(reopened, kept))).toHaveValue(BIG)
      await expect(rowNumberBox(await entityVariableRow(reopened, edited))).toHaveValue(BIG_EDITED)
      await reopened.locator('[data-testid="edit-dialog-cancel"]').click()
      await expect(variablesDialog(page)).toBeHidden()
    })

    await test.step('a run reads the Global variable as its exact integer', async () => {
      testId = await importValidateAndNavigate(page, readerTest(kept))
      const status = await startRun(page)
      const logs = await finishRun(page, status, 'number-global-done')
      expect(logs, logs.join('\n')).toContain('global=1234567890123456790')
    })
  })

  test('a new Integer System variable row typed `-` is named and holds Save', async ({ page }) => {
    test.setTimeout(120_000)
    const dialog = await openSystemVariablesOnNewRow(page)
    const row = newEntityVariableRow(dialog)
    await row.locator('[data-testid="variable-name-input"]').fill(`zz_11541_s8_typing_${token}`)
    await setEntityRowType(page, row, 'Integer')
    const chip = row.getByRole('button', { name: /\(null\)$/ })
    if (await chip.isVisible().catch(() => false)) await chip.click()
    const box = rowNumberBox(row)
    const save = dialog.locator('[data-testid="edit-dialog-save"]')
    await typeNumber(page, box, '-')
    await expect(row.locator('p[role="alert"]')).toHaveText('Enter a valid integer value')
    await expect(save).toBeDisabled()
    await typeNumber(page, box, '-12')
    await expect(row.locator('p[role="alert"]')).toHaveCount(0)
    await expect(save).toBeEnabled()
    await dialog.locator('[data-testid="edit-dialog-cancel"]').click()
    await closeUnsavedQuestion(page)
    await expect(variablesDialog(page)).toBeHidden()
  })
})
