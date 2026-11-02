/**
 * EditDialog Tests
 *
 * Tests for the generic edit dialog with unsaved-changes protection.
 */

import { useState } from 'react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act, within } from '@testing-library/react'
import { EditDialog } from '@/components/ui/edit-dialog'
import { DraggableSheet } from '@/components/shared/draggable-sheet'
import {
  useChildEditor,
  useChildEditorScope,
} from '@/components/shared/child-editors/child-editor-scope'

function renderDialog(props: Partial<Parameters<typeof EditDialog>[0]> = {}) {
  const defaults = {
    open: true,
    onOpenChange: vi.fn(),
    title: 'Edit Item',
    description: 'Edit the item details.',
    isDirty: false,
    onSave: vi.fn().mockResolvedValue(undefined),
    children: <input data-testid="edit-field" />,
    'data-testid': 'test-dialog',
  }
  return render(<EditDialog {...defaults} {...props} />)
}

describe('EditDialog', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('renders with title and children', () => {
    renderDialog()
    expect(screen.getByText('Edit Item')).toBeInTheDocument()
    expect(screen.getByTestId('edit-field')).toBeInTheDocument()
  })

  it('renders description when provided', () => {
    renderDialog({ description: 'Some help text' })
    expect(screen.getByText('Some help text')).toBeInTheDocument()
  })

  it('points the dialog at its description', () => {
    renderDialog({ description: 'Some help text' })

    const describedBy = screen.getByRole('dialog').getAttribute('aria-describedby')
    expect(document.getElementById(describedBy as string)).toHaveTextContent('Some help text')
  })

  it('describes a dialog with no description by nothing at all', () => {
    renderDialog({ description: undefined })

    expect(screen.getByRole('dialog')).not.toHaveAttribute('aria-describedby')
  })

  it('calls onSave and closes on save click', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined)
    const onOpenChange = vi.fn()
    renderDialog({ onSave, onOpenChange })

    await act(async () => {
      fireEvent.click(screen.getByTestId('edit-dialog-save'))
    })

    expect(onSave).toHaveBeenCalled()
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('shows save error when onSave throws', async () => {
    const onSave = vi.fn().mockRejectedValue(new Error('Save failed'))
    renderDialog({ onSave })

    await act(async () => {
      fireEvent.click(screen.getByTestId('edit-dialog-save'))
    })

    await waitFor(() => {
      expect(screen.getByText('Save failed')).toBeInTheDocument()
    })
  })

  it('shows generic error message for non-Error throws', async () => {
    const onSave = vi.fn().mockRejectedValue('string error')
    renderDialog({ onSave })

    await act(async () => {
      fireEvent.click(screen.getByTestId('edit-dialog-save'))
    })

    await waitFor(() => {
      expect(screen.getByText('Failed to save')).toBeInTheDocument()
    })
  })

  it('closes directly on cancel when not dirty', () => {
    const onOpenChange = vi.fn()
    renderDialog({ onOpenChange, isDirty: false })

    fireEvent.click(screen.getByTestId('edit-dialog-cancel'))
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('shows unsaved changes dialog on cancel when dirty', async () => {
    renderDialog({ isDirty: true })

    fireEvent.click(screen.getByTestId('edit-dialog-cancel'))

    await waitFor(() => {
      expect(screen.getByTestId('unsaved-changes-dialog')).toBeInTheDocument()
    })
  })

  it('keeps editing when Keep Editing is clicked', async () => {
    renderDialog({ isDirty: true })

    fireEvent.click(screen.getByTestId('edit-dialog-cancel'))

    await waitFor(() => {
      expect(screen.getByTestId('unsaved-keep-editing')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByTestId('unsaved-keep-editing'))

    await waitFor(() => {
      expect(screen.queryByTestId('unsaved-changes-dialog')).not.toBeInTheDocument()
    })
  })

  it('asks Keep Editing, Close or Save', async () => {
    renderDialog({ isDirty: true })

    fireEvent.click(screen.getByTestId('edit-dialog-cancel'))

    await waitFor(() => {
      expect(screen.getByTestId('unsaved-keep-editing')).toHaveTextContent(/^Keep Editing$/)
    })
    expect(screen.getByTestId('unsaved-discard')).toHaveTextContent(/^Close$/)
    expect(screen.getByTestId('unsaved-save-close')).toHaveTextContent(/^Save$/)
  })

  it('discards and closes when Close is clicked', async () => {
    const onOpenChange = vi.fn()
    const onDiscard = vi.fn()
    renderDialog({ isDirty: true, onOpenChange, onDiscard })

    fireEvent.click(screen.getByTestId('edit-dialog-cancel'))

    await waitFor(() => {
      expect(screen.getByTestId('unsaved-discard')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByTestId('unsaved-discard'))

    expect(onDiscard).toHaveBeenCalled()
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('saves and closes via Save in unsaved dialog', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined)
    const onOpenChange = vi.fn()
    renderDialog({ isDirty: true, onSave, onOpenChange })

    // Trigger unsaved changes dialog
    fireEvent.click(screen.getByTestId('edit-dialog-cancel'))

    await waitFor(() => {
      expect(screen.getByTestId('unsaved-save-close')).toBeInTheDocument()
    })

    await act(async () => {
      fireEvent.click(screen.getByTestId('unsaved-save-close'))
    })

    expect(onSave).toHaveBeenCalled()
    await waitFor(() => {
      expect(onOpenChange).toHaveBeenCalledWith(false)
    })
  })

  it('shows error in unsaved dialog when its Save fails', async () => {
    const onSave = vi.fn().mockRejectedValue(new Error('Save & Close failed'))
    renderDialog({ isDirty: true, onSave })

    fireEvent.click(screen.getByTestId('edit-dialog-cancel'))

    await waitFor(() => {
      expect(screen.getByTestId('unsaved-save-close')).toBeInTheDocument()
    })

    await act(async () => {
      fireEvent.click(screen.getByTestId('unsaved-save-close'))
    })

    await waitFor(() => {
      expect(screen.getByText('Save & Close failed')).toBeInTheDocument()
    })
  })

  it('shows generic error in unsaved dialog when its Save throws non-Error', async () => {
    const onSave = vi.fn().mockRejectedValue('not an Error object')
    renderDialog({ isDirty: true, onSave })

    fireEvent.click(screen.getByTestId('edit-dialog-cancel'))

    await waitFor(() => {
      expect(screen.getByTestId('unsaved-save-close')).toBeInTheDocument()
    })

    await act(async () => {
      fireEvent.click(screen.getByTestId('unsaved-save-close'))
    })

    await waitFor(() => {
      expect(screen.getByText('Failed to save')).toBeInTheDocument()
    })
  })

  it('disables save button when saveDisabled is true', () => {
    renderDialog({ saveDisabled: true })
    expect(screen.getByTestId('edit-dialog-save')).toBeDisabled()
  })

  it('uses custom save label', () => {
    renderDialog({ saveLabel: 'Update' })
    expect(screen.getByTestId('edit-dialog-save')).toHaveTextContent('Update')
  })

  it('renders in floating-sheet (flex-centered) mode without breaking the dialog', () => {
    // allowFloatingSheet switches DialogContent to flex-centering so a non-portaled
    // value-editor sheet floats viewport-relative. The dialog still works.
    renderDialog({ allowFloatingSheet: true })
    expect(screen.getByText('Edit Item')).toBeInTheDocument()
    expect(screen.getByTestId('edit-field')).toBeInTheDocument()
    expect(screen.getByTestId('edit-dialog-save')).toBeInTheDocument()
  })

  it('keeps a sheet opened inside a floating-sheet dialog within the dialog, beside its opener', () => {
    renderDialog({
      allowFloatingSheet: true,
      children: (
        <div data-testid="sheet-opener">
          <DraggableSheet
            open
            onClose={() => {}}
            ariaLabel="Edit value"
            header={<span>Edit value</span>}
            data-testid="dialog-sheet"
          >
            <input data-testid="dialog-sheet-field" />
          </DraggableSheet>
        </div>
      ),
    })
    const sheet = screen.getByTestId('dialog-sheet')
    expect(screen.getByRole('dialog')).toContainElement(sheet)
    expect(screen.getByTestId('sheet-opener')).not.toContainElement(sheet)
  })

  it('uses formatError to render custom error content', async () => {
    const onSave = vi.fn().mockRejectedValue(new Error('raw error'))
    const formatError = vi.fn().mockReturnValue(<span data-testid="custom-error">Custom error</span>)
    renderDialog({ onSave, formatError })

    await act(async () => {
      fireEvent.click(screen.getByTestId('edit-dialog-save'))
    })

    await waitFor(() => {
      expect(screen.getByTestId('custom-error')).toBeInTheDocument()
      expect(screen.getByText('Custom error')).toBeInTheDocument()
    })
    expect(formatError).toHaveBeenCalled()
  })
})

describe('EditDialog - Esc', () => {
  const pressEscape = () => fireEvent.keyDown(screen.getByTestId('edit-field'), { key: 'Escape' })

  it('ignores Esc by default', () => {
    const onOpenChange = vi.fn()
    renderDialog({ onOpenChange })

    pressEscape()

    expect(onOpenChange).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('ignores Esc by default even with unsaved changes, and does not ask', () => {
    const onOpenChange = vi.fn()
    renderDialog({ onOpenChange, isDirty: true })

    pressEscape()

    expect(onOpenChange).not.toHaveBeenCalled()
    expect(screen.queryByTestId('unsaved-changes-dialog')).not.toBeInTheDocument()
  })

  it('closes on Esc with closeOnEscape when nothing changed', () => {
    const onOpenChange = vi.fn()
    renderDialog({ onOpenChange, closeOnEscape: true })

    pressEscape()

    expect(onOpenChange).toHaveBeenCalledExactlyOnceWith(false)
    expect(screen.queryByTestId('unsaved-changes-dialog')).not.toBeInTheDocument()
  })

  it('asks before closing on Esc with closeOnEscape and unsaved changes, the same as Cancel', () => {
    const onOpenChange = vi.fn()
    const onDiscard = vi.fn()
    renderDialog({ onOpenChange, onDiscard, isDirty: true, closeOnEscape: true })

    pressEscape()

    expect(screen.getByTestId('unsaved-changes-dialog')).toBeInTheDocument()
    expect(onOpenChange).not.toHaveBeenCalled()

    fireEvent.click(screen.getByTestId('unsaved-discard'))

    expect(onDiscard).toHaveBeenCalledTimes(1)
    expect(onOpenChange).toHaveBeenCalledExactlyOnceWith(false)
  })
})

// A dialog that hosts floating editors is their parent: its Save and close count them.
describe('EditDialog - the parent of floating editors', () => {
  interface ChildSetup {
    hasChanges?: boolean
    cannotBeSaved?: boolean
  }

  function Child({ hasChanges = false, cannotBeSaved = false, onApply }: ChildSetup & { onApply: () => void }) {
    useChildEditor({ label: 'retries', hasChanges, cannotBeSaved, apply: onApply })
    return <span data-testid="child-editor" />
  }

  function ParentDialog({
    child = {},
    isDirty = false,
    saveDisabled = false,
    invalidNote = 'Save is disabled: the variables have errors',
    onSaved,
    onOpenChange = vi.fn(),
    onDiscard = vi.fn(),
  }: {
    child?: ChildSetup
    isDirty?: boolean
    saveDisabled?: boolean
    invalidNote?: string | null
    onSaved: (value: string) => void
    onOpenChange?: (open: boolean) => void
    onDiscard?: () => void
  }) {
    const childEditors = useChildEditorScope()
    const [value, setValue] = useState('saved')
    return (
      <EditDialog
        open
        onOpenChange={onOpenChange}
        title="Edit Suite Variables"
        isDirty={isDirty}
        saveDisabled={saveDisabled}
        invalidNote={invalidNote ?? undefined}
        childEditors={childEditors}
        onSave={async () => onSaved(value)}
        onDiscard={onDiscard}
        allowFloatingSheet
      >
        <Child {...child} onApply={() => setValue('from the editor')} />
      </EditDialog>
    )
  }

  const note = () => screen.getByTestId('save-blocked-note')

  it('keeps Save disabled while nothing changed anywhere', () => {
    render(<ParentDialog onSaved={vi.fn()} />)
    expect(screen.getByTestId('edit-dialog-save')).toBeDisabled()
  })

  it('closes at once while nothing changed anywhere', () => {
    const onOpenChange = vi.fn()
    render(<ParentDialog onSaved={vi.fn()} onOpenChange={onOpenChange} />)

    fireEvent.click(screen.getByTestId('edit-dialog-cancel'))

    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(screen.queryByTestId('unsaved-changes-dialog')).not.toBeInTheDocument()
  })

  it("saves once with the editor's unsaved value written first", async () => {
    const onSaved = vi.fn()
    const onOpenChange = vi.fn()
    render(<ParentDialog child={{ hasChanges: true }} onSaved={onSaved} onOpenChange={onOpenChange} />)

    await act(async () => {
      fireEvent.click(screen.getByTestId('edit-dialog-save'))
    })

    expect(onSaved).toHaveBeenCalledExactlyOnceWith('from the editor')
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('asks before closing while an editor has changes, and Close discards everything', async () => {
    const onOpenChange = vi.fn()
    const onDiscard = vi.fn()
    const onSaved = vi.fn()
    render(
      <ParentDialog
        child={{ hasChanges: true }}
        onSaved={onSaved}
        onOpenChange={onOpenChange}
        onDiscard={onDiscard}
      />,
    )

    fireEvent.click(screen.getByTestId('edit-dialog-cancel'))
    await waitFor(() => expect(screen.getByTestId('unsaved-changes-dialog')).toBeInTheDocument())
    fireEvent.click(screen.getByTestId('unsaved-discard'))

    expect(onDiscard).toHaveBeenCalledTimes(1)
    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(onSaved).not.toHaveBeenCalled()
  })

  it("Save in the question writes the editor's value and saves", async () => {
    const onSaved = vi.fn()
    render(<ParentDialog child={{ hasChanges: true }} onSaved={onSaved} />)

    fireEvent.click(screen.getByTestId('edit-dialog-cancel'))
    await waitFor(() => expect(screen.getByTestId('unsaved-save-close')).toBeInTheDocument())
    await act(async () => {
      fireEvent.click(screen.getByTestId('unsaved-save-close'))
    })

    expect(onSaved).toHaveBeenCalledExactlyOnceWith('from the editor')
  })

  it('disables both Saves and names the editor that has errors', async () => {
    render(<ParentDialog child={{ hasChanges: true, cannotBeSaved: true }} onSaved={vi.fn()} />)

    expect(screen.getByTestId('edit-dialog-save')).toBeDisabled()
    expect(note()).toHaveTextContent(/^Save is disabled: the retries editor has errors$/)

    fireEvent.click(screen.getByTestId('edit-dialog-cancel'))
    await waitFor(() => expect(screen.getByTestId('unsaved-save-close')).toBeDisabled())
    expect(
      within(screen.getByTestId('unsaved-changes-dialog')).getByTestId('save-blocked-note'),
    ).toHaveTextContent(/^Save is disabled: the retries editor has errors$/)
  })

  it('disables Save without a note where its host names no reason', () => {
    render(<ParentDialog isDirty saveDisabled invalidNote={null} onSaved={vi.fn()} />)

    expect(screen.getByTestId('edit-dialog-save')).toBeDisabled()
    expect(screen.queryByTestId('save-blocked-note')).not.toBeInTheDocument()
  })

  it('names its own form while it is invalid', () => {
    render(<ParentDialog isDirty saveDisabled onSaved={vi.fn()} />)

    expect(screen.getByTestId('edit-dialog-save')).toBeDisabled()
    expect(note()).toHaveTextContent(/^Save is disabled: the variables have errors$/)
  })
})
