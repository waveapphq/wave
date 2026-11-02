/**
 * usePeriodicBackup Hook Tests
 *
 * REQ-4.7.20, REQ-4.7.16: the Periodic Backup schedule state (SETTINGS-21) - read on
 * activation, staged fields, one PUT on Save, Cancel.
 *
 * Module under test: frontend/src/features/settings/container/use-periodic-backup.ts
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'

const { toastSuccess, toastError } = vi.hoisted(() => ({
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}))

vi.mock('@/components/ui/toast', () => ({
  useToast: () => ({ success: toastSuccess, error: toastError, warning: vi.fn(), info: vi.fn() }),
}))

vi.mock('@/features/settings/api/backup', () => ({
  createBackup: vi.fn(),
  validateBackup: vi.fn(),
  restoreBackup: vi.fn(),
  getSchedule: vi.fn(),
  updateSchedule: vi.fn(),
}))

import {
  getSchedule,
  updateSchedule,
  type BackupSchedule,
} from '@/features/settings/api/backup'
import {
  usePeriodicBackup,
  type ScheduleStaged,
} from '@/features/settings/container/use-periodic-backup'

const mockGetSchedule = vi.mocked(getSchedule)
const mockUpdateSchedule = vi.mocked(updateSchedule)

// ============================================================================
// Fixtures
// ============================================================================

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
const FRESH_SCHEDULE: BackupSchedule = {
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

const NIGHTLY_SCHEDULE: BackupSchedule = {
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

/** The nightly schedule after it was turned off: the server keeps every other value. */
const NIGHTLY_TURNED_OFF: BackupSchedule = { ...NIGHTLY_SCHEDULE, enabled: false, next_run: null }

type StagedEdit = [keyof ScheduleStaged, ScheduleStaged[keyof ScheduleStaged]]

/** One new value per staged field, each different from the fresh-install value. */
const FIELD_EDITS: StagedEdit[] = [
  ['enabled', true],
  ['cron', '30 4 * * 1'],
  ['entity_types', ['suites', 'tests']],
  ['max_backups', 12],
  ['save_directory', '/srv/backups/wave'],
  ['format', 'json'],
  ['compression_method', 'lzma'],
  ['compression_level', 3],
  ['secrets', 'plaintext'],
]

const READ_FAILURE = 'Failed to fetch schedule'

const SAVE_FAILURE = 'Save directory must be outside the data folder: /srv/wave/data'

const SAVE_FAILURE_TITLE = 'Could Not Save Backup Schedule'

