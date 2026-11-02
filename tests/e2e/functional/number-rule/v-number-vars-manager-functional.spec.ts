/**
 * V-NUMBER-VARS-MANAGER: the Variable Manager, its editors and the run records keep every digit by the one number rule
 * Wireframe: N/A (the Variable Manager, the variable window and the Edit value sheet keep their look)
 * Design Decisions: VMGR-110, FIELD-1, FIELD-13
 * REQ: REQ-3.1.3.14, REQ-3.1.3.19, REQ-3.2.1.6
 *
 * `fixture-vars-manager.json` declares an integer past 2^53 (`1234567890123456789`), a float of 22 digits
 * (`1000000000000000000000`), a float below 1e-6 (`0.0000001`), integer list, map and table items, and an
 * HTTP Block whose float Retry Delay is stored as `0.0000001`. The Test is run through the UI, then as a
 * tracked execution.
 *
 * Pass Criteria:
 * 1. The import validates with zero errors.
 * 2. The float variable `tiny` shows `0.0000001` on its Variable Manager row and in its window; a digit typed
 *    at its end is kept, and the saved Test holds `0.00000012`.
 * 3. The HTTP Block's Retry Delay shows `0.0000001`; a digit typed at its end is kept, and the saved Block holds
 *    `0.00000013`.
 * 4. In the Visual editor of an integer list item, an integer map value and an integer table cell, a letter and
 *    a dot never enter, and a 20th digit is dropped after 19 typed.
 * 5. The run passes; its console prints `big=1234567890123456789` and `huge=1000000000000000000000`; the
 *    Variable Manager rows of `big` and `huge` show every digit; the session variables carry both with every
 *    digit, never as `1e+21`, and `tiny` as `0.00000012`.
 * 6. A Current value of ` 30 `, `+30`, `1e5` or 20 digits for the integer `n`, `NaN` or `Infinity` for the float
 *    `f`, and a list item `abc` for `ports` are each refused 422 with the variable's message
 *    (`Value for variable 'n' is not a valid integer`, `... allows at most 19 digits, got 20`,
 *    `Value for variable 'f' is not a valid float`, `Value for variable 'ports' at item 2 is not a valid integer`),
 *    and every old value is kept.
 * 7. In the Current view of `n`'s window the keys ` +1e5` leave `15`: a space, a plus and a letter never enter.
 * 8. A tracked execution of the Test passes and its record carries `1234567890123456789` and
 *    `1000000000000000000000` with every digit, never in exponent form.
 */

import fs from 'fs'
import path from 'path'
import { test, expect, type APIRequestContext, type Locator, type Page } from '../../helpers/playwright-fixtures'
import { BACKEND_URL, E2E_ENV_NAME } from '../../helpers/config'
import { getActiveSessionId, getSessionVariables, importValidateAndNavigate } from '../../helpers/fixture-import'
import { finishRun, startRun } from '../../helpers/k8s-run'
import { expectTypedAs, rawBody, refusalOf, typeAtEnd } from '../../helpers/number-entry'
import {
  cancelCreate,
  closeValueEditor,
  openEditWindow,
  openValueEditor,
  saveWindow,
  setValueEditorView,
  valueField,
  variableRow,
} from '../../helpers/variable-create'
import { openBlockSheet, saveBlockSheet, saveTest } from '../../helpers/workbench'
import { persistedValues } from '../file-picker/picker'

const HTTP_BLOCK = '80240112-bbc7-4594-9dec-00e1e7743517'
const DONE = 'vars-manager-done'
const BIG = '1234567890123456789'
const HUGE = '1000000000000000000000'
const NINETEEN = '9876543210987654321'

function loadFixture(): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(path.join(__dirname, 'fixture-vars-manager.json'), 'utf-8'))
}

const rowValue = (page: Page, name: string): Locator =>
  variableRow(page, name).locator('[data-testid^="variable-value-"]')

