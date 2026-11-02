/**
 * V-FN-DRILL-SAVE-DELETE: a Save or a delete made while drilled into a Function touches only that Function's body
 * REQ: REQ-3.1.2.3, REQ-3.1.3.5
 *
 * Phase: functional-workflow (no run). API seed (POST /tests): a root Log, then a Local Function
 * `sec_fn` whose body holds an SSH Session Open Block (no password yet) and a CSV Parser that writes
 * its Row Count into the local `bound_local`. Validated with zero errors. The password is typed in
 * the Block's sheet, the Saves run from the toolbar and the delete through the Variable Manager row.
 *
 * Pass Criteria:
 * 1. Drilled into `sec_fn` with a newly typed password, the toolbar Save is accepted and the canvas
 *    still shows the Function's two Blocks under the Function breadcrumb; the stored body holds the
 *    same two Blocks with the password sealed, and the root holds the Log and the Function.
 * 2. The back arrow returns to the Test's own Blocks; reopening the Test and drilling in shows the
 *    same body.
 * 3. Deleting the bound local while drilled keeps both Blocks on the canvas, and the next Save is
 *    accepted: the stored body keeps both Blocks and names `bound_local` nowhere.
 */

import { randomUUID } from 'node:crypto'
import { test, expect, type Page } from '../../helpers/playwright-fixtures'
import { BACKEND_URL } from '../../helpers/config'
import {
  createValidTest,
  localFunctionNode,
  logNode,
  openTest,
  startEdge,
  validateTest,
} from '../../helpers/fn-seed'
import { SECRET_ENVELOPE } from '../../helpers/secret-canary'
import { expandVariableManager, variableRow } from '../../helpers/variable-create'
import { canvasBlockIds, digIn, openBlockSheet, saveBlockSheet, saveTest } from '../../helpers/workbench'
import {
  pathsNaming,
  readStoredTest,
  storedBodyNode,
  storedNode,
} from '../var-manager-panel/references-helpers'

const ROOT_LOG = 'drill-root-log'
const FN_ID = 'drill-sec-fn'
const FN_LABEL = 'sec_fn'
const SSH = 'drill-ssh'
const CSV = 'drill-csv'
const BODY = [SSH, CSV]

function pluginNode(
  id: string,
  label: string,
  elementType: string,
  category: string,
  values: Record<string, unknown>,
  outputBindings: Record<string, string>,
  position: { x: number; y: number },
): Record<string, unknown> {
  return {
    id,
    type: 'workflowNode',
    position,
    data: {
      label,
      elementType,
      nodeType: 'plugin',
      category,
      version: '1.0.0',
      expressionFields: [],
      templateFields: [],
      variableExpressionKeys: [],
      config: { values, outputBindings, profileBindings: [] },
    },
    measured: { width: 120, height: 62 },
  }
}

async function expectDrilledBody(page: Page): Promise<void> {
  await expect(page.getByTestId('canvas-breadcrumb')).toContainText(FN_LABEL)
  for (const id of BODY) await expect(page.getByTestId(`workflow-node-${id}`)).toBeVisible()
  await expect.poll(async () => (await canvasBlockIds(page)).sort()).toEqual([...BODY].sort())
}

/** Type a value into a Block setting through its "Edit value" sheet, then close that sheet. */
async function typeSheetValue(page: Page, setting: string, value: string): Promise<void> {
  await page.getByTestId(`param-expand-${setting}`).first().click()
  const valueSheet = page.getByTestId('value-editor-sheet')
  await expect(valueSheet).toBeVisible()
  await valueSheet.locator('.cm-content').first().click()
  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.press('Delete')
  await page.keyboard.insertText(value)
  await expect(valueSheet.locator('.cm-content').first()).toHaveText(value)
  await valueSheet.getByTestId('value-editor-save-button').click()
  await valueSheet.getByTestId('value-editor-cancel-button').click()
  await expect(valueSheet).toHaveCount(0)
}

let testId: string | undefined

