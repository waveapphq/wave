/**
 * Suite Detail Page Tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes, createMemoryRouter, RouterProvider } from 'react-router-dom'
import type { SuiteDetail, SuiteTestEntry } from '@/features/suites/api/types'
import { ToastProvider, ToastContainer } from '@/components/ui/toast'

// Mock the suite API module
vi.mock('@/features/suites/api/crud', () => ({
  fetchSuiteDetail: vi.fn(),
  fetchSuitesTags: vi.fn(),
  fetchSuiteTests: vi.fn().mockResolvedValue([]),
  updateSuite: vi.fn(),
  deleteSuite: vi.fn(),
}))

// Mock the tests API module (used by EntityPickerModal)
vi.mock('@/features/tests/api/crud', () => ({
  fetchTests: vi.fn(),
  fetchTestsTags: vi.fn(),
  transformApiTest: vi.fn(),
}))

const useEnvironmentsMock = vi.hoisted(() => vi.fn())
vi.mock('@/hooks/use-environments', () => ({
  useEnvironments: (primary?: unknown) => {
    useEnvironmentsMock(primary)
    return {
      environments: [{ id: 'env-1', name: 'Development' }],
      loading: false,
      error: null,
    }
  },
}))

vi.mock('@/features/executions/api/executions', () => ({
  startExecution: vi.fn(),
}))

vi.mock('@/features/regressions/api/crud', () => ({
  fetchRegressionDetail: vi.fn(),
}))

vi.mock('@/features/suites/api/export-import', () => ({
  exportSuite: vi.fn(),
}))

// The injected workbench value cell, mocked to surface the structured value
// it receives (the JSON-string edge parse) without the heavy CodeMirror sheet.
vi.mock('@/features/workbench/common/variables/variable-value-cell', () => ({
  VariableValueCell: ({ type, value }: { type: string; value: unknown }) => (
    <div data-testid="mock-value-cell" data-type={type} data-value={JSON.stringify(value)} />
  ),
}))

import { SuiteDetailPage } from '@/features/suites/container/suite-detail-page'

import {
  fetchSuiteDetail,
  fetchSuitesTags,
  updateSuite,
  deleteSuite,
} from '@/features/suites/api/crud'
import { fetchRegressionDetail } from '@/features/regressions/api/crud'
import { exportSuite } from '@/features/suites/api/export-import'
import { usePageBlockStore } from '@/stores/page-block-store'

const mockFetchSuiteDetail = vi.mocked(fetchSuiteDetail)
const mockFetchSuitesTags = vi.mocked(fetchSuitesTags)
const mockUpdateSuite = vi.mocked(updateSuite)
const mockFetchRegressionDetail = vi.mocked(fetchRegressionDetail)
const mockDeleteSuite = vi.mocked(deleteSuite)

const mockSuite: SuiteDetail = {
  id: 'suite-1',
  name: 'Test Suite',
  description: 'A description',
  version: '1.0.0',
  createdAt: '2026-03-01T00:00:00Z',
  updatedAt: '2026-03-02T00:00:00Z',
  testIds: ['t1', 't2'],
  testsCount: 2,
  status: 'passed',
  lastRun: '2026-03-02T12:00:00Z',
  tags: ['smoke'],
  variables: {
    base_url: { type: 'string', value: 'http://localhost', secret: false },
  },
}

const mockTests: SuiteTestEntry[] = [
  { id: 't1', name: 'Login Test', status: 'passed', lastRun: '2026-03-02T12:00:00Z', tags: ['smoke'], createdAt: '2026-03-01T00:00:00Z', updatedAt: '2026-03-02T00:00:00Z' },
  { id: 't2', name: 'Logout Test', status: 'failed', lastRun: '2026-03-01T10:00:00Z', tags: [], createdAt: '2026-03-01T00:00:00Z', updatedAt: '2026-03-01T00:00:00Z' },
]

function renderWithRoute(entry: string) {
  return render(
    <ToastProvider>
      <MemoryRouter initialEntries={[entry]}>
        <Routes>
          <Route path="/suites/:suiteId" element={<SuiteDetailPage />} />
          <Route path="/suites" element={<div data-testid="suites-list">Suites List</div>} />
          <Route path="/workbench" element={<div data-testid="test-edit">Test Edit</div>} />
        </Routes>
      </MemoryRouter>
      <ToastContainer />
    </ToastProvider>
  )
}

function renderWithRouter(suiteId = 'suite-1') {
  return renderWithRoute(`/suites/${suiteId}`)
}


/** A save test changes the variables first: nothing changed anywhere keeps Save disabled. */
function renameFirstVariable() {
  fireEvent.change(screen.getAllByTestId('variable-name-input')[0], { target: { value: 'renamed_variable' } })
}

