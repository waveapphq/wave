/**
 * The one Name prompt behind New folder and Rename: EditDialog
 * with a single TextField. A name the server would refuse, or one a sibling
 * already carries, is refused here.
 */

import { useId, useState } from 'react'
import { EditDialog } from '@/components/ui/edit-dialog'
import { TextField } from '@/components/shared/fields/text-field'

export interface TestDataNameDialogProps {
  open: boolean
  mode: 'folder' | 'rename'
  /** Where a new folder is created ("" is the root); named in the title. */
  folder: string
  /** The current name in rename mode. */
  initialName?: string
  /** Names already taken in the target folder (the renamed entry excluded). */
  siblings: string[]
  onSave: (name: string) => void
  onClose: () => void
}

const NAME_MAX_LENGTH = 255
const SEPARATORS = /[/\\]/
const RENAME_DESCRIPTION = 'Blocks that reference the old name will no longer find it.'

function folderTitle(folder: string): string {
  return folder === '' ? 'New folder in the root' : `New folder in ${folder}`
}

/** The refusal for a trimmed name, or null when it is acceptable. */
function refusal(name: string, siblings: string[]): string | null {
  if (name === '') return 'Enter a name'
  if (SEPARATORS.test(name)) return 'A name cannot contain / or \\'
  if (name === '.' || name === '..') return 'A name cannot be . or ..'
  if (siblings.includes(name)) return 'A file or folder with this name already exists'
  return null
}

export function TestDataNameDialog({
  open,
  mode,
  folder,
  initialName = '',
  siblings,
  onSave,
  onClose,
}: Readonly<TestDataNameDialogProps>) {
  const [name, setName] = useState(initialName)
  const [edited, setEdited] = useState(false)
  const fieldId = useId()
  const messageId = useId()

  const trimmed = name.trim()
  const message = refusal(trimmed, siblings)
  const unchanged = mode === 'rename' && trimmed === initialName
  const valid = message === null && !unchanged
  const showMessage = edited && message !== null

  const handleChange = (value: string) => {
    setName(value)
    setEdited(true)
  }

  return (
    <EditDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
      title={mode === 'folder' ? folderTitle(folder) : `Rename ${initialName}`}
      description={mode === 'rename' ? RENAME_DESCRIPTION : undefined}
      onSave={() => {
        onSave(trimmed)
        return Promise.resolve()
      }}
      isDirty={false}
      saveDisabled={!valid}
      className="max-w-md"
      data-testid="testdata-name-dialog"
    >
      <div className="space-y-1.5">
        <label htmlFor={fieldId} className="text-sm font-medium">
          Name
        </label>
        <TextField
          id={fieldId}
          value={name}
          onChange={handleChange}
          maxLength={NAME_MAX_LENGTH}
          autoFocus
          aria-invalid={showMessage}
          aria-describedby={showMessage ? messageId : undefined}
          className="font-mono"
          data-testid="testdata-name-input"
        />
        {showMessage && (
          <p id={messageId} className="text-xs text-error">
            {message}
          </p>
        )}
      </div>
    </EditDialog>
  )
}
