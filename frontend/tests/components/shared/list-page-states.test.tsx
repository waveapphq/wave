/**
 * ListPageStates Component Tests
 *
 * Tests for shared error, empty, and loading state components
 * used across entity list pages (suites, tests, regressions).
 *
 * Design decisions:
 * - LIST-5: Error: empathetic tone, "Try Again" button, red alert icon
 * - LIST-6: Empty: entity-specific icon, encouraging message, primary CTA
 */

import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { FolderOpen } from 'lucide-react'
import {
  ListErrorState,
  ListEmptyState,
  ListLoadingPagination,
} from '@/components/shared/list-page-states'

// ============================================================================
// ListErrorState Tests
// ============================================================================

describe('ListErrorState', () => {
  it('renders entity-specific title', () => {
    render(<ListErrorState entityName="suites" onRetry={vi.fn()} />)
    expect(screen.getByTestId('error-state-title')).toHaveTextContent('Unable to load suites')
  })

  it('renders error detail when provided', () => {
    render(<ListErrorState entityName="tests" error="Network timeout" onRetry={vi.fn()} />)
    const description = screen.getByTestId('error-state-description')
    expect(description).toHaveTextContent('(Network timeout)')
  })

  it('hides error detail when not provided', () => {
    render(<ListErrorState entityName="tests" onRetry={vi.fn()} />)
    const description = screen.getByTestId('error-state-description')
    expect(description).not.toHaveTextContent('(')
  })

  it('renders alert icon with error styling', () => {
    render(<ListErrorState entityName="suites" onRetry={vi.fn()} />)
    const icon = screen.getByTestId('error-state-icon')
    expect(icon).toBeVisible()
    expect(icon).toHaveClass('text-error')
  })

  it('renders "Try Again" button', () => {
    render(<ListErrorState entityName="suites" onRetry={vi.fn()} />)
    expect(screen.getByRole('button', { name: /Try Again/i })).toBeVisible()
  })

  it('retry button fires callback', async () => {
    const user = userEvent.setup()
    const handleRetry = vi.fn()

    render(<ListErrorState entityName="suites" onRetry={handleRetry} />)
    await user.click(screen.getByRole('button', { name: /Try Again/i }))

    expect(handleRetry).toHaveBeenCalledTimes(1)
  })

  it('renders empathetic description text', () => {
    render(<ListErrorState entityName="regressions" onRetry={vi.fn()} />)
    expect(screen.getByTestId('error-state-description')).toHaveTextContent(
      'Something went wrong while loading. Please try again.'
    )
  })

  it('renders error-state container', () => {
    render(<ListErrorState entityName="tests" onRetry={vi.fn()} />)
    expect(screen.getByTestId('error-state')).toBeInTheDocument()
  })
})

// ============================================================================
// ListEmptyState Tests
// ============================================================================

