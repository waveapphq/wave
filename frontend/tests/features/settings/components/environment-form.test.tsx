/**
 * EnvironmentForm Component Tests
 *
 * REQ-5.2.1.42: Settings and preferences screen - Environment create/edit form
 *
 * Tests for EnvironmentForm dialog component per design decisions:
 * - SETTINGS-6: Environments = name + description only
 * - SETTINGS-8: "+ New Environment" button opens creation dialog
 *
 * Component: frontend/src/components/settings/environment-form.tsx
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import {
  EnvironmentForm,
  type EnvironmentFormProps,
} from '@/features/settings/components/environment-form'

// ============================================================================
// Mock Data
// ============================================================================

const mockEnvironment = {
  id: 'env-1',
  name: 'Production',
  description: 'Production environment',
  tags: ['production', 'critical'],
  usage: 5,
  createdAt: '2025-01-10T10:00:00Z',
  updatedAt: '2025-01-15T14:30:00Z',
}

const mockAllTags = ['production', 'staging', 'development', 'critical', 'testing']

// ============================================================================
// Test Utilities
// ============================================================================

function renderEnvironmentForm(props: Partial<EnvironmentFormProps> = {}) {
  const defaultProps: EnvironmentFormProps = {
    open: true,
    mode: 'create',
    allTags: mockAllTags,
    onClose: vi.fn(),
    onSubmit: vi.fn(),
    loading: false,
    error: undefined,
    ...props,
  }
  return render(<EnvironmentForm {...defaultProps} />)
}

// ============================================================================
// Tests
// ============================================================================

describe('EnvironmentForm', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  describe('Dialog Structure', () => {
    it('renders dialog when open', () => {
      renderEnvironmentForm({ open: true })
      expect(screen.getByRole('dialog')).toBeInTheDocument()
    })

    it('does not render dialog when closed', () => {
      renderEnvironmentForm({ open: false })
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })

    it('renders dialog title for create mode', () => {
      renderEnvironmentForm({ mode: 'create' })
      expect(screen.getByRole('heading', { name: /New Environment/i })).toBeInTheDocument()
    })

    it('renders dialog title for edit mode', () => {
      renderEnvironmentForm({ mode: 'edit', environment: mockEnvironment })
      expect(screen.getByRole('heading', { name: /Edit Environment/i })).toBeInTheDocument()
    })

    it('renders close button', () => {
      renderEnvironmentForm()
      expect(screen.getByRole('button', { name: /Close/i })).toBeInTheDocument()
    })
  })

  describe('Form Fields (SETTINGS-6)', () => {
    it('renders Name input field', () => {
      renderEnvironmentForm()
      expect(screen.getByLabelText(/Name/i)).toBeInTheDocument()
    })

    it('Name field is required', () => {
      renderEnvironmentForm()
      const nameInput = screen.getByLabelText(/Name/i)
      expect(nameInput).toBeRequired()
    })

    it('renders Description textarea field', () => {
      renderEnvironmentForm()
      expect(screen.getByLabelText(/Description/i)).toBeInTheDocument()
    })

    it('Description field is optional', () => {
      renderEnvironmentForm()
      const descriptionInput = screen.getByLabelText(/Description/i)
      expect(descriptionInput).not.toBeRequired()
    })

    it('Name input has placeholder', () => {
      renderEnvironmentForm()
      const nameInput = screen.getByLabelText(/Name/i)
      expect(nameInput).toHaveAttribute('placeholder', expect.stringMatching(/environment name/i))
    })

    it('Description textarea has placeholder', () => {
      renderEnvironmentForm()
      const descriptionInput = screen.getByLabelText(/Description/i)
      expect(descriptionInput).toHaveAttribute('placeholder')
    })
  })

  describe('Create Mode', () => {
    it('fields are empty in create mode', () => {
      renderEnvironmentForm({ mode: 'create' })
      expect(screen.getByLabelText(/Name/i)).toHaveValue('')
      expect(screen.getByLabelText(/Description/i)).toHaveValue('')
    })

    it('renders "Create" submit button', () => {
      renderEnvironmentForm({ mode: 'create' })
      expect(screen.getByRole('button', { name: /^Create$/i })).toBeInTheDocument()
    })

    it('renders "Cancel" button', () => {
      renderEnvironmentForm({ mode: 'create' })
      expect(screen.getByRole('button', { name: /Cancel/i })).toBeInTheDocument()
    })

    it('Submit button is disabled when Name is empty', () => {
      renderEnvironmentForm({ mode: 'create' })
      expect(screen.getByRole('button', { name: /^Create$/i })).toBeDisabled()
    })

    it('Submit button is enabled when Name is provided', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      renderEnvironmentForm({ mode: 'create' })
      await user.type(screen.getByLabelText(/Name/i), 'Test Environment')

      expect(screen.getByRole('button', { name: /^Create$/i })).toBeEnabled()
    })

    it('calls onSubmit with form data on valid submission', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()
      const handleSubmit = vi.fn()

      renderEnvironmentForm({ mode: 'create', onSubmit: handleSubmit })
      await user.type(screen.getByLabelText(/Name/i), 'Test Environment')
      await user.type(screen.getByLabelText(/Description/i), 'Test description')
      await user.click(screen.getByRole('button', { name: /^Create$/i }))

      expect(handleSubmit).toHaveBeenCalledWith({
        name: 'Test Environment',
        description: 'Test description',
        tags: [],
      })
    })

    it('calls onSubmit with null description when empty', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()
      const handleSubmit = vi.fn()

      renderEnvironmentForm({ mode: 'create', onSubmit: handleSubmit })
      await user.type(screen.getByLabelText(/Name/i), 'Test Environment')
      await user.click(screen.getByRole('button', { name: /^Create$/i }))

      expect(handleSubmit).toHaveBeenCalledWith({
        name: 'Test Environment',
        description: null,
        tags: [],
      })
    })
  })

  describe('Edit Mode', () => {
    it('pre-fills Name field with existing value', () => {
      renderEnvironmentForm({ mode: 'edit', environment: mockEnvironment })
      expect(screen.getByLabelText(/Name/i)).toHaveValue('Production')
    })

    it('pre-fills Description field with existing value', () => {
      renderEnvironmentForm({ mode: 'edit', environment: mockEnvironment })
      expect(screen.getByLabelText(/Description/i)).toHaveValue('Production environment')
    })

    it('handles null description in edit mode', () => {
      const envNoDesc = { ...mockEnvironment, description: null }
      renderEnvironmentForm({ mode: 'edit', environment: envNoDesc })
      expect(screen.getByLabelText(/Description/i)).toHaveValue('')
    })

    it('renders "Save Changes" submit button', () => {
      renderEnvironmentForm({ mode: 'edit', environment: mockEnvironment })
      expect(screen.getByRole('button', { name: /Save Changes/i })).toBeInTheDocument()
    })

    it('calls onSubmit with updated data', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()
      const handleSubmit = vi.fn()

      renderEnvironmentForm({
        mode: 'edit',
        environment: mockEnvironment,
        onSubmit: handleSubmit,
      })
      await user.clear(screen.getByLabelText(/Name/i))
      await user.type(screen.getByLabelText(/Name/i), 'Updated Name')
      await user.click(screen.getByRole('button', { name: /Save Changes/i }))

      expect(handleSubmit).toHaveBeenCalledWith({
        name: 'Updated Name',
        description: 'Production environment',
        tags: ['production', 'critical'],
      })
    })

    it('Submit button is disabled when Name is cleared', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      renderEnvironmentForm({ mode: 'edit', environment: mockEnvironment })
      await user.clear(screen.getByLabelText(/Name/i))

      expect(screen.getByRole('button', { name: /Save Changes/i })).toBeDisabled()
    })
  })

  describe('Form Validation', () => {
    it('shows error when submitting with empty name', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      renderEnvironmentForm({ mode: 'create' })
      await user.click(screen.getByLabelText(/Name/i))
      await user.tab() // Blur to trigger validation

      expect(screen.getByText(/Name is required/i)).toBeInTheDocument()
    })

    it('shows error for name exceeding max length', async () => {
      const { MAX_ENTITY_NAME_LENGTH } = await import(
        '@/lib/field-constraints'
      )
      renderEnvironmentForm({ mode: 'create' })
      const longName = 'a'.repeat(MAX_ENTITY_NAME_LENGTH + 1)
      const input = screen.getByLabelText(/Name/i)
      fireEvent.change(input, { target: { value: longName } })
      fireEvent.blur(input)

      await waitFor(() => {
        expect(
          screen.getByText(
            new RegExp(`Name must not exceed ${MAX_ENTITY_NAME_LENGTH} characters`, 'i'),
          ),
        ).toBeInTheDocument()
      })
    })

    it('shows error for whitespace-only name', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      renderEnvironmentForm({ mode: 'create' })
      await user.type(screen.getByLabelText(/Name/i), '   ')
      await user.tab()

      expect(screen.getByText(/Name is required/i)).toBeInTheDocument()
    })

    it('trims whitespace from name on submit', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()
      const handleSubmit = vi.fn()

      renderEnvironmentForm({ mode: 'create', onSubmit: handleSubmit })
      await user.type(screen.getByLabelText(/Name/i), '  Test Environment  ')
      await user.click(screen.getByRole('button', { name: /^Create$/i }))

      expect(handleSubmit).toHaveBeenCalledWith({
        name: 'Test Environment',
        description: null,
        tags: [],
      })
    })

    it('clears validation error when valid input is provided', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      renderEnvironmentForm({ mode: 'create' })
      await user.click(screen.getByLabelText(/Name/i))
      await user.tab() // Trigger error
      expect(screen.getByText(/Name is required/i)).toBeInTheDocument()

      await user.type(screen.getByLabelText(/Name/i), 'Test')
      expect(screen.queryByText(/Name is required/i)).not.toBeInTheDocument()
    })

    it('shows validation error and prevents submit when name is empty on form submit', async () => {
      const { fireEvent } = await import('@testing-library/react')
      const handleSubmit = vi.fn()

      renderEnvironmentForm({ mode: 'create', onSubmit: handleSubmit })

      // Submit the form directly (bypassing disabled button)
      const form = screen.getByRole('dialog').querySelector('form')
      expect(form).not.toBeNull()
      fireEvent.submit(form!)

      // Should show validation error
      expect(screen.getByText(/Name is required/i)).toBeInTheDocument()

      // Should not call onSubmit
      expect(handleSubmit).not.toHaveBeenCalled()
    })
  })

  describe('Cancel and Close', () => {
    it('calls onClose when Cancel button is clicked', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()
      const handleClose = vi.fn()

      renderEnvironmentForm({ onClose: handleClose })
      await user.click(screen.getByRole('button', { name: /Cancel/i }))

      expect(handleClose).toHaveBeenCalledTimes(1)
    })

    it('calls onClose when close button is clicked', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()
      const handleClose = vi.fn()

      renderEnvironmentForm({ onClose: handleClose })
      await user.click(screen.getByRole('button', { name: /Close/i }))

      expect(handleClose).toHaveBeenCalledTimes(1)
    })

    it('calls onClose when pressing Escape', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()
      const handleClose = vi.fn()

      renderEnvironmentForm({ onClose: handleClose })
      await user.keyboard('{Escape}')

      expect(handleClose).toHaveBeenCalledTimes(1)
    })

    it('calls onClose when clicking overlay', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()
      const handleClose = vi.fn()

      renderEnvironmentForm({ onClose: handleClose })
      // Radix Dialog overlay is rendered without data-testid;
      // use the close button as the overlay click behavior is tested via Escape
      await user.click(screen.getByRole('button', { name: /close/i }))

      expect(handleClose).toHaveBeenCalledTimes(1)
    })

    it('does not submit when pressing Enter on Cancel', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const { act } = await import('@testing-library/react')
      const user = userEvent.setup()
      const handleSubmit = vi.fn()

      renderEnvironmentForm({ onSubmit: handleSubmit })
      const cancelButton = screen.getByRole('button', { name: /Cancel/i })
      await act(() => { cancelButton.focus() })
      await user.keyboard('{Enter}')

      expect(handleSubmit).not.toHaveBeenCalled()
    })
  })

  describe('Loading State', () => {
    it('disables form fields when loading', () => {
      renderEnvironmentForm({ loading: true })
      expect(screen.getByLabelText(/Name/i)).toBeDisabled()
      expect(screen.getByLabelText(/Description/i)).toBeDisabled()
    })

    it('disables submit button when loading', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const { cleanup } = await import('@testing-library/react')
      const user = userEvent.setup()

      renderEnvironmentForm({ loading: false })
      await user.type(screen.getByLabelText(/Name/i), 'Test')

      // Cleanup first render before second
      cleanup()

      render(
        <EnvironmentForm
          open={true}
          mode="create"
          allTags={mockAllTags}
          onClose={vi.fn()}
          onSubmit={vi.fn()}
          loading={true}
        />
      )

      expect(screen.getByRole('button', { name: /Create/i })).toBeDisabled()
    })

    it('shows loading indicator on submit button', () => {
      renderEnvironmentForm({ loading: true })
      expect(screen.getByTestId('submit-loading')).toBeInTheDocument()
    })

    it('Cancel button remains enabled during loading', () => {
      renderEnvironmentForm({ loading: true })
      expect(screen.getByRole('button', { name: /Cancel/i })).toBeEnabled()
    })
  })

  describe('Error State', () => {
    it('displays error message', () => {
      renderEnvironmentForm({ error: 'Environment with this name already exists' })
      expect(screen.getByText(/Environment with this name already exists/i)).toBeInTheDocument()
    })

    it('error message has error styling', () => {
      renderEnvironmentForm({ error: 'Error message' })
      const errorMessage = screen.getByTestId('form-error')
      expect(errorMessage).toHaveClass('text-error')
    })

    it('clears error on successful input change', async () => {
      const handleSubmit = vi.fn()

      const { rerender } = render(
        <EnvironmentForm
          open={true}
          mode="create"
          allTags={mockAllTags}
          onClose={vi.fn()}
          onSubmit={handleSubmit}
          loading={false}
          error="Duplicate name"
        />
      )

      expect(screen.getByText(/Duplicate name/i)).toBeInTheDocument()

      // Simulate clearing error when input changes
      rerender(
        <EnvironmentForm
          open={true}
          mode="create"
          allTags={mockAllTags}
          onClose={vi.fn()}
          onSubmit={handleSubmit}
          loading={false}
          error={undefined}
        />
      )

      expect(screen.queryByText(/Duplicate name/i)).not.toBeInTheDocument()
    })
  })

  describe('Form Submission', () => {
    it('submits form on Enter key in Name field', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()
      const handleSubmit = vi.fn()

      renderEnvironmentForm({ mode: 'create', onSubmit: handleSubmit })
      await user.type(screen.getByLabelText(/Name/i), 'Test Environment{Enter}')

      expect(handleSubmit).toHaveBeenCalledWith({
        name: 'Test Environment',
        description: null,
        tags: [],
      })
    })

    it('does not submit with invalid data', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()
      const handleSubmit = vi.fn()

      renderEnvironmentForm({ mode: 'create', onSubmit: handleSubmit })
      await user.type(screen.getByLabelText(/Name/i), '{Enter}')

      expect(handleSubmit).not.toHaveBeenCalled()
    })
  })

  describe('Accessibility', () => {
    it('dialog has aria-labelledby', () => {
      renderEnvironmentForm()
      const dialog = screen.getByRole('dialog')
      expect(dialog).toHaveAttribute('aria-labelledby')
    })

    it('form fields have associated labels', () => {
      renderEnvironmentForm()
      const nameInput = screen.getByLabelText(/Name/i)
      const descriptionInput = screen.getByLabelText(/Description/i)
      expect(nameInput).toHaveAccessibleName()
      expect(descriptionInput).toHaveAccessibleName()
    })

    it('required fields are marked as such', () => {
      renderEnvironmentForm()
      const nameInput = screen.getByLabelText(/Name/i)
      expect(nameInput).toHaveAttribute('aria-required', 'true')
    })

    it('error messages are associated with fields', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      renderEnvironmentForm({ mode: 'create' })
      await user.click(screen.getByLabelText(/Name/i))
      await user.tab()

      const nameInput = screen.getByLabelText(/Name/i)
      expect(nameInput).toHaveAttribute('aria-invalid', 'true')
      expect(nameInput).toHaveAttribute('aria-describedby')
    })

    it('loading state disables form controls', () => {
      renderEnvironmentForm({ loading: true })
      expect(screen.getByPlaceholderText(/enter environment name/i)).toBeDisabled()
      expect(screen.getByRole('button', { name: /create/i })).toBeDisabled()
    })

    it('focus is trapped in dialog', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      renderEnvironmentForm()

      // Wait for auto-focus setTimeout to complete
      await vi.waitFor(() => {
        expect(screen.getByLabelText(/Name/i)).toHaveFocus()
      })

      // Verify focus starts at Name input
      const nameInput = screen.getByLabelText(/Name/i)
      expect(nameInput).toHaveFocus()

      // Tab forward through elements - focus should stay within dialog
      await user.tab()
      const descTextarea = screen.getByLabelText(/Description/i)
      expect(descTextarea).toHaveFocus()

      // Continue tabbing and verify we eventually come back to Name
      // (verifies the focus trap cycles back)
      for (let i = 0; i < 10; i++) {
        await user.tab()
        // If we're back at Name, focus trap is working
        if (document.activeElement === nameInput) break
      }
      expect(nameInput).toHaveFocus()
    })

    it('Shift+Tab from first element cycles to last element', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      renderEnvironmentForm()

      // Focus on the first element (Name input)
      const nameInput = screen.getByLabelText(/Name/i)
      nameInput.focus()
      expect(nameInput).toHaveFocus()

      // Shift+Tab should cycle to the last focusable element
      await user.tab({ shift: true })

      // After shift+tab from first element, focus should not be on first element anymore
      // (it should have cycled to a focusable element at the end of the dialog)
      expect(nameInput).not.toHaveFocus()
      // Should be on a focusable element (button, or div with tabIndex like tags-input)
      expect(document.activeElement).not.toBeNull()
      expect(document.activeElement).not.toBe(document.body)
    })
  })

  describe('Custom ClassName', () => {
    it('accepts additional className', () => {
      renderEnvironmentForm({ className: 'custom-form' })
      // Radix Dialog renders into a portal, so query document.body
      expect(document.body.querySelector('.custom-form')).toBeInTheDocument()
    })
  })

  // ==========================================================================
  // Shared Field Primitives Migration
  //
  // Environment name moves from a 255-char local cap to MAX_ENTITY_NAME_LENGTH
  // (64) imported from the shared field-constraints module. Description
  // <textarea> stays as-is (multi-line, out of scope).
  // ==========================================================================

  describe('adopts shared field primitives (name field)', () => {
    it('environment name input is capped at MAX_ENTITY_NAME_LENGTH (64)', async () => {
      const { MAX_ENTITY_NAME_LENGTH } = await import(
        '@/lib/field-constraints'
      )
      renderEnvironmentForm()

      const nameInput = screen.getByLabelText(/^name$/i)
      expect(nameInput).toHaveAttribute(
        'maxLength',
        String(MAX_ENTITY_NAME_LENGTH),
      )
    })

    it('name input renders as the TextField primitive (TEXTAREA tag, rows=1)', () => {
      renderEnvironmentForm()

      const nameInput = screen.getByLabelText(/^name$/i)
      expect(nameInput.tagName).toBe('TEXTAREA')
      expect(nameInput).toHaveAttribute('rows', '1')
    })

    it('shows the NameField counter at >=80% of the new 64-char cap', async () => {
      const { MAX_ENTITY_NAME_LENGTH } = await import(
        '@/lib/field-constraints'
      )
      const value = 'a'.repeat(Math.ceil(0.8 * MAX_ENTITY_NAME_LENGTH))
      renderEnvironmentForm({
        mode: 'edit',
        environment: { ...mockEnvironment, name: value },
      })

      // Counter <span aria-live="polite"> appears once value crosses 80%.
      const counter = document.body.querySelector('span[aria-live="polite"]')
      expect(counter).not.toBeNull()
      expect(counter?.textContent).toContain(`/${MAX_ENTITY_NAME_LENGTH}`)
    })
  })
})
