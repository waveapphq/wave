/**
 * ImportDialog Component (Shared)
 *
 * Generic two-step dialog for importing entities:
 * Step 1: File upload drop zone
 * Step 2: Review validation results with conflict resolution
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Icon } from '@/components/ui/icon'
import { FileDropZone } from '@/components/shared/file-drop-zone'
import { CheckCircle, AlertTriangle, XCircle, FileWarning } from 'lucide-react'
import type { ValidateImportResult, ImportResult, ValidationItemResult } from '@/types/import-export'

export type ConflictResolution = 'rename' | 'overwrite' | 'skip'

export interface ImportDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  entityLabel: string
  onValidate: (file: File) => Promise<ValidateImportResult>
  onImport: (file: File, resolutions: Record<string, ConflictResolution>) => Promise<ImportResult>
  onImportComplete: (result: ImportResult) => void
  allowedResolutions?: ConflictResolution[]
}

const ACCEPTED_TYPES = '.yaml,.yml,.json,.zip'

const ALL_RESOLUTIONS: ConflictResolution[] = ['rename', 'overwrite', 'skip']

const RESOLUTION_LABELS: Record<ConflictResolution, string> = {
  rename: 'Auto-rename',
  overwrite: 'Overwrite',
  skip: 'Skip',
}

const CONFLICT_REASON_LABELS: Record<
  NonNullable<ValidationItemResult['conflict_reason']>,
  string
> = {
  name: 'Name already in use',
  id: 'ID already in library',
  both: 'Name and ID already in library',
}

function statusIcon(status: ValidationItemResult['status']) {
  switch (status) {
    case 'ok':
      return <Icon icon={CheckCircle} size="sm" className="text-success" />
    case 'conflict':
      return <Icon icon={FileWarning} size="sm" className="text-warning" />
    case 'fixable':
      return <Icon icon={AlertTriangle} size="sm" className="text-warning" />
    case 'fatal':
      return <Icon icon={XCircle} size="sm" className="text-error" />
  }
}

export function ImportDialog({
  open,
  onOpenChange,
  entityLabel,
  onValidate,
  onImport,
  onImportComplete,
  allowedResolutions = ALL_RESOLUTIONS,
}: Readonly<ImportDialogProps>) {
  const [step, setStep] = useState<'upload' | 'review'>('upload')
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [validationResult, setValidationResult] = useState<ValidateImportResult | null>(null)
  const [resolutions, setResolutions] = useState<Record<string, ConflictResolution>>({})
  const [validating, setValidating] = useState(false)
  const [importing, setImporting] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  // The buttons cannot await, so each step reports its own failure on the
  // dialog's error line rather than leaving the click looking like a no-op.
  const reportFailure = (fallback: string) => (err: unknown) => {
    setFailure(err instanceof Error ? err.message : fallback)
  }

  const handleValidate = () => {
    // selectedFile is guaranteed non-null: validate button is disabled when !selectedFile
    const file = selectedFile!
    setValidating(true)
    setFailure(null)
    const validate = async (): Promise<void> => {
      try {
        const result = await onValidate(file)
        setValidationResult(result)
        const initialResolutions: Record<string, ConflictResolution> = {}
        for (const item of result.items) {
          if (item.status === 'conflict') {
            initialResolutions[item.name] = allowedResolutions[0]
          }
        }
        setResolutions(initialResolutions)
        setStep('review')
      } finally {
        setValidating(false)
      }
    }
    validate().catch(reportFailure('Validation failed'))
  }

  const handleImport = () => {
    // selectedFile is guaranteed non-null: import is only reachable after validation which requires a file
    const file = selectedFile!
    setImporting(true)
    setFailure(null)
    const runImport = async (): Promise<void> => {
      try {
        const result = await onImport(file, resolutions)
        onImportComplete(result)
        handleClose()
      } finally {
        setImporting(false)
      }
    }
    runImport().catch(reportFailure('Import failed'))
  }

  const handleBack = () => {
    setStep('upload')
    setValidationResult(null)
    setResolutions({})
    setFailure(null)
  }

  const handleClose = () => {
    setStep('upload')
    setSelectedFile(null)
    setValidationResult(null)
    setResolutions({})
    setFailure(null)
    onOpenChange(false)
  }

  const handleResolutionChange = (itemName: string, value: string) => {
    setResolutions(prev => ({ ...prev, [itemName]: value as ConflictResolution }))
  }

  const pluralLabel = `${entityLabel}s`

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent data-testid="import-dialog" className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Import {pluralLabel}</DialogTitle>
          <DialogDescription>
            {step === 'upload'
              ? `Upload a YAML, JSON, or ZIP file containing ${pluralLabel.toLowerCase()} definitions.`
              : `${validationResult!.importable} of ${validationResult!.total} ${pluralLabel.toLowerCase()} can be imported.`}
          </DialogDescription>
        </DialogHeader>

        {step === 'upload' && (
          <div className="py-4">
            <FileDropZone
              accept={ACCEPTED_TYPES}
              acceptLabel=".yaml, .json, or .zip"
              onFile={setSelectedFile}
              selectedName={selectedFile?.name}
              data-testid="drop-zone"
            />
          </div>
        )}

        {step === 'review' && validationResult && (
          <div className="py-4 max-h-[300px] overflow-auto overscroll-contain" data-testid="review-step">
            <div className="space-y-3">
              {validationResult.items.map((item) => (
                <div
                  key={item.name}
                  className="flex items-center justify-between rounded-md border p-3"
                  data-testid={`item-result-${item.name}`}
                >
                  <div className="flex items-center gap-2">
                    {statusIcon(item.status)}
                    <div className="flex flex-col">
                      <span className="text-sm font-medium">{item.name}</span>
                      {item.conflict_reason && (
                        <span className="text-xs text-muted">
                          {CONFLICT_REASON_LABELS[item.conflict_reason]}
                        </span>
                      )}
                      {item.warnings.map((warning) => (
                        <span
                          key={warning.message}
                          className="flex items-start gap-1 text-xs text-warning"
                          data-testid="import-item-warning"
                        >
                          <Icon icon={AlertTriangle} size="sm" className="mt-0.5 shrink-0" />
                          {warning.message}
                        </span>
                      ))}
                    </div>
                  </div>
                  {item.status === 'conflict' && (
                    <Select
                      value={resolutions[item.name]}
                      onValueChange={(v) => handleResolutionChange(item.name, v)}
                    >
                      <SelectTrigger className="w-[130px]" data-testid={`resolution-${item.name}`}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {allowedResolutions.map((resolution) => (
                          <SelectItem key={resolution} value={resolution}>
                            {RESOLUTION_LABELS[resolution]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                  {item.status === 'fatal' && (
                    <span className="text-xs text-error">Blocked</span>
                  )}
                  {item.status === 'fixable' && (
                    <span className="text-xs text-warning">Will auto-fix</span>
                  )}
                </div>
              ))}
            </div>
            <div className="mt-3 text-sm text-muted" data-testid="import-summary">
              {validationResult.importable} importable, {validationResult.blocked} blocked
            </div>
          </div>
        )}

        {failure && (
          <p
            role="alert"
            data-testid="import-dialog-error"
            className="rounded-md bg-destructive/10 p-3 text-sm text-destructive"
          >
            {failure}
          </p>
        )}

        <DialogFooter>
          {step === 'upload' && (
            <>
              <Button variant="outline" onClick={handleClose}>
                Cancel
              </Button>
              <Button
                onClick={handleValidate}
                disabled={!selectedFile || validating}
                data-testid="validate-button"
              >
                {validating ? 'Validating…' : 'Validate'}
              </Button>
            </>
          )}
          {step === 'review' && (
            <>
              <Button variant="outline" onClick={handleBack} data-testid="back-button">
                Back
              </Button>
              <Button
                onClick={handleImport}
                disabled={importing || validationResult!.importable === 0}
                data-testid="import-button"
              >
                {importing ? 'Importing…' : 'Import'}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
