/**
 * V-PLUGIN-SFTP-01: SFTP block config sheet
 * Design Decisions: SFTP-2, SFTP-3, SFTP-4, SFTP-6, SFTP-8, SFTP-9, SFTP-10, PING-17, FIELDERR-1, SSH-11, FIELD-2,
 *   SHELL-10
 * REQ: REQ-3.4.1.8, REQ-5.2.1.47
 *
 * Runs in the no-data project list. Each test seeds its own Test through POST /tests (Session ID in
 * expression mode on the test variable ssh_session, as drawn) and afterAll deletes it. Theme-agnostic
 * DOM assertions.
 *
 * Pass Criteria:
 * SV-1  Header: FolderSync glyph text-cyan-500, title "SFTP - Edit Config", Version 1.0.0 and no other
 *       version offered; the canvas block icon is cyan.
 * SV-2  Upload as it opens: Session ID*, Operation*, Source*, Destination*, If the file exists, in that
 *       order, all String; Operation shows Upload with no toggle; Source has Browse named "Browse Test
 *       Data and Artifacts"; Destination has no Browse; If the file exists shows Replace it (options
 *       Replace it / Fail the block, no toggle); Advanced, Failure Handling, Secrets collapsed in that
 *       order; outputs Summary (Table), Success (Boolean), neither Secret-ticked.
 * SV-3  Download with Advanced open: Source* without Browse; Destination not required, empty, Browse
 *       named "Browse Artifacts"; Advanced holds Timeout (300), Max size (MiB) (1024), Max files
 *       (10000), each its gray default, all Integer with toggles, footer "Limits for this block"; outputs Summary, Success.
 * SV-4  List: Path* without Browse; Include subfolders Boolean, unticked, with toggle; Advanced holds
 *       Timeout only with the same footer; outputs Entries (Table), Count (Integer), Success.
 * SV-5  Stats, Delete, Move and Create folder show exactly their rows and outputs; Move shows Source*,
 *       Destination*, If the file exists; no Browse anywhere on the four.
 * SV-6  The Operation select offers exactly Upload, Download, List, Stats, Delete, Move, Create folder.
 * SV-7  Switching Operation: a Source typed on Upload survives Download and Move (and is what the saved
 *       Test holds); Path starts empty on List; the limit rows appear at their gray defaults 1024 / 10000 only on
 *       Download, and a limit typed there is not stored once Move hides it.
 * SV-8  On error = Record and continue adds Error and Reason after Success; back on Fail the block
 *       they leave.
 * SV-9  Every input and output row's (i) badge carries its exact text; only the starred rows carry the
 *       required mark.
 * SV-10 Bounds: Timeout 0, Max size (MiB) -1 and Max files -1 each show their message under the field
 *       eagerly, the input is marked invalid, Save is disabled under the settings-errors note, the
 *       typed value is kept; Save refuses an out-of-range value (SETTING_BELOW_MINIMUM), and the same value in a
 *       Test file edited by hand paints the canvas alert badge with the same message in its tooltip.
 * SV-11 Inside a Remote Execution body the SFTP block carries the L badge and the Upload Source keeps
 *       Browse.
 * SV-12 Quick-add lists SFTP under Remote with the cyan glyph.
 */

import { test, expect, type Locator, type Page } from '../../helpers/playwright-fixtures'
import { waitForTooltipClosed, waitForTooltipVisible } from '../../helpers/tooltip-wait'
import { waitForCanvasLoad } from '../../helpers/canvas'
import { importExpectingErrors, importValidateAndNavigate } from '../../helpers/fixture-import'
import { BACKEND_URL } from '../../helpers/config'
import {
  browseButton,
  checkbox,
  editPreview,
  enumTrigger,
  expectLayout,
  expectOptions,
  expectOutputs,
  exprToggle,
  groupHeader,
  numberInput,
  outputRow,
  paramRow,
  pickEnum,
  requiredStar,
  rowAlerts,
  rowError,
  rowLabel,
  saveButton,
  secretsTrigger,
  settingsNote,
} from '../../helpers/config-sheet'
import { expectStringParamPreview, setStringParam } from '../../helpers/param-config'
import { expectGrayDefault } from '../../helpers/default-rule'
import { answerSwitch, askSwitch } from '../../helpers/value-field'
import {
  deleteTest,
  expandGroup,
  openConfig,
  persistedNodes,
  saveConfig,
  saveWorkbench,
} from '../../functional/file-picker/picker'

// ---------------------------------------------------------------------------
// Seeded Test
// ---------------------------------------------------------------------------

const NODE_ID = '3c9e5a71-2b84-4f06-a1d7-6e0b92c4f853'
const START_EDGE_ID = 'd5f18b2e-7a39-4c64-8e02-b17c4a9d3f60'
const CONTAINER_ID = '8a4d2f67-c1e9-4b35-9f08-52e7d6a1b394'
const BODY_EDGE_ID = 'f27c9e41-5d86-4a13-b0e5-9c3a7b2d8e16'

const SESSION_VARIABLE = 'ssh_session'

// As drawn in the three wireframes.
const UPLOAD_VALUES = { source: 'testdata://orders.csv', destination: '/inbound/orders.tmp' }
const DOWNLOAD_VALUES = { operation: 'download', source: '/outbound/orders.out' }
const LIST_VALUES = { operation: 'list', path: '/outbound/*.out' }

type Values = Record<string, unknown>

