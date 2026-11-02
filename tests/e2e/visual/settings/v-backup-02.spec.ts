/**
 * V-BACKUP-02: Backup & Restore - Restore Section
 *
 * Design Decisions: SETTINGS-1 through SETTINGS-16 (existing settings page), SETTINGS-21,
 *   BACKUP-2 through BACKUP-9
 * REQ: on-demand restore (upload, validate, restore); REQ-4.7.20, REQ-5.2.1.23
 *
 * Main Purpose: Verify the Restore from Backup section renders correctly
 * with validation preview, entity summary, and conflict resolution controls,
 * and that the preview and the result name every conflict, skipped and failed item.
 * Uses route interception to mock API responses for the upload, validation and restore;
 * the schedule mock carries every field the real schedule read answers.
 * The page sends the file once to POST /api/backup/uploads; the mock answers an upload ID and
 * every validate and restore request names that ID and carries no file (BACKUP-5).
 * Two backups are mocked: a five-part one, and the nine-part one the wireframes draw.
 *
 * Pass Criteria - Upload Zone (U1-U2):
 * 1. Upload zone visible with drag & drop instructions
 * 2. ".zip archives only" hint text
 *
 * Pass Criteria - Validation Preview (V1-V8):
 * 3. Metadata displays file name, version, format, created date, secrets mode
 * 4. Entity summary table with the column headers Type, Total, OK, Conflicts, Fixable, Errors
 * 5. Entity rows with checkboxes and counts, in the order of the part list, Functions among them
 * 6. Auto-repair toggle visible when fixable entities exist
 * 7. Conflict resolution radio buttons visible when conflicts exist
 * 8. Clear file button resets to upload zone and drops the kept upload
 *
 * Pass Criteria - Rows that open (V9-V12):
 * 14. The nine Type names start at one x, 24px into the Type cell; a toggle only on the parts with
 *     entries and no button on the other rows; every part row is 36px high and has seven cells
 * 15. A part with a fatal entry starts open and the parts with conflicts only start closed;
 *     aria-expanded, the label and the chevron say so; the detail row is the next row
 * 16. The entry list: the fatal entry first, then the conflicts; an icon, a name and a reason per
 *     line, reasons word for word; the fatal line reads "Cannot be restored. <reason>" and a
 *     conflict line the reason alone (BACKUP-9); an entry on one text line is 28px; names and
 *     reasons each in one column; a 168px box that scrolls, filled by six 28px lines; a long
 *     reason wraps under its own start and a long name never widens the box
 * 17. The chevron, the name and Enter open and close a row; the label reads "Expand <text>" or
 *     "Collapse <text>"; the keyboard reaches the scroll box
 *
 * Pass Criteria - Preview re-reads (V13-V19):
 * 18. Unticking a part reads the preview again by the kept upload's ID, with no second upload;
 *     the table stays and Restore is disabled until the answer lands, then the table shows it
 * 19. A re-read that fails shows the server's reason under the table; the table stays and Restore
 *     is disabled
 * 20. A row closed by hand stays closed through a re-read that leaves its fatal entry; a re-read
 *     that gives a part its first fatal entry opens it
 * 21. Unticking the last ticked part sends no validate request and keeps the last preview; ticking
 *     it back sends none either; ticking a different part reads
 * 22. The Conflict Resolution choice stays once shown, also when the next preview counts no
 *     conflict; it ends with the file
 * 23. Of two files picked one after the other, the preview and the restore belong to the last one,
 *     also when the first file's answer lands last; the first file's kept upload is dropped
 * 33. When a restore ends the preview is read again with the ticked parts and the choices on
 *     screen; the table stays and Restore is disabled until the answer lands, then the table shows
 *     the items just restored as conflicts; the file was sent once
 *
 * Pass Criteria - Restore Action (R1-R6):
 * 9. Restore button shows entity count
 * 10. Restore button disabled when no entities selected
 * 11. Restore result shows "<part>: N imported, N skipped", and ", N failed" only when above 0
 *     (BACKUP-9): one block per part in the order of the part list, 16px lines, all texts
 *     starting at one x
 * 24. Auto-repair adds the fixable entities to the count
 * 25. A result line with a fatal entry starts open and lists it first as "Not restored. <reason>",
 *     then the skipped entries with the reason alone (BACKUP-9); the lines with skipped entries
 *     only start closed; a line without entries has no toggle; a toggle is described by the whole
 *     line text
 * 26. Every preview row is closed after the restore
 *
 * Pass Criteria - Overwrite confirmation (O1-O6):
 * 27. With Overwrite picked and a conflict in a ticked part, Restore opens the confirmation and
 *     sends nothing
 * 28. "Overwrite" in the confirmation closes it and sends one restore with the overwrite choice
 * 29. "Cancel" closes it, sends nothing and leaves the preview, the ticked parts and the choice
 * 30. No confirmation for Skip, for Rename, or for Overwrite when no ticked part has a conflict
 * 31. Escape and a click outside do not close the confirmation
 * 34. After a restore the confirmation follows the new preview: a second Restore asks about the
 *     entities the first one wrote
 *
 * Pass Criteria - Other theme (T1):
 * 32. In the other theme (flipped from the sidebar) the preview rows, the entry lists and the
 *     result lines hold
 *
 * Pass Criteria - Periodic Backup first read (S1-S2):
 * 12. The mocked schedule has exactly the fields the real GET /api/backup/schedule answers, and
 *     the Periodic Backup section draws it: switch off, Cancel and Save disabled
 * 13. A first read answered with 500 shows the API's reason and "Try Again" in the Periodic Backup
 *     section, with no switch and no Cancel or Save; an uploaded archive still gets its preview;
 *     Try Again loads the schedule
 */

import { test, expect, type Locator, type Page, type Route } from '../../helpers/playwright-fixtures'
import {
  apiPathMatcher,
  countApiFetches,
  delayApiRoute,
  failApiRoute,
  type ApiUrlMatcher,
} from '../../helpers/api-route'
import { BACKEND_URL } from '../../helpers/config'
import { toggleTheme } from '../../helpers/theme'

async function waitForSettingsPageLoad(page: Page) {
  await page.waitForSelector('[data-testid="settings-page"]', { state: 'visible' })
  await page.waitForSelector('[data-testid="settings-page"][aria-busy="false"]', {
    state: 'attached',
  })
}

type EntryStatus = 'fatal' | 'conflict' | 'skipped'

interface Entry {
  name: string
  status: EntryStatus
  reason: string
}

interface PreviewPart {
  total: number
  ok: number
  conflicts: number
  fixable: number
  fatal: number
  items: Entry[]
  testdata_files?: number
}

interface ResultPart {
  imported: number
  skipped: number
  fatal: number
  items: Entry[]
}

interface ValidateAnswer {
  metadata: Record<string, string>
  entity_summary: Record<string, PreviewPart>
}

type RestoreAnswer = Record<string, ResultPart>

// Mock validation response with conflicts and fixable entities
const MOCK_VALIDATION_RESPONSE: ValidateAnswer = {
  metadata: {
    wave_version: '0.1.0',
    created_at: '2026-03-01T14:30:00Z',
    format: 'yaml',
    schema_version: '1',
    secrets: 'mask',
  },
  entity_summary: {
    tests: { total: 10, ok: 7, conflicts: 2, fixable: 1, fatal: 0, items: [] },
    environments: { total: 3, ok: 3, conflicts: 0, fixable: 0, fatal: 0, items: [] },
    profiles: { total: 5, ok: 3, conflicts: 1, fixable: 0, fatal: 1, items: [] },
    suites: { total: 2, ok: 2, conflicts: 0, fixable: 0, fatal: 0, items: [] },
    regressions: { total: 1, ok: 1, conflicts: 0, fixable: 0, fatal: 0, items: [] },
  },
}

const MOCK_RESTORE_RESPONSE: RestoreAnswer = {
  tests: { imported: 8, skipped: 2, fatal: 0, items: [] },
  environments: { imported: 3, skipped: 0, fatal: 0, items: [] },
  profiles: { imported: 3, skipped: 1, fatal: 1, items: [] },
  suites: { imported: 2, skipped: 0, fatal: 0, items: [] },
  regressions: { imported: 1, skipped: 0, fatal: 0, items: [] },
}

/** The part list in display order (BACKUP-7). */
const PART_ORDER = [
  'tests',
  'environments',
  'profiles',
  'suites',
  'regressions',
  'functions',
  'system_variables',
  'ssh_hosts',
  'certificates',
] as const

type PartId = (typeof PART_ORDER)[number]

/** The part names as drawn. */
const PART_NAMES: Record<PartId, string> = {
  tests: 'Tests',
  environments: 'Environments',
  profiles: 'Profiles',
  suites: 'Suites',
  regressions: 'Regressions',
  functions: 'Functions',
  system_variables: 'System Variables',
  ssh_hosts: 'SSH Hosts',
  certificates: 'Additional Certificates',
}

/** The text a toggle's label carries: the accessible name of the row's checkbox. */
const PART_LABEL_TEXT: Record<PartId, string> = {
  tests: 'tests',
  environments: 'environments',
  profiles: 'profiles',
  suites: 'suites',
  regressions: 'regressions',
  functions: 'functions',
  system_variables: 'System Variables',
  ssh_hosts: 'SSH Hosts',
  certificates: 'Additional Certificates',
}

const ALREADY_HERE = 'Already in this WAVE'
const NAME_IN_USE = 'Name already in use'
const MISSING_FUNCTION_IN_PREVIEW =
  'Uses Function "Create invoice", which is not in the backup or in this WAVE'
const MISSING_FUNCTION_IN_RESULT = 'Uses Function "Create invoice", which is not in this WAVE'

type Stage = 'preview' | 'result'

/** BACKUP-9: the outcome a fatal line states before its reason. */
const FATAL_OUTCOME: Record<Stage, string> = {
  preview: 'Cannot be restored',
  result: 'Not restored',
}

const TEST_ENTRIES = [
  ['Login smoke', ALREADY_HERE],
  ['Checkout flow', ALREADY_HERE],
  ['Order export', NAME_IN_USE],
  ['Cart totals', ALREADY_HERE],
  ['Refund flow', ALREADY_HERE],
  ['Inventory sync', ALREADY_HERE],
  ['Search filters', NAME_IN_USE],
  ['User signup', ALREADY_HERE],
  ['Password reset', ALREADY_HERE],
] as const
const PROFILE_ENTRIES = [['Staging database', ALREADY_HERE]] as const
const FUNCTION_ENTRIES = [
  ['Build invoice payload', ALREADY_HERE],
  ['Format currency', NAME_IN_USE],
] as const

function entries(status: EntryStatus, list: readonly (readonly [string, string])[]): Entry[] {
  return list.map(([name, reason]) => ({ name, status, reason }))
}

function fatalTest(reason: string): Entry {
  return { name: 'Billing sync', status: 'fatal', reason }
}

function previewPart(
  total: number,
  ok: number,
  conflicts = 0,
  fixable = 0,
  fatal = 0,
  items: Entry[] = [],
): PreviewPart {
  return { total, ok, conflicts, fixable, fatal, items }
}

function resultPart(imported: number, skipped = 0, fatal = 0, items: Entry[] = []): ResultPart {
  return { imported, skipped, fatal, items }
}

const DEFAULT_FILE = 'wave-backup-2026-03-01.zip'
const WIREFRAME_FILE = 'wave-backup-2026-10-10.zip'
const WIREFRAME_METADATA = {
  wave_version: '1.0.0',
  created_at: '2026-10-10T07:06:39Z',
  format: 'yaml',
  schema_version: '1.0',
  secrets: 'mask',
}