async function testVariables(request: APIRequestContext, testId: string): Promise<Record<string, any>> {
  const response = await request.get(`${BACKEND_URL}/tests/${testId}`)
  expect(response.ok(), `GET /tests/${testId} answered ${response.status()}`).toBeTruthy()
  return (await response.json()).data.variables
}

async function environmentId(request: APIRequestContext): Promise<string> {
  const response = await request.get(`${BACKEND_URL}/environments/`)
  const body = await response.json()
  const listed = (Array.isArray(body) ? body : (body.data ?? [])) as Array<{ id: string; name: string }>
  const found = listed.find((environment) => environment.name === E2E_ENV_NAME)
  expect(found, `the environment ${E2E_ENV_NAME} exists`).toBeTruthy()
  return found!.id
}

/** In the window of `name`, the Visual editor's entry box `testId` drops a letter, a dot and a 20th digit. */
async function expectEntryGate(page: Page, name: string, testId: string, shown: string): Promise<void> {
  const win = await openEditWindow(page, name)
  const sheet = await openValueEditor(page, win)
  await setValueEditorView(page, sheet, 'Visual')
  const box = sheet.locator(`[data-testid="${testId}"]`)
  await expect(box).toHaveValue(shown)
  await typeAtEnd(box, 'a')
  await expect(box, 'a letter never enters').toHaveValue(shown)
  await typeAtEnd(box, '.')
  await expect(box, 'a dot never enters').toHaveValue(shown)
  await expectTypedAs(box, `${NINETEEN}0`, NINETEEN)
  await closeValueEditor(page, sheet, 'Close')
  await cancelCreate(page, win)
}

