/**
 * V-PLUGIN-SFTP-FLOW-FUNCTIONAL: a partner exchange built block by block on the canvas
 * Wireframe: N/A
 * Design Decisions: SFTP-1, SFTP-2, SFTP-4, SFTP-5, SFTP-9, WAIT-3, WAIT-6, WAIT-8
 * REQ: REQ-3.4.1.8
 *
 * An empty Test is opened on the canvas and the whole workflow is built through the UI: each
 * block dropped from the palette under the previous one, every row set in its sheet, Upload's
 * Source picked with Browse, the Wait Until retry lane dragged from its lane dot, output
 * variables created from the Assign to fields, the Test saved with the toolbar Save. An SSH
 * Session Exec stands in for the partner system: 3 s later it writes the answer file.
 *
 * Pass Criteria:
 * 1. FLOW-1: the saved Test holds the blocks in the built order with every SFTP row as typed
 *    (Operation values, the Browse-picked `testdata://orders.csv`, Session ID in expression mode)
 *    and validates with zero errors.
 * 2. FLOW-2: the run passes and every block ends success.
 * 3. FLOW-3: Upload's Summary holds one row [absolute WAVE path ending /orders.csv,
 *    {F}/inbound/orders.tmp, size] and the console logs the Upload line.
 * 4. FLOW-4: Move logs the Move line.
 * 5. FLOW-5: the Stats on the retry lane ran at least twice, every round logged the Stats line
 *    and none failed, the last reported Exists true, and the wait ended on its condition, not its
 *    give-up.
 * 6. FLOW-6: Download logs the Saved artifact line then the Download line `... to the run's
 *    files`; its Summary row lands at an absolute WAVE path ending /orders.out; the artifact reads
 *    back as orders.csv with `pending` replaced by `done`.
 * 7. FLOW-7: File I/O Read and Assert pass.
 * 8. FLOW-8: Delete logs `Deleted {F}`; the final Stats gives Exists false, Type empty, Size 0,
 *    Modified empty.
 * 9. FLOW-9: no console line written by an SFTP block carries the marker; the password never
 *    appears in clear.
 */

import { leaveExpressionEditor } from '../../helpers/code-editor'
import { test, expect, type Locator, type Page } from '../../helpers/playwright-fixtures'
import {
  BACKEND_URL,
  SSH_MAIN_PORT,
  SSH_STACK_PASSWORD,
  SSH_STACK_USER,
  SSH_TARGET_HOST,
  ensureEnvironment,
} from '../../helpers/config'
import {
  dragPaletteItemToCanvas,
  expandPalette,
  waitForViewportSettled,
  type PaletteDragSpec,
} from '../../helpers/canvas'
import { enumTrigger, exprToggle, numberInput, paramRow, pickEnum } from '../../helpers/config-sheet'
import { getTest } from '../../helpers/element-types'
import { createValidTest } from '../../helpers/fn-seed'
import { expectNodeStatus } from '../../helpers/k8s-run'
import { formatEntries } from '../../helpers/log-reader'
import { uploadTestData } from '../../helpers/testdata'
import {
  LANE_VIEWPORT,
  canvasNodeIds,
  dragFromLane,
  dropBelow,
  edgeOnCanvas,
  expectDrawnFromLane,
  nodeLocator,
  openLaneCanvas,
  saveCanvas,
} from '../canvas-lanes/lanes-helpers'
import {
  confirmPicker,
  deleteTest,
  expandGroup,
  expectReference,
  expectRowValue,
  openConfig,
  openPicker,
  saveConfig,
} from '../file-picker/picker'
import {
  SFTP_SOURCE,
  expectArtifactText,
  expectRunValid,
  fillTextRow,
  newSftpRun,
  ordersCsv,
  out,
  runCleanup,
  runSftpTest,
  sftpLine,
  sftpLines,
  summaryRows,
} from './sftp-cases'

test.use({ viewport: LANE_VIEWPORT })

