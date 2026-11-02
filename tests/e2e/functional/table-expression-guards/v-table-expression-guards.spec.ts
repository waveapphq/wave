/**
 * V-TABLE-EXPRESSION-GUARDS: what an element field expression may and may not do
 * to a table.
 *
 * REQ: REQ-3.4.1.13 (Excel parser), REQ-3.4.1.12 (CSV parser), REQ-3.1.3.13
 *      (expressions over variables)
 * Each behavior is proven on observable output rather than on a control existing.
 *
 *   G1  the read-only guard names the table type's REAL mutators, so the five
 *       that slipped it (whole-column add / insert / remove, row replace, row
 *       insert) cannot restructure a workflow's table - and a test
 *       carrying one is refused when it is saved, not only when it is run
 *   G2  the same guard leaves the query operations alone, and a chained
 *       filter -> filter -> two-key order_by shapes what both converters emit
 *       while the source variable keeps every row
 *   G3  the save-time variable scan reads an expression's FREE names, so a
 *       comprehension target, a lambda parameter and the sandbox builtins are
 *       not undeclared variables - while a genuinely undeclared name still is
 *   G4  the same read-only rule reaches a template marker and a Variable
 *       Manager expression entry, and refuses both at SAVE with the sentence
 *       that names the method, the Block and the field or the variable
 *   G5  the rule matches NAMES, so sorted(), keys(), reversed() and slicing
 *       still save and still run
 *   G6  text inside quotes is never read as code: a template marker reading
 *       the '@timestamp' column and an expression quoting '#', ';' and ')'
 *       show no finding, save and run, while the same marks outside quotes
 *       still get their finding
 *
 * Run: ./scripts/e2e-targeted-local.sh functional/table-expression-guards/v-table-expression-guards.spec.ts
 */

import { test, expect, type Locator, type Page } from '../../helpers/playwright-fixtures'
import { getLogTexts } from '../../helpers/log-reader'
import { importValidateAndNavigate } from '../../helpers/fixture-import'
import { selectEnvironment } from '../../helpers/workbench'
import { BACKEND_URL, ensureEnvironment } from '../../helpers/config'
import { openStringParamSheet } from '../../helpers/param-config'
import { fieldInput } from '../../helpers/value-field'
import {
  deleteTest,
  openConfig,
  persistedNodes,
  saveConfig,
  saveWorkbench,
} from '../file-picker/picker'
import fs from 'fs'
import path from 'path'

function loadFixture(name: string): Record<string, unknown> {
  return JSON.parse(
    fs.readFileSync(path.resolve(__dirname, `${name}.fixture.json`), 'utf-8'),
  ) as Record<string, unknown>
}

async function runToTerminal(page: Page): Promise<string> {
  await selectEnvironment(page)
  await page.locator('[data-testid="run-button"]').click()
  const status = page.locator('[data-testid="workflow-status"]')
  await expect(status).not.toHaveAttribute('data-status', 'idle', { timeout: 10_000 })
  await expect(status).not.toHaveAttribute('data-status', 'running', { timeout: 60_000 })
  return (await status.getAttribute('data-status')) ?? 'unknown'
}

interface ExpressionIssue {
  type: string
  code: string
  message: string
}

async function validateFieldExpression(
  page: Page,
  expression: string,
): Promise<{ valid: boolean; issues: ExpressionIssue[] }> {
  const resp = await page.request.post(`${BACKEND_URL}/variables/validate-expression`, {
    data: {
      expression,
      isFieldExpression: true,
      context: { variables: { orders: { type: 'table', value: [] } } },
    },
  })
  const body = await resp.json().catch(() => null)
  expect(
    resp.ok(),
    `POST /variables/validate-expression failed: ${resp.status()} - ${JSON.stringify(body)}`,
  ).toBeTruthy()
  return body.data as { valid: boolean; issues: ExpressionIssue[] }
}

// ---------------------------------------------------------------------------
// G1: every table mutator is refused by name.
// ---------------------------------------------------------------------------

const REFUSED: Array<{ method: string; expression: string }> = [
  { method: 'add_col', expression: "orders.add_col(['x'], 'flag', 'string')" },
  { method: 'insert_col', expression: "orders.insert_col(['x'], 0, 'flag', 'string')" },
  { method: 'remove_col', expression: "orders.remove_col('qty')" },
  { method: 'set_row', expression: "orders.set_row(['Z-9', 1], 0)" },
  { method: 'insert_row', expression: "orders.insert_row(['Z-9', 1], 0)" },
  { method: 'set_cell', expression: "orders.set_cell(9, 0, 'qty')" },
  { method: 'add_row', expression: "orders.add_row(['Z-9', 1])" },
  { method: 'remove_row', expression: 'orders.remove_row(0)' },
]

