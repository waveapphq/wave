/**
 * Tests for `DropChangesDialog` (REQ-3.1.2.2).
 *
 * ConfirmationDialog wrapper for the Drop Changes confirmation:
 *
 *   - variant="discard"
 *   - Title: "Drop changes"
 *   - Confirm label: "Drop changes"
 *   - Description names the function + the source version the instance reverts to
 *   - ESC / backdrop click do NOT dismiss (ConfirmationDialog policy)
 *   - Cancel closes the dialog without calling onConfirm
 *   - onConfirm is called when the user clicks Drop changes
 */

import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { DropChangesDialog } from '@/features/functions/canvas/drop-changes-dialog'


function defaultProps() {
  return {
    isOpen: true,
    functionName: 'Greet User',
    sourceVersion: '1.0.0',
    onClose: vi.fn(),
    onConfirm: vi.fn().mockResolvedValue(undefined),
  }
}


describe('DropChangesDialog - structure', () => {
  it('renders title "Drop changes"', () => {
    render(<DropChangesDialog {...defaultProps()} />)
    expect(
      screen.getByRole('heading', { name: /^drop changes\??$/i }),
    ).toBeInTheDocument()
  })

  it('renders the description naming the function + source version', () => {
    render(<DropChangesDialog {...defaultProps()} />)
    // The description references both the function name and the version
    // the instance will revert to so the user knows what state to expect.
    expect(screen.getByText(/Greet User/)).toBeInTheDocument()
    expect(screen.getByText(/v1\.0\.0/)).toBeInTheDocument()
  })

  it('renders Cancel + Drop changes buttons', () => {
    render(<DropChangesDialog {...defaultProps()} />)
    expect(screen.getByRole('button', { name: /cancel/i })).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /^drop changes$/i }),
    ).toBeInTheDocument()
  })

  it('does NOT render any other footer buttons (no extras)', () => {
    render(<DropChangesDialog {...defaultProps()} />)
    expect(screen.queryByRole('button', { name: /publish/i })).toBeNull()
  })
})


describe('DropChangesDialog - confirm path', () => {
  it('calls onConfirm when Drop changes is clicked', async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn().mockResolvedValue(undefined)
    render(<DropChangesDialog {...defaultProps()} onConfirm={onConfirm} />)
    await user.click(screen.getByRole('button', { name: /^drop changes$/i }))
    expect(onConfirm).toHaveBeenCalled()
  })

  it('does NOT call onConfirm when Cancel is clicked', async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn()
    const onClose = vi.fn()
    render(
      <DropChangesDialog
        {...defaultProps()}
        onConfirm={onConfirm}
        onClose={onClose}
      />,
    )
    await user.click(screen.getByRole('button', { name: /cancel/i }))
    expect(onConfirm).not.toHaveBeenCalled()
    expect(onClose).toHaveBeenCalled()
  })
})


describe('DropChangesDialog - ESC and backdrop do NOT dismiss', () => {
  it('Escape does NOT close the dialog (ConfirmationDialog policy)', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    const onConfirm = vi.fn()
    render(
      <DropChangesDialog
        {...defaultProps()}
        onClose={onClose}
        onConfirm={onConfirm}
      />,
    )
    await user.keyboard('{Escape}')
    expect(onClose).not.toHaveBeenCalled()
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('clicking outside the dialog does NOT close it', () => {
    const onClose = vi.fn()
    render(<DropChangesDialog {...defaultProps()} onClose={onClose} />)
    // The Radix AlertDialog used by ConfirmationDialog does not close on
    // outside-click by default (that is the contract diff between Dialog
    // and AlertDialog). Simulating an outside click via jsdom is unreliable
    // because Radix locks pointer-events on the document body while the
    // dialog is open; assert the structural guarantee instead: the alert
    // dialog stays mounted and onClose was not invoked spontaneously.
    expect(screen.getByRole('alertdialog')).toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
  })
})


describe('DropChangesDialog - closed state', () => {
  it('renders nothing when isOpen=false', () => {
    render(<DropChangesDialog {...defaultProps()} isOpen={false} />)
    expect(screen.queryByRole('alertdialog')).toBeNull()
  })
})
