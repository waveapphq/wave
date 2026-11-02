/**
 * V-NET-02: Settings > Network > Certificates
 *
 * Phase: no-data (parallel) - staged edits only, never Save; GET reads and the
 * POST parse call are real and write nothing.
 * Fixtures: tests/e2e/fixtures/settings/v-network-certificates-01/ (valid-ca.pem, expired-ca.pem)
 * Design Decisions: NET-1, NET-5, NET-6, NET-7, NET-8, NET-9
 * REQ: REQ-4.5.16
 *
 * Pass Criteria:
 * 1. /settings/network/certificates shows "Public Certificate Authorities" with
 *    Cancel and Save disabled while clean; two equal option cards: "WAVE's
 *    built-in list" reads `Mozilla's public list, {label}, {count} authorities.`
 *    and `Same on every WAVE host.` (label and count from GET
 *    /network/certificates settings.builtin), "This WAVE host's store" reads
 *    `Follows this machine's system updates.`; the built-in card is selected.
 * 2. Built-in Authorities: search "Search authorities…"; columns Name (sorted
 *    ascending), Organization, Expires and the eye column; no checkboxes, no
 *    Mass Action, no Add; the footer counts `count` authorities; search narrows
 *    the rows.
 * 3. The eye on a built-in row opens the certificate dialog (NET-9) titled with
 *    its name; every field equals GET /network/certificates/{id}; the
 *    fingerprint has a copy button, the PEM a Copy button and a scrollable mono
 *    box; the corner X and Close both close it.
 * 4. Selecting "This WAVE host's store" stages the change (Cancel and Save
 *    enable) and swaps Built-in Authorities for the "WAVE Host's Store" summary
 *    (Store, Certificates, Last changed from settings.host_store); with no store
 *    the card is disabled and reads "No certificate store found on this WAVE
 *    host". Cancel returns to the built-in card and table.
 * 5. Additional Certificates is empty: "No additional certificates" with its
 *    Add certificate button; the toolbar has search, Mass Action and Add
 *    certificate. The two Add certificate buttons are the same outlined button:
 *    equal computed size (36px tall), border (1px) and text style (14px).
 * 6. Add Certificate (NET-8): 672px, title only, no corner X, mono 12px text
 *    area, compact one-row dashed drop zone, Cancel then Add (both 40px), Add
 *    disabled while empty; preview columns Type 128px and Expires 184px
 *    (soft checks). The valid CA previews as one
 *    checked row and Add stages it. A bundle of the expired CA and the staged
 *    CA shows "Expired" after the date with the row still checked, and "Already
 *    added" with a disabled checkbox. Cancel the dialog, Cancel the page: the
 *    table is empty again.
 * 7. The eye on a staged row shows the parse result's detail without a fetch.
 * 8. The key checks of 1, 3, 5 and 6 hold again after flipping the theme.
 */

import fs from 'fs'
import path from 'path'
import { test, expect, type APIRequestContext, type Locator, type Page } from '../../helpers/playwright-fixtures'
import { BACKEND_URL } from '../../helpers/config'
import { toggleTheme } from '../../helpers/theme'

const FIXTURE_DIR = path.resolve(__dirname, '../../fixtures/settings/v-network-certificates-01')
const VALID_PEM = fs.readFileSync(path.join(FIXTURE_DIR, 'valid-ca.pem'), 'utf8')
const EXPIRED_PEM = fs.readFileSync(path.join(FIXTURE_DIR, 'expired-ca.pem'), 'utf8')
const VALID_NAME = 'WAVE E2E Fixture CA'
const EXPIRED_NAME = 'WAVE E2E Expired CA 2020'

const PAGE_SIZE = 10
const BUILTIN_TITLE = "WAVE's built-in list"
const HOST_TITLE = "This WAVE host's store"
const HOST_STORE_NOT_FOUND = 'No certificate store found on this WAVE host'
const DETAIL_PATH = /\/network\/certificates\/[0-9a-f]{64}$/
const MONO = /mono/i

interface CertificateRow {
  id: string
  name: string
  organization: string
  type: string
  expires: string
}

interface CertificatesView {
  settings: {
    public_source: string
    builtin: { label: string; count: number }
    host_store: { path: string | null; count: number; last_changed: string | null }
  }
  additional: CertificateRow[]
}

interface CertificateDetail {
  id: string
  name: string
  subject: string
  issuer: string
  type: string
  path_length: number | null
  valid_from: string
  valid_to: string
  status: 'valid' | 'expiring' | 'expired'
  days_to_expiry: number
  sha256_fingerprint: string
  serial_number: string
  key: string
  signature_algorithm: string
  key_usage: string[]
  subject_key_id: string | null
  authority_key_id: string | null
  pem: string
}

