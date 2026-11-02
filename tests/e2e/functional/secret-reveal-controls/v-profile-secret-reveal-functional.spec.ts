/**
 * V-PROFILE-SECRET-REVEAL-FUNCTIONAL: profiles join the shared-variable unmask.
 *
 * REQ: REQ-3.1.3.17 (system-wide secret reveal controls).
 *
 * A profile credential is a shared-variable surface: the `shared_variables` reveal
 * flag unseals it on read (`_prepare_profile_response`), and the profile edit modal
 * fresh-fetches on open, so a revealed credential shows plaintext in its parameter
 * row. RED proof: with `shared_variables` off the credential stays masked write-only.
 * Resets the flag in beforeEach/afterEach so it never leaks to another spec.
 */

import { test, expect, type APIRequestContext, type Page, type Locator } from '../../helpers/playwright-fixtures'
import { BACKEND_URL, E2E_ENV_NAME, ensureEnvironment } from '../../helpers/config'

const PROFILE_NAME = 'PSR-reveal'
const SECRET_VAL = 's3cr3t-profile-reveal-8080'
const REVEAL_FRAGMENT = 's3cr3t-profile' // survives value-cell truncation

async function setSharedVariables(page: Page, on: boolean): Promise<void> {
  const resp = await page.request.put(`${BACKEND_URL}/admin/secret-masking`, {
    data: { shared_variables: on },
  })
  expect(resp.ok(), `PUT /admin/secret-masking failed: ${resp.status()}`).toBeTruthy()
}

async function deleteSeed(request: APIRequestContext): Promise<void> {
  const list = await request.get(`${BACKEND_URL}/profiles?search=${encodeURIComponent(PROFILE_NAME)}`)
  const lb = await list.json()
  for (const p of Array.isArray(lb) ? lb : (lb.data ?? [])) {
    if (p.name === PROFILE_NAME) await request.delete(`${BACKEND_URL}/profiles/${p.id}`).catch(() => {})
  }
}

async function seedProfile(request: APIRequestContext): Promise<void> {
  const envResp = await request.get(`${BACKEND_URL}/environments/`)
  const envBody = await envResp.json()
  const envs = Array.isArray(envBody) ? envBody : (envBody.data ?? [])
  const envId = envs.find((e: { name: string }) => e.name === E2E_ENV_NAME).id
  await deleteSeed(request)
  const config = {
    host: { type: 'string', secret: false, value: 'db.local' },
    token: { type: 'string', secret: true, value: SECRET_VAL },
  }
  const resp = await request.post(`${BACKEND_URL}/profiles`, {
    data: { name: PROFILE_NAME, type: 'custom', tags: [], environment_values: { [envId]: config } },
  })
  expect(resp.ok(), `seed profile: ${resp.status()} ${await resp.text()}`).toBeTruthy()
}

/** Open the seeded profile's edit modal and select the env that holds the values. */
async function openParamModal(page: Page): Promise<Locator> {
  await page.goto(`/profiles?search=${encodeURIComponent(PROFILE_NAME)}`)
  await page.waitForSelector('[data-testid="profiles-page"][aria-busy="false"]', { state: 'attached' })
  const row = page.locator('[data-testid="profile-row"]', { hasText: PROFILE_NAME })
  await expect(row).toBeVisible({ timeout: 10_000 })
  await row.locator('[data-testid="action-edit"]').click()
  const dialog = page.locator('[role="dialog"]').first()
  await expect(dialog).toBeVisible()
  await expect(dialog.locator('tbody tr[data-parameter-id]').first()).toBeVisible()
  const selector = dialog.locator('[data-testid="env-selector"]')
  const popover = page.locator('[role="dialog"]').filter({ has: page.locator('[role="listbox"]') })
  await expect(async () => {
    await selector.click()
    await expect(popover).toBeVisible({ timeout: 2000 })
  }).toPass({ timeout: 15_000 })
  await popover.locator('[role="listbox"] button').filter({ hasText: E2E_ENV_NAME }).first().click()
  await expect(popover).not.toBeVisible()
  return dialog
}

test.describe('V-PROFILE-SECRET-REVEAL-FUNCTIONAL', () => {
  test.beforeEach(async ({ page, request }) => {
    await page.goto('/')
    await ensureEnvironment(request)
    await setSharedVariables(page, false)
    await seedProfile(request)
  })

  test.afterEach(async ({ page, request }) => {
    await setSharedVariables(page, false)
    await deleteSeed(request)
  })

  test('a profile credential masks when off and reveals under shared_variables', async ({ page }) => {
    test.setTimeout(120_000)

    // shared_variables OFF: the credential masks write-only; the value never renders.
    let dialog = await openParamModal(page)
    await expect(
      dialog.locator('button[aria-label="Edit protected value"]'),
      'the credential must mask write-only while shared_variables off',
    ).toBeVisible()
    await expect(dialog.getByText(SECRET_VAL)).toHaveCount(0)

    // Flip shared_variables ON; reopening navigates fresh (openParamModal does a full
    // page.goto), so the modal fresh-fetches the profile and reveals plaintext.
    await setSharedVariables(page, true)
    dialog = await openParamModal(page)
    await expect(
      dialog.getByText(new RegExp(REVEAL_FRAGMENT)),
      'the credential must reveal plaintext when shared_variables on',
    ).toBeVisible()
    await expect(
      dialog.locator('button[aria-label="Edit protected value"]'),
      'the revealed credential must no longer mask write-only',
    ).toHaveCount(0)
  })
})