test('G1 the read-only guard refuses every table mutator by name', async ({ page }) => {
  await ensureEnvironment(page.request)

  for (const { method, expression } of REFUSED) {
    const result = await validateFieldExpression(page, expression)
    expect(result.valid, `${method} must be refused in a field expression`).toBe(false)
    expect(
      result.issues.some(
        (i) =>
          i.code === 'mutation_not_allowed' &&
          i.message ===
            `Method '${method}' modifies data and is not allowed in field expressions`,
      ),
      `Expected the mutation_not_allowed issue for ${method}. Got: ${JSON.stringify(result.issues)}`,
    ).toBeTruthy()
  }
})

test('G1 the guard leaves the table query operations callable', async ({ page }) => {
  await ensureEnvironment(page.request)

  for (const expression of [
    "orders.filter('qty').greater_than(5)",
    "orders.order_by(('qty', 'desc'), 'sku')",
    "orders.col('sku')",
  ]) {
    const result = await validateFieldExpression(page, expression)
    expect(
      result.valid,
      `${expression} must stay callable. Issues: ${JSON.stringify(result.issues)}`,
    ).toBe(true)
  }
})

test('G1 a field expression that restructures a table is refused when the test is saved', async ({
  page,
}) => {
  const fixture = loadFixture('mutators')
  fixture.name = `${String(fixture.name)} ${Date.now()}`

  const resp = await page.request.post(`${BACKEND_URL}/tests`, { data: fixture })
  expect(resp.status(), 'a mutating field expression must not save').toBe(422)

  const body = await resp.json()
  const details = (body?.error?.details ?? []) as Array<{ code: string; message: string }>
  const hit = details.find((d) => d.code === 'EXPRESSION_CHANGES_DATA')
  expect(hit, `Expected EXPRESSION_CHANGES_DATA. Got: ${JSON.stringify(details)}`).toBeTruthy()
  expect(hit!.message).toContain('The add_col method changes data.')
  expect(hit!.message).toContain('add a Variable Setter Block')
})

// ---------------------------------------------------------------------------
// G2: the query chain shapes what each converter emits, source untouched.
// ---------------------------------------------------------------------------

test('G2 a two-filter, two-key chain shapes both converters and leaves the source whole', async ({
  page,
}) => {
  test.setTimeout(120_000)
  await importValidateAndNavigate(page, loadFixture('chain'))

  const status = await runToTerminal(page)
  const logs = await getLogTexts(page)
  expect(status, `the chain workflow must pass. Logs:\n${logs.join('\n')}`).toBe('passed')

  // west rows above 8, ordered by amount descending then rep ascending.
  expect(logs).toContain('guard-chain=region,rep,amount~west,cy,30~west,ada,10~west,zoe,10~')
  expect(logs).toContain('guard-xlsx=cy,ada,zoe|[30, 10, 10]|source-rows-5')
})

// ---------------------------------------------------------------------------
// G3: the save-time scan reads free names only.
// ---------------------------------------------------------------------------

test('G3 comprehension, lambda and sandbox builtin expressions save and evaluate', async ({
  page,
}) => {
  test.setTimeout(120_000)
  // importValidateAndNavigate asserts the zero-error gate, which IS the
  // save-time scan: an expression whose local names read as undeclared
  // variables cannot get past it.
  await importValidateAndNavigate(page, loadFixture('sandbox'))

  const status = await runToTerminal(page)
  const logs = await getLogTexts(page)
  expect(status, `the sandbox workflow must pass. Logs:\n${logs.join('\n')}`).toBe('passed')

  expect(logs).toContain('guard-comp=A-1,B-2')
  expect(logs).toContain('guard-lambda=42')
  expect(logs).toContain('guard-builtins=1,2,3|True|7')
})