/** The nine-part preview the wireframes draw; `changed` replaces single parts. */
function wireframePreview(changed: Partial<Record<PartId, PreviewPart>> = {}): ValidateAnswer {
  return {
    metadata: WIREFRAME_METADATA,
    entity_summary: {
      tests: {
        ...previewPart(18, 8, 9, 0, 1, [
          fatalTest(MISSING_FUNCTION_IN_PREVIEW),
          ...entries('conflict', TEST_ENTRIES),
        ]),
        testdata_files: 14,
      },
      environments: previewPart(3, 3),
      profiles: previewPart(5, 4, 1, 0, 0, entries('conflict', PROFILE_ENTRIES)),
      suites: previewPart(4, 4),
      regressions: previewPart(2, 2),
      functions: previewPart(6, 4, 2, 0, 0, entries('conflict', FUNCTION_ENTRIES)),
      system_variables: previewPart(1, 1),
      ssh_hosts: previewPart(2, 2),
      certificates: previewPart(1, 1),
      ...changed,
    },
  }
}

const WIREFRAME_PREVIEW = wireframePreview()

const WIREFRAME_RESULT: RestoreAnswer = {
  tests: resultPart(8, 9, 1, [
    fatalTest(MISSING_FUNCTION_IN_RESULT),
    ...entries('skipped', TEST_ENTRIES),
  ]),
  environments: resultPart(3),
  profiles: resultPart(4, 1, 0, entries('skipped', PROFILE_ENTRIES)),
  suites: resultPart(4),
  regressions: resultPart(2),
  functions: resultPart(4, 2, 0, entries('skipped', FUNCTION_ENTRIES)),
  system_variables: resultPart(1),
  ssh_hosts: resultPart(2),
  certificates: resultPart(1),
}

/** The column headers of the preview table; the first column holds the checkboxes (BACKUP-9). */
const PREVIEW_HEADERS = ['', 'Type', 'Total', 'OK', 'Conflicts', 'Fixable', 'Errors']

/** Each preview row of the wireframes: Type, Total, OK, Conflicts, Fixable, Errors. */
const WIREFRAME_ROWS = [
  ['Tests', '18', '8', '9', '0', '1'],
  ['Environments', '3', '3', '0', '0', '0'],
  ['Profiles', '5', '4', '1', '0', '0'],
  ['Suites', '4', '4', '0', '0', '0'],
  ['Regressions', '2', '2', '0', '0', '0'],
  ['Functions', '6', '4', '2', '0', '0'],
  ['System Variables', '1', '1', '0', '0', '0'],
  ['SSH Hosts', '2', '2', '0', '0', '0'],
  ['Additional Certificates', '1', '1', '0', '0', '0'],
]

const WIREFRAME_RESULT_LINES = [
  'Tests: 8 imported, 9 skipped, 1 failed',
  'Environments: 3 imported, 0 skipped',
  'Profiles: 4 imported, 1 skipped',
  'Suites: 4 imported, 0 skipped',
  'Regressions: 2 imported, 0 skipped',
  'Functions: 4 imported, 2 skipped',
  'System Variables: 1 imported, 0 skipped',
  'SSH Hosts: 2 imported, 0 skipped',
  'Additional Certificates: 1 imported, 0 skipped',
]

const WIREFRAME_RESTORE_BUTTON = 'Restore 41 entities'
const PARTS_WITH_ENTRIES: readonly string[] = ['tests', 'profiles', 'functions']
const PARTS_WITHOUT_ENTRIES = PART_ORDER.filter((type) => !PARTS_WITH_ENTRIES.includes(type))

const LONG_REASON =
  'Uses Function "Build invoice payload for every open order of the billing period" 2.4.0, which is not in the backup or in this WAVE'
const LONG_NAME = 'NightlyCheckoutRegressionAcrossEveryRegionAndCurrency'.repeat(3).slice(0, 150)

/** The wireframe preview with a long reason and a 150 character name in the Tests list. */
const LONG_ENTRIES_PREVIEW = wireframePreview({
  tests: previewPart(20, 8, 10, 0, 2, [
    fatalTest(MISSING_FUNCTION_IN_PREVIEW),
    { name: 'Invoice run', status: 'fatal', reason: LONG_REASON },
    { name: LONG_NAME, status: 'conflict', reason: ALREADY_HERE },
    ...entries('conflict', TEST_ENTRIES),
  ]),
})

const ENVIRONMENT_ENTRIES = [
  ['Staging', ALREADY_HERE],
  ['QA cluster', ALREADY_HERE],
  ['Production mirror', ALREADY_HERE],
] as const

/** The wireframe preview once its three environments are in this WAVE. */
const ENVIRONMENTS_HERE_PREVIEW = wireframePreview({
  environments: previewPart(3, 0, 3, 0, 0, entries('conflict', ENVIRONMENT_ENTRIES)),
})

/** The wireframe preview with every item restorable as is. */
const NO_CONFLICT_PREVIEW = wireframePreview({
  tests: previewPart(18, 18),
  profiles: previewPart(5, 5),
  functions: previewPart(6, 6),
})

const TWO_PART_PREVIEW: ValidateAnswer = {
  metadata: MOCK_VALIDATION_RESPONSE.metadata,
  entity_summary: { tests: previewPart(5, 5), environments: previewPart(2, 2) },
}

const OVERWRITE_RESULT: RestoreAnswer = {
  tests: resultPart(17, 0, 1, [fatalTest(MISSING_FUNCTION_IN_RESULT)]),
  environments: resultPart(3),
  profiles: resultPart(5),
  suites: resultPart(4),
  regressions: resultPart(2),
  functions: resultPart(6),
  system_variables: resultPart(1),
  ssh_hosts: resultPart(2),
  certificates: resultPart(1),
}

const OVERWRITE_TITLE = 'Overwrite conflicting entities?'
const OVERWRITE_BODY = "The ones in this WAVE get the backup's content. This cannot be undone."
const REREAD_REFUSED = 'Invalid backup archive: corrupt manifest.json'

const VALIDATE_ROUTE = apiPathMatcher('/api/backup/validate')
const RESTORE_ROUTE = apiPathMatcher('/api/backup/restore')

/** Longer than the 300 ms the page waits after a change before it reads the preview. */
const DEBOUNCE_WINDOW_MS = 1000
const HELD_MS = 2500

/** The schedule of a fresh install, every field the real read answers. */
const MOCK_SCHEDULE = {
  enabled: false,
  cron: '',
  entity_types: [
    'certificates',
    'environments',
    'functions',
    'profiles',
    'regressions',
    'ssh_hosts',
    'suites',
    'system_variables',
    'tests',
  ],
  max_backups: 5,
  save_directory: '~/wave-backups',
  format: 'yaml',
  compression_method: 'deflate',
  compression_level: 6,
  secrets: 'mask',
  last_run: null,
  last_run_status: null,
  cron_description: '',
  next_run: null,
}

const SCHEDULE_READ_FAILED = 'The backup schedule could not be read from the config file'

/** The success envelope the backup routes answer. */
function envelopeBody(data: unknown): string {
  return JSON.stringify({
    success: true,
    data,
    meta: { request_id: 'v-backup-02', timestamp: '2026-03-01T14:30:00Z' },
  })
}

/** The fields of one multipart form the page sent to a backup route. */
interface BackupForm {
  /** The name of the file part; only the upload request carries one (BACKUP-5). */
  fileName: string | null
  /** The kept upload a preview or a restore names instead of the file. */
  uploadId: string | null
  entityTypes: string | null
  conflictResolution: string | null
  autoRepair: string | null
}

function readForm(body: string | null): BackupForm {
  const text = body ?? ''
  const field = (name: string) =>
    new RegExp(`name="${name}"\\r?\\n\\r?\\n([^\\r\\n]*)`).exec(text)?.[1] ?? null
  return {
    fileName: /filename="([^"]*)"/.exec(text)?.[1] ?? null,
    uploadId: field('upload_id'),
    entityTypes: field('entity_types'),
    conflictResolution: field('conflict_resolution'),
    autoRepair: field('auto_repair'),
  }
}

/** The forms the page sends to one backup route, read as each leaves the page. */
function recordForms(page: Page, matcher: ApiUrlMatcher): BackupForm[] {
  const sent: BackupForm[] = []
  page.on('request', (request) => {
    if (request.method() !== 'POST') return
    if (matcher(new URL(request.url()))) sent.push(readForm(request.postData()))
  })
  return sent
}

/** A fixed preview, or one picked by the name of the file the request's upload ID was kept for. */
type PreviewSource = ValidateAnswer | ((fileName: string | null) => ValidateAnswer)

/** The mocked backup: its answers can be swapped between two requests. */
interface BackupMock {
  preview: PreviewSource
  result: RestoreAnswer
  /** The file name kept under each upload ID the mock answered, oldest first. */
  kept: Map<string, string | null>
  /** The upload IDs the page dropped, oldest first. */
  dropped: string[]
  /** The validate forms answered so far, oldest first. */
  previewsAnswered: BackupForm[]
}

/** The name of the file a preview or a restore belongs to: the one kept under its upload ID. */
function fileOf(mock: BackupMock, form: BackupForm): string | null {
  return form.uploadId === null ? null : (mock.kept.get(form.uploadId) ?? null)
}

/** The upload ID the mock answered for a file; the newest one when the file was sent again. */
function uploadIdOf(mock: BackupMock, fileName: string): string {
  const kept = [...mock.kept].findLast(([, name]) => name === fileName)
  if (!kept) throw new Error(`the page sent no upload of ${fileName}`)
  return kept[0]
}

async function setupMockRoutes(
  page: Page,
  answers: { preview?: PreviewSource; result?: RestoreAnswer } = {},
): Promise<BackupMock> {
  const mock: BackupMock = {
    preview: answers.preview ?? MOCK_VALIDATION_RESPONSE,
    result: answers.result ?? MOCK_RESTORE_RESPONSE,
    kept: new Map(),
    dropped: [],
    previewsAnswered: [],
  }

  // The upload answers an ID shaped like the real one: 32 lowercase hex characters.
  await page.route('**/api/backup/uploads', async (route: Route) => {
    if (route.request().method() !== 'POST') {
      await route.fallback()
      return
    }
    const uploadId = (mock.kept.size + 1).toString(16).padStart(32, '0')
    mock.kept.set(uploadId, readForm(route.request().postData()).fileName)
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: envelopeBody({ upload_id: uploadId }),
    })
  })

  // The drop of a kept upload, sent on Clear, on another pick and when the page is left.
  await page.route('**/api/backup/uploads/*', async (route: Route) => {
    if (route.request().method() !== 'DELETE') {
      await route.fallback()
      return
    }
    mock.dropped.push(new URL(route.request().url()).pathname.split('/').pop() ?? '')
    await route.fulfill({ status: 204 })
  })

  // Mock validation endpoint
  await page.route('**/api/backup/validate', async (route: Route) => {
    const form = readForm(route.request().postData())
    const preview = typeof mock.preview === 'function' ? mock.preview(fileOf(mock, form)) : mock.preview
    mock.previewsAnswered.push(form)
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: envelopeBody(preview),
    })
  })

  // Mock restore endpoint
  await page.route('**/api/backup/restore', async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: envelopeBody(mock.result),
    })
  })

  await mockSchedule(page)
  return mock
}

/** Mock schedule endpoint (the Backup page reads it when it opens). */
async function mockSchedule(page: Page) {
  await page.route('**/api/backup/schedule', async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: envelopeBody(MOCK_SCHEDULE),
    })
  })
}

function periodicSection(page: Page): Locator {
  return page.locator('[data-testid="periodic-backup-section"]')
}

