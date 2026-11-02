/**
 * V-VAR-SELF-REF-FUNCTIONAL: an expression that reads itself, or closes a loop with another
 * variable, is refused in the variable's window until it is fixed.
 * Design Decisions: VMGR-106, VMGR-110
 * REQ: REQ-3.1.3.13
 *
 * Phase: functional-workflow (no run). The fixture is imported through POST /tests, which allows
 * a self-reading variable (the cycle check runs in the window and when a Test is saved); it is not
 * validated, because it holds that cycle on purpose.
 *
 * Pass Criteria:
 * 1. Editing `a` to `a + 2` and leaving the field shows
 *    `Circular reference detected for variable 'a': a -> a` and Save stays disabled.
 * 2. Editing it to `1 + 1` clears the message; Save closes the window and the row shows the source.
 * 3. Editing `c` to `b * 2` (with `b` = `c + 1`) shows
 *    `Circular reference detected for variable 'b': b -> c -> b` and Save stays disabled.
 * 4. Editing it to `3` clears the message and Save closes the window.
 */

import { randomUUID } from 'node:crypto'
import { test, expect, type Page } from '../../helpers/playwright-fixtures'
import { BACKEND_URL } from '../../helpers/config'
import { openTest } from '../../helpers/fn-seed'
import {
  expandVariableManager,
  expectWindowValue,
  openEditWindow,
  saveWindow,
  setWindowValue,
  variableRow,
  windowSaveButton,
} from '../../helpers/variable-create'
import fs from 'fs'
import path from 'path'

function loadFixture(): Record<string, unknown> {
  const fixture = JSON.parse(fs.readFileSync(path.resolve(__dirname, 'fixture.json'), 'utf-8'))
  fixture.name = `v-variable-self-ref-${randomUUID().slice(0, 8)}`
  return fixture
}

/** Give the variable a new source, expect the cycle message and a held Save, then fix it and save. */
async function refusedThenFixed(page: Page, name: string, cyclic: string, message: string, fixed: string): Promise<void> {
  const win = await openEditWindow(page, name)
  await setWindowValue(page, win, cyclic)
  const error = win.getByTestId('create-cycle-error')
  await expect(error).toHaveText(message)
  await expect(error).toHaveAttribute('role', 'alert')
  await expect(windowSaveButton(win)).toBeDisabled()
  await setWindowValue(page, win, fixed)
  await expect(error).toHaveCount(0)
  await expectWindowValue(win, fixed)
  await saveWindow(page, win)
  await expect(variableRow(page, name).locator('[data-testid^="variable-value-"]')).toHaveText(fixed)
}

test.describe('Variable self-reference cycle (V-VAR-SELF-REF-FUNCTIONAL)', () => {
  let testId = ''

  test.afterEach(async ({ request }) => {
    await request.delete(`${BACKEND_URL}/workbench/session/`).catch(() => undefined)
    if (testId) await request.delete(`${BACKEND_URL}/tests/${testId}`).catch(() => undefined)
    testId = ''
  })

  test('a self-reading source and a two-variable loop are refused until fixed', async ({ page }) => {
    const create = await page.request.post(`${BACKEND_URL}/tests`, { data: loadFixture() })
    const body = await create.json().catch(() => null)
    expect(create.ok(), `POST /tests failed: ${create.status()} - ${JSON.stringify(body)}`).toBeTruthy()
    testId = body.data?.id || body.id
    await openTest(page, testId)
    await expandVariableManager(page)

    await test.step('a variable that reads itself', async () => {
      await refusedThenFixed(
        page,
        'a',
        'a + 2',
        "Circular reference detected for variable 'a': a -> a",
        '1 + 1',
      )
    })

    await test.step('a loop closed with another variable', async () => {
      await refusedThenFixed(
        page,
        'c',
        'b * 2',
        "Circular reference detected for variable 'b': b -> c -> b",
        '3',
      )
    })
  })
})
