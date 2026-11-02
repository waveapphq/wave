/**
 * V-PROFILE-TYPE-CHANGE: the profile type-change data-loss confirmation
 *
 * Phase: no-data (parallel) - opens the profile create dialog directly; no
 * fixture data.
 * Design Decisions: K8SPROF-3 (a field's declared starting value is seeded,
 * and seeded values are NOT author data), K8SPROF-4 (create opens on custom
 * with no rows). Re-seeding on a type pick asks first once the rows carry
 * something the author put in.
 *
 * Pass Criteria:
 *  1. Quiet path, first pick: picking a type from the empty custom form seeds
 *     the rows immediately and raises no confirmation.
 *  2. Quiet path, untouched re-pick: picking a second type straight after,
 *     with nothing edited, replaces the rows immediately and raises no
 *     confirmation (seeded starting values are not author data).
 *  3. Cancel restores exactly: with a value typed into one row, picking a
 *     second type raises the confirmation; while it is open the type selector
 *     still reads the FIRST type and the rows are untouched; Cancel leaves the
 *     type, the row set and the typed value byte-identical.
 *  4. Confirm replaces: confirming with "Change type" swaps the rows for the
 *     second type's field set and discards the typed value.
 *  5. Quiet path to custom: with author data present, picking custom raises no
 *     confirmation, because custom keeps the rows.
 */

import { test, expect } from '../../helpers/playwright-fixtures'
import { ensureEnvironment } from '../../helpers/config'
import { openProfileCreateDialog } from '../../helpers/profiles'
import type { Locator, Page } from '../../helpers/playwright-fixtures'

const SSH_FIELDS = [
  'host',
  'port',
  'username',
  'password',
  'private_key',
  'passphrase',
  'connect_timeout',
]

const K8S_FIELDS = [
  'api_url',
  'token',
  'client_cert',
  'client_key',
  'ca_cert',
  'verify_ssl',
  'tls_server_name',
  'namespace',
]

/** ssh row index of `port` - an integer row, so it edits inline. */
const PORT_ROW = SSH_FIELDS.indexOf('port')
const TYPED_PORT = '2222'

const paramRows = (dialog: Locator): Locator => dialog.locator('tbody tr[data-parameter-id]')

const typeSelector = (dialog: Locator): Locator => dialog.locator('[data-testid="type-selector"]')

/** The change-type confirmation. Two ConfirmationDialogs share the role here. */
const changeTypeDialog = (page: Page): Locator =>
  page.getByRole('alertdialog').filter({ hasText: 'Change profile type?' })

async function renderedFieldNames(dialog: Locator): Promise<string[]> {
  return dialog
    .locator('textarea[aria-label="Parameter name"]')
    .evaluateAll((els) => els.map((el) => (el as HTMLTextAreaElement).value))
}

/**
 * The portaled profile-type list. cmdk drops the CommandList id, so the only
 * anchor is the listbox itself; `custom` is in every profile type list, which
 * separates it from the environment selector's listbox.
 */
const typeListbox = (page: Page): Locator =>
  page
    .getByRole('listbox')
    .filter({ has: page.getByRole('option', { name: 'custom', exact: true }) })

/** Pick a profile type from the portaled type listbox. */
async function pickType(page: Page, dialog: Locator, type: string): Promise<void> {
  const listbox = typeListbox(page)
  await expect(async () => {
    if (!(await listbox.isVisible())) {
      await typeSelector(dialog).click()
    }
    await expect(listbox).toBeVisible({ timeout: 2000 })
  }).toPass({ timeout: 15000 })
  await listbox.getByRole('option', { name: type, exact: true }).click()
  await expect(listbox).toHaveCount(0)
}

/**
 * Create dialog on ssh with `2222` typed into the port row - the state every
 * loud-path assertion starts from. A VALUE edit is the only edit exempt from
 * the pre-existing Convert to Custom dialog, which structure edits raise.
 */
async function openSshWithTypedPort(page: Page): Promise<Locator> {
  const dialog = await openProfileCreateDialog(page)
  await pickType(page, dialog, 'ssh')
  await expect(paramRows(dialog)).toHaveCount(SSH_FIELDS.length)

  const portInput = paramRows(dialog).nth(PORT_ROW).locator('[data-testid="scalar-edit-input"]')
  await expect(portInput).toHaveValue('22')
  await portInput.fill(TYPED_PORT)
  await expect(portInput).toHaveValue(TYPED_PORT)
  return dialog
}

