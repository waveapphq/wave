/**
 * V-PROFILE-DATABASE-TYPED-OPTIONS: a database profile's Driver options rows keep the type
 * picked for each of them, and a SQL block bound to the profile hands the driver those
 * types.
 * Wireframe: N/A
 * Design Decisions: SQL-14 (the database profile's fields), SQL-8 (Driver options)
 * REQ: REQ-4.7.4, REQ-4.7.10, REQ-3.4.1.6, REQ-3.1.3.19
 *
 * Pass Criteria:
 * 1. The profile form's Driver options sheet offers and keeps a type per row: the
 *    application name "2024" as text, `timeout` 16 as a whole number, `startup_params` as
 *    a map.
 * 2. The saved profile stores the field with its element types (GET /profiles/{id}).
 * 3. Reopening the profile reads every row back with its type.
 * 4. A SQL block whose connection and Driver options come from the profile connects:
 *    the server reports the application name "2024" as text and the search path the map
 *    set, and `timeout` 16 reached the driver as a number.
 * 5. Retyping `timeout` as the decimal 16.5 in the profile stores it as a float, and the
 *    bound block still connects: the decimal reaches the driver as a platform number.
 * 6. The Test and the profile are deleted after.
 *
 * Phase: functional-workflow (creates its own profile and Test, deletes both after).
 */

import { test, expect } from '../../helpers/playwright-fixtures'
import {
  BACKEND_URL,
  E2E_ENV_NAME,
  POSTGRES_PORT,
  SQL_STACK_DATABASE,
  SQL_STACK_PASSWORD,
  SQL_STACK_USER,
  SQL_TARGET_HOST,
} from '../../helpers/config'
import { openTest } from '../../helpers/fn-seed'
import { openProfileEditor, openProfileFieldSheet } from '../../helpers/profiles'
import { resolveEnvironmentId } from '../../helpers/k8s-run'
import { selectEnvironment } from '../../helpers/workbench'
import {
  deleteTest,
  expectMapRows,
  expectProbeLines,
  fillMapRows,
  importValidated,
  readFixture,
  runToken,
  saveAndCloseSheet,
  settleRun,
  substitute,
  valueSheet,
  type MapRow,
} from '../../helpers/element-types'

const OPTION_ROWS: readonly MapRow[] = [
  { key: 'application_name', text: '2024', type: 'string' },
  { key: 'timeout', text: '16', type: 'integer' },
  { key: 'startup_params', text: '{"search_path": "profile_schema, public"}', type: 'map' },
]

test.describe('V-PROFILE-DATABASE-TYPED-OPTIONS: typed profile Driver options drive the block', () => {
  let testId = ''
  let profileId = ''

  test.afterEach(async ({ request }) => {
    if (testId) await deleteTest(request, testId)
    if (profileId) await request.delete(`${BACKEND_URL}/profiles/${profileId}`).catch(() => undefined)
  })

  test('the profile form keeps each Driver options type and the bound block receives it', async ({
    page,
    request,
  }) => {
    test.setTimeout(240_000)
    const environmentId = await resolveEnvironmentId(request)
    const profile = readFixture(__dirname, 'profile-database-typed.json')
    const name = `${profile.name} ${runToken()}`
    const config = {
      ...profile.config,
      host: SQL_TARGET_HOST,
      port: Number(POSTGRES_PORT),
      database: SQL_STACK_DATABASE,
      username: SQL_STACK_USER,
      password: SQL_STACK_PASSWORD,
    }
    const created = await request.post(`${BACKEND_URL}/profiles`, {
      data: { ...profile, name, config, environment_values: { [environmentId]: config } },
    })
    expect(created.ok(), `POST /profiles: ${created.status()} ${await created.text()}`).toBeTruthy()
    profileId = (await created.json()).data.id as string

    await test.step('type the Driver options rows in the profile form and save', async () => {
      const dialog = await openProfileEditor(page, name, E2E_ENV_NAME)
      await fillMapRows(page, await openProfileFieldSheet(page, dialog, 'driver_options'), OPTION_ROWS)
      await saveAndCloseSheet(page)
      await dialog.getByRole('button', { name: /Save Changes/i }).click()
      await expect(dialog).toBeHidden({ timeout: 10_000 })
    })

    await test.step('the saved profile stores the field with its element types', async () => {
      const stored = (await (await request.get(`${BACKEND_URL}/profiles/${profileId}`)).json()).data
      expect(stored.environment_values[environmentId].driver_options).toEqual({
        type: 'map',
        secret: false,
        value: {
          application_name: '2024',
          timeout: '16',
          startup_params: '{"search_path": "profile_schema, public"}',
        },
        elementTypes: { application_name: 'string', timeout: 'integer', startup_params: 'map' },
      })
    })

    await test.step('reopening the profile reads every row type back', async () => {
      const dialog = await openProfileEditor(page, name, E2E_ENV_NAME)
      await expectMapRows(await openProfileFieldSheet(page, dialog, 'driver_options'), OPTION_ROWS)
      await valueSheet(page).locator('[data-testid="value-editor-cancel-button"]').click()
      await expect(valueSheet(page)).toBeHidden()
    })

    await test.step('the bound block hands the driver each declared type', async () => {
      testId = await importValidated(
        request,
        substitute(readFixture(__dirname, 'fixture-database-typed.json'), {
          __DB_PROFILE_ID__: profileId,
          __DB_PROFILE_NAME__: name,
        }),
      )
      await openTest(page, testId)
      await selectEnvironment(page)
      await page.locator('[data-testid="run-button"]').click()
      expectProbeLines(await settleRun(page), ['PROFILE app=2024 app_is_text=True sp=profile_schema, public'])
    })

    await test.step('a decimal row from the profile reaches the driver as a platform number', async () => {
      const dialog = await openProfileEditor(page, name, E2E_ENV_NAME)
      const sheet = await openProfileFieldSheet(page, dialog, 'driver_options')
      // A type change on a held value asks first and leaves the type default (FIELD-7).
      const pill = sheet.locator('[data-testid="map-type-1"]')
      await pill.click()
      await page.getByRole('option', { name: 'float', exact: true }).click()
      const ask = page.getByRole('alertdialog').filter({ hasText: 'Change entry type?' })
      await ask.getByRole('button', { name: 'Change type', exact: true }).click()
      await expect(ask).toHaveCount(0)
      await expect(pill).toHaveText('float')
      await sheet.locator('[data-testid="map-edit-value-1"]').fill('16.5')
      await saveAndCloseSheet(page)
      await dialog.getByRole('button', { name: /Save Changes/i }).click()
      await expect(dialog).toBeHidden({ timeout: 10_000 })
      const stored = (await (await request.get(`${BACKEND_URL}/profiles/${profileId}`)).json()).data
      expect(stored.environment_values[environmentId].driver_options.value.timeout).toBe('16.5')
      expect(stored.environment_values[environmentId].driver_options.elementTypes).toEqual({
        application_name: 'string',
        timeout: 'float',
        startup_params: 'map',
      })
      await openTest(page, testId)
      await selectEnvironment(page)
      await page.locator('[data-testid="run-button"]').click()
      expectProbeLines(await settleRun(page), ['PROFILE app=2024 app_is_text=True sp=profile_schema, public'])
    })
  })
})
