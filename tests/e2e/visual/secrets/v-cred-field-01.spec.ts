/**
 * V-CRED-FIELD-01: declared credential input field - status icon + write-only masking
 *
 * Phase: no-data (parallel) - self-seeds a Test via POST /tests, opens its SSH
 * Session Open config sheet; no execution. Runs under dark + light projects.
 * Design Decisions: SECFLD-1..4
 * REQ: REQ-3.1.3.16 / REQ-3.1.3.18
 *
 * Pass Criteria:
 * 1. A STORED (sealed) credential literal renders masked write-only (Edit protected
 *    value) + a gray Lock carrying the literal tooltip; the wave:enc:v1: envelope
 *    never renders.
 * 2. A credential expression referencing a NON-secret variable shows the amber alert
 *    with the exact copy; referencing a SECRET variable shows the gray Lock.
 * 3. The SSH "Mask specific fields" list carries password / private_key / passphrase.
 * 4. Toggling a sealed credential literal to expression confirms ("Discard protected
 *    value?"), never carries the envelope into the editor, and persists no envelope.
 * 5. Editing a credential (Delete & Edit moves the focus into the field's new box, FIELD-1, then retype) and
 *    saving re-masks the field write-only WITHOUT a reload, and the persisted config holds a new sealed envelope.
 */

import { test, expect, type Page } from '../../helpers/playwright-fixtures'
import { importValidateAndNavigate } from '../../helpers/fixture-import'
import { configSheet, saveBtn } from '../../helpers/workbench'
import { BACKEND_URL } from '../../helpers/config'
import fs from 'fs'
import path from 'path'

const MASKING_ALL_OFF = {
  run_output: false,
  test_variables: false,
  shared_variables: false,
  credential_inputs: false,
}

const LITERAL_TOOLTIP =
  'This value is stored protected - after saving, it can be replaced, and viewed only ' +
  'while secret unmasking is enabled in Settings.'
const SECRET_EXPR_TOOLTIP = 'Value protected - references a secret variable.'
const nonSecretExprTooltip = (name: string) =>
  `Variable ${name} is not a secret - its value is stored and displayed unprotected. ` +
  `Mark it secret in the Variable Manager to protect it.`

function loadFixture(): Record<string, unknown> {
  return JSON.parse(
    fs.readFileSync(path.resolve(__dirname, '../../fixtures/secrets/cred-field.json'), 'utf-8'),
  )
}

async function persistedPassword(page: Page, testId: string): Promise<unknown> {
  const resp = await page.request.get(`${BACKEND_URL}/tests/${testId}/workflow`)
  const body = await resp.json().catch(() => null)
  const nodes = (body?.data?.nodes ?? body?.nodes ?? []) as Array<{
    id: string
    data?: { config?: { values?: Record<string, unknown> } }
  }>
  return nodes.find((n) => n.id === 'ssh-open')?.data?.config?.values?.password
}

/** Apply the config sheet (its own Save), then persist the workbench draft. */
async function applyConfigAndSave(page: Page): Promise<void> {
  const sheet = configSheet(page)
  const configSave = sheet.getByRole('button', { name: /^Save$/ }).last()
  await expect(configSave).toBeEnabled()
  await configSave.click()
  await expect(sheet).toBeHidden({ timeout: 10_000 })
  const toolbarSave = saveBtn(page)
  await expect(toolbarSave).toBeEnabled()
  await toolbarSave.click()
}

async function openSshConfig(page: Page): Promise<void> {
  await page.locator('[data-testid="workflow-node-ssh-open"]').locator('button').first().dblclick()
  await expect(configSheet(page)).toBeVisible({ timeout: 10_000 })
}

let testId = ''

