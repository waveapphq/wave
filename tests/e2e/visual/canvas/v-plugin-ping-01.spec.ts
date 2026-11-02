/**
 * V-PLUGIN-PING-01: Ping block config sheet
 * Design Decisions: PING-3, PING-6, PING-7, PING-8, PING-9, PING-10, PING-17, PING-18, FIELDERR-1, FIELD-2
 * REQ: REQ-3.3.4.4, REQ-3.4.1.9, REQ-3.4.2.2
 *
 * Runs in the no-data project list. Each test seeds its own Test through POST /tests and afterAll
 * deletes it. Theme-agnostic DOM assertions.
 *
 * Pass Criteria:
 * 1. On open the header carries the Radio glyph in the Network blue and the title
 *    "Ping - Edit Config", the Version reads 1.0.0, and the ungrouped rows read, top to bottom:
 *    Host (required, String, the one value field), Count (Integer, gray default 4), Interval (seconds)
 *    (Float, default 1), Packet size (bytes) (Integer, default 56), Timeout (Integer, default 30),
 *    Pass when (select on Any reply, no expression toggle) and Log Output (Boolean, off). Advanced,
 *    Failure Handling and Secrets follow, all collapsed, and nothing is flagged.
 * 2. Pass when offers Any reply / All replies / At least N replies / At least X% replies. Minimum
 *    replies appears directly beneath Pass when, required, only while the rule is At least N
 *    replies; Minimum rate (%) takes its place, required, only while the rule is At least X%
 *    replies. Both leave again with the rule.
 * 3. Advanced expands to exactly IP version (Auto), TTL (empty), Don't fragment (off) and Source
 *    address (empty), in that order, above Failure Handling; Failure Handling holds On error on
 *    Fail the block.
 * 4. OUTPUT VARIABLES holds Success (Boolean), Summary (Table) and Replies (Table); Error and
 *    Reason (String) join only while On error is Record and continue.
 * 5. A literal outside a row's declared bounds is messaged under the field eagerly, with no blur:
 *    Count at 50000 reads "Count must be between 1 and 1000", the input is marked
 *    invalid, Save is disabled under the settings-errors note, the typed value is kept verbatim,
 *    and no other row is flagged.
 * 6. Save refuses a Count past its maximum (SETTING_ABOVE_MAXIMUM); the same value in a Test file edited by
 *    hand paints the canvas alert badge with the same message in its tooltip, keeps Save shut, and opens it
 *    again once the value is back inside the range.
 * 7. Minimum replies above Count carries the rule's own message, "Minimum replies cannot exceed
 *    Count", on that row and blocks Save the same way.
 */

import { test, expect, type Locator, type Page } from '../../helpers/playwright-fixtures'
import { importExpectingErrors, importValidateAndNavigate } from '../../helpers/fixture-import'
import { BACKEND_URL } from '../../helpers/config'
import { deleteTest, expandGroup, openConfig } from '../../functional/file-picker/picker'
import { expectGrayDefault } from '../../helpers/default-rule'

// ---------------------------------------------------------------------------
// Seeded Test
// ---------------------------------------------------------------------------

const NODE_ID = '7a1f6c92-4d53-4e18-9b07-2c6ea4d81f35'
const START_EDGE_ID = 'b0d4e7a1-8c26-4f39-95be-1d7a3f620c48'

const HOST = '127.0.0.1'
const OUT_OF_RANGE_COUNT = 50000
// FIELDERR-1: the message names the row by its label.
const COUNT_MESSAGE = 'Count must be between 1 and 1000'
const MIN_REPLIES_MESSAGE = 'Minimum replies cannot exceed Count'
const SETTINGS_NOTE = 'Save is disabled: the settings have errors'

