/**
 * V-PLUGIN-K8S-01: K8s Connect config sheet
 *
 * Phase: no-data (parallel) - palette drag-drop only, no backend data needed.
 * Runs under both dark and light projects (theme-agnostic DOM assertions).
 * REQ: REQ-5.1.1, REQ-3.4.1.5
 * Design Decisions: K8SCON-1 through K8SCON-6
 *
 * Pass Criteria:
 *   K-a  dragging the K8s Connect palette item onto the canvas and configuring
 *        it opens the config sheet
 *   K-b  exactly three group headers render, in order Connection /
 *        Authentication / TLS / Certificates - no Advanced group, no Run Token
 *        group - and each expanded card carries its exact footer description
 *   K-c  the 16 input rows render in the exact schema order (the three
 *        run-token rows appear once Get SA Token is checked)
 *   K-d  credentials are modeless: Bearer Token and the client cert pair are
 *        visible simultaneously with no auth-mode selector anywhere
 *   K-e  Get SA Token gates its three sub-rows: absent until checked, then
 *        visible, and a typed Service Account value survives hide/reveal
 *   K-f  API URL is the only input carrying the required *; Service Account
 *        carries it while revealed
 *   K-g  every input row leads with the (i) info badge; the expression toggle
 *        is present on API URL and absent on both TLS version enums
 *   K-h  outputs render K8s Session then Cluster Version; the session Secret
 *        checkbox is checked by default with no lock affordance, and the
 *        cluster-version one is unchecked
 *   K-i  a freshly opened sheet is not dirty: Escape closes it silently with
 *        no Unsaved-changes dialog
 *   K-j  unchecking the session Secret checkbox and saving persists: the
 *        reopened sheet shows it still unchecked
 *   K-k  the labels read exactly Bearer Token, Get SA Token, and Verify
 *        Server Certificate
 */

import { test, expect, type Page, type Locator } from '../../helpers/playwright-fixtures'
import { expectStringParamPreview } from '../../helpers/param-config'
import { dragPaletteItemToCanvas, waitForCanvasLoad } from '../../helpers/canvas'
import { configSheet, openSelectedBlockSheet } from '../../helpers/workbench'
import { BACKEND_URL } from '../../helpers/config'

const DEFAULT_ROWS = [
  'api_url',
  'namespace',
  'timeout',
  'token',
  'acquire_run_token',
  'verify_ssl',
  'ca_cert',
  'tls_server_name',
  'client_cert',
  'client_key',
  'tls_min_version',
  'tls_max_version',
  'cipher_suites',
]
const RUN_TOKEN_ROWS = ['run_token_service_account', 'run_token_namespace', 'run_token_duration']
const ALL_ROWS = [
  ...DEFAULT_ROWS.slice(0, 5),
  ...RUN_TOKEN_ROWS,
  ...DEFAULT_ROWS.slice(5),
]

const GROUP_FOOTERS: Record<string, string> = {
  'Connection': 'API server URL, default namespace, and request timeout',
  'Authentication':
    'How WAVE identifies itself to the cluster: an optional bearer token, a TLS client certificate, or neither (anonymous or proxied access)',
  'TLS / Certificates':
    "Server trust and TLS behavior. A client certificate the cluster's client CA recognizes is also the identity WAVE presents",
}

async function openK8sConfig(page: Page): Promise<Locator> {
  await page.request.delete(`${BACKEND_URL}/workbench/session/`).catch(() => {})
  await page.goto('/workbench')
  await page.evaluate(() => localStorage.clear())
  await page.goto('/workbench')
  await waitForCanvasLoad(page)

  const canvas = page.locator('[data-testid="workflow-canvas"]')
  const box = await canvas.boundingBox()
  await dragPaletteItemToCanvas(
    page,
    { term: 'k8s', testId: 'palette-item-k8s-connect' },
    { x: box!.width / 2, y: box!.height / 2 },
  )

  const node = page.locator('[data-testid^="workflow-node-"][data-nodetype]').first()
  await node.locator('button').first().dispatchEvent('click')
  await expect(node).toHaveAttribute('data-selected', 'true')

  await openSelectedBlockSheet(page)
  const modal = configSheet(page)
  await expect(modal).toBeVisible()
  return modal
}

const paramRow = (modal: Locator, name: string) =>
  modal.locator(`[data-testid="param-row-${name}"]`)

const runTokenCheckbox = (modal: Locator) =>
  paramRow(modal, 'acquire_run_token').locator('button[role="checkbox"]')

