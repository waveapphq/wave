/**
 * V-SECRET-DEFINITION-CHANGE: a saved secret replaced in its Edit window keeps the new value secret
 * Design Decisions: VMGR-108, SECUI-1
 * REQ: REQ-3.1.3.5, REQ-3.1.3.13
 *
 * Phase: functional-workflow (imports its own Test, saves it and runs it).
 *
 * Pass Criteria:
 * 1. "Delete & Edit" on a saved secret String empties its field; the value typed there is saved.
 * 2. After Change kind on a saved secret String the masked control is gone and the Expression
 *    box is empty.
 * 3. After Change type to Integer on a saved secret String the masked control is gone and the
 *    number box holds the new type's start value 0.
 * 4. Save in each window and the Test save store all three as secrets with the typed values: the
 *    saved Test reads them masked with the new kind and type, and their rows show `********`.
 * 5. A run uses the typed values (each proof Log passes) while a Log printing any of them
 *    logs `********`, and no console line carries a typed value.
 */

import { test, expect, type Locator } from '../../helpers/playwright-fixtures'
import { BACKEND_URL } from '../../helpers/config'
import { importValidateAndNavigate } from '../../helpers/fixture-import'
import { logNode } from '../../helpers/fn-seed'
import { formatEntries, type LogEntry } from '../../helpers/log-reader'
import { runToEnd, saveTest, selectEnvironment } from '../../helpers/workbench'
import {
  editProtectedValue,
  expandVariableManager,
  expectWindowValue,
  openEditWindow,
  rekindInWindow,
  retypeInWindow,
  saveWindow,
  setWindowValue,
  valueEditor,
  valueField,
  variableRow,
} from '../../helpers/variable-create'

const MASK = '********'
const KIND_SOURCE = "'kind-' + 'rot8ted'"
const KIND_VALUE = 'kind-rot8ted'
const TYPE_VALUE = 4821
const ROTATED_VALUE = 'rot-new-7733'

const LOGS: Array<{ id: string; message: string; line: string }> = [
  { id: 'rd', message: 'rot_tok', line: MASK },
  { id: 'rp', message: `'rot-ok' if rot_tok == '${ROTATED_VALUE}' else 'rot-bad'`, line: 'rot-ok' },
  { id: 'kd', message: 'kind_tok', line: MASK },
  { id: 'kp', message: `'kind-ok' if kind_tok == '${KIND_VALUE}' else 'kind-bad'`, line: 'kind-ok' },
  { id: 'td', message: 'type_tok', line: MASK },
  { id: 'tp', message: `'type-ok' if type_tok == ${TYPE_VALUE} else 'type-bad'`, line: 'type-ok' },
]

function fixture(): Record<string, unknown> {
  const nodes = LOGS.map((log, index) => logNode(log.id, log.id, log.message, { x: 300, y: 120 + index * 100 }))
  const edges = LOGS.map((log, index) => ({
    id: `e-${log.id}`,
    source: index === 0 ? 'start-node' : LOGS[index - 1].id,
    target: log.id,
    type: 'default',
  }))
  return {
    name: 'Secret Definition Change E2E',
    version: '1.0.0',
    description: 'Three saved secret Strings: one replaced, one changes Kind, one changes Type.',
    workflow: { nodes, edges },
    variables: {
      rot_tok: { value: 'rot-old-7730', type: 'string', scope: 'test', secret: true },
      kind_tok: { value: 'kind-old-7731', type: 'string', scope: 'test', secret: true },
      type_tok: { value: 'type-old-7732', type: 'string', scope: 'test', secret: true },
    },
    metadata: { tags: [], suite_id: null, parent_suite: null },
  }
}

const maskedField = (win: Locator): Locator =>
  valueField(win).getByRole('button', { name: 'Value: Edit protected value', exact: true })

const linesOf = (entries: readonly LogEntry[], id: string): string[] =>
  entries.filter((entry) => entry.source === `Log : ${id}`).map((entry) => entry.message)

let testId = ''

test.describe('V-SECRET-DEFINITION-CHANGE', () => {
  test.afterEach(async ({ request }) => {
    if (testId) await request.delete(`${BACKEND_URL}/tests/${testId}`).catch(() => undefined)
    testId = ''
  })

  test('Delete & Edit, Change kind and Change type replace a saved secret; the typed value is saved secret and masked in the log', async ({
    page,
    request,
  }) => {
    test.setTimeout(180_000)
    testId = await importValidateAndNavigate(page, fixture())
    await expandVariableManager(page)

    await test.step('Delete & Edit: the masked control gives way to the empty field, which takes the new value', async () => {
      const win = await openEditWindow(page, 'rot_tok')
      await expect(maskedField(win)).toBeVisible()
      await editProtectedValue(page, win, 'Delete & Edit')
      await expect(valueEditor(page, win)).toHaveValue('')
      await setWindowValue(page, win, ROTATED_VALUE)
      await saveWindow(page, win)
    })

    await test.step('Change kind: the masked control gives way to an empty Expression box', async () => {
      const win = await openEditWindow(page, 'kind_tok')
      await expect(maskedField(win)).toBeVisible()
      await rekindInWindow(page, win, 'Expression')
      await expect(maskedField(win)).toHaveCount(0)
      await expect(valueEditor(page, win)).toHaveText('')
      await setWindowValue(page, win, KIND_SOURCE)
      await saveWindow(page, win)
    })

    await test.step('Change type: the masked control gives way to the Integer box at 0', async () => {
      const win = await openEditWindow(page, 'type_tok')
      await expect(maskedField(win)).toBeVisible()
      await retypeInWindow(page, win, 'integer')
      await expect(maskedField(win)).toHaveCount(0)
      await expectWindowValue(win, 0)
      await setWindowValue(page, win, TYPE_VALUE)
      await saveWindow(page, win)
    })

    await test.step('the Test save stores all three secret, with the new kind and type', async () => {
      await saveTest(page)
      for (const name of ['rot_tok', 'kind_tok', 'type_tok']) {
        await expect(variableRow(page, name).locator('[data-testid^="variable-value-"]')).toHaveText(MASK)
      }
      const saved = await request.get(`${BACKEND_URL}/tests/${testId}`)
      expect(saved.ok(), `GET /tests/${testId}: ${saved.status()}`).toBeTruthy()
      const variables = (await saved.json()).data.variables as Record<string, Record<string, unknown>>
      expect(variables.rot_tok).toMatchObject({ type: 'string', secret: true, value: MASK })
      expect(variables.kind_tok).toMatchObject({ type: 'string', secret: true, value: MASK, isExpression: true })
      expect(variables.type_tok).toMatchObject({ type: 'integer', secret: true, value: MASK })
    })

    await test.step('a run uses the typed values and logs each one masked', async () => {
      await selectEnvironment(page)
      const run = await runToEnd(page)
      const dump = formatEntries(run.entries)
      for (const log of LOGS) {
        expect(linesOf(run.entries, log.id), `Log ${log.id}:\n${dump}`).toEqual([log.line])
      }
      expect(dump, 'no console line carries the replaced String').not.toContain(ROTATED_VALUE)
      expect(dump, 'no console line carries the typed String').not.toContain(KIND_VALUE)
      expect(dump, 'no console line carries the typed Integer').not.toContain(String(TYPE_VALUE))
      expect(run.verdict, `run verdict:\n${dump}`).toBe('passed')
    })
  })
})