const PALETTE = {
  open: { term: 'SSH Session Open', testId: 'palette-item-ssh-session-open' },
  exec: { term: 'SSH Session Exec', testId: 'palette-item-ssh-session-exec' },
  close: { term: 'SSH Session Close', testId: 'palette-item-ssh-session-close' },
  sftp: { term: 'SFTP', testId: 'palette-item-sftp' },
  wait: { term: 'Wait Until', testId: 'palette-item-wait-until' },
  fileIo: { term: 'File I/O', testId: 'palette-item-file-io' },
  assert: { term: 'Assert', testId: 'palette-item-assert' },
  log: { term: 'Log', testId: 'palette-item-log' },
} satisfies Record<string, PaletteDragSpec>

const START = 'start-node'
const run = newSftpRun('sftp-flow')
const F = run.folder
const MARKER = `sftp-w1-${run.uuid}`
const ORDERS = ordersCsv(MARKER)
const ORDERS_BYTES = Buffer.byteLength(ORDERS)
const ANSWER = ORDERS.replaceAll('pending', 'done')
const ANSWER_BYTES = Buffer.byteLength(ANSWER)
const BOOKEND = `sftp-flow-done-${run.uuid}`

const INBOUND_TMP = `${F}/inbound/orders.tmp`
const INBOUND_CSV = `${F}/inbound/orders.csv`
const OUTBOUND = `${F}/outbound/orders.out`
const PARTNER_COMMAND =
  `nohup sh -c 'sleep 3; mkdir -p ${F}/outbound && sed s/pending/done/ ${INBOUND_CSV} > ${F}/outbound/.orders.out` +
  ` && mv ${F}/outbound/.orders.out ${OUTBOUND}' >/dev/null 2>&1 &`
// A Python string literal (the `\n` escapes stay two characters); ending on the variable lets its suggestion settle.
const ANSWER_CONDITION = `${JSON.stringify(ANSWER)} == out_text`

/** Unique descriptions; an SFTP block also takes its own as its Name, which its console source carries (EXEC-25). */
const DESC = {
  open: 'Open the partner session',
  upload: 'Upload the orders',
  move: 'Move the orders into place',
  partner: 'Partner system answers',
  wait: 'Wait for the answer',
  poll: 'Poll for the answer',
  download: 'Download the answer',
  read: 'Read the answer',
  assert: 'Check the answer',
  remove: 'Delete the spec folder',
  gone: 'Check the spec folder is gone',
  close: 'Close the partner session',
  done: 'Bookend',
} as const

type Key = keyof typeof DESC

const ELEMENT_TYPES: Record<Key, string> = {
  open: 'ssh-session-open',
  upload: 'sftp',
  move: 'sftp',
  partner: 'ssh-session-exec',
  wait: 'wait-until',
  poll: 'sftp',
  download: 'sftp',
  read: 'file-io',
  assert: 'assert',
  remove: 'sftp',
  gone: 'sftp',
  close: 'ssh-session-close',
  done: 'log',
}

const CREATED_VARIABLES = [
  'ssh_session',
  'up_summary',
  'out_exists',
  'wait_passed',
  'down_summary',
  'out_text',
  'answer_ok',
  'gone_exists',
  'gone_type',
  'gone_size',
  'gone_modified',
]

const createdTests: string[] = []

// ---------------------------------------------------------------------------
// Canvas
// ---------------------------------------------------------------------------

async function fitView(page: Page): Promise<void> {
  await expandPalette(page)
  await page.locator('.react-flow__controls-fitview').click()
  await waitForViewportSettled(page)
}

async function boxOf(locator: Locator, what: string) {
  await expect(locator, `${what} is on the canvas`).toBeVisible()
  const box = await locator.boundingBox()
  expect(box, `${what} has a box`).not.toBeNull()
  return box!
}