function workflowNode(
  id: string,
  elementType: string,
  label: string,
  position: { x: number; y: number },
  values: Values,
  extra: { expressionFields?: string[]; outputBindings?: Record<string, string>; width?: number } = {},
): Record<string, unknown> {
  return {
    id,
    type: 'workflowNode',
    position,
    data: {
      label,
      elementType,
      nodeType: 'plugin',
      category: 'remote',
      version: '1.0.0',
      description: '',
      hasNewerVersion: false,
      expressionFields: extra.expressionFields ?? [],
      templateFields: [],
      config: { values, outputBindings: extra.outputBindings ?? {}, profileBindings: [] },
    },
    measured: { width: extra.width ?? 120, height: 62 },
  }
}

const sftpNode = (id: string, position: { x: number; y: number }, values: Values) =>
  workflowNode(id, 'sftp', 'SFTP', position, { session_id: SESSION_VARIABLE, ...values }, {
    expressionFields: ['session_id'],
  })

const METADATA = { tags: [], suite_id: null, parent_suite: null }
const stringVariable = { value: '', type: 'string', scope: 'test' }

/** One SFTP block whose Session ID reads the test variable ssh_session. */
function sftpFixture(name: string, values: Values): Record<string, unknown> {
  return {
    name,
    version: '1.0.0',
    description: '',
    workflow: {
      nodes: [sftpNode(NODE_ID, { x: -75, y: 100 }, values)],
      edges: [{ id: START_EDGE_ID, source: 'start-node', target: NODE_ID }],
    },
    variables: { [SESSION_VARIABLE]: stringVariable },
    metadata: METADATA,
  }
}

/** The same Upload block inside a Remote Execution body. */
function remoteBodyFixture(name: string): Record<string, unknown> {
  return {
    name,
    version: '1.0.0',
    description: '',
    workflow: {
      nodes: [
        workflowNode(
          CONTAINER_ID,
          'remote-execution',
          'Remote Execution',
          { x: -75, y: 100 },
          { session_id: 'sid' },
          { expressionFields: ['session_id'], outputBindings: { remote_session_id: 'rsid' }, width: 160 },
        ),
        sftpNode(NODE_ID, { x: -75, y: 260 }, UPLOAD_VALUES),
      ],
      edges: [
        { id: START_EDGE_ID, source: 'start-node', target: CONTAINER_ID },
        { id: BODY_EDGE_ID, source: CONTAINER_ID, sourceHandle: 'body', target: NODE_ID, type: 'default' },
      ],
    },
    variables: { [SESSION_VARIABLE]: stringVariable, sid: stringVariable, rsid: stringVariable },
    metadata: METADATA,
  }
}

// ---------------------------------------------------------------------------
// Expected sheet content: rows and outputs per Operation (SFTP-2 to SFTP-9)
// ---------------------------------------------------------------------------

type Operation = 'upload' | 'download' | 'list' | 'stats' | 'delete' | 'move' | 'create_folder'

const OPERATIONS: Operation[] = ['upload', 'download', 'list', 'stats', 'delete', 'move', 'create_folder']

const OPERATION_LABELS: Record<Operation, string> = {
  upload: 'Upload',
  download: 'Download',
  list: 'List',
  stats: 'Stats',
  delete: 'Delete',
  move: 'Move',
  create_folder: 'Create folder',
}

const LABELS: Record<string, string> = {
  session_id: 'Session ID',
  operation: 'Operation',
  source: 'Source',
  destination: 'Destination',
  path: 'Path',
  if_exists: 'If the file exists',
  recursive: 'Include subfolders',
  missing_ok: 'Ignore missing',
  timeout: 'Timeout',
  max_size_mib: 'Max size (MiB)',
  max_files: 'Max files',
  on_error: 'On error',
}

const TYPES: Record<string, string> = {
  session_id: 'String',
  operation: 'String',
  source: 'String',
  destination: 'String',
  path: 'String',
  if_exists: 'String',
  recursive: 'Boolean',
  missing_ok: 'Boolean',
  timeout: 'Integer',
  max_size_mib: 'Integer',
  max_files: 'Integer',
  on_error: 'String',
}

/** Rows that choose a mode and so take no expression. */
const NO_TOGGLE = ['operation', 'if_exists', 'on_error']

const TOP_ROWS: Record<Operation, string[]> = {
  upload: ['session_id', 'operation', 'source', 'destination', 'if_exists'],
  download: ['session_id', 'operation', 'source', 'destination', 'if_exists'],
  list: ['session_id', 'operation', 'path', 'recursive'],
  stats: ['session_id', 'operation', 'path'],
  delete: ['session_id', 'operation', 'path', 'missing_ok'],
  move: ['session_id', 'operation', 'source', 'destination', 'if_exists'],
  create_folder: ['session_id', 'operation', 'path'],
}

const ADVANCED_ROWS: Record<Operation, string[]> = {
  upload: ['timeout'],
  download: ['timeout', 'max_size_mib', 'max_files'],
  list: ['timeout'],
  stats: ['timeout'],
  delete: ['timeout'],
  move: ['timeout'],
  create_folder: ['timeout'],
}

const REQUIRED: Record<Operation, string[]> = {
  upload: ['session_id', 'operation', 'source', 'destination'],
  download: ['session_id', 'operation', 'source'],
  list: ['session_id', 'operation', 'path'],
  stats: ['session_id', 'operation', 'path'],
  delete: ['session_id', 'operation', 'path'],
  move: ['session_id', 'operation', 'source', 'destination'],
  create_folder: ['session_id', 'operation', 'path'],
}

/** SFTP-4: only the WAVE-side rows browse. */
const BROWSE_ROWS: Record<Operation, string[]> = {
  upload: ['source'],
  download: ['destination'],
  list: [],
  stats: [],
  delete: [],
  move: [],
  create_folder: [],
}

const OUTPUT_ROWS: Record<Operation, string[]> = {
  upload: ['summary', 'success'],
  download: ['summary', 'success'],
  list: ['entries', 'count', 'success'],
  stats: ['exists', 'type', 'size', 'modified', 'success'],
  delete: ['success'],
  move: ['success'],
  create_folder: ['success'],
}