test.describe('V-FN-DRILL-SAVE-DELETE: drilled Save and delete keep the Function body', () => {
  test.afterEach(async ({ request }) => {
    if (testId) await request.delete(`${BACKEND_URL}/tests/${testId}`).catch(() => undefined)
    testId = undefined
  })

  test('a drilled Save with a newly typed secret and a drilled delete of a bound local keep the body', async ({
    page,
    request,
  }) => {
    await request.delete(`${BACKEND_URL}/workbench/session/`).catch(() => undefined)
    testId = await createValidTest(request, {
      name: `zz-drill-save-delete-${randomUUID().slice(0, 8)}`,
      nodes: [
        logNode(ROOT_LOG, 'Root log', "'root'", { x: 300, y: 120 }),
        localFunctionNode(
          FN_ID,
          FN_LABEL,
          {
            variables: [{ name: 'bound_local', type: 'integer', value: 0 }],
            nodes: [
              pluginNode(SSH, 'Open SSH', 'ssh-session-open', 'remote', { host: '10.0.0.5', username: 'svc' }, {}, {
                x: 200,
                y: 140,
              }),
              pluginNode(
                CSV,
                'Parse rows',
                'csv-parser',
                'data',
                { operation: 'parse', csv_content: 'a,b\n1,2', delimiter: ',', has_header: true },
                { row_count: 'bound_local' },
                { x: 200, y: 300 },
              ),
            ],
            edges: [
              { id: 'e-start-ssh', source: 'start-node', target: SSH },
              { id: 'e-ssh-csv', source: SSH, target: CSV },
            ],
          },
          { x: 300, y: 280 },
        ),
      ],
      edges: [startEdge(ROOT_LOG), { id: 'e-root-fn', source: ROOT_LOG, target: FN_ID }],
    })
    const validation = await validateTest(request, testId, 'run')
    expect(validation.errors, JSON.stringify(validation.errors)).toHaveLength(0)
    await openTest(page, testId)
    await expandVariableManager(page)
    await digIn(page, FN_ID)
    await expectDrilledBody(page)

    const password = `typed-pass-${randomUUID().slice(0, 8)}`
    await test.step('drilled, a newly typed secret and the toolbar Save keep the body on the canvas', async () => {
      const sheet = await openBlockSheet(page, SSH)
      await typeSheetValue(page, 'password', password)
      await saveBlockSheet(sheet)
      await saveTest(page)
      await expectDrilledBody(page)
      const stored = await readStoredTest(page, testId!)
      expect(stored.workflow.nodes.map((node) => node.id).sort()).toEqual([FN_ID, ROOT_LOG].sort())
      const body = storedNode(stored, FN_ID).data.localDefinition?.workflow?.nodes ?? []
      expect(body.map((node) => node.id).sort()).toEqual([...BODY].sort())
      const sealed = String(storedBodyNode(stored, FN_ID, SSH).data.config?.values?.password)
      expect(sealed.startsWith(SECRET_ENVELOPE), 'the typed password is stored sealed').toBe(true)
      expect(JSON.stringify(stored)).not.toContain(password)
    })

    await test.step('the back arrow returns to the Test; reopening shows the same body', async () => {
      await page.getByTestId('breadcrumb-back-arrow').click()
      await expect(page.getByTestId('canvas-breadcrumb')).not.toContainText(FN_LABEL)
      await expect.poll(async () => (await canvasBlockIds(page)).sort()).toEqual([FN_ID, ROOT_LOG].sort())
      await openTest(page, testId!)
      await expandVariableManager(page)
      await digIn(page, FN_ID)
      await expectDrilledBody(page)
    })

    await test.step('deleting the bound local while drilled keeps the body and the next Save is accepted', async () => {
      const row = variableRow(page, 'bound_local')
      await row.hover()
      await row.locator('[data-testid^="delete-button-"]').click()
      const dialog = page.getByRole('alertdialog')
      await expect(dialog).toBeVisible()
      await dialog.getByRole('button', { name: 'Delete', exact: true }).click()
      await expect(dialog).toBeHidden()
      await expect(variableRow(page, 'bound_local')).toHaveCount(0)
      await expectDrilledBody(page)
      await saveTest(page)
      await expectDrilledBody(page)
      const stored = await readStoredTest(page, testId!)
      const fn = storedNode(stored, FN_ID)
      expect((fn.data.localDefinition?.workflow?.nodes ?? []).map((node) => node.id).sort()).toEqual(
        [...BODY].sort(),
      )
      expect(pathsNaming(fn, 'bound_local'), 'bound_local is named nowhere in the Function').toEqual([])
    })
  })
})
