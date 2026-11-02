/** Take-over dialogs: waiting + approval chrome. */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import {
  TakeOverWaitingDialog,
  type TakeOverWaitingDialogProps,
} from '@/features/workbench/common/canvas/chrome/take-over-waiting-dialog'
import {
  TakeOverApprovalDialog,
  type TakeOverApprovalDialogProps,
} from '@/features/workbench/common/canvas/chrome/take-over-approval-dialog'
import {
  TakeOverResultDialog,
  type TakeOverResultDialogProps,
} from '@/features/workbench/common/canvas/chrome/take-over-result-dialog'

// ============================================================================
// Render helpers
// ============================================================================

function renderWaiting(props: Partial<TakeOverWaitingDialogProps> = {}) {
  const defaultProps: TakeOverWaitingDialogProps = {
    open: true,
    holderLabel: 'Ashley',
    holderKind: 'person',
    onCancel: vi.fn(),
    onForce: vi.fn(),
    ...props,
  }
  return { ...render(<TakeOverWaitingDialog {...defaultProps} />), props: defaultProps }
}

function renderApproval(props: Partial<TakeOverApprovalDialogProps> = {}) {
  const defaultProps: TakeOverApprovalDialogProps = {
    open: true,
    onHandOver: vi.fn(),
    onDeny: vi.fn(),
    ...props,
  }
  return { ...render(<TakeOverApprovalDialog {...defaultProps} />), props: defaultProps }
}

// ============================================================================
// Tests
// ============================================================================

describe('TakeOverWaitingDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders the alertdialog with its title and both actions when open', async () => {
    renderWaiting()

    const dialog = await screen.findByRole('alertdialog')
    expect(within(dialog).getByText('Waiting to take over')).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Force Take Over' })).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toBeInTheDocument()
  })

  it('reads a person holder generically as "Another session"', async () => {
    renderWaiting({ holderKind: 'person', holderLabel: 'Tab 7f3a' })

    const dialog = await screen.findByRole('alertdialog')
    expect(dialog).toHaveTextContent('Another session is being asked to hand over')
    expect(dialog).not.toHaveTextContent('Tab 7f3a')
  })

  it('surfaces the mcp holder label in the body', async () => {
    renderWaiting({ holderKind: 'mcp', holderLabel: 'Claude Code (MCP)' })

    const dialog = await screen.findByRole('alertdialog')
    expect(dialog).toHaveTextContent('Claude Code (MCP)')
  })

  it('Force Take Over calls onForce', async () => {
    const user = userEvent.setup()
    const { props } = renderWaiting()

    const dialog = await screen.findByRole('alertdialog')
    await user.click(within(dialog).getByRole('button', { name: 'Force Take Over' }))

    expect(props.onForce).toHaveBeenCalledTimes(1)
    expect(props.onCancel).not.toHaveBeenCalled()
  })

  it('Cancel calls onCancel', async () => {
    const user = userEvent.setup()
    const { props } = renderWaiting()

    const dialog = await screen.findByRole('alertdialog')
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))

    expect(props.onCancel).toHaveBeenCalledTimes(1)
    expect(props.onForce).not.toHaveBeenCalled()
  })

  it('renders nothing queryable when closed', () => {
    renderWaiting({ open: false })

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  })
})

describe('TakeOverApprovalDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders the generic title and read-only hand-over copy when open', async () => {
    renderApproval()

    const dialog = await screen.findByRole('alertdialog')
    expect(within(dialog).getByText('Another session wants to take over')).toBeInTheDocument()
    expect(
      within(dialog).getByText(
        'Another session takes over editing this draft. You switch to watching, read-only.',
      ),
    ).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Hand over' })).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Deny' })).toBeInTheDocument()
  })

  it('Hand over calls onHandOver once and never onDeny', async () => {
    const user = userEvent.setup()
    const { props } = renderApproval()

    const dialog = await screen.findByRole('alertdialog')
    await user.click(within(dialog).getByRole('button', { name: 'Hand over' }))

    expect(props.onHandOver).toHaveBeenCalledTimes(1)
    expect(props.onDeny).not.toHaveBeenCalled()
  })

  it('Deny calls onDeny once and never onHandOver', async () => {
    const user = userEvent.setup()
    const { props } = renderApproval()

    const dialog = await screen.findByRole('alertdialog')
    await user.click(within(dialog).getByRole('button', { name: 'Deny' }))

    expect(props.onDeny).toHaveBeenCalledTimes(1)
    expect(props.onHandOver).not.toHaveBeenCalled()
  })

  it('renders nothing queryable when closed', () => {
    renderApproval({ open: false })

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  })
})

function renderResult(props: Partial<TakeOverResultDialogProps> = {}) {
  const defaultProps: TakeOverResultDialogProps = {
    open: true,
    outcome: 'granted',
    onClose: vi.fn(),
    ...props,
  }
  return { ...render(<TakeOverResultDialog {...defaultProps} />), props: defaultProps }
}

describe('TakeOverResultDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('shows the granted outcome and a Start editing action', async () => {
    const user = userEvent.setup()
    const { props } = renderResult({ outcome: 'granted' })

    const dialog = await screen.findByRole('alertdialog')
    expect(within(dialog).getByText('You now hold the session')).toBeInTheDocument()

    await user.click(within(dialog).getByRole('button', { name: 'Start editing' }))
    expect(props.onClose).toHaveBeenCalledTimes(1)
  })

  it('shows the denied outcome and an OK action', async () => {
    const user = userEvent.setup()
    const { props } = renderResult({ outcome: 'denied' })

    const dialog = await screen.findByRole('alertdialog')
    expect(within(dialog).getByText('Take-over denied')).toBeInTheDocument()

    await user.click(within(dialog).getByRole('button', { name: 'OK' }))
    expect(props.onClose).toHaveBeenCalledTimes(1)
  })

  it('shows the forced-out outcome and an OK action', async () => {
    const user = userEvent.setup()
    const { props } = renderResult({ outcome: 'forced' })

    const dialog = await screen.findByRole('alertdialog')
    expect(within(dialog).getByText('Session taken over')).toBeInTheDocument()
    expect(within(dialog).getByText(/Another session forced a take-over/)).toBeInTheDocument()

    await user.click(within(dialog).getByRole('button', { name: 'OK' }))
    expect(props.onClose).toHaveBeenCalledTimes(1)
  })


  it('renders nothing queryable when closed', () => {
    renderResult({ open: false })

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  })
})