const OUTPUT_LABELS: Record<string, { label: string; type: string }> = {
  summary: { label: 'Summary', type: 'Table' },
  entries: { label: 'Entries', type: 'Table' },
  count: { label: 'Count', type: 'Integer' },
  exists: { label: 'Exists', type: 'Boolean' },
  type: { label: 'Type', type: 'String' },
  size: { label: 'Size', type: 'Integer' },
  modified: { label: 'Modified', type: 'String' },
  success: { label: 'Success', type: 'Boolean' },
  error: { label: 'Error', type: 'String' },
  reason: { label: 'Reason', type: 'String' },
}

const BROWSE_BOTH = 'Browse Test Data and Artifacts'
const BROWSE_ARTIFACTS = 'Browse Artifacts'
const ADVANCED_FOOTER = 'Limits for this block'
const SETTINGS_NOTE = 'Save is disabled: the settings have errors'

const TIMEOUT_MESSAGE = 'Timeout must be at least 1'
const MAX_SIZE_MESSAGE = 'Max size (MiB) must be at least 0'
const MAX_FILES_MESSAGE = 'Max files must be at least 0'

const COMMON_BADGES: Record<string, string> = {
  session_id:
    "Handle identifying an open SSH session: Open produces it; Execute, Script, Close, Tunnel Open, SFTP, " +
    "Remote Execution, and a chained Open's Parent Session reference it",
  operation:
    'What to do. Upload and Download move files between WAVE and the server; List, Stats, Delete, Move and Create folder work on the server.',
  if_exists:
    'What happens when a file is already at the destination: Replace it overwrites it; Fail the block stops before anything is written.',
  recursive: 'List the entries inside subfolders too, at every depth.',
  missing_ok: 'Pass when the path or pattern matches nothing, instead of failing the block.',
  timeout: 'Seconds the whole block may take, every file of a folder included.',
  max_size_mib:
    'Largest total a download may bring, in MiB. The block adds up the match before it writes anything and refuses a larger one. 0 means no limit.',
  max_files:
    'Most files a download may bring. The block counts the match before it writes anything and refuses more. 0 means no limit.',
  on_error: 'Fail the block, or record the outcome and let the test continue.',
}

/** The paired rows: one label, one wording per operation. */
const PAIRED_BADGES: Record<Operation, Record<string, string>> = {
  upload: {
    source:
      'File or folder on WAVE to upload. Pick a Test Data or Artifact entry with Browse, or type testdata://, artifact:// or an absolute or relative path. A folder goes with everything inside it; *, ? and [...] match several files.',
    destination:
      'Where it goes on the server. An existing folder or a path ending in / keeps the names; any other path is the new name, for one file only. Missing folders are created.',
  },
  download: {
    source:
      'File or folder on the server to download. A folder comes with everything inside it; *, ? and [...] match several files.',
    destination:
      "Where it lands on WAVE: artifact:// or an absolute or relative path; testdata:// is read-only. Empty puts it in the run's artifacts under its own name. An existing folder or a path ending in / keeps the names; any other path is the new name, for one file only.",
  },
  list: {
    path: 'Folder on the server to list, or a pattern: *, ? and [...] list only the matching entries. No match gives no entries and a Count of 0.',
  },
  stats: {
    path: 'File or folder on the server to report on. A missing path is not an error: Exists is false.',
  },
  delete: {
    path: "File or folder on the server to delete; a folder goes with everything inside it, and *, ? and [...] delete every match. A path that names the account's home or the server root (empty, ., ~ or /) is refused.",
  },
  move: {
    source: 'File or folder on the server to move or rename.',
    destination: 'The new path on the server. An existing folder or a path ending in / keeps the name.',
  },
  create_folder: {
    path: 'Folder to create on the server, including its name. Missing parent folders are created.',
  },
}

const OUTPUT_BADGES: Record<string, string> = {
  summary: 'One row per file transferred: source, destination and size.',
  entries:
    'One row per entry: name, path, type, modified and size. Include subfolders adds the entries of every subfolder.',
  count: 'Number of entries; 0 when nothing matches.',
  exists: 'True when the path is there on the server.',
  type: 'Whether the path is a file or a folder; empty when the path is missing.',
  size: 'Size in bytes of a file; 0 for a folder or a missing path.',
  modified: 'Last modified, ISO-8601 UTC; empty when the path is missing.',
  success: 'True when the operation finished. False when the block failed and On error is Record and continue.',
  error: 'The error message when the operation failed under Record and continue; empty otherwise',
  reason:
    'Why it failed: SessionClosed, SftpUnavailable, NoMatch, NotFound, NotAFolder, Conflict, Exists, ReadOnly, TooManyFiles, TooLarge, UnsafeEntry, Refused, PermissionDenied, ConnectionLost, ServerFailure, LocalFailure or Timeout; empty when it passed.',
}

/** SFTP-10: the Remote section of the palette, in order. */
const REMOTE_ORDER = [
  'ssh-session-open',
  'ssh-session-exec',
  'ssh-session-script',
  'ssh-session-close',
  'ssh-tunnel-open',
  'ssh-tunnel-close',
  'sftp',
  'remote-execution',
]

// ---------------------------------------------------------------------------
// Locators and small helpers
// ---------------------------------------------------------------------------

const created: string[] = []

const groupFooter = (sheet: Locator, name: string) => sheet.locator(`[data-testid="group-footer-${name}"]`)
const canvasNode = (page: Page, id: string) => page.locator(`[data-testid="workflow-node-${id}"]`)
const ACTIVE_TOOLTIP = '[data-slot="tooltip-content"]:not([data-state="closed"])'

