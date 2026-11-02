/**
 * Suite Create Modal Tests
 */

import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SuiteCreateModal } from '@/features/suites/components/suite-create-modal'

describe('SuiteCreateModal', () => {
  const defaultProps = {
    open: true,
    allTags: ['smoke', 'api', 'regression'],
    onClose: vi.fn(),
    onSubmit: vi.fn(),
  }

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('renders modal when open is true', () => {
    render(<SuiteCreateModal {...defaultProps} />)
    expect(screen.getByTestId('suite-create-modal')).toBeInTheDocument()
    expect(screen.getByText('Create Suite')).toBeInTheDocument()
  })

  it('does not render when open is false', () => {
    render(<SuiteCreateModal {...defaultProps} open={false} />)
    expect(screen.queryByTestId('suite-create-modal')).not.toBeInTheDocument()
  })

  it('renders name, description, and tags fields', () => {
    render(<SuiteCreateModal {...defaultProps} />)
    expect(screen.getByTestId('suite-name-input')).toBeInTheDocument()
    expect(screen.getByTestId('suite-description-input')).toBeInTheDocument()
    expect(screen.getByText('Tags')).toBeInTheDocument()
  })

  it('shows validation error when submitting with empty name', async () => {
    render(<SuiteCreateModal {...defaultProps} />)

    fireEvent.click(screen.getByTestId('suite-create-submit'))

    await waitFor(() => {
      expect(screen.getByText('Name is required')).toBeInTheDocument()
    })
    expect(defaultProps.onSubmit).not.toHaveBeenCalled()
  })

  it('calls onSubmit with trimmed data when name is valid', async () => {
    const user = userEvent.setup()
    render(<SuiteCreateModal {...defaultProps} />)

    await user.type(screen.getByTestId('suite-name-input'), '  My Suite  ')
    await user.type(screen.getByTestId('suite-description-input'), ' A description ')
    fireEvent.click(screen.getByTestId('suite-create-submit'))

    await waitFor(() => {
      expect(defaultProps.onSubmit).toHaveBeenCalledWith({
        name: 'My Suite',
        description: 'A description',
        tags: [],
      })
    })
  })

  it('calls onClose when Cancel is clicked', async () => {
    const user = userEvent.setup()
    render(<SuiteCreateModal {...defaultProps} />)

    await user.click(screen.getByText('Cancel'))

    expect(defaultProps.onClose).toHaveBeenCalled()
  })

  it('disables inputs and submit when loading', () => {
    render(<SuiteCreateModal {...defaultProps} loading />)

    expect(screen.getByTestId('suite-name-input')).toBeDisabled()
    expect(screen.getByTestId('suite-description-input')).toBeDisabled()
    expect(screen.getByTestId('suite-create-submit')).toBeDisabled()
  })

  it('displays error message when error prop is provided', () => {
    render(<SuiteCreateModal {...defaultProps} error="Suite name already exists" />)

    expect(screen.getByText('Suite name already exists')).toBeInTheDocument()
  })

  it('does not show error when error is null', () => {
    render(<SuiteCreateModal {...defaultProps} error={null} />)

    expect(screen.queryByText('Suite name already exists')).not.toBeInTheDocument()
  })

  it('resets form state when reopened', async () => {
    const { rerender } = render(<SuiteCreateModal {...defaultProps} />)

    // Type something
    const user = userEvent.setup()
    await user.type(screen.getByTestId('suite-name-input'), 'Test')

    // Close and reopen
    rerender(<SuiteCreateModal {...defaultProps} open={false} />)
    rerender(<SuiteCreateModal {...defaultProps} open={true} />)

    expect(screen.getByTestId('suite-name-input')).toHaveValue('')
  })

  it('clears name error when user starts typing', async () => {
    const user = userEvent.setup()
    render(<SuiteCreateModal {...defaultProps} />)

    // Trigger validation error
    fireEvent.click(screen.getByTestId('suite-create-submit'))
    await waitFor(() => {
      expect(screen.getByText('Name is required')).toBeInTheDocument()
    })

    // Type to clear error
    await user.type(screen.getByTestId('suite-name-input'), 'A')
    expect(screen.queryByText('Name is required')).not.toBeInTheDocument()
  })

  it('submit button is enabled when not loading', () => {
    render(<SuiteCreateModal {...defaultProps} />)

    expect(screen.getByTestId('suite-create-submit')).toBeEnabled()
  })
})
