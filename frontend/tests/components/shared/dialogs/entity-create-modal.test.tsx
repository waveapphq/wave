/**
 * EntityCreateModal shared-field migration tests.
 *
 * Shared dialog used by both Suite create + Regression create flows.
 * Shape:
 *   - Name input renders via `<NameField>` capped at MAX_ENTITY_NAME_LENGTH (64).
 *   - Description input is a single-line value field rendered via `<TextField>`.
 *
 * The migration tests below verify post-migration shape only. The full
 * EntityCreateModal behavior (open/close, submit, error handling) is covered
 * indirectly by the existing suite-create-modal.test.tsx and any
 * regression-create-modal coverage. We do not duplicate that here.
 */

import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

import { EntityCreateModal } from '@/components/shared/dialogs/entity-create-modal'
import { MAX_ENTITY_NAME_LENGTH } from '@/lib/field-constraints'
import { expectRequiredMark, labelOf } from '../../../utils/required-mark'

function renderModal() {
  return render(
    <EntityCreateModal
      open
      allTags={[]}
      onClose={vi.fn()}
      onSubmit={vi.fn()}
      title="Create Suite"
      description="Create a new test suite to organize and run tests together."
      testIdPrefix="suite"
      namePlaceholder="Enter suite name"
      descriptionPlaceholder="Optional description"
    />,
  )
}

describe('EntityCreateModal - shared field primitives migration', () => {
  describe('name field uses NameField with MAX_ENTITY_NAME_LENGTH', () => {
    it('renders the name input with the entity-name maxLength (64)', () => {
      renderModal()

      const nameInput = screen.getByTestId('suite-name-input')
      expect(nameInput).toHaveAttribute('maxLength', String(MAX_ENTITY_NAME_LENGTH))
    })

    it('renders a NameField counter testid sibling once enabled', () => {
      // NameField composes TextField with `showCount`. The counter <span> is
      // suffixed with `-counter`. It only appears at >=80% of the cap, so
      // pre-typing it should be absent on initial empty render.
      renderModal()

      expect(screen.queryByTestId('suite-name-input-counter')).not.toBeInTheDocument()
    })
  })

  describe('description field uses DescriptionField', () => {
    it('renders the description input as the multi-line DescriptionField primitive', () => {
      // DescriptionField renders a multi-line textarea with min-h-[80px],
      // matching the environment / test description fields (long-form, free-form text).
      renderModal()

      const descInput = screen.getByTestId('suite-description-input')
      expect(descInput.tagName).toBe('TEXTAREA')
      expect(descInput.className).toContain('min-h-[80px]')
    })

    it('description does not have a maxLength (no cap on free-form description)', () => {
      renderModal()

      const descInput = screen.getByTestId('suite-description-input')
      expect(descInput).not.toHaveAttribute('maxLength')
    })
  })
})

describe('EntityCreateModal - required mark', () => {
  it('marks the Name label with the shared RequiredMark', () => {
    renderModal()

    expectRequiredMark(labelOf(screen.getByTestId('suite-name-input')))
  })
})
