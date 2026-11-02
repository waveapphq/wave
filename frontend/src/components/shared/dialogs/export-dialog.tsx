/**
 * ExportDialog Component (Shared)
 *
 * Generic dialog for configuring export options, parameterized by entity type.
 * - Single entity: "Export {entityLabel}" title, "Download" button
 * - Bulk: "Export N {entityLabel}s" title, "Download ZIP" button
 * - Body: Format picker (YAML/JSON), optional Secret values picker
 */

import { useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { FormatPicker, type ExportFormat } from '@/components/shared/dialogs/format-picker'
import { SecretsModePicker } from '@/components/shared/secrets-mode-picker'
import type { ExportSecretsMode } from '@/types/import-export'

export interface ExportDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  entityIds: string[]
  entityNames: string[]
  entityLabel: string
  onExport: (options: { format: 'yaml' | 'json'; secrets: ExportSecretsMode }) => void
  hasSecrets?: boolean
  loading?: boolean
  defaultFormat?: ExportFormat
}

export function ExportDialog({
  open,
  onOpenChange,
  entityIds,
  entityNames,
  entityLabel,
  onExport,
  hasSecrets = true,
  loading = false,
  defaultFormat = 'yaml',
}: Readonly<ExportDialogProps>) {
  const [format, setFormat] = useState<ExportFormat>(defaultFormat)
  const [secrets, setSecrets] = useState<ExportSecretsMode>('mask')

  const isBulk = entityIds.length > 1
  const title = isBulk ? `Export ${entityIds.length} ${entityLabel}s` : `Export ${entityLabel}`
  const buttonText = isBulk ? 'Download ZIP' : 'Download'

  const handleExport = () => {
    onExport({ format, secrets: hasSecrets ? secrets : 'mask' })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="export-dialog">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {!isBulk && entityNames.length === 1
              ? entityNames[0]
              : 'Select format and options for export.'}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-4">
          <FormatPicker value={format} onChange={setFormat} />

          {hasSecrets && <SecretsModePicker value={secrets} onChange={setSecrets} />}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
            Cancel
          </Button>
          <Button onClick={handleExport} disabled={loading} data-testid="export-button">
            {loading ? 'Exporting…' : buttonText}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