/** Cancel or Save on the Periodic Backup heading line (SETTINGS-21). */
function periodicHeaderButton(page: Page, name: 'Cancel' | 'Save'): Locator {
  return periodicSection(page)
    .getByRole('heading', { name: 'Periodic Backup', exact: true })
    .locator('xpath=..')
    .getByRole('button', { name, exact: true })
}

async function uploadMockFile(page: Page, name = DEFAULT_FILE) {
  const fileInput = page.locator('[data-testid="upload-input"]')
  await fileInput.setInputFiles({
    name,
    mimeType: 'application/zip',
    buffer: Buffer.from('PK mock zip content'),
  })
}

/** The part rows of the preview table, without the detail rows. */
function partRows(page: Page): Locator {
  return page.locator(
    '[data-testid="entity-summary-table"] tbody > tr:not([data-testid^="entity-row-items-"])',
  )
}

function restoreButton(page: Page): Locator {
  return page.getByTestId('restore-button')
}

function overwriteDialog(page: Page): Locator {
  return page.getByTestId('restore-overwrite-dialog')
}

function previewList(page: Page, type: PartId): Locator {
  return page.getByTestId(`entity-row-items-${type}`).getByTestId('restore-item-list')
}

function resultList(page: Page, type: PartId): Locator {
  return page.getByTestId(`restore-result-items-${type}`).getByTestId('restore-item-list')
}

/** The Backup page with the nine-part backup of the wireframes uploaded and its preview drawn. */
async function openWireframePreview(page: Page): Promise<BackupMock> {
  const backup = await setupMockRoutes(page, {
    preview: WIREFRAME_PREVIEW,
    result: WIREFRAME_RESULT,
  })
  await page.goto('/settings/backup')
  await waitForSettingsPageLoad(page)
  await uploadMockFile(page, WIREFRAME_FILE)
  await expect(partRows(page)).toHaveCount(PART_ORDER.length)
  return backup
}

/** Pick Overwrite and wait for the preview read under it. */
async function pickOverwrite(page: Page) {
  const rereads = recordForms(page, VALIDATE_ROUTE)
  await page.getByTestId('cr-overwrite').click()
  await expect.poll(() => rereads.at(-1)?.conflictResolution).toBe('overwrite')
  await expect(restoreButton(page)).toBeEnabled()
}

async function boxOf(locator: Locator) {
  await expect(locator).toBeVisible()
  const box = await locator.boundingBox()
  if (!box) throw new Error('element has no bounding box')
  return box
}

function spread(values: number[]): number {
  return Math.max(...values) - Math.min(...values)
}

/** Where the first drawn text inside each element starts (page x). */
function firstTextX(nodes: Element[]): number[] {
  return nodes.map((node) => {
    const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT)
    let text = walker.nextNode()
    while (text && !text.textContent?.trim()) text = walker.nextNode()
    if (!text) throw new Error('the element holds no text')
    const range = document.createRange()
    range.selectNodeContents(text)
    return range.getBoundingClientRect().x
  })
}

async function expectRowNumbers(page: Page, type: PartId, numbers: string[]) {
  const cells = page.getByTestId(`entity-row-${type}`).locator(':scope > td:nth-child(n+3)')
  await expect(cells, `${type}: Total, OK, Conflicts, Fixable, Errors`).toHaveText(numbers)
}

/** The part rows as drawn: the Type name, the five counts, the cells, the heights and the toggle. */
async function readPartRows(page: Page) {
  return partRows(page).evaluateAll((rows) =>
    rows.map((row) => {
      const cells = Array.from(row.children) as HTMLElement[]
      const typeCell = cells[1]
      const button = typeCell.querySelector('button')
      return {
        type: (row.getAttribute('data-testid') ?? '').replace('entity-row-', ''),
        name: typeCell.innerText.trim(),
        numbers: cells.slice(2).map((cell) => cell.innerText.trim()),
        cells: cells.length,
        inside: typeCell.clientHeight,
        height: row.getBoundingClientRect().height,
        buttons: typeCell.querySelectorAll('button').length,
        toggle: button?.getAttribute('data-testid') ?? null,
        toggleText: button?.innerText.trim() ?? null,
      }
    }),
  )
}

/** BACKUP-2: names in one column, a toggle only on the parts with entries, 36px rows of seven cells. */
async function expectPartRowLayout(page: Page) {
  const rows = await readPartRows(page)
  expect(rows.map((row) => row.type)).toEqual([...PART_ORDER])
  expect(rows.map((row) => row.name)).toEqual(PART_ORDER.map((type) => PART_NAMES[type]))

  const typeCells = partRows(page).locator(':scope > td:nth-child(2)')
  const nameXs = await typeCells.evaluateAll(firstTextX)
  const cellLefts = await typeCells.evaluateAll((cells) =>
    cells.map(
      (cell) =>
        cell.getBoundingClientRect().x + Number.parseFloat(getComputedStyle(cell).paddingLeft),
    ),
  )
  expect(spread(nameXs), 'the nine Type names start at the same x').toBeLessThanOrEqual(0.5)

  for (const [index, row] of rows.entries()) {
    const hasEntries = PARTS_WITH_ENTRIES.includes(row.type)
    expect(nameXs[index] - cellLefts[index], `${row.type}: name 24px into the Type cell`).toBeCloseTo(24, 0)
    expect(row.buttons, `${row.type}: buttons in the Type cell`).toBe(hasEntries ? 1 : 0)
    expect(row.toggle, `${row.type}: toggle`).toBe(hasEntries ? `entity-row-toggle-${row.type}` : null)
    expect(row.toggleText, `${row.type}: the toggle holds the name`).toBe(hasEntries ? row.name : null)
    expect(row.cells, `${row.type}: cells`).toBe(7)
    expect(row.inside, `${row.type}: row height inside its line`).toBe(36)
    expect(row.height - row.inside, `${row.type}: the row's line`).toBeGreaterThanOrEqual(0)
    expect(row.height - row.inside, `${row.type}: the row's line`).toBeLessThanOrEqual(1)
  }
  for (const type of PARTS_WITHOUT_ENTRIES) {
    await expect(page.getByTestId(`entity-row-toggle-${type}`)).toHaveCount(0)
    await expect(page.getByTestId(`entity-row-${type}`).getByRole('button')).toHaveCount(0)
  }
}

/** Open and closed toggles of the preview rows or the result lines, with label, chevron and list. */
async function expectOpenParts(
  page: Page,
  ids: { toggle: string; items: string },
  open: readonly PartId[],
) {
  for (const type of ['tests', 'profiles', 'functions'] as const) {
    const isOpen = open.includes(type)
    const toggle = page.getByTestId(`${ids.toggle}-${type}`)
    await expect(toggle, `${type} toggle`).toHaveAttribute('aria-expanded', String(isOpen))
    await expect(toggle).toHaveAttribute(
      'aria-label',
      `${isOpen ? 'Collapse' : 'Expand'} ${PART_LABEL_TEXT[type]}`,
    )
    await expect(toggle.locator('svg')).toHaveClass(isOpen ? /chevron-down/ : /chevron-right/)
    await expect(page.getByTestId(`${ids.items}-${type}`), `${type} list`).toHaveCount(isOpen ? 1 : 0)
  }
}

async function expectPreviewOpen(page: Page, open: readonly PartId[]) {
  await expectOpenParts(page, { toggle: 'entity-row-toggle', items: 'entity-row-items' }, open)
}

async function expectResultOpen(page: Page, open: readonly PartId[]) {
  await expectOpenParts(page, { toggle: 'restore-result-toggle', items: 'restore-result-items' }, open)
}

/** An entry list as drawn: its scroll box and each line's icon, name and reason boxes. */
async function readEntryList(list: Locator) {
  return list.evaluate((box) => {
    const at = box.getBoundingClientRect()
    const lines = Array.from(box.querySelectorAll(':scope > [data-testid="restore-item"]')).map(
      (line) => {
        const icon = line.querySelector(':scope > svg')
        const [name, reason] = Array.from(line.querySelectorAll(':scope > span'))
        if (!icon || !name || !reason) throw new Error('an entry line needs an icon, a name and a reason')
        const lineBox = line.getBoundingClientRect()
        const iconBox = icon.getBoundingClientRect()
        const nameBox = name.getBoundingClientRect()
        const reasonBox = reason.getBoundingClientRect()
        return {
          status: line.getAttribute('data-status'),
          icons: line.querySelectorAll('svg').length,
          iconStatus: icon.getAttribute('data-status'),
          iconSize: `${iconBox.width}x${iconBox.height}`,
          iconShape: Array.from(icon.classList)
            .filter((cls) => cls.startsWith('lucide-'))
            .join(' '),
          iconColor: getComputedStyle(icon).color,
          reasonColor: getComputedStyle(reason).color,
          height: lineBox.height,
          top: lineBox.top,
          bottom: lineBox.bottom,
          nameLeft: nameBox.left,
          nameRight: nameBox.right,
          nameHeight: nameBox.height,
          reasonLeft: reasonBox.left,
          reasonRight: reasonBox.right,
          reasonHeight: reasonBox.height,
        }
      },
    )
    return {
      clientHeight: box.clientHeight,
      scrollHeight: box.scrollHeight,
      clientWidth: box.clientWidth,
      scrollWidth: box.scrollWidth,
      top: at.top,
      bottom: at.bottom,
      left: at.left,
      right: at.right,
      lines,
    }
  })
}

/** BACKUP-9: a fatal line states its outcome before the reason; every other line shows the reason alone. */
function shownReason(entry: Entry, stage: Stage): string {
  return entry.status === 'fatal' ? `${FATAL_OUTCOME[stage]}. ${entry.reason}` : entry.reason
}

/** The lines of an entry list in order: one 14px icon of the line's status, the name, the reason. */
async function expectEntries(list: Locator, stage: Stage, expected: readonly Entry[]) {
  const lines = list.getByTestId('restore-item')
  await expect(lines).toHaveCount(expected.length)
  await expect(lines.locator(':scope > span:nth-of-type(1)')).toHaveText(
    expected.map((entry) => entry.name),
  )
  await expect(lines.locator(':scope > span:nth-of-type(2)')).toHaveText(
    expected.map((entry) => shownReason(entry, stage)),
  )
  const drawn = await readEntryList(list)
  expect(drawn.lines.map((line) => line.status)).toEqual(expected.map((entry) => entry.status))
  for (const [index, line] of drawn.lines.entries()) {
    expect(line.icons, `line ${index + 1}: icons`).toBe(1)
    expect(line.iconStatus, `line ${index + 1}: icon status`).toBe(line.status)
    expect(line.iconSize, `line ${index + 1}: icon size`).toBe('14x14')
  }
}

/** BACKUP-3: a name is one text line; an entry on one text line is 28px; a wrapped reason adds its lines. */
function expectLineHeights(drawn: Awaited<ReturnType<typeof readEntryList>>) {
  for (const [index, line] of drawn.lines.entries()) {
    expect(line.nameHeight, `line ${index + 1}: the name is on one line`).toBeCloseTo(16, 0)
    expect(line.height, `line ${index + 1}: 6px above and under its text`).toBeCloseTo(line.reasonHeight + 12, 0)
  }
  // Every entry after the fatal one has a short reason.
  for (const [index, line] of drawn.lines.slice(1).entries()) {
    expect(line.height, `line ${index + 2}: height`).toBeCloseTo(28, 0)
  }
}

/** BACKUP-3: six lines high inside its border, then the list scrolls. */
async function expectScrollBox(list: Locator) {
  const drawn = await readEntryList(list)
  expect(drawn.clientHeight, 'the box is 168px high inside its border').toBe(168)
  expect(drawn.scrollHeight, 'the content is taller than the box').toBeGreaterThan(168)
  const overflowY = await list.evaluate((box) => getComputedStyle(box).overflowY)
  expect(['auto', 'scroll']).toContain(overflowY)
}

