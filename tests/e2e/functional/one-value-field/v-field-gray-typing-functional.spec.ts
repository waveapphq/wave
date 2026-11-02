/**
 * V-FIELD-GRAY-TYPING-FUNCTIONAL: pasting, typing and copying over a gray default on Block rows, checked in the stored Test.
 * Design Decisions: FIELD-2 (any change makes the user's value; the first key or paste replaces the whole default; the
 *   gray text is real text that copies), FIELD-3 (reset icon)
 * REQ: REQ-3.1.1.5, REQ-3.1.3.14
 *
 * Pass Criteria:
 * 1. Selecting the gray `eu-west-1` (a Function Block text input), copying it and pasting it back makes it the user's
 *    value: the value color and the reset icon; Save stores `eu-west-1`. The same for an integer default `3`.
 * 2. HTTP Retry Delay (default 1) typed `1.5` stores 1.5; an integer default 30 (HTTP Timeout) typed `-5` stores -5;
 *    while only `-` is typed the box shows it in the value color with `Enter a valid integer value`.
 * 3. Retryable Codes typed key by key `["429"]`: after `[` the text is in the value color, not gray, the row shows
 *    `Unexpected end of JSON input` and the window Save is off; Backspace edits the typed text; the finished list
 *    clears the problem and Save stores `["429"]`.
 * 4. Typing `[` over a gray list and then Backspace empties the box and brings the gray default back, with no problem.
 * 5. A map (Shell Exec Input Variables) typed key by key `{"A": "1"}` and a table (Function Block input) typed key by
 *    key `[{"name": "gamma"}]` store the typed value.
 * 6. A Function Block text input whose default has a line break shows its first line in gray; copying the gray line
 *    copies the whole default with its line break, and typing replaces the whole default; Save stores the typed text.
 *
 * Phase: functional-workflow (imports its own fixture, deletes it after). The stored Test is the behavior: nothing is run.
 */

import { test, expect, type Locator, type Page } from '../../helpers/playwright-fixtures'
import { importValidateAndNavigate } from '../../helpers/fixture-import'
import { readFixture } from '../../helpers/element-types'
import { rowError, saveButton } from '../../helpers/config-sheet'
import { openBlockSheet, saveBlockSheet, saveTest } from '../../helpers/workbench'
import { deleteSeededTest, openGroup, storedBlock } from '../../helpers/list-fields'
import { fieldInput } from '../../helpers/value-field'
import {
  expectGrayDefault,
  expectStored,
  expectUserValue,
  expectValueColor,
  storedFields,
  typeKeys,
} from '../../helpers/default-rule'
import { newToken, withToken } from '../shell-blocks/shell-helpers'

const SHELL = 'f41fa3af-20aa-497b-be12-9bd63c6e6c7c'
const REDIRECT = '45cf6657-0a92-4987-ac0c-baea37c1f7b8'
const RETRY = '7f9bc89a-b744-4623-8a7a-032c141e6a8f'
const FN = 'b706b9d0-5781-43fe-910c-81339e90b90c'

const RETRIES = 'Timeouts & Retries'
const NOTES_DEFAULT = 'first line\nsecond line'

function clipboardText(page: Page): Promise<string> {
  return page.evaluate(() => navigator.clipboard.readText())
}

/** Select all of the field's box and copy it; returns what the clipboard holds. */
async function copyField(page: Page, sheet: Locator, name: string): Promise<string> {
  await page.evaluate(() => navigator.clipboard.writeText(''))
  await fieldInput(sheet, name).click()
  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.press('ControlOrMeta+c')
  return clipboardText(page)
}

async function openSheet(page: Page, blockId: string, groups: readonly string[] = []): Promise<Locator> {
  const sheet = await openBlockSheet(page, blockId)
  for (const group of groups) await openGroup(sheet, group)
  return sheet
}

