/**
 * Profiles Import/Export API Client
 *
 * REQ-4.7.4: Profile management UI
 *
 * Export and import functionality for profiles.
 */

import { getApiBaseUrl } from '@/lib/api'
import {
  requestEntityImportValidation,
  requestImport,
} from '@/lib/api/import-export'
import { apiErrorFromResponse } from '@/services/api-client/errors'
import type { ValidateImportResult, ImportResult } from '@/types/import-export'
import type { ProfileExportOptions } from './types'

// ===========================================================================
// Profile Export/Import API
// ===========================================================================

/**
 * Export a single profile as a downloadable file
 */
export async function exportProfile(
  profileId: string,
  options: ProfileExportOptions = {}
): Promise<Blob> {
  const { format = 'yaml', secrets = 'mask' } = options
  const params = new URLSearchParams({ format, secrets })
  const path = `/profiles/${profileId}/export?${params}`
  const response = await fetch(`${getApiBaseUrl()}${path}`)
  if (!response.ok) {
    throw await apiErrorFromResponse(response, {
      method: 'GET',
      path,
      fallback: 'Export failed',
    })
  }
  return response.blob()
}

/**
 * Export multiple profiles (returns single file for 1, ZIP for 2+)
 */
export async function exportProfiles(
  profileIds: string[],
  options: ProfileExportOptions = {}
): Promise<Blob> {
  const { format = 'yaml', secrets = 'mask' } = options
  const path = '/profiles/export'
  const response = await fetch(`${getApiBaseUrl()}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      profile_ids: profileIds,
      format,
      secrets,
    }),
  })
  if (!response.ok) {
    throw await apiErrorFromResponse(response, {
      method: 'POST',
      path,
      fallback: 'Export failed',
    })
  }
  return response.blob()
}

/**
 * Validate a file for profile import (dry-run)
 */
export function validateProfileImport(file: File): Promise<ValidateImportResult> {
  return requestEntityImportValidation('/profiles/import/validate', file, {
    collection: 'profiles',
    existingId: 'existing_profile_id',
  })
}

/**
 * Import profiles from file with conflict resolutions
 */
export function importProfiles(
  file: File,
  conflictResolutions: Record<string, string> = {}
): Promise<ImportResult> {
  return requestImport('/profiles/import', file, conflictResolutions)
}
