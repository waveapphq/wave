/**
 * Metadata Sidebar Tests
 *
 * Covers the status label of the shared Details section: known statuses use
 * their fixed label, any other status shows its own name with a capital first
 * letter.
 */

import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MetadataSidebar } from '@/components/shared/metadata-sidebar'

function renderSidebar(status: string) {
  return render(
    <MetadataSidebar
      testId="metadata-sidebar"
      description="Nightly regression"
      status={status}
      tags={['release']}
      createdAt="2026-03-01T00:00:00Z"
      updatedAt="2026-03-02T00:00:00Z"
      variables={{}}
      onEditDetails={vi.fn()}
      onEditVariables={vi.fn()}
    />,
  )
}

describe('MetadataSidebar', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('shows the fixed label of a known status', () => {
    renderSidebar('never_run')

    expect(screen.getByText('Never Run')).toBeInTheDocument()
  })

  it('shows an unknown status by its own name with a capital first letter', () => {
    renderSidebar('running')

    expect(screen.getByText('Running')).toBeInTheDocument()
    expect(screen.queryByText('running')).not.toBeInTheDocument()
  })
})
