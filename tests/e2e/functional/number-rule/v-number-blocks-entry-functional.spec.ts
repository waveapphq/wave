/**
 * V-NUMBER-BLOCKS-ENTRY-FUNCTIONAL: an unfinished number in a number box is named under it and holds Save
 * Wireframe: none (functional)
 * Design Decisions: FIELD-1, FIELD-8, FIELDERR-1, VARSET-8
 * REQ: REQ-3.1.3.14
 *
 * `fixture-blocks-entry.json` holds an HTTP Block (Max Redirects set to 5, every other number row on its gray
 * default) and a Variable Setter with an integer row `count` and a float row `ratio`. A `zz-11541-s8-*` Suite,
 * Regression and Database profile are made through the API. Every box is typed through the UI; nothing is saved
 * while a box holds unfinished text.
 *
 * Pass Criteria:
 * 1. A Block integer box typed `-` over its gray default shows `Enter a valid integer value` under it and the sheet
 *    Save is off; the `-` is drawn in the value color of a set integer, not in the gray of a default.
 * 2. A Block float box typed `2.` shows `Enter a valid float value` and Save is off; once the text is a number the
 *    message goes and Save is on.
 * 3. A Variable Setter integer row typed `-` and a float row typed `2.` show the same messages and hold the sheet's
 *    Save until they are numbers.
 * 4. A Suite and a Regression variable row typed `-` (integer) or `2.` (float) shows the message under the row and
 *    holds the dialog's Save until the text is a number.
 * 5. A Database profile Port cell typed `-` shows `Enter a valid integer value` and holds Save Changes until it is a
 *    number.
 */

import { test, expect, type Locator, type Page } from '../../helpers/playwright-fixtures'
import { elementColor, numberInput, rowError, saveButton } from '../../helpers/config-sheet'
import { BACKEND_URL, E2E_ENV_NAME } from '../../helpers/config'
import { readFixture, runToken } from '../../helpers/element-types'
import { createEntity, openEntityVariables, entityVariableRow, variablesDialog } from '../../helpers/entity-variables'
import { importValidateAndNavigate } from '../../helpers/fixture-import'
import { resolveEnvironmentId } from '../../helpers/k8s-run'
import {
  closeUnsavedQuestion,
  deleteTestQuietly,
  discardSheet,
  nodeIdOf,
  openGroup,
  typeNumber,
} from '../../helpers/number-rule'
import { openProfileEditor } from '../../helpers/profiles'
import { openBlockSheet } from '../../helpers/workbench'

const UNFINISHED = {
  integer: 'Enter a valid integer value',
  float: 'Enter a valid float value',
}

/** The number box of a row that holds one (Variable Setter, entity and profile rows). */
const rowNumberBox = (row: Locator): Locator => row.locator('[data-testid="scalar-edit-input"]')

/** A profile form row by its parameter name. */
async function profileRow(dialog: Locator, name: string): Promise<Locator> {
  const rows = dialog.locator('tbody tr[data-parameter-id]')
  const total = await rows.count()
  for (let i = 0; i < total; i++) {
    if ((await rows.nth(i).locator('[aria-label="Parameter name"]').inputValue()) === name) return rows.nth(i)
  }
  throw new Error(`profile row "${name}" not found`)
}

/** Type unfinished text, see it named and Save held, then finish the number and see both clear. */
async function expectUnfinishedHeld(
  page: Page,
  box: Locator,
  message: Locator,
  save: Locator,
  steps: { unfinished: string; text: string; finished: string },
): Promise<void> {
  await typeNumber(page, box, steps.unfinished)
  await expect(message).toHaveText(steps.text)
  await expect(save, `Save is held while the box shows ${steps.unfinished}`).toBeDisabled()
  await typeNumber(page, box, steps.finished)
  await expect(message).toHaveCount(0)
  await expect(save).toBeEnabled()
}

