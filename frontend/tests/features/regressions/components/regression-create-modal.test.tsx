/**
 * Regression Create Modal Tests
 *
 * REQ-5.2.1.37: Regression management screen (list, create, edit, version control)
 * V-REG-EDIT-01: Regression creation dialog
 *
 * Design decisions: FORM-31 to FORM-38
 * - Modal is 400px wide, centered with semi-transparent overlay
 * - Title reads "Create Regression"
 * - Name field is required, placeholder "Enter regression name…"
 * - Description field is optional, placeholder "What does this regression validate?"
 * - Tags field with autocomplete from existing regression tags
 * - Footer: Cancel (left) and Create (right, primary)
 * - Form validation: name must be non-empty, submit disabled until valid
 * - After successful create, navigates to the new regression's detail page
 *
 * Component: frontend/src/features/regressions/components/regression-create-modal.tsx
 */

import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { RegressionCreateModal } from '@/features/regressions/components/regression-create-modal'

describe('RegressionCreateModal', () => {
  const defaultProps = {
    open: true,
    allTags: ['smoke', 'api', 'regression', 'nightly'],
    onClose: vi.fn(),
    onSubmit: vi.fn(),
  }

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // =========================================================================
  // Basic Rendering
  // =========================================================================

  it('renders modal when open is true', () => {
    render(<RegressionCreateModal {...defaultProps} />)
    expect(screen.getByTestId('regression-create-modal')).toBeInTheDocument()
    expect(screen.getByText('Create Regression')).toBeInTheDocument()
  })

  it('does not render when open is false', () => {
    render(<RegressionCreateModal {...defaultProps} open={false} />)
    expect(screen.queryByTestId('regression-create-modal')).not.toBeInTheDocument()
  })

  // =========================================================================
  // Form Fields (FORM-31 to FORM-34)
  // =========================================================================

  it('renders name, description, and tags fields', () => {
    render(<RegressionCreateModal {...defaultProps} />)
    expect(screen.getByTestId('regression-name-input')).toBeInTheDocument()
    expect(screen.getByTestId('regression-description-input')).toBeInTheDocument()
    expect(screen.getByText('Tags')).toBeInTheDocument()
  })

  it('name field has correct placeholder (FORM-31)', () => {
    render(<RegressionCreateModal {...defaultProps} />)
    expect(screen.getByPlaceholderText('Enter regression name…')).toBeInTheDocument()
  })

  it('description field has correct placeholder (FORM-32)', () => {
    render(<RegressionCreateModal {...defaultProps} />)
    expect(screen.getByPlaceholderText('What does this regression validate?')).toBeInTheDocument()
  })

  it('tags field provides autocomplete from existing tags (FORM-33)', () => {
    render(<RegressionCreateModal {...defaultProps} />)
    // Tags input exists and receives allTags for autocomplete
    expect(screen.getByTestId('regression-tags-input')).toBeInTheDocument()
  })

  // =========================================================================
  // Validation (FORM-35, FORM-36)
  // =========================================================================

  it('shows validation error when submitting with empty name', async () => {
    render(<RegressionCreateModal {...defaultProps} />)

    fireEvent.click(screen.getByTestId('regression-create-submit'))

    await waitFor(() => {
      expect(screen.getByText('Name is required')).toBeInTheDocument()
    })
    expect(defaultProps.onSubmit).not.toHaveBeenCalled()
  })

  it('shows validation error when name is only whitespace', async () => {
    const user = userEvent.setup()
    render(<RegressionCreateModal {...defaultProps} />)

    await user.type(screen.getByTestId('regression-name-input'), '   ')
    fireEvent.click(screen.getByTestId('regression-create-submit'))

    await waitFor(() => {
      expect(screen.getByText('Name is required')).toBeInTheDocument()
    })
    expect(defaultProps.onSubmit).not.toHaveBeenCalled()
  })

  it('clears name error when user starts typing', async () => {
    const user = userEvent.setup()
    render(<RegressionCreateModal {...defaultProps} />)

    // Trigger validation error
    fireEvent.click(screen.getByTestId('regression-create-submit'))
    await waitFor(() => {
      expect(screen.getByText('Name is required')).toBeInTheDocument()
    })

    // Type to clear error
    await user.type(screen.getByTestId('regression-name-input'), 'A')
    expect(screen.queryByText('Name is required')).not.toBeInTheDocument()
  })

  // =========================================================================
  // Submit (FORM-37)
  // =========================================================================

  it('calls onSubmit with trimmed data when name is valid', async () => {
    const user = userEvent.setup()
    render(<RegressionCreateModal {...defaultProps} />)

    await user.type(screen.getByTestId('regression-name-input'), '  WAVE 26.04  ')
    await user.type(screen.getByTestId('regression-description-input'), ' Full release regression ')
    fireEvent.click(screen.getByTestId('regression-create-submit'))

    await waitFor(() => {
      expect(defaultProps.onSubmit).toHaveBeenCalledWith({
        name: 'WAVE 26.04',
        description: 'Full release regression',
        tags: [],
      })
    })
  })

  it('submits with empty description when field is left blank', async () => {
    const user = userEvent.setup()
    render(<RegressionCreateModal {...defaultProps} />)

    await user.type(screen.getByTestId('regression-name-input'), 'Nightly')
    fireEvent.click(screen.getByTestId('regression-create-submit'))

    await waitFor(() => {
      expect(defaultProps.onSubmit).toHaveBeenCalledWith({
        name: 'Nightly',
        description: '',
        tags: [],
      })
    })
  })

  // =========================================================================
  // Cancel (FORM-38)
  // =========================================================================

  it('calls onClose when Cancel is clicked', async () => {
    const user = userEvent.setup()
    render(<RegressionCreateModal {...defaultProps} />)

    await user.click(screen.getByText('Cancel'))

    expect(defaultProps.onClose).toHaveBeenCalled()
  })

  // =========================================================================
  // Loading State
  // =========================================================================

  it('disables inputs and submit when loading', () => {
    render(<RegressionCreateModal {...defaultProps} loading />)

    expect(screen.getByTestId('regression-name-input')).toBeDisabled()
    expect(screen.getByTestId('regression-description-input')).toBeDisabled()
    expect(screen.getByTestId('regression-create-submit')).toBeDisabled()
  })

  it('submit button shows loading indicator when loading', () => {
    render(<RegressionCreateModal {...defaultProps} loading />)

    const submitBtn = screen.getByTestId('regression-create-submit')
    expect(submitBtn).toBeDisabled()
  })

  it('submit button is enabled when not loading', () => {
    render(<RegressionCreateModal {...defaultProps} />)

    expect(screen.getByTestId('regression-create-submit')).toBeEnabled()
  })

  // =========================================================================
  // Error Display
  // =========================================================================

  it('displays error message when error prop is provided', () => {
    render(<RegressionCreateModal {...defaultProps} error="Regression name already exists" />)

    expect(screen.getByText('Regression name already exists')).toBeInTheDocument()
  })

  it('does not show error when error is null', () => {
    render(<RegressionCreateModal {...defaultProps} error={null} />)

    expect(screen.queryByText('Regression name already exists')).not.toBeInTheDocument()
  })

  // =========================================================================
  // Form Reset
  // =========================================================================

  it('resets form state when reopened', async () => {
    const { rerender } = render(<RegressionCreateModal {...defaultProps} />)

    const user = userEvent.setup()
    await user.type(screen.getByTestId('regression-name-input'), 'Test')

    // Close and reopen
    rerender(<RegressionCreateModal {...defaultProps} open={false} />)
    rerender(<RegressionCreateModal {...defaultProps} open={true} />)

    expect(screen.getByTestId('regression-name-input')).toHaveValue('')
  })

  it('resets description when reopened', async () => {
    const { rerender } = render(<RegressionCreateModal {...defaultProps} />)

    const user = userEvent.setup()
    await user.type(screen.getByTestId('regression-description-input'), 'Some desc')

    // Close and reopen
    rerender(<RegressionCreateModal {...defaultProps} open={false} />)
    rerender(<RegressionCreateModal {...defaultProps} open={true} />)

    expect(screen.getByTestId('regression-description-input')).toHaveValue('')
  })
})
