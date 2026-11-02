/**
 * Shared file drop zone: a dashed button that opens the file picker and takes
 * a dropped file, in the default column layout or a compact one-row layout.
 */

import { useRef, type ChangeEvent } from 'react'
import { Upload } from 'lucide-react'
import { Icon } from '@/components/ui/icon'
import { useFileDrop } from '@/hooks/use-file-drop'
import { cn } from '@/lib/utils'

export type FileDropZoneLayout = 'default' | 'compact'

export interface FileDropZoneProps {
  /** The file input's accept list, for example ".pem,.crt,.cer". */
  accept: string
  /** The accepted types as the zone shows them, for example ".pem, .crt, or .cer". */
  acceptLabel: string
  onFile: (file: File) => void
  enabled?: boolean
  layout?: FileDropZoneLayout
  /** Shown in place of the prompt once a file is chosen. */
  selectedName?: string
  'data-testid'?: string
}

const PROMPT = 'Click or drop file here'

export function FileDropZone({
  accept,
  acceptLabel,
  onFile,
  enabled = true,
  layout = 'default',
  selectedName,
  'data-testid': testId,
}: Readonly<FileDropZoneProps>) {
  const inputRef = useRef<HTMLInputElement>(null)
  const { isDragging, dropZoneRef } = useFileDrop<HTMLButtonElement>({ onFile, enabled })
  const compact = layout === 'compact'

  const handleFileSelect = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) onFile(file)
  }

  return (
    <>
      <button
        type="button"
        ref={dropZoneRef}
        data-testid={testId}
        data-layout={layout}
        disabled={!enabled}
        onClick={() => inputRef.current?.click()}
        className={cn(
          'flex w-full cursor-pointer items-center justify-center rounded-lg border-2 border-dashed transition-colors disabled:cursor-not-allowed disabled:opacity-50',
          compact ? 'h-12 gap-2 p-3' : 'flex-col p-8',
          isDragging ? 'border-primary bg-primary/5' : 'enabled:hover:border-primary',
        )}
      >
        <Icon icon={Upload} size={compact ? 'sm' : 'xl'} className={cn('text-muted', !compact && 'mb-2')} />
        <p className="text-sm text-muted">{selectedName ?? PROMPT}</p>
        <p className={cn('text-xs text-muted', !compact && 'mt-1')}>{acceptLabel}</p>
      </button>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        disabled={!enabled}
        onChange={handleFileSelect}
        className="hidden"
        data-testid="file-input"
      />
    </>
  )
}
