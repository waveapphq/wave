/**
 * OutputListSection - the variable export table under the fixed output rows.
 *
 * SHRUN-6: columns Script Variable, Type, Secret, WAVE Variable, with
 * "Add variable export" beneath them. The Type cell is the Variable Setter's type
 * select (VARSET-5): locked to an existing bound variable's type, free otherwise.
 * A name error shows under the row once its field has lost focus (VARSET-8).
 *
 * REQ: REQ-3.4.1.1, REQ-3.4.2.2
 */
import { useState } from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock(
  '@/features/workbench/common/element-config/outputs/output-binding-combobox',
  () => ({
    OutputBindingCombobox: ({
      value,
      onChange,
      errorId,
    }: {
      value: string
      onChange: (value: string) => void
      errorId?: string
    }) => (
      <input
        data-testid="mock-output-binding"
        value={value ?? ''}
        aria-describedby={errorId}
        onChange={(e) => onChange(e.target.value)}
      />
    ),
  }),
)

vi.mock('@/features/workbench/common/variables/variable-inspect-modal/value-editor-sheet', () => ({
  ValueEditorSheet: () => null,
}))

import { OutputListSection } from '@/features/workbench/common/element-config/outputs/output-list-section'
import { outputListFieldErrors } from '@/features/workbench/lib/node-parameters/output-list'
import { describeBindingRejection } from '@/features/workbench/lib/validation/output-binding-rules'
import type {
  OutputListPolicy,
  OutputListRowState,
} from '@/features/workbench/lib/node-parameters/types'

const SHELL_SCRIPT_POLICY: OutputListPolicy = {
  nameHeading: 'Script Variable',
  bindingHeading: 'WAVE Variable',
  itemNoun: 'variable export',
  addLabel: 'Add variable export',
  namePattern: '^[A-Za-z_][A-Za-z0-9_]*$',
  nameRuleMessage:
    'Name must start with a letter or underscore, and contain only letters, numbers, and underscores',
  invalidNameMessage: "Invalid script variable name: '{name}'",
  clashMessage: "Script variable '{name}' has the name of a block output",
  duplicateMessage: "Script variable '{name}' is listed more than once",
}

const RULE =
  'Name must start with a letter or underscore, and contain only letters, numbers, and underscores'

/** Every output of Shell Script, including the two gated on Record and continue. */
const RESERVED_NAMES = ['stdout', 'stderr', 'exit_code', 'success', 'error', 'reason']

const VARIABLES = [
  { id: 'v1', name: 'count', type: 'integer' },
  { id: 'v2', name: 'report', type: 'string' },
  { id: 'v3', name: 'rows', type: 'table' },
]

function row(overrides: Partial<OutputListRowState> = {}): OutputListRowState {
  return { name: 'COUNT', binding: '', secret: false, type: 'string', ...overrides }
}

function Harness({
  initialRows = [],
  onRowsChange,
}: Readonly<{
  initialRows?: OutputListRowState[]
  onRowsChange?: (rows: OutputListRowState[]) => void
}>) {
  const [rows, setRows] = useState<OutputListRowState[]>(initialRows)
  return (
    <OutputListSection
      policy={SHELL_SCRIPT_POLICY}
      rows={rows}
      onRowsChange={(next: OutputListRowState[]) => {
        onRowsChange?.(next)
        setRows(next)
      }}
      rowErrors={outputListFieldErrors(rows, SHELL_SCRIPT_POLICY, RESERVED_NAMES)}
      bindingErrors={rows.map((current) => describeBindingRejection(current.binding) ?? undefined)}
      availableVariables={VARIABLES}
    />
  )
}

function renderSection(props: React.ComponentProps<typeof Harness> = {}) {
  return render(<Harness {...props} />)
}

function nameField(index: number): HTMLElement {
  return screen.getByTestId(`output-list-name-${index}`)
}

function rowCells(index: number): HTMLTableCellElement[] {
  const tableRow = nameField(index).closest('tr')
  expect(tableRow).not.toBeNull()
  return Array.from(tableRow!.querySelectorAll('td'))
}

