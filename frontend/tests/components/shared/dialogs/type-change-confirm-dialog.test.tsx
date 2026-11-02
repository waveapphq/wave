/**
 * Tests for TypeChangeConfirmDialog - the destructive type-change confirm
 * modal. Body copy varies by source type (collections use entry/entries,
 * scalars use "value") and by count (singular vs plural). The title names
 * what changes type: a variable, a map entry or a list item.
 */

import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TypeChangeConfirmDialog } from '@/components/shared/dialogs/type-change-confirm-dialog'

describe('TypeChangeConfirmDialog', () => {
  it.each([
    ['entry', 'Change entry type?'],
    ['item', 'Change item type?'],
  ] as const)('names the %s in its title, with the same sentence', (subject, title) => {
    render(
      <TypeChangeConfirmDialog
        open
        subject={subject}
        prevType="string"
        nextType="integer"
        currentLength={1}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    )
    expect(screen.getByRole('alertdialog', { name: title })).toBeInTheDocument()
    expect(
      screen.getByText('Changing type to integer will clear 1 existing string value. This cannot be undone.'),
    ).toBeInTheDocument()
  })

  it('renders the title verbatim', () => {
    render(
      <TypeChangeConfirmDialog
        open
        subject="variable"
        prevType="array"
        nextType="map"
        currentLength={3}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    )
    expect(screen.getByText('Change variable type?')).toBeInTheDocument()
  })

  it('renders the body with the correct collection plural for arrays', () => {
    render(
      <TypeChangeConfirmDialog
        open
        subject="variable"
        prevType="array"
        nextType="map"
        currentLength={3}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    )
    expect(
      screen.getByText(
        'Changing type to map will clear 3 existing array entries. This cannot be undone.',
      ),
    ).toBeInTheDocument()
  })

  it('uses singular "entry" for collection length of 1', () => {
    render(
      <TypeChangeConfirmDialog
        open
        subject="variable"
        prevType="array"
        nextType="map"
        currentLength={1}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    )
    expect(
      screen.getByText(
        'Changing type to map will clear 1 existing array entry. This cannot be undone.',
      ),
    ).toBeInTheDocument()
  })

  it('uses "entries" for map plural', () => {
    render(
      <TypeChangeConfirmDialog
        open
        subject="variable"
        prevType="map"
        nextType="array"
        currentLength={2}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    )
    expect(
      screen.getByText(
        'Changing type to array will clear 2 existing map entries. This cannot be undone.',
      ),
    ).toBeInTheDocument()
  })

  it('uses "value" wording when the source type is scalar', () => {
    // Defensive coverage - the dialog is normally only mounted for complex
    // sources, but the entryUnit helper has a scalar branch that must be
    // exercised so refactors do not silently regress.
    render(
      <TypeChangeConfirmDialog
        open
        subject="variable"
        prevType="string"
        nextType="map"
        currentLength={1}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    )
    expect(
      screen.getByText(
        'Changing type to map will clear 1 existing string value. This cannot be undone.',
      ),
    ).toBeInTheDocument()
  })

  it('exposes Cancel and Change type buttons inside the alertdialog', () => {
    render(
      <TypeChangeConfirmDialog
        open
        subject="variable"
        prevType="array"
        nextType="map"
        currentLength={3}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    )
    const dialog = screen.getByRole('alertdialog')
    expect(dialog).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Change type' })).toBeInTheDocument()
  })

  it('invokes onConfirm when Change type is clicked', async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn()
    const onCancel = vi.fn()
    render(
      <TypeChangeConfirmDialog
        open
        subject="variable"
        prevType="array"
        nextType="map"
        currentLength={3}
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    )
    await user.click(screen.getByRole('button', { name: 'Change type' }))
    expect(onConfirm).toHaveBeenCalledOnce()
  })

  it('invokes onCancel when Cancel is clicked', async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn()
    const onCancel = vi.fn()
    render(
      <TypeChangeConfirmDialog
        open
        subject="variable"
        prevType="array"
        nextType="map"
        currentLength={3}
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    )
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onCancel).toHaveBeenCalledOnce()
  })
})
