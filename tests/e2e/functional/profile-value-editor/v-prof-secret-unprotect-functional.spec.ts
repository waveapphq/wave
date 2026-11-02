/**
 * V-PROF-SECRET-UNPROTECT-FUNCTIONAL: removing secret protection empties every environment
 * Wireframe: none - the "Remove Secret Protection?" question is unchanged
 * Design Decisions: PROFILE-39
 * REQ: REQ-4.7.4, REQ-4.7.10, REQ-3.1.3.5
 *
 * A profile parameter is secret for the whole profile, while its value is kept per
 * environment. Removing the protection must therefore drop the stored value in every
 * environment, not only in the one on screen.
 *
 * Phase: functional-destructive (the test seeds and deletes its own profile and its two
 * environments over the API).
 * Run: ./scripts/e2e-targeted-local.sh functional/profile-value-editor/v-prof-secret-unprotect-functional.spec.ts
 *
 * Pass Criteria:
 * 1. Before: the secret parameter holds a value in both environments (read over the API)
 *    and shows masked in both.
 * 2. Unticking Secret asks "Remove Secret Protection?"; "Remove & Delete Value" unticks
 *    it and takes the masked field away.
 * 3. After Save and reopen the parameter is not secret and its value is empty in both
 *    environments.
 * 4. The profile read over the API holds no value for the parameter in either
 *    environment, and the parameter is not secret in either.
 * 5. The other parameters keep their own value in both environments: the plain one reads
 *    its text, the other secret one is still masked and still holds a value.
 */

import {
  test,
  expect,
  type APIRequestContext,
  type Locator,
} from '../../helpers/playwright-fixtures'
import { BACKEND_URL, ensureEnvironment } from '../../helpers/config'
import { openProfileEditor, selectProfileModalEnvironment } from '../../helpers/profiles'
import { clearPointerLock } from '../../helpers/workbench'

const MASKING_ALL_OFF = {
  run_output: false,
  test_variables: false,
  shared_variables: false,
  credential_inputs: false,
}

const PROFILE_NAME = 'PSU-unprotect'
const ENV_A = 'PSU-env-A'
const ENV_B = 'PSU-env-B'

const UNPROTECTED = 'relay_code'
const KEPT_SECRET = 'vault_pin'
const PLAIN = 'region'

// The preview of an empty text value, as the value field prints it.
const EMPTY_TEXT_PREVIEW = 'Edit…'

interface ParamSpec {
  type: string
  value: unknown
  secret?: boolean
}

const SEEDED: Record<string, Record<string, ParamSpec>> = {
  [ENV_A]: {
    [UNPROTECTED]: { type: 'string', value: 'relay-a-5t7w2', secret: true },
    [KEPT_SECRET]: { type: 'integer', value: '1357', secret: true },
    [PLAIN]: { type: 'string', value: 'eu-a' },
  },
  [ENV_B]: {
    [UNPROTECTED]: { type: 'string', value: 'relay-b-9k4c6', secret: true },
    [KEPT_SECRET]: { type: 'integer', value: '2468', secret: true },
    [PLAIN]: { type: 'string', value: 'eu-b' },
  },
}

// ---------------------------------------------------------------------------
// Backend helpers
// ---------------------------------------------------------------------------

async function findOrCreateEnvironment(request: APIRequestContext, name: string): Promise<string> {
  const existing = await request.get(`${BACKEND_URL}/environments/`)
  const body = await existing.json()
  const environments = (Array.isArray(body) ? body : (body.data ?? [])) as Array<{
    id: string
    name: string
  }>
  const found = environments.find((environment) => environment.name === name)
  if (found) return found.id
  const created = await request.post(`${BACKEND_URL}/environments/`, { data: { name } })
  expect(created.ok(), `create environment ${name}: ${created.status()}`).toBeTruthy()
  const createdBody = await created.json()
  return (createdBody.data?.id ?? createdBody.id) as string
}