function typeSelect(index: number): HTMLElement {
  return screen.getByTestId(`output-list-type-${index}`)
}

function bindingField(index: number): HTMLElement {
  return within(screen.getByTestId(`output-list-binding-${index}`)).getByRole('textbox')
}

async function leaveName(user: ReturnType<typeof userEvent.setup>, index: number) {
  await user.click(nameField(index))
  await user.tab()
}

function nameErrorRow(index: number): HTMLTableRowElement | null {
  const next = nameField(index).closest('tr')!.nextElementSibling
  return next !== null && next.querySelector('[role="alert"]') !== null
    ? (next as HTMLTableRowElement)
    : null
}

async function pickType(user: ReturnType<typeof userEvent.setup>, index: number, label: string) {
  await user.click(typeSelect(index))
  await waitFor(() => expect(screen.getByRole('option', { name: label })).toBeInTheDocument())
  await user.click(screen.getByRole('option', { name: label }))
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('OutputListSection headings and add button (SHRUN-6)', () => {
  it('renders the four column headings', () => {
    renderSection()

    expect(screen.getByRole('columnheader', { name: 'Script Variable' })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'Type' })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'Secret' })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'WAVE Variable' })).toBeInTheDocument()
  })

  it('renders the headings and the add button with no export rows', () => {
    renderSection()

    expect(screen.getByRole('columnheader', { name: 'Script Variable' })).toBeInTheDocument()
    expect(screen.getByTestId('output-list-add')).toHaveAccessibleName('Add variable export')
    expect(screen.queryByTestId('output-list-name-0')).not.toBeInTheDocument()
  })
})

describe('OutputListSection export rows in the table columns (SHRUN-6)', () => {
  it('puts the name, type, secret and binding in the four columns of one row', () => {
    renderSection({ initialRows: [row({ name: 'COUNT', binding: 'count' })] })

    const cells = rowCells(0)
    expect(cells).toHaveLength(5)
    expect(within(cells[1]).getByTestId('output-list-name-0')).toBeInTheDocument()
    expect(within(cells[2]).getByTestId('output-list-type-0')).toHaveTextContent(/^Integer$/)
    expect(within(cells[3]).getByTestId('output-list-secret-0')).toBeInTheDocument()
    expect(within(cells[4]).getByTestId('output-list-binding-0')).toBeInTheDocument()
    expect(within(cells[4]).getByTestId('output-list-remove-0')).toBeInTheDocument()
  })

  it('shows the export name in its own field', () => {
    renderSection({ initialRows: [row({ name: 'COUNT' })] })

    expect(nameField(0)).toHaveValue('COUNT')
  })

  it('numbers the accessible names from one', () => {
    renderSection({ initialRows: [row({ name: 'COUNT' }), row({ name: 'REPORT' })] })

    expect(nameField(0)).toHaveAccessibleName('Variable export 1 name')
    expect(screen.getByTestId('output-list-secret-0')).toHaveAccessibleName(
      'Variable export 1 secret',
    )
    expect(screen.getByTestId('output-list-remove-0')).toHaveAccessibleName(
      'Remove variable export 1',
    )
    expect(nameField(1)).toHaveAccessibleName('Variable export 2 name')
    expect(screen.getByTestId('output-list-secret-1')).toHaveAccessibleName(
      'Variable export 2 secret',
    )
    expect(screen.getByTestId('output-list-remove-1')).toHaveAccessibleName(
      'Remove variable export 2',
    )
  })
})

