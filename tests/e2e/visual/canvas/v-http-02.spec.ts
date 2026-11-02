/**
 * V-HTTP-02: HTTP Body Modes - Menu, Notes, Auto Headers, Section Cards, Ciphers, Proxy Row
 *
 * Phase: no-data (parallel) - seeds its own Tests via POST /tests; no DB reset.
 * Design Decisions: HTTP-13, SHELL-10, FIELD-10
 * Body rows live inside the collapsed Body section card (expand first); the
 * generated-Content-Type notes live in the styled param-notes container; the
 * Auto Headers checkbox drives the read-only generated row (on) or the amber
 * missing-header advisory (off); the group set is the section-card model
 * (name-only headers, no group-summary, no HTTP group footer); S6 exercises
 * the two-table cipher picker opened from the Cipher Suites field's expand.
 * REQ: REQ-3.4.1.4, REQ-3.4.3.9, REQ-3.1.1.5
 *
 * Pass Criteria:
 * 1. GET shows Body Mode Text + the retained JSON body; the JSON-without-CT
 *    advisory shows and clears when a Content-Type row is added
 * 2. Body Mode menu lists the four modes with the Multipart/File sublabels
 * 3. Form mode: generated-CT note in the notes container; Auto Headers on ->
 *    read-only generated row; off -> amber Expected-headers icon + advisory stripe
 * 4. Section cards: the group set, name-only headers, no group-summary,
 *    no HTTP group footer, an SSH group footer spot-check, the Secrets card
 * 5. Draft retention across mode switches
 * 6. Cipher picker (from the field's expand): two range-filtered tables, the default
 *    state `All 24 enabled` with the note `Default`, uncheck materializes explicit,
 *    Reset, explicit order + zero persistence
 * 7. Proxy row: the Connection group holds Allow Redirects, Max Redirects and Proxy
 *    and no Proxy URL row; the menu lists exactly "WAVE setting" (the default) and
 *    "Off", the row takes no expression, and each choice is saved as its own
 *    value (`wave-setting`, `off`); the same holds in the light theme
 * 8. A block inside a Remote Execution body shows the Proxy row at 50 percent
 *    opacity with the not-allowed cursor; its control is disabled, reads
 *    "Remote host's settings" whatever choice is stored and opens no menu; the
 *    rows beside it keep full strength; the same holds in the light theme
 */

import { test, expect, type Page, type Locator } from '../../helpers/playwright-fixtures'
import { importValidateAndNavigate } from '../../helpers/fixture-import'
import { toggleTheme } from '../../helpers/theme'
import { configSheet, saveBtn } from '../../helpers/workbench'
import { getNode } from '../../helpers/element-types'
import { handleEdge, remoteExecutionNode, sshSessionOpenNode } from '../../helpers/k8s-nodes'

const JSON_BODY = '{"query": {"match": {"status": "open"}}}'
const FORM_CT_NOTE = 'Content-Type: application/x-www-form-urlencoded - set automatically'
const FORM_CT_MISSING = 'Content-Type is not set - the transport will send its own default'

// Concrete catalog names (host-independent fixed inventory, tls_capabilities.py).
const CIPHER_12 = 'ECDHE-RSA-AES128-GCM-SHA256' // min==max 1.2 -> compat tag "1.2"
const CIPHER_SPAN = 'ECDHE-RSA-AES256-SHA' // 1.0-1.2 -> compat tag "1.0-1.2"
const CIPHER_13 = 'TLS_AES_128_GCM_SHA256' // 1.3 family (table 2)

const PROXY_LABELS = ['WAVE setting', 'Off']
const REMOTE_PROXY_TEXT = "Remote host's settings"

function httpNode(id: string, y: number, values: Record<string, unknown>, x = 320) {
  return {
    id,
    type: 'workflowNode',
    position: { x, y },
    data: {
      label: 'HTTP',
      elementType: 'http-client',
      nodeType: 'plugin',
      category: 'network',
      version: '1.0.0',
      description: id,
      hasNewerVersion: false,
      expressionFields: [],
      templateFields: [],
      config: { values, outputBindings: {}, profileBindings: [] },
    },
    measured: { width: 120, height: 62 },
  }
}