test.describe('V-NUMBER-VARS-MANAGER: the Variable Manager keeps every digit', () => {
  test('stored, edited, run and refused Current values keep the one number rule', async ({ page, request }) => {
    test.setTimeout(300_000)
    const testId = await importValidateAndNavigate(page, loadFixture(), { injectHttp: true })
    try {
      await test.step('2. the float 0.0000001 shows in plain digits and takes a digit at its end', async () => {
        await expect(rowValue(page, 'tiny')).toHaveText('0.0000001')
        const win = await openEditWindow(page, 'tiny')
        const box = valueField(win).locator('[data-testid="scalar-edit-input"]')
        await expect(box).toHaveValue('0.0000001')
        await typeAtEnd(box, '2')
        await expect(box).toHaveValue('0.00000012')
        await saveWindow(page, win)
        await saveTest(page)
        expect((await testVariables(request, testId)).tiny.value).toBe('0.00000012')
      })

      await test.step('3. the Block float field 0.0000001 shows in plain digits and takes a digit at its end', async () => {
        const sheet = await openBlockSheet(page, HTTP_BLOCK)
        const box = sheet.locator('[data-testid="param-input-retry_delay"]')
        if (!(await box.isVisible())) await sheet.locator('[data-testid="group-header-Timeouts & Retries"]').click()
        await expect(box).toHaveValue('0.0000001')
        await typeAtEnd(box, '3')
        await expect(box).toHaveValue('0.00000013')
        await saveBlockSheet(sheet)
        await saveTest(page)
        expect((await persistedValues(request, testId))[HTTP_BLOCK].retry_delay).toBe('0.00000013')
      })

      await test.step('4. list, map and table integer entries drop a letter, a dot and a 20th digit', async () => {
        await expectEntryGate(page, 'ports', 'array-edit-input-0', '8080')
        await expectEntryGate(page, 'limits', 'map-edit-value-0', '3')
        await expectEntryGate(page, 'grid', 'table-cell-0-0', '1')
      })

      const status = await startRun(page)
      const logs = await finishRun(page, status, DONE)

      await test.step('5. the console, the rows and the session variables carry every digit', async () => {
        for (const line of [`big=${BIG}`, `huge=${HUGE}`]) {
          expect(logs, `the console prints ${line}`).toContain(line)
        }
        await expect(rowValue(page, 'big')).toHaveText(BIG)
        await expect(rowValue(page, 'huge')).toHaveText(HUGE)
        const sid = await getActiveSessionId(page)
        const text = await rawBody(
          await request.get(`${BACKEND_URL}/workbench/${sid}/variables`),
          'GET the session variables',
        )
        expect(text).toContain(BIG)
        expect(text).toContain(HUGE)
        expect(text).not.toMatch(/e\+21/i)
        const variables = await getSessionVariables(page, sid)
        expect(variables.tiny.value, 'the edited float runs as typed').toBe('0.00000012')
      })

      await test.step('6. refused Current values keep the old value', async () => {
        const sid = await getActiveSessionId(page)
        const override = (name: string, data: Record<string, unknown>) =>
          request.patch(`${BACKEND_URL}/workbench/${sid}/variables/${name}`, { data })
        const cases: Array<[string, Record<string, unknown>, string]> = [
          ['n', { type: 'integer', value: ' 30 ' }, "Value for variable 'n' is not a valid integer"],
          ['n', { type: 'integer', value: '+30' }, "Value for variable 'n' is not a valid integer"],
          ['n', { type: 'integer', value: '1e5' }, "Value for variable 'n' is not a valid integer"],
          ['n', { type: 'integer', value: '12345678901234567890' }, "Value for variable 'n' allows at most 19 digits, got 20"],
          ['f', { type: 'float', value: 'NaN' }, "Value for variable 'f' is not a valid float"],
          ['f', { type: 'float', value: 'Infinity' }, "Value for variable 'f' is not a valid float"],
          [
            'ports',
            { type: 'array', value: ['8080', 'abc'], elementTypes: ['integer', 'integer'] },
            "Value for variable 'ports' at item 2 is not a valid integer",
          ],
        ]
        for (const [name, data, message] of cases) {
          const refusal = await refusalOf(await override(name, data), `a Current ${name} of ${JSON.stringify(data.value)}`)
          expect(refusal.status).toBe(422)
          expect(refusal.message).toBe(message)
        }
        const variables = await getSessionVariables(page, sid)
        expect(variables.n.value, 'n keeps 7').toBe(7)
        expect(String(variables.f.value), 'f keeps 1.5').toBe('1.5')
        expect(variables.ports.value, 'ports keeps its items').toEqual([8080, 8443])
        await expect(rowValue(page, 'n')).toHaveText('7')
      })

      await test.step('7. the Current number box drops a space, a plus and a letter', async () => {
        const win = await openEditWindow(page, 'n', { view: 'Current' })
        const box = valueField(win).locator('[data-testid="scalar-edit-input"]')
        await expect(box).toHaveValue('7')
        await expectTypedAs(box, ' +1e5', '15')
        await cancelCreate(page, win)
      })

      await test.step('8. the tracked run record carries every digit', async () => {
        const started = await request.post(`${BACKEND_URL}/executions`, {
          data: { type: 'test', id: testId, environment_id: await environmentId(request) },
        })
        expect(started.ok(), `POST /executions answered ${await started.text()}`).toBeTruthy()
        const executionId = ((await started.json()).data ?? {}).id as string
        await expect
          .poll(
            async () => {
              const response = await request.get(`${BACKEND_URL}/executions/${executionId}`)
              return (((await response.json()).data ?? {}) as { status?: string }).status ?? ''
            },
            { timeout: 90_000, message: 'the tracked run ends' },
          )
          .toMatch(/^(passed|failed|stopped)$/)
        const record = await request.get(`${BACKEND_URL}/executions/${executionId}`)
        expect(((await record.json()).data as { status: string }).status).toBe('passed')
        const text = await rawBody(
          await request.get(`${BACKEND_URL}/executions/${executionId}/variables`),
          `GET /executions/${executionId}/variables`,
        )
        expect(text).toContain(BIG)
        expect(text).toContain(HUGE)
        expect(text).not.toMatch(/e\+21/i)
      })
    } finally {
      await request.delete(`${BACKEND_URL}/workbench/session/`).catch(() => undefined)
      await request.delete(`${BACKEND_URL}/tests/${testId}`).catch(() => undefined)
    }
  })
})