async function deleteProfileByName(request: APIRequestContext, name: string): Promise<void> {
  const list = await request.get(`${BACKEND_URL}/profiles?search=${encodeURIComponent(name)}`)
  const body = await list.json().catch(() => null)
  const profiles = (Array.isArray(body) ? body : (body?.data ?? [])) as Array<{
    id: string
    name: string
  }>
  for (const profile of profiles) {
    if (profile.name === name) {
      await request.delete(`${BACKEND_URL}/profiles/${profile.id}`).catch(() => {})
    }
  }
}

/** Create a custom profile whose parameters carry { type, secret, value } per environment id. */
async function createCustomProfile(
  request: APIRequestContext,
  name: string,
  valuesByEnvironmentId: Record<string, Record<string, ParamSpec>>,
): Promise<string> {
  await deleteProfileByName(request, name)
  const environment_values: Record<string, Record<string, unknown>> = {}
  for (const [environmentId, fields] of Object.entries(valuesByEnvironmentId)) {
    const config: Record<string, unknown> = {}
    for (const [field, spec] of Object.entries(fields)) {
      config[field] = { type: spec.type, secret: !!spec.secret, value: spec.value }
    }
    environment_values[environmentId] = config
  }
  const resp = await request.post(`${BACKEND_URL}/profiles`, {
    data: { name, type: 'custom', tags: [], environment_values },
  })
  expect(resp.ok(), `create profile ${name}: ${resp.status()} ${await resp.text()}`).toBeTruthy()
  const body = await resp.json()
  return (body.data?.id ?? body.id) as string
}

interface StoredParameter {
  secret: unknown
  value: unknown
}

/** One parameter of one environment as the profile read over the API holds it. */
async function storedParameter(
  request: APIRequestContext,
  profileId: string,
  environmentId: string,
  name: string,
): Promise<StoredParameter> {
  const resp = await request.get(`${BACKEND_URL}/profiles/${profileId}`)
  expect(resp.ok(), `GET /profiles/${profileId}: ${resp.status()}`).toBeTruthy()
  const body = await resp.json()
  const entry: unknown = (body.data ?? body).environment_values?.[environmentId]?.[name]
  if (entry !== null && typeof entry === 'object' && 'value' in entry) {
    const typed = entry as { secret?: unknown; value: unknown }
    return { secret: typed.secret, value: typed.value }
  }
  return { secret: undefined, value: entry }
}

const holdsNothing = (value: unknown): boolean =>
  value === undefined || value === null || value === ''

// ---------------------------------------------------------------------------
// Profile modal helpers
// ---------------------------------------------------------------------------

async function rowNamed(dialog: Locator, name: string): Promise<Locator> {
  const rows = dialog.locator('tbody tr[data-parameter-id]')
  const total = await rows.count()
  for (let index = 0; index < total; index += 1) {
    const row = rows.nth(index)
    if ((await row.locator('[aria-label="Parameter name"]').inputValue()) === name) return row
  }
  throw new Error(`profile parameter "${name}" not found`)
}

const secretBox = (row: Locator): Locator => row.locator('input[aria-label="Mark as secret"]')

const maskedField = (row: Locator): Locator =>
  row.locator('button[aria-label="Edit protected value"]')

const editPreview = (row: Locator): Locator => row.locator('[data-testid^="param-edit-value-"]')

const environmentIds: string[] = []