interface ParsedCertificate {
  id: string
  name: string
  type: string
  expires: string
  expired: boolean
  detail: CertificateDetail
}

interface CertificateParse {
  certificates: ParsedCertificate[]
  errors: { index: number | null; message: string }[]
}

async function getJson<T>(request: APIRequestContext, route: string): Promise<T> {
  const response = await request.get(`${BACKEND_URL}${route}`)
  expect(response.status(), `GET ${route}`).toBe(200)
  return (await response.json()) as T
}

/** The saved view; this spec draws staged states over the stack's default settings. */
async function readDefaultView(request: APIRequestContext): Promise<CertificatesView> {
  const view = await getJson<CertificatesView>(request, '/network/certificates')
  expect(view.settings.public_source, 'the stack starts on the built-in list').toBe('builtin')
  expect(view.additional, 'the stack starts with no additional certificates').toEqual([])
  return view
}

async function openCertificatesPage(page: Page): Promise<Locator> {
  await page.goto('/settings/network/certificates')
  const tab = page.getByTestId('network-certificates-tab')
  await expect(tab.getByRole('radio', { name: BUILTIN_TITLE, exact: true })).toBeVisible()
  await expect(builtInTable(tab).locator('tbody tr[data-row-id]').first()).toBeVisible()
  return tab
}

const builtInTable = (tab: Locator) => tab.getByTestId('built-in-authorities-table')
const additionalTable = (tab: Locator) => tab.getByTestId('additional-certificates-table')
const cancelButton = (tab: Locator) => tab.getByRole('button', { name: 'Cancel', exact: true })
const saveButton = (tab: Locator) => tab.getByRole('button', { name: 'Save', exact: true })

function optionCard(page: Page, tab: Locator, title: string): { radio: Locator; card: Locator } {
  return {
    radio: tab.getByRole('radio', { name: title, exact: true }),
    card: tab.locator('label').filter({ has: page.getByRole('radio', { name: title, exact: true }) }),
  }
}

async function expectPageClean(tab: Locator): Promise<void> {
  await expect(cancelButton(tab)).toBeDisabled()
  await expect(saveButton(tab)).toBeDisabled()
}

async function expectPageDirty(tab: Locator): Promise<void> {
  await expect(cancelButton(tab)).toBeEnabled()
  await expect(saveButton(tab)).toBeEnabled()
}

/** The DataTable's alphanumeric name order: lower case, digit runs compared as numbers. */
function naturalCompare(left: string, right: string): number {
  const a = left.toLowerCase().split(/(\d+)/).filter(Boolean)
  const b = right.toLowerCase().split(/(\d+)/).filter(Boolean)
  while (a.length > 0 && b.length > 0) {
    const x = a.shift() as string
    const y = b.shift() as string
    const xn = /^\d+$/.test(x)
    const yn = /^\d+$/.test(y)
    if (xn && yn) {
      if (Number(x) !== Number(y)) return Number(x) - Number(y)
    } else if (xn !== yn) {
      return xn ? 1 : -1
    } else if (x !== y) {
      return x > y ? 1 : -1
    }
  }
  return a.length - b.length
}

function statusBadgeText(detail: CertificateDetail): string {
  if (detail.status === 'expired') return 'Expired'
  if (detail.status === 'expiring') {
    return `Expires in ${detail.days_to_expiry} ${detail.days_to_expiry === 1 ? 'day' : 'days'}`
  }
  return 'Valid'
}

/** Labels in dialog order with the text each value shows. */
function expectedFields(detail: CertificateDetail): [string, string][] {
  return [
    ['Subject', detail.subject],
    ['Issuer', detail.issuer],
    ['Type', detail.type],
    ['Path length', detail.path_length === null ? 'Unlimited' : String(detail.path_length)],
    ['Valid from', detail.valid_from],
    ['Valid to', `${detail.valid_to}${statusBadgeText(detail)}`],
    ['SHA-256 fingerprint', detail.sha256_fingerprint],
    ['Serial number', detail.serial_number],
    ['Key', detail.key],
    ['Signature algorithm', detail.signature_algorithm],
    ['Key usage', detail.key_usage.length > 0 ? detail.key_usage.join(', ') : 'None'],
    ['Subject Key ID', detail.subject_key_id ?? 'None'],
    ['Authority Key ID', detail.authority_key_id ?? 'None'],
  ]
}

function fieldValue(dialog: Locator, label: string): Locator {
  return dialog.locator('dt').filter({ hasText: new RegExp(`^${label}$`) }).locator('xpath=following-sibling::dd[1]')
}