function pingNode(
  id: string,
  position: { x: number; y: number },
  values: Record<string, unknown>,
): Record<string, unknown> {
  return {
    id,
    type: 'workflowNode',
    position,
    data: {
      label: 'Ping',
      elementType: 'ping',
      nodeType: 'plugin',
      category: 'network',
      version: '1.0.0',
      description: '',
      hasNewerVersion: false,
      expressionFields: [],
      templateFields: [],
      config: { values, outputBindings: {}, profileBindings: [] },
    },
    measured: { width: 120, height: 62 },
  }
}

/** One Ping block on the Test, carrying only the Host the sheet needs to be valid. */
function pingFixture(name: string, values: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name,
    version: '1.0.0',
    description: '',
    workflow: {
      nodes: [pingNode(NODE_ID, { x: -75, y: 100 }, { host: HOST, ...values })],
      edges: [{ id: START_EDGE_ID, source: 'start-node', target: NODE_ID }],
    },
    variables: {},
    metadata: { tags: [], suite_id: null, parent_suite: null },
  }
}

/** Open a Test whose one Ping block stores a number outside its declared bounds. */
async function openStored(
  page: Page,
  name: string,
  values: Record<string, unknown>,
): Promise<Locator> {
  await page.request.delete(`${BACKEND_URL}/workbench/session/`).catch(() => {})
  created.push(await importValidateAndNavigate(page, pingFixture(name, values)))
  return nodeAlert(page)
}

const nodeAlert = (page: Page): Locator =>
  page.locator(`[data-testid="workflow-node-${NODE_ID}"] [data-testid="node-validation-alert"]`)

/** The canvas alert badge carries the row's own message in its tooltip. */
async function expectBadgeMessage(page: Page, badge: Locator, message: string): Promise<void> {
  await expect(badge, 'the block carries the canvas alert badge').toBeVisible({ timeout: 10_000 })
  await badge.hover()
  const tooltip = page.locator('[role="tooltip"]').last()
  await expect(tooltip).toBeVisible({ timeout: 5_000 })
  await expect(tooltip).toContainText(message)
}

// ---------------------------------------------------------------------------
// Expected sheet content, verbatim from the shipped schema
// ---------------------------------------------------------------------------

type Control = 'edit' | 'select' | 'number' | 'checkbox'

interface RowSpec {
  label: string
  type: string
  control: Control
  required: boolean
}

const ROWS: Record<string, RowSpec> = {
  host: { label: 'Host', type: 'String', control: 'edit', required: true },
  count: { label: 'Count', type: 'Integer', control: 'number', required: false },
  interval: { label: 'Interval (seconds)', type: 'Float', control: 'number', required: false },
  packet_size: { label: 'Packet size (bytes)', type: 'Integer', control: 'number', required: false },
  timeout: { label: 'Timeout', type: 'Integer', control: 'number', required: false },
  pass_when: { label: 'Pass when', type: 'String', control: 'select', required: false },
  min_replies: { label: 'Minimum replies', type: 'Integer', control: 'number', required: true },
  min_rate: { label: 'Minimum rate (%)', type: 'Float', control: 'number', required: true },
  stream_output: { label: 'Log Output', type: 'Boolean', control: 'checkbox', required: false },
  ip_version: { label: 'IP version', type: 'String', control: 'select', required: false },
  ttl: { label: 'TTL', type: 'Integer', control: 'number', required: false },
  dont_fragment: { label: "Don't fragment", type: 'Boolean', control: 'checkbox', required: false },
  source_address: { label: 'Source address', type: 'String', control: 'edit', required: false },
  on_error: { label: 'On error', type: 'String', control: 'select', required: false },
}

const TOP_ROWS = ['host', 'count', 'interval', 'packet_size', 'timeout', 'pass_when', 'stream_output']
const BY_REPLIES_ROWS = [...TOP_ROWS.slice(0, 6), 'min_replies', 'stream_output']
const BY_RATE_ROWS = [...TOP_ROWS.slice(0, 6), 'min_rate', 'stream_output']
const ADVANCED_ROWS = ['ip_version', 'ttl', 'dont_fragment', 'source_address']
const CLOSED_TAIL = ['[Advanced]', '[Failure Handling]', '[Secrets]']