describe('OutputListSection Type cell: an existing variable (VARSET-5)', () => {
  it('shows the bound variable type in a locked select', () => {
    renderSection({ initialRows: [row({ name: 'COUNT', binding: 'count' })] })

    expect(typeSelect(0)).toHaveTextContent(/^Integer$/)
    expect(typeSelect(0)).toBeDisabled()
  })

  it('shows a table variable type', () => {
    renderSection({ initialRows: [row({ name: 'ROWS', binding: 'rows' })] })

    expect(typeSelect(0)).toHaveTextContent(/^Table$/)
    expect(typeSelect(0)).toBeDisabled()
  })

  it('shows the existing variable type, not the row choice', () => {
    renderSection({ initialRows: [row({ name: 'COUNT', binding: 'count', type: 'table' })] })

    expect(typeSelect(0)).toHaveTextContent(/^Integer$/)
  })

  it('takes the variable type onto the row when the author picks that variable', async () => {
    const user = userEvent.setup()
    const onRowsChange = vi.fn()
    renderSection({ initialRows: [row({ name: 'COUNT', binding: '' })], onRowsChange })

    await user.type(bindingField(0), 'count')

    expect(typeSelect(0)).toHaveTextContent(/^Integer$/)
    expect(typeSelect(0)).toBeDisabled()
    expect(onRowsChange).toHaveBeenLastCalledWith([
      { name: 'COUNT', binding: 'count', secret: false, type: 'integer' },
    ])
  })

  it('keeps that type as the choice when the binding moves on to a new name', async () => {
    const user = userEvent.setup()
    const onRowsChange = vi.fn()
    renderSection({
      initialRows: [row({ name: 'COUNT', binding: 'brand_new', type: 'table' })],
      onRowsChange,
    })

    await user.clear(bindingField(0))
    await user.type(bindingField(0), 'count')
    await user.clear(bindingField(0))
    await user.type(bindingField(0), 'fresh')

    expect(typeSelect(0)).toHaveTextContent(/^Integer$/)
    expect(typeSelect(0)).toBeEnabled()
    expect(onRowsChange).toHaveBeenLastCalledWith([
      { name: 'COUNT', binding: 'fresh', secret: false, type: 'integer' },
    ])
  })
})

describe('OutputListSection Type cell: no existing variable (VARSET-5)', () => {
  it('offers a free select while the row is unbound, String by default', () => {
    renderSection({ initialRows: [row({ name: 'COUNT', binding: '' })] })

    expect(within(rowCells(0)[2]).getByRole('combobox')).toBe(typeSelect(0))
    expect(typeSelect(0)).toBeEnabled()
    expect(typeSelect(0)).toHaveTextContent(/^String$/)
  })

  it('offers a free select when the binding names no variable', () => {
    renderSection({ initialRows: [row({ name: 'COUNT', binding: 'brand_new' })] })

    expect(typeSelect(0)).toBeEnabled()
    expect(typeSelect(0)).toHaveTextContent(/^String$/)
  })

  it('names the select for assistive tech and numbers it from one', () => {
    renderSection({
      initialRows: [row({ name: 'A', binding: 'new_a' }), row({ name: 'B', binding: 'count' })],
    })

    expect(typeSelect(0)).toHaveAccessibleName('Variable export 1 type')
    expect(typeSelect(1)).toHaveAccessibleName('Variable export 2 type')
  })

  it('shows the type chosen in the row', () => {
    renderSection({
      initialRows: [row({ name: 'COUNT', binding: 'brand_new', type: 'integer' })],
    })

    expect(typeSelect(0)).toHaveTextContent(/^Integer$/)
  })

  it('lists every variable type', async () => {
    const user = userEvent.setup()
    renderSection({ initialRows: [row({ name: 'COUNT', binding: 'brand_new' })] })

    await user.click(typeSelect(0))

    await waitFor(() => expect(screen.getByRole('option', { name: 'Table' })).toBeInTheDocument())
    expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual([
      'String',
      'Integer',
      'Float',
      'Boolean',
      'Array',
      'Map',
      'Table',
    ])
  })

  it('updates the row with the chosen type', async () => {
    const user = userEvent.setup()
    const onRowsChange = vi.fn()
    renderSection({ initialRows: [row({ name: 'COUNT', binding: 'brand_new' })], onRowsChange })

    await pickType(user, 0, 'Table')

    expect(onRowsChange).toHaveBeenCalledWith([
      { name: 'COUNT', binding: 'brand_new', secret: false, type: 'table' },
    ])
    expect(typeSelect(0)).toHaveTextContent(/^Table$/)
  })

  it('keeps the chosen type when the binding moves to another new name', async () => {
    const user = userEvent.setup()
    renderSection({
      initialRows: [row({ name: 'COUNT', binding: 'brand_new', type: 'integer' })],
    })

    await user.clear(bindingField(0))
    await user.type(bindingField(0), 'other_new')

    expect(typeSelect(0)).toHaveTextContent(/^Integer$/)
  })

  it('lets the type be chosen on a just-added row before it is bound', async () => {
    const user = userEvent.setup()
    const onRowsChange = vi.fn()
    renderSection({ onRowsChange })

    await user.click(screen.getByTestId('output-list-add'))
    await pickType(user, 0, 'Map')

    expect(onRowsChange).toHaveBeenLastCalledWith([
      { name: '', binding: '', secret: false, type: 'map' },
    ])
  })
})

