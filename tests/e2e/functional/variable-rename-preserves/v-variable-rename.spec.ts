/**
 * V-VAR-RENAME-PRESERVES-FUNCTIONAL: renaming a list variable in its window keeps its value
 * Design Decisions: VMGR-106, VMGR-108
 * REQ: REQ-3.1.3.11
 *
 * Phase: functional-workflow (imports its own fixture, validated with zero errors).
 *
 * Pass Criteria:
 * 1. The pencil on `colors` (array `["red", "green", "blue"]`) opens its window; only the Name
 *    changes to `shades`; Save closes the window.
 * 2. The row is renamed and no `colors` row is left.
 * 3. The saved Test holds `shades` as an array `["red", "green", "blue"]` and no `colors`.
 * 4. After a reload the `shades` window still shows `["red", "green", "blue"]`.
 */

import { test, expect } from '../../helpers/playwright-fixtures'
import { BACKEND_URL } from '../../helpers/config'
import { importValidateAndNavigate } from '../../helpers/fixture-import'
import { openTest } from '../../helpers/fn-seed'
import {
  cancelWindow,
  expandVariableManager,
  expectWindowValue,
  openEditWindow,
  renameInWindow,
  saveWindow,
  variableRow,
} from '../../helpers/variable-create'
import { saveTest } from '../../helpers/workbench'
import fs from 'fs'
import path from 'path'

const COLORS_TEXT = '["red", "green", "blue"]'

function loadFixture(): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(path.resolve(__dirname, 'fixture.json'), 'utf-8'))
}

test.describe('Variable rename preserves value (V-VAR-RENAME-PRESERVES-FUNCTIONAL)', () => {
  test('a rename-only save of a list keeps the value through the Test save and a reload', async ({ page }) => {
    test.setTimeout(120_000)
    const testId = await importValidateAndNavigate(page, loadFixture())
    await expandVariableManager(page)

    await test.step('only the name changes in the window', async () => {
      const win = await openEditWindow(page, 'colors')
      await expectWindowValue(win, COLORS_TEXT)
      await renameInWindow(win, 'shades')
      await saveWindow(page, win)
      await expect(variableRow(page, 'shades')).toBeVisible()
      await expect(variableRow(page, 'colors')).toHaveCount(0)
    })

    await test.step('the saved Test holds the list under the new name', async () => {
      await saveTest(page)
      const fetched = await page.request.get(`${BACKEND_URL}/tests/${testId}`)
      expect(fetched.ok()).toBeTruthy()
      const variables = (await fetched.json()).data.variables
      expect(variables).toHaveProperty('shades')
      expect(variables).not.toHaveProperty('colors')
      expect(variables.shades.type).toBe('array')
      expect(variables.shades.value).toEqual(['red', 'green', 'blue'])
    })

    await test.step('after a reload the window shows the same list', async () => {
      await openTest(page, testId)
      await expandVariableManager(page)
      await expect(variableRow(page, 'colors')).toHaveCount(0)
      const win = await openEditWindow(page, 'shades')
      await expectWindowValue(win, COLORS_TEXT)
      await cancelWindow(page, win)
    })
  })
})