test('G3 a genuinely undeclared name is still reported', async ({ page }) => {
  await ensureEnvironment(page.request)

  // Imported without the shared zero-error gate - the refusal is what this test
  // wants, and the save itself is where it lands.
  const fixture = loadFixture('undeclared')
  const unique = { ...fixture, name: `${fixture.name as string} ${Date.now()}` }
  const createResp = await page.request.post(`${BACKEND_URL}/tests`, { data: unique })
  const body = await createResp.json().catch(() => null)

  expect(createResp.status(), 'the Test must be refused, not saved').toBe(422)

  const details = (body?.error?.details ?? []) as Array<{ code?: string; message?: string }>
  expect(
    details.some(
      (e) =>
        e.code === 'UNDECLARED_VARIABLE' &&
        e.message ===
          "Variable 'nowhere_var' is used in 1 block(s) but not declared in variable manager",
    ),
    `Expected the UNDECLARED_VARIABLE refusal for nowhere_var. Got: ${JSON.stringify(body)}`,
  ).toBeTruthy()
})

// ---------------------------------------------------------------------------
// G4: the same read-only rule, on the two surfaces the field test does not
// reach - a template marker and a Variable Manager expression entry. Both are
// refused when the test is SAVED, with the sentence that names the method.
// ---------------------------------------------------------------------------

const READ_ONLY_SENTENCE =
  'The append method changes data. An expression can only read data, not change it. ' +
  'To change a variable, add a Variable Setter Block.'

async function saveRefusal(page: Page, fixtureName: string): Promise<string> {
  const fixture = loadFixture(fixtureName)
  fixture.name = `${String(fixture.name)} ${Date.now()}`

  const resp = await page.request.post(`${BACKEND_URL}/tests`, { data: fixture })
  const body = await resp.json().catch(() => null)
  expect(
    resp.status(),
    `${fixtureName} must not save. Got ${resp.status()} - ${JSON.stringify(body)}`,
  ).toBe(422)

  const details = (body?.error?.details ?? []) as Array<{ code?: string; message?: string }>
  const hit = details.find((d) => d.code === 'EXPRESSION_CHANGES_DATA')
  expect(
    hit,
    `Expected EXPRESSION_CHANGES_DATA for ${fixtureName}. Got: ${JSON.stringify(details)}`,
  ).toBeTruthy()
  return hit!.message ?? ''
}

test('G4 a template marker that changes data is refused when the test is saved', async ({
  page,
}) => {
  const message = await saveRefusal(page, 'template-mutator')

  // The whole sentence, then the Block and the field it came from.
  expect(message).toBe(`${READ_ONLY_SENTENCE} Block: Template Mutator. Field: message.`)
  // The pattern-shaped wording is gone and must never come back.
  expect(message).not.toContain('Blocked pattern')
  expect(message).not.toContain('not allowed for security reasons')
})

test('G4 an expression variable that changes data is refused when the test is saved', async ({
  page,
}) => {
  const message = await saveRefusal(page, 'variable-mutator')

  expect(message).toBe(`${READ_ONLY_SENTENCE} Variable: grown_list.`)
  expect(message).not.toContain('Blocked pattern')
  expect(message).not.toContain('not allowed for security reasons')
})

// ---------------------------------------------------------------------------
// G5: the rule matches NAMES, not shapes. sorted(), keys(), reversed() and
// slicing read data without changing it, so they must still save and still run
// - on an expression field and inside a template marker.
// ---------------------------------------------------------------------------

test('G5 sorted, keys, reversed and slicing still save and still run', async ({ page }) => {
  test.setTimeout(120_000)
  // importValidateAndNavigate asserts the save and the zero-error gate, which
  // is where a rule that refused everything would stop this fixture.
  await importValidateAndNavigate(page, loadFixture('readonly-names'))

  const status = await runToTerminal(page)
  const logs = await getLogTexts(page)
  expect(status, `the read-only names workflow must pass. Logs:\n${logs.join('\n')}`).toBe(
    'passed',
  )

  expect(logs).toContain('guard-sorted=ada,cy,zoe')
  expect(logs).toContain('guard-keys=a,b')
  expect(logs).toContain('guard-slice=ada,cy')
  // reversed is one letter from the blocked reverse method - proof the check
  // reads whole names.
  expect(logs).toContain('guard-reversed=cy,ada,zoe')
  expect(logs).toContain('guard-template=ada,cy,zoe')
})

// ---------------------------------------------------------------------------
// G6: the editor's syntax checks skip the text inside a string literal, so a
// quoted '@timestamp', '#', ';' or ')' is data. Each clean case follows the
// same mark outside quotes, whose finding proves the check ran on that row.
// ---------------------------------------------------------------------------

const QUOTED_CELL = "{{ final.cell(0, '@timestamp') }}"
const QUOTED_MARKS = "'marks=' + '#' + ';' + ')'"

