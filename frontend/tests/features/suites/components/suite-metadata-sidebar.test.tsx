/**
 * Suite Metadata Sidebar Tests
 */

import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { SuiteMetadataSidebar } from '@/features/suites/components/suite-metadata-sidebar'
import type { SuiteDetail } from '@/features/suites/api/types'

const mockSuite: SuiteDetail = {
  id: 'suite-1',
  name: 'Test Suite',
  description: 'A test suite description',
  version: '1.0.0',
  createdAt: '2026-03-01T00:00:00Z',
  updatedAt: '2026-03-02T00:00:00Z',
  testIds: ['t1', 't2'],
  testsCount: 2,
  status: 'passed',
  lastRun: '2026-03-02T12:00:00Z',
  tags: ['smoke', 'api'],
  variables: {
    base_url: { type: 'string', value: 'http://localhost', secret: false },
  },
}

describe('SuiteMetadataSidebar', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('renders with data-testid', () => {
    render(
      <SuiteMetadataSidebar suite={mockSuite} onEditDetails={vi.fn()} onEditVariables={vi.fn()} />
    )
    expect(screen.getByTestId('suite-metadata-sidebar')).toBeInTheDocument()
  })

  it('displays description', () => {
    render(
      <SuiteMetadataSidebar suite={mockSuite} onEditDetails={vi.fn()} onEditVariables={vi.fn()} />
    )
    expect(screen.getByTestId('sidebar-description-display')).toHaveTextContent('A test suite description')
  })

  it('displays tags as badges', () => {
    render(
      <SuiteMetadataSidebar suite={mockSuite} onEditDetails={vi.fn()} onEditVariables={vi.fn()} />
    )
    expect(screen.getByText('smoke')).toBeInTheDocument()
    expect(screen.getByText('api')).toBeInTheDocument()
  })

  it('displays status badge', () => {
    render(
      <SuiteMetadataSidebar suite={mockSuite} onEditDetails={vi.fn()} onEditVariables={vi.fn()} />
    )
    expect(screen.getByText('Passed')).toBeInTheDocument()
  })

  it('renders variables table', () => {
    render(
      <SuiteMetadataSidebar suite={mockSuite} onEditDetails={vi.fn()} onEditVariables={vi.fn()} />
    )
    expect(screen.getByTestId('variable-readonly-table')).toBeInTheDocument()
  })

  it('shows placeholder when description is null', () => {
    const suiteNoDesc = { ...mockSuite, description: null }
    render(
      <SuiteMetadataSidebar suite={suiteNoDesc} onEditDetails={vi.fn()} onEditVariables={vi.fn()} />
    )
    expect(screen.getByTestId('sidebar-description-display')).toHaveTextContent('No description')
  })

  it('shows "No tags" when tags are empty', () => {
    const suiteNoTags = { ...mockSuite, tags: [] }
    render(
      <SuiteMetadataSidebar suite={suiteNoTags} onEditDetails={vi.fn()} onEditVariables={vi.fn()} />
    )
    expect(screen.queryByTestId('sidebar-tags-display')).not.toBeInTheDocument()
    expect(screen.getByText('No tags')).toBeInTheDocument()
  })

  it('calls onEditDetails when edit details button is clicked', () => {
    const onEditDetails = vi.fn()
    render(
      <SuiteMetadataSidebar suite={mockSuite} onEditDetails={onEditDetails} onEditVariables={vi.fn()} />
    )
    fireEvent.click(screen.getByTestId('edit-details-btn'))
    expect(onEditDetails).toHaveBeenCalledOnce()
  })

  it('calls onEditVariables when edit variables button is clicked', () => {
    const onEditVariables = vi.fn()
    render(
      <SuiteMetadataSidebar suite={mockSuite} onEditDetails={vi.fn()} onEditVariables={onEditVariables} />
    )
    fireEvent.click(screen.getByTestId('edit-variables-btn'))
    expect(onEditVariables).toHaveBeenCalledOnce()
  })

  it('displays dates', () => {
    render(
      <SuiteMetadataSidebar suite={mockSuite} onEditDetails={vi.fn()} onEditVariables={vi.fn()} />
    )
    expect(screen.getByText('Created')).toBeInTheDocument()
    expect(screen.getByText('Updated')).toBeInTheDocument()
  })

  it('displays never_run status', () => {
    const neverRunSuite = { ...mockSuite, status: 'never_run' as const }
    render(
      <SuiteMetadataSidebar suite={neverRunSuite} onEditDetails={vi.fn()} onEditVariables={vi.fn()} />
    )
    expect(screen.getByText('Never Run')).toBeInTheDocument()
  })

  it('displays failed status', () => {
    const failedSuite = { ...mockSuite, status: 'failed' as const }
    render(
      <SuiteMetadataSidebar suite={failedSuite} onEditDetails={vi.fn()} onEditVariables={vi.fn()} />
    )
    expect(screen.getByText('Failed')).toBeInTheDocument()
  })
})
