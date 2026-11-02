/**
 * Tests for EditVariablesDialog: it threads the consumer-injected
 * `renderValueCell` through to the shared VariableEditor and opts the wrapping
 * EditDialog into the floating-sheet mode (so the non-portaled value-editor
 * sheet floats correctly over the centered dialog).
 *
 * EditDialog + VariableEditor are mocked to stand-ins surfacing the threaded
 * props so this file covers the wrapper's wiring only.
 *
 * REQ-3.1.3.1 / REQ-3.1.3.11: entity-scope variable value editing on the shared cell
 */

import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'

import { EditVariablesDialog } from '@/components/shared/dialogs/edit-variables-dialog'
import type { VariableRow } from '@/lib/variable-types'

// EditDialog stand-in: renders children when open and surfaces allowFloatingSheet.
vi.mock('@/components/ui/edit-dialog', () => ({
  EditDialog: ({
    open,
    children,
    allowFloatingSheet,
  }: {
    open: boolean
    children: ReactNode
    allowFloatingSheet?: boolean
  }) =>
    open ? (
      <div data-testid="edit-dialog" data-allow-floating-sheet={String(!!allowFloatingSheet)}>
        {children}
      </div>
    ) : null,
}))

// VariableEditor stand-in: invokes the injected renderValueCell with a sample row
// so the thread-through is observable.
vi.mock('@/components/shared/variable-editor/variable-editor', () => ({
  VariableEditor: ({
    renderValueCell,
  }: {
    renderValueCell?: (row: VariableRow) => ReactNode
  }) => (
    <div data-testid="variable-editor">
      <div data-testid="has-render-value-cell">{String(!!renderValueCell)}</div>
      {renderValueCell?.({ id: 'r1', name: 'cfg', type: 'array', secret: false, value: '[1,2]' })}
    </div>
  ),
}))

function renderDialog(renderValueCell: (row: VariableRow) => ReactNode) {
  render(
    <EditVariablesDialog
      open
      onOpenChange={vi.fn()}
      title="Edit Suite Variables"
      description="desc"
      isDirty={false}
      onSave={vi.fn(async () => {})}
      onDiscard={vi.fn()}
      formatError={(e) => String(e)}
      editVariables={[]}
      onChange={vi.fn()}
      selectedIds={new Set()}
      onSelectionChange={vi.fn()}
      onBulkDuplicate={vi.fn()}
      onBulkDelete={vi.fn()}
      renderValueCell={renderValueCell}
    />,
  )
}

describe('EditVariablesDialog - renderValueCell threading', () => {
  it('threads renderValueCell through to VariableEditor', () => {
    renderDialog(vi.fn(() => <div />))
    expect(screen.getByTestId('has-render-value-cell')).toHaveTextContent('true')
  })

  it('renders the injected cell output for a row', () => {
    renderDialog((row) => <div data-testid={`injected-${row.id}`}>{row.type}</div>)
    expect(screen.getByTestId('injected-r1')).toHaveTextContent('array')
  })

  it('opts the EditDialog into the floating-sheet mode', () => {
    renderDialog(vi.fn(() => <div />))
    expect(screen.getByTestId('edit-dialog')).toHaveAttribute('data-allow-floating-sheet', 'true')
  })
})
