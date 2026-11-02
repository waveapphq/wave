/**
 * RestoreBackupSection Component
 *
 * Settings section for uploading, validating, and restoring backup archives.
 */

import { useState, useRef, useCallback, useEffect, useId } from 'react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Progress } from '@/components/ui/progress'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Upload } from 'lucide-react'
import { ExpandToggle } from '@/components/shared/expand-toggle'
import * as backupApi from '@/features/settings/api/backup'
import { useDebouncedParse } from '@/features/settings/container/use-debounced-parse'
import { errorMessage } from './utils'
import { useFileDrop } from '@/hooks/use-file-drop'
import { pluralize } from '@/lib/pluralize'
import { EntitySummaryTable } from './entity-summary-table'
import { entityTypeLabel } from '@/features/settings/components/entity-selector'
import { RestoreItemList } from './restore-item-list'
import { RestoreOverwriteDialog } from './restore-overwrite-dialog'
import { ValidationPreview } from './validation-preview'

type PreviewKey = [
  uploadMarker: number,
  entityTypes: string[],
  conflictResolution: string,
  autoRepair: boolean,
  restoresEnded: number,
]

interface RowChoice {
  open: boolean
  hadFatal: boolean
}

const READ_FAILURE = 'Failed to read the backup file'
const NO_UPLOAD = 0
const NO_RESTORE = 0
const DEFAULT_CONFLICT_RESOLUTION = 'skip'
const OVERWRITE = 'overwrite'
const NO_PARTS: Record<string, backupApi.BackupEntitySummary> = {}

function previewKey(...key: PreviewKey): string {
  return JSON.stringify(key)
}

function hasFatalItem(part: { items: readonly backupApi.BackupItem[] }): boolean {
  return part.items.some((item) => item.status === 'fatal')
}

function toggled(members: string[], member: string): string[] {
  return members.includes(member) ? members.filter((m) => m !== member) : [...members, member]
}

interface RestoreResultPanelProps {
  result: backupApi.BackupRestoreResult
  openTypes: string[]
  onOpenToggle: (entityType: string) => void
}

