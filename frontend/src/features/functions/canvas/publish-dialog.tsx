/**
 * PublishDialog - promote a local Function on the canvas to a library entry.
 *
 * Fields:
 *   - Name (free-form, 32-cap; uses the shared NameField counter contract:
 *     hidden < 80%, muted 80-99%, destructive at 100%)
 *   - Version (editable, semver-validated, default 1.0.0)
 *   - Description (full-width)
 *   - Tags (chip input via the shared TagsInput)
 *   - Changelog (required; pre-filled with "Initial release - YYYY-MM-DD")
 *   - Details (required; pre-filled with "No specific usage or parameter
 *     details" so the user can publish without typing anything but must
 *     re-fill if they clear it)
 *   - Footer: left-aligned note + Cancel + Publish
 *
 * On submit it calls the publishLocalFunction API; on failure the dialog stays
 * open and surfaces the inline error.
 */

import { useEffect, useMemo, useState } from 'react'
import type { ChangeEvent } from 'react'

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
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { TagsInput } from '@/components/ui/tags-input'
import { NameField } from '@/components/shared/fields/name-field'
import { TextField } from '@/components/shared/fields/text-field'
import { cn } from '@/lib/utils'

import { listFunctionTags } from '@/features/functions/api/functions-api'
import { isValidSemver } from '@/features/functions/lib/semver'
import { MAX_VERSION_LENGTH } from '@/lib/field-constraints'
import type { PublishFunctionPayload } from '@/features/functions/api/types'
import { RequiredMark } from '@/components/shared/fields/required-mark'

const NAME_MAX = 32
const FOOTER_NOTE = 'A new library Function will be created.'
const DEFAULT_VERSION = '1.0.0'
const DEFAULT_DETAILS = 'No specific usage or parameter details'
const PUBLISH_VERSION_ERROR_ID = 'publish-version-error'

function buildInitialChangelog(): string {
  // YYYY-MM-DD so changelog history sorts chronologically when the user
  // scans the published-versions list later.
  const today = new Date().toISOString().slice(0, 10)
  return `Initial release - ${today}`
}

const textareaClass = cn(
  'flex min-h-[64px] w-full rounded-md border border-input bg-background',
  'px-3 py-2 text-sm text-foreground ring-offset-background',
  'placeholder:text-muted-foreground focus-visible:outline-none',
  'focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
  'disabled:cursor-not-allowed disabled:opacity-50',
)

export interface PublishDialogLocalFunction {
  /** Empty string when the canvas is a draft (Test not saved yet). */
  testId: string
  nodeId: string
  suggestedName?: string
  etag?: string
}

interface PublishDialogProps {
  isOpen: boolean
  onClose: () => void
  onPublished: (functionId: string) => void
  localFunction: PublishDialogLocalFunction
  /**
   * The actual publish call. Pulled into the parent so the same dialog can
   * drive either the saved-Test path (POST /tests/{id}/functions/publish) or
   * the draft path (POST /functions with the inline local body) without
   * embedding either backend in the dialog itself.
   */
  onSubmit: (payload: PublishFunctionPayload) => Promise<{ function_id: string }>
}

