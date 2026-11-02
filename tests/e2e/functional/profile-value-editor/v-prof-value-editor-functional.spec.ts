/**
 * V-PROF-VALUE-EDITOR-FUNCTIONAL: profile parameter values edit on the shared value bodies
 * REQ: REQ-4.7.4 (Create/Edit modal value editing), REQ-4.7.10 (per-environment values)
 *
 * The profile parameter value cell mirrors the Variable Setter: integer / float / boolean edit
 * inline; string, array, map and table open the shared "Edit value" sheet; a secret parameter
 * holding a value shows one masked control whose clear-and-edit confirm opens the editor for its
 * type. A table parameter is stored as { headers, rows }.
 *
 * Covers: per-type edit and persist, secret clear-and-edit, per-environment isolation, the
 * description save, exact number round-trip, the sheet over the modal and the string Format
 * control, an empty name blocking Save, and the list / map / table editors and the delete control.
 *
 * Phase: functional-destructive (each test seeds + deletes its own profile via API).
 * Run: ./scripts/e2e-targeted-local.sh functional/profile-value-editor/v-prof-value-editor-functional.spec.ts
 */

import { test, expect, type APIRequestContext, type Page, type Locator } from '../../helpers/playwright-fixtures'
import { BACKEND_PORT, ensureEnvironment } from '../../helpers/config'

const BACKEND = `http://localhost:${BACKEND_PORT}`

// ---------------------------------------------------------------------------
// Backend helpers (mirror profile-bugs createCustomProfile)
// ---------------------------------------------------------------------------

interface ParamSpec {
  type: string
  value: unknown
  secret?: boolean
}

async function createEnv(request: APIRequestContext, name: string): Promise<string> {
  const existing = await request.get(`${BACKEND}/environments/`)
  const body = await existing.json()
  const envs = Array.isArray(body) ? body : (body.data ?? [])
  const found = envs.find((e: { name: string }) => e.name === name)
  if (found) return found.id
  const created = await request.post(`${BACKEND}/environments/`, { data: { name } })
  expect(created.ok(), `create env ${name}: ${created.status()}`).toBeTruthy()
  const cb = await created.json()
  return cb.data?.id ?? cb.id
}

async function deleteEnv(request: APIRequestContext, id: string) {
  await request.delete(`${BACKEND}/environments/${id}`).catch(() => {})
}

async function deleteProfileByName(request: APIRequestContext, name: string) {
  // Filter by name (per_page caps at 100 server-side, so a large per_page 422s and the
  // delete silently no-ops, leaving a leftover that the next create then 409s on).
  const list = await request.get(`${BACKEND}/profiles?search=${encodeURIComponent(name)}`)
  const lb = await list.json()
  const arr = Array.isArray(lb) ? lb : (lb.data ?? [])
  for (const p of arr) {
    if (p.name === name) await request.delete(`${BACKEND}/profiles/${p.id}`).catch(() => {})
  }
}

/** Create a custom profile whose params carry the wrapped { type, secret, value }
 *  shape across one or more environments (envValues keyed by env id). */
async function createCustomProfile(
  request: APIRequestContext,
  name: string,
  envValues: Record<string, Record<string, ParamSpec>>,
): Promise<string> {
  await deleteProfileByName(request, name)
  const environment_values: Record<string, Record<string, unknown>> = {}
  for (const [envId, fields] of Object.entries(envValues)) {
    const config: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(fields)) {
      config[k] = { type: v.type, secret: !!v.secret, value: v.value }
    }
    environment_values[envId] = config
  }
  const resp = await request.post(`${BACKEND}/profiles`, {
    data: { name, type: 'custom', tags: [], environment_values },
  })
  expect(resp.ok(), `create profile ${name}: ${resp.status()} ${await resp.text()}`).toBeTruthy()
  const body = await resp.json()
  return body.data?.id ?? body.id
}

// ---------------------------------------------------------------------------
// UI helpers
// ---------------------------------------------------------------------------

