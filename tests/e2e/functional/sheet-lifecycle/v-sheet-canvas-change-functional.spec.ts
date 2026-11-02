/**
 * V-SHEET-CANVAS-CHANGE: an open config sheet follows canvas changes it did not make and keeps its own edits
 * Design Decisions: CANVAS-230
 * REQ: REQ-3.1.1.5, REQ-3.1.3.1
 *
 * Phase: functional-workflow (no run). API seed (POST /tests) per test, validated with zero errors:
 * (a) a CSV Parser at the root whose Row Count writes the Test variable `gone_rows`, and a Local
 *     Function whose inner CSV Parser writes its local `gone_local`;
 * (b) a Local Function Block `fn_a` whose output `result` writes the Test variable `total`, and a
 *     Log Block beside it.
 * Deletes go through the Variable Manager row and its dialog; edits through the sheets.
 *
 * Pass Criteria:
 * 1. With a Block's sheet open, deleting the variable its output writes (a Test variable at the root,
 *    a Function local inside the Function) empties that binding in the open sheet and Save stays
 *    disabled; a rename and Save afterwards stores the new name and no binding to the deleted name.
 * 2. A Function Block sheet holding a typed, unsaved Name keeps it when another Block is selected,
 *    when another Block is renamed, and when the variable its output writes is deleted (that binding
 *    empties); its Save then stores the typed Name and no binding to the deleted variable.
 */

import { randomUUID } from 'node:crypto'
import { test, expect, type Locator, type Page } from '../../helpers/playwright-fixtures'
import { BACKEND_URL } from '../../helpers/config'
import { createValidTest, localFunctionNode, logNode, openTest, startEdge, validateTest } from '../../helpers/fn-seed'
import { expandVariableManager, variableRow } from '../../helpers/variable-create'
import {
  digIn,
  openBlockSheet,
  openFunctionBlockSheet,
  saveBlockSheet,
  saveTest,
} from '../../helpers/workbench'
import {
  pathsNaming,
  readStoredTest,
  storedBodyNode,
  storedNode,
} from '../var-manager-panel/references-helpers'

const ROOT_CSV = 'chg-root-csv'
const BIND_FN = 'chg-bind-fn'
const INNER_CSV = 'chg-inner-csv'
const CALL_FN = 'chg-call-fn'
const OTHER = 'chg-other-log'

function csvNode(id: string, label: string, writes: string, position = { x: 300, y: 160 }): Record<string, unknown> {
  return {
    id,
    type: 'workflowNode',
    position,
    data: {
      label,
      elementType: 'csv-parser',
      nodeType: 'plugin',
      category: 'data',
      version: '1.0.0',
      expressionFields: [],
      templateFields: [],
      variableExpressionKeys: [],
      config: {
        values: { operation: 'parse', csv_content: 'a,b\n1,2', delimiter: ',', has_header: true },
        outputBindings: { row_count: writes },
        profileBindings: [],
      },
    },
    measured: { width: 120, height: 62 },
  }
}

function setterNode(id: string, variables: Record<string, string>): Record<string, unknown> {
  return {
    id,
    type: 'workflowNode',
    position: { x: 200, y: 160 },
    data: {
      label: 'Set result',
      elementType: 'variable-setter',
      nodeType: 'control',
      category: 'flow',
      version: '1.0.0',
      expressionFields: [],
      templateFields: [],
      variableExpressionKeys: Object.keys(variables),
      variableTypes: Object.fromEntries(Object.keys(variables).map((name) => [name, 'string'])),
      config: { values: { variables }, outputBindings: {}, profileBindings: [] },
    },
    measured: { width: 120, height: 62 },
  }
}

/** Delete a variable through its Variable Manager row and the confirmation dialog. */
async function deleteThroughRow(page: Page, name: string): Promise<void> {
  const row = variableRow(page, name)
  await row.hover()
  await row.locator('[data-testid^="delete-button-"]').click()
  const dialog = page.getByRole('alertdialog')
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: 'Delete', exact: true }).click()
  await expect(dialog).toBeHidden()
  await expect(variableRow(page, name)).toHaveCount(0)
}

/** Open a plugin Block's sheet while a Function Block sheet is already open. */
async function openPluginSheetBeside(page: Page, blockId: string): Promise<Locator> {
  const configure = page.getByTestId(`workflow-node-${blockId}`).locator('[data-testid="node-configure"]')
  // Both windows are the one Block window; the plugin's is the one without the Function name box.
  const sheet = page.getByTestId('element-config-sheet').filter({ hasNot: page.getByTestId('function-name-input') })
  await expect(async () => {
    await configure.dispatchEvent('click')
    await expect(sheet).toBeVisible({ timeout: 2_000 })
  }).toPass({ timeout: 15_000 })
  return sheet
}

function binding(sheet: Locator, output: string): Locator {
  return sheet.locator(`[data-testid="output-row-${output}"] [role="combobox"]`).first()
}

async function seed(request: Parameters<typeof createValidTest>[0], spec: Parameters<typeof createValidTest>[1]): Promise<string> {
  await request.delete(`${BACKEND_URL}/workbench/session/`).catch(() => undefined)
  const id = await createValidTest(request, spec)
  const validation = await validateTest(request, id, 'run')
  expect(validation.errors, JSON.stringify(validation.errors)).toHaveLength(0)
  return id
}

let testId: string | undefined

