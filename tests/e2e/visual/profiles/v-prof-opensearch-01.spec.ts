/**
 * V-PROF-OPENSEARCH-01: OpenSearch profile form
 * Design Decisions: OS-15, K8SPROF-6, K8SPROF-7, K8SPROF-8, SECUI-9
 * REQ: REQ-4.7.3
 *
 * Runs in the no-data project list. Opens the Create Profile modal directly; the two tests that
 * create a profile name it uniquely and delete it in afterAll.
 *
 * Pass Criteria:
 * 1. Picking Type opensearch seeds exactly nine rows in this order: url, username, password,
 *    api_key, bearer_token, verify_ssl, ca_cert, client_cert, client_key, typed String except
 *    verify_ssl (Boolean).
 * 2. password, api_key, bearer_token and client_key are secret: their box under the lock column
 *    is ticked (every other box unticked, verify_ssl's disabled), and once stored each reopens
 *    masked, never showing its value.
 * 3. verify_ssl starts true; every string row opens blank (Edit…).
 * 4. No row is required: no required marker, no row message, and a profile with only a Name
 *    saves; the stored profile is type opensearch with verify_ssl true and nothing made up.
 * 5. No host, port, use_ssl, index or timeout row.
 * 6. The url field's Edit value sheet has no Format control; the username field's keeps it.
 */

import { test, expect, type APIRequestContext, type Locator, type Page } from '../../helpers/playwright-fixtures'
import { BACKEND_URL, E2E_ENV_NAME, ensureEnvironment } from '../../helpers/config'
import { resolveEnvironmentId } from '../../helpers/k8s-run'
import {
  openProfileCreateDialog,
  openProfileEditor,
  openProfileFieldSheet,
  selectProfileType,
} from '../../helpers/profiles'

const OPENSEARCH_FIELDS = [
  'url',
  'username',
  'password',
  'api_key',
  'bearer_token',
  'verify_ssl',
  'ca_cert',
  'client_cert',
  'client_key',
] as const

type OpenSearchField = (typeof OPENSEARCH_FIELDS)[number]

const SECRET_FIELDS: ReadonlySet<OpenSearchField> = new Set(['password', 'api_key', 'bearer_token', 'client_key'])
const STRING_FIELDS = OPENSEARCH_FIELDS.filter((field) => field !== 'verify_ssl')

/** The block's own per-request rows and the retired connection rows stay off the profile (OS-15). */
const ABSENT_FIELDS = ['host', 'port', 'use_ssl', 'index', 'timeout']

/** The empty-string preview the shared ValueField renders. */
const EMPTY_PREVIEW = 'Edit…'
const CREATE_NOTE = 'Create is disabled: the settings have errors'
const MASK = '•'.repeat(8)
const STORED_URL = 'https://opensearch.example.com:9200'

/** Test-only values for the masked-secrets profile; none reaches a real cluster. */
const STORED_SECRETS: Record<string, string> = {
  password: 'vprof-os-password-4c1e',
  api_key: 'vprof-os-api-key-9b27',
  bearer_token: 'vprof-os-bearer-51d0',
  client_key: 'vprof-os-client-key-e83a',
}

const paramRows = (dialog: Locator): Locator => dialog.locator('tbody tr[data-parameter-id]')

const row = (dialog: Locator, field: OpenSearchField): Locator =>
  paramRows(dialog).nth(OPENSEARCH_FIELDS.indexOf(field))

const preview = (dialog: Locator, field: OpenSearchField): Locator =>
  row(dialog, field).locator('[data-testid^="param-edit-value-"] span.truncate')

const secretBox = (dialog: Locator, field: OpenSearchField): Locator =>
  row(dialog, field).locator('input[aria-label="Mark as secret"]')

const createButton = (dialog: Locator): Locator => dialog.getByRole('button', { name: 'Create', exact: true })

