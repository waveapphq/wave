/**
 * EntityVariableValueCell tests.
 *
 * The entity-scope (Suite / Regression / System) value edge: the backend
 * round-trips entity values VERBATIM as actual JS values (arrays / objects /
 * numbers / booleans), so the cell adapts a structured value straight through
 * (parsing only a complex value that arrives as a JSON string), and stores the
 * cell's output structured (numbers as exact text). The shared VariableValueCell
 * is mocked to a stand-in surfacing the value it receives + a literal save /
 * secret-clear so the adaptation + row update can be driven.
 *
 * REQ-3.1.3.1: Variable scoping (entity-scope value editing)
 * REQ-3.1.3.11: Variable Manager UI panel
 */

import { useState } from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { EntityVariableValueCell } from '@/features/workbench/common/variables/entity-variable-value-cell'
import { EditVariablesDialog } from '@/components/shared/dialogs/edit-variables-dialog'
import {
  parseEntityCellValue,
  toEntityStoredValue,
  type VariableRow,
  type VariableType,
} from '@/lib/variable-types'

// Cases that drive the real shared cell (null chip, number box) switch this on.
const sharedCell = vi.hoisted(() => ({ real: false }))

// Stand-in for the shared cell: surfaces the parsed value it receives + buttons
// to fire a literal onChange and the secret clear so the edge can be asserted.
vi.mock('@/features/workbench/common/variables/variable-value-cell', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/features/workbench/common/variables/variable-value-cell')>()
  return {
    VariableValueCell: (props: any) => {
      if (sharedCell.real) return <actual.VariableValueCell {...props} />
      const { type, value, secret, elementTypes, onChange, onClearSecretValue } = props
      return (
        <div
          data-testid="mock-cell"
          data-type={type}
          data-secret={String(!!secret)}
          data-value={JSON.stringify(value)}
          data-element-types={JSON.stringify(elementTypes ?? null)}
        >
          <button data-testid="cell-change-array" onClick={() => onChange([9], false)}>arr</button>
          <button data-testid="cell-change-scalar" onClick={() => onChange('42', false)}>num</button>
          <button data-testid="cell-change-bool" onClick={() => onChange(true, false)}>bool</button>
          <button data-testid="cell-change-map" onClick={() => onChange({ k: 'v' }, false)}>map</button>
          <button data-testid="cell-change-typed-map" onClick={() => onChange({ n: '16' }, false, { n: 'integer' })}>typed</button>
          <button data-testid="cell-clear" onClick={onClearSecretValue}>clear</button>
        </div>
      )
    },
  }
})

function makeRow(overrides: Partial<VariableRow> = {}): VariableRow {
  return { id: 'r1', name: 'v', type: 'string', secret: false, value: '', ...overrides }
}

function renderCell(row: VariableRow) {
  const onRowsChange = vi.fn()
  render(<EntityVariableValueCell row={row} rows={[row]} onRowsChange={onRowsChange} />)
  return { onRowsChange }
}

const storedValue = (onRowsChange: ReturnType<typeof vi.fn>): unknown =>
  (onRowsChange.mock.calls.at(-1)?.[0] as VariableRow[])[0].value

beforeEach(() => {
  vi.clearAllMocks()
})

// ---------------------------------------------------------------------------
// parseEntityCellValue (read edge)
// ---------------------------------------------------------------------------
describe('parseEntityCellValue', () => {
  it('returns a real boolean for a boolean row (actual bool or string)', () => {
    expect(parseEntityCellValue('boolean', true)).toBe(true)
    expect(parseEntityCellValue('boolean', 'true')).toBe(true)
    expect(parseEntityCellValue('boolean', false)).toBe(false)
    expect(parseEntityCellValue('boolean', 'false')).toBe(false)
  })

  it.each(['string', 'integer', 'float'] as const)('passes the scalar value through for %s', (type) => {
    expect(parseEntityCellValue(type, '42')).toBe('42')
  })

  it('passes an already-structured complex value straight through (the real backend shape)', () => {
    expect(parseEntityCellValue('array', [1, 2, 3])).toEqual([1, 2, 3])
    expect(parseEntityCellValue('map', { a: 1 })).toEqual({ a: 1 })
    expect(parseEntityCellValue('table', [{ a: 1 }])).toEqual([{ a: 1 }])
  })

  it('parses a complex value held as a JSON string (legacy / edited shape)', () => {
    expect(parseEntityCellValue('array', '[1,2,3]')).toEqual([1, 2, 3])
    expect(parseEntityCellValue('map', '{"a":1}')).toEqual({ a: 1 })
  })

  it('seeds an empty shape when a complex string fails to parse', () => {
    expect(parseEntityCellValue('array', 'h1,h2')).toEqual([])
    expect(parseEntityCellValue('table', 'oops')).toEqual([])
    expect(parseEntityCellValue('map', 'oops')).toEqual({})
  })
})

