/**
 * ArtifactsFilters (coverage for components/artifacts-filters.tsx).
 *
 * Thin EntityFilterWrapper wrapper exposing search + status/type pills and the
 * column toggle. The wrapper internals are covered elsewhere; this pins the
 * artifacts wiring (entity name, default filters, fields).
 */

import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import {
  ArtifactsFilters,
  DEFAULT_ARTIFACTS_FILTERS,
} from '@/features/artifacts/components/artifacts-filters'

const COLUMNS = [
  { id: 'execution', label: 'Execution', visible: true },
  { id: 'status', label: 'Status', visible: true },
]

describe('ArtifactsFilters', () => {
  it('renders the artifacts search field (default enabled)', () => {
    render(
      <ArtifactsFilters
        filters={DEFAULT_ARTIFACTS_FILTERS}
        columns={COLUMNS}
        onFilterChange={vi.fn()}
        onColumnToggle={vi.fn()}
      />,
    )

    expect(screen.getByPlaceholderText(/search artifacts/i)).toBeInTheDocument()
  })

  it('disables the controls when disabled', () => {
    render(
      <ArtifactsFilters
        filters={{ search: 'x', status: ['failed'], type: ['suite'] }}
        columns={COLUMNS}
        onFilterChange={vi.fn()}
        onColumnToggle={vi.fn()}
        disabled
      />,
    )

    expect(screen.getByPlaceholderText(/search artifacts/i)).toBeDisabled()
  })
})