async function seed(page: Page, fixture: Record<string, unknown>): Promise<string> {
  await page.request.delete(`${BACKEND_URL}/workbench/session/`).catch(() => {})
  const testId = await importValidateAndNavigate(page, fixture)
  created.push(testId)
  return testId
}

async function openSheet(page: Page, name: string, values: Values): Promise<Locator> {
  await seed(page, sftpFixture(name, values))
  const sheet = await openConfig(page, NODE_ID)
  await expect(sheet.getByRole('heading', { name: 'SFTP - Edit Config' })).toBeVisible()
  return sheet
}

const setOperation = (page: Page, sheet: Locator, operation: Operation) =>
  pickEnum(page, sheet, 'operation', OPERATION_LABELS[operation])

/** The input side with both groups open: top rows, Advanced rows, On error, Secrets. */
const expandedLayout = (operation: Operation) => [
  ...TOP_ROWS[operation],
  '[Advanced]',
  ...ADVANCED_ROWS[operation],
  '[Failure Handling]',
  'on_error',
  '[Secrets]',
]

const collapsedLayout = (operation: Operation) => [
  ...TOP_ROWS[operation],
  '[Advanced]',
  '[Failure Handling]',
  '[Secrets]',
]

/** Type into a number row as a user does: the first key replaces a gray default (FIELD-2), else the selection. */
async function typeNumber(page: Page, sheet: Locator, name: string, text: string): Promise<void> {
  await numberInput(sheet, name).click()
  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.type(text)
  await expect(numberInput(sheet, name)).toHaveValue(text)
}

async function browseRowIds(sheet: Locator): Promise<string[]> {
  return sheet
    .locator('[data-testid^="param-browse-"]')
    .evaluateAll((els) => els.map((el) => (el.getAttribute('data-testid') ?? '').replace('param-browse-', '')))
}

/** Label, Type text, (i) badge, required mark and expression toggle of one row. */
async function expectRow(sheet: Locator, name: string, required: boolean): Promise<void> {
  expect(await rowLabel(sheet, name), name).toBe(LABELS[name])
  await expect(paramRow(sheet, name).locator('td:nth-child(3)'), name).toHaveText(TYPES[name], {
    useInnerText: true,
  })
  await expect(paramRow(sheet, name).locator('td:first-child .cursor-help'), `${name} info badge`).toHaveCount(1)
  await expect(requiredStar(sheet, name), `${name} required mark`).toHaveCount(required ? 1 : 0)
  await expect(exprToggle(sheet, name), `${name} expression toggle`).toHaveCount(NO_TOGGLE.includes(name) ? 0 : 1)
}

/** Every visible row of the operation, with its required marks. */
async function expectRows(sheet: Locator, operation: Operation, names: string[]): Promise<void> {
  for (const name of names) await expectRow(sheet, name, REQUIRED[operation].includes(name))
}

async function expectOutputRows(sheet: Locator, names: string[]): Promise<void> {
  for (const name of names) {
    const { label, type } = OUTPUT_LABELS[name]
    const row = outputRow(sheet, name)
    await expect(row.locator('td:nth-child(2)'), name).toHaveText(label)
    await expect(row.locator('td:nth-child(3)'), name).toHaveText(type, { useInnerText: true })
    await expect(row.locator('td:first-child .cursor-help'), `${name} info badge`).toHaveCount(1)
    await expect(sheet.locator(`[data-testid="output-secret-${name}"]`), `${name} Secret`).toHaveAttribute(
      'data-state',
      'unchecked',
    )
  }
}

/** Park the pointer on sheet padding so one tooltip closes before the next opens. */
async function dismissTooltip(page: Page, sheet: Locator): Promise<void> {
  const box = await sheet.boundingBox()
  await page.mouse.move(box!.x + 8, box!.y + box!.height - 8)
  await waitForTooltipClosed(page, 'the tooltip closes', 5_000)
  await expect(page.locator(ACTIVE_TOOLTIP)).toHaveCount(0)
}

/** Hover a target and read the single accessible copy of its tooltip. */
async function expectTooltip(page: Page, sheet: Locator, target: Locator, label: string, text: string): Promise<void> {
  await target.scrollIntoViewIfNeeded()
  await target.hover()
  await waitForTooltipVisible(page, label, 5_000)
  const tooltip = page.locator(ACTIVE_TOOLTIP)
  await expect(tooltip, label).toBeVisible({ timeout: 5_000 })
  // Radix paints the wording twice; [role="tooltip"] is the single accessible copy.
  await expect(tooltip.locator('[role="tooltip"]'), label).toHaveText(text)
  await dismissTooltip(page, sheet)
}

const expectBadge = (page: Page, sheet: Locator, row: Locator, label: string, text: string) =>
  expectTooltip(page, sheet, row.locator('td:first-child .cursor-help'), label, text)

const expectBrowseHint = (page: Page, sheet: Locator, name: string, text: string) =>
  expectTooltip(page, sheet, browseButton(sheet, name), `${name} Browse`, text)

/** The canvas alert badge carries the row's own message in its tooltip. */
async function expectBadgeMessages(page: Page, badge: Locator, messages: string[]): Promise<void> {
  await expect(badge, 'the block carries the canvas alert badge').toBeVisible({ timeout: 10_000 })
  await badge.hover()
  const tooltip = page.locator('[role="tooltip"]').last()
  await expect(tooltip).toBeVisible({ timeout: 5_000 })
  for (const message of messages) await expect(tooltip).toContainText(message)
}

// ---------------------------------------------------------------------------

