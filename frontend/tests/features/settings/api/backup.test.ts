/**
 * Backup API Client Tests
 *
 * Tests for backup API fetch functions covering:
 * - createBackup: POST /api/backup/create
 * - validateBackup: POST /api/backup/validate
 * - restoreBackup: POST /api/backup/restore
 * - kept upload: POST /api/backup/uploads once per picked file, then only its upload ID
 * - releaseBackup: DELETE /api/backup/uploads/<id>
 * - getSchedule: GET /api/backup/schedule
 * - updateSchedule: PUT /api/backup/schedule (REQ-4.7.20: also the only way to turn the schedule off)
 */

vi.mock('@/lib/api', () => ({
  apiClient: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  },
  getApiBaseUrl: vi.fn().mockReturnValue('http://localhost:8000'),
}))

import { describe, it, expect, expectTypeOf, vi, beforeEach } from 'vitest'
import { getApiBaseUrl } from '@/lib/api'
import { toFailureDetail } from '@/lib/failure-detail'

import * as backupApi from '@/features/settings/api/backup'
import {
  createBackup,
  validateBackup,
  restoreBackup,
  releaseBackup,
  getSchedule,
  updateSchedule,
  type BackupCreateRequest,
  type BackupItem,
  type BackupPreviewItem,
  type BackupRestoreItem,
  type BackupValidateResult,
  type BackupRestoreOptions,
  type BackupRestoreResult,
  type BackupSchedule,
} from '@/features/settings/api/backup'
import type { ExportSecretsMode } from '@/types/import-export'
import { failedResponse } from '../../../utils/failed-response'

// ============================================================================
// Mock Data
// ============================================================================

const mockSchedule: BackupSchedule = {
  enabled: true,
  cron: '0 2 * * *',
  entity_types: ['tests', 'environments'],
  max_backups: 5,
  save_directory: '/srv/backups',
  format: 'yaml',
  compression_method: 'deflate',
  compression_level: 6,
  secrets: 'mask',
  last_run: '2026-03-07T02:00:00Z',
  last_run_status: 'success',
  cron_description: 'Every day at 02:00',
  next_run: '2026-03-08T02:00:00Z',
}

/** What a fresh install answers: off, every entity type, the default save folder. */
const freshSchedule: BackupSchedule = {
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

/** Every field a Save with the schedule on sends. */
const scheduleUpdate = {
  enabled: true,
  cron: '0 2 * * *',
  entity_types: ['tests', 'environments'],
  max_backups: 5,
  save_directory: '/srv/backups',
  format: 'yaml',
  compression_method: 'deflate',
  compression_level: 6,
  secrets: 'encrypted',
} satisfies Parameters<typeof updateSchedule>[0]

function sentBody(): unknown {
  return JSON.parse(vi.mocked(global.fetch).mock.calls[0][1]!.body as string)
}

function sentForm(call = 0): FormData {
  return vi.mocked(global.fetch).mock.calls[call][1]!.body as FormData
}

function formFields(form: FormData): Record<string, FormDataEntryValue> {
  return Object.fromEntries(form.entries())
}

const mockValidateResult: BackupValidateResult = {
  metadata: {
    wave_version: '1.0.0',
    created_at: '2026-03-07T12:00:00Z',
    format: 'yaml',
    schema_version: '1.0',
    secrets: 'mask',
  },
  entity_summary: {
    tests: { total: 2, ok: 2, conflicts: 0, fixable: 0, fatal: 0, items: [] },
    environments: { total: 1, ok: 1, conflicts: 0, fixable: 0, fatal: 0, items: [] },
  },
}

const mockRestoreResult: BackupRestoreResult = {
  environments: { imported: 1, skipped: 0, fatal: 0, items: [] },
  tests: { imported: 2, skipped: 0, fatal: 0, items: [] },
}

const previewItems: BackupPreviewItem[] = [
  { name: 'bad.json', status: 'fatal', reason: 'Cannot be read' },
  { name: 'login-flow', status: 'conflict', reason: 'Name already in use' },
]

const mockValidateWithItems: BackupValidateResult = {
  metadata: mockValidateResult.metadata,
  entity_summary: {
    tests: { total: 3, ok: 1, conflicts: 1, fixable: 0, fatal: 1, items: previewItems },
    functions: { total: 1, ok: 1, conflicts: 0, fixable: 0, fatal: 0, items: [] },
  },
}

const restoreItems: BackupRestoreItem[] = [
  { name: 'bad.json', status: 'fatal', reason: 'Cannot be read' },
  { name: 'login-flow', status: 'skipped', reason: 'Already in this WAVE' },
]

const mockRestoreWithItems: BackupRestoreResult = {
  tests: { imported: 1, skipped: 1, fatal: 1, items: restoreItems },
  functions: { imported: 1, skipped: 0, fatal: 0, items: [] },
}

/**
 * The WAVE error envelope, exactly as the backend middleware emits it: a
 * success flag, an error object carrying code + message, and a meta block.
 */
function waveErrorEnvelope(message: string, code = 'VALIDATION_ERROR') {
  return {
    success: false,
    error: { code, message, details: null },
    meta: {
      timestamp: '2026-03-07T12:00:00Z',
      version: '1.0.0',
      request_id: 'req-42',
    },
  }
}


/** The success envelope the backend answers, wrapping the route's payload. */
function envelope(data: unknown) {
  return {
    success: true,
    data,
    meta: { request_id: 'req-42', timestamp: '2026-03-07T12:00:00Z' },
  }
}


async function rejectionOf(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise
  } catch (error) {
    return error as Error
  }
  throw new Error('expected the call to reject')
}

