/**
 * DebugSplitButton - REQ-3.2.1.2
 *
 * Contract for the ``DebugSplitButton`` component. It is a debug-specific
 * wrapper around the shared
 * ``SplitButton`` primitive (see ``@/components/shared/split-button``) and
 * mirrors the layout used by the existing Run split button.
 *
 * Props contract:
 *   {
 *     onDebug: (scope: 'current' | 'all', environmentOverride?: string) => void,
 *     selectedEnvironment: string | null,
 *     showCurrentScope: boolean,
 *     disabled: boolean,
 *   }
 *
 * Behavior:
 *   - Renders with label "Debug" and a bug icon.
 *   - When ``selectedEnvironment`` is set, primary click calls
 *     ``onDebug('current')``. When null, primary click does nothing
 *     (caller owns the "no env selected" UX).
 *   - Dropdown exposes two options: "Debug Current" and "Debug All".
 *     Each fires ``onDebug('current')`` / ``onDebug('all')`` respectively.
 *   - When ``showCurrentScope`` is false, the dropdown hides the
 *     "Debug Current" option (at test root - RUN-9).
 *   - ``disabled`` disables both primary and caret buttons.
 */

import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

describe('DebugSplitButton', () => {
  it('renders a button with the label "Debug"', async () => {
    const { DebugSplitButton } = await import(
      '@/features/workbench/common/canvas/canvas-action-bar/debug-split-button'
    )
    render(
      <DebugSplitButton
        onDebug={vi.fn()}
        selectedEnvironment="env-1"
        showCurrentScope={true}
        disabled={false}
      />
    )

    expect(screen.getByRole('button', { name: /^Debug$/i })).toBeInTheDocument()
  })

  it('calls onDebug("current") when primary button clicked with env set', async () => {
    const user = userEvent.setup()
    const onDebug = vi.fn()
    const { DebugSplitButton } = await import(
      '@/features/workbench/common/canvas/canvas-action-bar/debug-split-button'
    )
    render(
      <DebugSplitButton
        onDebug={onDebug}
        selectedEnvironment="env-1"
        showCurrentScope={true}
        disabled={false}
      />
    )

    await user.click(screen.getByTestId('debug-button'))
    expect(onDebug).toHaveBeenCalledExactlyOnceWith('current')
  })

  it('dropdown exposes Debug Current and Debug All options', async () => {
    const user = userEvent.setup()
    const onDebug = vi.fn()
    const { DebugSplitButton } = await import(
      '@/features/workbench/common/canvas/canvas-action-bar/debug-split-button'
    )
    render(
      <DebugSplitButton
        onDebug={onDebug}
        selectedEnvironment="env-1"
        showCurrentScope={true}
        disabled={false}
      />
    )

    await user.click(screen.getByTestId('debug-button-dropdown'))

    expect(screen.getByTestId('debug-current-option')).toBeInTheDocument()
    expect(screen.getByTestId('debug-all-option')).toBeInTheDocument()
  })

  it('Debug Current option fires onDebug("current")', async () => {
    const user = userEvent.setup()
    const onDebug = vi.fn()
    const { DebugSplitButton } = await import(
      '@/features/workbench/common/canvas/canvas-action-bar/debug-split-button'
    )
    render(
      <DebugSplitButton
        onDebug={onDebug}
        selectedEnvironment="env-1"
        showCurrentScope={true}
        disabled={false}
      />
    )

    await user.click(screen.getByTestId('debug-button-dropdown'))
    await user.click(screen.getByTestId('debug-current-option'))

    expect(onDebug).toHaveBeenLastCalledWith('current')
  })

  it('Debug All option fires onDebug("all")', async () => {
    const user = userEvent.setup()
    const onDebug = vi.fn()
    const { DebugSplitButton } = await import(
      '@/features/workbench/common/canvas/canvas-action-bar/debug-split-button'
    )
    render(
      <DebugSplitButton
        onDebug={onDebug}
        selectedEnvironment="env-1"
        showCurrentScope={true}
        disabled={false}
      />
    )

    await user.click(screen.getByTestId('debug-button-dropdown'))
    await user.click(screen.getByTestId('debug-all-option'))

    expect(onDebug).toHaveBeenLastCalledWith('all')
  })

  it('hides the Debug Current option at test root (showCurrentScope=false)', async () => {
    const user = userEvent.setup()
    const { DebugSplitButton } = await import(
      '@/features/workbench/common/canvas/canvas-action-bar/debug-split-button'
    )
    render(
      <DebugSplitButton
        onDebug={vi.fn()}
        selectedEnvironment="env-1"
        showCurrentScope={false}
        disabled={false}
      />
    )

    await user.click(screen.getByTestId('debug-button-dropdown'))

    expect(screen.queryByTestId('debug-current-option')).not.toBeInTheDocument()
    expect(screen.getByTestId('debug-all-option')).toBeInTheDocument()
  })

  it('disables both the primary and caret buttons when disabled=true', async () => {
    const { DebugSplitButton } = await import(
      '@/features/workbench/common/canvas/canvas-action-bar/debug-split-button'
    )
    render(
      <DebugSplitButton
        onDebug={vi.fn()}
        selectedEnvironment="env-1"
        showCurrentScope={true}
        disabled={true}
      />
    )

    expect(screen.getByTestId('debug-button')).toBeDisabled()
    expect(screen.getByTestId('debug-button-dropdown')).toBeDisabled()
  })

  it('renders with the "outline" variant (blue accent per DEBUG-2)', async () => {
    const { DebugSplitButton } = await import(
      '@/features/workbench/common/canvas/canvas-action-bar/debug-split-button'
    )
    const { container } = render(
      <DebugSplitButton
        onDebug={vi.fn()}
        selectedEnvironment="env-1"
        showCurrentScope={true}
        disabled={false}
      />
    )

    // SplitButton tags its root with data-split-button-variant so consumers
    // can verify which underlying variant is in use without snapshotting
    // CSS-class strings.
    const root = container.querySelector('[data-split-button-variant]')
    expect(root).toHaveAttribute('data-split-button-variant', 'outline')
  })

  it('disables the caret when selectedEnvironment is null', async () => {
    const { DebugSplitButton } = await import(
      '@/features/workbench/common/canvas/canvas-action-bar/debug-split-button'
    )
    render(
      <DebugSplitButton
        onDebug={vi.fn()}
        selectedEnvironment={null}
        showCurrentScope={true}
        disabled={false}
      />
    )

    expect(screen.getByTestId('debug-button-dropdown')).toBeDisabled()
  })
})
