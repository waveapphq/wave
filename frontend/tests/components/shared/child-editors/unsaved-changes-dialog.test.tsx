/**
 * UnsavedChangesDialog: the question a parent asks when it closes with changes.
 *
 * Keep Editing returns; Close discards everything and closes; Save is the
 * parent's own Save. Save is left out where the parent cannot save (read-only),
 * and while something blocks it, it is disabled with a red note naming what.
 */

import { describe, it, expect, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'

import { UnsavedChangesDialog } from '@/components/shared/child-editors/unsaved-changes-dialog'

function renderDialog(overrides: Partial<Parameters<typeof UnsavedChangesDialog>[0]> = {}) {
  const props = {
    open: true,
    onKeepEditing: vi.fn(),
    onClose: vi.fn(),
    onSave: vi.fn(),
    ...overrides,
  }
  render(<UnsavedChangesDialog {...props} />)
  return props
}

/** The dialog's own answers; the header X is the dialog shell's. */
function footerLabels(dialog: HTMLElement): (string | null)[] {
  return within(dialog)
    .getAllByRole('button')
    .filter((button) => button.dataset.testid !== undefined)
    .map((button) => button.textContent)
}

describe('UnsavedChangesDialog', () => {
  it('asks Keep Editing, Close or Save', () => {
    renderDialog()

    const dialog = screen.getByTestId('unsaved-changes-dialog')
    expect(within(dialog).getByText(/^Unsaved changes$/)).toBeInTheDocument()
    expect(
      within(dialog).getByText(/^You have unsaved changes\. What would you like to do\?$/),
    ).toBeInTheDocument()
    expect(footerLabels(dialog)).toEqual(['Keep Editing', 'Close', 'Save'])
  })

  it('returns on Keep Editing', () => {
    const props = renderDialog()

    fireEvent.click(screen.getByTestId('unsaved-keep-editing'))

    expect(props.onKeepEditing).toHaveBeenCalledTimes(1)
    expect(props.onClose).not.toHaveBeenCalled()
  })

  it('returns when dismissed with Escape', () => {
    const props = renderDialog()

    fireEvent.keyDown(screen.getByTestId('unsaved-changes-dialog'), { key: 'Escape' })

    expect(props.onKeepEditing).toHaveBeenCalledTimes(1)
  })

  it('closes on Close', () => {
    const props = renderDialog()

    fireEvent.click(screen.getByTestId('unsaved-close'))

    expect(props.onClose).toHaveBeenCalledTimes(1)
  })

  it('saves on Save', () => {
    const props = renderDialog()

    fireEvent.click(screen.getByTestId('unsaved-save'))

    expect(props.onSave).toHaveBeenCalledTimes(1)
  })

  it('offers Keep Editing and Close only where the parent cannot save', () => {
    renderDialog({ onSave: undefined })

    const dialog = screen.getByTestId('unsaved-changes-dialog')
    expect(footerLabels(dialog)).toEqual(['Keep Editing', 'Close'])
  })

  it('disables Save with a note naming what blocks it', () => {
    renderDialog({ saveBlockedNote: 'Save is disabled: the Input Variables editor has errors' })

    expect(screen.getByTestId('unsaved-save')).toBeDisabled()
    expect(
      within(screen.getByTestId('unsaved-changes-dialog')).getByTestId('save-blocked-note'),
    ).toHaveTextContent(/^Save is disabled: the Input Variables editor has errors$/)
  })

  it('disables Save without a note where its host gives none', () => {
    renderDialog({ saveDisabled: true })

    expect(screen.getByTestId('unsaved-save')).toBeDisabled()
    expect(screen.queryByTestId('save-blocked-note')).not.toBeInTheDocument()
  })

  it('shows no note while Save is left out', () => {
    renderDialog({ onSave: undefined, saveBlockedNote: 'Save is disabled: the settings have errors' })

    expect(screen.queryByTestId('save-blocked-note')).not.toBeInTheDocument()
  })

  it('disables every button while a save is in flight', () => {
    renderDialog({ busy: true })

    expect(screen.getByTestId('unsaved-keep-editing')).toBeDisabled()
    expect(screen.getByTestId('unsaved-close')).toBeDisabled()
    expect(screen.getByTestId('unsaved-save')).toBeDisabled()
    expect(screen.getByTestId('unsaved-save-spinner')).toBeInTheDocument()
  })

  it('takes the test ids its host already uses', () => {
    renderDialog({
      testIds: {
        dialog: 'value-editor-unsaved-dialog',
        keepEditing: 'value-editor-unsaved-keep-button',
        close: 'value-editor-unsaved-discard-button',
        save: 'value-editor-unsaved-save-button',
      },
    })

    expect(screen.getByTestId('value-editor-unsaved-dialog')).toBeInTheDocument()
    expect(screen.getByTestId('value-editor-unsaved-keep-button')).toHaveTextContent('Keep Editing')
    expect(screen.getByTestId('value-editor-unsaved-discard-button')).toHaveTextContent('Close')
    expect(screen.getByTestId('value-editor-unsaved-save-button')).toHaveTextContent('Save')
  })

  it('names Keep Editing and Close with the labels its host gives', () => {
    renderDialog({ keepEditingLabel: 'Cancel', closeLabel: 'Discard' })

    expect(footerLabels(screen.getByTestId('unsaved-changes-dialog'))).toEqual([
      'Cancel',
      'Discard',
      'Save',
    ])
  })

  it('renders nothing while closed', () => {
    renderDialog({ open: false })

    expect(screen.queryByTestId('unsaved-changes-dialog')).not.toBeInTheDocument()
  })
})