/** BACKUP-3: the list's fatal and conflict icons are the table header's, shape and color. */
async function expectHeaderIcons(page: Page, list: Locator) {
  const header = await page.getByTestId('entity-summary-table').evaluate((table) => {
    const read = (status: string) => {
      const icon = table.querySelector(`thead svg[data-status="${status}"]`)
      if (!icon) throw new Error(`no ${status} icon in the table header`)
      return {
        shape: Array.from(icon.classList)
          .filter((cls) => cls.startsWith('lucide-'))
          .join(' '),
        color: getComputedStyle(icon).color,
      }
    }
    return { fatal: read('fatal'), conflict: read('conflict') }
  })
  expect(header.fatal.color, 'fatal and conflict have their own color').not.toBe(header.conflict.color)
  const drawn = await readEntryList(list)
  for (const [index, line] of drawn.lines.entries()) {
    const icon = line.status === 'fatal' ? header.fatal : header.conflict
    expect(line.iconShape, `line ${index + 1}: icon shape`).toBe(icon.shape)
    expect(line.iconColor, `line ${index + 1}: icon color`).toBe(icon.color)
  }
}

/** BACKUP-4, BACKUP-7: one block per part in the order of the part list, 16px lines, texts in one column. */
async function expectWireframeResultLines(page: Page) {
  const result = page.getByTestId('restore-result')
  const lines = result.locator('[data-testid^="restore-result-line-"]')
  await expect(result.getByRole('heading')).toHaveText('Restore Complete')
  await expect(lines).toHaveText(WIREFRAME_RESULT_LINES, { useInnerText: true })

  const blocks = await result.locator('[data-testid^="restore-result-part-"]').evaluateAll((parts) =>
    parts.map((part) => {
      const id = part.getAttribute('data-testid') ?? ''
      const type = id.replace('restore-result-part-', '')
      return {
        id,
        lines: part.querySelectorAll(`[data-testid="restore-result-line-${type}"]`).length,
      }
    }),
  )
  expect(blocks).toEqual(PART_ORDER.map((type) => ({ id: `restore-result-part-${type}`, lines: 1 })))

  const heights = await lines.evaluateAll((nodes) =>
    nodes.map((node) => node.getBoundingClientRect().height),
  )
  for (const [index, height] of heights.entries()) {
    expect(height, `${PART_ORDER[index]}: line height`).toBeCloseTo(16, 0)
  }
  expect(spread(await lines.evaluateAll(firstTextX)), 'all line texts start at the same x').toBeLessThanOrEqual(0.5)
}

/** No restore left the page: no request, no progress, no result, the button still offers it. */
async function expectNothingRestored(page: Page, restores: () => number, button: string) {
  await expect(page.getByTestId('restore-result')).toHaveCount(0)
  await expect(page.getByTestId('restore-progress')).toHaveCount(0)
  await expect(restoreButton(page)).toHaveText(button)
  expect(restores(), 'restore requests').toBe(0)
}

test.describe('V-BACKUP-02: Upload Zone', () => {
  test('V-BACKUP-02-U1: upload zone visible with instructions', async ({ page }) => {
    await setupMockRoutes(page)
    await page.goto('/settings/backup')
    await waitForSettingsPageLoad(page)

    const uploadZone = page.locator('[data-testid="upload-zone"]')
    await expect(uploadZone, 'Upload zone should be visible').toBeVisible()
    await expect(uploadZone).toContainText('Click or drag & drop a backup file')

    // Should have dashed border
    const hasDashed = await uploadZone.evaluate((el) => el.classList.contains('border-dashed'))
    expect(hasDashed, 'Upload zone should have dashed border').toBeTruthy()
  })

  test('V-BACKUP-02-U2: zip archives only hint', async ({ page }) => {
    await setupMockRoutes(page)
    await page.goto('/settings/backup')
    await waitForSettingsPageLoad(page)

    const uploadZone = page.locator('[data-testid="upload-zone"]')
    await expect(uploadZone).toContainText('.zip archives only')
  })
})

test.describe('V-BACKUP-02: Validation Preview', () => {
  test('V-BACKUP-02-V1: metadata displays after file upload', async ({ page }) => {
    await setupMockRoutes(page)
    await page.goto('/settings/backup')
    await waitForSettingsPageLoad(page)

    await uploadMockFile(page)

    // Wait for validation preview
    const preview = page.locator('[data-testid="validation-preview"]')
    await expect(preview, 'Validation preview should be visible').toBeVisible()

    // Check metadata fields
    await expect(preview).toContainText('wave-backup-2026-03-01.zip')
    await expect(preview).toContainText('0.1.0')
    // Format is displayed with CSS text-transform: uppercase, raw text is lowercase
    await expect(preview).toContainText('yaml')
    await expect(preview).toContainText('2026-03-01')
    // Restore preview reports the recorded secrets mode (metadata.secrets='mask'
    // -> "Masked"), not a credentials flag.
    await expect(preview).toContainText('Secrets')
    await expect(preview).toContainText('Masked')
    await expect(preview, 'no legacy credentials line').not.toContainText('Excluded')
  })

  test('V-BACKUP-02-V2: entity summary table headers', async ({ page }) => {
    await setupMockRoutes(page)
    await page.goto('/settings/backup')
    await waitForSettingsPageLoad(page)

    await uploadMockFile(page)

    const table = page.locator('[data-testid="entity-summary-table"]')
    await expect(table, 'Entity summary table should be visible').toBeVisible()

    await expect(table.locator('thead th'), 'the last count column is Errors (BACKUP-9)').toHaveText(
      PREVIEW_HEADERS,
    )
  })

  test('V-BACKUP-02-V3: entity rows with correct counts, in the order of the part list (BACKUP-7)', async ({
    page,
  }) => {
    const backup = await setupMockRoutes(page)
    await page.goto('/settings/backup')
    await waitForSettingsPageLoad(page)

    await test.step('five-part backup: a row and a checkbox for each part', async () => {
      await uploadMockFile(page)

      // Check tests row
      const testsRow = page.locator('[data-testid="entity-row-tests"]')
      await expect(testsRow, 'Tests row should be visible').toBeVisible()
      await expect(testsRow).toContainText('tests')

      // Check environments row
      const envsRow = page.locator('[data-testid="entity-row-environments"]')
      await expect(envsRow, 'Environments row should be visible').toBeVisible()

      // Check profiles row (has fatal)
      const profilesRow = page.locator('[data-testid="entity-row-profiles"]')
      await expect(profilesRow, 'Profiles row should be visible').toBeVisible()

      // Check suites row
      const suitesRow = page.locator('[data-testid="entity-row-suites"]')
      await expect(suitesRow, 'Suites row should be visible').toBeVisible()

      // Check regressions row
      const regsRow = page.locator('[data-testid="entity-row-regressions"]')
      await expect(regsRow, 'Regressions row should be visible').toBeVisible()

      // All rows should have checkboxes
      for (const type of ['tests', 'environments', 'profiles', 'suites', 'regressions']) {
        const checkbox = page.locator(`[data-testid="restore-checkbox-${type}"]`)
        await expect(checkbox, `${type} restore checkbox should be visible`).toBeVisible()
      }
    })

    await test.step('nine-part backup: the rows follow the part list, Functions among them', async () => {
      backup.preview = WIREFRAME_PREVIEW
      await page.getByTestId('clear-file-button').click()
      await uploadMockFile(page, WIREFRAME_FILE)
      await expect(partRows(page)).toHaveCount(PART_ORDER.length)

      const rows = await readPartRows(page)
      expect(rows.map((row) => row.type)).toEqual([...PART_ORDER])
      expect(rows.map((row) => [row.name, ...row.numbers])).toEqual(WIREFRAME_ROWS)
      expect(rows.findIndex((row) => row.type === 'functions'), 'Functions is the sixth row').toBe(5)
      for (const type of PART_ORDER) {
        await expect(page.getByTestId(`restore-checkbox-${type}`), `${type} is ticked`).toBeChecked()
      }
      await expect(restoreButton(page)).toHaveText(WIREFRAME_RESTORE_BUTTON)
    })
  })

  test('V-BACKUP-02-V4: all entity types checked by default', async ({ page }) => {
    await setupMockRoutes(page)
    await page.goto('/settings/backup')
    await waitForSettingsPageLoad(page)

    await uploadMockFile(page)

    // All checkboxes should be checked by default
    for (const type of ['tests', 'environments', 'profiles', 'suites', 'regressions']) {
      const checkbox = page.locator(`[data-testid="restore-checkbox-${type}"]`)
      await expect(
        checkbox,
        `${type} checkbox should be checked by default`
      ).toBeChecked()
    }
  })

  test('V-BACKUP-02-V5: auto-repair toggle visible (fixable entities exist)', async ({ page }) => {
    await setupMockRoutes(page)
    await page.goto('/settings/backup')
    await waitForSettingsPageLoad(page)

    await uploadMockFile(page)

    // Auto-repair toggle should be visible since tests have fixable=1
    const autoRepairContainer = page.locator('[data-testid="auto-repair-toggle-container"]')
    await expect(
      autoRepairContainer,
      'Auto-repair toggle should be visible when fixable entities exist'
    ).toBeVisible()

    const autoRepairToggle = page.locator('[data-testid="auto-repair-toggle"]')
    await expect(autoRepairToggle).toBeVisible()
    await expect(autoRepairToggle, 'Auto-repair should be off by default').not.toBeChecked()
  })

  test('V-BACKUP-02-V6: conflict resolution radio buttons visible', async ({ page }) => {
    await setupMockRoutes(page)
    await page.goto('/settings/backup')
    await waitForSettingsPageLoad(page)

    await uploadMockFile(page)

    // Conflict resolution should be visible since tests and profiles have conflicts
    const crSection = page.locator('[data-testid="conflict-resolution"]')
    await expect(
      crSection,
      'Conflict resolution should be visible when conflicts exist'
    ).toBeVisible()

    // Three radio options
    const skipRadio = page.locator('[data-testid="cr-skip"]')
    const overwriteRadio = page.locator('[data-testid="cr-overwrite"]')
    const renameRadio = page.locator('[data-testid="cr-rename"]')

    await expect(skipRadio, 'Skip radio should be visible').toBeVisible()
    await expect(overwriteRadio, 'Overwrite radio should be visible').toBeVisible()
    await expect(renameRadio, 'Rename radio should be visible').toBeVisible()

    // Skip should be selected by default
    await expect(skipRadio, 'Skip should be selected by default').toBeChecked()
  })

  test('V-BACKUP-02-V7: clear file button resets to upload zone', async ({ page }) => {
    const backup = await setupMockRoutes(page)
    await page.goto('/settings/backup')
    await waitForSettingsPageLoad(page)

    await uploadMockFile(page)

    // Validation preview should be visible
    await expect(page.locator('[data-testid="validation-preview"]')).toBeVisible()

    // Upload zone should NOT be visible (replaced by preview)
    await expect(page.locator('[data-testid="upload-zone"]')).not.toBeVisible()

    // Click clear button
    const clearButton = page.locator('[data-testid="clear-file-button"]')
    await expect(clearButton, 'Clear button should be visible').toBeVisible()
    await clearButton.click()

    // Upload zone should be visible again
    await expect(
      page.locator('[data-testid="upload-zone"]'),
      'Upload zone should reappear after clearing'
    ).toBeVisible()

    // Validation preview should be gone
    await expect(page.locator('[data-testid="validation-preview"]')).not.toBeVisible()

    // Clear drops the upload the backend kept for the file (BACKUP-5).
    await expect
      .poll(() => backup.dropped, 'Clear drops the kept upload')
      .toEqual([uploadIdOf(backup, DEFAULT_FILE)])
  })

  test('V-BACKUP-02-V8: conflict resolution hidden when no conflicts', async ({ page }) => {
    // A backup with no conflicts and nothing fixable
    await setupMockRoutes(page, { preview: TWO_PART_PREVIEW })

    await page.goto('/settings/backup')
    await waitForSettingsPageLoad(page)

    await uploadMockFile(page)

    // Conflict resolution should NOT be visible
    await expect(
      page.locator('[data-testid="conflict-resolution"]'),
      'Conflict resolution should be hidden when no conflicts'
    ).not.toBeVisible()

    // Auto-repair should NOT be visible
    await expect(
      page.locator('[data-testid="auto-repair-toggle-container"]'),
      'Auto-repair should be hidden when no fixable entities'
    ).not.toBeVisible()
  })
})

