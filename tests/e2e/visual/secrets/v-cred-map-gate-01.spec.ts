/**
 * V-CRED-MAP-GATE-01: declared MAP credential - the K8s Apply Secret Data field
 *
 * Phase: no-data (parallel) - self-seeds a Test via POST /tests and drives its two
 * K8s Apply config sheets; no execution. Runs under dark + light projects.
 * Design Decisions: SECFLD-1, SECFLD-4, K8SWRITE-3, FIELD-1
 * REQ: REQ-3.1.3.18, REQ-3.1.3.16, REQ-5.1.1
 *
 * A map credential seals value by value, so its keys stay readable at rest. The
 * field is therefore protected as a whole once it is stored: the sheet shows one
 * protected value, and the key/value editor is reached only by clearing it. The
 * ConfigMap Data map beside it is not a credential and never changes.
 *
 * Criterion ids use the MG- prefix, following the per-file letter convention.
 *
 * Pass Criteria:
 *   MG-a  a STORED Secret Data map renders as one protected value - no entry
 *         count, no keys, no values and no envelope - while the ConfigMap Data
 *         map on the same test still shows its entries as one line (FIELD-1)
 *   MG-b  Cancel on the Edit Protected Value dialog opens no editor, leaves the
 *         row protected, and leaves the stored map on disk unchanged
 *   MG-c  Delete & Edit clears the stored map and opens an empty key/value
 *         editor, and the row then shows the empty map `{}`
 *   MG-d  a map typed this session offers its quick-insert keys and reads back
 *         as typed, and one save renders it protected with NO reload; the
 *         persisted values are envelopes and never the typed text
 *   MG-e  after a full reload the saved Secret Data map is still protected while
 *         the ConfigMap Data map still shows its keys and values
 */

import { test, expect, type Locator, type Page } from '../../helpers/playwright-fixtures'
import { importValidateAndNavigate } from '../../helpers/fixture-import'
import { waitForCanvasLoad } from '../../helpers/canvas'
import { clearPointerLock, configSheet, saveBtn } from '../../helpers/workbench'
import { BACKEND_URL } from '../../helpers/config'
import fs from 'fs'
import path from 'path'

const MASKING_ALL_OFF = {
  run_output: false,
  test_variables: false,
  shared_variables: false,
  credential_inputs: false,
}

const SECRET_NODE = 'apply-secret'
const CONFIG_NODE = 'apply-config'
const ENVELOPE = 'wave:enc:v1:'

// The stored Secret Data map the fixture ships; the import seals both values.
const STORED_KEYS = ['tls.crt', 'tls.key']
const STORED_VALUES = ['stored-crt-7c1d9', 'stored-key-4b2e8']

// The kubernetes.io/tls quick-insert list, and the entry this spec types.
const TLS_QUICK_INSERT_KEYS = ['tls.crt', 'tls.key']
const TYPED_KEY = 'tls.crt'
const TYPED_VALUE = 'typed-crt-9a4f2'

// The ConfigMap Data map, which is not a credential.
const CONFIG_ENTRIES: [string, string][] = [
  ['log_level', 'debug'],
  ['replica_hint', '2'],
]

/** The entry count a map trigger shows; only the unprotected trigger can render it. */
const ENTRY_COUNT = /\d+\s+entr(y|ies)/

function loadFixture(): Record<string, unknown> {
  return JSON.parse(
    fs.readFileSync(path.resolve(__dirname, '../../fixtures/secrets/k8s-apply-map-gate.json'), 'utf-8'),
  )
}

const paramRow = (sheet: Locator, name: string): Locator =>
  sheet.locator(`[data-testid="param-row-${name}"]`)

const protectedValue = (row: Locator): Locator =>
  row.locator('button[aria-label="Edit protected value"]')

// The one value field draws a map as one line, and its expand opens the map editor (FIELD-1).
const mapField = (row: Locator): Locator => row.locator('[data-slot="input-group"] input')
const mapExpand = (row: Locator): Locator => row.locator('[data-testid^="param-expand-"]')

const CONFIG_LINE = '{"log_level": "debug", "replica_hint": "2"}'
const TYPED_LINE = `{"${TYPED_KEY}": "${TYPED_VALUE}"}`

/** The shared "Edit value" sheet, a page-level overlay beside the config sheet. */
const mapEditor = (page: Page): Locator => page.locator('[data-testid="value-editor-sheet"]')

async function openConfig(page: Page, nodeId: string): Promise<Locator> {
  await page.locator(`[data-testid="workflow-node-${nodeId}"]`).locator('button').first().dblclick()
  const sheet = configSheet(page)
  await expect(sheet).toBeVisible({ timeout: 10_000 })
  return sheet
}

async function closeConfig(page: Page): Promise<void> {
  const sheet = configSheet(page)
  await sheet.locator('button[aria-label="Close"]').click()
  await expect(sheet).toBeHidden({ timeout: 10_000 })
  await clearPointerLock(page)
}

/** Apply the config sheet (its own Save), then persist the workbench draft. The
 *  post-save re-sync lands before the toolbar Save reads clean. */
