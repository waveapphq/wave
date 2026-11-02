/**
 * V-NUMBER-PROFILES: profile number values keep the one number rule in the modal, at Save, at import and at run
 * Wireframe: N/A (the profile modal keeps its look; its row messages follow FIELDERR-1)
 * Design Decisions: PROFILE-39, FIELDERR-1, FIELDERR-2, SQL-14
 * REQ: REQ-3.1.3.14, REQ-4.7.4, REQ-4.7.10
 *
 * Every profile is named `zz-11541-s9-...` per run, lives in the shared E2E environment and is deleted
 * afterwards. `fixture-profiles.json` binds a SQL Block to a Database profile and runs `SELECT 1` against the
 * stack's PostgreSQL.
 *
 * Pass Criteria:
 * 1. In a new Database profile the Port box drops a dot (`1.9` leaves `19`, never 1); `-` shows
 *    `Enter a valid integer value` under the row and holds Create; `70000` and `0` show
 *    `port must be between 1 and 65535` and hold Create.
 * 2. A Port typed and then emptied is created as not provided: the stored Port is null, never 0.
 * 3. Through the API a Database profile with Port 70000 or 0 is refused 400
 *    `Configuration validation failed at 'config.port': must be between 1 and 65535`, with `1.9`
 *    `... 'config.port': expected integer, got string`, and a custom profile integer of 20 digits
 *    `... 'config.big': expected at most 19 digits, got 20`; nothing is stored.
 * 4. A Port typed `09473` is saved as typed, reopens as `09473`, and a Block bound to the profile connects on
 *    port 9473 (`Connected to PostgreSQL ... at <host>:9473`) and reads 1.
 * 5. In a new custom profile an Integer value takes 19 digits and drops a 20th; a Float `2.50` is saved and
 *    reopens as `2.50`.
 * 6. A custom Float stored as the whole number 2 reopens as a Float field that takes a decimal point (`2.5`);
 *    a Float stored as `0.0000001` shows `0.0000001` and takes a digit typed at its end; both save as typed.
 * 7. The Profiles Import dialog blocks a profile file whose Port is 70000 with the save's message.
 */

import fs from 'fs'
import path from 'path'
import { test, expect, type APIRequestContext, type Locator, type Page } from '../../helpers/playwright-fixtures'
import {
  BACKEND_URL,
  E2E_ENV_NAME,
  POSTGRES_PORT,
  SQL_STACK_DATABASE,
  SQL_STACK_PASSWORD,
  SQL_STACK_USER,
  SQL_TARGET_HOST,
} from '../../helpers/config'
import { runToken } from '../../helpers/element-types'
import { importValidateAndNavigate } from '../../helpers/fixture-import'
import { finishRun, resolveEnvironmentId, startRun } from '../../helpers/k8s-run'
import { setConsoleMinimumLevel } from '../../helpers/log-reader'
import { expectBlocked, expectTypedAs, importDryRun, refusalOf, typeAtEnd, typeKeys } from '../../helpers/number-entry'
import {
  openDatabaseProfileForm,
  openProfileCreateDialog,
  openProfileEditor,
  selectProfileModalEnvironment,
  selectProfileType,
} from '../../helpers/profiles'

const NINETEEN = '1234567890123456789'
const PORT_RANGE = 'port must be between 1 and 65535'
const SAVE_PORT_RANGE = "Configuration validation failed at 'config.port': must be between 1 and 65535"
const TYPED_PORT = `0${POSTGRES_PORT}`

const token = runToken()
const names = {
  emptied: `zz-11541-s9-prof-emptied-${token}`,
  refused: `zz-11541-s9-prof-refused-${token}`,
  leading: `zz-11541-s9-prof-leading-${token}`,
  custom: `zz-11541-s9-prof-custom-${token}`,
  stored: `zz-11541-s9-prof-stored-${token}`,
  imported: `zz-11541-s9-prof-imported-${token}`,
}

async function profileIdsNamed(request: APIRequestContext, name: string): Promise<string[]> {
  const response = await request.get(`${BACKEND_URL}/profiles?search=${encodeURIComponent(name)}`)
  const body = await response.json().catch(() => null)
  const listed = (Array.isArray(body) ? body : (body?.data ?? [])) as Array<{ id: string; name: string }>
  return listed.filter((profile) => profile.name === name).map((profile) => profile.id)
}