test.describe('V-BACKUP-02: Rows that open', () => {
  test('V-BACKUP-02-V9: names in one column, a toggle only on the parts with entries, 36px rows of seven cells (BACKUP-2)', async ({
    page,
  }) => {
    await openWireframePreview(page)
    await expectPartRowLayout(page)
  })

  test('V-BACKUP-02-V10: Tests with a fatal entry starts open, Profiles and Functions start closed (BACKUP-2)', async ({
    page,
  }) => {
    await openWireframePreview(page)
    await expectPreviewOpen(page, ['tests'])

    const afterTests = await page
      .getByTestId('entity-row-tests')
      .evaluate((row) => row.nextElementSibling?.getAttribute('data-testid'))
    expect(afterTests, 'the detail row sits right under its part row').toBe('entity-row-items-tests')

    const detailCells = await page
      .getByTestId('entity-row-items-tests')
      .locator(':scope > td')
      .evaluateAll((cells) =>
        cells.map((cell) => ({
          span: (cell as HTMLTableCellElement).colSpan,
          empty: cell.childNodes.length === 0,
        })),
      )
    expect(detailCells, 'the list starts under the Type column').toEqual([
      { span: 1, empty: true },
      { span: 6, empty: false },
    ])
    await expect(previewList(page, 'tests')).toBeVisible()
  })

  test('V-BACKUP-02-V11: the entry list names the fatal entry first, each line an icon, a name and its reason (BACKUP-3, BACKUP-6, BACKUP-9)', async ({
    page,
  }) => {
    const backup = await openWireframePreview(page)
    const list = previewList(page, 'tests')

    await test.step('the fatal entry first with its outcome, then the conflicts, reasons word for word', async () => {
      await expectEntries(list, 'preview', WIREFRAME_PREVIEW.entity_summary.tests.items)
      const lines = list.getByTestId('restore-item')
      const statuses = await lines.evaluateAll((nodes) =>
        nodes.map((node) => node.getAttribute('data-status')),
      )
      expect(statuses).toEqual(['fatal', ...Array<string>(9).fill('conflict')])
      await expect(lines.first().locator(':scope > span')).toHaveText([
        'Billing sync',
        'Cannot be restored. Uses Function "Create invoice", which is not in the backup or in this WAVE',
      ])
      await expect(lines.locator(':scope > span:nth-of-type(2)')).toHaveText([
        'Cannot be restored. Uses Function "Create invoice", which is not in the backup or in this WAVE',
        'Already in this WAVE',
        'Already in this WAVE',
        'Name already in use',
        'Already in this WAVE',
        'Already in this WAVE',
        'Already in this WAVE',
        'Name already in use',
        'Already in this WAVE',
        'Already in this WAVE',
      ])
      await expectHeaderIcons(page, list)
    })

    await test.step('a one-line entry is 28px, names and reasons in columns; a 168px box that scrolls', async () => {
      const drawn = await readEntryList(list)
      expectLineHeights(drawn)
      expect(spread(drawn.lines.map((line) => line.nameLeft)), 'the names share one column').toBeLessThanOrEqual(0.5)
      expect(spread(drawn.lines.map((line) => line.reasonLeft)), 'the reasons share one column').toBeLessThanOrEqual(0.5)

      await expectScrollBox(list)
      const lineSum = drawn.lines.reduce((sum, line) => sum + line.height, 0)
      expect(drawn.scrollHeight, 'the content is the ten lines').toBeCloseTo(lineSum, 0)

      await list.evaluate((box) => {
        box.scrollTop = box.scrollHeight
      })
      const atEnd = await readEntryList(list)
      const inView = atEnd.lines.filter(
        (line) => line.top >= atEnd.top - 0.5 && line.bottom <= atEnd.bottom + 0.5,
      )
      expect(inView, 'six 28px lines fill the box').toHaveLength(6)
      await list.evaluate((box) => {
        box.scrollTop = 0
      })

      await list.hover()
      await page.mouse.wheel(0, 56)
      await expect.poll(() => list.evaluate((box) => box.scrollTop), 'a wheel scrolls the list').toBeGreaterThan(0)
    })

    await test.step('a long reason wraps and its name stays on one line; a long name never widens the box', async () => {
      backup.preview = LONG_ENTRIES_PREVIEW
      await page.getByTestId('clear-file-button').click()
      await uploadMockFile(page, WIREFRAME_FILE)
      await expect(partRows(page)).toHaveCount(PART_ORDER.length)
      await expectEntries(list, 'preview', LONG_ENTRIES_PREVIEW.entity_summary.tests.items)

      const drawn = await readEntryList(list)
      // Line 4 is the first with a short name and a short reason.
      const [, longReason, longName, short] = drawn.lines
      expect(short.height, 'a short line').toBeCloseTo(28, 0)
      expect(longReason.height, 'the line of the long reason').toBeGreaterThan(28.5)
      expect(longReason.reasonHeight, 'the long reason wraps').toBeGreaterThan(short.reasonHeight)
      expect(longReason.nameHeight, 'its name stays on one line').toBeCloseTo(short.nameHeight, 0)
      expect(longReason.reasonLeft, 'the reason wraps under its own start').toBeCloseTo(short.reasonLeft, 0)

      expect(LONG_NAME).toHaveLength(150)
      expect(drawn.scrollWidth, 'the box never scrolls sideways').toBe(drawn.clientWidth)
      expect(longName.nameHeight, 'the long name wraps').toBeGreaterThan(short.nameHeight)
      for (const [index, line] of drawn.lines.entries()) {
        expect(line.nameLeft, `line ${index + 1}: name inside the box`).toBeGreaterThanOrEqual(drawn.left)
        expect(line.nameRight, `line ${index + 1}: name ends before its reason`).toBeLessThanOrEqual(line.reasonLeft)
        expect(line.reasonRight, `line ${index + 1}: reason inside the box`).toBeLessThanOrEqual(drawn.right)
      }
    })
  })

  test('V-BACKUP-02-V12: the chevron, the name and Enter open and close a row; the list takes focus (BACKUP-2)', async ({
    page,
  }) => {
    await openWireframePreview(page)
    const profiles = page.getByTestId('entity-row-toggle-profiles')
    const tests = page.getByTestId('entity-row-toggle-tests')

    await test.step('a click on the Profiles chevron opens Profiles', async () => {
      await expect(page.getByTestId('restore-checkbox-profiles')).toHaveAccessibleName('profiles')
      await expect(profiles).toHaveAttribute('aria-label', 'Expand profiles')
      await profiles.locator('svg').click()
      await expect(profiles).toHaveAttribute('aria-label', 'Collapse profiles')
      await expect(profiles).toHaveAttribute('aria-expanded', 'true')
      await expectEntries(
        previewList(page, 'profiles'),
        'preview',
        WIREFRAME_PREVIEW.entity_summary.profiles.items,
      )
    })

    await test.step('a click on the Tests name closes Tests', async () => {
      await expect(tests).toHaveAttribute('aria-label', 'Collapse tests')
      await tests.locator('span').click()
      await expect(tests).toHaveAttribute('aria-expanded', 'false')
      await expect(tests).toHaveAttribute('aria-label', 'Expand tests')
      await expect(page.getByTestId('entity-row-items-tests')).toHaveCount(0)
    })

    await test.step('Enter on the focused toggle opens it again', async () => {
      await expect(tests).toBeFocused()
      await page.keyboard.press('Enter')
      await expect(tests).toHaveAttribute('aria-expanded', 'true')
      await expect(previewList(page, 'tests')).toBeVisible()
    })

    await test.step('the keyboard reaches the scroll box and scrolls it', async () => {
      const list = previewList(page, 'tests')
      await page.keyboard.press('Tab')
      await expect(list).toBeFocused()
      await page.keyboard.press('End')
      await expect.poll(() => list.evaluate((box) => box.scrollTop)).toBeGreaterThan(0)
    })
  })
})

