/**
 * V-PROF-DATABASE-01: Database profile form
 * Design Decisions: SQL-14, K8SPROF-6, K8SPROF-7, K8SPROF-8, FIELDERR-1, FIELDERR-3
 * REQ: REQ-5.1.4
 *
 * Runs in the no-data project list. Opens the Create Profile modal directly;
 * the one test that creates a profile names it uniquely and deletes it.
 *
 * Pass Criteria:
 * 1. Picking Type database seeds exactly ten rows in this order: host, port,
 *    database, username, password, verify_ssl, ca_cert, client_cert,
 *    client_key, driver_options.
 * 2. The rows are typed String, Integer, String, String, String, Boolean,
 *    String, String, String, Map.
 * 3. No timeout, connect timeout, failover, TLS toggle, database type, Max
 *    rows, Batch size or SQLite file row exists.
 * 4. password and client_key are the only rows marked secret; verify_ssl's
 *    secret box is disabled.
 * 5. port is an empty number box with no placeholder; verify_ssl sits on true;
 *    driver_options reads 0 pairs; every string row opens blank (Edit…).
 * 6. Picking the Type shows no Name message and no row message; Create is
 *    disabled under the generic note "Create is disabled: the settings have errors".
 * 7. Every parameter row has one height (49 px) and every value box, the port
 *    number box included, is 32 px tall like the name and type controls.
 * 8. A Name alone enables Create (no profile field is required), and the
 *    created profile keeps port as not provided: it reopens with port empty,
 *    no row message and no settings-errors note.
 */

import { test, expect, type APIRequestContext, type Locator } from '../../helpers/playwright-fixtures'
import { BACKEND_URL, ensureEnvironment } from '../../helpers/config'
import {
  DATABASE_PROFILE_FIELDS,
  openDatabaseProfileForm,
  type DatabaseProfileField,
} from '../../helpers/profiles'

const FIELD_TYPES: Record<DatabaseProfileField, string> = {
  host: 'string',
  port: 'integer',
  database: 'string',
  username: 'string',
  password: 'string',
  verify_ssl: 'boolean',
  ca_cert: 'string',
  client_cert: 'string',
  client_key: 'string',
  driver_options: 'map',
}

const TYPE_LABELS: Record<string, string> = {
  string: 'String',
  integer: 'Integer',
  boolean: 'Boolean',
  map: 'Map',
}

/** Choices and per-request bounds stay on the block (SQL-14, K8SPROF-7, K8SPROF-8). */
const ABSENT_FIELDS = [
  'timeout',
  'connect_timeout',
  'failover',
  'failover_hosts',
  'tls',
  'database_type',
  'max_rows',
  'batch_size',
  'file',
]

const SECRET_FIELDS: ReadonlySet<DatabaseProfileField> = new Set(['password', 'client_key'])

const STRING_FIELDS = DATABASE_PROFILE_FIELDS.filter((field) => FIELD_TYPES[field] === 'string')

/** The empty-string preview the shared ValueField renders. */
const EMPTY_PREVIEW = 'Edit…'
const CREATE_NOTE = 'Create is disabled: the settings have errors'
const ROW_HEIGHT_PX = 49
const CONTROL_HEIGHT_PX = 32

const paramRows = (dialog: Locator): Locator => dialog.locator('tbody tr[data-parameter-id]')

const row = (dialog: Locator, field: DatabaseProfileField): Locator =>
  paramRows(dialog).nth(DATABASE_PROFILE_FIELDS.indexOf(field))

const preview = (dialog: Locator, field: DatabaseProfileField): Locator =>
  row(dialog, field).locator('[data-testid^="param-edit-value-"] span.truncate')

const portInput = (dialog: Locator): Locator =>
  row(dialog, 'port').locator('[data-testid="scalar-edit-input"]')

const rowMessages = (dialog: Locator): Locator =>
  dialog.locator('[data-testid^="param-value-error-"]')

const createButton = (dialog: Locator): Locator =>
  dialog.getByRole('button', { name: 'Create', exact: true })