describe('OutputListSection Secret box (SHRUN-6)', () => {
  it('is ticked for a secret export', () => {
    renderSection({ initialRows: [row({ secret: true })] })

    expect(screen.getByTestId('output-list-secret-0')).toBeChecked()
  })

  it('is unticked for an export that is not secret', () => {
    renderSection({ initialRows: [row({ secret: false })] })

    expect(screen.getByTestId('output-list-secret-0')).not.toBeChecked()
  })

  it('reports the row as secret when the box is ticked', async () => {
    const user = userEvent.setup()
    const onRowsChange = vi.fn()
    renderSection({ initialRows: [row({ name: 'COUNT', secret: false })], onRowsChange })

    await user.click(screen.getByTestId('output-list-secret-0'))

    expect(onRowsChange).toHaveBeenCalledWith([{ name: 'COUNT', binding: '', secret: true, type: 'string' }])
    expect(screen.getByTestId('output-list-secret-0')).toBeChecked()
  })

  it('clears the secret flag when the box is unticked', async () => {
    const user = userEvent.setup()
    const onRowsChange = vi.fn()
    renderSection({ initialRows: [row({ name: 'COUNT', secret: true })], onRowsChange })

    await user.click(screen.getByTestId('output-list-secret-0'))

    expect(onRowsChange).toHaveBeenCalledWith([{ name: 'COUNT', binding: '', secret: false, type: 'string' }])
  })
})

describe('OutputListSection name editing (SHRUN-6)', () => {
  it('reports every keystroke of the export name', async () => {
    const user = userEvent.setup()
    const onRowsChange = vi.fn()
    renderSection({ initialRows: [row({ name: '' })], onRowsChange })

    await user.type(nameField(0), 'COUNT')

    expect(nameField(0)).toHaveValue('COUNT')
    expect(onRowsChange).toHaveBeenLastCalledWith([
      { name: 'COUNT', binding: '', secret: false, type: 'string' },
    ])
  })

  it('changes only the row being edited', async () => {
    const user = userEvent.setup()
    const onRowsChange = vi.fn()
    renderSection({
      initialRows: [row({ name: 'COUNT', binding: 'count' }), row({ name: '' })],
      onRowsChange,
    })

    await user.type(nameField(1), 'REPORT')

    expect(nameField(0)).toHaveValue('COUNT')
    expect(onRowsChange).toHaveBeenLastCalledWith([
      { name: 'COUNT', binding: 'count', secret: false, type: 'string' },
      { name: 'REPORT', binding: '', secret: false, type: 'string' },
    ])
  })
})