// ---------------------------------------------------------------------------
// toEntityStoredValue (write edge) - keeps the verbatim/structured backend shape
// ---------------------------------------------------------------------------
describe('toEntityStoredValue', () => {
  it('passes a boolean through unchanged', () => {
    expect(toEntityStoredValue('boolean', true)).toBe(true)
    expect(toEntityStoredValue('boolean', false)).toBe(false)
  })

  it.each(['integer', 'float'] as const)('keeps %s as exact text', (type) => {
    expect(toEntityStoredValue(type, '42')).toBe('42')
  })

  it('stores a number that arrives as a JS number in plain digits (REQ-3.1.3.14)', () => {
    expect(toEntityStoredValue('float', 0.0000001)).toBe('0.0000001')
    expect(toEntityStoredValue('integer', 1e18)).toBe('1000000000000000000')
  })

  it('keeps a string as-is', () => {
    expect(toEntityStoredValue('string', 'hello')).toBe('hello')
  })

  it('keeps a complex value STRUCTURED (not a JSON string)', () => {
    expect(toEntityStoredValue('array', [9])).toEqual([9])
    expect(toEntityStoredValue('map', { k: 'v' })).toEqual({ k: 'v' })
  })
})

// ---------------------------------------------------------------------------
// Component wiring (adapt in -> cell -> adapt out -> row update)
// ---------------------------------------------------------------------------
describe('EntityVariableValueCell', () => {
  it('passes a structured complex value (the real backend shape) to the cell', () => {
    renderCell(makeRow({ type: 'array', value: [1, 2, 3] as unknown as string }))
    expect(screen.getByTestId('mock-cell')).toHaveAttribute('data-value', '[1,2,3]')
    expect(screen.getByTestId('mock-cell')).toHaveAttribute('data-type', 'array')
  })

  it('round-trips a complex edit back to the row STRUCTURED (verbatim backend shape)', () => {
    const { onRowsChange } = renderCell(makeRow({ type: 'array', value: '[1,2,3]' }))
    fireEvent.click(screen.getByTestId('cell-change-array'))
    expect(storedValue(onRowsChange)).toEqual([9])
  })

  it('round-trips a scalar edit back to the row as exact text', () => {
    const { onRowsChange } = renderCell(makeRow({ type: 'integer', value: '7' }))
    fireEvent.click(screen.getByTestId('cell-change-scalar'))
    expect(storedValue(onRowsChange)).toBe('42')
  })

  it('round-trips a boolean edit as a real boolean', () => {
    const { onRowsChange } = renderCell(makeRow({ type: 'boolean', value: 'false' }))
    fireEvent.click(screen.getByTestId('cell-change-bool'))
    expect(storedValue(onRowsChange)).toBe(true)
  })

  it('round-trips a map edit STRUCTURED', () => {
    const { onRowsChange } = renderCell(makeRow({ type: 'map', value: '{}' }))
    fireEvent.click(screen.getByTestId('cell-change-map'))
    expect(storedValue(onRowsChange)).toEqual({ k: 'v' })
  })

  it('clears the value to an empty string on secret clear', () => {
    const { onRowsChange } = renderCell(makeRow({ type: 'string', secret: true, value: 'x' }))
    fireEvent.click(screen.getByTestId('cell-clear'))
    expect(storedValue(onRowsChange)).toBe('')
  })

  // Mask write-only ONLY when the stored value is the masked placeholder
  // (the shared-variable read path) - a value typed this session or revealed as
  // plaintext (shared unmask on) is not the stored form, so it stays visible.
  it('masks write-only for a stored (masked-placeholder) secret value', () => {
    renderCell(makeRow({ type: 'string', secret: true, value: '********' }))
    expect(screen.getByTestId('mock-cell')).toHaveAttribute('data-secret', 'true')
  })

  it('does NOT mask a freshly typed (non-stored) secret value', () => {
    renderCell(makeRow({ type: 'string', secret: true, value: 'just-typed' }))
    expect(screen.getByTestId('mock-cell')).toHaveAttribute('data-secret', 'false')
  })

  it('does NOT mask a revealed plaintext secret value (shared unmask on)', () => {
    renderCell(makeRow({ type: 'string', secret: true, value: 'revealed-plaintext' }))
    expect(screen.getByTestId('mock-cell')).toHaveAttribute('data-secret', 'false')
  })

  it('updates only the target row, leaving siblings untouched', () => {
    const target = makeRow({ id: 'r1', type: 'array', value: '[]' })
    const other = makeRow({ id: 'r2', name: 'keep', value: 'stay' })
    const onRowsChange = vi.fn()
    render(
      <EntityVariableValueCell row={target} rows={[target, other]} onRowsChange={onRowsChange} />,
    )
    fireEvent.click(screen.getByTestId('cell-change-array'))
    const next = onRowsChange.mock.calls.at(-1)?.[0] as VariableRow[]
    expect(next.find((r) => r.id === 'r1')?.value).toEqual([9])
    expect(next.find((r) => r.id === 'r2')?.value).toBe('stay')
  })
})