async function fontFamily(locator: Locator): Promise<string> {
  return locator.evaluate((element) => getComputedStyle(element).fontFamily)
}

/** NET-9: the dialog shows `detail` field by field, then the PEM. */
async function expectCertificateDialog(page: Page, detail: CertificateDetail): Promise<Locator> {
  const dialog = page.getByRole('dialog', { name: detail.name, exact: true })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByTestId('certificate-detail-loading')).toHaveCount(0)
  await expect(dialog.locator('dt').first()).toBeVisible()

  const shown = await dialog.locator('dl').evaluateAll((lists) =>
    lists.flatMap((list) =>
      [...list.querySelectorAll('dt')].map((term) => [
        term.textContent ?? '',
        term.nextElementSibling?.textContent ?? '',
      ]),
    ),
  )
  expect(shown).toEqual(expectedFields(detail))

  const validTo = fieldValue(dialog, 'Valid to')
  const date = validTo.getByText(detail.valid_to, { exact: true })
  const badge = validTo.getByText(statusBadgeText(detail), { exact: true })
  await expect(badge).toBeVisible()
  const dateBox = await date.boundingBox()
  const badgeBox = await badge.boundingBox()
  expect(badgeBox!.x, 'the status badge sits after the Valid to date').toBeGreaterThan(dateBox!.x + dateBox!.width)

  const fingerprint = fieldValue(dialog, 'SHA-256 fingerprint')
  const lines = await fingerprint.evaluate((value) =>
    [...value.querySelectorAll('span')]
      .filter((span) => span.children.length === 0 && span.textContent)
      .map((span) => ({ text: span.textContent ?? '', top: span.getBoundingClientRect().top })),
  )
  expect(lines, 'the fingerprint shows on two lines').toHaveLength(2)
  expect(lines[0].text).toMatch(/:$/)
  expect(`${lines[0].text}${lines[1].text}`).toBe(detail.sha256_fingerprint)
  expect(lines[1].top, 'the second fingerprint line sits below the first').toBeGreaterThan(lines[0].top)
  await expect(fingerprint.getByRole('button', { name: 'Copy SHA-256 fingerprint', exact: true })).toBeVisible()
  for (const label of ['SHA-256 fingerprint', 'Serial number', 'Subject Key ID', 'Authority Key ID']) {
    expect(await fontFamily(fieldValue(dialog, label)), `${label} is monospace`).toMatch(MONO)
  }

  await expect(dialog.getByText('PEM', { exact: true })).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'Copy', exact: true })).toBeVisible()
  const pem = dialog.locator('pre')
  await expect(pem).toBeVisible()
  expect(await pem.textContent()).toBe(detail.pem)
  expect(await fontFamily(pem), 'the PEM box is monospace').toMatch(MONO)
  const scroll = await pem.evaluate((element) => ({
    overflowY: getComputedStyle(element).overflowY,
    scrollHeight: element.scrollHeight,
    clientHeight: element.clientHeight,
  }))
  expect(scroll.overflowY).toBe('auto')
  expect(scroll.scrollHeight, 'the PEM box scrolls').toBeGreaterThan(scroll.clientHeight)

  await expect(dialog.getByRole('button', { name: 'Close', exact: true })).toHaveCount(2)
  return dialog
}

/** Footer Close renders first; the corner X is the dialog's last Close. */
const footerClose = (dialog: Locator) => dialog.getByRole('button', { name: 'Close', exact: true }).first()
const cornerClose = (dialog: Locator) => dialog.getByRole('button', { name: 'Close', exact: true }).last()

/** Criterion 1. */
async function expectHeaderAndCards(page: Page, tab: Locator, view: CertificatesView): Promise<void> {
  await expect(tab.getByRole('heading', { name: 'Public Certificate Authorities', exact: true })).toBeVisible()
  await expectPageClean(tab)

  const builtin = optionCard(page, tab, BUILTIN_TITLE)
  const host = optionCard(page, tab, HOST_TITLE)
  const { label, count } = view.settings.builtin
  await expect(builtin.card.getByText(BUILTIN_TITLE, { exact: true })).toBeVisible()
  await expect(
    builtin.card.getByText(`Mozilla's public list, ${label}, ${count} authorities.`, { exact: true }),
  ).toBeVisible()
  await expect(builtin.card.getByText('Same on every WAVE host.', { exact: true })).toBeVisible()
  await expect(host.card.getByText(HOST_TITLE, { exact: true })).toBeVisible()
  await expect(host.card.getByText("Follows this machine's system updates.", { exact: true })).toBeVisible()
  await expect(builtin.radio).toBeChecked()
  await expect(host.radio).not.toBeChecked()

  const builtinBox = (await builtin.card.boundingBox())!
  const hostBox = (await host.card.boundingBox())!
  expect(Math.abs(builtinBox.width - hostBox.width), 'equal card widths').toBeLessThanOrEqual(1)
  expect(Math.abs(builtinBox.height - hostBox.height), 'equal card heights').toBeLessThanOrEqual(1)
  expect(Math.abs(builtinBox.y - hostBox.y), 'cards share one row').toBeLessThanOrEqual(1)
  const borderOf = (card: Locator) => card.evaluate((element) => getComputedStyle(element).borderTopColor)
  expect(await borderOf(builtin.card), 'the selected card has its own border').not.toBe(await borderOf(host.card))
}

