/**
 * V-PROF-K8S-01: Kubernetes profile form per the approved wireframe
 *
 * Phase: no-data (parallel) - opens the profile create dialog directly and
 * picks the kubernetes type; no fixture data.
 * Design Decisions: K8SPROF-1 (explicit cluster fields, never a kubeconfig
 * document), K8SPROF-2 (there is no kubeconfig import), K8SPROF-3 (a field's
 * declared starting value is what a new profile opens with), K8SPROF-6 (an
 * empty field means "not provided").
 *
 * Pass Criteria:
 *  1. Exactly eight parameter rows, in schema order: api_url, token,
 *     client_cert, client_key, ca_cert, verify_ssl, tls_server_name,
 *     namespace.
 *  2. The retired rows kubeconfig, context and api_server appear nowhere in
 *     the parameters table.
 *  3. token and client_key are the ONLY rows with "Mark as secret" ticked;
 *     the other six are unticked.
 *  4. verify_ssl is a Boolean row: its type select reads boolean, its secret
 *     checkbox is disabled, and its two-segment control sits on true.
 *  5. namespace opens showing its declared starting value default.
 *  6. api_url, client_cert, ca_cert and tls_server_name open blank - they
 *     declare no starting value and carry no other field's value.
 *  7. The PARAMETERS header carries + Add and nothing else: no import or
 *     upload affordance anywhere on the modal.
 */

import { test, expect } from '../../helpers/playwright-fixtures'
import { ensureEnvironment } from '../../helpers/config'
import { openProfileCreateDialog } from '../../helpers/profiles'
import type { Locator, Page } from '../../helpers/playwright-fixtures'

/** The kubernetes schema field list, in the order the form must render it. */
const K8S_FIELDS = [
  'api_url',
  'token',
  'client_cert',
  'client_key',
  'ca_cert',
  'verify_ssl',
  'tls_server_name',
  'namespace',
] as const

/** Retired rows - they must not resurface anywhere in the table. */
const RETIRED_FIELDS = ['kubeconfig', 'context', 'api_server'] as const

/** The empty-string preview the shared ValueField renders (variable-value-preview.ts). */
const EMPTY_PREVIEW = 'Edit…'

const paramRows = (dialog: Locator): Locator => dialog.locator('tbody tr[data-parameter-id]')

const nameFields = (dialog: Locator): Locator =>
  dialog.locator('textarea[aria-label="Parameter name"]')

/**
 * The portaled profile-type list. cmdk drops the CommandList id, so the only
 * anchor is the listbox itself; `custom` is in every profile type list, which
 * separates it from the environment selector's listbox.
 */
const typeListbox = (page: Page): Locator =>
  page
    .getByRole('listbox')
    .filter({ has: page.getByRole('option', { name: 'custom', exact: true }) })

/** Open the create dialog and select the kubernetes type, settled on 8 rows. */
async function openKubernetesForm(page: Page): Promise<Locator> {
  const dialog = await openProfileCreateDialog(page)

  // The create modal opens on `custom` with no rows (K8SPROF-4); picking a
  // type seeds the rows from an async GET /profiles/types/{type}/schema, so
  // wait on the row count rather than asserting straight after the click.
  const listbox = typeListbox(page)
  await expect(async () => {
    if (!(await listbox.isVisible())) {
      await dialog.locator('[data-testid="type-selector"]').click()
    }
    await expect(listbox).toBeVisible({ timeout: 2000 })
  }).toPass({ timeout: 15000 })
  await listbox.getByRole('option', { name: 'kubernetes', exact: true }).click()

  await expect(paramRows(dialog)).toHaveCount(K8S_FIELDS.length)
  return dialog
}

