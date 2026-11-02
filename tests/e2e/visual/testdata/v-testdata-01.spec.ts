/**
 * V-TESTDATA-01: Test Data chip, the populated Test Data sheet, and the
 * four modes of the file-reference picker.
 *
 * Phase: fixture (serial) - self-seeds one test through the API (four File I/O
 * blocks plus a Log bookend), uploads its data files one request at a time,
 * and runs it once as a tracked execution so the artifact drill has rows.
 * Runs under both dark and light projects (theme-agnostic DOM assertions).
 *
 * REQ: REQ-3.4.3.2, REQ-3.4.2.2, REQ-5.2.4.12
 * Design Decisions: TDATA-3, TDATA-4, TDATA-5, TDATA-7, TDATA-8, TDATA-9,
 *                   TDATA-11
 *
 * Pass Criteria:
 *   TD-a  The Test Data chip sits left of the Artifacts chip, same font size
 *         and height, carries no count badge, opens the sheet, and shares the
 *         Artifacts chip's gating: neither chip exists on the read-only
 *         historical canvas (TDATA-3).
 *   TD-b  Sheet anatomy: decorative folder icon immediately before the "Test
 *         Data" title, Upload and New folder as 32 px text buttons with a
 *         leading icon portalled into the header, Refresh and Close as 28 px
 *         icon-only buttons, the filter row with its "N files - size" meta
 *         line, and the tree as the first child of the zone directly under
 *         that filter row with no section heading anywhere (TDATA-4).
 *   TD-c  Rows: a folder row carries its subtree size and a Collapse/Expand
 *         chevron; file rows carry the type tile for their extension, a
 *         monospaced name and their own size; the footer note states the
 *         read-only contract (TDATA-4, TDATA-6, TDATA-11).
 *   TD-d  Copy path is the first action on a Test Data file row and on a
 *         folder row, before Download and the kebab; a click marks the button
 *         copied, announces "Path copied" and puts the row's testdata://
 *         reference on the clipboard (TDATA-5, TDATA-7).
 *   TD-e  Picker file / file-or-folder / folder modes: per-mode title on the
 *         sheet and its aria-label, both source tabs with the tab of the row's
 *         scheme in front (Artifacts for these artifact:// rows), the Reference
 *         line as the fixed scheme of the tab in front plus the path under it,
 *         each tab keeping its own path, the selection rule each mode allows,
 *         muted non-selectable files in folder mode, and the editable path
 *         driving the Select button's disabled state (TDATA-8, TDATA-9).
 *   TD-f  Picker save-as mode: "Save as", no source tabs, the artifacts-only
 *         pane with its hint and empty state, the Name field seeded from the
 *         row value, the Reference under the fixed artifact:// scheme, and
 *         Select disabled the moment the Name is empty (TDATA-8, TDATA-9).
 *   TD-g  Copy path is the first action on artifact drill rows too, before
 *         Download and Delete, and copies the row's artifact:// reference
 *         (TDATA-7).
 */

import { Buffer } from 'node:buffer'
import {
  test,
  expect,
  type APIRequestContext,
  type Locator,
  type Page,
} from '../../helpers/playwright-fixtures'
import { BACKEND_URL, E2E_ENV_NAME, ensureEnvironment } from '../../helpers/config'
import { createValidTest, openTest, validateTest } from '../../helpers/fn-seed'
import { configSheet } from '../../helpers/workbench'
import {
  createTestDataFolder,
  readTestDataListing,
  uploadTestData,
} from '../../helpers/testdata'

const NODE_DIMS = { width: 120, height: 62 }

/** One File I/O block with its operation already chosen. */
function fileIoNode(
  id: string,
  description: string,
  values: Record<string, unknown>,
  position: { x: number; y: number },
): Record<string, unknown> {
  return {
    id,
    type: 'workflowNode',
    position,
    data: {
      label: 'File I/O',
      elementType: 'file-io',
      nodeType: 'plugin',
      category: 'system',
      version: '1.0.0',
      description,
      hasNewerVersion: false,
      expressionFields: [],
      templateFields: [],
      config: { values, outputBindings: {}, profileBindings: [] },
    },
    measured: { ...NODE_DIMS },
  }
}