describe('SuiteDetailPage', () => {
  beforeEach(() => {
    mockFetchSuiteDetail.mockResolvedValue({ suite: mockSuite, tests: mockTests })
    mockFetchSuitesTags.mockResolvedValue(['smoke', 'api', 'regression'])
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('shows loading state initially', () => {
    mockFetchSuiteDetail.mockReturnValue(new Promise(() => {}))
    mockFetchSuitesTags.mockReturnValue(new Promise(() => {}))

    renderWithRouter()
    expect(screen.getByTestId('suite-detail-loading')).toBeInTheDocument()
  })

  it('fetches and displays suite data', async () => {
    renderWithRouter()

    await waitFor(() => {
      expect(screen.getByTestId('suite-detail-page')).toBeInTheDocument()
    })

    expect(screen.getByText('Test Suite')).toBeInTheDocument()
    expect(screen.getByText('Login Test')).toBeInTheDocument()
    expect(screen.getByText('Logout Test')).toBeInTheDocument()
  })

  it('shows error state on fetch failure', async () => {
    mockFetchSuiteDetail.mockRejectedValue(new Error('Network error'))

    renderWithRouter()

    await waitFor(() => {
      expect(screen.getByTestId('suite-detail-error')).toBeInTheDocument()
    })
    expect(screen.getByText('Network error')).toBeInTheDocument()
    expect(screen.getByText('Try Again')).toBeInTheDocument()
  })

  it('reaches the error state without waiting for the tag read', async () => {
    let releaseTags: (tags: string[]) => void = () => {}
    mockFetchSuiteDetail.mockRejectedValue(new Error('Network error'))
    mockFetchSuitesTags.mockReturnValue(
      new Promise<string[]>((resolve) => {
        releaseTags = resolve
      })
    )

    renderWithRouter()

    await waitFor(() => {
      expect(screen.getByTestId('suite-detail-error')).toBeInTheDocument()
    })

    await act(async () => {
      releaseTags(['smoke'])
    })
  })

  it('retries on error', async () => {
    mockFetchSuiteDetail.mockRejectedValueOnce(new Error('Network error'))

    renderWithRouter()

    await waitFor(() => {
      expect(screen.getByText('Try Again')).toBeInTheDocument()
    })

    mockFetchSuiteDetail.mockResolvedValue({ suite: mockSuite, tests: mockTests })

    await act(async () => {
      fireEvent.click(screen.getByText('Try Again'))
    })

    await waitFor(() => {
      expect(screen.getByTestId('suite-detail-page')).toBeInTheDocument()
    })
  })

  it('toggles sidebar visibility', async () => {
    renderWithRouter()

    await waitFor(() => {
      expect(screen.getByTestId('suite-detail-page')).toBeInTheDocument()
    })

    // Sidebar should be open by default
    expect(screen.getByTestId('suite-metadata-sidebar')).toBeInTheDocument()
    // Header toggle should be hidden when sidebar is open
    expect(screen.queryByTestId('sidebar-toggle-btn')).not.toBeInTheDocument()

    // Click bottom collapse button inside sidebar
    fireEvent.click(screen.getByTestId('sidebar-collapse-btn'))

    // Sidebar should be hidden
    expect(screen.queryByTestId('suite-metadata-sidebar')).not.toBeInTheDocument()
    // Header toggle should now be visible
    expect(screen.getByTestId('sidebar-toggle-btn')).toBeInTheDocument()

    // Click header toggle to expand
    fireEvent.click(screen.getByTestId('sidebar-toggle-btn'))

    // Sidebar should be visible again
    expect(screen.getByTestId('suite-metadata-sidebar')).toBeInTheDocument()
  })

  it('opens the delete confirmation dialog when the delete button is clicked', async () => {
    renderWithRouter()

    await waitFor(() => {
      expect(screen.getByTestId('suite-detail-page')).toBeInTheDocument()
    })

    expect(screen.queryByTestId('delete-confirmation-dialog')).not.toBeInTheDocument()

    fireEvent.click(screen.getByTestId('suite-delete-btn'))

    expect(screen.getByTestId('delete-confirmation-dialog')).toBeInTheDocument()
  })

  it('opens edit details dialog when edit button is clicked', async () => {
    renderWithRouter()

    await waitFor(() => {
      expect(screen.getByTestId('edit-details-btn')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByTestId('edit-details-btn'))

    await waitFor(() => {
      expect(screen.getByTestId('edit-details-dialog')).toBeInTheDocument()
    })
    expect(screen.getByTestId('edit-details-name')).toHaveValue('Test Suite')
  })

  it('saves details from edit dialog', async () => {
    mockUpdateSuite.mockResolvedValue(mockSuite)

    renderWithRouter()

    await waitFor(() => {
      expect(screen.getByTestId('edit-details-btn')).toBeInTheDocument()
    })

    // Open edit details dialog
    fireEvent.click(screen.getByTestId('edit-details-btn'))

    await waitFor(() => {
      expect(screen.getByTestId('edit-details-name')).toBeInTheDocument()
    })

    // Edit name
    fireEvent.change(screen.getByTestId('edit-details-name'), {
      target: { value: 'Updated Suite' },
    })

    // Save
    await act(async () => {
      fireEvent.click(screen.getByTestId('edit-dialog-save'))
    })

    await waitFor(() => {
      expect(mockUpdateSuite).toHaveBeenCalledWith('suite-1', expect.objectContaining({
        name: 'Updated Suite',
      }))
    })
  })

  it('opens edit variables dialog when edit button is clicked', async () => {
    renderWithRouter()

    await waitFor(() => {
      expect(screen.getByTestId('edit-variables-btn')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByTestId('edit-variables-btn'))

    await waitFor(() => {
      expect(screen.getByTestId('edit-variables-dialog')).toBeInTheDocument()
    })
    expect(screen.getByTestId('variable-editor')).toBeInTheDocument()
  })

  it('injects the shared value cell with the complex value adapted at the edge', async () => {
    mockFetchSuiteDetail.mockResolvedValue({
      suite: {
        ...mockSuite,
        // The backend round-trips an array variable VERBATIM as an actual array.
        variables: { cfg: { type: 'array', value: [1, 2, 3] as unknown as string, secret: false } },
      },
      tests: mockTests,
    })
    renderWithRouter()

    await waitFor(() => {
      expect(screen.getByTestId('edit-variables-btn')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByTestId('edit-variables-btn'))

    await waitFor(() => {
      expect(screen.getByTestId('mock-value-cell')).toBeInTheDocument()
    })
    const cell = screen.getByTestId('mock-value-cell')
    expect(cell).toHaveAttribute('data-type', 'array')
    // The actual array reaches the cell structured (the edge adapts it).
    expect(cell).toHaveAttribute('data-value', '[1,2,3]')
  })

  it('navigates back to suites list', async () => {
    renderWithRouter()

    await waitFor(() => {
      expect(screen.getByTestId('detail-back-btn')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByTestId('detail-back-btn'))

    await waitFor(() => {
      expect(screen.getByTestId('suites-list')).toBeInTheDocument()
    })
  })

  it('renders sidebar and content areas', async () => {
    renderWithRouter()

    await waitFor(() => {
      expect(screen.getByTestId('suite-metadata-sidebar')).toBeInTheDocument()
    })
    expect(screen.getByTestId('suite-tests-table')).toBeInTheDocument()
  })

  it('navigates to test edit page when edit button is clicked', async () => {
    renderWithRouter()

    await waitFor(() => {
      expect(screen.getByTestId('suite-detail-page')).toBeInTheDocument()
    })

    fireEvent.click(screen.getAllByTestId('test-edit-btn')[0])

    await waitFor(() => {
      expect(screen.getByTestId('test-edit')).toBeInTheDocument()
    })
  })

  it('shows error in edit dialog when save fails', async () => {
    mockUpdateSuite.mockRejectedValue(new Error('Save failed'))

    renderWithRouter()

    await waitFor(() => {
      expect(screen.getByTestId('edit-details-btn')).toBeInTheDocument()
    })

    // Open edit dialog
    fireEvent.click(screen.getByTestId('edit-details-btn'))

    await waitFor(() => {
      expect(screen.getByTestId('edit-details-dialog')).toBeInTheDocument()
    })

    // Save
    await act(async () => {
      fireEvent.click(screen.getByTestId('edit-dialog-save'))
    })

    await waitFor(() => {
      expect(screen.getByText('Save failed')).toBeInTheDocument()
    })
  })

  it('shows unsaved changes dialog when canceling with dirty state', async () => {
    renderWithRouter()

    await waitFor(() => {
      expect(screen.getByTestId('edit-details-btn')).toBeInTheDocument()
    })

    // Open edit dialog
    fireEvent.click(screen.getByTestId('edit-details-btn'))

    await waitFor(() => {
      expect(screen.getByTestId('edit-details-name')).toBeInTheDocument()
    })

    // Make a change to make it dirty
    fireEvent.change(screen.getByTestId('edit-details-name'), {
      target: { value: 'Changed Name' },
    })

    // Click cancel
    fireEvent.click(screen.getByTestId('edit-dialog-cancel'))

    // Unsaved changes dialog should appear
    await waitFor(() => {
      expect(screen.getByTestId('unsaved-changes-dialog')).toBeInTheDocument()
    })
    expect(screen.getByTestId('unsaved-keep-editing')).toBeInTheDocument()
  })

  it('keeps editing when "Keep Editing" is clicked in unsaved dialog', async () => {
    renderWithRouter()

    await waitFor(() => {
      expect(screen.getByTestId('edit-details-btn')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByTestId('edit-details-btn'))

    await waitFor(() => {
      expect(screen.getByTestId('edit-details-name')).toBeInTheDocument()
    })

    // Make dirty
    fireEvent.change(screen.getByTestId('edit-details-name'), {
      target: { value: 'Changed' },
    })

    // Cancel
    fireEvent.click(screen.getByTestId('edit-dialog-cancel'))

    await waitFor(() => {
      expect(screen.getByTestId('unsaved-keep-editing')).toBeInTheDocument()
    })

    // Keep editing
    fireEvent.click(screen.getByTestId('unsaved-keep-editing'))

    // Should still be in edit dialog with changes preserved
    expect(screen.getByTestId('edit-details-dialog')).toBeInTheDocument()
    expect(screen.getByTestId('edit-details-name')).toHaveValue('Changed')
  })

  it('discards changes when "Close" is clicked in unsaved dialog', async () => {
    renderWithRouter()

    await waitFor(() => {
      expect(screen.getByTestId('edit-details-btn')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByTestId('edit-details-btn'))

    await waitFor(() => {
      expect(screen.getByTestId('edit-details-name')).toBeInTheDocument()
    })

    // Make dirty
    fireEvent.change(screen.getByTestId('edit-details-name'), {
      target: { value: 'Changed' },
    })

    // Cancel
    fireEvent.click(screen.getByTestId('edit-dialog-cancel'))

    await waitFor(() => {
      expect(screen.getByTestId('unsaved-discard')).toBeInTheDocument()
    })

    // Close
    fireEvent.click(screen.getByTestId('unsaved-discard'))

    // Dialog should close
    await waitFor(() => {
      expect(screen.queryByTestId('edit-details-dialog')).not.toBeInTheDocument()
    })
  })

  it('closes edit dialog without confirmation when not dirty', async () => {
    renderWithRouter()

    await waitFor(() => {
      expect(screen.getByTestId('edit-details-btn')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByTestId('edit-details-btn'))

    await waitFor(() => {
      expect(screen.getByTestId('edit-details-dialog')).toBeInTheDocument()
    })

    // Cancel without making changes
    fireEvent.click(screen.getByTestId('edit-dialog-cancel'))

    // Should close immediately, no confirmation
    await waitFor(() => {
      expect(screen.queryByTestId('edit-details-dialog')).not.toBeInTheDocument()
    })
    expect(screen.queryByTestId('unsaved-changes-dialog')).not.toBeInTheDocument()
  })

  it('saves variables from edit variables dialog', async () => {
    mockUpdateSuite.mockResolvedValue(mockSuite)

    renderWithRouter()

    await waitFor(() => {
      expect(screen.getByTestId('edit-variables-btn')).toBeInTheDocument()
    })

    // Open edit variables dialog
    fireEvent.click(screen.getByTestId('edit-variables-btn'))

    await waitFor(() => {
      expect(screen.getByTestId('edit-variables-dialog')).toBeInTheDocument()
    })

    // Save
    // Nothing changed anywhere keeps Save disabled.
    renameFirstVariable()

    await act(async () => {
      fireEvent.click(screen.getByTestId('edit-dialog-save'))
    })

    await waitFor(() => {
      expect(mockUpdateSuite).toHaveBeenCalledWith('suite-1', expect.objectContaining({
        variables: expect.any(Object),
      }))
    })
  })

  it('saves via Save in unsaved changes dialog', async () => {
    mockUpdateSuite.mockResolvedValue(mockSuite)

    renderWithRouter()

    await waitFor(() => {
      expect(screen.getByTestId('edit-details-btn')).toBeInTheDocument()
    })

    // Open edit dialog
    fireEvent.click(screen.getByTestId('edit-details-btn'))

    await waitFor(() => {
      expect(screen.getByTestId('edit-details-name')).toBeInTheDocument()
    })

    // Make dirty
    fireEvent.change(screen.getByTestId('edit-details-name'), {
      target: { value: 'Changed Name' },
    })

    // Cancel to trigger unsaved changes dialog
    fireEvent.click(screen.getByTestId('edit-dialog-cancel'))

    await waitFor(() => {
      expect(screen.getByTestId('unsaved-save-close')).toBeInTheDocument()
    })

    // Click Save
    await act(async () => {
      fireEvent.click(screen.getByTestId('unsaved-save-close'))
    })

    await waitFor(() => {
      expect(mockUpdateSuite).toHaveBeenCalled()
    })
  })

  it('shows error banner when reload fails after successful initial load', async () => {
    renderWithRouter()

    // Wait for initial load to succeed
    await waitFor(() => {
      expect(screen.getByTestId('suite-detail-page')).toBeInTheDocument()
    })

    // Now make subsequent fetch fail
    mockFetchSuiteDetail.mockRejectedValue(new Error('Reload failed'))
    mockUpdateSuite.mockResolvedValue(mockSuite)

    // Open edit dialog, make a change, and save - save succeeds but reload fails
    fireEvent.click(screen.getByTestId('edit-details-btn'))

    await waitFor(() => {
      expect(screen.getByTestId('edit-details-dialog')).toBeInTheDocument()
    })

    // Save triggers loadData which now fails
    await act(async () => {
      fireEvent.click(screen.getByTestId('edit-dialog-save'))
    })

    // Error banner shows on the main page (not blocking, suite already loaded)
    await waitFor(() => {
      expect(screen.getByText('Reload failed')).toBeInTheDocument()
    })
    // Suite page should still be visible (non-blocking error)
    expect(screen.getByTestId('suite-detail-page')).toBeInTheDocument()
  })

  // =========================================================================
  // Test Edit Mode
  // =========================================================================

  it('shows "Edit Tests" button on loaded page', async () => {
    renderWithRouter()

    await waitFor(() => {
      expect(screen.getByTestId('suite-detail-page')).toBeInTheDocument()
    })

    expect(screen.getByTestId('edit-tests-btn')).toBeInTheDocument()
    expect(screen.getByTestId('edit-tests-btn')).toHaveTextContent('Edit Tests')
  })

  it('entering edit mode shows Save/Cancel and hides Edit Tests', async () => {
    renderWithRouter()

    await waitFor(() => {
      expect(screen.getByTestId('edit-tests-btn')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByTestId('edit-tests-btn'))

    expect(screen.getByTestId('save-tests-btn')).toBeInTheDocument()
    expect(screen.getByTestId('cancel-tests-btn')).toBeInTheDocument()
    expect(screen.queryByTestId('edit-tests-btn')).not.toBeInTheDocument()
  })

  it('entering edit mode shows grip handles', async () => {
    renderWithRouter()

    await waitFor(() => {
      expect(screen.getByTestId('suite-detail-page')).toBeInTheDocument()
    })

    // No grip handles in detail mode
    expect(screen.queryByTestId('dnd-grip-handle')).not.toBeInTheDocument()

    // Enter edit mode
    fireEvent.click(screen.getByTestId('edit-tests-btn'))

    // Grip handles should appear
    expect(screen.getAllByTestId('dnd-grip-handle')).toHaveLength(2)
  })

  it('cancel exits edit mode without API call', async () => {
    renderWithRouter()

    await waitFor(() => {
      expect(screen.getByTestId('edit-tests-btn')).toBeInTheDocument()
    })

    // Enter edit mode
    fireEvent.click(screen.getByTestId('edit-tests-btn'))
    expect(screen.getByTestId('save-tests-btn')).toBeInTheDocument()

    // Cancel
    fireEvent.click(screen.getByTestId('cancel-tests-btn'))

    // Should be back in detail mode
    expect(screen.getByTestId('edit-tests-btn')).toBeInTheDocument()
    expect(screen.queryByTestId('save-tests-btn')).not.toBeInTheDocument()

    // updateSuite should NOT have been called
    expect(mockUpdateSuite).not.toHaveBeenCalled()
  })

  it('excludes test in edit mode', async () => {
    renderWithRouter()

    await waitFor(() => {
      expect(screen.getByTestId('suite-detail-page')).toBeInTheDocument()
    })

    // Enter edit mode
    fireEvent.click(screen.getByTestId('edit-tests-btn'))

    // Should have 2 test rows
    expect(screen.getAllByTestId('test-exclude-btn')).toHaveLength(2)

    // Exclude first test
    fireEvent.click(screen.getAllByTestId('test-exclude-btn')[0])

    // Should have 1 exclude button
    expect(screen.getAllByTestId('test-exclude-btn')).toHaveLength(1)
    expect(screen.getByText('Logout Test')).toBeInTheDocument()
    expect(screen.queryByText('Login Test')).not.toBeInTheDocument()
  })

  it('saves test edits and calls updateSuite with new test IDs', async () => {
    mockUpdateSuite.mockResolvedValue(mockSuite)

    renderWithRouter()

    await waitFor(() => {
      expect(screen.getByTestId('suite-detail-page')).toBeInTheDocument()
    })

    // Enter edit mode
    fireEvent.click(screen.getByTestId('edit-tests-btn'))

    // Exclude first test
    fireEvent.click(screen.getAllByTestId('test-exclude-btn')[0])

    // Save
    await act(async () => {
      fireEvent.click(screen.getByTestId('save-tests-btn'))
    })

    await waitFor(() => {
      expect(mockUpdateSuite).toHaveBeenCalledWith('suite-1', {
        tests: ['t2'],
      })
    })

    // Should exit edit mode after save
    await waitFor(() => {
      expect(screen.getByTestId('edit-tests-btn')).toBeInTheDocument()
    })
  })

  it('shows error banner on save failure and stays in edit mode', async () => {
    mockUpdateSuite.mockRejectedValue(new Error('Save failed'))

    renderWithRouter()

    await waitFor(() => {
      expect(screen.getByTestId('suite-detail-page')).toBeInTheDocument()
    })

    // Enter edit mode
    fireEvent.click(screen.getByTestId('edit-tests-btn'))

    // Save (the button click triggers async work)
    fireEvent.click(screen.getByTestId('save-tests-btn'))

    // Error should be displayed after the rejected promise
    await waitFor(() => {
      expect(screen.getByText('Save failed')).toBeInTheDocument()
    })

    // Should still be in edit mode
    expect(screen.getByTestId('save-tests-btn')).toBeInTheDocument()
  })

  it('reloads data after successful save', async () => {
    mockUpdateSuite.mockResolvedValue(mockSuite)

    renderWithRouter()

    await waitFor(() => {
      expect(screen.getByTestId('suite-detail-page')).toBeInTheDocument()
    })

    const initialCallCount = mockFetchSuiteDetail.mock.calls.length

    // Enter edit mode and save
    fireEvent.click(screen.getByTestId('edit-tests-btn'))

    await act(async () => {
      fireEvent.click(screen.getByTestId('save-tests-btn'))
    })

    await waitFor(() => {
      // fetchSuiteDetail should have been called again
      expect(mockFetchSuiteDetail.mock.calls.length).toBeGreaterThan(initialCallCount)
    })
  })

  it('shows Add Tests button in edit mode', async () => {
    renderWithRouter()

    await waitFor(() => {
      expect(screen.getByTestId('suite-detail-page')).toBeInTheDocument()
    })

    // No Add Tests button in detail mode
    expect(screen.queryByTestId('add-tests-button')).not.toBeInTheDocument()

    // Enter edit mode
    fireEvent.click(screen.getByTestId('edit-tests-btn'))

    // Add Tests button should appear
    expect(screen.getByTestId('add-tests-button')).toBeInTheDocument()
  })

  it('opens test picker modal when Add Tests is clicked', async () => {
    // Mock the tests API for the picker modal
    const { fetchTests, fetchTestsTags } = await import('@/features/tests/api/crud')
    vi.mocked(fetchTests).mockResolvedValue({
      success: true,
      data: [],
      pagination: { total: 0, page: 1, per_page: 100, total_pages: 0 },
    })
    vi.mocked(fetchTestsTags).mockResolvedValue([])

    renderWithRouter()

    await waitFor(() => {
      expect(screen.getByTestId('suite-detail-page')).toBeInTheDocument()
    })

    // Enter edit mode
    fireEvent.click(screen.getByTestId('edit-tests-btn'))

    // Click Add Tests
    fireEvent.click(screen.getByTestId('add-tests-button'))

    // Test picker modal should open
    await waitFor(() => {
      expect(screen.getByTestId('test-picker-modal')).toBeInTheDocument()
    })

    // Close the modal via its close (X) button
    const modal = screen.getByTestId('test-picker-modal')
    const closeBtn = modal.querySelector('button[class*="absolute"]')!
    fireEvent.click(closeBtn)

    // Modal should close
    await waitFor(() => {
      expect(screen.queryByTestId('test-picker-modal')).not.toBeInTheDocument()
    })
  })

  it('test picker forwards page=1 & per_page=25 to fetchTests and surfaces the total', async () => {
    const { fetchTests, fetchTestsTags, transformApiTest } = await import('@/features/tests/api/crud')
    vi.mocked(fetchTests).mockResolvedValue({
      success: true,
      data: [
        { id: 'pt1', name: 'Picker Test 1', version: '1.0.0', created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z', tags: ['smoke'], metadata: { status: 'passed' } },
        { id: 'pt2', name: 'Picker Test 2', version: '1.0.0', created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z', tags: [], metadata: { status: 'failed' } },
      ],
      pagination: { total: 60, page: 1, per_page: 25, total_pages: 3 },
    })
    vi.mocked(fetchTestsTags).mockResolvedValue([])
    vi.mocked(transformApiTest).mockImplementation((t) => ({
      id: t.id,
      name: t.name,
      suiteCount: 0,
      suiteIds: [],
      suiteNames: [],
      status: (t.metadata?.status ?? 'never_run') as ReturnType<typeof transformApiTest>['status'],
      lastRun: null,
      tags: t.tags ?? [],
      createdAt: null,
      updatedAt: null,
    }))

    renderWithRouter()

    await waitFor(() => {
      expect(screen.getByTestId('suite-detail-page')).toBeInTheDocument()
    })

    // Enter edit mode and open the picker.
    fireEvent.click(screen.getByTestId('edit-tests-btn'))
    fireEvent.click(screen.getByTestId('add-tests-button'))

    await waitFor(() => {
      expect(screen.getByTestId('test-picker-modal')).toBeInTheDocument()
    })
    await waitFor(() => {
      expect(screen.getByText('Picker Test 1')).toBeInTheDocument()
    })

    // Paginated contract: 25 per page, page 1.
    expect(vi.mocked(fetchTests)).toHaveBeenCalledWith(
      expect.objectContaining({ page: 1, per_page: 25 }),
    )
    // The total (60) drives the refine nudge with the "tests" plural.
    expect(
      screen.getByText('60 tests - refine your search to narrow down'),
    ).toBeInTheDocument()
  })
})

describe('SuiteDetailPage - blocking reads', () => {
  beforeEach(() => {
    useEnvironmentsMock.mockClear()
    usePageBlockStore.setState({ block: null, retrying: false, retiredOwners: new Set() })
    mockFetchSuiteDetail.mockResolvedValue({ suite: mockSuite, tests: mockTests })
    mockFetchSuitesTags.mockResolvedValue(['smoke'])
    mockFetchRegressionDetail.mockResolvedValue({
      regression: { id: 'reg-9', name: 'Nightly' },
    } as never)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('blocks the page when the tag read fails instead of showing the error state', async () => {
    mockFetchSuitesTags.mockRejectedValue(new Error('Tags unavailable'))

    renderWithRouter()

    await waitFor(() => expect(usePageBlockStore.getState().block).not.toBeNull())
    expect(usePageBlockStore.getState().block?.title).toBe('Could not load tags')
    expect(screen.getByTestId('suite-detail-page')).toBeInTheDocument()
    expect(screen.queryByTestId('suite-detail-error')).not.toBeInTheDocument()
  })

  it('holds the environments read until the suite read has landed', async () => {
    renderWithRouter()

    expect(useEnvironmentsMock).toHaveBeenCalledWith('pending')
    await waitFor(() => expect(screen.getByTestId('suite-detail-page')).toBeInTheDocument())
    expect(useEnvironmentsMock).toHaveBeenLastCalledWith('loaded')
  })

  it('tells the environments read the suite read failed', async () => {
    mockFetchSuiteDetail.mockRejectedValue(new Error('Network error'))

    renderWithRouter()

    await waitFor(() => expect(screen.getByTestId('suite-detail-error')).toBeInTheDocument())
    expect(useEnvironmentsMock).toHaveBeenLastCalledWith('failed')
  })

  it('blocks the page when the parent regression read fails', async () => {
    mockFetchRegressionDetail.mockRejectedValue(new Error('Regression unavailable'))

    renderWithRoute('/suites/suite-1?regressionId=reg-9')

    await waitFor(() => expect(usePageBlockStore.getState().block).not.toBeNull())
    expect(usePageBlockStore.getState().block?.title).toBe('Could not load parent regression')
  })

  it('names the parent regression in the breadcrumb when its read succeeds', async () => {
    renderWithRoute('/suites/suite-1?regressionId=reg-9')

    await waitFor(() => expect(screen.getByText('Nightly')).toBeInTheDocument())
    expect(usePageBlockStore.getState().block).toBeNull()
  })

  it('shows only the error state when the suite read and the tag read both fail', async () => {
    mockFetchSuiteDetail.mockRejectedValue(new Error('Network error'))
    mockFetchSuitesTags.mockRejectedValue(new Error('Tags unavailable'))

    renderWithRouter()

    await waitFor(() => expect(screen.getByTestId('suite-detail-error')).toBeInTheDocument())
    await waitFor(() => expect(mockFetchSuitesTags).toHaveBeenCalled())
    expect(usePageBlockStore.getState().block).toBeNull()
  })

  it('falls back to a generic message when the suite read failure is not an Error', async () => {
    mockFetchSuiteDetail.mockRejectedValue('weird failure')

    renderWithRouter()

    await waitFor(() => expect(screen.getByTestId('suite-detail-error')).toBeInTheDocument())
    expect(screen.getAllByText('Failed to load suite')).toHaveLength(2)
  })

  it('sits in the loading shell when the route carries no suite id', async () => {
    render(
      <ToastProvider>
        <MemoryRouter initialEntries={['/suites']}>
          <Routes>
            <Route path="/suites" element={<SuiteDetailPage />} />
          </Routes>
        </MemoryRouter>
      </ToastProvider>
    )

    await waitFor(() =>
      expect(screen.getByTestId('suite-detail-loading')).toBeInTheDocument()
    )
    expect(mockFetchSuiteDetail).not.toHaveBeenCalled()
    expect(mockFetchSuitesTags).not.toHaveBeenCalled()
  })

  it('lets a superseded parent regression read not overwrite the newer name', async () => {
    let resolveFirst!: (value: { regression: { id: string; name: string } }) => void
    mockFetchRegressionDetail
      .mockReturnValueOnce(
        new Promise((resolve) => {
          resolveFirst = resolve as never
        }) as never,
      )
      .mockResolvedValueOnce({ regression: { id: 'reg-2', name: 'Second' } } as never)

    const router = createMemoryRouter(
      [{ path: '/suites/:suiteId', element: <SuiteDetailPage /> }],
      { initialEntries: ['/suites/suite-1?regressionId=reg-9'] },
    )
    render(
      <ToastProvider>
        <RouterProvider router={router} />
      </ToastProvider>
    )
    await waitFor(() => expect(screen.getByTestId('suite-detail-page')).toBeInTheDocument())

    await act(async () => {
      await router.navigate('/suites/suite-1?regressionId=reg-2')
    })
    await waitFor(() => expect(screen.getByText('Second')).toBeInTheDocument())

    await act(async () => {
      resolveFirst({ regression: { id: 'reg-9', name: 'First' } })
    })

    expect(screen.getByText('Second')).toBeInTheDocument()
    expect(screen.queryByText('First')).not.toBeInTheDocument()
  })

  it('reports the reason when the suite export fails', async () => {
    vi.mocked(exportSuite).mockRejectedValue(new Error('Export failed: Not Found'))
    vi.spyOn(console, 'error').mockImplementation(() => {})

    renderWithRouter()
    await waitFor(() => expect(screen.getByTestId('suite-detail-page')).toBeInTheDocument())

    fireEvent.click(screen.getByTestId('suite-export-btn'))
    fireEvent.click(await screen.findByTestId('export-button'))

    expect(await screen.findByText('Export failed: Not Found')).toBeInTheDocument()
  })

  it('passes a non-Error export rejection through verbatim', async () => {
    vi.mocked(exportSuite).mockRejectedValue('not an error object')
    vi.spyOn(console, 'error').mockImplementation(() => {})

    renderWithRouter()
    await waitFor(() => expect(screen.getByTestId('suite-detail-page')).toBeInTheDocument())

    fireEvent.click(screen.getByTestId('suite-export-btn'))
    fireEvent.click(await screen.findByTestId('export-button'))

    expect(await screen.findByText('not an error object')).toBeInTheDocument()
    expect(screen.getByText('Export Failed')).toBeInTheDocument()
  })

  // ==========================================================================
  // Delete confirmation
  // ==========================================================================

  async function openDeleteDialog(): Promise<void> {
    renderWithRouter()
    await waitFor(() => {
      expect(screen.getByTestId('suite-detail-page')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByTestId('suite-delete-btn'))
    await waitFor(() => {
      expect(screen.getByTestId('delete-confirmation-dialog')).toBeInTheDocument()
    })
  }

  it('navigates to the list after confirming delete', async () => {
    mockDeleteSuite.mockResolvedValue(undefined)
    await openDeleteDialog()

    await act(async () => {
      fireEvent.click(screen.getByTestId('delete-confirm-btn'))
    })

    await waitFor(() => {
      expect(screen.getByTestId('suites-list')).toBeInTheDocument()
    })
    expect(mockDeleteSuite).toHaveBeenCalledWith('suite-1')
  })

  it('keeps the dialog open and names the reason when the delete fails', async () => {
    mockDeleteSuite.mockRejectedValueOnce(
      Object.assign(new Error('backend unavailable'), { status: 500 }),
    )
    await openDeleteDialog()

    await act(async () => {
      fireEvent.click(screen.getByTestId('delete-confirm-btn'))
    })

    await waitFor(() => {
      expect(screen.getByTestId('delete-suite-error')).toHaveTextContent('backend unavailable')
    })
    // The suite is still here: the dialog stayed open and nothing navigated.
    expect(screen.getByTestId('delete-confirmation-dialog')).toBeInTheDocument()
    expect(screen.queryByTestId('suites-list')).not.toBeInTheDocument()

    // Cancel closes the dialog and clears the reason.
    const dialog = screen.getByTestId('delete-confirmation-dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: /^Cancel$/ }))
    await waitFor(() => {
      expect(screen.queryByTestId('delete-confirmation-dialog')).not.toBeInTheDocument()
    })

    fireEvent.click(screen.getByTestId('suite-delete-btn'))
    await waitFor(() => {
      expect(screen.getByTestId('delete-confirmation-dialog')).toBeInTheDocument()
    })
    expect(screen.queryByTestId('delete-suite-error')).not.toBeInTheDocument()
  })

  it('falls back to a generic reason when the delete rejects with a non-Error', async () => {
    mockDeleteSuite.mockRejectedValueOnce('weird')
    await openDeleteDialog()

    await act(async () => {
      fireEvent.click(screen.getByTestId('delete-confirm-btn'))
    })

    await waitFor(() => {
      expect(screen.getByTestId('delete-suite-error')).toHaveTextContent('Failed to delete suite')
    })
  })

  it('closes the dialog and points at the running execution on a delete conflict', async () => {
    mockDeleteSuite.mockRejectedValueOnce(
      Object.assign(new Error('Cannot delete suite'), {
        status: 409,
        code: 'CONFLICT',
        details: { execution_ids: ['exec-7'] },
      }),
    )
    await openDeleteDialog()

    await act(async () => {
      fireEvent.click(screen.getByTestId('delete-confirm-btn'))
    })

    await waitFor(() => {
      expect(screen.queryByTestId('delete-confirmation-dialog')).not.toBeInTheDocument()
    })
    expect(await screen.findByText(/Execution exec-7 is still running/)).toBeInTheDocument()
  })

  it('clears the delete error when the dialog is closed via ESC (onOpenChange)', async () => {
    mockDeleteSuite.mockRejectedValueOnce(
      Object.assign(new Error('backend unavailable'), { status: 500 }),
    )
    await openDeleteDialog()

    await act(async () => {
      fireEvent.click(screen.getByTestId('delete-confirm-btn'))
    })
    await waitFor(() => {
      expect(screen.getByTestId('delete-suite-error')).toBeInTheDocument()
    })

    fireEvent.keyDown(document, { key: 'Escape', code: 'Escape' })
    await waitFor(() => {
      expect(screen.queryByTestId('delete-confirmation-dialog')).not.toBeInTheDocument()
    })

    fireEvent.click(screen.getByTestId('suite-delete-btn'))
    await waitFor(() => {
      expect(screen.getByTestId('delete-confirmation-dialog')).toBeInTheDocument()
    })
    expect(screen.queryByTestId('delete-suite-error')).not.toBeInTheDocument()
  })

  it('restores the tags and clears the block on retry', async () => {
    mockFetchSuitesTags.mockRejectedValueOnce(new Error('Tags unavailable'))

    renderWithRouter()
    await waitFor(() => expect(usePageBlockStore.getState().block).not.toBeNull())

    mockFetchSuitesTags.mockResolvedValue(['recovered'])
    const detailCalls = mockFetchSuiteDetail.mock.calls.length
    await act(async () => {
      await usePageBlockStore.getState().block!.retry()
    })

    expect(usePageBlockStore.getState().block).toBeNull()
    expect(mockFetchSuiteDetail).toHaveBeenCalledTimes(detailCalls)
  })
})
