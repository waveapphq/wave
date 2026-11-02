/**
 * Floating workbench sheet holding the session test's own files. Mirrors
 * the Session Artifacts sheet: DraggableSheet shell,
 * ESC closes, the listing loads through the blocking-read model. The header
 * lends the browser a slot for its Upload and New folder buttons.
 */

import { useState } from 'react'
import { Folder, RefreshCw, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { DraggableSheet } from '@/components/shared/draggable-sheet'
import { TestDataBrowser } from '@/features/workbench/common/testdata/testdata-browser'
import { useTestData } from '@/features/workbench/common/testdata/use-testdata'

export interface TestDataSheetProps {
  open: boolean
  onClose: () => void
  /** The session's saved test; null for a test that was never saved. */
  testId: string | null
  /** A session that does not hold the test reads its files but never changes them. */
  readOnly?: boolean
}

const FOOTER_NOTE =
  'Reference a file as testdata://folder/name. Blocks read test data; they never change it.'
const SKELETON_ROWS = ['a', 'b', 'c']

function LoadingRows() {
  return (
    <div className="space-y-3 px-4 py-4" aria-busy="true">
      {SKELETON_ROWS.map((row) => (
        <Skeleton key={row} className="h-8 w-full" />
      ))}
    </div>
  )
}

interface OpenSheetProps {
  onClose: () => void
  testId: string | null
  readOnly: boolean
}

function OpenTestDataSheet({ onClose, testId, readOnly }: Readonly<OpenSheetProps>) {
  const { listing, loading, error, blockedReason, uploads, refresh, upload, createFolder, rename, remove } =
    useTestData(testId, !readOnly)
  const [toolbarSlot, setToolbarSlot] = useState<HTMLElement | null>(null)
  const populated = listing.entries.length > 0

  let body
  if (loading) {
    body = <LoadingRows />
  } else if (error) {
    body = (
      <p data-testid="testdata-load-error" role="alert" className="px-4 py-3 text-xs text-error">
        {error.message}
      </p>
    )
  } else {
    body = (
      <TestDataBrowser
        testId={testId}
        listing={listing}
        mode="manage"
        readOnly={readOnly}
        blockedReason={blockedReason}
        uploads={uploads}
        toolbarSlot={toolbarSlot}
        onUpload={upload}
        onCreateFolder={createFolder}
        onRename={rename}
        onDelete={remove}
      />
    )
  }

  return (
    <DraggableSheet
      open
      onClose={onClose}
      sheetId="testdata"
      ariaLabel="Test Data"
      data-testid="testdata-sheet"
      initialWidth={480}
      minWidth={460}
      header={
        <>
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <Folder className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <h2 className="text-[13px] font-semibold">Test Data</h2>
            <div ref={setToolbarSlot} className="ml-auto flex items-center gap-1" />
          </div>
          <div className="flex items-center gap-1">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Refresh"
              onClick={(event) => {
                // The header is the drag handle; keep button clicks out of it.
                event.stopPropagation()
                refresh()
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
              onClick={onClose}
              onPointerDown={(event) => event.stopPropagation()}
              className="h-7 w-7"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </>
      }
    >
      {body}
      {populated && (
        <div className="rounded-b-lg border-t bg-subtle px-4 py-2 text-[11px] text-muted-foreground">
          {FOOTER_NOTE}
        </div>
      )}
    </DraggableSheet>
  )
}

export function TestDataSheet({
  open,
  onClose,
  testId,
  readOnly = false,
}: Readonly<TestDataSheetProps>) {
  return open ? (
    <OpenTestDataSheet onClose={onClose} testId={testId} readOnly={readOnly} />
  ) : null
}