test.describe('V-FIELD-GRAY-TYPING-FUNCTIONAL: pasting, typing and copying over a gray default', () => {
  let testId = ''

  test.afterEach(async ({ page }) => {
    await deleteSeededTest(page, testId)
    testId = ''
  })

  test('a pasted default, typed numbers, lists, maps and tables, and a many-line default are stored as typed', async ({
    page,
  }) => {
    test.setTimeout(300_000)
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
    const fixture = withToken(readFixture(__dirname, 'fixture-default-rule.json'), newToken())
    testId = await importValidateAndNavigate(page, fixture, { injectHttp: true, rejectRepairs: true })

    await test.step('Function Block: the gray default pasted back, a table typed key by key, a many-line default', async () => {
      const sheet = await openSheet(page, FN)

      await test.step('region: copy the gray eu-west-1 and paste it back', async () => {
        await expectGrayDefault(sheet, 'region', 'eu-west-1')
        expect(await copyField(page, sheet, 'region'), 'the gray text copies').toBe('eu-west-1')
        await page.keyboard.press('ControlOrMeta+v')
        await expectUserValue(sheet, 'region', 'string', 'eu-west-1')
      })

      await test.step('tries: copy the gray 3 and paste it back', async () => {
        await expectGrayDefault(sheet, 'tries', '3')
        expect(await copyField(page, sheet, 'tries'), 'the gray number copies').toBe('3')
        await page.keyboard.press('ControlOrMeta+v')
        await expectUserValue(sheet, 'tries', 'integer', '3')
      })

      await test.step('grid: a table typed key by key replaces the gray default', async () => {
        await expectGrayDefault(sheet, 'grid', '[{"name": "alpha"}, {"name": "beta"}]')
        await typeKeys(page, sheet, 'grid', '[{"name": "gamma"}]')
        await expectUserValue(sheet, 'grid', 'table', '[{"name": "gamma"}]')
        await expect(rowError(sheet, 'grid')).toHaveCount(0)
      })

      await test.step('notes: the gray first line copies the whole default; typing replaces all of it', async () => {
        await expectGrayDefault(sheet, 'notes', 'first line…')
        await expect(fieldInput(sheet, 'notes'), 'the whole default is the box title').toHaveAttribute('title', NOTES_DEFAULT)
        expect(await copyField(page, sheet, 'notes'), 'the copy holds every line').toBe(NOTES_DEFAULT)
        await typeKeys(page, sheet, 'notes', 'x')
        await expectUserValue(sheet, 'notes', 'string', 'x')
      })

      await saveBlockSheet(sheet)
    })

    await test.step('HTTP Retry Once: Retry Delay typed 1.5; Retryable Codes typed key by key with its line problem', async () => {
      const sheet = await openSheet(page, RETRY, [RETRIES])

      await test.step('retry_delay: 1.5 typed over the gray 1', async () => {
        await expectGrayDefault(sheet, 'retry_delay', '1')
        await typeKeys(page, sheet, 'retry_delay', '1.5')
        await expectUserValue(sheet, 'retry_delay', 'float', '1.5')
      })

      await test.step('retryable_status_codes: an unfinished [ is the value color, shows its problem and holds Save', async () => {
        const name = 'retryable_status_codes'
        await typeKeys(page, sheet, name, '[')
        const box = fieldInput(sheet, name)
        await expect(box).toHaveValue('[')
        await expectValueColor(box, 'array', 'the unfinished text')
        await expect(rowError(sheet, name), 'the line problem').toHaveText('Unexpected end of JSON input')
        await expect(saveButton(sheet), 'Save is off while the line does not read').toBeDisabled()

        await page.keyboard.type('"4299')
        await page.keyboard.press('Backspace')
        await expect(box, 'Backspace edits the typed text').toHaveValue('["429')
        await expectValueColor(box, 'array', 'the edited text')

        await page.keyboard.type('"]')
        await expectUserValue(sheet, name, 'array', '["429"]')
        await expect(rowError(sheet, name)).toHaveCount(0)
        await expect(saveButton(sheet)).toBeEnabled()
      })

      await saveBlockSheet(sheet)
    })

    await test.step('HTTP Redirect Ten: Timeout typed -5; an emptied list brings the gray default back', async () => {
      const sheet = await openSheet(page, REDIRECT, [RETRIES])

      await test.step('timeout: -5 typed over the gray 30', async () => {
        await expectGrayDefault(sheet, 'timeout', '30')
        await typeKeys(page, sheet, 'timeout', '-')
        await expect(fieldInput(sheet, 'timeout')).toHaveValue('-')
        await expectValueColor(fieldInput(sheet, 'timeout'), 'integer', 'the unfinished number')
        await expect(rowError(sheet, 'timeout')).toHaveText('Enter a valid integer value')
        await page.keyboard.type('5')
        await expectUserValue(sheet, 'timeout', 'integer', '-5')
        await expect(rowError(sheet, 'timeout')).toHaveCount(0)
      })

      await test.step('retryable_status_codes: [ then Backspace empties the box and the gray default is back', async () => {
        const name = 'retryable_status_codes'
        await typeKeys(page, sheet, name, '[')
        await expect(rowError(sheet, name)).toHaveText('Unexpected end of JSON input')
        await page.keyboard.press('Backspace')
        await expectGrayDefault(sheet, name, '["502", "503", "504"]')
        await expect(rowError(sheet, name), 'no problem once the default is back').toHaveCount(0)
      })

      await saveBlockSheet(sheet)
    })

    await test.step('Shell Exec: Input Variables typed key by key', async () => {
      const sheet = await openSheet(page, SHELL)
      await expectGrayDefault(sheet, 'env_vars', '{}')
      await typeKeys(page, sheet, 'env_vars', '{"A": "1"}')
      await expectUserValue(sheet, 'env_vars', 'map', '{"A": "1"}')
      await saveBlockSheet(sheet)
    })

    await test.step('Save stores every typed or pasted value', async () => {
      await saveTest(page)
      const fn = storedFields(await storedBlock(page.request, testId, FN))
      expectStored(fn, 'region', 'eu-west-1', false, 'the pasted default')
      expectStored(fn, 'tries', 3, false, 'the pasted number default')
      expectStored(fn, 'grid', { columns: [{ name: 'name', type: 'string' }], rows: [['gamma']] }, false, 'the typed table')
      expectStored(fn, 'notes', 'x', false, 'the typed text over a many-line default')

      const retry = storedFields(await storedBlock(page.request, testId, RETRY))
      expectStored(retry, 'retry_delay', 1.5, false, 'the typed float')
      expectStored(retry, 'retryable_status_codes', ['429'], false, 'the list typed key by key')

      const redirect = storedFields(await storedBlock(page.request, testId, REDIRECT))
      expectStored(redirect, 'timeout', -5, false, 'the typed negative integer')
      expect(Object.hasOwn(redirect.values, 'retryable_status_codes'), 'the emptied list stores nothing').toBe(false)

      const shell = storedFields(await storedBlock(page.request, testId, SHELL))
      expectStored(shell, 'env_vars', { A: '1' }, false, 'the map typed key by key')
    })
  })
})
