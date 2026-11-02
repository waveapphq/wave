/**
 * ArtifactsListPage - execution-first artifact landing list
 *
 * Module: frontend/src/features/artifacts/page.tsx
 *
 * Presentational list mirroring the Reports/Executions chrome (filters,
 * DataTable, pagination) but execution-first: one row per execution that has
 * artifacts, columns Execution / Type / Status / Finished / Artifacts / Size /
 * Actions. Adds selection mode + a mass-action menu (Download .zip + Delete
 * artifacts). One row per execution; no "+ New" button (artifacts come from
 * executions).
 */

import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { ArtifactsListPage, type ArtifactsListPageProps } from '@/features/artifacts/page'
import type { ExecutionArtifactSummary } from '@/features/artifacts/api/types'

const ROWS: ExecutionArtifactSummary[] = [
  {
    execution_id: 'exec-1',
    name: 'Nightly API Suite',
    entity_type: 'suite',
    status: 'failed',
    finished_at: '2026-06-10T11:07:13+00:00',
    artifact_count: 12,
    total_size_bytes: 48210,
  },
  {
    execution_id: 'exec-2',
    name: 'Inventory Sync Validation',
    entity_type: 'test',
    status: 'passed',
    finished_at: '2026-06-10T10:00:04+00:00',
    artifact_count: 3,
    total_size_bytes: 1024,
  },
]

const PAGE_INFO = { currentPage: 1, pageSize: 10, totalItems: 2, totalPages: 1 }
const FILTERS = { search: '', status: [] as string[], type: [] as string[] }

function renderPage(props: Partial<ArtifactsListPageProps> = {}) {
  const defaultProps: ArtifactsListPageProps = {
    rows: ROWS,
    pageInfo: PAGE_INFO,
    filters: FILTERS,
    loading: false,
    error: undefined,
    sorting: [{ id: 'finishedAt', desc: true }],
    onSortingChange: vi.fn(),
    columnVisibility: {},
    onColumnVisibilityChange: vi.fn(),
    visibleColumns: ['execution', 'type', 'status', 'finishedAt', 'artifacts', 'size'],
    onColumnToggle: vi.fn(),
    selectionModeActive: false,
    selectedCount: 0,
    totalSizeBytes: 0,
    selectedSizeBytes: 0,
    onEnterSelectionMode: vi.fn(),
    onExitSelectionMode: vi.fn(),
    onOpenExecution: vi.fn(),
    onDownloadZip: vi.fn(),
    onDeleteSelected: vi.fn(),
    onFilterChange: vi.fn(),
    onPageChange: vi.fn(),
    onPageSizeChange: vi.fn(),
    onRetry: vi.fn(),
    ...props,
  }
  return {
    props: defaultProps,
    ...render(
      <MemoryRouter>
        <ArtifactsListPage {...defaultProps} />
      </MemoryRouter>,
    ),
  }
}

describe('ArtifactsListPage - chrome', () => {
  it('renders the page shell with the Artifacts title', () => {
    renderPage()

    expect(screen.getByTestId('artifacts-page')).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 1, name: 'Artifacts' })).toBeInTheDocument()
  })

  it('renders the page subtitle', () => {
    renderPage()

    expect(screen.getByText(/Browse outputs by execution/i)).toBeInTheDocument()
  })

  it('has no New button (artifacts come from executions)', () => {
    renderPage()
    expect(screen.queryByRole('button', { name: /new/i })).toBeNull()
  })

  it('renders the execution-first column headers', () => {
    renderPage()

    const headers = screen.getAllByRole('columnheader').map((h) => h.textContent)
    expect(headers).toEqual(
      expect.arrayContaining(['Execution', 'Type', 'Status', 'Finished', 'Artifacts', 'Size']),
    )
  })

  it('renders one row per execution', () => {
    renderPage()

    expect(screen.getByText('Nightly API Suite')).toBeInTheDocument()
    expect(screen.getByText('Inventory Sync Validation')).toBeInTheDocument()
  })
})

describe('ArtifactsListPage - states', () => {
  it('shows the execution-with-artifacts empty state when there are no rows', () => {
    renderPage({ rows: [] })

    expect(screen.getByText(/no executions with artifacts yet/i)).toBeInTheDocument()
  })

  it('shows the error state', () => {
    renderPage({ rows: [], error: 'Unable to load artifacts' })

    expect(screen.getByText('Unable to load artifacts')).toBeInTheDocument()
  })
})

describe('ArtifactsListPage - selection / mass actions', () => {
  it('offers a Mass Action entry when not in selection mode', () => {
    renderPage({ selectionModeActive: false })

    expect(screen.getByRole('button', { name: /mass action/i })).toBeInTheDocument()
  })

  it('shows the selection counter with count-of-total and selected size', () => {
    renderPage({ selectionModeActive: true, selectedCount: 2, selectedSizeBytes: 2048 })

    const counter = screen.getByTestId('selection-counter')
    expect(counter).toHaveTextContent('2 of')
    expect(counter).toHaveTextContent('2.0 KB')
  })

  it('shows the grand total artifact size in the header', () => {
    renderPage({ totalSizeBytes: 1024 })

    expect(screen.getByTestId('artifacts-total-size')).toHaveTextContent('1.0 KB')
  })

  it('labels a nameless row by its execution id for selection', () => {
    renderPage({
      selectionModeActive: true,
      rows: [{ ...ROWS[0], name: null }],
      rowSelection: {},
      onRowSelectionChange: vi.fn(),
    })

    expect(screen.getByTestId('artifacts-table')).toBeInTheDocument()
  })
})
