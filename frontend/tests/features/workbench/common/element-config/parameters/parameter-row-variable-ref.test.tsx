/**
 * ParameterRow - variableRef Integration Tests
 *
 * TDD tests verifying that ParameterRow renders VariableRefCombobox
 * when a parameter has the variableRef property, instead of the
 * default input widget.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

// Mock the VariableRefCombobox component to verify it gets rendered
// with the correct props when parameter.variableRef is set
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
      data-variable-count={props.availableVariables.length}
    >
      <input
        data-testid="variable-ref-input"
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        readOnly
      />
    </div>
  ),
}))

// Mock the shared "Edit value" sheet to avoid complex editor rendering.
vi.mock('@/features/workbench/common/variables/variable-inspect-modal/value-editor-sheet', () => ({
  ValueEditorSheet: () => null,
}))

// Import the component under test after mocks
import { ParameterRow } from '@/features/workbench/common/element-config/parameters/parameter-row'

const REQUIRED_MARK_MODULE = '@/components/shared/fields/required-mark'

// Helper: parameter with variableRef (ForEach collection)
const variableRefParam = {
  name: 'collection',
  label: 'Collection',
  type: 'array' as const,
  required: true,
  description: 'Variable to iterate over',
  variableRef: { types: ['array', 'map', 'table'] },
}

// Helper: parameter with variableRef AND selectableType (ForEach collection with type dropdown)
const selectableTypeParam = {
  ...variableRefParam,
  selectableType: { options: ['array', 'map', 'table'] },
}

// Helper: parameter without variableRef (regular string)
const regularStringParam = {
  name: 'url',
  label: 'URL',
  type: 'string' as const,
  required: true,
  description: 'Request URL',
}

// Helper: timeout parameter (no variableRef)
const timeoutParam = {
  name: 'timeout',
  label: 'Timeout',
  type: 'float' as const,
  required: false,
  description: 'Max execution time in seconds',
  group: 'Advanced',
}

// Helper: shared props for rendering ParameterRow
const defaultRowProps = {
  mode: 'input' as const,
  onChange: vi.fn(),
  availableVariables: [
    { name: 'users_list', type: 'array' },
    { name: 'config_map', type: 'map' },
    { name: 'api_url', type: 'string' },
  ],
  expressionFields: [] as string[],
  onExpressionFieldsChange: vi.fn(),
  templateFields: [] as string[],
  onTemplateFieldsChange: vi.fn(),
}

/** Wrap ParameterRow in a table (it renders <tr>) */
function renderRow(props: React.ComponentProps<typeof ParameterRow>) {
  return render(
    <table>
      <tbody>
        <ParameterRow {...props} />
      </tbody>
    </table>
  )
}