describe('EntityVariableValueCell - element types (REQ-3.1.3.19)', () => {
  it('hands the row\'s element types to the cell', () => {
    renderCell(makeRow({ type: 'map', value: '{"n":"16"}', elementTypes: { n: 'integer' } }))
    expect(screen.getByTestId('mock-cell')).toHaveAttribute('data-element-types', '{"n":"integer"}')
  })

  it('stores the element types a sheet save reports beside the value', () => {
    const { onRowsChange } = renderCell(makeRow({ type: 'map', value: '{}' }))
    fireEvent.click(screen.getByTestId('cell-change-typed-map'))
    const [row] = onRowsChange.mock.calls.at(-1)?.[0] as VariableRow[]
    expect(row.elementTypes).toEqual({ n: 'integer' })
  })

  it('keeps the row\'s element types when a save reports none', () => {
    const { onRowsChange } = renderCell(makeRow({ type: 'map', value: '{}', elementTypes: { k: 'string' } }))
    fireEvent.click(screen.getByTestId('cell-change-map'))
    const [row] = onRowsChange.mock.calls.at(-1)?.[0] as VariableRow[]
    expect(row.elementTypes).toEqual({ k: 'string' })
  })
})

// ---------------------------------------------------------------------------
// The real shared cell behind the entity edge (REQ-3.1.3.20, VMGR-93, VMGR-95)
// ---------------------------------------------------------------------------

const ALL_TYPES: VariableType[] = ['string', 'integer', 'float', 'boolean', 'array', 'map', 'table']
const NULL_VALUE = null as unknown as string
const NO_SELECTION = new Set<string>()
const noop = () => {}
const saveNoop = async () => {}

/** The suite / regression / system Edit Variables dialog with the entity cell injected, as the pages wire it. */
function EditVariablesHost({ initial }: Readonly<{ initial: VariableRow[] }>) {
  const [rows, setRows] = useState(initial)
  return (
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
      onChange={setRows}
      selectedIds={NO_SELECTION}
      onSelectionChange={noop}
      onBulkDuplicate={noop}
      onBulkDelete={noop}
      renderValueCell={(row) => (
        <EntityVariableValueCell row={row} rows={rows} onRowsChange={setRows} />
      )}
    />
  )
}