describe('OutputListSection binding errors (SHRUN-6)', () => {
  const DOTTED_MESSAGE =
    "'profile.host' is a namespace or profile reference; pick or create a test-local variable instead"

  it('shows no binding error for a test-local variable', () => {
    renderSection({ initialRows: [row({ name: 'COUNT', binding: 'count' })] })

    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(bindingField(0)).not.toHaveAttribute('aria-describedby')
  })

  it('shows the rejection under the binding field of its row as the author types', async () => {
    const user = userEvent.setup()
    renderSection({ initialRows: [row({ name: 'COUNT' }), row({ name: 'REPORT' })] })

    await user.type(bindingField(1), 'profile.host')

    const cells = rowCells(1)
    expect(within(cells[4]).getByRole('alert').textContent).toBe(DOTTED_MESSAGE)
    expect(within(rowCells(0)[4]).queryByRole('alert')).not.toBeInTheDocument()
  })

  it('ties the binding field to its error for assistive tech', () => {
    renderSection({ initialRows: [row({ name: 'COUNT', binding: 'system' })] })

    const alert = screen.getByRole('alert')
    expect(alert.textContent).toBe("'system' is a read-only namespace and cannot receive an output")
    expect(alert).toHaveAttribute('id', 'output-list-binding-error-0')
    expect(bindingField(0)).toHaveAttribute('aria-describedby', alert.id)
  })

  it('clears the error once the binding names a test-local variable', async () => {
    const user = userEvent.setup()
    renderSection({ initialRows: [row({ name: 'COUNT', binding: 'profile.host' })] })

    await user.clear(bindingField(0))
    await user.type(bindingField(0), 'report')

    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(bindingField(0)).not.toHaveAttribute('aria-describedby')
  })

  it('shows the binding error without waiting for the name field to be left', () => {
    renderSection({ initialRows: [row({ name: '1COUNT', binding: 'profile.host' })] })

    expect(screen.getAllByRole('alert')).toHaveLength(1)
    expect(screen.getByRole('alert').textContent).toBe(DOTTED_MESSAGE)
  })
})

describe('OutputListSection add (SHRUN-6)', () => {
  it('appends an empty export row', async () => {
    const user = userEvent.setup()
    const onRowsChange = vi.fn()
    renderSection({ initialRows: [row({ name: 'COUNT', binding: 'count' })], onRowsChange })

    await user.click(screen.getByTestId('output-list-add'))

    expect(onRowsChange).toHaveBeenCalledWith([
      { name: 'COUNT', binding: 'count', secret: false, type: 'string' },
      { name: '', binding: '', secret: false, type: 'string' },
    ])
    expect(nameField(1)).toHaveValue('')
    expect(screen.getByTestId('output-list-secret-1')).not.toBeChecked()
    expect(typeSelect(1)).toHaveTextContent(/^String$/)
  })

  it('focuses the new name field and shows no error before the field is left', async () => {
    const user = userEvent.setup()
    renderSection()

    await user.click(screen.getByTestId('output-list-add'))

    await waitFor(() => expect(nameField(0)).toHaveFocus())
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(nameField(0)).not.toHaveAttribute('aria-invalid')
  })
})

describe('OutputListSection remove (SHRUN-6)', () => {
  it('drops the row it belongs to', async () => {
    const user = userEvent.setup()
    const onRowsChange = vi.fn()
    renderSection({
      initialRows: [row({ name: 'COUNT' }), row({ name: 'REPORT', binding: 'report' })],
      onRowsChange,
    })

    await user.click(screen.getByTestId('output-list-remove-0'))

    expect(onRowsChange).toHaveBeenCalledWith([
      { name: 'REPORT', binding: 'report', secret: false, type: 'string' },
    ])
    expect(nameField(0)).toHaveValue('REPORT')
    expect(screen.queryByTestId('output-list-name-1')).not.toBeInTheDocument()
  })

  it('moves focus to the row that took the removed row place', async () => {
    const user = userEvent.setup()
    renderSection({ initialRows: [row({ name: 'COUNT' }), row({ name: 'REPORT' })] })

    await user.click(screen.getByTestId('output-list-remove-0'))

    await waitFor(() => expect(nameField(0)).toHaveFocus())
    expect(nameField(0)).toHaveValue('REPORT')
  })

  it('moves focus to the add button when the last row goes', async () => {
    const user = userEvent.setup()
    renderSection({ initialRows: [row({ name: 'COUNT' })] })

    await user.click(screen.getByTestId('output-list-remove-0'))

    await waitFor(() => expect(screen.getByTestId('output-list-add')).toHaveFocus())
  })
})

