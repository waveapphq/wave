/** Drilled-into-Shared chrome with two variants: read-only (Edit Function) and edit-mode (Drop changes). */

import { Pencil, Upload, XCircle } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { ReadOnlyPill } from './read-only-pill'

interface ActionBarReadonlyChromeProps {
  editMode?: boolean
  onEditFunction?: () => void
  onDropChanges?: () => void
  onPublish?: () => void
}

function Splitter() {
  return (
    <span
      data-testid="action-bar-readonly-splitter"
      aria-hidden="true"
      className="inline-block w-px h-[26px] bg-border mx-1"
    />
  )
}

export function ActionBarReadonlyChrome({
  editMode = false,
  onEditFunction,
  onDropChanges,
  onPublish,
}: Readonly<ActionBarReadonlyChromeProps>) {
  if (editMode) {
    return (
      <div className="flex items-center">
        <Splitter />
        <span
          aria-label="Edit-mode inspect"
          className={cn(
            'inline-flex items-center gap-1.5 rounded-full px-2 py-0.5',
            'text-[10px] font-semibold uppercase tracking-wider',
            'bg-amber-500/15 text-amber-700 dark:text-amber-300',
          )}
        >
          <Pencil className="h-3 w-3" aria-hidden="true" />
          Edit mode
        </span>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            onDropChanges?.()
          }}
          aria-label="Drop changes"
          data-testid="action-bar-drop-changes-button"
          className="ml-2 h-8 gap-1.5 px-2 border-amber-500/40 text-amber-700 hover:bg-amber-500/10 dark:text-amber-300"
        >
          <XCircle className="h-4 w-4" aria-hidden="true" />
          <span className="text-sm">Drop changes</span>
        </Button>
        <Button
          type="button"
          size="sm"
          onClick={() => {
            onPublish?.()
          }}
          aria-label="Publish"
          data-testid="action-bar-publish-button"
          className="ml-2 h-8 gap-1.5 px-2"
        >
          <Upload className="h-4 w-4" aria-hidden="true" />
          <span className="text-sm">Publish</span>
        </Button>
        <Splitter />
      </div>
    )
  }
  return (
    <div className="flex items-center">
      <Splitter />
      <ReadOnlyPill ariaLabel="Read-only inspect mode" />
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => {
          onEditFunction?.()
        }}
        aria-label="Edit Function"
        data-testid="action-bar-edit-function-button"
        className="ml-2 h-8 gap-1.5 px-2"
      >
        <Pencil className="h-4 w-4" aria-hidden="true" />
        <span className="text-sm">Edit Function</span>
      </Button>
      <Splitter />
    </div>
  )
}
