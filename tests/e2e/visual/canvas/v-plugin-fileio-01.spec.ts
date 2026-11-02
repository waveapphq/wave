/**
 * V-PLUGIN-FILEIO-01: File I/O config sheet
 *
 * Phase: no-data (parallel) - palette drag-drop for the sheet itself; the
 * Remote Execution leg seeds its own Test through POST /tests and needs no DB
 * reset.
 * Runs under both dark and light projects (theme-agnostic DOM assertions).
 * REQ: REQ-3.4.1.10, REQ-3.4.2.2
 * Design Decisions: FIO-1 through FIO-10, TDATA-10
 *
 * Criterion ids use the FI- prefix (FIO-n below are design decision ids),
 * following the per-file letter convention v-plugin-k8s-01.spec.ts established.
 *
 * Pass Criteria:
 *   FI-a  the sheet is one flat form with no group cards, and each of the
 *         eight operations shows exactly its own rows in declaration order;
 *         switching operation removes the previous operation's rows
 *   FI-b  every row carries its exact label, and the required marker sits on
 *         Operation, the path-shaped rows and Write's Content only
 *   FI-c  the guidance placeholders follow the operation: the readable form on
 *         Read / Stats / List Path and Copy Source, the writable form on
 *         Write / Delete / Create folder Path, Move Source and Destination;
 *         RegEx Pattern carries its own example
 *   FI-d  defaults on screen: If the file exists opens on Replace it, Checksum
 *         on None, Output format on Individual, and the three switches unticked
 *   FI-e  the enum option labels: the eight operations in order, Write's three
 *         file policies against Copy's two, the five checksums, the three
 *         output formats
 *   FI-f  Browse sits on exactly the path-shaped rows and nowhere else; its
 *         tooltip names Artifacts alone where the picker is artifacts-only,
 *         and turning on the expression toggle takes Browse off the row
 *   FI-g  the expression toggle is on every row except Operation, If the file
 *         exists, Checksum and Output format
 *   FI-h  every input and output row leads with the (i) badge carrying its
 *         exact wording, and the paired Path / Source / If the file exists
 *         rows swap their wording with the operation
 *   FI-i  output rows follow the operation: Content for Read, Entries and
 *         Count for List, the Stats set in all three output formats with Size
 *         and Checksum joining and leaving on their settings, and NO output
 *         section at all for Write, Copy, Move, Delete and Create folder
 *   FI-j  a File I/O block inside a Remote Execution body carries the R locus
 *         badge and its path row loses Browse, while the same block outside
 *         the body keeps it
 *   FI-k  File I/O and HTTP Client each offer exactly one version, 1.0.0, with
 *         no newer-version arrow
 */

import { test, expect, type Page, type Locator } from '../../helpers/playwright-fixtures'
import { waitForTooltipClosed, waitForTooltipVisible } from '../../helpers/tooltip-wait'
import {
  dragPaletteItemToCanvas,
  expandPalette,
  waitForCanvasLoad,
  type PaletteDragSpec,
} from '../../helpers/canvas'
import { clearPointerLock, configSheet, openBlockSheet, openSelectedBlockSheet } from '../../helpers/workbench'
import { BACKEND_URL } from '../../helpers/config'

type Operation =
  | 'read'
  | 'write'
  | 'copy'
  | 'move'
  | 'delete'
  | 'stats'
  | 'list'
  | 'create_folder'

const OPERATIONS: Operation[] = [
  'read',
  'write',
  'copy',
  'move',
  'delete',
  'stats',
  'list',
  'create_folder',
]

const OPERATION_LABELS: Record<Operation, string> = {
  read: 'Read',
  write: 'Write',
  copy: 'Copy',
  move: 'Move',
  delete: 'Delete',
  stats: 'Stats',
  list: 'List',
  create_folder: 'Create folder',
}

/** FIO-1: the rows each operation shows, in descriptor declaration order. */
const ROWS: Record<Operation, string[]> = {
  read: ['operation', 'path'],
  write: ['operation', 'path', 'content', 'if_exists'],
  copy: ['operation', 'source', 'destination', 'if_exists'],
  move: ['operation', 'source', 'destination', 'if_exists'],
  delete: ['operation', 'path', 'missing_ok'],
  stats: ['operation', 'path', 'size', 'checksum', 'output_format'],
  list: ['operation', 'path', 'pattern', 'recursive', 'size'],
  create_folder: ['operation', 'path'],
}

const LABELS: Record<string, string> = {
  operation: 'Operation',
  path: 'Path',
  source: 'Source',
  destination: 'Destination',
  content: 'Content',
  if_exists: 'If the file exists',
  missing_ok: 'Ignore missing',
  pattern: 'RegEx Pattern',
  recursive: 'Include subfolders',
  size: 'Size',
  checksum: 'Checksum',
  output_format: 'Output format',
}

