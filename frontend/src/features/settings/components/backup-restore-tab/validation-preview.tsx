/**
 * ValidationPreview Component
 *
 * Displays metadata from a validated backup archive with a clear button.
 */

import { Button } from '@/components/ui/button'
import { Timestamp } from '@/components/shared/timestamp/timestamp'
import { X } from 'lucide-react'
import type { BackupMetadata } from '@/features/settings/api/backup'
import type { ExportSecretsMode } from '@/types/import-export'

const SECRETS_MODE_LABELS: Record<ExportSecretsMode, string> = {
  mask: 'Masked',
  encrypted: 'Encrypted',
  plaintext: 'Plain text',
}

interface ValidationPreviewProps {
  fileName: string | undefined
  metadata: BackupMetadata
  onClear: () => void
}

export function ValidationPreview({ fileName, metadata, onClear }: Readonly<ValidationPreviewProps>) {
  return (
    <div data-testid="validation-preview" className="space-y-3 p-4 rounded-md border max-w-2xl">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Backup Details</h3>
        <Button
          variant="ghost"
          size="sm"
          onClick={onClear}
          data-testid="clear-file-button"
          className="h-7 px-2"
        >
          <X className="h-3.5 w-3.5 mr-1" />
          Clear
        </Button>
      </div>
      <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs">
        <span className="text-muted-foreground">File</span>
        <span translate="no" className="min-w-0 break-all font-medium">
          {fileName}
        </span>
        <span className="text-muted-foreground">Version</span>
        <span translate="no">{metadata.wave_version}</span>
        <span className="text-muted-foreground">Format</span>
        <span className="uppercase">{metadata.format}</span>
        <span className="text-muted-foreground">Created</span>
        <Timestamp value={metadata.created_at} style="full" />
        <span className="text-muted-foreground">Secrets</span>
        <span>{SECRETS_MODE_LABELS[metadata.secrets]}</span>
      </div>
    </div>
  )
}