/** Criterion 6: the Add Certificate dialog shell, then the preview of `text`. */
async function openAddDialog(page: Page, tab: Locator): Promise<Locator> {
  await additionalTable(tab).getByRole('button', { name: 'Add certificate', exact: true }).first().click()
  const dialog = page.getByRole('dialog', { name: 'Add Certificate', exact: true })
  await expect(dialog).toBeVisible()
  return dialog
}

function expectNear(actual: number, expected: number, what: string, tolerance = 1): void {
  expect(Math.abs(actual - expected), `${what}: ${actual}px, expected ${expected}px`).toBeLessThanOrEqual(tolerance)
}

async function expectAddDialogShell(dialog: Locator): Promise<void> {
  await expect(dialog).toHaveAccessibleDescription('')
  await expect(dialog.getByRole('button', { name: 'Close', exact: true })).toHaveCount(0)
  expectNear((await dialog.boundingBox())!.width, 672, 'dialog width')

  const text = dialog.getByRole('textbox', { name: 'Certificate PEM', exact: true })
  await expect(text).toBeVisible()
  await expect(text).toHaveValue('')
  expect(await fontFamily(text), 'the text area is monospace').toMatch(MONO)
  await expect(text).toHaveCSS('font-size', '12px')
  expectNear((await text.boundingBox())!.height, 138, 'text area height', 2)

  const dropZone = dialog.getByRole('button').filter({ hasText: 'Click or drop file here' })
  const prompt = dropZone.getByText('Click or drop file here', { exact: true })
  const accept = dropZone.getByText('.pem, .crt, or .cer', { exact: true })
  await expect(prompt).toBeVisible()
  await expect(accept).toBeVisible()
  const zoneBox = (await dropZone.boundingBox())!
  const textBox = (await text.boundingBox())!
  const promptBox = (await prompt.boundingBox())!
  const acceptBox = (await accept.boundingBox())!
  expect(zoneBox.y, 'the drop zone sits under the text area').toBeGreaterThanOrEqual(textBox.y + textBox.height)
  expectNear(zoneBox.height, 48, 'drop zone height')
  await expect(dropZone).toHaveCSS('border-top-style', 'dashed')
  await expect(dropZone).toHaveCSS('border-top-width', '2px')
  expect(
    Math.abs(promptBox.y + promptBox.height / 2 - (acceptBox.y + acceptBox.height / 2)),
    'prompt and accepted types share one line',
  ).toBeLessThanOrEqual(2)
  expect(acceptBox.x).toBeGreaterThan(promptBox.x + promptBox.width)

  const cancel = dialog.getByRole('button', { name: 'Cancel', exact: true })
  const add = dialog.getByRole('button', { name: 'Add', exact: true })
  await expect(cancel).toBeEnabled()
  await expect(add).toBeDisabled()
  const cancelBox = (await cancel.boundingBox())!
  const addBox = (await add.boundingBox())!
  expect(addBox.x, 'Add sits right of Cancel').toBeGreaterThan(cancelBox.x + cancelBox.width)
  expectNear(cancelBox.height, 40, 'Cancel height')
  expectNear(addBox.height, 40, 'Add height')
}

async function pasteAndParse(page: Page, dialog: Locator, text: string): Promise<CertificateParse> {
  const parsed = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' && new URL(response.url()).pathname.endsWith('/network/certificates/parse'),
  )
  await dialog.getByRole('textbox', { name: 'Certificate PEM', exact: true }).fill(text)
  const response = await parsed
  expect(response.status()).toBe(200)
  const result = (await response.json()) as CertificateParse
  expect(result.errors).toEqual([])
  return result
}

const previewRows = (dialog: Locator) => dialog.locator('tbody tr[data-row-id]')
const previewRow = (dialog: Locator, id: string) => dialog.locator(`tbody tr[data-row-id="${id}"]`)

