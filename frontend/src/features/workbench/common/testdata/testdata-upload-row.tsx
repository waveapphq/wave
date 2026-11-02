/**
 * The row one file owns while it is arriving, and after it did not (TDATA-14,
 * TDATA-17). It sits in the tree under the folder the file is going
 * to, so where it lands is never in doubt.
 *
 * A short upload shows a spinner only; from three seconds the row carries the
 * progress and the time left the server worked out, plus Cancel. A file that
 * did not land keeps its row with the reason and the way back - the same bytes,
 * or a file the person picks - until it is dismissed. A file somebody stopped
 * leaves an amber row that goes when the sheet closes.
 */

import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import { Loader2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { rowIndentPadding } from '@/components/shared/file-row'
import { formatDuration } from '@/lib/format-duration'
import type { TestDataUpload } from './use-testdata'

const DETAIL_AFTER_MS = 3_000
const TICK_MS = 500
const ROW_CLASS = 'flex items-center gap-2 border-b border-subtle py-1.5 pr-4 text-xs'
const NAME_CLASS = 'min-w-0 flex-1 truncate font-mono text-[13px]'
const CANCELED_NOTE = 'Canceled'
const ESTIMATING = 'Estimating…'

/** Wall clock, refreshed while an upload runs so each row ages on its own. */
export function useNow(running: boolean): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!running) return
    const timer = setInterval(() => setNow(Date.now()), TICK_MS)
    return () => clearInterval(timer)
  }, [running])
  return now
}

function percentOf(upload: TestDataUpload): number {
  if (upload.total === 0) return 0
  return Math.floor((upload.loaded / upload.total) * 100)
}

function etaLabel(eta: number | null): string {
  return eta === null ? ESTIMATING : `${formatDuration(eta)} left`
}

function DismissButton({ upload }: Readonly<{ upload: TestDataUpload }>) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className="h-6 w-6 shrink-0"
      aria-label={`Dismiss ${upload.name}`}
      onClick={upload.dismiss}
    >
      <X className="h-3.5 w-3.5" />
    </Button>
  )
}

/** Picks the bytes this tab no longer holds, under the name the row expects. */
function ChooseFileButton({ upload }: Readonly<{ upload: TestDataUpload }>) {
  const inputRef = useRef<HTMLInputElement>(null)
  const chooseFile = upload.chooseFile as (file: File) => void
  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget
    const picked = input.files?.[0]
    input.value = ''
    if (picked) chooseFile(picked)
  }

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        hidden
        data-testid={`testdata-choose-input-${upload.name}`}
        onChange={handleChange}
      />
      <Button
        type="button"
        variant="ghost"
        size="sm"
        aria-label={`Choose file for ${upload.name}`}
        onClick={() => (inputRef.current as HTMLInputElement).click()}
      >
        Choose file
      </Button>
    </>
  )
}

function UploadFailure({ upload }: Readonly<{ upload: TestDataUpload }>) {
  return (
    <>
      <span className="text-error">{upload.failure}</span>
      {upload.retry !== null && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-label={`Retry ${upload.name}`}
          onClick={upload.retry}
        >
          Retry
        </Button>
      )}
      {upload.chooseFile !== null && <ChooseFileButton upload={upload} />}
      <DismissButton upload={upload} />
    </>
  )
}

function UploadCanceled({ upload }: Readonly<{ upload: TestDataUpload }>) {
  return (
    <>
      <span className="text-warning">{CANCELED_NOTE}</span>
      <DismissButton upload={upload} />
    </>
  )
}

function UploadProgress({ upload }: Readonly<{ upload: TestDataUpload }>) {
  const percent = percentOf(upload)
  return (
    <>
      <Progress
        value={percent}
        max={100}
        aria-label={`Upload progress of ${upload.name}`}
        className="h-1.5 w-24 shrink-0"
      />
      <span data-testid="testdata-upload-percent" className="shrink-0 tabular-nums text-muted">
        {percent}%
      </span>
      <span data-testid="testdata-upload-eta" className="shrink-0 text-muted">
        {etaLabel(upload.eta)}
      </span>
      {upload.cancel !== null && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-label={`Cancel upload of ${upload.name}`}
          onClick={upload.cancel}
        >
          Cancel
        </Button>
      )}
    </>
  )
}

function rowDetail(upload: TestDataUpload, now: number) {
  if (upload.status === 'canceled') return <UploadCanceled upload={upload} />
  if (upload.status === 'interrupted') return <UploadFailure upload={upload} />
  if (now - upload.startedAt >= DETAIL_AFTER_MS) return <UploadProgress upload={upload} />
  return (
    <Loader2
      className="h-4 w-4 shrink-0 animate-spin text-muted"
      aria-label={`Uploading ${upload.name}`}
    />
  )
}

export interface TestDataUploadRowProps {
  upload: TestDataUpload
  /** Tree depth, so the row lines up with the entries in the same folder. */
  indent: number
  now: number
}

export function TestDataUploadRow({ upload, indent, now }: Readonly<TestDataUploadRowProps>) {
  return (
    <div
      data-testid={`testdata-upload-${upload.name}`}
      data-upload-row={upload.name}
      data-upload-status={upload.status}
      data-upload-folder={upload.folder}
      className={ROW_CLASS}
      style={{ paddingLeft: rowIndentPadding(indent) }}
    >
      <span className={NAME_CLASS}>{upload.name}</span>
      {rowDetail(upload, now)}
    </div>
  )
}
