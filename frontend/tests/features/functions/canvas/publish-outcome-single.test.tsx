/**
 * PublishOutcomeDialog - single-outcome mode for the standalone library View
 * (REQ-3.1.2.2, VIEW-7).
 *
 * In the library View there is no caller instance to re-pin, so publish is a
 * single outcome: Cancel + Publish. The View switches to the newly published
 * version. The dialog reuses the same Upload icon, "Publish a new version?"
 * title, and mono `v<src> -> v<tgt>` transition line as the three-option mode.
 *
 * The dialog stays presentational: confirming calls `onConfirmSingle`, which the
 * parent (function-lifecycle-dialogs in library-View mode) wires to
 * `addFunctionVersion`. The three-option in-Test mode is unchanged.
 */

import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { PublishOutcomeDialog } from '@/features/functions/canvas/publish-outcome-dialog'

function renderSingle(overrides: Record<string, unknown> = {}) {
  const props = {
    isOpen: true,
    onClose: vi.fn(),
    functionName: 'Greet User',
    sourceVersion: '1.0.0',
    targetVersion: '1.0.1',
    pending: false,
    error: null as string | null,
    mode: 'single' as const,
    onConfirmSingle: vi.fn(),
    // three-option handlers still required by the existing prop shape.
    onSetNew: vi.fn(),
    onKeepOld: vi.fn(),
    ...overrides,
  }
  render(<PublishOutcomeDialog {...props} />)
  return props
}

describe('PublishOutcomeDialog - single-outcome mode (structure)', () => {
  it('keeps the title "Publish a new version?"', () => {
    renderSingle()
    expect(screen.getByText(/publish a new version\?/i)).toBeInTheDocument()
  })

  it('renders the v<src> -> v<tgt> transition', () => {
    renderSingle()
    expect(screen.getByText(/v1\.0\.0/)).toBeInTheDocument()
    expect(screen.getByText(/v1\.0\.1/)).toBeInTheDocument()
  })

  it('renders exactly Cancel + Publish (no three-option buttons)', () => {
    renderSingle()
    expect(screen.getByRole('button', { name: /^cancel$/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^publish$/i })).toBeInTheDocument()
    // The three-option labels must be absent in single mode.
    expect(screen.queryByRole('button', { name: /publish and set new/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /publish and keep old/i })).toBeNull()
  })
})

describe('PublishOutcomeDialog - single-outcome mode (actions)', () => {
  it('fires onConfirmSingle when Publish is clicked', async () => {
    const user = userEvent.setup()
    const props = renderSingle()
    await user.click(screen.getByRole('button', { name: /^publish$/i }))
    expect(props.onConfirmSingle).toHaveBeenCalledTimes(1)
    expect(props.onSetNew).not.toHaveBeenCalled()
    expect(props.onKeepOld).not.toHaveBeenCalled()
  })

  it('fires onClose when Cancel is clicked', async () => {
    const user = userEvent.setup()
    const props = renderSingle()
    await user.click(screen.getByRole('button', { name: /^cancel$/i }))
    expect(props.onClose).toHaveBeenCalledTimes(1)
  })

  it('disables the footer while a publish is pending', () => {
    renderSingle({ pending: true })
    expect(screen.getByRole('button', { name: /^cancel$/i })).toBeDisabled()
    const publish = screen.getByRole('button', { name: /^publish$/i })
    expect(publish.getAttribute('aria-busy') === 'true' || publish.hasAttribute('disabled')).toBe(
      true,
    )
  })
})