const UPLOAD_ID = 'a3f1c2d4e5b60718293a4b5c6d7e8f90'
const SECOND_UPLOAD_ID = '0f9e8d7c6b5a49382716e5d4c3b2a1f0'
const UPLOADS = 'POST /api/backup/uploads'
const UPLOAD_GONE_MESSAGE = 'Backup upload not found'
const SKIP: BackupRestoreOptions = { conflict_resolution: 'skip' }

/** A success answer that carries the payload in the shared envelope. */
function answered(data: unknown) {
  return { ok: true, json: () => Promise.resolve(envelope(data)) }
}

/** What the backend answers when it keeps an uploaded file. */
function kept(uploadId = UPLOAD_ID) {
  return answered({ upload_id: uploadId })
}

/** What validate and restore answer for an upload ID the backend no longer knows. */
function uploadGone() {
  return failedResponse(
    404,
    'Not Found',
    waveErrorEnvelope(UPLOAD_GONE_MESSAGE, 'BACKUP_UPLOAD_NOT_FOUND')
  )
}

function backupFile(name = 'backup.zip'): File {
  return new File(['zipdata'], name, { type: 'application/zip' })
}

/** Every request sent so far, in order, as "METHOD /path". */
function sentRequests(): string[] {
  return vi
    .mocked(global.fetch)
    .mock.calls.map(
      ([url, init]) => `${init?.method} ${String(url).replace('http://localhost:8000', '')}`
    )
}

interface HeldAnswer {
  promise: Promise<unknown>
  answer: (response: unknown) => void
}

/** An answer the test gives later, so a request can be caught on its way. */
function heldAnswer(): HeldAnswer {
  let answer!: (response: unknown) => void
  const promise = new Promise<unknown>((resolve) => {
    answer = resolve
  })
  return { promise, answer }
}