test.describe('V-PROFILE-TYPE-CHANGE: type-change data-loss confirmation', () => {
  test.beforeEach(async ({ page }) => {
    // The Profile create dialog is gated on "at least one environment exists";
    // without an env the New Profile click toasts instead of opening the modal.
    await ensureEnvironment(page.request)
    await page.goto('/')
    await page.evaluate(() => localStorage.clear())
  })

  test('S1: first pick and an untouched re-pick both seed silently (K8SPROF-4, R74)', async ({
    page,
  }) => {
    const dialog = await openProfileCreateDialog(page)

    // Create opens on custom with no rows, so the first pick can discard nothing.
    await expect(typeSelector(dialog)).toHaveText(/custom/)
    await expect(paramRows(dialog)).toHaveCount(0)

    await pickType(page, dialog, 'ssh')
    await expect(paramRows(dialog)).toHaveCount(SSH_FIELDS.length)
    expect(await renderedFieldNames(dialog)).toEqual(SSH_FIELDS)
    await expect(typeSelector(dialog)).toHaveText(/ssh/)
    await expect(page.getByRole('alertdialog')).toHaveCount(0)

    // Re-pick with nothing edited: the seeded starting values are not author
    // data, so the swap is silent and immediate.
    await pickType(page, dialog, 'kubernetes')
    await expect(paramRows(dialog)).toHaveCount(K8S_FIELDS.length)
    expect(await renderedFieldNames(dialog)).toEqual(K8S_FIELDS)
    await expect(typeSelector(dialog)).toHaveText(/kubernetes/)
    await expect(page.getByRole('alertdialog')).toHaveCount(0)
  })

  test('S2: Cancel restores the type, the rows and the typed value exactly (R74)', async ({
    page,
  }) => {
    const dialog = await openSshWithTypedPort(page)

    await pickType(page, dialog, 'kubernetes')

    const confirm = changeTypeDialog(page)
    await expect(confirm).toBeVisible()
    await expect(confirm).toContainText(
      'Switching to kubernetes replaces the parameters below. Anything you entered will be lost.',
    )
    await expect(confirm.locator('[data-confirmation-icon][data-icon="alert-triangle"]')).toHaveCount(
      1,
    )
    await expect(confirm.getByRole('button', { name: 'Change type' })).toBeVisible()
    await expect(confirm.getByRole('button', { name: 'Cancel' })).toBeVisible()

    // Nothing has been applied yet: the form still reads ssh, with ssh's rows.
    await expect(typeSelector(dialog)).toHaveText(/ssh/)
    await expect(paramRows(dialog)).toHaveCount(SSH_FIELDS.length)
    expect(await renderedFieldNames(dialog)).toEqual(SSH_FIELDS)

    await confirm.getByRole('button', { name: 'Cancel' }).click()
    await expect(changeTypeDialog(page)).toHaveCount(0)

    await expect(typeSelector(dialog)).toHaveText(/ssh/)
    await expect(paramRows(dialog)).toHaveCount(SSH_FIELDS.length)
    expect(await renderedFieldNames(dialog)).toEqual(SSH_FIELDS)
    // The whole point: the value the author typed survives byte-identical.
    await expect(
      paramRows(dialog).nth(PORT_ROW).locator('[data-testid="scalar-edit-input"]'),
    ).toHaveValue(TYPED_PORT)
  })

  test('S3: Change type replaces the rows and drops the typed value (R74)', async ({ page }) => {
    const dialog = await openSshWithTypedPort(page)

    // Raise the confirmation, cancel it, then come back and confirm - the
    // post-cancel state must still be a live ssh form carrying the edit.
    await pickType(page, dialog, 'kubernetes')
    await changeTypeDialog(page).getByRole('button', { name: 'Cancel' }).click()
    await expect(changeTypeDialog(page)).toHaveCount(0)
    await expect(
      paramRows(dialog).nth(PORT_ROW).locator('[data-testid="scalar-edit-input"]'),
    ).toHaveValue(TYPED_PORT)

    await pickType(page, dialog, 'kubernetes')
    await changeTypeDialog(page).getByRole('button', { name: 'Change type' }).click()
    await expect(changeTypeDialog(page)).toHaveCount(0)

    await expect(typeSelector(dialog)).toHaveText(/kubernetes/)
    await expect(paramRows(dialog)).toHaveCount(K8S_FIELDS.length)
    expect(await renderedFieldNames(dialog)).toEqual(K8S_FIELDS)

    // kubernetes declares no integer field, so the typed port is gone with the
    // row that held it.
    await expect(dialog.locator('[data-testid="scalar-edit-input"]')).toHaveCount(0)
    await expect(dialog.locator('table').first()).not.toContainText(TYPED_PORT)
  })

  test('S4: switching to custom with author data present raises nothing (R74)', async ({
    page,
  }) => {
    const dialog = await openSshWithTypedPort(page)

    // custom keeps the rows, so it can discard nothing and never asks.
    await pickType(page, dialog, 'custom')
    await expect(typeSelector(dialog)).toHaveText(/custom/)
    await expect(page.getByRole('alertdialog')).toHaveCount(0)

    await expect(paramRows(dialog)).toHaveCount(SSH_FIELDS.length)
    expect(await renderedFieldNames(dialog)).toEqual(SSH_FIELDS)
    await expect(
      paramRows(dialog).nth(PORT_ROW).locator('[data-testid="scalar-edit-input"]'),
    ).toHaveValue(TYPED_PORT)
  })
})