function buildFixture() {
  return {
    name: 'V-HTTP-02 Body Modes',
    version: '1.0.0',
    description: '',
    workflow: {
      nodes: [
        httpNode('http-get', 160, {
          url: 'https://api.example.com/v1/orders',
          method: 'GET',
          headers: { 'X-Trace-Id': 'wave-1' },
          body: JSON_BODY,
          timeout: 30,
        }),
        httpNode('http-form', 280, {
          url: 'https://api.example.com/v1/login',
          method: 'POST',
          body_mode: 'form',
          form_fields: { username: 'alice', grant_type: 'password', scope: 'orders:read' },
          timeout: 30,
        }),
        // Explicit ordered cipher subset (order persists through load).
        httpNode('http-cipher-explicit', 400, {
          url: 'https://api.example.com/v1/orders',
          method: 'GET',
          cipher_suites: [CIPHER_12, CIPHER_SPAN],
          timeout: 30,
        }),
        // Explicit-zero ciphers (a valid, saveable state distinct from default).
        httpNode('http-cipher-zero', 520, {
          url: 'https://api.example.com/v1/orders',
          method: 'GET',
          cipher_suites: [],
          timeout: 30,
        }),
      ],
      edges: [
        { id: 'e-start', source: 'start-node', target: 'http-get' },
        { id: 'e-1', source: 'http-get', target: 'http-form' },
        { id: 'e-2', source: 'http-form', target: 'http-cipher-explicit' },
        { id: 'e-3', source: 'http-cipher-explicit', target: 'http-cipher-zero' },
      ],
    },
    variables: {},
    metadata: { tags: [], suite_id: null, parent_suite: null },
  }
}

/** A single SSH Session Open node - its Connection group carries a description,
 *  so it exercises the group-footer mechanism HTTP groups never trigger. */
function buildSshFixture() {
  return {
    name: 'V-HTTP-02 SSH footer spot-check',
    version: '1.0.0',
    description: '',
    workflow: {
      nodes: [
        {
          id: 'ssh-open',
          type: 'workflowNode',
          position: { x: 320, y: 160 },
          data: {
            label: 'SSH Session Open',
            elementType: 'ssh-session-open',
            nodeType: 'plugin',
            category: 'remote',
            version: '1.0.0',
            description: 'ssh-open',
            hasNewerVersion: false,
            expressionFields: [],
            templateFields: [],
            config: {
              values: { host: 'example.com', port: 22, username: 'wave', password: 'pw' },
              outputBindings: {},
              profileBindings: [],
            },
          },
          measured: { width: 160, height: 62 },
        },
      ],
      edges: [{ id: 'e-start', source: 'start-node', target: 'ssh-open' }],
    },
    variables: {},
    metadata: { tags: [], suite_id: null, parent_suite: null },
  }
}

/** One HTTP block inside a Remote Execution body and two after it (HTTP-13). */
function buildProxyFixture() {
  const url = 'https://example.com/health'
  return {
    name: 'V-HTTP-02 Proxy Row',
    version: '1.0.0',
    description: '',
    workflow: {
      nodes: [
        sshSessionOpenNode({
          id: 'proxy-ssh',
          values: { host: 'example.com', port: 22, username: 'wave', password: 'pw' },
          outputBindings: { session_id: 'sid' },
          position: { x: 320, y: 120 },
        }),
        remoteExecutionNode({
          id: 'proxy-rx',
          values: { session_id: 'sid' },
          expressionFields: ['session_id'],
          position: { x: 320, y: 240 },
        }),
        // A stored Off never shows while the block runs on the remote host.
        httpNode('http-remote', 380, { url, method: 'GET', proxy_mode: 'off' }, 180),
        httpNode('http-local', 380, { url, method: 'GET' }, 460),
        httpNode('http-off', 500, { url, method: 'GET', proxy_mode: 'off' }, 460),
      ],
      edges: [
        { id: 'e-start', source: 'start-node', target: 'proxy-ssh' },
        { id: 'e-ssh', source: 'proxy-ssh', target: 'proxy-rx' },
        handleEdge('proxy-rx', 'body', 'http-remote'),
        handleEdge('proxy-rx', 'then', 'http-local'),
        { id: 'e-local', source: 'http-local', target: 'http-off' },
      ],
    },
    variables: { sid: { value: '', type: 'string', scope: 'test' } },
    metadata: { tags: [], suite_id: null, parent_suite: null },
  }
}