describe('ListEmptyState', () => {
  const defaultProps = {
    entityName: 'suites',
    entityNameSingular: 'Suite',
    icon: FolderOpen,
    emptyDescription: 'Suites help you organize tests into logical groups',
    isFilteredEmpty: false,
    onClearFilters: vi.fn(),
    onCreateNew: vi.fn(),
  }

  describe('Filtered empty state', () => {
    it('renders filtered empty state with correct title', () => {
      render(<ListEmptyState {...defaultProps} isFilteredEmpty />)
      expect(screen.getByTestId('no-results-state-title')).toHaveTextContent(
        'No matching suites found'
      )
    })

    it('renders filtered empty state description', () => {
      render(<ListEmptyState {...defaultProps} isFilteredEmpty />)
      expect(screen.getByTestId('no-results-state-description')).toHaveTextContent(
        'No suites match your current filters. Try adjusting your search criteria.'
      )
    })

    it('renders Clear Filters button', () => {
      render(<ListEmptyState {...defaultProps} isFilteredEmpty />)
      expect(screen.getByRole('button', { name: /Clear Filters/i })).toBeVisible()
    })

    it('Clear Filters button fires callback', async () => {
      const user = userEvent.setup()
      const handleClearFilters = vi.fn()

      render(
        <ListEmptyState {...defaultProps} isFilteredEmpty onClearFilters={handleClearFilters} />
      )
      await user.click(screen.getByRole('button', { name: /Clear Filters/i }))

      expect(handleClearFilters).toHaveBeenCalledTimes(1)
    })

    it('renders no-results-state container', () => {
      render(<ListEmptyState {...defaultProps} isFilteredEmpty />)
      expect(screen.getByTestId('no-results-state')).toBeInTheDocument()
    })

    it('renders no-results-state-icon', () => {
      render(<ListEmptyState {...defaultProps} isFilteredEmpty />)
      expect(screen.getByTestId('no-results-state-icon')).toBeVisible()
    })

    it('does not show Create CTA in filtered state', () => {
      render(<ListEmptyState {...defaultProps} isFilteredEmpty />)
      expect(
        screen.queryByRole('button', { name: /Create Your First/i })
      ).not.toBeInTheDocument()
    })
  })

  describe('Unfiltered empty state', () => {
    it('renders unfiltered empty state with correct title', () => {
      render(<ListEmptyState {...defaultProps} />)
      expect(screen.getByTestId('empty-state-title')).toHaveTextContent('No suites yet')
    })

    it('renders description text', () => {
      render(<ListEmptyState {...defaultProps} />)
      expect(screen.getByTestId('empty-state-description')).toHaveTextContent(
        'Suites help you organize tests into logical groups'
      )
    })

    it('renders Create CTA with entity name', () => {
      render(<ListEmptyState {...defaultProps} />)
      expect(
        screen.getByRole('button', { name: /Create Your First Suite/i })
      ).toBeVisible()
    })

    it('Create CTA fires callback', async () => {
      const user = userEvent.setup()
      const handleCreateNew = vi.fn()

      render(<ListEmptyState {...defaultProps} onCreateNew={handleCreateNew} />)
      await user.click(screen.getByRole('button', { name: /Create Your First Suite/i }))

      expect(handleCreateNew).toHaveBeenCalledTimes(1)
    })

    it('Create CTA has primary styling', () => {
      render(<ListEmptyState {...defaultProps} />)
      expect(screen.getByRole('button', { name: /Create Your First Suite/i })).toHaveClass(
        'btn-primary'
      )
    })

    it('renders empty-state container', () => {
      render(<ListEmptyState {...defaultProps} />)
      expect(screen.getByTestId('empty-state')).toBeInTheDocument()
    })

    it('renders empty-state-icon', () => {
      render(<ListEmptyState {...defaultProps} />)
      expect(screen.getByTestId('empty-state-icon')).toBeVisible()
    })

    it('does not show Clear Filters in unfiltered state', () => {
      render(<ListEmptyState {...defaultProps} />)
      expect(
        screen.queryByRole('button', { name: /Clear Filters/i })
      ).not.toBeInTheDocument()
    })
  })

  describe('Icon customization', () => {
    it('renders correct icon with default className', () => {
      render(<ListEmptyState {...defaultProps} />)
      const icon = screen.getByTestId('empty-state-icon')
      expect(icon).toHaveClass('text-muted')
    })

    it('renders icon with custom className', () => {
      render(<ListEmptyState {...defaultProps} iconClassName="text-violet-400" />)
      const icon = screen.getByTestId('empty-state-icon')
      expect(icon).toHaveClass('text-violet-400')
    })
  })
})

// ============================================================================
// ListLoadingPagination Tests
// ============================================================================

describe('ListLoadingPagination', () => {
  it('renders pagination container', () => {
    render(<ListLoadingPagination />)
    expect(screen.getByTestId('pagination')).toBeInTheDocument()
  })

  it('renders skeleton elements', () => {
    const { container } = render(<ListLoadingPagination />)
    // Three skeleton divs: one for item count, one for page size, one for navigation
    const skeletons = container.querySelectorAll('.skeleton')
    expect(skeletons.length).toBe(3)
  })

  it('pagination container has correct layout classes', () => {
    render(<ListLoadingPagination />)
    const pagination = screen.getByTestId('pagination')
    expect(pagination).toHaveClass('flex', 'flex-shrink-0', 'items-center', 'justify-between')
  })
})
