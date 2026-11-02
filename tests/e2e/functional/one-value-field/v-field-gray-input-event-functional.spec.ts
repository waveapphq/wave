/**
 * V-FIELD-GRAY-INPUT-EVENT-FUNCTIONAL: a value that reaches a gray default with no key press (a fill, autofill, a dropped
 *   text) replaces the whole default and is what Save stores.
 * Design Decisions: FIELD-2 (any change makes the user's value; the inserted text replaces the whole default), FIELD-3
 * REQ: REQ-3.1.1.5, REQ-3.1.3.14
 *
 * Fixture `fixture-default-rule.json` (POST /tests, zero validation errors): a Function Block whose inputs all have
 * defaults (text `region`, integer `tries`, float `ratio`, list `labels`, map `opts`, table `grid`) and an HTTP Request
 * whose Timeout is not set (default 30). Each value goes in with Playwright `fill()`: one input event, no key press.
 *
 * Pass Criteria:
 * 1. Every free-entry type filled over its gray default shows the filled text in its value color with the reset icon:
 *    text `us-east-2`, integer `7`, list `["x"]`, map `{"k": "v"}`, table `[{"name": "gamma"}]`, HTTP Timeout `45`.
 * 2. A fill equal to the gray default (float `2.5`) is the user's value too: value color and reset icon.
 * 3. Save stores exactly what each field shows: `us-east-2`, 7, 2.5, `["x"]`, `{"k": "v"}`, the one-row table and 45,
 *    none of them as an expression.
 *
 * Phase: functional-workflow (imports its own fixture, deletes it after). The stored Test is the behavior: nothing is run.
 */

import { test, expect, type Locator, type Page } from '../../helpers/playwright-fixtures'
import { importValidateAndNavigate } from '../../helpers/fixture-import'
import { readFixture } from '../../helpers/element-types'
import { openBlockSheet, saveBlockSheet, saveTest } from '../../helpers/workbench'
import { deleteSeededTest, openGroup, storedBlock } from '../../helpers/list-fields'
import { fieldInput } from '../../helpers/value-field'
import {
  expectGrayDefault,
  expectStored,
  expectUserValue,
  storedFields,
  type FreeEntryType,
} from '../../helpers/default-rule'
import { newToken, withToken } from '../shell-blocks/shell-helpers'

const REDIRECT = '45cf6657-0a92-4987-ac0c-baea37c1f7b8'
const FN = 'b706b9d0-5781-43fe-910c-81339e90b90c'
const RETRIES = 'Timeouts & Retries'

interface Filled {
  name: string
  type: FreeEntryType
  gray: string
  text: string
}

const FN_FIELDS: readonly Filled[] = [
  { name: 'region', type: 'string', gray: 'eu-west-1', text: 'us-east-2' },
  { name: 'tries', type: 'integer', gray: '3', text: '7' },
  { name: 'ratio', type: 'float', gray: '2.5', text: '2.5' },
  { name: 'labels', type: 'array', gray: '[1, 2]', text: '["x"]' },
  { name: 'opts', type: 'map', gray: '{"k": 1}', text: '{"k": "v"}' },
  { name: 'grid', type: 'table', gray: '[{"name": "alpha"}, {"name": "beta"}]', text: '[{"name": "gamma"}]' },
]

/** One input event with no key press puts `text` in the box, as autofill or a dropped text does. */
async function fillOverDefault(sheet: Locator, field: Filled): Promise<void> {
  await expectGrayDefault(sheet, field.name, field.gray)
  await fieldInput(sheet, field.name).fill(field.text)
  await expectUserValue(sheet, field.name, field.type, field.text)
}

async function openSheet(page: Page, blockId: string, groups: readonly string[] = []): Promise<Locator> {
  const sheet = await openBlockSheet(page, blockId)
  for (const group of groups) await openGroup(sheet, group)
  return sheet
}

test.describe('V-FIELD-GRAY-INPUT-EVENT-FUNCTIONAL: a value with no key press replaces the gray default', () => {
  let testId = ''

  test.afterEach(async ({ page }) => {
    await deleteSeededTest(page, testId)
    testId = ''
  })

  test('a fill over every free-entry gray default is shown and stored as the user value', async ({ page }) => {
    test.setTimeout(240_000)
    const token = newToken()
    const fixture = withToken(readFixture(__dirname, 'fixture-default-rule.json'), token)
    fixture.name = `zz-11541-r3-gray-input-${token}`
    testId = await importValidateAndNavigate(page, fixture, { injectHttp: true, rejectRepairs: true })

    await test.step('Function Block: text, integer, float equal to the default, list, map and table', async () => {
      const sheet = await openSheet(page, FN)
      for (const field of FN_FIELDS) {
        await test.step(`${field.name}: ${field.text} filled over the gray ${field.gray}`, () => fillOverDefault(sheet, field))
      }
      await saveBlockSheet(sheet)
    })

    await test.step('HTTP Request: Timeout 45 filled over the gray 30', async () => {
      const sheet = await openSheet(page, REDIRECT, [RETRIES])
      await fillOverDefault(sheet, { name: 'timeout', type: 'integer', gray: '30', text: '45' })
      await saveBlockSheet(sheet)
    })

    await test.step('Save stores what each field shows', async () => {
      await saveTest(page)
      const fn = storedFields(await storedBlock(page.request, testId, FN))
      expectStored(fn, 'region', 'us-east-2', false, 'the filled text')
      expectStored(fn, 'tries', 7, false, 'the filled integer')
      expectStored(fn, 'ratio', 2.5, false, 'the filled float equal to the default')
      expectStored(fn, 'labels', ['x'], false, 'the filled list')
      expectStored(fn, 'opts', { k: 'v' }, false, 'the filled map')
      expectStored(fn, 'grid', { columns: [{ name: 'name', type: 'string' }], rows: [['gamma']] }, false, 'the filled table')
      const redirect = storedFields(await storedBlock(page.request, testId, REDIRECT))
      expectStored(redirect, 'timeout', 45, false, 'the filled HTTP Timeout')
    })
  })
})
