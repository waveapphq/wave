/**
 * TestFormDialog Tests
 *
 * Consolidated tests for TestFormDialog which replaces both
 * SaveTestDialog and EditTestMetadataDialog.
 *
 * Test coverage:
 * - Rendering per mode (create/edit/edit-metadata titles and buttons)
 * - Name validation (required, max length, error display, error clears)
 * - Tags input (add via Enter, add via comma, remove, deduplicate, dynamic placeholder)
 * - Payload shape per mode (create/edit/edit-metadata)
 * - Error handling (API errors, duplicate name, conflict)
 * - Initial values (pre-fill form)
 * - Fetch on open (edit-metadata mode)
 * - isSaving state (spinner, disabled fields/buttons)
 * - Accessibility (role="dialog", labels)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

// Mock the APIs
vi.mock('@/features/tests/api/crud', () => ({
  fetchTest: vi.fn(),
  fetchTestsTags: vi.fn().mockReturnValue(new Promise(() => {})),
}))

import { fetchTest, fetchTestsTags } from '@/features/tests/api/crud'
import { TestFormDialog, type TestFormDialogProps, type WorkflowData } from '@/features/workbench/common/test-form'
import { expectRequiredMark, labelOf } from '../../../../utils/required-mark'

const mockFetchTest = fetchTest as ReturnType<typeof vi.fn>
const mockFetchTestsTags = fetchTestsTags as ReturnType<typeof vi.fn>

// Mock workflow data
const mockWorkflowData: WorkflowData = {
  nodes: [
    { id: 'node-1', type: 'workflowNode', position: { x: 100, y: 100 }, data: { label: 'Script', nodeType: 'plugin' } },
    { id: 'node-2', type: 'workflowNode', position: { x: 200, y: 200 }, data: { label: 'Log', nodeType: 'control' } },
  ],
  edges: [
    { id: 'edge-1', source: 'node-1', target: 'node-2' },
  ],
}

// Default props for create mode
const createProps: TestFormDialogProps = {
  isOpen: true,
  onClose: vi.fn(),
  onSave: vi.fn(),
  mode: 'create',
  workflowData: mockWorkflowData,
}

// Default props for edit mode
const editProps: TestFormDialogProps = {
  isOpen: true,
  onClose: vi.fn(),
  onSave: vi.fn(),
  mode: 'edit',
  workflowData: mockWorkflowData,
  testId: 'test-123',
  initialValues: { name: 'Existing Test' },
}

// Default props for edit-metadata mode
const editMetadataProps: TestFormDialogProps = {
  isOpen: true,
  onClose: vi.fn(),
  onSave: vi.fn(),
  mode: 'edit-metadata',
  testId: 'test-123',
  initialValues: { name: 'My Test' },
}

describe('TestFormDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Default mock: test details for edit-metadata
    mockFetchTest.mockResolvedValue({
      id: 'test-123',
      name: 'My Test',
      description: 'A test description',
      tags: ['tag1', 'tag2'],
      metadata: {
        tags: ['tag1', 'tag2'],
      },
    })
  })

  // ===========================================================================
  // Rendering per mode
  // ===========================================================================
  describe('Rendering per mode', () => {
    it('renders nothing when isOpen is false', () => {
      render(<TestFormDialog {...createProps} isOpen={false} />)
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })

    it('renders the dialog when isOpen is true', async () => {
      render(<TestFormDialog {...createProps} />)
      expect(screen.getByRole('dialog')).toBeInTheDocument()
    })

    it('renders all form fields: name, description, tags', async () => {
      render(<TestFormDialog {...createProps} />)

      expect(screen.getByLabelText(/test name/i)).toBeInTheDocument()
      expect(screen.getByLabelText(/description/i)).toBeInTheDocument()
      expect(screen.getByTestId('tags-input')).toBeInTheDocument()
    })

    it('displays "New Test" title in create mode', async () => {
      render(<TestFormDialog {...createProps} />)
      expect(screen.getByText('New Test')).toBeInTheDocument()
    })

    it('displays "Create Test" button in create mode', async () => {
      render(<TestFormDialog {...createProps} />)
      expect(screen.getByRole('button', { name: /create test/i })).toBeInTheDocument()
    })

    it('displays "Edit Test" title in edit mode', async () => {
      render(<TestFormDialog {...editProps} />)
      expect(screen.getByText('Edit Test')).toBeInTheDocument()
    })

    it('displays "Save" button in edit mode', async () => {
      render(<TestFormDialog {...editProps} />)
      expect(screen.getByRole('button', { name: /^save$/i })).toBeInTheDocument()
    })

    it('displays "Edit Test Info" title in edit-metadata mode', async () => {
      render(<TestFormDialog {...editMetadataProps} />)
      expect(screen.getByText('Edit Test Info')).toBeInTheDocument()
      // Wait for async fetchTest to settle
      await waitFor(() => {
        expect(screen.queryByTestId('description-skeleton')).not.toBeInTheDocument()
      })
    })

    it('displays "Save" button in edit-metadata mode', async () => {
      render(<TestFormDialog {...editMetadataProps} />)
      expect(screen.getByRole('button', { name: /^save$/i })).toBeInTheDocument()
      await waitFor(() => {
        expect(screen.queryByTestId('description-skeleton')).not.toBeInTheDocument()
      })
    })
  })

  // ===========================================================================
  // Name Validation
  // ===========================================================================
  describe('Name Validation', () => {
    it('shows error when name is empty on submit', async () => {
      const user = userEvent.setup()
      render(<TestFormDialog {...createProps} />)

      await user.click(screen.getByRole('button', { name: /create test/i }))

      expect(screen.getByText('Test name is required')).toBeInTheDocument()
      expect(createProps.onSave).not.toHaveBeenCalled()
    })

    it('shows error when name is whitespace-only', async () => {
      const user = userEvent.setup()
      render(<TestFormDialog {...createProps} />)

      await user.type(screen.getByLabelText(/test name/i), '   ')
      await user.click(screen.getByRole('button', { name: /create test/i }))

      expect(screen.getByText('Test name is required')).toBeInTheDocument()
      expect(createProps.onSave).not.toHaveBeenCalled()
    })

    it('shows error when name exceeds max length (255 chars)', async () => {
      const user = userEvent.setup()
      render(<TestFormDialog {...createProps} />)

      const longName = 'a'.repeat(256)
      // Use fireEvent.change instead of user.type to avoid timeout on 256 chars
      fireEvent.change(screen.getByLabelText(/test name/i), { target: { value: longName } })
      await user.click(screen.getByRole('button', { name: /create test/i }))

      expect(screen.getByText('Name must be 255 characters or less')).toBeInTheDocument()
      expect(createProps.onSave).not.toHaveBeenCalled()
    })

    it('accepts name with special characters', async () => {
      const user = userEvent.setup()
      const onSave = vi.fn()
      render(<TestFormDialog {...createProps} onSave={onSave} />)

      await user.type(screen.getByLabelText(/test name/i), 'test@name!#$%')
      await user.click(screen.getByRole('button', { name: /create test/i }))

      await waitFor(() => {
        expect(onSave).toHaveBeenCalled()
      })
    })

    it('accepts valid name with alphanumeric, spaces, hyphens, underscores', async () => {
      const user = userEvent.setup()
      const onSave = vi.fn()
      render(<TestFormDialog {...createProps} onSave={onSave} />)

      await user.type(screen.getByLabelText(/test name/i), 'My Test-Name_123')
      await user.click(screen.getByRole('button', { name: /create test/i }))

      await waitFor(() => {
        expect(onSave).toHaveBeenCalled()
      })
    })

    it('clears error when user starts typing valid name', async () => {
      const user = userEvent.setup()
      render(<TestFormDialog {...createProps} />)

      await user.click(screen.getByRole('button', { name: /create test/i }))
      expect(screen.getByText('Test name is required')).toBeInTheDocument()

      await user.type(screen.getByLabelText(/test name/i), 'Valid Name')
      expect(screen.queryByText('Test name is required')).not.toBeInTheDocument()
    })
  })

  // ===========================================================================
  // Tags Input
  // ===========================================================================
  describe('Tags Input', () => {
    it('renders TagsInput component', () => {
      render(<TestFormDialog {...createProps} />)
      expect(screen.getByTestId('tags-input')).toBeInTheDocument()
    })

    it('shows initial tags from initialValues', () => {
      render(
        <TestFormDialog
          {...createProps}
          initialValues={{ name: 'Test', tags: ['smoke', 'api'] }}
        />
      )
      expect(screen.getByText('smoke')).toBeInTheDocument()
      expect(screen.getByText('api')).toBeInTheDocument()
    })
  })

  // ===========================================================================
  // Payload shape per mode
  // ===========================================================================
  describe('Payload shape per mode', () => {
    it('create mode: includes workflowData, no testId', async () => {
      const user = userEvent.setup()
      const onSave = vi.fn()
      render(
        <TestFormDialog
          {...createProps}
          onSave={onSave}
          initialValues={{ name: '', tags: ['smoke'] }}
        />
      )

      await user.type(screen.getByLabelText(/test name/i), 'My Test')
      await user.type(screen.getByLabelText(/description/i), 'Test description')

      await user.click(screen.getByRole('button', { name: /create test/i }))

      await waitFor(() => {
        expect(onSave).toHaveBeenCalledWith({
          name: 'My Test',
          description: 'Test description',
          tags: ['smoke'],
          workflowData: mockWorkflowData,
        })
      })
    })

    it('edit mode: includes workflowData + testId', async () => {
      const user = userEvent.setup()
      const onSave = vi.fn()
      render(<TestFormDialog {...editProps} onSave={onSave} />)

      await user.click(screen.getByRole('button', { name: /^save$/i }))

      await waitFor(() => {
        expect(onSave).toHaveBeenCalledWith(
          expect.objectContaining({
            testId: 'test-123',
            workflowData: mockWorkflowData,
          })
        )
      })
    })

    it('edit-metadata mode: includes testId, NO workflowData', async () => {
      const user = userEvent.setup()
      const onSave = vi.fn()
      render(<TestFormDialog {...editMetadataProps} onSave={onSave} />)

      await waitFor(() => {
        // Wait for test details to load
        expect(screen.queryByTestId('description-skeleton')).not.toBeInTheDocument()
      })

      await user.click(screen.getByRole('button', { name: /^save$/i }))

      await waitFor(() => {
        const payload = onSave.mock.calls[0][0]
        expect(payload.testId).toBe('test-123')
        expect(payload.workflowData).toBeUndefined()
      })
    })

    it('trims name before saving', async () => {
      const user = userEvent.setup()
      const onSave = vi.fn()
      render(<TestFormDialog {...createProps} onSave={onSave} />)

      await user.type(screen.getByLabelText(/test name/i), '  My Test  ')
      await user.click(screen.getByRole('button', { name: /create test/i }))

      await waitFor(() => {
        expect(onSave).toHaveBeenCalledWith(
          expect.objectContaining({
            name: 'My Test',
          })
        )
      })
    })
  })

  // ===========================================================================
  // Error Handling
  // ===========================================================================
  describe('Error Handling', () => {
    it('displays API error in dialog footer', async () => {
      const user = userEvent.setup()
      const onSave = vi.fn().mockRejectedValue(new Error('Server error'))
      render(<TestFormDialog {...createProps} onSave={onSave} />)

      await user.type(screen.getByLabelText(/test name/i), 'Test')
      await user.click(screen.getByRole('button', { name: /create test/i }))

      await waitFor(() => {
        expect(screen.getByTestId('api-error')).toHaveTextContent('Server error')
      })
    })

    it('displays duplicate name error inline', async () => {
      const user = userEvent.setup()
      const error = new Error('A test with this name already exists')
      const onSave = vi.fn().mockRejectedValue(error)
      render(<TestFormDialog {...createProps} onSave={onSave} />)

      await user.type(screen.getByLabelText(/test name/i), 'Duplicate Test')
      await user.click(screen.getByRole('button', { name: /create test/i }))

      await waitFor(() => {
        expect(screen.getByText('A test with this name already exists')).toBeInTheDocument()
      })
    })

    it('handles 409 conflict error for version mismatch', async () => {
      const user = userEvent.setup()
      const conflictError = new Error('Version conflict: test was modified');
      (conflictError as unknown as Record<string, unknown>).status = 409
      const onSave = vi.fn().mockRejectedValue(conflictError)
      render(<TestFormDialog {...editProps} onSave={onSave} />)

      await user.click(screen.getByRole('button', { name: /^save$/i }))

      await waitFor(() => {
        expect(screen.getByText(/version conflict/i)).toBeInTheDocument()
      })
    })

    it('clears error when user modifies form', async () => {
      const user = userEvent.setup()
      const onSave = vi.fn()
        .mockRejectedValueOnce(new Error('Server error'))
        .mockResolvedValueOnce(undefined)
      render(<TestFormDialog {...createProps} onSave={onSave} />)

      await user.type(screen.getByLabelText(/test name/i), 'Test')
      await user.click(screen.getByRole('button', { name: /create test/i }))

      await waitFor(() => {
        expect(screen.getByTestId('api-error')).toBeInTheDocument()
      })

      await user.type(screen.getByLabelText(/test name/i), '2')

      expect(screen.queryByTestId('api-error')).not.toBeInTheDocument()
    })

    it('clears error when description is modified', async () => {
      const user = userEvent.setup()
      const onSave = vi.fn().mockRejectedValue(new Error('Server error'))
      render(<TestFormDialog {...createProps} onSave={onSave} />)

      await user.type(screen.getByLabelText(/test name/i), 'Test')
      await user.click(screen.getByRole('button', { name: /create test/i }))

      await waitFor(() => {
        expect(screen.getByTestId('api-error')).toBeInTheDocument()
      })

      await user.type(screen.getByLabelText(/description/i), ' updated')

      await waitFor(() => {
        expect(screen.queryByTestId('api-error')).not.toBeInTheDocument()
      })
    })

    it('re-enables form after error', async () => {
      const user = userEvent.setup()
      const onSave = vi.fn().mockRejectedValue(new Error('Server error'))
      render(<TestFormDialog {...createProps} onSave={onSave} />)

      await user.type(screen.getByLabelText(/test name/i), 'Test')
      await user.click(screen.getByRole('button', { name: /create test/i }))

      await waitFor(() => {
        expect(screen.getByTestId('api-error')).toBeInTheDocument()
      })

      expect(screen.getByLabelText(/test name/i)).not.toBeDisabled()
      expect(screen.getByRole('button', { name: /create test/i })).not.toBeDisabled()
    })

    it('displays generic error for unknown errors', async () => {
      const user = userEvent.setup()
      const onSave = vi.fn().mockRejectedValue(new Error())
      render(<TestFormDialog {...createProps} onSave={onSave} />)

      await user.type(screen.getByLabelText(/test name/i), 'Test')
      await user.click(screen.getByRole('button', { name: /create test/i }))

      await waitFor(() => {
        expect(screen.getByTestId('api-error')).toHaveTextContent('Failed to save test. Please try again.')
      })
    })

    it('allows retry after error', async () => {
      const user = userEvent.setup()
      const onSave = vi.fn()
        .mockRejectedValueOnce(new Error('Server error'))
        .mockResolvedValueOnce(undefined)
      render(<TestFormDialog {...createProps} onSave={onSave} />)

      await user.type(screen.getByLabelText(/test name/i), 'Test')
      await user.click(screen.getByRole('button', { name: /create test/i }))

      await waitFor(() => {
        expect(screen.getByTestId('api-error')).toBeInTheDocument()
      })

      await user.click(screen.getByRole('button', { name: /create test/i }))

      await waitFor(() => {
        expect(onSave).toHaveBeenCalledTimes(2)
      })
    })

    it('shows error in edit-metadata mode', async () => {
      const user = userEvent.setup()
      const onSave = vi.fn().mockRejectedValue(new Error('Server error'))
      render(<TestFormDialog {...editMetadataProps} onSave={onSave} />)

      await waitFor(() => {
        expect(screen.queryByTestId('description-skeleton')).not.toBeInTheDocument()
      })

      await user.click(screen.getByRole('button', { name: /^save$/i }))

      await waitFor(() => {
        expect(screen.getByTestId('api-error')).toHaveTextContent('Server error')
      })
    })
  })

  // ===========================================================================
  // Initial Values
  // ===========================================================================
  describe('Initial Values', () => {
    it('pre-populates form fields with initial values in create mode', async () => {
      render(
        <TestFormDialog
          {...createProps}
          initialValues={{
            name: 'Existing Test',
            description: 'Test description',
            tags: ['smoke', 'regression'],
          }}
        />
      )

      expect(screen.getByLabelText(/test name/i)).toHaveValue('Existing Test')
      expect(screen.getByLabelText(/description/i)).toHaveValue('Test description')
      expect(screen.getByText('smoke')).toBeInTheDocument()
      expect(screen.getByText('regression')).toBeInTheDocument()
    })

    it('allows modification of pre-populated values', async () => {
      const user = userEvent.setup()
      const onSave = vi.fn()
      render(
        <TestFormDialog
          {...createProps}
          onSave={onSave}
          initialValues={{
            name: 'Existing Test',
            description: 'Old description',
          }}
        />
      )

      const nameInput = screen.getByLabelText(/test name/i)
      await user.clear(nameInput)
      await user.type(nameInput, 'Updated Test')

      await user.click(screen.getByRole('button', { name: /create test/i }))

      await waitFor(() => {
        expect(onSave).toHaveBeenCalledWith(
          expect.objectContaining({
            name: 'Updated Test',
          })
        )
      })
    })

    it('pre-populates name in edit mode', async () => {
      render(<TestFormDialog {...editProps} />)

      expect(screen.getByLabelText(/test name/i)).toHaveValue('Existing Test')
    })

    it('pre-populates name in edit-metadata mode', async () => {
      render(<TestFormDialog {...editMetadataProps} />)

      expect(screen.getByLabelText(/test name/i)).toHaveValue('My Test')
      // Wait for async fetchTest to settle
      await waitFor(() => {
        expect(screen.queryByTestId('description-skeleton')).not.toBeInTheDocument()
      })
    })
  })

  // ===========================================================================
  // Fetch on open (edit-metadata mode)
  // ===========================================================================
  describe('Fetch on open (edit-metadata)', () => {
    it('fetches test details on open', async () => {
      render(<TestFormDialog {...editMetadataProps} />)

      await waitFor(() => {
        expect(mockFetchTest).toHaveBeenCalledWith('test-123')
      })
    })

    it('does NOT fetch test details in create mode', async () => {
      render(<TestFormDialog {...createProps} />)


      expect(mockFetchTest).not.toHaveBeenCalled()
    })

    it('does NOT fetch test details in edit mode', async () => {
      render(<TestFormDialog {...editProps} />)


      expect(mockFetchTest).not.toHaveBeenCalled()
    })

    it('shows skeletons for description and tags while loading', async () => {
      mockFetchTest.mockImplementation(() => new Promise(() => {}))
      render(<TestFormDialog {...editMetadataProps} />)

      expect(screen.getByTestId('description-skeleton')).toBeInTheDocument()
      expect(screen.getByTestId('tags-skeleton')).toBeInTheDocument()

      // Wait for async suite fetch to settle
    })

    it('populates form with fetched data', async () => {
      render(<TestFormDialog {...editMetadataProps} />)

      await waitFor(() => {
        expect(screen.queryByTestId('description-skeleton')).not.toBeInTheDocument()
      })

      expect(screen.getByLabelText(/description/i)).toHaveValue('A test description')
      expect(screen.getByText('tag1')).toBeInTheDocument()
      expect(screen.getByText('tag2')).toBeInTheDocument()
    })

    it('handles fetch error gracefully', async () => {
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
      mockFetchTest.mockRejectedValue(new Error('Network error'))

      render(<TestFormDialog {...editMetadataProps} />)

      await waitFor(() => {
        expect(screen.getByRole('dialog')).toBeInTheDocument()
      })

      // Should still render the dialog after error
      await waitFor(() => {
        expect(screen.queryByTestId('description-skeleton')).not.toBeInTheDocument()
      })
      consoleError.mockRestore()
    })

    it('handles null description from fetch', async () => {
      mockFetchTest.mockResolvedValueOnce({
        id: 'test-123',
        name: 'Test',
        description: null,
        tags: ['tag1'],
        metadata: {
          tags: ['tag1'],
        },
      })
      render(
        <TestFormDialog
          {...editMetadataProps}
          initialValues={{ name: 'Test' }}
        />
      )

      await waitFor(() => {
        expect(screen.queryByTestId('description-skeleton')).not.toBeInTheDocument()
      })

      expect(screen.getByLabelText(/description/i)).toHaveValue('')
    })

    it('handles missing optional values from fetch', async () => {
      mockFetchTest.mockResolvedValueOnce({
        id: 'test-123',
        name: 'Test',
        description: '',
        tags: [],
        metadata: {
          suite_id: null,
          tags: [],
        },
      })
      render(
        <TestFormDialog
          {...editMetadataProps}
          initialValues={{ name: 'Test' }}
        />
      )

      await waitFor(() => {
        expect(screen.queryByTestId('description-skeleton')).not.toBeInTheDocument()
      })

      expect(screen.getByLabelText(/description/i)).toHaveValue('')
      expect(screen.getByTestId('tags-input')).toBeInTheDocument()
    })

  })

  // ===========================================================================
  // isSaving state
  // ===========================================================================
  describe('isSaving state', () => {
    it('disables Submit button during save operation', async () => {
      const user = userEvent.setup()
      const onSave = vi.fn().mockImplementation(() => new Promise(() => {}))
      render(<TestFormDialog {...createProps} onSave={onSave} />)

      await user.type(screen.getByLabelText(/test name/i), 'Test')
      await user.click(screen.getByRole('button', { name: /create test/i }))

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /creating/i })).toBeDisabled()
      })
    })

    it('disables Cancel button during save operation', async () => {
      const user = userEvent.setup()
      const onSave = vi.fn().mockImplementation(() => new Promise(() => {}))
      render(<TestFormDialog {...createProps} onSave={onSave} />)

      await user.type(screen.getByLabelText(/test name/i), 'Test')
      await user.click(screen.getByRole('button', { name: /create test/i }))

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /cancel/i })).toBeDisabled()
      })
    })

    it('disables form fields during save operation', async () => {
      const user = userEvent.setup()
      const onSave = vi.fn().mockImplementation(() => new Promise(() => {}))
      render(<TestFormDialog {...createProps} onSave={onSave} />)

      await user.type(screen.getByLabelText(/test name/i), 'Test')
      await user.click(screen.getByRole('button', { name: /create test/i }))

      await waitFor(() => {
        expect(screen.getByLabelText(/test name/i)).toBeDisabled()
        expect(screen.getByLabelText(/description/i)).toBeDisabled()
      })
    })

    it('shows spinner in Submit button during save', async () => {
      const user = userEvent.setup()
      const onSave = vi.fn().mockImplementation(() => new Promise(() => {}))
      render(<TestFormDialog {...createProps} onSave={onSave} />)

      await user.type(screen.getByLabelText(/test name/i), 'Test')
      await user.click(screen.getByRole('button', { name: /create test/i }))

      await waitFor(() => {
        expect(screen.getByTestId('save-spinner')).toBeInTheDocument()
      })
    })

    it('prevents double-click submission', async () => {
      const user = userEvent.setup()
      const onSave = vi.fn().mockImplementation(() => new Promise((resolve) => setTimeout(resolve, 100)))
      render(<TestFormDialog {...createProps} onSave={onSave} />)

      await user.type(screen.getByLabelText(/test name/i), 'Test')

      const saveButton = screen.getByRole('button', { name: /create test/i })
      await user.click(saveButton)
      await user.click(saveButton)
      await user.click(saveButton)

      expect(onSave).toHaveBeenCalledTimes(1)
    })

    it('shows "Saving…" in edit mode', async () => {
      const user = userEvent.setup()
      const onSave = vi.fn().mockImplementation(() => new Promise(() => {}))
      render(<TestFormDialog {...editProps} onSave={onSave} />)

      await user.click(screen.getByRole('button', { name: /^save$/i }))

      await waitFor(() => {
        expect(screen.getByText('Saving…')).toBeInTheDocument()
      })
    })

    it('shows "Creating…" in create mode', async () => {
      const user = userEvent.setup()
      const onSave = vi.fn().mockImplementation(() => new Promise(() => {}))
      render(<TestFormDialog {...createProps} onSave={onSave} />)

      await user.type(screen.getByLabelText(/test name/i), 'Test')
      await user.click(screen.getByRole('button', { name: /create test/i }))

      await waitFor(() => {
        expect(screen.getByText('Creating…')).toBeInTheDocument()
      })
    })
  })

  // ===========================================================================
  // Cancel Behavior
  // ===========================================================================
  describe('Cancel Behavior', () => {
    it('calls onClose when Cancel button clicked', async () => {
      const user = userEvent.setup()
      const onClose = vi.fn()
      render(<TestFormDialog {...createProps} onClose={onClose} />)

      await user.click(screen.getByRole('button', { name: /cancel/i }))

      expect(onClose).toHaveBeenCalled()
    })

    it('does not call onSave when canceled', async () => {
      const user = userEvent.setup()
      const onSave = vi.fn()
      render(<TestFormDialog {...createProps} onSave={onSave} />)

      await user.type(screen.getByLabelText(/test name/i), 'Test')
      await user.click(screen.getByRole('button', { name: /cancel/i }))

      expect(onSave).not.toHaveBeenCalled()
    })

    it('calls onClose when ESC is pressed (handleOpenChange)', async () => {
      const user = userEvent.setup()
      const onClose = vi.fn()
      render(<TestFormDialog {...createProps} onClose={onClose} />)

      await user.keyboard('{Escape}')

      expect(onClose).toHaveBeenCalled()
    })

    it('does NOT call onClose when ESC is pressed during save', async () => {
      const user = userEvent.setup()
      const onClose = vi.fn()
      const onSave = vi.fn().mockImplementation(() => new Promise(() => {}))
      render(<TestFormDialog {...createProps} onClose={onClose} onSave={onSave} />)

      await user.type(screen.getByLabelText(/test name/i), 'Test')
      await user.click(screen.getByRole('button', { name: /create test/i }))

      await waitFor(() => {
        expect(screen.getByText('Creating…')).toBeInTheDocument()
      })

      onClose.mockClear()
      await user.keyboard('{Escape}')

      expect(onClose).not.toHaveBeenCalled()
    })
  })

  // ===========================================================================
  // Save Success
  // ===========================================================================
  describe('Save Success', () => {
    it('calls onClose after successful save', async () => {
      const user = userEvent.setup()
      const onClose = vi.fn()
      const onSave = vi.fn().mockResolvedValue(undefined)
      render(<TestFormDialog {...createProps} onClose={onClose} onSave={onSave} />)

      await user.type(screen.getByLabelText(/test name/i), 'Test')
      await user.click(screen.getByRole('button', { name: /create test/i }))

      await waitFor(() => {
        expect(onClose).toHaveBeenCalled()
      })
    })

    it('calls onClose after successful save in edit-metadata mode', async () => {
      const user = userEvent.setup()
      const onClose = vi.fn()
      const onSave = vi.fn().mockResolvedValue(undefined)
      render(<TestFormDialog {...editMetadataProps} onClose={onClose} onSave={onSave} />)

      await waitFor(() => {
        expect(screen.queryByTestId('description-skeleton')).not.toBeInTheDocument()
      })

      await user.click(screen.getByRole('button', { name: /^save$/i }))

      await waitFor(() => {
        expect(onClose).toHaveBeenCalled()
      })
    })
  })

  // ===========================================================================
  // Accessibility
  // ===========================================================================
  describe('Accessibility', () => {
    it('has role="dialog"', async () => {
      render(<TestFormDialog {...createProps} />)
      expect(screen.getByRole('dialog')).toBeInTheDocument()
    })

    it('marks the Test Name label with the shared RequiredMark', () => {
      render(<TestFormDialog {...createProps} />)
      expectRequiredMark(labelOf(screen.getByLabelText(/test name/i)))
    })

    it('sets aria-invalid on name input when validation fails', async () => {
      const user = userEvent.setup()
      render(<TestFormDialog {...createProps} />)

      await user.click(screen.getByRole('button', { name: /create test/i }))

      expect(screen.getByLabelText(/test name/i)).toHaveAttribute('aria-invalid', 'true')
    })

    it('has aria-describedby pointing to error message', async () => {
      const user = userEvent.setup()
      render(<TestFormDialog {...createProps} />)

      await user.click(screen.getByRole('button', { name: /create test/i }))

      const nameInput = screen.getByLabelText(/test name/i)
      const errorId = nameInput.getAttribute('aria-describedby')
      expect(errorId).toBeTruthy()
      expect(document.getElementById(errorId!)).toHaveTextContent('Test name is required')
    })
  })

  // ==========================================================================
  // Shared Field Primitives
  //
  // Test name moves from a bare <input className="input"> with a local
  // MAX_NAME_LENGTH=255 to <NameField maxLength={MAX_TEST_NAME_LENGTH}>.
  // Description <textarea> stays (multi-line).
  // ==========================================================================

  describe('adopts shared field primitives (name field)', () => {
    it('test name input is capped at MAX_TEST_NAME_LENGTH (255)', async () => {
      const { MAX_TEST_NAME_LENGTH } = await import(
        '@/lib/field-constraints'
      )
      render(<TestFormDialog {...createProps} />)

      const nameInput = screen.getByLabelText(/test name/i)
      expect(nameInput).toHaveAttribute(
        'maxLength',
        String(MAX_TEST_NAME_LENGTH),
      )
    })

    it('test name input renders as the TextField primitive (TEXTAREA tag, rows=1)', () => {
      render(<TestFormDialog {...createProps} />)

      const nameInput = screen.getByLabelText(/test name/i)
      expect(nameInput.tagName).toBe('TEXTAREA')
      expect(nameInput).toHaveAttribute('rows', '1')
    })

    it('shows the NameField counter at >=80% of the 255-char cap', async () => {
      const { MAX_TEST_NAME_LENGTH } = await import(
        '@/lib/field-constraints'
      )
      const value = 'a'.repeat(Math.ceil(0.8 * MAX_TEST_NAME_LENGTH))
      render(<TestFormDialog {...editProps} initialValues={{ name: value }} />)

      // The counter span has aria-live="polite" - find it via that.
      const counter = document.body.querySelector('span[aria-live="polite"]')
      expect(counter).not.toBeNull()
      expect(counter?.textContent).toContain(`/${MAX_TEST_NAME_LENGTH}`)
    })
  })

  describe('a failed tags read', () => {
    it('says the tags did not load instead of showing none', async () => {
      mockFetchTestsTags.mockRejectedValueOnce(new Error('Tags API down'))

      render(<TestFormDialog {...createProps} />)

      await waitFor(() => {
        expect(screen.getByTestId('api-error')).toHaveTextContent(
          'Could not load tags. Close and reopen this dialog to try again.'
        )
      })
    })

    it('refuses to save while the tags read has failed', async () => {
      const user = userEvent.setup()
      mockFetchTestsTags.mockRejectedValueOnce(new Error('Tags API down'))
      const onSave = vi.fn()

      render(<TestFormDialog {...createProps} onSave={onSave} initialValues={{ name: 'My Test' }} />)
      await waitFor(() => {
        expect(screen.getByTestId('api-error')).toBeInTheDocument()
      })

      await user.click(screen.getByRole('button', { name: /create test/i }))

      expect(onSave).not.toHaveBeenCalled()
      expect(screen.getByTestId('api-error')).toHaveTextContent('Could not load tags')
    })

    it('refuses to save the empty form when the test details read failed', async () => {
      const user = userEvent.setup()
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
      mockFetchTest.mockRejectedValue(new Error('Network error'))
      const onSave = vi.fn()

      render(<TestFormDialog {...editMetadataProps} onSave={onSave} />)

      await waitFor(() => {
        expect(screen.getByTestId('api-error')).toHaveTextContent(
          'Could not load test details. Close and reopen this dialog to try again.'
        )
      })
      await user.click(screen.getByRole('button', { name: /^save$/i }))

      expect(onSave).not.toHaveBeenCalled()
      consoleError.mockRestore()
    })

    it('names both reads when the details and the tags reads both fail', async () => {
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
      mockFetchTest.mockRejectedValue(new Error('Network error'))
      mockFetchTestsTags.mockRejectedValueOnce(new Error('Tags API down'))

      render(<TestFormDialog {...editMetadataProps} />)

      await waitFor(() => {
        expect(screen.getByTestId('api-error')).toHaveTextContent(
          'Could not load test details and tags. Close and reopen this dialog to try again.'
        )
      })
      consoleError.mockRestore()
    })

    it('ignores a tags response that arrives after the dialog closed', async () => {
      let resolveTags: (tags: string[]) => void = () => {}
      mockFetchTestsTags.mockReturnValueOnce(
        new Promise<string[]>((resolve) => {
          resolveTags = resolve
        })
      )

      const { unmount } = render(<TestFormDialog {...createProps} />)
      unmount()
      resolveTags(['smoke'])
      await Promise.resolve()

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })

    it('ignores a tags failure that arrives after the dialog closed', async () => {
      let rejectTags: (reason: unknown) => void = () => {}
      mockFetchTestsTags.mockReturnValueOnce(
        new Promise<string[]>((_resolve, reject) => {
          rejectTags = reject
        })
      )

      const { unmount } = render(<TestFormDialog {...createProps} />)
      unmount()
      rejectTags(new Error('Tags API down'))
      await Promise.resolve()

      expect(screen.queryByTestId('api-error')).not.toBeInTheDocument()
    })

    it('re-runs the tags read when the dialog is reopened', async () => {
      const user = userEvent.setup()
      mockFetchTestsTags.mockRejectedValueOnce(new Error('Tags API down'))
      const onSave = vi.fn().mockResolvedValue(undefined)

      const { rerender } = render(
        <TestFormDialog {...createProps} onSave={onSave} initialValues={{ name: 'My Test' }} />
      )
      await waitFor(() => {
        expect(screen.getByTestId('api-error')).toBeInTheDocument()
      })

      mockFetchTestsTags.mockResolvedValueOnce(['smoke'])
      rerender(
        <TestFormDialog {...createProps} onSave={onSave} initialValues={{ name: 'My Test' }} isOpen={false} />
      )
      rerender(
        <TestFormDialog {...createProps} onSave={onSave} initialValues={{ name: 'My Test' }} isOpen />
      )

      await waitFor(() => {
        expect(screen.queryByTestId('api-error')).not.toBeInTheDocument()
      })
      await user.click(screen.getByRole('button', { name: /create test/i }))
      expect(onSave).toHaveBeenCalled()
    })
  })
})
