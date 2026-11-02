/**
 * V-PROFILE-FIELDERR-FUNCTIONAL: field-level save errors on the Create Profile modal.
 * Wireframe: N/A (the profile modal follows the rows-and-note rule of the SQL config
 *   modal's field errors)
 * Design Decisions: FIELDERR-1, FIELDERR-2, FIELDERR-3, K8SPROF-6, SQL-14
 * REQ: REQ-4.7.4, REQ-4.7.10
 *
 * A profile field is never required, so the modal flags only its Name and a value that is
 * present but wrong, such as a port out of range. The Type picked here is database, whose
 * port is the one bounded field (1 to 65535).
 *
 * Pass Criteria:
 * 1. Opening Create Profile and picking a Type shows no Name message.
 * 2. Typing in Name, clearing it and leaving the field shows `Name is required` under Name
 *    and marks it invalid; typing a Name again lifts the message.
 * 3. A port of 70000 shows `port must be between 1 and 65535` under the port field at once,
 *    before the field is left, and marks the field invalid.
 * 4. The message never moves the field: the port field, its name and its type keep their x
 *    and y, the message sits below the field and the row grows downward.
 * 5. Create is disabled and the note under it is the generic
 *    `Create is disabled: the settings have errors`.
 * 6. Fixing the port lifts the message and the note and enables Create; clearing the port
 *    keeps Create enabled.
 * 7. A database profile with only a Name and every field left as it opened creates, and GET
 *    of the profile shows it persisted with the fields empty (the declared starting values
 *    of verify_ssl and driver_options aside).
 * 8. Reopening that profile flags nothing: no field message and no note under Save.
 * 9. Every profile the spec creates is deleted and gone afterwards.
 *
 * Run: ./scripts/e2e-targeted-local.sh functional/profile-field-errors/v-profile-field-errors-functional.spec.ts
 */

import { test, expect, type Locator, type Page } from '../../helpers/playwright-fixtures'
import { BACKEND_URL, ensureEnvironment } from '../../helpers/config'
import { DATABASE_PROFILE_FIELDS, openDatabaseProfileForm } from '../../helpers/profiles'
import { SECRET_MASK } from '../../helpers/secret-canary'

const NAME_REQUIRED = 'Name is required'
const PORT_MESSAGE = 'port must be between 1 and 65535'
const CREATE_NOTE = 'Create is disabled: the settings have errors'

const rows = (dialog: Locator): Locator => dialog.locator('tbody tr[data-parameter-id]')

/** The port row, asserted by the name it shows so a reordered form fails here. */
async function portRow(dialog: Locator): Promise<Locator> {
  const row = rows(dialog).nth(DATABASE_PROFILE_FIELDS.indexOf('port'))
  await expect(row.locator('textarea[aria-label="Parameter name"]')).toHaveValue('port')
  return row
}

const createButton = (dialog: Locator): Locator =>
  dialog.getByRole('button', { name: 'Create', exact: true })