test.describe('V-NUMBER-BLOCKS-ENTRY-FUNCTIONAL: unfinished numbers are named and hold Save', () => {
  const cleanups: Array<() => Promise<unknown>> = []

  test.afterEach(async () => {
    for (const cleanup of cleanups.splice(0)) await cleanup().catch(() => undefined)
  })

  test('a Block field and a Variable Setter row name unfinished text and hold the sheet Save', async ({
    page,
    request,
  }) => {
    test.setTimeout(180_000)
    const fixture = readFixture(__dirname, 'fixture-blocks-entry.json')
    const http = nodeIdOf(fixture, 'Typed Entry')
    const setter = nodeIdOf(fixture, 'Set Numbers')
    const testId = await importValidateAndNavigate(page, fixture, { injectHttp: true, rejectRepairs: true })
    cleanups.push(() => request.delete(`${BACKEND_URL}/workbench/session/`))
    cleanups.push(() => deleteTestQuietly(request, testId))

    await test.step('a Block integer box: `-` over the gray default is named and drawn in the value color', async () => {
      const sheet = await openBlockSheet(page, http)
      await openGroup(sheet, 'Timeouts & Retries')
      await openGroup(sheet, 'Connection')
      const timeout = numberInput(sheet, 'timeout')
      await expect(timeout, 'Timeout starts on its gray default').toHaveValue('30')
      const grayDefault = await elementColor(numberInput(sheet, 'retry_count'), 'color')
      const setInteger = await elementColor(numberInput(sheet, 'max_redirects'), 'color')
      expect(grayDefault, 'a default and a set value are drawn apart').not.toBe(setInteger)

      await typeNumber(page, timeout, '-')
      await expect(rowError(sheet, 'timeout')).toHaveText(UNFINISHED.integer)
      await expect(saveButton(sheet)).toBeDisabled()
      expect(await elementColor(timeout, 'color'), 'the typed `-` takes the value color').toBe(setInteger)
      await typeNumber(page, timeout, '-45')
      await expect(rowError(sheet, 'timeout')).toHaveCount(0)
      await expect(saveButton(sheet)).toBeEnabled()

      await expectUnfinishedHeld(page, numberInput(sheet, 'retry_delay'), rowError(sheet, 'retry_delay'), saveButton(sheet), {
        unfinished: '2.',
        text: UNFINISHED.float,
        finished: '2.5',
      })
      await discardSheet(page, sheet)
    })

    await test.step('a Variable Setter integer and float row name unfinished text and hold Save', async () => {
      const sheet = await openBlockSheet(page, setter)
      const boxes = rowNumberBox(sheet)
      await expect(boxes).toHaveCount(2)
      const alert = sheet.locator('p[role="alert"]')
      await expectUnfinishedHeld(page, boxes.nth(0), alert, saveButton(sheet), {
        unfinished: '-',
        text: UNFINISHED.integer,
        finished: '-3',
      })
      await expectUnfinishedHeld(page, boxes.nth(1), alert, saveButton(sheet), {
        unfinished: '2.',
        text: UNFINISHED.float,
        finished: '2.75',
      })
      await discardSheet(page, sheet)
    })
  })

  test('Suite and Regression variable rows and a profile Port cell name unfinished text and hold Save', async ({
    page,
    request,
  }) => {
    test.setTimeout(180_000)
    const token = runToken()
    const variables = {
      count: { type: 'integer', value: 5, secret: false },
      ratio: { type: 'float', value: 1.5, secret: false },
    }
    const suiteId = await createEntity(request, '/suites', { name: `zz-11541-s8-suite-${token}`, variables })
    cleanups.push(() => request.delete(`${BACKEND_URL}/suites/${suiteId}`))
    const regressionId = await createEntity(request, '/regressions', {
      name: `zz-11541-s8-regression-${token}`,
      variables,
    })
    cleanups.push(() => request.delete(`${BACKEND_URL}/regressions/${regressionId}`))

    for (const [scope, id] of [
      ['suite', suiteId],
      ['regression', regressionId],
    ] as const) {
      await test.step(`a ${scope} integer and float row name unfinished text and hold the dialog Save`, async () => {
        const dialog = await openEntityVariables(page, scope, id)
        const save = dialog.locator('[data-testid="edit-dialog-save"]')
        for (const [name, steps] of [
          ['count', { unfinished: '-', text: UNFINISHED.integer, finished: '-7' }],
          ['ratio', { unfinished: '2.', text: UNFINISHED.float, finished: '2.25' }],
        ] as const) {
          const row = await entityVariableRow(dialog, name)
          await expectUnfinishedHeld(page, rowNumberBox(row), row.locator('p[role="alert"]'), save, steps)
        }
        await dialog.locator('[data-testid="edit-dialog-cancel"]').click()
        await closeUnsavedQuestion(page)
        await expect(variablesDialog(page)).toBeHidden()
      })
    }

    await test.step('a Database profile Port cell names unfinished text and holds Save Changes', async () => {
      const environmentId = await resolveEnvironmentId(request)
      const name = `zz-11541-s8-profile-${token}`
      const config = {
        host: 'db.example.test',
        port: 5432,
        database: 'wave',
        username: 'wave',
        password: '',
        verify_ssl: true,
        ca_cert: '',
        client_cert: '',
        client_key: '',
        driver_options: {},
      }
      const resp = await request.post(`${BACKEND_URL}/profiles`, {
        data: { name, type: 'database', tags: [], config, environment_values: { [environmentId]: config } },
      })
      expect(resp.ok(), `POST /profiles: ${resp.status()} ${await resp.text()}`).toBeTruthy()
      const profileId = (await resp.json()).data.id as string
      cleanups.push(() => request.delete(`${BACKEND_URL}/profiles/${profileId}`))

      const dialog = await openProfileEditor(page, name, E2E_ENV_NAME)
      const row = await profileRow(dialog, 'port')
      await expectUnfinishedHeld(
        page,
        rowNumberBox(row),
        row.locator('p[role="alert"]'),
        dialog.getByRole('button', { name: 'Save Changes', exact: true }),
        { unfinished: '-', text: UNFINISHED.integer, finished: '5433' },
      )
    })
  })
})