/** Rows carrying the required marker while the operation is on screen. */
const REQUIRED: Record<Operation, string[]> = {
  read: ['operation', 'path'],
  write: ['operation', 'path', 'content'],
  copy: ['operation', 'source', 'destination'],
  move: ['operation', 'source', 'destination'],
  delete: ['operation', 'path'],
  stats: ['operation', 'path'],
  list: ['operation', 'path'],
  create_folder: ['operation', 'path'],
}

const PATH_READABLE = 'artifact://…, testdata://…, or /abs/path'
const PATH_WRITABLE = 'artifact://…, or /abs/path'
const PATTERN_PLACEHOLDER = String.raw`^report-.*\.json$`

/** FIO-2: the placeholder each operation puts on its path-shaped rows. */
const PLACEHOLDERS: Record<Operation, Record<string, string>> = {
  read: { path: PATH_READABLE },
  write: { path: PATH_WRITABLE },
  copy: { source: PATH_READABLE, destination: PATH_WRITABLE },
  move: { source: PATH_WRITABLE, destination: PATH_WRITABLE },
  delete: { path: PATH_WRITABLE },
  stats: { path: PATH_READABLE },
  list: { path: PATH_READABLE, pattern: PATTERN_PLACEHOLDER },
  create_folder: { path: PATH_WRITABLE },
}

/** The rows that carry the file picker, per operation. */
const BROWSE_ROWS: Record<Operation, string[]> = {
  read: ['path'],
  write: ['path'],
  copy: ['source', 'destination'],
  move: ['source', 'destination'],
  delete: ['path'],
  stats: ['path'],
  list: ['path'],
  create_folder: ['path'],
}

const BROWSE_BOTH = 'Browse Test Data and Artifacts'
const BROWSE_ARTIFACTS = 'Browse Artifacts'

/** The picker hint per row: artifacts-only wherever the target is written. */
const BROWSE_HINTS: Record<Operation, Record<string, string>> = {
  read: { path: BROWSE_BOTH },
  write: { path: BROWSE_ARTIFACTS },
  copy: { source: BROWSE_BOTH, destination: BROWSE_ARTIFACTS },
  move: { source: BROWSE_ARTIFACTS, destination: BROWSE_ARTIFACTS },
  delete: { path: BROWSE_BOTH },
  stats: { path: BROWSE_BOTH },
  list: { path: BROWSE_BOTH },
  create_folder: { path: BROWSE_ARTIFACTS },
}

/** Rows the descriptor pins as selector-only (noExpression). */
const NO_EXPRESSION_ROWS = ['operation', 'if_exists', 'checksum', 'output_format']

const OPERATION_BADGE =
  "What to do. Read returns a file's text. Write creates or changes a file. Copy and Move take a " +
  'source and a destination. Delete removes a file or folder. Stats reports whether a path is there ' +
  "and what it is. List returns a folder's entries as a table. Create folder makes a folder and " +
  'its missing parents.'

/** FIO-2 / TDATA-10: the info badge of every input row, per operation. */
const INPUT_BADGES: Record<Operation, Record<string, string>> = {
  read: {
    operation: OPERATION_BADGE,
    path:
      'File to read as UTF-8 text. Pick a Test Data or Artifact file with Browse, or type artifact://, testdata://, or an absolute or relative path where the block runs.',
  },
  write: {
    path:
      'File to write. artifact:// or an absolute or relative path where the block runs; missing folders are created. testdata:// is read-only.',
    content: 'Text to write, UTF-8.',
    if_exists: 'What happens when the file is already there.',
  },
  copy: {
    source:
      'File or folder to copy. Pick a Test Data or Artifact file or folder with Browse, or type a path.',
    destination:
      'The full target path, including the new name. artifact:// or an absolute or relative path; missing folders are created. testdata:// is read-only.',
    if_exists:
      'What happens when the destination is already there. Replacing a folder merges: files inside are replaced, others are kept.',
  },
  move: {
    source:
      'File or folder to move. artifact:// or an absolute or relative path; testdata:// is read-only.',
  },
  delete: {
    path:
      'File or folder to delete. A folder is removed with everything inside it. testdata:// is read-only.',
    missing_ok: 'Succeed when there is nothing to delete.',
  },
  stats: {
    path: 'File or folder to report on. A missing path is not an error: Exists is false.',
    size:
      "Include the size in bytes. A folder's size is everything inside it, at every depth.",
    checksum: "Digest of the file's bytes. Empty for a folder.",
    output_format: 'Individual outputs, one map, or a one-row table.',
  },
  list: {
    path: 'Folder to list.',
    pattern:
      'Python regular expression matched against each entry name. Empty lists everything.',
    recursive: 'List entries at every depth below the folder.',
  },
  create_folder: {
    path:
      'Folder to create, including its name. Missing parents are created; an existing folder is not an error. testdata:// is read-only.',
  },
}