test.describe('V-PROF-K8S-01: kubernetes profile form', () => {
  test.beforeEach(async ({ page }) => {
    // The Profile create dialog is gated on "at least one environment exists";
    // without an env the New Profile click toasts instead of opening the modal.
    await ensureEnvironment(page.request)
    await page.goto('/')
    await page.evaluate(() => localStorage.clear())
  })

  test('S1: eight rows in schema order, and no retired row anywhere (K8SPROF-1)', async ({
    page,
  }) => {
    const dialog = await openKubernetesForm(page)

    await expect(nameFields(dialog)).toHaveCount(K8S_FIELDS.length)
    const rendered = await nameFields(dialog).evaluateAll((els) =>
      els.map((el) => (el as HTMLTextAreaElement).value),
    )
    expect(rendered).toEqual([...K8S_FIELDS])

    // Absence, stated per retired field so a failure names the survivor.
    for (const retired of RETIRED_FIELDS) {
      expect(rendered).not.toContain(retired)
      await expect(dialog.locator('table').first().getByText(retired, { exact: false })).toHaveCount(
        0,
      )
    }
  })

  test('S2: token and client_key are the only secret rows (K8SPROF-3)', async ({ page }) => {
    const dialog = await openKubernetesForm(page)
    const secretBoxes = dialog.locator('input[aria-label="Mark as secret"]')
    await expect(secretBoxes).toHaveCount(K8S_FIELDS.length)

    const checked = await secretBoxes.evaluateAll((els) =>
      els.map((el) => (el as HTMLInputElement).checked),
    )
    // A secret row with no value renders the ordinary editor, not a masked
    // pill, so the ticked checkbox is the whole contract here.
    expect(checked).toEqual([false, true, false, true, false, false, false, false])

    for (const [index, field] of K8S_FIELDS.entries()) {
      const shouldBeSecret = field === 'token' || field === 'client_key'
      if (shouldBeSecret) {
        await expect(secretBoxes.nth(index)).toBeChecked()
      } else {
        await expect(secretBoxes.nth(index)).not.toBeChecked()
      }
    }
  })

  test('S3: verify_ssl is a Boolean row, secret disabled, control on true (R65)', async ({
    page,
  }) => {
    const dialog = await openKubernetesForm(page)
    const verifySsl = paramRows(dialog).nth(K8S_FIELDS.indexOf('verify_ssl'))

    await expect(verifySsl.locator('textarea[aria-label="Parameter name"]')).toHaveValue(
      'verify_ssl',
    )
    await expect(verifySsl.locator('select[aria-label="Parameter type"]')).toHaveValue('boolean')

    const secretBox = verifySsl.locator('input[aria-label="Mark as secret"]')
    await expect(secretBox).toBeDisabled()
    await expect(secretBox).not.toBeChecked()

    // Two-segment control seeded from the declared starting value true.
    await expect(verifySsl.locator('[data-testid="scalar-edit-bool-true"]')).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    await expect(verifySsl.locator('[data-testid="scalar-edit-bool-false"]')).toHaveAttribute(
      'aria-pressed',
      'false',
    )

    // Every other row is a string row, so verify_ssl is the only boolean.
    const types = await dialog
      .locator('select[aria-label="Parameter type"]')
      .evaluateAll((els) => els.map((el) => (el as HTMLSelectElement).value))
    expect(types).toEqual([
      'string',
      'string',
      'string',
      'string',
      'string',
      'boolean',
      'string',
      'string',
    ])
  })

  test('S4: namespace opens on default, the four undeclared fields open blank (K8SPROF-3, K8SPROF-6)', async ({
    page,
  }) => {
    const dialog = await openKubernetesForm(page)

    const preview = (field: (typeof K8S_FIELDS)[number]) =>
      paramRows(dialog)
        .nth(K8S_FIELDS.indexOf(field))
        .locator('[data-testid^="param-edit-value-"] span.truncate')

    // Declared starting value. The preview quotes a non-empty string value.
    await expect(preview('namespace')).toHaveText('"default"')

    // No declared starting value: blank, and carrying nobody else's value.
    for (const blank of ['api_url', 'client_cert', 'ca_cert', 'tls_server_name'] as const) {
      await expect(preview(blank)).toHaveText(EMPTY_PREVIEW)
    }

    // The two secret rows are blank too, so nothing was seeded into them.
    await expect(preview('token')).toHaveText(EMPTY_PREVIEW)
    await expect(preview('client_key')).toHaveText(EMPTY_PREVIEW)
  })

  test('S5: the PARAMETERS header carries + Add and nothing else (R68)', async ({ page }) => {
    const dialog = await openKubernetesForm(page)

    const addButton = dialog.locator('[data-testid="add-parameter-btn"]')
    await expect(addButton).toHaveCount(1)
    await expect(addButton).toBeVisible()
    await expect(addButton).toHaveText(/Add/)

    // Innermost div wrapping the Add control is the PARAMETERS header row; it
    // must hold exactly one control alongside the label.
    const header = dialog
      .locator('div')
      .filter({ has: page.locator('[data-testid="add-parameter-btn"]') })
      .last()
    await expect(header).toContainText('Parameters')
    await expect(header.locator('button')).toHaveCount(1)

    // The kubeconfig import was designed, drawn and cut (K8SPROF-2):
    // no import affordance survives anywhere on the modal.
    await expect(
      dialog.getByRole('button', { name: /import|upload|browse|choose file|kubeconfig/i }),
    ).toHaveCount(0)
    await expect(dialog.locator('input[type="file"]')).toHaveCount(0)
    await expect(dialog.getByText(/kubeconfig/i)).toHaveCount(0)
  })
})
