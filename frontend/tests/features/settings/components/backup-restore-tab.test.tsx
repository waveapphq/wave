/**
 * BackupRestoreTab Component Tests
 *
 * Tests for the main Backup & Restore settings section:
 * - Three-section layout: Create / Restore / Periodic
 * - Create Backup section: entity selector, format, compression, credentials, progress, button
 * - Restore section: drag & drop upload zone, entity summary table, checkboxes, radio conflict resolution, auto-repair, progress
 * - Restore preview and result (REQ-5.2.1.42, BACKUP-2 to BACKUP-7): rows that open to list their
 *   entries, the preview read again after each change, the result lines with their entries
 * - Periodic section (REQ-4.7.20, REQ-4.7.16, SETTINGS-21): every state of the schedule driven
 *   through the periodicBackup prop - pending, failed, off, on, staged, saving
 */

vi.mock('@/features/settings/api/backup', () => ({
  createBackup: vi.fn(),
  validateBackup: vi.fn(),
  restoreBackup: vi.fn(),
  releaseBackup: vi.fn(),
  getSchedule: vi.fn(),
  updateSchedule: vi.fn(),
}))

vi.mock('@/lib/download-blob', () => ({
  downloadBlob: vi.fn(),
}))

// jsdom doesn't provide URL.createObjectURL
global.URL.createObjectURL = vi.fn(() => 'blob:mock-url')
global.URL.revokeObjectURL = vi.fn()
// Prevent "Not implemented: navigation to another Document" from anchor click downloads
vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, within, waitFor, act, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { StrictMode, type ComponentProps } from 'react'
import { BackupRestoreTab } from '@/features/settings/components/backup-restore-tab/tab'
import { PeriodicBackupSection } from '@/features/settings/components/backup-restore-tab/periodic-backup-section'
import * as backupApi from '@/features/settings/api/backup'
import { downloadBlob } from '@/lib/download-blob'
import { useTimezoneStore } from '@/stores/timezone-store'

// ============================================================================
// Mock Data
// ============================================================================

type PeriodicBackup = ComponentProps<typeof BackupRestoreTab>['periodicBackup']
type ScheduleStaged = PeriodicBackup['staged']

/** Every backup entity type, sorted, as the server answers a schedule that names none. */
const EVERY_ENTITY_TYPE = [
  'certificates',
  'environments',
  'functions',
  'profiles',
  'regressions',
  'ssh_hosts',
  'suites',
  'system_variables',
  'tests',
]

/** What a fresh install answers: off, with the defaults. */
const FRESH_SCHEDULE: backupApi.BackupSchedule = {
  enabled: false,
  cron: '',
  entity_types: EVERY_ENTITY_TYPE,
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

const NIGHTLY_SCHEDULE: backupApi.BackupSchedule = {
  enabled: true,
  cron: '0 2 * * *',
  entity_types: ['environments', 'tests'],
  max_backups: 7,
  save_directory: '/srv/wave-backups',
  format: 'json',
  compression_method: 'bzip2',
  compression_level: 9,
  secrets: 'encrypted',
  last_run: '2026-10-03T02:00:00Z',
  last_run_status: 'success',
  cron_description: 'At 02:00',
  next_run: '2026-10-05T02:00:00Z',
}

const SCHEDULE_READ_FAILURE = 'Failed to fetch schedule'

const SECRETS_MODES = ['mask', 'encrypted', 'plaintext'] as const

/** The testid of every schedule field under the switch. */
const SCHEDULE_FIELDS = [
  'cron-input',
  'entity-selector',
  'periodic-format-select',
  'periodic-compression-method-select',
  'periodic-compression-level-slider',
  'secrets-mode-picker',
  'max-backups-input',
  'save-directory-input',
] as const

const mockValidateResult: backupApi.BackupValidateResult = {
  metadata: {
    wave_version: '1.0.0',
    created_at: '2026-03-07T12:00:00Z',
    format: 'yaml',
    schema_version: '1.0',
    secrets: 'mask',
  },
  entity_summary: {
    tests: { total: 2, ok: 2, conflicts: 0, fixable: 0, fatal: 0, items: [] },
    environments: { total: 1, ok: 0, conflicts: 1, fixable: 0, fatal: 0, items: [] },
  },
}

const mockValidateWithFixable: backupApi.BackupValidateResult = {
  metadata: {
    wave_version: '1.0.0',
    created_at: '2026-03-07T12:00:00Z',
    format: 'yaml',
    schema_version: '1.0',
    secrets: 'mask',
  },
  entity_summary: {
    tests: { total: 3, ok: 1, conflicts: 1, fixable: 1, fatal: 0, items: [] },
    environments: { total: 2, ok: 1, conflicts: 0, fixable: 0, fatal: 1, items: [] },
  },
}

// ============================================================================
// Periodic Backup State
// ============================================================================

/** The fields of a schedule the page stages. */
function stagedOf(schedule: backupApi.BackupSchedule): ScheduleStaged {
  return {
    enabled: schedule.enabled,
    cron: schedule.cron,
    entity_types: schedule.entity_types,
    max_backups: schedule.max_backups,
    save_directory: schedule.save_directory,
    format: schedule.format,
    compression_method: schedule.compression_method,
    compression_level: schedule.compression_level,
    secrets: schedule.secrets,
  }
}

function makePeriodicBackup(overrides: Partial<PeriodicBackup> = {}): PeriodicBackup {
  return {
    status: 'loaded',
    saved: FRESH_SCHEDULE,
    staged: stagedOf(FRESH_SCHEDULE),
    dirty: false,
    saving: false,
    stage: vi.fn(),
    cancel: vi.fn(),
    save: vi.fn(),
    retry: vi.fn(),
    ...overrides,
  }
}

/** A loaded schedule with staged edits on top; the page is dirty when there are any. */
function loadedWith(
  saved: backupApi.BackupSchedule,
  edits: Partial<ScheduleStaged> = {},
): Partial<PeriodicBackup> {
  return {
    saved,
    staged: { ...stagedOf(saved), ...edits },
    dirty: Object.keys(edits).length > 0,
  }
}

function renderTab(overrides: Partial<PeriodicBackup> = {}) {
  const periodicBackup = makePeriodicBackup(overrides)
  const view = render(<BackupRestoreTab periodicBackup={periodicBackup} />)
  return { ...view, periodicBackup }
}

function periodicSection(): HTMLElement {
  return screen.getByTestId('periodic-backup-section')
}

function periodicField(testId: string): HTMLElement {
  return within(periodicSection()).getByTestId(testId)
}

function enableSwitch(): HTMLElement {
  return within(periodicSection()).getByRole('switch', { name: 'Enable periodic backups' })
}

function saveButton(): HTMLElement {
  return within(periodicSection()).getByRole('button', { name: 'Save' })
}

function cancelButton(): HTMLElement {
  return within(periodicSection()).getByRole('button', { name: 'Cancel' })
}

function levelThumb(): HTMLElement {
  return within(periodicField('periodic-compression-level-slider')).getByRole('slider')
}

function expectFieldsShown() {
  for (const testId of SCHEDULE_FIELDS) {
    expect(within(periodicSection()).getByTestId(testId)).toBeInTheDocument()
  }
}

function expectFieldsHidden() {
  for (const testId of SCHEDULE_FIELDS) {
    expect(within(periodicSection()).queryByTestId(testId)).not.toBeInTheDocument()
  }
}

/** Every state of section 7.3 the section can be in, by name. */
const SECTION_STATES: Array<[string, Partial<PeriodicBackup>]> = [
  ['first read pending', { status: 'pending', saved: undefined }],
  ['first read failed', { status: 'failed', error: SCHEDULE_READ_FAILURE, saved: undefined }],
  ['off, clean', loadedWith(FRESH_SCHEDULE)],
  ['switch turned on (staged)', loadedWith(FRESH_SCHEDULE, { enabled: true })],
  ['on, clean', loadedWith(NIGHTLY_SCHEDULE)],
  ['on, edits staged', loadedWith(NIGHTLY_SCHEDULE, { max_backups: 12 })],
  ['switch turned off (staged)', loadedWith(NIGHTLY_SCHEDULE, { enabled: false })],
  ['saving', { ...loadedWith(NIGHTLY_SCHEDULE, { max_backups: 12 }), saving: true }],
]

// ============================================================================
// Restore Preview and Result
// ============================================================================

type User = ReturnType<typeof userEvent.setup>
type PreviewItem = backupApi.BackupPreviewItem
type ResultItem = backupApi.BackupRestoreItem

/** How long the page waits after the last change before it reads the preview again. */
const REREAD_DELAY_MS = 300

const ALREADY_HERE = 'Already in this WAVE'
const NAME_IN_USE = 'Name already in use'
const MISSING_FUNCTION = 'Uses Function "Login", which is not in this WAVE'
const NAME_TAKEN = 'Another Test here has this name'
const MISSING_VERSION = 'Uses Function "F1-Func" 1.2.0, which is not in this WAVE'

/** The words a fatal entry leads with, in the preview and in the result. */
const FATAL_OUTCOMES = { preview: 'Cannot be restored', result: 'Not restored' } as const
type Stage = keyof typeof FATAL_OUTCOMES

const HEADER_STATUS_TOKENS = [
  ['ok', 'text-success'],
  ['conflict', 'text-warning'],
  ['fixable', 'text-info'],
  ['fatal', 'text-destructive'],
] as const

function conflictItem(name: string, reason = ALREADY_HERE): PreviewItem {
  return { name, status: 'conflict', reason }
}

function fatalItem(
  name: string,
  reason = MISSING_FUNCTION,
): { name: string; status: 'fatal'; reason: string } {
  return { name, status: 'fatal', reason }
}

function skippedItem(name: string, reason = ALREADY_HERE): ResultItem {
  return { name, status: 'skipped', reason }
}

/** A preview part; its total is the sum of the four counts. */
function previewPart(
  counts: { ok?: number; conflicts?: number; fixable?: number; fatal?: number },
  items: PreviewItem[] = [],
): backupApi.BackupEntitySummary {
  const { ok = 0, conflicts = 0, fixable = 0, fatal = 0 } = counts
  return { total: ok + conflicts + fixable + fatal, ok, conflicts, fixable, fatal, items }
}

function previewOf(
  parts: Record<string, backupApi.BackupEntitySummary>,
  metadata: Partial<backupApi.BackupMetadata> = {},
): backupApi.BackupValidateResult {
  return { metadata: { ...mockValidateResult.metadata, ...metadata }, entity_summary: parts }
}

function resultPart(
  counts: { imported?: number; skipped?: number; fatal?: number },
  items: ResultItem[] = [],
): backupApi.BackupRestoreTypeResult {
  const { imported = 0, skipped = 0, fatal = 0 } = counts
  return { imported, skipped, fatal, items }
}

/** Three parts that can all be restored; the conflict makes the Conflict Resolution choice show. */
function threeParts(): backupApi.BackupValidateResult {
  return previewOf({
    tests: previewPart({ ok: 2, conflicts: 1 }, [conflictItem('Checkout smoke')]),
    environments: previewPart({ ok: 1 }),
    suites: previewPart({ ok: 1 }),
  })
}

interface Deferred<T> {
  promise: Promise<T>
  resolve: (value: T) => void
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

/** Runs each test of the group on a fake clock, with no answer left over for the read or the restore. */
function onFakeClock() {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.mocked(backupApi.validateBackup).mockReset()
    vi.mocked(backupApi.restoreBackup).mockReset()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.mocked(backupApi.validateBackup).mockReset()
    vi.mocked(backupApi.restoreBackup).mockReset()
  })
}

async function advance(ms: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}

async function answer<T>(pending: Deferred<T>, value: T): Promise<void> {
  await act(async () => {
    pending.resolve(value)
  })
}

/** Picks a backup file and lets its first read land. */
async function uploadBackup(user: User, name = 'backup.zip'): Promise<File> {
  const file = new File(['zipdata'], name, { type: 'application/zip' })
  await user.upload(screen.getByTestId('upload-input'), file)
  await advance(0)
  return file
}

/** Renders the tab and uploads a file whose first read answers the given preview. */
async function openPreview(preview: backupApi.BackupValidateResult) {
  vi.mocked(backupApi.validateBackup).mockResolvedValueOnce(preview)
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
  renderTab()
  const file = await uploadBackup(user)
  return { user, file }
}

/** Queues the answer of the next read of the preview. */
function nextPreview(preview: backupApi.BackupValidateResult) {
  vi.mocked(backupApi.validateBackup).mockResolvedValueOnce(preview)
}

/** Lets a restore answer land, then the read of the preview that follows it, then the progress bar go. */
async function settleRestore(): Promise<void> {
  await advance(0)
  await advance(600)
}

/** Presses Restore and lets the restore settle. */
async function pressRestore(user: User): Promise<void> {
  await user.click(screen.getByTestId('restore-button'))
  await settleRestore()
}

/** Uploads a file that holds the parts of the given result, restores it and lets the result land. */
async function openResult(result: backupApi.BackupRestoreResult) {
  const parts = Object.fromEntries(
    Object.keys(result).map((type) => [type, previewPart({ ok: 1 })]),
  )
  const opened = await openPreview(previewOf(parts))
  vi.mocked(backupApi.restoreBackup).mockResolvedValueOnce(result)
  nextPreview(previewOf(parts))
  await pressRestore(opened.user)
  return opened
}

interface PreviewRead {
  file: File | undefined
  options: backupApi.BackupRestoreOptions | undefined
}

/** The file and the options of the last read of the preview. */
function lastPreviewRead(): PreviewRead {
  const [file, options] = vi.mocked(backupApi.validateBackup).mock.lastCall ?? []
  return { file, options }
}

function partCells(type: string): HTMLElement[] {
  return within(screen.getByTestId(`entity-row-${type}`)).getAllByRole('cell')
}

/** Total, OK, Conflicts, Fixable and Errors of a part row, as drawn. */
function partCounts(type: string): Array<string | null> {
  return partCells(type)
    .slice(2)
    .map((cell) => cell.textContent)
}

function partCheckbox(type: string): HTMLElement {
  return screen.getByTestId(`restore-checkbox-${type}`)
}

function rowToggle(type: string): HTMLElement {
  return screen.getByTestId(`entity-row-toggle-${type}`)
}

/** The parts whose detail row is drawn, in table order. */
function openRows(): string[] {
  return screen
    .queryAllByTestId(/^entity-row-items-/)
    .map((row) => (row.getAttribute('data-testid') ?? '').replace('entity-row-items-', ''))
}

function resultLine(type: string): HTMLElement {
  return screen.getByTestId(`restore-result-line-${type}`)
}

function resultToggle(type: string): HTMLElement {
  return screen.getByTestId(`restore-result-toggle-${type}`)
}

function restoreButton(): HTMLElement {
  return screen.getByTestId('restore-button')
}

function entryLines(container: HTMLElement): HTMLElement[] {
  return within(within(container).getByTestId('restore-item-list')).getAllByTestId('restore-item')
}

/** The item list inside the given element shows exactly these entries, in this order. */
function expectEntries(container: HTMLElement, items: backupApi.BackupItem[], stage: Stage) {
  const lines = entryLines(container)
  expect(lines.map((line) => line.getAttribute('data-status'))).toEqual(
    items.map((item) => item.status),
  )
  items.forEach((item, index) => {
    const reason =
      item.status === 'fatal' ? `${FATAL_OUTCOMES[stage]}. ${item.reason}` : item.reason
    expect(within(lines[index]).getByText(item.name)).toBeInTheDocument()
    expect(within(lines[index]).getByText(reason)).toBeInTheDocument()
  })
}

// ============================================================================
// Test Setup
// ============================================================================

beforeEach(() => {
  // The schedule comes in through the periodicBackup prop; a read from inside the tab stays pending.
  vi.mocked(backupApi.getSchedule).mockReturnValue(new Promise(() => {}))
})

// ============================================================================
// Tests
// ============================================================================