/** The values a stored profile holds in the shared E2E environment. */
async function storedValues(request: APIRequestContext, name: string): Promise<Record<string, any>> {
  const [id] = await profileIdsNamed(request, name)
  expect(id, `the profile ${name} is stored`).toBeTruthy()
  const response = await request.get(`${BACKEND_URL}/profiles/${id}`)
  expect(response.ok(), `GET /profiles/${id} answered ${response.status()}`).toBeTruthy()
  const body = await response.json()
  return (body.data ?? body).environment_values[await resolveEnvironmentId(request)]
}

async function createProfile(request: APIRequestContext, data: Record<string, unknown>): Promise<string> {
  const response = await request.post(`${BACKEND_URL}/profiles`, { data })
  expect(response.ok(), `POST /profiles answered ${response.status()} ${await response.text()}`).toBeTruthy()
  const body = await response.json()
  return (body.data?.id ?? body.id) as string
}

async function databaseProfile(name: string, port: unknown, request: APIRequestContext): Promise<Record<string, unknown>> {
  return {
    name,
    type: 'database',
    description: '',
    tags: [],
    environment_values: {
      [await resolveEnvironmentId(request)]: {
        host: SQL_TARGET_HOST,
        port,
        database: SQL_STACK_DATABASE,
        username: SQL_STACK_USER,
        password: SQL_STACK_PASSWORD,
      },
    },
  }
}

/** The modal row of the parameter `name`. */
async function rowNamed(dialog: Locator, name: string): Promise<Locator> {
  const rows = dialog.locator('tbody tr[data-parameter-id]')
  await expect(rows.first()).toBeVisible()
  const total = await rows.count()
  for (let i = 0; i < total; i++) {
    if ((await rows.nth(i).locator('[aria-label="Parameter name"]').inputValue()) === name) return rows.nth(i)
  }
  throw new Error(`profile parameter "${name}" not found`)
}

const numberBox = (row: Locator): Locator => row.locator('[data-testid="scalar-edit-input"]')
const rowMessage = (row: Locator): Locator => row.locator('[data-testid^="param-value-error-"]')
const submit = (dialog: Locator, name: 'Create' | RegExp): Locator =>
  dialog.getByRole('button', { name, exact: typeof name === 'string' })

async function submitProfile(dialog: Locator, name: 'Create' | RegExp): Promise<void> {
  await expect(submit(dialog, name)).toBeEnabled()
  await submit(dialog, name).click()
  await expect(dialog).toBeHidden({ timeout: 10_000 })
}

/** Add a custom parameter `name` of `type` and return its row. */
async function addParameter(dialog: Locator, name: string, type: string): Promise<Locator> {
  const rows = dialog.locator('tbody tr[data-parameter-id]')
  const before = await rows.count()
  await dialog.locator('[data-testid="add-parameter-btn"]').first().click()
  await expect(rows).toHaveCount(before + 1)
  const row = rows.nth(before)
  await row.locator('[aria-label="Parameter name"]').fill(name)
  await row.locator('select[aria-label="Parameter type"]').selectOption(type)
  await expect(numberBox(row)).toBeVisible()
  return row
}

async function openStoredProfile(page: Page, name: string): Promise<Locator> {
  return openProfileEditor(page, name, E2E_ENV_NAME)
}

