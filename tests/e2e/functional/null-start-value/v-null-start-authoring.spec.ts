/**
 * V-NULL-START-AUTHORING: the create window starts a new variable on its type default
 * Design Decisions: VMGR-93
 * REQ: REQ-3.1.3.20
 *
 * Phase: functional-workflow. The Test is created through POST /tests with no blocks; every
 * variable is created through the Variable Manager's create window.
 *
 * Pass Criteria:
 * 1. A variable created for each declared type with the value body never touched stores the
 *    type default the window preset, and its row reads it: blank, `0`, `0`, `[0 items]`,
 *    `{0 keys}`, `0×0 table` - never `null`.
 * 2. An untouched boolean saves the option its control showed and reads `false`.
 * 3. An untouched secret stores the string default: its row is blank, neither masked nor null.
 * 4. Saving the test succeeds: the Save control settles disabled and no
 *    "Variables Without Values" toast appears.
 * 5. The stored test (GET /tests/{id}) carries each preset value under its declared type.
 */

import { test, expect, type Page } from '../../helpers/playwright-fixtures'
import { BACKEND_URL, ensureEnvironment } from '../../helpers/config'
import { createValidTest, openTest } from '../../helpers/fn-seed'
import { SECRET_MASK } from '../../helpers/secret-canary'
import { saveBtn } from '../../helpers/workbench'
import {
  createSimpleVariable,
  expandVariableManager,
  variableRow,
} from '../../helpers/variable-create'

const OLD_REFUSAL_TOAST = 'Variables Without Values'

/** Each declared type, the default the create window presets, and the row text for it. */
const PRESETS: ReadonlyArray<{ type: string; value: unknown; row: string }> = [
  { type: 'string', value: '', row: '' },
  { type: 'integer', value: 0, row: '0' },
  { type: 'float', value: 0, row: '0' },
  { type: 'array', value: [], row: '[0 items]' },
  { type: 'map', value: {}, row: '{0 keys}' },
  { type: 'table', value: [], row: '0×0 table' },
]

function valueCell(page: Page, name: string) {
  return variableRow(page, name).locator('[data-testid^="variable-value-"]')
}

/** The stored declaration's type and value, and whether it carries a value key at all. */
function storedPair(declaration: Record<string, unknown> | undefined): Record<string, unknown> {
  expect(declaration, 'the declaration is stored').toBeTruthy()
  const stored = declaration as Record<string, unknown>
  return { type: stored.type, hasValue: 'value' in stored, value: stored.value }
}

test.describe('V-NULL-START-AUTHORING: the create window presets the type default', () => {
  test('every type is created on its preset, the panel reads it, and the stored test carries it', async ({
    page,
    request,
  }) => {
    test.setTimeout(240_000)
    await ensureEnvironment(request)
    const testId = await createValidTest(request, {
      name: `V-NULL-START-AUTHORING ${Date.now()}`,
      nodes: [],
    })
    await openTest(page, testId)
    await expandVariableManager(page)

    await test.step('NULL-START: each declared type is created on its preset with the value body untouched', async () => {
      for (const { type, row } of PRESETS) {
        await createSimpleVariable(page, `u_${type}`, { type })
        await expect(
          valueCell(page, `u_${type}`),
          `a ${type} created untouched reads its type default "${row}"`,
        ).toHaveText(row)
      }
    })

    await test.step('NULL-START: an untouched boolean saves the value its control showed', async () => {
      await createSimpleVariable(page, 'u_boolean', { type: 'boolean' })
      await expect(
        valueCell(page, 'u_boolean'),
        'the boolean control shows a chosen option, so that value is saved',
      ).toHaveText('false')
    })

    await test.step('NULL-START: an untouched secret holds the string default, neither masked nor null', async () => {
      await createSimpleVariable(page, 'u_secret', { secret: true })
      await expect(
        variableRow(page, 'u_secret').locator('[data-testid^="secret-badge-"]'),
      ).toBeVisible()
      await expect(valueCell(page, 'u_secret')).toHaveText('')
      await expect(valueCell(page, 'u_secret')).not.toHaveText(SECRET_MASK)
    })

    await test.step('NULL-START: the save is accepted - no no-value refusal', async () => {
      await expect(saveBtn(page)).toBeEnabled()
      await saveBtn(page).click()
      await expect(saveBtn(page), 'a refused save leaves the canvas dirty').toBeDisabled({
        timeout: 15_000,
      })
      await expect(
        page.locator('[data-toast]', { hasText: OLD_REFUSAL_TOAST }),
        'the no-value refusal toast must not appear',
      ).toHaveCount(0)
    })

    await test.step('NULL-START: the stored test carries each preset value under its declared type', async () => {
      const resp = await page.request.get(`${BACKEND_URL}/tests/${testId}`)
      expect(resp.ok(), `GET /tests/${testId} failed: ${resp.status()}`).toBeTruthy()
      const variables = (await resp.json()).data.variables as Record<string, Record<string, unknown>>
      for (const { type, value } of PRESETS) {
        expect(storedPair(variables[`u_${type}`]), `u_${type} stores its preset`).toEqual({
          type,
          hasValue: true,
          value,
        })
      }
      expect(storedPair(variables.u_boolean), 'u_boolean stores the value its control showed').toEqual({
        type: 'boolean',
        hasValue: true,
        value: false,
      })
      expect(variables.u_secret, 'u_secret stores the string default and its flag').toEqual({
        type: 'string',
        secret: true,
        value: '',
      })
    })
  })
})
