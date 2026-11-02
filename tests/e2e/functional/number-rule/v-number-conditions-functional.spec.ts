/**
 * V-NUMBER-CONDITIONS: condition and filter compare-to values and column indexes keep the one number rule
 * Wireframe: N/A (the condition rows and the CSV Transform section keep their look)
 * Design Decisions: CSV-7, CSV-8, CSV-12
 * REQ: REQ-3.1.3.14, REQ-3.5.5.4
 *
 * `fixture-conditions.json` chains an Assert, an If/Else, a Switch, a While, a Wait Until and a CSV Parser
 * whose rows compare the integer `n`, the float `f` (stored compare-to `1e-7`), the string `s`, the loop
 * counter `i`, and the CSV cells As Integer and As Float, with a sort on column index 1.
 *
 * Pass Criteria:
 * 1. In the value box of an integer compare on each of the five condition Blocks, and of an As Integer and an
 *    As Float filter, the keys `1e5`, `1,000` and `abc` leave `15`, `1000` and nothing; a string compare takes
 *    `1e5,000x` as typed.
 * 2. The float compare-to stored as `1e-7` shows `0.0000001`, and a digit typed at its end is kept.
 * 3. The sort's column Index box refuses a minus, a dot and letters (`-1.x2` leaves `12`).
 * 3a. Picking the integer `n` on the string row comparing to `1e5` keeps `1e5`, shows
 *    `Enter a valid integer value` under the box and holds the window's Save; with `5` typed the message goes,
 *    Save works and the stored row compares `n` to 5.
 * 3b. Turning the As Float filter holding `2.0` As Integer keeps `2.0`, shows `Enter a valid integer value` under
 *    the box and holds the window's Save; with `2` typed the message goes and Save is on again.
 * 4. A Test whose stored compare-to value breaks the rule is refused at Save naming the variable
 *    (`The value compared with 'n' is not a valid integer`, `... 'f' is not a valid float`) or the cell
 *    (`The value compared with the cell is not a valid integer` / `... float`), on each Block.
 * 5. A Test whose sort or filter column picked by index holds `abc` or `x1` is refused at Save with
 *    `Column index 'abc' is not a valid integer` / `Column index 'x1' is not a valid integer`.
 * 6. The fixture imports with zero validation errors and its run passes: the If/Else takes `big`, the Switch
 *    takes `five`, the While counts `i` to 3, the Wait Until passes, and the CSV filters and the index sort keep
 *    ids 3 then 2.
 */

import fs from 'fs'
import path from 'path'
import { test, expect, type Locator, type Page } from '../../helpers/playwright-fixtures'
import { BACKEND_URL, ensureEnvironment } from '../../helpers/config'
import {
  openConditionBody,
  pickConditionVariable,
  rowPath,
  valueBox,
  type ConditionBlock,
} from '../../helpers/condition-builder'
import { getActiveSessionId, getSessionVariables, importValidateAndNavigate } from '../../helpers/fixture-import'
import { expectNodesSuccess, finishRun, startRun } from '../../helpers/k8s-run'
import { discardBlockSheet, expectTypedAs, messagesOf, refusalOf, typeAtEnd, typeKeys } from '../../helpers/number-entry'
import { keptIds, setFilterAsType } from '../../helpers/table-transform'
import { runToken } from '../../helpers/element-types'
import { openBlockSheet, saveBlockSheet, saveTest } from '../../helpers/workbench'
import { persistedValues } from '../file-picker/picker'

const ASSERT = '5ed2ad3a-1d9a-4af4-b0d5-3d1cfca03491'
const IF_ELSE = 'c75a6c58-6b90-4fb9-a86f-552eddf0087a'
const SWITCH = '60912e40-d75c-4ee1-bef0-a6d7a9f64bae'
const WHILE = '093563e5-179e-4fc7-b340-4899635919ce'
const WAIT = 'e8a81b55-f297-4388-9f0b-dcccfe5eef7b'
const CSV = '74b19258-e98c-4179-bb98-92854437fe69'
const LOG_IF = 'd3bb26f0-527c-4b8c-8c33-55f38a62171a'
const LOG_CASE = '9f5ab27b-0a11-46ef-b17e-7b2e305a592c'
const LOG_DONE = '92b85c2e-7e1d-4e75-a99a-cca92011cbc4'

type Fixture = { name: string; workflow: { nodes: Array<Record<string, any>> }; [key: string]: unknown }

function loadFixture(): Fixture {
  return JSON.parse(fs.readFileSync(path.join(__dirname, 'fixture-conditions.json'), 'utf-8')) as Fixture
}

function valuesOf(fixture: Fixture, id: string): Record<string, any> {
  return fixture.workflow.nodes.find((node) => node.id === id)!.data.config.values
}

/** The fixture with one stored value changed by `change`, under a per-run name. */
function changed(change: (fixture: Fixture) => void): Fixture {
  const fixture = loadFixture()
  fixture.name = `zz-11541-s9-conditions-refused-${runToken()}`
  change(fixture)
  return fixture
}