test.describe('V-BACKUP-02: Preview re-reads', () => {
  test('V-BACKUP-02-V13: unticking a part reads the preview again and Restore waits for the answer (BACKUP-5)', async ({
    page,
  }) => {
    const backup = await openWireframePreview(page)
    const rereads = recordForms(page, VALIDATE_ROUTE)
    await delayApiRoute(page, VALIDATE_ROUTE, HELD_MS, 'POST')
    const restore = restoreButton(page)
    await expect(restore).toBeEnabled()
    await expect(restore).toHaveText(WIREFRAME_RESTORE_BUTTON)

    const secondFatal: Entry = {
      name: 'Invoice run',
      status: 'fatal',
      reason: 'Uses Function "Build payload", which is not in this WAVE',
    }
    const reread = wireframePreview({
      tests: previewPart(18, 7, 9, 0, 2, [
        fatalTest(MISSING_FUNCTION_IN_PREVIEW),
        secondFatal,
        ...entries('conflict', TEST_ENTRIES),
      ]),
    })
    backup.preview = reread
    await page.getByTestId('restore-checkbox-functions').click()

    await test.step('while the answer is held back the table stays and Restore is disabled', async () => {
      await expect.poll(() => rereads.length, 'the re-read left the page').toBe(1)
      expect(rereads[0], 'the re-read names the kept upload and carries no file').toEqual({
        fileName: null,
        uploadId: uploadIdOf(backup, WIREFRAME_FILE),
        entityTypes: 'tests,environments,profiles,suites,regressions,system_variables,ssh_hosts,certificates',
        conflictResolution: 'skip',
        autoRepair: 'false',
      })
      await expect(restore).toBeDisabled()
      await expect(partRows(page)).toHaveCount(PART_ORDER.length)
      await expectRowNumbers(page, 'tests', ['18', '8', '9', '0', '1'])
      expect(backup.previewsAnswered, 'only the first read is answered so far').toHaveLength(1)
    })

    await test.step('when it lands the table shows it and Restore is enabled', async () => {
      await expectRowNumbers(page, 'tests', ['18', '7', '9', '0', '2'])
      await expect(restore).toBeEnabled()
      await expect(restore).toHaveText('Restore 34 entities')
      await expectEntries(previewList(page, 'tests'), 'preview', reread.entity_summary.tests.items)
      await expect(page.getByTestId('restore-checkbox-functions')).not.toBeChecked()
      await expectRowNumbers(page, 'functions', ['6', '4', '2', '0', '0'])
      expect([...backup.kept.values()], 'the file was sent once').toEqual([WIREFRAME_FILE])
    })
  })

  test('V-BACKUP-02-V14: a re-read that fails shows the reason under the table; the table stays (BACKUP-5)', async ({
    page,
  }) => {
    await openWireframePreview(page)
    await failApiRoute(page, VALIDATE_ROUTE, { status: 400, detail: REREAD_REFUSED }, 'POST')
    await page.getByTestId('restore-checkbox-suites').click()

    const error = page.getByTestId('restore-validate-error')
    await expect(error).toHaveText(REREAD_REFUSED)
    await expect(error).toHaveCount(1)
    const tableBox = await boxOf(page.getByTestId('entity-summary-table'))
    const errorBox = await boxOf(error)
    expect(errorBox.y, 'the reason sits under the table').toBeGreaterThanOrEqual(tableBox.y + tableBox.height)

    const rows = await readPartRows(page)
    expect(rows.map((row) => [row.name, ...row.numbers]), 'the last preview stays').toEqual(WIREFRAME_ROWS)
    await expectPreviewOpen(page, ['tests'])
    await expect(restoreButton(page)).toBeDisabled()
  })

  test('V-BACKUP-02-V15: a row closed by hand stays closed through a re-read; a first fatal entry opens a row (BACKUP-2)', async ({
    page,
  }) => {
    const backup = await openWireframePreview(page)
    const tests = page.getByTestId('entity-row-toggle-tests')
    const profiles = page.getByTestId('entity-row-toggle-profiles')
    const restore = restoreButton(page)

    await tests.click()
    await expect(tests).toHaveAttribute('aria-expanded', 'false')

    await test.step('Tests stays closed through a re-read that leaves its fatal entry', async () => {
      await page.getByTestId('restore-checkbox-suites').click()
      await expect.poll(() => backup.previewsAnswered.length, 'the re-read is answered').toBe(2)
      await expect(restore).toBeEnabled()
      await expectRowNumbers(page, 'tests', ['18', '8', '9', '0', '1'])
      await expect(tests).toHaveAttribute('aria-expanded', 'false')
      await expect(page.getByTestId('entity-row-items-tests')).toHaveCount(0)
    })

    await test.step('a re-read that gives Profiles its first fatal entry opens Profiles', async () => {
      await expect(profiles).toHaveAttribute('aria-expanded', 'false')
      const namelessProfile: Entry = { name: 'profile-41c7', status: 'fatal', reason: 'Has no name' }
      const withFatalProfile = wireframePreview({
        profiles: previewPart(5, 3, 1, 0, 1, [namelessProfile, ...entries('conflict', PROFILE_ENTRIES)]),
      })
      backup.preview = withFatalProfile
      await page.getByTestId('restore-checkbox-regressions').click()

      await expectRowNumbers(page, 'profiles', ['5', '3', '1', '0', '1'])
      await expect(profiles).toHaveAttribute('aria-expanded', 'true')
      await expectEntries(
        previewList(page, 'profiles'),
        'preview',
        withFatalProfile.entity_summary.profiles.items,
      )
      await expect(tests, 'Tests keeps the choice made by hand').toHaveAttribute('aria-expanded', 'false')
    })
  })

  test('V-BACKUP-02-V16: unticking the last ticked part sends no validate request (BACKUP-5)', async ({
    page,
  }) => {
    // The page's timers are advanced by hand, so "no request" is read after the debounce window.
    await page.clock.install()
    await setupMockRoutes(page, { preview: TWO_PART_PREVIEW })
    const validates = countApiFetches(page, VALIDATE_ROUTE, 'POST')
    const sent = recordForms(page, VALIDATE_ROUTE)
    await page.goto('/settings/backup')
    await waitForSettingsPageLoad(page)
    await uploadMockFile(page)

    const restore = restoreButton(page)
    await expect(restore).toHaveText('Restore 7 entities')
    await expect(restore).toBeEnabled()
    expect(validates(), 'the first read').toBe(1)

    await test.step('one part is left ticked', async () => {
      await page.getByTestId('restore-checkbox-tests').click()
      await page.clock.runFor(DEBOUNCE_WINDOW_MS)
      await expect.poll(validates).toBe(2)
      await expect(restore).toBeEnabled()
      await expect(restore).toHaveText('Restore 2 entities')
    })

    await test.step('unticking it sends nothing; the last preview stays and Restore is disabled', async () => {
      await page.getByTestId('restore-checkbox-environments').click()
      await page.clock.runFor(DEBOUNCE_WINDOW_MS)
      await expect(restore).toBeDisabled()
      await expectRowNumbers(page, 'tests', ['5', '5', '0', '0', '0'])
      await expectRowNumbers(page, 'environments', ['2', '2', '0', '0', '0'])
      await expect(page.getByTestId('restore-validate-error')).toHaveCount(0)
      expect(validates(), 'no read for an empty set').toBe(2)
    })

    await test.step('ticking the same part back sends nothing either', async () => {
      await page.getByTestId('restore-checkbox-environments').click()
      await page.clock.runFor(DEBOUNCE_WINDOW_MS)
      await expect(restore).toBeEnabled()
      await expect(restore).toHaveText('Restore 2 entities')
      expect(validates(), 'no read for the set already on screen').toBe(2)
    })

    await test.step('ticking a different part reads', async () => {
      await page.getByTestId('restore-checkbox-tests').click()
      await page.clock.runFor(DEBOUNCE_WINDOW_MS)
      await expect.poll(validates).toBe(3)
      await expect(restore).toBeEnabled()
      await expect(restore).toHaveText('Restore 7 entities')
      expect(sent.map((form) => form.entityTypes)).toEqual([null, 'environments', 'tests,environments'])
    })
  })

  test('V-BACKUP-02-V17: the Conflict Resolution choice stays after Overwrite is picked, until the file is cleared (BACKUP-5)', async ({
    page,
  }) => {
    const backup = await openWireframePreview(page)
    const rereads = recordForms(page, VALIDATE_ROUTE)
    const choice = page.getByTestId('conflict-resolution')
    await expect(choice).toBeVisible()

    backup.preview = NO_CONFLICT_PREVIEW
    await page.getByTestId('cr-overwrite').click()

    await test.step('the next preview counts no conflict and the choice stays', async () => {
      for (const type of ['tests', 'profiles', 'functions'] as const) {
        await expect(
          page.getByTestId(`entity-row-${type}`).locator(':scope > td').nth(4),
          `${type}: Conflicts`,
        ).toHaveText('0')
      }
      expect(rereads.at(-1)?.conflictResolution, 'the preview was read under Overwrite').toBe('overwrite')
      await expect(choice).toBeVisible()
      await expect(page.getByTestId('cr-overwrite')).toBeChecked()
      await expect(page.getByTestId('cr-skip')).not.toBeChecked()
    })

    await test.step('Clear hides it; the next file starts without it', async () => {
      await page.getByTestId('clear-file-button').click()
      await expect(page.getByTestId('upload-zone')).toBeVisible()
      await expect(choice).toHaveCount(0)

      await uploadMockFile(page, WIREFRAME_FILE)
      await expect(partRows(page)).toHaveCount(PART_ORDER.length)
      await expect(restoreButton(page)).toBeEnabled()
      await expect(choice).toHaveCount(0)
    })
  })

  test('V-BACKUP-02-V18: of two files picked in a row the preview and the restore belong to the last one (BACKUP-5)', async ({
    page,
  }) => {
    const firstFile = 'wave-backup-first.zip'
    const lastFile = 'wave-backup-last.zip'
    const backup = await setupMockRoutes(page, {
      preview: (fileName) => (fileName === firstFile ? MOCK_VALIDATION_RESPONSE : WIREFRAME_PREVIEW),
      result: WIREFRAME_RESULT,
    })
    // Only the first file's validate answer is held back, until the test lets it go.
    let releaseFirstAnswer = () => {}
    const firstAnswerHeld = new Promise<void>((resolve) => {
      releaseFirstAnswer = resolve
    })
    await page.route(VALIDATE_ROUTE, async (route: Route) => {
      if (fileOf(backup, readForm(route.request().postData())) === firstFile) await firstAnswerHeld
      await route.fallback()
    })
    const answeredFiles = () => backup.previewsAnswered.map((form) => fileOf(backup, form))
    const restores = recordForms(page, RESTORE_ROUTE)
    await page.goto('/settings/backup')
    await waitForSettingsPageLoad(page)

    await uploadMockFile(page, firstFile)
    await uploadMockFile(page, lastFile)

    const details = page.getByTestId('validation-preview')
    const expectLastFile = async () => {
      await expect(details.getByText(lastFile, { exact: true })).toBeVisible()
      await expect(details).not.toContainText(firstFile)
      await expect(partRows(page)).toHaveCount(PART_ORDER.length)
      const rows = await readPartRows(page)
      expect(rows.map((row) => [row.name, ...row.numbers])).toEqual(WIREFRAME_ROWS)
      await expect(restoreButton(page)).toHaveText(WIREFRAME_RESTORE_BUTTON)
    }

    await test.step('the preview is the last file\'s, also after the first file\'s answer lands', async () => {
      await expectLastFile()
      expect(answeredFiles(), 'only the last file is answered so far').toEqual([lastFile])
      releaseFirstAnswer()
      await expect
        .poll(answeredFiles, 'the first file is answered after the last one')
        .toEqual([lastFile, firstFile])
      await expectLastFile()
    })

    await test.step('each file was sent once and the first file\'s kept upload is dropped', async () => {
      expect([...backup.kept.values()]).toEqual([firstFile, lastFile])
      await expect.poll(() => backup.dropped).toEqual([uploadIdOf(backup, firstFile)])
    })

    await test.step('Restore names the upload of the last file with its parts and carries no file', async () => {
      await restoreButton(page).click()
      await expect(page.getByTestId('restore-result')).toBeVisible()
      expect(restores).toEqual([
        {
          fileName: null,
          uploadId: uploadIdOf(backup, lastFile),
          entityTypes: PART_ORDER.join(','),
          conflictResolution: 'skip',
          autoRepair: 'false',
        },
      ])
      await expectLastFile()
    })
  })
  test('V-BACKUP-02-V19: the preview is read again when a restore ends and Restore waits for the answer (BACKUP-5)', async ({
    page,
  }) => {
    const backup = await openWireframePreview(page)
    const rereads = recordForms(page, VALIDATE_ROUTE)
    await delayApiRoute(page, VALIDATE_ROUTE, HELD_MS, 'POST')
    const restore = restoreButton(page)
    const environments = page.getByTestId('entity-row-toggle-environments')
    backup.preview = ENVIRONMENTS_HERE_PREVIEW

    await restore.click()
    await expect(page.getByTestId('restore-result')).toBeVisible()

    await test.step('while the answer is held back the table stays and Restore is disabled', async () => {
      await expect.poll(() => rereads.length, 'the re-read left the page').toBe(1)
      expect(rereads[0], 'the re-read names the kept upload and carries no file').toEqual({
        fileName: null,
        uploadId: uploadIdOf(backup, WIREFRAME_FILE),
        entityTypes: PART_ORDER.join(','),
        conflictResolution: 'skip',
        autoRepair: 'false',
      })
      await expect(restore).toHaveText(WIREFRAME_RESTORE_BUTTON)
      await expect(restore).toBeDisabled()
      await expectRowNumbers(page, 'environments', ['3', '3', '0', '0', '0'])
      await expect(environments).toHaveCount(0)
      expect(backup.previewsAnswered, 'only the first read is answered so far').toHaveLength(1)
    })

    await test.step('when it lands the table shows the environments as conflicts and Restore is enabled', async () => {
      await expectRowNumbers(page, 'environments', ['3', '0', '3', '0', '0'])
      await expect(restore).toBeEnabled()
      await expect(restore).toHaveText(WIREFRAME_RESTORE_BUTTON)
      await expectPreviewOpen(page, [])
      await expect(environments).toHaveAttribute('aria-expanded', 'false')
      await environments.click()
      await expectEntries(
        previewList(page, 'environments'),
        'preview',
        ENVIRONMENTS_HERE_PREVIEW.entity_summary.environments.items,
      )
      await expect(page.getByTestId('restore-result')).toBeVisible()
      expect(rereads, 'one read for the restore').toHaveLength(1)
      expect([...backup.kept.values()], 'the file was sent once').toEqual([WIREFRAME_FILE])
    })
  })
})