/** Stages the valid CA through the dialog and returns its parse result. */
async function stageValidCertificate(page: Page, tab: Locator): Promise<ParsedCertificate> {
  const dialog = await openAddDialog(page, tab)
  await expectAddDialogShell(dialog)

  const result = await pasteAndParse(page, dialog, VALID_PEM)
  expect(result.certificates.map((certificate) => certificate.name)).toEqual([VALID_NAME])
  const valid = result.certificates[0]
  await expect(previewRows(dialog)).toHaveCount(1)
  const row = previewRow(dialog, valid.id)
  await expect(row.getByRole('checkbox', { name: `Select ${VALID_NAME}`, exact: true })).toBeChecked()
  await expect(row).toContainText(VALID_NAME)
  await expect(row).toContainText(valid.type)
  await expect(row).toContainText(valid.expires)
  await expect(dialog.getByRole('checkbox', { name: 'Select all', exact: true })).toBeChecked()
  await expect(dialog.getByRole('columnheader')).toHaveText(['', 'Name', 'Type', 'Expires'])
  const headerWidth = async (label: string) =>
    (await dialog.getByRole('columnheader', { name: label, exact: true }).boundingBox())!.width
  const typeWidth = await headerWidth('Type')
  const expiresWidth = await headerWidth('Expires')
  expect.soft(Math.abs(typeWidth - 128), `preview Type column ${typeWidth}px, expected 128px`).toBeLessThanOrEqual(2)
  expect
    .soft(Math.abs(expiresWidth - 184), `preview Expires column ${expiresWidth}px, expected 184px`)
    .toBeLessThanOrEqual(2)
  await expect(dialog.getByRole('button', { name: 'Add', exact: true })).toBeEnabled()

  await dialog.getByRole('button', { name: 'Add', exact: true }).click()
  await expect(dialog).toBeHidden()
  const staged = additionalTable(tab).locator(`tbody tr[data-row-id="${valid.id}"]`)
  await expect(staged).toBeVisible()
  await expect(staged.locator('td')).toHaveText([VALID_NAME, valid.type, valid.expires, ''])
  await expect(staged.getByRole('button', { name: `View ${VALID_NAME}`, exact: true })).toBeVisible()
  await expect(staged.getByRole('button', { name: `Remove ${VALID_NAME}`, exact: true })).toBeVisible()
  await expectPageDirty(tab)
  return valid
}

/** A bundle of the expired CA and the staged valid CA: Expired stays allowed, Already added is locked. */
async function expectBundlePreview(page: Page, tab: Locator, valid: ParsedCertificate): Promise<void> {
  const dialog = await openAddDialog(page, tab)
  const result = await pasteAndParse(page, dialog, `${EXPIRED_PEM}${VALID_PEM}`)
  expect(result.certificates.map((certificate) => certificate.name)).toEqual([EXPIRED_NAME, VALID_NAME])
  const expired = result.certificates[0]
  expect(expired.expired).toBe(true)
  expect(expired.expires).toBe('2021-01-01')
  await expect(previewRows(dialog)).toHaveCount(2)

  const expiredRow = previewRow(dialog, expired.id)
  const date = expiredRow.getByText(expired.expires, { exact: true })
  const badge = expiredRow.getByText('Expired', { exact: true })
  await expect(badge).toBeVisible()
  expect((await badge.boundingBox())!.x, '"Expired" sits after the date').toBeGreaterThan(
    (await date.boundingBox())!.x + (await date.boundingBox())!.width,
  )
  const expiredCheckbox = expiredRow.getByRole('checkbox', { name: `Select ${EXPIRED_NAME}`, exact: true })
  await expect(expiredCheckbox).toBeChecked()
  await expect(expiredCheckbox).toBeEnabled()

  const addedRow = previewRow(dialog, valid.id)
  const name = addedRow.getByText(VALID_NAME, { exact: true })
  const marker = addedRow.getByText('Already added', { exact: true })
  await expect(marker).toBeVisible()
  expect((await marker.boundingBox())!.x, '"Already added" sits after the name').toBeGreaterThan(
    (await name.boundingBox())!.x + (await name.boundingBox())!.width,
  )
  const addedCheckbox = addedRow.getByRole('checkbox', { name: `Select ${VALID_NAME} Already added`, exact: true })
  await expect(addedCheckbox).toBeDisabled()
  await expect(addedCheckbox).not.toBeChecked()
  await expect(addedCheckbox).toHaveCSS('opacity', '0.5')
  await expect(addedCheckbox).toHaveCSS('cursor', 'not-allowed')
  await expect(dialog.getByRole('button', { name: 'Add', exact: true })).toBeEnabled()

  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(dialog).toBeHidden()
  await expect(additionalTable(tab).locator('tbody tr[data-row-id]')).toHaveCount(1)
  await expect(additionalTable(tab).locator(`tbody tr[data-row-id="${valid.id}"]`)).toBeVisible()
}