test.describe('V-PROF-SECRET-UNPROTECT-FUNCTIONAL', () => {
  test.beforeAll(async ({ request }) => {
    await ensureEnvironment(request)
  })

  test.beforeEach(async ({ request }) => {
    // A stored secret shows masked only while the unmask settings are off.
    await request.put(`${BACKEND_URL}/admin/secret-masking`, { data: MASKING_ALL_OFF })
  })

  test.afterEach(async ({ request }) => {
    await deleteProfileByName(request, PROFILE_NAME)
    for (const id of environmentIds.splice(0)) {
      await request.delete(`${BACKEND_URL}/environments/${id}`).catch(() => {})
    }
  })

  test('unticking Secret empties the value in every environment, on screen and in the saved profile', async ({
    page,
    request,
  }) => {
    test.setTimeout(120_000)
    const idOf: Record<string, string> = {}
    for (const name of [ENV_A, ENV_B]) {
      idOf[name] = await findOrCreateEnvironment(request, name)
      environmentIds.push(idOf[name])
    }
    const profileId = await createCustomProfile(request, PROFILE_NAME, {
      [idOf[ENV_A]]: SEEDED[ENV_A],
      [idOf[ENV_B]]: SEEDED[ENV_B],
    })

    await test.step('before: the parameter holds a protected value in both environments', async () => {
      for (const name of [ENV_A, ENV_B]) {
        const stored = await storedParameter(request, profileId, idOf[name], UNPROTECTED)
        expect(stored.secret, `${name}: the parameter is secret`).toBe(true)
        expect(holdsNothing(stored.value), `${name}: the parameter holds a value`).toBe(false)
      }
    })

    const dialog = await openProfileEditor(page, PROFILE_NAME, ENV_B)
    await expect(maskedField(await rowNamed(dialog, UNPROTECTED))).toBeVisible()
    await selectProfileModalEnvironment(page, dialog, ENV_A)
    const row = await rowNamed(dialog, UNPROTECTED)
    await expect(maskedField(row)).toBeVisible()
    await expect(secretBox(row)).toBeChecked()

    await test.step('untick Secret on the first environment and confirm', async () => {
      await secretBox(row).click()
      const question = page
        .getByRole('alertdialog')
        .filter({ hasText: 'Remove Secret Protection?' })
      await expect(question).toBeVisible()
      await question.getByRole('button', { name: 'Remove & Delete Value', exact: true }).click()
      await expect(question).toBeHidden()
      await clearPointerLock(page)
      await expect(secretBox(row)).not.toBeChecked()
      await expect(maskedField(row)).toHaveCount(0)
    })

    await dialog.getByRole('button', { name: 'Save Changes', exact: true }).click()
    await expect(dialog).toBeHidden({ timeout: 10_000 })

    await test.step('reopen: the value is empty in both environments', async () => {
      const reopened = await openProfileEditor(page, PROFILE_NAME, ENV_A)
      for (const name of [ENV_A, ENV_B]) {
        await selectProfileModalEnvironment(page, reopened, name)
        const emptied = await rowNamed(reopened, UNPROTECTED)
        await expect(secretBox(emptied), `${name}: no longer secret`).not.toBeChecked()
        await expect(maskedField(emptied), `${name}: no masked value`).toHaveCount(0)
        await expect(editPreview(emptied), `${name}: the value is empty`).toHaveText(
          EMPTY_TEXT_PREVIEW,
        )
        await expect(
          editPreview(await rowNamed(reopened, PLAIN)),
          `${name}: the plain parameter keeps its own value`,
        ).toHaveText(`"${String(SEEDED[name][PLAIN].value)}"`)
        await expect(
          maskedField(await rowNamed(reopened, KEPT_SECRET)),
          `${name}: the other secret is still masked`,
        ).toBeVisible()
      }
    })

    await test.step('the saved profile holds no value for the parameter in either environment', async () => {
      for (const name of [ENV_A, ENV_B]) {
        const emptied = await storedParameter(request, profileId, idOf[name], UNPROTECTED)
        expect(
          holdsNothing(emptied.value),
          `${name}: the saved profile still holds ${JSON.stringify(emptied.value)}`,
        ).toBe(true)
        expect(emptied.secret, `${name}: the parameter is no longer secret`).not.toBe(true)

        const kept = await storedParameter(request, profileId, idOf[name], KEPT_SECRET)
        expect(kept.secret, `${name}: the other secret stays secret`).toBe(true)
        expect(holdsNothing(kept.value), `${name}: the other secret keeps a value`).toBe(false)

        const plain = await storedParameter(request, profileId, idOf[name], PLAIN)
        expect(plain.value, `${name}: the plain parameter keeps its own value`).toBe(
          SEEDED[name][PLAIN].value,
        )
      }
    })
  })
})