const EXPRESSION_CASES: Array<{ outside: string; finding: string; inside: string }> = [
  {
    outside: 'final.cell(0, @timestamp)',
    finding: 'Decorators (@) are not valid in expressions',
    inside: "final.cell(0, '@timestamp')",
  },
  {
    outside: "'marks=' # note",
    finding: 'Comments (#) are not valid in expressions',
    inside: "'marks=' + '#'",
  },
  {
    outside: "'marks='; 'more'",
    finding: 'Semicolons are not valid in expressions',
    inside: "'marks=' + ';'",
  },
  {
    outside: "'marks=')",
    finding: 'Unbalanced parentheses: unexpected )',
    inside: QUOTED_MARKS,
  },
]

/** Replace a CodeMirror document in one input event, so nothing is auto-closed. */
async function replaceCode(page: Page, editor: Locator, text: string): Promise<void> {
  await editor.click()
  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.press('Delete')
  await page.keyboard.insertText(text)
  await expect(editor).toHaveText(text)
}

test('G6 text inside quotes is never read as code', async ({ page }) => {
  test.setTimeout(180_000)
  const testId = await importValidateAndNavigate(page, loadFixture('quoted-text'))

  try {
    await selectEnvironment(page)

    await test.step("a template marker reading the '@timestamp' column shows no finding", async () => {
      const dialog = await openConfig(page, 'log-quoted-cell')
      const sheet = await openStringParamSheet(dialog, page, 'message')
      await sheet.getByTestId('kind-dropdown').click()
      await page.getByRole('option', { name: 'Template', exact: true }).click()
      await expect(sheet.getByTestId('kind-dropdown')).toHaveText('Template')

      const editor = sheet.locator('.cm-content').first()
      await replaceCode(page, editor, '{{ final.cell(0, @timestamp) }}')
      await expect(
        editor.locator('.cm-invalid-function'),
        'an unquoted @ inside the marker is underlined',
      ).not.toHaveCount(0)

      await replaceCode(page, editor, QUOTED_CELL)
      await expect(editor.locator('.cm-expression'), 'the marker is read as an expression').not.toHaveCount(0)
      await expect(editor.locator('.cm-invalid-function')).toHaveCount(0)
      await expect(editor.locator('.cm-unknown-variable')).toHaveCount(0)

      const save = sheet.getByTestId('value-editor-save-button')
      await save.click()
      await expect(save).toBeDisabled()
      await sheet.getByTestId('value-editor-cancel-button').click()
      await expect(sheet).toBeHidden()

      await expect(fieldInput(dialog, 'message')).toHaveValue(QUOTED_CELL)
      await expect(dialog.getByTestId('param-warning-message')).toHaveCount(0)
      await saveConfig(dialog)
    })

    await test.step("quoted '@', '#', ';' and ')' show no finding; unquoted they each still do", async () => {
      const dialog = await openConfig(page, 'log-quoted-marks')
      const editor = dialog.getByTestId('param-input-message').locator('.cm-content')
      const warning = dialog.getByTestId('param-warning-message')

      for (const { outside, finding, inside } of EXPRESSION_CASES) {
        await replaceCode(page, editor, outside)
        await expect(warning, `${outside} outside quotes`).toHaveText(finding)
        await replaceCode(page, editor, inside)
        await expect(warning, `${inside} inside quotes`).toHaveCount(0)
      }

      await saveConfig(dialog)
    })

    await test.step('both Blocks save as written', async () => {
      await saveWorkbench(page)
      const nodes = await persistedNodes(page.request, testId)
      expect(nodes['log-quoted-cell'].templateFields).toEqual(['message'])
      expect(nodes['log-quoted-cell'].config.values.message).toBe(QUOTED_CELL)
      expect(nodes['log-quoted-marks'].expressionFields).toEqual(['message'])
      expect(nodes['log-quoted-marks'].config.values.message).toBe(QUOTED_MARKS)
    })

    await test.step('the run logs the cell value and the quoted marks', async () => {
      const status = await runToTerminal(page)
      const logs = await getLogTexts(page)
      expect(status, `the quoted-text workflow must pass. Logs:\n${logs.join('\n')}`).toBe('passed')
      expect(logs).toContain('2026-09-27T10:00:00.000Z')
      expect(logs).toContain('marks=#;)')
    })
  } finally {
    await deleteTest(page.request, testId)
  }
})