describe('OutputListSection name errors (SHRUN-6, VARSET-8)', () => {
  it('shows no error for a valid, unique name', async () => {
    const user = userEvent.setup()
    renderSection({ initialRows: [row({ name: 'COUNT', binding: 'count' })] })

    await leaveName(user, 0)

    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('holds an invalid name error until the field is left', async () => {
    const user = userEvent.setup()
    renderSection({ initialRows: [row({ name: 'x y' })] })

    expect(screen.queryByRole('alert')).not.toBeInTheDocument()

    await leaveName(user, 0)

    expect(screen.getByRole('alert')).toHaveTextContent(new RegExp(`^${RULE}$`))
  })

  it('asks for a name when a just-added row is left empty', async () => {
    const user = userEvent.setup()
    renderSection()

    await user.click(screen.getByTestId('output-list-add'))
    await user.tab()

    expect(screen.getByRole('alert')).toHaveTextContent(/^Name is required$/)
    expect(nameField(0)).toHaveAttribute('aria-invalid', 'true')
  })

  it('puts the error on its own line under the row, never inside the row', async () => {
    const user = userEvent.setup()
    renderSection({ initialRows: [row({ name: '1COUNT', binding: 'count' })] })

    await leaveName(user, 0)

    const dataRow = nameField(0).closest('tr')!
    expect(within(dataRow).queryByRole('alert')).not.toBeInTheDocument()
    expect(within(dataRow).getByTestId('output-list-binding-0')).toBeInTheDocument()
    const errorRow = nameErrorRow(0)
    expect(errorRow).not.toBeNull()
    const alert = within(errorRow!).getByRole('alert')
    expect(alert).toHaveTextContent(new RegExp(`^${RULE}$`))
    expect(nameField(0)).toHaveAttribute('aria-describedby', alert.id)
  })

  it('does not repeat the name in the message', async () => {
    const user = userEvent.setup()
    renderSection({ initialRows: [row({ name: 'x y' })] })

    await leaveName(user, 0)

    expect(screen.getByRole('alert').textContent).not.toContain('x y')
  })

  it('says a block output already has the name', async () => {
    const user = userEvent.setup()
    renderSection({ initialRows: [row({ name: 'reason' })] })

    await leaveName(user, 0)

    expect(screen.getByRole('alert')).toHaveTextContent(/^A block output already has this name$/)
  })

  it('flags each left row of a repeated name', async () => {
    const user = userEvent.setup()
    renderSection({ initialRows: [row({ name: 'A' }), row({ name: 'A' })] })

    await leaveName(user, 0)
    await leaveName(user, 1)

    const alerts = screen.getAllByRole('alert')
    expect(alerts).toHaveLength(2)
    for (const alert of alerts) {
      expect(alert).toHaveTextContent(/^Another variable export has this name$/)
    }
  })

  it('updates as the author types once the field has been left', async () => {
    const user = userEvent.setup()
    renderSection({ initialRows: [row({ name: '1COUNT' })] })

    await leaveName(user, 0)
    expect(screen.getByRole('alert')).toHaveTextContent(new RegExp(`^${RULE}$`))

    await user.clear(nameField(0))
    expect(screen.getByRole('alert')).toHaveTextContent(/^Name is required$/)

    await user.type(nameField(0), 'COUNT')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()

    await user.type(nameField(0), ' X')
    expect(screen.getByRole('alert')).toHaveTextContent(new RegExp(`^${RULE}$`))
  })

  it('keeps each row error with its own row when a row above is removed', async () => {
    const user = userEvent.setup()
    renderSection({ initialRows: [row({ name: 'x y' }), row({ name: '1B' }), row({ name: '2C' })] })

    await leaveName(user, 1)
    await user.click(screen.getByTestId('output-list-remove-0'))

    expect(nameField(0)).toHaveValue('1B')
    expect(nameErrorRow(0)).not.toBeNull()
    expect(nameField(1)).toHaveValue('2C')
    expect(nameErrorRow(1)).toBeNull()
  })

  it('shows no error on a row appended after a left row', async () => {
    const user = userEvent.setup()
    renderSection({ initialRows: [row({ name: '1A' })] })

    await leaveName(user, 0)
    await user.click(screen.getByTestId('output-list-add'))

    expect(nameErrorRow(0)).not.toBeNull()
    expect(nameErrorRow(1)).toBeNull()
  })
})