const OUTPUT_BADGES: Record<string, string> = {
  content: "The file's text.",
  exists: 'True when the path is there.',
  type: 'file, folder, or empty when the path is missing.',
  modified: 'Last modified, ISO-8601 UTC; empty when the path is missing.',
  size: 'Size in bytes.',
  checksum: 'Hex digest; empty for a folder or a missing path.',
  entries:
    'One row per entry: name, path, type, modified, and size when ticked.',
  count: 'Number of entries.',
}

const STATS_MAP_BADGE = 'exists, type, modified, and size or checksum when chosen.'
const STATS_TABLE_BADGE = 'One row with the same columns.'

/** FIO-9: the operations that produce nothing at all. */
const OUTPUTLESS: Operation[] = ['write', 'copy', 'move', 'delete', 'create_folder']

// ---------------------------------------------------------------------------
// Locators and small helpers
// ---------------------------------------------------------------------------

const paramRow = (modal: Locator, name: string) =>
  modal.locator(`[data-testid="param-row-${name}"]`)

const outputRow = (modal: Locator, name: string) =>
  modal.locator(`[data-testid="output-row-${name}"]`)

const browseButton = (modal: Locator, name: string) =>
  modal.locator(`[data-testid="param-browse-${name}"]`)

const exprToggle = (modal: Locator, name: string) =>
  paramRow(modal, name).locator('[data-testid="expression-toggle"]')

/** The text box of a row's one value field (FIELD-1). */
const fieldBox = (modal: Locator, name: string) =>
  paramRow(modal, name).locator('[data-slot="input-group"] input')

/** The required marker span in a row's name cell. */
const requiredStar = (modal: Locator, name: string) =>
  paramRow(modal, name).locator('td:nth-child(2) span.text-destructive')

/** Drop one palette block on an empty canvas and open its config sheet. */
async function openPluginConfig(page: Page, spec: PaletteDragSpec): Promise<Locator> {
  await page.request.delete(`${BACKEND_URL}/workbench/session`).catch(() => {})
  await page.goto('/workbench')
  await page.evaluate(() => localStorage.clear())
  await page.goto('/workbench')
  await waitForCanvasLoad(page)

  // Expanding first settles the canvas box the drop position is measured from.
  await expandPalette(page)
  const canvas = page.locator('[data-testid="workflow-canvas"]')
  const box = await canvas.boundingBox()
  await dragPaletteItemToCanvas(page, spec, { x: box!.width / 2, y: box!.height / 2 })

  const node = page.locator('[data-testid^="workflow-node-"][data-nodetype]').first()
  await node.locator('button').first().dispatchEvent('click')
  await expect(node).toHaveAttribute('data-selected', 'true')

  await openSelectedBlockSheet(page)
  const modal = configSheet(page)
  await expect(modal).toBeVisible()
  return modal
}

const openFileIoConfig = (page: Page) =>
  openPluginConfig(page, { term: 'File I/O', testId: 'palette-item-file-io' })

/** Every visible input row id on the sheet, in DOM order. */
async function sheetRowIds(modal: Locator): Promise<string[]> {
  return modal
    .locator('[data-testid^="param-row-"]')
    .evaluateAll((els) =>
      els.map((el) => (el.getAttribute('data-testid') ?? '').replace('param-row-', '')),
    )
}

async function outputRowIds(modal: Locator): Promise<string[]> {
  return modal
    .locator('[data-testid^="output-row-"]')
    .evaluateAll((els) =>
      els.map((el) => (el.getAttribute('data-testid') ?? '').replace('output-row-', '')),
    )
}

/** The visible input rows, waited on by count first so the read never races a
 *  re-render that is still landing. */
async function expectRowIds(modal: Locator, names: string[], label: string): Promise<void> {
  await expect(modal.locator('[data-testid^="param-row-"]'), label).toHaveCount(names.length)
  expect(await sheetRowIds(modal), label).toEqual(names)
}

async function expectOutputIds(modal: Locator, names: string[], label: string): Promise<void> {
  await expect(modal.locator('[data-testid^="output-row-"]'), label).toHaveCount(names.length)
  expect(await outputRowIds(modal), label).toEqual(names)
}

/** Every Browse button on the sheet, by the wire name it belongs to. */
async function browseRowIds(modal: Locator): Promise<string[]> {
  return modal
    .locator('[data-testid^="param-browse-"]')
    .evaluateAll((els) =>
      els.map((el) => (el.getAttribute('data-testid') ?? '').replace('param-browse-', '')),
    )
}