test.describe('V-BACKUP-02: Restore Action', () => {
  test('V-BACKUP-02-R1: restore button shows entity count', async ({ page }) => {
    await setupMockRoutes(page)
    await page.goto('/settings/backup')
    await waitForSettingsPageLoad(page)

    await uploadMockFile(page)

    const restoreButton = page.locator('[data-testid="restore-button"]')
    await expect(restoreButton, 'Restore button should be visible').toBeVisible()

    // Count: ok + conflicts for all selected types (auto_repair off, so fixable excluded)
    // tests: 7+2=9, environments: 3+0=3, profiles: 3+1=4, suites: 2+0=2, regressions: 1+0=1 = 19
    await expect(restoreButton).toContainText('Restore 19 entities')
  })

  test('V-BACKUP-02-R2: restore button disabled when no entities selected', async ({ page }) => {
    await setupMockRoutes(page)
    await page.goto('/settings/backup')
    await waitForSettingsPageLoad(page)

    await uploadMockFile(page)

    // Uncheck all entity types
    for (const type of ['tests', 'environments', 'profiles', 'suites', 'regressions']) {
      const checkbox = page.locator(`[data-testid="restore-checkbox-${type}"]`)
      await checkbox.click()
    }

    const restoreButton = page.locator('[data-testid="restore-button"]')
    await expect(
      restoreButton,
      'Restore button should be disabled when no entities selected'
    ).toBeDisabled()
  })

  test('V-BACKUP-02-R3: restore result shows per-type counts, one block per part in the order of the part list (BACKUP-4, BACKUP-7)', async ({
    page,
  }) => {
    const backup = await setupMockRoutes(page)
    await page.goto('/settings/backup')
    await waitForSettingsPageLoad(page)

    await test.step('five-part backup: imported and skipped per type, failed only where above 0', async () => {
      await uploadMockFile(page)

      // Click restore
      await restoreButton(page).click()

      // Wait for restore result
      const result = page.locator('[data-testid="restore-result"]')
      await expect(result, 'Restore result should be visible').toBeVisible({ timeout: 10_000 })

      // Verify result contents
      await expect(result).toContainText('Restore Complete')
      await expect(result).toContainText('tests')
      await expect(result).toContainText('8 imported')
      await expect(result).toContainText('environments')
      await expect(result).toContainText('3 imported')
      await expect(result).toContainText('profiles')
      // BACKUP-9: a line counts failed items only when it has some.
      await expect(page.getByTestId('restore-result-line-profiles')).toHaveText(
        'Profiles: 3 imported, 1 skipped, 1 failed',
        { useInnerText: true },
      )
      await expect(page.getByTestId('restore-result-line-tests')).toHaveText(
        'Tests: 8 imported, 2 skipped',
        { useInnerText: true },
      )
    })

    await test.step('nine-part backup: the lines follow the part list, 16px high, texts at one x', async () => {
      backup.preview = WIREFRAME_PREVIEW
      backup.result = WIREFRAME_RESULT
      await page.getByTestId('clear-file-button').click()
      await expect(page.getByTestId('restore-result')).toHaveCount(0)
      await uploadMockFile(page, WIREFRAME_FILE)
      await expect(partRows(page)).toHaveCount(PART_ORDER.length)

      await restoreButton(page).click()
      await expect(page.getByTestId('restore-result')).toBeVisible()
      await expectWireframeResultLines(page)
    })
  })

  test('V-BACKUP-02-R4: auto-repair changes restorable count', async ({ page }) => {
    await setupMockRoutes(page)
    await page.goto('/settings/backup')
    await waitForSettingsPageLoad(page)

    await uploadMockFile(page)

    // Initially: ok+conflicts = 19 (fixable excluded)
    const restoreButton = page.locator('[data-testid="restore-button"]')
    await expect(restoreButton).toContainText('Restore 19 entities')

    // Enable auto-repair
    const autoRepairToggle = page.locator('[data-testid="auto-repair-toggle"]')
    await autoRepairToggle.click()

    // Now: ok+conflicts+fixable = 19 + 1 (tests fixable) = 20
    await expect(restoreButton).toContainText('Restore 20 entities')
  })

  test('V-BACKUP-02-R5: the result line with a fatal entry starts open and names it first, then the skipped entries (BACKUP-4, BACKUP-6, BACKUP-9)', async ({
    page,
  }) => {
    await openWireframePreview(page)
    await restoreButton(page).click()
    await expect(page.getByTestId('restore-result')).toBeVisible()
    const tests = page.getByTestId('restore-result-toggle-tests')
    const profiles = page.getByTestId('restore-result-toggle-profiles')
    const functions = page.getByTestId('restore-result-toggle-functions')

    await test.step('the Tests list is the next sibling of its line: the fatal entry with its outcome, then the skipped ones', async () => {
      const line = page.getByTestId('restore-result-line-tests')
      const afterLine = await line.evaluate((node) => node.nextElementSibling?.getAttribute('data-testid'))
      expect(afterLine).toBe('restore-result-items-tests')

      const list = resultList(page, 'tests')
      await expectEntries(list, 'result', WIREFRAME_RESULT.tests.items)
      const lines = list.getByTestId('restore-item')
      await expect(lines.first().locator(':scope > span')).toHaveText([
        'Billing sync',
        'Not restored. Uses Function "Create invoice", which is not in this WAVE',
      ])
      const statuses = await lines.evaluateAll((nodes) =>
        nodes.map((node) => node.getAttribute('data-status')),
      )
      expect(statuses).toEqual(['fatal', ...Array<string>(9).fill('skipped')])
      await expect(lines.locator(':scope > span:nth-of-type(2)').nth(1)).toHaveText('Already in this WAVE')
      await expect(lines.locator(':scope > span:nth-of-type(2)').nth(3)).toHaveText('Name already in use')

      const drawn = await readEntryList(list)
      for (const [index, skipped] of drawn.lines.slice(1).entries()) {
        expect(skipped.iconShape, `skipped line ${index + 1}: icon`).toContain('lucide-skip-forward')
        expect(skipped.iconColor, `skipped line ${index + 1}: muted icon`).toBe(skipped.reasonColor)
      }
      await expectScrollBox(list)

      const listBox = await boxOf(list)
      const nextLine = await boxOf(page.getByTestId('restore-result-line-environments'))
      expect(nextLine.y - (listBox.y + listBox.height), 'the next line is 8px under the list').toBeCloseTo(8, 0)
    })

    await test.step('a toggle is described by its whole line text and labeled Expand or Collapse', async () => {
      await expect(tests).toHaveAccessibleDescription('Tests: 8 imported, 9 skipped, 1 failed', { ignoreCase: true })
      await expect(tests).toHaveAttribute('aria-label', 'Collapse tests')
      await expect(profiles).toHaveAccessibleDescription('Profiles: 4 imported, 1 skipped', { ignoreCase: true })
      await expect(profiles).toHaveAttribute('aria-label', 'Expand profiles')
      await expect(functions).toHaveAccessibleDescription('Functions: 4 imported, 2 skipped', { ignoreCase: true })
      await expect(functions).toHaveAttribute('aria-label', 'Expand functions')
    })

    await test.step('Profiles and Functions start closed; the six other lines have no toggle', async () => {
      await expectResultOpen(page, ['tests'])
      for (const type of PARTS_WITHOUT_ENTRIES) {
        await expect(page.getByTestId(`restore-result-toggle-${type}`)).toHaveCount(0)
        await expect(page.getByTestId(`restore-result-line-${type}`).locator('button')).toHaveCount(0)
        await expect(page.getByTestId(`restore-result-items-${type}`)).toHaveCount(0)
      }
    })

    await test.step('a click on the text inside the Profiles toggle opens it', async () => {
      await profiles.locator('span').first().click()
      await expect(profiles).toHaveAttribute('aria-expanded', 'true')
      await expect(profiles).toHaveAttribute('aria-label', 'Collapse profiles')
      await expect(profiles).toHaveAccessibleDescription('Profiles: 4 imported, 1 skipped', { ignoreCase: true })
      await expectEntries(resultList(page, 'profiles'), 'result', WIREFRAME_RESULT.profiles.items)
      await expectResultOpen(page, ['tests', 'profiles'])
    })
  })

  test('V-BACKUP-02-R6: every preview row is closed after the restore (BACKUP-2)', async ({ page }) => {
    await openWireframePreview(page)
    await page.getByTestId('entity-row-toggle-profiles').click()
    await expectPreviewOpen(page, ['tests', 'profiles'])

    await restoreButton(page).click()
    await expect(page.getByTestId('restore-result')).toBeVisible()

    await expectPreviewOpen(page, [])
    const rows = await readPartRows(page)
    expect(rows.map((row) => [row.name, ...row.numbers]), 'the preview stays above the result').toEqual(WIREFRAME_ROWS)
    await expect(restoreButton(page)).toHaveText(WIREFRAME_RESTORE_BUTTON)
    await expect(restoreButton(page)).toBeEnabled()

    await page.getByTestId('entity-row-toggle-tests').click()
    await expectPreviewOpen(page, ['tests'])
  })
})

