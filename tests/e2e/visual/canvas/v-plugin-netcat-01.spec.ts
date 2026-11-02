/**
 * V-PLUGIN-NETCAT-01: Netcat block config sheet
 * Design Decisions: NETCAT-1, NETCAT-2, NETCAT-3, NETCAT-4, NETCAT-5, NETCAT-6, NETCAT-7, NETCAT-10, NETCAT-12,
 *   NETCAT-16, FIELD-1, FIELD-2
 * REQ: REQ-3.3.4.3, REQ-3.4.1.9
 *
 * Runs in the no-data project list. Each test imports its own Test through
 * POST /tests and afterAll deletes it. The stored block carries Host and Port,
 * so no state below shows the settings-errors note under Save unless stated.
 * Theme-agnostic DOM assertions.
 *
 * Pass Criteria:
 * 1. Check: the header carries the Cable glyph in the Network blue and the title
 *    "Netcat - Edit Config"; the input table reads Parameter / Type / Value; the sheet
 *    reads Host, Ports, Port, Protocol, Mode, Timeout, then Failure Handling and
 *    Secrets, both collapsed, Secrets last. Host (required, String) is the one value
 *    field showing the stored host with a toggle; Ports is a select showing Single
 *    (Single / Range) with no toggle; Port (required, Integer) shows the stored port
 *    with a toggle; Protocol shows TCP (TCP / UDP) and Mode shows Check (Check / Talk),
 *    neither with a toggle; Timeout (Integer) shows its default 10 in gray with a toggle
 *    and stores nothing. There is no Send, Text, File or Advanced row or group, and no
 *    settings-errors note. Failure Handling expands to the On error select on Fail
 *    the block.
 * 2. Range: Ports = Range removes Port and puts Port range (required, String, value
 *    field showing "22, 80, 8000-8010", toggle) right after Ports and Pass when
 *    (select on One succeeds, One succeeds / All succeed, no toggle) between Port range
 *    and Protocol; no settings-errors note. Ports = Single brings Port back with its
 *    stored value and removes both Range rows.
 * 3. Talk: the sheet reads Host, Ports, Port, Protocol, Mode (Talk), Send (select on
 *    Text, no toggle), Text (value field with the stored payload's first line cut with "…", toggle),
 *    Timeout, then Advanced, Failure Handling and Secrets. Advanced opens collapsed;
 *    expanded it reads CRLF line endings (Boolean, unticked, toggle), Close after
 *    sending (Boolean, unticked, toggle) and Max reply size (bytes) (Integer, gray default
 *    16777216, toggle) with the footer "Line endings, closing and reply size for Talk",
 *    above Failure Handling.
 * 4. Talk show rules: over TCP Send offers Nothing / Text / File; Nothing shows neither
 *    Text nor File; File puts the File row (required, path placeholder, Browse, toggle)
 *    where Text was, hides Text and blocks Save with the settings-errors note until
 *    Send goes back to Text, which shows the stored payload again. Over UDP Close
 *    after sending leaves the Advanced group and Send offers Text / File only; back
 *    on TCP both return.
 * 5. Outputs: the output table reads Parameter / Type / Secret / Assign to with Success
 *    (Boolean), Results (Table) and Reply (String), each with an unticked Secret box and
 *    an empty Assign to input. Reply leaves for Range and for Check; Error and Reason
 *    (String) join only under On error = Record and continue. With nothing stored, Text
 *    and Port range start empty, and the empty required Port range shows the
 *    settings-errors note until Ports goes back to Single.
 * 6. Remote body: a Netcat block inside a Remote Execution body carries the R locus badge;
 *    its Talk File row shows the stored path but no Browse, because the file is read on
 *    the remote host.
 */

import { test, expect, type Locator, type Page } from '../../helpers/playwright-fixtures'
import { importValidateAndNavigate } from '../../helpers/fixture-import'
import {
  BACKEND_URL,
  NETCAT_ECHO_HOST,
  NETCAT_TARGET_SERVICE,
  NETCAT_TCP_ECHO_PORT,
  SSH_FIXTURE_HOST_SENTINEL,
} from '../../helpers/config'
import { deleteTest, expandGroup, openConfig } from '../../functional/file-picker/picker'
import { expectGrayDefault } from '../../helpers/default-rule'