async function applyConfigAndSave(page: Page): Promise<void> {
  const sheet = configSheet(page)
  const configSave = sheet.getByRole('button', { name: /^Save$/ }).last()
  await expect(configSave).toBeEnabled()
  await configSave.click()
  await expect(sheet).toBeHidden({ timeout: 10_000 })
  const toolbarSave = saveBtn(page)
  await expect(toolbarSave).toBeEnabled()
  await toolbarSave.click()
  await expect(toolbarSave).toBeDisabled({ timeout: 15_000 })
}

/** Reopen the same Test in a clean session, so nothing rides on the open canvas. */
async function reopenTest(page: Page, id: string): Promise<void> {
  await page.request.delete(`${BACKEND_URL}/workbench/session/`).catch(() => {})
  await page.goto(`/workbench?editTest=${id}`)
  await page.evaluate(() => localStorage.clear())
  await page.goto(`/workbench?editTest=${id}`)
  await waitForCanvasLoad(page)
}

/** A stored map credential renders as one protected value: the count, the keys and
 *  the values are all absent, and the entry count can only render on the map
 *  trigger, so the trigger's absence is the count's absence. */
async function expectProtectedMap(row: Locator, hidden: string[]): Promise<void> {
  await expect(row).toHaveCount(1)
  await expect(protectedValue(row)).toBeVisible()
  await expect(mapField(row)).toHaveCount(0)
  await expect(row).not.toHaveText(ENTRY_COUNT)
  await expect(row).not.toContainText(ENVELOPE)
  for (const text of hidden) await expect(row).not.toContainText(text)
}

/** The persisted Secret Data map, read back through the workflow route. */
async function persistedSecretData(page: Page, id: string): Promise<Record<string, unknown>> {
  const resp = await page.request.get(`${BACKEND_URL}/tests/${id}/workflow`)
  const body = await resp.json().catch(() => null)
  const nodes = (body?.data?.nodes ?? body?.nodes ?? []) as Array<{
    id: string
    data?: { config?: { values?: Record<string, unknown> } }
  }>
  const values = nodes.find((node) => node.id === SECRET_NODE)?.data?.config?.values
  return (values?.secret_data ?? {}) as Record<string, unknown>
}

/** Consent to the clear-and-retype and return the editor it opens. */
async function confirmClearAndEdit(page: Page, row: Locator): Promise<Locator> {
  await protectedValue(row).click()
  const confirm = page.getByRole('dialog').filter({ hasText: 'Edit Protected Value?' })
  await expect(confirm).toBeVisible()
  await confirm.getByRole('button', { name: /Delete & Edit/i }).click()
  const editor = mapEditor(page)
  await expect(editor).toBeVisible()
  return editor
}

/** Clear the stored map, insert a key from the quick-insert menu, type its value,
 *  and prove the entry stays readable while it is only typed. */
async function clearAndTypeSecretData(page: Page, row: Locator): Promise<void> {
  const editor = await confirmClearAndEdit(page, row)
  await expect(editor.locator('[data-testid="map-edit-body"]')).toBeVisible()
  await expect(editor.locator('[data-testid="map-edit-key-0"]')).toHaveCount(0)

  await editor.getByRole('button', { name: '+ Key' }).click()
  const menu = page.getByRole('menu')
  await expect(menu).toBeVisible()
  const items = await menu.getByRole('menuitem').allInnerTexts()
  expect(items.map((text) => text.trim())).toEqual(TLS_QUICK_INSERT_KEYS)
  await menu.getByRole('menuitem', { name: TYPED_KEY }).click()
  await expect(menu).toHaveCount(0)
  await clearPointerLock(page)

  await expect(editor.locator('[data-testid="map-edit-key-0"]')).toHaveValue(TYPED_KEY)
  await editor.locator('[data-testid="map-edit-value-0"]').fill(TYPED_VALUE)
  await editor.locator('[data-testid="value-editor-save-button"]').click()
  await editor.locator('[data-testid="value-editor-cancel-button"]').click()
  await expect(editor).toBeHidden()

  // Typed this session, not stored: the row shows its one line and its expand opens the editor.
  await expect(protectedValue(row)).toHaveCount(0)
  await expect(mapField(row)).toHaveValue(TYPED_LINE)

  await mapExpand(row).click()
  const reopened = mapEditor(page)
  await expect(reopened).toBeVisible()
  await expect(reopened.locator('[data-testid="map-edit-key-0"]')).toHaveValue(TYPED_KEY)
  await expect(reopened.locator('[data-testid="map-edit-value-0"]')).toHaveValue(TYPED_VALUE)
  await reopened.locator('[data-testid="value-editor-cancel-button"]').click()
  await expect(reopened).toBeHidden()
}

let testId = ''

