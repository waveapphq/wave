/**
 * PublishEditModeDialog - collect the metadata for publishing an in-Test
 * edit-mode draft as a new library version.
 *
 * Distinct from the ``PublishDialog`` because:
 *   - The source library entry is LOCKED (no picker; shown as a context chip).
 *   - The Version field is the shared ``VersionDropdown`` in ``bump`` mode.
 *   - Changelog + Details are MANDATORY.
 *   - Description / Tags / Details pre-fill from the source version's metadata.
 *
 * It does NOT publish directly. Clicking Publish hands the collected payload to
 * ``onRequestOutcome`` so the parent opens the three-option outcome dialog
 * (Cancel / Publish and keep Old / Publish and set New), which runs the
 * test-independent ``addFunctionVersion`` and applies the chosen outcome
 * in-memory. The bump target re-syncs to the lowest ALLOWED level once
 * the allowed-bumps result resolves, and Publish is disabled for a disallowed
 * target (no server-side rejection round-trip).
 */

import { useEffect, useMemo, useState } from 'react'

import { Upload } from 'lucide-react'

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { TagsInput } from '@/components/ui/tags-input'
import { cn } from '@/lib/utils'
import { joinLabels } from '@/lib/join-labels'

import { useAllowedBumps } from '@/features/functions/hooks/use-allowed-bumps'
import { useFunctionVersions } from '@/features/functions/hooks/use-function-versions'
import { VersionDropdown } from '@/features/functions/canvas/version-dropdown'
import { nextAvailableTarget, classifyBumpLevel } from '@/features/functions/lib/semver'
import type { BumpLevel } from '@/features/functions/api/types'
import { RequiredMark } from '@/components/shared/fields/required-mark'


export interface PublishEditModeInstance {
  testId: string
  nodeId: string
  functionId: string
  functionName: string
  sourceVersion: string
  draft: Record<string, unknown>
  sourceMetadata?: {
    description?: string
    tags?: string[]
    details?: string
  }
  etag?: string
}


export interface EditModeOutcomeRequest {
  targetVersion: string
  changelog: string
  description: string
  tags: string[]
  details: string
}


/** A read the parent runs for this dialog, so its failure lands on the same
 *  banner and the same Try Again. */
export interface PublishEditModeSourceRead {
  failed: boolean
  retry: () => void
}


export interface PublishEditModeDialogProps {
  isOpen: boolean
  onClose: () => void
  instance: PublishEditModeInstance
  onRequestOutcome: (payload: EditModeOutcomeRequest) => void
  sourceMetadataRead?: PublishEditModeSourceRead
}


function lowestAllowedTarget(base: string, allowed: BumpLevel[], existing: string[]): string {
  // Bump from the source's major-line latest (per-major no-backports) at the
  // lowest allowed level; nextAvailableTarget also skips already-published versions.
  for (const level of ['patch', 'minor', 'major'] as const) {
    if (allowed.includes(level)) return nextAvailableTarget(base, level, existing)
  }
  return nextAvailableTarget(base, 'patch', existing)
}


// Same default the PublishDialog uses so the two dialogs stay consistent
// when no source metadata is present.
const DEFAULT_DETAILS = 'No specific usage or parameter details'

interface FailedRead {
  label: string
  retry: () => void
}