export function PublishDialog({
  isOpen,
  onClose,
  onPublished,
  localFunction,
  onSubmit,
}: Readonly<PublishDialogProps>) {
  const [name, setName] = useState(localFunction.suggestedName ?? '')
  const [version, setVersion] = useState(DEFAULT_VERSION)
  const [description, setDescription] = useState('')
  const [tags, setTags] = useState<string[]>([])
  const [availableTags, setAvailableTags] = useState<string[]>([])
  const [tagsFailed, setTagsFailed] = useState(false)
  const [tagsAttempt, setTagsAttempt] = useState(0)
  const [changelog, setChangelog] = useState(buildInitialChangelog)
  const [details, setDetails] = useState(DEFAULT_DETAILS)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  useEffect(() => {
    if (!isOpen) return
    setName(localFunction.suggestedName ?? '')
    setVersion(DEFAULT_VERSION)
    setDescription('')
    setTags([])
    // Re-derive the changelog default on every open so the date stamp tracks
    // wall-clock time (a dialog kept mounted across midnight still gets the
    // current day when re-opened).
    setChangelog(buildInitialChangelog())
    setDetails(DEFAULT_DETAILS)
    setError(null)
    setPending(false)
    setTagsFailed(false)
  }, [isOpen, localFunction.suggestedName])

  useEffect(() => {
    if (!isOpen) return
    let canceled = false
    listFunctionTags()
      .then((tags) => {
        if (canceled) return
        setAvailableTags(tags)
        setTagsFailed(false)
      })
      .catch(() => {
        if (canceled) return
        setTagsFailed(true)
      })
    return () => {
      canceled = true
    }
  }, [isOpen, tagsAttempt])

  const versionValid = useMemo(() => isValidSemver(version), [version])
  const nameValid = name.trim().length > 0 && name.length <= NAME_MAX
  const changelogValid = changelog.trim().length > 0
  const detailsValid = details.trim().length > 0
  const canSubmit =
    nameValid && versionValid && changelogValid && detailsValid && !pending && !tagsFailed

  /** A publish that failed is named on the dialog's own error line. */
  const reportFailure = (err: unknown): void => {
    setError((err as { message?: string })?.message ?? 'Publish failed')
    setPending(false)
  }

  const handleSubmit = async () => {
    // The Publish button is disabled when canSubmit is false, so we don't
    // re-gate here - the disabled state is the source of truth.
    setPending(true)
    setError(null)
    try {
      const result = await onSubmit({
        name: name.trim(),
        description,
        tags,
        changelog,
        details,
        version,
      })
      onPublished(result.function_id)
      onClose()
    } catch (err) {
      reportFailure(err)
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent className="sm:max-w-[640px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Upload className="h-5 w-5 text-indigo-500" aria-hidden="true" />
            Publish Function
          </DialogTitle>
          <DialogDescription className="sr-only">
            Promote this local Function to a reusable library entry.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid grid-cols-[1fr_220px] gap-3 items-start">
            <div className="space-y-2">
              <label htmlFor="publish-name" className="text-sm font-medium">
                Name <RequiredMark />
              </label>
              <NameField
                id="publish-name"
                data-testid="publish-name-input"
                value={name}
                onChange={setName}
                maxLength={NAME_MAX}
                placeholder="Function name"
                autoFocus
              />
            </div>
            <div className="space-y-2">
              <label htmlFor="publish-version" className="text-sm font-medium">
                Version
              </label>
              <TextField
                id="publish-version"
                data-testid="publish-version-input"
                aria-label="Version"
                value={version}
                onChange={setVersion}
                maxLength={MAX_VERSION_LENGTH}
                showCount
                aria-invalid={!versionValid || undefined}
                aria-describedby={versionValid ? undefined : PUBLISH_VERSION_ERROR_ID}
                className={cn(
                  'font-mono',
                  !versionValid && 'border-destructive',
                )}
                placeholder="1.0.0"
              />
              {!versionValid && (
                <p id={PUBLISH_VERSION_ERROR_ID} className="text-xs text-destructive">
                  Use{' '}
                  <Popover>
                    <PopoverTrigger asChild>
                      <button
                        type="button"
                        className="underline underline-offset-2 hover:text-destructive/80"
                      >
                        semver v2
                      </button>
                    </PopoverTrigger>
                    <PopoverContent
                      side="bottom"
                      align="start"
                      className="w-[280px] text-xs"
                    >
                      <p className="font-medium text-foreground mb-2">
                        Semver v2 examples
                      </p>
                      <ul className="space-y-1 font-mono text-muted-foreground">
                        <li>1.0.0</li>
                        <li>2.5.1</li>
                        <li>1.0.0-alpha</li>
                        <li>1.0.0-alpha.1</li>
                        <li>1.0.0-0.3.7</li>
                        <li>1.0.0-x.7.z.92</li>
                        <li>1.0.0+20130313144700</li>
                        <li>1.0.0-beta+exp.sha.5114f85</li>
                      </ul>
                      <a
                        href="https://semver.org/"
                        target="_blank"
                        rel="noreferrer"
                        className="mt-2 inline-block text-primary hover:underline"
                      >
                        semver.org →
                      </a>
                    </PopoverContent>
                  </Popover>
                  .
                </p>
              )}
            </div>
          </div>
          <div className="space-y-2">
            <label htmlFor="publish-description" className="text-sm font-medium">
              Description
            </label>
            <textarea
              id="publish-description"
              value={description}
              onChange={(e: ChangeEvent<HTMLTextAreaElement>) =>
                setDescription(e.target.value)
              }
              placeholder="Short description shown in the library."
              rows={2}
              className={textareaClass}
            />
          </div>
          <div className="space-y-2">
            <label htmlFor="publish-tags" className="text-sm font-medium">
              Tags
            </label>
            <TagsInput
              triggerId="publish-tags"
              value={tags}
              availableTags={availableTags}
              onChange={setTags}
              placeholder="Add tag…"
            />
            {tagsFailed ? (
              <div
                data-testid="publish-tags-error"
                role="alert"
                className="flex items-center justify-between gap-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
              >
                <span>Could not load tags, so this Function cannot be published yet.</span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  data-testid="publish-tags-retry"
                  onClick={() => setTagsAttempt((attempt) => attempt + 1)}
                >
                  Try Again
                </Button>
              </div>
            ) : null}
          </div>
          <div className="space-y-2">
            <label htmlFor="publish-changelog" className="text-sm font-medium">
              Changelog <RequiredMark />
            </label>
            <textarea
              id="publish-changelog"
              value={changelog}
              onChange={(e: ChangeEvent<HTMLTextAreaElement>) =>
                setChangelog(e.target.value)
              }
              rows={2}
              required
              aria-invalid={!changelogValid || undefined}
              className={cn(
                textareaClass,
                !changelogValid && 'border-destructive',
              )}
            />
          </div>
          <div className="space-y-2">
            <label htmlFor="publish-details" className="text-sm font-medium">
              Details <RequiredMark />
            </label>
            <textarea
              id="publish-details"
              value={details}
              onChange={(e: ChangeEvent<HTMLTextAreaElement>) =>
                setDetails(e.target.value)
              }
              rows={3}
              required
              aria-invalid={!detailsValid || undefined}
              className={cn(
                textareaClass,
                !detailsValid && 'border-destructive',
              )}
            />
          </div>
          {error ? (
            <div
              data-testid="publish-dialog-error"
              role="alert"
              className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
            >
              {error}
            </div>
          ) : null}
        </div>
        <DialogFooter className="flex flex-row justify-between items-center gap-2">
          <p className="text-xs text-muted-foreground">{FOOTER_NOTE}</p>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose} disabled={pending}>
              Cancel
            </Button>
            <Button onClick={() => { handleSubmit().catch(reportFailure) }} disabled={!canSubmit} loading={pending}>
              Publish
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
