/**
 * V-PROF-VALUE-ELEMENT-TYPES: a custom profile's map field keeps the type picked for
 * every entry - in the saved profile, after reopening, and in an expression that reads it.
 * REQ: REQ-4.7.4, REQ-4.7.10, REQ-3.1.3.19, REQ-3.1.3.14
 *
 * Pass Criteria:
 * 1. The profile form's map sheet offers and keeps every element type.
 * 2. The saved profile stores the field's exact text with its element types
 *    (GET /profiles/{id}).
 * 3. Reopening the profile reads every row back with its type.
 * 4. A Log bound to the profile reads every entry as its declared type.
 *
 * Phase: functional-workflow (creates its own profile and Test, deletes both after).
 */

import { test, expect } from '../../helpers/playwright-fixtures'
import { BACKEND_URL, E2E_ENV_NAME } from '../../helpers/config'
import { openTest } from '../../helpers/fn-seed'
import { resolveEnvironmentId } from '../../helpers/k8s-run'
import { openProfileEditor, openProfileFieldSheet } from '../../helpers/profiles'
import { selectEnvironment } from '../../helpers/workbench'
import {
  MAP_ROWS,
  deleteTest,
  expectMapRows,
  expectProbeLines,
  fillMapRows,
  importValidated,
  mapElementTypes,
  mapProbe,
  mapProbeLine,
  readFixture,
  runToken,
  saveAndCloseSheet,
  settleRun,
  storedMap,
  substitute,
  valueSheet,
} from '../../helpers/element-types'

test.describe('V-PROF-VALUE-ELEMENT-TYPES: a custom profile map keeps its element types', () => {
  let testId = ''
  let profileId = ''

  test.afterEach(async ({ request }) => {
    if (testId) await deleteTest(request, testId)
    if (profileId) await request.delete(`${BACKEND_URL}/profiles/${profileId}`).catch(() => undefined)
  })

  test('typed map entries persist and reach an expression', async ({ page, request }) => {
    test.setTimeout(240_000)
    const environmentId = await resolveEnvironmentId(request)
    const name = `PVET ${runToken()}`
    const created = await request.post(`${BACKEND_URL}/profiles`, {
      data: {
        name,
        type: 'custom',
        tags: [],
        environment_values: { [environmentId]: { m: { type: 'map', secret: false, value: {} } } },
      },
    })
    expect(created.ok(), `POST /profiles: ${created.status()} ${await created.text()}`).toBeTruthy()
    profileId = (await created.json()).data.id as string

    await test.step('type the map rows in the profile form and save', async () => {
      const dialog = await openProfileEditor(page, name, E2E_ENV_NAME)
      await fillMapRows(page, await openProfileFieldSheet(page, dialog, 'm'), MAP_ROWS)
      await saveAndCloseSheet(page)
      await dialog.getByRole('button', { name: /Save Changes/i }).click()
      await expect(dialog).toBeHidden({ timeout: 10_000 })
    })

    await test.step('the saved profile stores exact text and every element type', async () => {
      const stored = (await (await request.get(`${BACKEND_URL}/profiles/${profileId}`)).json()).data
      expect(stored.environment_values[environmentId].m).toEqual({
        type: 'map',
        secret: false,
        value: storedMap(),
        elementTypes: mapElementTypes(),
      })
    })

    await test.step('reopening the profile reads every row type back', async () => {
      const dialog = await openProfileEditor(page, name, E2E_ENV_NAME)
      await expectMapRows(await openProfileFieldSheet(page, dialog, 'm'), MAP_ROWS)
      await valueSheet(page).locator('[data-testid="value-editor-cancel-button"]').click()
      await expect(valueSheet(page)).toBeHidden()
    })

    await test.step('a Log bound to the profile reads every entry as its declared type', async () => {
      testId = await importValidated(
        request,
        substitute(readFixture(__dirname, 'element-types-fixture.json'), {
          __MAP_PROBE__: mapProbe('PROF', 'prof.m'),
          __PROFILE_ID__: profileId,
          __PROFILE_NAME__: name,
        }),
      )
      await openTest(page, testId)
      await selectEnvironment(page)
      await page.locator('[data-testid="run-button"]').click()
      expectProbeLines(await settleRun(page), [mapProbeLine('PROF')])
    })
  })
})
