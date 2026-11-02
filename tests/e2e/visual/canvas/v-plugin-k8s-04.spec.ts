/**
 * V-PLUGIN-K8S-04: K8s Logs config sheet
 *
 * Phase: no-data (parallel) - palette drag-drop only, no backend data needed.
 * Runs under both dark and light projects (theme-agnostic DOM assertions).
 * REQ: REQ-3.3.2.1, REQ-3.3.2.3, REQ-3.4.1.5, REQ-5.1.1
 * Design Decisions: K8SREAD-8, K8SREAD-9, K8SREAD-10, K8SREAD-12, K8SREAD-14,
 *                   K8SREAD-16, K8SREAD-20
 *
 * Criterion ids use the KL- prefix, following the per-file letter convention
 * v-plugin-k8s-01.spec.ts established.
 *
 * Pass Criteria:
 *   KL-a  four group cards render in the order Connection / Logs / Advanced /
 *         Failure Handling, each carrying its exact footer note
 *   KL-b  Advanced and Failure Handling open COLLAPSED - a collapsed card
 *         renders neither its rows nor its footer - and both expand on a click
 *   KL-c  Connection holds K8s Session and Timeout, the Logs group holds
 *         exactly the eight log rows in schema order with their exact labels,
 *         and Failure Handling holds On error alone defaulting to Fail the block
 *   KL-d  Output Format sits between Timestamps and Max Bytes and offers
 *         String plus one per-line option that Timestamps renames: Array while
 *         the tick is off, Table while it is on (K8SREAD-16)
 *   KL-e  there is NO All namespaces row on this sheet: Advanced leads with
 *         Namespace, where Get and Events lead with All namespaces
 *   KL-f  Namespace is on the sheet from the start, optional, and keeps a typed
 *         value
 *   KL-g  K8s Session, Pod and Container are the only rows carrying the
 *         required *, and every row leads with the (i) info badge
 *   KL-h  the expression toggle is absent on On error, Timestamps and Output
 *         Format, present on Previous Instance and Namespace, and present but
 *         off on K8s Session
 *   KL-i  two outputs on a default sheet, Logs then Success, Logs typed string,
 *         neither marked Secret; Error and Reason appear only under Record and
 *         continue, and with the per-line option picked, flipping Timestamps
 *         both ways leaves the row on a choice it still offers, with the Logs
 *         Type cell following the tick
 *   KL-j  the Changelog carries the Output Format entry for both Timestamps
 *         states
 */

import { test, expect, type Page, type Locator } from '../../helpers/playwright-fixtures'
import { expectStringParamPreview } from '../../helpers/param-config'
import { dragPaletteItemToCanvas, waitForCanvasLoad } from '../../helpers/canvas'
import { configSheet, openSelectedBlockSheet } from '../../helpers/workbench'
import { BACKEND_URL } from '../../helpers/config'
import { expectOnlyRequiredFlags } from '../../helpers/config-sheet'

const GROUP_ORDER = ['Connection', 'Logs', 'Advanced', 'Failure Handling']

const GROUP_FOOTERS: Record<string, string> = {
  'Connection': 'K8s Session and request timeout',
  'Logs': 'Which pod and container to read, and how much of the log to bring back',
  'Advanced':
    'Namespace and identity for this block only, in place of what the session provides',
  'Failure Handling':
    'Record and continue sets Success, Error and Reason instead of failing the block',
}

const CONNECTION_ROWS = ['session', 'timeout']
const LOGS_ROWS = [
  'pod',
  'container',
  'previous',
  'tail_lines',
  'since_seconds',
  'timestamps',
  'output_format',
  'max_bytes',
]
const ADVANCED_ROWS = ['namespace', 'impersonate_user', 'impersonate_groups']
const FAILURE_ROWS = ['on_error']

const ROW_LABELS: Record<string, string> = {
  session: 'K8s Session',
  timeout: 'Timeout',
  pod: 'Pod',
  container: 'Container',
  previous: 'Previous Instance',
  tail_lines: 'Tail Lines',
  since_seconds: 'Since (s)',
  timestamps: 'Timestamps',
  output_format: 'Output Format',
  max_bytes: 'Max Bytes',
  namespace: 'Namespace',
  impersonate_user: 'Impersonate user',
  impersonate_groups: 'Impersonate groups',
  on_error: 'On error',
}

const REQUIRED_ROWS = ['session', 'pod', 'container']
// Timestamps picks which Output Format row renders, so both take a literal only.
const NO_EXPRESSION_ROWS = ['on_error', 'timestamps', 'output_format']
const EXPRESSION_ROWS = ['previous', 'namespace']

