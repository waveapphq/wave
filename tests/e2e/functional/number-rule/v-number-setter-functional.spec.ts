/**
 * V-NUMBER-SETTER: Variable Setter rows keep the one number rule at Save, in the window and in the run
 * Wireframe: N/A (the Variable Setter window keeps its look)
 * Design Decisions: VARSET-6, VARSET-8
 * REQ: REQ-3.1.3.14, REQ-3.4.3.8
 *
 * `fixture-setter.json` sets the integer `n` from the literal digit text `30`, the integer `big` from an
 * Expression that yields the 20-digit `12345678901234567890`, then the float `ratio` from an Expression that
 * yields NaN.
 *
 * Pass Criteria:
 * 1. A Test whose literal row does not fit its variable's type is refused at Save naming the variable: ` 30 `,
 *    `abc` and `1.5` for the integer `n` with `Value for variable 'n' is not a valid integer`, `1e5` for the
 *    float `ratio` with `Value for variable 'ratio' is not a valid float`.
 * 2. A stored literal row ` 30 ` opens in the Variable Setter window with `Must be a valid integer` under it
 *    and the window's Save held.
 * 3. The fixture imports with zero validation errors; its run sets `n` to 30 and `big` to the exact
 *    `12345678901234567890` (the console prints `n=30 big=12345678901234567890 next=12345678901234567891`).
 * 4. The NaN Expression fails its Block with `Block 'Set NaN' failed: Variable 'ratio': cannot convert nan to float`,
 *    the run fails there, the Block after it never runs, and `ratio` keeps 0.5.
 */

import fs from 'fs'
import path from 'path'
import { test, expect } from '../../helpers/playwright-fixtures'
import { BACKEND_URL, ensureEnvironment } from '../../helpers/config'
import {
  getActiveSessionId,
  getSessionVariables,
  importExpectingErrors,
  importValidateAndNavigate,
} from '../../helpers/fixture-import'
import { expectNodeStatus, finishRunAnyVerdict, startRun } from '../../helpers/k8s-run'
import { getLogEntries } from '../../helpers/log-reader'
import { messagesOf, refusalOf } from '../../helpers/number-entry'
import { openBlockSheet } from '../../helpers/workbench'
import { runToken } from '../../helpers/element-types'

const SET_VALUES = 'c6daead1-e71e-404d-a20c-ccd481b87150'
const SET_NAN = '227b05fb-8b17-4b3c-ac44-f6a1334dae41'
const AFTER_NAN = '40011554-2faa-4dff-95bb-e41f42f286d9'

type Fixture = { name: string; workflow: { nodes: Array<Record<string, any>> }; [key: string]: unknown }

function loadFixture(): Fixture {
  return JSON.parse(fs.readFileSync(path.join(__dirname, 'fixture-setter.json'), 'utf-8')) as Fixture
}

/** The fixture with the first Setter holding one literal row `name` = `value` of `type`. */
function withLiteralRow(name: string, type: string, value: string): Fixture {
  const fixture = loadFixture()
  fixture.name = `zz-11541-s9-setter-row-${runToken()}`
  const setter = fixture.workflow.nodes.find((node) => node.id === SET_VALUES)!
  setter.data.variableExpressionKeys = []
  setter.data.variableTypes = { [name]: type }
  setter.data.config.values.variables = { [name]: value }
  return fixture
}

test.describe('V-NUMBER-SETTER: Variable Setter rows and the one number rule', () => {
  test('a literal row that does not fit its variable is refused at Save and shows its message in the window', async ({
    page,
    request,
  }) => {
    await ensureEnvironment(request)
    const cases: Array<[string, string, string, string]> = [
      ['n', 'integer', ' 30 ', "Value for variable 'n' is not a valid integer"],
      ['n', 'integer', 'abc', "Value for variable 'n' is not a valid integer"],
      ['n', 'integer', '1.5', "Value for variable 'n' is not a valid integer"],
      ['ratio', 'float', '1e5', "Value for variable 'ratio' is not a valid float"],
    ]
    for (const [name, type, value, message] of cases) {
      await test.step(`1. ${JSON.stringify(value)} for the ${type} ${name} is refused at Save`, async () => {
        const refusal = await refusalOf(
          await request.post(`${BACKEND_URL}/tests`, { data: withLiteralRow(name, type, value) }),
          `POST /tests with the row ${name} = ${JSON.stringify(value)}`,
        )
        expect(messagesOf(refusal, 'INVALID_VARIABLE_VALUE')).toEqual([message])
      })
    }

    const stored = await importExpectingErrors(page, withLiteralRow('n', 'integer', ' 30 '), { context: 'load' })
    try {
      await test.step('2. the stored row " 30 " shows its message in the window and holds Save', async () => {
        const sheet = await openBlockSheet(page, SET_VALUES)
        const nameBox = sheet.locator('[data-testid="varset-name-input-0"]')
        await expect(nameBox).toHaveValue('n')
        await expect(sheet.locator('[data-testid="scalar-edit-input"]').first()).toHaveValue(' 30 ')
        await nameBox.focus()
        await nameBox.blur()
        await expect(sheet.locator('p[role="alert"]')).toHaveText(['Must be a valid integer'])
        await expect(sheet.getByRole('button', { name: 'Save', exact: true })).toBeDisabled()
      })
    } finally {
      await request.delete(`${BACKEND_URL}/workbench/session/`).catch(() => undefined)
      await request.delete(`${BACKEND_URL}/tests/${stored.testId}`).catch(() => undefined)
    }
  })

  test('an Expression row sets an exact 20-digit integer, and one that yields NaN fails its Block', async ({
    page,
    request,
  }) => {
    test.setTimeout(180_000)
    const testId = await importValidateAndNavigate(page, loadFixture())
    try {
      const status = await startRun(page)
      const { verdict, logs } = await finishRunAnyVerdict(page, status, 'setter-done')

      await test.step('3. the literal 30 and the exact 20-digit expression are set', async () => {
        expect(logs).toContain('n=30 big=12345678901234567890 next=12345678901234567891')
        const variables = await getSessionVariables(page, await getActiveSessionId(page))
        expect(variables.n.value).toBe(30)
        expect(String(variables.big.value)).toBe('12345678901234567890')
      })

      await test.step('4. the NaN expression fails its Block by name and nothing after it runs', async () => {
        expect(verdict, 'the run fails at the NaN Block').toBe('failed')
        await expect
          .poll(async () => (await getLogEntries(page)).filter((entry) => entry.level === 'ERROR').map((entry) => entry.message))
          .toContain("Block 'Set NaN' failed: Variable 'ratio': cannot convert nan to float")
        await expectNodeStatus(page, SET_NAN, 'failed')
        expect(logs).not.toContain('after-nan')
        await expect(page.locator(`[data-testid="workflow-node-${AFTER_NAN}"]`)).not.toHaveAttribute(
          'data-execution-status',
          'success',
        )
        const variables = await getSessionVariables(page, await getActiveSessionId(page))
        expect(String(variables.ratio.value), 'no NaN is stored').toBe('0.5')
      })
    } finally {
      await request.delete(`${BACKEND_URL}/workbench/session/`).catch(() => undefined)
      await request.delete(`${BACKEND_URL}/tests/${testId}`).catch(() => undefined)
    }
  })
})