/** Defaults the sheet shows in gray; nothing below is stored on the block (FIELD-2). */
const PLACEHOLDERS: Record<string, string> = {
  count: '4',
  interval: '1',
  packet_size: '56',
  timeout: '30',
}

const PASS_WHEN_OPTIONS = ['Any reply', 'All replies', 'At least N replies', 'At least X% replies']
const IP_VERSION_OPTIONS = ['Auto', 'IPv4', 'IPv6']

const OUTPUTS: Record<string, { label: string; type: string }> = {
  success: { label: 'Success', type: 'Boolean' },
  summary: { label: 'Summary', type: 'Table' },
  replies: { label: 'Replies', type: 'Table' },
  error: { label: 'Error', type: 'String' },
  reason: { label: 'Reason', type: 'String' },
}

// ---------------------------------------------------------------------------
// Locators and small helpers
// ---------------------------------------------------------------------------

const created: string[] = []

async function openSheet(
  page: Page,
  name: string,
  values: Record<string, unknown> = {},
): Promise<Locator> {
  await page.request.delete(`${BACKEND_URL}/workbench/session/`).catch(() => {})
  created.push(await importValidateAndNavigate(page, pingFixture(name, values)))
  const modal = await openConfig(page, NODE_ID)
  await expect(modal.getByRole('heading', { name: 'Ping - Edit Config' })).toBeVisible()
  return modal
}

const paramRow = (modal: Locator, name: string) => modal.locator(`[data-testid="param-row-${name}"]`)
const outputRow = (modal: Locator, name: string) => modal.locator(`[data-testid="output-row-${name}"]`)
const exprToggle = (modal: Locator, name: string) =>
  paramRow(modal, name).locator('[data-testid="expression-toggle"]')
const requiredStar = (modal: Locator, name: string) =>
  paramRow(modal, name).locator('td:nth-child(2) span.text-destructive')
const enumTrigger = (modal: Locator, name: string) => paramRow(modal, name).locator('button[role="combobox"]')
const checkbox = (modal: Locator, name: string) => paramRow(modal, name).locator('button[role="checkbox"]')
// The one value field's text box (FIELD-1).
const editPreview = (modal: Locator, name: string) =>
  paramRow(modal, name).locator('[data-slot="input-group"] input')
const numberInput = (modal: Locator, name: string) => modal.locator(`[data-testid="param-input-${name}"]`)
const groupHeader = (modal: Locator, name: string) => modal.locator(`[data-testid="group-header-${name}"]`)
const secretsTrigger = (modal: Locator) => modal.locator('[data-testid="secrets-section-trigger"]')
const settingsNote = (modal: Locator) => modal.locator('[data-testid="save-blocked-note"]')
const saveButton = (modal: Locator) => modal.getByRole('button', { name: 'Save', exact: true })
const rowAlert = (modal: Locator, name: string) => paramRow(modal, name).getByRole('alert')
const allAlerts = (modal: Locator) => modal.locator('[data-testid^="param-row-"] [role="alert"]')

const CONTROL_LOCATOR: Record<Control, (modal: Locator, name: string) => Locator> = {
  edit: editPreview,
  select: enumTrigger,
  number: numberInput,
  checkbox,
}

/** The input side of the sheet in DOM order: row names, [Group] headers and [Secrets]. */
function inputLayout(modal: Locator): Promise<string[]> {
  return modal.evaluate((sheet) =>
    Array.from(
      sheet.querySelectorAll(
        '[data-testid^="param-row-"], [data-testid^="group-header-"], [data-testid="secrets-section-trigger"]',
      ),
    ).map((el) => {
      const id = el.getAttribute('data-testid') ?? ''
      if (id.startsWith('param-row-')) return id.slice('param-row-'.length)
      if (id.startsWith('group-header-')) return `[${id.slice('group-header-'.length)}]`
      return '[Secrets]'
    }),
  )
}

