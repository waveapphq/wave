/**
 * ModeRadioSection - the shared radio-plus-checkbox section.
 *
 * Promoted out of the Assert arm of ConfigModalBody so Assert's Branching Mode
 * and Wait Until's Wait Mode render from one component instead of two copies of
 * the same JSX.
 */

import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { ModeRadioSection } from '@/features/workbench/common/config/mode-radio-section'

type SectionProps = React.ComponentProps<typeof ModeRadioSection>

const OPTIONS = [
  { value: 'retry', label: 'Retry', description: 'Run a sub-flow every round until the condition holds' },
  { value: 'watch', label: 'Watch', description: 'Only re-check the condition; another flow makes it true' },
]

function makeProps(overrides: Partial<SectionProps> = {}): SectionProps {
  return {
    title: 'Wait Mode',
    value: 'retry',
    options: OPTIONS,
    onValueChange: vi.fn(),
    ...overrides,
  }
}

function renderSection(overrides: Partial<SectionProps> = {}) {
  const props = makeProps(overrides)
  return { ...render(<ModeRadioSection {...props} />), props }
}

describe('ModeRadioSection', () => {
  it('renders the section title', () => {
    renderSection()

    expect(screen.getByText('Wait Mode')).toBeInTheDocument()
  })

  it('renders one radio per option, labeled and described', () => {
    renderSection()

    expect(screen.getByLabelText('Retry')).toBeInTheDocument()
    expect(screen.getByLabelText('Watch')).toBeInTheDocument()
    expect(
      screen.getByText('Run a sub-flow every round until the condition holds')
    ).toBeInTheDocument()
    expect(
      screen.getByText('Only re-check the condition; another flow makes it true')
    ).toBeInTheDocument()
  })

  it('marks the selected option as checked', () => {
    renderSection({ value: 'watch' })

    expect(screen.getByRole('radio', { name: 'Watch' })).toBeChecked()
    expect(screen.getByRole('radio', { name: 'Retry' })).not.toBeChecked()
  })

  it('reports the new value when another option is chosen', async () => {
    const user = userEvent.setup()
    const onValueChange = vi.fn()
    renderSection({ onValueChange })

    await user.click(screen.getByLabelText('Watch'))

    expect(onValueChange).toHaveBeenCalledWith('watch')
  })

  it('binds each label to its own control so the label is clickable', async () => {
    // Two instances of the section can never share radio ids, or clicking one
    // panel's label would toggle the other's control.
    const user = userEvent.setup()
    const onValueChange = vi.fn()
    render(
      <>
        <ModeRadioSection {...makeProps({ title: 'Wait Mode', onValueChange })} />
        <ModeRadioSection {...makeProps({ title: 'Other Mode' })} />
      </>
    )

    await user.click(screen.getAllByText('Watch')[0])

    expect(onValueChange).toHaveBeenCalledWith('watch')
  })

  it('renders no checkbox when none is configured', () => {
    renderSection()

    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
  })

  it('renders the trailing checkbox with its label and description', () => {
    renderSection({
      checkbox: {
        id: 'wait-fail-current-scope',
        label: 'Fail Current Scope',
        description: 'Marks the current scope failed when the wait gives up',
        checked: false,
        onChange: vi.fn(),
      },
    })

    expect(screen.getByLabelText('Fail Current Scope')).toBeInTheDocument()
    expect(
      screen.getByText('Marks the current scope failed when the wait gives up')
    ).toBeInTheDocument()
  })

  it('reflects the checkbox state', () => {
    renderSection({
      checkbox: {
        id: 'wait-fail-current-scope',
        label: 'Fail Current Scope',
        description: 'Marks the current scope failed when the wait gives up',
        checked: true,
        onChange: vi.fn(),
      },
    })

    expect(screen.getByRole('checkbox', { name: 'Fail Current Scope' })).toBeChecked()
  })

  it('reports a checkbox toggle as a boolean', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    renderSection({
      checkbox: {
        id: 'wait-fail-current-scope',
        label: 'Fail Current Scope',
        description: 'Marks the current scope failed when the wait gives up',
        checked: false,
        onChange,
      },
    })

    await user.click(screen.getByLabelText('Fail Current Scope'))

    expect(onChange).toHaveBeenCalledWith(true)
  })

  it('reports unchecking as false', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    renderSection({
      checkbox: {
        id: 'wait-fail-current-scope',
        label: 'Fail Current Scope',
        description: 'Marks the current scope failed when the wait gives up',
        checked: true,
        onChange,
      },
    })

    await user.click(screen.getByLabelText('Fail Current Scope'))

    expect(onChange).toHaveBeenCalledWith(false)
  })

  it('serves Assert its Branching Mode section unchanged', () => {
    // The promotion has to keep a shipped control rendering exactly as before.
    renderSection({
      title: 'Branching Mode',
      value: 'split',
      options: [
        {
          value: 'single',
          label: 'Single',
          description: 'One output handle - continues to next block regardless of pass/fail',
        },
        {
          value: 'split',
          label: 'Split',
          description: 'Two output handles - pass (green) and fail (red) branch to different paths',
        },
      ],
      checkbox: {
        id: 'fail-current-scope',
        label: 'Fail Current Scope',
        description: 'Marks the current scope failed without stopping execution',
        checked: false,
        onChange: vi.fn(),
      },
    })

    expect(screen.getByText('Branching Mode')).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Split' })).toBeChecked()
    expect(screen.getByLabelText('Fail Current Scope')).toBeInTheDocument()
  })
})
