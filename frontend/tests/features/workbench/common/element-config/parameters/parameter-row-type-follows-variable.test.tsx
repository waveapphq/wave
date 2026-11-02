/**
 * ParameterRow - a selectableType row follows the variable it binds.
 *
 * The For Each collection row pairs a variableRef picker with a type selector.
 * With nothing explicitly chosen, the selector follows the bound variable's type; an
 * explicit choice still wins, and expression mode - where there is no bound
 * variable - keeps the defaulted selector.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('@/features/workbench/common/element-config/parameters/variable-ref-combobox', () => ({
  VariableRefCombobox: (props: {
    value: string
    onChange: (value: string) => void
    allowedTypes: string[]
    availableVariables: Array<{ name: string; type: string }>
  }) => (
    <div
      data-testid="mock-variable-ref-combobox"
      data-value={props.value}
      data-allowed-types={JSON.stringify(props.allowedTypes)}
    >
      {['orders_table', 'users_list', 'config_map', 'made_up_name'].map((name) => (
        <button key={name} data-testid={`pick-${name}`} onClick={() => props.onChange(name)}>
          {name}
        </button>
      ))}
    </div>
  ),
}))

vi.mock('@/features/workbench/common/variables/variable-inspect-modal/value-editor-sheet', () => ({
  ValueEditorSheet: () => null,
}))

import { ParameterRow } from '@/features/workbench/common/element-config/parameters/parameter-row'

const collectionParam = {
  name: 'collection',
  label: 'Collection',
  type: 'array' as const,
  required: true,
  description: 'Variable to iterate over',
  variableRef: { types: ['array', 'map', 'table'] },
  selectableType: { options: ['array', 'map', 'table'] },
}

/** Same row without the type selector - must be untouched by the follow rule. */
const plainVariableRefParam = {
  name: 'collection',
  label: 'Collection',
  type: 'array' as const,
  required: true,
  description: 'Variable to iterate over',
  variableRef: { types: ['array', 'map', 'table'] },
}

const defaultRowProps = {
  mode: 'input' as const,
  onChange: vi.fn(),
  onTypeChange: vi.fn(),
  availableVariables: [
    { name: 'orders_table', type: 'table' },
    { name: 'users_list', type: 'array' },
    { name: 'config_map', type: 'map' },
  ],
  expressionFields: [] as string[],
  onExpressionFieldsChange: vi.fn(),
  templateFields: [] as string[],
  onTemplateFieldsChange: vi.fn(),
}

function renderRow(props: React.ComponentProps<typeof ParameterRow>) {
  return render(
    <table>
      <tbody>
        <ParameterRow {...props} />
      </tbody>
    </table>,
  )
}

describe('selected type follows the bound variable', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('shows the bound table variable type instead of the defaulted first option', () => {
    renderRow({
      ...defaultRowProps,
      parameter: collectionParam,
      value: 'orders_table',
      allValues: { collection: 'orders_table' },
    })

    expect(screen.getByTestId('type-select-collection').textContent).toContain('table')
  })

  it('shows the bound map variable type', () => {
    renderRow({
      ...defaultRowProps,
      parameter: collectionParam,
      value: 'config_map',
      allValues: { collection: 'config_map' },
    })

    expect(screen.getByTestId('type-select-collection').textContent).toContain('map')
  })

  it('reports no type mismatch for a bound table variable', () => {
    renderRow({
      ...defaultRowProps,
      parameter: collectionParam,
      value: 'orders_table',
      allValues: { collection: 'orders_table' },
    })

    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('does not report the mismatch through onValidationChange either', () => {
    const onValidationChange = vi.fn()
    renderRow({
      ...defaultRowProps,
      parameter: collectionParam,
      value: 'orders_table',
      allValues: { collection: 'orders_table' },
      onValidationChange,
    })

    expect(onValidationChange).toHaveBeenCalledWith('collection', null)
  })

  it('filters the variable picker to the followed type', () => {
    renderRow({
      ...defaultRowProps,
      parameter: collectionParam,
      value: 'orders_table',
      allValues: { collection: 'orders_table' },
    })

    expect(screen.getByTestId('mock-variable-ref-combobox')).toHaveAttribute(
      'data-allowed-types',
      JSON.stringify(['table']),
    )
  })

  it('keeps the defaulted first option when nothing is bound', () => {
    renderRow({
      ...defaultRowProps,
      parameter: collectionParam,
      value: '',
      allValues: {},
    })

    expect(screen.getByTestId('type-select-collection').textContent).toContain('array')
  })

  it('keeps the defaulted first option for a name that is not a known variable', () => {
    renderRow({
      ...defaultRowProps,
      parameter: collectionParam,
      value: 'made_up_name',
      allValues: { collection: 'made_up_name' },
    })

    expect(screen.getByTestId('type-select-collection').textContent).toContain('array')
  })
})

describe('an explicit choice still wins', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('shows the stored type over the bound variable type', () => {
    renderRow({
      ...defaultRowProps,
      parameter: collectionParam,
      value: 'orders_table',
      allValues: { collection: 'orders_table', collection_type: 'map' },
    })

    expect(screen.getByTestId('type-select-collection').textContent).toContain('map')
  })

  it('still reports a mismatch when the user pins a contradicting type', () => {
    renderRow({
      ...defaultRowProps,
      parameter: collectionParam,
      value: 'orders_table',
      allValues: { collection: 'orders_table', collection_type: 'array' },
    })

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Variable "orders_table" is type table, expected array',
    )
  })

  it('leaves the selector interactive', async () => {
    const user = userEvent.setup()
    const onTypeChange = vi.fn()
    renderRow({
      ...defaultRowProps,
      parameter: collectionParam,
      value: 'orders_table',
      allValues: { collection: 'orders_table' },
      onTypeChange,
    })

    await user.click(screen.getByTestId('type-select-collection'))
    await user.click(await screen.findByRole('option', { name: 'map' }))

    expect(onTypeChange).toHaveBeenCalledWith('map')
  })
})

describe('rows the follow rule must not touch', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('leaves a variableRef row without a type selector alone', () => {
    renderRow({
      ...defaultRowProps,
      parameter: plainVariableRefParam,
      value: 'orders_table',
      allValues: { collection: 'orders_table' },
      onTypeChange: undefined,
    })

    expect(screen.queryByTestId('type-select-collection')).not.toBeInTheDocument()
    expect(screen.getByTestId('mock-variable-ref-combobox')).toHaveAttribute(
      'data-allowed-types',
      JSON.stringify(['array', 'map', 'table']),
    )
  })

  it('keeps the defaulted selector in expression mode', () => {
    renderRow({
      ...defaultRowProps,
      parameter: collectionParam,
      value: 'orders_table',
      allValues: { collection: 'orders_table' },
      expressionFields: ['collection'],
    })

    expect(screen.getByTestId('type-select-collection').textContent).toContain('array')
  })

  it('binding a variable still stores the binding itself', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    renderRow({
      ...defaultRowProps,
      parameter: collectionParam,
      value: '',
      allValues: {},
      onChange,
    })

    await user.click(screen.getByTestId('pick-orders_table'))

    expect(onChange).toHaveBeenCalledWith('orders_table')
  })
})