test.describe('V-SHEET-CANVAS-CHANGE: open sheets and canvas changes', () => {
  test.afterEach(async ({ request }) => {
    if (testId) await request.delete(`${BACKEND_URL}/tests/${testId}`).catch(() => undefined)
    testId = undefined
  })

  test('an open Block sheet drops the binding to a variable deleted under it, at the root and in a Function', async ({
    page,
    request,
  }) => {
    testId = await seed(request, {
      name: `zz-sheet-var-delete-${randomUUID().slice(0, 8)}`,
      variables: { gone_rows: { type: 'integer', value: 0 } },
      nodes: [
        csvNode(ROOT_CSV, 'Parse rows', 'gone_rows'),
        localFunctionNode(
          BIND_FN,
          'Bind_Fn',
          {
            variables: [{ name: 'gone_local', type: 'integer', value: 0 }],
            nodes: [csvNode(INNER_CSV, 'Parse inner rows', 'gone_local')],
            edges: [{ id: 'e-start-inner-csv', source: 'start-node', target: INNER_CSV }],
          },
          { x: 300, y: 320 },
        ),
      ],
      edges: [startEdge(ROOT_CSV), { id: 'e-csv-fn', source: ROOT_CSV, target: BIND_FN }],
    })
    await openTest(page, testId)
    await expandVariableManager(page)

    await test.step('root: deleting the Test variable empties the open sheet binding; Save stays off', async () => {
      const sheet = await openBlockSheet(page, ROOT_CSV)
      await expect(binding(sheet, 'row_count')).toHaveValue('gone_rows')
      await deleteThroughRow(page, 'gone_rows')
      await expect(binding(sheet, 'row_count')).toHaveValue('')
      await expect(sheet.getByRole('button', { name: 'Save', exact: true })).toBeDisabled()
      await sheet.getByTestId('element-name-input').fill('Parse all rows')
      await saveBlockSheet(sheet)
    })

    await test.step('in the Function: deleting the local empties the open sheet binding; Save stays off', async () => {
      await digIn(page, BIND_FN)
      await expect(page.getByTestId(`workflow-node-${INNER_CSV}`)).toBeVisible()
      const sheet = await openBlockSheet(page, INNER_CSV)
      await expect(binding(sheet, 'row_count')).toHaveValue('gone_local')
      await deleteThroughRow(page, 'gone_local')
      await expect(binding(sheet, 'row_count')).toHaveValue('')
      await expect(sheet.getByRole('button', { name: 'Save', exact: true })).toBeDisabled()
      await sheet.getByTestId('element-name-input').fill('Parse all inner rows')
      await saveBlockSheet(sheet)
    })

    await test.step('the saved Test holds the new names and no binding to either deleted variable', async () => {
      await saveTest(page)
      const stored = await readStoredTest(page, testId!)
      expect(storedNode(stored, ROOT_CSV).data.label).toBe('Parse all rows')
      expect(storedBodyNode(stored, BIND_FN, INNER_CSV).data.label).toBe('Parse all inner rows')
      expect(pathsNaming(stored, 'gone_rows'), 'gone_rows is named nowhere').toEqual([])
      expect(pathsNaming(stored, 'gone_local'), 'gone_local is named nowhere').toEqual([])
    })
  })

  test('a Function Block sheet keeps a typed Name through a selection, a rename and a variable delete', async ({
    page,
    request,
  }) => {
    const callFn = localFunctionNode(CALL_FN, 'fn_a', {
      outputs: [{ name: 'result', type: 'string' }],
      nodes: [setterNode('chg-fn-set', { result: "'done'" })],
      edges: [{ id: 'e-start-chg-set', source: 'start-node', target: 'chg-fn-set' }],
    }) as { data: Record<string, unknown> }
    callFn.data.config = { values: {}, outputBindings: { result: 'total' }, profileBindings: [] }
    testId = await seed(request, {
      name: `zz-sheet-fn-name-${randomUUID().slice(0, 8)}`,
      variables: { total: { type: 'string', value: '' } },
      nodes: [callFn, logNode(OTHER, 'Other', "'other'", { x: 300, y: 360 })],
      edges: [startEdge(CALL_FN), { id: 'e-fn-other', source: CALL_FN, target: OTHER }],
    })

    await openTest(page, testId)
    await expandVariableManager(page)
    const fnSheet = await openFunctionBlockSheet(page, CALL_FN)
    const name = fnSheet.getByTestId('function-name-input')
    await expect(name).toHaveValue('fn_a')
    await expect(binding(fnSheet, 'result')).toHaveValue('total')
    await name.fill('renamed_fn')

    await test.step('another Block is selected: the typed Name stays', async () => {
      const other = page.getByTestId(`workflow-node-${OTHER}`)
      await other.locator('button').first().dispatchEvent('click')
      await expect(other).toHaveAttribute('data-selected', 'true')
      await expect(name).toHaveValue('renamed_fn')
    })

    await test.step('another Block is renamed: the typed Name stays', async () => {
      const plugin = await openPluginSheetBeside(page, OTHER)
      await plugin.getByTestId('element-name-input').fill('Other renamed')
      await saveBlockSheet(plugin)
      await expect(page.getByTestId(`workflow-node-${OTHER}`)).toContainText('Other renamed')
      await expect(name).toHaveValue('renamed_fn')
    })

    await test.step('the bound variable is deleted: the binding empties and the typed Name stays', async () => {
      await deleteThroughRow(page, 'total')
      await expect(binding(fnSheet, 'result')).toHaveValue('')
      await expect(name).toHaveValue('renamed_fn')
    })

    await test.step('the sheet Save stores the typed Name and no binding to the deleted variable', async () => {
      await fnSheet.getByRole('button', { name: 'Save', exact: true }).click()
      await expect(fnSheet).toHaveCount(0)
      await saveTest(page)
      const saved = await readStoredTest(page, testId!)
      expect(storedNode(saved, CALL_FN).data.label).toBe('renamed_fn')
      expect(storedNode(saved, OTHER).data.label).toBe('Other renamed')
      expect(pathsNaming(saved, 'total'), 'total is named nowhere').toEqual([])
    })
  })
})
