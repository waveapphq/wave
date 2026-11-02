/**
 * Backup API Client
 *
 * Provides functions for backup creation, validation, restoration,
 * and periodic schedule management.
 */

import { getApiBaseUrl } from '@/lib/api'
import { apiErrorFromResponse } from '@/services/api-client/errors'
import type { ApiError } from '@/services/api-client/types'
import type { ExportSecretsMode } from '@/types/import-export'

// ============================================================================
// Types
// ============================================================================

export interface BackupCreateRequest {
  entity_types: string[]
  format?: string
  compression_method?: string
  compression_level?: number
  secrets?: ExportSecretsMode
}

export interface BackupPreviewItem {
  name: string
  status: 'conflict' | 'fatal'
  reason: string
}

export interface BackupRestoreItem {
  name: string
  status: 'skipped' | 'fatal'
  reason: string
}

export type BackupItem = BackupPreviewItem | BackupRestoreItem

export interface BackupEntitySummary {
  total: number
  ok: number
  conflicts: number
  fixable: number
  fatal: number
  items: BackupPreviewItem[]
}

export interface BackupMetadata {
  wave_version: string
  created_at: string
  format: string
  schema_version: string
  secrets: ExportSecretsMode
}

export interface BackupValidateResult {
  metadata: BackupMetadata
  entity_summary: Record<string, BackupEntitySummary>
}

export interface BackupRestoreOptions {
  entity_types?: string[]
  conflict_resolution: string
  auto_repair?: boolean
}

export interface BackupRestoreTypeResult {
  imported: number
  skipped: number
  fatal: number
  items: BackupRestoreItem[]
}

export type BackupRestoreResult = Record<string, BackupRestoreTypeResult>

export interface BackupSchedule {
  enabled: boolean
  cron: string
  entity_types: string[]
  max_backups: number
  save_directory: string
  format: string
  compression_method: string
  compression_level: number
  secrets: ExportSecretsMode
  last_run: string | null
  last_run_status: 'success' | 'failed' | null
  cron_description: string
  next_run: string | null
}

export interface BackupScheduleUpdate {
  enabled: boolean
  cron?: string
  entity_types?: string[]
  /** The number wire form: a JS number when exact, else its digit text (REQ-3.1.3.14). */
  max_backups?: number | string
  save_directory?: string
  format?: string
  compression_method?: string
  compression_level?: number
  secrets?: ExportSecretsMode
}

// ============================================================================
// Failures
// ============================================================================

const BACKUP_PATHS = {
  create: '/api/backup/create',
  validate: '/api/backup/validate',
  restore: '/api/backup/restore',
  uploads: '/api/backup/uploads',
  schedule: '/api/backup/schedule',
} as const

type BackupPath = (typeof BACKUP_PATHS)[keyof typeof BACKUP_PATHS]
type KeptUploadPath = typeof BACKUP_PATHS.validate | typeof BACKUP_PATHS.restore

const UPLOAD_GONE = 'BACKUP_UPLOAD_NOT_FOUND'

/**
 * The reason the server gave, read through the one shared envelope parser so
 * the whole app reads a failure the same way. The fallback describes the
 * operation and is used only when the response carries no reason at all.
 */
function backupFailure(
  response: Response,
  method: string,
  path: BackupPath,
  fallback: string
): Promise<ApiError> {
  return apiErrorFromResponse(response, { method, path, fallback })
}

/** The payload the shared success envelope carries. */
async function envelopeData<T>(response: Response): Promise<T> {
  const body = (await response.json()) as { data: T }
  return body.data
}

// ============================================================================
// API Functions
// ============================================================================

/**
 * Create a backup archive and download it.
 */
