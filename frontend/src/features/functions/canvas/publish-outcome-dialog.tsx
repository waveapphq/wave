/**
 * PublishOutcomeDialog - the three-option publish confirmation (CANVAS-219..222).
 *
 * Offered when publishing an edit-mode draft. AlertDialog semantics: ESC and
 * backdrop do NOT dismiss (an explicit choice is required). Identical in draft
 * and saved-Test modes; carries no save-status line (the Test is never saved by
 * publish). The prominent transition line carries the v-prefixed versions; the
 * body + note reference them in prose so the heading stays the single emphatic
 * version reference.
 */

import { useState } from 'react'

import { Upload } from 'lucide-react'

import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'

export interface PublishOutcomeDialogProps {
  isOpen: boolean
  onClose: () => void
  functionName: string
  sourceVersion: string
  targetVersion: string
  pending: boolean
  error: string | null
  onSetNew: () => void
  onKeepOld: () => void
  /** 'single' (library View): just Cancel + Publish, no instance to re-pin. */
  mode?: 'three-option' | 'single'
  onConfirmSingle?: () => void
}

export function PublishOutcomeDialog({
  isOpen,
  onClose,
  functionName,
  sourceVersion,
  targetVersion,
  pending,
  error,
  onSetNew,
  onKeepOld,
  mode = 'three-option',
  onConfirmSingle,
}: Readonly<PublishOutcomeDialogProps>) {
  const [chosen, setChosen] = useState<'new' | 'old' | null>(null)
  const isSingle = mode === 'single'

  const handleSetNew = () => {
    setChosen('new')
    onSetNew()
  }
  const handleKeepOld = () => {
    setChosen('old')
    onKeepOld()
  }

  return (
    <AlertDialog open={isOpen} onOpenChange={() => {}}>
      <AlertDialogContent
        className="sm:max-w-[600px]"
        onEscapeKeyDown={(event) => event.preventDefault()}
      >
        <div className="flex items-start gap-3">
          <span
            aria-hidden="true"
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-indigo-500/15 text-indigo-500"
          >
            <Upload className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <AlertDialogTitle>Publish a new version?</AlertDialogTitle>
            <p className="mt-1 font-mono text-sm">
              <span className="font-medium">{functionName}</span>
              <span className="text-muted-foreground"> · </span>
              <span className="text-muted-foreground">v{sourceVersion}</span>
              <span className="text-muted-foreground"> {'->'} </span>
              <span className="font-semibold text-primary">v{targetVersion}</span>
            </p>
          </div>
        </div>

        <AlertDialogDescription className="text-sm text-foreground">
          {isSingle ? (
            <>
              This permanently records version {targetVersion} in the library. It can't be
              undone and doesn't affect other Tests. The view switches to the new version.
            </>
          ) : (
            <>
              This permanently records version {targetVersion} in the library. It can't be
              undone and doesn't affect other Tests. Choose what happens to this instance:
            </>
          )}
        </AlertDialogDescription>

        {isSingle ? null : (
          <div className="rounded-md border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
            <strong className="font-semibold text-foreground">Set New</strong> moves this
            instance to version {targetVersion}.{' '}
            <strong className="font-semibold text-foreground">Keep Old</strong> switches back
            to version {sourceVersion}. Either option publishes version {targetVersion} and
            exits edit mode.
          </div>
        )}

        {error ? (
          <div
            data-testid="publish-outcome-error"
            role="alert"
            className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          >
            {error}
          </div>
        ) : null}

        <div className="flex flex-row justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={pending} className="whitespace-nowrap">
            Cancel
          </Button>
          {isSingle ? (
            <Button
              onClick={onConfirmSingle}
              disabled={pending}
              loading={pending}
              autoFocus
              data-testid="publish-outcome-single-confirm"
              className="whitespace-nowrap"
            >
              Publish
            </Button>
          ) : (
            <>
              <Button
                variant="secondary"
                onClick={handleKeepOld}
                disabled={pending}
                loading={pending && chosen === 'old'}
                className="whitespace-nowrap"
              >
                Publish and keep Old
              </Button>
              <Button
                onClick={handleSetNew}
                disabled={pending}
                loading={pending && chosen === 'new'}
                autoFocus
                className="whitespace-nowrap"
              >
                Publish and set New
              </Button>
            </>
          )}
        </div>
      </AlertDialogContent>
    </AlertDialog>
  )
}
