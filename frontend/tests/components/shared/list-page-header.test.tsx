/**
 * ListPageHeader Component Tests
 *
 * Tests for the title row shared by every entity list page.
 */

import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ListPageHeader } from '@/components/shared/list-page-header'

describe('ListPageHeader', () => {
  it('renders the title alone when the page offers no actions', () => {
    render(<ListPageHeader title="Executions" />)

    expect(screen.getByRole('heading', { name: 'Executions' })).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('renders only the Import button when the page has no create action', async () => {
    const user = userEvent.setup()
    const onImport = vi.fn()

    render(<ListPageHeader title="Functions" onImport={onImport} />)

    const importButton = screen.getByTestId('import-button')
    expect(importButton).toHaveTextContent('Import')
    expect(screen.getAllByRole('button')).toHaveLength(1)

    await user.click(importButton)
    expect(onImport).toHaveBeenCalledTimes(1)
  })

  it('renders both actions and stamps the create test id when given', async () => {
    const user = userEvent.setup()
    const onImport = vi.fn()
    const onCreate = vi.fn()

    render(
      <ListPageHeader
        title="Profiles"
        onImport={onImport}
        create={{ label: 'New Profile', onClick: onCreate, testId: 'new-profile-button' }}
      />
    )

    const createButton = screen.getByTestId('new-profile-button')
    expect(createButton).toHaveTextContent('New Profile')

    await user.click(createButton)
    expect(onCreate).toHaveBeenCalledTimes(1)
    expect(onImport).not.toHaveBeenCalled()
  })

  it('renders the create button without a test id when none is given', () => {
    render(
      <ListPageHeader title="Tests" create={{ label: 'New Test', onClick: vi.fn() }} />
    )

    const createButton = screen.getByRole('button', { name: /new test/i })
    expect(createButton).not.toHaveAttribute('data-testid')
    expect(screen.queryByTestId('import-button')).not.toBeInTheDocument()
  })
})
