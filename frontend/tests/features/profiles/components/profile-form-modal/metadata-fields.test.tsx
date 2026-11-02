/**
 * MetadataFields shared-field migration tests.
 *
 * Shape:
 *   - Profile name `<Input>` -> `<NameField maxLength={MAX_ENTITY_NAME_LENGTH}>` (64).
 *   - Profile description -> `<DescriptionField>` (multi-line, matches the
 *     environment / test description fields).
 *
 * The migration tests below verify post-migration shape only. Higher-level
 * profile form behavior (validation, submit, errors) is covered by
 * `tests/features/profiles/components/profile-form-modal.test.tsx`.
 *
 * The Name reports leaving it and is described by its message (FIELDERR-1, FIELDERR-3).
 */

import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useRef } from 'react'

import { MetadataFields } from '@/features/profiles/components/profile-form-modal/metadata-fields'
import { MAX_ENTITY_NAME_LENGTH } from '@/lib/field-constraints'
import { expectRequiredMark, labelOf } from '../../../../utils/required-mark'

function MetadataFieldsHarness({
  name = '',
  description = '',
  errors = {},
  onNameBlur,
  onNameVisit,
}: {
  name?: string
  description?: string
  errors?: Record<string, string>
  onNameBlur?: () => void
  onNameVisit?: () => void
}) {
  const nameInputRef = useRef<HTMLTextAreaElement>(null)
  return (
    <MetadataFields
      nameInputRef={nameInputRef}
      name={name}
      description={description}
      tags={[]}
      allTags={[]}
      errors={errors}
      loading={false}
      onFieldChange={vi.fn()}
      onNameBlur={onNameBlur}
      onNameVisit={onNameVisit}
    />
  )
}

describe('MetadataFields - shared field primitives migration', () => {
  describe('profile name uses NameField with MAX_ENTITY_NAME_LENGTH', () => {
    it('renders the name input capped at 64', () => {
      render(<MetadataFieldsHarness />)

      const nameInput = screen.getByLabelText(/^name/i)
      expect(nameInput).toHaveAttribute(
        'maxLength',
        String(MAX_ENTITY_NAME_LENGTH),
      )
    })

    it('renders as the TextField primitive (TEXTAREA tag, rows=1)', () => {
      render(<MetadataFieldsHarness />)

      const nameInput = screen.getByLabelText(/^name/i)
      expect(nameInput.tagName).toBe('TEXTAREA')
      expect(nameInput).toHaveAttribute('rows', '1')
    })

    it('shows the NameField counter at >=80% of cap', () => {
      const value = 'a'.repeat(52) // 52/64 = 81.25%
      const { container } = render(<MetadataFieldsHarness name={value} />)

      const counter = container.querySelector('span[aria-live="polite"]')
      expect(counter).not.toBeNull()
      expect(counter).toHaveTextContent(`52/${MAX_ENTITY_NAME_LENGTH}`)
      expect(counter).toHaveAttribute('data-state', 'muted')
    })

    it('renders inline error message when errors.name is set', () => {
      render(<MetadataFieldsHarness errors={{ name: 'Name is required' }} />)

      const error = screen.getByRole('alert')
      expect(error).toHaveTextContent('Name is required')
    })
  })

  describe('profile description uses DescriptionField', () => {
    it('renders as the DescriptionField primitive (TEXTAREA with min-h-[80px])', () => {
      render(<MetadataFieldsHarness />)

      const descInput = screen.getByLabelText(/^description/i)
      expect(descInput.tagName).toBe('TEXTAREA')
      expect(descInput.className).toContain('min-h-[80px]')
    })

    it('description has no maxLength (free-form)', () => {
      render(<MetadataFieldsHarness />)

      const descInput = screen.getByLabelText(/^description/i)
      expect(descInput).not.toHaveAttribute('maxLength')
    })
  })

  describe('Name leave and message wiring (FIELDERR-1, FIELDERR-3)', () => {
    it('calls onNameBlur when the Name field loses focus', async () => {
      const user = userEvent.setup()
      const onNameBlur = vi.fn()
      render(<MetadataFieldsHarness onNameBlur={onNameBlur} />)

      await user.click(screen.getByLabelText(/^name/i))
      expect(onNameBlur).not.toHaveBeenCalled()
      await user.tab()

      expect(onNameBlur).toHaveBeenCalledTimes(1)
    })

    it('calls onNameVisit when the Name field takes focus and again when it is clicked', async () => {
      const user = userEvent.setup()
      const onNameVisit = vi.fn()
      render(<MetadataFieldsHarness onNameVisit={onNameVisit} />)
      const nameInput = screen.getByLabelText(/^name/i)

      nameInput.focus()
      expect(onNameVisit).toHaveBeenCalledTimes(1)
      await user.click(nameInput)

      expect(onNameVisit).toHaveBeenCalledTimes(2)
    })

    it('lets the Name lose focus without an onNameBlur handler', async () => {
      const user = userEvent.setup()
      render(<MetadataFieldsHarness />)

      await user.click(screen.getByLabelText(/^name/i))
      await user.tab()

      expect(screen.getByLabelText(/^name/i)).not.toHaveFocus()
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    })

    it('describes the Name field by its message', () => {
      render(<MetadataFieldsHarness errors={{ name: 'Name is required' }} />)

      const nameInput = screen.getByLabelText(/^name/i)
      expect(nameInput).toHaveAttribute('aria-invalid', 'true')
      expect(nameInput).toHaveAccessibleDescription('Name is required')
    })

    it('gives the Name field no description while it has no message', () => {
      render(<MetadataFieldsHarness />)

      expect(screen.getByLabelText(/^name/i)).not.toHaveAccessibleDescription()
    })
  })
})

describe('MetadataFields - required mark', () => {
  it('marks the Name label with the shared RequiredMark', () => {
    render(<MetadataFieldsHarness />)

    expectRequiredMark(labelOf(screen.getByLabelText(/^name/i)))
  })

  it('leaves the Description label unmarked', () => {
    render(<MetadataFieldsHarness />)

    const description = labelOf(screen.getByLabelText(/^description/i))
    expect(description.textContent).not.toContain('*')
  })
})