async function openConfig(page: Page, nodeId: string): Promise<Locator> {
  await page.locator(`[data-testid="workflow-node-${nodeId}"]`).dblclick()
  const sheet = configSheet(page)
  await expect(sheet).toBeVisible()
  return sheet
}

/** Expand a (default-collapsed) group card once. */
async function expandGroup(sheet: Locator, name: string) {
  await sheet.locator(`[data-testid="group-header-${name}"]`).click()
}

function proxyRow(sheet: Locator): Locator {
  return sheet.locator('[data-testid="param-row-proxy_mode"]')
}

/** Open the Proxy menu: it lists the two choices in order with `current` checked. */
async function openProxyMenu(page: Page, sheet: Locator, current: string): Promise<Locator> {
  const trigger = proxyRow(sheet).getByRole('combobox')
  await expect(trigger).toHaveText(current)
  await expect(trigger).toBeEnabled()
  await trigger.click()
  const options = page.getByRole('option')
  await expect(options).toHaveText(PROXY_LABELS)
  await expect(options.nth(PROXY_LABELS.indexOf(current))).toHaveAttribute('data-state', 'checked')
  await expect(page.locator('[role="option"][data-state="checked"]')).toHaveCount(1)
  return options
}

async function saveSheet(sheet: Locator) {
  await sheet.getByRole('button', { name: 'Save', exact: true }).last().click()
  await expect(sheet).toHaveCount(0)
}

async function cancelSheet(sheet: Locator) {
  await sheet.getByRole('button', { name: 'Cancel', exact: true }).last().click()
  await expect(sheet).toHaveCount(0)
}

async function selectBodyMode(page: Page, sheet: Locator, label: string) {
  await sheet.locator('[data-testid="param-row-body_mode"] button[role="combobox"]').click()
  await page.getByRole('option', { name: label }).click()
}

/** The one value field's text box of a row (FIELD-1). */
function fieldBox(sheet: Locator, name: string): Locator {
  return sheet.locator(`[data-testid="param-row-${name}"] [data-slot="input-group"] input`).first()
}

async function openCipherPicker(sheet: Locator): Promise<void> {
  await sheet.getByRole('button', { name: 'Open editor for Cipher Suites', exact: true }).click()
}

async function openHeadersEditor(page: Page, sheet: Locator): Promise<Locator> {
  await sheet.getByRole('button', { name: 'Open editor for Headers', exact: true }).click()
  const editor = page.locator('[data-testid="value-editor-sheet"]')
  await expect(editor).toBeVisible()
  return editor
}