test.describe('V-CRED-FIELD-01: credential field status + masking', () => {
  test.beforeEach(async ({ page }) => {
    // Masked baseline (credential_inputs off) so a sealed literal renders write-only.
    await page.request.put(`${BACKEND_URL}/admin/secret-masking`, { data: MASKING_ALL_OFF })
    testId = await importValidateAndNavigate(page, loadFixture())
    const node = page.locator('[data-testid="workflow-node-ssh-open"]')
    await node.locator('button').first().dblclick()
    await expect(configSheet(page)).toBeVisible({ timeout: 10_000 })
  })

  test.afterEach(async ({ page }) => {
    if (testId) await page.request.delete(`${BACKEND_URL}/tests/${testId}`).catch(() => {})
  })

  test('SECFLD-1/3/4: masked-write-only lock, non-secret alert, secret lock', async ({ page }) => {
    const sheet = configSheet(page)

    // Password (Connection group): sealed literal -> masked write-only + literal lock,
    // and the envelope never renders.
    const pwRow = sheet.locator('[data-testid="param-row-password"]')
    await expect(pwRow.locator('button[aria-label="Edit protected value"]')).toBeVisible()
    await expect(sheet.locator(`[aria-label="${LITERAL_TOOLTIP}"]`)).toBeVisible()
    await expect(sheet.getByText(/wave:enc:v1:/)).toHaveCount(0)

    // Private key: expression referencing a NON-secret variable -> amber alert.
    await expect(sheet.locator(`[aria-label="${nonSecretExprTooltip('plain_var')}"]`)).toBeVisible()

    // Passphrase (Advanced group): expression referencing a SECRET variable -> lock.
    await sheet.locator('[data-testid="group-header-Advanced"]').click()
    await expect(sheet.locator('[data-testid="param-row-passphrase"]')).toBeVisible()
    await expect(sheet.locator(`[aria-label="${SECRET_EXPR_TOOLTIP}"]`)).toBeVisible()
  })

  test('SSH "Mask specific fields" lists the three declared credentials', async ({ page }) => {
    const sheet = configSheet(page)
    await sheet.locator('[data-testid="secrets-section-trigger"]').click()
    await expect(sheet.locator('[data-testid="secret-mask-field-password"]')).toBeVisible()
    await expect(sheet.locator('[data-testid="secret-mask-field-private_key"]')).toBeVisible()
    await expect(sheet.locator('[data-testid="secret-mask-field-passphrase"]')).toBeVisible()
  })

  test('literal -> expression discards the sealed value, never leaks the envelope', async ({ page }) => {
    const pwRow = configSheet(page).locator('[data-testid="param-row-password"]')

    await pwRow.locator('[data-testid="expression-toggle"]').click()
    await expect(page.getByText('Discard protected value?')).toBeVisible()
    await page.getByRole('button', { name: 'Switch to expression' }).click()

    // Now an expression field: the sealed envelope must NOT be carried in, and the
    // masked write-only affordance is gone.
    await expect(pwRow.getByText(/wave:enc:v1:/)).toHaveCount(0)
    await expect(pwRow.locator('button[aria-label="Edit protected value"]')).toHaveCount(0)

    // Apply the config (sheet Save) + persist the workbench (toolbar Save).
    await applyConfigAndSave(page)
    // The persisted config no longer holds a sealed envelope for password.
    await expect
      .poll(
        async () => {
          const pw = await persistedPassword(page, testId)
          return typeof pw === 'string' && pw.startsWith('wave:enc:v1:')
        },
        { timeout: 10_000 },
      )
      .toBe(false)
  })

  test('editing a credential re-masks write-only after save without reload', async ({ page }) => {
    const pwRow = () => configSheet(page).locator('[data-testid="param-row-password"]')

    // Clear-and-retype the sealed credential through the write-only flow.
    await pwRow().locator('button[aria-label="Edit protected value"]').click()
    const editConfirm = page.getByRole('dialog').filter({ hasText: 'Edit Protected Value?' })
    await expect(editConfirm).toBeVisible()
    await editConfirm.getByRole('button', { name: /Delete & Edit/i }).click()
    // FIELD-1: Delete & Edit leaves an ordinary field with the lock icon, and the focus in its box.
    const box = pwRow().locator('[data-slot="input-group"] input')
    await expect(box, 'the focus moves into the new box').toBeFocused()
    await page.keyboard.type('fresh-pw-2b3c4d')
    await expect(box).toHaveValue('fresh-pw-2b3c4d')

    // Apply the config + persist the workbench (this seals the credential + resyncs the store).
    await applyConfigAndSave(page)

    // The persisted config holds a new sealed envelope (and never the typed plaintext).
    await expect
      .poll(
        async () => {
          const pw = await persistedPassword(page, testId)
          return typeof pw === 'string' && pw.startsWith('wave:enc:v1:')
        },
        { timeout: 10_000 },
      )
      .toBe(true)
    const finalPw = await persistedPassword(page, testId)
    expect(String(finalPw), 'the typed plaintext must never persist cleartext').not.toContain(
      'fresh-pw-2b3c4d',
    )

    // Reopen the config WITHOUT a page reload: the field masks write-only again (the
    // post-save store resync), never showing the typed plaintext.
    await openSshConfig(page)
    await expect(pwRow().locator('button[aria-label="Edit protected value"]')).toBeVisible({
      timeout: 10_000,
    })
    await expect(pwRow().getByText(/fresh-pw-2b3c4d/)).toHaveCount(0)
  })
})