test.describe('V-PLUGIN-SFTP-01: SFTP block config sheet', () => {
  test.afterAll(async ({ request }) => {
    for (const testId of created.splice(0)) await deleteTest(request, testId)
  })

  test('SV-1: cyan FolderSync header, one version 1.0.0, cyan canvas icon', async ({ page }) => {
    await seed(page, sftpFixture('V-PLUGIN-SFTP-01 header', UPLOAD_VALUES))

    // SFTP-10: the block sits in the Remote section, so its icon is the Remote cyan.
    const nodeIcon = canvasNode(page, NODE_ID).locator('[data-testid="workflow-node-icon"] svg')
    await expect(nodeIcon).toHaveClass(/\blucide-folder-sync\b/)
    await expect(nodeIcon).toHaveClass(/\btext-cyan-500\b/)

    const sheet = await openConfig(page, NODE_ID)
    const heading = sheet.getByRole('heading', { name: 'SFTP - Edit Config' })
    await expect(heading).toBeVisible()
    const glyph = heading.locator('svg.lucide-folder-sync')
    await expect(glyph).toHaveCount(1)
    await expect(glyph).toHaveClass(/\btext-cyan-500\b/)

    const selector = sheet.locator('[data-testid="version-selector"]')
    await expect(selector).toHaveText('1.0.0')
    await expect(sheet.locator('[data-testid="version-update-available"]')).toHaveCount(0)
    await selector.click()
    const options = selector.locator('..').locator('ul li button')
    await expect(options).toHaveCount(1)
    await expect(options.first()).toContainText('1.0.0')
    await expect(options.first()).toContainText('Current')
  })

  test('SV-2: Upload as it opens, with Browse on Source only and three collapsed groups', async ({ page }) => {
    const sheet = await openSheet(page, 'V-PLUGIN-SFTP-01 upload', UPLOAD_VALUES)

    await expectLayout(sheet, collapsedLayout('upload'), 'upload on open')
    await expectRows(sheet, 'upload', TOP_ROWS.upload)

    // Session ID reads the session variable in expression mode, as drawn.
    await expect(exprToggle(sheet, 'session_id')).toHaveAttribute('aria-pressed', 'true')
    await expect(paramRow(sheet, 'session_id')).toContainText(SESSION_VARIABLE)
    await expect(enumTrigger(sheet, 'operation')).toHaveText('Upload')
    await expectStringParamPreview(sheet, 'source', UPLOAD_VALUES.source)
    await expectStringParamPreview(sheet, 'destination', UPLOAD_VALUES.destination)
    await expect(enumTrigger(sheet, 'if_exists')).toHaveText('Replace it')
    await expectOptions(page, sheet, 'if_exists', ['Replace it', 'Fail the block'])

    // SFTP-4: Source is on WAVE, Destination on the server.
    expect(await browseRowIds(sheet)).toEqual(BROWSE_ROWS.upload)
    await expect(browseButton(sheet, 'destination')).toHaveCount(0)
    await expectBrowseHint(page, sheet, 'source', BROWSE_BOTH)

    for (const group of ['Advanced', 'Failure Handling']) {
      await expect(groupHeader(sheet, group), group).toHaveAttribute('aria-expanded', 'false')
    }
    await expect(secretsTrigger(sheet)).toHaveAttribute('aria-expanded', 'false')

    await expectOutputs(sheet, OUTPUT_ROWS.upload, 'upload outputs')
    await expectOutputRows(sheet, OUTPUT_ROWS.upload)
    await expect(rowAlerts(sheet), 'nothing is flagged on open').toHaveCount(0)
  })

  test('SV-3: Download with Advanced open holds the limit rows at their defaults', async ({ page }) => {
    const sheet = await openSheet(page, 'V-PLUGIN-SFTP-01 download', DOWNLOAD_VALUES)
    await expect(enumTrigger(sheet, 'operation')).toHaveText('Download')

    await expandGroup(sheet, 'Advanced')
    await expectLayout(
      sheet,
      [...TOP_ROWS.download, '[Advanced]', ...ADVANCED_ROWS.download, '[Failure Handling]', '[Secrets]'],
      'download with Advanced open',
    )
    await expectRows(sheet, 'download', [...TOP_ROWS.download, ...ADVANCED_ROWS.download])

    await expectStringParamPreview(sheet, 'source', DOWNLOAD_VALUES.source)
    // Empty Destination lands the file in the run's artifacts.
    await expect(editPreview(sheet, 'destination')).toHaveValue('')
    expect(await browseRowIds(sheet)).toEqual(BROWSE_ROWS.download)
    await expect(browseButton(sheet, 'source')).toHaveCount(0)
    await expectBrowseHint(page, sheet, 'destination', BROWSE_ARTIFACTS)

    // FIELD-2: each limit shows its default in gray, nothing stored.
    for (const [name, shown] of [
      ['timeout', '300'],
      ['max_size_mib', '1024'],
      ['max_files', '10000'],
    ]) {
      await expectGrayDefault(sheet, name, shown)
    }
    await expect(groupFooter(sheet, 'Advanced')).toHaveText(ADVANCED_FOOTER)

    await expectOutputs(sheet, OUTPUT_ROWS.download, 'download outputs')
    await expectOutputRows(sheet, OUTPUT_ROWS.download)
    await expect(rowAlerts(sheet)).toHaveCount(0)
  })

  test('SV-4: List shows Path and Include subfolders, and Advanced holds Timeout only', async ({ page }) => {
    const sheet = await openSheet(page, 'V-PLUGIN-SFTP-01 list', LIST_VALUES)
    await expect(enumTrigger(sheet, 'operation')).toHaveText('List')
    await expectLayout(sheet, collapsedLayout('list'), 'list on open')

    await expandGroup(sheet, 'Advanced')
    await expectLayout(
      sheet,
      [...TOP_ROWS.list, '[Advanced]', ...ADVANCED_ROWS.list, '[Failure Handling]', '[Secrets]'],
      'list with Advanced open',
    )
    await expectRows(sheet, 'list', [...TOP_ROWS.list, ...ADVANCED_ROWS.list])

    await expectStringParamPreview(sheet, 'path', LIST_VALUES.path)
    await expect(sheet.locator('[data-testid^="param-browse-"]')).toHaveCount(0)
    await expect(checkbox(sheet, 'recursive')).toHaveAttribute('data-state', 'unchecked')
    await expectGrayDefault(sheet, 'timeout', '300')
    await expect(groupFooter(sheet, 'Advanced')).toHaveText(ADVANCED_FOOTER)

    await expectOutputs(sheet, OUTPUT_ROWS.list, 'list outputs')
    await expectOutputRows(sheet, OUTPUT_ROWS.list)
    await expect(rowAlerts(sheet)).toHaveCount(0)
  })

  test('SV-5: Stats, Delete, Move and Create folder show exactly their rows and outputs', async ({ page }) => {
    const sheet = await openSheet(page, 'V-PLUGIN-SFTP-01 server operations', UPLOAD_VALUES)
    await expandGroup(sheet, 'Advanced')
    await expandGroup(sheet, 'Failure Handling')

    for (const operation of ['stats', 'delete', 'move', 'create_folder'] as const) {
      await test.step(OPERATION_LABELS[operation], async () => {
        await setOperation(page, sheet, operation)
        await expectLayout(sheet, expandedLayout(operation), operation)
        await expectRows(sheet, operation, [...TOP_ROWS[operation], ...ADVANCED_ROWS[operation], 'on_error'])
        // Every row here names a path on the server: nothing to browse.
        expect(await browseRowIds(sheet), operation).toEqual([])
        await expectOutputs(sheet, OUTPUT_ROWS[operation], `${operation} outputs`)
        await expectOutputRows(sheet, OUTPUT_ROWS[operation])
      })
    }

    await setOperation(page, sheet, 'delete')
    await expect(checkbox(sheet, 'missing_ok')).toHaveAttribute('data-state', 'unchecked')
    await setOperation(page, sheet, 'move')
    await expect(enumTrigger(sheet, 'if_exists')).toHaveText('Replace it')
  })

  test('SV-6: the Operation select offers the seven operations in order', async ({ page }) => {
    const sheet = await openSheet(page, 'V-PLUGIN-SFTP-01 operations', UPLOAD_VALUES)
    await expectOptions(
      page,
      sheet,
      'operation',
      OPERATIONS.map((operation) => OPERATION_LABELS[operation]),
    )
  })

  test('SV-7: switching Operation keeps Source across transfers and Move, and clears what leaves', async ({
    page,
  }) => {
    const typedSource = 'exports/orders.csv'
    const typedDestination = '/archive/orders.csv'
    // POST /tests refuses empty required rows; the typed values replace these.
    const seeded = { source: 'seeded/placeholder.csv', destination: '/inbound/placeholder.tmp' }
    const testId = await seed(page, sftpFixture('V-PLUGIN-SFTP-01 switching', seeded))
    let sheet = await openConfig(page, NODE_ID)
    await expandGroup(sheet, 'Advanced')

    await setStringParam(sheet, page, 'source', typedSource)
    await expectStringParamPreview(sheet, 'source', typedSource)
    await expect(paramRow(sheet, 'max_size_mib')).toHaveCount(0)
    await expect(paramRow(sheet, 'max_files')).toHaveCount(0)

    // One wire name, one field: the Upload Source is the Download Source.
    await setOperation(page, sheet, 'download')
    await expectStringParamPreview(sheet, 'source', typedSource)
    await expectStringParamPreview(sheet, 'destination', seeded.destination)
    await expectGrayDefault(sheet, 'max_size_mib', '1024')
    await expectGrayDefault(sheet, 'max_files', '10000')
    await typeNumber(page, sheet, 'max_size_mib', '5')

    await setOperation(page, sheet, 'move')
    await expectStringParamPreview(sheet, 'source', typedSource)
    await expectStringParamPreview(sheet, 'destination', seeded.destination)
    await expect(paramRow(sheet, 'max_size_mib')).toHaveCount(0)
    await expect(paramRow(sheet, 'max_files')).toHaveCount(0)
    await setStringParam(sheet, page, 'destination', typedDestination)
    await saveConfig(sheet)
    await saveWorkbench(page)

    // The saved Test holds what the sheet showed; the limit typed on Download left with it.
    const stored = (await persistedNodes(page.request, testId))[NODE_ID]
    expect(stored.expressionFields).toContain('session_id')
    const values = stored.config.values as Values
    expect(values.session_id).toBe(SESSION_VARIABLE)
    expect(values.operation).toBe('move')
    expect(values.source).toBe(typedSource)
    expect(values.destination).toBe(typedDestination)
    // Save stores only what the form shows and the user set (SHELL-10): the typed 5 left with Download.
    expect(Object.hasOwn(values, 'max_size_mib'), 'max_size_mib stores nothing').toBe(false)
    expect(Object.hasOwn(values, 'max_files'), 'max_files stores nothing').toBe(false)

    sheet = await openConfig(page, NODE_ID)
    await expect(enumTrigger(sheet, 'operation')).toHaveText('Move')
    await expectStringParamPreview(sheet, 'source', typedSource)
    await expandGroup(sheet, 'Advanced')
    await setOperation(page, sheet, 'download')
    // Back at the gray default (FIELD-2).
    await expectGrayDefault(sheet, 'max_size_mib', '1024')
    await expectGrayDefault(sheet, 'max_files', '10000')

    // A server operation has no Source, so the value goes and Path starts empty.
    await setOperation(page, sheet, 'list')
    await expect(editPreview(sheet, 'path')).toHaveValue('')
    for (const name of ['source', 'destination', 'if_exists', 'max_size_mib', 'max_files']) {
      await expect(paramRow(sheet, name), `${name} leaves on List`).toHaveCount(0)
    }
    await setOperation(page, sheet, 'upload')
    await expect(editPreview(sheet, 'source'), 'Source was cleared on List').toHaveValue('')
    await expect(editPreview(sheet, 'destination'), 'Destination was cleared on List').toHaveValue('')
  })

  test('SV-8: Record and continue adds Error and Reason after Success, and they leave again', async ({ page }) => {
    const sheet = await openSheet(page, 'V-PLUGIN-SFTP-01 on error', UPLOAD_VALUES)
    await expandGroup(sheet, 'Failure Handling')
    await expect(enumTrigger(sheet, 'on_error')).toHaveText('Fail the block')

    for (const operation of ['upload', 'stats'] as const) {
      await test.step(OPERATION_LABELS[operation], async () => {
        await setOperation(page, sheet, operation)
        await expectOutputs(sheet, OUTPUT_ROWS[operation], `${operation} fail the block`)
        await pickEnum(page, sheet, 'on_error', 'Record and continue')
        await expectOutputs(sheet, [...OUTPUT_ROWS[operation], 'error', 'reason'], `${operation} record`)
        await expectOutputRows(sheet, ['error', 'reason'])
        await pickEnum(page, sheet, 'on_error', 'Fail the block')
        await expectOutputs(sheet, OUTPUT_ROWS[operation], `${operation} back to fail the block`)
        await expect(outputRow(sheet, 'error')).toHaveCount(0)
        await expect(outputRow(sheet, 'reason')).toHaveCount(0)
      })
    }
  })

  test('SV-9: every row carries its exact info badge, and only the starred rows the required mark', async ({
    page,
  }) => {
    // One hover, tooltip wait and dismiss per badge, across all seven operations.
    test.setTimeout(180_000)
    const sheet = await openSheet(page, 'V-PLUGIN-SFTP-01 badges', UPLOAD_VALUES)
    await expandGroup(sheet, 'Advanced')
    await expandGroup(sheet, 'Failure Handling')

    for (const operation of OPERATIONS) {
      await test.step(OPERATION_LABELS[operation], async () => {
        if (operation !== 'upload') await setOperation(page, sheet, operation)
        await expectLayout(sheet, expandedLayout(operation), operation)

        const rows = [...TOP_ROWS[operation], ...ADVANCED_ROWS[operation], 'on_error']
        const starred: string[] = []
        for (const name of rows) {
          if ((await requiredStar(sheet, name).count()) > 0) starred.push(name)
        }
        expect(starred, `${operation}: rows carrying the required mark`).toEqual(REQUIRED[operation])

        for (const [name, text] of Object.entries(PAIRED_BADGES[operation])) {
          await expectBadge(page, sheet, paramRow(sheet, name), `${operation}/${name}`, text)
        }
        if (operation === 'upload') {
          for (const name of ['session_id', 'operation', 'if_exists', 'timeout', 'on_error']) {
            await expectBadge(page, sheet, paramRow(sheet, name), name, COMMON_BADGES[name])
          }
        }
        if (operation === 'download') {
          for (const name of ['max_size_mib', 'max_files']) {
            await expectBadge(page, sheet, paramRow(sheet, name), name, COMMON_BADGES[name])
          }
        }
        if (operation === 'list') {
          await expectBadge(page, sheet, paramRow(sheet, 'recursive'), 'recursive', COMMON_BADGES.recursive)
        }
        if (operation === 'delete') {
          await expectBadge(page, sheet, paramRow(sheet, 'missing_ok'), 'missing_ok', COMMON_BADGES.missing_ok)
        }

        for (const name of OUTPUT_ROWS[operation]) {
          if (name === 'success' && operation !== 'upload') continue
          await expectBadge(page, sheet, outputRow(sheet, name), `${operation} output ${name}`, OUTPUT_BADGES[name])
        }
      })
    }

    await pickEnum(page, sheet, 'on_error', 'Record and continue')
    for (const name of ['error', 'reason']) {
      await expectBadge(page, sheet, outputRow(sheet, name), `output ${name}`, OUTPUT_BADGES[name])
    }
  })

  test('SV-10: a limit below its bound is messaged on its own row and blocks Save', async ({ page }) => {
    const sheet = await openSheet(page, 'V-PLUGIN-SFTP-01 bounds', DOWNLOAD_VALUES)
    await expandGroup(sheet, 'Advanced')
    // Save turns on once the sheet is dirty; from here on only a bound can turn it off again.
    await typeNumber(page, sheet, 'timeout', '300')
    await expect(saveButton(sheet)).toBeEnabled()

    for (const [name, typed, message, inside] of [
      ['timeout', '0', TIMEOUT_MESSAGE, '300'],
      ['max_size_mib', '-1', MAX_SIZE_MESSAGE, '1024'],
      ['max_files', '-1', MAX_FILES_MESSAGE, '10000'],
    ]) {
      await test.step(LABELS[name], async () => {
        // PING-17: the message lands under the field as the value is typed, with no blur.
        await typeNumber(page, sheet, name, typed)
        await expect(rowError(sheet, name)).toHaveText(message)
        await expect(numberInput(sheet, name)).toHaveAttribute('aria-invalid', 'true')
        await expect(rowAlerts(sheet), 'no other row is flagged by it').toHaveCount(1)
        await expect(settingsNote(sheet)).toHaveText(SETTINGS_NOTE)
        await expect(saveButton(sheet)).toBeDisabled()
        // Nothing is clamped or rewritten: what the author typed is kept.
        await expect(numberInput(sheet, name)).toHaveValue(typed)

        await numberInput(sheet, name).fill(inside)
        await expect(rowAlerts(sheet), 'a value back inside the bound clears the message').toHaveCount(0)
        await expect(settingsNote(sheet)).toHaveCount(0)
        await expect(saveButton(sheet)).toBeEnabled()
      })
    }
  })

  test('SV-10: stored limits below their bounds paint the canvas alert badge', async ({ page }) => {
    const fixture = sftpFixture('V-PLUGIN-SFTP-01 stored bounds', {
      ...DOWNLOAD_VALUES,
      timeout: 0,
      max_size_mib: -1,
      max_files: -1,
    })
    // Save refuses a limit below its minimum; a Test file edited by hand can still hold it.
    await page.request.delete(`${BACKEND_URL}/workbench/session/`).catch(() => {})
    const refused = await page.request.post(`${BACKEND_URL}/tests`, {
      data: { ...fixture, name: `zz-11541-r2-sftp-refused-${Date.now()}` },
    })
    expect(refused.status(), 'Save refuses limits below their minimum').toBe(422)
    expect(JSON.stringify(await refused.json())).toContain('SETTING_BELOW_MINIMUM')
    created.push((await importExpectingErrors(page, fixture, { context: 'load' })).testId)
    const badge = canvasNode(page, NODE_ID).locator('[data-testid="node-validation-alert"]')
    await expectBadgeMessages(page, badge, [TIMEOUT_MESSAGE, MAX_SIZE_MESSAGE, MAX_FILES_MESSAGE])

    const sheet = await openConfig(page, NODE_ID)
    await expandGroup(sheet, 'Advanced')
    for (const [name, stored, message] of [
      ['timeout', '0', TIMEOUT_MESSAGE],
      ['max_size_mib', '-1', MAX_SIZE_MESSAGE],
      ['max_files', '-1', MAX_FILES_MESSAGE],
    ]) {
      await expect(rowError(sheet, name), name).toHaveText(message)
      await expect(numberInput(sheet, name), `${name} is kept verbatim`).toHaveValue(stored)
    }
    await expect(rowAlerts(sheet)).toHaveCount(3)
    await expect(settingsNote(sheet)).toHaveText(SETTINGS_NOTE)
    await expect(saveButton(sheet)).toBeDisabled()
  })

  test('SV-11: inside a Remote Execution body the block carries L and Source keeps Browse', async ({ page }) => {
    await seed(page, remoteBodyFixture('V-PLUGIN-SFTP-01 remote body'))

    // SFTP is not remotable: it runs on WAVE, so its WAVE-side row still browses.
    const locus = canvasNode(page, NODE_ID).locator('[data-testid="node-remote-locus-badge"]')
    await expect(locus).toHaveAttribute('data-locus', 'L')

    const sheet = await openConfig(page, NODE_ID)
    await expect(enumTrigger(sheet, 'operation')).toHaveText('Upload')
    await expect(browseButton(sheet, 'source')).toBeVisible()
    await expectBrowseHint(page, sheet, 'source', BROWSE_BOTH)
    expect(await browseRowIds(sheet)).toEqual(BROWSE_ROWS.upload)

    // An expression names the path at run time, so there is nothing to pick.
    // FIELD-7: Source holds a path, so the switch asks first; Clear empties the {x} box.
    await askSwitch(page, sheet, 'source')
    await answerSwitch(page, 'Clear')
    await expect(exprToggle(sheet, 'source')).toHaveAttribute('aria-pressed', 'true')
    await expect(browseButton(sheet, 'source')).toHaveCount(0)
  })

  test('SV-12: Quick Insert lists SFTP under Remote with the cyan FolderSync glyph', async ({ page }) => {
    await page.request.delete(`${BACKEND_URL}/workbench/session/`).catch(() => {})
    await page.goto('/workbench')
    await page.evaluate(() => localStorage.clear())
    await page.goto('/workbench')
    await waitForCanvasLoad(page)

    await page.locator('[data-testid="workflow-canvas"]').click({ position: { x: 40, y: 40 } })
    await page.keyboard.press('Control+Space')
    const popover = page.locator('[data-testid="quick-add-popover"]')
    await expect(popover).toBeVisible({ timeout: 5_000 })

    const row = popover.locator('[data-testid="quick-add-item-sftp"]')
    await row.scrollIntoViewIfNeeded()
    await expect(row).toBeVisible()
    await expect(row.locator('span.truncate')).toHaveText('SFTP')
    await expect(row.locator('span.ml-auto')).toHaveText('Remote')
    const glyph = row.locator('svg').first()
    await expect(glyph).toHaveClass(/\blucide-folder-sync\b/)
    await expect(glyph).toHaveClass(/\btext-cyan-500\b/)

    // The Remote rows follow the palette: SFTP after SSH Tunnel Close, before Remote Execution.
    const labeled = await popover.locator('[data-testid^="quick-add-item-"]').evaluateAll((els) =>
      els.map((el) => ({
        id: (el.getAttribute('data-testid') ?? '').replace('quick-add-item-', ''),
        label: (el.querySelector('span.ml-auto')?.textContent ?? '').trim(),
      })),
    )
    expect(labeled.filter((item) => item.label === 'Remote').map((item) => item.id)).toEqual(REMOTE_ORDER)
    expect(labeled.filter((item) => item.label === 'Network').map((item) => item.id)).not.toContain('sftp')

    await page.keyboard.press('Escape')
    await expect(popover).toHaveCount(0)
  })
})