async function renderedNames(dialog: Locator): Promise<string[]> {
  return dialog
    .locator('textarea[aria-label="Parameter name"]')
    .evaluateAll((els) => els.map((el) => (el as HTMLTextAreaElement).value))
}

async function deleteProfile(request: APIRequestContext, profileId: string): Promise<void> {
  const response = await request.delete(`${BACKEND_URL}/profiles/${profileId}`)
  expect([204, 404], `DELETE /profiles/${profileId} answered ${response.status()}`).toContain(
    response.status(),
  )
}

const createdProfiles: string[] = []

test.describe('V-PROF-DATABASE-01: database profile form', () => {
  test.beforeEach(async ({ page }) => {
    // The create dialog opens only once an environment exists.
    await ensureEnvironment(page.request)
    await page.goto('/')
    await page.evaluate(() => localStorage.clear())
  })

  test.afterAll(async ({ request }) => {
    for (const profileId of createdProfiles.splice(0)) await deleteProfile(request, profileId)
  })

  test('S1: ten rows in schema order with their types, and no block-only row (SQL-14, K8SPROF-7, K8SPROF-8)', async ({
    page,
  }) => {
    const dialog = await openDatabaseProfileForm(page)

    await expect(dialog.locator('[data-testid="type-selector"]')).toHaveText(/database/)
    expect(await renderedNames(dialog)).toEqual([...DATABASE_PROFILE_FIELDS])

    const types = await dialog
      .locator('select[aria-label="Parameter type"]')
      .evaluateAll((els) =>
        els.map((el) => {
          const select = el as HTMLSelectElement
          return { value: select.value, label: select.selectedOptions[0]?.textContent ?? '' }
        }),
      )
    expect(types).toEqual(
      DATABASE_PROFILE_FIELDS.map((field) => ({
        value: FIELD_TYPES[field],
        label: TYPE_LABELS[FIELD_TYPES[field]],
      })),
    )

    const rendered = await renderedNames(dialog)
    for (const absent of ABSENT_FIELDS) {
      expect(rendered, `${absent} must not be a profile row`).not.toContain(absent)
    }
    await expect(dialog.locator('table').first().getByText(/failover|timeout/i)).toHaveCount(0)
  })

  test('S2: secrets, verify_ssl, an empty port and blank starting values (SQL-14, K8SPROF-6)', async ({
    page,
  }) => {
    const dialog = await openDatabaseProfileForm(page)

    const secretBoxes = dialog.locator('input[aria-label="Mark as secret"]')
    await expect(secretBoxes).toHaveCount(DATABASE_PROFILE_FIELDS.length)
    expect(
      await secretBoxes.evaluateAll((els) => els.map((el) => (el as HTMLInputElement).checked)),
    ).toEqual(DATABASE_PROFILE_FIELDS.map((field) => SECRET_FIELDS.has(field)))
    await expect(row(dialog, 'verify_ssl').locator('input[aria-label="Mark as secret"]')).toBeDisabled()

    // Port has no default and no placeholder: blank means the database type's own port.
    await expect(portInput(dialog)).toHaveValue('')
    expect(await portInput(dialog).getAttribute('placeholder')).toBeNull()

    const verifySsl = row(dialog, 'verify_ssl')
    await expect(verifySsl.locator('[data-testid="scalar-edit-bool-true"]')).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    await expect(verifySsl.locator('[data-testid="scalar-edit-bool-false"]')).toHaveAttribute(
      'aria-pressed',
      'false',
    )

    await expect(preview(dialog, 'driver_options')).toHaveText('0 pairs')
    for (const field of STRING_FIELDS) {
      await expect(preview(dialog, field), `${field} opens blank`).toHaveText(EMPTY_PREVIEW)
    }
  })

  test('S3: no Name message after the Type pick, Create disabled under the generic note (FIELDERR-1, FIELDERR-3)', async ({
    page,
  }) => {
    const dialog = await openDatabaseProfileForm(page)

    await expect(dialog.getByText('Name is required')).toHaveCount(0)
    await expect(dialog.locator('#name')).not.toHaveAttribute('aria-invalid', 'true')
    await expect(rowMessages(dialog)).toHaveCount(0)

    await expect(createButton(dialog)).toBeDisabled()
    await expect(dialog.locator('[data-testid="save-blocked-note"]')).toHaveText(CREATE_NOTE)
  })

  test('S4: every row one height, every value box 32 px (FIELDERR-2)', async ({ page }) => {
    const dialog = await openDatabaseProfileForm(page)

    const heights = await paramRows(dialog).evaluateAll((trs) =>
      trs.map((tr) => Math.round(tr.getBoundingClientRect().height)),
    )
    expect(heights, 'every parameter row stands 49 px').toEqual(
      DATABASE_PROFILE_FIELDS.map(() => ROW_HEIGHT_PX),
    )

    const controls = await paramRows(dialog).evaluateAll((trs) =>
      trs.map((tr) => {
        const cells = tr.querySelectorAll('td')
        const height = (el: Element | null | undefined) =>
          el ? Math.round(el.getBoundingClientRect().height) : null
        return {
          name: height(cells[0]?.querySelector('textarea')),
          type: height(cells[1]?.querySelector('select')),
          value: height(
            cells[3]?.querySelector('[data-testid="scalar-edit-input"], [data-testid^="param-edit-value-"]'),
          ),
        }
      }),
    )
    for (const [index, field] of DATABASE_PROFILE_FIELDS.entries()) {
      if (field === 'verify_ssl') continue
      expect(controls[index], `${field} controls`).toEqual({
        name: CONTROL_HEIGHT_PX,
        type: CONTROL_HEIGHT_PX,
        value: CONTROL_HEIGHT_PX,
      })
    }
  })

  test('S5: a Name alone creates the profile, and port stays not provided (K8SPROF-6)', async ({
    page,
  }) => {
    const dialog = await openDatabaseProfileForm(page)
    const name = `V-PROF-DATABASE-01 ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

    await dialog.locator('#name').fill(name)
    await expect(createButton(dialog)).toBeEnabled()
    await expect(dialog.locator('[data-testid="save-blocked-note"]')).toHaveCount(0)

    const created = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        new URL(response.url()).pathname.endsWith('/profiles'),
    )
    await createButton(dialog).click()
    const response = await created
    const body = await response.json()
    expect(response.status(), `POST /profiles answered ${JSON.stringify(body)}`).toBe(201)
    const profileId = String((body.data ?? body).id)
    createdProfiles.push(profileId)
    await expect(dialog).toBeHidden()

    // Persisted: the database type with the verify_ssl default, and no port number made up.
    const stored = await page.request.get(`${BACKEND_URL}/profiles/${profileId}`)
    const profile = (await stored.json()).data
    expect(profile.type).toBe('database')
    const configs = Object.values(profile.environment_values ?? {}) as Array<Record<string, unknown>>
    expect(configs.length, 'the profile stores values per environment').toBeGreaterThan(0)
    for (const config of configs) {
      expect(config.verify_ssl).toBe(true)
      expect(typeof config.port, `port must stay not provided, got ${JSON.stringify(config.port)}`).not.toBe(
        'number',
      )
    }

    // Reopened: port is still empty, nothing is flagged and Save is not blocked.
    await page.goto(`/profiles?search=${encodeURIComponent(name)}`)
    const listRow = page.locator('[data-testid="profile-row"]', { hasText: name })
    await expect(listRow).toBeVisible({ timeout: 15_000 })
    await listRow.locator('[data-testid="action-edit"]').click()
    const edit = page.locator('[role="dialog"]').first()
    await expect(paramRows(edit)).toHaveCount(DATABASE_PROFILE_FIELDS.length)
    expect(await renderedNames(edit)).toEqual([...DATABASE_PROFILE_FIELDS])
    await expect(portInput(edit)).toHaveValue('')
    await expect(rowMessages(edit)).toHaveCount(0)
    await expect(edit.locator('[data-testid="save-blocked-note"]')).toHaveCount(0)
    await expect(row(edit, 'verify_ssl').locator('[data-testid="scalar-edit-bool-true"]')).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    await expect(preview(edit, 'driver_options')).toHaveText('0 pairs')
  })
})
