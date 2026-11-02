/**
 * BackupRestoreTab Component
 *
 * Main settings section for backup and restore operations.
 * Three sub-sections: Create Backup, Restore from Backup, Periodic Backup.
 */

import { CreateBackupSection } from './create-backup-section'
import { RestoreBackupSection } from './restore-backup-section'
import { PeriodicBackupSection } from './periodic-backup-section'
import type { UsePeriodicBackupResult } from '@/features/settings/container/use-periodic-backup'

export interface BackupRestoreTabProps {
  periodicBackup: UsePeriodicBackupResult
}

export function BackupRestoreTab({ periodicBackup }: Readonly<BackupRestoreTabProps>) {
  return (
    <div data-testid="backup-restore-tab" className="space-y-8">
      <CreateBackupSection />
      <hr className="border-border" />
      <RestoreBackupSection />
      <hr className="border-border" />
      <PeriodicBackupSection schedule={periodicBackup} />
    </div>
  )
}