test.describe('V-CRED-MAP-GATE-01: K8s Apply Secret Data map credential', () => {
  test.beforeEach(async ({ page }) => {
    // Masked baseline (credential_inputs off) so a sealed map renders write-only.
    await page.request.put(`${BACKEND_URL}/admin/secret-masking`, { data: MASKING_ALL_OFF })
    testId = await importValidateAndNavigate(page, loadFixture())
  })

  test.afterEach(async ({ page }) => {
    if (testId) await page.request.delete(`${BACKEND_URL}/tests/${testId}`).catch(() => {})
  })

  test('MG-a: a stored Secret Data map is one protected value; the ConfigMap Data map counts its entries', async ({
    page,
  }) => {
    const secretSheet = await openConfig(page, SECRET_NODE)
    await expectProtectedMap(paramRow(secretSheet, 'secret_data'), [
      ...STORED_KEYS,
      ...STORED_VALUES,
    ])
    // The sealed values never reach the sheet at all, not just the row.
    await expect(secretSheet).not.toContainText(ENVELOPE)
    for (const value of STORED_VALUES) await expect(secretSheet).not.toContainText(value)
    await closeConfig(page)

    const configSheetRow = paramRow(await openConfig(page, CONFIG_NODE), 'data')
    await expect(protectedValue(configSheetRow)).toHaveCount(0)
    await expect(mapField(configSheetRow)).toHaveValue(CONFIG_LINE)
  })

  test('MG-b: Cancel opens no editor and leaves the stored map untouched', async ({ page }) => {
    const before = await persistedSecretData(page, testId)
    expect(Object.keys(before).sort()).toEqual(STORED_KEYS)

    const row = paramRow(await openConfig(page, SECRET_NODE), 'secret_data')
    await protectedValue(row).click()
    const confirm = page.getByRole('dialog').filter({ hasText: 'Edit Protected Value?' })
    await expect(confirm).toBeVisible()
    await confirm.getByRole('button', { name: 'Cancel' }).click()
    await expect(confirm).toBeHidden()

    await expect(mapEditor(page)).toHaveCount(0)
    await expectProtectedMap(row, [...STORED_KEYS, ...STORED_VALUES])
    expect(await persistedSecretData(page, testId), 'Cancel must not touch the stored map').toEqual(
      before,
    )
  })

  test('MG-c: Delete & Edit clears the stored map and opens an empty key/value editor', async ({
    page,
  }) => {
    const row = paramRow(await openConfig(page, SECRET_NODE), 'secret_data')
    const editor = await confirmClearAndEdit(page, row)

    await expect(editor.locator('[data-testid="map-edit-body"]')).toBeVisible()
    await expect(editor.locator('[data-testid="map-edit-key-0"]')).toHaveCount(0)
    for (const value of STORED_VALUES) await expect(editor).not.toContainText(value)

    await editor.locator('[data-testid="value-editor-cancel-button"]').click()
    await expect(editor).toBeHidden()

    // The consent dropped the stored value: the row is no longer protected and
    // carries no count, because the cleared map has no entries.
    await expect(protectedValue(row)).toHaveCount(0)
    await expect(mapField(row)).toHaveValue('{}')
    await expect(row).not.toHaveText(ENTRY_COUNT)
  })

  test('MG-d: a typed map reads back as typed and one save protects it without a reload', async ({
    page,
  }) => {
    test.setTimeout(90_000)
    const sheet = await openConfig(page, SECRET_NODE)
    await clearAndTypeSecretData(page, paramRow(sheet, 'secret_data'))
    await applyConfigAndSave(page)

    // Reopened WITHOUT a page reload: the save re-sync masks the field write-only.
    const reopened = await openConfig(page, SECRET_NODE)
    await expectProtectedMap(paramRow(reopened, 'secret_data'), [TYPED_KEY, TYPED_VALUE])

    const persisted = await persistedSecretData(page, testId)
    expect(Object.keys(persisted), 'the typed key is the only one stored').toEqual([TYPED_KEY])
    for (const value of Object.values(persisted)) {
      expect(String(value).startsWith(ENVELOPE), 'every stored value is sealed').toBeTruthy()
    }
    expect(JSON.stringify(persisted), 'the typed value never persists cleartext').not.toContain(
      TYPED_VALUE,
    )
  })

  test('MG-e: after a reload the saved map stays protected and the ConfigMap Data map stays readable', async ({
    page,
  }) => {
    test.setTimeout(120_000)
    const sheet = await openConfig(page, SECRET_NODE)
    await clearAndTypeSecretData(page, paramRow(sheet, 'secret_data'))
    await applyConfigAndSave(page)

    await reopenTest(page, testId)

    const secretSheet = await openConfig(page, SECRET_NODE)
    await expectProtectedMap(paramRow(secretSheet, 'secret_data'), [TYPED_KEY, TYPED_VALUE])
    await closeConfig(page)

    // The same save left the non-credential map alone, keys and values included.
    const dataRow = paramRow(await openConfig(page, CONFIG_NODE), 'data')
    await expect(protectedValue(dataRow)).toHaveCount(0)
    await expect(mapField(dataRow)).toHaveValue(CONFIG_LINE)

    await mapExpand(dataRow).click()
    const editor = mapEditor(page)
    await expect(editor).toBeVisible()
    for (const [index, [key, value]] of CONFIG_ENTRIES.entries()) {
      await expect(editor.locator(`[data-testid="map-edit-key-${index}"]`)).toHaveValue(key)
      await expect(editor.locator(`[data-testid="map-edit-value-${index}"]`)).toHaveValue(value)
    }
  })
})