/** Select an environment inside the open profile modal. The modal defaults its
 *  selectedEnvId to environments[0], which is rarely the env that carries the
 *  seeded values - so every value-reading test must select its own env first. */
async function selectModalEnv(page: Page, dialog: Locator, envName: string): Promise<void> {
  const selector = dialog.locator('[data-testid="env-selector"]')
  // The portaled env popover is the [role="dialog"] that carries a [role="listbox"]
  // (cmdk does not forward the CommandList id, so we cannot target it by id).
  const popover = page.locator('[role="dialog"]').filter({ has: page.locator('[role="listbox"]') })
  await expect(async () => {
    await selector.click()
    await expect(popover).toBeVisible({ timeout: 2000 })
  }).toPass({ timeout: 15_000 })
  await popover.locator('[role="listbox"] button').filter({ hasText: envName }).first().click()
  await expect(popover).not.toBeVisible()
}

async function openEditModal(page: Page, profileName: string, envName: string): Promise<Locator> {
  // Filter the list to the just-seeded profile by name so it is the only/first row,
  // regardless of how many other destructive-phase profiles accumulated in the DB.
  await page.goto(`/profiles?search=${encodeURIComponent(profileName)}`)
  await page.waitForSelector('[data-testid="profiles-page"]', { state: 'visible' })
  await page.waitForSelector('[data-testid="profiles-page"][aria-busy="false"]', { state: 'attached' })
  const row = page.locator('[data-testid="profile-row"]', { hasText: profileName })
  await expect(row).toBeVisible({ timeout: 10_000 })
  await row.locator('[data-testid="action-edit"]').click()
  const dialog = page.locator('[role="dialog"]').first()
  await expect(dialog).toBeVisible({ timeout: 10_000 })
  // Wait for the parameters table to render its rows.
  await expect(dialog.locator('tbody tr[data-parameter-id]').first()).toBeVisible()
  // Select the env carrying the seeded values (modal defaults to environments[0]).
  await selectModalEnv(page, dialog, envName)
  return dialog
}

/** A parameter row by its render index (rows render in stored-config key order). */
function paramRow(dialog: Locator, index: number): Locator {
  return dialog.locator('tbody tr[data-parameter-id]').nth(index)
}

function valueSheet(page: Page): Locator {
  return page.locator('[data-testid="value-editor-sheet"]')
}

async function saveProfile(dialog: Locator) {
  await dialog.getByRole('button', { name: /Save Changes/i }).click()
  await expect(dialog).toBeHidden({ timeout: 10_000 })
}

// ===========================================================================
// Suite
// ===========================================================================