// ---------------------------------------------------------------------------
// Imported Test
// ---------------------------------------------------------------------------

const NODE_ID = '5f3c8e21-9a4b-4d7e-8c16-2b0e7a9d4f53'
const START_EDGE_ID = 'c81d4f07-3e6a-4b92-a5d8-7f1b0c6e2a94'
const REMOTE_CONTAINER_ID = '055dad31-21f3-4e3c-bb19-b4d805339bea'
const REMOTE_NODE_ID = '09ae4026-056d-41c1-9ad3-cc0e0c35d654'
const REMOTE_START_EDGE_ID = '42723b2a-4d91-4abe-97bd-b7ce6d3788c2'
const REMOTE_BODY_EDGE_ID = 'aab3ea36-56bc-4fbc-a8f2-0e4b369a9c66'
const REMOTE_PAYLOAD_PATH = '/tmp/netcat-payload.txt'

const PORT_RANGE = '22, 80, 8000-8010'
const TALK_TEXT = 'GET / HTTP/1.0\n\n'
const TALK_TEXT_PREVIEW = 'GET / HTTP/1.0'

function netcatNode(
  id: string,
  position: { x: number; y: number },
  values: Record<string, unknown>,
): Record<string, unknown> {
  return {
    id,
    type: 'workflowNode',
    position,
    data: {
      label: 'Netcat',
      elementType: 'netcat',
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

/** One Netcat block on the Test; the Host carries the SSH sentinel that injectSsh rewrites. */
function netcatFixture(name: string, values: Record<string, unknown>): Record<string, unknown> {
  return {
    name,
    version: '1.0.0',
    description: '',
    workflow: {
      nodes: [
        netcatNode(NODE_ID, { x: -75, y: 100 }, {
          host: SSH_FIXTURE_HOST_SENTINEL,
          port: Number(NETCAT_TCP_ECHO_PORT),
          ...values,
        }),
      ],
      edges: [{ id: START_EDGE_ID, source: 'start-node', target: NODE_ID }],
    },
    variables: {},
    metadata: { tags: [], suite_id: null, parent_suite: null },
  }
}

/** One Netcat block inside a Remote Execution body, in Talk sending a plain path. */
function remoteBodyFixture(name: string): Record<string, unknown> {
  return {
    name,
    version: '1.0.0',
    description: '',
    workflow: {
      nodes: [
        {
          id: REMOTE_CONTAINER_ID,
          type: 'workflowNode',
          position: { x: -75, y: 100 },
          data: {
            label: 'Remote Execution',
            elementType: 'remote-execution',
            nodeType: 'plugin',
            category: 'remote',
            version: '1.0.0',
            description: '',
            hasNewerVersion: false,
            expressionFields: ['session_id'],
            templateFields: [],
            config: {
              values: { session_id: 'sid' },
              outputBindings: { remote_session_id: 'rsid' },
              profileBindings: [],
            },
          },
          measured: { width: 160, height: 62 },
        },
        netcatNode(REMOTE_NODE_ID, { x: -75, y: 260 }, {
          host: NETCAT_TARGET_SERVICE,
          port: Number(NETCAT_TCP_ECHO_PORT),
          mode: 'talk',
          send: 'file',
          file: REMOTE_PAYLOAD_PATH,
        }),
      ],
      edges: [
        { id: REMOTE_START_EDGE_ID, source: 'start-node', target: REMOTE_CONTAINER_ID },
        {
          id: REMOTE_BODY_EDGE_ID,
          source: REMOTE_CONTAINER_ID,
          sourceHandle: 'body',
          target: REMOTE_NODE_ID,
          type: 'default',
        },
      ],
    },
    variables: {
      sid: { value: '', type: 'string', scope: 'test' },
      rsid: { value: '', type: 'string', scope: 'test' },
    },
    metadata: { tags: [], suite_id: null, parent_suite: null },
  }
}

// ---------------------------------------------------------------------------
// Expected sheet content, verbatim from the shipped schema
// ---------------------------------------------------------------------------

const ADVANCED_FOOTER = 'Line endings, closing and reply size for Talk'
const SETTINGS_NOTE = 'Save is disabled: the settings have errors'
const FILE_PLACEHOLDER = 'testdata://…, artifact://…, or /abs/path'

type Control = 'edit' | 'select' | 'number' | 'checkbox'

interface RowSpec {
  label: string
  type: string
  control: Control
  required: boolean
}

const ROWS: Record<string, RowSpec> = {
  host: { label: 'Host', type: 'String', control: 'edit', required: true },
  ports: { label: 'Ports', type: 'String', control: 'select', required: false },
  port: { label: 'Port', type: 'Integer', control: 'number', required: true },
  port_range: { label: 'Port range', type: 'String', control: 'edit', required: true },
  pass_when: { label: 'Pass when', type: 'String', control: 'select', required: false },
  protocol: { label: 'Protocol', type: 'String', control: 'select', required: false },
  mode: { label: 'Mode', type: 'String', control: 'select', required: false },
  send: { label: 'Send', type: 'String', control: 'select', required: false },
  text: { label: 'Text', type: 'String', control: 'edit', required: false },
  file: { label: 'File', type: 'String', control: 'edit', required: true },
  timeout: { label: 'Timeout', type: 'Integer', control: 'number', required: false },
  crlf: { label: 'CRLF line endings', type: 'Boolean', control: 'checkbox', required: false },
  close_after_send: { label: 'Close after sending', type: 'Boolean', control: 'checkbox', required: false },
  max_reply_bytes: { label: 'Max reply size (bytes)', type: 'Integer', control: 'number', required: false },
  on_error: { label: 'On error', type: 'String', control: 'select', required: false },
}

const CHECK_ROWS = ['host', 'ports', 'port', 'protocol', 'mode', 'timeout']
const RANGE_ROWS = ['host', 'ports', 'port_range', 'pass_when', 'protocol', 'mode', 'timeout']
const TALK_ROWS = ['host', 'ports', 'port', 'protocol', 'mode', 'send', 'text', 'timeout']
const TALK_FILE_ROWS = ['host', 'ports', 'port', 'protocol', 'mode', 'send', 'file', 'timeout']
const TALK_NOTHING_ROWS = ['host', 'ports', 'port', 'protocol', 'mode', 'send', 'timeout']
const ADVANCED_ROWS = ['crlf', 'close_after_send', 'max_reply_bytes']
const UDP_ADVANCED_ROWS = ['crlf', 'max_reply_bytes']
const CLOSED_TAIL = ['[Failure Handling]', '[Secrets]']

const OUTPUTS: Record<string, { label: string; type: string }> = {
  success: { label: 'Success', type: 'Boolean' },
  results: { label: 'Results', type: 'Table' },
  reply: { label: 'Reply', type: 'String' },
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
  created.push(await importValidateAndNavigate(page, netcatFixture(name, values), { injectSsh: true }))
  const modal = await openConfig(page, NODE_ID)
  await expect(modal.getByRole('heading', { name: 'Netcat - Edit Config' })).toBeVisible()
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
const browseButton = (modal: Locator, name: string) => modal.locator(`[data-testid="param-browse-${name}"]`)
const groupHeader = (modal: Locator, name: string) => modal.locator(`[data-testid="group-header-${name}"]`)
const groupFooter = (modal: Locator, name: string) => modal.locator(`[data-testid="group-footer-${name}"]`)
const secretsTrigger = (modal: Locator) => modal.locator('[data-testid="secrets-section-trigger"]')
const settingsNote = (modal: Locator) => modal.locator('[data-testid="save-blocked-note"]')
const inputTable = (modal: Locator) => modal.locator('table:has([data-testid="param-row-host"])')
const outputTable = (modal: Locator) => modal.locator('table:has([data-testid="output-row-success"])')

/** A many-line Text shows its first line cut with "…" and carries the whole text in its title. */
async function expectTalkText(modal: Locator): Promise<void> {
  await expect(editPreview(modal, 'text')).toHaveValue(`${TALK_TEXT_PREVIEW}…`)
  await expect(editPreview(modal, 'text')).toHaveAttribute('title', TALK_TEXT)
}

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
    // NETCAT-12: selects take no expression; every other row does.
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

test.describe('V-PLUGIN-NETCAT-01: Netcat block config sheet', () => {
  test.afterAll(async ({ request }) => {
    for (const testId of created.splice(0)) await deleteTest(request, testId)
  })

  test('V-PLUGIN-NETCAT-01 check: the Check rows in order, with Failure Handling and Secrets collapsed', async ({
    page,
  }) => {
    const modal = await openSheet(page, 'V-PLUGIN-NETCAT-01 check')

    // NETCAT-12: the title glyph stays Cable, in the Network blue.
    const glyph = modal.getByRole('heading', { name: 'Netcat - Edit Config' }).locator('svg.lucide-cable')
    await expect(glyph).toHaveCount(1)
    await expect(glyph).toHaveClass(/\btext-blue-500\b/)

    await expect(modal.getByRole('heading', { name: 'Input Parameters' })).toBeVisible()
    expect(await headerTexts(inputTable(modal))).toEqual(['', 'Parameter', 'Type', 'Value'])

    await expectLayout(modal, [...CHECK_ROWS, ...CLOSED_TAIL], 'check on open')
    await expectRows(modal, CHECK_ROWS)

    await expect(editPreview(modal, 'host')).toHaveValue(NETCAT_ECHO_HOST)
    await expect(numberInput(modal, 'port')).toHaveValue(NETCAT_TCP_ECHO_PORT)
    await expect(enumTrigger(modal, 'ports')).toHaveText('Single')
    await expect(enumTrigger(modal, 'protocol')).toHaveText('TCP')
    await expect(enumTrigger(modal, 'mode')).toHaveText('Check')
    await expectOptions(page, modal, 'ports', ['Single', 'Range'])
    await expectOptions(page, modal, 'protocol', ['TCP', 'UDP'])
    await expectOptions(page, modal, 'mode', ['Check', 'Talk'])

    // NETCAT-6, FIELD-2: the default 10 shows in gray; nothing is stored.
    await expectGrayDefault(modal, 'timeout', '10')

    for (const name of ['send', 'text', 'file', ...ADVANCED_ROWS]) {
      await expect(paramRow(modal, name), `${name} absent in Check`).toHaveCount(0)
    }
    await expect(groupHeader(modal, 'Advanced')).toHaveCount(0)

    await expect(groupHeader(modal, 'Failure Handling')).toHaveAttribute('aria-expanded', 'false')
    await expect(groupFooter(modal, 'Failure Handling')).toHaveCount(0)
    await expect(secretsTrigger(modal)).toHaveAttribute('aria-expanded', 'false')
    await expect(settingsNote(modal)).toHaveCount(0)

    await expandGroup(modal, 'Failure Handling')
    await expectLayout(
      modal,
      [...CHECK_ROWS, '[Failure Handling]', 'on_error', '[Secrets]'],
      'failure handling expanded',
    )
    await expectRows(modal, ['on_error'])
    await expect(enumTrigger(modal, 'on_error')).toHaveText('Fail the block')
  })

  test('V-PLUGIN-NETCAT-01 range: Port range and Pass when take the place of Port', async ({ page }) => {
    const modal = await openSheet(page, 'V-PLUGIN-NETCAT-01 range', { port_range: PORT_RANGE })
    await expectLayout(modal, [...CHECK_ROWS, ...CLOSED_TAIL], 'single on open')

    await pickEnum(page, modal, 'ports', 'Range')
    await expectLayout(modal, [...RANGE_ROWS, ...CLOSED_TAIL], 'range')
    await expect(paramRow(modal, 'port')).toHaveCount(0)
    await expectRows(modal, RANGE_ROWS)
    await expect(editPreview(modal, 'port_range')).toHaveValue(PORT_RANGE)
    await expect(enumTrigger(modal, 'pass_when')).toHaveText('One succeeds')
    await expectOptions(page, modal, 'pass_when', ['One succeeds', 'All succeed'])
    await expect(settingsNote(modal)).toHaveCount(0)

    await pickEnum(page, modal, 'ports', 'Single')
    await expectLayout(modal, [...CHECK_ROWS, ...CLOSED_TAIL], 'back to single')
    await expect(numberInput(modal, 'port')).toHaveValue(NETCAT_TCP_ECHO_PORT)
    await expect(paramRow(modal, 'port_range')).toHaveCount(0)
    await expect(paramRow(modal, 'pass_when')).toHaveCount(0)
  })

  test('V-PLUGIN-NETCAT-01 talk: Send, Text and the Advanced group', async ({ page }) => {
    const modal = await openSheet(page, 'V-PLUGIN-NETCAT-01 talk', { mode: 'talk', text: TALK_TEXT })

    await expectLayout(modal, [...TALK_ROWS, '[Advanced]', ...CLOSED_TAIL], 'talk on open')
    await expectRows(modal, TALK_ROWS)
    await expect(enumTrigger(modal, 'mode')).toHaveText('Talk')
    await expect(enumTrigger(modal, 'send')).toHaveText('Text')
    await expectTalkText(modal)
    await expectGrayDefault(modal, 'timeout', '10')
    await expect(settingsNote(modal)).toHaveCount(0)

    // NETCAT-5: Advanced opens collapsed.
    await expect(groupHeader(modal, 'Advanced')).toHaveAttribute('aria-expanded', 'false')
    await expect(groupFooter(modal, 'Advanced')).toHaveCount(0)
    await expect(groupHeader(modal, 'Failure Handling')).toHaveAttribute('aria-expanded', 'false')
    await expect(secretsTrigger(modal)).toHaveAttribute('aria-expanded', 'false')

    await expandGroup(modal, 'Advanced')
    await expectLayout(
      modal,
      [...TALK_ROWS, '[Advanced]', ...ADVANCED_ROWS, ...CLOSED_TAIL],
      'advanced expanded',
    )
    await expectRows(modal, ADVANCED_ROWS)
    await expect(groupFooter(modal, 'Advanced')).toHaveText(ADVANCED_FOOTER)
    await expect(checkbox(modal, 'crlf')).toHaveAttribute('data-state', 'unchecked')
    await expect(checkbox(modal, 'close_after_send')).toHaveAttribute('data-state', 'unchecked')
    await expectGrayDefault(modal, 'max_reply_bytes', '16777216')
  })

  test('V-PLUGIN-NETCAT-01 talk show rules: Send over TCP and UDP, and the File row', async ({ page }) => {
    const modal = await openSheet(page, 'V-PLUGIN-NETCAT-01 talk rules', { mode: 'talk', text: TALK_TEXT })
    await expandGroup(modal, 'Advanced')
    await expectLayout(
      modal,
      [...TALK_ROWS, '[Advanced]', ...ADVANCED_ROWS, ...CLOSED_TAIL],
      'tcp talk',
    )

    // NETCAT-4: over TCP, Nothing sends no payload, so neither Text nor File shows.
    await expectOptions(page, modal, 'send', ['Nothing', 'Text', 'File'])
    await pickEnum(page, modal, 'send', 'Nothing')
    await expectLayout(
      modal,
      [...TALK_NOTHING_ROWS, '[Advanced]', ...ADVANCED_ROWS, ...CLOSED_TAIL],
      'send nothing',
    )

    await pickEnum(page, modal, 'send', 'File')
    await expectLayout(
      modal,
      [...TALK_FILE_ROWS, '[Advanced]', ...ADVANCED_ROWS, ...CLOSED_TAIL],
      'send file',
    )
    await expectRows(modal, ['file'])
    await expect(editPreview(modal, 'file')).toHaveValue('')
    await expect(editPreview(modal, 'file')).toHaveAttribute('placeholder', FILE_PLACEHOLDER)
    await expect(browseButton(modal, 'file')).toBeVisible()
    await expect(paramRow(modal, 'text')).toHaveCount(0)
    await expect(settingsNote(modal)).toHaveText(SETTINGS_NOTE)
    await expect(modal.getByRole('button', { name: 'Save', exact: true })).toBeDisabled()

    await pickEnum(page, modal, 'send', 'Text')
    await expectLayout(
      modal,
      [...TALK_ROWS, '[Advanced]', ...ADVANCED_ROWS, ...CLOSED_TAIL],
      'send text again',
    )
    await expectTalkText(modal)
    await expect(paramRow(modal, 'file')).toHaveCount(0)
    await expect(settingsNote(modal)).toHaveCount(0)

    // NETCAT-4, NETCAT-16: over UDP Send drops Nothing and Close after sending leaves.
    await pickEnum(page, modal, 'protocol', 'UDP')
    await expectLayout(
      modal,
      [...TALK_ROWS, '[Advanced]', ...UDP_ADVANCED_ROWS, ...CLOSED_TAIL],
      'udp talk',
    )
    await expect(enumTrigger(modal, 'send')).toHaveText('Text')
    await expectOptions(page, modal, 'send', ['Text', 'File'])

    await pickEnum(page, modal, 'protocol', 'TCP')
    await expectLayout(
      modal,
      [...TALK_ROWS, '[Advanced]', ...ADVANCED_ROWS, ...CLOSED_TAIL],
      'tcp talk again',
    )
    await expect(checkbox(modal, 'close_after_send')).toHaveAttribute('data-state', 'unchecked')
    await expectOptions(page, modal, 'send', ['Nothing', 'Text', 'File'])
  })

  test('V-PLUGIN-NETCAT-01 outputs: Success, Results and Reply, with Reply only for Single and Talk', async ({
    page,
  }) => {
    const modal = await openSheet(page, 'V-PLUGIN-NETCAT-01 outputs', { mode: 'talk' })
    await expect(settingsNote(modal)).toHaveCount(0)
    // Text defaults to empty.
    await expect(editPreview(modal, 'text')).toHaveValue('')

    await expect(modal.getByRole('heading', { name: 'Output Variables' })).toBeVisible()
    expect(await headerTexts(outputTable(modal))).toEqual(['', 'Parameter', 'Type', 'Secret', 'Assign to'])
    await expectOutputs(modal, ['success', 'results', 'reply'], 'single talk')
    for (const name of ['success', 'results', 'reply']) {
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

    // NETCAT-7: Reply exists only for Ports = Single with Mode = Talk.
    await pickEnum(page, modal, 'ports', 'Range')
    await expectOutputs(modal, ['success', 'results'], 'range talk')
    // Port range defaults to empty, and an empty required row blocks Save.
    await expect(editPreview(modal, 'port_range')).toHaveValue('')
    await expect(settingsNote(modal)).toHaveText(SETTINGS_NOTE)
    await pickEnum(page, modal, 'ports', 'Single')
    await expectOutputs(modal, ['success', 'results', 'reply'], 'single talk again')
    await expect(settingsNote(modal)).toHaveCount(0)
    await pickEnum(page, modal, 'mode', 'Check')
    await expectOutputs(modal, ['success', 'results'], 'single check')

    await expandGroup(modal, 'Failure Handling')
    await pickEnum(page, modal, 'on_error', 'Record and continue')
    await expectOutputs(modal, ['success', 'results', 'error', 'reason'], 'check, record and continue')
    for (const name of ['error', 'reason']) {
      const { label, type } = OUTPUTS[name]
      await expect(outputRow(modal, name).locator('td:nth-child(2)'), name).toHaveText(label)
      await expect(outputRow(modal, name).locator('td:nth-child(3)'), name).toHaveText(type, {
        useInnerText: true,
      })
    }

    await pickEnum(page, modal, 'mode', 'Talk')
    await expectOutputs(modal, ['success', 'results', 'reply', 'error', 'reason'], 'talk, record and continue')
    await pickEnum(page, modal, 'on_error', 'Fail the block')
    await expectOutputs(modal, ['success', 'results', 'reply'], 'talk, fail the block')
  })

  test('V-PLUGIN-NETCAT-01 remote body: the R badge, and the File row without Browse', async ({ page }) => {
    await page.request.delete(`${BACKEND_URL}/workbench/session/`).catch(() => {})
    created.push(await importValidateAndNavigate(page, remoteBodyFixture('V-PLUGIN-NETCAT-01 remote body')))

    const badge = page.locator(
      `[data-testid="workflow-node-${REMOTE_NODE_ID}"] [data-testid="node-remote-locus-badge"]`,
    )
    await expect(badge).toHaveAttribute('data-locus', 'R')
    await expect(badge).toHaveText('R')
    await expect(badge).toHaveAttribute('aria-label', 'Runs on the remote host')

    const modal = await openConfig(page, REMOTE_NODE_ID)
    await expect(modal.getByRole('heading', { name: 'Netcat - Edit Config' })).toBeVisible()
    await expectLayout(modal, [...TALK_FILE_ROWS, '[Advanced]', ...CLOSED_TAIL], 'remote talk file')
    await expectRows(modal, ['file'])
    await expect(editPreview(modal, 'file')).toHaveValue(REMOTE_PAYLOAD_PATH)
    // NETCAT-10: nothing on the remote host can be picked from WAVE's file tree.
    await expect(browseButton(modal, 'file')).toHaveCount(0)
  })
})