/** Every block runs on artifact:// only: a tracked execution has no test data
 *  roots in its context, so a testdata:// reference could not resolve there. */
const SEED_NODES = [
  fileIoNode(
    'fileio-write',
    'Write Artifact JSON',
    {
      operation: 'write',
      path: 'artifact://data/output.json',
      content: '{"status": "seeded"}',
      if_exists: 'overwrite',
    },
    { x: 200, y: 100 },
  ),
  fileIoNode(
    'fileio-read',
    'Read Artifact JSON',
    { operation: 'read', path: 'artifact://data/output.json' },
    { x: 200, y: 200 },
  ),
  fileIoNode(
    'fileio-copy',
    'Copy Artifact JSON',
    {
      operation: 'copy',
      source: 'artifact://data/output.json',
      destination: 'artifact://data/copy.json',
      if_exists: 'overwrite',
    },
    { x: 200, y: 300 },
  ),
  fileIoNode(
    'fileio-list',
    'List Artifact Folder',
    { operation: 'list', path: 'artifact://data' },
    { x: 200, y: 400 },
  ),
  {
    id: 'log-seeded',
    type: 'workflowNode',
    position: { x: 200, y: 500 },
    data: {
      label: 'Log',
      elementType: 'log',
      nodeType: 'plugin',
      category: 'system',
      version: '1.0.0',
      description: 'Seed Bookend',
      hasNewerVersion: false,
      expressionFields: ['message'],
      templateFields: [],
      config: {
        values: { message: "'test data visual seed complete'", level: 'INFO' },
        outputBindings: {},
        profileBindings: [],
      },
    },
    measured: { ...NODE_DIMS },
  },
]

const SEED_EDGES = [
  { id: 'e1', source: 'start-node', target: 'fileio-write', type: 'default' },
  { id: 'e2', source: 'fileio-write', target: 'fileio-read', type: 'default' },
  { id: 'e3', source: 'fileio-read', target: 'fileio-copy', type: 'default' },
  { id: 'e4', source: 'fileio-copy', target: 'fileio-list', type: 'default' },
  { id: 'e5', source: 'fileio-list', target: 'log-seeded', type: 'default' },
]

interface SeedFile {
  folder: string
  name: string
  body: string
}

/** The uploaded tree: one root file and a folder holding two more. */
const SEED_FILES: SeedFile[] = [
  { folder: '', name: 'users.csv', body: 'id,name\n1,Ada\n2,Grace\n' },
  { folder: 'fixtures', name: 'orders.json', body: '{"orders": [1, 2, 3]}\n' },
  { folder: 'fixtures', name: 'notes.txt', body: 'seed notes\n' },
]

function byteLength(body: string): number {
  return Buffer.byteLength(body, 'utf8')
}

const USERS_BYTES = byteLength(SEED_FILES[0].body)
const FIXTURES_BYTES = byteLength(SEED_FILES[1].body) + byteLength(SEED_FILES[2].body)
const TOTAL_BYTES = USERS_BYTES + FIXTURES_BYTES

/** Every seeded file is well under 1 KB, so the sheet renders plain bytes. */
function seedSize(bytes: number): string {
  return `${bytes} B`
}

let seededTestId = ''
let seededExecutionId = ''

async function environmentId(request: APIRequestContext): Promise<string> {
  const response = await request.get(`${BACKEND_URL}/environments`)
  expect(response.ok(), `GET /environments failed: ${response.status()}`).toBeTruthy()
  const body = await response.json()
  const environments = Array.isArray(body) ? body : (body.data ?? [])
  const found = environments.find((env: Record<string, unknown>) => env.name === E2E_ENV_NAME)
  expect(found, `E2E environment "${E2E_ENV_NAME}" not found`).toBeTruthy()
  return found.id as string
}