// K8SREAD-16: String plus one per-line option, which Timestamps renames.
const FORMAT_OPTIONS_PLAIN = ['String', 'Array']
const FORMAT_OPTIONS_TIMESTAMPED = ['String', 'Table']

/** The Output Format entry the in-app Changelog carries for 1.0.0. */
const CHANGELOG_OUTPUT_FORMAT =
  'Output Format String or one line at a time, which Timestamps names Array when off and a TIME and MESSAGE table when on'

const OUTPUT_ORDER = ['logs', 'success']
const OUTPUT_ORDER_RECORD = ['logs', 'success', 'error', 'reason']
const OUTPUT_LABELS: Record<string, string> = {
  logs: 'Logs',
  success: 'Success',
  error: 'Error',
  reason: 'Reason',
}
const OUTPUT_TYPES: Record<string, string> = {
  logs: 'string',
  success: 'boolean',
  error: 'string',
  reason: 'string',
}

async function openK8sLogsConfig(page: Page): Promise<Locator> {
  await page.request.delete(`${BACKEND_URL}/workbench/session`).catch(() => {})
  await page.goto('/workbench')
  await page.evaluate(() => localStorage.clear())
  await page.goto('/workbench')
  await waitForCanvasLoad(page)

  const canvas = page.locator('[data-testid="workflow-canvas"]')
  const box = await canvas.boundingBox()
  await dragPaletteItemToCanvas(
    page,
    { term: 'k8s', testId: 'palette-item-k8s-logs' },
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

const groupHeader = (modal: Locator, group: string) =>
  modal.locator(`[data-testid="group-header-${group}"]`)

const groupCard = (modal: Locator, group: string) => groupHeader(modal, group).locator('..')

/** Param names inside one group card, in DOM order. A collapsed card has none. */
async function groupRows(modal: Locator, group: string): Promise<string[]> {
  return groupCard(modal, group)
    .locator('[data-testid^="param-row-"]')
    .evaluateAll((rows) =>
      rows.map((r) => (r.getAttribute('data-testid') ?? '').replace('param-row-', '')),
    )
}

/** Expand a collapsible group card. Idempotent. */
async function expandGroup(modal: Locator, group: string) {
  const header = groupHeader(modal, group)
  await header.scrollIntoViewIfNeeded()
  if ((await header.getAttribute('aria-expanded')) !== 'true') await header.click()
  await expect(header).toHaveAttribute('aria-expanded', 'true')
}

const checkbox = (modal: Locator, name: string) =>
  paramRow(modal, name).locator('button[role="checkbox"]')

async function setCheckbox(modal: Locator, name: string, on: boolean) {
  const box = checkbox(modal, name)
  await box.scrollIntoViewIfNeeded()
  await expect(box).toBeVisible()
  const want = on ? 'checked' : 'unchecked'
  if ((await box.getAttribute('data-state')) !== want) await box.click()
  await expect(box).toHaveAttribute('data-state', want)
}

async function pickEnum(page: Page, modal: Locator, name: string, optionLabel: string) {
  const trigger = paramRow(modal, name).locator('button[role="combobox"]')
  await trigger.scrollIntoViewIfNeeded()
  await trigger.click()
  const listbox = page.locator('[role="listbox"]')
  await expect(listbox).toBeVisible()
  await listbox.getByRole('option', { name: optionLabel, exact: true }).click()
  await expect(listbox).toHaveCount(0)
  await expect(trigger).toHaveText(optionLabel)
}

/** Open a plain enum row and assert its option labels in DOM order, then close it. */
async function expectEnumOptions(
  page: Page,
  modal: Locator,
  name: string,
  labels: readonly string[],
) {
  const trigger = paramRow(modal, name).locator('button[role="combobox"]')
  await trigger.scrollIntoViewIfNeeded()
  await trigger.click()
  const listbox = page.locator('[role="listbox"]')
  await expect(listbox).toBeVisible()
  const options = listbox.getByRole('option')
  await expect(options).toHaveCount(labels.length)
  for (const [index, label] of labels.entries()) {
    await expect(options.nth(index), label).toHaveText(label)
  }
  await page.keyboard.press('Escape')
  await expect(page.locator('[role="listbox"]')).toHaveCount(0)
}

/** Output row ids, in DOM order. */
function outputIds(modal: Locator): Promise<string[]> {
  return modal
    .locator('[data-testid^="output-row-"]')
    .evaluateAll((els) =>
      els.map((el) => (el.getAttribute('data-testid') ?? '').replace('output-row-', '')),
    )
}

/** The Type cell of an output row (3rd column: info, name, type, secret, value). */
async function outputType(modal: Locator, name: string): Promise<string> {
  const raw = await modal.locator(`[data-testid="output-row-${name}"] td:nth-child(3)`).innerText()
  return raw.trim().toLowerCase()
}

/** The name cell text without the required marker's "*" and its sr-only word. */
async function rowLabel(modal: Locator, name: string): Promise<string> {
  return paramRow(modal, name)
    .locator('td:nth-child(2)')
    .evaluate((td) => (td.textContent ?? '').replace(/\*\s*required$/, '').trim())
}

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

test.describe('V-PLUGIN-K8S-04: K8s Logs config sheet', () => {
  test('KL-a: four groups in order with their exact footer notes', async ({ page }) => {
    const modal = await openK8sLogsConfig(page)

    const headers = modal.locator('[data-testid^="group-header-"]')
    await expect(headers).toHaveCount(4)
    const names = await headers.evaluateAll((els) =>
      els.map((el) => (el.getAttribute('data-testid') ?? '').replace('group-header-', '')),
    )
    expect(names).toEqual(GROUP_ORDER)

    // The verb groups of the other three read blocks never appear here.
    for (const foreign of ['Resource', 'Events', 'Measurement']) {
      await expect(modal.locator(`[data-testid="group-header-${foreign}"]`)).toHaveCount(0)
    }

    // Advanced and Failure Handling hold their footers back until expanded.
    await expandGroup(modal, 'Advanced')
    await expandGroup(modal, 'Failure Handling')
    await expect(modal.locator('[data-testid^="group-footer-"]')).toHaveCount(4)
    for (const [name, footer] of Object.entries(GROUP_FOOTERS)) {
      await expect(modal.locator(`[data-testid="group-footer-${name}"]`)).toHaveText(footer)
    }
  })

  test('KL-b: Advanced and Failure Handling open collapsed with no rows and no footer, and expand on click', async ({
    page,
  }) => {
    const modal = await openK8sLogsConfig(page)

    // On open: the two groups an author has to fill in are the two that are open.
    await expect(groupHeader(modal, 'Connection')).toHaveAttribute('aria-expanded', 'true')
    await expect(groupHeader(modal, 'Logs')).toHaveAttribute('aria-expanded', 'true')
    await expect(groupHeader(modal, 'Advanced')).toHaveAttribute('aria-expanded', 'false')
    await expect(groupHeader(modal, 'Failure Handling')).toHaveAttribute(
      'aria-expanded',
      'false',
    )

    // A collapsed card renders neither its rows nor its footer.
    await expect(modal.locator('[data-testid^="group-footer-"]')).toHaveCount(2)
    await expect(modal.locator('[data-testid="group-footer-Advanced"]')).toHaveCount(0)
    await expect(modal.locator('[data-testid="group-footer-Failure Handling"]')).toHaveCount(0)
    expect(await groupRows(modal, 'Advanced')).toEqual([])
    expect(await groupRows(modal, 'Failure Handling')).toEqual([])
    await expect(paramRow(modal, 'namespace')).toHaveCount(0)
    await expect(paramRow(modal, 'on_error')).toHaveCount(0)

    // The default-visible rows are Connection plus Logs and nothing else.
    await expect(modal.locator('[data-testid^="param-row-"]')).toHaveCount(
      CONNECTION_ROWS.length + LOGS_ROWS.length,
    )

    // One click opens each, bringing its rows and its footer with it.
    await expandGroup(modal, 'Advanced')
    expect(await groupRows(modal, 'Advanced')).toEqual(ADVANCED_ROWS)
    await expect(modal.locator('[data-testid="group-footer-Advanced"]')).toBeVisible()

    await expandGroup(modal, 'Failure Handling')
    expect(await groupRows(modal, 'Failure Handling')).toEqual(FAILURE_ROWS)
    await expect(modal.locator('[data-testid="group-footer-Failure Handling"]')).toBeVisible()
  })

  test('KL-c: Connection, the eight log rows in schema order with their exact labels, and On error alone defaulting to Fail the block', async ({
    page,
  }) => {
    const modal = await openK8sLogsConfig(page)

    expect(await groupRows(modal, 'Connection')).toEqual(CONNECTION_ROWS)
    expect(await groupRows(modal, 'Logs')).toEqual(LOGS_ROWS)

    await expandGroup(modal, 'Failure Handling')
    expect(await groupRows(modal, 'Failure Handling')).toEqual(FAILURE_ROWS)
    await expect(paramRow(modal, 'on_error').getByRole('combobox')).toHaveText('Fail the block')

    for (const name of [...CONNECTION_ROWS, ...LOGS_ROWS, ...FAILURE_ROWS]) {
      expect(await rowLabel(modal, name)).toBe(ROW_LABELS[name])
    }
  })

  test('KL-d: Output Format sits between Timestamps and Max Bytes, and Timestamps renames its per-line option', async ({
    page,
  }) => {
    const modal = await openK8sLogsConfig(page)

    const logsRows = await groupRows(modal, 'Logs')
    expect(logsRows).toEqual(LOGS_ROWS)
    expect(logsRows.indexOf('output_format')).toBe(logsRows.indexOf('timestamps') + 1)
    expect(logsRows.at(-1)).toBe('max_bytes')

    // Two descriptors share the wire name output_format, so exactly one renders.
    await expect(paramRow(modal, 'output_format')).toHaveCount(1)
    expect(await rowLabel(modal, 'output_format')).toBe('Output Format')
    await expect(paramRow(modal, 'output_format').locator('button[role="combobox"]')).toHaveText(
      'String',
    )

    // K8SREAD-16: only a timestamped line carries a prefix a Table can split
    // on, so the tick renames the per-line option instead of adding a third.
    await expectEnumOptions(page, modal, 'output_format', FORMAT_OPTIONS_PLAIN)
    await setCheckbox(modal, 'timestamps', true)
    await expectEnumOptions(page, modal, 'output_format', FORMAT_OPTIONS_TIMESTAMPED)
    await setCheckbox(modal, 'timestamps', false)
    await expectEnumOptions(page, modal, 'output_format', FORMAT_OPTIONS_PLAIN)
  })

  test('KL-e: no All namespaces row - Advanced leads with Namespace', async ({
    page,
  }) => {
    const modal = await openK8sLogsConfig(page)

    await expandGroup(modal, 'Advanced')
    await expandGroup(modal, 'Failure Handling')
    await expect(paramRow(modal, 'namespace')).toBeVisible()

    await expect(modal.locator('[data-testid="param-row-all_namespaces"]')).toHaveCount(0)

    // The discriminator: Get and Events put All namespaces above the Namespace
    // row, Logs starts the group at Namespace itself.
    const advancedRows = await groupRows(modal, 'Advanced')
    expect(advancedRows.at(0)).toBe('namespace')
    expect(advancedRows).toEqual(ADVANCED_ROWS)
  })

  test('KL-f: the Namespace row is on the sheet from the start, optional, and keeps a typed value', async ({
    page,
  }) => {
    const modal = await openK8sLogsConfig(page)

    await expandGroup(modal, 'Advanced')

    // No tick above it, no required marker: empty means the session's namespace.
    await expect(paramRow(modal, 'namespace')).toBeVisible()
    expect(await groupRows(modal, 'Advanced')).toEqual(ADVANCED_ROWS)
    expect(await rowLabel(modal, 'namespace')).toBe('Namespace')
    await expect(
      paramRow(modal, 'namespace').locator('td:nth-child(2) span.text-destructive'),
    ).toHaveCount(0)

    await setStringValue(page, modal, 'namespace', 'wave-logs')
    await expectStringParamPreview(modal, 'namespace', 'wave-logs')
  })

  test('KL-g: K8s Session, Pod and Container are the only required rows, and every row leads with the info badge', async ({
    page,
  }) => {
    const modal = await openK8sLogsConfig(page)

    await expandGroup(modal, 'Advanced')
    await expandGroup(modal, 'Failure Handling')
    await expect(paramRow(modal, 'namespace')).toBeVisible()

    const allRows = [...CONNECTION_ROWS, ...LOGS_ROWS, ...ADVANCED_ROWS, ...FAILURE_ROWS]
    await expect(modal.locator('[data-testid^="param-row-"]')).toHaveCount(allRows.length)

    for (const name of allRows) {
      await expect(
        paramRow(modal, name).locator('td:nth-child(2) span.text-destructive'),
      ).toHaveCount(REQUIRED_ROWS.includes(name) ? 1 : 0)
      await expect(paramRow(modal, name).locator('td').first().locator('svg')).toBeVisible()
    }

    // FIELDERR-3: a fresh sheet flags its empty required rows at once, and nothing else.
    await expectOnlyRequiredFlags(modal)
  })

  test('KL-h: the expression toggle is absent on On error, Timestamps and Output Format, and present on Previous Instance and Namespace', async ({
    page,
  }) => {
    const modal = await openK8sLogsConfig(page)

    await expandGroup(modal, 'Advanced')
    await expandGroup(modal, 'Failure Handling')

    for (const name of NO_EXPRESSION_ROWS) {
      await expect(paramRow(modal, name)).toHaveCount(1)
      await expect(
        paramRow(modal, name).locator('[data-testid="expression-toggle"]'),
      ).toHaveCount(0)
    }
    for (const name of EXPRESSION_ROWS) {
      await expect(
        paramRow(modal, name).locator('[data-testid="expression-toggle"]'),
      ).toHaveCount(1)
    }

    // The session is bound by expression, so its toggle exists and starts off.
    await expect(
      paramRow(modal, 'session').locator('[data-testid="expression-toggle"]'),
    ).toHaveAttribute('data-state', 'off')
  })

  test('KL-i: two outputs on a default sheet, Logs typed string, neither marked Secret, Error and Reason only under Record and continue, and the Logs type follows Output Format and Timestamps', async ({
    page,
  }) => {
    const modal = await openK8sLogsConfig(page)

    const outputs = modal.locator('[data-testid^="output-row-"]')
    await expect(outputs).toHaveCount(OUTPUT_ORDER.length)
    expect(await outputIds(modal)).toEqual(OUTPUT_ORDER)

    for (const name of OUTPUT_ORDER) {
      const row = modal.locator(`[data-testid="output-row-${name}"]`)
      await expect(row.locator('td:nth-child(2)')).toHaveText(OUTPUT_LABELS[name])
      await expect(row.locator('td:nth-child(3)')).toHaveText(OUTPUT_TYPES[name])
      await expect(modal.locator(`[data-testid="output-secret-${name}"]`)).toHaveAttribute(
        'data-state',
        'unchecked',
      )
    }

    // K8SREAD-16: one stored per-line value that the tick renames. Flipping
    // Timestamps with it picked must leave the row on a choice it still
    // offers, and the Logs type cell follows both fields.
    const formatTrigger = paramRow(modal, 'output_format').locator('button[role="combobox"]')
    await pickEnum(page, modal, 'output_format', 'Array')
    await expect.poll(() => outputType(modal, 'logs')).toBe('array')

    await setCheckbox(modal, 'timestamps', true)
    await expect(formatTrigger).toHaveText('Table')
    await expectEnumOptions(page, modal, 'output_format', FORMAT_OPTIONS_TIMESTAMPED)
    await expect.poll(() => outputType(modal, 'logs')).toBe('table')

    await setCheckbox(modal, 'timestamps', false)
    await expect(formatTrigger).toHaveText('Array')
    await expectEnumOptions(page, modal, 'output_format', FORMAT_OPTIONS_PLAIN)
    await expect.poll(() => outputType(modal, 'logs')).toBe('array')

    await pickEnum(page, modal, 'output_format', 'String')
    await expect.poll(() => outputType(modal, 'logs')).toBe('string')

    // K8SREAD-14: Error and Reason exist only under Record and continue, and
    // Success is the exception that stays under both.
    await expandGroup(modal, 'Failure Handling')
    await pickEnum(page, modal, 'on_error', 'Record and continue')
    await expect(outputs).toHaveCount(OUTPUT_ORDER_RECORD.length)
    expect(await outputIds(modal)).toEqual(OUTPUT_ORDER_RECORD)
    for (const name of OUTPUT_ORDER_RECORD) {
      const row = modal.locator(`[data-testid="output-row-${name}"]`)
      await expect(row.locator('td:nth-child(2)')).toHaveText(OUTPUT_LABELS[name])
      await expect(row.locator('td:nth-child(3)')).toHaveText(OUTPUT_TYPES[name])
    }

    await pickEnum(page, modal, 'on_error', 'Fail the block')
    await expect(outputs).toHaveCount(OUTPUT_ORDER.length)
    expect(await outputIds(modal)).toEqual(OUTPUT_ORDER)
  })

  test('KL-j: the Changelog carries the Output Format entry for both Timestamps states', async ({
    page,
  }) => {
    const modal = await openK8sLogsConfig(page)

    await modal.getByRole('button', { name: 'Changelog' }).click()
    const changelog = page.locator('[data-testid="changelog-scroll"]')
    await expect(changelog).toBeVisible()
    await expect(changelog).toContainText(CHANGELOG_OUTPUT_FORMAT)

    await page.keyboard.press('Escape')
    await expect(changelog).toHaveCount(0)
    await expect(modal).toBeVisible()
  })
})
