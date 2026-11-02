/**
 * V-PLUGIN-EXCEL-FUNCTIONAL: Excel Parser end-to-end execution.
 *
 * REQ: REQ-3.4.1.13 (Excel parser), REQ-3.4.3.1 / REQ-3.4.3.2 (artifact:// and
 *      testdata:// resolution), REQ-3.4.3.3 (table variable output),
 *      REQ-3.5.1.16 (For Each over a table)
 *
 * Each fixture chains Excel nodes binding their outputs to variables with Log
 * nodes whose message is an expression over those variables; expected.json is
 * the ground truth the spec asserts verbatim. Assertions anchor on the emitted
 * console output and the run status, never on an element merely rendering.
 *
 *   roundtrip   write -> read back; sheets accumulate under keep_sheets; sheet by
 *               name, by position with a range, an offset start cell read through
 *               its header row, and a header-less sheet read as column letters
 *   real-file   two LibreOffice-authored workbooks uploaded as the test's own test
 *               data and read through testdata://: auto typing, ISO dates, an
 *               uncomputed formula in errors, and the macro-enabled format
 *   loop-rows   the table a workbook was read into feeds a For Each bound from the
 *               variable picker; each row is logged, stored by a Variable Setter,
 *               and writes its own sheet into a second workbook
 *
 * Aborting permutations live in their own fixtures because they terminate the run:
 *   abort-xls            legacy .xls is refused
 *   abort-missing-sheet  a named sheet the workbook does not carry
 *   abort-mismatch       a declared-type mismatch under the fail policy
 *
 * Run: ./scripts/e2e-targeted-local.sh functional/excel-parser/v-plugin-excel-functional.spec.ts
 */

import { test, expect, type APIRequestContext, type Page } from '../../helpers/playwright-fixtures'
import { getLogTexts, getLogLines } from '../../helpers/log-reader'
import { importValidateAndNavigate } from '../../helpers/fixture-import'
import { uploadTestData } from '../../helpers/testdata'
import { selectEnvironment } from '../../helpers/workbench'
import fs from 'fs'
import path from 'path'

function loadFixture(name: string): Record<string, unknown> {
  return JSON.parse(
    fs.readFileSync(path.resolve(__dirname, `${name}.fixture.json`), 'utf-8'),
  ) as Record<string, unknown>
}

const EXPECTED: Record<string, string[]> = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, 'expected.json'), 'utf-8'),
)

/** The workbooks checked into the backend's Excel fixtures, by fixture name. */
const WORKBOOK_DIR = path.resolve(
  __dirname,
  '../../../../backend/tests/plugins/excel_parser/fixtures',
)
const TEST_DATA: Record<string, string[]> = {
  'real-file': ['sample_workbook.xlsx', 'macro_book.xlsm'],
}

/** Put a fixture's workbooks in the test's own Test Data, where testdata:// reads them. */
async function seedTestData(
  request: APIRequestContext,
  testId: string,
  name: string,
): Promise<void> {
  for (const file of TEST_DATA[name] ?? []) {
    await uploadTestData(request, testId, '', file, fs.readFileSync(path.join(WORKBOOK_DIR, file)), {
      mimeType: 'application/octet-stream',
    })
  }
}

async function runToTerminal(page: Page): Promise<string> {
  await selectEnvironment(page)
  await page.locator('[data-testid="run-button"]').click()
  const status = page.locator('[data-testid="workflow-status"]')
  await expect(status).not.toHaveAttribute('data-status', 'idle', { timeout: 10_000 })
  await expect(status).not.toHaveAttribute('data-status', 'running', { timeout: 90_000 })
  return (await status.getAttribute('data-status')) ?? 'unknown'
}

// ---------------------------------------------------------------------------
// Passing fixtures: every expected console line must appear.
// ---------------------------------------------------------------------------

const PASSING = ['roundtrip', 'real-file', 'loop-rows']

for (const name of PASSING) {
  test(`Excel functional: ${name}`, async ({ page, request }) => {
    test.setTimeout(180_000)
    const testId = await importValidateAndNavigate(page, loadFixture(name))
    await seedTestData(request, testId, name)

    const status = await runToTerminal(page)
    const logs = await getLogTexts(page)
    if (status !== 'passed') {
      const lines = await getLogLines(page)
      test.info().annotations.push({
        type: 'error-logs',
        description: JSON.stringify(lines.slice(-20)),
      })
    }
    expect(status, `workflow ${name} must pass`).toBe('passed')

    const missing = EXPECTED[name].filter((line) => !logs.includes(line))
    expect(
      missing,
      `Missing expected console lines for ${name}:\n${JSON.stringify(missing, null, 2)}\n\nGot:\n${logs.join('\n')}`,
    ).toEqual([])
  })
}

// ---------------------------------------------------------------------------
// Aborting fixtures: the run FAILS at the node with the exact error message.
// ---------------------------------------------------------------------------

const ABORTING: Array<{ name: string; node: string; errorText: string }> = [
  {
    name: 'abort-xls',
    node: 'read-legacy',
    errorText:
      'Unsupported workbook format: legacy.xls. Excel supports .xlsx and .xlsm - save the file as .xlsx',
  },
  {
    name: 'abort-missing-sheet',
    node: 'read-missing',
    errorText: 'Sheet not found: Nope. Available sheets: Orders',
  },
  {
    name: 'abort-mismatch',
    node: 'read-schema-fail',
    errorText: "Type mismatch in column 'code': 'abc' is not a valid integer",
  },
]

for (const { name, node, errorText } of ABORTING) {
  test(`Excel functional abort: ${name}`, async ({ page }) => {
    test.setTimeout(120_000)
    await importValidateAndNavigate(page, loadFixture(name))

    const status = await runToTerminal(page)
    expect(status, `workflow ${name} must fail`).toBe('failed')

    await expect(page.locator(`[data-testid="workflow-node-${node}"]`)).toHaveAttribute(
      'data-execution-status',
      'failed',
    )

    const lines = await getLogLines(page)
    expect(
      lines.some((l) => l.includes(errorText)),
      `Expected console ERROR containing:\n  ${errorText}\nGot:\n${lines.join('\n')}`,
    ).toBeTruthy()
  })
}