async function expectLayout(modal: Locator, expected: string[], label: string): Promise<void> {
  await expect.poll(() => inputLayout(modal), { message: label }).toEqual(expected)
}

async function expectOutputs(modal: Locator, expected: string[], label: string): Promise<void> {
  const rows = modal.locator('[data-testid^="output-row-"]')
  await expect
    .poll(
      () =>
        rows.evaluateAll((els) =>
          els.map((el) => (el.getAttribute('data-testid') ?? '').replace('output-row-', '')),
        ),
      { message: label },
    )
    .toEqual(expected)
}

/** Label, Type text, (i) badge, required marker, value control and toggle of each named row. */
async function expectRows(modal: Locator, names: string[]): Promise<void> {
  for (const name of names) {
    const spec = ROWS[name]
    const row = paramRow(modal, name)
    const label = await row
      .locator('td:nth-child(2)')
      .evaluate((cell) => (cell.textContent ?? '').replace(/\*\s*required$/, '').trim())
    expect(label, name).toBe(spec.label)
    await expect(row.locator('td:nth-child(3)'), name).toHaveText(spec.type, { useInnerText: true })
    await expect(row.locator('td:first-child .cursor-help'), `${name} info badge`).toHaveCount(1)
    await expect(requiredStar(modal, name), `${name} required marker`).toHaveCount(spec.required ? 1 : 0)
    await expect(CONTROL_LOCATOR[spec.control](modal, name), `${name} ${spec.control}`).toHaveCount(1)
    // PING-3, PING-7: the two selects take no expression; every other row does.
    await expect(exprToggle(modal, name), `${name} expression toggle`).toHaveCount(
      spec.control === 'select' ? 0 : 1,
    )
  }
}

async function headerTexts(table: Locator): Promise<string[]> {
  return table.locator('thead th').evaluateAll((cells) => cells.map((c) => (c.textContent ?? '').trim()))
}

async function openOptions(page: Page, modal: Locator, name: string): Promise<Locator> {
  const trigger = enumTrigger(modal, name)
  await trigger.scrollIntoViewIfNeeded()
  await trigger.click()
  const listbox = page.locator('[role="listbox"]')
  await expect(listbox).toBeVisible()
  return listbox
}

async function pickEnum(page: Page, modal: Locator, name: string, optionLabel: string): Promise<void> {
  const listbox = await openOptions(page, modal, name)
  await listbox.getByRole('option', { name: optionLabel, exact: true }).click()
  await expect(listbox).toHaveCount(0)
  await expect(enumTrigger(modal, name)).toHaveText(optionLabel)
}

/** Assert the options a select offers, then close it by picking the value it already shows. */
async function expectOptions(page: Page, modal: Locator, name: string, labels: string[]): Promise<void> {
  const current = ((await enumTrigger(modal, name).textContent()) ?? '').trim()
  const listbox = await openOptions(page, modal, name)
  await expect(listbox.getByRole('option'), `${name} options`).toHaveText(labels)
  await listbox.getByRole('option', { name: current, exact: true }).click()
  await expect(listbox).toHaveCount(0)
  await expect(enumTrigger(modal, name)).toHaveText(current)
}

// ---------------------------------------------------------------------------