async function runTracked(
  request: APIRequestContext,
  testId: string,
  envId: string,
): Promise<string> {
  const started = await request.post(`${BACKEND_URL}/executions`, {
    data: { type: 'test', id: testId, environment_id: envId },
  })
  expect(started.ok(), `POST /executions failed: ${started.status()}`).toBeTruthy()
  const executionId = (((await started.json()).data ?? {}) as Record<string, unknown>).id as string

  const deadline = Date.now() + 60_000
  while (Date.now() < deadline) {
    const polled = await request.get(`${BACKEND_URL}/executions/${executionId}`)
    expect(polled.ok()).toBeTruthy()
    const status = (((await polled.json()).data ?? {}) as Record<string, unknown>).status as string
    if (status === 'passed' || status === 'failed' || status === 'stopped') {
      expect(status, 'the seeded artifact run passes').toBe('passed')
      return executionId
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error(`Execution ${executionId} did not finish in 60s`)
}

/** The wrapper row of one entry; `data-path` is the entry's relative path. */
function testDataRow(page: Page, path: string): Locator {
  return page.locator(`[data-testid="testdata-row"][data-path="${path}"]`)
}

async function openTestDataSheet(page: Page): Promise<Locator> {
  await page.getByTestId('breadcrumb-testdata-chip').click()
  const sheet = page.getByTestId('testdata-sheet')
  await expect(sheet).toBeVisible()
  await expect(page.getByTestId('testdata-browser')).toBeVisible()
  return sheet
}

async function openPicker(page: Page, nodeId: string, browseTestId: string): Promise<Locator> {
  const node = page.locator(`[data-testid="workflow-node-${nodeId}"]`)
  await node.locator('button').first().dispatchEvent('click')
  await expect(node).toHaveAttribute('data-selected', 'true')
  await node.getByTestId('node-configure').click()
  await expect(configSheet(page)).toBeVisible()
  await page.getByTestId(browseTestId).click()
  const picker = page.getByTestId('file-reference-picker-sheet')
  await expect(picker).toBeVisible()
  return picker
}

/** Cancel the picker, then close the config sheet it was opened from. */
async function closePicker(page: Page): Promise<void> {
  await page.getByTestId('picker-cancel-button').click()
  await expect(page.getByTestId('file-reference-picker-sheet')).toHaveCount(0)
  // The config sheet is a draggable sheet, not a dialog: Escape does not reach it.
  const sheet = configSheet(page)
  await sheet.locator('button[aria-label="Close"]').click()
  await expect(sheet).toBeHidden({ timeout: 10_000 })
}

/** A drill section located by its exact bold title span. */
function drillSection(page: Page, title: string): Locator {
  return page.locator('section', {
    has: page.locator('span.text-sm.font-bold', { hasText: title }),
  })
}

test.describe('V-TESTDATA-01: Test Data chip, sheet and file-reference picker', () => {
  test.describe.configure({ timeout: 120_000 })

  test.beforeAll(async ({ request }) => {
    test.setTimeout(180_000)
    await ensureEnvironment(request)
    const envId = await environmentId(request)

    seededTestId = await createValidTest(request, {
      name: `V-TESTDATA-01 ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      nodes: SEED_NODES,
      edges: SEED_EDGES,
    })
    const validation = await validateTest(request, seededTestId, 'run')
    expect(validation.errors, 'the seeded workflow validates clean').toHaveLength(0)

    expect(await createTestDataFolder(request, seededTestId, 'fixtures')).toEqual({
      path: 'fixtures',
    })
    for (const file of SEED_FILES) {
      // One file per request, fields in the order path, replace, then the file.
      expect(
        await uploadTestData(request, seededTestId, file.folder, file.name, file.body, {
          mimeType: 'text/plain',
        }),
      ).toEqual({
        path: file.folder === '' ? file.name : `${file.folder}/${file.name}`,
        size_bytes: byteLength(file.body),
        replaced: false,
      })
    }
    expect(await readTestDataListing(request, seededTestId)).toMatchObject({
      total_files: SEED_FILES.length,
      total_bytes: TOTAL_BYTES,
    })

    seededExecutionId = await runTracked(request, seededTestId, envId)
  })

  test.afterAll(async ({ request }) => {
    if (seededTestId === '') return
    await request.delete(`${BACKEND_URL}/workbench/session`).catch(() => undefined)
    // Deleting the test cascades: its test data folder goes with it.
    const removed = await request.delete(`${BACKEND_URL}/tests/${seededTestId}`)
    expect(removed.ok(), `cleanup delete failed: ${removed.status()}`).toBeTruthy()
    seededTestId = ''
  })

  test('TD-a: the chip sits left of Artifacts, carries no badge, and shares its gating', async ({
    page,
  }) => {
    await openTest(page, seededTestId)

    const chip = page.getByTestId('breadcrumb-testdata-chip')
    const artifactsChip = page.getByTestId('breadcrumb-artifacts-chip')
    await expect(chip).toBeVisible()
    await expect(artifactsChip).toBeVisible()

    // The chip names itself "Test data" to assistive tech and shows "Test Data".
    await expect(chip).toHaveAttribute('aria-label', 'Test data')
    // No count badge: the chip's whole text is its label (TDATA-3).
    await expect(chip).toHaveText('Test Data')

    const placement = await page.evaluate(() => {
      const testData = document.querySelector('[data-testid="breadcrumb-testdata-chip"]')
      const artifacts = document.querySelector('[data-testid="breadcrumb-artifacts-chip"]')
      if (!testData || !artifacts) return 'missing'
      const following = testData.compareDocumentPosition(artifacts) & 4
      return following === 0 ? 'after' : 'before'
    })
    expect(placement, 'the Test Data chip precedes the Artifacts chip').toBe('before')

    const metrics = (locator: Locator) =>
      locator.evaluate((el) => ({
        fontSize: getComputedStyle(el).fontSize,
        height: el.getBoundingClientRect().height,
      }))
    const chipMetrics = await metrics(chip)
    const artifactsMetrics = await metrics(artifactsChip)
    expect(chipMetrics.fontSize, 'both chips use the same type size').toBe(
      artifactsMetrics.fontSize,
    )
    expect(
      Math.abs(chipMetrics.height - artifactsMetrics.height),
      'both chips are the same height',
    ).toBeLessThanOrEqual(1)

    await openTestDataSheet(page)

    // Same visibility gating (TDATA-3): the read-only historical canvas of the
    // seeded run carries neither chip.
    await page.goto(`/executions/history/${seededExecutionId}`)
    await expect(page.getByTestId('canvas-breadcrumb')).toBeVisible({ timeout: 30_000 })
    await expect(page.getByTestId('breadcrumb-artifacts-chip')).toHaveCount(0)
    await expect(page.getByTestId('breadcrumb-testdata-chip')).toHaveCount(0)
  })

  test('TD-b: sheet header, filter row meta line, and the tree straight under it', async ({
    page,
  }) => {
    await openTest(page, seededTestId)
    const sheet = await openTestDataSheet(page)
    const handle = page.getByTestId('testdata-sheet-drag-handle')

    await expect(sheet).toHaveAttribute('aria-label', 'Test Data')
    await expect(handle.getByRole('heading', { name: 'Test Data', exact: true })).toBeVisible()

    const iconLeadsTitle = await handle.evaluate((el) => {
      const heading = el.querySelector('h2')
      const previous = heading?.previousElementSibling ?? null
      return (
        previous !== null &&
        previous.tagName.toLowerCase() === 'svg' &&
        previous.getAttribute('aria-hidden') === 'true'
      )
    })
    expect(iconLeadsTitle, 'a decorative folder icon sits immediately before the title').toBe(true)

    // Upload and New folder are small TEXT buttons with a leading icon, and the
    // browser portals them into the sheet header (TDATA-4).
    for (const [testId, label] of [
      ['testdata-upload-button', 'Upload'],
      ['testdata-new-folder-button', 'New folder'],
    ] as const) {
      const button = handle.getByTestId(testId)
      await expect(button).toBeVisible()
      await expect(button).toHaveText(label)
      await expect(button).toHaveCSS('height', '32px')
      const iconLeads = await button.evaluate((el) => {
        const wrapper = el.querySelector('span')
        return wrapper?.firstElementChild?.tagName.toLowerCase() === 'svg'
      })
      expect(iconLeads, `${label} carries a leading icon`).toBe(true)
    }

    // Refresh and Close carry no visible label: square icon buttons.
    for (const name of ['Refresh', 'Close'] as const) {
      const button = handle.getByRole('button', { name, exact: true })
      await expect(button).toHaveText('')
      await expect(button.locator('svg')).toBeVisible()
      const box = await button.boundingBox()
      expect(Math.round(box?.width ?? 0), `${name} is a square icon button`).toBe(
        Math.round(box?.height ?? 0),
      )
    }

    const filter = page.getByTestId('testdata-filter')
    await expect(filter.locator('input')).toHaveAttribute('placeholder', 'Filter files…')
    await expect(
      sheet.getByText(`${SEED_FILES.length} files - ${seedSize(TOTAL_BYTES)}`, { exact: true }),
    ).toBeVisible()

    // The tree starts directly under the filter row, with no section header.
    const layout = await page.getByTestId('testdata-dropzone').evaluate((zone) => {
      const previous = zone.previousElementSibling
      return {
        previousHoldsFilter: previous?.querySelector('[data-testid="testdata-filter"]') != null,
        firstChildRole: zone.firstElementChild?.getAttribute('role') ?? null,
        firstChildLabel: zone.firstElementChild?.getAttribute('aria-label') ?? null,
      }
    })
    expect(
      layout.previousHoldsFilter,
      'the filter row is the tree zone previous sibling',
    ).toBe(true)
    expect(layout.firstChildRole).toBe('tree')
    expect(layout.firstChildLabel).toBe('Test data files')
    await expect(sheet.getByRole('heading'), 'the sheet has no section headings').toHaveCount(1)
  })

  test('TD-c: folder aggregate size, file tiles, monospaced names, footer note', async ({
    page,
  }) => {
    await openTest(page, seededTestId)
    const sheet = await openTestDataSheet(page)

    const fixtures = testDataRow(page, 'fixtures')
    await expect(fixtures).toHaveAttribute('data-entry-type', 'dir')
    const fixturesRow = fixtures.getByTestId('folder-row').first()
    await expect(
      fixturesRow.getByRole('button', { name: 'Collapse fixtures', exact: true }),
    ).toHaveAttribute('aria-expanded', 'true')
    await expect(
      fixturesRow.getByText(seedSize(FIXTURES_BYTES), { exact: true }),
      'the folder row shows its subtree size',
    ).toBeVisible()

    const tiles: Array<[string, string, number]> = [
      ['users.csv', 'spreadsheet', USERS_BYTES],
      ['fixtures/orders.json', 'json', byteLength(SEED_FILES[1].body)],
      ['fixtures/notes.txt', 'text', byteLength(SEED_FILES[2].body)],
    ]
    for (const [path, kind, bytes] of tiles) {
      const name = path.split('/').pop() as string
      const row = testDataRow(page, path).getByTestId('file-row')
      await expect(row.getByTestId('artifact-file-icon')).toHaveAttribute('data-file-kind', kind)
      await expect(row.getByText(name, { exact: true }).last()).toHaveCSS(
        'font-family',
        /monospace/,
      )
      await expect(row.getByText(seedSize(bytes), { exact: true })).toBeVisible()
    }

    await expect(
      sheet.getByText(
        'Reference a file as testdata://folder/name. Blocks read test data; they never change it.',
        { exact: true },
      ),
    ).toBeVisible()
  })

  test('TD-d: Copy path leads the row actions and copies the testdata:// reference', async ({
    page,
  }) => {
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
    await openTest(page, seededTestId)
    await openTestDataSheet(page)

    const fileRow = testDataRow(page, 'users.csv').getByTestId('file-row')
    const fileActions = fileRow.getByRole('button')
    await expect(fileActions).toHaveCount(3)
    await expect(fileActions.nth(0)).toHaveAccessibleName('Copy path of users.csv')
    await expect(fileActions.nth(1)).toHaveAccessibleName('Download users.csv')
    await expect(fileActions.nth(2)).toHaveAccessibleName('More actions for users.csv')

    const copyFile = fileRow.getByTestId('copy-path-button')
    await expect(copyFile).not.toHaveAttribute('data-copied', 'true')
    await copyFile.click()
    await expect(copyFile).toHaveAttribute('data-copied', 'true')
    await expect(copyFile.locator('output')).toHaveText('Path copied')
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('testdata://users.csv')

    const folderRow = testDataRow(page, 'fixtures').getByTestId('folder-row').first()
    const folderActions = folderRow.getByRole('button')
    await expect(folderActions).toHaveCount(4)
    await expect(folderActions.nth(0)).toHaveAccessibleName('Collapse fixtures')
    await expect(folderActions.nth(1)).toHaveAccessibleName('Copy path of fixtures')
    await expect(folderActions.nth(2)).toHaveAccessibleName('Download fixtures')
    await expect(folderActions.nth(3)).toHaveAccessibleName('More actions for fixtures')

    await folderRow.getByTestId('copy-path-button').click()
    // A folder reference carries no trailing slash.
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('testdata://fixtures')
  })

  test('TD-e: picker file, file-or-folder and folder modes', async ({ page }) => {
    await openTest(page, seededTestId)

    await test.step('file mode on File I/O Read Path', async () => {
      const picker = await openPicker(page, 'fileio-read', 'param-browse-path')
      await expect(picker).toHaveAttribute('aria-label', 'Choose a file')
      await expect(picker.getByRole('heading', { name: 'Choose a file', exact: true })).toBeVisible()
      await expect(page.getByTestId('file-reference-picker')).toHaveAttribute(
        'data-picker-mode',
        'file',
      )

      const testDataTab = page.getByTestId('picker-tab-testdata')
      const artifactsTab = page.getByTestId('picker-tab-artifacts')
      const scheme = page.getByTestId('picker-reference-scheme')
      const reference = page.getByTestId('picker-reference-input')
      const select = page.getByTestId('picker-use-button')
      await expect(select).toHaveText('Select')

      // Both source tabs; the row holds an artifact, so Artifacts opens in front with its path (TDATA-9).
      await expect(artifactsTab).toHaveAttribute('aria-pressed', 'true')
      await expect(testDataTab).toHaveAttribute('aria-pressed', 'false')
      await expect(page.getByTestId('picker-name-input'), 'no Name field outside save-as').toHaveCount(
        0,
      )
      await expect(scheme).toHaveText('artifact://')
      await expect(reference).toHaveValue('data/output.json')
      await expect(select).toBeEnabled()

      // The Artifacts tab; this session wrote nothing.
      await expect(page.getByTestId('testdata-browser')).toHaveCount(0)
      await expect(page.getByTestId('picker-artifacts-empty')).toHaveText(
        'Files this session wrote appear here. Type a path an earlier block writes.',
      )
      await expect(picker.getByText("Files in this session's artifacts", { exact: true })).toBeVisible()
      await expect(
        picker.getByText(
          'A block can read one only after an earlier block in the same run wrote it.',
          { exact: true },
        ),
      ).toBeVisible()

      // Test Data has its own scheme and a path of its own, empty so far.
      await testDataTab.click()
      await expect(testDataTab).toHaveAttribute('aria-pressed', 'true')
      await expect(artifactsTab).toHaveAttribute('aria-pressed', 'false')
      await expect(scheme).toHaveText('testdata://')
      await expect(reference).toHaveValue('')
      await expect(select).toBeDisabled()

      // The path is editable and alone decides whether Select is live.
      await reference.fill('reports/latest.csv')
      await expect(scheme).toHaveText('testdata://')
      await expect(select).toBeEnabled()
      await reference.fill('')
      await expect(select).toBeDisabled()

      // A file selects; a folder in file mode does not.
      const fileRow = testDataRow(page, 'users.csv').getByTestId('file-row')
      await fileRow.click()
      await expect(fileRow).toHaveAttribute('data-selected', 'true')
      await expect(reference).toHaveValue('users.csv')

      const folderRow = testDataRow(page, 'fixtures').getByTestId('folder-row').first()
      await folderRow.getByText('fixtures', { exact: true }).last().click()
      await expect(folderRow).not.toHaveAttribute('data-selected', 'true')
      await expect(reference).toHaveValue('users.csv')

      // Typing the path drops the row selection (TDATA-9).
      await reference.fill('fixtures/notes.txt')
      await expect(fileRow).not.toHaveAttribute('data-selected', 'true')
      await expect(select).toBeEnabled()

      // Each tab keeps its own path.
      await artifactsTab.click()
      await expect(scheme).toHaveText('artifact://')
      await expect(reference).toHaveValue('data/output.json')
      await testDataTab.click()
      await expect(scheme).toHaveText('testdata://')
      await expect(reference).toHaveValue('fixtures/notes.txt')

      await closePicker(page)
    })

    await test.step('file-or-folder mode on File I/O Copy Source', async () => {
      const picker = await openPicker(page, 'fileio-copy', 'param-browse-source')
      await expect(picker).toHaveAttribute('aria-label', 'Choose a file or folder')
      await expect(
        picker.getByRole('heading', { name: 'Choose a file or folder', exact: true }),
      ).toBeVisible()
      await expect(page.getByTestId('file-reference-picker')).toHaveAttribute(
        'data-picker-mode',
        'file-or-folder',
      )
      const testDataTab = page.getByTestId('picker-tab-testdata')
      const artifactsTab = page.getByTestId('picker-tab-artifacts')
      await expect(testDataTab).toBeVisible()
      await expect(artifactsTab).toBeVisible()

      const scheme = page.getByTestId('picker-reference-scheme')
      const reference = page.getByTestId('picker-reference-input')
      const select = page.getByTestId('picker-use-button')

      // The row holds an artifact: Artifacts opens in front with its path.
      await expect(artifactsTab).toHaveAttribute('aria-pressed', 'true')
      await expect(scheme).toHaveText('artifact://')
      await expect(reference).toHaveValue('data/output.json')

      await testDataTab.click()
      await expect(scheme).toHaveText('testdata://')
      await expect(reference).toHaveValue('')
      await expect(select).toBeDisabled()

      // Nothing in this mode is muted: both kinds pick.
      await expect(testDataRow(page, 'users.csv').getByTestId('file-row')).toBeVisible()
      await expect(page.locator('[data-testid="file-row"][data-muted="true"]')).toHaveCount(0)

      const folderRow = testDataRow(page, 'fixtures').getByTestId('folder-row').first()
      await folderRow.getByText('fixtures', { exact: true }).last().click()
      await expect(folderRow).toHaveAttribute('data-selected', 'true')
      await expect(reference).toHaveValue('fixtures')
      await expect(select).toBeEnabled()

      const fileRow = testDataRow(page, 'fixtures/orders.json').getByTestId('file-row')
      await fileRow.click()
      await expect(fileRow).toHaveAttribute('data-selected', 'true')
      await expect(folderRow).not.toHaveAttribute('data-selected', 'true')
      await expect(scheme).toHaveText('testdata://')
      await expect(reference).toHaveValue('fixtures/orders.json')

      await closePicker(page)
    })

    await test.step('folder mode on File I/O List Path', async () => {
      const picker = await openPicker(page, 'fileio-list', 'param-browse-path')
      await expect(picker).toHaveAttribute('aria-label', 'Choose a folder')
      await expect(
        picker.getByRole('heading', { name: 'Choose a folder', exact: true }),
      ).toBeVisible()
      await expect(page.getByTestId('file-reference-picker')).toHaveAttribute(
        'data-picker-mode',
        'folder',
      )
      const testDataTab = page.getByTestId('picker-tab-testdata')
      const artifactsTab = page.getByTestId('picker-tab-artifacts')
      await expect(testDataTab).toBeVisible()
      await expect(artifactsTab).toBeVisible()

      const scheme = page.getByTestId('picker-reference-scheme')
      const reference = page.getByTestId('picker-reference-input')
      const select = page.getByTestId('picker-use-button')

      // The row holds an artifact folder: Artifacts opens in front with its path.
      await expect(artifactsTab).toHaveAttribute('aria-pressed', 'true')
      await expect(scheme).toHaveText('artifact://')
      await expect(reference).toHaveValue('data')

      await testDataTab.click()
      await expect(scheme).toHaveText('testdata://')
      await expect(reference).toHaveValue('')
      await expect(select).toBeDisabled()

      // Files are visible but out of reach: muted, aria-disabled and untabbable.
      const fileRow = testDataRow(page, 'users.csv').getByTestId('file-row')
      await expect(fileRow).toHaveAttribute('data-muted', 'true')
      await expect(fileRow).toHaveAttribute('aria-disabled', 'true')
      await expect(fileRow).not.toHaveAttribute('tabindex', '0')
      await expect(fileRow).toHaveCSS('cursor', 'not-allowed')
      await expect(fileRow).toHaveCSS('opacity', '0.5')

      const folderRow = testDataRow(page, 'fixtures').getByTestId('folder-row').first()
      await expect(folderRow).toHaveAttribute('tabindex', '0')
      await folderRow.getByText('fixtures', { exact: true }).last().click()
      await expect(folderRow).toHaveAttribute('data-selected', 'true')
      await expect(scheme).toHaveText('testdata://')
      await expect(reference).toHaveValue('fixtures')
      await expect(select).toBeEnabled()

      await closePicker(page)
    })
  })

  test('TD-f: picker save-as mode on File I/O Write Path', async ({ page }) => {
    await openTest(page, seededTestId)
    const picker = await openPicker(page, 'fileio-write', 'param-browse-path')

    await expect(picker).toHaveAttribute('aria-label', 'Save as')
    await expect(picker.getByRole('heading', { name: 'Save as', exact: true })).toBeVisible()
    await expect(page.getByTestId('file-reference-picker')).toHaveAttribute(
      'data-picker-mode',
      'save-as',
    )

    // Save-as writes artifacts only, so it has no source tabs at all (TDATA-9).
    await expect(page.getByTestId('picker-tab-testdata')).toHaveCount(0)
    await expect(page.getByTestId('picker-tab-artifacts')).toHaveCount(0)
    await expect(page.getByTestId('testdata-browser')).toHaveCount(0)
    await expect(
      picker.getByText("Folders and files in this session's artifacts", { exact: true }),
    ).toBeVisible()
    await expect(page.getByTestId('picker-artifacts-empty')).toHaveText(
      'Files this session wrote appear here. Type a path an earlier block writes.',
    )

    const name = page.getByTestId('picker-name-input')
    const scheme = page.getByTestId('picker-reference-scheme')
    const reference = page.getByTestId('picker-reference-input')
    const select = page.getByTestId('picker-use-button')

    // The Name field is seeded from the row's own value; save-as sits under artifact:// only.
    await expect(picker.getByText('Name', { exact: true })).toBeVisible()
    await expect(name).toHaveValue('output.json')
    await expect(scheme).toHaveText('artifact://')
    await expect(reference).toHaveValue('data/output.json')
    await expect(select).toHaveText('Select')
    await expect(select).toBeEnabled()

    // Name and Reference stay composed: a new name recomposes the folder + name.
    await name.fill('report.json')
    await expect(reference).toHaveValue('data/report.json')
    await expect(select).toBeEnabled()

    // An empty Name leaves a folder with nothing to save into.
    await name.fill('')
    await expect(scheme).toHaveText('artifact://')
    await expect(reference).toHaveValue('data/')
    await expect(select).toBeDisabled()

    await closePicker(page)
  })

  test('TD-g: Copy path leads artifact drill row actions and copies artifact://', async ({
    page,
  }) => {
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
    await page.goto(`/artifacts/${seededExecutionId}`)
    await expect(page.getByTestId('artifact-drill-page')).toBeVisible({ timeout: 30_000 })

    const files = drillSection(page, 'Files')
    await expect(
      files.getByRole('button', { name: 'Copy path of data', exact: true }),
      'the data/ folder row carries Copy path too',
    ).toBeVisible()

    const outputRow = files
      .locator('[data-testid="file-row"]')
      .filter({ hasText: 'output.json' })
      .first()
    const actions = outputRow.getByRole('button')
    await expect(actions).toHaveCount(3)
    await expect(actions.nth(0)).toHaveAccessibleName('Copy path of output.json')
    await expect(actions.nth(1)).toHaveAccessibleName('Download output.json')
    await expect(actions.nth(2)).toHaveAccessibleName('Delete output.json')

    const copy = outputRow.getByTestId('copy-path-button')
    await copy.click()
    await expect(copy).toHaveAttribute('data-copied', 'true')
    await expect(copy.locator('output')).toHaveText('Path copied')
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
      'artifact://data/output.json',
    )
  })
})