/** NET-3, NET-7: what an outlined add button computes to, apart from its label's width. */
async function addButtonStyle(button: Locator): Promise<Record<string, string>> {
  await expect(button).toBeVisible()
  return button.evaluate((element) => {
    const style = getComputedStyle(element)
    const names = [
      'height',
      'padding-left',
      'padding-right',
      'border-top-width',
      'border-right-width',
      'border-bottom-width',
      'border-left-width',
      'border-top-style',
      'border-top-color',
      'border-right-color',
      'border-bottom-color',
      'border-left-color',
      'border-top-left-radius',
      'background-color',
      'box-shadow',
      'font-family',
      'font-size',
      'font-weight',
      'line-height',
      'color',
      'white-space',
    ]
    return Object.fromEntries(names.map((name) => [name, style.getPropertyValue(name)]))
  })
}

/** Criterion 5: the toolbar's and the empty table's "Add certificate" are one outlined button. */
async function expectAddButtonsAlike(tab: Locator): Promise<void> {
  const table = additionalTable(tab)
  await expect(table.getByRole('button', { name: 'Add certificate', exact: true })).toHaveCount(2)
  const toolbarAdd = table.getByRole('button', { name: 'Add certificate', exact: true }).first()
  const emptyAdd = table.locator('tbody').getByRole('button', { name: 'Add certificate', exact: true })
  const shared = await addButtonStyle(toolbarAdd)
  expect(await addButtonStyle(emptyAdd), 'the empty table button computes like the toolbar button').toEqual(shared)
  expect(shared).toMatchObject({
    height: '36px',
    'padding-left': '12px',
    'padding-right': '12px',
    'border-top-width': '1px',
    'border-right-width': '1px',
    'border-bottom-width': '1px',
    'border-left-width': '1px',
    'border-top-style': 'solid',
    'font-size': '14px',
  })
  expectNear(
    (await emptyAdd.boundingBox())!.width,
    (await toolbarAdd.boundingBox())!.width,
    'both buttons are equally wide',
    0.5,
  )
}

async function expectAdditionalEmpty(tab: Locator): Promise<void> {
  const table = additionalTable(tab)
  await expect(table.locator('tbody tr[data-row-id]')).toHaveCount(0)
  const emptyCell = table.locator('td').filter({ hasText: 'No additional certificates' })
  await expect(emptyCell.getByText('No additional certificates', { exact: true })).toBeVisible()
  await expect(emptyCell.getByRole('button', { name: 'Add certificate', exact: true })).toBeVisible()
}

async function viewFirstBuiltIn(page: Page, tab: Locator, request: APIRequestContext): Promise<Locator> {
  const row = builtInTable(tab).locator('tbody tr[data-row-id]').first()
  const id = (await row.getAttribute('data-row-id'))!
  const name = (await row.locator('td').first().textContent())!
  const detail = await getJson<CertificateDetail>(request, `/network/certificates/${id}`)
  expect(detail.name).toBe(name)
  await row.getByRole('button', { name: `View ${name}`, exact: true }).click()
  return expectCertificateDialog(page, detail)
}

