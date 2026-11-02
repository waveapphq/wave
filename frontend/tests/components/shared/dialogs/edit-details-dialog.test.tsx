/**
 * EditDetailsDialog shared-field migration tests.
 *
 * Shared metadata-edit dialog opened by Suite + Regression metadata sidebars.
 * Contract under test:
 *   - Name input renders via `<NameField>` capped at MAX_ENTITY_NAME_LENGTH (64).
 *   - Description input is a single-line value field rendered via `<TextField>`.
 */

import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

import { EditDetailsDialog } from '@/components/shared/dialogs/edit-details-dialog'
import { MAX_ENTITY_NAME_LENGTH } from '@/lib/field-constraints'

function renderDialog(
  overrides: Partial<Parameters<typeof EditDetailsDialog>[0]> = {},
) {
  const props = {
    open: true,
    onOpenChange: vi.fn(),
    title: 'Edit Suite',
    description: 'Edit suite metadata',
    isDirty: false,
    onSave: vi.fn().mockResolvedValue(undefined),
    onDiscard: vi.fn(),
    editName: '',
    onEditNameChange: vi.fn(),
    editDescription: '',
    onEditDescriptionChange: vi.fn(),
    editTags: [],
    allTags: [],
    onEditTagsChange: vi.fn(),
    ...overrides,
  }
  return render(<EditDetailsDialog {...props} />)
}

describe('EditDetailsDialog - shared field primitives migration', () => {
  describe('name field uses NameField with MAX_ENTITY_NAME_LENGTH', () => {
    it('renders the name input with the entity-name maxLength (64)', () => {
      renderDialog()

      const nameInput = screen.getByTestId('edit-details-name')
      expect(nameInput).toHaveAttribute('maxLength', String(MAX_ENTITY_NAME_LENGTH))
    })

    it('shows the NameField counter when value crosses 80% of the cap', () => {
      // 52/64 = 81.25% -> muted counter visible.
      const value = 'a'.repeat(52)
      renderDialog({ editName: value })

      const counter = screen.getByTestId('edit-details-name-counter')
      expect(counter).toHaveTextContent(`52/${MAX_ENTITY_NAME_LENGTH}`)
      expect(counter).toHaveAttribute('data-state', 'muted')
    })

    it('counter goes destructive at the cap', () => {
      const value = 'a'.repeat(MAX_ENTITY_NAME_LENGTH)
      renderDialog({ editName: value })

      const counter = screen.getByTestId('edit-details-name-counter')
      expect(counter).toHaveAttribute('data-state', 'destructive')
    })
  })

  describe('description field uses DescriptionField', () => {
    it('renders the description input as the multi-line DescriptionField primitive', () => {
      renderDialog()

      const descInput = screen.getByTestId('edit-details-description')
      expect(descInput.tagName).toBe('TEXTAREA')
      expect(descInput.className).toContain('min-h-[80px]')
    })
  })
})