/** Drop a palette block just under Start; the drop links it from Start. */
async function dropUnderStart(page: Page, block: PaletteDragSpec): Promise<string> {
  await fitView(page)
  const canvas = await boxOf(page.getByTestId('workflow-canvas'), 'the canvas')
  const start = await boxOf(page.getByTestId(START), 'Start')
  const before = await canvasNodeIds(page)
  await dragPaletteItemToCanvas(page, block, {
    x: start.x - canvas.x + start.width / 2,
    y: start.y - canvas.y + start.height + 60,
  })
  const added = (await canvasNodeIds(page)).filter((id) => !before.includes(id))
  expect(added, 'exactly one block was dropped').toHaveLength(1)
  await expect(edgeOnCanvas(page, START, added[0]), 'the drop under Start links it').toHaveCount(1)
  return added[0]
}

/** Drop a palette block under a lane dot; the drop links it from that lane. */
async function dropUnder(page: Page, source: string, handle: string | null, block: PaletteDragSpec): Promise<string> {
  await fitView(page)
  const id = await dropBelow(page, source, handle, block)
  await expect(edgeOnCanvas(page, source, id), `the drop links ${source} -> ${id}`).toHaveCount(1)
  await expectDrawnFromLane(page, source, handle, id)
  return id
}

/** Drop a palette block well to the right of `anchor`, out of reach of every free lane. */
async function dropBeside(page: Page, anchor: string, block: PaletteDragSpec): Promise<string> {
  await fitView(page)
  const canvas = await boxOf(page.getByTestId('workflow-canvas'), 'the canvas')
  const node = await boxOf(nodeLocator(page, anchor), `block ${anchor}`)
  const before = await canvasNodeIds(page)
  await dragPaletteItemToCanvas(page, block, {
    x: node.x - canvas.x + node.width * 2.5,
    y: node.y - canvas.y + node.height / 2,
  })
  const added = (await canvasNodeIds(page)).filter((id) => !before.includes(id))
  expect(added, 'exactly one block was dropped').toHaveLength(1)
  await expect(
    page.locator(`.react-flow__edge[aria-label$=" to ${added[0]}"]`),
    'a drop out of reach links nothing',
  ).toHaveCount(0)
  return added[0]
}

// ---------------------------------------------------------------------------
// Sheets
// ---------------------------------------------------------------------------

async function describeBlock(sheet: Locator, text: string): Promise<void> {
  const input = sheet.locator('[data-testid="element-description-input"]')
  await input.fill(text)
  await expect(input).toHaveValue(text)
}

async function nameBlock(sheet: Locator, text: string): Promise<void> {
  const input = sheet.locator('[data-testid="element-name-input"]')
  await input.fill(text)
  await expect(input).toHaveValue(text)
}

/** Type an expression that ends on a variable name, wait for that suggestion, then leave the editor. */
async function typeExpression(
  page: Page,
  sheet: Locator,
  editor: Locator,
  expression: string,
  variable: string,
): Promise<void> {
  await editor.click()
  await page.keyboard.insertText(expression)
  const suggestions = page.getByRole('listbox', { name: 'Completions' })
  await expect(suggestions.getByRole('option').filter({ hasText: variable }), `${variable} is offered`).toBeVisible()
  await leaveExpressionEditor(editor)
  await expect(sheet, 'leaving the editor left the sheet open').toBeVisible()
  await expect(editor).toHaveText(expression)
}

/** Turn a row's {} on and type a variable name into it. */
async function expressionRow(page: Page, sheet: Locator, name: string, variable: string): Promise<void> {
  const toggle = exprToggle(sheet, name)
  await toggle.click()
  await expect(toggle).toHaveAttribute('data-state', 'on')
  const editor = paramRow(sheet, name).locator(`[data-testid="param-input-${name}"] .cm-content`)
  await typeExpression(page, sheet, editor, variable, variable)
}

/** Add one Expression condition to an empty assertion builder. */
async function addCondition(page: Page, sheet: Locator, expression: string, variable: string): Promise<void> {
  await expect(sheet.getByTestId('assertion-builder-empty'), 'the fresh block holds no condition').toBeVisible()
  await sheet.getByTestId('assert-add-assertion').click()
  await sheet.getByTestId('assert-add-expression').click()
  const editor = sheet.locator('[data-testid="assert-expression-input-0"] .cm-content')
  await typeExpression(page, sheet, editor, expression, variable)
}