test.describe('V-BACKUP-02: Overwrite confirmation', () => {
  test('V-BACKUP-02-O1: Restore with Overwrite and a conflict in a ticked part asks first and sends nothing (BACKUP-8)', async ({
    page,
  }) => {
    await openWireframePreview(page)
    const restores = countApiFetches(page, RESTORE_ROUTE, 'POST')
    await pickOverwrite(page)
    await restoreButton(page).click()

    const dialog = overwriteDialog(page)
    await expect(dialog).toBeVisible()
    await expect(dialog).toHaveAttribute('role', 'alertdialog')
    await expect(dialog.getByRole('heading')).toHaveText(OVERWRITE_TITLE)
    await expect(dialog).toHaveAccessibleName(OVERWRITE_TITLE)
    await expect(dialog.getByText(OVERWRITE_BODY, { exact: true })).toBeVisible()
    await expect(dialog).toHaveAccessibleDescription(OVERWRITE_BODY)
    await expect(dialog.getByRole('button')).toHaveText(['Cancel', 'Overwrite'])
    await expectNothingRestored(page, restores, WIREFRAME_RESTORE_BUTTON)
  })

  test('V-BACKUP-02-O2: Overwrite in the confirmation closes it and sends one restore with the overwrite choice (BACKUP-8)', async ({
    page,
  }) => {
    const backup = await openWireframePreview(page)
    backup.result = OVERWRITE_RESULT
    const restores = countApiFetches(page, RESTORE_ROUTE, 'POST')
    const sent = recordForms(page, RESTORE_ROUTE)
    await pickOverwrite(page)
    await restoreButton(page).click()

    const dialog = overwriteDialog(page)
    await dialog.getByRole('button', { name: 'Overwrite', exact: true }).click()
    await expect(dialog).toBeHidden()

    const result = page.getByTestId('restore-result')
    await expect(result).toBeVisible()
    await expect(result.getByRole('heading')).toHaveText('Restore Complete')
    await expect(page.getByTestId('restore-result-line-tests')).toHaveText(
      'Tests: 17 imported, 0 skipped, 1 failed',
      { useInnerText: true },
    )
    await expect(page.getByTestId('restore-result-line-profiles')).toHaveText(
      'Profiles: 5 imported, 0 skipped',
      { useInnerText: true },
    )
    await expect(restoreButton(page)).toBeEnabled()
    expect(restores(), 'restore requests').toBe(1)
    expect(sent).toEqual([
      {
        fileName: null,
        uploadId: uploadIdOf(backup, WIREFRAME_FILE),
        entityTypes: PART_ORDER.join(','),
        conflictResolution: 'overwrite',
        autoRepair: 'false',
      },
    ])
  })

  test('V-BACKUP-02-O3: Cancel sends nothing and leaves the preview, the ticked parts and the choice (BACKUP-8)', async ({
    page,
  }) => {
    await openWireframePreview(page)
    const restores = countApiFetches(page, RESTORE_ROUTE, 'POST')
    await page.getByTestId('restore-checkbox-suites').click()
    await pickOverwrite(page)
    const restore = restoreButton(page)
    await expect(restore).toHaveText('Restore 37 entities')
    await restore.click()

    const dialog = overwriteDialog(page)
    await expect(dialog).toBeVisible()
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(dialog).toBeHidden()

    await test.step('the preview, the ticked parts and the choice are as they were', async () => {
      const rows = await readPartRows(page)
      expect(rows.map((row) => [row.name, ...row.numbers])).toEqual(WIREFRAME_ROWS)
      await expectPreviewOpen(page, ['tests'])
      for (const type of PART_ORDER) {
        const checkbox = page.getByTestId(`restore-checkbox-${type}`)
        if (type === 'suites') await expect(checkbox, 'suites stays unticked').not.toBeChecked()
        else await expect(checkbox, `${type} stays ticked`).toBeChecked()
      }
      await expect(page.getByTestId('cr-overwrite')).toBeChecked()
      await expect(restore).toBeEnabled()
      await expectNothingRestored(page, restores, 'Restore 37 entities')
    })

    await test.step('Restore can be clicked again and asks again', async () => {
      await restore.click()
      await expect(dialog).toBeVisible()
      await expect(dialog.getByRole('heading')).toHaveText(OVERWRITE_TITLE)
      await expectNothingRestored(page, restores, 'Restore 37 entities')
    })
  })

  test('V-BACKUP-02-O4: Skip, Rename and Overwrite without a ticked conflict restore at once (BACKUP-8)', async ({
    page,
  }) => {
    await openWireframePreview(page)
    const restores = countApiFetches(page, RESTORE_ROUTE, 'POST')
    const sent = recordForms(page, RESTORE_ROUTE)
    const rereads = recordForms(page, VALIDATE_ROUTE)
    const dialog = overwriteDialog(page)
    const restore = restoreButton(page)
    const allParts = PART_ORDER.join(',')
    const partsWithoutConflicts = PARTS_WITHOUT_ENTRIES.join(',')

    await test.step('Skip restores at once', async () => {
      await expect(page.getByTestId('cr-skip')).toBeChecked()
      await restore.click()
      await expect.poll(restores).toBe(1)
      expect(sent[0]).toMatchObject({ entityTypes: allParts, conflictResolution: 'skip' })
      await expect(page.getByTestId('restore-result')).toBeVisible()
      await expect(dialog).toHaveCount(0)
    })

    await test.step('Rename restores at once', async () => {
      await page.getByTestId('cr-rename').click()
      await expect.poll(() => rereads.at(-1)?.conflictResolution).toBe('rename')
      await restore.click()
      await expect.poll(restores).toBe(2)
      expect(sent[1]).toMatchObject({ entityTypes: allParts, conflictResolution: 'rename' })
      await expect(dialog).toHaveCount(0)
    })

    await test.step('Overwrite restores at once when the parts with conflicts are unticked', async () => {
      await page.getByTestId('cr-overwrite').click()
      for (const type of PARTS_WITH_ENTRIES) {
        await page.getByTestId(`restore-checkbox-${type}`).click()
      }
      await expect
        .poll(() => `${rereads.at(-1)?.conflictResolution}: ${rereads.at(-1)?.entityTypes}`)
        .toBe(`overwrite: ${partsWithoutConflicts}`)
      await expect(restore).toBeEnabled()
      await expect(restore).toHaveText('Restore 13 entities')
      await expectRowNumbers(page, 'tests', ['18', '8', '9', '0', '1'])
      await expect(page.getByTestId('cr-overwrite')).toBeChecked()

      await restore.click()
      await expect.poll(restores).toBe(3)
      expect(sent[2]).toMatchObject({ entityTypes: partsWithoutConflicts, conflictResolution: 'overwrite' })
      await expect(dialog).toHaveCount(0)
    })
  })

  test('V-BACKUP-02-O5: Escape and a click outside do not close the confirmation (BACKUP-8, REQ-5.2.1.23)', async ({
    page,
  }) => {
    await openWireframePreview(page)
    const restores = countApiFetches(page, RESTORE_ROUTE, 'POST')
    await pickOverwrite(page)
    await restoreButton(page).click()
    const dialog = overwriteDialog(page)
    await expect(dialog).toBeVisible()

    await test.step('Escape', async () => {
      await page.keyboard.press('Escape')
      await expect(dialog).toHaveAttribute('data-state', 'open')
      await expect(dialog).toBeVisible()
    })

    await test.step('a click outside', async () => {
      const box = await boxOf(dialog)
      await page.mouse.click(box.x / 2, box.y / 2)
      await expect(dialog).toHaveAttribute('data-state', 'open')
      await expect(dialog).toBeVisible()
      await expectNothingRestored(page, restores, WIREFRAME_RESTORE_BUTTON)
    })

    await test.step('the confirmation still answers its own button', async () => {
      await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
      await expect(dialog).toBeHidden()
      await expectNothingRestored(page, restores, WIREFRAME_RESTORE_BUTTON)
    })
  })
  test('V-BACKUP-02-O6: after a restore the confirmation follows the new preview, so a second Restore asks (BACKUP-5, BACKUP-8)', async ({
    page,
  }) => {
    const backup = await openWireframePreview(page)
    const restores = countApiFetches(page, RESTORE_ROUTE, 'POST')
    const rereads = recordForms(page, VALIDATE_ROUTE)
    const dialog = overwriteDialog(page)
    const restore = restoreButton(page)
    const partsWithoutConflicts = PARTS_WITHOUT_ENTRIES.join(',')

    await test.step('Overwrite with the parts with conflicts unticked restores at once', async () => {
      await page.getByTestId('cr-overwrite').click()
      for (const type of PARTS_WITH_ENTRIES) {
        await page.getByTestId(`restore-checkbox-${type}`).click()
      }
      await expect
        .poll(() => `${rereads.at(-1)?.conflictResolution}: ${rereads.at(-1)?.entityTypes}`)
        .toBe(`overwrite: ${partsWithoutConflicts}`)
      await expect(restore).toBeEnabled()
      backup.preview = ENVIRONMENTS_HERE_PREVIEW

      await restore.click()
      await expect(page.getByTestId('restore-result')).toBeVisible()
      await expect(dialog).toHaveCount(0)
      expect(restores(), 'restore requests').toBe(1)
    })

    await test.step('the new preview counts the environments as conflicts and Restore asks', async () => {
      await expectRowNumbers(page, 'environments', ['3', '0', '3', '0', '0'])
      await expect(restore).toBeEnabled()
      await restore.click()
      await expect(dialog).toBeVisible()
      await expect(dialog.getByRole('heading')).toHaveText(OVERWRITE_TITLE)
      expect(restores(), 'no second restore was sent').toBe(1)
    })
  })
})

test.describe('V-BACKUP-02: Other theme', () => {
  test('V-BACKUP-02-T1: the preview and the result hold in the other theme (BACKUP-2, BACKUP-3, BACKUP-4)', async ({
    page,
  }) => {
    await setupMockRoutes(page, { preview: WIREFRAME_PREVIEW, result: WIREFRAME_RESULT })
    await page.goto('/settings/backup')
    await waitForSettingsPageLoad(page)
    const theme = await toggleTheme(page)
    await uploadMockFile(page, WIREFRAME_FILE)
    await expect(partRows(page)).toHaveCount(PART_ORDER.length)

    await test.step(`${theme}: part rows, open rows and the Tests list of the preview`, async () => {
      await expectPartRowLayout(page)
      await expectPreviewOpen(page, ['tests'])
      const list = previewList(page, 'tests')
      await expectEntries(list, 'preview', WIREFRAME_PREVIEW.entity_summary.tests.items)
      await expectHeaderIcons(page, list)
      await expectScrollBox(list)
      expectLineHeights(await readEntryList(list))
    })

    await test.step(`${theme}: result lines, open lines and the Tests list of the result`, async () => {
      await restoreButton(page).click()
      await expect(page.getByTestId('restore-result')).toBeVisible()
      await expectWireframeResultLines(page)
      await expectResultOpen(page, ['tests'])
      await expectPreviewOpen(page, [])
      const list = resultList(page, 'tests')
      await expectEntries(list, 'result', WIREFRAME_RESULT.tests.items)
      await expectScrollBox(list)
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
    })
  })
})

test.describe('V-BACKUP-02: Periodic Backup first read', () => {
  test('V-BACKUP-02-S1: the mocked schedule has the fields the API answers and the section draws it', async ({
    page,
  }) => {
    const real = await page.request.get(`${BACKEND_URL}/api/backup/schedule`)
    expect(real.status(), 'GET /api/backup/schedule').toBe(200)
    const { data } = (await real.json()) as { data: Record<string, unknown> }
    expect(Object.keys(data).sort()).toEqual(Object.keys(MOCK_SCHEDULE).sort())

    await setupMockRoutes(page)
    await page.goto('/settings/backup')
    await waitForSettingsPageLoad(page)

    const section = periodicSection(page)
    await expect(section.locator('[data-testid="periodic-enable-toggle"]')).not.toBeChecked()
    await expect(section.getByRole('alert')).toHaveCount(0)
    await expect(periodicHeaderButton(page, 'Cancel')).toBeDisabled()
    await expect(periodicHeaderButton(page, 'Save')).toBeDisabled()
  })

  test('V-BACKUP-02-S2: a failed first read shows the reason and Try Again loads the schedule', async ({
    page,
  }) => {
    let failing = true
    await setupMockRoutes(page)
    await failApiRoute(page, apiPathMatcher('/api/backup/schedule'), () =>
      failing ? { detail: SCHEDULE_READ_FAILED } : null,
    )
    await page.goto('/settings/backup')
    await waitForSettingsPageLoad(page)

    const section = periodicSection(page)
    const error = section.getByRole('alert')
    await expect(error.locator('p')).toHaveText(SCHEDULE_READ_FAILED)
    const retry = error.getByRole('button', { name: 'Try Again', exact: true })
    await expect(retry).toBeVisible()
    await expect(section.getByRole('heading', { name: 'Periodic Backup', exact: true })).toBeVisible()
    await expect(section.locator('[data-testid="periodic-enable-toggle"]')).toHaveCount(0)
    await expect(periodicHeaderButton(page, 'Cancel')).toHaveCount(0)
    await expect(periodicHeaderButton(page, 'Save')).toHaveCount(0)

    // Restore does not depend on the schedule read.
    await uploadMockFile(page)
    await expect(page.locator('[data-testid="validation-preview"]')).toBeVisible()

    failing = false
    await retry.click()
    await expect(section.getByRole('alert')).toHaveCount(0)
    await expect(section.locator('[data-testid="periodic-enable-toggle"]')).not.toBeChecked()
    await expect(periodicHeaderButton(page, 'Cancel')).toBeDisabled()
    await expect(periodicHeaderButton(page, 'Save')).toBeDisabled()
  })
})