async function setStringValue(page: Page, modal: Locator, param: string, text: string) {
  await paramRow(modal, param).scrollIntoViewIfNeeded()
  await modal.locator(`[data-testid="param-expand-${param}"]`).click()
  const editor = page.locator('[data-testid="value-editor-sheet"]')
  await expect(editor).toBeVisible()
  await editor.locator('.cm-content').click()
  await page.keyboard.press('Control+a')
  await page.keyboard.type(text)
  await editor.locator('[data-testid="value-editor-save-button"]').click()
  await editor.locator('[data-testid="value-editor-cancel-button"]').click()
  await expect(editor).not.toBeVisible()
}

test.describe('V-PLUGIN-K8S-01: K8s Connect config sheet', () => {
  test('K-a/K-b: three groups in order with their exact footer notes, no Advanced or Run Token group', async ({
    page,
  }) => {
    const modal = await openK8sConfig(page)

    const headers = modal.locator('[data-testid^="group-header-"]')
    await expect(headers).toHaveCount(3)
    const names = await headers.evaluateAll((els) =>
      els.map((el) => (el.getAttribute('data-testid') ?? '').replace('group-header-', '')),
    )
    expect(names).toEqual(['Connection', 'Authentication', 'TLS / Certificates'])

    await expect(modal.locator('[data-testid="group-header-Advanced"]')).toHaveCount(0)
    await expect(modal.locator('[data-testid="group-header-Run Token"]')).toHaveCount(0)

    // All three cards are expanded by default, each with its footer description.
    for (const [name, footer] of Object.entries(GROUP_FOOTERS)) {
      await expect(modal.locator(`[data-testid="group-footer-${name}"]`)).toContainText(footer)
    }
  })

  test('K-c: the 16 input rows render in exact schema order', async ({ page }) => {
    const modal = await openK8sConfig(page)

    // Run-token sub-rows are gated off, leaving 13 rows by default.
    const rows = modal.locator('[data-testid^="param-row-"]')
    await expect(rows).toHaveCount(13)
    const defaultIds = await rows.evaluateAll((els) =>
      els.map((el) => (el.getAttribute('data-testid') ?? '').replace('param-row-', '')),
    )
    expect(defaultIds).toEqual(DEFAULT_ROWS)

    // Revealing the run-token rows completes the 16-row schema order.
    await runTokenCheckbox(modal).click()
    await expect(rows).toHaveCount(16)
    const allIds = await rows.evaluateAll((els) =>
      els.map((el) => (el.getAttribute('data-testid') ?? '').replace('param-row-', '')),
    )
    expect(allIds).toEqual(ALL_ROWS)
  })

  test('K-d/K-k: modeless credentials - token and cert pair together, no auth-mode selector, exact labels', async ({
    page,
  }) => {
    const modal = await openK8sConfig(page)

    // K8SCON-1: no mode switch - token and client cert pair coexist.
    await expect(paramRow(modal, 'token')).toBeVisible()
    await expect(paramRow(modal, 'client_cert')).toBeVisible()
    await expect(paramRow(modal, 'client_key')).toBeVisible()
    await expect(modal.locator('[data-testid="param-row-auth_mode"]')).toHaveCount(0)
    await expect(paramRow(modal, 'token').getByRole('combobox')).toHaveCount(0)
    await expect(paramRow(modal, 'client_cert').getByRole('combobox')).toHaveCount(0)

    // K-k: exact labels.
    await expect(paramRow(modal, 'token').getByText('Bearer Token', { exact: true })).toBeVisible()
    await expect(
      paramRow(modal, 'acquire_run_token').getByText('Get SA Token', { exact: true }),
    ).toBeVisible()
    await expect(
      paramRow(modal, 'verify_ssl').getByText('Verify Server Certificate', { exact: true }),
    ).toBeVisible()
  })

  test('K-e/K-f: Get SA Token gates its rows, retains a typed value, and marks Service Account required', async ({
    page,
  }) => {
    const modal = await openK8sConfig(page)

    for (const name of RUN_TOKEN_ROWS) {
      await expect(paramRow(modal, name)).toHaveCount(0)
    }

    const gate = runTokenCheckbox(modal)
    await gate.click()
    await expect(gate).toHaveAttribute('data-state', 'checked')
    for (const name of RUN_TOKEN_ROWS) {
      await expect(paramRow(modal, name)).toBeVisible()
    }
    // K-f: while revealed, Service Account carries the required marker.
    await expect(
      paramRow(modal, 'run_token_service_account').getByText('*', { exact: true }),
    ).toHaveCount(1)

    // Retention across hide/reveal: the typed value survives the gate toggle.
    await setStringValue(page, modal, 'run_token_service_account', 'wave-tests')
    await expectStringParamPreview(modal, 'run_token_service_account', 'wave-tests')

    await gate.click()
    await expect(gate).toHaveAttribute('data-state', 'unchecked')
    for (const name of RUN_TOKEN_ROWS) {
      await expect(paramRow(modal, name)).toHaveCount(0)
    }

    await gate.click()
    await expect(gate).toHaveAttribute('data-state', 'checked')
    await expectStringParamPreview(modal, 'run_token_service_account', 'wave-tests')
  })

  test('K-f/K-g: API URL is the only required input; info badges everywhere; expression-toggle policy', async ({
    page,
  }) => {
    const modal = await openK8sConfig(page)

    // K-f: exactly api_url carries the * among the default-visible inputs.
    for (const name of DEFAULT_ROWS) {
      await expect(paramRow(modal, name).getByText('*', { exact: true })).toHaveCount(
        name === 'api_url' ? 1 : 0,
      )
    }

    // K-g: every input row (all 16) leads with the (i) info badge.
    await runTokenCheckbox(modal).click()
    for (const name of ALL_ROWS) {
      await expect(paramRow(modal, name).locator('td').first().locator('svg')).toBeVisible()
    }

    // K8SCON-4: the TLS version enums take no expression; API URL does.
    await expect(
      paramRow(modal, 'api_url').locator('[data-testid="expression-toggle"]'),
    ).toBeVisible()
    await expect(
      paramRow(modal, 'tls_min_version').locator('[data-testid="expression-toggle"]'),
    ).toHaveCount(0)
    await expect(
      paramRow(modal, 'tls_max_version').locator('[data-testid="expression-toggle"]'),
    ).toHaveCount(0)
  })

  test('K-h: outputs in order with the session Secret checked by default and no lock affordance', async ({
    page,
  }) => {
    const modal = await openK8sConfig(page)

    const outputs = modal.locator('[data-testid^="output-row-"]')
    await expect(outputs).toHaveCount(2)
    const ids = await outputs.evaluateAll((els) =>
      els.map((el) => (el.getAttribute('data-testid') ?? '').replace('output-row-', '')),
    )
    expect(ids).toEqual(['session', 'cluster_version'])
    await expect(modal.locator('[data-testid="output-row-session"]')).toContainText('K8s Session')

    // K8SCON-5: session is secret by default, yet stays a plain editable
    // checkbox - no lock icon or label.
    const sessionSecret = modal.locator('[data-testid="output-secret-session"]')
    await expect(sessionSecret).toHaveAttribute('data-state', 'checked')
    await expect(sessionSecret).toBeEnabled()
    const sessionRow = modal.locator('[data-testid="output-row-session"]')
    await expect(sessionRow.locator('svg.lucide-lock')).toHaveCount(0)
    await expect(sessionRow).not.toContainText('Locked')

    await expect(modal.locator('[data-testid="output-secret-cluster_version"]')).toHaveAttribute(
      'data-state',
      'unchecked',
    )
  })

  test('K-i: a fresh sheet is not dirty - Escape closes silently with no Unsaved-changes dialog', async ({
    page,
  }) => {
    const modal = await openK8sConfig(page)

    // The schema-secret default must not count as an edit: Escape right after
    // opening closes the sheet without raising the Unsaved-changes dialog.
    await page.keyboard.press('Escape')
    await expect(modal).not.toBeVisible()
    await expect(page.getByText('Unsaved changes')).toHaveCount(0)
  })

  test('K-j: unchecking the session Secret persists across save and reopen', async ({ page }) => {
    const modal = await openK8sConfig(page)

    // api_url is required, so fill it to enable Save.
    await setStringValue(page, modal, 'api_url', 'https://example.invalid:6443')

    const sessionSecret = modal.locator('[data-testid="output-secret-session"]')
    await sessionSecret.click()
    await expect(sessionSecret).toHaveAttribute('data-state', 'unchecked')

    const saveButton = modal.getByRole('button', { name: 'Save' })
    await expect(saveButton).toBeEnabled()
    await saveButton.click()
    await expect(modal).not.toBeVisible()

    // Reopen the same node: the deliberate reveal survived the round trip.
    const node = page.locator('[data-testid^="workflow-node-"][data-nodetype]').first()
    await node.locator('button').first().dispatchEvent('click')
    await expect(node).toHaveAttribute('data-selected', 'true')
    await openSelectedBlockSheet(page)
    await expect(modal).toBeVisible()
    await expect(modal.locator('[data-testid="output-secret-session"]')).toHaveAttribute(
      'data-state',
      'unchecked',
    )
  })
})