/** Bind an output to a new variable typed into its Assign to field. */
async function assignNew(page: Page, sheet: Locator, label: string, name: string): Promise<void> {
  const assign = sheet.getByRole('combobox', { name: `Assign ${label} to`, exact: true })
  await assign.scrollIntoViewIfNeeded()
  await assign.fill(name)
  const hint = page.getByTestId('output-new-var-hint').filter({ hasText: `“${name}”` })
  await expect(hint, `${name} is a new variable`).toHaveText(`“${name}” will be created as a new variable`)
  await assign.press('Escape')
  await expect(hint, 'Escape closes the suggestion list').toHaveCount(0)
  await expect(sheet).toBeVisible()
  await expect(assign).toHaveValue(name)
}

/** An SFTP sheet: Name and description (the same text), Session ID `{}` ssh_session, then the Operation. */
async function openSftp(page: Page, id: string, description: string, operation: string): Promise<Locator> {
  const sheet = await openConfig(page, id)
  await nameBlock(sheet, description)
  await describeBlock(sheet, description)
  await expressionRow(page, sheet, 'session_id', 'ssh_session')
  if (operation === 'Upload') await expect(enumTrigger(sheet, 'operation'), 'Upload by default').toHaveText('Upload')
  else await pickEnum(page, sheet, 'operation', operation)
  return sheet
}

// ---------------------------------------------------------------------------
// Saved Test
// ---------------------------------------------------------------------------

type Edge = [source: string, handle: string | null, target: string]

const edgeKey = ([source, handle, target]: Edge): string => `${source} -[${handle ?? ''}]-> ${target}`

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

