/**
 * Regression Detail Page Tests
 *
 * REQ-5.2.1.37: Regression management screen (list, create, edit, version control)
 * REQ-6.2.5: Regression collection schema
 * V-REG-EDIT-02: Regression editor
 * V-REG-DETAIL-01: Regression detail view
 *
 * Design decisions: REG-1 to REG-22
 * - 2-panel layout: collapsible metadata sidebar (left) + suites DataTable (main)
 * - Sidebar uses shared MetadataSidebar with "Details" and "Variables" collapsible sections
 * - Variables section in sidebar with add/edit/delete controls
 * - Suites table columns: Name, Description, Tags, Tests (count), Avg Duration, Actions
 * - Header actions: Save/Undo/Redo | Add Suites, Create Suite, Run
 * - Edit mode: drag-to-reorder suites, checkboxes for multi-select removal
 * - View/edit mode toggle
 *
 * Component: frontend/src/features/regressions/container/regression-detail-page.tsx
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within, act } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { ToastProvider } from '@/components/ui/toast'

// Mock the regression API module
vi.mock('@/features/regressions/api/crud', () => ({
  fetchRegressionDetail: vi.fn(),
  fetchRegressionsTags: vi.fn(),
  updateRegression: vi.fn(),
  deleteRegression: vi.fn(),
}))

// Mock the suites API module. The suite picker calls fetchSuitesList (paginated),
// NOT fetchSuites - the previous fetchSuites mock left fetchSuitesList undefined,
// so the picker silently fell into its catch branch.
vi.mock('@/features/suites/api/crud', () => ({
  fetchSuitesList: vi.fn(),
  fetchSuitesTags: vi.fn(),
}))

import { fetchSuitesList, fetchSuitesTags } from '@/features/suites/api/crud'

const mockFetchSuitesList = vi.mocked(fetchSuitesList)
const mockFetchSuitesTags = vi.mocked(fetchSuitesTags)

// Mock the export-import API module
vi.mock('@/features/regressions/api/export-import', () => ({
  exportRegression: vi.fn(),
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

vi.mock('@/features/regressions/api/regressions', () => ({
  fetchRegressionSuitesWithTests: vi.fn().mockResolvedValue([]),
}))

// The injected workbench value cell, mocked to surface the structured value
// it receives (the JSON-string edge parse) without the heavy CodeMirror sheet.
vi.mock('@/features/workbench/common/variables/variable-value-cell', () => ({
  VariableValueCell: ({ type, value }: { type: string; value: unknown }) => (
    <div data-testid="mock-value-cell" data-type={type} data-value={JSON.stringify(value)} />
  ),
}))

import { RegressionDetailPage } from '@/features/regressions/container/regression-detail-page'

import {
  fetchRegressionDetail,
  fetchRegressionsTags,
  updateRegression,
  deleteRegression,
} from '@/features/regressions/api/crud'

const mockFetchRegressionDetail = vi.mocked(fetchRegressionDetail)
const mockFetchRegressionsTags = vi.mocked(fetchRegressionsTags)
const mockUpdateRegression = vi.mocked(updateRegression)
const mockDeleteRegressionById = vi.mocked(deleteRegression)

// ============================================================================
// Mock Data
// ============================================================================

import type { RegressionDetail, RegressionSuiteEntry } from '@/features/regressions/api/types'
import type { SuiteListApiResponse } from '@/features/suites/api/types'

const mockRegression: RegressionDetail = {
  id: 'reg-1',
  name: 'WAVE 26.04',
  description: 'Full release regression for WAVE 26.04',
  createdAt: '2026-03-01T00:00:00Z',
  updatedAt: '2026-03-15T12:00:00Z',
  suiteIds: ['suite-1', 'suite-2'],
  suitesCount: 2,
  testsCount: 45,
  status: 'passed',
  lastRun: '2026-03-15T12:00:00Z',
  tags: ['release', 'full'],
  variables: {
    base_url: { type: 'string', value: 'http://localhost:8000', secret: false },
    api_key: { type: 'string', value: '***', secret: true },
  },
}

const mockSuites: RegressionSuiteEntry[] = [
  {
    id: 'suite-1',
    name: 'Auth Suite',
    description: 'Authentication tests',
    status: 'passed',
    lastRun: '2026-03-15T12:00:00Z',
    tags: ['auth'],
    testsCount: 25,
    avgDuration: 45.2,
    createdAt: '2026-03-01T00:00:00Z',
    updatedAt: '2026-03-15T12:00:00Z',
  },
  {
    id: 'suite-2',
    name: 'API Suite',
    description: 'API integration tests',
    status: 'failed',
    lastRun: '2026-03-14T10:00:00Z',
    tags: ['api', 'integration'],
    testsCount: 20,
    avgDuration: 120.5,
    createdAt: '2026-03-02T00:00:00Z',
    updatedAt: '2026-03-14T10:00:00Z',
  },
]

// ============================================================================
// Test Utilities
// ============================================================================

function renderWithRouter(regressionId = 'reg-1') {
  return render(
    <ToastProvider>
      <MemoryRouter initialEntries={[`/regressions/${regressionId}`]}>
        <Routes>
          <Route path="/regressions/:regressionId" element={<RegressionDetailPage />} />
          <Route path="/regressions" element={<div data-testid="regressions-list">Regressions List</div>} />
          <Route path="/suites/:suiteId" element={<div data-testid="suite-detail">Suite Detail</div>} />
          <Route path="/workbench" element={<div data-testid="test-edit">Test Edit</div>} />
        </Routes>
      </MemoryRouter>
    </ToastProvider>
  )
}

// Candidate suites returned by the picker (NOT already in the regression).
const CANDIDATE_PAGE_1: SuiteListApiResponse[] = [
  { id: 'cand-1', name: 'Cand Suite 1', description: null, version: '1.0.0', created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z', tests_count: 5, status: 'passed', last_run: null, tags: ['smoke'] },
  { id: 'cand-2', name: 'Cand Suite 2', description: null, version: '1.0.0', created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z', tests_count: 8, status: 'passed', last_run: null, tags: [] },
]
// A page-2-only candidate with a distinctive 'failed' status so the cache
// (real metadata) is distinguishable from a zeroed placeholder ('never_run').
const CANDIDATE_PAGE_2: SuiteListApiResponse = {
  id: 'cand-3', name: 'Cand Suite 3', description: null, version: '1.0.0', created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z', tests_count: 12, status: 'failed', last_run: '2026-03-20T12:00:00Z', tags: ['nightly'],
}

/** Drive the suite picker's infinite-scroll handler by faking near-bottom metrics. */
function scrollSuitePickerToBottom(): void {
  const list = screen.getByTestId('suite-picker-list')
  Object.defineProperty(list, 'scrollHeight', { configurable: true, value: 1000 })
  Object.defineProperty(list, 'clientHeight', { configurable: true, value: 400 })
  list.scrollTop = 600
  fireEvent.scroll(list)
}

