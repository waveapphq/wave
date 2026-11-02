/**
 * V-VARSET-OUTPUT-SECRET: a Variable Setter Secret row makes the Function output it writes secret
 * Design Decisions: SECUI-12
 * REQ: REQ-3.1.3.5, REQ-3.1.2.9
 *
 * Phase: functional-workflow. API seed (POST /tests): a Local Function `Secret_Out_Fn` declaring a
 * plain string output `res`; its body is a Variable Setter row writing a literal into `res`, then a
 * Log of `res`. Validated with zero errors. The Secret tick, the Block Save, the warning, the toolbar
 * Save and the run all go through the UI.
 *
 * Pass Criteria:
 * 1. Drilled into the Function, the output row `res` carries OUT and no SECRET badge.
 * 2. Ticking Secret on the Setter row and saving the Block opens the make-secret warning naming
 *    `res`; "Make secret and save" closes the sheet.
 * 3. The output row `res` then carries the SECRET badge and its value is masked.
 * 4. After the toolbar Save the stored Function declares `res` secret and the Setter keeps its
 *    Secret row with a sealed literal.
 * 5. A run prints the Log of `res` masked; the literal appears in no console line.
 */

import { randomUUID } from 'node:crypto'
import { test, expect } from '../../helpers/playwright-fixtures'
import { BACKEND_URL, ensureEnvironment } from '../../helpers/config'
import {
  createValidTest,
  localFunctionNode,
  logNode,
  openTest,
  startEdge,
  storedLocalDefinition,
  validateTest,
} from '../../helpers/fn-seed'
import { getLogEntries } from '../../helpers/log-reader'
import { SECRET_ENVELOPE, SECRET_MASK } from '../../helpers/secret-canary'
import { expandVariableManager, variableRow } from '../../helpers/variable-create'
import {
  confirmSecretPromotion,
  digIn,
  openBlockSheet,
  runToEnd,
  saveTest,
  selectEnvironment,
} from '../../helpers/workbench'

const FN_ID = 'fn-secret-out'
const SETTER_ID = 'fn-secret-out-set'
const LOG_ID = 'fn-secret-out-log'
const OUTPUT = 'res'

interface StoredNode {
  id: string
  data: {
    config?: { values?: { variables?: Record<string, unknown> }; variableSecretKeys?: string[] }
    localDefinition?: { workflow?: { nodes?: StoredNode[] } }
  }
}

function setterNode(literal: string): Record<string, unknown> {
  return {
    id: SETTER_ID,
    type: 'workflowNode',
    position: { x: 200, y: 140 },
    data: {
      label: 'Set res',
      elementType: 'variable-setter',
      nodeType: 'control',
      category: 'flow',
      version: '1.0.0',
      expressionFields: [],
      templateFields: [],
      variableExpressionKeys: [],
      variableTemplateKeys: [],
      variableTypes: { [OUTPUT]: 'string' },
      config: { values: { variables: { [OUTPUT]: literal } }, outputBindings: {}, profileBindings: [] },
    },
    measured: { width: 120, height: 62 },
  }
}

let testId: string | undefined

test.describe('V-VARSET-OUTPUT-SECRET: a Setter Secret row on a Function output', () => {
  test.afterEach(async ({ request }) => {
    if (testId) await request.delete(`${BACKEND_URL}/tests/${testId}`).catch(() => undefined)
    testId = undefined
  })

  test('saving a Setter Secret row that writes a declared output asks first, then the output is secret', async ({
    page,
    request,
  }) => {
    await ensureEnvironment(request)
    const literal = `out-canary-${randomUUID().slice(0, 8)}`
    testId = await createValidTest(request, {
      name: `zz-setter-secret-output-${randomUUID().slice(0, 8)}`,
      nodes: [
        localFunctionNode(FN_ID, 'Secret_Out_Fn', {
          outputs: [{ name: OUTPUT, type: 'string' }],
          nodes: [setterNode(literal), logNode(LOG_ID, 'Log res', OUTPUT, { x: 200, y: 300 })],
          edges: [
            { id: 'e-start-set', source: 'start-node', target: SETTER_ID },
            { id: 'e-set-log', source: SETTER_ID, target: LOG_ID },
          ],
        }),
      ],
      edges: [startEdge(FN_ID)],
    })
    const validation = await validateTest(request, testId, 'run')
    expect(validation.errors, JSON.stringify(validation.errors)).toHaveLength(0)
    await openTest(page, testId)
    await selectEnvironment(page)
    await expandVariableManager(page)
    await digIn(page, FN_ID)
    await expect(page.getByTestId(`workflow-node-${SETTER_ID}`)).toBeVisible()

    const row = variableRow(page, OUTPUT)
    await test.step('the declared output starts plain', async () => {
      await expect(row.locator('[data-testid^="out-badge-"]')).toHaveText('OUT')
      await expect(row.locator('[data-testid^="secret-badge-"]')).toHaveCount(0)
    })

    await test.step('ticking Secret on the Setter row and saving asks before making res secret', async () => {
      const sheet = await openBlockSheet(page, SETTER_ID)
      const secretBox = sheet.getByTestId('varset-secret-checkbox-0')
      await secretBox.click()
      await expect(secretBox).toHaveAttribute('data-state', 'checked')
      await sheet.getByRole('button', { name: 'Save', exact: true }).click()
      await confirmSecretPromotion(page, [OUTPUT])
      await expect(sheet).toHaveCount(0)
    })

    await test.step('the output row carries the SECRET badge and a masked value', async () => {
      await expect(row.locator('[data-testid^="secret-badge-"]')).toHaveText('SECRET')
      await expect(row).not.toContainText(literal)
    })

    await test.step('the saved Function declares res secret and the Setter row stays secret and sealed', async () => {
      await saveTest(page)
      const definition = await storedLocalDefinition(request, testId!, FN_ID)
      const output = definition.outputs.find((entry) => entry.name === OUTPUT)
      expect(output?.secret, JSON.stringify(definition.outputs)).toBe(true)
      const stored = (await (await request.get(`${BACKEND_URL}/tests/${testId}`)).json()).data
      const fn = (stored.workflow.nodes as StoredNode[]).find((node) => node.id === FN_ID)
      const setter = fn?.data.localDefinition?.workflow?.nodes?.find((node) => node.id === SETTER_ID)
      expect(setter?.data.config?.variableSecretKeys).toEqual([OUTPUT])
      expect(String(setter?.data.config?.values?.variables?.[OUTPUT])).toContain(SECRET_ENVELOPE)
    })

    await test.step('a run prints res masked and never the literal', async () => {
      // The console shows the whole run (its closing line included) from the Test root.
      await page.getByTestId('breadcrumb-back-arrow').click()
      await expect(page.getByTestId(`workflow-node-${FN_ID}`)).toBeVisible()
      const { verdict, entries } = await runToEnd(page)
      expect(verdict).toBe('passed')
      const messages = entries.map((entry) => entry.message)
      expect(messages, 'the Log of res is masked').toContain(SECRET_MASK)
      expect(messages.filter((message) => message.includes(literal)), 'the literal leaks nowhere').toEqual([])
      expect((await getLogEntries(page)).some((entry) => entry.message.includes(literal))).toBe(false)
    })
  })
})