function uniqueName(): string {
  return `FieldErr DB ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

async function box(locator: Locator): Promise<{ x: number; y: number; width: number; height: number }> {
  const measured = await locator.boundingBox()
  expect(measured, 'the element must be laid out').not.toBeNull()
  return measured!
}

/** The id of every profile the store lists under this exact name. */
async function profileIdsNamed(page: Page, name: string): Promise<string[]> {
  const resp = await page.request.get(`${BACKEND_URL}/profiles?search=${encodeURIComponent(name)}`)
  const body = await resp.json().catch(() => null)
  const listed = (Array.isArray(body) ? body : (body?.data ?? [])) as Array<{ id: string; name?: string }>
  return listed.filter((p) => p.name === name).map((p) => p.id)
}

async function deleteProfilesNamed(page: Page, name: string): Promise<void> {
  for (const id of await profileIdsNamed(page, name)) {
    await page.request.delete(`${BACKEND_URL}/profiles/${id}`).catch(() => {})
  }
}

test.describe('V-PROFILE-FIELDERR-FUNCTIONAL', () => {
  test.beforeEach(async ({ page }) => {
    // The create dialog refuses to open until at least one environment exists.
    await ensureEnvironment(page.request)
  })

  test('Name is flagged only once it is left blank, never on picking a Type', async ({ page }) => {
    const dialog = await openDatabaseProfileForm(page)
    const name = dialog.locator('#name')
    const nameMessage = dialog.getByText(NAME_REQUIRED, { exact: true })

    await test.step('picking a Type shows no Name message', async () => {
      await expect(nameMessage).toHaveCount(0)
      await expect(name).not.toHaveAttribute('aria-invalid', 'true')
    })

    await test.step('typing, clearing and leaving Name shows the message', async () => {
      await name.fill('x')
      await name.fill('')
      await name.press('Tab')
      await expect(nameMessage).toBeVisible()
      await expect(name).toHaveAttribute('aria-invalid', 'true')
      await expect(name).toHaveAccessibleDescription(NAME_REQUIRED)
    })

    await test.step('typing a Name lifts the message', async () => {
      await name.fill(uniqueName())
      await expect(nameMessage).toHaveCount(0)
      await expect(name).not.toHaveAttribute('aria-invalid', 'true')
    })
  })

  test('an out-of-range port is flagged under the field at once and blocks Create', async ({
    page,
  }) => {
    const dialog = await openDatabaseProfileForm(page)
    await dialog.locator('#name').fill(uniqueName())
    const row = await portRow(dialog)
    const port = row.locator('[data-testid="scalar-edit-input"]')
    const message = row.locator('[data-testid^="param-value-error-"]')
    const note = dialog.locator('[data-testid="save-blocked-note"]')

    await expect(createButton(dialog)).toBeEnabled()
    await expect(note).toHaveCount(0)
    const before = {
      port: await box(port),
      name: await box(row.locator('textarea[aria-label="Parameter name"]')),
      type: await box(row.locator('select[aria-label="Parameter type"]')),
      row: await box(row),
    }

    await test.step('70000 shows the bound message under the port field before leaving it', async () => {
      await port.fill('70000')
      await expect(port).toBeFocused()
      await expect(message).toHaveText(PORT_MESSAGE)
      await expect(port).toHaveAttribute('aria-invalid', 'true')
      await expect(port).toHaveAccessibleDescription(PORT_MESSAGE)
    })

    await test.step('the message never moves the field; the row grows downward', async () => {
      const after = {
        port: await box(port),
        name: await box(row.locator('textarea[aria-label="Parameter name"]')),
        type: await box(row.locator('select[aria-label="Parameter type"]')),
        row: await box(row),
      }
      for (const cell of ['port', 'name', 'type'] as const) {
        expect(after[cell].x, `${cell} moved sideways`).toBeCloseTo(before[cell].x, 0)
        expect(after[cell].y, `${cell} moved up or down`).toBeCloseTo(before[cell].y, 0)
      }
      expect(after.row.y).toBeCloseTo(before.row.y, 0)
      expect(after.row.height).toBeGreaterThan(before.row.height)
      const shown = await box(message)
      expect(shown.y).toBeGreaterThanOrEqual(after.port.y + after.port.height)
      expect(shown.y + shown.height).toBeLessThanOrEqual(after.row.y + after.row.height)
    })

    await test.step('Create is disabled and the note stays generic', async () => {
      await expect(createButton(dialog)).toBeDisabled()
      await expect(note).toHaveText(CREATE_NOTE)
    })

    await test.step('fixing the port lifts the message and enables Create', async () => {
      await port.fill('5432')
      await expect(message).toHaveCount(0)
      await expect(port).not.toHaveAttribute('aria-invalid', 'true')
      await expect(note).toHaveCount(0)
      await expect(createButton(dialog)).toBeEnabled()
    })

    await test.step('an empty port is not required', async () => {
      await port.fill('')
      await expect(message).toHaveCount(0)
      await expect(createButton(dialog)).toBeEnabled()
    })
  })

  test('a database profile with only a Name creates, persists empty and reopens clean', async ({
    page,
  }) => {
    const profileName = uniqueName()
    try {
      const dialog = await openDatabaseProfileForm(page)
      await dialog.locator('#name').fill(profileName)

      await test.step('Create is enabled with every field left as it opened', async () => {
        await expect(dialog.locator('[data-testid^="param-value-error-"]')).toHaveCount(0)
        await expect(dialog.locator('[data-testid="save-blocked-note"]')).toHaveCount(0)
        await createButton(dialog).click()
        await expect(dialog).toBeHidden({ timeout: 10_000 })
      })

      await test.step('GET of the profile shows it persisted with the fields empty', async () => {
        const ids = await profileIdsNamed(page, profileName)
        expect(ids, `profile "${profileName}" was not created`).toHaveLength(1)
        const resp = await page.request.get(`${BACKEND_URL}/profiles/${ids[0]}`)
        expect(resp.ok(), `GET /profiles/{id} failed: ${resp.status()}`).toBeTruthy()
        const body = await resp.json()
        const stored = (body.data ?? body) as {
          name: string
          type: string
          environment_values: Record<string, Record<string, unknown>>
        }
        expect(stored.name).toBe(profileName)
        expect(stored.type).toBe('database')
        const environments = Object.values(stored.environment_values)
        expect(environments.length).toBeGreaterThan(0)
        for (const config of environments) {
          const shown = JSON.stringify(config)
          for (const field of ['host', 'database', 'username', 'ca_cert', 'client_cert']) {
            expect(config[field], `${field} in ${shown}`).toBe('')
          }
          expect(config.port, `an empty port stays unset, never zero (K8SPROF-6): ${shown}`).toBeNull()
          // The API masks every secret field, so an unset one reads as empty or as the mask.
          for (const field of ['password', 'client_key']) {
            expect(['', SECRET_MASK], `${field}: ${shown}`).toContain(config[field])
          }
          expect(config.verify_ssl, shown).toBe(true)
          expect(config.driver_options, shown).toEqual({})
        }
      })

      await test.step('reopening the profile flags nothing', async () => {
        await page.goto(`/profiles?search=${encodeURIComponent(profileName)}`)
        const listed = page.locator('[data-testid="profile-row"]', { hasText: profileName })
        await expect(listed).toBeVisible({ timeout: 10_000 })
        await listed.locator('[data-testid="action-edit"]').click()
        const edit = page.locator('[role="dialog"]').first()
        await expect(edit.getByText('Edit Profile', { exact: true })).toBeVisible()
        await expect(rows(edit)).toHaveCount(DATABASE_PROFILE_FIELDS.length)
        const row = await portRow(edit)
        await expect(row.locator('select[aria-label="Parameter type"]')).toHaveValue('integer')
        await expect(row.locator('[data-testid="scalar-edit-input"]')).toHaveValue('')
        await expect(edit.locator('[data-testid^="param-value-error-"]')).toHaveCount(0)
        await expect(edit.locator('[data-testid="save-blocked-note"]')).toHaveCount(0)
        await edit.getByRole('button', { name: 'Cancel', exact: true }).click()
        await expect(edit).toBeHidden()
      })
    } finally {
      await deleteProfilesNamed(page, profileName)
    }

    expect(await profileIdsNamed(page, profileName), 'the profile outlived its test').toEqual([])
  })
})