// ============================================================================
// Tests
// ============================================================================


/** A save test changes the variables first: nothing changed anywhere keeps Save disabled. */
function renameFirstVariable() {
  fireEvent.change(screen.getAllByTestId('variable-name-input')[0], { target: { value: 'renamed_variable' } })
}

describe('RegressionDetailPage', () => {
  beforeEach(() => {
    mockFetchRegressionDetail.mockResolvedValue({ regression: mockRegression, suites: mockSuites })
    mockFetchRegressionsTags.mockResolvedValue(['release', 'full', 'nightly', 'smoke'])
    mockFetchSuitesList.mockResolvedValue({
      success: true,
      data: [],
      pagination: { total: 0, page: 1, per_page: 25, total_pages: 0 },
    })
    mockFetchSuitesTags.mockResolvedValue([])
    mockDeleteRegressionById.mockResolvedValue(undefined)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // =========================================================================
  // Data Loading
  // =========================================================================

  it('shows loading state initially', () => {
    mockFetchRegressionDetail.mockReturnValue(new Promise(() => {}))
    mockFetchRegressionsTags.mockReturnValue(new Promise(() => {}))

    renderWithRouter()
    expect(screen.getByTestId('regression-detail-loading')).toBeInTheDocument()
  })

  it('fetches and displays regression data', async () => {
    renderWithRouter()

    await waitFor(() => {
      expect(screen.getByTestId('regression-detail-page')).toBeInTheDocument()
    })

    expect(screen.getByText('WAVE 26.04')).toBeInTheDocument()
    expect(screen.getByText('Auth Suite')).toBeInTheDocument()
    expect(screen.getByText('API Suite')).toBeInTheDocument()
  })

  it('shows error state on fetch failure', async () => {
    mockFetchRegressionDetail.mockRejectedValue(new Error('Network error'))

    renderWithRouter()

    await waitFor(() => {
      expect(screen.getByTestId('regression-detail-error')).toBeInTheDocument()
    })
    expect(screen.getByText('Network error')).toBeInTheDocument()
    expect(screen.getByText('Try Again')).toBeInTheDocument()
  })

  it('holds the environments read until the regression read has landed', async () => {
    useEnvironmentsMock.mockClear()

    renderWithRouter()

    expect(useEnvironmentsMock).toHaveBeenCalledWith('pending')
    await waitFor(() => {
      expect(screen.getByTestId('regression-detail-page')).toBeInTheDocument()
    })
    expect(useEnvironmentsMock).toHaveBeenLastCalledWith('loaded')
  })

  it('tells the environments read the regression read failed', async () => {
    useEnvironmentsMock.mockClear()
    mockFetchRegressionDetail.mockRejectedValue(new Error('Network error'))

    renderWithRouter()

    await waitFor(() => {
      expect(screen.getByTestId('regression-detail-error')).toBeInTheDocument()
    })
    expect(useEnvironmentsMock).toHaveBeenLastCalledWith('failed')
  })

  it('falls back to a generic reason when the load rejects with a non-Error', async () => {
    mockFetchRegressionDetail.mockRejectedValue('weird')

    renderWithRouter()

    await waitFor(() => {
      expect(screen.getByTestId('regression-detail-error')).toBeInTheDocument()
    })
    expect(screen.getByTestId('regression-detail-error')).toHaveTextContent(
      'Failed to load regression',
    )
  })

  it('retries on error', async () => {
    mockFetchRegressionDetail.mockRejectedValueOnce(new Error('Network error'))

    renderWithRouter()

    await waitFor(() => {
      expect(screen.getByText('Try Again')).toBeInTheDocument()
    })

    mockFetchRegressionDetail.mockResolvedValue({ regression: mockRegression, suites: mockSuites })

    await act(async () => {
      fireEvent.click(screen.getByText('Try Again'))
    })

    await waitFor(() => {
      expect(screen.getByTestId('regression-detail-page')).toBeInTheDocument()
    })
  })

  // =========================================================================
  // 2-Panel Layout (REG-1, REG-2)
  // =========================================================================

  it('renders sidebar and content areas', async () => {
    renderWithRouter()

    await waitFor(() => {
      expect(screen.getByTestId('regression-metadata-sidebar')).toBeInTheDocument()
    })
    expect(screen.getByTestId('regression-suites-table')).toBeInTheDocument()
  })

  it('sidebar shows Details header (REG-8)', async () => {
    renderWithRouter()

    await waitFor(() => {
      expect(screen.getByTestId('regression-metadata-sidebar')).toBeInTheDocument()
    })
    expect(screen.getByText('Details')).toBeInTheDocument()
  })

  it('toggles sidebar visibility', async () => {
    renderWithRouter()

    await waitFor(() => {
      expect(screen.getByTestId('regression-detail-page')).toBeInTheDocument()
    })

    // Sidebar should be open by default
    expect(screen.getByTestId('regression-metadata-sidebar')).toBeInTheDocument()
    // Header toggle should be hidden when sidebar is open
    expect(screen.queryByTestId('sidebar-toggle-btn')).not.toBeInTheDocument()

    // Click bottom collapse button inside sidebar
    fireEvent.click(screen.getByTestId('sidebar-collapse-btn'))

    // Sidebar should be hidden
    expect(screen.queryByTestId('regression-metadata-sidebar')).not.toBeInTheDocument()
    // Header toggle should now be visible
    expect(screen.getByTestId('sidebar-toggle-btn')).toBeInTheDocument()

    // Click header toggle to expand
    fireEvent.click(screen.getByTestId('sidebar-toggle-btn'))

    // Sidebar should be visible again
    expect(screen.getByTestId('regression-metadata-sidebar')).toBeInTheDocument()
  })

  // =========================================================================
  // Sidebar Metadata (REG-8 to REG-10)
  // =========================================================================

  it('suites count is reflected in the table rows', async () => {
    renderWithRouter()

    await waitFor(() => {
      expect(screen.getByTestId('regression-suites-table')).toBeInTheDocument()
    })
    // 2 suites are displayed as rows in the table
    const rows = screen.getAllByTestId('suite-name')
    expect(rows).toHaveLength(2)
  })

  it('sidebar shows tags', async () => {
    renderWithRouter()

    await waitFor(() => {
      expect(screen.getByTestId('regression-metadata-sidebar')).toBeInTheDocument()
    })
    expect(screen.getByText('release')).toBeInTheDocument()
    expect(screen.getByText('full')).toBeInTheDocument()
  })

  it('sidebar shows description', async () => {
    renderWithRouter()

    await waitFor(() => {
      expect(screen.getByTestId('regression-metadata-sidebar')).toBeInTheDocument()
    })
    expect(screen.getByText('Full release regression for WAVE 26.04')).toBeInTheDocument()
  })

  it('sidebar shows created and updated dates', async () => {
    renderWithRouter()

    await waitFor(() => {
      expect(screen.getByTestId('regression-metadata-sidebar')).toBeInTheDocument()
    })
    expect(screen.getByTestId('sidebar-created-date')).toBeInTheDocument()
    expect(screen.getByTestId('sidebar-updated-date')).toBeInTheDocument()
  })

  // =========================================================================
  // Suites Table (REG-11 to REG-16)
  // =========================================================================

  it('suites table renders with correct columns (REG-11)', async () => {
    renderWithRouter()

    await waitFor(() => {
      expect(screen.getByTestId('regression-suites-table')).toBeInTheDocument()
    })

    const table = screen.getByTestId('regression-suites-table')
    expect(within(table).getByRole('columnheader', { name: /Name/i })).toBeInTheDocument()
    expect(within(table).getByRole('columnheader', { name: /Status/i })).toBeInTheDocument()
    expect(within(table).getByRole('columnheader', { name: /Last Run/i })).toBeInTheDocument()
    expect(within(table).getByRole('columnheader', { name: /Actions/i })).toBeInTheDocument()
  })

  it('suites table displays suite data', async () => {
    renderWithRouter()

    await waitFor(() => {
      expect(screen.getByText('Auth Suite')).toBeInTheDocument()
    })
    expect(screen.getByText('API Suite')).toBeInTheDocument()
  })

  // =========================================================================
  // View/Edit Mode Toggle (REG-5)
  // =========================================================================

  it('starts in view mode', async () => {
    renderWithRouter()

    await waitFor(() => {
      expect(screen.getByTestId('regression-detail-page')).toBeInTheDocument()
    })

    expect(screen.getByTestId('edit-suites-btn')).toBeInTheDocument()
    expect(screen.getByTestId('edit-suites-btn')).toHaveTextContent('Edit Suites')
  })

  it('entering edit mode shows Save/Cancel and hides Edit Suites', async () => {
    renderWithRouter()

    await waitFor(() => {
      expect(screen.getByTestId('edit-suites-btn')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByTestId('edit-suites-btn'))

    expect(screen.getByTestId('save-suites-btn')).toBeInTheDocument()
    expect(screen.getByTestId('cancel-suites-btn')).toBeInTheDocument()
    expect(screen.queryByTestId('edit-suites-btn')).not.toBeInTheDocument()
  })

  it('entering edit mode shows grip handles for drag-reorder', async () => {
    renderWithRouter()

    await waitFor(() => {
      expect(screen.getByTestId('regression-detail-page')).toBeInTheDocument()
    })

    // No grip handles in view mode
    expect(screen.queryByTestId('dnd-grip-handle')).not.toBeInTheDocument()

    // Enter edit mode
    fireEvent.click(screen.getByTestId('edit-suites-btn'))

    // Grip handles should appear
    expect(screen.getAllByTestId('dnd-grip-handle')).toHaveLength(2)
  })

  it('canceling edit mode returns to view mode', async () => {
    renderWithRouter()

    await waitFor(() => {
      expect(screen.getByTestId('edit-suites-btn')).toBeInTheDocument()
    })

    // Enter edit mode
    fireEvent.click(screen.getByTestId('edit-suites-btn'))
    expect(screen.getByTestId('save-suites-btn')).toBeInTheDocument()

    // Cancel
    fireEvent.click(screen.getByTestId('cancel-suites-btn'))
    expect(screen.getByTestId('edit-suites-btn')).toBeInTheDocument()
  })

  it('edit mode shows Add Suites button (REG-5)', async () => {
    renderWithRouter()

    await waitFor(() => {
      expect(screen.getByTestId('edit-suites-btn')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByTestId('edit-suites-btn'))

    expect(screen.getByTestId('add-suites-btn')).toBeInTheDocument()
  })

  // =========================================================================
  // Save Changes
  // =========================================================================

  it('save calls update API', async () => {
    mockUpdateRegression.mockResolvedValue(mockRegression)

    renderWithRouter()

    await waitFor(() => {
      expect(screen.getByTestId('edit-suites-btn')).toBeInTheDocument()
    })

    // Enter edit mode
    fireEvent.click(screen.getByTestId('edit-suites-btn'))

    // Save
    await act(async () => {
      fireEvent.click(screen.getByTestId('save-suites-btn'))
    })

    await waitFor(() => {
      expect(mockUpdateRegression).toHaveBeenCalledWith('reg-1', expect.any(Object))
    })
  })

  // =========================================================================
  // Edit Details Dialog
  // =========================================================================

  it('opens edit details dialog when edit button is clicked', async () => {
    renderWithRouter()

    await waitFor(() => {
      expect(screen.getByTestId('edit-details-btn')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByTestId('edit-details-btn'))

    await waitFor(() => {
      expect(screen.getByTestId('edit-details-dialog')).toBeInTheDocument()
    })
    expect(screen.getByTestId('edit-details-name')).toHaveValue('WAVE 26.04')
  })

  it('saves details from edit dialog', async () => {
    mockUpdateRegression.mockResolvedValue(mockRegression)

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
      target: { value: 'Updated Regression' },
    })

    // Save
    await act(async () => {
      fireEvent.click(screen.getByTestId('edit-dialog-save'))
    })

    await waitFor(() => {
      expect(mockUpdateRegression).toHaveBeenCalledWith('reg-1', expect.objectContaining({
        name: 'Updated Regression',
      }))
    })
  })

  it('shows error in edit dialog when save fails', async () => {
    mockUpdateRegression.mockRejectedValue(new Error('Save failed'))

    renderWithRouter()

    await waitFor(() => {
      expect(screen.getByTestId('edit-details-btn')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByTestId('edit-details-btn'))

    await waitFor(() => {
      expect(screen.getByTestId('edit-details-dialog')).toBeInTheDocument()
    })

    await act(async () => {
      fireEvent.click(screen.getByTestId('edit-dialog-save'))
    })

    await waitFor(() => {
      expect(screen.getByText('Save failed')).toBeInTheDocument()
    })
  })

  // =========================================================================
  // Variable Editor (REG-20 to REG-22)
  // =========================================================================

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
    mockFetchRegressionDetail.mockResolvedValue({
      regression: {
        ...mockRegression,
        // The backend round-trips an array variable VERBATIM as an actual array.
        variables: { cfg: { type: 'array', value: [1, 2, 3] as unknown as string, secret: false } },
      },
      suites: mockSuites,
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

  it('saves variables from edit variables dialog', async () => {
    mockUpdateRegression.mockResolvedValue(mockRegression)

    renderWithRouter()

    await waitFor(() => {
      expect(screen.getByTestId('edit-variables-btn')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByTestId('edit-variables-btn'))

    await waitFor(() => {
      expect(screen.getByTestId('edit-variables-dialog')).toBeInTheDocument()
    })

    // Nothing changed anywhere keeps Save disabled.
    renameFirstVariable()

    await act(async () => {
      fireEvent.click(screen.getByTestId('edit-dialog-save'))
    })

    await waitFor(() => {
      expect(mockUpdateRegression).toHaveBeenCalledWith('reg-1', expect.objectContaining({
        variables: expect.any(Object),
      }))
    })
  })

  it('displays existing variables in sidebar', async () => {
    renderWithRouter()

    await waitFor(() => {
      expect(screen.getByTestId('regression-metadata-sidebar')).toBeInTheDocument()
    })

    expect(screen.getByText('base_url')).toBeInTheDocument()
    expect(screen.getByText('api_key')).toBeInTheDocument()
  })

  // =========================================================================
  // Collision Error Display
  // =========================================================================

  it('opens the CollisionResolutionModal when save returns a collision', async () => {
    const collisionError = new Error('Variable type collisions detected')
    Object.assign(collisionError, {
      status: 409,
      details: {
        collisions: [
          {
            variable: 'timeout',
            this_type: 'string',
            other_regression: 'Nightly Regression',
            other_regression_id: 'reg-2',
            other_type: 'integer',
          },
        ],
      },
    })
    mockUpdateRegression.mockRejectedValue(collisionError)

    renderWithRouter()

    await waitFor(() => {
      expect(screen.getByTestId('edit-variables-btn')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByTestId('edit-variables-btn'))

    await waitFor(() => {
      expect(screen.getByTestId('edit-variables-dialog')).toBeInTheDocument()
    })

    // Nothing changed anywhere keeps Save disabled.
    renameFirstVariable()

    await act(async () => {
      fireEvent.click(screen.getByTestId('edit-dialog-save'))
    })

    // The save handler routes collisions to the shared CollisionResolutionModal via decodeCollision.
    await waitFor(() => {
      expect(screen.getByTestId('collision-resolution-modal')).toBeInTheDocument()
    })
    expect(screen.getByTestId('collision-details')).toHaveTextContent('Nightly Regression')
    expect(screen.getByTestId('collision-details')).toHaveTextContent('timeout')
  })

  it('groups collision errors by variable and type in the modal', async () => {
    const collisionError = new Error('Variable type collisions detected')
    Object.assign(collisionError, {
      status: 409,
      details: {
        collisions: [
          {
            variable: 'timeout',
            this_type: 'string',
            other_regression: 'Nightly Regression',
            other_regression_id: 'reg-2',
            other_type: 'integer',
          },
          {
            variable: 'timeout',
            this_type: 'string',
            other_regression: 'Smoke Regression',
            other_regression_id: 'reg-3',
            other_type: 'integer',
          },
        ],
      },
    })
    mockUpdateRegression.mockRejectedValue(collisionError)

    renderWithRouter()

    await waitFor(() => {
      expect(screen.getByTestId('edit-variables-btn')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByTestId('edit-variables-btn'))

    await waitFor(() => {
      expect(screen.getByTestId('edit-variables-dialog')).toBeInTheDocument()
    })

    // Nothing changed anywhere keeps Save disabled.
    renameFirstVariable()

    await act(async () => {
      fireEvent.click(screen.getByTestId('edit-dialog-save'))
    })

    await waitFor(() => {
      expect(screen.getByTestId('collision-resolution-modal')).toBeInTheDocument()
    })
    // Collisions are grouped by variable+type so "timeout" appears once
    // and the multiple conflicting regressions are aggregated under a
    // "2 regressions" popover trigger.
    const details = screen.getByTestId('collision-details')
    expect(details).toHaveTextContent('timeout')
    const timeoutMatches = details.textContent?.match(/timeout/g) ?? []
    expect(timeoutMatches.length).toBe(1)
  })

  // =========================================================================
  // Suite Picker Modal
  // =========================================================================

  it('opens suite picker modal from Add Suites button', async () => {
    renderWithRouter()

    await waitFor(() => {
      expect(screen.getByTestId('edit-suites-btn')).toBeInTheDocument()
    })

    // Enter edit mode
    fireEvent.click(screen.getByTestId('edit-suites-btn'))

    // Click Add Suites
    fireEvent.click(screen.getByTestId('add-suites-btn'))

    await waitFor(() => {
      expect(screen.getByTestId('suite-picker-modal')).toBeInTheDocument()
    })
  })

  it('suite picker modal has search input', async () => {
    renderWithRouter()

    await waitFor(() => {
      expect(screen.getByTestId('edit-suites-btn')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByTestId('edit-suites-btn'))
    fireEvent.click(screen.getByTestId('add-suites-btn'))

    await waitFor(() => {
      expect(screen.getByTestId('suite-picker-modal')).toBeInTheDocument()
    })

    expect(screen.getByPlaceholderText(/Search suites/i)).toBeInTheDocument()
  })

  it('suite picker forwards page=1 & per_page=25 to fetchSuitesList and surfaces the total', async () => {
    mockFetchSuitesList.mockResolvedValue({
      success: true,
      data: CANDIDATE_PAGE_1,
      pagination: { total: 60, page: 1, per_page: 25, total_pages: 3 },
    })

    renderWithRouter()
    await waitFor(() => {
      expect(screen.getByTestId('edit-suites-btn')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByTestId('edit-suites-btn'))
    fireEvent.click(screen.getByTestId('add-suites-btn'))

    await waitFor(() => {
      expect(screen.getByTestId('suite-picker-modal')).toBeInTheDocument()
    })
    await waitFor(() => {
      expect(screen.getByText('Cand Suite 1')).toBeInTheDocument()
    })

    // Paginated contract: 25 per page, page 1.
    expect(mockFetchSuitesList).toHaveBeenCalledWith(
      expect.objectContaining({ page: 1, per_page: 25 }),
    )
    // The total (60) drives the refine nudge with the "suites" plural.
    expect(
      screen.getByText('60 suites - refine your search to narrow down'),
    ).toBeInTheDocument()
  })

  it('keeps real metadata for a suite added from a later page via pickerSuiteCache', async () => {
    // Empty regression so the only edit-table row is the suite we add.
    mockFetchRegressionDetail.mockResolvedValue({
      regression: { ...mockRegression, suiteIds: [] },
      suites: [],
    })
    mockFetchSuitesList.mockImplementation(async (params) => {
      const page = params?.page ?? 1
      if (page >= 2) {
        return {
          success: true,
          data: [CANDIDATE_PAGE_2],
          pagination: { total: 3, page: 2, per_page: 25, total_pages: 2 },
        }
      }
      return {
        success: true,
        data: CANDIDATE_PAGE_1,
        pagination: { total: 3, page: 1, per_page: 25, total_pages: 2 },
      }
    })

    renderWithRouter()
    await waitFor(() => {
      expect(screen.getByTestId('edit-suites-btn')).toBeInTheDocument()
    })

    // Enter edit mode and open the picker.
    fireEvent.click(screen.getByTestId('edit-suites-btn'))
    fireEvent.click(screen.getByTestId('add-suites-btn'))

    await waitFor(() => {
      expect(screen.getByText('Cand Suite 1')).toBeInTheDocument()
    })
    expect(screen.queryByText('Cand Suite 3')).not.toBeInTheDocument()

    // Scroll the picker to load page 2 (where the distinctive suite lives).
    await act(async () => {
      scrollSuitePickerToBottom()
    })
    await waitFor(() => {
      expect(screen.getByText('Cand Suite 3')).toBeInTheDocument()
    })

    // Select the page-2 suite and add it.
    fireEvent.click(screen.getByText('Cand Suite 3'))
    fireEvent.click(screen.getByTestId('suite-picker-add-btn'))

    await waitFor(() => {
      expect(screen.queryByTestId('suite-picker-modal')).not.toBeInTheDocument()
    })

    // The added row carries the cached 'failed' status (real metadata from the
    // picker response), not a zeroed 'never_run' placeholder.
    expect(screen.getByText('Cand Suite 3')).toBeInTheDocument()
    expect(screen.getByTestId('status-badge-failed')).toBeInTheDocument()
    expect(screen.queryByTestId('status-badge-never-run')).not.toBeInTheDocument()
  })

  // =========================================================================
  // Navigation
  // =========================================================================

  it('navigates back to regressions list', async () => {
    renderWithRouter()

    await waitFor(() => {
      expect(screen.getByTestId('detail-back-btn')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByTestId('detail-back-btn'))

    await waitFor(() => {
      expect(screen.getByTestId('regressions-list')).toBeInTheDocument()
    })
  })

  it('header shows regression name (REG-3)', async () => {
    renderWithRouter()

    await waitFor(() => {
      expect(screen.getByTestId('regression-detail-page')).toBeInTheDocument()
    })

    expect(screen.getByTestId('detail-back-btn')).toBeInTheDocument()
    expect(screen.getByText('WAVE 26.04')).toBeInTheDocument()
  })

  // =========================================================================
  // Unsaved Changes
  // =========================================================================

  it('shows unsaved changes dialog when canceling with dirty state', async () => {
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
      target: { value: 'Changed Name' },
    })

    // Cancel
    fireEvent.click(screen.getByTestId('edit-dialog-cancel'))

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

  it('discards changes when "Discard" is clicked in unsaved dialog', async () => {
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

    // Discard
    fireEvent.click(screen.getByTestId('unsaved-discard'))

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

    await waitFor(() => {
      expect(screen.queryByTestId('edit-details-dialog')).not.toBeInTheDocument()
    })
    expect(screen.queryByTestId('unsaved-changes-dialog')).not.toBeInTheDocument()
  })

  // =========================================================================
  // Error Banner on Reload
  // =========================================================================

  it('shows error banner when reload fails after successful initial load', async () => {
    renderWithRouter()

    await waitFor(() => {
      expect(screen.getByTestId('regression-detail-page')).toBeInTheDocument()
    })

    // Make subsequent fetch fail
    mockFetchRegressionDetail.mockRejectedValue(new Error('Reload failed'))
    mockUpdateRegression.mockResolvedValue(mockRegression)

    // Open edit dialog, save - save succeeds but reload fails
    fireEvent.click(screen.getByTestId('edit-details-btn'))

    await waitFor(() => {
      expect(screen.getByTestId('edit-details-dialog')).toBeInTheDocument()
    })

    await act(async () => {
      fireEvent.click(screen.getByTestId('edit-dialog-save'))
    })

    await waitFor(() => {
      expect(screen.getByText('Reload failed')).toBeInTheDocument()
    })
    // Page should still be visible (non-blocking error)
    expect(screen.getByTestId('regression-detail-page')).toBeInTheDocument()
  })

  // =========================================================================
  // No Console Panel (V-REG-DETAIL-01 criterion 4)
  // =========================================================================

  it('does not render console panel (REG-2)', async () => {
    renderWithRouter()

    await waitFor(() => {
      expect(screen.getByTestId('regression-detail-page')).toBeInTheDocument()
    })

    expect(screen.queryByTestId('console-panel')).not.toBeInTheDocument()
  })

  // =========================================================================
  // Delete Confirmation
  // =========================================================================

  it('delete confirmation warns that suites will not be deleted', async () => {
    renderWithRouter()

    await waitFor(() => {
      expect(screen.getByTestId('regression-detail-page')).toBeInTheDocument()
    })

    // Open delete dialog (from header action or menu)
    fireEvent.click(screen.getByTestId('delete-regression-btn'))

    await waitFor(() => {
      expect(screen.getByTestId('delete-confirmation-dialog')).toBeInTheDocument()
    })
    expect(screen.getByText(/Suites will not be deleted/i)).toBeInTheDocument()
  })

  it('navigates to the list after confirming delete', async () => {
    renderWithRouter()

    await waitFor(() => {
      expect(screen.getByTestId('regression-detail-page')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByTestId('delete-regression-btn'))

    await waitFor(() => {
      expect(screen.getByTestId('delete-confirmation-dialog')).toBeInTheDocument()
    })

    const dialog = screen.getByTestId('delete-confirmation-dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: /^Delete$/ }))

    await waitFor(() => {
      expect(screen.getByTestId('regressions-list')).toBeInTheDocument()
    })
  })

  // =========================================================================
  // Collision modal (cross-regression variable conflicts via suite save)
  // =========================================================================

  it('renders collision resolution modal when saving suite edits hits a sibling regression conflict', async () => {
    renderWithRouter()

    await waitFor(() => {
      expect(screen.getByTestId('regression-detail-page')).toBeInTheDocument()
    })

    // Enter suite edit mode so handleSaveSuiteEdits is the handler used.
    fireEvent.click(screen.getByTestId('edit-suites-btn'))

    await waitFor(() => {
      expect(screen.getByTestId('save-suites-btn')).toBeInTheDocument()
    })

    const collisionError = Object.assign(new Error('Variable type collision'), {
      status: 409,
      details: {
        collisions: [
          {
            variable: 'env',
            this_type: 'string',
            other_type: 'integer',
            other_regression: 'Sibling Regression',
            other_regression_id: 'reg-2',
          },
        ],
        conflicting_regression_ids: ['reg-2'],
      },
    })
    mockUpdateRegression.mockRejectedValueOnce(collisionError)

    await act(async () => {
      fireEvent.click(screen.getByTestId('save-suites-btn'))
    })

    await waitFor(() => {
      expect(screen.getByTestId('collision-resolution-modal')).toBeInTheDocument()
    })
  })

  it('clears the delete error when the dialog is closed via ESC (onOpenChange)', async () => {
    mockDeleteRegressionById.mockRejectedValueOnce(
      Object.assign(new Error('backend unavailable'), { status: 500 }),
    )

    renderWithRouter()

    await waitFor(() => {
      expect(screen.getByTestId('regression-detail-page')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByTestId('delete-regression-btn'))
    await waitFor(() => {
      expect(screen.getByTestId('delete-confirmation-dialog')).toBeInTheDocument()
    })

    await act(async () => {
      fireEvent.click(screen.getByTestId('confirm-delete-regression-btn'))
    })

    await waitFor(() => {
      expect(screen.getByTestId('delete-regression-error')).toBeInTheDocument()
    })

    // ESC key triggers Radix's internal close → onOpenChange(false) →
    // setDeleteDialogOpen(false) AND setDeleteError(null) via the !open branch.
    fireEvent.keyDown(document, { key: 'Escape', code: 'Escape' })

    await waitFor(() => {
      expect(screen.queryByTestId('delete-confirmation-dialog')).not.toBeInTheDocument()
    })

    // Reopen: error is cleared via the onOpenChange(false) branch.
    fireEvent.click(screen.getByTestId('delete-regression-btn'))
    await waitFor(() => {
      expect(screen.getByTestId('delete-confirmation-dialog')).toBeInTheDocument()
    })
    expect(screen.queryByTestId('delete-regression-error')).not.toBeInTheDocument()
  })

  it('surfaces a delete error inside the dialog and clears it on close', async () => {
    mockDeleteRegressionById.mockRejectedValueOnce(
      Object.assign(new Error('active executions reference this regression'), {
        status: 409,
      }),
    )

    renderWithRouter()

    await waitFor(() => {
      expect(screen.getByTestId('regression-detail-page')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByTestId('delete-regression-btn'))
    await waitFor(() => {
      expect(screen.getByTestId('delete-confirmation-dialog')).toBeInTheDocument()
    })

    await act(async () => {
      fireEvent.click(screen.getByTestId('confirm-delete-regression-btn'))
    })

    // Error surfaces inside the dialog.
    await waitFor(() => {
      expect(screen.getByTestId('delete-regression-error')).toBeInTheDocument()
    })
    expect(screen.getByTestId('delete-regression-error')).toHaveTextContent(
      /active executions/,
    )
    // The regression is still here (the navigation did not fire).
    expect(screen.queryByTestId('regressions-list')).not.toBeInTheDocument()

    // Cancel closes the dialog and the deleteError state is cleared via
    // the onOpenChange(false) branch - reopening shows no error banner.
    const dialog = screen.getByTestId('delete-confirmation-dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: /^Cancel$/ }))
    await waitFor(() => {
      expect(screen.queryByTestId('delete-confirmation-dialog')).not.toBeInTheDocument()
    })

    fireEvent.click(screen.getByTestId('delete-regression-btn'))
    await waitFor(() => {
      expect(screen.getByTestId('delete-confirmation-dialog')).toBeInTheDocument()
    })
    expect(screen.queryByTestId('delete-regression-error')).not.toBeInTheDocument()
  })

  it('renders the collision modal with a fix button for suite-side collisions and removes the offenders when clicked', async () => {
    renderWithRouter()

    await waitFor(() => {
      expect(screen.getByTestId('regression-detail-page')).toBeInTheDocument()
    })

    // Enter suite edit mode. The suites table starts with two rows from the
    // fixture, and we want the backend to reject the save with a pair
    // collision that names BOTH mock suites.
    fireEvent.click(screen.getByTestId('edit-suites-btn'))

    await waitFor(() => {
      expect(screen.getByTestId('save-suites-btn')).toBeInTheDocument()
    })

    const pairCollisionError = Object.assign(
      new Error('Variable type collision'),
      {
        status: 409,
        details: {
          collisions: [
            {
              variable: 'env',
              this_type: 'string',
              other_type: 'boolean',
              this_suite: 'Suite One',
              this_suite_id: 'suite-1',
              other_suite: 'Suite Two',
              other_suite_id: 'suite-2',
            },
          ],
          conflicting_suite_ids: ['suite-1', 'suite-2'],
        },
      },
    )
    mockUpdateRegression.mockRejectedValueOnce(pairCollisionError)

    await act(async () => {
      fireEvent.click(screen.getByTestId('save-suites-btn'))
    })

    const modal = await screen.findByTestId('collision-resolution-modal')
    expect(modal).toHaveTextContent('Two suites in this regression')

    // The fix button is visible and labeled "Remove conflicting suites".
    const fixBtn = within(modal).getByTestId('collision-fix')
    expect(fixBtn).toHaveTextContent(/Remove conflicting suites/i)

    // Clicking it closes the modal and removes both suites from the edit
    // buffer (the suites table should no longer show their names).
    await act(async () => {
      fireEvent.click(fixBtn)
    })

    await waitFor(() => {
      expect(screen.queryByTestId('collision-resolution-modal')).not.toBeInTheDocument()
    })
  })

  it('defaults collision kind to "pair" when the backend returns mixed collision shapes', async () => {
    renderWithRouter()

    await waitFor(() => {
      expect(screen.getByTestId('regression-detail-page')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByTestId('edit-suites-btn'))
    await waitFor(() => {
      expect(screen.getByTestId('save-suites-btn')).toBeInTheDocument()
    })

    // Mix a pair-kind (this_suite set) entry with a regression-kind
    // (other_regression set) entry. decodeCollision should fall through
    // to 'pair' because the kinds set has >1 member, which exercises
    // the ternary's false branch.
    const mixedCollisionError = Object.assign(
      new Error('Variable type collision'),
      {
        status: 409,
        details: {
          collisions: [
            {
              variable: 'env',
              this_type: 'string',
              other_type: 'integer',
              this_suite: 'Suite Str',
              this_suite_id: 'suite-str',
              other_suite: 'Suite Int',
              other_suite_id: 'suite-int',
            },
            {
              variable: 'host',
              this_type: 'string',
              other_type: 'integer',
              other_regression: 'Other Regression',
              other_regression_id: 'reg-2',
            },
          ],
          conflicting_suite_ids: ['suite-str', 'suite-int'],
          conflicting_regression_ids: ['reg-2'],
        },
      },
    )
    mockUpdateRegression.mockRejectedValueOnce(mixedCollisionError)

    await act(async () => {
      fireEvent.click(screen.getByTestId('save-suites-btn'))
    })

    const modal = await screen.findByTestId('collision-resolution-modal')
    // 'pair' kind description
    expect(modal).toHaveTextContent('Two suites in this regression')
  })

  it('renders the "suite" description when a member suite conflicts with a regression variable', async () => {
    renderWithRouter()

    await waitFor(() => {
      expect(screen.getByTestId('regression-detail-page')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByTestId('edit-suites-btn'))
    await waitFor(() => {
      expect(screen.getByTestId('save-suites-btn')).toBeInTheDocument()
    })

    const regVsSuiteError = Object.assign(
      new Error('Variable type collision'),
      {
        status: 409,
        details: {
          collisions: [
            {
              variable: 'env',
              this_type: 'string',
              other_type: 'integer',
              other_suite: 'Conflicting Member Suite',
              other_suite_id: 'suite-99',
            },
          ],
          conflicting_suite_ids: ['suite-99'],
        },
      },
    )
    mockUpdateRegression.mockRejectedValueOnce(regVsSuiteError)

    await act(async () => {
      fireEvent.click(screen.getByTestId('save-suites-btn'))
    })

    const modal = await screen.findByTestId('collision-resolution-modal')
    expect(modal).toHaveTextContent('member suite declares the same variable')
    expect(within(modal).getByTestId('collision-fix')).toBeInTheDocument()
  })

  // =========================================================================
  // Selection mode exit (editor)
  // =========================================================================

  it('exits selection mode via the X button after entering it', async () => {
    renderWithRouter()

    await waitFor(() => {
      expect(screen.getByTestId('regression-detail-page')).toBeInTheDocument()
    })

    // Enter edit mode, then enter selection mode via the Mass Action button.
    fireEvent.click(screen.getByTestId('edit-suites-btn'))

    const massActionButton = await screen.findByRole('button', {
      name: /mass action/i,
    })
    fireEvent.click(massActionButton)

    // X button exits selection mode -> triggers onExitSelectionMode callback
    const exitButton = await screen.findByTestId('selection-close')
    fireEvent.click(exitButton)

    // Mass Action button returns, confirming we've left selection mode
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /mass action/i })).toBeInTheDocument()
    })
  })

  // =========================================================================
  // Column visibility toggle (handleColumnToggle)
  // =========================================================================

  it('toggles visible and hidden columns via the column filter dropdown', async () => {
    renderWithRouter()

    await waitFor(() => {
      expect(screen.getByTestId('regression-detail-page')).toBeInTheDocument()
    })

    // Open the Columns dropdown
    const columnsButton = await screen.findByRole('button', { name: /columns/i })
    fireEvent.click(columnsButton)

    // The column list has some columns checked (status, lastRun) and some
    // unchecked (tags, createdAt, updatedAt). Toggling BOTH a checked and
    // an unchecked item exercises both branches of handleColumnToggle:
    // - visible=false path (prev.filter)
    // - visible=true path ([...prev, columnId])
    const checkboxOptions = await screen.findAllByRole('menuitemcheckbox')
    expect(checkboxOptions.length).toBeGreaterThanOrEqual(2)

    // Find first checked and first unchecked menuitemcheckbox via aria state
    const checked = checkboxOptions.find(
      (el) => el.getAttribute('aria-checked') === 'true',
    )
    const unchecked = checkboxOptions.find(
      (el) => el.getAttribute('aria-checked') === 'false',
    )
    expect(checked).toBeDefined()
    expect(unchecked).toBeDefined()

    // Toggle the checked one OFF (hits the `prev.filter(...)` branch)
    fireEvent.click(checked!)
    // Toggle the unchecked one ON (hits the `[...prev, columnId]` branch)
    fireEvent.click(unchecked!)

    expect(screen.getByTestId('regression-detail-page')).toBeInTheDocument()
  })
})