/** Lets every promise chain that can run now run to its end. */
function settled(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

/** Lets the requests on their way go out, then checks how many were sent. */
async function requestCount(count: number): Promise<void> {
  await settled()
  expect(global.fetch).toHaveBeenCalledTimes(count)
}

/** Runs the body and reports every promise rejection nobody handled during it. */
async function unhandledRejectionsDuring(body: () => Promise<void>): Promise<unknown[]> {
  const seen: unknown[] = []
  const record = (reason: unknown) => {
    seen.push(reason)
  }
  process.on('unhandledRejection', record)
  try {
    await body()
    await settled()
  } finally {
    process.off('unhandledRejection', record)
  }
  return seen
}

// ============================================================================
// Tests
// ============================================================================

describe('Backup API Client', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.mocked(getApiBaseUrl).mockReturnValue('http://localhost:8000')
  })

  describe('createBackup', () => {
    it('sends POST to /api/backup/create and returns blob', async () => {
      const mockBlob = new Blob(['zipdata'], { type: 'application/zip' })
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        blob: () => Promise.resolve(mockBlob),
        headers: new Headers({
          'content-disposition': 'attachment; filename="wave-backup.zip"',
        }),
      })

      const request: BackupCreateRequest = {
        entity_types: ['tests', 'environments'],
        format: 'yaml',
        compression_method: 'deflate',
        compression_level: 6,
        secrets: 'mask',
      }

      const result = await createBackup(request)

      expect(global.fetch).toHaveBeenCalledWith(
        'http://localhost:8000/api/backup/create',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
          }),
          body: JSON.stringify(request),
        })
      )
      expect(result).toBeInstanceOf(Blob)
    })

    it('throws the reason the server sent', async () => {
      global.fetch = vi.fn().mockResolvedValue(
        failedResponse(400, 'Bad Request', waveErrorEnvelope('Unknown entity type: plugins'))
      )

      await expect(
        createBackup({ entity_types: ['plugins'] })
      ).rejects.toThrow('Unknown entity type: plugins')
    })

    it('carries the request context so the failure can be shown in full', async () => {
      global.fetch = vi.fn().mockResolvedValue(
        failedResponse(400, 'Bad Request', waveErrorEnvelope('Unknown entity type: plugins'))
      )

      const error = await rejectionOf(createBackup({ entity_types: ['plugins'] }))

      expect(toFailureDetail(error)).toMatchObject({
        method: 'POST',
        path: '/api/backup/create',
        status: 400,
        statusText: 'Bad Request',
        requestId: 'req-42',
        message: 'Unknown entity type: plugins',
      })
    })

    it('falls back to the status text when the body carries no reason', async () => {
      global.fetch = vi
        .fn()
        .mockResolvedValue(failedResponse(400, 'Bad Request', { success: false }))

      await expect(
        createBackup({ entity_types: ['tests'] })
      ).rejects.toThrow('Bad Request')
    })

    it('names the operation when the response carries no reason at all', async () => {
      global.fetch = vi.fn().mockResolvedValue(failedResponse(500, ''))

      await expect(
        createBackup({ entity_types: ['tests'] })
      ).rejects.toThrow('Backup creation failed')
    })

    it('sends default parameters when not specified', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        blob: () => Promise.resolve(new Blob()),
        headers: new Headers(),
      })

      await createBackup({ entity_types: ['tests'] })

      const callArgs = vi.mocked(global.fetch).mock.calls[0]
      const body = JSON.parse(callArgs[1]?.body as string)
      expect(body.entity_types).toEqual(['tests'])
    })
  })

  describe('validateBackup', () => {
    it('uploads file and returns validation result', async () => {
      global.fetch = vi.fn().mockResolvedValueOnce(kept()).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(envelope(mockValidateResult)),
      })

      const file = new File(['zipdata'], 'backup.zip', {
        type: 'application/zip',
      })

      const result = await validateBackup(file, {
        conflict_resolution: 'skip',
        auto_repair: false,
      })

      expect(global.fetch).toHaveBeenCalledWith(
        'http://localhost:8000/api/backup/validate',
        expect.objectContaining({
          method: 'POST',
        })
      )
      // Verify FormData was used
      const callArgs = vi.mocked(global.fetch).mock.calls[1]
      expect(callArgs[1]?.body).toBeInstanceOf(FormData)
      expect(result.metadata.wave_version).toBe('1.0.0')
      expect(result.entity_summary.tests.total).toBe(2)
    })

    it('throws the reason the server sent for a bad archive', async () => {
      global.fetch = vi.fn().mockResolvedValueOnce(kept()).mockResolvedValue(
        failedResponse(
          400,
          'Bad Request',
          waveErrorEnvelope('backup.txt is not a ZIP archive')
        )
      )

      const file = new File(['bad'], 'backup.txt')
      await expect(
        validateBackup(file, { conflict_resolution: 'skip' })
      ).rejects.toThrow('backup.txt is not a ZIP archive')
    })

    it('names the operation when the response carries no reason at all', async () => {
      global.fetch = vi
        .fn()
        .mockResolvedValueOnce(kept())
        .mockResolvedValue(failedResponse(500, ''))

      const file = new File(['bad'], 'backup.txt')
      await expect(
        validateBackup(file, { conflict_resolution: 'skip' })
      ).rejects.toThrow('Validation failed')
    })

    it('sends the options beside the upload ID, never the file', async () => {
      global.fetch = vi.fn().mockResolvedValueOnce(kept()).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(envelope(mockValidateResult)),
      })
      const file = new File(['zipdata'], 'backup.zip', { type: 'application/zip' })

      await validateBackup(file, {
        entity_types: ['tests', 'functions'],
        conflict_resolution: 'overwrite',
        auto_repair: true,
      })

      const form = sentForm(1)
      expect(form.has('file')).toBe(false)
      expect(formFields(form)).toEqual({
        upload_id: UPLOAD_ID,
        entity_types: 'tests,functions',
        conflict_resolution: 'overwrite',
        auto_repair: 'true',
      })
    })

    it('leaves entity_types out when none is given', async () => {
      global.fetch = vi.fn().mockResolvedValueOnce(kept()).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(envelope(mockValidateResult)),
      })
      const file = new File(['zipdata'], 'backup.zip', { type: 'application/zip' })

      await validateBackup(file, { conflict_resolution: 'skip', auto_repair: false })

      const form = sentForm(1)
      expect(form.has('file')).toBe(false)
      expect(form.has('entity_types')).toBe(false)
      expect(formFields(form)).toEqual({
        upload_id: UPLOAD_ID,
        conflict_resolution: 'skip',
        auto_repair: 'false',
      })
    })

    it('returns the items of each part', async () => {
      global.fetch = vi.fn().mockResolvedValueOnce(kept()).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(envelope(mockValidateWithItems)),
      })
      const file = new File(['zipdata'], 'backup.zip', { type: 'application/zip' })

      const result = await validateBackup(file, {
        conflict_resolution: 'skip',
        auto_repair: false,
      })

      expect(result.entity_summary.tests.items).toEqual([
        { name: 'bad.json', status: 'fatal', reason: 'Cannot be read' },
        { name: 'login-flow', status: 'conflict', reason: 'Name already in use' },
      ])
      expect(result.entity_summary.functions.items).toEqual([])
    })

    it("throws the server's reason for an unknown conflict choice", async () => {
      global.fetch = vi.fn().mockResolvedValueOnce(kept()).mockResolvedValue(
        failedResponse(
          400,
          'Bad Request',
          waveErrorEnvelope("Unknown conflict resolution: 'merge'")
        )
      )
      const file = new File(['zipdata'], 'backup.zip', { type: 'application/zip' })

      const error = await rejectionOf(validateBackup(file, { conflict_resolution: 'merge' }))

      expect(error.message).toBe("Unknown conflict resolution: 'merge'")
      expect(sentForm(1).get('conflict_resolution')).toBe('merge')
    })
  })

  describe('restoreBackup', () => {
    it('uploads file with options and returns restore result', async () => {
      global.fetch = vi.fn().mockResolvedValueOnce(kept()).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(envelope(mockRestoreResult)),
      })

      const file = new File(['zipdata'], 'backup.zip', {
        type: 'application/zip',
      })

      const result = await restoreBackup(file, {
        entity_types: ['tests', 'environments'],
        conflict_resolution: 'skip',
        auto_repair: false,
      })

      expect(global.fetch).toHaveBeenCalledWith(
        'http://localhost:8000/api/backup/restore',
        expect.objectContaining({ method: 'POST' })
      )
      expect(result.environments.imported).toBe(1)
      expect(result.tests.imported).toBe(2)
    })

    it('throws the reason the server sent for a corrupt archive', async () => {
      global.fetch = vi.fn().mockResolvedValueOnce(kept()).mockResolvedValue(
        failedResponse(
          400,
          'Bad Request',
          waveErrorEnvelope('entities/tests/login.yaml is truncated at byte 2048')
        )
      )

      const file = new File(['bad'], 'backup.zip')
      await expect(
        restoreBackup(file, { conflict_resolution: 'skip' })
      ).rejects.toThrow('entities/tests/login.yaml is truncated at byte 2048')
    })

    it('names the operation when the response carries no reason at all', async () => {
      global.fetch = vi
        .fn()
        .mockResolvedValueOnce(kept())
        .mockResolvedValue(failedResponse(500, ''))

      const file = new File(['bad'], 'backup.zip')
      await expect(
        restoreBackup(file, { conflict_resolution: 'skip' })
      ).rejects.toThrow('Restore failed')
    })

    it('sends the same fields as validateBackup', async () => {
      global.fetch = vi
        .fn()
        .mockResolvedValueOnce(kept())
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(envelope(mockValidateResult)),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(envelope(mockRestoreResult)),
        })
      const file = new File(['zipdata'], 'backup.zip', { type: 'application/zip' })
      const options = {
        entity_types: ['tests', 'functions'],
        conflict_resolution: 'rename',
        auto_repair: true,
      }

      await validateBackup(file, options)
      await restoreBackup(file, options)

      const restoreFields = formFields(sentForm(2))
      expect(restoreFields).not.toHaveProperty('file')
      expect(restoreFields).toEqual({
        upload_id: UPLOAD_ID,
        entity_types: 'tests,functions',
        conflict_resolution: 'rename',
        auto_repair: 'true',
      })
      expect(restoreFields).toEqual(formFields(sentForm(1)))
    })

    it('returns the items of each part', async () => {
      global.fetch = vi.fn().mockResolvedValueOnce(kept()).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(envelope(mockRestoreWithItems)),
      })
      const file = new File(['zipdata'], 'backup.zip', { type: 'application/zip' })

      const result = await restoreBackup(file, {
        entity_types: ['tests', 'functions'],
        conflict_resolution: 'skip',
        auto_repair: false,
      })

      expect(result.tests.items).toEqual([
        { name: 'bad.json', status: 'fatal', reason: 'Cannot be read' },
        { name: 'login-flow', status: 'skipped', reason: 'Already in this WAVE' },
      ])
      expect(result.functions.items).toEqual([])
    })
  })

  const VALIDATE = 'POST /api/backup/validate'
  const RESTORE = 'POST /api/backup/restore'
  const RELEASE = `DELETE /api/backup/uploads/${UPLOAD_ID}`

  const viaKeptUpload = [
    {
      name: 'validateBackup',
      request: VALIDATE,
      fallback: 'Validation failed',
      result: mockValidateResult as unknown,
      send: (file: File, options = SKIP): Promise<unknown> => validateBackup(file, options),
    },
    {
      name: 'restoreBackup',
      request: RESTORE,
      fallback: 'Restore failed',
      result: mockRestoreResult as unknown,
      send: (file: File, options = SKIP): Promise<unknown> => restoreBackup(file, options),
    },
  ]

  describe.each(viaKeptUpload)('kept upload: $name', ({ request, fallback, result, send }) => {
    const choices: BackupRestoreOptions = {
      entity_types: ['tests'],
      conflict_resolution: 'rename',
      auto_repair: true,
    }
    const choiceFields = {
      entity_types: 'tests',
      conflict_resolution: 'rename',
      auto_repair: 'true',
    }

    it('sends the file once, then the request with the upload ID', async () => {
      global.fetch = vi.fn().mockResolvedValueOnce(kept()).mockResolvedValueOnce(answered(result))
      const file = backupFile()

      await expect(send(file, choices)).resolves.toEqual(result)

      expect(sentRequests()).toEqual([UPLOADS, request])
      expect(global.fetch).toHaveBeenNthCalledWith(
        1,
        'http://localhost:8000/api/backup/uploads',
        expect.objectContaining({ method: 'POST' })
      )
      expect(sentForm(0).get('file')).toBe(file)
      expect(Object.keys(formFields(sentForm(0)))).toEqual(['file'])
      expect(formFields(sentForm(1))).toEqual({ upload_id: UPLOAD_ID, ...choiceFields })
    })

    it('sends the file again when the backend no longer knows the upload ID', async () => {
      global.fetch = vi
        .fn()
        .mockResolvedValueOnce(kept())
        .mockResolvedValueOnce(uploadGone())
        .mockResolvedValueOnce(kept(SECOND_UPLOAD_ID))
        .mockResolvedValueOnce(answered(result))
      const file = backupFile()

      await expect(send(file, choices)).resolves.toEqual(result)

      expect(sentRequests()).toEqual([UPLOADS, request, UPLOADS, request])
      expect(sentForm(2).get('file')).toBe(file)
      expect(formFields(sentForm(1))).toEqual({ upload_id: UPLOAD_ID, ...choiceFields })
      expect(formFields(sentForm(3))).toEqual({ upload_id: SECOND_UPLOAD_ID, ...choiceFields })
    })

    it('uses the new upload ID for the requests that follow', async () => {
      global.fetch = vi
        .fn()
        .mockResolvedValueOnce(kept())
        .mockResolvedValueOnce(uploadGone())
        .mockResolvedValueOnce(kept(SECOND_UPLOAD_ID))
        .mockResolvedValue(answered(result))
      const file = backupFile()

      await send(file)
      await send(file)

      expect(sentRequests()).toEqual([UPLOADS, request, UPLOADS, request, request])
      expect(sentForm(4).get('upload_id')).toBe(SECOND_UPLOAD_ID)
    })

    it('repeats the request only once', async () => {
      global.fetch = vi
        .fn()
        .mockResolvedValueOnce(kept())
        .mockResolvedValueOnce(uploadGone())
        .mockResolvedValueOnce(kept(SECOND_UPLOAD_ID))
        .mockResolvedValueOnce(uploadGone())

      const error = await rejectionOf(send(backupFile()))

      expect(error.message).toBe(UPLOAD_GONE_MESSAGE)
      expect(sentRequests()).toEqual([UPLOADS, request, UPLOADS, request])
    })

    it('names the operation when the repeated request carries no reason at all', async () => {
      global.fetch = vi
        .fn()
        .mockResolvedValueOnce(kept())
        .mockResolvedValueOnce(uploadGone())
        .mockResolvedValueOnce(kept(SECOND_UPLOAD_ID))
        .mockResolvedValueOnce(failedResponse(500, ''))

      await expect(send(backupFile())).rejects.toThrow(`${fallback}: HTTP 500`)
    })

    it('throws the upload failure when the file cannot be sent again', async () => {
      global.fetch = vi
        .fn()
        .mockResolvedValueOnce(kept())
        .mockResolvedValueOnce(uploadGone())
        .mockResolvedValueOnce(failedResponse(500, ''))

      await expect(send(backupFile())).rejects.toThrow('Upload failed: HTTP 500')

      expect(sentRequests()).toEqual([UPLOADS, request, UPLOADS])
    })

    it('throws and sends nothing again when the file was released meanwhile', async () => {
      const onItsWay = heldAnswer()
      global.fetch = vi
        .fn()
        .mockResolvedValueOnce(kept())
        .mockReturnValueOnce(onItsWay.promise)
        .mockResolvedValueOnce(answered(null))
      const file = backupFile()

      const sent = send(file)
      await requestCount(2)
      releaseBackup(file)
      await requestCount(3)
      onItsWay.answer(uploadGone())
      const error = await rejectionOf(sent)

      expect(error).toMatchObject({
        message: UPLOAD_GONE_MESSAGE,
        code: 'BACKUP_UPLOAD_NOT_FOUND',
        status: 404,
      })
      expect(sentRequests()).toEqual([UPLOADS, request, RELEASE])
    })

    it('does not send the file again for a 404 with another code', async () => {
      global.fetch = vi
        .fn()
        .mockResolvedValueOnce(kept())
        .mockResolvedValueOnce(
          failedResponse(404, 'Not Found', waveErrorEnvelope('No such route', 'NOT_FOUND'))
        )

      await expect(send(backupFile())).rejects.toThrow('No such route')

      expect(sentRequests()).toEqual([UPLOADS, request])
    })
  })

  describe('kept upload', () => {
    it('sends one upload for every request with the same file', async () => {
      global.fetch = vi
        .fn()
        .mockResolvedValueOnce(kept())
        .mockResolvedValueOnce(answered(mockValidateResult))
        .mockResolvedValueOnce(answered(mockValidateResult))
        .mockResolvedValueOnce(answered(mockRestoreResult))
      const file = backupFile()

      await validateBackup(file, SKIP)
      await validateBackup(file, { conflict_resolution: 'overwrite', auto_repair: true })
      await restoreBackup(file, SKIP)

      expect(sentRequests()).toEqual([UPLOADS, VALIDATE, VALIDATE, RESTORE])
      expect([1, 2, 3].map((call) => sentForm(call).get('upload_id'))).toEqual([
        UPLOAD_ID,
        UPLOAD_ID,
        UPLOAD_ID,
      ])
    })

    it('sends one upload per file', async () => {
      global.fetch = vi
        .fn()
        .mockResolvedValueOnce(kept())
        .mockResolvedValueOnce(answered(mockValidateResult))
        .mockResolvedValueOnce(kept(SECOND_UPLOAD_ID))
        .mockResolvedValueOnce(answered(mockValidateResult))
      const first = backupFile('first.zip')
      const second = backupFile('second.zip')

      await validateBackup(first, SKIP)
      await validateBackup(second, SKIP)

      expect(sentRequests()).toEqual([UPLOADS, VALIDATE, UPLOADS, VALIDATE])
      expect(sentForm(0).get('file')).toBe(first)
      expect(sentForm(1).get('upload_id')).toBe(UPLOAD_ID)
      expect(sentForm(2).get('file')).toBe(second)
      expect(sentForm(3).get('upload_id')).toBe(SECOND_UPLOAD_ID)
    })

    it('shares one upload between concurrent callers', async () => {
      const upload = heldAnswer()
      global.fetch = vi
        .fn()
        .mockReturnValueOnce(upload.promise)
        .mockResolvedValueOnce(answered(mockValidateResult))
        .mockResolvedValueOnce(answered(mockRestoreResult))
      const file = backupFile()

      const validated = validateBackup(file, SKIP)
      const restored = restoreBackup(file, SKIP)
      await settled()
      expect(sentRequests()).toEqual([UPLOADS])
      upload.answer(kept())

      await expect(validated).resolves.toEqual(mockValidateResult)
      await expect(restored).resolves.toEqual(mockRestoreResult)
      expect(sentRequests()).toEqual([UPLOADS, VALIDATE, RESTORE])
      expect(sentForm(1).get('upload_id')).toBe(UPLOAD_ID)
      expect(sentForm(2).get('upload_id')).toBe(UPLOAD_ID)
    })

    it('uses the upload another caller already sent again', async () => {
      const uploadIds = [UPLOAD_ID, SECOND_UPLOAD_ID]
      global.fetch = vi.fn().mockImplementation((url: string, init: RequestInit) => {
        if (url.endsWith('/uploads')) return Promise.resolve(kept(uploadIds.shift()))
        if ((init.body as FormData).get('upload_id') === UPLOAD_ID) {
          return Promise.resolve(uploadGone())
        }
        return Promise.resolve(
          answered(url.endsWith('/validate') ? mockValidateResult : mockRestoreResult)
        )
      })
      const file = backupFile()

      const [validated, restored] = await Promise.all([
        validateBackup(file, SKIP),
        restoreBackup(file, SKIP),
      ])

      expect(validated).toEqual(mockValidateResult)
      expect(restored).toEqual(mockRestoreResult)
      expect(sentRequests()).toEqual([UPLOADS, VALIDATE, RESTORE, UPLOADS, VALIDATE, RESTORE])
      expect(sentForm(4).get('upload_id')).toBe(SECOND_UPLOAD_ID)
      expect(sentForm(5).get('upload_id')).toBe(SECOND_UPLOAD_ID)
    })

    it('throws the reason the server sent when the upload fails', async () => {
      global.fetch = vi
        .fn()
        .mockResolvedValue(
          failedResponse(
            413,
            'Payload Too Large',
            waveErrorEnvelope('The backup file is larger than this WAVE accepts')
          )
        )

      await expect(validateBackup(backupFile(), SKIP)).rejects.toThrow(
        'The backup file is larger than this WAVE accepts'
      )

      expect(sentRequests()).toEqual([UPLOADS])
    })

    it('names the upload when its response carries no reason at all', async () => {
      global.fetch = vi.fn().mockResolvedValue(failedResponse(500, ''))

      const error = await rejectionOf(restoreBackup(backupFile(), SKIP))

      expect(error.message).toBe('Upload failed: HTTP 500')
      expect(sentRequests()).toEqual([UPLOADS])
    })

    it('carries the request context of a failed upload', async () => {
      global.fetch = vi
        .fn()
        .mockResolvedValue(
          failedResponse(507, 'Insufficient Storage', waveErrorEnvelope('No space left to keep it'))
        )

      const error = await rejectionOf(validateBackup(backupFile(), SKIP))

      expect(toFailureDetail(error)).toMatchObject({
        method: 'POST',
        path: '/api/backup/uploads',
        status: 507,
        statusText: 'Insufficient Storage',
        requestId: 'req-42',
        message: 'No space left to keep it',
      })
    })

    it('does not remember a failed upload', async () => {
      global.fetch = vi
        .fn()
        .mockResolvedValueOnce(failedResponse(500, ''))
        .mockResolvedValueOnce(kept())
        .mockResolvedValueOnce(answered(mockValidateResult))
      const file = backupFile()

      await expect(validateBackup(file, SKIP)).rejects.toThrow('Upload failed: HTTP 500')
      await expect(validateBackup(file, SKIP)).resolves.toEqual(mockValidateResult)

      expect(sentRequests()).toEqual([UPLOADS, UPLOADS, VALIDATE])
      expect(sentForm(2).get('upload_id')).toBe(UPLOAD_ID)
    })

    it('keeps a newer upload of the same file when an older one fails late', async () => {
      const older = heldAnswer()
      global.fetch = vi
        .fn()
        .mockReturnValueOnce(older.promise)
        .mockResolvedValueOnce(kept(SECOND_UPLOAD_ID))
        .mockResolvedValue(answered(mockValidateResult))
      const file = backupFile()

      const first = validateBackup(file, SKIP)
      await requestCount(1)
      releaseBackup(file)
      await validateBackup(file, SKIP)
      older.answer(failedResponse(500, ''))
      await expect(first).rejects.toThrow('Upload failed: HTTP 500')
      await validateBackup(file, SKIP)

      expect(sentRequests()).toEqual([UPLOADS, UPLOADS, VALIDATE, VALIDATE])
      expect(sentForm(3).get('upload_id')).toBe(SECOND_UPLOAD_ID)
    })
  })

  describe('releaseBackup', () => {
    async function keptFile(): Promise<File> {
      const file = backupFile()
      await validateBackup(file, SKIP)
      return file
    }

    it('sends nothing for a file that was never kept', async () => {
      global.fetch = vi.fn()

      releaseBackup(backupFile())
      await settled()

      expect(global.fetch).not.toHaveBeenCalled()
    })

    it('sends DELETE /api/backup/uploads/<id> without waiting for the answer', async () => {
      global.fetch = vi
        .fn()
        .mockResolvedValueOnce(kept())
        .mockResolvedValueOnce(answered(mockValidateResult))
        .mockReturnValueOnce(new Promise(() => {}))
      const file = await keptFile()

      expect(releaseBackup(file)).toBeUndefined()

      await requestCount(3)
      expect(global.fetch).toHaveBeenLastCalledWith(
        `http://localhost:8000/api/backup/uploads/${UPLOAD_ID}`,
        { method: 'DELETE' }
      )
    })

    it('forgets the upload: a second release of the same file sends nothing', async () => {
      global.fetch = vi
        .fn()
        .mockResolvedValueOnce(kept())
        .mockResolvedValueOnce(answered(mockValidateResult))
        .mockResolvedValueOnce(answered(null))
      const file = await keptFile()

      releaseBackup(file)
      await requestCount(3)
      releaseBackup(file)
      await settled()

      expect(sentRequests()).toEqual([UPLOADS, VALIDATE, RELEASE])
    })

    it('forgets the upload: the file is sent again when it is used again', async () => {
      global.fetch = vi
        .fn()
        .mockResolvedValueOnce(kept())
        .mockResolvedValueOnce(answered(mockValidateResult))
        .mockResolvedValueOnce(answered(null))
        .mockResolvedValueOnce(kept(SECOND_UPLOAD_ID))
        .mockResolvedValueOnce(answered(mockValidateResult))
      const file = await keptFile()

      releaseBackup(file)
      await requestCount(3)
      await validateBackup(file, SKIP)

      expect(sentRequests()).toEqual([UPLOADS, VALIDATE, RELEASE, UPLOADS, VALIDATE])
      expect(sentForm(4).get('upload_id')).toBe(SECOND_UPLOAD_ID)
    })

    it('ignores a failure the backend answers', async () => {
      global.fetch = vi
        .fn()
        .mockResolvedValueOnce(kept())
        .mockResolvedValueOnce(answered(mockValidateResult))
        .mockResolvedValueOnce(failedResponse(500, 'Internal Server Error'))
      const file = await keptFile()

      const unhandled = await unhandledRejectionsDuring(async () => {
        releaseBackup(file)
        await requestCount(3)
      })

      expect(unhandled).toEqual([])
      expect(sentRequests()).toEqual([UPLOADS, VALIDATE, RELEASE])
    })

    it('swallows a request that never reaches the backend', async () => {
      global.fetch = vi
        .fn()
        .mockResolvedValueOnce(kept())
        .mockResolvedValueOnce(answered(mockValidateResult))
        .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      const file = await keptFile()

      const unhandled = await unhandledRejectionsDuring(async () => {
        releaseBackup(file)
        await requestCount(3)
      })

      expect(unhandled).toEqual([])
      expect(sentRequests()).toEqual([UPLOADS, VALIDATE, RELEASE])
    })

    it('drops an upload that was still on its way once its ID arrives', async () => {
      const upload = heldAnswer()
      global.fetch = vi
        .fn()
        .mockReturnValueOnce(upload.promise)
        .mockResolvedValueOnce(uploadGone())
        .mockResolvedValueOnce(answered(null))
      const file = backupFile()

      const validated = validateBackup(file, SKIP)
      await requestCount(1)
      releaseBackup(file)
      await settled()
      expect(sentRequests()).toEqual([UPLOADS])
      upload.answer(kept())

      await expect(validated).rejects.toThrow(UPLOAD_GONE_MESSAGE)
      expect(sentRequests()).toEqual([UPLOADS, VALIDATE, RELEASE])
    })

    it('sends nothing when the upload it waited for fails', async () => {
      const upload = heldAnswer()
      global.fetch = vi.fn().mockReturnValueOnce(upload.promise)
      const file = backupFile()
      const validated = validateBackup(file, SKIP)
      await requestCount(1)

      const unhandled = await unhandledRejectionsDuring(async () => {
        releaseBackup(file)
        upload.answer(failedResponse(500, ''))
        await expect(validated).rejects.toThrow('Upload failed: HTTP 500')
      })

      expect(unhandled).toEqual([])
      expect(sentRequests()).toEqual([UPLOADS])
    })
  })

  describe('getSchedule', () => {
    it('fetches schedule config', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(envelope(mockSchedule)),
      })

      const result = await getSchedule()

      expect(global.fetch).toHaveBeenCalledWith(
        'http://localhost:8000/api/backup/schedule',
        expect.objectContaining({ method: 'GET' })
      )
      expect(result.enabled).toBe(true)
      expect(result.cron).toBe('0 2 * * *')
    })

    it('returns every field of the schedule the server answered', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(envelope(mockSchedule)),
      })

      const result = await getSchedule()

      expect(result).toEqual(mockSchedule)
    })

    it('returns the fresh-install schedule: off, with the defaults', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(envelope(freshSchedule)),
      })

      const result = await getSchedule()

      expect(result).toEqual(freshSchedule)
      expect(result.enabled).toBe(false)
      expect(result.save_directory).toBe('~/wave-backups')
    })

    it('throws the reason the server sent', async () => {
      global.fetch = vi.fn().mockResolvedValue(
        failedResponse(
          500,
          'Internal Server Error',
          waveErrorEnvelope('Schedule file is unreadable', 'INTERNAL_ERROR')
        )
      )

      await expect(getSchedule()).rejects.toThrow('Schedule file is unreadable')
    })

    it('names the operation when the response carries no reason at all', async () => {
      global.fetch = vi.fn().mockResolvedValue(failedResponse(500, ''))

      await expect(getSchedule()).rejects.toThrow('Failed to fetch schedule')
    })
  })

  describe('updateSchedule', () => {
    it('sends PUT with schedule config', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(envelope(mockSchedule)),
      })

      const result = await updateSchedule({
        enabled: true,
        cron: '0 2 * * *',
        entity_types: ['tests', 'environments'],
        max_backups: 5,
        save_directory: '/srv/backups',
        secrets: 'encrypted',
      })

      expect(global.fetch).toHaveBeenCalledWith(
        'http://localhost:8000/api/backup/schedule',
        expect.objectContaining({
          method: 'PUT',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
          }),
        })
      )
      const putBody = JSON.parse(vi.mocked(global.fetch).mock.calls[0][1]!.body as string)
      expect(putBody.secrets).toBe('encrypted')
      expect(putBody).not.toHaveProperty('include_credentials')
      expect(result.enabled).toBe(true)
    })

    it('sends every field of a schedule that is on', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(envelope(mockSchedule)),
      })

      const result = await updateSchedule(scheduleUpdate)

      expect(sentBody()).toStrictEqual(scheduleUpdate)
      expect(result).toEqual(mockSchedule)
    })

    it('turns the schedule off with a PUT that carries only { enabled: false }', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(envelope({ ...mockSchedule, enabled: false, next_run: null })),
      })

      const result = await updateSchedule({ enabled: false })

      expect(global.fetch).toHaveBeenCalledTimes(1)
      expect(global.fetch).toHaveBeenCalledWith(
        'http://localhost:8000/api/backup/schedule',
        expect.objectContaining({ method: 'PUT' })
      )
      expect(sentBody()).toStrictEqual({ enabled: false })
      expect(result).toEqual({ ...mockSchedule, enabled: false, next_run: null })
    })

    it('throws the exact reason for a save directory inside the data folder', async () => {
      global.fetch = vi.fn().mockResolvedValue(
        failedResponse(
          400,
          'Bad Request',
          waveErrorEnvelope('Save directory must be outside the data folder: /srv/wave/data')
        )
      )

      const error = await rejectionOf(
        updateSchedule({ ...scheduleUpdate, save_directory: '/srv/wave/data/backups' })
      )

      expect(error.message).toBe('Save directory must be outside the data folder: /srv/wave/data')
    })

    it('throws the exact reason when the config file cannot be written', async () => {
      global.fetch = vi.fn().mockResolvedValue(
        failedResponse(
          500,
          'Internal Server Error',
          waveErrorEnvelope(
            'Settings cannot be saved: the config file /srv/wave/config/config.yaml is read-only',
            'INTERNAL_ERROR'
          )
        )
      )

      const error = await rejectionOf(updateSchedule({ enabled: false }))

      expect(error.message).toBe(
        'Settings cannot be saved: the config file /srv/wave/config/config.yaml is read-only'
      )
    })

    it('throws the reason the server sent for an invalid cron', async () => {
      global.fetch = vi.fn().mockResolvedValue(
        failedResponse(
          400,
          'Bad Request',
          waveErrorEnvelope("'bad' is not a valid cron expression")
        )
      )

      await expect(
        updateSchedule({ enabled: true, cron: 'bad' })
      ).rejects.toThrow("'bad' is not a valid cron expression")
    })

    it('names the operation when the response carries no reason at all', async () => {
      global.fetch = vi.fn().mockResolvedValue(failedResponse(500, ''))

      await expect(
        updateSchedule({ enabled: true, cron: 'bad' })
      ).rejects.toThrow('Failed to update schedule')
    })
  })

  describe('deleteSchedule', () => {
    it('is no longer exported: the schedule is turned off through updateSchedule', () => {
      expect(Object.keys(backupApi)).not.toContain('deleteSchedule')
    })
  })

  // Type assertions: the type-check step fails on them, the test run does not.
  describe('BackupSchedule type', () => {
    it('holds exactly the fields the server answers, none of them optional', () => {
      expectTypeOf<keyof BackupSchedule>().toEqualTypeOf<
        | 'enabled'
        | 'cron'
        | 'entity_types'
        | 'max_backups'
        | 'save_directory'
        | 'format'
        | 'compression_method'
        | 'compression_level'
        | 'secrets'
        | 'last_run'
        | 'last_run_status'
        | 'cron_description'
        | 'next_run'
      >()
      expectTypeOf<Required<BackupSchedule>>().toEqualTypeOf<BackupSchedule>()
    })

    it('types each field as the server sends it', () => {
      expectTypeOf<BackupSchedule['enabled']>().toEqualTypeOf<boolean>()
      expectTypeOf<BackupSchedule['cron']>().toEqualTypeOf<string>()
      expectTypeOf<BackupSchedule['entity_types']>().toEqualTypeOf<string[]>()
      expectTypeOf<BackupSchedule['max_backups']>().toEqualTypeOf<number>()
      expectTypeOf<BackupSchedule['save_directory']>().toEqualTypeOf<string>()
      expectTypeOf<BackupSchedule['compression_level']>().toEqualTypeOf<number>()
      expectTypeOf<BackupSchedule['secrets']>().toEqualTypeOf<ExportSecretsMode>()
      expectTypeOf<BackupSchedule['last_run']>().toEqualTypeOf<string | null>()
      expectTypeOf<BackupSchedule['last_run_status']>().toEqualTypeOf<'success' | 'failed' | null>()
      expectTypeOf<BackupSchedule['cron_description']>().toEqualTypeOf<string>()
      expectTypeOf<BackupSchedule['next_run']>().toEqualTypeOf<string | null>()
    })
  })

  describe('Backup item types', () => {
    it('types a preview item and a result item as the server sends them', () => {
      expectTypeOf<BackupPreviewItem>().toEqualTypeOf<{
        name: string
        status: 'conflict' | 'fatal'
        reason: string
      }>()
      expectTypeOf<BackupRestoreItem>().toEqualTypeOf<{
        name: string
        status: 'skipped' | 'fatal'
        reason: string
      }>()
      expectTypeOf<BackupItem>().toEqualTypeOf<BackupPreviewItem | BackupRestoreItem>()
    })
  })
})
