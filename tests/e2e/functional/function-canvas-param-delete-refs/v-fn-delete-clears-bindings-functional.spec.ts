/**
 * V-FN-DELETE-CLEARS-BINDINGS: deleting a Function local or output clears the inner bindings that write it
 * Design Decisions: none
 * REQ: REQ-3.1.2.3
 *
 * Phase: functional-workflow (no run). API seed (POST /tests): a Local Function `Bind_Fn` with a
 * local `bound_local` and an output `res_out`; inside it one CSV Parser writes its Row Count into
 * `bound_local` and a second one into `res_out`. Validated with zero errors. Deletes go through the
 * Variable Manager row and its dialog, undo through the toolbar.
 *
 * Pass Criteria:
 * 1. Drilled into the Function, deleting `bound_local` empties the Row Count binding of the Block
 *    that wrote it (its sheet shows it empty); one undo brings back both the local and the binding.
 * 2. The same for the output `res_out` and the Block that wrote it.
 * 3. After the undos nothing is left unsaved; a later rename and Save stores a Function that still
 *    declares both and Blocks that still write them.
 */

import { randomUUID } from 'node:crypto'
import { test, expect, type Page } from '../../helpers/playwright-fixtures'
import { BACKEND_URL } from '../../helpers/config'
import {
  createValidTest,
  localFunctionNode,
  openTest,
  startEdge,
  storedLocalDefinition,
  validateTest,
} from '../../helpers/fn-seed'
import { expandVariableManager, variableRow } from '../../helpers/variable-create'
import { clickUndo, digIn, openBlockSheet, saveBlockSheet, saveBtn, saveTest } from '../../helpers/workbench'
import { pathsNaming, readStoredTest, storedBodyNode } from '../var-manager-panel/references-helpers'

const FN_ID = 'del-bind-fn'
const LOCAL_WRITER = 'del-csv-local'
const OUTPUT_WRITER = 'del-csv-out'

function csvNode(id: string, label: string, writes: string, position: { x: number; y: number }): Record<string, unknown> {
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

/** The Row Count binding the Block's sheet shows; the sheet is closed again. */
async function shownBinding(page: Page, blockId: string): Promise<string> {
  const sheet = await openBlockSheet(page, blockId)
  const field = sheet.locator('[data-testid="output-row-row_count"] [role="combobox"]').first()
  await expect(field).toBeVisible()
  const value = await field.inputValue()
  await sheet.getByRole('button', { name: 'Close', exact: true }).first().click()
  await expect(sheet).toHaveCount(0)
  return value
}

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

let testId: string | undefined

test.describe('V-FN-DELETE-CLEARS-BINDINGS: a delete clears what it says it clears', () => {
  test.afterEach(async ({ request }) => {
    if (testId) await request.delete(`${BACKEND_URL}/tests/${testId}`).catch(() => undefined)
    testId = undefined
  })

  test('deleting a bound local or output clears the inner binding and one undo brings both back', async ({
    page,
    request,
  }) => {
    await request.delete(`${BACKEND_URL}/workbench/session/`).catch(() => undefined)
    testId = await createValidTest(request, {
      name: `zz-fn-delete-bindings-${randomUUID().slice(0, 8)}`,
      nodes: [
        localFunctionNode(FN_ID, 'Bind_Fn', {
          outputs: [{ name: 'res_out', type: 'integer' }],
          variables: [{ name: 'bound_local', type: 'integer', value: 0 }],
          nodes: [
            csvNode(LOCAL_WRITER, 'Count into local', 'bound_local', { x: 200, y: 140 }),
            csvNode(OUTPUT_WRITER, 'Count into output', 'res_out', { x: 200, y: 300 }),
          ],
          edges: [
            { id: 'e-start-local-writer', source: 'start-node', target: LOCAL_WRITER },
            { id: 'e-local-output-writer', source: LOCAL_WRITER, target: OUTPUT_WRITER },
          ],
        }),
      ],
      edges: [startEdge(FN_ID)],
    })
    const validation = await validateTest(request, testId, 'run')
    expect(validation.errors, JSON.stringify(validation.errors)).toHaveLength(0)
    await openTest(page, testId)
    await expandVariableManager(page)
    await digIn(page, FN_ID)
    await expect(page.getByTestId(`workflow-node-${LOCAL_WRITER}`)).toBeVisible()

    for (const [name, writer] of [
      ['bound_local', LOCAL_WRITER],
      ['res_out', OUTPUT_WRITER],
    ] as const) {
      await test.step(`deleting ${name} empties the binding of the Block that wrote it`, async () => {
        expect(await shownBinding(page, writer)).toBe(name)
        await deleteThroughRow(page, name)
        expect(await shownBinding(page, writer)).toBe('')
      })

      await test.step(`one undo brings back ${name} and its binding`, async () => {
        await clickUndo(page)
        await expect(variableRow(page, name)).toHaveCount(1)
        expect(await shownBinding(page, writer)).toBe(name)
      })
    }

    await test.step('saved after the undos, the Function still declares both and both Blocks still write them', async () => {
      await expect(saveBtn(page), 'the undos left nothing unsaved').toBeDisabled()
      const sheet = await openBlockSheet(page, LOCAL_WRITER)
      await sheet.getByTestId('element-name-input').fill('Count rows into local')
      await saveBlockSheet(sheet)
      await saveTest(page)
      const definition = await storedLocalDefinition(request, testId!, FN_ID)
      expect(definition.variables.map((entry) => entry.name)).toEqual(['bound_local'])
      expect(definition.outputs.map((entry) => entry.name)).toEqual(['res_out'])
      const stored = await readStoredTest(page, testId!)
      expect(storedBodyNode(stored, FN_ID, LOCAL_WRITER).data.label).toBe('Count rows into local')
      expect(pathsNaming(storedBodyNode(stored, FN_ID, LOCAL_WRITER), 'bound_local')).not.toEqual([])
      expect(pathsNaming(storedBodyNode(stored, FN_ID, OUTPUT_WRITER), 'res_out')).not.toEqual([])
    })
  })
})