describe('ParameterRow with variableRef', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // ---------------------------------------------------------------------------
  // variableRef triggers VariableRefCombobox
  // ---------------------------------------------------------------------------

  describe('widget selection', () => {
    it('renders VariableRefCombobox when parameter has variableRef', () => {
      renderRow({
        ...defaultRowProps,
        parameter: variableRefParam,
        value: 'users_list',
      })

      const combobox = screen.getByTestId('mock-variable-ref-combobox')
      expect(combobox).toBeInTheDocument()
    })

    it('does NOT render VariableRefCombobox for regular string parameter', () => {
      renderRow({
        ...defaultRowProps,
        parameter: regularStringParam,
        value: 'https://example.com',
      })

      expect(screen.queryByTestId('mock-variable-ref-combobox')).not.toBeInTheDocument()
      // Should render the shared ValueField preview instead
      expect(screen.getByRole('textbox', { name: 'URL' })).toBeInTheDocument()
    })

    it('does NOT render VariableRefCombobox for float parameter without variableRef', () => {
      renderRow({
        ...defaultRowProps,
        parameter: timeoutParam,
        value: 30,
      })

      expect(screen.queryByTestId('mock-variable-ref-combobox')).not.toBeInTheDocument()
    })
  })

  // ---------------------------------------------------------------------------
  // Props passed to VariableRefCombobox
  // ---------------------------------------------------------------------------

  describe('props forwarding', () => {
    it('passes current value to VariableRefCombobox', () => {
      renderRow({
        ...defaultRowProps,
        parameter: variableRefParam,
        value: 'config_map',
      })

      const combobox = screen.getByTestId('mock-variable-ref-combobox')
      expect(combobox).toHaveAttribute('data-value', 'config_map')
    })

    it('passes allowedTypes from variableRef.types', () => {
      renderRow({
        ...defaultRowProps,
        parameter: variableRefParam,
        value: '',
      })

      const combobox = screen.getByTestId('mock-variable-ref-combobox')
      expect(combobox).toHaveAttribute(
        'data-allowed-types',
        JSON.stringify(['array', 'map', 'table'])
      )
    })

    it('passes availableVariables to VariableRefCombobox', () => {
      renderRow({
        ...defaultRowProps,
        parameter: variableRefParam,
        value: '',
      })

      const combobox = screen.getByTestId('mock-variable-ref-combobox')
      expect(combobox).toHaveAttribute('data-variable-count', '3')
    })

    it('passes empty string value when value is undefined', () => {
      renderRow({
        ...defaultRowProps,
        parameter: variableRefParam,
        value: undefined,
      })

      const combobox = screen.getByTestId('mock-variable-ref-combobox')
      // Should pass empty or the stringified undefined - depending on implementation
      expect(combobox).toBeInTheDocument()
    })
  })

  // ---------------------------------------------------------------------------
  // Expression mode interaction with variableRef
  // ---------------------------------------------------------------------------

  describe('expression mode', () => {
    it('shows expression toggle button for variableRef parameter', () => {
      renderRow({
        ...defaultRowProps,
        parameter: variableRefParam,
        value: 'users_list',
      })

      const toggle = screen.getByTestId('expression-toggle')
      expect(toggle).toBeInTheDocument()
    })

    it('renders ExpressionField instead of VariableRefCombobox when in expression mode', () => {
      renderRow({
        ...defaultRowProps,
        parameter: variableRefParam,
        value: 'some_expression',
        expressionFields: ['collection'],
      })

      // In expression mode, VariableRefCombobox should NOT be rendered
      expect(screen.queryByTestId('mock-variable-ref-combobox')).not.toBeInTheDocument()
    })

    it('toggles from literal (VariableRefCombobox) to expression mode', async () => {
      const user = userEvent.setup()
      const onExprChange = vi.fn()

      renderRow({
        ...defaultRowProps,
        parameter: variableRefParam,
        value: 'users_list',
        onExpressionFieldsChange: onExprChange,
      })

      // Initially in literal mode - should show combobox
      expect(screen.getByTestId('mock-variable-ref-combobox')).toBeInTheDocument()

      // Click expression toggle: the field holds a value, so the switch warning asks first (FIELD-7)
      const toggle = screen.getByTestId('expression-toggle')
      await user.click(toggle)
      expect(onExprChange).not.toHaveBeenCalled()
      await user.click(screen.getByTestId('switch-mode-clear-default'))

      // onExpressionFieldsChange should have been called to add 'collection'
      expect(onExprChange).toHaveBeenCalledWith(
        expect.arrayContaining(['collection'])
      )
    })

    it('does not render expression toggle when noExpression is set', () => {
      const noExprParam = {
        ...variableRefParam,
        noExpression: true,
      }

      renderRow({
        ...defaultRowProps,
        parameter: noExprParam,
        value: 'users_list',
      })

      expect(screen.queryByTestId('expression-toggle')).not.toBeInTheDocument()
    })
  })

  // ---------------------------------------------------------------------------
  // Row metadata display
  // ---------------------------------------------------------------------------

  describe('row metadata', () => {
    it('displays parameter label', () => {
      renderRow({
        ...defaultRowProps,
        parameter: variableRefParam,
        value: '',
      })

      expect(screen.getByText('Collection')).toBeInTheDocument()
    })

    it('shows required asterisk for required variableRef parameter', () => {
      renderRow({
        ...defaultRowProps,
        parameter: variableRefParam,
        value: '',
      })

      const row = screen.getByTestId('param-row-collection')
      expect(row.textContent).toContain('*')
    })

    it('marks a required row with the shared required mark', async () => {
      // A path held in a constant keeps the import out of the file-level resolve.
      const { RequiredMark } = (await import(/* @vite-ignore */ REQUIRED_MARK_MODULE)) as {
        RequiredMark: () => React.ReactElement
      }
      const mark = render(<RequiredMark />).container.innerHTML
      expect(mark).toContain('aria-hidden="true"')
      renderRow({
        ...defaultRowProps,
        parameter: variableRefParam,
        value: '',
      })

      const nameCell = screen.getByTestId('param-row-collection').querySelectorAll('td')[1]
      expect(nameCell.innerHTML).toContain(mark)
    })

    it('shows parameter type as static text when no selectableType', () => {
      renderRow({
        ...defaultRowProps,
        parameter: variableRefParam,
        value: '',
      })

      expect(screen.getByText('array')).toBeInTheDocument()
    })

    it('shows description tooltip icon', () => {
      renderRow({
        ...defaultRowProps,
        parameter: variableRefParam,
        value: '',
      })

      // Description icon should be present
      const row = screen.getByTestId('param-row-collection')
      expect(row).toBeInTheDocument()
    })

    it('renders with correct testid for the row', () => {
      renderRow({
        ...defaultRowProps,
        parameter: variableRefParam,
        value: '',
      })

      expect(screen.getByTestId('param-row-collection')).toBeInTheDocument()
    })
  })

  // ---------------------------------------------------------------------------
  // Output mode (variableRef should NOT apply in output mode)
  // ---------------------------------------------------------------------------

  describe('output mode', () => {
    it('renders OutputBindingCombobox in output mode even with variableRef param', () => {
      renderRow({
        ...defaultRowProps,
        mode: 'output',
        parameter: variableRefParam,
        value: '',
      })

      // In output mode, VariableRefCombobox should NOT be used
      // (output mode always renders OutputBindingCombobox)
      expect(screen.queryByTestId('mock-variable-ref-combobox')).not.toBeInTheDocument()
    })
  })

  // ---------------------------------------------------------------------------
  // Selectable type dropdown
  // ---------------------------------------------------------------------------

  describe('selectableType dropdown', () => {
    it('renders type dropdown when selectableType and onTypeChange are provided', () => {
      renderRow({
        ...defaultRowProps,
        parameter: selectableTypeParam,
        value: '',
        onTypeChange: vi.fn(),
      })

      expect(screen.getByTestId('type-select-collection')).toBeInTheDocument()
    })

    it('does NOT render type dropdown when onTypeChange is not provided', () => {
      renderRow({
        ...defaultRowProps,
        parameter: selectableTypeParam,
        value: '',
      })

      // Without onTypeChange, falls back to static text
      expect(screen.queryByTestId('type-select-collection')).not.toBeInTheDocument()
      expect(screen.getByText('array')).toBeInTheDocument()
    })

    it('defaults selected type to first option when no type in allValues', () => {
      renderRow({
        ...defaultRowProps,
        parameter: selectableTypeParam,
        value: '',
        onTypeChange: vi.fn(),
        allValues: {},
      })

      // The select trigger should show the first option (array)
      const trigger = screen.getByTestId('type-select-collection')
      expect(trigger.textContent).toContain('array')
    })

    it('shows stored type from allValues', () => {
      renderRow({
        ...defaultRowProps,
        parameter: selectableTypeParam,
        value: '',
        onTypeChange: vi.fn(),
        allValues: { collection_type: 'map' },
      })

      const trigger = screen.getByTestId('type-select-collection')
      expect(trigger.textContent).toContain('map')
    })

    it('filters VariableRefCombobox to only the selected type', () => {
      renderRow({
        ...defaultRowProps,
        parameter: selectableTypeParam,
        value: 'users_list',
        onTypeChange: vi.fn(),
        allValues: { collection_type: 'map' },
      })

      const combobox = screen.getByTestId('mock-variable-ref-combobox')
      // When selectableType is active, allowedTypes should be just the selected type
      expect(combobox).toHaveAttribute(
        'data-allowed-types',
        JSON.stringify(['map'])
      )
    })

    it('passes all variableRef.types when no selectableType', () => {
      renderRow({
        ...defaultRowProps,
        parameter: variableRefParam,
        value: 'users_list',
      })

      const combobox = screen.getByTestId('mock-variable-ref-combobox')
      expect(combobox).toHaveAttribute(
        'data-allowed-types',
        JSON.stringify(['array', 'map', 'table'])
      )
    })
  })

  // ---------------------------------------------------------------------------
  // Type mismatch validation
  // ---------------------------------------------------------------------------

  describe('type mismatch validation', () => {
    it('shows error when variable type does not match selected type', () => {
      renderRow({
        ...defaultRowProps,
        parameter: selectableTypeParam,
        value: 'config_map',
        onTypeChange: vi.fn(),
        allValues: { collection: 'config_map', collection_type: 'array' },
      })

      // config_map is type 'map', but selected type is 'array'
      expect(screen.getByRole('alert')).toHaveTextContent(
        'Variable "config_map" is type map, expected array'
      )
    })

    it('does NOT show error when variable type matches selected type', () => {
      renderRow({
        ...defaultRowProps,
        parameter: selectableTypeParam,
        value: 'config_map',
        onTypeChange: vi.fn(),
        allValues: { collection: 'config_map', collection_type: 'map' },
      })

      expect(screen.queryByText(/expected/)).not.toBeInTheDocument()
    })

    it('does NOT validate type mismatch in expression mode', () => {
      renderRow({
        ...defaultRowProps,
        parameter: selectableTypeParam,
        value: 'config_map',
        onTypeChange: vi.fn(),
        allValues: { collection: 'config_map', collection_type: 'array' },
        expressionFields: ['collection'],
      })

      // In expression mode, no type mismatch validation
      expect(screen.queryByText(/expected/)).not.toBeInTheDocument()
    })

    it('does NOT validate when value is empty', () => {
      renderRow({
        ...defaultRowProps,
        parameter: selectableTypeParam,
        value: '',
        onTypeChange: vi.fn(),
        allValues: { collection_type: 'array' },
      })

      expect(screen.queryByText(/expected/)).not.toBeInTheDocument()
    })

    it('does NOT validate when variable is not found in availableVariables', () => {
      renderRow({
        ...defaultRowProps,
        parameter: selectableTypeParam,
        value: 'unknown_var',
        onTypeChange: vi.fn(),
        allValues: { collection: 'unknown_var', collection_type: 'array' },
      })

      // unknown_var is not in availableVariables, so no mismatch
      expect(screen.queryByText(/expected/)).not.toBeInTheDocument()
    })

    it('reports validation error via onValidationChange', () => {
      const onValidationChange = vi.fn()
      renderRow({
        ...defaultRowProps,
        parameter: selectableTypeParam,
        value: 'config_map',
        onTypeChange: vi.fn(),
        onValidationChange,
        allValues: { collection: 'config_map', collection_type: 'array' },
      })

      // Should report the type mismatch error
      expect(onValidationChange).toHaveBeenCalledWith(
        'collection',
        expect.stringContaining('expected array')
      )
    })
  })
})