const notInteger = (subject: string): string => `The value compared with ${subject} is not a valid integer`
const notFloat = (subject: string): string => `The value compared with ${subject} is not a valid float`

/** A row's integer compare-to box drops an exponent letter, a separator and letters. */
async function expectIntegerBox(box: Locator): Promise<void> {
  await expectTypedAs(box, '1e5', '15')
  await expectTypedAs(box, '1,000', '1000')
  await expectTypedAs(box, 'abc', '')
}

async function openCsvSection(sheet: Locator, section: 'csv-sorts-section' | 'csv-filters-section'): Promise<void> {
  const trigger = sheet.locator(`[data-testid="${section}-trigger"]`)
  if ((await trigger.getAttribute('data-state')) !== 'open') await trigger.click()
  await expect(trigger).toHaveAttribute('data-state', 'open')
}

async function checkConditionBox(page: Page, id: string, block: ConditionBlock, branch?: string): Promise<void> {
  const sheet = await openBlockSheet(page, id)
  const body = await openConditionBody(sheet, block, branch)
  await expectIntegerBox(valueBox(body, rowPath(0)))
  await discardBlockSheet(page, sheet)
}

test.describe('V-NUMBER-CONDITIONS: compare-to values and column indexes', () => {
  test('stored compare-to values and column indexes that break the rule are refused at Save by name', async ({
    request,
  }) => {
    await ensureEnvironment(request)
    const conditionOf = (fixture: Fixture, id: string, at: (values: Record<string, any>) => Record<string, any>) =>
      at(valuesOf(fixture, id))
    const cases: Array<[string, (fixture: Fixture) => void, string, string]> = [
      ['Assert n = 1e5', (f) => (conditionOf(f, ASSERT, (v) => v.assertions[0]).reference_value = '1e5'), 'INVALID_COMPARE_VALUE', notInteger("'n'")],
      ['Assert f = 1e5', (f) => (conditionOf(f, ASSERT, (v) => v.assertions[2]).reference_value = '1e5'), 'INVALID_COMPARE_VALUE', notFloat("'f'")],
      ['If/Else n > 1,000', (f) => (conditionOf(f, IF_ELSE, (v) => v.branches[0].conditions[0]).reference_value = '1,000'), 'INVALID_COMPARE_VALUE', notInteger("'n'")],
      ['Switch n = abc', (f) => (conditionOf(f, SWITCH, (v) => v.branches[0].conditions[0]).reference_value = 'abc'), 'INVALID_COMPARE_VALUE', notInteger("'n'")],
      ['While i < 1e5', (f) => (conditionOf(f, WHILE, (v) => v.conditions[0]).reference_value = '1e5'), 'INVALID_COMPARE_VALUE', notInteger("'i'")],
      ['Wait Until n = 1e5', (f) => (conditionOf(f, WAIT, (v) => v.conditions[0]).reference_value = '1e5'), 'INVALID_COMPARE_VALUE', notInteger("'n'")],
      ['As Integer filter 1e5', (f) => (conditionOf(f, CSV, (v) => v.filters[0].conditions[0]).reference_value = '1e5'), 'INVALID_COMPARE_VALUE', notInteger('the cell')],
      ['As Float filter 1,000', (f) => (conditionOf(f, CSV, (v) => v.filters[1].conditions[0]).reference_value = '1,000'), 'INVALID_COMPARE_VALUE', notFloat('the cell')],
      ['sort on index abc', (f) => (valuesOf(f, CSV).sorts[0].column.value = 'abc'), 'INVALID_COLUMN_INDEX', "Column index 'abc' is not a valid integer"],
      ['filter on index x1', (f) => (valuesOf(f, CSV).filters[0].column = { mode: 'index', value: 'x1' }), 'INVALID_COLUMN_INDEX', "Column index 'x1' is not a valid integer"],
    ]
    for (const [what, change, code, message] of cases) {
      await test.step(`4-5. ${what} is refused at Save`, async () => {
        const refusal = await refusalOf(
          await request.post(`${BACKEND_URL}/tests`, { data: changed(change) }),
          `POST /tests with ${what}`,
        )
        expect(messagesOf(refusal, code), what).toEqual([message])
      })
    }
  })

  test('the value boxes drop what a number cannot hold, and the run compares by the rule', async ({ page, request }) => {
    test.setTimeout(300_000)
    const testId = await importValidateAndNavigate(page, loadFixture())
    try {
      await test.step('1-2. Assert: the integer box drops keys, the float shows 0.0000001, the string takes any text', async () => {
        const sheet = await openBlockSheet(page, ASSERT)
        await expectIntegerBox(valueBox(sheet, rowPath(0)))
        const tiny = valueBox(sheet, rowPath(1))
        await expect(tiny).toHaveValue('0.0000001')
        await typeAtEnd(tiny, '5')
        await expect(tiny).toHaveValue('0.00000015')
        await expectTypedAs(tiny, '1e5', '15')
        const text = valueBox(sheet, rowPath(2))
        await typeKeys(text, '1e5,000x')
        await expect(text).toHaveValue('1e5,000x')
        await discardBlockSheet(page, sheet)
      })

      await test.step('3a. picking an integer variable keeps the text, names it under the box and holds Save until a number is typed', async () => {
        const sheet = await openBlockSheet(page, ASSERT)
        const path = rowPath(2)
        await pickConditionVariable(page, sheet, path, 'n')
        await expect(sheet.locator(`[data-testid="assert-type-badge-${path}"]`)).toHaveText('integer')
        const box = valueBox(sheet, path)
        await expect(box).toHaveValue('1e5')
        const message = sheet.locator('[data-testid="assert-value-error-cond-assert-s"]')
        await expect(message).toHaveText('Enter a valid integer value')
        await expect(box).toHaveAttribute('aria-invalid', 'true')
        await expect(sheet.getByRole('button', { name: 'Save', exact: true })).toBeDisabled()
        await expectTypedAs(box, '5', '5')
        await expect(message).toHaveCount(0)
        await saveBlockSheet(sheet)
        await saveTest(page)
        const rows = (await persistedValues(request, testId))[ASSERT].assertions as Array<Record<string, unknown>>
        expect(rows[4]).toMatchObject({ variable: 'n', value_type: 'integer' })
        expect(String(rows[4].reference_value)).toBe('5')
      })

      await test.step('1. If/Else, Switch, While and Wait Until: the integer box drops keys', async () => {
        await checkConditionBox(page, IF_ELSE, 'if-else', 'branch_big')
        await checkConditionBox(page, SWITCH, 'switch', 'branch_0')
        await checkConditionBox(page, WHILE, 'while')
        await checkConditionBox(page, WAIT, 'wait-until')
      })

      await test.step('1, 3. CSV: As Integer and As Float filter boxes and the column Index box drop keys', async () => {
        const sheet = await openBlockSheet(page, CSV)
        await openCsvSection(sheet, 'csv-filters-section')
        await expectIntegerBox(sheet.locator('[data-testid="filter-condition-value-filter-id-cond"]'))
        const ratio = sheet.locator('[data-testid="filter-condition-value-filter-ratio-cond"]')
        await expect(ratio).toHaveValue('2.0')
        await expectTypedAs(ratio, '1e5', '15')
        await expectTypedAs(ratio, '1,000', '1000')
        await expectTypedAs(ratio, 'abc', '')
        await openCsvSection(sheet, 'csv-sorts-section')
        const index = sheet.locator('[data-testid^="sort-row-"]').first().locator('[data-testid="column-ref-value"]')
        await expect(index).toHaveValue('1')
        await expectTypedAs(index, '-1.x2', '12')
        await discardBlockSheet(page, sheet)
      })

      await test.step('3b. a filter turned As Integer keeps 2.0, names it under the box and holds Save until a number is typed', async () => {
        const sheet = await openBlockSheet(page, CSV)
        await openCsvSection(sheet, 'csv-filters-section')
        const block = sheet.locator('[data-testid="filter-block-filter-ratio"]')
        await setFilterAsType(page, block, 'integer')
        const box = sheet.locator('[data-testid="filter-condition-value-filter-ratio-cond"]')
        await expect(box).toHaveValue('2.0')
        const message = sheet.locator('[data-testid="filter-condition-error-filter-ratio-cond"]')
        await expect(message).toHaveText('Enter a valid integer value')
        await expect(box).toHaveAttribute('aria-invalid', 'true')
        const save = sheet.getByRole('button', { name: 'Save', exact: true })
        await expect(save).toBeDisabled()
        await expectTypedAs(box, '2', '2')
        await expect(message).toHaveCount(0)
        await expect(save).toBeEnabled()
        await discardBlockSheet(page, sheet)
      })

      const status = await startRun(page)
      const logs = await finishRun(page, status, 'conditions-done')

      await test.step('6. the run takes the branches the numbers pick and keeps the filtered, index-sorted rows', async () => {
        expect(logs).toContain('if-big')
        expect(logs).not.toContain('if-small')
        expect(logs).toContain('case-five')
        expect(logs).toContain('conditions-done i=3')
        await expectNodesSuccess(page, [ASSERT, IF_ELSE, LOG_IF, SWITCH, LOG_CASE, WHILE, WAIT, CSV, LOG_DONE])
        const variables = await getSessionVariables(page, await getActiveSessionId(page))
        expect(keptIds(variables, 'kept')).toBe('3,2')
      })
    } finally {
      await request.delete(`${BACKEND_URL}/workbench/session/`).catch(() => undefined)
      await request.delete(`${BACKEND_URL}/tests/${testId}`).catch(() => undefined)
    }
  })
})
