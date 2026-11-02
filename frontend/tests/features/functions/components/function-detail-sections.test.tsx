/**
 * FunctionDetailSections tests: Changelog expanded by default;
 * Details/Inputs/Outputs/Usage collapsible; Markdown render; I/O Description
 * column; empty-state hints; inline usage list.
 */

import { describe, it, expect } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { FunctionDetailSections } from '@/features/functions/components/function-detail-sections'
import type {
  FunctionInput,
  FunctionOutput,
  FunctionDependentsResponse,
} from '@/features/functions/api/types'

const INPUTS: FunctionInput[] = [
  { name: 'to', type: 'string', required: true, default: '', description: 'Recipient address' },
]
const OUTPUTS: FunctionOutput[] = [
  { name: 'sent', type: 'boolean', description: 'Whether it was sent' },
]
const USAGE: FunctionDependentsResponse = {
  tests: [{ id: 't1', name: 'Login test' }],
  functions: [{ id: 'fn-9', name: 'caller_fn' }],
}
const EMPTY_USAGE: FunctionDependentsResponse = { tests: [], functions: [] }

function renderSections(overrides: Partial<Parameters<typeof FunctionDetailSections>[0]> = {}) {
  render(
    <MemoryRouter>
      <FunctionDetailSections
        changelog="Initial **release**"
        details="Detailed _notes_"
        inputs={INPUTS}
        outputs={OUTPUTS}
        usage={USAGE}
        {...overrides}
      />
    </MemoryRouter>,
  )
}

describe('FunctionDetailSections', () => {
  it('renders the Changelog markdown expanded by default', () => {
    renderSections()
    expect(screen.getByTestId('section-changelog')).toBeInTheDocument()
    expect(screen.getByText('release')).toBeInTheDocument()
  })

  it('expands Details to reveal its markdown', async () => {
    const user = userEvent.setup()
    renderSections()
    expect(screen.queryByTestId('section-details')).not.toBeInTheDocument()
    await user.click(screen.getByTestId('section-toggle-details'))
    expect(screen.getByText('notes')).toBeInTheDocument()
  })

  it('renders the Inputs table with a Description column', async () => {
    const user = userEvent.setup()
    renderSections()
    await user.click(screen.getByTestId('section-toggle-inputs'))
    const inputs = screen.getByTestId('section-inputs')
    expect(within(inputs).getByRole('columnheader', { name: /Description/i })).toBeInTheDocument()
    expect(within(inputs).getByText('Recipient address')).toBeInTheDocument()
    expect(within(inputs).getByText('Yes')).toBeInTheDocument()
  })

  it('shows "No" in the Required column for an optional input', async () => {
    const user = userEvent.setup()
    renderSections({
      inputs: [{ name: 'opt', type: 'string', required: false, default: '', description: 'optional' }],
    })
    await user.click(screen.getByTestId('section-toggle-inputs'))
    expect(within(screen.getByTestId('section-inputs')).getByText('No')).toBeInTheDocument()
  })

  it('renders the Outputs table with a Description column', async () => {
    const user = userEvent.setup()
    renderSections()
    await user.click(screen.getByTestId('section-toggle-outputs'))
    const outputs = screen.getByTestId('section-outputs')
    expect(within(outputs).getByRole('columnheader', { name: /Description/i })).toBeInTheDocument()
    expect(within(outputs).getByText('Whether it was sent')).toBeInTheDocument()
  })

  it('links consuming Tests to the workbench and Functions to their detail page', async () => {
    const user = userEvent.setup()
    renderSections()
    await user.click(screen.getByTestId('section-toggle-usage'))
    const usage = screen.getByTestId('section-usage')
    // A Test opens in the workbench (there is no /tests/:id route);
    // a Function opens its detail page. Both are client-side router links.
    expect(within(usage).getByRole('link', { name: /Login test/i })).toHaveAttribute(
      'href',
      '/workbench?editTest=t1',
    )
    expect(within(usage).getByRole('link', { name: /caller_fn/i })).toHaveAttribute(
      'href',
      '/functions/fn-9',
    )
  })

  it('shows empty hints for no inputs/outputs/usage', async () => {
    const user = userEvent.setup()
    renderSections({ inputs: [], outputs: [], usage: EMPTY_USAGE, changelog: '', details: '' })
    await user.click(screen.getByTestId('section-toggle-inputs'))
    expect(within(screen.getByTestId('section-inputs')).getByText(/No inputs declared/i)).toBeInTheDocument()
    await user.click(screen.getByTestId('section-toggle-outputs'))
    expect(within(screen.getByTestId('section-outputs')).getByText(/No outputs declared/i)).toBeInTheDocument()
    await user.click(screen.getByTestId('section-toggle-usage'))
    expect(within(screen.getByTestId('section-usage')).getByText(/Not used by any Test or Function/i)).toBeInTheDocument()
  })
})