test.describe('V-NET-02: Settings > Network > Certificates', () => {
  test('NET-5: header, option cards and the Built-in Authorities table', async ({ page, request }) => {
    const view = await readDefaultView(request)
    const builtinRows = (await getJson<{ certificates: CertificateRow[] }>(request, '/network/certificates/builtin'))
      .certificates
    const tab = await openCertificatesPage(page)

    await test.step('1. Header and option cards', async () => {
      await expectHeaderAndCards(page, tab, view)
    })

    await test.step('2. Built-in Authorities table', async () => {
      const { count } = view.settings.builtin
      const table = builtInTable(tab)
      await expect(tab.getByRole('heading', { name: 'Built-in Authorities', exact: true })).toBeVisible()
      await expect(table.getByPlaceholder('Search authorities…', { exact: true })).toBeVisible()
      await expect(table.getByRole('columnheader')).toHaveText(['Name', 'Organization', 'Expires', 'Actions'])
      await expect(table.locator('th[aria-sort="ascending"]')).toHaveText('Name')
      await expect(table.getByRole('checkbox')).toHaveCount(0)
      await expect(table.getByRole('button', { name: /^Mass Action/ })).toHaveCount(0)
      await expect(table.getByRole('button', { name: /^Add/ })).toHaveCount(0)

      const shown = Math.min(PAGE_SIZE, count)
      const rows = table.locator('tbody tr[data-row-id]')
      await expect(rows).toHaveCount(shown)
      await expect(table.getByRole('button', { name: /^View / })).toHaveCount(shown)
      await expect(table.getByTestId('pagination-item-count')).toHaveText(`Showing 1-${shown} of ${count} authorities`)
      expect(builtinRows).toHaveLength(count)

      const names = await rows.locator('td:first-child').allTextContents()
      const lowest = [...builtinRows].sort((a, b) => naturalCompare(a.name, b.name))[0].name
      expect(names[0], 'the first row is the lowest name').toBe(lowest)
      for (let i = 1; i < names.length; i++) {
        expect(naturalCompare(names[i - 1], names[i]), `"${names[i - 1]}" sorts before "${names[i]}"`).toBeLessThanOrEqual(0)
      }

      const haystack = (row: CertificateRow) => `${row.name} ${row.organization}`.toLowerCase()
      const term = [...new Set(builtinRows.map((row) => row.organization))]
        .filter(Boolean)
        .find((organization) => {
          const hits = builtinRows.filter((row) => haystack(row).includes(organization.toLowerCase())).length
          return hits >= 2 && hits <= PAGE_SIZE && hits < count
        })
      expect(term, 'an organization that narrows the list to one page').toBeTruthy()
      const hits = builtinRows.filter((row) => haystack(row).includes(term!.toLowerCase()))
      await table.getByPlaceholder('Search authorities…', { exact: true }).fill(term!)
      await expect(rows).toHaveCount(hits.length)
      await expect(table.getByTestId('pagination-item-count')).toHaveText(
        `Showing 1-${hits.length} of ${hits.length} authorities`,
      )
      for (const text of await rows.allTextContents()) expect(text.toLowerCase()).toContain(term!.toLowerCase())
      await table.getByPlaceholder('Search authorities…', { exact: true }).fill('')
      await expect(rows).toHaveCount(shown)
      await expectPageClean(tab)
    })
  })

  test('NET-9: the eye on a built-in authority opens its certificate dialog', async ({ page, request }) => {
    await readDefaultView(request)
    const tab = await openCertificatesPage(page)

    await test.step('3. Every field equals the API detail; the corner X closes it', async () => {
      const dialog = await viewFirstBuiltIn(page, tab, request)
      await cornerClose(dialog).click()
      await expect(dialog).toBeHidden()
    })

    await test.step('3. Close in the footer closes it too', async () => {
      const dialog = await viewFirstBuiltIn(page, tab, request)
      await footerClose(dialog).click()
      await expect(dialog).toBeHidden()
      await expectPageClean(tab)
    })
  })

  test('NET-6: the host store source stages, shows its summary and cancels', async ({ page, request }) => {
    const view = await readDefaultView(request)
    const store = view.settings.host_store
    const tab = await openCertificatesPage(page)
    const builtin = optionCard(page, tab, BUILTIN_TITLE)
    const host = optionCard(page, tab, HOST_TITLE)

    if (store.path === null) {
      await test.step('4. No store on this WAVE host: the card is disabled', async () => {
        await expect(host.radio).toBeDisabled()
        await expect(host.card.getByText(HOST_STORE_NOT_FOUND, { exact: true })).toBeVisible()
        await expect(builtin.radio).toBeChecked()
        await expectPageClean(tab)
      })
      return
    }

    await test.step('4. Selecting the host store stages it and shows the WAVE Host\'s Store summary', async () => {
      await expect(host.radio).toBeEnabled()
      await expect(host.card.getByText(HOST_STORE_NOT_FOUND, { exact: true })).toHaveCount(0)
      await host.radio.click()
      await expect(host.radio).toBeChecked()
      await expect(builtin.radio).not.toBeChecked()
      await expectPageDirty(tab)

      await expect(tab.getByRole('heading', { name: 'Built-in Authorities', exact: true })).toHaveCount(0)
      await expect(builtInTable(tab)).toHaveCount(0)
      const heading = tab.getByRole('heading', { name: "WAVE Host's Store", exact: true })
      await expect(heading).toBeVisible()
      const summary = tab
        .locator('section')
        .filter({ has: page.getByRole('heading', { name: "WAVE Host's Store", exact: true }) })

      const facts: [string, string][] = [
        ['Store', store.path!],
        ['Certificates', String(store.count)],
      ]
      if (store.last_changed !== null) facts.push(['Last changed', store.last_changed])
      for (const [label, value] of facts) {
        const shown = summary.getByText(value, { exact: true })
        await expect(shown).toBeVisible()
        await expect(shown.locator('xpath=..')).toHaveText(`${label}${value}`)
      }
      expect(await fontFamily(summary.getByText(store.path!, { exact: true })), 'the store path is monospace').toMatch(
        MONO,
      )
      await expect(summary.locator('svg.lucide-lock')).toHaveCount(facts.length)
      await expect(summary.getByText(HOST_STORE_NOT_FOUND, { exact: true })).toHaveCount(0)
    })

    await test.step('4. Cancel returns to the built-in card and table', async () => {
      await cancelButton(tab).click()
      await expect(builtin.radio).toBeChecked()
      await expect(host.radio).not.toBeChecked()
      await expect(tab.getByRole('heading', { name: 'Built-in Authorities', exact: true })).toBeVisible()
      await expect(builtInTable(tab).locator('tbody tr[data-row-id]').first()).toBeVisible()
      await expect(tab.getByRole('heading', { name: "WAVE Host's Store", exact: true })).toHaveCount(0)
      await expectPageClean(tab)
    })
  })

  test('NET-7 / NET-8: Additional Certificates, the Add Certificate dialog and a staged row', async ({
    page,
    request,
  }) => {
    await readDefaultView(request)
    const tab = await openCertificatesPage(page)
    const detailFetches: string[] = []
    page.on('request', (outgoing) => {
      if (outgoing.method() === 'GET' && DETAIL_PATH.test(new URL(outgoing.url()).pathname)) {
        detailFetches.push(outgoing.url())
      }
    })

    await test.step('5. Empty Additional Certificates with its toolbar', async () => {
      const table = additionalTable(tab)
      await expect(tab.getByRole('heading', { name: 'Additional Certificates', exact: true })).toBeVisible()
      await expectAdditionalEmpty(tab)
      await expect(table.getByRole('columnheader')).toHaveText(['Name', 'Type', 'Expires', 'Actions'])
      await expect(table.locator('th[aria-sort="ascending"]')).toHaveText('Name')
      await expect(table.getByPlaceholder('Search certificates…', { exact: true })).toBeVisible()
      await expect(table.getByRole('button', { name: /^Mass Action/ })).toBeVisible()
      await expectAddButtonsAlike(tab)
    })

    let valid: ParsedCertificate | undefined
    await test.step('6. Add Certificate shell; the valid CA stages as one row', async () => {
      valid = await stageValidCertificate(page, tab)
    })

    await test.step('7. The eye on the staged row shows the parse detail without a fetch', async () => {
      await additionalTable(tab).getByRole('button', { name: `View ${VALID_NAME}`, exact: true }).click()
      const dialog = await expectCertificateDialog(page, valid!.detail)
      await footerClose(dialog).click()
      await expect(dialog).toBeHidden()
      expect(detailFetches, 'no detail read for a staged row').toEqual([])

      // Control: a built-in row's eye does read its detail, so the listener sees these reads.
      const dialogFromList = await viewFirstBuiltIn(page, tab, request)
      await footerClose(dialogFromList).click()
      await expect(dialogFromList).toBeHidden()
      expect(detailFetches).toHaveLength(1)
    })

    await test.step('6. A bundle shows Expired and Already added; Cancel keeps one staged row', async () => {
      await expectBundlePreview(page, tab, valid!)
    })

    await test.step('6. Cancel on the page empties the table again', async () => {
      await cancelButton(tab).click()
      await expectAdditionalEmpty(tab)
      await expectPageClean(tab)
    })
  })

  test('Theme flip: the cards, the certificate dialog and the Add Certificate preview hold', async ({
    page,
    request,
  }) => {
    const view = await readDefaultView(request)
    const tab = await openCertificatesPage(page)
    const theme = await toggleTheme(page)

    await test.step(`8. Criterion 5 in ${theme}`, async () => {
      await expectAdditionalEmpty(tab)
      await expectAddButtonsAlike(tab)
    })

    await test.step(`8. Criterion 1 in ${theme}`, async () => {
      await expectHeaderAndCards(page, tab, view)
    })

    await test.step(`8. Criterion 3 in ${theme}`, async () => {
      const dialog = await viewFirstBuiltIn(page, tab, request)
      await footerClose(dialog).click()
      await expect(dialog).toBeHidden()
    })

    await test.step(`8. Criterion 6 in ${theme}`, async () => {
      const valid = await stageValidCertificate(page, tab)
      await expectBundlePreview(page, tab, valid)
      await cancelButton(tab).click()
      await expectAdditionalEmpty(tab)
      await expect(page.locator('html'), `still in ${theme}`).toHaveAttribute('data-theme', theme)
    })
  })
})