describe('EntityVariableValueCell - a stored null', () => {
  beforeEach(() => {
    sharedCell.real = true
  })

  afterEach(() => {
    sharedCell.real = false
  })

  it.each(ALL_TYPES)('shows the null chip for a stored null %s, named after the variable', (type) => {
    renderCell(makeRow({ name: 'timeout', type, value: NULL_VALUE }))
    expect(screen.getByRole('button', { name: 'timeout (null)' })).toHaveTextContent(/^null$/)
  })

  it('shows the null chip for a variable with no value', () => {
    const { value: _omitted, ...noValue } = makeRow({ name: 'timeout', type: 'integer' })
    renderCell(noValue as VariableRow)
    expect(screen.getByRole('button', { name: 'timeout (null)' })).toHaveTextContent(/^null$/)
  })

  it('shows the hint "Click to enter a value" when the chip gets keyboard focus', async () => {
    const user = userEvent.setup()
    renderCell(makeRow({ name: 'timeout', type: 'integer', value: NULL_VALUE }))

    await user.tab()

    expect(screen.getByRole('button', { name: 'timeout (null)' })).toHaveFocus()
    expect(await screen.findByRole('tooltip')).toHaveTextContent(/^Click to enter a value$/)
  })

  it.each([
    ['string', ''],
    ['integer', '0'],
    ['float', '0'],
    ['boolean', false],
    ['array', []],
    ['map', {}],
    ['table', []],
  ] as const)('stores the %s type default in stored form when the chip is clicked', (type, expected) => {
    const { onRowsChange } = renderCell(makeRow({ name: 'timeout', type, value: NULL_VALUE }))
    fireEvent.click(screen.getByRole('button', { name: 'timeout (null)' }))
    expect(storedValue(onRowsChange)).toStrictEqual(expected)
  })

  it.each([
    ['Enter', '{Enter}'],
    ['Space', ' '],
  ])('stores the type default when the focused chip gets %s', async (_key, keys) => {
    const user = userEvent.setup()
    const { onRowsChange } = renderCell(makeRow({ name: 'timeout', type: 'integer', value: NULL_VALUE }))

    await user.tab()
    expect(screen.getByRole('button', { name: 'timeout (null)' })).toHaveFocus()
    await user.keyboard(keys)

    expect(storedValue(onRowsChange)).toBe('0')
  })

  it('shows a string holding the text "null" as an ordinary value, never the null chip', () => {
    renderCell(makeRow({ name: 'label', type: 'string', value: 'null' }))
    expect(screen.queryByRole('button', { name: 'label (null)' })).not.toBeInTheDocument()
    expect(screen.getByTestId('entity-var-edit-r1')).toHaveTextContent(/^"null"$/)
  })

  it('keeps Save open for a stored null', () => {
    render(<EditVariablesHost initial={[makeRow({ name: 'timeout', type: 'integer', value: NULL_VALUE })]} />)
    expect(screen.getByTestId('edit-dialog-save')).toBeEnabled()
  })
})

describe('EntityVariableValueCell - an emptied number box (VMGR-95)', () => {
  beforeEach(() => {
    sharedCell.real = true
  })

  afterEach(() => {
    sharedCell.real = false
  })

  it.each([
    ['integer', '7', 'Must be an integer'],
    ['float', '2.5', 'Must be a number'],
  ] as const)('an emptied %s box shows its message and blocks Save', (type, stored, message) => {
    render(<EditVariablesHost initial={[makeRow({ name: 'timeout', type, value: stored })]} />)
    expect(screen.getByTestId('edit-dialog-save')).toBeEnabled()

    fireEvent.change(screen.getByTestId('scalar-edit-input'), { target: { value: '' } })

    expect(screen.getByText(message)).toBeInTheDocument()
    expect(screen.getByTestId('edit-dialog-save')).toBeDisabled()
  })
})

describe('EntityVariableValueCell - unfinished number text (REQ-3.1.3.14)', () => {
  beforeEach(() => {
    sharedCell.real = true
  })

  afterEach(() => {
    sharedCell.real = false
  })

  it.each([
    ['integer', '7', '-', 'Enter a valid integer value'],
    ['float', '2.5', '2.', 'Enter a valid float value'],
  ] as const)('an unfinished %s box names it and blocks Save', (type, stored, typed, message) => {
    render(<EditVariablesHost initial={[makeRow({ name: 'timeout', type, value: stored })]} />)

    fireEvent.change(screen.getByTestId('scalar-edit-input'), { target: { value: typed } })

    expect(screen.getByRole('alert')).toHaveTextContent(message)
    expect(screen.getByTestId('scalar-edit-input')).toHaveValue(typed)
    expect(screen.getByTestId('edit-dialog-save')).toBeDisabled()
  })

  it('names a stored integer past 19 digits and blocks Save', () => {
    render(
      <EditVariablesHost initial={[makeRow({ name: 'id', type: 'integer', value: '12345678901234567890' })]} />,
    )
    expect(screen.getByRole('alert')).toHaveTextContent('Maximum 19 digits')
    expect(screen.getByTestId('edit-dialog-save')).toBeDisabled()
  })
})

describe('EntityVariableValueCell - the value message reaches a screen reader', () => {
  beforeEach(() => {
    sharedCell.real = true
  })

  afterEach(() => {
    sharedCell.real = false
  })

  it('announces an emptied number box message and links it to the box', () => {
    render(<EditVariablesHost initial={[makeRow({ name: 'timeout', type: 'integer', value: '7' })]} />)
    const box = screen.getByTestId('scalar-edit-input')

    fireEvent.change(box, { target: { value: '' } })

    const message = screen.getByRole('alert')
    expect(message).toHaveTextContent(/^Must be an integer$/)
    expect(box).toHaveAttribute('aria-describedby', message.id)
  })
})