export async function createBackup(request: BackupCreateRequest): Promise<Blob> {
  const response = await fetch(`${getApiBaseUrl()}${BACKUP_PATHS.create}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  })
  if (!response.ok) {
    throw await backupFailure(response, 'POST', BACKUP_PATHS.create, 'Backup creation failed')
  }
  return response.blob()
}

/** The upload the backend keeps for each picked file, by its ID. */
const keptUploads = new WeakMap<File, Promise<string>>()

async function uploadBackup(file: File): Promise<string> {
  const formData = new FormData()
  formData.append('file', file)
  const response = await fetch(`${getApiBaseUrl()}${BACKUP_PATHS.uploads}`, {
    method: 'POST',
    body: formData,
  })
  if (!response.ok) {
    throw await backupFailure(response, 'POST', BACKUP_PATHS.uploads, 'Upload failed')
  }
  const kept = await envelopeData<{ upload_id: string }>(response)
  return kept.upload_id
}

/** Forgets an upload unless a newer one of the same file took its place. */
function forgetUpload(file: File, upload: Promise<string>): void {
  if (keptUploads.get(file) === upload) keptUploads.delete(file)
}

/** Sends a file once; every caller that needs it meanwhile shares that upload. */
function keptUpload(file: File): Promise<string> {
  const kept = keptUploads.get(file)
  if (kept) return kept
  const upload = uploadBackup(file)
  keptUploads.set(file, upload)
  upload.catch(() => forgetUpload(file, upload))
  return upload
}

/** The one multipart form both the preview and the restore send. */
function backupForm(uploadId: string, options: BackupRestoreOptions): FormData {
  const formData = new FormData()
  formData.append('upload_id', uploadId)
  if (options.entity_types) {
    formData.append('entity_types', options.entity_types.join(','))
  }
  formData.append('conflict_resolution', options.conflict_resolution)
  formData.append('auto_repair', String(options.auto_repair ?? false))
  return formData
}

function postChoices(
  path: KeptUploadPath,
  uploadId: string,
  options: BackupRestoreOptions
): Promise<Response> {
  return fetch(`${getApiBaseUrl()}${path}`, {
    method: 'POST',
    body: backupForm(uploadId, options),
  })
}

/** Sends the choices for a kept file; a file the backend dropped is sent again once. */
async function sendForKeptUpload<T>(
  path: KeptUploadPath,
  file: File,
  options: BackupRestoreOptions,
  fallback: string
): Promise<T> {
  const upload = keptUpload(file)
  const first = await postChoices(path, await upload, options)
  if (first.ok) return envelopeData<T>(first)
  const failure = await backupFailure(first, 'POST', path, fallback)
  // No kept upload left means the page released the file meanwhile.
  if (failure.code !== UPLOAD_GONE || !keptUploads.has(file)) throw failure
  forgetUpload(file, upload)
  const second = await postChoices(path, await keptUpload(file), options)
  if (second.ok) return envelopeData<T>(second)
  throw await backupFailure(second, 'POST', path, fallback)
}

/**
 * Validate an uploaded backup archive (dry-run preview).
 */
export function validateBackup(
  file: File,
  options: BackupRestoreOptions
): Promise<BackupValidateResult> {
  return sendForKeptUpload<BackupValidateResult>(
    BACKUP_PATHS.validate,
    file,
    options,
    'Validation failed'
  )
}

/**
 * Restore entities from an uploaded backup archive.
 */
export function restoreBackup(
  file: File,
  options: BackupRestoreOptions
): Promise<BackupRestoreResult> {
  return sendForKeptUpload<BackupRestoreResult>(
    BACKUP_PATHS.restore,
    file,
    options,
    'Restore failed'
  )
}

/** Drops the upload the backend keeps for a file the page let go of. */
export function releaseBackup(file: File): void {
  const upload = keptUploads.get(file)
  if (!upload) return
  keptUploads.delete(file)
  upload
    .then((uploadId) =>
      fetch(`${getApiBaseUrl()}${BACKUP_PATHS.uploads}/${uploadId}`, { method: 'DELETE' })
    )
    .catch(() => {
      // The backend drops an idle upload by itself.
    })
}

/**
 * Get the current periodic backup schedule.
 */
export async function getSchedule(): Promise<BackupSchedule> {
  const response = await fetch(`${getApiBaseUrl()}${BACKUP_PATHS.schedule}`, {
    method: 'GET',
  })
  if (!response.ok) {
    throw await backupFailure(response, 'GET', BACKUP_PATHS.schedule, 'Failed to fetch schedule')
  }
  return envelopeData<BackupSchedule>(response)
}

/**
 * Update the periodic backup schedule.
 */
export async function updateSchedule(
  config: BackupScheduleUpdate
): Promise<BackupSchedule> {
  const response = await fetch(`${getApiBaseUrl()}${BACKUP_PATHS.schedule}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(config),
  })
  if (!response.ok) {
    throw await backupFailure(response, 'PUT', BACKUP_PATHS.schedule, 'Failed to update schedule')
  }
  return envelopeData<BackupSchedule>(response)
}
