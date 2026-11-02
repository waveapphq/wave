/**
 * Suite Variables Editor Tests
 *
 * Tests for the shared VariableEditor as used by suite detail page.
 */

import { describe, it, expect, vi } from 'vitest'
import type { ReactNode } from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { VariableEditor } from '@/components/shared/variable-editor/variable-editor'
import { EditVariablesDialog } from '@/components/shared/dialogs/edit-variables-dialog'
import { EntityVariableValueCell } from '@/features/workbench/common/variables/entity-variable-value-cell'
import type { VariableRow } from '@/lib/variable-types'

const noop = () => {}
const saveNoop = async () => {}
const stubValueCell = (row: VariableRow): ReactNode => <div data-testid={`value-cell-${row.id}`} />

/** The rows inside the suite's Edit Variables dialog, with a change to save. */
function renderInEditDialog(rows: VariableRow[]) {
  render(
    <EditVariablesDialog
      open
      onOpenChange={noop}
      title="Edit Suite Variables"
      description="Suite variables"
      isDirty
      onSave={saveNoop}
      onDiscard={noop}
      formatError={String}
      editVariables={rows}
      onChange={noop}
      selectedIds={new Set()}
      onSelectionChange={noop}
      onBulkDuplicate={noop}
      onBulkDelete={noop}
      renderValueCell={(row) => <EntityVariableValueCell row={row} rows={rows} onRowsChange={noop} />}
    />,
  )
}

describe('VariableEditor (suite variables)', () => {
  const onChange = vi.fn()

  const defaultRows: VariableRow[] = [
    { id: 'row-1', name: 'base_url', type: 'string', value: 'http://localhost', secret: false },
    { id: 'row-2', name: 'timeout', type: 'integer', value: '30', secret: false },
  ]

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('renders editor with data-testid', () => {
    render(<VariableEditor rows={defaultRows} onChange={onChange} renderValueCell={stubValueCell} />)
    expect(screen.getByTestId('variable-editor')).toBeInTheDocument()
  })

  it('renders rows for each variable', () => {
    render(<VariableEditor rows={defaultRows} onChange={onChange} renderValueCell={stubValueCell} />)
    expect(screen.getAllByTestId('variable-editor-row')).toHaveLength(2)
  })

  it('shows empty state when no variables', () => {
    render(<VariableEditor rows={[]} onChange={onChange} renderValueCell={stubValueCell} />)
    expect(screen.getByText(/No variables yet/)).toBeInTheDocument()
  })

  it('adds a new variable when Add Variable is clicked', () => {
    render(<VariableEditor rows={defaultRows} onChange={onChange} renderValueCell={stubValueCell} />)

    fireEvent.click(screen.getByTestId('add-variable-btn'))

    expect(onChange).toHaveBeenCalledWith(
      expect.arrayContaining([
        defaultRows[0],
        defaultRows[1],
        expect.objectContaining({
          name: 'new_var_1',
          type: 'string',
          value: '',
          secret: false,
        }),
      ])
    )
  })

  it('generates unique names for new variables', () => {
    const rows: VariableRow[] = [
      { id: 'row-1', name: 'new_var_1', type: 'string', value: '', secret: false },
    ]

    render(<VariableEditor rows={rows} onChange={onChange} renderValueCell={stubValueCell} />)

    fireEvent.click(screen.getByTestId('add-variable-btn'))

    expect(onChange).toHaveBeenCalledWith(
      expect.arrayContaining([
        rows[0],
        expect.objectContaining({ name: 'new_var_2' }),
      ])
    )
  })

  it('removes a variable when delete is clicked', () => {
    render(<VariableEditor rows={defaultRows} onChange={onChange} renderValueCell={stubValueCell} />)

    const deleteButtons = screen.getAllByTestId('variable-delete-btn')
    fireEvent.click(deleteButtons[0])

    expect(onChange).toHaveBeenCalledWith([defaultRows[1]])
  })

  it('renders type select trigger showing current type', () => {
    render(<VariableEditor rows={defaultRows} onChange={onChange} renderValueCell={stubValueCell} />)

    const typeSelects = screen.getAllByTestId('variable-type-select')
    expect(typeSelects[0]).toHaveTextContent('String')
    expect(typeSelects[1]).toHaveTextContent('Integer')
  })

  it('renders type select triggers for all variables', () => {
    render(<VariableEditor rows={defaultRows} onChange={onChange} renderValueCell={stubValueCell} />)

    const typeSelects = screen.getAllByTestId('variable-type-select')
    expect(typeSelects).toHaveLength(2)
  })

  it('renders add variable button', () => {
    render(<VariableEditor rows={[]} onChange={onChange} renderValueCell={stubValueCell} />)
    expect(screen.getByTestId('add-variable-btn')).toBeInTheDocument()
    expect(screen.getByText('Add')).toBeInTheDocument()
  })

  it('updates variable name on change', () => {
    render(<VariableEditor rows={defaultRows} onChange={onChange} renderValueCell={stubValueCell} />)

    const nameInputs = screen.getAllByTestId('variable-name-input')
    fireEvent.change(nameInputs[0], { target: { value: 'api_url' } })

    expect(onChange).toHaveBeenCalledWith([
      { ...defaultRows[0], name: 'api_url' },
      defaultRows[1],
    ])
  })

  it('toggles secret checkbox', () => {
    render(<VariableEditor rows={defaultRows} onChange={onChange} renderValueCell={stubValueCell} />)

    const secretCheckbox = screen.getByTestId(`variable-secret-${defaultRows[0].id}`)
    fireEvent.click(secretCheckbox)

    expect(onChange).toHaveBeenCalledWith([
      { ...defaultRows[0], secret: true },
      defaultRows[1],
    ])
  })

  it('shows "Must be an integer" for an empty integer value and blocks Save', () => {
    const rows: VariableRow[] = [
      { id: 'row-1', name: 'count', type: 'integer', value: '', secret: false },
    ]
    renderInEditDialog(rows)
    expect(screen.getByText('Must be an integer')).toBeInTheDocument()
    expect(screen.getByTestId('edit-dialog-save')).toBeDisabled()
  })

  it('shows "Must be a number" for an empty float value and blocks Save', () => {
    const rows: VariableRow[] = [
      { id: 'row-1', name: 'ratio', type: 'float', value: '', secret: false },
    ]
    renderInEditDialog(rows)
    expect(screen.getByText('Must be a number')).toBeInTheDocument()
    expect(screen.getByTestId('edit-dialog-save')).toBeDisabled()
  })

  it('keeps Save open when every value is valid', () => {
    renderInEditDialog(defaultRows)
    expect(screen.getByTestId('edit-dialog-save')).toBeEnabled()
  })
})