/** The fields of a schedule the page stages. */
function stagedOf(schedule: BackupSchedule): ScheduleStaged {
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

/** The saved values as new objects, so an equal value is never the same array. */
function savedCopyOf(schedule: BackupSchedule): ScheduleStaged {
  return { ...stagedOf(schedule), entity_types: [...schedule.entity_types] }
}

function apiError(message: string, status: number): Error {
  return Object.assign(new Error(message), { status })
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

// ============================================================================
// Utilities
// ============================================================================

async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

function renderPeriodicBackup(active: boolean) {
  return renderHook(({ active: isActive }: { active: boolean }) => usePeriodicBackup(isActive), {
    initialProps: { active },
  })
}

/** Stages each edit in its own update, as separate gestures on the page do. */
function stageAll(
  result: { current: ReturnType<typeof usePeriodicBackup> },
  edits: Partial<ScheduleStaged>,
) {
  for (const [field, value] of Object.entries(edits) as StagedEdit[]) {
    act(() => {
      result.current.stage(field, value)
    })
  }
}

async function renderLoaded(schedule: BackupSchedule = FRESH_SCHEDULE) {
  mockGetSchedule.mockResolvedValueOnce(schedule)
  const view = renderPeriodicBackup(true)
  await flush()
  expect(view.result.current.status).toBe('loaded')
  return view
}

// ============================================================================
// Tests
// ============================================================================

describe('usePeriodicBackup', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Reset, not clear: an answer queued by a failed test must not reach the next one.
    mockGetSchedule.mockReset().mockResolvedValue(FRESH_SCHEDULE)
    mockUpdateSchedule.mockReset().mockResolvedValue(FRESH_SCHEDULE)
  })

  describe('read', () => {
    it('does not read while the page is inactive', async () => {
      const { result } = renderPeriodicBackup(false)
      await flush()

      expect(mockGetSchedule).not.toHaveBeenCalled()
      expect(result.current.status).toBe('pending')
    })

    it('a Save asked before the first read has answered sends nothing', async () => {
      const { result } = renderPeriodicBackup(false)
      await flush()

      await act(async () => {
        result.current.save()
      })
      await flush()

      expect(mockUpdateSchedule).not.toHaveBeenCalled()
      expect(result.current.saving).toBe(false)
      expect(result.current.dirty).toBe(false)
      expect(toastError).not.toHaveBeenCalled()
    })

    it('is pending while the first read is in flight, then loaded with the saved schedule', async () => {
      const read = deferred<BackupSchedule>()
      mockGetSchedule.mockReturnValueOnce(read.promise)

      const { result } = renderPeriodicBackup(true)
      await flush()
      expect(mockGetSchedule).toHaveBeenCalledTimes(1)
      expect(result.current.status).toBe('pending')

      await act(async () => {
        read.resolve(NIGHTLY_SCHEDULE)
      })
      await flush()

      expect(result.current.status).toBe('loaded')
      expect(result.current.error).toBeUndefined()
      expect(result.current.saved).toEqual(NIGHTLY_SCHEDULE)
      expect(result.current.staged).toEqual(stagedOf(NIGHTLY_SCHEDULE))
      expect(result.current.dirty).toBe(false)
      expect(result.current.saving).toBe(false)
    })

    it('loads the fresh-install defaults as the server answers them', async () => {
      const { result } = await renderLoaded(FRESH_SCHEDULE)

      expect(result.current.saved).toEqual(FRESH_SCHEDULE)
      expect(result.current.staged).toEqual({
        enabled: false,
        cron: '',
        entity_types: EVERY_ENTITY_TYPE,
        max_backups: 5,
        save_directory: '~/wave-backups',
        format: 'yaml',
        compression_method: 'deflate',
        compression_level: 6,
        secrets: 'mask',
      })
      expect(result.current.dirty).toBe(false)
    })

    it('reads once the page turns active', async () => {
      const view = renderPeriodicBackup(false)
      await flush()

      view.rerender({ active: true })
      await flush()

      expect(mockGetSchedule).toHaveBeenCalledTimes(1)
      expect(view.result.current.status).toBe('loaded')
    })

    it('does not read again while the page stays active', async () => {
      const view = await renderLoaded()

      view.rerender({ active: true })
      await flush()

      expect(mockGetSchedule).toHaveBeenCalledTimes(1)
    })

    it('is failed with the API message when the read fails', async () => {
      mockGetSchedule.mockRejectedValueOnce(apiError(READ_FAILURE, 500))

      const { result } = renderPeriodicBackup(true)
      await flush()

      expect(result.current.status).toBe('failed')
      expect(result.current.error).toBe(READ_FAILURE)
      expect(result.current.saved).toBeUndefined()
    })

    it('retry reads again: pending, then loaded', async () => {
      mockGetSchedule.mockRejectedValueOnce(apiError(READ_FAILURE, 500))
      const { result } = renderPeriodicBackup(true)
      await flush()
      expect(result.current.status).toBe('failed')

      const read = deferred<BackupSchedule>()
      mockGetSchedule.mockReturnValueOnce(read.promise)
      act(() => {
        result.current.retry()
      })
      await flush()
      expect(mockGetSchedule).toHaveBeenCalledTimes(2)
      expect(result.current.status).toBe('pending')

      await act(async () => {
        read.resolve(NIGHTLY_SCHEDULE)
      })
      await flush()

      expect(result.current.status).toBe('loaded')
      expect(result.current.error).toBeUndefined()
      expect(result.current.saved).toEqual(NIGHTLY_SCHEDULE)
      expect(result.current.staged).toEqual(stagedOf(NIGHTLY_SCHEDULE))
    })

    it('reads again when a clean page turns active again', async () => {
      const view = await renderLoaded(FRESH_SCHEDULE)
      mockGetSchedule.mockResolvedValueOnce(NIGHTLY_SCHEDULE)

      view.rerender({ active: false })
      await flush()
      view.rerender({ active: true })
      await flush()

      expect(mockGetSchedule).toHaveBeenCalledTimes(2)
      expect(view.result.current.saved).toEqual(NIGHTLY_SCHEDULE)
      expect(view.result.current.staged).toEqual(stagedOf(NIGHTLY_SCHEDULE))
    })

    it('keeps the staged values and does not read when a dirty page turns active again', async () => {
      const view = await renderLoaded(FRESH_SCHEDULE)
      stageAll(view.result, {
        enabled: true,
        cron: '0 2 * * *',
      })

      view.rerender({ active: false })
      await flush()
      view.rerender({ active: true })
      await flush()

      expect(mockGetSchedule).toHaveBeenCalledTimes(1)
      expect(view.result.current.dirty).toBe(true)
      expect(view.result.current.staged).toEqual({
        ...stagedOf(FRESH_SCHEDULE),
        enabled: true,
        cron: '0 2 * * *',
      })
    })
  })

  describe('staging', () => {
    it.each(FIELD_EDITS)(
      'stage(%s) holds the new value, marks the page dirty and sends nothing',
      async (field, value) => {
        const { result } = await renderLoaded(FRESH_SCHEDULE)

        act(() => {
          result.current.stage(field, value)
        })

        expect(result.current.staged).toEqual({ ...stagedOf(FRESH_SCHEDULE), [field]: value })
        expect(result.current.dirty).toBe(true)
        expect(result.current.saved).toEqual(FRESH_SCHEDULE)
        expect(mockUpdateSchedule).not.toHaveBeenCalled()
        expect(mockGetSchedule).toHaveBeenCalledTimes(1)
      },
    )

    it.each(FIELD_EDITS)(
      'stage(%s) back to the saved value makes the page clean again',
      async (field, value) => {
        const { result } = await renderLoaded(FRESH_SCHEDULE)
        act(() => {
          result.current.stage(field, value)
        })
        expect(result.current.dirty).toBe(true)

        act(() => {
          result.current.stage(field, savedCopyOf(FRESH_SCHEDULE)[field])
        })

        expect(result.current.dirty).toBe(false)
        expect(result.current.staged).toEqual(stagedOf(FRESH_SCHEDULE))
        expect(mockUpdateSchedule).not.toHaveBeenCalled()
      },
    )

    it('is clean again when an entity type is unchecked and checked again, which moves it to the end', async () => {
      const { result } = await renderLoaded(NIGHTLY_SCHEDULE)

      stageAll(result, { entity_types: ['tests'] })
      expect(result.current.dirty).toBe(true)
      stageAll(result, { entity_types: ['tests', 'environments'] })

      expect(result.current.dirty).toBe(false)
    })

    it('is clean when every entity type is selected again in another order', async () => {
      const { result } = await renderLoaded(FRESH_SCHEDULE)

      stageAll(result, { entity_types: [] })
      expect(result.current.dirty).toBe(true)
      stageAll(result, { entity_types: [...EVERY_ENTITY_TYPE].reverse() })

      expect(result.current.dirty).toBe(false)
    })

    it.each([
      ['one type fewer', ['tests']],
      ['one type more', ['environments', 'tests', 'suites']],
      ['as many types, one of them another', ['environments', 'suites']],
    ])('is dirty with a different set of entity types: %s', async (_case, entityTypes) => {
      const { result } = await renderLoaded(NIGHTLY_SCHEDULE)

      stageAll(result, { entity_types: entityTypes })

      expect(result.current.dirty).toBe(true)
    })

    it('stays dirty until every staged field is back at its saved value', async () => {
      const { result } = await renderLoaded(NIGHTLY_SCHEDULE)
      stageAll(result, { cron: '30 4 * * 1', max_backups: 12 })

      stageAll(result, { cron: '0 2 * * *' })
      expect(result.current.dirty).toBe(true)

      stageAll(result, { max_backups: 7 })
      expect(result.current.dirty).toBe(false)
      expect(result.current.staged).toEqual(stagedOf(NIGHTLY_SCHEDULE))
    })

    it('is clean again when the switch is turned on and off again', async () => {
      const { result } = await renderLoaded(FRESH_SCHEDULE)

      stageAll(result, { enabled: true })
      expect(result.current.dirty).toBe(true)
      stageAll(result, { enabled: false })

      expect(result.current.dirty).toBe(false)
    })

    it('reads again on the next activation once the staged values are back at the saved ones', async () => {
      const view = await renderLoaded(FRESH_SCHEDULE)
      stageAll(view.result, { cron: '0 2 * * *' })
      stageAll(view.result, { cron: '' })
      mockGetSchedule.mockResolvedValueOnce(NIGHTLY_SCHEDULE)

      view.rerender({ active: false })
      await flush()
      view.rerender({ active: true })
      await flush()

      expect(mockGetSchedule).toHaveBeenCalledTimes(2)
      expect(view.result.current.saved).toEqual(NIGHTLY_SCHEDULE)
    })

    it('holds several staged fields together', async () => {
      const { result } = await renderLoaded(NIGHTLY_SCHEDULE)

      stageAll(result, {
        cron: '30 4 * * 1',
        max_backups: 12,
        save_directory: '/srv/backups/wave',
      })

      expect(result.current.staged).toEqual({
        ...stagedOf(NIGHTLY_SCHEDULE),
        cron: '30 4 * * 1',
        max_backups: 12,
        save_directory: '/srv/backups/wave',
      })
      expect(result.current.dirty).toBe(true)
    })

    it('turning the schedule off keeps the other staged values on the page', async () => {
      const { result } = await renderLoaded(NIGHTLY_SCHEDULE)

      stageAll(result, { enabled: false })

      expect(result.current.staged).toEqual({ ...stagedOf(NIGHTLY_SCHEDULE), enabled: false })
      expect(result.current.dirty).toBe(true)
      expect(mockUpdateSchedule).not.toHaveBeenCalled()
    })
  })

  describe('cancel', () => {
    it('restores the saved values and sends nothing', async () => {
      const { result } = await renderLoaded(NIGHTLY_SCHEDULE)
      stageAll(result, {
        enabled: false,
        cron: '30 4 * * 1',
        entity_types: ['tests'],
      })
      expect(result.current.dirty).toBe(true)

      act(() => {
        result.current.cancel()
      })

      expect(result.current.staged).toEqual(stagedOf(NIGHTLY_SCHEDULE))
      expect(result.current.saved).toEqual(NIGHTLY_SCHEDULE)
      expect(result.current.dirty).toBe(false)
      expect(mockUpdateSchedule).not.toHaveBeenCalled()
      expect(mockGetSchedule).toHaveBeenCalledTimes(1)
    })
  })

  describe('save', () => {
    it('with the schedule turned on sends the whole staged schedule in one PUT', async () => {
      const { result } = await renderLoaded(FRESH_SCHEDULE)
      stageAll(result, {
        enabled: true,
        cron: '0 2 * * *',
      })

      await act(async () => {
        result.current.save()
      })
      await flush()

      expect(mockUpdateSchedule).toHaveBeenCalledTimes(1)
      expect(mockUpdateSchedule.mock.calls[0][0]).toStrictEqual({
        enabled: true,
        cron: '0 2 * * *',
        entity_types: EVERY_ENTITY_TYPE,
        max_backups: 5,
        save_directory: '~/wave-backups',
        format: 'yaml',
        compression_method: 'deflate',
        compression_level: 6,
        secrets: 'mask',
      })
    })

    it('with the schedule already on sends every staged field, changed or not', async () => {
      const { result } = await renderLoaded(NIGHTLY_SCHEDULE)
      stageAll(result, {
        max_backups: 12,
        save_directory: '/srv/backups/wave',
      })

      await act(async () => {
        result.current.save()
      })
      await flush()

      expect(mockUpdateSchedule).toHaveBeenCalledTimes(1)
      expect(mockUpdateSchedule.mock.calls[0][0]).toStrictEqual({
        ...stagedOf(NIGHTLY_SCHEDULE),
        max_backups: 12,
        save_directory: '/srv/backups/wave',
      })
    })

    it('with the schedule turned off sends exactly { enabled: false }', async () => {
      const { result } = await renderLoaded(NIGHTLY_SCHEDULE)
      stageAll(result, { enabled: false })

      await act(async () => {
        result.current.save()
      })
      await flush()

      expect(mockUpdateSchedule).toHaveBeenCalledTimes(1)
      expect(mockUpdateSchedule.mock.calls[0][0]).toStrictEqual({ enabled: false })
    })

    it('with the schedule turned off leaves other staged edits out of the request', async () => {
      const { result } = await renderLoaded(NIGHTLY_SCHEDULE)
      stageAll(result, {
        cron: '30 4 * * 1',
        save_directory: '/srv/backups/wave',
        enabled: false,
      })

      await act(async () => {
        result.current.save()
      })
      await flush()

      expect(mockUpdateSchedule).toHaveBeenCalledTimes(1)
      expect(mockUpdateSchedule.mock.calls[0][0]).toStrictEqual({ enabled: false })
    })

    it('is saving while the request is in flight', async () => {
      const write = deferred<BackupSchedule>()
      mockUpdateSchedule.mockReturnValueOnce(write.promise)
      const { result } = await renderLoaded(NIGHTLY_SCHEDULE)
      stageAll(result, { max_backups: 12 })

      await act(async () => {
        result.current.save()
      })
      expect(result.current.saving).toBe(true)

      await act(async () => {
        write.resolve({ ...NIGHTLY_SCHEDULE, max_backups: 12 })
      })
      await flush()

      expect(result.current.saving).toBe(false)
    })

    it('makes the response the new baseline and resets the staged values', async () => {
      const response: BackupSchedule = {
        ...FRESH_SCHEDULE,
        enabled: true,
        cron: '15 3 * * *',
        cron_description: 'At 03:15',
        next_run: '2026-10-05T03:15:00Z',
      }
      mockUpdateSchedule.mockResolvedValueOnce(response)
      const { result } = await renderLoaded(FRESH_SCHEDULE)
      stageAll(result, {
        enabled: true,
        cron: '15 3 * * *',
      })

      await act(async () => {
        result.current.save()
      })
      await flush()

      expect(result.current.status).toBe('loaded')
      expect(result.current.saving).toBe(false)
      expect(result.current.dirty).toBe(false)
      expect(result.current.saved).toEqual(response)
      expect(result.current.staged).toEqual(stagedOf(response))
      expect(mockGetSchedule).toHaveBeenCalledTimes(1)

      act(() => {
        result.current.cancel()
      })
      expect(result.current.staged).toEqual(stagedOf(response))
      expect(result.current.dirty).toBe(false)
    })

    it('after turning the schedule off shows the values the server kept, not the dropped edits', async () => {
      mockUpdateSchedule.mockResolvedValueOnce(NIGHTLY_TURNED_OFF)
      const { result } = await renderLoaded(NIGHTLY_SCHEDULE)
      stageAll(result, {
        cron: '30 4 * * 1',
        enabled: false,
      })

      await act(async () => {
        result.current.save()
      })
      await flush()

      expect(result.current.saved).toEqual(NIGHTLY_TURNED_OFF)
      expect(result.current.staged).toEqual(stagedOf(NIGHTLY_TURNED_OFF))
      expect(result.current.staged.cron).toBe('0 2 * * *')
      expect(result.current.dirty).toBe(false)
    })

    it('shows no toast when the Save succeeds', async () => {
      mockUpdateSchedule.mockResolvedValueOnce(NIGHTLY_TURNED_OFF)
      const { result } = await renderLoaded(NIGHTLY_SCHEDULE)
      stageAll(result, { enabled: false })

      await act(async () => {
        result.current.save()
      })
      await flush()

      expect(toastSuccess).not.toHaveBeenCalled()
      expect(toastError).not.toHaveBeenCalled()
    })

    it('on a failure shows the failure toast with the exact message and keeps the staged values', async () => {
      mockUpdateSchedule.mockRejectedValueOnce(apiError(SAVE_FAILURE, 400))
      const { result } = await renderLoaded(NIGHTLY_SCHEDULE)
      stageAll(result, {
        save_directory: '/srv/wave/data/backups',
        max_backups: 12,
      })
      const stagedBefore = result.current.staged

      await act(async () => {
        result.current.save()
      })
      await flush()

      expect(toastError).toHaveBeenCalledTimes(1)
      expect(toastError).toHaveBeenCalledWith(SAVE_FAILURE, SAVE_FAILURE_TITLE)
      expect(toastSuccess).not.toHaveBeenCalled()
      expect(result.current.status).toBe('loaded')
      expect(result.current.saving).toBe(false)
      expect(result.current.dirty).toBe(true)
      expect(result.current.staged).toEqual(stagedBefore)
      expect(result.current.staged).toEqual({
        ...stagedOf(NIGHTLY_SCHEDULE),
        save_directory: '/srv/wave/data/backups',
        max_backups: 12,
      })
      expect(result.current.saved).toEqual(NIGHTLY_SCHEDULE)
      expect(mockGetSchedule).toHaveBeenCalledTimes(1)
    })

    it('keeps the saved values as the Cancel target after a failed Save', async () => {
      mockUpdateSchedule.mockRejectedValueOnce(apiError(SAVE_FAILURE, 400))
      const { result } = await renderLoaded(NIGHTLY_SCHEDULE)
      stageAll(result, { save_directory: '/srv/wave/data/backups' })
      await act(async () => {
        result.current.save()
      })
      await flush()

      act(() => {
        result.current.cancel()
      })

      expect(result.current.staged).toEqual(stagedOf(NIGHTLY_SCHEDULE))
      expect(result.current.dirty).toBe(false)
    })

    it('sends the same request again on the next Save after a failure', async () => {
      mockUpdateSchedule.mockRejectedValueOnce(apiError(SAVE_FAILURE, 400))
      mockUpdateSchedule.mockResolvedValueOnce({ ...NIGHTLY_SCHEDULE, max_backups: 12 })
      const { result } = await renderLoaded(NIGHTLY_SCHEDULE)
      stageAll(result, { max_backups: 12 })
      await act(async () => {
        result.current.save()
      })
      await flush()

      await act(async () => {
        result.current.save()
      })
      await flush()

      expect(mockUpdateSchedule).toHaveBeenCalledTimes(2)
      expect(mockUpdateSchedule.mock.calls[1][0]).toStrictEqual(mockUpdateSchedule.mock.calls[0][0])
      expect(toastError).toHaveBeenCalledTimes(1)
      expect(result.current.dirty).toBe(false)
      expect(result.current.saved).toEqual({ ...NIGHTLY_SCHEDULE, max_backups: 12 })
    })
  })
})