describe('BackupRestoreTab', () => {
  describe('Layout', () => {
    it('renders main container', () => {
      renderTab()
      expect(screen.getByTestId('backup-restore-tab')).toBeInTheDocument()
    })

    it('renders Create Backup section', () => {
      renderTab()
      expect(screen.getByTestId('create-backup-section')).toBeInTheDocument()
    })

    it('renders Restore from Backup section', () => {
      renderTab()
      expect(screen.getByTestId('restore-backup-section')).toBeInTheDocument()
    })

    it('renders Periodic Backup section', () => {
      renderTab()
      expect(screen.getByTestId('periodic-backup-section')).toBeInTheDocument()
    })

    it('renders section headings', () => {
      renderTab()
      expect(screen.getByText('Create Backup')).toBeInTheDocument()
      expect(screen.getByText('Restore from Backup')).toBeInTheDocument()
      expect(screen.getByText('Periodic Backup')).toBeInTheDocument()
    })

    it('gives the three sections headings of one level', () => {
      renderTab()
      for (const name of ['Create Backup', 'Restore from Backup', 'Periodic Backup']) {
        expect(screen.getByRole('heading', { level: 2, name })).toBeInTheDocument()
      }
    })
  })

  describe('Create Backup Section', () => {
    it('renders entity selector', () => {
      renderTab()
      const section = screen.getByTestId('create-backup-section')
      expect(within(section).getByTestId('entity-selector')).toBeInTheDocument()
    })

    it('renders format dropdown', () => {
      renderTab()
      const section = screen.getByTestId('create-backup-section')
      expect(within(section).getByTestId('format-select')).toBeInTheDocument()
    })

    it('renders compression method dropdown', () => {
      renderTab()
      const section = screen.getByTestId('create-backup-section')
      expect(within(section).getByTestId('compression-method-select')).toBeInTheDocument()
    })

    it('names the Format and Compression selects by their labels', () => {
      renderTab()
      const section = within(screen.getByTestId('create-backup-section'))
      expect(section.getByRole('combobox', { name: 'Format' })).toBe(
        section.getByTestId('format-select'),
      )
      expect(section.getByRole('combobox', { name: 'Compression' })).toBe(
        section.getByTestId('compression-method-select'),
      )
    })

    it('renders compression level slider', () => {
      renderTab()
      const section = screen.getByTestId('create-backup-section')
      expect(within(section).getByTestId('compression-level-slider')).toBeInTheDocument()
    })

    it('renders the secrets mode picker after the compression controls', () => {
      renderTab()
      const section = screen.getByTestId('create-backup-section')
      expect(within(section).getByTestId('secrets-mode-picker')).toBeInTheDocument()
    })

    it('no longer renders the include-credentials toggle', () => {
      renderTab()
      expect(screen.queryByTestId('include-credentials-toggle')).not.toBeInTheDocument()
    })

    it('renders Create & Download button', () => {
      renderTab()
      expect(screen.getByRole('button', { name: /create.*download/i })).toBeInTheDocument()
    })

    it('shows the backup plaintext warning when Decrypt is chosen', async () => {
      const user = userEvent.setup()
      renderTab()

      const section = screen.getByTestId('create-backup-section')
      await user.click(within(section).getByTestId('secrets-mode-plaintext'))

      expect(within(section).getByTestId('secrets-plaintext-warning')).toHaveTextContent(
        'Secrets will be written in plain text. Handle the backup file securely.',
      )
    })

    it('calls createBackup and shows progress', async () => {
      const user = userEvent.setup()
      vi.mocked(backupApi.createBackup).mockResolvedValue(
        new Blob(['zipdata'], { type: 'application/zip' })
      )

      renderTab()

      // Select at least one entity type
      const testsCheckbox = screen.getByTestId('entity-checkbox-tests')
      await user.click(testsCheckbox)

      const createBtn = screen.getByRole('button', { name: /create.*download/i })
      await user.click(createBtn)

      expect(backupApi.createBackup).toHaveBeenCalled()
    })

    it('downloads the created archive through the shared downloadBlob helper', async () => {
      const user = userEvent.setup()
      const archive = new Blob(['zipdata'], { type: 'application/zip' })
      vi.mocked(backupApi.createBackup).mockResolvedValue(archive)

      renderTab()

      await user.click(screen.getByTestId('entity-checkbox-tests'))
      await user.click(screen.getByRole('button', { name: /create.*download/i }))

      await waitFor(() => {
        expect(downloadBlob).toHaveBeenCalledWith(
          archive,
          expect.stringMatching(/^wave-backup-\d{4}-\d{2}-\d{2}\.zip$/)
        )
      })
    })

    it('does not call createBackup when no entities are selected (early return guard)', async () => {
      vi.mocked(backupApi.createBackup).mockClear()

      renderTab()

      const createBtn = screen.getByRole('button', { name: /create.*download/i })
      expect(createBtn).toBeDisabled()

      // Access React's internal onClick handler from the fiber to call it directly,
      // bypassing the disabled button restriction. This exercises the guard at line 71.
      const fiberKey = Object.keys(createBtn).find((k) => k.startsWith('__reactFiber'))
      if (fiberKey) {
        const fiber = (createBtn as unknown as Record<string, unknown>)[fiberKey] as {
          memoizedProps?: { onClick?: () => void }
        }
        if (fiber?.memoizedProps?.onClick) {
          await act(async () => {
            fiber.memoizedProps!.onClick!()
          })
        }
      }

      // The guard `if (selectedEntities.length === 0) return` prevents the call
      expect(backupApi.createBackup).not.toHaveBeenCalled()
    })

    it('says the backup was not created instead of just stopping the progress bar', async () => {
      const user = userEvent.setup()
      vi.mocked(backupApi.createBackup).mockRejectedValue(new Error('Disk is full'))
      vi.mocked(downloadBlob).mockClear()

      renderTab()

      await user.click(screen.getByTestId('entity-checkbox-tests'))
      await user.click(screen.getByRole('button', { name: /create.*download/i }))

      expect(await screen.findByTestId('create-backup-error')).toHaveTextContent('Disk is full')
      expect(screen.queryByTestId('create-progress')).not.toBeInTheDocument()
      expect(downloadBlob).not.toHaveBeenCalled()
    })

    it('reports a generic reason when createBackup rejects with a non-Error', async () => {
      const user = userEvent.setup()
      vi.mocked(backupApi.createBackup).mockRejectedValue('nope')

      renderTab()

      await user.click(screen.getByTestId('entity-checkbox-tests'))
      await user.click(screen.getByRole('button', { name: /create.*download/i }))

      expect(await screen.findByTestId('create-backup-error')).toHaveTextContent(
        'Failed to create the backup',
      )
    })

    it('re-enables Create & Download after a failure so the same button retries', async () => {
      const user = userEvent.setup()
      vi.useFakeTimers({ shouldAdvanceTime: true })
      vi.mocked(backupApi.createBackup)
        .mockRejectedValueOnce(new Error('Disk is full'))
        .mockResolvedValueOnce(new Blob(['zipdata'], { type: 'application/zip' }))
      vi.mocked(downloadBlob).mockClear()

      renderTab()

      await user.click(screen.getByTestId('entity-checkbox-tests'))
      await user.click(screen.getByRole('button', { name: /create.*download/i }))
      await screen.findByTestId('create-backup-error')

      // The finally-block timeout re-enables the button.
      await act(async () => {
        vi.advanceTimersByTime(600)
      })
      const createBtn = screen.getByRole('button', { name: /create.*download/i })
      expect(createBtn).toBeEnabled()

      await user.click(createBtn)
      await waitFor(() => {
        expect(screen.queryByTestId('create-backup-error')).not.toBeInTheDocument()
      })
      expect(downloadBlob).toHaveBeenCalled()

      await act(async () => {
        vi.advanceTimersByTime(600)
      })
      vi.useRealTimers()
    })

    it('names the progress bar of a running backup', async () => {
      const user = userEvent.setup()
      vi.useFakeTimers({ shouldAdvanceTime: true })
      const running = deferred<Blob>()
      vi.mocked(backupApi.createBackup).mockReturnValueOnce(running.promise)

      renderTab()

      await user.click(screen.getByTestId('entity-checkbox-tests'))
      await user.click(screen.getByRole('button', { name: /create.*download/i }))

      const progress = within(screen.getByTestId('create-progress'))
      expect(progress.getByRole('progressbar', { name: 'Backup progress' })).toBeInTheDocument()

      await answer(running, new Blob(['zipdata'], { type: 'application/zip' }))
      await act(async () => {
        vi.advanceTimersByTime(600)
      })
      vi.useRealTimers()
    })
  })

  describe('Restore from Backup Section', () => {
    it('renders upload zone with drag & drop text', () => {
      renderTab()
      expect(screen.getByTestId('upload-zone')).toBeInTheDocument()
      expect(screen.getByText(/click or drag.*drop/i)).toBeInTheDocument()
    })

    it('shows entity summary table after file upload', async () => {
      vi.mocked(backupApi.validateBackup).mockResolvedValue(mockValidateResult)

      renderTab()

      const file = new File(['zipdata'], 'backup.zip', { type: 'application/zip' })
      const input = screen.getByTestId('upload-input') as HTMLInputElement

      await userEvent.upload(input, file)

      expect(await screen.findByTestId('entity-summary-table')).toBeInTheDocument()
    })

    it('shows validation preview with backup metadata', async () => {
      vi.mocked(backupApi.validateBackup).mockResolvedValue(mockValidateResult)

      renderTab()

      const file = new File(['zipdata'], 'backup.zip', { type: 'application/zip' })
      const input = screen.getByTestId('upload-input') as HTMLInputElement
      await userEvent.upload(input, file)

      const preview = await screen.findByTestId('validation-preview')
      expect(preview).toBeInTheDocument()
      expect(within(preview).getByText('1.0.0')).toBeInTheDocument()
    })

    it('keeps the file name and the version out of page translation', async () => {
      vi.mocked(backupApi.validateBackup).mockResolvedValue(mockValidateResult)

      renderTab()

      const file = new File(['zipdata'], 'backup.zip', { type: 'application/zip' })
      await userEvent.upload(screen.getByTestId('upload-input'), file)

      const preview = within(await screen.findByTestId('validation-preview'))
      expect(preview.getByText('backup.zip')).toHaveAttribute('translate', 'no')
      expect(preview.getByText('1.0.0')).toHaveAttribute('translate', 'no')
    })

    it.each([
      ['utc', /^2026-03-07 12:00:00 UTC$/],
      ['local', /^2026-03-0[78] \d{2}:\d{2}:00 \S+$/],
    ] as const)('shows when the backup was created in the %s time zone mode', async (mode, text) => {
      useTimezoneStore.setState({ mode })
      vi.mocked(backupApi.validateBackup).mockResolvedValue(mockValidateResult)

      renderTab()

      const file = new File(['zipdata'], 'backup.zip', { type: 'application/zip' })
      await userEvent.upload(screen.getByTestId('upload-input'), file)

      const preview = within(await screen.findByTestId('validation-preview'))
      expect(preview.getByText('Created').nextElementSibling).toHaveTextContent(text)
      act(() => {
        useTimezoneStore.setState({ mode: 'local' })
      })
    })

    it('puts the file headings one level under the section heading', async () => {
      vi.mocked(backupApi.validateBackup).mockResolvedValue(mockValidateResult)

      renderTab()

      const file = new File(['zipdata'], 'backup.zip', { type: 'application/zip' })
      await userEvent.upload(screen.getByTestId('upload-input'), file)

      const section = within(screen.getByTestId('restore-backup-section'))
      expect(await section.findByRole('heading', { level: 3, name: 'Backup Details' })).toBeInTheDocument()
      expect(section.getByRole('heading', { level: 3, name: 'Entity Summary' })).toBeInTheDocument()
    })

    it('renders checkboxes per entity type in summary table', async () => {
      vi.mocked(backupApi.validateBackup).mockResolvedValue(mockValidateResult)

      renderTab()

      const file = new File(['zipdata'], 'backup.zip', { type: 'application/zip' })
      const input = screen.getByTestId('upload-input') as HTMLInputElement
      await userEvent.upload(input, file)

      expect(await screen.findByTestId('restore-checkbox-tests')).toBeInTheDocument()
      expect(screen.getByTestId('restore-checkbox-environments')).toBeInTheDocument()
    })

    it('names each summary checkbox by its entity type', async () => {
      vi.mocked(backupApi.validateBackup).mockResolvedValue(mockValidateResult)

      renderTab()

      const file = new File(['zipdata'], 'backup.zip', { type: 'application/zip' })
      await userEvent.upload(screen.getByTestId('upload-input'), file)

      const table = within(await screen.findByTestId('entity-summary-table'))
      expect(table.getByRole('checkbox', { name: 'tests' })).toBe(
        screen.getByTestId('restore-checkbox-tests'),
      )
      expect(table.getByRole('checkbox', { name: 'environments' })).toBe(
        screen.getByTestId('restore-checkbox-environments'),
      )
    })

    it('shows conflict resolution as radio buttons', async () => {
      vi.mocked(backupApi.validateBackup).mockResolvedValue(mockValidateResult)

      renderTab()

      const file = new File(['zipdata'], 'backup.zip', { type: 'application/zip' })
      const input = screen.getByTestId('upload-input') as HTMLInputElement
      await userEvent.upload(input, file)

      expect(await screen.findByTestId('conflict-resolution')).toBeInTheDocument()
      expect(screen.getByTestId('cr-skip')).toBeInTheDocument()
      expect(screen.getByTestId('cr-overwrite')).toBeInTheDocument()
      expect(screen.getByTestId('cr-rename')).toBeInTheDocument()
      expect(screen.getByRole('radiogroup', { name: 'Conflict Resolution' })).toBe(
        screen.getByTestId('conflict-resolution-radio'),
      )
    })

    it('shows auto-repair toggle when fixable entities exist', async () => {
      vi.mocked(backupApi.validateBackup).mockResolvedValue(mockValidateWithFixable)

      renderTab()

      const file = new File(['zipdata'], 'backup.zip', { type: 'application/zip' })
      const input = screen.getByTestId('upload-input') as HTMLInputElement
      await userEvent.upload(input, file)

      expect(await screen.findByTestId('auto-repair-toggle')).toBeInTheDocument()
      expect(screen.getByRole('switch', { name: 'Auto-repair fixable entities' })).toBe(
        screen.getByTestId('auto-repair-toggle'),
      )
    })

    it('does not show auto-repair toggle when no fixable entities', async () => {
      vi.mocked(backupApi.validateBackup).mockResolvedValue(mockValidateResult)

      renderTab()

      const file = new File(['zipdata'], 'backup.zip', { type: 'application/zip' })
      const input = screen.getByTestId('upload-input') as HTMLInputElement
      await userEvent.upload(input, file)

      await screen.findByTestId('validation-preview')
      expect(screen.queryByTestId('auto-repair-toggle')).not.toBeInTheDocument()
    })

    it('shows restore button with correct entity count', async () => {
      vi.mocked(backupApi.validateBackup).mockResolvedValue(mockValidateResult)

      renderTab()

      const file = new File(['zipdata'], 'backup.zip', { type: 'application/zip' })
      const input = screen.getByTestId('upload-input') as HTMLInputElement
      await userEvent.upload(input, file)

      const restoreBtn = await screen.findByTestId('restore-button')
      // 2 ok tests + 0 ok envs + 1 conflict env = 3 (fixable=0, auto-repair off)
      expect(restoreBtn).toHaveTextContent('Restore 3 entities')
    })

    it('unchecking entity type reduces restore count', async () => {
      vi.mocked(backupApi.validateBackup).mockResolvedValue(mockValidateResult)

      renderTab()

      const file = new File(['zipdata'], 'backup.zip', { type: 'application/zip' })
      const input = screen.getByTestId('upload-input') as HTMLInputElement
      await userEvent.upload(input, file)

      // Uncheck tests type
      const testsCheckbox = await screen.findByTestId('restore-checkbox-tests')
      await userEvent.click(testsCheckbox)

      const restoreBtn = screen.getByTestId('restore-button')
      // Only environments: 0 ok + 1 conflict = 1
      expect(restoreBtn).toHaveTextContent(/^Restore 1 entity$/)
    })

    it('calls restoreBackup with selected options', async () => {
      vi.mocked(backupApi.validateBackup).mockResolvedValue(mockValidateResult)
      vi.mocked(backupApi.restoreBackup).mockResolvedValue({
        tests: { imported: 2, skipped: 0, fatal: 0, items: [] },
        environments: { imported: 1, skipped: 0, fatal: 0, items: [] },
      })

      renderTab()

      const file = new File(['zipdata'], 'backup.zip', { type: 'application/zip' })
      const input = screen.getByTestId('upload-input') as HTMLInputElement
      await userEvent.upload(input, file)

      const restoreBtn = await screen.findByTestId('restore-button')
      await userEvent.click(restoreBtn)

      expect(backupApi.restoreBackup).toHaveBeenCalled()
    })

    it('shows restore results after successful restore', async () => {
      vi.mocked(backupApi.validateBackup).mockResolvedValue(mockValidateResult)
      vi.mocked(backupApi.restoreBackup).mockResolvedValue({
        tests: { imported: 2, skipped: 0, fatal: 0, items: [] },
        environments: { imported: 1, skipped: 0, fatal: 0, items: [] },
      })

      renderTab()

      const file = new File(['zipdata'], 'backup.zip', { type: 'application/zip' })
      const input = screen.getByTestId('upload-input') as HTMLInputElement
      await userEvent.upload(input, file)

      const restoreBtn = await screen.findByTestId('restore-button')
      await userEvent.click(restoreBtn)

      expect(await screen.findByTestId('restore-result')).toBeInTheDocument()
    })

    it('names system variables, SSH hosts and certificates as the pickers do, in the table and in the result', async () => {
      vi.mocked(backupApi.validateBackup).mockResolvedValue({
        ...mockValidateResult,
        entity_summary: {
          system_variables: { total: 4, ok: 4, conflicts: 0, fixable: 0, fatal: 0, items: [] },
          ssh_hosts: { total: 2, ok: 2, conflicts: 0, fixable: 0, fatal: 0, items: [] },
          certificates: { total: 1, ok: 1, conflicts: 0, fixable: 0, fatal: 0, items: [] },
        },
      })
      vi.mocked(backupApi.restoreBackup).mockResolvedValue({
        system_variables: { imported: 4, skipped: 0, fatal: 0, items: [] },
        ssh_hosts: { imported: 1, skipped: 1, fatal: 0, items: [] },
        certificates: { imported: 1, skipped: 0, fatal: 0, items: [] },
      })

      renderTab()

      const file = new File(['zipdata'], 'backup.zip', { type: 'application/zip' })
      await userEvent.upload(screen.getByTestId('upload-input'), file)

      const restoreBtn = await screen.findByTestId('restore-button')
      const typeCell = (type: string) =>
        within(screen.getByTestId(`entity-row-${type}`)).getAllByRole('cell')[1]
      expect(typeCell('system_variables')).toHaveTextContent(/^System Variables$/)
      expect(typeCell('ssh_hosts')).toHaveTextContent(/^SSH Hosts$/)
      expect(typeCell('certificates')).toHaveTextContent(/^Additional Certificates$/)

      await userEvent.click(restoreBtn)

      const result = await screen.findByTestId('restore-result')
      expect(result).toHaveTextContent('System Variables: 4 imported, 0 skipped')
      expect(result).toHaveTextContent('SSH Hosts: 1 imported, 1 skipped')
      expect(result).toHaveTextContent('Additional Certificates: 1 imported, 0 skipped')
    })

    it('clears file and validation on clear button', async () => {
      vi.mocked(backupApi.validateBackup).mockResolvedValue(mockValidateResult)

      renderTab()

      const file = new File(['zipdata'], 'backup.zip', { type: 'application/zip' })
      const input = screen.getByTestId('upload-input') as HTMLInputElement
      await userEvent.upload(input, file)

      await screen.findByTestId('validation-preview')

      const clearBtn = screen.getByTestId('clear-file-button')
      await userEvent.click(clearBtn)

      // Upload zone should reappear
      expect(screen.getByTestId('upload-zone')).toBeInTheDocument()
      expect(screen.queryByTestId('validation-preview')).not.toBeInTheDocument()
    })

    it('auto-repair toggle increases restorable count', async () => {
      vi.mocked(backupApi.validateBackup).mockResolvedValue(mockValidateWithFixable)

      renderTab()

      const file = new File(['zipdata'], 'backup.zip', { type: 'application/zip' })
      const input = screen.getByTestId('upload-input') as HTMLInputElement
      await userEvent.upload(input, file)

      // Without auto-repair: tests=1ok+1conflict, envs=1ok = 3
      const restoreBtn = await screen.findByTestId('restore-button')
      expect(restoreBtn).toHaveTextContent('Restore 3 entities')

      // Enable auto-repair
      const toggle = screen.getByTestId('auto-repair-toggle')
      await userEvent.click(toggle)

      // With auto-repair: tests=1ok+1conflict+1fixable, envs=1ok = 4
      expect(restoreBtn).toHaveTextContent('Restore 4 entities')
    })

    it('does not show conflict resolution when no conflicts', async () => {
      const noConflicts: backupApi.BackupValidateResult = {
        metadata: mockValidateResult.metadata,
        entity_summary: {
          tests: { total: 2, ok: 2, conflicts: 0, fixable: 0, fatal: 0, items: [] },
        },
      }
      vi.mocked(backupApi.validateBackup).mockResolvedValue(noConflicts)

      renderTab()

      const file = new File(['zipdata'], 'backup.zip', { type: 'application/zip' })
      const input = screen.getByTestId('upload-input') as HTMLInputElement
      await userEvent.upload(input, file)

      await screen.findByTestId('validation-preview')
      expect(screen.queryByTestId('conflict-resolution')).not.toBeInTheDocument()
    })

    it('processes file via drag and drop onto the drop zone', async () => {
      vi.mocked(backupApi.validateBackup).mockResolvedValue(mockValidateResult)

      renderTab()

      const dropZone = screen.getByTestId('upload-zone')
      const file = new File(['zipdata'], 'dropped-backup.zip', { type: 'application/zip' })

      // The window-level drop handler checks zone.contains(e.target)
      // Fire the drop event from inside the drop zone so it bubbles to window
      fireEvent.drop(dropZone, {
        dataTransfer: { files: [file] },
      })

      // After drop, validation should run and summary should appear
      expect(await screen.findByTestId('entity-summary-table')).toBeInTheDocument()
      expect(backupApi.validateBackup).toHaveBeenCalledWith(file, {
        conflict_resolution: 'skip',
        auto_repair: false,
      })
    })

    it('stops the restore progress interval when restoreBackup fails', async () => {
      vi.mocked(backupApi.validateBackup).mockResolvedValue(mockValidateResult)
      vi.mocked(backupApi.restoreBackup).mockRejectedValue(new Error('Restore failed'))

      vi.useFakeTimers({ shouldAdvanceTime: true })

      renderTab()

      const file = new File(['zipdata'], 'backup.zip', { type: 'application/zip' })
      const input = screen.getByTestId('upload-input') as HTMLInputElement
      await userEvent.upload(input, file)

      const restoreBtn = await screen.findByTestId('restore-button')
      await userEvent.click(restoreBtn)

      // The failure is reported, and no restore result is shown.
      expect(await screen.findByTestId('restore-backup-error')).toBeInTheDocument()
      expect(screen.queryByTestId('restore-result')).not.toBeInTheDocument()

      // Advance past the setTimeout(500) in finally block
      await act(async () => {
        vi.advanceTimersByTime(600)
      })

      vi.useRealTimers()
    })

    it('shows progress during restore operation', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true })

      vi.mocked(backupApi.validateBackup).mockResolvedValue(mockValidateResult)
      // Make restore take a while so we can observe the progress interval
      let resolveRestore: (value: backupApi.BackupRestoreResult) => void
      vi.mocked(backupApi.restoreBackup).mockImplementation(
        () =>
          new Promise((resolve) => {
            resolveRestore = resolve
          })
      )

      renderTab()

      const file = new File(['zipdata'], 'backup.zip', { type: 'application/zip' })
      const input = screen.getByTestId('upload-input') as HTMLInputElement
      await userEvent.upload(input, file)

      const restoreBtn = await screen.findByTestId('restore-button')
      await userEvent.click(restoreBtn)

      // Progress bar should appear
      expect(screen.getByTestId('restore-progress')).toBeInTheDocument()

      // Advance timer to trigger interval callback (200ms step)
      await act(async () => {
        vi.advanceTimersByTime(200)
      })

      // Progress should have advanced (showing "Restoring…" in the progress area)
      const progressArea = screen.getByTestId('restore-progress')
      expect(within(progressArea).getByText('Restoring…')).toBeInTheDocument()
      expect(within(progressArea).getByText('Restoring…')).toHaveAttribute('aria-live', 'polite')

      // Advance enough times for progress to hit >= 95 and stop
      await act(async () => {
        vi.advanceTimersByTime(2000)
      })

      // Now resolve the restore
      await act(async () => {
        resolveRestore!({
          tests: { imported: 2, skipped: 0, fatal: 0, items: [] },
          environments: { imported: 1, skipped: 0, fatal: 0, items: [] },
        })
      })

      // Should show "Complete"
      await waitFor(() => {
        expect(screen.getByText('Complete')).toBeInTheDocument()
      })

      // Advance past the setTimeout(500) in finally
      await act(async () => {
        vi.advanceTimersByTime(600)
      })

      vi.useRealTimers()
    })

    it('advances progress via setInterval during backup creation', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true })

      // Mock createBackup to return a promise we control
      let resolveCreate: (value: Blob) => void
      vi.mocked(backupApi.createBackup).mockImplementation(
        () =>
          new Promise((resolve) => {
            resolveCreate = resolve
          })
      )

      renderTab()

      // Select one entity type so the button is enabled
      const testsCheckbox = screen.getByTestId('entity-checkbox-tests')
      await userEvent.click(testsCheckbox)

      const createBtn = screen.getByRole('button', { name: /create.*download/i })
      await userEvent.click(createBtn)

      // Progress bar should appear at 0
      expect(screen.getByTestId('create-progress')).toBeInTheDocument()

      // Advance timer to trigger the interval callback (200ms intervals)
      await act(async () => {
        vi.advanceTimersByTime(200)
      })

      // With 1 entity, step=100, so first tick current=100 >= 95 -> clearInterval, setProgress(95)
      const progressArea = screen.getByTestId('create-progress')
      expect(within(progressArea).getByText('Creating backup…')).toBeInTheDocument()
      expect(within(progressArea).getByText('Creating backup…')).toHaveAttribute(
        'aria-live',
        'polite',
      )

      // Now resolve the createBackup promise
      await act(async () => {
        resolveCreate!(new Blob(['zipdata'], { type: 'application/zip' }))
      })

      // Should show "Complete" after resolve
      await waitFor(() => {
        expect(screen.getByText('Complete')).toBeInTheDocument()
      })

      // Advance past the setTimeout(500) in finally
      await act(async () => {
        vi.advanceTimersByTime(600)
      })

      vi.useRealTimers()
    })

    it('advances progress with intermediate steps when multiple entities selected', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true })

      // Mock createBackup to return a promise we control
      let resolveCreate: (value: Blob) => void
      vi.mocked(backupApi.createBackup).mockImplementation(
        () =>
          new Promise((resolve) => {
            resolveCreate = resolve
          })
      )

      renderTab()

      // Select multiple entity types so step < 95 (e.g., 4 entities -> step=25)
      const testsCheckbox = screen.getByTestId('entity-checkbox-tests')
      const suitesCheckbox = screen.getByTestId('entity-checkbox-suites')
      const envsCheckbox = screen.getByTestId('entity-checkbox-environments')
      const profilesCheckbox = screen.getByTestId('entity-checkbox-profiles')
      await userEvent.click(testsCheckbox)
      await userEvent.click(suitesCheckbox)
      await userEvent.click(envsCheckbox)
      await userEvent.click(profilesCheckbox)

      const createBtn = screen.getByRole('button', { name: /create.*download/i })
      await userEvent.click(createBtn)

      // Advance 200ms -> first interval tick: current=25 < 95, setProgress(25) - covers line 84
      await act(async () => {
        vi.advanceTimersByTime(200)
      })

      expect(screen.getByTestId('create-progress')).toBeInTheDocument()

      // Advance more ticks to reach >= 95: 25, 50, 75, 100 -> 100 >= 95, clearInterval - covers lines 80-82
      await act(async () => {
        vi.advanceTimersByTime(600)
      })

      // Now resolve
      await act(async () => {
        resolveCreate!(new Blob(['zipdata'], { type: 'application/zip' }))
      })

      await waitFor(() => {
        expect(screen.getByText('Complete')).toBeInTheDocument()
      })

      await act(async () => {
        vi.advanceTimersByTime(600)
      })

      vi.useRealTimers()
    })

    it('clears interval in catch block when createBackup fails', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true })

      vi.mocked(backupApi.createBackup).mockRejectedValue(new Error('Backup failed'))

      renderTab()

      // Select an entity type
      const testsCheckbox = screen.getByTestId('entity-checkbox-tests')
      await userEvent.click(testsCheckbox)

      const createBtn = screen.getByRole('button', { name: /create.*download/i })
      await userEvent.click(createBtn)

      // The error is caught - progress should appear briefly
      await waitFor(() => {
        expect(backupApi.createBackup).toHaveBeenCalled()
      })

      // Advance past the setTimeout(500) in finally block to clean up
      await act(async () => {
        vi.advanceTimersByTime(600)
      })

      // After error + finally timeout, progress should be cleared (no crash, no download)
      expect(screen.queryByTestId('create-progress')).not.toBeInTheDocument()
      expect(screen.getByTestId('create-backup-error')).toBeInTheDocument()

      vi.useRealTimers()
    })

    it('sets dragOver state on dragover events inside drop zone', async () => {
      renderTab()

      const dropZone = screen.getByTestId('upload-zone')

      // Fire dragover event on the drop zone element (window handler captures it)
      await act(async () => {
        fireEvent.dragOver(dropZone, {
          dataTransfer: { dropEffect: 'none' },
        })
      })

      // The drop zone should have the active drag-over styling (border-primary)
      expect(dropZone.className).toContain('border-primary')
    })

    it('clears dragOver state on dragover outside drop zone', async () => {
      renderTab()

      const dropZone = screen.getByTestId('upload-zone')

      // First, dragover inside the zone to activate dragOver state
      await act(async () => {
        fireEvent.dragOver(dropZone, {
          dataTransfer: { dropEffect: 'none' },
        })
      })

      expect(dropZone.className).toContain('border-primary')

      // Now fire dragover on a target outside the drop zone (e.g., document body)
      await act(async () => {
        fireEvent.dragOver(document.body, {
          dataTransfer: { dropEffect: 'none' },
        })
      })

      // The drop zone should lose the active styling
      expect(dropZone.className).not.toContain('border-primary bg-primary/5')
    })

    it('clears dragOver state on dragleave when leaving drop zone', async () => {
      renderTab()

      const dropZone = screen.getByTestId('upload-zone')

      // Activate dragOver state
      await act(async () => {
        fireEvent.dragOver(dropZone, {
          dataTransfer: { dropEffect: 'none' },
        })
      })

      expect(dropZone.className).toContain('border-primary')

      // Fire dragleave with relatedTarget outside the drop zone
      await act(async () => {
        fireEvent.dragLeave(dropZone, {
          relatedTarget: document.body,
        })
      })

      // dragOver should be false, no active styling
      expect(dropZone.className).not.toContain('border-primary bg-primary/5')
    })

    it('ignores file input change event when no file is selected', async () => {
      vi.mocked(backupApi.validateBackup).mockClear()

      renderTab()

      const input = screen.getByTestId('upload-input') as HTMLInputElement

      // Fire change event with empty file list (simulates user canceling file dialog)
      fireEvent.change(input, { target: { files: [] } })

      // validateBackup should NOT have been called since no file was provided
      expect(backupApi.validateBackup).not.toHaveBeenCalled()
      // Upload zone should still be visible
      expect(screen.getByTestId('upload-zone')).toBeInTheDocument()
    })

    it('exercises fileInputRef.current value reset in handleClear', async () => {
      // Line 293: `if (fileInputRef.current) fileInputRef.current.value = ''`
      // The upload zone (with the hidden input) and the validation preview
      // (with the clear button) are in mutually exclusive render branches.
      // To exercise the truthy path, we need fileInputRef.current to be
      // non-null when handleClear runs. We achieve this by capturing the
      // input element ref before it unmounts and reassigning it to the
      // ref via React fiber internals.
      vi.mocked(backupApi.validateBackup).mockResolvedValue(mockValidateResult)

      renderTab()

      // Capture the hidden input element BEFORE uploading (while it's mounted)
      const input = screen.getByTestId('upload-input') as HTMLInputElement

      // Find the React fiber for this input to access its ref
      const fiberKey = Object.keys(input).find((k) => k.startsWith('__reactFiber'))
      let refObject: { current: HTMLInputElement | null } | null = null
      if (fiberKey) {
        let fiber = (input as unknown as Record<string, unknown>)[fiberKey] as {
          ref?: { current: HTMLInputElement | null }
          return?: unknown
        }
        // The ref is on the fiber
        if (fiber?.ref && typeof fiber.ref === 'object' && 'current' in fiber.ref) {
          refObject = fiber.ref as { current: HTMLInputElement | null }
        }
      }

      // Upload a file - this will unmount the input and null the ref
      await userEvent.upload(input, new File(['zipdata'], 'backup.zip', { type: 'application/zip' }))
      await screen.findByTestId('validation-preview')

      // Re-assign the ref's current to the captured input element
      // so that handleClear's `if (fileInputRef.current)` check is truthy
      if (refObject) {
        refObject.current = input
      }

      const clearBtn = screen.getByTestId('clear-file-button')
      await userEvent.click(clearBtn)

      // After clear, the input value should have been reset via the ref
      expect(input.value).toBe('')
      expect(screen.getByTestId('upload-zone')).toBeInTheDocument()
    })

    it('re-checks a previously unchecked entity type', async () => {
      vi.mocked(backupApi.validateBackup).mockResolvedValue(mockValidateResult)

      renderTab()

      const file = new File(['zipdata'], 'backup.zip', { type: 'application/zip' })
      const input = screen.getByTestId('upload-input') as HTMLInputElement
      await userEvent.upload(input, file)

      const restoreBtn = await screen.findByTestId('restore-button')
      // Initially both types selected: 2 ok + 0 ok + 1 conflict = 3
      expect(restoreBtn).toHaveTextContent('Restore 3 entities')

      // Uncheck tests
      const testsCheckbox = screen.getByTestId('restore-checkbox-tests')
      await userEvent.click(testsCheckbox)
      // Only environments: 0 ok + 1 conflict = 1
      expect(restoreBtn).toHaveTextContent(/^Restore 1 entity$/)

      // Re-check tests (covers the [...prev, entityType] branch)
      await userEvent.click(testsCheckbox)
      // Back to 3
      expect(restoreBtn).toHaveTextContent('Restore 3 entities')
    })

    it('disables restore button when all entity types are unchecked', async () => {
      // The restore button is disabled when selectedTypes is empty or
      // restorableCount is 0. This, combined with the defense guard at line 303
      // (`if (!file || !validationResult) return`), prevents invalid restores.
      vi.mocked(backupApi.restoreBackup).mockClear()
      vi.mocked(backupApi.validateBackup).mockResolvedValue(mockValidateResult)

      renderTab()

      const file = new File(['zipdata'], 'backup.zip', { type: 'application/zip' })
      const input = screen.getByTestId('upload-input') as HTMLInputElement
      await userEvent.upload(input, file)

      const restoreBtn = await screen.findByTestId('restore-button')

      // Uncheck all entity types to make button disabled
      const testsCheckbox = screen.getByTestId('restore-checkbox-tests')
      const envsCheckbox = screen.getByTestId('restore-checkbox-environments')
      await userEvent.click(testsCheckbox)
      await userEvent.click(envsCheckbox)

      expect(restoreBtn).toBeDisabled()
      expect(restoreBtn).toHaveTextContent('Restore 0 entities')
    })

    it('handles entity type without summary entry in restorableCount', async () => {
      // Create a mutable entity_summary. After the component processes it for
      // rendering, we delete a key so that on the next re-render cycle,
      // selectedTypes contains a type no longer in entity_summary, triggering
      // the `if (!s) return sum` guard at line 342.
      const mutableSummary: Record<string, backupApi.BackupEntitySummary> = {
        tests: { total: 2, ok: 2, conflicts: 0, fixable: 0, fatal: 0, items: [] },
        suites: { total: 1, ok: 1, conflicts: 0, fixable: 0, fatal: 0, items: [] },
      }
      const mutableValidation: backupApi.BackupValidateResult = {
        metadata: mockValidateResult.metadata,
        entity_summary: mutableSummary,
      }
      vi.mocked(backupApi.validateBackup).mockResolvedValue(mutableValidation)

      renderTab()

      const file = new File(['zipdata'], 'backup.zip', { type: 'application/zip' })
      const input = screen.getByTestId('upload-input') as HTMLInputElement
      await userEvent.upload(input, file)

      // Wait for table to appear with both types
      const restoreBtn = await screen.findByTestId('restore-button')
      expect(restoreBtn).toHaveTextContent('Restore 3 entities')

      // Now delete 'suites' from the entity_summary. selectedTypes still
      // contains 'suites' (it was set from Object.keys during processFile).
      // On the next re-render, restorableCount reduce iterates selectedTypes
      // and entity_summary['suites'] is now undefined -> triggers `if (!s) return sum`.
      delete mutableSummary.suites

      // Trigger a re-render by toggling tests checkbox off and on
      const testsCheckbox = screen.getByTestId('restore-checkbox-tests')
      await userEvent.click(testsCheckbox) // uncheck tests
      await userEvent.click(testsCheckbox) // re-check tests

      // After re-render with suites deleted from summary, restorableCount
      // should only count tests (2 ok), suites entry returns undefined
      expect(restoreBtn).toHaveTextContent('Restore 2 entities')
    })

    it('shows "Encrypted" when the manifest secrets mode is encrypted', async () => {
      const encrypted: backupApi.BackupValidateResult = {
        metadata: {
          ...mockValidateResult.metadata,
          secrets: 'encrypted',
        },
        entity_summary: {
          tests: { total: 2, ok: 2, conflicts: 0, fixable: 0, fatal: 0, items: [] },
        },
      }
      vi.mocked(backupApi.validateBackup).mockResolvedValue(encrypted)

      renderTab()

      const file = new File(['zipdata'], 'backup.zip', { type: 'application/zip' })
      const input = screen.getByTestId('upload-input') as HTMLInputElement
      await userEvent.upload(input, file)

      const preview = await screen.findByTestId('validation-preview')
      expect(within(preview).getByText('Encrypted')).toBeInTheDocument()
    })

    it('shows "Plain text" when the manifest secrets mode is plaintext', async () => {
      const plaintext: backupApi.BackupValidateResult = {
        metadata: {
          ...mockValidateResult.metadata,
          secrets: 'plaintext',
        },
        entity_summary: {
          tests: { total: 2, ok: 2, conflicts: 0, fixable: 0, fatal: 0, items: [] },
        },
      }
      vi.mocked(backupApi.validateBackup).mockResolvedValue(plaintext)

      renderTab()

      const file = new File(['zipdata'], 'backup.zip', { type: 'application/zip' })
      const input = screen.getByTestId('upload-input') as HTMLInputElement
      await userEvent.upload(input, file)

      const preview = await screen.findByTestId('validation-preview')
      expect(within(preview).getByText('Plain text')).toBeInTheDocument()
    })

    it('shows "Masked" when the manifest secrets mode is mask', async () => {
      vi.mocked(backupApi.validateBackup).mockResolvedValue(mockValidateResult)

      renderTab()

      const file = new File(['zipdata'], 'backup.zip', { type: 'application/zip' })
      const input = screen.getByTestId('upload-input') as HTMLInputElement
      await userEvent.upload(input, file)

      const preview = await screen.findByTestId('validation-preview')
      expect(within(preview).getByText('Masked')).toBeInTheDocument()
    })

    it('displays fatal count in restore result when fatal > 0', async () => {
      vi.mocked(backupApi.validateBackup).mockResolvedValue(mockValidateResult)
      vi.mocked(backupApi.restoreBackup).mockResolvedValue({
        tests: { imported: 1, skipped: 0, fatal: 2, items: [] },
        environments: { imported: 1, skipped: 0, fatal: 0, items: [] },
      })

      renderTab()

      const file = new File(['zipdata'], 'backup.zip', { type: 'application/zip' })
      const input = screen.getByTestId('upload-input') as HTMLInputElement
      await userEvent.upload(input, file)

      const restoreBtn = await screen.findByTestId('restore-button')
      await userEvent.click(restoreBtn)

      const resultDiv = await screen.findByTestId('restore-result')
      // tests line should show fatal count: "1 imported, 0 skipped, 2 failed"
      expect(resultDiv).toHaveTextContent('2 failed')
      // environments line should NOT show fatal since fatal=0
      // Verify the full tests line
      expect(resultDiv).toHaveTextContent('1 imported')
    })

    it('says the restore failed instead of leaving the user believing it worked', async () => {
      vi.mocked(backupApi.validateBackup).mockResolvedValue(mockValidateResult)
      vi.mocked(backupApi.restoreBackup).mockRejectedValue(new Error('Storage is read-only'))

      renderTab()

      const file = new File(['zipdata'], 'backup.zip', { type: 'application/zip' })
      await userEvent.upload(screen.getByTestId('upload-input'), file)
      await userEvent.click(await screen.findByTestId('restore-button'))

      expect(await screen.findByTestId('restore-backup-error')).toHaveTextContent(
        'Storage is read-only',
      )
      expect(screen.queryByTestId('restore-result')).not.toBeInTheDocument()
      expect(screen.queryByTestId('restore-progress')).not.toBeInTheDocument()
    })

    it('reports a generic reason when the restore rejects with a non-Error', async () => {
      vi.mocked(backupApi.validateBackup).mockResolvedValue(mockValidateResult)
      vi.mocked(backupApi.restoreBackup).mockRejectedValue('nope')

      renderTab()

      const file = new File(['zipdata'], 'backup.zip', { type: 'application/zip' })
      await userEvent.upload(screen.getByTestId('upload-input'), file)
      await userEvent.click(await screen.findByTestId('restore-button'))

      expect(await screen.findByTestId('restore-backup-error')).toHaveTextContent(
        'Failed to restore the backup',
      )
    })

    it('drops the reported restore failure once a later restore succeeds', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true })
      vi.mocked(backupApi.validateBackup).mockResolvedValue(mockValidateResult)
      vi.mocked(backupApi.restoreBackup)
        .mockRejectedValueOnce(new Error('Storage is read-only'))
        .mockResolvedValueOnce({ tests: { imported: 2, skipped: 0, fatal: 0, items: [] } })

      renderTab()

      const file = new File(['zipdata'], 'backup.zip', { type: 'application/zip' })
      await userEvent.upload(screen.getByTestId('upload-input'), file)
      await userEvent.click(await screen.findByTestId('restore-button'))
      await screen.findByTestId('restore-backup-error')

      await act(async () => {
        vi.advanceTimersByTime(600)
      })
      await userEvent.click(screen.getByTestId('restore-button'))

      await waitFor(() => {
        expect(screen.queryByTestId('restore-backup-error')).not.toBeInTheDocument()
      })
      expect(await screen.findByTestId('restore-result')).toBeInTheDocument()

      await act(async () => {
        vi.advanceTimersByTime(600)
      })
      vi.useRealTimers()
    })

    it('says the backup file could not be read when validation fails', async () => {
      vi.mocked(backupApi.validateBackup).mockRejectedValue(new Error('Archive is corrupt'))

      renderTab()

      const file = new File(['zipdata'], 'backup.zip', { type: 'application/zip' })
      await userEvent.upload(screen.getByTestId('upload-input'), file)

      expect(await screen.findByTestId('restore-validate-error')).toHaveTextContent(
        'Archive is corrupt',
      )
      // No summary table is offered for an archive that was never read.
      expect(screen.queryByTestId('entity-summary-table')).not.toBeInTheDocument()
      // The upload zone stays, so picking a file again is the retry.
      expect(screen.getByTestId('upload-zone')).toBeInTheDocument()
    })

    it('reports a generic reason when validation rejects with a non-Error', async () => {
      vi.mocked(backupApi.validateBackup).mockRejectedValue('nope')

      renderTab()

      const file = new File(['zipdata'], 'backup.zip', { type: 'application/zip' })
      await userEvent.upload(screen.getByTestId('upload-input'), file)

      expect(await screen.findByTestId('restore-validate-error')).toHaveTextContent(
        'Failed to read the backup file',
      )
    })

    it('drops the reported read failure once another file validates', async () => {
      vi.mocked(backupApi.validateBackup)
        .mockRejectedValueOnce(new Error('Archive is corrupt'))
        .mockResolvedValueOnce(mockValidateResult)

      renderTab()

      const input = screen.getByTestId('upload-input')
      await userEvent.upload(input, new File(['bad'], 'bad.zip', { type: 'application/zip' }))
      await screen.findByTestId('restore-validate-error')

      await userEvent.upload(input, new File(['ok'], 'good.zip', { type: 'application/zip' }))

      expect(await screen.findByTestId('entity-summary-table')).toBeInTheDocument()
      expect(screen.queryByTestId('restore-validate-error')).not.toBeInTheDocument()
    })

    it('clears a reported restore failure when the file is cleared', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true })
      vi.mocked(backupApi.validateBackup).mockResolvedValue(mockValidateResult)
      vi.mocked(backupApi.restoreBackup).mockRejectedValue(new Error('Storage is read-only'))

      renderTab()

      const file = new File(['zipdata'], 'backup.zip', { type: 'application/zip' })
      await userEvent.upload(screen.getByTestId('upload-input'), file)
      await userEvent.click(await screen.findByTestId('restore-button'))
      await screen.findByTestId('restore-backup-error')

      await act(async () => {
        vi.advanceTimersByTime(600)
      })
      await userEvent.click(screen.getByTestId('clear-file-button'))

      expect(screen.queryByTestId('restore-backup-error')).not.toBeInTheDocument()
      vi.useRealTimers()
    })

    describe('table', () => {
      onFakeClock()

      it('draws the parts in the order the server sent them', async () => {
        await openPreview(
          previewOf({
            suites: previewPart({ ok: 1 }),
            certificates: previewPart({ ok: 1 }),
            tests: previewPart({ ok: 2 }),
            environments: previewPart({ ok: 1 }),
          }),
        )

        const rows = within(screen.getByTestId('entity-summary-table')).getAllByTestId(
          /^entity-row-/,
        )
        expect(rows.map((row) => row.getAttribute('data-testid'))).toEqual([
          'entity-row-suites',
          'entity-row-certificates',
          'entity-row-tests',
          'entity-row-environments',
        ])
      })

      it('shows a toggle only on a part with entries', async () => {
        await openPreview(
          previewOf({
            tests: previewPart({ ok: 1, conflicts: 1 }, [conflictItem('Checkout smoke')]),
            environments: previewPart({ ok: 1 }),
          }),
        )

        expect(partCells('tests')[1]).toContainElement(rowToggle('tests'))
        const plainCell = partCells('environments')[1]
        expect(screen.queryByTestId('entity-row-toggle-environments')).not.toBeInTheDocument()
        expect(plainCell.querySelector('button')).not.toBeInTheDocument()
        expect(plainCell.querySelector('[aria-hidden="true"]')).toBeInTheDocument()
      })

      it('makes the name part of the toggle', async () => {
        const { user } = await openPreview(
          previewOf({
            tests: previewPart({ ok: 1, conflicts: 1 }, [conflictItem('Checkout smoke')]),
          }),
        )
        const name = within(rowToggle('tests')).getByText('tests')
        expect(openRows()).toEqual([])

        await user.click(name)

        expect(openRows()).toEqual(['tests'])
      })

      it("labels the toggle with the checkbox's name", async () => {
        const { user } = await openPreview(
          previewOf({
            tests: previewPart({ ok: 1, conflicts: 1 }, [conflictItem('Checkout smoke')]),
            system_variables: previewPart({ conflicts: 1 }, [conflictItem('System variables')]),
          }),
        )

        expect(rowToggle('tests')).toHaveAccessibleName('Expand tests')
        expect(rowToggle('system_variables')).toHaveAccessibleName('Expand System Variables')

        await user.click(rowToggle('tests'))

        expect(rowToggle('tests')).toHaveAccessibleName('Collapse tests')
      })

      it('keeps seven cells in a part row that has a toggle', async () => {
        await openPreview(
          previewOf({
            tests: previewPart({ ok: 1, fatal: 1 }, [fatalItem('Login flow')]),
            environments: previewPart({ conflicts: 1 }, [conflictItem('staging')]),
          }),
        )

        for (const type of ['tests', 'environments']) {
          const cells = partCells(type)
          expect(cells).toHaveLength(7)
          expect(cells[1]).toContainElement(rowToggle(type))
        }
      })

      it('keeps the row checkbox named by the part alone', async () => {
        await openPreview(
          previewOf({
            tests: previewPart({ ok: 1, conflicts: 1 }, [conflictItem('Checkout smoke')]),
          }),
        )

        const table = within(screen.getByTestId('entity-summary-table'))
        expect(table.getByRole('checkbox', { name: 'tests' })).toBe(partCheckbox('tests'))
        // jsdom reads a button inside the label by its text, so the reference itself is checked too.
        const name = within(rowToggle('tests')).getByText('tests')
        expect(name).toHaveAttribute('id')
        expect(partCheckbox('tests')).toHaveAttribute('aria-labelledby', name.id)
      })

      it('shows a Functions row', async () => {
        await openPreview(previewOf({ functions: previewPart({ ok: 3 }) }))

        const typeCell = partCells('functions')[1]
        expect(typeCell).toHaveTextContent(/^functions$/)
        expect(within(typeCell).getByText('functions')).toHaveClass('capitalize')
      })

      it('names the last count column Errors', async () => {
        await openPreview(
          previewOf({ tests: previewPart({ ok: 1, fatal: 1 }, [fatalItem('Login flow')]) }),
        )

        const table = within(screen.getByTestId('entity-summary-table'))
        expect(table.getAllByRole('columnheader').map((cell) => cell.textContent)).toEqual([
          '',
          'Type',
          'Total',
          'OK',
          'Conflicts',
          'Fixable',
          'Errors',
        ])
        expect(table.queryByText('Fatal')).not.toBeInTheDocument()
      })

      it('draws the header icons and the counts with the status tokens', async () => {
        await openPreview(
          previewOf({
            tests: previewPart({ ok: 4, conflicts: 2, fixable: 3, fatal: 1 }, [
              fatalItem('Login flow'),
              conflictItem('Checkout smoke'),
              conflictItem('Nightly sync', NAME_IN_USE),
            ]),
          }),
        )

        const table = screen.getByTestId('entity-summary-table')
        const header = within(table).getAllByRole('row')[0]
        for (const [status, token] of HEADER_STATUS_TOKENS) {
          expect(header.querySelector(`[data-status="${status}"]`)).toHaveClass(token)
        }
        const cells = partCells('tests')
        expect(within(cells[4]).getByText('2')).toHaveClass('text-warning')
        expect(within(cells[5]).getByText('3')).toHaveClass('text-info')
        expect(within(cells[6]).getByText('1')).toHaveClass('text-destructive')
        expect(
          table.querySelector('.text-emerald-500, .text-amber-500, .text-blue-500'),
        ).not.toBeInTheDocument()
      })
    })

    describe('open rows', () => {
      onFakeClock()

      it('a part with a fatal entry starts open', async () => {
        await openPreview(
          previewOf({ tests: previewPart({ ok: 1, fatal: 1 }, [fatalItem('Login flow')]) }),
        )

        expect(rowToggle('tests')).toHaveAttribute('aria-expanded', 'true')
        expect(screen.getByTestId('entity-row-items-tests')).toBeInTheDocument()
      })

      it('a part with only conflicts starts closed', async () => {
        await openPreview(
          previewOf({
            tests: previewPart({ ok: 1, conflicts: 1 }, [conflictItem('Checkout smoke')]),
          }),
        )

        expect(rowToggle('tests')).toHaveAttribute('aria-expanded', 'false')
        expect(screen.queryByTestId('entity-row-items-tests')).not.toBeInTheDocument()
      })

      it('the toggle opens and closes the row', async () => {
        const { user } = await openPreview(
          previewOf({
            tests: previewPart({ ok: 1, conflicts: 1 }, [conflictItem('Checkout smoke')]),
          }),
        )

        await user.click(rowToggle('tests'))

        expect(rowToggle('tests')).toHaveAttribute('aria-expanded', 'true')
        expect(screen.getByTestId('entity-row-items-tests')).toBeInTheDocument()

        await user.click(rowToggle('tests'))

        expect(rowToggle('tests')).toHaveAttribute('aria-expanded', 'false')
        expect(screen.queryByTestId('entity-row-items-tests')).not.toBeInTheDocument()
      })

      it('the open row lists the entries as sent, fatal first', async () => {
        const items = [
          fatalItem('Zone transfer'),
          fatalItem('Billing export', NAME_TAKEN),
          conflictItem('Nightly sync', NAME_IN_USE),
          conflictItem('Checkout smoke'),
        ]
        await openPreview(
          previewOf({ tests: previewPart({ ok: 1, conflicts: 2, fatal: 2 }, items) }),
        )

        expectEntries(screen.getByTestId('entity-row-items-tests'), items, 'preview')
      })

      it('a fatal entry leads with "Cannot be restored"; a conflict shows its reason alone', async () => {
        await openPreview(
          previewOf({
            functions: previewPart({ ok: 1, conflicts: 1, fatal: 1 }, [
              fatalItem('F1-User', MISSING_VERSION),
              conflictItem('F1-Func'),
            ]),
          }),
        )

        const lines = entryLines(screen.getByTestId('entity-row-items-functions'))
        expect(lines.map((line) => line.textContent)).toEqual([
          `F1-UserCannot be restored. ${MISSING_VERSION}`,
          `F1-Func${ALREADY_HERE}`,
        ])
      })

      it('an unreadable member is drawn like any fatal entry', async () => {
        const unreadable = fatalItem('bad.json', 'Cannot be read')
        await openPreview(previewOf({ tests: previewPart({ ok: 2, fatal: 1 }, [unreadable]) }))

        expect(rowToggle('tests')).toHaveAttribute('aria-expanded', 'true')
        expectEntries(screen.getByTestId('entity-row-items-tests'), [unreadable], 'preview')
      })

      it('a re-read that gives a part its first fatal entry opens it', async () => {
        const { user } = await openPreview(
          previewOf({
            tests: previewPart({ ok: 1, conflicts: 1 }, [conflictItem('Checkout smoke')]),
            environments: previewPart({ conflicts: 1 }, [conflictItem('staging')]),
          }),
        )
        await user.click(rowToggle('tests'))
        await user.click(rowToggle('tests'))
        expect(openRows()).toEqual([])

        nextPreview(
          previewOf({
            tests: previewPart({ ok: 1, fatal: 1 }, [fatalItem('Checkout smoke', NAME_TAKEN)]),
            environments: previewPart({ fatal: 1 }, [
              fatalItem('staging', 'Another Environment here has this name'),
            ]),
          }),
        )
        await user.click(screen.getByTestId('cr-overwrite'))
        await advance(REREAD_DELAY_MS)

        expect(rowToggle('tests')).toHaveAttribute('aria-expanded', 'true')
        expect(rowToggle('environments')).toHaveAttribute('aria-expanded', 'true')
        expect(openRows()).toEqual(['tests', 'environments'])
      })

      it('a row opened or closed by hand keeps that choice through a re-read that leaves its fatal state as it was', async () => {
        const preview = () =>
          previewOf({
            tests: previewPart({ ok: 1, fatal: 1 }, [fatalItem('Login flow')]),
            environments: previewPart({ conflicts: 1 }, [conflictItem('staging')]),
            suites: previewPart({ ok: 2 }),
          })
        const { user } = await openPreview(preview())
        await user.click(rowToggle('tests'))
        await user.click(rowToggle('environments'))
        expect(openRows()).toEqual(['environments'])

        nextPreview(preview())
        await user.click(partCheckbox('suites'))
        await advance(REREAD_DELAY_MS)

        expect(backupApi.validateBackup).toHaveBeenCalledTimes(2)
        expect(rowToggle('tests')).toHaveAttribute('aria-expanded', 'false')
        expect(rowToggle('environments')).toHaveAttribute('aria-expanded', 'true')
        expect(openRows()).toEqual(['environments'])
      })

      it('a re-read that takes the last fatal entry of a part away closes it', async () => {
        const { user } = await openPreview(
          previewOf({
            tests: previewPart({ ok: 1, conflicts: 1, fatal: 1 }, [
              fatalItem('Login flow'),
              conflictItem('Checkout smoke'),
            ]),
            environments: previewPart({ ok: 1 }),
          }),
        )
        await user.click(rowToggle('tests'))
        await user.click(rowToggle('tests'))
        expect(rowToggle('tests')).toHaveAttribute('aria-expanded', 'true')

        nextPreview(
          previewOf({
            tests: previewPart({ ok: 2, conflicts: 1 }, [conflictItem('Checkout smoke')]),
            environments: previewPart({ ok: 1 }),
          }),
        )
        await user.click(partCheckbox('environments'))
        await advance(REREAD_DELAY_MS)

        expect(backupApi.validateBackup).toHaveBeenCalledTimes(2)
        expect(rowToggle('tests')).toHaveAttribute('aria-expanded', 'false')
        expect(openRows()).toEqual([])
      })

      it('every preview row closes when a restore completes', async () => {
        const preview = () =>
          previewOf({
            tests: previewPart({ ok: 1, fatal: 1 }, [fatalItem('Login flow')]),
            environments: previewPart({ conflicts: 1 }, [conflictItem('staging')]),
          })
        const { user } = await openPreview(preview())
        await user.click(rowToggle('environments'))
        expect(openRows()).toEqual(['tests', 'environments'])
        vi.mocked(backupApi.restoreBackup).mockResolvedValueOnce({
          tests: resultPart({ imported: 1, fatal: 1 }, [fatalItem('Login flow')]),
          environments: resultPart({ skipped: 1 }, [skippedItem('staging')]),
        })
        nextPreview(preview())

        await pressRestore(user)

        expect(screen.getByTestId('restore-result')).toBeInTheDocument()
        expect(backupApi.validateBackup).toHaveBeenCalledTimes(2)
        expect(openRows()).toEqual([])

        nextPreview(preview())
        await user.click(screen.getByTestId('cr-overwrite'))
        await advance(REREAD_DELAY_MS)

        expect(backupApi.validateBackup).toHaveBeenCalledTimes(3)
        expect(openRows()).toEqual([])
      })

      it('the rows stay as they were when a restore fails', async () => {
        const preview = () =>
          previewOf({
            tests: previewPart({ ok: 1, fatal: 1 }, [fatalItem('Login flow')]),
            environments: previewPart({ conflicts: 1 }, [conflictItem('staging')]),
            suites: previewPart({ conflicts: 1 }, [conflictItem('Nightly', NAME_IN_USE)]),
          })
        const { user } = await openPreview(preview())
        await user.click(rowToggle('environments'))
        expect(openRows()).toEqual(['tests', 'environments'])
        vi.mocked(backupApi.restoreBackup).mockRejectedValueOnce(new Error('Storage is read-only'))
        nextPreview(preview())

        await pressRestore(user)

        expect(screen.getByTestId('restore-backup-error')).toHaveTextContent(
          'Storage is read-only',
        )
        expect(backupApi.validateBackup).toHaveBeenCalledTimes(2)
        expect(openRows()).toEqual(['tests', 'environments'])
      })

      it('Clear and a new upload drop the open-row choices', async () => {
        const { user } = await openPreview(
          previewOf({
            tests: previewPart({ ok: 1, fatal: 1 }, [fatalItem('Login flow')]),
            profiles: previewPart({ conflicts: 1, fixable: 1 }, [conflictItem('lab-ssh')]),
          }),
        )
        await user.click(rowToggle('tests'))
        expect(openRows()).toEqual([])
        expect(screen.getByTestId('conflict-resolution')).toBeInTheDocument()
        expect(screen.getByTestId('auto-repair-toggle')).toBeInTheDocument()

        await user.click(screen.getByTestId('clear-file-button'))
        nextPreview(
          previewOf({
            tests: previewPart({ ok: 1, fatal: 1 }, [fatalItem('Login flow')]),
            profiles: previewPart({ ok: 2 }),
          }),
        )
        await uploadBackup(user, 'second.zip')

        expect(openRows()).toEqual(['tests'])
        expect(screen.queryByTestId('conflict-resolution')).not.toBeInTheDocument()
        expect(screen.queryByTestId('auto-repair-toggle')).not.toBeInTheDocument()

        nextPreview(
          previewOf({
            tests: previewPart({ ok: 1, fatal: 1 }, [fatalItem('Login flow')]),
            profiles: previewPart({ conflicts: 1, fixable: 1 }, [conflictItem('lab-ssh')]),
          }),
        )
        await user.click(partCheckbox('tests'))
        await advance(REREAD_DELAY_MS)

        expect(screen.getByTestId('conflict-resolution')).toBeInTheDocument()
        expect(screen.getByTestId('auto-repair-toggle')).toBeInTheDocument()
      })

      it('a row opened by hand stays closed once a fatal entry came and went', async () => {
        const onlyConflict = () =>
          previewOf({
            tests: previewPart({ ok: 1, conflicts: 1 }, [conflictItem('Checkout smoke')]),
          })
        const { user } = await openPreview(onlyConflict())
        await user.click(rowToggle('tests'))
        expect(openRows()).toEqual(['tests'])

        nextPreview(
          previewOf({
            tests: previewPart({ ok: 1, fatal: 1 }, [fatalItem('Checkout smoke', NAME_TAKEN)]),
          }),
        )
        await user.click(screen.getByTestId('cr-overwrite'))
        await advance(REREAD_DELAY_MS)
        expect(rowToggle('tests')).toHaveAttribute('aria-expanded', 'true')

        nextPreview(onlyConflict())
        await user.click(screen.getByTestId('cr-skip'))
        await advance(REREAD_DELAY_MS)

        expect(backupApi.validateBackup).toHaveBeenCalledTimes(3)
        expect(partCounts('tests')).toEqual(['2', '1', '1', '0', '0'])
        expect(rowToggle('tests')).toHaveAttribute('aria-expanded', 'false')
        expect(openRows()).toEqual([])
      })
    })

    describe('first read', () => {
      onFakeClock()

      it('the first read sends the defaults and no part list', async () => {
        const { file } = await openPreview(threeParts())

        expect(backupApi.validateBackup).toHaveBeenCalledTimes(1)
        expect(backupApi.validateBackup).toHaveBeenCalledWith(file, {
          conflict_resolution: 'skip',
          auto_repair: false,
        })
        expect(lastPreviewRead().file).toBe(file)
        expect(lastPreviewRead().options?.entity_types).toBeUndefined()
      })

      it('no second read follows the upload', async () => {
        await openPreview(threeParts())

        await advance(1000)

        expect(backupApi.validateBackup).toHaveBeenCalledTimes(1)
      })
    })

    describe('re-read', () => {
      onFakeClock()

      it('unticking a part reads the preview again with the ticked parts', async () => {
        const fourParts = () =>
          previewOf({
            tests: previewPart({ ok: 2 }),
            environments: previewPart({ ok: 1 }),
            profiles: previewPart({ ok: 1 }),
            suites: previewPart({ ok: 1 }),
          })
        const { user, file } = await openPreview(fourParts())

        nextPreview(fourParts())
        await user.click(partCheckbox('profiles'))
        await advance(REREAD_DELAY_MS - 1)
        expect(backupApi.validateBackup).toHaveBeenCalledTimes(1)

        await advance(1)
        expect(backupApi.validateBackup).toHaveBeenCalledTimes(2)
        expect(lastPreviewRead().file).toBe(file)
        expect(lastPreviewRead().options).toEqual({
          entity_types: ['tests', 'environments', 'suites'],
          conflict_resolution: 'skip',
          auto_repair: false,
        })

        nextPreview(fourParts())
        await user.click(partCheckbox('tests'))
        await user.click(partCheckbox('profiles'))
        await advance(REREAD_DELAY_MS)

        expect(backupApi.validateBackup).toHaveBeenCalledTimes(3)
        expect(lastPreviewRead().options).toEqual({
          entity_types: ['environments', 'profiles', 'suites'],
          conflict_resolution: 'skip',
          auto_repair: false,
        })
      })

      it('changing the conflict choice reads again', async () => {
        const { user, file } = await openPreview(threeParts())

        nextPreview(threeParts())
        await user.click(screen.getByTestId('cr-overwrite'))
        await advance(REREAD_DELAY_MS)

        expect(backupApi.validateBackup).toHaveBeenCalledTimes(2)
        expect(lastPreviewRead().file).toBe(file)
        expect(lastPreviewRead().options).toEqual({
          entity_types: ['tests', 'environments', 'suites'],
          conflict_resolution: 'overwrite',
          auto_repair: false,
        })
      })

      it('the Conflict Resolution radios stay after Overwrite is picked', async () => {
        const { user } = await openPreview(
          previewOf({
            profiles: previewPart({ ok: 1, conflicts: 1 }, [conflictItem('lab-ssh')]),
          }),
        )
        expect(screen.getByTestId('conflict-resolution')).toBeInTheDocument()

        nextPreview(previewOf({ profiles: previewPart({ ok: 1, fixable: 1 }) }))
        await user.click(screen.getByTestId('cr-overwrite'))
        await advance(REREAD_DELAY_MS)

        expect(partCounts('profiles')).toEqual(['2', '1', '0', '1', '0'])
        expect(screen.getByTestId('conflict-resolution')).toBeInTheDocument()
        expect(screen.getByTestId('cr-overwrite')).toHaveAttribute('aria-checked', 'true')
      })

      it('turning auto-repair on reads again', async () => {
        const withFixable = () =>
          previewOf({
            tests: previewPart({ ok: 2 }),
            profiles: previewPart({ ok: 1, fixable: 1 }),
          })
        const { user, file } = await openPreview(withFixable())

        nextPreview(withFixable())
        await user.click(screen.getByTestId('auto-repair-toggle'))
        await advance(REREAD_DELAY_MS)

        expect(backupApi.validateBackup).toHaveBeenCalledTimes(2)
        expect(lastPreviewRead().file).toBe(file)
        expect(lastPreviewRead().options).toEqual({
          entity_types: ['tests', 'profiles'],
          conflict_resolution: 'skip',
          auto_repair: true,
        })
      })

      it('the auto-repair switch stays once it has been shown', async () => {
        const { user } = await openPreview(
          previewOf({
            tests: previewPart({ ok: 2 }),
            profiles: previewPart({ ok: 1, fixable: 1 }),
          }),
        )
        expect(screen.getByTestId('auto-repair-toggle')).toHaveAttribute('aria-checked', 'false')

        nextPreview(
          previewOf({
            tests: previewPart({ ok: 2 }),
            profiles: previewPart({ ok: 2 }),
          }),
        )
        await user.click(screen.getByTestId('auto-repair-toggle'))
        await user.click(partCheckbox('profiles'))
        await advance(REREAD_DELAY_MS)

        expect(partCounts('profiles')).toEqual(['2', '2', '0', '0', '0'])
        expect(screen.getByTestId('auto-repair-toggle')).toHaveAttribute('aria-checked', 'true')
      })

      it('a burst of changes sends one read', async () => {
        const { user } = await openPreview(threeParts())

        nextPreview(threeParts())
        await user.click(partCheckbox('environments'))
        await advance(100)
        await user.click(screen.getByTestId('cr-overwrite'))
        await advance(100)
        await user.click(partCheckbox('suites'))
        await advance(REREAD_DELAY_MS - 1)
        expect(backupApi.validateBackup).toHaveBeenCalledTimes(1)

        await advance(1)
        expect(backupApi.validateBackup).toHaveBeenCalledTimes(2)
        expect(lastPreviewRead().options).toEqual({
          entity_types: ['tests'],
          conflict_resolution: 'overwrite',
          auto_repair: false,
        })

        await advance(1000)
        expect(backupApi.validateBackup).toHaveBeenCalledTimes(2)
      })

      it('the latest answer wins', async () => {
        const { user } = await openPreview(threeParts())
        const older = deferred<backupApi.BackupValidateResult>()
        const newer = deferred<backupApi.BackupValidateResult>()
        vi.mocked(backupApi.validateBackup)
          .mockReturnValueOnce(older.promise)
          .mockReturnValueOnce(newer.promise)
        await user.click(partCheckbox('environments'))
        await advance(REREAD_DELAY_MS)
        await user.click(partCheckbox('suites'))
        await advance(REREAD_DELAY_MS)
        expect(backupApi.validateBackup).toHaveBeenCalledTimes(3)

        await answer(
          newer,
          previewOf({
            tests: previewPart({ ok: 22 }),
            environments: previewPart({ ok: 1 }),
            suites: previewPart({ ok: 1 }),
          }),
        )
        expect(partCounts('tests')).toEqual(['22', '22', '0', '0', '0'])

        await answer(
          older,
          previewOf({
            tests: previewPart({ ok: 11 }),
            environments: previewPart({ ok: 1 }),
            suites: previewPart({ ok: 1 }),
          }),
        )
        expect(partCounts('tests')).toEqual(['22', '22', '0', '0', '0'])
      })

      it('going back to the ticks on screen sends nothing', async () => {
        const { user } = await openPreview(threeParts())

        await user.click(partCheckbox('tests'))
        await advance(100)
        await user.click(partCheckbox('tests'))
        await advance(1000)

        expect(backupApi.validateBackup).toHaveBeenCalledTimes(1)
      })

      it('an empty set sends no read', async () => {
        const { user } = await openPreview(
          previewOf({ tests: previewPart({ ok: 2 }), environments: previewPart({ ok: 1 }) }),
        )
        nextPreview(
          previewOf({ tests: previewPart({ ok: 2 }), environments: previewPart({ ok: 7 }) }),
        )
        await user.click(partCheckbox('tests'))
        await advance(REREAD_DELAY_MS)
        expect(backupApi.validateBackup).toHaveBeenCalledTimes(2)

        await user.click(partCheckbox('environments'))
        await advance(1000)

        expect(backupApi.validateBackup).toHaveBeenCalledTimes(2)
        expect(partCounts('environments')).toEqual(['7', '7', '0', '0', '0'])
        expect(restoreButton()).toBeDisabled()

        await user.click(partCheckbox('environments'))
        await advance(1000)

        expect(backupApi.validateBackup).toHaveBeenCalledTimes(2)

        nextPreview(
          previewOf({ tests: previewPart({ ok: 2 }), environments: previewPart({ ok: 7 }) }),
        )
        await user.click(partCheckbox('environments'))
        await user.click(partCheckbox('tests'))
        await advance(REREAD_DELAY_MS)

        expect(backupApi.validateBackup).toHaveBeenCalledTimes(3)
        expect(lastPreviewRead().options).toEqual({
          entity_types: ['tests'],
          conflict_resolution: 'skip',
          auto_repair: false,
        })
      })

      it('a restore that completes reads the preview again with the choices on screen', async () => {
        const { user, file } = await openPreview(
          previewOf({ tests: previewPart({ ok: 2 }), environments: previewPart({ ok: 1 }) }),
        )
        vi.mocked(backupApi.restoreBackup).mockResolvedValueOnce({
          tests: resultPart({ imported: 2 }),
          environments: resultPart({ imported: 1 }),
        })
        nextPreview(
          previewOf({
            tests: previewPart({ conflicts: 2 }, [
              conflictItem('Login flow'),
              conflictItem('Checkout smoke'),
            ]),
            environments: previewPart({ conflicts: 1 }, [conflictItem('staging')]),
          }),
        )

        await user.click(restoreButton())
        await advance(0)
        expect(screen.getByTestId('restore-result')).toBeInTheDocument()

        await advance(REREAD_DELAY_MS - 1)

        expect(backupApi.validateBackup).toHaveBeenCalledTimes(1)
        expect(partCounts('tests')).toEqual(['2', '2', '0', '0', '0'])

        await advance(1)

        expect(backupApi.validateBackup).toHaveBeenCalledTimes(2)
        expect(lastPreviewRead().file).toBe(file)
        expect(lastPreviewRead().options).toEqual({
          entity_types: ['tests', 'environments'],
          conflict_resolution: 'skip',
          auto_repair: false,
        })
        expect(partCounts('tests')).toEqual(['2', '0', '2', '0', '0'])
        expect(partCounts('environments')).toEqual(['1', '0', '1', '0', '0'])
        expect(screen.getByTestId('restore-result')).toBeInTheDocument()
      })

      it('a restore that fails reads the preview again', async () => {
        const { user, file } = await openPreview(threeParts())
        vi.mocked(backupApi.restoreBackup).mockRejectedValueOnce(new Error('Storage is read-only'))
        nextPreview(
          previewOf({
            tests: previewPart({ ok: 1, conflicts: 2 }, [
              conflictItem('Checkout smoke'),
              conflictItem('Login flow'),
            ]),
            environments: previewPart({ ok: 1 }),
            suites: previewPart({ ok: 1 }),
          }),
        )

        await pressRestore(user)

        expect(screen.getByTestId('restore-backup-error')).toHaveTextContent(
          'Storage is read-only',
        )
        expect(backupApi.validateBackup).toHaveBeenCalledTimes(2)
        expect(lastPreviewRead().file).toBe(file)
        expect(lastPreviewRead().options).toEqual({
          entity_types: ['tests', 'environments', 'suites'],
          conflict_resolution: 'skip',
          auto_repair: false,
        })
        expect(partCounts('tests')).toEqual(['3', '1', '2', '0', '0'])
        expect(restoreButton()).toBeEnabled()
      })
    })

    describe('pending', () => {
      onFakeClock()

      it('the table stays and Restore is disabled while a newer preview loads', async () => {
        const failing = fatalItem('Login flow')
        const { user } = await openPreview(
          previewOf({
            tests: previewPart({ ok: 2, fatal: 1 }, [failing]),
            environments: previewPart({ ok: 1 }),
          }),
        )
        expect(restoreButton()).toBeEnabled()
        vi.mocked(backupApi.validateBackup).mockReturnValueOnce(
          deferred<backupApi.BackupValidateResult>().promise,
        )

        await user.click(partCheckbox('environments'))

        expect(restoreButton()).toBeDisabled()

        await advance(REREAD_DELAY_MS)

        expect(backupApi.validateBackup).toHaveBeenCalledTimes(2)
        expect(restoreButton()).toBeDisabled()
        expect(partCounts('tests')).toEqual(['3', '2', '0', '0', '1'])
        expect(partCounts('environments')).toEqual(['1', '1', '0', '0', '0'])
        expectEntries(screen.getByTestId('entity-row-items-tests'), [failing], 'preview')
      })

      it('Restore stays disabled until the preview read after a restore lands', async () => {
        const { user } = await openPreview(threeParts())
        vi.mocked(backupApi.restoreBackup).mockResolvedValueOnce({
          tests: resultPart({ imported: 2, skipped: 1 }, [skippedItem('Checkout smoke')]),
          environments: resultPart({ imported: 1 }),
          suites: resultPart({ imported: 1 }),
        })
        const held = deferred<backupApi.BackupValidateResult>()
        vi.mocked(backupApi.validateBackup).mockReturnValueOnce(held.promise)

        await pressRestore(user)

        expect(screen.getByTestId('restore-result')).toBeInTheDocument()
        expect(backupApi.validateBackup).toHaveBeenCalledTimes(2)
        expect(restoreButton()).toHaveTextContent('Restore 5 entities')
        expect(restoreButton()).toBeDisabled()
        expect(partCounts('tests')).toEqual(['3', '2', '1', '0', '0'])

        await answer(
          held,
          previewOf({
            tests: previewPart({ conflicts: 3 }, [
              conflictItem('Checkout smoke'),
              conflictItem('Login flow'),
              conflictItem('Order export'),
            ]),
            environments: previewPart({ conflicts: 1 }, [conflictItem('staging')]),
            suites: previewPart({ conflicts: 1 }, [conflictItem('Nightly')]),
          }),
        )

        expect(partCounts('tests')).toEqual(['3', '0', '3', '0', '0'])
        expect(restoreButton()).toBeEnabled()
      })
    })

    describe('done', () => {
      onFakeClock()

      it('the table shows the new answer and Restore is enabled', async () => {
        const { user } = await openPreview(
          previewOf({
            tests: previewPart({ ok: 2, fatal: 1 }, [fatalItem('Login flow')]),
            environments: previewPart({ ok: 1 }),
          }),
        )
        const newer = deferred<backupApi.BackupValidateResult>()
        vi.mocked(backupApi.validateBackup).mockReturnValueOnce(newer.promise)
        await user.click(partCheckbox('environments'))
        await advance(REREAD_DELAY_MS)
        expect(restoreButton()).toBeDisabled()
        const entries = [fatalItem('Billing export', NAME_TAKEN), conflictItem('Checkout smoke')]

        await answer(
          newer,
          previewOf({
            tests: previewPart({ ok: 1, conflicts: 1, fatal: 1 }, entries),
            environments: previewPart({ ok: 1 }),
          }),
        )

        expect(partCounts('tests')).toEqual(['3', '1', '1', '0', '1'])
        expectEntries(screen.getByTestId('entity-row-items-tests'), entries, 'preview')
        expect(restoreButton()).toBeEnabled()
        expect(restoreButton()).toHaveTextContent(/^Restore 2 entities$/)
      })
    })

    describe('failed', () => {
      onFakeClock()

      it('the table stays, the error line shows under it and Restore is disabled', async () => {
        const failing = fatalItem('Login flow')
        const { user } = await openPreview(
          previewOf({
            tests: previewPart({ ok: 2, fatal: 1 }, [failing]),
            environments: previewPart({ ok: 1 }),
          }),
        )
        vi.mocked(backupApi.validateBackup).mockRejectedValueOnce(
          new Error('The backup file could not be opened'),
        )

        await user.click(partCheckbox('environments'))
        await advance(REREAD_DELAY_MS)

        const table = screen.getByTestId('entity-summary-table')
        expect(partCounts('tests')).toEqual(['3', '2', '0', '0', '1'])
        expectEntries(screen.getByTestId('entity-row-items-tests'), [failing], 'preview')
        const errorLine = screen.getByTestId('restore-validate-error')
        expect(errorLine).toHaveTextContent(/^The backup file could not be opened$/)
        expect(errorLine).toHaveAttribute('role', 'alert')
        expect(table.compareDocumentPosition(errorLine)).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
        expect(restoreButton()).toBeDisabled()
      })

      it("a failed re-read with no reason reads the first read's fallback", async () => {
        const { user } = await openPreview(threeParts())
        vi.mocked(backupApi.validateBackup).mockRejectedValueOnce({ status: 502 })

        await user.click(partCheckbox('environments'))
        await advance(REREAD_DELAY_MS)

        expect(screen.getByTestId('restore-validate-error')).toHaveTextContent(
          /^Failed to read the backup file$/,
        )
        expect(
          within(screen.getByTestId('restore-backup-section')).queryByText('Request failed'),
        ).not.toBeInTheDocument()
      })

      it('a later good read removes the error line and enables Restore', async () => {
        const { user } = await openPreview(threeParts())
        vi.mocked(backupApi.validateBackup).mockRejectedValueOnce(
          new Error('The backup file could not be opened'),
        )
        await user.click(partCheckbox('environments'))
        await advance(REREAD_DELAY_MS)
        expect(screen.getByTestId('restore-validate-error')).toBeInTheDocument()
        expect(restoreButton()).toBeDisabled()

        nextPreview(threeParts())
        await user.click(partCheckbox('suites'))
        await advance(REREAD_DELAY_MS)

        expect(backupApi.validateBackup).toHaveBeenCalledTimes(3)
        expect(screen.queryByTestId('restore-validate-error')).not.toBeInTheDocument()
        expect(restoreButton()).toBeEnabled()
      })
    })

    describe('upload', () => {
      onFakeClock()

      it('a late answer for a cleared file is ignored', async () => {
        const { user } = await openPreview(
          previewOf({ tests: previewPart({ ok: 2 }), environments: previewPart({ ok: 1 }) }),
        )
        const late = deferred<backupApi.BackupValidateResult>()
        vi.mocked(backupApi.validateBackup).mockReturnValueOnce(late.promise)
        await user.click(partCheckbox('environments'))
        await advance(REREAD_DELAY_MS)
        expect(backupApi.validateBackup).toHaveBeenCalledTimes(2)

        await user.click(screen.getByTestId('clear-file-button'))
        nextPreview(previewOf({ tests: previewPart({ ok: 5 }) }, { wave_version: '2.0.0' }))
        await uploadBackup(user, 'second.zip')
        expect(partCounts('tests')).toEqual(['5', '5', '0', '0', '0'])

        await answer(
          late,
          previewOf({ tests: previewPart({ ok: 99 }), environments: previewPart({ ok: 1 }) }),
        )

        expect(partCounts('tests')).toEqual(['5', '5', '0', '0', '0'])
        expect(screen.queryByTestId('entity-row-environments')).not.toBeInTheDocument()
        const details = within(screen.getByTestId('validation-preview'))
        expect(details.getByText('second.zip')).toBeInTheDocument()
        expect(details.getByText('2.0.0')).toBeInTheDocument()
      })

      it('a first answer that lands after a newer file was picked is ignored', async () => {
        const heldBack = deferred<backupApi.BackupValidateResult>()
        vi.mocked(backupApi.validateBackup).mockReturnValueOnce(heldBack.promise)
        const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
        renderTab()
        await uploadBackup(user, 'first.zip')
        nextPreview(previewOf({ tests: previewPart({ ok: 5 }) }, { wave_version: '2.0.0' }))
        const second = await uploadBackup(user, 'second.zip')
        expect(partCounts('tests')).toEqual(['5', '5', '0', '0', '0'])

        await answer(
          heldBack,
          previewOf({ tests: previewPart({ ok: 99 }), environments: previewPart({ ok: 1 }) }),
        )

        expect(partCounts('tests')).toEqual(['5', '5', '0', '0', '0'])
        expect(screen.queryByTestId('entity-row-environments')).not.toBeInTheDocument()
        const details = within(screen.getByTestId('validation-preview'))
        expect(details.getByText('second.zip')).toBeInTheDocument()
        expect(details.getByText('2.0.0')).toBeInTheDocument()

        vi.mocked(backupApi.restoreBackup).mockResolvedValueOnce({
          tests: resultPart({ imported: 5 }),
        })
        nextPreview(previewOf({ tests: previewPart({ conflicts: 5 }) }, { wave_version: '2.0.0' }))
        await pressRestore(user)

        expect(backupApi.restoreBackup).toHaveBeenCalledTimes(1)
        expect(vi.mocked(backupApi.restoreBackup).mock.lastCall?.[0]).toBe(second)
        expect(backupApi.validateBackup).toHaveBeenCalledTimes(3)
        expect(lastPreviewRead().file).toBe(second)
        expect(partCounts('tests')).toEqual(['5', '0', '5', '0', '0'])
      })

      it('gives the hidden file input a name', () => {
        renderTab()

        expect(screen.getByTestId('upload-input')).toHaveAttribute('name', 'backup-file')
      })

      it('keeps the picked file name out of page translation, and leaves the hint to it', async () => {
        vi.mocked(backupApi.validateBackup).mockReturnValueOnce(
          deferred<backupApi.BackupValidateResult>().promise,
        )
        const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
        renderTab()
        const hint = within(screen.getByTestId('upload-zone')).getByText(
          'Click or drag & drop a backup file (.zip)',
        )
        expect(hint).not.toHaveAttribute('translate')

        await uploadBackup(user, 'nightly-2026-10-13.zip')

        const fileName = within(screen.getByTestId('upload-zone')).getByText(
          'nightly-2026-10-13.zip',
        )
        expect(fileName).toHaveAttribute('translate', 'no')
      })
    })

    describe('kept upload', () => {
      onFakeClock()

      beforeEach(() => {
        vi.mocked(backupApi.releaseBackup).mockClear()
      })

      /** Renders the tab and picks a file whose first read answers three parts. */
      async function holdFile(wrapper?: typeof StrictMode) {
        nextPreview(threeParts())
        const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
        const { unmount } = render(<BackupRestoreTab periodicBackup={makePeriodicBackup()} />, {
          wrapper,
        })
        const file = await uploadBackup(user)
        return { user, file, unmount }
      }

      it('releases the upload when the file is cleared', async () => {
        const { user, file } = await holdFile()
        expect(backupApi.releaseBackup).not.toHaveBeenCalled()

        await user.click(screen.getByTestId('clear-file-button'))

        expect(backupApi.releaseBackup).toHaveBeenCalledTimes(1)
        expect(backupApi.releaseBackup).toHaveBeenCalledWith(file)
      })

      it('releases the upload of a file that another pick replaces', async () => {
        vi.mocked(backupApi.validateBackup).mockReturnValueOnce(new Promise(() => {}))
        const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
        renderTab()
        const first = await uploadBackup(user, 'first.zip')
        expect(backupApi.releaseBackup).not.toHaveBeenCalled()

        nextPreview(threeParts())
        const second = await uploadBackup(user, 'second.zip')

        expect(backupApi.releaseBackup).toHaveBeenCalledTimes(1)
        expect(backupApi.releaseBackup).toHaveBeenCalledWith(first)
        expect(lastPreviewRead().file).toBe(second)
      })

      it('releases the upload when the section unmounts', async () => {
        const { file, unmount } = await holdFile()
        expect(backupApi.releaseBackup).not.toHaveBeenCalled()

        unmount()

        expect(backupApi.releaseBackup).toHaveBeenCalledTimes(1)
        expect(backupApi.releaseBackup).toHaveBeenCalledWith(file)
      })

      it('on unmount releases the file held now, not one it replaced', async () => {
        vi.mocked(backupApi.validateBackup).mockReturnValueOnce(new Promise(() => {}))
        const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
        const { unmount } = renderTab()
        await uploadBackup(user, 'first.zip')
        nextPreview(threeParts())
        const second = await uploadBackup(user, 'second.zip')

        unmount()

        expect(backupApi.releaseBackup).toHaveBeenCalledTimes(2)
        expect(backupApi.releaseBackup).toHaveBeenLastCalledWith(second)
      })

      it('releases nothing when the section unmounts with no file', () => {
        const { unmount } = renderTab()

        unmount()

        expect(backupApi.releaseBackup).not.toHaveBeenCalled()
      })

      it('releases nothing more on unmount once the file was cleared', async () => {
        const { user, unmount } = await holdFile()
        await user.click(screen.getByTestId('clear-file-button'))

        unmount()

        expect(backupApi.releaseBackup).toHaveBeenCalledTimes(1)
      })

      it('holds the upload through a change of the choices and a restore', async () => {
        const { user } = await holdFile()
        nextPreview(threeParts())
        await user.click(partCheckbox('suites'))
        await advance(REREAD_DELAY_MS)
        vi.mocked(backupApi.restoreBackup).mockResolvedValueOnce({
          tests: resultPart({ imported: 3 }),
          environments: resultPart({ imported: 1 }),
        })
        nextPreview(threeParts())
        await pressRestore(user)

        expect(backupApi.validateBackup).toHaveBeenCalledTimes(3)
        expect(backupApi.restoreBackup).toHaveBeenCalledTimes(1)
        expect(backupApi.releaseBackup).not.toHaveBeenCalled()
      })

      it('in StrictMode releases nothing on mount and the held file once on unmount', async () => {
        const { file, unmount } = await holdFile(StrictMode)
        expect(backupApi.releaseBackup).not.toHaveBeenCalled()

        unmount()

        expect(backupApi.releaseBackup).toHaveBeenCalledTimes(1)
        expect(backupApi.releaseBackup).toHaveBeenCalledWith(file)
      })
    })

    describe('overwrite confirmation', () => {
      onFakeClock()

      const allParts = ['tests', 'environments', 'suites']

      /** Picks a conflict choice and lets the preview it asks for land. */
      async function pickChoice(user: User, choice: 'overwrite' | 'rename'): Promise<void> {
        nextPreview(threeParts())
        await user.click(screen.getByTestId(`cr-${choice}`))
        await advance(REREAD_DELAY_MS)
      }

      /** Queues the answer of the next restore and of the read of the preview that follows it. */
      function nextRestoreAnswers(): void {
        vi.mocked(backupApi.restoreBackup).mockResolvedValueOnce({
          tests: resultPart({ imported: 3 }),
          environments: resultPart({ imported: 1 }),
          suites: resultPart({ imported: 1 }),
        })
        nextPreview(threeParts())
      }

      async function pressInDialog(user: User, label: string): Promise<void> {
        const dialog = within(screen.getByRole('alertdialog'))
        await user.click(dialog.getByRole('button', { name: label }))
        await settleRestore()
      }

      it('Restore asks before it overwrites and sends nothing', async () => {
        const { user } = await openPreview(threeParts())
        await pickChoice(user, 'overwrite')

        await pressRestore(user)

        const dialog = screen.getByRole('alertdialog')
        expect(dialog).toBe(screen.getByTestId('restore-overwrite-dialog'))
        expect(dialog).toHaveAccessibleName('Overwrite conflicting entities?')
        expect(dialog).toHaveAccessibleDescription(
          "The ones in this WAVE get the backup's content. This cannot be undone.",
        )
        expect(
          within(dialog)
            .getAllByRole('button')
            .map((button) => button.textContent),
        ).toEqual(['Cancel', 'Overwrite'])
        expect(backupApi.restoreBackup).not.toHaveBeenCalled()
        expect(screen.queryByTestId('restore-progress')).not.toBeInTheDocument()
      })

      it('Overwrite in the dialog sends the restore once and closes the dialog', async () => {
        const { user, file } = await openPreview(threeParts())
        await pickChoice(user, 'overwrite')
        nextRestoreAnswers()
        await pressRestore(user)

        await pressInDialog(user, 'Overwrite')

        expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
        expect(backupApi.restoreBackup).toHaveBeenCalledTimes(1)
        expect(backupApi.restoreBackup).toHaveBeenCalledWith(file, {
          entity_types: allParts,
          conflict_resolution: 'overwrite',
          auto_repair: false,
        })
        expect(screen.getByTestId('restore-result')).toBeInTheDocument()
      })

      it('Cancel closes the dialog, sends nothing and leaves the preview as it was', async () => {
        const { user } = await openPreview(threeParts())
        await pickChoice(user, 'overwrite')
        await pressRestore(user)

        await pressInDialog(user, 'Cancel')

        expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
        expect(backupApi.restoreBackup).not.toHaveBeenCalled()
        expect(backupApi.validateBackup).toHaveBeenCalledTimes(2)
        expect(screen.getByTestId('cr-overwrite')).toHaveAttribute('aria-checked', 'true')
        expect(partCounts('tests')).toEqual(['3', '2', '1', '0', '0'])
        expect(allParts.map((type) => partCheckbox(type).getAttribute('aria-checked'))).toEqual([
          'true',
          'true',
          'true',
        ])
        expect(screen.queryByTestId('restore-result')).not.toBeInTheDocument()
        expect(restoreButton()).toBeEnabled()
      })

      it('Restore asks again after a Cancel', async () => {
        const { user } = await openPreview(threeParts())
        await pickChoice(user, 'overwrite')
        await pressRestore(user)
        await pressInDialog(user, 'Cancel')
        nextRestoreAnswers()

        await pressRestore(user)

        expect(screen.getByRole('alertdialog')).toBeInTheDocument()
        expect(backupApi.restoreBackup).not.toHaveBeenCalled()

        await pressInDialog(user, 'Overwrite')

        expect(backupApi.restoreBackup).toHaveBeenCalledTimes(1)
      })

      it('Skip restores without asking', async () => {
        const { user } = await openPreview(threeParts())
        nextRestoreAnswers()

        await pressRestore(user)

        expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
        expect(backupApi.restoreBackup).toHaveBeenCalledTimes(1)
        expect(vi.mocked(backupApi.restoreBackup).mock.lastCall?.[1]).toEqual({
          entity_types: allParts,
          conflict_resolution: 'skip',
          auto_repair: false,
        })
      })

      it('Rename restores without asking', async () => {
        const { user } = await openPreview(threeParts())
        await pickChoice(user, 'rename')
        nextRestoreAnswers()

        await pressRestore(user)

        expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
        expect(backupApi.restoreBackup).toHaveBeenCalledTimes(1)
        expect(vi.mocked(backupApi.restoreBackup).mock.lastCall?.[1]).toEqual({
          entity_types: allParts,
          conflict_resolution: 'rename',
          auto_repair: false,
        })
      })

      it('Overwrite restores without asking when no ticked part has a conflict', async () => {
        const { user } = await openPreview(threeParts())
        await pickChoice(user, 'overwrite')
        nextPreview(threeParts())
        await user.click(partCheckbox('tests'))
        await advance(REREAD_DELAY_MS)
        expect(partCounts('tests')).toEqual(['3', '2', '1', '0', '0'])
        nextRestoreAnswers()

        await pressRestore(user)

        expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
        expect(backupApi.restoreBackup).toHaveBeenCalledTimes(1)
        expect(vi.mocked(backupApi.restoreBackup).mock.lastCall?.[1]).toEqual({
          entity_types: ['environments', 'suites'],
          conflict_resolution: 'overwrite',
          auto_repair: false,
        })
      })

      it('Restore asks before a second restore overwrites what the first one wrote', async () => {
        const { user } = await openPreview(threeParts())
        await pickChoice(user, 'overwrite')
        nextPreview(threeParts())
        await user.click(partCheckbox('tests'))
        await advance(REREAD_DELAY_MS)
        vi.mocked(backupApi.restoreBackup).mockResolvedValueOnce({
          environments: resultPart({ imported: 1 }),
          suites: resultPart({ imported: 1 }),
        })
        nextPreview(
          previewOf({
            tests: previewPart({ ok: 2, conflicts: 1 }, [conflictItem('Checkout smoke')]),
            environments: previewPart({ conflicts: 1 }, [conflictItem('staging')]),
            suites: previewPart({ conflicts: 1 }, [conflictItem('Nightly')]),
          }),
        )

        await pressRestore(user)

        expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
        expect(backupApi.restoreBackup).toHaveBeenCalledTimes(1)
        expect(partCounts('environments')).toEqual(['1', '0', '1', '0', '0'])

        await pressRestore(user)

        expect(screen.getByRole('alertdialog')).toBeInTheDocument()
        expect(backupApi.restoreBackup).toHaveBeenCalledTimes(1)
      })
    })

    describe('result', () => {
      onFakeClock()

      it('names the progress bar of a running restore', async () => {
        const { user } = await openPreview(threeParts())
        const running = deferred<backupApi.BackupRestoreResult>()
        vi.mocked(backupApi.restoreBackup).mockReturnValueOnce(running.promise)

        await user.click(restoreButton())

        const progress = within(screen.getByTestId('restore-progress'))
        expect(progress.getByRole('progressbar', { name: 'Restore progress' })).toBeInTheDocument()

        nextPreview(threeParts())
        await answer(running, { tests: resultPart({ imported: 3 }) })
        await settleRestore()
      })

      it('draws one block per part in the order the server sent them', async () => {
        const types = ['suites', 'tests', 'environments']
        await openResult({
          suites: resultPart({ imported: 1 }),
          tests: resultPart({ imported: 2 }),
          environments: resultPart({ skipped: 1 }, [skippedItem('staging')]),
        })

        const blocks = within(screen.getByTestId('restore-result')).getAllByTestId(
          /^restore-result-part-/,
        )
        expect(blocks.map((block) => block.getAttribute('data-testid'))).toEqual(
          types.map((type) => `restore-result-part-${type}`),
        )
        types.forEach((type, index) => {
          expect(blocks[index]).toContainElement(resultLine(type))
        })
      })

      it('a result line has a toggle only when it has entries', async () => {
        await openResult({
          tests: resultPart({ imported: 1, skipped: 1 }, [skippedItem('Checkout smoke')]),
          environments: resultPart({ imported: 1 }),
        })

        expect(resultLine('tests')).toContainElement(resultToggle('tests'))
        expect(screen.queryByTestId('restore-result-toggle-environments')).not.toBeInTheDocument()
        expect(resultLine('environments').querySelector('button')).not.toBeInTheDocument()
      })

      it('a result line with a fatal entry starts open; one with only skipped entries starts closed', async () => {
        await openResult({
          tests: resultPart({ imported: 1, fatal: 1 }, [fatalItem('Login flow')]),
          environments: resultPart({ skipped: 1 }, [skippedItem('staging')]),
        })

        expect(resultToggle('tests')).toHaveAttribute('aria-expanded', 'true')
        expect(screen.getByTestId('restore-result-items-tests')).toBeInTheDocument()
        expect(resultToggle('environments')).toHaveAttribute('aria-expanded', 'false')
        expect(screen.queryByTestId('restore-result-items-environments')).not.toBeInTheDocument()
      })

      it('the open line lists fatal first, then skipped, with their reasons', async () => {
        const items = [
          fatalItem('Zone transfer'),
          fatalItem('Billing export', 'Could not be written: No space left on device'),
          skippedItem('Nightly sync', NAME_IN_USE),
          skippedItem('Checkout smoke'),
        ]
        await openResult({
          tests: resultPart({ imported: 3, skipped: 2, fatal: 2 }, items),
          environments: resultPart({ skipped: 1 }, [skippedItem('staging')]),
        })

        const block = within(screen.getByTestId('restore-result-part-tests'))
        const wrapper = block.getByTestId('restore-result-items-tests')
        expect(block.getByTestId('restore-result-line-tests').nextElementSibling).toBe(wrapper)
        expectEntries(wrapper, items, 'result')
        expect(screen.queryByTestId('restore-result-items-environments')).not.toBeInTheDocument()
      })

      it('a fatal entry leads with "Not restored"; a skipped entry shows its reason alone', async () => {
        await openResult({
          functions: resultPart({ imported: 53, skipped: 1, fatal: 1 }, [
            fatalItem('F1-User', MISSING_VERSION),
            skippedItem('F1-Func'),
          ]),
        })

        const lines = entryLines(screen.getByTestId('restore-result-items-functions'))
        expect(lines.map((line) => line.textContent)).toEqual([
          `F1-UserNot restored. ${MISSING_VERSION}`,
          `F1-Func${ALREADY_HERE}`,
        ])
      })

      it('a result line counts its fatal entries as failed, only when there are any', async () => {
        await openResult({
          functions: resultPart({ imported: 53, fatal: 1 }, [
            fatalItem('F1-User', MISSING_VERSION),
          ]),
          tests: resultPart({ imported: 2 }),
        })

        expect(resultLine('functions')).toHaveTextContent(
          /^functions: 53 imported, 0 skipped, 1 failed$/,
        )
        expect(resultLine('tests')).toHaveTextContent(/^tests: 2 imported, 0 skipped$/)
        expect(screen.getByTestId('restore-result')).not.toHaveTextContent(/fatal/i)
      })

      it('the result line text is unchanged and is part of the toggle', async () => {
        const { user } = await openResult({
          tests: resultPart({ imported: 1, skipped: 1 }, [skippedItem('Checkout smoke')]),
          suites: resultPart({ imported: 3, fatal: 2 }, [
            fatalItem('Nightly', 'Could not be written: No space left on device'),
            fatalItem('suite-7c1e', 'Has no name'),
          ]),
          system_variables: resultPart({ imported: 4 }),
        })

        expect(resultLine('tests')).toHaveTextContent(/^tests: 1 imported, 1 skipped$/)
        expect(resultLine('suites')).toHaveTextContent(/^suites: 3 imported, 0 skipped, 2 failed$/)
        expect(resultLine('system_variables')).toHaveTextContent(
          /^System Variables: 4 imported, 0 skipped$/,
        )
        expect(resultToggle('tests')).toHaveTextContent(/^tests: 1 imported, 1 skipped$/)
        expect(screen.queryByTestId('restore-result-items-tests')).not.toBeInTheDocument()

        await user.click(within(resultToggle('tests')).getByText('tests'))

        expect(screen.getByTestId('restore-result-items-tests')).toBeInTheDocument()
      })

      it('the toggle of a result line is described by the whole line text', async () => {
        const { user } = await openResult({
          tests: resultPart({ imported: 8, skipped: 9, fatal: 1 }, [
            fatalItem('Billing sync'),
            skippedItem('Login smoke'),
          ]),
          system_variables: resultPart({ imported: 1, skipped: 1 }, [
            skippedItem('System variables'),
          ]),
        })

        expect(resultToggle('tests')).toHaveAttribute('aria-label', 'Collapse tests')
        expect(resultToggle('tests')).toHaveAccessibleDescription(
          'tests: 8 imported, 9 skipped, 1 failed',
        )
        expect(resultToggle('system_variables')).toHaveAttribute(
          'aria-label',
          'Expand System Variables',
        )
        expect(resultToggle('system_variables')).toHaveAccessibleDescription(
          'System Variables: 1 imported, 1 skipped',
        )

        await user.click(resultToggle('system_variables'))

        expect(resultToggle('system_variables')).toHaveAttribute(
          'aria-label',
          'Collapse System Variables',
        )
        expect(resultToggle('system_variables')).toHaveAccessibleDescription(
          'System Variables: 1 imported, 1 skipped',
        )
      })
    })
  })

  describe('Periodic Backup Section', () => {
    beforeEach(() => {
      vi.mocked(backupApi.getSchedule).mockClear()
      vi.mocked(backupApi.updateSchedule).mockClear()
    })

    describe('State from the periodicBackup prop', () => {
      it('reads no schedule itself', () => {
        renderTab()

        expect(backupApi.getSchedule).not.toHaveBeenCalled()
      })

      it('renders the schedule the prop holds', () => {
        renderTab(loadedWith(NIGHTLY_SCHEDULE))

        expect(enableSwitch()).toHaveAttribute('aria-checked', 'true')
        expect(periodicField('cron-input')).toHaveValue('0 2 * * *')
        expect(periodicField('save-directory-input')).toHaveValue('/srv/wave-backups')
        expect(backupApi.getSchedule).not.toHaveBeenCalled()
      })

      it('keeps the description of the section', () => {
        renderTab()

        expect(
          within(periodicSection()).getByText('Schedule automatic backups at regular intervals.'),
        ).toBeInTheDocument()
      })
    })

    describe('First read pending', () => {
      it('shows the "Periodic Backup" heading with no Cancel or Save', () => {
        renderTab({ status: 'pending', saved: undefined })

        const section = within(periodicSection())
        expect(section.getByRole('heading', { name: 'Periodic Backup' })).toBeInTheDocument()
        expect(section.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument()
        expect(section.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument()
      })

      it('shows a skeleton in place of the switch and the fields', () => {
        renderTab({ status: 'pending', saved: undefined })

        expect(periodicSection().querySelector('.skeleton')).not.toBeNull()
        expect(within(periodicSection()).queryByRole('switch')).not.toBeInTheDocument()
        expectFieldsHidden()
      })
    })

    describe('First read failed', () => {
      it('shows the reason with Try Again in place of the switch and the fields', () => {
        renderTab({ status: 'failed', error: SCHEDULE_READ_FAILURE, saved: undefined })

        const section = within(periodicSection())
        expect(section.getByRole('heading', { name: 'Periodic Backup' })).toBeInTheDocument()
        const failure = section.getByRole('alert')
        expect(within(failure).getByText(SCHEDULE_READ_FAILURE)).toBeInTheDocument()
        expect(within(failure).getByRole('button', { name: 'Try Again' })).toBeInTheDocument()
        expect(section.queryByRole('switch')).not.toBeInTheDocument()
        expectFieldsHidden()
      })

      it('shows the "Periodic Backup" heading with no Cancel or Save', () => {
        renderTab({ status: 'failed', error: SCHEDULE_READ_FAILURE, saved: undefined })

        const section = within(periodicSection())
        expect(section.getByRole('heading', { name: 'Periodic Backup' })).toBeInTheDocument()
        expect(section.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument()
        expect(section.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument()
      })

      it('Try Again calls retry', async () => {
        const user = userEvent.setup()
        const { periodicBackup } = renderTab({
          status: 'failed',
          error: SCHEDULE_READ_FAILURE,
          saved: undefined,
        })

        await user.click(within(periodicSection()).getByRole('button', { name: 'Try Again' }))

        expect(periodicBackup.retry).toHaveBeenCalledTimes(1)
      })
    })

    describe('Off, clean', () => {
      it('disables Cancel and Save', () => {
        renderTab()

        expect(cancelButton()).toBeDisabled()
        expect(saveButton()).toBeDisabled()
      })

      it('shows the "Enable periodic backups" switch off and hides the fields', () => {
        renderTab()

        expect(within(periodicSection()).getByText('Enable periodic backups')).toBeInTheDocument()
        expect(enableSwitch()).toHaveAttribute('aria-checked', 'false')
        expect(enableSwitch()).toBeEnabled()
        expectFieldsHidden()
      })
    })

    describe('Header', () => {
      it('puts Cancel, then Save, on the "Periodic Backup" heading line, apart from the switch', () => {
        renderTab()

        const heading = within(periodicSection()).getByRole('heading', { name: 'Periodic Backup' })
        // The smallest ancestor of the heading that holds Save; nesting depth is not pinned.
        let line = heading.parentElement
        while (line && !within(line).queryByRole('button', { name: 'Save' })) {
          line = line.parentElement
        }
        expect(line).not.toBeNull()
        const header = within(line as HTMLElement)
        const cancel = header.getByRole('button', { name: 'Cancel' })
        const save = header.getByRole('button', { name: 'Save' })
        expect(cancel.compareDocumentPosition(save)).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
        expect(save.querySelector('svg.lucide-save')).toBeInTheDocument()
        expect(header.queryByRole('switch')).not.toBeInTheDocument()
        expect(screen.getAllByRole('button', { name: 'Save' })).toHaveLength(1)
        expect(screen.getAllByRole('button', { name: 'Cancel' })).toHaveLength(1)
      })

      it('Save calls save', async () => {
        const user = userEvent.setup()
        const { periodicBackup } = renderTab(loadedWith(FRESH_SCHEDULE, { enabled: true }))

        await user.click(saveButton())

        expect(periodicBackup.save).toHaveBeenCalledTimes(1)
        expect(periodicBackup.cancel).not.toHaveBeenCalled()
      })

      it('Cancel calls cancel', async () => {
        const user = userEvent.setup()
        const { periodicBackup } = renderTab(loadedWith(FRESH_SCHEDULE, { enabled: true }))

        await user.click(cancelButton())

        expect(periodicBackup.cancel).toHaveBeenCalledTimes(1)
        expect(periodicBackup.save).not.toHaveBeenCalled()
      })

      it('does not call save or cancel while the page is clean', async () => {
        const user = userEvent.setup()
        const { periodicBackup } = renderTab()

        await user.click(saveButton())
        await user.click(cancelButton())

        expect(periodicBackup.save).not.toHaveBeenCalled()
        expect(periodicBackup.cancel).not.toHaveBeenCalled()
      })
    })

    describe('Enable switch', () => {
      it('is named "Enable periodic backups" for screen readers', () => {
        renderTab()

        expect(
          within(periodicSection()).getByRole('switch', { name: 'Enable periodic backups' }),
        ).toBeInTheDocument()
        expect(within(periodicSection()).getAllByRole('switch')).toHaveLength(1)
      })

      it('turning it on stages the switch and sends no request', async () => {
        const user = userEvent.setup()
        const { periodicBackup } = renderTab()

        await user.click(enableSwitch())

        expect(periodicBackup.stage).toHaveBeenCalledTimes(1)
        expect(periodicBackup.stage).toHaveBeenCalledWith('enabled', true)
        expect(periodicBackup.save).not.toHaveBeenCalled()
        expect(backupApi.updateSchedule).not.toHaveBeenCalled()
        expect(backupApi.getSchedule).not.toHaveBeenCalled()
      })

      it('turning it off stages the switch and sends no request', async () => {
        const user = userEvent.setup()
        const { periodicBackup } = renderTab(loadedWith(NIGHTLY_SCHEDULE))

        await user.click(enableSwitch())

        expect(periodicBackup.stage).toHaveBeenCalledTimes(1)
        expect(periodicBackup.stage).toHaveBeenCalledWith('enabled', false)
        expect(periodicBackup.save).not.toHaveBeenCalled()
        expect(backupApi.updateSchedule).not.toHaveBeenCalled()
        expect(backupApi.getSchedule).not.toHaveBeenCalled()
      })

      it('follows the staged value, not the click', async () => {
        const user = userEvent.setup()
        renderTab()

        await user.click(enableSwitch())

        expect(enableSwitch()).toHaveAttribute('aria-checked', 'false')
        expectFieldsHidden()
      })
    })

    describe('Switch turned on (staged)', () => {
      it('enables Cancel and Save', () => {
        renderTab(loadedWith(FRESH_SCHEDULE, { enabled: true }))

        expect(cancelButton()).toBeEnabled()
        expect(saveButton()).toBeEnabled()
      })

      it('shows the fields with the fresh-install values', () => {
        renderTab(loadedWith(FRESH_SCHEDULE, { enabled: true }))

        expect(enableSwitch()).toHaveAttribute('aria-checked', 'true')
        expectFieldsShown()
        expect(periodicField('cron-input')).toHaveValue('')
        for (const entityType of EVERY_ENTITY_TYPE) {
          expect(periodicField(`entity-checkbox-${entityType}`)).toHaveAttribute(
            'aria-checked',
            'true',
          )
        }
        expect(periodicField('periodic-format-select')).toHaveTextContent('YAML')
        expect(periodicField('periodic-compression-method-select')).toHaveTextContent('Deflate')
        expect(within(periodicSection()).getByText('Compression Level: 6')).toBeInTheDocument()
        expect(levelThumb()).toHaveAttribute('aria-valuenow', '6')
        expect(periodicField('secrets-mode-mask')).toHaveAttribute('aria-checked', 'true')
        expect(periodicField('max-backups-input')).toHaveValue('5')
        expect(periodicField('save-directory-input')).toHaveValue('~/wave-backups')
      })

      it('shows Save Directory with the server value, no placeholder and no help line', () => {
        renderTab(loadedWith(FRESH_SCHEDULE, { enabled: true }))

        const input = periodicField('save-directory-input')
        expect(input).toHaveValue('~/wave-backups')
        expect(input).not.toHaveAttribute('placeholder')
        expect(input).not.toHaveAttribute('aria-describedby')
        expect(screen.queryByPlaceholderText('Default: data/backup')).not.toBeInTheDocument()
        const label = within(periodicSection()).getByText('Save Directory')
        expect(label.parentElement).toHaveTextContent(/^Save Directory$/)
      })

      it('has no "Save Schedule" button: the header Save is the only Save', () => {
        renderTab(loadedWith(FRESH_SCHEDULE, { enabled: true }))

        expect(screen.queryByRole('button', { name: /save schedule/i })).not.toBeInTheDocument()
        const saves = within(periodicSection()).getAllByRole('button', { name: /save/i })
        expect(saves).toHaveLength(1)
        expect(saves[0]).toBe(saveButton())
      })

      it('shows no next run and no last run line before the schedule ever ran', () => {
        renderTab(loadedWith(FRESH_SCHEDULE, { enabled: true }))

        expect(screen.queryByTestId('next-run-info')).not.toBeInTheDocument()
        expect(screen.queryByTestId('last-run-status')).not.toBeInTheDocument()
      })
    })

    describe('On, clean', () => {
      it('disables Cancel and Save', () => {
        renderTab(loadedWith(NIGHTLY_SCHEDULE))

        expect(cancelButton()).toBeDisabled()
        expect(saveButton()).toBeDisabled()
      })

      it('shows the saved values in the fields', () => {
        renderTab(loadedWith(NIGHTLY_SCHEDULE))

        expect(enableSwitch()).toHaveAttribute('aria-checked', 'true')
        expectFieldsShown()
        expect(periodicField('cron-input')).toHaveValue('0 2 * * *')
        expect(periodicField('entity-checkbox-environments')).toHaveAttribute('aria-checked', 'true')
        expect(periodicField('entity-checkbox-tests')).toHaveAttribute('aria-checked', 'true')
        expect(periodicField('entity-checkbox-suites')).toHaveAttribute('aria-checked', 'false')
        expect(periodicField('entity-checkbox-profiles')).toHaveAttribute('aria-checked', 'false')
        expect(periodicField('periodic-format-select')).toHaveTextContent('JSON')
        expect(periodicField('periodic-compression-method-select')).toHaveTextContent('Bzip2')
        expect(within(periodicSection()).getByText('Compression Level: 9')).toBeInTheDocument()
        expect(levelThumb()).toHaveAttribute('aria-valuenow', '9')
        expect(periodicField('secrets-mode-encrypted')).toHaveAttribute('aria-checked', 'true')
        expect(periodicField('max-backups-input')).toHaveValue('7')
        expect(periodicField('save-directory-input')).toHaveValue('/srv/wave-backups')
      })

      it('renders the secrets mode picker, not the old include-credentials toggle', () => {
        renderTab(loadedWith(NIGHTLY_SCHEDULE))

        expect(periodicField('secrets-mode-picker')).toBeInTheDocument()
        expect(screen.queryByTestId('periodic-include-credentials-toggle')).not.toBeInTheDocument()
      })

      it('shows the next run in UTC and in local time', () => {
        renderTab(loadedWith(NIGHTLY_SCHEDULE))

        expect(periodicField('next-run-info')).toBeInTheDocument()
        expect(periodicField('next-run-utc')).toHaveTextContent(
          'Next Run (UTC): 2026-10-05 02:00 UTC',
        )
        expect(periodicField('next-run-local')).toHaveTextContent(/^Next Run \(.+\): 2026-10-0[45] /)
      })

      it.each(['success', 'failed'] as const)('shows the last run line for a %s run', (status) => {
        renderTab(loadedWith({ ...NIGHTLY_SCHEDULE, last_run_status: status }))

        expect(periodicField('last-run-status')).toHaveTextContent(`Last run: ${status}`)
      })

      it.each([
        ['utc', /^Last run: success at 2026-10-03 02:00:00 UTC$/],
        ['local', /^Last run: success at 2026-10-0[23] \d{2}:\d{2}:00 \S+$/],
      ] as const)('shows the time of the last run in the %s time zone mode', (mode, text) => {
        useTimezoneStore.setState({ mode })

        renderTab(loadedWith(NIGHTLY_SCHEDULE))

        expect(periodicField('last-run-status')).toHaveTextContent(text)
        act(() => {
          useTimezoneStore.setState({ mode: 'local' })
        })
      })

      it('shows the last run result alone when the schedule holds no time for it', () => {
        renderTab(loadedWith({ ...NIGHTLY_SCHEDULE, last_run: null }))

        expect(periodicField('last-run-status')).toHaveTextContent(/^Last run: success$/)
      })

      it('shows no next run and no last run line when the schedule has none', () => {
        renderTab(
          loadedWith({ ...NIGHTLY_SCHEDULE, next_run: null, last_run: null, last_run_status: null }),
        )

        expect(periodicField('cron-input')).toBeInTheDocument()
        expect(screen.queryByTestId('next-run-info')).not.toBeInTheDocument()
        expect(screen.queryByTestId('last-run-status')).not.toBeInTheDocument()
      })

      it('disables the level slider for a compression method that takes no level', () => {
        renderTab(loadedWith({ ...NIGHTLY_SCHEDULE, compression_method: 'lzma' }))

        expect(periodicField('periodic-compression-level-slider')).toHaveAttribute('data-disabled')
      })

      it('leaves the level slider enabled for a compression method that takes a level', () => {
        renderTab(loadedWith(NIGHTLY_SCHEDULE))

        expect(periodicField('periodic-compression-level-slider')).not.toHaveAttribute(
          'data-disabled',
        )
      })
    })

    describe('On, edits staged', () => {
      it('enables Cancel and Save and shows the staged values, not the saved ones', () => {
        renderTab(
          loadedWith(NIGHTLY_SCHEDULE, {
            cron: '30 4 * * 1',
            entity_types: ['suites'],
            max_backups: 12,
            save_directory: '/srv/backups/wave',
            format: 'yaml',
            compression_method: 'deflate',
            compression_level: 3,
            secrets: 'mask',
          }),
        )

        expect(cancelButton()).toBeEnabled()
        expect(saveButton()).toBeEnabled()
        expect(periodicField('cron-input')).toHaveValue('30 4 * * 1')
        expect(periodicField('entity-checkbox-suites')).toHaveAttribute('aria-checked', 'true')
        expect(periodicField('entity-checkbox-tests')).toHaveAttribute('aria-checked', 'false')
        expect(periodicField('periodic-format-select')).toHaveTextContent('YAML')
        expect(periodicField('periodic-compression-method-select')).toHaveTextContent('Deflate')
        expect(levelThumb()).toHaveAttribute('aria-valuenow', '3')
        expect(periodicField('secrets-mode-mask')).toHaveAttribute('aria-checked', 'true')
        expect(periodicField('max-backups-input')).toHaveValue('12')
        expect(periodicField('save-directory-input')).toHaveValue('/srv/backups/wave')
      })

      it('keeps showing the next run and last run of the saved schedule while another cron is staged', () => {
        renderTab(loadedWith(NIGHTLY_SCHEDULE, { cron: '30 4 * * 1' }))

        expect(periodicField('cron-input')).toHaveValue('30 4 * * 1')
        expect(periodicField('next-run-utc')).toHaveTextContent(
          'Next Run (UTC): 2026-10-05 02:00 UTC',
        )
        expect(periodicField('next-run-local')).toBeInTheDocument()
        expect(periodicField('last-run-status')).toHaveTextContent('Last run: success')
      })

      it('shows the last run of a schedule that was turned off once the switch is staged back on', () => {
        renderTab(
          loadedWith({ ...NIGHTLY_SCHEDULE, enabled: false, next_run: null }, { enabled: true }),
        )

        expect(periodicField('last-run-status')).toHaveTextContent('Last run: success')
        expect(screen.queryByTestId('next-run-info')).not.toBeInTheDocument()
      })

      it('shows the backup plaintext warning when the staged secrets mode is Decrypt', () => {
        renderTab(loadedWith(NIGHTLY_SCHEDULE, { secrets: 'plaintext' }))

        expect(periodicField('secrets-plaintext-warning')).toHaveTextContent(
          'Secrets will be written in plain text. Handle the backup file securely.',
        )
      })

      it('typing a cron expression stages it', () => {
        const { periodicBackup } = renderTab(loadedWith(NIGHTLY_SCHEDULE))

        fireEvent.change(periodicField('cron-input'), { target: { value: '15 3 * * *' } })

        expect(periodicBackup.stage).toHaveBeenCalledTimes(1)
        expect(periodicBackup.stage).toHaveBeenCalledWith('cron', '15 3 * * *')
      })

      it('unchecking an entity type stages the remaining types', async () => {
        const user = userEvent.setup()
        const { periodicBackup } = renderTab(loadedWith(NIGHTLY_SCHEDULE))

        await user.click(periodicField('entity-checkbox-tests'))

        expect(periodicBackup.stage).toHaveBeenCalledTimes(1)
        expect(periodicBackup.stage).toHaveBeenCalledWith('entity_types', ['environments'])
      })

      it('checking an entity type stages it with the others', async () => {
        const user = userEvent.setup()
        const { periodicBackup } = renderTab(loadedWith(NIGHTLY_SCHEDULE))

        await user.click(periodicField('entity-checkbox-suites'))

        expect(periodicBackup.stage).toHaveBeenCalledTimes(1)
        const [field, value] = vi.mocked(periodicBackup.stage).mock.calls[0]
        expect(field).toBe('entity_types')
        expect([...(value as string[])].sort()).toEqual(['environments', 'suites', 'tests'])
      })

      it('choosing a format stages it', async () => {
        const user = userEvent.setup()
        const { periodicBackup } = renderTab(loadedWith(NIGHTLY_SCHEDULE))

        await user.click(periodicField('periodic-format-select'))
        await user.click(screen.getByRole('option', { name: 'YAML' }))

        expect(periodicBackup.stage).toHaveBeenCalledTimes(1)
        expect(periodicBackup.stage).toHaveBeenCalledWith('format', 'yaml')
      })

      it('choosing a compression method stages it', async () => {
        const user = userEvent.setup()
        const { periodicBackup } = renderTab(loadedWith(NIGHTLY_SCHEDULE))

        await user.click(periodicField('periodic-compression-method-select'))
        await user.click(screen.getByRole('option', { name: 'LZMA' }))

        expect(periodicBackup.stage).toHaveBeenCalledTimes(1)
        expect(periodicBackup.stage).toHaveBeenCalledWith('compression_method', 'lzma')
      })

      it('moving the level slider stages the level', async () => {
        const user = userEvent.setup()
        const { periodicBackup } = renderTab(loadedWith(NIGHTLY_SCHEDULE))

        levelThumb().focus()
        await user.keyboard('{ArrowLeft}')

        expect(periodicBackup.stage).toHaveBeenCalledTimes(1)
        expect(periodicBackup.stage).toHaveBeenCalledWith('compression_level', 8)
      })

      it('choosing a secrets mode stages it', async () => {
        const user = userEvent.setup()
        const { periodicBackup } = renderTab(loadedWith(NIGHTLY_SCHEDULE))

        await user.click(periodicField('secrets-mode-plaintext'))

        expect(periodicBackup.stage).toHaveBeenCalledTimes(1)
        expect(periodicBackup.stage).toHaveBeenCalledWith('secrets', 'plaintext')
      })

      it('typing a number of backups to keep stages it as a number', () => {
        const { periodicBackup } = renderTab(loadedWith(NIGHTLY_SCHEDULE))

        fireEvent.change(periodicField('max-backups-input'), { target: { value: '12' } })

        expect(periodicBackup.stage).toHaveBeenCalledTimes(1)
        expect(periodicBackup.stage).toHaveBeenCalledWith('max_backups', 12)
      })

      it('an emptied Max Backups box stays empty and stages nothing', () => {
        const { periodicBackup } = renderTab(loadedWith(NIGHTLY_SCHEDULE))

        fireEvent.change(periodicField('max-backups-input'), { target: { value: '' } })

        expect(periodicField('max-backups-input')).toHaveValue('')
        expect(periodicBackup.stage).not.toHaveBeenCalled()
      })

      it('a Max Backups box left empty goes back to the number it held', () => {
        renderTab(loadedWith(NIGHTLY_SCHEDULE))

        fireEvent.change(periodicField('max-backups-input'), { target: { value: '' } })
        fireEvent.blur(periodicField('max-backups-input'))

        expect(periodicField('max-backups-input')).toHaveValue('7')
      })

      it('drops a key the number rule refuses in Max Backups and never shows spinner arrows (REQ-3.1.3.14)', () => {
        const { periodicBackup } = renderTab(loadedWith(NIGHTLY_SCHEDULE))

        fireEvent.change(periodicField('max-backups-input'), { target: { value: '1.5' } })
        fireEvent.change(periodicField('max-backups-input'), { target: { value: '-1' } })
        fireEvent.change(periodicField('max-backups-input'), { target: { value: '1e3' } })

        expect(periodicField('max-backups-input')).toHaveValue('7')
        expect(periodicField('max-backups-input')).toHaveAttribute('type', 'text')
        expect(periodicField('max-backups-input')).toHaveAttribute('inputmode', 'numeric')
        expect(periodicBackup.stage).not.toHaveBeenCalled()
      })

      it('stages a count past what a JS number holds as its exact digits', () => {
        const { periodicBackup } = renderTab(loadedWith(NIGHTLY_SCHEDULE))

        fireEvent.change(periodicField('max-backups-input'), { target: { value: '9007199254740993' } })

        expect(periodicBackup.stage).toHaveBeenCalledWith('max_backups', '9007199254740993')
      })

      it('a number of backups below 1 is shown while typed and not staged', () => {
        const { periodicBackup } = renderTab(loadedWith(NIGHTLY_SCHEDULE))

        fireEvent.change(periodicField('max-backups-input'), { target: { value: '0' } })

        expect(periodicField('max-backups-input')).toHaveValue('0')
        expect(periodicBackup.stage).not.toHaveBeenCalled()
      })

      it('typing a save directory stages it', () => {
        const { periodicBackup } = renderTab(loadedWith(NIGHTLY_SCHEDULE))

        fireEvent.change(periodicField('save-directory-input'), {
          target: { value: '/srv/backups/wave' },
        })

        expect(periodicBackup.stage).toHaveBeenCalledTimes(1)
        expect(periodicBackup.stage).toHaveBeenCalledWith('save_directory', '/srv/backups/wave')
      })

      it('sends no request while fields are edited', async () => {
        const user = userEvent.setup()
        const { periodicBackup } = renderTab(loadedWith(NIGHTLY_SCHEDULE))

        fireEvent.change(periodicField('cron-input'), { target: { value: '15 3 * * *' } })
        await user.click(periodicField('entity-checkbox-tests'))
        await user.click(periodicField('secrets-mode-plaintext'))

        expect(periodicBackup.save).not.toHaveBeenCalled()
        expect(backupApi.updateSchedule).not.toHaveBeenCalled()
        expect(backupApi.getSchedule).not.toHaveBeenCalled()
      })
    })

    describe('Switch turned off (staged)', () => {
      it('hides the fields and enables Cancel and Save', () => {
        renderTab(loadedWith(NIGHTLY_SCHEDULE, { enabled: false }))

        expect(enableSwitch()).toHaveAttribute('aria-checked', 'false')
        expectFieldsHidden()
        expect(cancelButton()).toBeEnabled()
        expect(saveButton()).toBeEnabled()
      })

      it('hides the next run and last run lines with the fields', () => {
        renderTab(loadedWith(NIGHTLY_SCHEDULE, { enabled: false }))

        expect(screen.queryByTestId('next-run-info')).not.toBeInTheDocument()
        expect(screen.queryByTestId('last-run-status')).not.toBeInTheDocument()
      })
    })

    describe('Staged values back at the saved ones', () => {
      it('disables Cancel and Save again after an edit is taken back', () => {
        const { rerender } = renderTab(loadedWith(NIGHTLY_SCHEDULE, { max_backups: 12 }))
        expect(cancelButton()).toBeEnabled()
        expect(saveButton()).toBeEnabled()

        rerender(
          <BackupRestoreTab periodicBackup={makePeriodicBackup(loadedWith(NIGHTLY_SCHEDULE))} />,
        )

        expect(cancelButton()).toBeDisabled()
        expect(saveButton()).toBeDisabled()
        expect(periodicField('max-backups-input')).toHaveValue('7')
      })

      it('disables Cancel and Save again after an entity type is unchecked and checked again', () => {
        const reordered = { ...stagedOf(NIGHTLY_SCHEDULE), entity_types: ['tests', 'environments'] }
        const { rerender } = renderTab(loadedWith(NIGHTLY_SCHEDULE, { entity_types: ['tests'] }))
        expect(saveButton()).toBeEnabled()

        rerender(
          <BackupRestoreTab
            periodicBackup={makePeriodicBackup({ saved: NIGHTLY_SCHEDULE, staged: reordered })}
          />,
        )

        expect(cancelButton()).toBeDisabled()
        expect(saveButton()).toBeDisabled()
        expect(periodicField('entity-checkbox-environments')).toHaveAttribute('aria-checked', 'true')
        expect(periodicField('entity-checkbox-tests')).toHaveAttribute('aria-checked', 'true')
      })

      it('disables Cancel and Save again after the switch is turned on and off again', () => {
        const { rerender } = renderTab(loadedWith(FRESH_SCHEDULE, { enabled: true }))
        expect(saveButton()).toBeEnabled()

        rerender(
          <BackupRestoreTab periodicBackup={makePeriodicBackup(loadedWith(FRESH_SCHEDULE))} />,
        )

        expect(cancelButton()).toBeDisabled()
        expect(saveButton()).toBeDisabled()
        expectFieldsHidden()
      })
    })

    describe('Saving', () => {
      it('shows Save busy and disables Cancel', () => {
        renderTab({ ...loadedWith(NIGHTLY_SCHEDULE, { max_backups: 12 }), saving: true })

        expect(saveButton()).toHaveAttribute('aria-busy', 'true')
        expect(saveButton()).toBeDisabled()
        expect(cancelButton()).toBeDisabled()
      })

      it('disables the switch and the fields', () => {
        renderTab({ ...loadedWith(NIGHTLY_SCHEDULE, { max_backups: 12 }), saving: true })

        expect(enableSwitch()).toBeDisabled()
        expect(periodicField('cron-input')).toBeDisabled()
        expect(periodicField('periodic-format-select')).toBeDisabled()
        expect(periodicField('periodic-compression-method-select')).toBeDisabled()
        expect(periodicField('periodic-compression-level-slider')).toHaveAttribute('data-disabled')
        expect(periodicField('max-backups-input')).toBeDisabled()
        expect(periodicField('save-directory-input')).toBeDisabled()
      })

      it('disables every entity checkbox, Select all and Deselect all', () => {
        renderTab({ ...loadedWith(NIGHTLY_SCHEDULE, { max_backups: 12 }), saving: true })

        for (const entityType of EVERY_ENTITY_TYPE) {
          expect(periodicField(`entity-checkbox-${entityType}`)).toBeDisabled()
        }
        const selector = within(periodicField('entity-selector'))
        expect(selector.getByRole('button', { name: 'Select all' })).toBeDisabled()
        expect(selector.getByRole('button', { name: 'Deselect all' })).toBeDisabled()
      })

      it('disables the Secret values radios', () => {
        renderTab({ ...loadedWith(NIGHTLY_SCHEDULE, { max_backups: 12 }), saving: true })

        for (const mode of SECRETS_MODES) {
          expect(periodicField(`secrets-mode-${mode}`)).toBeDisabled()
        }
      })

      it('stages nothing when a checkbox or a radio is clicked', async () => {
        const user = userEvent.setup()
        const { periodicBackup } = renderTab({
          ...loadedWith(NIGHTLY_SCHEDULE, { max_backups: 12 }),
          saving: true,
        })

        await user.click(periodicField('entity-checkbox-tests'))
        await user.click(periodicField('secrets-mode-plaintext'))

        expect(periodicBackup.stage).not.toHaveBeenCalled()
      })

      it('leaves the switch and the fields enabled while not saving', () => {
        renderTab(loadedWith(NIGHTLY_SCHEDULE, { max_backups: 12 }))

        expect(enableSwitch()).toBeEnabled()
        expect(periodicField('cron-input')).toBeEnabled()
        expect(periodicField('periodic-format-select')).toBeEnabled()
        expect(periodicField('periodic-compression-method-select')).toBeEnabled()
        expect(periodicField('max-backups-input')).toBeEnabled()
        expect(periodicField('save-directory-input')).toBeEnabled()
        for (const entityType of EVERY_ENTITY_TYPE) {
          expect(periodicField(`entity-checkbox-${entityType}`)).toBeEnabled()
        }
        const selector = within(periodicField('entity-selector'))
        expect(selector.getByRole('button', { name: 'Select all' })).toBeEnabled()
        expect(selector.getByRole('button', { name: 'Deselect all' })).toBeEnabled()
        for (const mode of SECRETS_MODES) {
          expect(periodicField(`secrets-mode-${mode}`)).toBeEnabled()
        }
      })

      it('does not call save again when the busy Save is clicked', async () => {
        const user = userEvent.setup()
        const { periodicBackup } = renderTab({
          ...loadedWith(NIGHTLY_SCHEDULE, { max_backups: 12 }),
          saving: true,
        })

        await user.click(saveButton())

        expect(periodicBackup.save).not.toHaveBeenCalled()
      })
    })

    it('a schedule saved with eight parts shows Functions unticked', () => {
      const savedParts = EVERY_ENTITY_TYPE.filter((entityType) => entityType !== 'functions')
      expect(savedParts).toHaveLength(8)

      renderTab(loadedWith({ ...NIGHTLY_SCHEDULE, entity_types: savedParts }))

      expect(periodicField('entity-checkbox-functions')).toHaveAttribute('aria-checked', 'false')
      for (const entityType of savedParts) {
        expect(periodicField(`entity-checkbox-${entityType}`)).toHaveAttribute(
          'aria-checked',
          'true',
        )
      }
    })
  })

  describe('Periodic Backup shows no inline save error', () => {
    it.each(SECTION_STATES)('has none in the state: %s', (_state, overrides) => {
      renderTab(overrides)

      expect(screen.queryByTestId('periodic-backup-write-error')).not.toBeInTheDocument()
    })

    it('has none after a failed Save: the staged values stay and nothing else shows', () => {
      const staged = loadedWith(NIGHTLY_SCHEDULE, { save_directory: '/srv/wave/data/backups' })
      const { rerender } = renderTab({ ...staged, saving: true })

      rerender(<BackupRestoreTab periodicBackup={makePeriodicBackup(staged)} />)

      expect(screen.queryByTestId('periodic-backup-write-error')).not.toBeInTheDocument()
      expect(within(periodicSection()).queryByRole('alert')).not.toBeInTheDocument()
      expect(periodicField('save-directory-input')).toHaveValue('/srv/wave/data/backups')
      expect(saveButton()).toBeEnabled()
      expect(cancelButton()).toBeEnabled()
    })
  })

  describe('PeriodicBackupSection on its own', () => {
    beforeEach(() => {
      vi.mocked(backupApi.getSchedule).mockClear()
      vi.mocked(backupApi.updateSchedule).mockClear()
    })

    it('renders the schedule its schedule prop holds and reads nothing itself', () => {
      render(<PeriodicBackupSection schedule={makePeriodicBackup(loadedWith(NIGHTLY_SCHEDULE))} />)

      expect(enableSwitch()).toHaveAttribute('aria-checked', 'true')
      expect(periodicField('cron-input')).toHaveValue('0 2 * * *')
      expect(periodicField('max-backups-input')).toHaveValue('7')
      expect(backupApi.getSchedule).not.toHaveBeenCalled()
    })

    it('Save, Cancel and the switch call the functions of its schedule prop', async () => {
      const user = userEvent.setup()
      const schedule = makePeriodicBackup(loadedWith(NIGHTLY_SCHEDULE, { max_backups: 12 }))
      render(<PeriodicBackupSection schedule={schedule} />)

      await user.click(saveButton())
      await user.click(cancelButton())
      await user.click(enableSwitch())

      expect(schedule.save).toHaveBeenCalledTimes(1)
      expect(schedule.cancel).toHaveBeenCalledTimes(1)
      expect(schedule.stage).toHaveBeenCalledWith('enabled', false)
      expect(backupApi.updateSchedule).not.toHaveBeenCalled()
    })
  })

  describe('formatLocalTime timezone fallback', () => {
    const RealDateTimeFormat = Intl.DateTimeFormat

    /** Makes Intl.DateTimeFormat answer the given parts, so the time zone name can be left out. */
    function stubDateTimeParts(parts: Intl.DateTimeFormatPart[]) {
      vi.spyOn(Intl, 'DateTimeFormat').mockImplementation((...args) => {
        const instance = new RealDateTimeFormat(...args)
        return {
          ...instance,
          formatToParts: () => parts,
          format: instance.format.bind(instance),
          resolvedOptions: instance.resolvedOptions.bind(instance),
        } as Intl.DateTimeFormat
      })
    }

    afterEach(() => {
      if (vi.isMockFunction(Intl.DateTimeFormat)) vi.mocked(Intl.DateTimeFormat).mockRestore()
    })

    it('falls back to "Local" when Intl.DateTimeFormat has no timeZoneName part', () => {
      stubDateTimeParts([
        { type: 'month', value: '3' },
        { type: 'literal', value: '/' },
        { type: 'day', value: '10' },
        { type: 'literal', value: '/' },
        { type: 'year', value: '2026' },
      ])

      renderTab(
        loadedWith({
          ...NIGHTLY_SCHEDULE,
          next_run: '2026-03-10T02:00:00Z',
          last_run: null,
          last_run_status: null,
        }),
      )

      expect(periodicField('next-run-local')).toHaveTextContent('Local')
    })

    it('falls back to "Local" in the heading of the local line when the time zone name is blank', () => {
      stubDateTimeParts([
        { type: 'month', value: '3' },
        { type: 'literal', value: '/' },
        { type: 'day', value: '10' },
        { type: 'literal', value: '/' },
        { type: 'year', value: '2026' },
        { type: 'timeZoneName', value: ' ' },
      ])

      renderTab(loadedWith({ ...NIGHTLY_SCHEDULE, next_run: '2026-03-10T02:00:00Z' }))

      expect(periodicField('next-run-local')).toHaveTextContent(/Next Run \(Local\)/)
    })
  })
})