const uniqueName = (label: string): string =>
  `V-PROF-OPENSEARCH-01 ${label} ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

async function renderedNames(dialog: Locator): Promise<string[]> {
  return dialog
    .locator('textarea[aria-label="Parameter name"]')
    .evaluateAll((els) => els.map((el) => (el as HTMLTextAreaElement).value))
}

async function openOpenSearchForm(page: Page): Promise<Locator> {
  const dialog = await openProfileCreateDialog(page)
  await selectProfileType(page, dialog, 'opensearch', OPENSEARCH_FIELDS.length)
  return dialog
}

async function deleteProfile(request: APIRequestContext, profileId: string): Promise<void> {
  const response = await request.delete(`${BACKEND_URL}/profiles/${profileId}`)
  expect([204, 404], `DELETE /profiles/${profileId} answered ${response.status()}`).toContain(response.status())
}

const createdProfiles: string[] = []

test.describe('V-PROF-OPENSEARCH-01: opensearch profile form', () => {
  test.beforeEach(async ({ page }) => {
    // The create dialog opens only once an environment exists.
    await ensureEnvironment(page.request)
    await page.goto('/')
    await page.evaluate(() => localStorage.clear())
  })

  test.afterAll(async ({ request }) => {
    for (const profileId of createdProfiles.splice(0)) await deleteProfile(request, profileId)
  })

  test('S1: nine rows in order with their types, and no host, port, use_ssl, index or timeout row (OS-15, K8SPROF-7, K8SPROF-8)', async ({
    page,
  }) => {
    const dialog = await openOpenSearchForm(page)

    await expect(dialog.locator('[data-testid="type-selector"]')).toHaveText(/opensearch/)
    expect(await renderedNames(dialog)).toEqual([...OPENSEARCH_FIELDS])

    const types = await dialog
      .locator('select[aria-label="Parameter type"]')
      .evaluateAll((els) => els.map((el) => (el as HTMLSelectElement).selectedOptions[0]?.textContent ?? ''))
    expect(types).toEqual(OPENSEARCH_FIELDS.map((field) => (field === 'verify_ssl' ? 'Boolean' : 'String')))

    const rendered = await renderedNames(dialog)
    for (const absent of ABSENT_FIELDS) {
      expect(rendered, `${absent} must not be a profile row`).not.toContain(absent)
    }
  })

  test('S2: password, api_key, bearer_token and client_key are ticked under the lock column (OS-15, SECUI-9)', async ({
    page,
  }) => {
    const dialog = await openOpenSearchForm(page)

    const lockHeader = dialog.locator('thead th').nth(2)
    await expect(lockHeader.locator('svg.lucide-lock'), 'the secret column is headed by the lock glyph').toHaveCount(1)
    for (const field of OPENSEARCH_FIELDS) {
      await expect(
        row(dialog, field).locator('td').nth(2).locator('input[aria-label="Mark as secret"]'),
        `${field}: its secret box sits under the lock`,
      ).toHaveCount(1)
    }

    expect(
      await dialog
        .locator('input[aria-label="Mark as secret"]')
        .evaluateAll((els) => els.map((el) => (el as HTMLInputElement).checked)),
    ).toEqual(OPENSEARCH_FIELDS.map((field) => SECRET_FIELDS.has(field)))
    await expect(secretBox(dialog, 'verify_ssl')).toBeDisabled()
    await expect(secretBox(dialog, 'verify_ssl')).not.toBeChecked()
  })

  test('S3: verify_ssl starts true and every string row opens blank (OS-15, K8SPROF-6)', async ({ page }) => {
    const dialog = await openOpenSearchForm(page)

    const verifySsl = row(dialog, 'verify_ssl')
    await expect(verifySsl.locator('[data-testid="scalar-edit-bool-true"]')).toHaveAttribute('aria-pressed', 'true')
    await expect(verifySsl.locator('[data-testid="scalar-edit-bool-false"]')).toHaveAttribute('aria-pressed', 'false')

    for (const field of STRING_FIELDS) {
      await expect(preview(dialog, field), `${field} opens blank`).toHaveText(EMPTY_PREVIEW)
    }
  })

  test('S4: no row is required, and a Name alone creates the profile (OS-15, K8SPROF-6)', async ({ page }) => {
    const dialog = await openOpenSearchForm(page)
    const table = dialog.locator('table').first()

    await expect(table.getByText('*'), 'no required marker on any row').toHaveCount(0)
    await expect(table.locator('[aria-required="true"]'), 'no row is marked required').toHaveCount(0)
    await expect(dialog.locator('[data-testid^="param-value-error-"]'), 'no row message').toHaveCount(0)
    await expect(createButton(dialog)).toBeDisabled()
    await expect(dialog.locator('[data-testid="save-blocked-note"]')).toHaveText(CREATE_NOTE)

    const name = uniqueName('name only')
    await dialog.locator('#name').fill(name)
    await expect(createButton(dialog)).toBeEnabled()
    await expect(dialog.locator('[data-testid="save-blocked-note"]')).toHaveCount(0)

    const created = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' && new URL(response.url()).pathname.endsWith('/profiles'),
    )
    await createButton(dialog).click()
    const response = await created
    const body = await response.json()
    expect(response.status(), `POST /profiles answered ${JSON.stringify(body)}`).toBe(201)
    const profileId = String((body.data ?? body).id)
    createdProfiles.push(profileId)
    await expect(dialog).toBeHidden()

    const stored = (await (await page.request.get(`${BACKEND_URL}/profiles/${profileId}`)).json()).data
    expect(stored.type).toBe('opensearch')
    const configs = Object.values(stored.environment_values ?? {}) as Array<Record<string, unknown>>
    expect(configs.length, 'the profile stores values per environment').toBeGreaterThan(0)
    for (const config of configs) {
      expect(config.verify_ssl, 'verify_ssl keeps its starting value').toBe(true)
      for (const field of STRING_FIELDS.filter((f) => !SECRET_FIELDS.has(f))) {
        expect(['', null, undefined], `${field} stays not provided`).toContain(config[field])
      }
    }

    // Reopened: a secret that holds no value is a blank row, not a masked one (VMGR-87, SECUI-2).
    await page.goto(`/profiles?search=${encodeURIComponent(name)}`)
    const listRow = page.locator('[data-testid="profile-row"]', { hasText: name })
    await expect(listRow).toBeVisible({ timeout: 15_000 })
    await listRow.locator('[data-testid="action-edit"]').click()
    const edit = page.locator('[role="dialog"]').first()
    await expect(paramRows(edit)).toHaveCount(OPENSEARCH_FIELDS.length)
    expect(await renderedNames(edit)).toEqual([...OPENSEARCH_FIELDS])
    await expect(edit.locator('[data-testid^="param-value-error-"]')).toHaveCount(0)
    await expect(row(edit, 'verify_ssl').locator('[data-testid="scalar-edit-bool-true"]')).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    const secretsLast = [...STRING_FIELDS].sort((a, b) => Number(SECRET_FIELDS.has(a)) - Number(SECRET_FIELDS.has(b)))
    for (const field of secretsLast) {
      await expect(
        row(edit, field).getByRole('button', { name: 'Edit protected value' }),
        `${field} holds no value, so nothing is masked`,
      ).toHaveCount(0)
      await expect(preview(edit, field), `${field} reopens blank`).toHaveText(EMPTY_PREVIEW)
    }
  })

  test('S5: the url editor has no Format control, the username editor keeps it', async ({ page }) => {
    const dialog = await openOpenSearchForm(page)

    const urlSheet = await openProfileFieldSheet(page, dialog, 'url')
    await expect(urlSheet.locator('.cm-content').first(), 'the url sheet is a text editor').toBeVisible()
    await expect(urlSheet.locator('[data-testid="format-dropdown"]'), 'url takes plain text only').toHaveCount(0)
    await urlSheet.locator('[data-testid="value-editor-cancel-button"]').click()
    await expect(urlSheet).toBeHidden()

    const usernameSheet = await openProfileFieldSheet(page, dialog, 'username')
    await expect(usernameSheet.locator('[data-testid="format-dropdown"]'), 'a plain string field keeps the Format menu').toHaveCount(1)
    await usernameSheet.locator('[data-testid="value-editor-cancel-button"]').click()
    await expect(usernameSheet).toBeHidden()
  })

  test('S6: a stored secret reopens masked and never shows its value (SECUI-9)', async ({ page }) => {
    const environmentId = await resolveEnvironmentId(page.request)
    const name = uniqueName('masked')
    const created = await page.request.post(`${BACKEND_URL}/profiles`, {
      data: {
        name,
        type: 'opensearch',
        tags: [],
        environment_values: {
          [environmentId]: {
            url: STORED_URL,
            username: '',
            password: STORED_SECRETS.password,
            api_key: STORED_SECRETS.api_key,
            bearer_token: STORED_SECRETS.bearer_token,
            verify_ssl: true,
            ca_cert: '',
            client_cert: '',
            client_key: STORED_SECRETS.client_key,
          },
        },
      },
    })
    expect(created.ok(), `POST /profiles: ${created.status()} ${await created.text()}`).toBeTruthy()
    createdProfiles.push(String((await created.json()).data.id))

    const dialog = await openProfileEditor(page, name, E2E_ENV_NAME)
    await expect(paramRows(dialog)).toHaveCount(OPENSEARCH_FIELDS.length)
    await expect(preview(dialog, 'url')).toHaveText(`"${STORED_URL}"`)
    for (const [field, value] of Object.entries(STORED_SECRETS) as Array<[OpenSearchField, string]>) {
      const masked = row(dialog, field).getByRole('button', { name: 'Edit protected value' })
      await expect(masked, `${field} is masked`).toBeVisible()
      await expect(masked, `${field} shows the bullets`).toContainText(MASK)
      await expect(row(dialog, field).getByText(value), `${field} never shows its value`).toHaveCount(0)
    }
    await expect(dialog.getByText(/wave:enc:v1:/), 'no sealed envelope renders').toHaveCount(0)
  })
})