test.describe('V-PLUGIN-SFTP-FLOW-FUNCTIONAL: a partner exchange built on the canvas', () => {
  test.afterAll(async ({ request }) => {
    await runCleanup(request, { account: 'wave', paths: [F] })
    await request.delete(`${BACKEND_URL}/workbench/session/`).catch(() => undefined)
    for (const testId of createdTests.splice(0)) await deleteTest(request, testId)
  })

  test('FLOW-1..FLOW-9: Upload by Browse, Move, the partner job, a polled Stats, Download, Read, Assert, Delete', async ({
    page,
    request,
  }) => {
    test.setTimeout(600_000)
    const ids = {} as Record<Key, string>

    const testId = await test.step('an empty Test with orders.csv in its Test Data, open on the canvas', async () => {
      await ensureEnvironment(request)
      await request.delete(`${BACKEND_URL}/workbench/session/`).catch(() => undefined)
      const id = await createValidTest(request, {
        name: `V-PLUGIN-SFTP-FLOW-FUNCTIONAL ${run.uuid}`,
        nodes: [],
        edges: [],
      })
      createdTests.push(id)
      await uploadTestData(request, id, '', 'orders.csv', Buffer.from(ORDERS))
      await openLaneCanvas(page, id)
      return id
    })

    await test.step('SSH Session Open: the stack sshd, Strict host keys, Session ID bound to ssh_session', async () => {
      ids.open = await dropUnderStart(page, PALETTE.open)
      const sheet = await openConfig(page, ids.open)
      await describeBlock(sheet, DESC.open)
      await fillTextRow(page, sheet, 'host', SSH_TARGET_HOST)
      // Typed key by key: the first key replaces the gray default (FIELD-2).
      await numberInput(sheet, 'port').click()
      await numberInput(sheet, 'port').press('ControlOrMeta+a')
      await numberInput(sheet, 'port').pressSequentially(String(SSH_MAIN_PORT))
      await expect(numberInput(sheet, 'port')).toHaveValue(String(SSH_MAIN_PORT))
      await expect(numberInput(sheet, 'port')).toHaveValue(SSH_MAIN_PORT)
      await fillTextRow(page, sheet, 'username', SSH_STACK_USER)
      await fillTextRow(page, sheet, 'password', SSH_STACK_PASSWORD)
      await expandGroup(sheet, 'Advanced')
      await pickEnum(page, sheet, 'host_key_verification', 'strict')
      await assignNew(page, sheet, 'Session ID', 'ssh_session')
      await saveConfig(sheet)
    })

    await test.step('SFTP Upload: Source picked with Browse from the Test Data tab', async () => {
      ids.upload = await dropUnder(page, ids.open, null, PALETTE.sftp)
      const sheet = await openSftp(page, ids.upload, DESC.upload, 'Upload')
      const picker = await openPicker(page, sheet, 'source', 'file-or-folder')
      if ((await picker.testDataTab.getAttribute('aria-pressed')) !== 'true') await picker.testDataTab.click()
      await expect(picker.testDataTab).toHaveAttribute('aria-pressed', 'true')
      await picker.file('orders.csv').click()
      await expectReference(picker, 'testdata://', 'orders.csv')
      await confirmPicker(picker)
      await expectRowValue(sheet, 'source', 'testdata://orders.csv')
      await fillTextRow(page, sheet, 'destination', INBOUND_TMP)
      await assignNew(page, sheet, 'Summary', 'up_summary')
      await saveConfig(sheet)
    })

    await test.step('SFTP Move: the upload takes its final name', async () => {
      ids.move = await dropUnder(page, ids.upload, null, PALETTE.sftp)
      const sheet = await openSftp(page, ids.move, DESC.move, 'Move')
      await fillTextRow(page, sheet, 'source', INBOUND_TMP)
      await fillTextRow(page, sheet, 'destination', INBOUND_CSV)
      await saveConfig(sheet)
    })

    await test.step('SSH Session Exec: the partner system answers in the background', async () => {
      ids.partner = await dropUnder(page, ids.move, null, PALETTE.exec)
      const sheet = await openConfig(page, ids.partner)
      await describeBlock(sheet, DESC.partner)
      await expressionRow(page, sheet, 'session_id', 'ssh_session')
      await fillTextRow(page, sheet, 'command', PARTNER_COMMAND)
      await saveConfig(sheet)
    })

    await test.step('the main chain: Wait Until, Download, Read, Assert, Delete, Stats, Close, Log', async () => {
      ids.wait = await dropUnder(page, ids.partner, null, PALETTE.wait)
      await expect(nodeLocator(page, ids.wait).locator('[data-testid^="handle-output-"]')).toHaveCount(2)

      ids.download = await dropUnder(page, ids.wait, 'then', PALETTE.sftp)
      let sheet = await openSftp(page, ids.download, DESC.download, 'Download')
      await fillTextRow(page, sheet, 'source', OUTBOUND)
      await assignNew(page, sheet, 'Summary', 'down_summary')
      await saveConfig(sheet)

      ids.read = await dropUnder(page, ids.download, null, PALETTE.fileIo)
      sheet = await openConfig(page, ids.read)
      await describeBlock(sheet, DESC.read)
      await fillTextRow(page, sheet, 'path', 'artifact://orders.out')
      await assignNew(page, sheet, 'Content', 'out_text')
      await saveConfig(sheet)

      ids.assert = await dropUnder(page, ids.read, null, PALETTE.assert)
      sheet = await openConfig(page, ids.assert)
      await describeBlock(sheet, DESC.assert)
      await addCondition(page, sheet, ANSWER_CONDITION, 'out_text')
      await assignNew(page, sheet, 'Passed', 'answer_ok')
      await saveConfig(sheet)

      ids.remove = await dropUnder(page, ids.assert, 'pass', PALETTE.sftp)
      sheet = await openSftp(page, ids.remove, DESC.remove, 'Delete')
      await fillTextRow(page, sheet, 'path', F)
      await saveConfig(sheet)

      ids.gone = await dropUnder(page, ids.remove, null, PALETTE.sftp)
      sheet = await openSftp(page, ids.gone, DESC.gone, 'Stats')
      await fillTextRow(page, sheet, 'path', F)
      await assignNew(page, sheet, 'Exists', 'gone_exists')
      await assignNew(page, sheet, 'Type', 'gone_type')
      await assignNew(page, sheet, 'Size', 'gone_size')
      await assignNew(page, sheet, 'Modified', 'gone_modified')
      await saveConfig(sheet)

      ids.close = await dropUnder(page, ids.gone, null, PALETTE.close)
      sheet = await openConfig(page, ids.close)
      await describeBlock(sheet, DESC.close)
      await expressionRow(page, sheet, 'session_id', 'ssh_session')
      await saveConfig(sheet)

      ids.done = await dropUnder(page, ids.close, null, PALETTE.log)
      sheet = await openConfig(page, ids.done)
      await describeBlock(sheet, DESC.done)
      await fillTextRow(page, sheet, 'message', BOOKEND)
      await saveConfig(sheet)
    })

    await test.step('the retry lane: SFTP Stats dropped beside the wait, linked by a drag from the retry dot', async () => {
      ids.poll = await dropBeside(page, ids.wait, PALETTE.sftp)
      await dragFromLane(page, ids.wait, 'retry', ids.poll)
      await expectDrawnFromLane(page, ids.wait, 'retry', ids.poll)

      const sheet = await openSftp(page, ids.poll, DESC.poll, 'Stats')
      await fillTextRow(page, sheet, 'path', OUTBOUND)
      await assignNew(page, sheet, 'Exists', 'out_exists')
      await saveConfig(sheet)
    })

    await test.step('Wait Until: Retry mode, every 1 s, gives up after 30 s, condition out_exists', async () => {
      const sheet = await openConfig(page, ids.wait)
      await describeBlock(sheet, DESC.wait)
      // Typed key by key: the first key replaces a gray default (FIELD-2).
      for (const [name, text] of [
        ['timeout', '30000'],
        ['check_interval', '1000'],
      ] as const) {
        await numberInput(sheet, name).click()
        await numberInput(sheet, name).press('ControlOrMeta+a')
        await numberInput(sheet, name).pressSequentially(text)
        await expect(numberInput(sheet, name)).toHaveValue(text)
      }
      const retry = sheet.locator('#wait-mode-retry')
      await retry.click()
      await expect(retry).toHaveAttribute('data-state', 'checked')
      await addCondition(page, sheet, 'out_exists', 'out_exists')
      await assignNew(page, sheet, 'Passed', 'wait_passed')
      await saveConfig(sheet)
    })

    await test.step('FLOW-1: the toolbar Save stores the blocks in the built order, every SFTP row as typed', async () => {
      await saveCanvas(page)
      const saved = await getTest(request, testId)
      const nodes = new Map(
        (saved.workflow.nodes as Array<Record<string, any>>).map((node) => [node.id as string, node.data]),
      )
      for (const key of Object.keys(ids) as Key[]) {
        expect(nodes.get(ids[key])?.elementType, `${key} is a ${ELEMENT_TYPES[key]} block`).toBe(ELEMENT_TYPES[key])
        expect(nodes.get(ids[key])?.description, `${key} description`).toBe(DESC[key])
        if (ELEMENT_TYPES[key] === 'sftp') expect(nodes.get(ids[key])?.label, `${key} Name`).toBe(DESC[key])
      }
      expect(nodes.size, 'no other block is stored').toBe(Object.keys(ids).length)

      const built: Edge[] = [
        [START, null, ids.open],
        [ids.open, null, ids.upload],
        [ids.upload, null, ids.move],
        [ids.move, null, ids.partner],
        [ids.partner, null, ids.wait],
        [ids.wait, 'retry', ids.poll],
        [ids.wait, 'then', ids.download],
        [ids.download, null, ids.read],
        [ids.read, null, ids.assert],
        [ids.assert, 'pass', ids.remove],
        [ids.remove, null, ids.gone],
        [ids.gone, null, ids.close],
        [ids.close, null, ids.done],
      ]
      const stored = (saved.workflow.edges as Array<Record<string, any>>).map((edge) =>
        edgeKey([edge.source, edge.sourceHandle ?? null, edge.target]),
      )
      expect(stored.sort(), 'the links as built').toEqual(built.map(edgeKey).sort())

      const values = (key: Key) => nodes.get(ids[key]).config.values as Record<string, unknown>
      const bindings = (key: Key) => nodes.get(ids[key]).config.outputBindings as Record<string, unknown>
      for (const key of ['upload', 'move', 'poll', 'download', 'remove', 'gone', 'partner', 'close'] as Key[]) {
        expect(values(key).session_id, `${key} Session ID`).toBe('ssh_session')
        expect(nodes.get(ids[key]).expressionFields, `${key} Session ID is an expression`).toContain('session_id')
      }
      expect(values('upload')).toMatchObject({
        operation: 'upload',
        source: 'testdata://orders.csv',
        destination: INBOUND_TMP,
      })
      expect(values('move')).toMatchObject({ operation: 'move', source: INBOUND_TMP, destination: INBOUND_CSV })
      expect(values('poll')).toMatchObject({ operation: 'stats', path: OUTBOUND })
      expect(values('download')).toMatchObject({ operation: 'download', source: OUTBOUND })
      expect(values('download').destination ?? '', 'Download Destination stays empty').toBe('')
      expect(values('remove')).toMatchObject({ operation: 'delete', path: F })
      expect(values('gone')).toMatchObject({ operation: 'stats', path: F })
      expect(bindings('upload')).toMatchObject({ summary: 'up_summary' })
      expect(bindings('poll')).toMatchObject({ exists: 'out_exists' })
      expect(bindings('download')).toMatchObject({ summary: 'down_summary' })
      expect(bindings('gone')).toMatchObject({
        exists: 'gone_exists',
        type: 'gone_type',
        size: 'gone_size',
        modified: 'gone_modified',
      })

      expect(values('open')).toMatchObject({
        host: SSH_TARGET_HOST,
        username: SSH_STACK_USER,
        host_key_verification: 'strict',
      })
      expect(Number(values('open').port)).toBe(Number(SSH_MAIN_PORT))
      expect(values('open').password, 'the Password is stored').toBeTruthy()
      expect(values('open').password, 'the Password is never stored in clear').not.toBe(SSH_STACK_PASSWORD)
      expect(bindings('open')).toMatchObject({ session_id: 'ssh_session' })
      expect(values('partner').command).toBe(PARTNER_COMMAND)
      expect(values('read')).toMatchObject({ path: 'artifact://orders.out' })
      expect(values('wait').mode).toBe('retry')
      expect(Number(values('wait').timeout), 'Wait Until Timeout').toBe(30000)
      expect(Number(values('wait').check_interval), 'Wait Until Check Interval').toBe(1000)
      expect(values('done')).toMatchObject({ message: BOOKEND })
      for (const name of CREATED_VARIABLES) {
        expect(saved.variables?.[name], `the Assign to field created ${name}`).toBeTruthy()
      }
      expect(JSON.stringify(saved), 'the saved Test never holds the password in clear').not.toContain(
        SSH_STACK_PASSWORD,
      )

      await expectRunValid(request, testId)
    })

    const { vars, entries } = await runSftpTest(page, testId, BOOKEND)
    const consoleText = formatEntries(entries)

    await test.step('FLOW-2: every block ends success', async () => {
      for (const key of Object.keys(ids) as Key[]) await expectNodeStatus(page, ids[key], 'success')
    })

    await test.step('FLOW-3: Upload sends orders.csv to the inbound temporary name', () => {
      const [row, ...rest] = summaryRows(vars, 'up_summary')
      expect(rest, 'one Summary row').toEqual([])
      expect(row.source, 'an absolute WAVE path to orders.csv').toMatch(/^\/.*\/orders\.csv$/)
      expect(row.destination).toBe(INBOUND_TMP)
      expect(row.size).toBe(ORDERS_BYTES)
      expect(sftpLines(entries, DESC.upload), consoleText).toEqual([
        sftpLine.uploaded(1, ORDERS_BYTES, 'testdata://orders.csv', INBOUND_TMP),
      ])
    })

    await test.step('FLOW-4: Move gives the upload its final name', () => {
      expect(sftpLines(entries, DESC.move), consoleText).toEqual([sftpLine.moved(INBOUND_TMP, INBOUND_CSV)])
    })

    await test.step('FLOW-5: the Stats on the retry lane polled until the answer landed', async () => {
      const rounds = sftpLines(entries, DESC.poll)
      // The wait checks before each round, so every round before the last reported Exists false (WAIT-8).
      expect(rounds.length, `the Stats ran at least twice\n${consoleText}`).toBeGreaterThanOrEqual(2)
      expect(rounds, 'each round logs the Stats line').toEqual(rounds.map(() => sftpLine.stats(OUTBOUND)))
      expect(sftpLines(entries, DESC.poll, 'WARN'), 'no round failed').toEqual([])
      expect(out(vars, 'out_exists'), 'the last round reported Exists true').toBe(true)
      expect(out(vars, 'wait_passed'), 'the wait ended on its condition').toBe(true)
      const waits = entries.filter((entry) => entry.message.startsWith('[WAIT] ')).map((entry) => entry.message)
      expect(waits, consoleText).toContain('[WAIT] Waiting for condition (timeout=30000 ms, interval=1000 ms)')
      expect(
        waits.filter((line) => /^\[WAIT\] Condition met after \d+ ms$/.test(line)),
        'the wait ended on its condition',
      ).toHaveLength(1)
      expect(waits.filter((line) => line.startsWith('[WAIT] Gave up')), 'and not on its give-up').toEqual([])
      await expectNodeStatus(page, ids.wait, 'success')
      await expectNodeStatus(page, ids.poll, 'success')
    })

    await test.step('FLOW-6: Download lands the answer in the run artifacts, byte for byte', async () => {
      const [row, ...rest] = summaryRows(vars, 'down_summary')
      expect(rest, 'one Summary row').toEqual([])
      expect(row.source).toBe(OUTBOUND)
      expect(row.destination, 'an absolute WAVE path to orders.out').toMatch(/^\/.*\/orders\.out$/)
      expect(row.size).toBe(ANSWER_BYTES)
      expect(sftpLines(entries, DESC.download), consoleText).toEqual([
        sftpLine.saved('orders.out', row.destination, ANSWER_BYTES),
        sftpLine.downloaded(1, ANSWER_BYTES, OUTBOUND, "the run's files"),
      ])
      await expectArtifactText(page, 'orders.out', ANSWER)
    })

    await test.step('FLOW-7: File I/O Read and Assert pass', async () => {
      expect(out(vars, 'out_text'), 'Read gives the answer').toBe(ANSWER)
      expect(out(vars, 'answer_ok'), 'the Assert passed').toBe(true)
      await expectNodeStatus(page, ids.read, 'success')
      await expectNodeStatus(page, ids.assert, 'success')
    })

    await test.step('FLOW-8: Delete removes the spec folder and the final Stats finds nothing', () => {
      expect(sftpLines(entries, DESC.remove), consoleText).toEqual([sftpLine.deleted(F)])
      expect(out(vars, 'gone_exists'), 'Exists').toBe(false)
      expect(out(vars, 'gone_type'), 'Type').toBe('')
      expect(out(vars, 'gone_size'), 'Size').toBe(0)
      expect(out(vars, 'gone_modified'), 'Modified').toBe('')
    })

    await test.step('FLOW-9: no SFTP line carries the file contents; the password never appears in clear', () => {
      const sftpEntries = entries.filter(
        (entry) => entry.source === SFTP_SOURCE || entry.source.startsWith(`${SFTP_SOURCE} : `),
      )
      expect(sftpEntries.length, 'the SFTP blocks wrote to the console').toBeGreaterThan(0)
      expect(
        sftpEntries.filter((entry) => entry.message.includes(MARKER)),
        'SFTP lines carrying the marker',
      ).toEqual([])
      expect(consoleText, 'the console never shows the password').not.toContain(SSH_STACK_PASSWORD)
      expect(JSON.stringify(vars), 'no variable holds the password').not.toContain(SSH_STACK_PASSWORD)
    })
  })
})
