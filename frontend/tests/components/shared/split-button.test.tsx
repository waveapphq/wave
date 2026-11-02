/**
 * SplitButton Component Tests
 *
 * SplitButton is a shared primitive extracted from the Workbench's Debug/Run/Stop
 * controls. It renders a primary action button joined to a dropdown trigger; the
 * dropdown exposes alternative action options.
 *
 * Contract the implementation must satisfy:
 *   <SplitButton
 *     label="Stop"
 *     icon={<Square/>}
 *     variant="destructive"
 *     onPrimaryClick={...}                     // primary area click
 *     options={[
 *       { id: 'immediate',  label: 'Immediate Stop',  onClick: ... },
 *       { id: 'finalize',   label: 'Stop with Finalization', onClick: ... },
 *     ]}
 *     disabled={false}
 *   />
 *
 * Primary click fires onPrimaryClick. The caret opens a dropdown whose items fire
 * their own onClick. When disabled, both the button and the caret are inert.
 */

import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SplitButton } from '@/components/shared/split-button'

describe('SplitButton', () => {
  const baseOptions = [
    { id: 'immediate', label: 'Immediate Stop', onClick: vi.fn() },
    { id: 'finalize', label: 'Stop with Finalization', onClick: vi.fn() },
  ]

  it('renders the primary label and icon', () => {
    render(
      <SplitButton
        label="Stop"
        icon={<span data-testid="stop-icon" />}
        options={baseOptions}
        onPrimaryClick={vi.fn()}
      />,
    )
    expect(screen.getByRole('button', { name: /^Stop$/ })).toBeInTheDocument()
    expect(screen.getByTestId('stop-icon')).toBeInTheDocument()
  })

  it('fires onPrimaryClick when the primary area is clicked', async () => {
    const onPrimary = vi.fn()
    const user = userEvent.setup()
    render(
      <SplitButton
        label="Stop"
        options={baseOptions}
        onPrimaryClick={onPrimary}
      />,
    )
    await user.click(screen.getByRole('button', { name: /^Stop$/ }))
    expect(onPrimary).toHaveBeenCalledTimes(1)
  })

  it('exposes the caret as a separate control with its own accessible name', () => {
    render(
      <SplitButton
        label="Stop"
        options={baseOptions}
        onPrimaryClick={vi.fn()}
      />,
    )
    const caret = screen.getByRole('button', { name: /stop options/i })
    expect(caret).toBeInTheDocument()
  })

  it('opens the dropdown when the caret is clicked and reveals the options', async () => {
    const user = userEvent.setup()
    render(
      <SplitButton
        label="Stop"
        options={baseOptions}
        onPrimaryClick={vi.fn()}
      />,
    )
    await user.click(screen.getByRole('button', { name: /stop options/i }))
    expect(
      await screen.findByRole('menuitem', { name: /immediate stop/i }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('menuitem', { name: /stop with finalization/i }),
    ).toBeInTheDocument()
  })

  it('fires the option onClick when a menu item is selected', async () => {
    const onFinalize = vi.fn()
    const user = userEvent.setup()
    render(
      <SplitButton
        label="Stop"
        options={[
          { id: 'immediate', label: 'Immediate Stop', onClick: vi.fn() },
          { id: 'finalize', label: 'Stop with Finalization', onClick: onFinalize },
        ]}
        onPrimaryClick={vi.fn()}
      />,
    )
    await user.click(screen.getByRole('button', { name: /stop options/i }))
    await user.click(
      await screen.findByRole('menuitem', { name: /stop with finalization/i }),
    )
    expect(onFinalize).toHaveBeenCalledTimes(1)
  })

  it('disables both the primary button and the caret when disabled', () => {
    render(
      <SplitButton
        label="Stop"
        options={baseOptions}
        onPrimaryClick={vi.fn()}
        disabled
      />,
    )
    expect(screen.getByRole('button', { name: /^Stop$/ })).toBeDisabled()
    expect(screen.getByRole('button', { name: /stop options/i })).toBeDisabled()
  })

  it('does not call onPrimaryClick when disabled', async () => {
    const onPrimary = vi.fn()
    const user = userEvent.setup()
    render(
      <SplitButton
        label="Stop"
        options={baseOptions}
        onPrimaryClick={onPrimary}
        disabled
      />,
    )
    await user.click(screen.getByRole('button', { name: /^Stop$/ }))
    expect(onPrimary).not.toHaveBeenCalled()
  })

  it('propagates variant to the primary button styling hook (class contains variant id)', () => {
    const { container } = render(
      <SplitButton
        label="Stop"
        variant="destructive"
        options={baseOptions}
        onPrimaryClick={vi.fn()}
      />,
    )
    const group = container.querySelector('[data-split-button-variant]')
    expect(group?.getAttribute('data-split-button-variant')).toBe('destructive')
  })

  it('renders with zero options only if the caller opts in via allowEmptyOptions', () => {
    render(
      <SplitButton
        label="Run"
        options={[]}
        allowEmptyOptions
        onPrimaryClick={vi.fn()}
      />,
    )
    // Caret not rendered when there are no options and allowEmptyOptions=true
    expect(screen.queryByRole('button', { name: /run options/i })).toBeNull()
  })

  it('supports a per-option disabled flag that prevents the onClick from firing', async () => {
    const onImmediate = vi.fn()
    const user = userEvent.setup()
    render(
      <SplitButton
        label="Stop"
        options={[
          { id: 'immediate', label: 'Immediate Stop', onClick: onImmediate, disabled: true },
        ]}
        onPrimaryClick={vi.fn()}
      />,
    )
    await user.click(screen.getByRole('button', { name: /stop options/i }))
    const item = await screen.findByRole('menuitem', { name: /immediate stop/i })
    await user.click(item)
    expect(onImmediate).not.toHaveBeenCalled()
  })
})