async function pickEnum(
  page: Page,
  modal: Locator,
  name: string,
  optionLabel: string,
): Promise<void> {
  const trigger = paramRow(modal, name).locator('button[role="combobox"]')
  await trigger.scrollIntoViewIfNeeded()
  await trigger.click()
  const listbox = page.locator('[role="listbox"]')
  await expect(listbox).toBeVisible()
  await listbox.getByRole('option', { name: optionLabel, exact: true }).click()
  await expect(listbox).toHaveCount(0)
  await expect(trigger).toHaveText(optionLabel)
}

const setOperation = (page: Page, modal: Locator, operation: Operation) =>
  pickEnum(page, modal, 'operation', OPERATION_LABELS[operation])

/** Open an enum, read its options in order, close it again without choosing. */
async function readEnumOptions(page: Page, modal: Locator, name: string): Promise<string[]> {
  const trigger = paramRow(modal, name).locator('button[role="combobox"]')
  await trigger.scrollIntoViewIfNeeded()
  await trigger.click()
  const listbox = page.locator('[role="listbox"]')
  await expect(listbox).toBeVisible()
  const options = await listbox.getByRole('option').allTextContents()
  await page.keyboard.press('Escape')
  await expect(page.locator('[role="listbox"]')).toHaveCount(0)
  await expect(modal).toBeVisible()
  return options.map((text) => text.trim())
}

const checkbox = (modal: Locator, name: string) =>
  paramRow(modal, name).locator('button[role="checkbox"]')

async function setCheckbox(modal: Locator, name: string, checked: boolean): Promise<void> {
  const state = checked ? 'checked' : 'unchecked'
  const box = checkbox(modal, name)
  await box.scrollIntoViewIfNeeded()
  if ((await box.getAttribute('data-state')) !== state) await box.click()
  await expect(box).toHaveAttribute('data-state', state)
}

/** Park the pointer on sheet padding so one tooltip closes before the next opens. */
async function dismissTooltip(page: Page, modal: Locator): Promise<void> {
  const box = await modal.boundingBox()
  await page.mouse.move(box!.x + 8, box!.y + box!.height - 8)
  await waitForTooltipClosed(page, 'the tooltip closes', 5_000)
  await expect(
    page.locator('[data-slot="tooltip-content"]:not([data-state="closed"])'),
  ).toHaveCount(0)
}

/** Hover one row's (i) and read the single accessible copy of its tooltip. */
async function expectBadge(
  page: Page,
  modal: Locator,
  row: Locator,
  label: string,
  text: string,
): Promise<void> {
  const badge = row.locator('.cursor-help')
  await badge.scrollIntoViewIfNeeded()
  await badge.hover()
  await waitForTooltipVisible(page, label, 5_000)
  const tooltip = page.locator('[data-slot="tooltip-content"]:not([data-state="closed"])')
  await expect(tooltip, label).toBeVisible({ timeout: 5_000 })
  // Radix paints the wording twice; [role="tooltip"] is the single accessible copy.
  await expect(tooltip.locator('[role="tooltip"]'), label).toHaveText(text)
  await dismissTooltip(page, modal)
}

/** Hover a Browse button and read its picker hint. */
async function expectBrowseHint(
  page: Page,
  modal: Locator,
  name: string,
  text: string,
): Promise<void> {
  const button = browseButton(modal, name)
  await button.scrollIntoViewIfNeeded()
  await button.hover()
  await waitForTooltipVisible(page, name, 5_000)
  const tooltip = page.locator('[data-slot="tooltip-content"]:not([data-state="closed"])')
  await expect(tooltip, name).toBeVisible({ timeout: 5_000 })
  await expect(tooltip.locator('[role="tooltip"]'), name).toHaveText(text)
  await dismissTooltip(page, modal)
}

// ---------------------------------------------------------------------------
// FI-j fixture: one container, one File I/O in its body, one outside it
// ---------------------------------------------------------------------------

const HOST_PATH = '/tmp/wave-e2e-fileio-w1.txt'

function fixtureNode(
  id: string,
  label: string,
  elementType: string,
  category: string,
  config: Record<string, unknown>,
  expressionFields: string[] = [],
  measured: { width: number; height: number } = { width: 120, height: 62 },
) {
  return {
    id,
    type: 'workflowNode',
    position: { x: -75, y: 100 },
    data: {
      label,
      elementType,
      nodeType: 'plugin',
      category,
      version: '1.0.0',
      description: label,
      hasNewerVersion: false,
      expressionFields,
      templateFields: [],
      config,
    },
    measured,
  }
}

const fileIoConfig = {
  values: { operation: 'read', path: HOST_PATH },
  outputBindings: {},
  profileBindings: [],
}