test.describe('V-PROF-VALUE-EDITOR: profile value editing mirrors the Variable Setter', () => {
  test.beforeAll(async ({ request }) => {
    await ensureEnvironment(request)
  })

  // -------------------------------------------------------------------------
  // Scalars: integer / float / boolean edit INLINE; string via the sheet.
  // -------------------------------------------------------------------------
  test('scalars: string (sheet) + integer/boolean (inline) edits persist (setter parity)', async ({
    page,
    request,
  }) => {
    const env = await createEnv(request, 'PVE-env-scalars')
    const name = 'PVE-scalars'
    await createCustomProfile(request, name, {
      [env]: {
        str: { type: 'string', value: 'old-host' },
        num: { type: 'integer', value: '10' },
        flag: { type: 'boolean', value: false },
      },
    })

    const dialog = await openEditModal(page, name, "PVE-env-scalars")

    // String row (0): plain Edit-button preview shows the quoted current value.
    const strEdit = paramRow(dialog, 0).locator('[data-testid^="param-edit-value-"]')
    await expect(strEdit).toContainText('"old-host"')
    await strEdit.click()
    const sheet = valueSheet(page)
    await expect(sheet).toBeVisible()
    // Literal-only: NO Kind/Template dropdown, Format dropdown stays.
    await expect(sheet.locator('[data-testid="kind-dropdown"]')).toHaveCount(0)
    await expect(sheet.locator('[data-testid="format-dropdown"]')).toBeVisible()
    const cm = sheet.locator('.cm-content').first()
    await cm.click()
    await page.keyboard.press('ControlOrMeta+a')
    await page.keyboard.press('Delete')
    await page.keyboard.type('new-host')
    await sheet.locator('[data-testid="value-editor-save-button"]').click()
    await sheet.locator('[data-testid="value-editor-cancel-button"]').click()
    await expect(sheet).toBeHidden()
    await expect(strEdit).toContainText('"new-host"')

    // Integer row (1): inline ScalarEditBody numeric input.
    const numInput = paramRow(dialog, 1).locator('[data-testid="scalar-edit-input"]')
    await expect(numInput).toHaveValue('10')
    await numInput.fill('5432')

    // Boolean row (2): inline true/false segmented control, starts false.
    const boolTrue = paramRow(dialog, 2).locator('[data-testid="scalar-edit-bool-true"]')
    await expect(boolTrue).toHaveAttribute('aria-pressed', 'false')
    await boolTrue.click()
    await expect(boolTrue).toHaveAttribute('aria-pressed', 'true')

    await saveProfile(dialog)

    // Reopen and assert every edit persisted through save + reload.
    const reopened = await openEditModal(page, name, "PVE-env-scalars")
    await expect(reopened.locator('tbody tr[data-parameter-id]').nth(0).locator('[data-testid^="param-edit-value-"]')).toContainText('"new-host"')
    await expect(reopened.locator('tbody tr[data-parameter-id]').nth(1).locator('[data-testid="scalar-edit-input"]')).toHaveValue('5432')
    await expect(reopened.locator('tbody tr[data-parameter-id]').nth(2).locator('[data-testid="scalar-edit-bool-true"]')).toHaveAttribute('aria-pressed', 'true')

    await deleteProfileByName(request, name)
    await deleteEnv(request, env)
  })

  // -------------------------------------------------------------------------
  // Array / map / table edit via the shared sheet and persist; the table stays { headers, rows } at rest.
  // -------------------------------------------------------------------------
  test('complex: array/map/table edit via the shared sheet persist; table keeps {headers,rows}', async ({
    page,
    request,
  }) => {
    const env = await createEnv(request, 'PVE-env-complex')
    const name = 'PVE-complex'
    const profileId = await createCustomProfile(request, name, {
      [env]: {
        arr: { type: 'array', value: ['x'] },
        m: { type: 'map', value: { a: '1' } },
        tbl: { type: 'table', value: { headers: ['host', 'port'], rows: [['db.local', '5432']] } },
      },
    })

    const dialog = await openEditModal(page, name, "PVE-env-complex")
    const sheet = valueSheet(page)

    // Array row (0): preview "1 items" -> add an item via the Visual body -> "2 items".
    const arrEdit = paramRow(dialog, 0).locator('[data-testid^="param-edit-value-"]')
    await expect(arrEdit).toContainText('1 items')
    await arrEdit.click()
    await expect(sheet.locator('[data-testid="value-editor-type-badge"]')).toContainText('array')
    await sheet.locator('[data-testid="array-add-item"]').click()
    await sheet.locator('[data-testid="array-edit-input-1"]').fill('y')
    await sheet.locator('[data-testid="value-editor-save-button"]').click()
    await sheet.locator('[data-testid="value-editor-cancel-button"]').click()
    await expect(sheet).toBeHidden()
    await expect(arrEdit).toContainText('2 items')

    // Map row (1): preview "1 pairs" -> add an entry -> "2 pairs".
    const mapEdit = paramRow(dialog, 1).locator('[data-testid^="param-edit-value-"]')
    await expect(mapEdit).toContainText('1 pairs')
    await mapEdit.click()
    await expect(sheet.locator('[data-testid="value-editor-type-badge"]')).toContainText('map')
    await sheet.locator('[data-testid="map-add-entry"]').click()
    await sheet.locator('[data-testid="map-edit-key-1"]').fill('b')
    await sheet.locator('[data-testid="map-edit-value-1"]').fill('2')
    await sheet.locator('[data-testid="value-editor-save-button"]').click()
    await sheet.locator('[data-testid="value-editor-cancel-button"]').click()
    await expect(sheet).toBeHidden()
    await expect(mapEdit).toContainText('2 pairs')

    // Table row (2): preview "1 rows x 2 col" -> add a row -> "2 rows x 2 col".
    const tblEdit = paramRow(dialog, 2).locator('[data-testid^="param-edit-value-"]')
    await expect(tblEdit).toContainText('1 rows x 2 col')
    await tblEdit.click()
    await expect(sheet.locator('[data-testid="value-editor-type-badge"]')).toContainText('table')
    await sheet.locator('[data-testid="table-add-row"]').click()
    await sheet.locator('[data-testid="value-editor-save-button"]').click()
    await sheet.locator('[data-testid="value-editor-cancel-button"]').click()
    await expect(sheet).toBeHidden()
    // Soft, so the stored read-back below still runs when the cell drops the rows.
    await expect.soft(tblEdit).toContainText('2 rows x 2 col')

    await saveProfile(dialog)

    // The table is still stored as { headers, rows } (NOT row-objects) so the
    // runtime binding is unchanged. Read the persisted config straight from the API.
    const after = await request.get(`${BACKEND}/profiles/${profileId}`)
    const ab = await after.json()
    const stored = (ab.data ?? ab).environment_values?.[env]?.tbl
    const tableValue = (stored && typeof stored === 'object' && 'value' in stored ? stored.value : stored) as {
      headers?: unknown
      rows?: unknown
    }
    expect(Array.isArray(tableValue.headers), `table stored as {headers,rows}: ${JSON.stringify(stored)}`).toBeTruthy()
    expect(Array.isArray(tableValue.rows)).toBeTruthy()
    expect((tableValue.rows as unknown[]).length).toBe(2)

    // Reopen: every complex preview persisted.
    const reopened = await openEditModal(page, name, "PVE-env-complex")
    await expect(reopened.locator('tbody tr[data-parameter-id]').nth(0).locator('[data-testid^="param-edit-value-"]')).toContainText('2 items')
    await expect(reopened.locator('tbody tr[data-parameter-id]').nth(1).locator('[data-testid^="param-edit-value-"]')).toContainText('2 pairs')
    await expect(reopened.locator('tbody tr[data-parameter-id]').nth(2).locator('[data-testid^="param-edit-value-"]')).toContainText('2 rows x 2 col')

    await deleteProfileByName(request, name)
    await deleteEnv(request, env)
  })

  // -------------------------------------------------------------------------
  // The uniform masked affordance gates clear-and-edit;
  // an integer clears + edits inline, a string clears + opens the sheet; unchecking
  // secret on a valued param runs the "Remove Secret Protection?" confirm.
  // -------------------------------------------------------------------------
  test('secret: masked affordance clear-and-edit (inline int + sheet string) and unsecret confirm', async ({
    page,
    request,
  }) => {
    const env = await createEnv(request, 'PVE-env-secret')
    const name = 'PVE-secret'
    await createCustomProfile(request, name, {
      [env]: {
        snum: { type: 'integer', value: '999', secret: true },
        sstr: { type: 'string', value: 'topsecret', secret: true },
      },
    })

    const dialog = await openEditModal(page, name, "PVE-env-secret")

    // Both secret rows render the SAME uniform masked affordance (no per-type label).
    const snumMask = paramRow(dialog, 0).locator('button[aria-label="Edit protected value"]')
    const sstrMask = paramRow(dialog, 1).locator('button[aria-label="Edit protected value"]')
    await expect(snumMask).toBeVisible()
    await expect(sstrMask).toBeVisible()
    // The masked affordance shows the dot mask, never the underlying value.
    await expect(snumMask).toContainText('•')
    await expect(snumMask).not.toContainText('999')

    // Secret integer clear-and-edit: confirm clears the value and edits INLINE.
    await snumMask.click()
    const editConfirm = page.getByRole('dialog').filter({ hasText: 'Edit Protected Value?' })
    await expect(editConfirm).toBeVisible()
    await editConfirm.getByRole('button', { name: /Delete & Edit/i }).click()
    const snumInput = paramRow(dialog, 0).locator('[data-testid="scalar-edit-input"]')
    await expect(snumInput).toBeVisible()
    await expect(snumInput, 'old secret value cleared').toHaveValue('')
    await snumInput.fill('777')
    await expect(snumInput).toHaveValue('777')

    // Secret string clear-and-edit: confirm clears the value and opens the SHEET.
    await sstrMask.click()
    const editConfirm2 = page.getByRole('dialog').filter({ hasText: 'Edit Protected Value?' })
    await expect(editConfirm2).toBeVisible()
    await editConfirm2.getByRole('button', { name: /Delete & Edit/i }).click()
    const sheet = valueSheet(page)
    await expect(sheet).toBeVisible()
    await sheet.locator('.cm-content').first().click()
    await page.keyboard.type('newsecret')
    await sheet.locator('[data-testid="value-editor-save-button"]').click()
    await sheet.locator('[data-testid="value-editor-cancel-button"]').click()
    await expect(sheet).toBeHidden()
    // A value typed before the profile is saved stays visible; it masks again after the save.
    await expect(paramRow(dialog, 1).locator('[data-testid^="param-edit-value-"]')).toContainText(
      'newsecret',
    )

    await saveProfile(dialog)

    // Reopen: both params still hold a (masked) value - the edits persisted.
    const reopened = await openEditModal(page, name, "PVE-env-secret")
    await expect(reopened.locator('tbody tr[data-parameter-id]').nth(0).locator('button[aria-label="Edit protected value"]')).toBeVisible()
    await expect(reopened.locator('tbody tr[data-parameter-id]').nth(1).locator('button[aria-label="Edit protected value"]')).toBeVisible()

    // Unticking Secret on a valued param asks first (so .uncheck() would see no change); confirming clears it.
    await reopened.locator('tbody tr[data-parameter-id]').nth(0).locator('input[aria-label="Mark as secret"]').click()
    const removeConfirm = page.getByRole('alertdialog').filter({ hasText: 'Remove Secret Protection?' })
    await expect(removeConfirm).toBeVisible()
    await removeConfirm.getByRole('button', { name: /Remove & Delete Value/i }).click()
    // No longer secret + value cleared -> the inline integer editor shows empty.
    await expect(reopened.locator('tbody tr[data-parameter-id]').nth(0).locator('[data-testid="scalar-edit-input"]')).toHaveValue('')

    await deleteProfileByName(request, name)
    await deleteEnv(request, env)
  })

  // -------------------------------------------------------------------------
  // Per-environment isolation - each environment keeps its own value.
  // -------------------------------------------------------------------------
  test('per-environment: each environment keeps its own value', async ({ page, request }) => {
    const envA = await createEnv(request, 'PVE-env-A')
    const envB = await createEnv(request, 'PVE-env-B')
    const name = 'PVE-perenv'
    await createCustomProfile(request, name, {
      [envA]: { host: { type: 'string', value: 'host-A' } },
      [envB]: { host: { type: 'string', value: 'host-B' } },
    })

    const dialog = await openEditModal(page, name, 'PVE-env-A')
    const hostPreview = () => paramRow(dialog, 0).locator('[data-testid^="param-edit-value-"]')

    // Switch between the two environments and assert the value cell reflects each
    // environment's own stored value.
    for (const envName of ['PVE-env-A', 'PVE-env-B']) {
      await selectModalEnv(page, dialog, envName)
      await expect(hostPreview()).toContainText(envName === 'PVE-env-A' ? '"host-A"' : '"host-B"')
    }

    // Editing one environment must not bleed into the other.
    await selectModalEnv(page, dialog, 'PVE-env-A')
    await hostPreview().click()
    const sheet = valueSheet(page)
    await sheet.locator('.cm-content').first().click()
    await page.keyboard.press('ControlOrMeta+a')
    await page.keyboard.press('Delete')
    await page.keyboard.type('host-A-edited')
    await sheet.locator('[data-testid="value-editor-save-button"]').click()
    await sheet.locator('[data-testid="value-editor-cancel-button"]').click()
    await expect(sheet).toBeHidden()
    await expect(hostPreview()).toContainText('"host-A-edited"')

    await selectModalEnv(page, dialog, 'PVE-env-B')
    await expect(hostPreview(), 'env B value unchanged by env A edit').toContainText('"host-B"')

    await deleteProfileByName(request, name)
    await deleteEnv(request, envA)
    await deleteEnv(request, envB)
  })

  // -------------------------------------------------------------------------
  // A profile description edit persists; clearing it persists empty.
  // -------------------------------------------------------------------------
  test('description: edited description persists; cleared description persists empty', async ({
    page,
    request,
  }) => {
    const env = await createEnv(request, 'PVE-env-desc')
    const name = 'PVE-desc'
    await createCustomProfile(request, name, {
      [env]: { host: { type: 'string', value: 'h' } },
    })

    const dialog = await openEditModal(page, name, "PVE-env-desc")
    const desc = dialog.getByPlaceholder('What does this profile contain?')
    await desc.fill('Updated documentation')
    await saveProfile(dialog)

    const reopened = await openEditModal(page, name, "PVE-env-desc")
    await expect(
      reopened.getByPlaceholder('What does this profile contain?'),
      'the edited description is saved and shows on reopen',
    ).toHaveValue('Updated documentation')

    // Clearing the description must also persist (FE sends description as-is, not undefined).
    await reopened.getByPlaceholder('What does this profile contain?').fill('')
    await saveProfile(reopened)
    const reopened2 = await openEditModal(page, name, "PVE-env-desc")
    await expect(reopened2.getByPlaceholder('What does this profile contain?')).toHaveValue('')

    await deleteProfileByName(request, name)
    await deleteEnv(request, env)
  })

  // -------------------------------------------------------------------------
  // UI half: a precision-exceeding integer + float round-trip EXACT through
  // the modal (the FE keeps them as exact digit-strings, never JS Numbers).
  // -------------------------------------------------------------------------
  test('number precision (UI): >2^53 integer and >17-digit float survive save/reopen exact', async ({
    page,
    request,
  }) => {
    const env = await createEnv(request, 'PVE-env-num')
    const name = 'PVE-num'
    // 19-digit integers stay within the MAX_INTEGER_DIGITS=19 input cap while still
    // exceeding 2^53 (~16 digits) - a naive JS Number would round them.
    const BIG_INT = '1234567890123456789'
    const BIG_FLOAT = '3.14159265358979311699'
    await createCustomProfile(request, name, {
      [env]: {
        bignum: { type: 'integer', value: BIG_INT },
        bigflt: { type: 'float', value: BIG_FLOAT },
      },
    })

    const dialog = await openEditModal(page, name, "PVE-env-num")
    // Seeded values display EXACTLY (no rounding past float64 precision).
    await expect(paramRow(dialog, 0).locator('[data-testid="scalar-edit-input"]')).toHaveValue(BIG_INT)
    await expect(paramRow(dialog, 1).locator('[data-testid="scalar-edit-input"]')).toHaveValue(BIG_FLOAT)

    // Re-enter a fresh precision-exceeding integer and assert it survives save/reopen.
    const NEW_INT = '9876543210987654321'
    await paramRow(dialog, 0).locator('[data-testid="scalar-edit-input"]').fill(NEW_INT)
    await saveProfile(dialog)

    const reopened = await openEditModal(page, name, "PVE-env-num")
    await expect(reopened.locator('tbody tr[data-parameter-id]').nth(0).locator('[data-testid="scalar-edit-input"]')).toHaveValue(NEW_INT)
    await expect(reopened.locator('tbody tr[data-parameter-id]').nth(1).locator('[data-testid="scalar-edit-input"]')).toHaveValue(BIG_FLOAT)

    await deleteProfileByName(request, name)
    await deleteEnv(request, env)
  })

  // -------------------------------------------------------------------------
  // The "Edit value" sheet floats ABOVE the still-open profile modal, is
  // interactable, suppresses Kind/Template (allowTemplate=false), ESC closes only
  // the sheet, and the string Format control works (Auto detection + pretty-print).
  // -------------------------------------------------------------------------
  test('sheet-over-modal: floating sheet edits the row, no Kind dropdown, ESC closes only the sheet, Format control', async ({
    page,
    request,
  }) => {
    const env = await createEnv(request, 'PVE-env-sheet')
    const name = 'PVE-sheet'
    await createCustomProfile(request, name, {
      [env]: {
        plain: { type: 'string', value: 'plain text' },
        json: { type: 'string', value: '{"a":1}' },
      },
    })

    const consoleErrors: string[] = []
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text())
    })

    const dialog = await openEditModal(page, name, "PVE-env-sheet")

    // (a) Open the sheet from a row; it floats above the form and edits the row value.
    await paramRow(dialog, 0).locator('[data-testid^="param-edit-value-"]').click()
    const sheet = valueSheet(page)
    await expect(sheet).toBeVisible()
    await expect(dialog, 'profile modal stays open under the sheet').toBeVisible()
    // The sheet renders on top (higher stacking) - it is hit-testable / interactable.
    await sheet.locator('.cm-content').first().click()
    await page.keyboard.press('ControlOrMeta+a')
    await page.keyboard.press('Delete')
    await page.keyboard.type('typed-in-sheet')
    await sheet.locator('[data-testid="value-editor-save-button"]').click()
    await sheet.locator('[data-testid="value-editor-cancel-button"]').click()
    await expect(sheet).toBeHidden()
    await expect(paramRow(dialog, 0).locator('[data-testid^="param-edit-value-"]')).toContainText('"typed-in-sheet"')

    // (b) Profiles are literal-only: the sheet shows ONLY Format, never Kind/Template.
    await paramRow(dialog, 0).locator('[data-testid^="param-edit-value-"]').click()
    await expect(sheet).toBeVisible()
    await expect(sheet.locator('[data-testid="kind-dropdown"]')).toHaveCount(0)
    await expect(sheet.locator('[data-testid="format-dropdown"]')).toBeVisible()

    // (c) ESC closes ONLY the front-most sheet; the profile modal stays open.
    await page.keyboard.press('Escape')
    await expect(sheet).toBeHidden()
    await expect(dialog, 'ESC closed the sheet, not the profile modal').toBeVisible()

    // (d) String Format control: a JSON value -> Auto detects JSON + a Format button
    //     reflows it. The detection is LIVE from the draft.
    await paramRow(dialog, 1).locator('[data-testid^="param-edit-value-"]').click()
    await expect(sheet).toBeVisible()
    await expect(sheet.locator('[data-testid="format-dropdown"]')).toContainText('Auto (JSON)')
    const formatBtn = sheet.locator('[data-testid="value-editor-string-format-button"]')
    await expect(formatBtn).toBeVisible()
    await formatBtn.click()
    // Pretty-print reflows the single-line JSON onto multiple lines.
    await expect(async () => {
      const lineCount = await sheet.locator('.cm-content .cm-line').count()
      expect(lineCount).toBeGreaterThan(1)
    }).toPass()

    // A plain-text string offers NO Format button and Auto stays plain.
    // The Format reflow dirtied the draft, so Cancel raises the unsaved guard.
    await sheet.locator('[data-testid="value-editor-cancel-button"]').click()
    const unsavedGuard = page.locator('[data-testid="value-editor-unsaved-dialog"]')
    await expect(unsavedGuard).toBeVisible()
    await unsavedGuard.locator('[data-testid="value-editor-unsaved-discard-button"]').click()
    await expect(sheet).toBeHidden()
    await paramRow(dialog, 0).locator('[data-testid^="param-edit-value-"]').click()
    await expect(sheet).toBeVisible()
    await expect(sheet.locator('[data-testid="format-dropdown"]')).toContainText('Auto')
    await expect(sheet.locator('[data-testid="format-dropdown"]')).not.toContainText('Auto (')
    await expect(sheet.locator('[data-testid="value-editor-string-format-button"]')).toHaveCount(0)

    // Bonus guard: no React DOM-nesting warning from the <tr><td> sheet wrapper.
    expect(
      consoleErrors.filter((e) => /validateDOMNesting|cannot (be a|appear as a) (child|descendant)/i.test(e)),
      `DOM-nesting console errors: ${consoleErrors.join('\n')}`,
    ).toHaveLength(0)

    await deleteProfileByName(request, name)
    await deleteEnv(request, env)
  })

  // -------------------------------------------------------------------------
  // An unnamed parameter is silently dropped on save, so an
  // empty / invalid name blocks Save and surfaces "Name is required"; the Trash2
  // delete removes a row.
  // -------------------------------------------------------------------------
  test('empty/invalid parameter name blocks Save (no silent drop); trash deletes a row', async ({
    page,
    request,
  }) => {
    const env = await createEnv(request, 'PVE-env-name')
    const name = 'PVE-name'
    await createCustomProfile(request, name, {
      [env]: { host: { type: 'string', value: 'h' } },
    })

    const dialog = await openEditModal(page, name, "PVE-env-name")
    const submit = dialog.getByRole('button', { name: /Save Changes/i })

    // Save only lives while something changed, so the parameter name stays the only blocker.
    await dialog.locator('#description').fill('name gate probe')

    // Add a second parameter, give it a VALUE but leave the NAME empty.
    await dialog.locator('[data-testid="add-parameter-btn"]').click()
    const newRow = paramRow(dialog, 1)
    await newRow.locator('[data-testid="scalar-edit-input"], [data-testid^="param-edit-value-"]').first().waitFor()
    // It is a string by default -> open the sheet and set a value.
    await newRow.locator('[data-testid^="param-edit-value-"]').click()
    const sheet = valueSheet(page)
    await sheet.locator('.cm-content').first().click()
    await page.keyboard.type('orphan-value')
    await sheet.locator('[data-testid="value-editor-save-button"]').click()
    await sheet.locator('[data-testid="value-editor-cancel-button"]').click()
    await expect(sheet).toBeHidden()

    // Empty name -> "Name is required" inline + Save disabled (would be a silent drop).
    await expect(newRow.getByText('Name is required')).toBeVisible()
    await expect(submit, 'unnamed parameter must block Save').toBeDisabled()

    // An invalid identifier keeps Save disabled.
    await newRow.locator('textarea[aria-label="Parameter name"]').fill('1bad')
    await expect(submit).toBeDisabled()

    // A valid name clears the error and re-enables Save.
    await newRow.locator('textarea[aria-label="Parameter name"]').fill('extra')
    await expect(newRow.getByText('Name is required')).toHaveCount(0)
    await expect(submit).toBeEnabled()

    // Trash2 delete removes the row.
    await newRow.locator('button[aria-label="Delete parameter"]').click()
    await expect(dialog.locator('tbody tr[data-parameter-id]')).toHaveCount(1)
    await expect(submit).toBeEnabled()

    await deleteProfileByName(request, name)
    await deleteEnv(request, env)
  })
})
