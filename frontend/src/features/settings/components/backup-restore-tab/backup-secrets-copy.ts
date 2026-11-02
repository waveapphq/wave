/**
 * Backup-variant copy for the shared SecretsModePicker.
 */

import type { ExportSecretsMode } from '@/types/import-export'

export const BACKUP_SECRETS_DESCRIPTIONS: Partial<Record<ExportSecretsMode, string>> = {
  encrypted: 'Values stay sealed - restorable with working secrets on this WAVE instance',
}

export const BACKUP_SECRETS_WARNING =
  'Secrets will be written in plain text. Handle the backup file securely.'