test.describe('V-NUMBER-PROFILES: profile numbers and the one number rule', () => {
  test.afterAll(async ({ request }) => {
    for (const name of Object.values(names)) {
      for (const id of await profileIdsNamed(request, name)) {
        await request.delete(`${BACKEND_URL}/profiles/${id}`).catch(() => undefined)
      }
    }
  })

  test('a Database Port drops a dot, names unfinished and out-of-range text, and an emptied Port is not provided', async ({
    page,
    request,
  }) => {
    await resolveEnvironmentId(request)
    const dialog = await openDatabaseProfileForm(page)
    await selectProfileModalEnvironment(page, dialog, E2E_ENV_NAME)
    await dialog.locator('#name').fill(names.emptied)
    const row = await rowNamed(dialog, 'port')
    const port = numberBox(row)

    await test.step('1. 1.9 leaves 19, never 1', async () => {
      await expectTypedAs(port, '1.9', '19')
      await expect(rowMessage(row)).toHaveCount(0)
    })

    await test.step('1. "-" names unfinished text and holds Create', async () => {
      await typeKeys(port, '-')
      await expect(rowMessage(row)).toHaveText('Enter a valid integer value')
      await expect(submit(dialog, 'Create')).toBeDisabled()
    })

    for (const value of ['70000', '0']) {
      await test.step(`1. ${value} is out of range and holds Create`, async () => {
        await typeKeys(port, value)
        await expect(rowMessage(row)).toHaveText(PORT_RANGE)
        await expect(submit(dialog, 'Create')).toBeDisabled()
      })
    }

    await test.step('2. a Port typed and emptied is created as not provided', async () => {
      await typeKeys(port, '5432')
      await expect(rowMessage(row)).toHaveCount(0)
      await typeKeys(port, '')
      await expect(port).toHaveValue('')
      await expect(rowMessage(row)).toHaveCount(0)
      await submitProfile(dialog, 'Create')
      const stored = await storedValues(request, names.emptied)
      expect(stored.port, 'an emptied Port is not provided, never 0').toBeNull()
    })
  })

  test('the API refuses a Port out of range or no integer, and a custom integer of 20 digits', async ({ request }) => {
    const envId = await resolveEnvironmentId(request)
    const cases: Array<[string, Record<string, unknown>, string]> = [
      ['Port 70000', await databaseProfile(names.refused, 70000, request), SAVE_PORT_RANGE],
      ['Port 0', await databaseProfile(names.refused, 0, request), SAVE_PORT_RANGE],
      [
        'Port 1.9',
        await databaseProfile(names.refused, '1.9', request),
        "Configuration validation failed at 'config.port': expected integer, got string",
      ],
      [
        'a custom integer of 20 digits',
        {
          name: names.refused,
          type: 'custom',
          tags: [],
          environment_values: { [envId]: { big: { type: 'integer', secret: false, value: '12345678901234567890' } } },
        },
        "Configuration validation failed at 'config.big': expected at most 19 digits, got 20",
      ],
    ]
    for (const [what, data, message] of cases) {
      await test.step(`3. ${what} is refused`, async () => {
        const refusal = await refusalOf(await request.post(`${BACKEND_URL}/profiles`, { data }), `POST /profiles with ${what}`)
        expect(refusal.status).toBe(400)
        expect(refusal.message).toBe(message)
        expect(await profileIdsNamed(request, names.refused), 'nothing is stored').toEqual([])
      })
    }
  })

  test('a Port typed with a leading zero saves as typed, reopens as typed and a bound Block connects on the number', async ({
    page,
    request,
  }) => {
    test.setTimeout(180_000)
    const profileId = await createProfile(request, await databaseProfile(names.leading, 1, request))

    await test.step('4. 09473 is saved as typed and reopens as typed', async () => {
      const dialog = await openStoredProfile(page, names.leading)
      const port = numberBox(await rowNamed(dialog, 'port'))
      await expectTypedAs(port, TYPED_PORT, TYPED_PORT)
      await submitProfile(dialog, /Save Changes/i)
      expect((await storedValues(request, names.leading)).port).toBe(TYPED_PORT)
      const reopened = await openStoredProfile(page, names.leading)
      await expect(numberBox(await rowNamed(reopened, 'port'))).toHaveValue(TYPED_PORT)
      await reopened.locator('[data-testid="modal-close"]').click()
      await expect(reopened).toBeHidden()
    })

    const raw = fs
      .readFileSync(path.join(__dirname, 'fixture-profiles.json'), 'utf-8')
      .replace(/__DB_PROFILE_ID__/g, profileId)
      .replace(/__DB_PROFILE_NAME__/g, names.leading)
    const testId = await importValidateAndNavigate(page, JSON.parse(raw) as Record<string, unknown>)
    try {
      await test.step('4. the bound Block connects on 9473 and reads 1', async () => {
        await setConsoleMinimumLevel(page, 'DEBUG')
        const status = await startRun(page)
        const logs = await finishRun(page, status, 'profiles-done')
        expect(logs).toContain('profiles-done one=1')
        const connected = new RegExp(
          `^Connected to PostgreSQL \\S+.* at ${SQL_TARGET_HOST.replace(/\./g, '\\.')}:${POSTGRES_PORT}$`,
        )
        expect(logs.some((line) => connected.test(line)), logs.join('\n')).toBeTruthy()
      })
    } finally {
      await request.delete(`${BACKEND_URL}/workbench/session/`).catch(() => undefined)
      await request.delete(`${BACKEND_URL}/tests/${testId}`).catch(() => undefined)
    }
  })

  test('a custom Integer takes 19 digits only and a Float 2.50 reopens as 2.50', async ({ page, request }) => {
    await resolveEnvironmentId(request)
    const dialog = await openProfileCreateDialog(page)
    await selectProfileType(page, dialog, 'custom', 0)
    await selectProfileModalEnvironment(page, dialog, E2E_ENV_NAME)
    await dialog.locator('#name').fill(names.custom)

    await test.step('5. an Integer value takes 19 digits and drops a 20th', async () => {
      const big = await addParameter(dialog, 'big', 'integer')
      await expectTypedAs(numberBox(big), `${NINETEEN}0`, NINETEEN)
    })

    await test.step('5. a Float 2.50 is saved and reopens as typed', async () => {
      const ratio = await addParameter(dialog, 'ratio', 'float')
      await expectTypedAs(numberBox(ratio), '2.50', '2.50')
      await submitProfile(dialog, 'Create')
      const stored = await storedValues(request, names.custom)
      expect(stored.big).toMatchObject({ type: 'integer', value: NINETEEN })
      expect(stored.ratio).toMatchObject({ type: 'float', value: '2.50' })
      const reopened = await openStoredProfile(page, names.custom)
      await expect(numberBox(await rowNamed(reopened, 'big'))).toHaveValue(NINETEEN)
      await expect(numberBox(await rowNamed(reopened, 'ratio'))).toHaveValue('2.50')
      await reopened.locator('[data-testid="modal-close"]').click()
      await expect(reopened).toBeHidden()
    })
  })

  test('a Float stored as a whole number or below 1e-6 reopens as a Float that takes the keyboard', async ({
    page,
    request,
  }) => {
    const envId = await resolveEnvironmentId(request)
    await createProfile(request, {
      name: names.stored,
      type: 'custom',
      tags: [],
      environment_values: {
        [envId]: {
          whole: { type: 'float', secret: false, value: 2 },
          tiny: { type: 'float', secret: false, value: 1e-7 },
        },
      },
    })
    const dialog = await openStoredProfile(page, names.stored)

    await test.step('6. the whole number 2 reopens as a Float and takes a decimal point', async () => {
      const whole = await rowNamed(dialog, 'whole')
      await expect(whole.locator('select[aria-label="Parameter type"]')).toHaveValue('float')
      await expect(numberBox(whole)).toHaveValue('2')
      await typeAtEnd(numberBox(whole), '.5')
      await expect(numberBox(whole)).toHaveValue('2.5')
    })

    await test.step('6. 0.0000001 shows in plain digits and takes a digit at its end', async () => {
      const tiny = await rowNamed(dialog, 'tiny')
      await expect(numberBox(tiny)).toHaveValue('0.0000001')
      await typeAtEnd(numberBox(tiny), '5')
      await expect(numberBox(tiny)).toHaveValue('0.00000015')
    })

    await submitProfile(dialog, /Save Changes/i)
    const stored = await storedValues(request, names.stored)
    expect(stored.whole).toMatchObject({ type: 'float', value: '2.5' })
    expect(stored.tiny).toMatchObject({ type: 'float', value: '0.00000015' })
  })

  test('the Profiles Import dialog blocks a profile file whose Port is 70000 with the save message', async ({
    page,
    request,
  }) => {
    const text = JSON.stringify({
      name: names.imported,
      type: 'database',
      description: '',
      tags: [],
      environment_values: { [E2E_ENV_NAME]: { host: 'db.invalid', port: 70000 } },
    })
    const file = { name: 'zz-11541-s9-profile.json', mimeType: 'application/json', buffer: Buffer.from(text, 'utf-8') }
    const dryRun = await importDryRun(page, '/profiles', file, 'profiles')
    await expectBlocked(dryRun, names.imported, SAVE_PORT_RANGE)
    await expect(dryRun.dialog.locator('[data-testid="import-summary"]')).toHaveText('0 importable, 1 blocked')
    expect(await profileIdsNamed(request, names.imported), 'the dry run stores nothing').toEqual([])
  })
})