function RestoreResultPanel({
  result,
  openTypes,
  onOpenToggle,
}: Readonly<RestoreResultPanelProps>) {
  const lineTextId = useId()
  return (
    <div data-testid="restore-result" className="p-4 rounded-md border space-y-1 max-w-lg">
      <h3 className="text-sm font-semibold">Restore Complete</h3>
      {Object.entries(result).map(([type, part]) => {
        const label = entityTypeLabel(type)
        const textId = `${lineTextId}-${type}`
        const open = openTypes.includes(type)
        const text = (
          <span id={textId} className="text-foreground group-hover:underline">
            <span className="capitalize font-medium">{label}</span>:{' '}
            {part.imported} imported,{' '}
            {part.skipped} skipped
            {part.fatal > 0 && `, ${part.fatal} failed`}
          </span>
        )
        return (
          <div key={type} data-testid={`restore-result-part-${type}`} className="space-y-1">
            <p data-testid={`restore-result-line-${type}`} className="text-xs">
              {part.items.length > 0 ? (
                <ExpandToggle
                  expanded={open}
                  onToggle={() => onOpenToggle(type)}
                  name={label}
                  aria-describedby={textId}
                  data-testid={`restore-result-toggle-${type}`}
                  className="cursor-pointer text-muted-foreground"
                >
                  {text}
                </ExpandToggle>
              ) : (
                <>
                  <span aria-hidden="true" className="inline-block w-6" />
                  {text}
                </>
              )}
            </p>
            {open && (
              <div data-testid={`restore-result-items-${type}`} className="mb-2">
                <RestoreItemList items={part.items} stage="result" labelId={textId} />
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

export function RestoreBackupSection() {
  const fieldId = useId()
  const autoRepairId = `${fieldId}-auto-repair`
  const conflictLabelId = `${fieldId}-conflict-resolution`
  const [file, setFile] = useState<File | null>(null)
  const [selectedTypes, setSelectedTypes] = useState<string[]>([])
  const [conflictResolution, setConflictResolution] = useState(DEFAULT_CONFLICT_RESOLUTION)
  const [autoRepair, setAutoRepair] = useState(false)
  const [restoring, setRestoring] = useState(false)
  const [restoreProgress, setRestoreProgress] = useState<number | null>(null)
  const [restoreResult, setRestoreResult] = useState<backupApi.BackupRestoreResult | null>(null)
  const [validateError, setValidateError] = useState<string | undefined>()
  const [restoreError, setRestoreError] = useState<string | undefined>()
  const [uploadMarker, setUploadMarker] = useState(NO_UPLOAD)
  const [restoresEnded, setRestoresEnded] = useState(NO_RESTORE)
  const [previewTypes, setPreviewTypes] = useState<string[]>([])
  const [previewChoices, setPreviewChoices] = useState<Partial<Record<string, RowChoice>>>({})
  const [openResultTypes, setOpenResultTypes] = useState<string[]>([])
  const [conflictShown, setConflictShown] = useState(false)
  const [autoRepairShown, setAutoRepairShown] = useState(false)
  const [confirmingOverwrite, setConfirmingOverwrite] = useState(false)
  const uploadCountRef = useRef(0)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const heldFileRef = useRef<File | null>(null)

  // The backend keeps an upload per file until the section lets go of that file.
  const holdFile = useCallback((next: File | null) => {
    if (heldFileRef.current) backupApi.releaseBackup(heldFileRef.current)
    heldFileRef.current = next
    setFile(next)
  }, [])

  useEffect(
    () => () => {
      if (heldFileRef.current) backupApi.releaseBackup(heldFileRef.current)
    },
    []
  )

  const readPreview = useCallback(
    async (text: string) => {
      const [, entityTypes, conflict, repair] = JSON.parse(text) as PreviewKey
      try {
        return await backupApi.validateBackup(file!, {
          entity_types: entityTypes,
          conflict_resolution: conflict,
          auto_repair: repair,
        })
      } catch (err) {
        throw new Error(errorMessage(err, READ_FAILURE), { cause: err })
      }
    },
    [file]
  )

  const {
    status: previewStatus,
    lastGoodResult: preview,
    error: previewError,
    prime: primePreview,
  } = useDebouncedParse(
    uploadMarker === NO_UPLOAD
      ? ''
      : previewKey(uploadMarker, previewTypes, conflictResolution, autoRepair, restoresEnded),
    readPreview
  )

  const entitySummary = preview ? preview.entity_summary : NO_PARTS
  const partTypes = Object.keys(entitySummary)
  const parts = Object.values(entitySummary)
  const showAutoRepair = autoRepairShown || parts.some((s) => s.fixable > 0)
  const showConflictResolution = conflictShown || parts.some((s) => s.conflicts > 0)
  // A choice counts only while its part has the fatal state it was made in (BACKUP-2).
  const liveChoices: Partial<Record<string, RowChoice>> = Object.fromEntries(
    Object.entries(entitySummary).flatMap(([type, part]): [string, RowChoice][] => {
      const choice = previewChoices[type]
      return choice?.hadFatal === hasFatalItem(part) ? [[type, choice]] : []
    })
  )
  const openTypes = partTypes.filter(
    (type) => liveChoices[type]?.open ?? hasFatalItem(entitySummary[type])
  )

  const reportValidateFailure = useCallback((err: unknown) => {
    setValidateError(errorMessage(err, READ_FAILURE))
  }, [])

  const reportRestoreFailure = useCallback((err: unknown) => {
    setRestoreProgress(null)
    setRestoreError(errorMessage(err, 'Failed to restore the backup'))
  }, [])

  const processFile = useCallback(async (selectedFile: File) => {
    uploadCountRef.current += 1
    const marker = uploadCountRef.current
    holdFile(selectedFile)
    setRestoreResult(null)
    setValidateError(undefined)
    setRestoreError(undefined)
    const [firstRead] = await Promise.allSettled([
      backupApi.validateBackup(selectedFile, {
        conflict_resolution: DEFAULT_CONFLICT_RESOLUTION,
        auto_repair: false,
      }),
    ])
    // The answer of an upload that a newer pick replaced is dropped, good or bad.
    if (uploadCountRef.current !== marker) return
    if (firstRead.status === 'rejected') {
      reportValidateFailure(firstRead.reason)
      return
    }
    const types = Object.keys(firstRead.value.entity_summary)
    primePreview(
      previewKey(marker, types, DEFAULT_CONFLICT_RESOLUTION, false, NO_RESTORE),
      firstRead.value
    )
    setUploadMarker(marker)
    setRestoresEnded(NO_RESTORE)
    setSelectedTypes(types)
    setPreviewTypes(types)
  }, [holdFile, primePreview, reportValidateFailure])

  const { isDragging: dragOver, dropZoneRef } = useFileDrop<HTMLButtonElement>({
    onFile: (file) => { processFile(file).catch(reportValidateFailure) },
    enabled: !preview,
  })

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>): void => {
    const selectedFile = e.target.files?.[0]
    if (!selectedFile) return
    processFile(selectedFile).catch(reportValidateFailure)
  }

  const handleClear = () => {
    holdFile(null)
    setSelectedTypes([])
    setRestoreResult(null)
    setValidateError(undefined)
    setRestoreError(undefined)
    setAutoRepair(false)
    setConflictResolution(DEFAULT_CONFLICT_RESOLUTION)
    setUploadMarker(NO_UPLOAD)
    setPreviewChoices({})
    setConflictShown(false)
    setAutoRepairShown(false)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  // Before a change starts a re-read: shown controls stay, outdated row choices go (BACKUP-2, BACKUP-5).
  const settlePreviewOnScreen = () => {
    setAutoRepairShown(showAutoRepair)
    setConflictShown(showConflictResolution)
    setPreviewChoices(liveChoices)
  }

  const handleTypeToggle = (entityType: string) => {
    const nextSelected = toggled(selectedTypes, entityType)
    const nextPreviewTypes = partTypes.filter((type) => nextSelected.includes(type))
    setSelectedTypes(nextSelected)
    if (nextPreviewTypes.length > 0) setPreviewTypes(nextPreviewTypes)
    settlePreviewOnScreen()
  }

  const handleAutoRepairChange = (checked: boolean) => {
    setAutoRepair(checked)
    settlePreviewOnScreen()
  }

  const handleConflictResolutionChange = (value: string) => {
    setConflictResolution(value)
    settlePreviewOnScreen()
  }

  const handleOpenToggle = (entityType: string) => {
    setPreviewChoices((prev) => ({
      ...prev,
      [entityType]: {
        open: !openTypes.includes(entityType),
        hadFatal: hasFatalItem(entitySummary[entityType]),
      },
    }))
  }

  const handleResultToggle = (entityType: string) => {
    setOpenResultTypes((prev) => toggled(prev, entityType))
  }

  const handleRestore = async () => {
    setRestoring(true)
    setRestoreProgress(0)
    setRestoreError(undefined)

    const step = 100 / selectedTypes.length
    let current = 0
    const interval = setInterval(() => {
      current += step
      if (current >= 95) {
        clearInterval(interval)
        setRestoreProgress(95)
      } else {
        setRestoreProgress(Math.round(current))
      }
    }, 200)

    try {
      const result = await backupApi.restoreBackup(file!, {
        entity_types: selectedTypes,
        conflict_resolution: conflictResolution,
        auto_repair: autoRepair,
      })
      clearInterval(interval)
      setRestoreProgress(100)
      setRestoreResult(result)
      setPreviewChoices(
        Object.fromEntries(
          Object.entries(entitySummary).map(([type, part]): [string, RowChoice] => [
            type,
            { open: false, hadFatal: hasFatalItem(part) },
          ])
        )
      )
      setOpenResultTypes(Object.keys(result).filter((type) => hasFatalItem(result[type])))
    } catch (err) {
      clearInterval(interval)
      reportRestoreFailure(err)
    } finally {
      // A restore changes what is here, so the preview is read again when it ends (BACKUP-5).
      setRestoresEnded((count) => count + 1)
      setTimeout(() => {
        setRestoring(false)
        setRestoreProgress(null)
      }, 500)
    }
  }

  const startRestore = () => {
    handleRestore().catch(reportRestoreFailure)
  }

  // Count restorable entities (exclude fatal + unchecked types)
  const restorableCount = selectedTypes.reduce((sum, type) => {
    const s = entitySummary[type]
    if (!s) return sum
    return sum + s.ok + s.conflicts + (autoRepair ? s.fixable : 0)
  }, 0)
  // Restore asks first when it would overwrite an entity here (BACKUP-8).
  const overwritesHere =
    conflictResolution === OVERWRITE &&
    Object.entries(entitySummary).some(
      ([type, part]) => part.conflicts > 0 && selectedTypes.includes(type)
    )

  return (
    <div data-testid="restore-backup-section" className="space-y-4">
      <h2 className="text-lg font-semibold">Restore from Backup</h2>
      <p className="text-sm text-muted-foreground">
        Upload a backup archive to validate and restore entities.
      </p>

      {!preview && (
        <>
          <button
            type="button"
            ref={dropZoneRef}
            data-testid="upload-zone"
            className={`border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors max-w-lg w-full appearance-none bg-transparent ${
              dragOver ? 'border-primary bg-primary/5' : 'hover:border-primary/50'
            }`}
            onClick={() => fileInputRef.current?.click()}
          >
            <Upload className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
            <span
              translate={file ? 'no' : undefined}
              className="block break-words text-sm text-muted-foreground"
            >
              {file ? file.name : 'Click or drag & drop a backup file (.zip)'}
            </span>
            <span className="block text-xs text-muted-foreground mt-1">.zip archives only</span>
          </button>
          <input
            ref={fileInputRef}
            data-testid="upload-input"
            name="backup-file"
            type="file"
            accept=".zip"
            onChange={handleFileChange}
            className="hidden"
          />
          {validateError && (
            <p data-testid="restore-validate-error" role="alert" className="text-sm text-error">
              {validateError}
            </p>
          )}
        </>
      )}

      {preview && (
        <div className="space-y-4">
          {/* Metadata */}
          <ValidationPreview
            fileName={file?.name}
            metadata={preview.metadata}
            onClear={handleClear}
          />

          {/* Entity Summary Table */}
          <EntitySummaryTable
            entitySummary={entitySummary}
            selectedTypes={selectedTypes}
            onTypeToggle={handleTypeToggle}
            openTypes={openTypes}
            onOpenToggle={handleOpenToggle}
          />

          {previewStatus === 'failed' && (
            <p data-testid="restore-validate-error" role="alert" className="text-sm text-error">
              {previewError}
            </p>
          )}

          {/* Auto-repair toggle */}
          {showAutoRepair && (
            <div className="flex items-center gap-3" data-testid="auto-repair-toggle-container">
              <Switch
                id={autoRepairId}
                data-testid="auto-repair-toggle"
                checked={autoRepair}
                onCheckedChange={handleAutoRepairChange}
              />
              <Label htmlFor={autoRepairId} className="text-sm">
                Auto-repair fixable entities
              </Label>
            </div>
          )}

          {/* Conflict Resolution - Radio Group */}
          {showConflictResolution && (
            <div data-testid="conflict-resolution" className="space-y-2">
              <Label id={conflictLabelId} className="text-sm font-medium">
                Conflict Resolution
              </Label>
              <RadioGroup
                data-testid="conflict-resolution-radio"
                aria-labelledby={conflictLabelId}
                value={conflictResolution}
                onValueChange={handleConflictResolutionChange}
                className="flex gap-6"
              >
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="skip" id="cr-skip" data-testid="cr-skip" />
                  <Label htmlFor="cr-skip" className="text-sm font-normal cursor-pointer">
                    Skip
                  </Label>
                </div>
                <div className="flex items-center gap-2">
                  <RadioGroupItem value={OVERWRITE} id="cr-overwrite" data-testid="cr-overwrite" />
                  <Label htmlFor="cr-overwrite" className="text-sm font-normal cursor-pointer">
                    Overwrite
                  </Label>
                </div>
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="rename" id="cr-rename" data-testid="cr-rename" />
                  <Label htmlFor="cr-rename" className="text-sm font-normal cursor-pointer">
                    Rename
                  </Label>
                </div>
              </RadioGroup>
            </div>
          )}

          {/* Restore Progress */}
          {restoreProgress !== null && (
            <div data-testid="restore-progress" className="max-w-md space-y-1">
              <Progress value={restoreProgress} aria-label="Restore progress" />
              <p aria-live="polite" className="text-xs text-muted-foreground">
                {restoreProgress < 100 ? 'Restoring…' : 'Complete'}
              </p>
            </div>
          )}

          {restoreError && (
            <p data-testid="restore-backup-error" role="alert" className="text-sm text-error">
              {restoreError}
            </p>
          )}

          {/* Restore Button */}
          <Button
            data-testid="restore-button"
            onClick={overwritesHere ? () => setConfirmingOverwrite(true) : startRestore}
            disabled={
              restoring ||
              previewStatus !== 'done' ||
              restorableCount === 0 ||
              selectedTypes.length === 0
            }
          >
            {restoring ? 'Restoring…' : `Restore ${pluralize(restorableCount, 'entity', 'entities')}`}
          </Button>
          <RestoreOverwriteDialog
            open={confirmingOverwrite}
            onConfirm={startRestore}
            onCancel={() => setConfirmingOverwrite(false)}
          />
        </div>
      )}

      {restoreResult && (
        <RestoreResultPanel
          result={restoreResult}
          openTypes={openResultTypes}
          onOpenToggle={handleResultToggle}
        />
      )}
    </div>
  )
}