test.describe('V-PLUGIN-PING-01: Ping block config sheet', () => {
  test.afterAll(async ({ request }) => {
    for (const testId of created.splice(0)) await deleteTest(request, testId)
  })

  test('V-PLUGIN-PING-01 defaults: the seven top rows in order, three groups collapsed', async ({
    page,
  }) => {
    const modal = await openSheet(page, 'V-PLUGIN-PING-01 defaults')

    const glyph = modal.getByRole('heading', { name: 'Ping - Edit Config' }).locator('svg.lucide-radio')
    await expect(glyph).toHaveCount(1)
    await expect(glyph).toHaveClass(/\btext-blue-500\b/)
    await expect(modal.locator('[data-testid="version-selector"]')).toContainText('1.0.0')

    await expect(modal.getByRole('heading', { name: 'Input Parameters' })).toBeVisible()
    expect(
      await headerTexts(modal.locator('table:has([data-testid="param-row-host"])')),
    ).toEqual(['', 'Parameter', 'Type', 'Value'])

    // PING-6: the ungrouped rows, then Advanced, Failure Handling and Secrets, all collapsed.
    await expectLayout(modal, [...TOP_ROWS, ...CLOSED_TAIL], 'defaults on open')
    await expectRows(modal, TOP_ROWS)

    await expect(editPreview(modal, 'host')).toHaveValue(HOST)
    for (const [name, shown] of Object.entries(PLACEHOLDERS)) {
      await expectGrayDefault(modal, name, shown)
    }
    await expect(enumTrigger(modal, 'pass_when')).toHaveText('Any reply')
    await expect(checkbox(modal, 'stream_output')).toHaveAttribute('data-state', 'unchecked')

    for (const name of ['min_replies', 'min_rate', ...ADVANCED_ROWS, 'on_error']) {
      await expect(paramRow(modal, name), `${name} absent while its group is closed`).toHaveCount(0)
    }
    for (const group of ['Advanced', 'Failure Handling']) {
      await expect(groupHeader(modal, group)).toHaveAttribute('aria-expanded', 'false')
    }
    await expect(secretsTrigger(modal)).toHaveAttribute('aria-expanded', 'false')
    await expect(settingsNote(modal)).toHaveCount(0)
    await expect(allAlerts(modal), 'nothing is flagged on open').toHaveCount(0)
  })

  test('V-PLUGIN-PING-01 pass rules: Minimum replies and Minimum rate reveal beneath Pass when', async ({
    page,
  }) => {
    const modal = await openSheet(page, 'V-PLUGIN-PING-01 pass rules')
    await expectOptions(page, modal, 'pass_when', PASS_WHEN_OPTIONS)

    // PING-3: At least N replies reveals Minimum replies directly beneath Pass when.
    await pickEnum(page, modal, 'pass_when', 'At least N replies')
    await expectLayout(modal, [...BY_REPLIES_ROWS, ...CLOSED_TAIL], 'at least N replies')
    await expectRows(modal, ['min_replies'])
    await expectGrayDefault(modal, 'min_replies', '1')
    await expect(paramRow(modal, 'min_rate')).toHaveCount(0)
    await expect(settingsNote(modal)).toHaveCount(0)

    await pickEnum(page, modal, 'pass_when', 'At least X% replies')
    await expectLayout(modal, [...BY_RATE_ROWS, ...CLOSED_TAIL], 'at least X% replies')
    await expectRows(modal, ['min_rate'])
    await expectGrayDefault(modal, 'min_rate', '100')
    await expect(paramRow(modal, 'min_replies')).toHaveCount(0)
    await expect(settingsNote(modal)).toHaveCount(0)

    await pickEnum(page, modal, 'pass_when', 'All replies')
    await expectLayout(modal, [...TOP_ROWS, ...CLOSED_TAIL], 'all replies')
    await pickEnum(page, modal, 'pass_when', 'Any reply')
    await expectLayout(modal, [...TOP_ROWS, ...CLOSED_TAIL], 'back to any reply')
  })

  test('V-PLUGIN-PING-01 advanced: exactly four rows, above Failure Handling', async ({ page }) => {
    const modal = await openSheet(page, 'V-PLUGIN-PING-01 advanced')

    // PING-7: the group opens collapsed and holds exactly these four rows, in this order.
    await expandGroup(modal, 'Advanced')
    await expectLayout(
      modal,
      [...TOP_ROWS, '[Advanced]', ...ADVANCED_ROWS, '[Failure Handling]', '[Secrets]'],
      'advanced expanded',
    )
    await expectRows(modal, ADVANCED_ROWS)
    await expect(enumTrigger(modal, 'ip_version')).toHaveText('Auto')
    await expectOptions(page, modal, 'ip_version', IP_VERSION_OPTIONS)
    await expect(numberInput(modal, 'ttl'), 'TTL leaves the system default').toHaveValue('')
    await expect(numberInput(modal, 'ttl')).not.toHaveAttribute('placeholder', /./)
    await expect(checkbox(modal, 'dont_fragment')).toHaveAttribute('data-state', 'unchecked')
    // PING-8: Source address takes an address, never an interface name, and starts empty.
    await expect(editPreview(modal, 'source_address')).toHaveValue('')
    await expect(settingsNote(modal)).toHaveCount(0)

    await expandGroup(modal, 'Failure Handling')
    await expectLayout(
      modal,
      [...TOP_ROWS, '[Advanced]', ...ADVANCED_ROWS, '[Failure Handling]', 'on_error', '[Secrets]'],
      'failure handling expanded',
    )
    await expectRows(modal, ['on_error'])
    await expect(enumTrigger(modal, 'on_error')).toHaveText('Fail the block')
  })

  test('V-PLUGIN-PING-01 outputs: Success, Summary and Replies, with Error and Reason gated', async ({
    page,
  }) => {
    const modal = await openSheet(page, 'V-PLUGIN-PING-01 outputs')

    await expect(modal.getByRole('heading', { name: 'Output Variables' })).toBeVisible()
    expect(
      await headerTexts(modal.locator('table:has([data-testid="output-row-success"])')),
    ).toEqual(['', 'Parameter', 'Type', 'Secret', 'Assign to'])

    // PING-9, PING-10: the seven statistics collapse into one Summary table, beside Replies.
    await expectOutputs(modal, ['success', 'summary', 'replies'], 'fail the block')
    for (const name of ['success', 'summary', 'replies']) {
      const { label, type } = OUTPUTS[name]
      const row = outputRow(modal, name)
      await expect(row.locator('td:nth-child(2)'), name).toHaveText(label)
      await expect(row.locator('td:nth-child(3)'), name).toHaveText(type, { useInnerText: true })
      await expect(row.locator('td:first-child .cursor-help'), `${name} info badge`).toHaveCount(1)
      await expect(modal.locator(`[data-testid="output-secret-${name}"]`), name).toHaveAttribute(
        'data-state',
        'unchecked',
      )
      const assign = row.getByRole('combobox', { name: `Assign ${label} to` })
      await expect(assign, name).toHaveAttribute('placeholder', 'variable_name')
      await expect(assign, name).toHaveValue('')
    }

    await expandGroup(modal, 'Failure Handling')
    await pickEnum(page, modal, 'on_error', 'Record and continue')
    await expectOutputs(modal, ['success', 'summary', 'replies', 'error', 'reason'], 'record')
    for (const name of ['error', 'reason']) {
      const { label, type } = OUTPUTS[name]
      await expect(outputRow(modal, name).locator('td:nth-child(2)'), name).toHaveText(label)
      await expect(outputRow(modal, name).locator('td:nth-child(3)'), name).toHaveText(type, {
        useInnerText: true,
      })
    }

    await pickEnum(page, modal, 'on_error', 'Fail the block')
    await expectOutputs(modal, ['success', 'summary', 'replies'], 'back to fail the block')
  })

  test('V-PLUGIN-PING-01 bounds: a value outside the range is messaged on its own row', async ({
    page,
  }) => {
    const modal = await openSheet(page, 'V-PLUGIN-PING-01 bounds')
    // Save turns on once the sheet is dirty; from here on only the bound can turn it off again.
    // FIELD-2: the first key typed over the gray default replaces it.
    await numberInput(modal, 'count').click()
    await page.keyboard.type('4')
    await expect(saveButton(modal)).toBeEnabled()

    // PING-17: the message lands under the field as the value is typed, with no blur.
    await numberInput(modal, 'count').fill(String(OUT_OF_RANGE_COUNT))
    await expect(rowAlert(modal, 'count')).toHaveText(COUNT_MESSAGE)
    await expect(numberInput(modal, 'count')).toHaveAttribute('aria-invalid', 'true')
    await expect(allAlerts(modal), 'no other row is flagged by it').toHaveCount(1)
    await expect(settingsNote(modal)).toHaveText(SETTINGS_NOTE)
    await expect(saveButton(modal)).toBeDisabled()
    // Nothing is clamped or rewritten: what the author typed is kept.
    await expect(numberInput(modal, 'count')).toHaveValue(String(OUT_OF_RANGE_COUNT))

    await numberInput(modal, 'count').fill('4')
    await expect(allAlerts(modal), 'a value back inside the range clears the message').toHaveCount(0)
    await expect(settingsNote(modal)).toHaveCount(0)
    await expect(saveButton(modal)).toBeEnabled()
  })

  test('V-PLUGIN-PING-01 stored bounds: Count outside its range', async ({ page }) => {
    const fixture = pingFixture('V-PLUGIN-PING-01 stored count', { count: OUT_OF_RANGE_COUNT })
    // Save refuses the value at its maximum; a Test file edited by hand can still hold it.
    const refused = await page.request.post(`${BACKEND_URL}/tests`, {
      data: { ...fixture, name: `zz-11541-r2-ping-refused-${Date.now()}` },
    })
    expect(refused.status(), 'Save refuses a Count past its maximum').toBe(422)
    expect(JSON.stringify(await refused.json())).toContain('SETTING_ABOVE_MAXIMUM')
    created.push((await importExpectingErrors(page, fixture, { context: 'load' })).testId)
    await expectBadgeMessage(page, nodeAlert(page), COUNT_MESSAGE)

    const modal = await openConfig(page, NODE_ID)
    await expect(rowAlert(modal, 'count')).toHaveText(COUNT_MESSAGE)
    await expect(numberInput(modal, 'count'), 'the stored value is kept verbatim').toHaveValue(
      String(OUT_OF_RANGE_COUNT),
    )
    await expect(allAlerts(modal), 'no other row is flagged by it').toHaveCount(1)
    await expect(settingsNote(modal)).toHaveText(SETTINGS_NOTE)
    await expect(saveButton(modal)).toBeDisabled()

    // The bound is what holds Save shut: a value back inside the range opens it.
    await numberInput(modal, 'count').fill('4')
    await expect(allAlerts(modal)).toHaveCount(0)
    await expect(settingsNote(modal)).toHaveCount(0)
    await expect(saveButton(modal)).toBeEnabled()
  })

  test('V-PLUGIN-PING-01 stored bounds: Minimum replies above Count', async ({ page }) => {
    // PING-18: a bound naming another row carries that rule's own message.
    const badge = await openStored(page, 'V-PLUGIN-PING-01 stored min replies', {
      count: 4,
      pass_when: 'min_replies',
      min_replies: 10,
    })
    await expectBadgeMessage(page, badge, MIN_REPLIES_MESSAGE)

    const modal = await openConfig(page, NODE_ID)
    await expect(rowAlert(modal, 'min_replies')).toHaveText(MIN_REPLIES_MESSAGE)
    await expect(numberInput(modal, 'min_replies')).toHaveValue('10')
    await expect(allAlerts(modal), 'only the row that names Count is flagged').toHaveCount(1)
    await expect(settingsNote(modal)).toHaveText(SETTINGS_NOTE)
    await expect(saveButton(modal)).toBeDisabled()

    await numberInput(modal, 'min_replies').fill('4')
    await expect(allAlerts(modal), 'Minimum replies equal to Count is inside the bound').toHaveCount(0)
    await expect(settingsNote(modal)).toHaveCount(0)
    await expect(saveButton(modal)).toBeEnabled()
  })
})