test.describe('V-HTTP-02: HTTP body modes', () => {
  test('V-HTTP-02-S1: GET-with-body + JSON advisory add/remove (HTTP-6/8)', async ({ page }) => {
    await importValidateAndNavigate(page, buildFixture())
    const sheet = await openConfig(page, 'http-get')

    // Body rows live inside the collapsed Body section card.
    await expandGroup(sheet, 'Body')

    // 1. Body Mode row shows Text; the Body row carries the seeded JSON draft
    const modeTrigger = sheet.locator('[data-testid="param-row-body_mode"] button[role="combobox"]')
    await expect(modeTrigger).toContainText('Text')
    const methodTrigger = sheet.locator('[data-testid="param-row-method"] button[role="combobox"]')
    await expect(methodTrigger).toContainText('GET')
    const bodyRow = sheet.locator('[data-testid="param-row-body"]')
    await expect(bodyRow).toBeVisible()
    await expect(fieldBox(sheet, 'body')).toHaveValue(JSON_BODY)

    // 2. JSON body without a Content-Type header row -> amber in-field advisory
    const advisory = bodyRow.locator('[aria-label="Missing Content-Type"]')
    await expect(advisory).toBeVisible()

    // Adding a Content-Type header (via the scaffold) clears the advisory
    const editor = await openHeadersEditor(page, sheet)
    await editor.getByRole('button', { name: '+ Content-Type' }).click()
    await page.getByRole('menuitem', { name: 'application/json' }).click()
    await editor.locator('[data-testid="value-editor-save-button"]').click()
    await editor.locator('[data-testid="value-editor-cancel-button"]').click()
    await expect(editor).not.toBeVisible()
    await expect(advisory).toHaveCount(0)
  })

  test('V-HTTP-02-S2: Body Mode menu labels + muted sublabels (HTTP-9)', async ({ page }) => {
    await importValidateAndNavigate(page, buildFixture())
    const sheet = await openConfig(page, 'http-get')
    await expandGroup(sheet, 'Body')

    await sheet.locator('[data-testid="param-row-body_mode"] button[role="combobox"]').click()
    const options = page.locator('[role="option"]')
    await expect(options).toHaveCount(4)

    // 3. Exact order and labels
    await expect(options.nth(0)).toHaveText('Text')
    await expect(options.nth(1)).toHaveText('Form (URL-encoded)')
    await expect(options.nth(2)).toContainText('Multipart (form-data)')
    await expect(options.nth(3)).toContainText('File')

    // Muted sublabels render inside the Multipart and File entries
    await expect(options.nth(2).locator('.text-muted-foreground')).toHaveText('file upload')
    await expect(options.nth(3).locator('.text-muted-foreground')).toHaveText('file as body')
    await page.keyboard.press('Escape')
  })

  test('V-HTTP-02-S3: form mode note + Auto Headers generated row / advisory', async ({
    page,
  }) => {
    await importValidateAndNavigate(page, buildFixture())
    const sheet = await openConfig(page, 'http-form')
    await expandGroup(sheet, 'Body')

    // 4. Form Fields row visible with its 3 seeded entries; Body row hidden
    const formRow = sheet.locator('[data-testid="param-row-form_fields"]')
    await expect(formRow).toBeVisible()
    await expect(fieldBox(sheet, 'form_fields')).toHaveValue(
      '{"username": "alice", "grant_type": "password", "scope": "orders:read"}',
    )
    await expect(sheet.locator('[data-testid="param-row-body"]')).not.toBeVisible()

    // The generated-CT note lives inside the styled notes container
    await expect(sheet.locator('[data-testid="param-notes-Body"]')).toBeVisible()
    await expect(sheet.locator('[data-testid="param-note-form_fields"]')).toContainText(FORM_CT_NOTE)

    // Auto Headers defaults ON
    const autoHeaders = sheet.locator(
      '[data-testid="param-row-body_auto_headers"] button[role="checkbox"]',
    )
    await expect(autoHeaders).toHaveAttribute('data-state', 'checked')

    // ON -> the headers editor shows the generated read-only Content-Type row
    let editor = await openHeadersEditor(page, sheet)
    await expect(editor.locator('[data-testid="map-generated-key-0"]')).toHaveValue('Content-Type')
    await expect(editor.locator('[data-testid="map-generated-value-0"]')).toHaveValue(
      'application/x-www-form-urlencoded',
    )
    await editor.locator('[data-testid="value-editor-cancel-button"]').click()
    await expect(editor).not.toBeVisible()

    // OFF -> amber Expected-headers icon on the Headers row + advisory stripe
    await autoHeaders.click()
    await expect(autoHeaders).toHaveAttribute('data-state', 'unchecked')
    await expect(
      sheet.locator('[data-testid="param-row-headers"]').locator('[aria-label="Expected headers missing"]'),
    ).toBeVisible()

    editor = await openHeadersEditor(page, sheet)
    const advisoryStripe = editor.locator('[data-testid="value-editor-advisory"]')
    await expect(advisoryStripe).toContainText(FORM_CT_MISSING)
    // Only Content-Type is ever generated, so the strip carries one message (no expander)
    await expect(editor.locator('[data-testid="value-editor-advisory-more"]')).toHaveCount(0)
    await expect(editor.locator('[data-testid="map-generated-key-0"]')).toHaveCount(0)
  })

  test('V-HTTP-02-S4: section cards - group set, no summaries/footers, SSH footer, Secrets', async ({
    page,
  }) => {
    await importValidateAndNavigate(page, buildFixture())
    const sheet = await openConfig(page, 'http-get')

    // 5. The section-card group set; the Security decoy is gone
    for (const name of ['Auth', 'Body', 'Timeouts & Retries', 'Response', 'TLS / Certificates', 'Connection']) {
      await expect(sheet.locator(`[data-testid="group-header-${name}"]`)).toBeVisible()
    }
    await expect(sheet.locator('[data-testid="group-header-Security"]')).toHaveCount(0)

    // No group-summary anywhere
    await expect(sheet.locator('[data-testid^="group-summary-"]')).toHaveCount(0)

    // No HTTP group carries a footer note (all bare group())
    await expect(sheet.locator('[data-testid^="group-footer-"]')).toHaveCount(0)

    // Response group: File reveals File Path; Max Size present
    await expandGroup(sheet, 'Response')
    const responseTrigger = sheet.locator('[data-testid="param-row-response_mode"] button[role="combobox"]')
    await expect(responseTrigger).toContainText('Body')
    await expect(sheet.locator('[data-testid="param-row-max_size"]')).toBeVisible()
    await expect(sheet.locator('[data-testid="param-row-file_path"]')).not.toBeVisible()
    await responseTrigger.click()
    await page.getByRole('option', { name: 'File' }).click()
    await expect(sheet.locator('[data-testid="param-row-file_path"]')).toBeVisible()

    // TLS / Certificates group: verify + CA + mTLS rows + Min/Max TLS + Cipher Suites
    await expandGroup(sheet, 'TLS / Certificates')
    for (const param of [
      'verify_ssl',
      'ca_cert',
      'client_cert',
      'client_key',
      'tls_min_version',
      'tls_max_version',
      'cipher_suites',
    ]) {
      await expect(sheet.locator(`[data-testid="param-row-${param}"]`)).toBeVisible()
    }

    // Connection group: redirects + proxy (HTTP/1.1 only, no HTTP/2); no Proxy URL row (HTTP-13)
    await expandGroup(sheet, 'Connection')
    for (const param of ['allow_redirects', 'max_redirects', 'proxy_mode']) {
      await expect(sheet.locator(`[data-testid="param-row-${param}"]`)).toBeVisible()
    }
    await expect(sheet.locator('[data-testid="param-row-http2"]')).toHaveCount(0)
    await expect(sheet.locator('[data-testid="param-row-proxy_url"]')).toHaveCount(0)

    // The Secrets section at the sheet bottom carries the same card chrome
    await expect(sheet.locator('[data-testid="secrets-section-trigger"]')).toBeVisible()

    // SSH spot-check: a group WITH a description renders the footer mechanism
    await importValidateAndNavigate(page, buildSshFixture())
    const sshSheet = await openConfig(page, 'ssh-open')
    await expect(sshSheet.locator('[data-testid="group-footer-Connection"]')).toContainText(
      'Target host and credentials',
    )
  })

  test('V-HTTP-02-S5: draft retention across mode switches (HTTP-14)', async ({ page }) => {
    await importValidateAndNavigate(page, buildFixture())
    const sheet = await openConfig(page, 'http-get')
    await expandGroup(sheet, 'Body')

    const bodyRow = sheet.locator('[data-testid="param-row-body"]')
    await expect(fieldBox(sheet, 'body')).toHaveValue(JSON_BODY)

    // 6. Text -> Form: Body hides, Form Fields appears
    await selectBodyMode(page, sheet, 'Form (URL-encoded)')
    await expect(bodyRow).not.toBeVisible()
    await expect(sheet.locator('[data-testid="param-row-form_fields"]')).toBeVisible()

    // Form -> Text: the Body draft SURVIVED the mode switch (retainOnHide)
    await selectBodyMode(page, sheet, 'Text')
    await expect(bodyRow).toBeVisible()
    await expect(fieldBox(sheet, 'body')).toHaveValue(JSON_BODY)
  })

  test('V-HTTP-02-S6: two-table cipher picker - default, materialize, reset, order, zero (HTTP-16)', async ({
    page,
  }) => {
    await importValidateAndNavigate(page, buildFixture())

    // --- Default state (fresh node, cipher_suites unset) ---
    const sheet = await openConfig(page, 'http-get')
    await expandGroup(sheet, 'TLS / Certificates')
    await openCipherPicker(sheet)
    const picker = page.locator('[data-testid="cipher-picker-sheet"]')
    await expect(picker).toBeVisible()
    await expect(picker.locator('[data-testid="cipher-picker-type-badge"]')).toHaveText('ciphers')

    // Both range-filtered tables render at the default 1.2-1.3 range (all 24 rows)
    const table12 = picker.locator('[data-testid="cipher-table-tls12"]')
    const table13 = picker.locator('[data-testid="cipher-table-tls13"]')
    await expect(table12).toBeVisible()
    await expect(table13).toBeVisible()

    // Default (undefined store): every visible row enabled + the defaults note
    await expect(picker.locator('[data-testid="cipher-picker-metric"]')).toHaveText('All 24 enabled')
    await expect(picker.locator('[data-testid="cipher-picker-defaults-note"]')).toHaveText('Default')
    await expect(picker.locator('[data-testid="cipher-picker-reset-button"]')).toHaveCount(0)

    // All-enabled means every row is selected -> a drag handle on every row;
    // table 1 carries a compat tag, table 2 does not
    await expect(picker.locator('[data-testid^="cipher-drag-"]')).toHaveCount(24)
    await expect(picker.locator(`[data-testid="cipher-tag-${CIPHER_12}"]`)).toHaveText('1.2')
    await expect(picker.locator(`[data-testid="cipher-tag-${CIPHER_SPAN}"]`)).toHaveText('1.0-1.2')
    await expect(picker.locator(`[data-testid="cipher-tag-${CIPHER_13}"]`)).toHaveCount(0)

    // Unchecking one materializes the explicit kept set (23 selected, Reset appears)
    await picker.locator(`[data-testid="cipher-toggle-${CIPHER_12}"]`).click()
    await expect(picker.locator('[data-testid="cipher-picker-metric"]')).toHaveText('23 selected')
    await expect(picker.locator('[data-testid="cipher-picker-defaults-note"]')).toHaveCount(0)
    const resetBtn = picker.locator('[data-testid="cipher-picker-reset-button"]')
    await expect(resetBtn).toBeVisible()

    // Reset returns to the undefined-store default
    await resetBtn.click()
    await expect(picker.locator('[data-testid="cipher-picker-metric"]')).toHaveText('All 24 enabled')
    await expect(picker.locator('[data-testid="cipher-picker-defaults-note"]')).toBeVisible()
    await picker.locator('[data-testid="cipher-picker-cancel-button"]').click()
    await expect(picker).not.toBeVisible()
    await sheet.getByRole('button', { name: 'Cancel' }).last().click()
    const unsavedClose = page.getByTestId('unsaved-close')
    if (await unsavedClose.isVisible({ timeout: 500 }).catch(() => false)) await unsavedClose.click()

    // --- Explicit ordered subset (order persists through load) ---
    const explicitSheet = await openConfig(page, 'http-cipher-explicit')
    await expandGroup(explicitSheet, 'TLS / Certificates')
    await openCipherPicker(explicitSheet)
    const explicitPicker = page.locator('[data-testid="cipher-picker-sheet"]')
    await expect(explicitPicker).toBeVisible()
    await expect(explicitPicker.locator('[data-testid="cipher-picker-metric"]')).toHaveText(
      '2 selected',
    )
    // The two seeded ciphers render selected, at the top of table 1, in stored order
    const selectedRows = explicitPicker.locator('[data-testid="cipher-table-tls12"] [data-testid^="cipher-row-"]')
    await expect(selectedRows.nth(0)).toHaveAttribute('data-testid', `cipher-row-${CIPHER_12}`)
    await expect(selectedRows.nth(1)).toHaveAttribute('data-testid', `cipher-row-${CIPHER_SPAN}`)
    await expect(explicitPicker.locator(`[data-testid="cipher-toggle-${CIPHER_12}"]`)).toHaveAttribute(
      'data-state',
      'checked',
    )
    await explicitPicker.locator('[data-testid="cipher-picker-cancel-button"]').click()
    await explicitSheet.getByRole('button', { name: 'Cancel' }).last().click()
    const unsavedClose2 = page.getByTestId('unsaved-close')
    if (await unsavedClose2.isVisible({ timeout: 500 }).catch(() => false)) await unsavedClose2.click()

    // --- Explicit zero (valid, distinct from default) ---
    const zeroSheet = await openConfig(page, 'http-cipher-zero')
    await expandGroup(zeroSheet, 'TLS / Certificates')
    await openCipherPicker(zeroSheet)
    const zeroPicker = page.locator('[data-testid="cipher-picker-sheet"]')
    await expect(zeroPicker).toBeVisible()
    await expect(zeroPicker.locator('[data-testid="cipher-picker-metric"]')).toHaveText('0 selected')
    await expect(zeroPicker.locator('[data-testid="cipher-picker-defaults-note"]')).toHaveCount(0)
    // Explicit zero is saveable (Save enabled once the catalog loaded)
    await expect(zeroPicker.locator('[data-testid="cipher-picker-save-button"]')).toBeEnabled()
  })

  test('V-HTTP-02-S7: Proxy row - WAVE setting and Off, no Proxy URL row, each choice saved as its value (HTTP-13)', async ({
    page,
  }) => {
    const testId = await importValidateAndNavigate(page, buildProxyFixture())

    let sheet = await openConfig(page, 'http-local')
    await expandGroup(sheet, 'Connection')

    // 7. The group holds these three rows and nothing else
    const groupRows = sheet
      .locator('[data-testid="group-header-Connection"]')
      .locator('xpath=..')
      .locator('tr[data-testid^="param-row-"]')
    await expect(groupRows).toHaveCount(3)
    expect(await groupRows.evaluateAll((rows) => rows.map((row) => row.getAttribute('data-testid')))).toEqual([
      'param-row-allow_redirects',
      'param-row-max_redirects',
      'param-row-proxy_mode',
    ])
    await expect(sheet.locator('[data-testid="param-row-proxy_url"]')).toHaveCount(0)

    // The row is at full strength and takes no expression
    await expect(proxyRow(sheet)).toHaveCSS('opacity', '1')
    await expect(proxyRow(sheet).locator('[data-testid="expression-toggle"]')).toHaveCount(0)

    // An unset choice reads the default; Off replaces it
    let options = await openProxyMenu(page, sheet, 'WAVE setting')
    await options.nth(1).click()
    await expect(proxyRow(sheet).getByRole('combobox')).toHaveText('Off')
    await saveSheet(sheet)

    // A stored Off reads "Off"; WAVE setting replaces it
    sheet = await openConfig(page, 'http-off')
    await expandGroup(sheet, 'Connection')
    options = await openProxyMenu(page, sheet, 'Off')
    await options.nth(0).click()
    await expect(proxyRow(sheet).getByRole('combobox')).toHaveText('WAVE setting')
    await saveSheet(sheet)

    // Each choice is saved as its own value
    await expect(saveBtn(page)).toBeEnabled()
    await saveBtn(page).click()
    await expect(saveBtn(page)).toBeDisabled({ timeout: 15_000 })
    const stored = async (nodeId: string) =>
      (await getNode(page.request, testId, nodeId)).data.config.values.proxy_mode
    expect(await stored('http-local')).toBe('off')
    expect(await stored('http-off')).toBe('wave-setting')

    // The other theme shows the same menu
    await toggleTheme(page)
    sheet = await openConfig(page, 'http-local')
    await expandGroup(sheet, 'Connection')
    await openProxyMenu(page, sheet, 'Off')
    await page.keyboard.press('Escape')
    await expect(page.getByRole('option')).toHaveCount(0)
    await cancelSheet(sheet)
  })

  test("V-HTTP-02-S8: inside Remote Execution the Proxy row is grayed out and reads Remote host's settings (HTTP-13)", async ({
    page,
  }) => {
    await importValidateAndNavigate(page, buildProxyFixture())
    await expect(
      page.locator('[data-testid="workflow-node-http-remote"] [data-testid="node-remote-locus-badge"]'),
    ).toHaveAttribute('data-locus', 'R')

    const expectLockedRow = async () => {
      const sheet = await openConfig(page, 'http-remote')
      await expandGroup(sheet, 'Connection')

      // 8. The row carries the fade once and the not-allowed cursor
      const row = proxyRow(sheet)
      await expect(row).toHaveCSS('opacity', '0.5')
      await expect(row).toHaveCSS('cursor', 'not-allowed')
      const trigger = row.getByRole('combobox')
      await expect(trigger).toBeDisabled()
      await expect(trigger).toHaveText(REMOTE_PROXY_TEXT)
      await expect(trigger).toHaveCSS('opacity', '1')
      await expect(row.locator('[data-testid="expression-toggle"]')).toHaveCount(0)

      // The rows beside it keep full strength
      for (const param of ['allow_redirects', 'max_redirects']) {
        await expect(sheet.locator(`[data-testid="param-row-${param}"]`)).toHaveCSS('opacity', '1')
      }

      // A click opens no menu
      await trigger.click({ force: true })
      await expect(trigger).toHaveAttribute('aria-expanded', 'false')
      await expect(page.getByRole('option')).toHaveCount(0)
      await cancelSheet(sheet)
    }

    await test.step('in the project theme', expectLockedRow)
    await test.step('and again in the other theme', async () => {
      await toggleTheme(page)
      await expectLockedRow()
    })
  })
})
