/**
 * CurrentEditRunConflictDialog: Run / Resume with an unsaved window change asks Cancel / Drop Changes / Save Changes (VMGR-64).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import {
  CurrentEditRunConflictDialog,
  type CurrentEditRunConflictDialogProps,
} from '@/features/workbench/common/variables/variable-inspect-modal/current-edit-run-conflict-dialog'

const defaultProps: CurrentEditRunConflictDialogProps = {
  isOpen: true,
  entries: [{ name: 'count', functionPath: [] }],
  onCancel: vi.fn(),
  onDrop: vi.fn(),
  onSave: vi.fn(),
}

describe('CurrentEditRunConflictDialog - rendering', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders nothing when closed', () => {
    render(<CurrentEditRunConflictDialog {...defaultProps} isOpen={false} />)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('renders the dialog with a warning icon when open', () => {
    render(<CurrentEditRunConflictDialog {...defaultProps} />)
    const dialog = screen.getByRole('dialog')
    expect(dialog).toBeInTheDocument()
    expect(dialog.querySelector('svg')).toBeInTheDocument()
  })

  it('offers Cancel, Drop Changes, and Save Changes', () => {
    render(<CurrentEditRunConflictDialog {...defaultProps} />)
    expect(screen.getByRole('button', { name: /^cancel$/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /drop changes/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /save changes/i })).toBeInTheDocument()
  })

  it('names the variable(s) with the unsaved Current edit', () => {
    render(
      <CurrentEditRunConflictDialog
        {...defaultProps}
        entries={[
          { name: 'alpha', functionPath: [] },
          { name: 'beta', functionPath: [] },
        ]}
      />,
    )
    expect(screen.getByText(/alpha/)).toBeInTheDocument()
    expect(screen.getByText(/beta/)).toBeInTheDocument()
  })
})

describe('CurrentEditRunConflictDialog - actions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('calls onCancel when Cancel is clicked', async () => {
    const user = userEvent.setup()
    const onCancel = vi.fn()
    render(<CurrentEditRunConflictDialog {...defaultProps} onCancel={onCancel} />)
    await user.click(screen.getByRole('button', { name: /^cancel$/i }))
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('calls onDrop when Drop Changes is clicked', async () => {
    const user = userEvent.setup()
    const onDrop = vi.fn()
    render(<CurrentEditRunConflictDialog {...defaultProps} onDrop={onDrop} />)
    await user.click(screen.getByRole('button', { name: /drop changes/i }))
    expect(onDrop).toHaveBeenCalledTimes(1)
  })

  it('calls onSave when Save Changes is clicked', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn()
    render(<CurrentEditRunConflictDialog {...defaultProps} onSave={onSave} />)
    await user.click(screen.getByRole('button', { name: /save changes/i }))
    expect(onSave).toHaveBeenCalledTimes(1)
  })

  it('routes ESC to Cancel (the non-destructive choice)', async () => {
    const user = userEvent.setup()
    const onCancel = vi.fn()
    const onDrop = vi.fn()
    render(
      <CurrentEditRunConflictDialog {...defaultProps} onCancel={onCancel} onDrop={onDrop} />,
    )
    await user.keyboard('{Escape}')
    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(onDrop).not.toHaveBeenCalled()
  })

  it('puts default focus on Cancel', () => {
    render(<CurrentEditRunConflictDialog {...defaultProps} />)
    expect(screen.getByRole('button', { name: /^cancel$/i })).toHaveFocus()
  })

  it('disables Cancel and Drop while a save is in flight', () => {
    render(<CurrentEditRunConflictDialog {...defaultProps} isSaving />)
    expect(screen.getByRole('button', { name: /^cancel$/i })).toBeDisabled()
    expect(screen.getByRole('button', { name: /drop changes/i })).toBeDisabled()
  })

  it('does not route ESC to Cancel while a save is in flight', async () => {
    const user = userEvent.setup()
    const onCancel = vi.fn()
    render(<CurrentEditRunConflictDialog {...defaultProps} isSaving onCancel={onCancel} />)
    await user.keyboard('{Escape}')
    expect(onCancel).not.toHaveBeenCalled()
  })
})

describe('CurrentEditRunConflictDialog - entries carry a name and a scope (VMGR-64)', () => {
  it('keeps the one-entry copy: the title, the named variable and the choice line', () => {
    render(<CurrentEditRunConflictDialog {...defaultProps} />)
    expect(screen.getByRole('dialog', { name: 'Unsaved Current value' })).toBeInTheDocument()
    expect(screen.getByText('count').closest('p')).toHaveTextContent(
      /^This variable has an unsaved Current-value edit: count\.$/,
    )
    expect(
      screen.getByText('Save the override before the run, drop it, or cancel and keep editing.'),
    ).toBeInTheDocument()
  })

  it('names a Test entry and a Function entry in the order given, with the plural copy', () => {
    render(
      <CurrentEditRunConflictDialog
        {...defaultProps}
        entries={[
          { name: 'alpha', functionPath: [] },
          { name: 'beta', functionPath: [{ nodeId: 'fn-node-1', label: 'Function_A' }] },
        ]}
      />,
    )
    expect(screen.getByRole('dialog', { name: 'Unsaved Current values' })).toBeInTheDocument()
    expect(screen.getByText('alpha, beta').closest('p')).toHaveTextContent(
      /^These variables have an unsaved Current-value edit: alpha, beta\.$/,
    )
  })

  it('names a nested Function entry by its name only, never by its path', () => {
    render(
      <CurrentEditRunConflictDialog
        {...defaultProps}
        entries={[
          {
            name: 'total',
            functionPath: [
              { nodeId: 'outer-node', label: 'Outer_Fn' },
              { nodeId: 'inner-node', label: 'Inner_Fn' },
            ],
          },
        ]}
      />,
    )
    expect(screen.getByText('total').closest('p')).toHaveTextContent(
      /^This variable has an unsaved Current-value edit: total\.$/,
    )
    expect(screen.getByRole('dialog')).not.toHaveTextContent(/outer-node|inner-node|Outer_Fn|Inner_Fn/)
  })
})

describe('CurrentEditRunConflictDialog - copy for a definition change', () => {
  const NEW_CHOICE_LINE = 'Save the changes before the run, drop them, or cancel and keep editing.'

  it('keeps the Current-value copy when every entry holds only a Current value', () => {
    render(
      <CurrentEditRunConflictDialog
        {...defaultProps}
        entries={[
          { name: 'alpha', definitionChanged: false },
          { name: 'beta', definitionChanged: false },
        ]}
      />,
    )
    expect(screen.getByRole('dialog', { name: 'Unsaved Current values' })).toBeInTheDocument()
    expect(screen.getByText('alpha, beta').closest('p')).toHaveTextContent(
      /^These variables have an unsaved Current-value edit: alpha, beta\.$/,
    )
    expect(
      screen.getByText('Save the override before the run, drop it, or cancel and keep editing.'),
    ).toBeInTheDocument()
  })

  it('says Unsaved changes for one entry holding a definition change', () => {
    render(<CurrentEditRunConflictDialog {...defaultProps} entries={[{ name: 'count', definitionChanged: true }]} />)
    expect(screen.getByRole('dialog', { name: 'Unsaved changes' })).toBeInTheDocument()
    expect(screen.getByText('count').closest('p')).toHaveTextContent(/^This variable has unsaved changes: count\.$/)
    expect(screen.getByText(NEW_CHOICE_LINE)).toBeInTheDocument()
    expect(screen.queryByText(/override|Current-value/)).not.toBeInTheDocument()
  })

  it('says Unsaved changes, plural, when any entry of several holds a definition change', () => {
    render(
      <CurrentEditRunConflictDialog
        {...defaultProps}
        entries={[
          { name: 'alpha', definitionChanged: false },
          { name: 'beta', definitionChanged: true },
        ]}
      />,
    )
    expect(screen.getByRole('dialog', { name: 'Unsaved changes' })).toBeInTheDocument()
    expect(screen.getByText('alpha, beta').closest('p')).toHaveTextContent(
      /^These variables have unsaved changes: alpha, beta\.$/,
    )
    expect(screen.getByText(NEW_CHOICE_LINE)).toBeInTheDocument()
  })

  it('keeps Cancel, Drop Changes and Save Changes in that order with the focus on Cancel', () => {
    render(<CurrentEditRunConflictDialog {...defaultProps} entries={[{ name: 'count', definitionChanged: true }]} />)
    const buttons = screen.getAllByRole('button').map((button) => button.textContent)
    expect(buttons).toEqual(['Cancel', 'Drop Changes', 'Save Changes'])
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus()
  })
})