export function PublishEditModeDialog({
  isOpen,
  onClose,
  instance,
  onRequestOutcome,
  sourceMetadataRead,
}: Readonly<PublishEditModeDialogProps>) {
  const sourceMeta = instance.sourceMetadata ?? {}
  const [description, setDescription] = useState(sourceMeta.description ?? '')
  const [tags, setTags] = useState<string[]>(sourceMeta.tags ?? [])
  const [details, setDetails] = useState(sourceMeta.details ?? DEFAULT_DETAILS)
  const [changelog, setChangelog] = useState('')
  const bumpsResult = useAllowedBumps(instance.functionId, instance.sourceVersion, instance.draft)
  // Fetch the live version list each time the dialog opens (refreshKey = isOpen)
  // so a version published in another tab is reflected before we suggest a bump.
  const {
    versions,
    latest,
    failed: versionsFailed,
    retry: retryVersions,
  } = useFunctionVersions(isOpen ? instance.functionId : '', isOpen)
  const existingVersions = useMemo(() => versions.map((v) => v.version), [versions])
  const [target, setTarget] = useState<string>(() =>
    lowestAllowedTarget(instance.sourceVersion, bumpsResult.allowed, existingVersions),
  )
  // A user hand-pick freezes the re-sync so it never yanks their choice.
  const [userPicked, setUserPicked] = useState(false)

  useEffect(() => {
    if (!isOpen) return
    setChangelog('')
    setUserPicked(false)
    setTarget(lowestAllowedTarget(instance.sourceVersion, bumpsResult.allowed, existingVersions))
    // Intentionally not depending on bumpsResult here; the re-sync effect below
    // owns tracking the allowed set so a refresh does not reset changelog.
  }, [isOpen, instance.functionId, instance.sourceVersion])

  // Re-sync the target to the lowest allowed level once bumps resolve,
  // unless the user has hand-picked a target.
  useEffect(() => {
    if (!isOpen || userPicked || bumpsResult.isLoading) return
    setTarget(lowestAllowedTarget(instance.sourceVersion, bumpsResult.allowed, existingVersions))
  }, [
    isOpen,
    userPicked,
    bumpsResult.isLoading,
    bumpsResult.allowed,
    instance.sourceVersion,
    existingVersions,
  ])

  // sourceMetadata resolves async (version-list fetch); sync pre-filled fields when it arrives.
  useEffect(() => {
    if (!isOpen) return
    const meta = instance.sourceMetadata
    setDescription(meta?.description ?? '')
    setTags(meta?.tags ?? [])
    setDetails(meta?.details ?? DEFAULT_DETAILS)
  }, [isOpen, instance.sourceMetadata])

  const handleTargetChange = (next: string) => {
    setUserPicked(true)
    setTarget(next)
  }

  // Every read this dialog is built on. A failure is never a smaller answer:
  // publishing stays shut until the read is run again and succeeds.
  const failedReads = useMemo<FailedRead[]>(() => {
    const reads: FailedRead[] = []
    if (versionsFailed) reads.push({ label: 'version list', retry: retryVersions })
    if (bumpsResult.failed) {
      reads.push({ label: 'allowed version bumps', retry: bumpsResult.retry })
    }
    if (sourceMetadataRead?.failed) {
      reads.push({ label: 'source version details', retry: sourceMetadataRead.retry })
    }
    return reads
  }, [versionsFailed, retryVersions, bumpsResult.failed, bumpsResult.retry, sourceMetadataRead])

  const changelogValid = useMemo(() => changelog.trim().length > 0, [changelog])
  const detailsValid = useMemo(() => details.trim().length > 0, [details])
  // Gate on the target classifying to a currently-allowed bump level.
  const targetAllowed = useMemo(() => {
    const level = classifyBumpLevel(instance.sourceVersion, target)
    return level !== null && bumpsResult.allowed.includes(level)
  }, [instance.sourceVersion, target, bumpsResult.allowed])
  const canSubmit = changelogValid && detailsValid && targetAllowed && failedReads.length === 0

  // Wired only to the Publish button, which is `disabled={!canSubmit}`, so the
  // body runs only when submission is allowed.
  const submit = () => {
    onRequestOutcome({
      targetVersion: target,
      changelog: changelog.trim(),
      description,
      tags,
      details,
    })
  }

  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent className="sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Upload className="h-5 w-5 text-indigo-500" aria-hidden="true" />
            Publish edit-mode draft
          </DialogTitle>
          <DialogDescription className="sr-only">
            Publish the unpublished changes on this Function instance as a new
            library version.
          </DialogDescription>
        </DialogHeader>

        <div
          data-testid="publish-edit-mode-source-chip"
          className="flex items-center gap-2 rounded-md border border-indigo-500/30 bg-indigo-500/10 px-3 py-2 text-indigo-700 dark:text-indigo-200 text-sm"
        >
          <span className="inline-flex h-6 w-6 items-center justify-center rounded font-semibold text-xs border border-indigo-500/40 bg-indigo-500/15">
            f
          </span>
          <span className="font-medium truncate">{instance.functionName}</span>
          <span className="ml-auto text-xs opacity-80">
            from edit mode · source v{instance.sourceVersion}
          </span>
        </div>

        <div className="grid gap-4 mt-3">
          {failedReads.length > 0 ? (
            <div
              data-testid="publish-edit-mode-read-error"
              role="alert"
              className="flex items-center justify-between gap-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
            >
              <span>
                Could not load {joinLabels(failedReads.map((read) => read.label))}, so this
                Function cannot be published yet.
              </span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                data-testid="publish-edit-mode-read-retry"
                onClick={() => {
                  for (const read of failedReads) read.retry()
                }}
              >
                Try Again
              </Button>
            </div>
          ) : null}

          <div className="grid gap-1">
            <span className="text-xs uppercase tracking-wide text-muted-foreground">
              Version
            </span>
            <VersionDropdown
              mode="bump"
              source={instance.sourceVersion}
              selected={target}
              allowedBumps={bumpsResult}
              existingVersions={existingVersions}
              latest={latest}
              onChange={handleTargetChange}
            />
          </div>

          <div className="grid gap-1">
            <label
              htmlFor="publish-edit-description"
              className="text-xs uppercase tracking-wide text-muted-foreground"
            >
              Description
            </label>
            <textarea
              id="publish-edit-description"
              data-testid="publish-edit-mode-description-input"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              rows={2}
              className="w-full px-2 py-1.5 text-sm rounded border border-input bg-background"
            />
          </div>

          <div className="grid gap-1">
            <span className="text-xs uppercase tracking-wide text-muted-foreground">
              Tags
            </span>
            <TagsInput
              value={tags}
              availableTags={tags}
              onChange={setTags}
              placeholder="Add tag and press Enter"
            />
          </div>

          <div className="grid gap-1">
            <label
              htmlFor="publish-edit-details"
              className="text-xs uppercase tracking-wide text-muted-foreground"
            >
              Details <RequiredMark />
            </label>
            <textarea
              id="publish-edit-details"
              data-testid="publish-edit-mode-details-input"
              value={details}
              onChange={(event) => setDetails(event.target.value)}
              rows={3}
              required
              aria-invalid={!detailsValid || undefined}
              className={cn(
                'w-full px-2 py-1.5 text-sm rounded border border-input bg-background',
                !detailsValid && 'border-destructive',
              )}
            />
          </div>

          <div className="grid gap-1">
            <label
              data-testid="publish-edit-mode-changelog-label"
              htmlFor="publish-edit-changelog"
              className="text-xs uppercase tracking-wide text-muted-foreground"
            >
              Changelog <RequiredMark />
            </label>
            <textarea
              id="publish-edit-changelog"
              data-testid="publish-edit-mode-changelog-input"
              value={changelog}
              onChange={(event) => setChangelog(event.target.value)}
              rows={3}
              required
              className="w-full px-2 py-1.5 text-sm rounded border border-input bg-background"
            />
          </div>
        </div>

        <DialogFooter className="flex flex-row justify-end gap-2 mt-3">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={submit}
            disabled={!canSubmit}
            aria-disabled={!canSubmit}
            className={cn(
              !canSubmit && 'opacity-50 cursor-not-allowed',
            )}
          >
            Publish
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
