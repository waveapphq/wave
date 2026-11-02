/**
 * CreateBackupSection Component
 *
 * Settings section for creating and downloading backup archives.
 */

import { useId, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Slider } from '@/components/ui/slider'
import { Progress } from '@/components/ui/progress'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Download } from 'lucide-react'
import { EntitySelector } from '../entity-selector'
import { SecretsModePicker } from '@/components/shared/secrets-mode-picker'
import * as backupApi from '@/features/settings/api/backup'
import { errorMessage } from './utils'
import { downloadBlob } from '@/lib/download-blob'
import type { ExportSecretsMode } from '@/types/import-export'
import {
  BACKUP_SECRETS_DESCRIPTIONS,
  BACKUP_SECRETS_WARNING,
} from './backup-secrets-copy'

export function CreateBackupSection() {
  const fieldId = useId()
  const formatId = `${fieldId}-format`
  const compressionId = `${fieldId}-compression`
  const [selectedEntities, setSelectedEntities] = useState<string[]>([])
  const [format, setFormat] = useState('yaml')
  const [compressionMethod, setCompressionMethod] = useState('deflate')
  const [compressionLevel, setCompressionLevel] = useState(6)
  const [secrets, setSecrets] = useState<ExportSecretsMode>('mask')
  const [creating, setCreating] = useState(false)
  const [progress, setProgress] = useState<number | null>(null)
  const [error, setError] = useState<string | undefined>()

  const levelDisabled = compressionMethod === 'stored' || compressionMethod === 'lzma'

  const reportFailure = (err: unknown): void => {
    setProgress(null)
    setError(errorMessage(err, 'Failed to create the backup'))
  }

  const handleCreate = async () => {
    if (selectedEntities.length === 0) return
    setCreating(true)
    setProgress(0)
    setError(undefined)

    // Simulate progress per entity type
    const step = 100 / selectedEntities.length
    let current = 0
    const interval = setInterval(() => {
      current += step
      if (current >= 95) {
        clearInterval(interval)
        setProgress(95)
      } else {
        setProgress(Math.round(current))
      }
    }, 200)

    try {
      const blob = await backupApi.createBackup({
        entity_types: selectedEntities,
        format,
        compression_method: compressionMethod,
        compression_level: compressionLevel,
        secrets,
      })
      clearInterval(interval)
      setProgress(100)
      downloadBlob(blob, `wave-backup-${new Date().toISOString().slice(0, 10)}.zip`)
    } catch (err) {
      clearInterval(interval)
      reportFailure(err)
    } finally {
      setTimeout(() => {
        setCreating(false)
        setProgress(null)
      }, 500)
    }
  }

  return (
    <div data-testid="create-backup-section" className="space-y-4">
      <h2 className="text-lg font-semibold">Create Backup</h2>
      <p className="text-sm text-muted-foreground">
        Select entity types to include in the backup archive.
      </p>

      <EntitySelector selected={selectedEntities} onChange={setSelectedEntities} />

      <div className="flex items-start gap-4 max-w-md">
        <div className="flex-1">
          <Label htmlFor={formatId} className="text-sm font-medium mb-1.5 block">
            Format
          </Label>
          <Select value={format} onValueChange={setFormat}>
            <SelectTrigger id={formatId} data-testid="format-select">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="yaml">YAML</SelectItem>
              <SelectItem value="json">JSON</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="flex-1">
          <Label htmlFor={compressionId} className="text-sm font-medium mb-1.5 block">
            Compression
          </Label>
          <Select value={compressionMethod} onValueChange={setCompressionMethod}>
            <SelectTrigger id={compressionId} data-testid="compression-method-select">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="stored">None (Stored)</SelectItem>
              <SelectItem value="deflate">Deflate</SelectItem>
              <SelectItem value="bzip2">Bzip2</SelectItem>
              <SelectItem value="lzma">LZMA</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="max-w-xs">
        <Label className="text-sm font-medium mb-1.5 block">
          Compression Level: {compressionLevel}
        </Label>
        <Slider
          data-testid="compression-level-slider"
          value={[compressionLevel]}
          onValueChange={([v]) => setCompressionLevel(v)}
          min={1}
          max={9}
          step={1}
          disabled={levelDisabled}
        />
      </div>

      <div className="max-w-lg">
        <SecretsModePicker
          value={secrets}
          onChange={setSecrets}
          warningText={BACKUP_SECRETS_WARNING}
          descriptions={BACKUP_SECRETS_DESCRIPTIONS}
        />
      </div>

      {progress !== null && (
        <div data-testid="create-progress" className="max-w-md space-y-1">
          <Progress value={progress} aria-label="Backup progress" />
          <p aria-live="polite" className="text-xs text-muted-foreground">
            {progress < 100 ? 'Creating backup…' : 'Complete'}
          </p>
        </div>
      )}

      {error && (
        <p data-testid="create-backup-error" role="alert" className="text-sm text-error">
          {error}
        </p>
      )}

      <Button
        onClick={() => { handleCreate().catch(reportFailure) }}
        disabled={creating || selectedEntities.length === 0}
      >
        <Download className="h-4 w-4 mr-2" />
        {creating ? 'Creating…' : 'Create & Download'}
      </Button>
    </div>
  )
}