// A unique name per run: POST /tests refuses a duplicate.
const REMOTE_FIXTURE = {
  name: `File I/O Remote Locus Fixture ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  version: '1.0.0',
  description: '',
  workflow: {
    nodes: [
      fixtureNode(
        'container',
        'Remote Execution',
        'remote-execution',
        'remote',
        {
          values: { session_id: 'sid' },
          outputBindings: { remote_session_id: 'rsid' },
          profileBindings: [],
        },
        ['session_id'],
        { width: 160, height: 62 },
      ),
      fixtureNode('fileio-in', 'File I/O', 'file-io', 'system', fileIoConfig),
      fixtureNode('fileio-out', 'File I/O', 'file-io', 'system', fileIoConfig),
    ],
    edges: [
      { id: 'e0', source: 'start-node', target: 'container' },
      {
        id: 'e1',
        source: 'container',
        sourceHandle: 'body',
        target: 'fileio-in',
        type: 'default',
      },
      {
        id: 'e2',
        source: 'container',
        sourceHandle: 'then',
        target: 'fileio-out',
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

/** Close the config sheet without saving. */
async function closeConfig(page: Page): Promise<void> {
  const sheet = configSheet(page)
  await sheet.locator('button[aria-label="Close"]').click()
  await expect(sheet).toBeHidden({ timeout: 10_000 })
  await clearPointerLock(page)
}

/** Open a seeded node's config sheet. */
async function openSeededConfig(page: Page, nodeId: string): Promise<Locator> {
  const node = page.locator(`[data-testid="workflow-node-${nodeId}"]`)
  await node.locator('button').first().dispatchEvent('click')
  await expect(node).toHaveAttribute('data-selected', 'true')
  await openBlockSheet(page, nodeId)
  const modal = configSheet(page)
  await expect(modal).toBeVisible()
  return modal
}

/** The FI-j assertions, run against a seeded test id. */
async function runRemoteBodyChecks(page: Page, testId: string): Promise<void> {
  await page.goto(`/workbench?editTest=${testId}`)
  await page.evaluate(() => localStorage.clear())
  await page.goto(`/workbench?editTest=${testId}`)
  await waitForCanvasLoad(page)

  const badge = (nodeId: string) =>
    page.locator(`[data-testid="workflow-node-${nodeId}"] [data-testid="node-remote-locus-badge"]`)

  // File I/O is remotable, so in the body it runs on the host: R.
  await expect(badge('fileio-in')).toHaveAttribute('data-locus', 'R')
  // The same block on the then branch runs on WAVE and carries no badge.
  await expect(badge('fileio-out')).toHaveCount(0)

  // Every path there is a host path, so there is nothing to browse. The
  // row itself is untouched - it still edits and still carries its value.
  const inBody = await openSeededConfig(page, 'fileio-in')
  await expect(paramRow(inBody, 'path')).toBeVisible()
  await expect(browseButton(inBody, 'path')).toHaveCount(0)
  await expect(inBody.locator('[data-testid^="param-browse-"]')).toHaveCount(0)
  await expect(exprToggle(inBody, 'path')).toBeVisible()
  await expect(fieldBox(inBody, 'path')).toHaveValue(HOST_PATH)
  // The preview paints the tail so the file name stays readable, and the
  // whole path stays in the hover title.
  await expect(paramRow(inBody, 'path').locator('div[title]')).toHaveAttribute('title', HOST_PATH)
  await closeConfig(page)

  // Outside the body the same block, same operation, keeps its picker.
  const outside = await openSeededConfig(page, 'fileio-out')
  await expect(browseButton(outside, 'path')).toBeVisible()
}

// ---------------------------------------------------------------------------

test.describe('V-PLUGIN-FILEIO-01: File I/O config sheet', () => {
  test('FI-a: one flat form; each operation shows its own rows and switching removes the rest', async ({
    page,
  }) => {
    const modal = await openFileIoConfig(page)
    await expect(modal.getByRole('heading', { name: 'File I/O - Edit Config' })).toBeVisible()

    // FIO-1: no collapsible group card anywhere on the sheet.
    await expect(modal.locator('[data-testid^="group-header-"]')).toHaveCount(0)

    // The sheet opens on Read without anything being chosen.
    await expectRowIds(modal, ROWS.read, 'read on open')

    for (const operation of OPERATIONS) {
      if (operation !== 'read') await setOperation(page, modal, operation)
      await expectRowIds(modal, ROWS[operation], operation)
    }

    // Coming back to Read takes every other operation's row off the sheet.
    await setOperation(page, modal, 'read')
    await expectRowIds(modal, ROWS.read, 'back to read')
    for (const name of ['source', 'destination', 'content', 'if_exists', 'missing_ok']) {
      await expect(paramRow(modal, name), name).toHaveCount(0)
    }
  })

  test('FI-b: every row carries its label, and the required marker sits only where the schema puts it', async ({
    page,
  }) => {
    const modal = await openFileIoConfig(page)

    for (const operation of OPERATIONS) {
      if (operation !== 'read') await setOperation(page, modal, operation)

      const labels = await modal
        .locator('[data-testid^="param-row-"] td:nth-child(2)')
        .evaluateAll((cells) =>
          cells.map((cell) => (cell.textContent ?? '').replace(/\*\s*required$/, '').trim()),
        )
      expect(labels, operation).toEqual(ROWS[operation].map((name) => LABELS[name]))

      for (const name of ROWS[operation]) {
        const expected = REQUIRED[operation].includes(name) ? 1 : 0
        await expect(requiredStar(modal, name), `${operation}/${name}`).toHaveCount(expected)
      }
    }
  })

  test('FI-c: the guidance placeholders follow the operation on the paired path rows', async ({
    page,
  }) => {
    const modal = await openFileIoConfig(page)

    for (const operation of OPERATIONS) {
      if (operation !== 'read') await setOperation(page, modal, operation)

      for (const [name, placeholder] of Object.entries(PLACEHOLDERS[operation])) {
        // An empty string row paints its placeholder as muted italic guidance,
        // never as a value.
        await expect(fieldBox(modal, name), `${operation}/${name} holds no value`).toHaveValue('')
        await expect(fieldBox(modal, name), `${operation}/${name}`).toHaveAttribute('placeholder', placeholder)
      }
    }

    // The same wire name, two operations, two placeholders: the paired Source
    // descriptors describe the operation on screen rather than the wire.
    await setOperation(page, modal, 'copy')
    await expect(fieldBox(modal, 'source')).toHaveAttribute('placeholder', PATH_READABLE)
    await setOperation(page, modal, 'move')
    await expect(fieldBox(modal, 'source')).toHaveAttribute('placeholder', PATH_WRITABLE)
  })

  test('FI-d: the defaults each operation opens on', async ({ page }) => {
    const modal = await openFileIoConfig(page)

    await setOperation(page, modal, 'write')
    await expect(paramRow(modal, 'if_exists').locator('button[role="combobox"]')).toHaveText(
      'Replace it',
    )

    await setOperation(page, modal, 'copy')
    await expect(paramRow(modal, 'if_exists').locator('button[role="combobox"]')).toHaveText(
      'Replace it',
    )

    await setOperation(page, modal, 'delete')
    await expect(checkbox(modal, 'missing_ok')).toHaveAttribute('data-state', 'unchecked')

    await setOperation(page, modal, 'stats')
    await expect(checkbox(modal, 'size')).toHaveAttribute('data-state', 'unchecked')
    await expect(paramRow(modal, 'checksum').locator('button[role="combobox"]')).toHaveText('None')
    await expect(
      paramRow(modal, 'output_format').locator('button[role="combobox"]'),
    ).toHaveText('Individual')

    await setOperation(page, modal, 'list')
    await expect(checkbox(modal, 'recursive')).toHaveAttribute('data-state', 'unchecked')
    await expect(checkbox(modal, 'size')).toHaveAttribute('data-state', 'unchecked')

    // No row is retained across a hide: a checksum chosen under Stats is
    // gone when Stats comes back, not carried over.
    await setOperation(page, modal, 'stats')
    await pickEnum(page, modal, 'checksum', 'SHA-256')
    await setOperation(page, modal, 'list')
    await expect(paramRow(modal, 'checksum')).toHaveCount(0)
    await setOperation(page, modal, 'stats')
    await expect(paramRow(modal, 'checksum').locator('button[role="combobox"]')).toHaveText('None')
  })

  test('FI-e: the enum option labels', async ({ page }) => {
    const modal = await openFileIoConfig(page)

    expect(await readEnumOptions(page, modal, 'operation')).toEqual([
      'Read',
      'Write',
      'Copy',
      'Move',
      'Delete',
      'Stats',
      'List',
      'Create folder',
    ])

    // Write can append to what is there; Copy and Move cannot (FIO-3).
    await setOperation(page, modal, 'write')
    expect(await readEnumOptions(page, modal, 'if_exists')).toEqual([
      'Replace it',
      'Append to it',
      'Fail the block',
    ])

    await setOperation(page, modal, 'copy')
    expect(await readEnumOptions(page, modal, 'if_exists')).toEqual([
      'Replace it',
      'Fail the block',
    ])

    await setOperation(page, modal, 'stats')
    expect(await readEnumOptions(page, modal, 'checksum')).toEqual([
      'None',
      'MD5',
      'SHA-1',
      'SHA-256',
      'SHA-512',
    ])
    expect(await readEnumOptions(page, modal, 'output_format')).toEqual([
      'Individual',
      'Map',
      'Table',
    ])
  })

  test('FI-f: Browse sits on the path-shaped rows only, names the picker it opens, and leaves in expression mode', async ({
    page,
  }) => {
    const modal = await openFileIoConfig(page)

    for (const operation of OPERATIONS) {
      if (operation !== 'read') await setOperation(page, modal, operation)

      expect(await browseRowIds(modal), operation).toEqual(BROWSE_ROWS[operation])
      for (const name of BROWSE_ROWS[operation]) {
        await expect(browseButton(modal, name), `${operation}/${name}`).toHaveAttribute(
          'aria-label',
          `Browse files for ${LABELS[name]}`,
        )
      }
    }

    // Nothing that is not a path gets a picker.
    await setOperation(page, modal, 'write')
    await expect(browseButton(modal, 'content')).toHaveCount(0)
    await expect(browseButton(modal, 'if_exists')).toHaveCount(0)
    await setOperation(page, modal, 'list')
    await expect(browseButton(modal, 'pattern')).toHaveCount(0)
    await expect(browseButton(modal, 'recursive')).toHaveCount(0)
    await expect(browseButton(modal, 'size')).toHaveCount(0)

    // A written target browses this run's artifacts alone; a read one offers
    // both sources.
    await setOperation(page, modal, 'read')
    await expectBrowseHint(page, modal, 'path', BROWSE_HINTS.read.path)
    await setOperation(page, modal, 'write')
    await expectBrowseHint(page, modal, 'path', BROWSE_HINTS.write.path)
    await setOperation(page, modal, 'copy')
    await expectBrowseHint(page, modal, 'source', BROWSE_HINTS.copy.source)
    await expectBrowseHint(page, modal, 'destination', BROWSE_HINTS.copy.destination)
    // testdata:// is read-only, so Move's Source browses artifacts only.
    await setOperation(page, modal, 'move')
    await expectBrowseHint(page, modal, 'source', BROWSE_HINTS.move.source)

    // An expression names the path at run time, so there is nothing to pick.
    await setOperation(page, modal, 'read')
    await expect(browseButton(modal, 'path')).toBeVisible()
    await exprToggle(modal, 'path').click()
    await expect(exprToggle(modal, 'path')).toHaveAttribute('aria-pressed', 'true')
    await expect(browseButton(modal, 'path')).toHaveCount(0)
    await exprToggle(modal, 'path').click()
    await expect(exprToggle(modal, 'path')).toHaveAttribute('aria-pressed', 'false')
    await expect(browseButton(modal, 'path')).toBeVisible()
  })

  test('FI-g: only the selector rows drop the expression toggle', async ({ page }) => {
    const modal = await openFileIoConfig(page)

    for (const operation of OPERATIONS) {
      if (operation !== 'read') await setOperation(page, modal, operation)

      for (const name of ROWS[operation]) {
        const expected = NO_EXPRESSION_ROWS.includes(name) ? 0 : 1
        await expect(exprToggle(modal, name), `${operation}/${name}`).toHaveCount(expected)
      }
    }
  })

  test('FI-h: every row leads with the (i) badge, and the paired rows swap their wording', async ({
    page,
  }) => {
    // One hover, tooltip wait and dismiss per badge, across all eight operations.
    test.setTimeout(120_000)
    const modal = await openFileIoConfig(page)

    for (const operation of OPERATIONS) {
      if (operation !== 'read') await setOperation(page, modal, operation)

      // Every input row on screen leads with one.
      const rows = ROWS[operation].length
      await expect(modal.locator('[data-testid^="param-row-"] .cursor-help'), operation).toHaveCount(
        rows,
      )

      for (const [name, text] of Object.entries(INPUT_BADGES[operation])) {
        await expectBadge(page, modal, paramRow(modal, name), `${operation}/${name}`, text)
      }
    }

    // Output badges: Read, then the three Stats formats, then List.
    await setOperation(page, modal, 'read')
    await expectBadge(page, modal, outputRow(modal, 'content'), 'content', OUTPUT_BADGES.content)

    await setOperation(page, modal, 'stats')
    await setCheckbox(modal, 'size', true)
    await pickEnum(page, modal, 'checksum', 'SHA-256')
    for (const name of ['exists', 'type', 'modified', 'size', 'checksum']) {
      await expectBadge(page, modal, outputRow(modal, name), name, OUTPUT_BADGES[name])
    }
    await pickEnum(page, modal, 'output_format', 'Map')
    await expectBadge(page, modal, outputRow(modal, 'stats'), 'stats map', STATS_MAP_BADGE)
    await pickEnum(page, modal, 'output_format', 'Table')
    await expectBadge(page, modal, outputRow(modal, 'stats'), 'stats table', STATS_TABLE_BADGE)

    await setOperation(page, modal, 'list')
    await expectBadge(page, modal, outputRow(modal, 'entries'), 'entries', OUTPUT_BADGES.entries)
    await expectBadge(page, modal, outputRow(modal, 'count'), 'count', OUTPUT_BADGES.count)
  })

  test('FI-i: outputs follow the operation, and five operations produce none at all', async ({
    page,
  }) => {
    const modal = await openFileIoConfig(page)

    const outputsHeading = modal.getByRole('heading', { name: 'Output Variables' })

    // Read hands back the text it read.
    await expectOutputIds(modal, ['content'], 'read')
    await expect(outputsHeading).toBeVisible()

    // FIO-9: no path output, no Success output, no failure-handling group - the
    // section is not rendered at all.
    for (const operation of OUTPUTLESS) {
      await setOperation(page, modal, operation)
      await expectOutputIds(modal, [], operation)
      await expect(outputsHeading, operation).toHaveCount(0)
    }

    // Stats, individual: the three always-on rows, then Size and Checksum
    // joining and leaving on their own settings.
    await setOperation(page, modal, 'stats')
    await expectOutputIds(modal, ['exists', 'type', 'modified'], 'stats individual')
    await setCheckbox(modal, 'size', true)
    await expectOutputIds(modal, ['exists', 'type', 'modified', 'size'], 'stats size on')
    await pickEnum(page, modal, 'checksum', 'SHA-256')
    await expectOutputIds(
      modal,
      ['exists', 'type', 'modified', 'size', 'checksum'],
      'stats checksum chosen',
    )
    await pickEnum(page, modal, 'checksum', 'None')
    await expectOutputIds(modal, ['exists', 'type', 'modified', 'size'], 'stats checksum none')
    await setCheckbox(modal, 'size', false)
    await expectOutputIds(modal, ['exists', 'type', 'modified'], 'stats size off')

    // Output format swaps the individual rows for one row whose declared type
    // is the shape the block hands back.
    await pickEnum(page, modal, 'output_format', 'Map')
    await expectOutputIds(modal, ['stats'], 'stats map')
    await expect(outputRow(modal, 'stats').locator('td').nth(2)).toHaveText('map')
    await pickEnum(page, modal, 'output_format', 'Table')
    await expectOutputIds(modal, ['stats'], 'stats table')
    await expect(outputRow(modal, 'stats').locator('td').nth(2)).toHaveText('table')
    await pickEnum(page, modal, 'output_format', 'Individual')
    await expectOutputIds(modal, ['exists', 'type', 'modified'], 'stats back to individual')

    await setOperation(page, modal, 'list')
    await expectOutputIds(modal, ['entries', 'count'], 'list')
    await expect(outputRow(modal, 'entries').locator('td').nth(2)).toHaveText('table')
    await expect(outputRow(modal, 'count').locator('td').nth(2)).toHaveText('integer')
  })

  test('FI-j: inside a Remote Execution body the block carries the R badge and loses Browse', async ({
    page,
  }) => {
    const createResp = await page.request.post(`${BACKEND_URL}/tests`, { data: REMOTE_FIXTURE })
    const createBody = await createResp.json().catch(() => null)
    expect(
      createResp.ok(),
      `POST /tests failed: ${createResp.status()} - ${JSON.stringify(createBody)}`,
    ).toBeTruthy()
    const testId = createBody.data?.id ?? createBody.id

    try {
      await runRemoteBodyChecks(page, testId)
    } finally {
      // The stack is shared: this spec's own test never outlives it.
      await page.request.delete(`${BACKEND_URL}/tests/${testId}`).catch(() => {})
    }
  })

  test('FI-k: File I/O and HTTP Client each offer exactly one version, 1.0.0', async ({
    page,
  }) => {
    for (const spec of [
      { term: 'File I/O', testId: 'palette-item-file-io' },
      { term: 'http', testId: 'palette-item-http-client' },
    ]) {
      const modal = await openPluginConfig(page, spec)
      const selector = modal.locator('[data-testid="version-selector"]')
      await expect(selector, spec.testId).toHaveText('1.0.0')
      // WAVE is pre-release: with one version there is nothing newer to offer.
      await expect(
        modal.locator('[data-testid="version-update-available"]'),
        spec.testId,
      ).toHaveCount(0)

      await selector.click()
      const options = selector.locator('..').locator('ul li button')
      await expect(options, spec.testId).toHaveCount(1)
      // The one entry is the one in use, so it carries the Current hint.
      await expect(options.first(), spec.testId).toContainText('1.0.0')
      await expect(options.first(), spec.testId).toContainText('Current')
    }
  })
})
