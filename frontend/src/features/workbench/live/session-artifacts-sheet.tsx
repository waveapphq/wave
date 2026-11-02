/**
 * Floating workbench sheet listing the live session's artifact files.
 *
 * Rendered on the shared DraggableSheet primitive (non-blocking, drag via the
 * header, ESC closes the front-most sheet). Rows reuse the shared
 * FileRow; per-row delete is hidden for tracked sessions because
 * their artifacts are managed in the Artifacts page. A failed poll tick is
 * announced under the header, beside the last known list.
 */

import { useState } from 'react'
import { Archive, RefreshCw, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog'
import { DraggableSheet } from '@/components/shared/draggable-sheet'
import { FileRow } from '@/components/shared/file-row'
import { buildArtifactReference } from '@/lib/file-references'
import { formatBytes } from '@/lib/format-bytes'
import type { WorkbenchSessionArtifact } from '@/features/workbench/api/workbench'

export interface SessionArtifactsSheetProps {
  open: boolean
  onClose: () => void
  items: WorkbenchSessionArtifact[]
  count: number
  totalBytes: number
  /** A failed poll tick's reason, shown beside the last good list. */
  pollError: string | null
  /** Tracked sessions hide per-row delete (artifacts live in the permanent store). */
  isTracked: boolean
  running: boolean
  onRefresh: () => void
  onDownload: (path: string) => void
  onDelete: (path: string) => void
}

function splitPath(path: string): { name: string; folder?: string } {
  const separatorIndex = path.lastIndexOf('/')
  if (separatorIndex === -1) {
    return { name: path }
  }
  return { name: path.slice(separatorIndex + 1), folder: path.slice(0, separatorIndex) }
}

export function SessionArtifactsSheet(props: Readonly<SessionArtifactsSheetProps>) {
  const {
    open,
    onClose,
    items,
    count,
    totalBytes,
    pollError,
    isTracked,
    onRefresh,
    onDownload,
    onDelete,
  } = props
  const isEmpty = items.length === 0
  const [pendingDelete, setPendingDelete] = useState<string | null>(null)
  const closeSheet = () => {
    setPendingDelete(null)
    onClose()
  }

  return (
    <>
    <DraggableSheet
      open={open}
      onClose={closeSheet}
      sheetId="session-artifacts"
      ariaLabel="Session Artifacts"
      data-testid="session-artifacts-sheet"
      initialWidth={460}
      minWidth={420}
      header={
        <>
          <div className="flex min-w-0 items-center gap-2">
            <Archive className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <h2 className="text-[13px] font-semibold">Session Artifacts</h2>
            {!isEmpty && (
              <span className="truncate text-xs text-muted-foreground">
                {count} files - {formatBytes(totalBytes)}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Refresh artifacts"
              onClick={(event) => {
                // The header is the drag handle; keep button clicks out of it.
                event.stopPropagation()
                onRefresh()
              }}
              onPointerDown={(event) => event.stopPropagation()}
              className="h-7 w-7"
            >
              <RefreshCw className="h-4 w-4" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Close"
              onClick={closeSheet}
              onPointerDown={(event) => event.stopPropagation()}
              className="h-7 w-7"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </>
      }
    >
      {pollError && (
        <p
          data-testid="session-artifacts-refresh-error"
          role="alert"
          className="shrink-0 border-b px-4 py-2 text-xs text-error"
        >
          {pollError} (showing the last known state)
        </p>
      )}
      {isEmpty ? (
        <div className="px-6 py-10 text-center">
          <p className="text-[13px] font-medium">No artifacts in this session yet</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Files written by plugins during a run appear here.
          </p>
        </div>
      ) : (
        <>
          <div className="max-h-[50vh] flex-1 overflow-y-auto overscroll-contain">
            {items.map((item) => {
              const { name, folder } = splitPath(item.path)
              return (
                <FileRow
                  key={item.path}
                  name={name}
                  sizeBytes={item.size_bytes}
                  subtitle={folder}
                  subtitleMono
                  copyPath={buildArtifactReference(item.path)}
                  onDownload={() => onDownload(item.path)}
                  onDelete={isTracked ? undefined : () => setPendingDelete(item.path)}
                />
              )
            })}
          </div>
          <div className="rounded-b-lg border-t bg-subtle px-4 py-2 text-[11px] text-muted-foreground">
            Session artifacts are temporary - they are deleted when the session is reset,
            replaced, or closed.
          </div>
        </>
      )}
    </DraggableSheet>
    {pendingDelete === null ? null : (
      <ConfirmationDialog
        isOpen
        variant="delete"
        itemName={splitPath(pendingDelete).name}
        description="The file is removed from this session's artifacts, with no removal record and no way back."
        onConfirm={() => {
          onDelete(pendingDelete)
          setPendingDelete(null)
        }}
        onClose={() => setPendingDelete(null)}
      />
    )}
    </>
  )
}
