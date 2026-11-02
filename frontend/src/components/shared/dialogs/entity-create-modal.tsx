import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
  type SubmitEvent,
} from 'react'
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
import { NameField } from '@/components/shared/fields/name-field'
import { DescriptionField } from '@/components/shared/fields/description-field'
import { MAX_ENTITY_NAME_LENGTH } from '@/lib/field-constraints'
import { Loader2 } from 'lucide-react'
import { RequiredMark } from '@/components/shared/fields/required-mark'

export interface EntityCreateModalProps {
  open: boolean
  allTags: string[]
  loading?: boolean
  error?: string | null
  onClose: () => void
  onSubmit: (data: { name: string; description: string; tags: string[] }) => void
  title: string
  description: string
  testIdPrefix: string
  namePlaceholder: string
  descriptionPlaceholder: string
}

export function EntityCreateModal({
  open,
  allTags,
  loading = false,
  error,
  onClose,
  onSubmit,
  title,
  description,
  testIdPrefix,
  namePlaceholder,
  descriptionPlaceholder,
}: Readonly<EntityCreateModalProps>): ReactNode {
  const [name, setName] = useState('')
  const [desc, setDesc] = useState('')
  const [tags, setTags] = useState<string[]>([])
  const [nameError, setNameError] = useState('')
  const nameInputRef = useRef<HTMLTextAreaElement>(null)
  const nameErrorId = useId()

  useEffect(() => {
    if (open) {
      setName('')
      setDesc('')
      setTags([])
      setNameError('')
      setTimeout(() => nameInputRef.current?.focus(), 0)
    }
  }, [open])

  const handleSubmit = useCallback(
    (e: SubmitEvent<HTMLFormElement>) => {
      e.preventDefault()
      const trimmed = name.trim()
      if (!trimmed) {
        setNameError('Name is required')
        return
      }
      setNameError('')
      onSubmit({ name: trimmed, description: desc.trim(), tags })
    },
    [name, desc, tags, onSubmit],
  )

  if (!open) {
    return null
  }

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent data-testid={`${testIdPrefix}-create-modal`}>
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="min-w-0">
              <label
                htmlFor={`${testIdPrefix}-name`}
                className="block text-sm font-medium mb-1"
              >
                Name <RequiredMark />
              </label>
              <NameField
                id={`${testIdPrefix}-name`}
                ref={nameInputRef}
                data-testid={`${testIdPrefix}-name-input`}
                value={name}
                onChange={(value) => {
                  setName(value)
                  if (nameError) setNameError('')
                }}
                placeholder={namePlaceholder}
                aria-invalid={!!nameError}
                aria-describedby={nameError ? nameErrorId : undefined}
                disabled={loading}
                maxLength={MAX_ENTITY_NAME_LENGTH}
              />
              {nameError && (
                <p
                  id={nameErrorId}
                  className="mt-1 text-sm text-destructive"
                  role="alert"
                >
                  {nameError}
                </p>
              )}
            </div>

            <div className="min-w-0">
              <label
                htmlFor={`${testIdPrefix}-description`}
                className="block text-sm font-medium mb-1"
              >
                Description
              </label>
              <DescriptionField
                id={`${testIdPrefix}-description`}
                data-testid={`${testIdPrefix}-description-input`}
                value={desc}
                onChange={setDesc}
                placeholder={descriptionPlaceholder}
                disabled={loading}
              />
            </div>

            <div>
              <label
                htmlFor={`${testIdPrefix}-tags`}
                className="block text-sm font-medium mb-1"
              >
                Tags
              </label>
              <div data-testid={`${testIdPrefix}-tags-input`}>
                <TagsInput
                  triggerId={`${testIdPrefix}-tags`}
                  value={tags}
                  availableTags={allTags}
                  onChange={setTags}
                  placeholder="Add tags…"
                  disabled={loading}
                />
              </div>
            </div>

            {error && (
              <div role="alert" className="text-sm text-destructive rounded-md bg-destructive/10 p-3">
                {error}
              </div>
            )}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              disabled={loading}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              data-testid={`${testIdPrefix}-create-submit`}
              disabled={loading}
            >
              {loading && (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              )}
              Create
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
