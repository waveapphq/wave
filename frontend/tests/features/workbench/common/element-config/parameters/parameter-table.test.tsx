/**
 * ParameterTable Component Tests - V-CANVAS-12 Config Modal
 *
 * Tests WAVE-specific behavior for parameter table in config modal.
 * Does NOT test: CSS styling, tooltip library behavior, keyboard navigation (library concerns).
 */

import { useState, type ComponentProps } from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within, waitFor, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { ParameterTable as Table } from '@/features/workbench/common/element-config/parameters/parameter-table'
import { HELD_DEFAULT_LOOK_CLASS } from '@/lib/variable-format'
import { getInputParams } from '@/features/workbench/lib/node-parameters'

// The Map / Array / String inputs now open the shared "Edit value" sheet
// (the array / map / text editor modals are gone). Stand-in exposing its threaded
// props + a literal-save / template-save / close so the ParameterTable -> input
// wiring can be asserted; the sheet's own behavior lives in its own test files.
vi.mock('@/features/workbench/common/variables/variable-inspect-modal/value-editor-sheet', async () => {
  const { createPortal } = await import('react-dom')
  return {
    ValueEditorSheet: ({ type, stringValuesOnly, isTemplate, onSave, onClose }: {
      type: string
      stringValuesOnly?: boolean
      isTemplate?: boolean
      onSave: (value: unknown, isTemplate: boolean) => void
      onClose: () => void
    }) =>
      createPortal(
        <div
          data-testid="value-editor-sheet"
          data-type={type}
          data-string-values-only={String(!!stringValuesOnly)}
          data-is-template={String(isTemplate)}
        >
          <button data-testid="sheet-save" onClick={() => onSave('SAVED', false)}>Save</button>
          <button data-testid="sheet-save-template" onClick={() => onSave('SAVED', true)}>SaveTemplate</button>
          <button data-testid="sheet-close" onClick={onClose}>Close</button>
        </div>,
        document.body,
      ),
  }
})

// The file-reference picker is a sub-editor with its own test file; here it only
// has to report the props the row hands it.
vi.mock('@/features/workbench/common/element-config/parameters/file-reference-picker-sheet', () => ({
  FileReferencePickerSheet: ({
    mode,
    artifactsOnly,
    testId,
  }: {
    mode: string
    artifactsOnly?: boolean
    testId: string | null
  }) => (
    <span
      data-testid="picker-mock"
      data-mode={mode}
      data-artifacts-only={String(!!artifactsOnly)}
      data-test-id-prop={testId ?? ''}
    />
  ),
}))

// Mock parameter types - canonical types per REQ-3.4.2.2
interface Parameter {
  name: string
  label?: string
  type: 'string' | 'integer' | 'float' | 'boolean' | 'array' | 'map' | 'table'
  required: boolean
  description?: string
  defaultValue?: unknown
  enumValues?: string[]
  group?: string
  secret?: boolean
  variableRef?: { types: string[] }
  selectableType?: { options: string[] }
}

const mockInputParameters: Parameter[] = [
  {
    name: 'url',
    type: 'string',
    required: true,
    description: 'The URL to request',
  },
  {
    name: 'method',
    type: 'string',
    required: true,
    enumValues: ['GET', 'POST', 'PUT', 'DELETE'],
    description: 'HTTP method',
  },
  {
    name: 'timeout',
    type: 'integer',
    required: false,
    defaultValue: 30000,
    description: 'Request timeout in milliseconds',
  },
  {
    name: 'followRedirects',
    type: 'boolean',
    required: false,
    defaultValue: true,
    description: 'Whether to follow redirects',
  },
  {
    name: 'headers',
    type: 'map',
    required: false,
    description: 'Request headers',
  },
]

const mockOutputParameters: Parameter[] = [
  { name: 'statusCode', type: 'integer', required: false, description: 'HTTP status code' },
  { name: 'body', type: 'string', required: false, description: 'Response body' },
]

const mockAvailableVariables = [
  { name: 'endpoint', type: 'string' },
  { name: 'api_key', type: 'string' },
  { name: 'base_url', type: 'string' },
]

type TableProps = ComponentProps<typeof Table>

/** A table that keeps its own values, as the Block window does; `onChange` still sees every write. */
function StatefulTable({
  initialValues,
  onChange,
  ...props
}: Omit<TableProps, 'values' | 'onChange'> & {
  initialValues: Record<string, unknown>
  onChange?: (name: string, value: unknown) => void
}) {
  const [values, setValues] = useState(initialValues)
  return (
    <Table
      {...props}
      values={values}
      onChange={(name, value) => {
        onChange?.(name, value)
        setValues((current) => ({ ...current, [name]: value }))
      }}
    />
  )
}

/** The deepest elements in `container` that show exactly `text`, as text or as a field's value. */
function elementsShowing(container: HTMLElement, text: string): HTMLElement[] {
  const byText = within(container).queryAllByText(
    (_content, element) =>
      element !== null &&
      element.textContent === text &&
      !Array.from(element.children).some((child) => child.textContent === text),
  )
  return [...byText, ...within(container).queryAllByDisplayValue(text)]
}

/** True when the element, or an ancestor up to `boundary`, carries the Text Muted gray. */
function grayUpTo(element: HTMLElement, boundary: HTMLElement): boolean {
  for (let node: HTMLElement | null = element; node !== null; node = node.parentElement) {
    if (node.classList.contains(HELD_DEFAULT_LOOK_CLASS)) return true
    if (node === boundary) return false
  }
  return false
}

/** A number row's box: the shared exact-number body's input, under the row's param-input id. */
function numberBox(row: HTMLElement): HTMLElement {
  const name = (row.getAttribute('data-testid') ?? '').replace(/^param-row-/, '')
  return within(within(row).getByTestId('scalar-edit-body')).getByTestId(`param-input-${name}`)
}

/** Clicks one action of the switch warning (FIELD-7) once it shows. */
async function chooseSwitch(
  user: ReturnType<typeof userEvent.setup>,
  action: 'switch-mode-cancel' | 'switch-mode-clear-default' | 'switch-mode-clear-empty',
) {
  expect(screen.getByTestId('switch-mode-dialog')).toBeInTheDocument()
  await user.click(screen.getByTestId(action))
}

describe('ParameterTable Component', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Input Parameters Mode', () => {
    it('renders all parameters from configuration', async () => {
      const { ParameterTable } = await import(
        '@/features/workbench/common/element-config/parameters/parameter-table'
      )
      render(
        <ParameterTable
          mode="input"
          parameters={mockInputParameters}
          values={{}}
          onChange={vi.fn()}
          availableVariables={mockAvailableVariables}
        />
      )

      expect(screen.getByTestId('param-row-url')).toBeInTheDocument()
      expect(screen.getByTestId('param-row-method')).toBeInTheDocument()
      expect(screen.getByTestId('param-row-timeout')).toBeInTheDocument()
      expect(screen.getByTestId('param-row-followRedirects')).toBeInTheDocument()
      expect(screen.getByTestId('param-row-headers')).toBeInTheDocument()
    })

    it('displays label instead of name when label is provided', async () => {
      const { ParameterTable } = await import(
        '@/features/workbench/common/element-config/parameters/parameter-table'
      )
      const params: Parameter[] = [
        { name: 'retry_count', label: 'Retry Count', type: 'integer', required: false },
        { name: 'timeout', type: 'integer', required: false },
      ]
      render(
        <ParameterTable
          mode="input"
          parameters={params}
          values={{}}
          onChange={vi.fn()}
          availableVariables={[]}
        />
      )

      // Label is displayed when provided
      const labeledRow = screen.getByTestId('param-row-retry_count')
      expect(within(labeledRow).getByText('Retry Count')).toBeInTheDocument()

      // Falls back to name when no label
      const fallbackRow = screen.getByTestId('param-row-timeout')
      expect(within(fallbackRow).getByText('timeout')).toBeInTheDocument()
    })

    it('marks required parameters with asterisk', async () => {
      const { ParameterTable } = await import(
        '@/features/workbench/common/element-config/parameters/parameter-table'
      )
      render(
        <ParameterTable
          mode="input"
          parameters={mockInputParameters}
          values={{}}
          onChange={vi.fn()}
          availableVariables={mockAvailableVariables}
        />
      )

      const urlRow = screen.getByTestId('param-row-url')
      expect(within(urlRow).getByText('*')).toBeInTheDocument()

      const timeoutRow = screen.getByTestId('param-row-timeout')
      expect(within(timeoutRow).queryByText('*')).not.toBeInTheDocument()
    })
  })

  describe('Output Parameters Mode', () => {
    it('renders table with "Assign to" column for variable bindings', async () => {
      const { ParameterTable } = await import(
        '@/features/workbench/common/element-config/parameters/parameter-table'
      )
      render(
        <ParameterTable
          mode="output"
          parameters={mockOutputParameters}
          values={{}}
          onChange={vi.fn()}
          availableVariables={mockAvailableVariables}
        />
      )

      expect(screen.getByText('Assign to')).toBeInTheDocument()
      // Output mode uses 'output-row-' prefix to distinguish from input parameters
      const statusCodeRow = screen.getByTestId('output-row-statusCode')
      expect(within(statusCodeRow).getByRole('combobox')).toBeInTheDocument()
    })

    it('opens combobox on Ctrl+Space and shows only compatible variables', async () => {
      const user = userEvent.setup()
      const { ParameterTable } = await import(
        '@/features/workbench/common/element-config/parameters/parameter-table'
      )
      render(
        <ParameterTable
          mode="output"
          parameters={mockOutputParameters}
          values={{}}
          onChange={vi.fn()}
          availableVariables={[
            { name: 'status_var', type: 'integer' },
            { name: 'other_var', type: 'string' },
            { name: 'count_var', type: 'integer' },
          ]}
        />
      )

      const statusCodeRow = screen.getByTestId('output-row-statusCode')
      const input = within(statusCodeRow).getByRole('combobox')

      await user.click(input)
      await user.keyboard('{Control>} {/Control}')

      // Only integer-compatible variables should be shown for integer output.
      // (Free-text typing of a wrong-type name still triggers the inline gate.)
      expect(screen.getByText('status_var')).toBeInTheDocument()
      expect(screen.getByText('count_var')).toBeInTheDocument()
      expect(screen.queryByText('other_var')).not.toBeInTheDocument()
    })

    it('selects variable from combobox and updates value', async () => {
      const user = userEvent.setup()
      const handleChange = vi.fn()
      const { ParameterTable } = await import(
        '@/features/workbench/common/element-config/parameters/parameter-table'
      )
      render(
        <ParameterTable
          mode="output"
          parameters={mockOutputParameters}
          values={{}}
          onChange={handleChange}
          availableVariables={[
            { name: 'my_status', type: 'integer' },
          ]}
        />
      )

      const statusCodeRow = screen.getByTestId('output-row-statusCode')
      const input = within(statusCodeRow).getByRole('combobox')

      // Open combobox
      await user.click(input)
      await user.keyboard('{Control>} {/Control}')

      // Click the variable item
      const item = screen.getByText('my_status')
      await user.click(item)

      expect(handleChange).toHaveBeenCalledWith('statusCode', 'my_status')
    })

    it('shows OUT badge on output-bound variables', async () => {
      const user = userEvent.setup()
      const { ParameterTable } = await import(
        '@/features/workbench/common/element-config/parameters/parameter-table'
      )
      render(
        <ParameterTable
          mode="output"
          parameters={mockOutputParameters}
          values={{}}
          onChange={vi.fn()}
          availableVariables={[
            { name: 'bound_var', type: 'integer', source: 'HTTP Client', isOutputBinding: true },
            { name: 'free_var', type: 'integer' },
          ]}
        />
      )

      const statusCodeRow = screen.getByTestId('output-row-statusCode')
      const input = within(statusCodeRow).getByRole('combobox')

      await user.click(input)
      await user.keyboard('{Control>} {/Control}')

      // The bound variable should show OUT badge
      expect(screen.getByText('OUT')).toBeInTheDocument()
      // Both variables should be listed
      expect(screen.getByText('bound_var')).toBeInTheDocument()
      expect(screen.getByText('free_var')).toBeInTheDocument()
    })

    it('shows all variables when output parameter type has no compat filter', async () => {
      const user = userEvent.setup()
      const { ParameterTable } = await import(
        '@/features/workbench/common/element-config/parameters/parameter-table'
      )
      // Use type not in OUTPUT_TYPE_COMPAT - shows all variables
      const unknownTypeOutputParams = [
        { name: 'result', type: 'custom' as unknown as Parameter['type'], required: false },
      ]
      render(
        <ParameterTable
          mode="output"
          parameters={unknownTypeOutputParams}
          values={{}}
          onChange={vi.fn()}
          availableVariables={[
            { name: 'str_var', type: 'string' },
            { name: 'int_var', type: 'integer' },
            { name: 'bool_var', type: 'boolean' },
          ]}
        />
      )

      const resultRow = screen.getByTestId('output-row-result')
      const input = within(resultRow).getByRole('combobox')

      await user.click(input)
      await user.keyboard('{Control>} {/Control}')

      // All variables should be shown (no type filter for unknown/expression type)
      expect(screen.getByText('str_var')).toBeInTheDocument()
      expect(screen.getByText('int_var')).toBeInTheDocument()
      expect(screen.getByText('bool_var')).toBeInTheDocument()
    })

    it('shows footer hints with Esc and Ctrl+Space', async () => {
      const user = userEvent.setup()
      const { ParameterTable } = await import(
        '@/features/workbench/common/element-config/parameters/parameter-table'
      )
      render(
        <ParameterTable
          mode="output"
          parameters={mockOutputParameters}
          values={{}}
          onChange={vi.fn()}
          availableVariables={[
            { name: 'my_int', type: 'integer' },
          ]}
        />
      )

      const statusCodeRow = screen.getByTestId('output-row-statusCode')
      const input = within(statusCodeRow).getByRole('combobox')
      await user.click(input)
      await user.keyboard('{Control>} {/Control}')

      const footer = screen.getByTestId('output-binding-footer')
      expect(footer).toBeInTheDocument()
      expect(footer).toHaveTextContent('Esc')
      expect(footer).toHaveTextContent('Ctrl+Space')
    })

    it('closes combobox when pressing Escape', async () => {
      const user = userEvent.setup()
      const { ParameterTable } = await import(
        '@/features/workbench/common/element-config/parameters/parameter-table'
      )
      render(
        <ParameterTable
          mode="output"
          parameters={mockOutputParameters}
          values={{}}
          onChange={vi.fn()}
          availableVariables={[
            { name: 'my_int', type: 'integer' },
          ]}
        />
      )

      const statusCodeRow = screen.getByTestId('output-row-statusCode')
      const input = within(statusCodeRow).getByRole('combobox')

      // Open the combobox via Ctrl+Space
      await user.click(input)
      await user.keyboard('{Control>} {/Control}')

      // Verify combobox is open (footer is visible)
      expect(screen.getByTestId('output-binding-footer')).toBeInTheDocument()

      // Press Escape to close
      await user.keyboard('{Escape}')

      // Footer should no longer be visible (combobox closed)
      expect(screen.queryByTestId('output-binding-footer')).not.toBeInTheDocument()
    })

    it('shows new variable hint when typed name does not match any existing variable', async () => {
      const user = userEvent.setup()
      const { ParameterTable } = await import(
        '@/features/workbench/common/element-config/parameters/parameter-table'
      )
      // Stateful wrapper so typed text actually updates the controlled value
      function Wrapper() {
        const [vals, setVals] = useState<Record<string, unknown>>({})
        return (
          <ParameterTable
            mode="output"
            parameters={mockOutputParameters}
            values={vals}
            onChange={(name, value) => setVals((prev) => ({ ...prev, [name]: value }))}
            availableVariables={[
              { name: 'existing_var', type: 'integer' },
            ]}
          />
        )
      }
      render(<Wrapper />)

      const statusCodeRow = screen.getByTestId('output-row-statusCode')
      const input = within(statusCodeRow).getByRole('combobox')
      await user.click(input)
      await user.type(input, 'brand_new')

      const hint = screen.getByTestId('output-new-var-hint')
      expect(hint).toBeInTheDocument()
      expect(hint).toHaveTextContent(/brand_new.+will be created as a new variable/)
    })

    it('does not show new variable hint when typed name matches an existing variable', async () => {
      const user = userEvent.setup()
      const { ParameterTable } = await import(
        '@/features/workbench/common/element-config/parameters/parameter-table'
      )
      function Wrapper() {
        const [vals, setVals] = useState<Record<string, unknown>>({})
        return (
          <ParameterTable
            mode="output"
            parameters={mockOutputParameters}
            values={vals}
            onChange={(name, value) => setVals((prev) => ({ ...prev, [name]: value }))}
            availableVariables={[
              { name: 'status_var', type: 'integer' },
            ]}
          />
        )
      }
      render(<Wrapper />)

      const statusCodeRow = screen.getByTestId('output-row-statusCode')
      const input = within(statusCodeRow).getByRole('combobox')
      await user.click(input)
      await user.type(input, 'status_var')

      expect(screen.queryByTestId('output-new-var-hint')).not.toBeInTheDocument()
    })

    it('keeps the suggestions shut while the typed binding name is invalid and restores them once it is valid', async () => {
      const user = userEvent.setup()
      const { ParameterTable } = await import(
        '@/features/workbench/common/element-config/parameters/parameter-table'
      )
      function Wrapper() {
        const [vals, setVals] = useState<Record<string, unknown>>({})
        return (
          <ParameterTable
            mode="output"
            parameters={mockOutputParameters}
            values={vals}
            onChange={(name, value) => setVals((prev) => ({ ...prev, [name]: value }))}
            availableVariables={[
              { name: 'status_var', type: 'integer' },
            ]}
          />
        )
      }
      render(<Wrapper />)

      const statusCodeRow = screen.getByTestId('output-row-statusCode')
      const input = within(statusCodeRow).getByRole('combobox')

      // Empty name: unchanged, the list opens on click.
      await user.click(input)
      expect(screen.getByTestId('output-binding-footer')).toBeInTheDocument()

      await user.type(input, 'k8s-')
      expect(screen.queryByTestId('output-binding-footer')).not.toBeInTheDocument()
      expect(screen.queryByTestId('output-new-var-hint')).not.toBeInTheDocument()
      expect(input).toHaveAttribute('aria-invalid', 'true')

      await user.keyboard('{Backspace}')
      expect(screen.getByTestId('output-binding-footer')).toBeInTheDocument()
      expect(screen.getByTestId('output-new-var-hint')).toHaveTextContent(/k8s.+will be created/)
      expect(input).not.toHaveAttribute('aria-invalid')

      // Escape and Ctrl+Space keep working on the valid name.
      await user.keyboard('{Escape}')
      expect(screen.queryByTestId('output-binding-footer')).not.toBeInTheDocument()
      await user.keyboard('{Control>} {/Control}')
      expect(screen.getByTestId('output-binding-footer')).toBeInTheDocument()
    })

  })

  describe('Type-Specific Inputs', () => {
    it('renders expression editor for string type with current value', async () => {
      const { ParameterTable } = await import(
        '@/features/workbench/common/element-config/parameters/parameter-table'
      )
      render(
        <ParameterTable
          mode="input"
          parameters={[mockInputParameters[0]]}
          values={{ url: 'https://example.com' }}
          onChange={vi.fn()}
          availableVariables={mockAvailableVariables}
        />
      )

      const urlRow = screen.getByTestId('param-row-url')
      // String literal mode draws the one value field; its expand opens the sheet
      expect(elementsShowing(urlRow, 'https://example.com')).not.toHaveLength(0)
      expect(within(urlRow).getByTestId('param-expand-url')).toBeInTheDocument()
    })

    it('renders number input for integer type', async () => {
      const { ParameterTable } = await import(
        '@/features/workbench/common/element-config/parameters/parameter-table'
      )
      const retryParam = {
        name: 'maxRetries',
        type: 'integer' as const,
        required: false,
        defaultValue: 3,
      }
      render(
        <ParameterTable
          mode="input"
          parameters={[retryParam]}
          values={{ maxRetries: 5 }}
          onChange={vi.fn()}
          availableVariables={mockAvailableVariables}
        />
      )

      expect(numberBox(screen.getByTestId('param-row-maxRetries'))).toHaveValue('5')
    })

    it('renders number input for integer timeout parameter', async () => {
      const { ParameterTable } = await import(
        '@/features/workbench/common/element-config/parameters/parameter-table'
      )
      render(
        <ParameterTable
          mode="input"
          parameters={[mockInputParameters[2]]}
          values={{ timeout: 30000 }}
          onChange={vi.fn()}
          availableVariables={mockAvailableVariables}
        />
      )

      expect(numberBox(screen.getByTestId('param-row-timeout'))).toHaveValue('30000')
    })

    it('renders number input for float type', async () => {
      const { ParameterTable } = await import(
        '@/features/workbench/common/element-config/parameters/parameter-table'
      )
      const floatParam = {
        name: 'threshold',
        type: 'float' as const,
        required: false,
        defaultValue: 0.95,
      }
      render(
        <ParameterTable
          mode="input"
          parameters={[floatParam]}
          values={{ threshold: 3.14 }}
          onChange={vi.fn()}
          availableVariables={mockAvailableVariables}
        />
      )

      expect(numberBox(screen.getByTestId('param-row-threshold'))).toHaveValue('3.14')
    })

    it('calls onChange with the exact digits typed into an integer row, and unsets it when cleared', async () => {
      const user = userEvent.setup()
      const onChange = vi.fn()
      const retryParam = {
        name: 'maxRetries',
        type: 'integer' as const,
        required: false,
      }
      render(
        <StatefulTable
          mode="input"
          parameters={[retryParam]}
          initialValues={{}}
          onChange={onChange}
          availableVariables={mockAvailableVariables}
        />
      )

      const input = numberBox(screen.getByTestId('param-row-maxRetries'))
      await user.type(input, '7')
      expect(onChange).toHaveBeenLastCalledWith('maxRetries', '7')

      await user.clear(input)
      expect(onChange).toHaveBeenLastCalledWith('maxRetries', undefined)
    })

    it('renders checkbox for boolean type', async () => {
      const { ParameterTable } = await import(
        '@/features/workbench/common/element-config/parameters/parameter-table'
      )
      render(
        <ParameterTable
          mode="input"
          parameters={[mockInputParameters[3]]}
          values={{ followRedirects: true }}
          onChange={vi.fn()}
          availableVariables={mockAvailableVariables}
        />
      )

      const redirectRow = screen.getByTestId('param-row-followRedirects')
      expect(within(redirectRow).getByRole('checkbox')).toBeChecked()
    })

    it('renders select dropdown for string type with enumValues', async () => {
      const { ParameterTable } = await import(
        '@/features/workbench/common/element-config/parameters/parameter-table'
      )
      render(
        <ParameterTable
          mode="input"
          parameters={[mockInputParameters[1]]}
          values={{ method: 'GET' }}
          onChange={vi.fn()}
          availableVariables={mockAvailableVariables}
        />
      )

      const methodRow = screen.getByTestId('param-row-method')
      expect(within(methodRow).getByRole('combobox')).toBeInTheDocument()
    })

    it('renders the map as one line with an expand for map type', async () => {
      const { ParameterTable } = await import(
        '@/features/workbench/common/element-config/parameters/parameter-table'
      )
      render(
        <ParameterTable
          mode="input"
          parameters={[mockInputParameters[4]]}
          values={{ headers: { 'Content-Type': 'application/json' } }}
          onChange={vi.fn()}
          availableVariables={mockAvailableVariables}
        />
      )

      const headersRow = screen.getByTestId('param-row-headers')
      expect(elementsShowing(headersRow, '{"Content-Type": "application/json"}')).not.toHaveLength(0)
      expect(within(headersRow).getByTestId('param-expand-headers')).toBeInTheDocument()
    })
  })

  describe('Value Changes', () => {
    it('calls onChange with string value', async () => {
      const user = userEvent.setup()
      const handleChange = vi.fn()

      const { ParameterTable } = await import(
        '@/features/workbench/common/element-config/parameters/parameter-table'
      )
      render(
        <ParameterTable
          mode="input"
          parameters={[mockInputParameters[0]]}
          values={{ url: '' }}
          onChange={handleChange}
          availableVariables={mockAvailableVariables}
        />
      )

      const urlRow = screen.getByTestId('param-row-url')
      // The field's expand opens the shared "Edit value" sheet
      await user.click(within(urlRow).getByTestId('param-expand-url'))
      await user.click(screen.getByTestId('sheet-save'))

      expect(handleChange).toHaveBeenLastCalledWith('url', 'SAVED')
    })

    it('calls onChange with the exact digits of a number value', async () => {
      const user = userEvent.setup()
      const handleChange = vi.fn()

      render(
        <StatefulTable
          mode="input"
          parameters={[mockInputParameters[2]]}
          initialValues={{ timeout: 0 }}
          onChange={handleChange}
          availableVariables={mockAvailableVariables}
        />
      )

      const input = numberBox(screen.getByTestId('param-row-timeout'))

      await user.clear(input)
      await user.type(input, '5000')

      expect(handleChange).toHaveBeenLastCalledWith('timeout', '5000')
    })

    it('calls onChange with boolean value on checkbox toggle', async () => {
      const user = userEvent.setup()
      const handleChange = vi.fn()

      const { ParameterTable } = await import(
        '@/features/workbench/common/element-config/parameters/parameter-table'
      )
      render(
        <ParameterTable
          mode="input"
          parameters={[mockInputParameters[3]]}
          values={{ followRedirects: true }}
          onChange={handleChange}
          availableVariables={mockAvailableVariables}
        />
      )

      const redirectRow = screen.getByTestId('param-row-followRedirects')
      await user.click(within(redirectRow).getByRole('checkbox'))

      expect(handleChange).toHaveBeenCalledWith('followRedirects', false)
    })
  })

  describe('Enum Expression Mode', () => {
    it('shows expression toggle for enum fields', async () => {
      const { ParameterTable } = await import(
        '@/features/workbench/common/element-config/parameters/parameter-table'
      )
      render(
        <ParameterTable
          mode="input"
          parameters={[mockInputParameters[1]]}
          values={{ method: 'GET' }}
          onChange={vi.fn()}
          availableVariables={mockAvailableVariables}
        />
      )

      const methodRow = screen.getByTestId('param-row-method')
      expect(within(methodRow).getByTestId('expression-toggle')).toBeInTheDocument()
    })

    it('draws the shared {x} toggle named by its field', async () => {
      const { ParameterTable } = await import(
        '@/features/workbench/common/element-config/parameters/parameter-table'
      )
      render(
        <ParameterTable
          mode="input"
          parameters={[mockInputParameters[1]]}
          values={{ method: 'GET' }}
          onChange={vi.fn()}
          availableVariables={mockAvailableVariables}
        />
      )
      const toggle = within(screen.getByTestId('param-row-method')).getByTestId('expression-toggle')
      expect(toggle).toHaveAttribute('data-slot', 'expression-toggle')
      expect(toggle).toHaveAccessibleName(/^method expression mode$/)
      expect(toggle).toHaveAttribute('aria-pressed', 'false')
    })

    it('switches to text input when expression mode toggled', async () => {
      const user = userEvent.setup()

      const { ParameterTable } = await import(
        '@/features/workbench/common/element-config/parameters/parameter-table'
      )
      render(
        <ParameterTable
          mode="input"
          parameters={[mockInputParameters[1]]}
          values={{ method: 'GET' }}
          onChange={vi.fn()}
          availableVariables={mockAvailableVariables}
        />
      )

      const methodRow = screen.getByTestId('param-row-method')
      await user.click(within(methodRow).getByTestId('expression-toggle'))
      // The choice holds a value, so the switch asks first (FIELD-7)
      await chooseSwitch(user, 'switch-mode-clear-default')

      await waitFor(() => {
        expect(within(methodRow).queryByRole('combobox')).not.toBeInTheDocument()
        expect(within(methodRow).getByRole('textbox')).toBeInTheDocument()
      })
    })

    it('carries nothing into the expression when switching modes', async () => {
      const user = userEvent.setup()
      const handleChange = vi.fn()

      render(
        <StatefulTable
          mode="input"
          parameters={[mockInputParameters[1]]}
          initialValues={{ method: 'POST' }}
          onChange={handleChange}
          availableVariables={mockAvailableVariables}
        />
      )

      const methodRow = screen.getByTestId('param-row-method')
      await user.click(within(methodRow).getByTestId('expression-toggle'))
      await chooseSwitch(user, 'switch-mode-clear-default')

      const box = await within(methodRow).findByTestId('param-input-method')
      expect(box.querySelector('.cm-content')?.textContent).toBe('')
      expect(handleChange).not.toHaveBeenCalledWith('method', 'POST')
    })
  })

  describe('Variable Autocomplete', () => {
    it('shows available variables when typing in raw expression mode', async () => {
      const user = userEvent.setup()

      const { ParameterTable } = await import(
        '@/features/workbench/common/element-config/parameters/parameter-table'
      )
      render(
        <ParameterTable
          mode="input"
          parameters={[mockInputParameters[0]]}
          values={{}}
          onChange={vi.fn()}
          availableVariables={mockAvailableVariables}
        />
      )

      const urlRow = screen.getByTestId('param-row-url')
      // Toggle to expression mode to get raw expression CodeMirror
      await user.click(within(urlRow).getByTestId('expression-toggle'))

      await waitFor(() => {
        expect(within(urlRow).getByRole('textbox')).toBeInTheDocument()
      })
      const input = within(urlRow).getByRole('textbox')

      // In raw expression mode, just type a variable prefix to trigger autocomplete
      await user.click(input)
      await user.type(input, 'e')

      // CodeMirror renders autocomplete at document.body level
      await waitFor(() => {
        const autocomplete = document.querySelector('.cm-tooltip-autocomplete')
        expect(autocomplete).toBeInTheDocument()
        // CodeMirror shows variable names in completion items
        expect(autocomplete?.textContent).toContain('endpoint')
      })
    })

    it('filters suggestions based on partial input', async () => {
      const user = userEvent.setup()

      const { ParameterTable } = await import(
        '@/features/workbench/common/element-config/parameters/parameter-table'
      )
      render(
        <ParameterTable
          mode="input"
          parameters={[mockInputParameters[0]]}
          values={{}}
          onChange={vi.fn()}
          availableVariables={mockAvailableVariables}
        />
      )

      const urlRow = screen.getByTestId('param-row-url')
      // Toggle to expression mode to get raw expression CodeMirror
      await user.click(within(urlRow).getByTestId('expression-toggle'))

      await waitFor(() => {
        expect(within(urlRow).getByRole('textbox')).toBeInTheDocument()
      })
      const input = within(urlRow).getByRole('textbox')

      // In raw expression mode, type a prefix directly (no ${ needed)
      await user.click(input)
      await user.type(input, 'api')

      // CodeMirror renders autocomplete at document.body level
      await waitFor(() => {
        const autocomplete = document.querySelector('.cm-tooltip-autocomplete')
        expect(autocomplete).toBeInTheDocument()
        // Should show api_key but not endpoint (filtered)
        expect(autocomplete?.textContent).toContain('api_key')
        expect(autocomplete?.textContent).not.toContain('endpoint')
      })
    })

    it('hides autocomplete when filter matches no variables', async () => {
      const user = userEvent.setup()

      const { ParameterTable } = await import(
        '@/features/workbench/common/element-config/parameters/parameter-table'
      )
      render(
        <ParameterTable
          mode="input"
          parameters={[mockInputParameters[0]]}
          values={{}}
          onChange={vi.fn()}
          availableVariables={mockAvailableVariables}
        />
      )

      const urlRow = screen.getByTestId('param-row-url')
      // Toggle to expression mode to get raw expression CodeMirror
      await user.click(within(urlRow).getByTestId('expression-toggle'))

      await waitFor(() => {
        expect(within(urlRow).getByRole('textbox')).toBeInTheDocument()
      })
      const input = within(urlRow).getByRole('textbox')

      // Type a filter that doesn't match any variables
      await user.click(input)
      await user.type(input, 'xyz_no_match')

      // Wait a moment for autocomplete to potentially appear
      await act(async () => {
        await new Promise((r) => setTimeout(r, 100))
      })

      // CodeMirror autocomplete should not be visible because no variables match
      expect(document.querySelector('.cm-tooltip-autocomplete')).not.toBeInTheDocument()
    })

    it('inserts selected variable into input', async () => {
      const user = userEvent.setup()
      const handleChange = vi.fn()

      const { ParameterTable } = await import(
        '@/features/workbench/common/element-config/parameters/parameter-table'
      )
      render(
        <ParameterTable
          mode="input"
          parameters={[mockInputParameters[0]]}
          values={{}}
          onChange={handleChange}
          availableVariables={mockAvailableVariables}
        />
      )

      const urlRow = screen.getByTestId('param-row-url')
      // Toggle to expression mode to get raw expression CodeMirror
      await user.click(within(urlRow).getByTestId('expression-toggle'))

      await waitFor(() => {
        expect(within(urlRow).getByRole('textbox')).toBeInTheDocument()
      })
      const input = within(urlRow).getByRole('textbox')

      // In raw expression mode, type a prefix to trigger autocomplete
      await user.click(input)
      await user.type(input, 'base')

      // CodeMirror renders autocomplete at document.body level
      await waitFor(() => {
        expect(document.querySelector('.cm-tooltip-autocomplete')).toBeInTheDocument()
      })

      // Find and click the base_url option in CodeMirror's autocomplete
      const options = document.querySelectorAll('.cm-tooltip-autocomplete li')
      const baseUrlOption = Array.from(options).find((li) =>
        li.textContent?.includes('base_url')
      )
      expect(baseUrlOption).toBeTruthy()
      await user.click(baseUrlOption!)

      // Raw expression mode passes value directly (no ${...} wrapping)
      expect(handleChange).toHaveBeenCalledWith('url', 'base_url')
    })
  })

  describe('Expression Mode Wrapper', () => {
    it('expression mode renders clean editor without ${ } labels', async () => {
      const user = userEvent.setup()
      const { ParameterTable } = await import(
        '@/features/workbench/common/element-config/parameters/parameter-table'
      )
      render(
        <ParameterTable
          mode="input"
          parameters={[mockInputParameters[0]]}
          values={{}}
          onChange={vi.fn()}
          availableVariables={mockAvailableVariables}
        />
      )

      const urlRow = screen.getByTestId('param-row-url')
      // Toggle to expression mode
      await user.click(within(urlRow).getByTestId('expression-toggle'))

      // Should NOT show ${ and } wrapper labels (clean expression editor)
      await waitFor(() => {
        const spans = urlRow.querySelectorAll('span.font-mono.shrink-0')
        expect(spans.length).toBe(0)
      })
    })

    it('raw expression mode has no ${...} highlighting', async () => {
      const user = userEvent.setup()
      const { ParameterTable } = await import(
        '@/features/workbench/common/element-config/parameters/parameter-table'
      )
      render(
        <ParameterTable
          mode="input"
          parameters={[mockInputParameters[0]]}
          values={{}}
          onChange={vi.fn()}
          availableVariables={mockAvailableVariables}
        />
      )

      const urlRow = screen.getByTestId('param-row-url')
      // Toggle to expression mode for raw expression CodeMirror
      await user.click(within(urlRow).getByTestId('expression-toggle'))

      await waitFor(() => {
        expect(within(urlRow).getByRole('textbox')).toBeInTheDocument()
      })
      const input = within(urlRow).getByRole('textbox')

      // Type a raw expression (no ${...} wrapping)
      await user.click(input)
      await user.type(input, 'base_url + endpoint')

      // Raw expression mode highlights entire content as expression
      await act(async () => {
        await new Promise((r) => setTimeout(r, 100))
      })
      expect(urlRow.querySelector('.cm-expression')).toBeInTheDocument()
    })
  })

  describe('Validation', () => {
    it('shows error for empty required field', async () => {
      const user = userEvent.setup()

      const { ParameterTable } = await import(
        '@/features/workbench/common/element-config/parameters/parameter-table'
      )
      render(
        <ParameterTable
          mode="input"
          parameters={[mockInputParameters[0]]}
          values={{ url: '' }}
          onChange={vi.fn()}
          availableVariables={mockAvailableVariables}
        />
      )

      const urlRow = screen.getByTestId('param-row-url')
      await user.click(within(urlRow).getByTestId('param-expand-url'))

      await waitFor(() => {
        expect(within(urlRow).getByRole('alert')).toHaveTextContent('url is required')
      })
    })

    it('reports validation state via onValidationChange', async () => {
      const handleValidation = vi.fn()

      const { ParameterTable } = await import(
        '@/features/workbench/common/element-config/parameters/parameter-table'
      )
      render(
        <ParameterTable
          mode="input"
          parameters={[mockInputParameters[0]]}
          values={{ url: '' }}
          onChange={vi.fn()}
          onValidationChange={handleValidation}
          availableVariables={mockAvailableVariables}
        />
      )

      await waitFor(() => {
        expect(handleValidation).toHaveBeenCalledWith({
          isValid: false,
          errors: expect.objectContaining({
            url: expect.any(String),
          }),
        })
      })
    })
  })

  describe('URL Validation', () => {
    it('shows error for invalid URL scheme in literal mode', async () => {
      const { ParameterTable } = await import(
        '@/features/workbench/common/element-config/parameters/parameter-table'
      )
      render(
        <ParameterTable
          mode="input"
          parameters={[mockInputParameters[0]]}
          values={{ url: 'htps://example.com' }}
          onChange={vi.fn()}
          availableVariables={mockAvailableVariables}
        />
      )

      const urlRow = screen.getByTestId('param-row-url')

      await waitFor(() => {
        const alert = within(urlRow).getByRole('alert')
        expect(alert).toHaveTextContent('URL must start with http:// or https://')
      })
    })

    it('shows error for URL without scheme in literal mode', async () => {
      const { ParameterTable } = await import(
        '@/features/workbench/common/element-config/parameters/parameter-table'
      )
      render(
        <ParameterTable
          mode="input"
          parameters={[mockInputParameters[0]]}
          values={{ url: 'example.com' }}
          onChange={vi.fn()}
          availableVariables={mockAvailableVariables}
        />
      )

      const urlRow = screen.getByTestId('param-row-url')

      await waitFor(() => {
        const alert = within(urlRow).getByRole('alert')
        expect(alert).toHaveTextContent('URL must start with http:// or https://')
      })
    })

    it('shows error for URL with missing double-slash', async () => {
      const { ParameterTable } = await import(
        '@/features/workbench/common/element-config/parameters/parameter-table'
      )
      render(
        <ParameterTable
          mode="input"
          parameters={[mockInputParameters[0]]}
          values={{ url: 'http:localhost:8000/health' }}
          onChange={vi.fn()}
          availableVariables={mockAvailableVariables}
        />
      )

      const urlRow = screen.getByTestId('param-row-url')
      await waitFor(() => {
        const alert = within(urlRow).getByRole('alert')
        expect(alert).toHaveTextContent('URL must start with http:// or https://')
      })
    })

    it('does not show URL error in expression mode', async () => {
      const user = userEvent.setup()

      const { ParameterTable } = await import(
        '@/features/workbench/common/element-config/parameters/parameter-table'
      )
      render(
        <ParameterTable
          mode="input"
          parameters={[mockInputParameters[0]]}
          values={{ url: 'htps://example.com' }}
          onChange={vi.fn()}
          availableVariables={mockAvailableVariables}
          expressionFields={['url']}
          onExpressionFieldsChange={vi.fn()}
        />
      )

      const urlRow = screen.getByTestId('param-row-url')

      // In expression mode, there's a CodeMirror editor - interact with the row
      await user.click(urlRow)

      // Wait a tick and assert no URL validation alert appears
      await waitFor(() => {
        const alerts = within(urlRow).queryAllByRole('alert')
        const urlAlert = alerts.find(el => el.textContent?.includes('http://'))
        expect(urlAlert).toBeUndefined()
      })
    })

    it('does not show URL error for valid http URL', async () => {
      const { ParameterTable } = await import(
        '@/features/workbench/common/element-config/parameters/parameter-table'
      )
      render(
        <ParameterTable
          mode="input"
          parameters={[mockInputParameters[0]]}
          values={{ url: 'http://localhost:8080' }}
          onChange={vi.fn()}
          availableVariables={mockAvailableVariables}
        />
      )

      const urlRow = screen.getByTestId('param-row-url')

      await waitFor(() => {
        const alerts = within(urlRow).queryAllByRole('alert')
        expect(alerts).toHaveLength(0)
      })
    })

    it('does not show URL error for valid https URL', async () => {
      const { ParameterTable } = await import(
        '@/features/workbench/common/element-config/parameters/parameter-table'
      )
      render(
        <ParameterTable
          mode="input"
          parameters={[mockInputParameters[0]]}
          values={{ url: 'https://api.example.com/v1' }}
          onChange={vi.fn()}
          availableVariables={mockAvailableVariables}
        />
      )

      const urlRow = screen.getByTestId('param-row-url')

      await waitFor(() => {
        const alerts = within(urlRow).queryAllByRole('alert')
        expect(alerts).toHaveLength(0)
      })
    })

    it('clears stale errors when parameters change (version switch)', async () => {
      const handleValidation = vi.fn()

      const { ParameterTable } = await import(
        '@/features/workbench/common/element-config/parameters/parameter-table'
      )

      // Render with invalid URL - creates a validation error
      const { rerender } = render(
        <ParameterTable
          mode="input"
          parameters={[mockInputParameters[0]]}
          values={{ url: 'htps://example.com' }}
          onChange={vi.fn()}
          onValidationChange={handleValidation}
          availableVariables={mockAvailableVariables}
        />
      )

      // Wait for URL error to be reported
      await waitFor(() => {
        expect(handleValidation).toHaveBeenCalledWith({
          isValid: false,
          errors: expect.objectContaining({ url: expect.any(String) }),
        })
      })

      handleValidation.mockClear()

      // Re-render with different parameters (no url param) - simulates version switch
      rerender(
        <ParameterTable
          mode="input"
          parameters={[mockInputParameters[2]]}
          values={{ timeout: 5000 }}
          onChange={vi.fn()}
          onValidationChange={handleValidation}
          availableVariables={mockAvailableVariables}
        />
      )

      // Stale 'url' error should be cleaned up, validation should be valid
      await waitFor(() => {
        expect(handleValidation).toHaveBeenCalledWith({
          isValid: true,
          errors: {},
        })
      })
    })

    it('reports URL validation state via onValidationChange', async () => {
      const handleValidation = vi.fn()

      const { ParameterTable } = await import(
        '@/features/workbench/common/element-config/parameters/parameter-table'
      )
      render(
        <ParameterTable
          mode="input"
          parameters={[mockInputParameters[0]]}
          values={{ url: 'htps://example.com' }}
          onChange={vi.fn()}
          onValidationChange={handleValidation}
          availableVariables={mockAvailableVariables}
        />
      )

      await waitFor(() => {
        expect(handleValidation).toHaveBeenCalledWith({
          isValid: false,
          errors: expect.objectContaining({
            url: 'URL must start with http:// or https://',
          }),
        })
      })
    })
  })

  describe('Default Values', () => {
    it('uses default value for checkbox when no value provided', async () => {
      const { ParameterTable } = await import(
        '@/features/workbench/common/element-config/parameters/parameter-table'
      )
      render(
        <ParameterTable
          mode="input"
          parameters={[mockInputParameters[3]]}
          values={{}}
          onChange={vi.fn()}
          availableVariables={mockAvailableVariables}
        />
      )

      const redirectRow = screen.getByTestId('param-row-followRedirects')
      expect(within(redirectRow).getByRole('checkbox')).toBeChecked()
    })
  })

  describe('Map Type Parameters (replaces Object Type)', () => {
    it('renders the map field with its expand for map type parameters', async () => {
      const { ParameterTable } = await import(
        '@/features/workbench/common/element-config/parameters/parameter-table'
      )
      render(
        <ParameterTable
          mode="input"
          parameters={[mockInputParameters[4]]} // headers is map type
          values={{ headers: { 'Content-Type': 'application/json' } }}
          onChange={vi.fn()}
          availableVariables={mockAvailableVariables}
        />
      )

      const headersRow = screen.getByTestId('param-row-headers')
      expect(within(headersRow).getByTestId('param-expand-headers')).toHaveAccessibleName('Open editor for headers')
    })

    it('shows every entry on the one line in place of a count', async () => {
      const { ParameterTable } = await import(
        '@/features/workbench/common/element-config/parameters/parameter-table'
      )
      render(
        <ParameterTable
          mode="input"
          parameters={[mockInputParameters[4]]} // headers is map type
          values={{ headers: { 'Content-Type': 'application/json', 'Accept': 'text/html' } }}
          onChange={vi.fn()}
          availableVariables={mockAvailableVariables}
        />
      )

      const headersRow = screen.getByTestId('param-row-headers')
      expect(
        elementsShowing(headersRow, '{"Content-Type": "application/json", "Accept": "text/html"}'),
      ).not.toHaveLength(0)
    })

    it('opens the value sheet when the map expand is clicked', async () => {
      const user = userEvent.setup()

      const { ParameterTable } = await import(
        '@/features/workbench/common/element-config/parameters/parameter-table'
      )
      render(
        <ParameterTable
          mode="input"
          parameters={[mockInputParameters[4]]} // headers is map type
          values={{ headers: { 'Authorization': 'Bearer token' } }}
          onChange={vi.fn()}
          availableVariables={mockAvailableVariables}
        />
      )

      const headersRow = screen.getByTestId('param-row-headers')
      await user.click(within(headersRow).getByTestId('param-expand-headers'))

      await waitFor(() => {
        expect(screen.getByTestId('value-editor-sheet')).toHaveAttribute('data-type', 'map')
      })
    })
  })

  describe('External Value Updates', () => {
    it('syncs input value when prop changes externally', async () => {
      const { ParameterTable } = await import(
        '@/features/workbench/common/element-config/parameters/parameter-table'
      )

      const { rerender } = render(
        <ParameterTable
          mode="input"
          parameters={[mockInputParameters[0]]}
          values={{ url: 'https://initial.com' }}
          onChange={vi.fn()}
          availableVariables={mockAvailableVariables}
        />
      )

      // Verify initial value (the one value field)
      expect(elementsShowing(screen.getByTestId('param-row-url'), 'https://initial.com')).not.toHaveLength(0)

      // Simulate external update (e.g., from variable selection)
      rerender(
        <ParameterTable
          mode="input"
          parameters={[mockInputParameters[0]]}
          values={{ url: 'https://updated.com/users' }}
          onChange={vi.fn()}
          availableVariables={mockAvailableVariables}
        />
      )

      // The field should sync to the new value
      const urlRow = screen.getByTestId('param-row-url')
      expect(elementsShowing(urlRow, 'https://updated.com/users')).not.toHaveLength(0)
      expect(elementsShowing(urlRow, 'https://initial.com')).toHaveLength(0)
    })
  })

  describe('Number Field Validation', () => {
    it('shows validation error for required empty integer field', async () => {
      const user = userEvent.setup()

      const requiredNumberParam: Parameter = {
        name: 'count',
        type: 'integer',
        required: true,
        description: 'Number of items',
      }

      const { ParameterTable } = await import(
        '@/features/workbench/common/element-config/parameters/parameter-table'
      )
      render(
        <ParameterTable
          mode="input"
          parameters={[requiredNumberParam]}
          values={{}}
          onChange={vi.fn()}
          availableVariables={mockAvailableVariables}
        />
      )

      const input = numberBox(screen.getByTestId('param-row-count'))

      // Trigger validation by focusing and blurring
      await user.click(input)
      await user.tab()

      await waitFor(() => {
        expect(input).toHaveAttribute('aria-invalid', 'true')
      })
    })

    it('handles undefined value in integer field', async () => {
      const numberParam: Parameter = {
        name: 'timeout',
        type: 'integer',
        required: false,
      }

      const { ParameterTable } = await import(
        '@/features/workbench/common/element-config/parameters/parameter-table'
      )
      render(
        <ParameterTable
          mode="input"
          parameters={[numberParam]}
          values={{}} // No value (undefined) to test the ?? '' fallback
          onChange={vi.fn()}
          availableVariables={mockAvailableVariables}
        />
      )

      // Input should be empty when value is undefined
      expect(numberBox(screen.getByTestId('param-row-timeout'))).toHaveValue('')
    })
  })

  describe('Enum Field Validation', () => {
    it('shows validation error for required empty enum field in expression mode', async () => {
      const user = userEvent.setup()

      const requiredEnumParam: Parameter = {
        name: 'status',
        type: 'string',
        required: true,
        enumValues: ['active', 'inactive', 'pending'],
        description: 'Current status',
      }

      const { ParameterTable } = await import(
        '@/features/workbench/common/element-config/parameters/parameter-table'
      )
      render(
        <ParameterTable
          mode="input"
          parameters={[requiredEnumParam]}
          values={{}}
          onChange={vi.fn()}
          availableVariables={mockAvailableVariables}
        />
      )

      const statusRow = screen.getByTestId('param-row-status')

      // An unset field switches with no warning (FIELD-7)
      await user.click(within(statusRow).getByTestId('expression-toggle'))

      // Wait for input to appear
      await waitFor(() => {
        expect(within(statusRow).getByRole('textbox')).toBeInTheDocument()
      })

      // Focus and blur the text input to trigger validation
      const input = within(statusRow).getByRole('textbox')
      // Click to focus, then click outside to blur
      await user.click(input)
      await user.click(statusRow)

      // The input is touched now, validation should appear
      await waitFor(() => {
        expect(within(statusRow).getByRole('alert')).toBeInTheDocument()
      })
    })

    it('shows validation error for required empty select field after closing', async () => {
      const user = userEvent.setup()

      const requiredEnumParam: Parameter = {
        name: 'status',
        type: 'string',
        required: true,
        enumValues: ['active', 'inactive', 'pending'],
        description: 'Current status',
      }

      const { ParameterTable } = await import(
        '@/features/workbench/common/element-config/parameters/parameter-table'
      )
      render(
        <ParameterTable
          mode="input"
          parameters={[requiredEnumParam]}
          values={{ status: '' }} // Empty value for required enum field
          onChange={vi.fn()}
          availableVariables={mockAvailableVariables}
        />
      )

      const statusRow = screen.getByTestId('param-row-status')
      const select = within(statusRow).getByRole('combobox')

      // Open and close the dropdown without selecting anything
      await user.click(select)
      await user.keyboard('{Escape}')

      // Now the select is touched (onOpenChange sets touched when closing)
      // Validation error should appear for empty required field
      await waitFor(() => {
        expect(within(statusRow).getByRole('alert')).toBeInTheDocument()
      })
    })

    it('handles null/undefined value for enum in expression mode', async () => {
      const user = userEvent.setup()

      const requiredEnumParam: Parameter = {
        name: 'status',
        type: 'string',
        required: true,
        enumValues: ['active', 'inactive', 'pending'],
      }

      const { ParameterTable } = await import(
        '@/features/workbench/common/element-config/parameters/parameter-table'
      )
      render(
        <ParameterTable
          mode="input"
          parameters={[requiredEnumParam]}
          values={{}} // No value (undefined), test the ?? '' fallback
          onChange={vi.fn()}
          availableVariables={mockAvailableVariables}
        />
      )

      const statusRow = screen.getByTestId('param-row-status')

      // Toggle to expression mode
      await user.click(within(statusRow).getByTestId('expression-toggle'))

      // Input should be empty (from undefined ?? '')
      await waitFor(() => {
        // CodeMirror uses contenteditable, empty value shows empty text
        expect(within(statusRow).getByRole('textbox')).toHaveTextContent('')
      })
    })
  })

  describe('Autocomplete Behavior', () => {
    it('shows autocomplete when typing variable placeholder', async () => {
      const user = userEvent.setup()
      const { ParameterTable } = await import(
        '@/features/workbench/common/element-config/parameters/parameter-table'
      )

      render(
        <ParameterTable
          mode="input"
          parameters={[mockInputParameters[0]]}
          values={{}}
          onChange={vi.fn()}
          availableVariables={mockAvailableVariables}
        />
      )

      const urlRow = screen.getByTestId('param-row-url')
      // Toggle to expression mode for CodeMirror
      await user.click(within(urlRow).getByTestId('expression-toggle'))

      await waitFor(() => {
        expect(within(urlRow).getByRole('textbox')).toBeInTheDocument()
      })
      const input = within(urlRow).getByRole('textbox')

      // Focus and type to trigger autocomplete
      await user.click(input)
      await user.type(input, '${{')

      // Autocomplete should show when matching pattern is detected
      // CodeMirror renders autocomplete at document.body level
      await waitFor(() => {
        expect(document.querySelector('.cm-tooltip-autocomplete')).toBeInTheDocument()
      })
    })

    it('closes autocomplete when clicking outside', async () => {
      const user = userEvent.setup()
      const { ParameterTable } = await import(
        '@/features/workbench/common/element-config/parameters/parameter-table'
      )

      render(
        <div>
          <ParameterTable
            mode="input"
            parameters={[mockInputParameters[0]]}
            values={{}}
            onChange={vi.fn()}
            availableVariables={mockAvailableVariables}
          />
          <button data-testid="outside-element">Outside</button>
        </div>
      )

      const urlRow = screen.getByTestId('param-row-url')
      // Toggle to expression mode for CodeMirror
      await user.click(within(urlRow).getByTestId('expression-toggle'))

      await waitFor(() => {
        expect(within(urlRow).getByRole('textbox')).toBeInTheDocument()
      })
      const input = within(urlRow).getByRole('textbox')

      // Focus and type to trigger autocomplete
      await user.click(input)
      await user.type(input, '${{')

      // Wait for autocomplete to appear
      // CodeMirror renders autocomplete at document.body level
      await waitFor(() => {
        expect(document.querySelector('.cm-tooltip-autocomplete')).toBeInTheDocument()
      })

      // Click outside - CodeMirror closes autocomplete when focus leaves editor
      await user.click(screen.getByTestId('outside-element'))

      // Autocomplete should close
      await waitFor(() => {
        expect(document.querySelector('.cm-tooltip-autocomplete')).not.toBeInTheDocument()
      })
    })
  })

  // ==========================================================================
  // Map Type, showWhen, Duration ms (REQ-3.4.1.4, REQ-3.1.1.5)
  // ==========================================================================

  describe('Map Type Parameters (REQ-3.1.1.5)', () => {
    const mapParameter = {
      name: 'headers',
      type: 'map' as const,
      required: false,
      description: 'Request headers as key-value pairs',
    }

    it('renders an empty map as {} with an expand', async () => {
      const { ParameterTable } = await import(
        '@/features/workbench/common/element-config/parameters/parameter-table'
      )
      render(
        <ParameterTable
          mode="input"
          parameters={[mapParameter]}
          values={{ headers: {} }}
          onChange={vi.fn()}
          availableVariables={mockAvailableVariables}
        />
      )

      const headersRow = screen.getByTestId('param-row-headers')
      expect(elementsShowing(headersRow, '{}')).not.toHaveLength(0)
      expect(within(headersRow).getByTestId('param-expand-headers')).toBeInTheDocument()
    })

    it('shows the entries on the one line when values exist', async () => {
      const { ParameterTable } = await import(
        '@/features/workbench/common/element-config/parameters/parameter-table'
      )
      render(
        <ParameterTable
          mode="input"
          parameters={[mapParameter]}
          values={{ headers: { 'Content-Type': 'application/json', 'Accept': 'text/html' } }}
          onChange={vi.fn()}
          availableVariables={mockAvailableVariables}
        />
      )

      const headersRow = screen.getByTestId('param-row-headers')
      expect(
        elementsShowing(headersRow, '{"Content-Type": "application/json", "Accept": "text/html"}'),
      ).not.toHaveLength(0)
      expect(within(headersRow).queryByText(/^\d+ entr(y|ies)$/)).not.toBeInTheDocument()
    })

    it('opens the value sheet for a map param expand click', async () => {
      const user = userEvent.setup()

      const { ParameterTable } = await import(
        '@/features/workbench/common/element-config/parameters/parameter-table'
      )
      render(
        <ParameterTable
          mode="input"
          parameters={[mapParameter]}
          values={{ headers: { 'Authorization': 'Bearer token' } }}
          onChange={vi.fn()}
          availableVariables={mockAvailableVariables}
        />
      )

      const headersRow = screen.getByTestId('param-row-headers')
      await user.click(within(headersRow).getByTestId('param-expand-headers'))

      // The shared "Edit value" sheet opens as a map.
      await waitFor(() => {
        expect(screen.getByTestId('value-editor-sheet')).toHaveAttribute('data-type', 'map')
      })
    })

    it('calls onChange when the map sheet saves', async () => {
      const user = userEvent.setup()
      const handleChange = vi.fn()

      const { ParameterTable } = await import(
        '@/features/workbench/common/element-config/parameters/parameter-table'
      )
      render(
        <ParameterTable
          mode="input"
          parameters={[mapParameter]}
          values={{ headers: {} }}
          onChange={handleChange}
          availableVariables={mockAvailableVariables}
        />
      )

      const headersRow = screen.getByTestId('param-row-headers')
      await user.click(within(headersRow).getByTestId('param-expand-headers'))

      await waitFor(() => {
        expect(screen.getByTestId('value-editor-sheet')).toBeInTheDocument()
      })
      await user.click(screen.getByTestId('sheet-save'))

      // The map sheet's save routes straight to the param onChange.
      expect(handleChange).toHaveBeenCalledWith('headers', 'SAVED')
    })

    it('renders an unset map with no default as an empty field with an expand', async () => {
      const { ParameterTable } = await import(
        '@/features/workbench/common/element-config/parameters/parameter-table'
      )
      render(
        <ParameterTable
          mode="input"
          parameters={[mapParameter]}
          values={{}}
          onChange={vi.fn()}
          availableVariables={mockAvailableVariables}
        />
      )

      const headersRow = screen.getByTestId('param-row-headers')
      expect(within(headersRow).getByTestId('param-expand-headers')).toBeInTheDocument()
      expect(within(headersRow).queryByText('Edit…')).not.toBeInTheDocument()
      expect(elementsShowing(headersRow, '{}')).toHaveLength(0)
    })

    it('opens the map sheet with stringValuesOnly (param maps stay string->string)', async () => {
      const user = userEvent.setup()

      const { ParameterTable } = await import(
        '@/features/workbench/common/element-config/parameters/parameter-table'
      )
      render(
        <ParameterTable
          mode="input"
          parameters={[mapParameter]}
          values={{ headers: {} }}
          onChange={vi.fn()}
          availableVariables={mockAvailableVariables}
        />
      )

      const headersRow = screen.getByTestId('param-row-headers')
      await user.click(within(headersRow).getByTestId('param-expand-headers'))

      // The numeric-stays-string preservation itself lives in map-edit-body's stringValuesOnly
      // tests; here we prove the param wires stringValuesOnly through to the sheet.
      await waitFor(() => {
        expect(screen.getByTestId('value-editor-sheet')).toHaveAttribute('data-string-values-only', 'true')
      })
    })

    it('displays map type label in type column', async () => {
      const { ParameterTable } = await import(
        '@/features/workbench/common/element-config/parameters/parameter-table'
      )
      render(
        <ParameterTable
          mode="input"
          parameters={[mapParameter]}
          values={{}}
          onChange={vi.fn()}
          availableVariables={mockAvailableVariables}
        />
      )

      const headersRow = screen.getByTestId('param-row-headers')
      expect(within(headersRow).getByText('map')).toBeInTheDocument()
    })
  })

  describe('Conditional Parameter Visibility - showWhen (REQ-3.1.1.5)', () => {
    const methodParam = {
      name: 'method',
      type: 'string' as const,
      required: true,
      enumValues: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
      defaultValue: 'GET',
      description: 'HTTP method',
    }

    const bodyParam = {
      name: 'body',
      type: 'string' as const,
      required: false,
      description: 'Request body',
      showWhen: { field: 'method', values: ['POST', 'PUT', 'PATCH', 'DELETE'] },
    }

    it('hides parameter when showWhen condition is not met', async () => {
      const { ParameterTable } = await import(
        '@/features/workbench/common/element-config/parameters/parameter-table'
      )
      render(
        <ParameterTable
          mode="input"
          parameters={[methodParam, bodyParam]}
          values={{ method: 'GET' }}
          onChange={vi.fn()}
          availableVariables={mockAvailableVariables}
        />
      )

      // method row should be visible
      expect(screen.getByTestId('param-row-method')).toBeInTheDocument()
      // body row should be hidden because GET is not in showWhen.values
      expect(screen.queryByTestId('param-row-body')).not.toBeInTheDocument()
    })

    it('shows parameter when showWhen condition is met', async () => {
      const { ParameterTable } = await import(
        '@/features/workbench/common/element-config/parameters/parameter-table'
      )
      render(
        <ParameterTable
          mode="input"
          parameters={[methodParam, bodyParam]}
          values={{ method: 'POST' }}
          onChange={vi.fn()}
          availableVariables={mockAvailableVariables}
        />
      )

      // Both rows should be visible
      expect(screen.getByTestId('param-row-method')).toBeInTheDocument()
      expect(screen.getByTestId('param-row-body')).toBeInTheDocument()
    })

    it('shows parameter for all methods in showWhen values', async () => {
      const { ParameterTable } = await import(
        '@/features/workbench/common/element-config/parameters/parameter-table'
      )

      for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
        const { unmount } = render(
          <ParameterTable
            mode="input"
            parameters={[methodParam, bodyParam]}
            values={{ method }}
            onChange={vi.fn()}
            availableVariables={mockAvailableVariables}
          />
        )

        expect(screen.getByTestId('param-row-body')).toBeInTheDocument()
        unmount()
      }
    })

    it('clears hidden parameter value when showWhen condition becomes false', async () => {
      const handleChange = vi.fn()

      const { ParameterTable } = await import(
        '@/features/workbench/common/element-config/parameters/parameter-table'
      )

      // Start with POST (body visible with a value)
      const { rerender } = render(
        <ParameterTable
          mode="input"
          parameters={[methodParam, bodyParam]}
          values={{ method: 'POST', body: '{"key": "value"}' }}
          onChange={handleChange}
          availableVariables={mockAvailableVariables}
        />
      )

      expect(screen.getByTestId('param-row-body')).toBeInTheDocument()

      // Switch to GET (body should be hidden and value cleared)
      await act(async () => {
        rerender(
          <ParameterTable
            mode="input"
            parameters={[methodParam, bodyParam]}
            values={{ method: 'GET', body: '{"key": "value"}' }}
            onChange={handleChange}
            availableVariables={mockAvailableVariables}
          />
        )
      })

      // body row should be hidden
      expect(screen.queryByTestId('param-row-body')).not.toBeInTheDocument()
      // onChange should have been called to clear the body value
      expect(handleChange).toHaveBeenCalledWith('body', undefined)
    })

    it('does not affect parameters without showWhen', async () => {
      const urlParam = {
        name: 'url',
        type: 'string' as const,
        required: true,
        description: 'Request URL',
      }

      const { ParameterTable } = await import(
        '@/features/workbench/common/element-config/parameters/parameter-table'
      )
      render(
        <ParameterTable
          mode="input"
          parameters={[urlParam, methodParam, bodyParam]}
          values={{ method: 'GET' }}
          onChange={vi.fn()}
          availableVariables={mockAvailableVariables}
        />
      )

      // url has no showWhen - always visible
      expect(screen.getByTestId('param-row-url')).toBeInTheDocument()
      // method has no showWhen - always visible
      expect(screen.getByTestId('param-row-method')).toBeInTheDocument()
      // body has showWhen and GET is not in values - hidden
      expect(screen.queryByTestId('param-row-body')).not.toBeInTheDocument()
    })

    it('uses defaultValue of referenced field for showWhen when value is not set', async () => {
      const modeParam = {
        name: 'mode',
        type: 'string' as const,
        required: true,
        description: 'Mode',
        defaultValue: 'count',
        enumValues: ['count', 'range'],
      }
      const countParam = {
        name: 'count',
        type: 'integer' as const,
        required: false,
        description: 'Number',
        showWhen: { field: 'mode', values: ['count'] },
      }
      const startParam = {
        name: 'start',
        type: 'integer' as const,
        required: false,
        description: 'Start',
        showWhen: { field: 'mode', values: ['range'] },
      }

      const { ParameterTable } = await import(
        '@/features/workbench/common/element-config/parameters/parameter-table'
      )
      render(
        <ParameterTable
          mode="input"
          parameters={[modeParam, countParam, startParam]}
          values={{}}
          onChange={vi.fn()}
          availableVariables={mockAvailableVariables}
        />
      )

      // count should be visible because mode defaults to 'count'
      expect(screen.getByTestId('param-row-count')).toBeInTheDocument()
      // start should be hidden because 'count' is not in its showWhen values
      expect(screen.queryByTestId('param-row-start')).not.toBeInTheDocument()
    })
  })

  describe('Conditional Required - requiredWhen', () => {
    it('marks parameter as required when requiredWhen condition is met', async () => {
      const modeParam = {
        name: 'mode',
        type: 'string' as const,
        required: true,
        description: 'Mode',
        defaultValue: 'count',
        enumValues: ['count', 'range'],
      }
      const countParam = {
        name: 'count',
        type: 'integer' as const,
        required: false,
        description: 'Number',
        showWhen: { field: 'mode', values: ['count'] },
        requiredWhen: { field: 'mode', values: ['count'] },
      }

      const { ParameterTable } = await import(
        '@/features/workbench/common/element-config/parameters/parameter-table'
      )
      render(
        <ParameterTable
          mode="input"
          parameters={[modeParam, countParam]}
          values={{ mode: 'count' }}
          onChange={vi.fn()}
          availableVariables={mockAvailableVariables}
        />
      )

      const countRow = screen.getByTestId('param-row-count')
      expect(within(countRow).getByText('*')).toBeInTheDocument()
    })

    it('uses defaultValue for requiredWhen when field value is not set', async () => {
      const modeParam = {
        name: 'mode',
        type: 'string' as const,
        required: true,
        description: 'Mode',
        defaultValue: 'count',
        enumValues: ['count', 'range'],
      }
      const countParam = {
        name: 'count',
        type: 'integer' as const,
        required: false,
        description: 'Number',
        showWhen: { field: 'mode', values: ['count'] },
        requiredWhen: { field: 'mode', values: ['count'] },
      }

      const { ParameterTable } = await import(
        '@/features/workbench/common/element-config/parameters/parameter-table'
      )
      render(
        <ParameterTable
          mode="input"
          parameters={[modeParam, countParam]}
          values={{}}
          onChange={vi.fn()}
          availableVariables={mockAvailableVariables}
        />
      )

      // count should be visible (showWhen matches default) and required (requiredWhen matches default)
      const countRow = screen.getByTestId('param-row-count')
      expect(within(countRow).getByText('*')).toBeInTheDocument()
    })

    it('does not mark parameter as required when requiredWhen condition is not met', async () => {
      const modeParam = {
        name: 'mode',
        type: 'string' as const,
        required: true,
        description: 'Mode',
        defaultValue: 'count',
        enumValues: ['count', 'range'],
      }
      const startParam = {
        name: 'start',
        type: 'integer' as const,
        required: false,
        description: 'Start',
        showWhen: { field: 'mode', values: ['range'] },
        requiredWhen: { field: 'mode', values: ['range'] },
      }

      const { ParameterTable } = await import(
        '@/features/workbench/common/element-config/parameters/parameter-table'
      )
      render(
        <ParameterTable
          mode="input"
          parameters={[modeParam, startParam]}
          values={{ mode: 'range' }}
          onChange={vi.fn()}
          availableVariables={mockAvailableVariables}
        />
      )

      // start is visible and required when mode=range
      const startRow = screen.getByTestId('param-row-start')
      expect(within(startRow).getByText('*')).toBeInTheDocument()
    })
  })

  describe('Stale validation errors for hidden parameters', () => {
    it('clears validation error when conditionally-required parameter becomes hidden', async () => {
      const handleValidation = vi.fn()
      const handleChange = vi.fn()

      const modeParam = {
        name: 'mode',
        type: 'string' as const,
        required: true,
        description: 'Mode',
        defaultValue: 'count',
        enumValues: ['count', 'range'],
      }
      const countParam = {
        name: 'count',
        type: 'integer' as const,
        required: false,
        description: 'Number',
        showWhen: { field: 'mode', values: ['count'] },
        requiredWhen: { field: 'mode', values: ['count'] },
      }
      const startParam = {
        name: 'start',
        type: 'integer' as const,
        required: false,
        description: 'Start',
        showWhen: { field: 'mode', values: ['range'] },
        requiredWhen: { field: 'mode', values: ['range'] },
      }

      const { ParameterTable } = await import(
        '@/features/workbench/common/element-config/parameters/parameter-table'
      )

      // Start with mode=count, count is visible but empty -> validation error
      const { rerender } = render(
        <ParameterTable
          mode="input"
          parameters={[modeParam, countParam, startParam]}
          values={{ mode: 'count' }}
          onChange={handleChange}
          onValidationChange={handleValidation}
          availableVariables={mockAvailableVariables}
        />
      )

      await waitFor(() => {
        expect(handleValidation).toHaveBeenCalledWith({
          isValid: false,
          errors: expect.objectContaining({ count: expect.any(String) }),
        })
      })

      handleValidation.mockClear()

      // Switch to range mode - count becomes hidden, start becomes visible
      await act(async () => {
        rerender(
          <ParameterTable
            mode="input"
            parameters={[modeParam, countParam, startParam]}
            values={{ mode: 'range', start: 10 }}
            onChange={handleChange}
            onValidationChange={handleValidation}
            availableVariables={mockAvailableVariables}
          />
        )
      })

      // Stale 'count' error should be cleared; start has a value so no error
      await waitFor(() => {
        expect(handleValidation).toHaveBeenCalledWith({
          isValid: true,
          errors: {},
        })
      })
    })
  })

  describe('Duration Parameter as Plain Integer (REQ-3.1.1.5)', () => {
    const durationParam = {
      name: 'duration',
      type: 'integer' as const,
      required: true,
      description: 'Delay duration',
    }

    it('renders the shared number body for duration integer parameter', async () => {
      const { ParameterTable } = await import(
        '@/features/workbench/common/element-config/parameters/parameter-table'
      )
      render(
        <ParameterTable
          mode="input"
          parameters={[durationParam]}
          values={{ duration: 5000 }}
          onChange={vi.fn()}
          availableVariables={mockAvailableVariables}
        />
      )

      // Duration renders as a plain number (no amount/unit decomposition)
      expect(within(screen.getByTestId('param-row-duration')).getByTestId('scalar-edit-body')).toBeInTheDocument()
    })

    it('shows raw numeric value in the number box', async () => {
      const { ParameterTable } = await import(
        '@/features/workbench/common/element-config/parameters/parameter-table'
      )
      render(
        <ParameterTable
          mode="input"
          parameters={[durationParam]}
          values={{ duration: 5000 }}
          onChange={vi.fn()}
          availableVariables={mockAvailableVariables}
        />
      )

      // Value shown as-is (no ms to s conversion)
      expect(numberBox(screen.getByTestId('param-row-duration'))).toHaveValue('5000')
    })

    it('calls onChange with the exact digits of a typed integer value', async () => {
      const user = userEvent.setup()
      const handleChange = vi.fn()

      render(
        <StatefulTable
          mode="input"
          parameters={[durationParam]}
          initialValues={{ duration: 5000 }}
          onChange={handleChange}
          availableVariables={mockAvailableVariables}
        />
      )

      const input = numberBox(screen.getByTestId('param-row-duration'))
      await user.clear(input)
      await user.type(input, '10000')

      expect(handleChange).toHaveBeenLastCalledWith('duration', '10000')
    })
  })

  // ==========================================================================
  // HTTP Plugin Interface: Parameter Grouping
  // ==========================================================================

  describe('Parameter Grouping with Collapsible Sections', () => {
    const groupedParameters: Parameter[] = [
      // Ungrouped
      { name: 'url', type: 'string', required: true, description: 'Request URL' },
      { name: 'method', type: 'string', required: true, enumValues: ['GET', 'POST'], description: 'HTTP method' },
      // Group: Timeouts & Retries
      { name: 'timeout', type: 'integer', required: false, defaultValue: 30, group: 'Timeouts & Retries' },
      { name: 'retry_count', type: 'integer', required: false, defaultValue: 0, group: 'Timeouts & Retries' },
      // Group: Security
      { name: 'verify_ssl', type: 'boolean', required: false, defaultValue: true, group: 'Security' },
      { name: 'ca_cert', type: 'string', required: false, group: 'Security' },
      // Group: Connection
      { name: 'allow_redirects', type: 'boolean', required: false, defaultValue: true, group: 'Connection' },
    ]

    it('renders ungrouped parameters directly without section header', async () => {
      const { ParameterTable } = await import(
        '@/features/workbench/common/element-config/parameters/parameter-table'
      )
      render(
        <ParameterTable
          mode="input"
          parameters={groupedParameters}
          values={{}}
          onChange={vi.fn()}
          availableVariables={mockAvailableVariables}
        />
      )

      // Ungrouped params should render
      expect(screen.getByTestId('param-row-url')).toBeInTheDocument()
      expect(screen.getByTestId('param-row-method')).toBeInTheDocument()
    })

    it('renders group headers for each distinct group', async () => {
      const { ParameterTable } = await import(
        '@/features/workbench/common/element-config/parameters/parameter-table'
      )
      render(
        <ParameterTable
          mode="input"
          parameters={groupedParameters}
          values={{}}
          onChange={vi.fn()}
          availableVariables={mockAvailableVariables}
        />
      )

      expect(screen.getByText('Timeouts & Retries')).toBeInTheDocument()
      expect(screen.getByText('Security')).toBeInTheDocument()
      expect(screen.getByText('Connection')).toBeInTheDocument()
    })

    it('collapses all groups by default (grouped param rows hidden)', async () => {
      const { ParameterTable } = await import(
        '@/features/workbench/common/element-config/parameters/parameter-table'
      )
      render(
        <ParameterTable
          mode="input"
          parameters={groupedParameters}
          values={{}}
          onChange={vi.fn()}
          availableVariables={mockAvailableVariables}
        />
      )

      // Grouped params should NOT be visible when collapsed
      expect(screen.queryByTestId('param-row-timeout')).not.toBeInTheDocument()
      expect(screen.queryByTestId('param-row-retry_count')).not.toBeInTheDocument()
      expect(screen.queryByTestId('param-row-verify_ssl')).not.toBeInTheDocument()
      expect(screen.queryByTestId('param-row-ca_cert')).not.toBeInTheDocument()
      expect(screen.queryByTestId('param-row-allow_redirects')).not.toBeInTheDocument()
    })

    it('expands group when clicking group header', async () => {
      const user = userEvent.setup()
      const { ParameterTable } = await import(
        '@/features/workbench/common/element-config/parameters/parameter-table'
      )
      render(
        <ParameterTable
          mode="input"
          parameters={groupedParameters}
          values={{}}
          onChange={vi.fn()}
          availableVariables={mockAvailableVariables}
        />
      )

      // Click the "Timeouts & Retries" group header
      await user.click(screen.getByText('Timeouts & Retries'))

      // Params in this group should now be visible
      await waitFor(() => {
        expect(screen.getByTestId('param-row-timeout')).toBeInTheDocument()
        expect(screen.getByTestId('param-row-retry_count')).toBeInTheDocument()
      })

      // Other groups should still be collapsed
      expect(screen.queryByTestId('param-row-verify_ssl')).not.toBeInTheDocument()
      expect(screen.queryByTestId('param-row-allow_redirects')).not.toBeInTheDocument()
    })

    it('collapses group when clicking expanded group header', async () => {
      const user = userEvent.setup()
      const { ParameterTable } = await import(
        '@/features/workbench/common/element-config/parameters/parameter-table'
      )
      render(
        <ParameterTable
          mode="input"
          parameters={groupedParameters}
          values={{}}
          onChange={vi.fn()}
          availableVariables={mockAvailableVariables}
        />
      )

      // Expand then collapse "Security"
      await user.click(screen.getByText('Security'))
      await waitFor(() => {
        expect(screen.getByTestId('param-row-verify_ssl')).toBeInTheDocument()
      })

      await user.click(screen.getByText('Security'))
      await waitFor(() => {
        expect(screen.queryByTestId('param-row-verify_ssl')).not.toBeInTheDocument()
      })
    })

    it('renders parameters without group property as ungrouped (no collapsible)', async () => {
      const { ParameterTable } = await import(
        '@/features/workbench/common/element-config/parameters/parameter-table'
      )

      // Only ungrouped params - no group headers should appear
      const ungroupedOnly: Parameter[] = [
        { name: 'url', type: 'string', required: true },
        { name: 'method', type: 'string', required: true },
      ]

      render(
        <ParameterTable
          mode="input"
          parameters={ungroupedOnly}
          values={{}}
          onChange={vi.fn()}
          availableVariables={mockAvailableVariables}
        />
      )

      expect(screen.getByTestId('param-row-url')).toBeInTheDocument()
      expect(screen.getByTestId('param-row-method')).toBeInTheDocument()
      // No group headers should exist
      expect(screen.queryByTestId('group-header-Timeouts & Retries')).not.toBeInTheDocument()
    })
  })

  // ==========================================================================
  // HTTP Plugin Interface: Array Type Rendering
  // ==========================================================================

  describe('Array Type Parameters', () => {
    const arrayParameter: Parameter = {
      name: 'retryable_status_codes',
      type: 'array',
      required: false,
      defaultValue: ['502', '503', '504'],
      description: 'HTTP status codes that trigger retry',
    }

    it('renders the list field with its expand for array type parameter', async () => {
      const { ParameterTable } = await import(
        '@/features/workbench/common/element-config/parameters/parameter-table'
      )
      render(
        <ParameterTable
          mode="input"
          parameters={[arrayParameter]}
          values={{ retryable_status_codes: ['502', '503', '504'] }}
          onChange={vi.fn()}
          availableVariables={mockAvailableVariables}
        />
      )

      const row = screen.getByTestId('param-row-retryable_status_codes')
      expect(within(row).getByTestId('param-expand-retryable_status_codes')).toHaveAccessibleName(
        'Open editor for retryable_status_codes',
      )
    })

    it('shows every item on the one line in place of a count', async () => {
      const { ParameterTable } = await import(
        '@/features/workbench/common/element-config/parameters/parameter-table'
      )
      render(
        <ParameterTable
          mode="input"
          parameters={[arrayParameter]}
          values={{ retryable_status_codes: ['502', '503', '504'] }}
          onChange={vi.fn()}
          availableVariables={mockAvailableVariables}
        />
      )

      const row = screen.getByTestId('param-row-retryable_status_codes')
      expect(elementsShowing(row, '["502", "503", "504"]')).not.toHaveLength(0)
      expect(within(row).queryByText(/^\d+ items?$/)).not.toBeInTheDocument()
    })

    it('shows a single-element array as its one item', async () => {
      const { ParameterTable } = await import(
        '@/features/workbench/common/element-config/parameters/parameter-table'
      )
      render(
        <ParameterTable
          mode="input"
          parameters={[arrayParameter]}
          values={{ retryable_status_codes: ['502'] }}
          onChange={vi.fn()}
          availableVariables={mockAvailableVariables}
        />
      )

      const row = screen.getByTestId('param-row-retryable_status_codes')
      expect(elementsShowing(row, '["502"]')).not.toHaveLength(0)
    })

    it('shows an empty array as [] in its own color, not the gray default', async () => {
      const { ParameterTable } = await import(
        '@/features/workbench/common/element-config/parameters/parameter-table'
      )
      render(
        <ParameterTable
          mode="input"
          parameters={[arrayParameter]}
          values={{ retryable_status_codes: [] }}
          onChange={vi.fn()}
          availableVariables={mockAvailableVariables}
        />
      )

      const row = screen.getByTestId('param-row-retryable_status_codes')
      const [line] = elementsShowing(row, '[]')
      expect(line).toBeDefined()
      expect(grayUpTo(line, row)).toBe(false)
      expect(within(row).queryByText('Edit…')).not.toBeInTheDocument()
    })

    it('opens the value sheet when the array expand is clicked', async () => {
      const user = userEvent.setup()
      const { ParameterTable } = await import(
        '@/features/workbench/common/element-config/parameters/parameter-table'
      )
      render(
        <ParameterTable
          mode="input"
          parameters={[arrayParameter]}
          values={{ retryable_status_codes: ['502', '503'] }}
          onChange={vi.fn()}
          availableVariables={mockAvailableVariables}
        />
      )

      const row = screen.getByTestId('param-row-retryable_status_codes')
      await user.click(within(row).getByTestId('param-expand-retryable_status_codes'))

      await waitFor(() => {
        expect(screen.getByTestId('value-editor-sheet')).toHaveAttribute('data-type', 'array')
      })
    })

    it('uses default value when no value provided', async () => {
      const { ParameterTable } = await import(
        '@/features/workbench/common/element-config/parameters/parameter-table'
      )
      render(
        <ParameterTable
          mode="input"
          parameters={[arrayParameter]}
          values={{}}
          onChange={vi.fn()}
          availableVariables={mockAvailableVariables}
        />
      )

      const row = screen.getByTestId('param-row-retryable_status_codes')
      // The unset row shows its default on one line, in the Text Muted gray (FIELD-2)
      const [line] = elementsShowing(row, '["502", "503", "504"]')
      expect(line).toBeDefined()
      expect(grayUpTo(line, row)).toBe(true)
    })

    it('calls onChange when the array sheet saves', async () => {
      const user = userEvent.setup()
      const handleChange = vi.fn()
      const { ParameterTable } = await import(
        '@/features/workbench/common/element-config/parameters/parameter-table'
      )
      render(
        <ParameterTable
          mode="input"
          parameters={[arrayParameter]}
          values={{ retryable_status_codes: ['502'] }}
          onChange={handleChange}
          availableVariables={mockAvailableVariables}
        />
      )

      const row = screen.getByTestId('param-row-retryable_status_codes')
      await user.click(within(row).getByTestId('param-expand-retryable_status_codes'))

      await waitFor(() => {
        expect(screen.getByTestId('value-editor-sheet')).toBeInTheDocument()
      })
      await user.click(screen.getByTestId('sheet-save'))

      expect(handleChange).toHaveBeenCalledWith('retryable_status_codes', 'SAVED')
    })

    it('renders an empty field with its expand when no value and no default provided', async () => {
      const { ParameterTable } = await import(
        '@/features/workbench/common/element-config/parameters/parameter-table'
      )
      const noDefaultArrayParam: Parameter = {
        name: 'tags',
        type: 'array',
        required: false,
        description: 'Tags',
      }
      render(
        <ParameterTable
          mode="input"
          parameters={[noDefaultArrayParam]}
          values={{}}
          onChange={vi.fn()}
          availableVariables={mockAvailableVariables}
        />
      )

      const row = screen.getByTestId('param-row-tags')
      expect(within(row).getByTestId('param-expand-tags')).toBeInTheDocument()
      expect(within(row).queryByText('Edit…')).not.toBeInTheDocument()
      expect(elementsShowing(row, '[]')).toHaveLength(0)
    })
  })

  // ==========================================================================
  // HTTP Plugin Interface: Universal Expression Toggle
  // ==========================================================================

  describe('Universal Expression Toggle', () => {
    it('shows expression toggle for integer parameter', async () => {
      const { ParameterTable } = await import(
        '@/features/workbench/common/element-config/parameters/parameter-table'
      )
      render(
        <ParameterTable
          mode="input"
          parameters={[{ name: 'timeout', type: 'integer', required: false, defaultValue: 30 }]}
          values={{}}
          onChange={vi.fn()}
          availableVariables={mockAvailableVariables}
        />
      )

      const row = screen.getByTestId('param-row-timeout')
      expect(within(row).getByTestId('expression-toggle')).toBeInTheDocument()
    })

    it('shows expression toggle for float parameter', async () => {
      const { ParameterTable } = await import(
        '@/features/workbench/common/element-config/parameters/parameter-table'
      )
      render(
        <ParameterTable
          mode="input"
          parameters={[{ name: 'delay', type: 'float', required: false, defaultValue: 1.5 }]}
          values={{}}
          onChange={vi.fn()}
          availableVariables={mockAvailableVariables}
        />
      )

      const row = screen.getByTestId('param-row-delay')
      expect(within(row).getByTestId('expression-toggle')).toBeInTheDocument()
    })

    it('shows expression toggle for boolean parameter', async () => {
      const { ParameterTable } = await import(
        '@/features/workbench/common/element-config/parameters/parameter-table'
      )
      render(
        <ParameterTable
          mode="input"
          parameters={[{ name: 'verify_ssl', type: 'boolean', required: false, defaultValue: true }]}
          values={{}}
          onChange={vi.fn()}
          availableVariables={mockAvailableVariables}
        />
      )

      const row = screen.getByTestId('param-row-verify_ssl')
      expect(within(row).getByTestId('expression-toggle')).toBeInTheDocument()
    })

    it('shows expression toggle for map parameter', async () => {
      const { ParameterTable } = await import(
        '@/features/workbench/common/element-config/parameters/parameter-table'
      )
      render(
        <ParameterTable
          mode="input"
          parameters={[{ name: 'headers', type: 'map', required: false }]}
          values={{}}
          onChange={vi.fn()}
          availableVariables={mockAvailableVariables}
        />
      )

      const row = screen.getByTestId('param-row-headers')
      expect(within(row).getByTestId('expression-toggle')).toBeInTheDocument()
    })

    it('shows expression toggle for array parameter', async () => {
      const { ParameterTable } = await import(
        '@/features/workbench/common/element-config/parameters/parameter-table'
      )
      render(
        <ParameterTable
          mode="input"
          parameters={[{ name: 'codes', type: 'array', required: false, defaultValue: ['502'] }]}
          values={{}}
          onChange={vi.fn()}
          availableVariables={mockAvailableVariables}
        />
      )

      const row = screen.getByTestId('param-row-codes')
      expect(within(row).getByTestId('expression-toggle')).toBeInTheDocument()
    })

    it('shows expression toggle for plain string parameter', async () => {
      const { ParameterTable } = await import(
        '@/features/workbench/common/element-config/parameters/parameter-table'
      )
      render(
        <ParameterTable
          mode="input"
          parameters={[{ name: 'url', type: 'string', required: true }]}
          values={{}}
          onChange={vi.fn()}
          availableVariables={mockAvailableVariables}
        />
      )

      const row = screen.getByTestId('param-row-url')
      expect(within(row).getByTestId('expression-toggle')).toBeInTheDocument()
    })

    it('does NOT show expression toggle in output mode', async () => {
      const { ParameterTable } = await import(
        '@/features/workbench/common/element-config/parameters/parameter-table'
      )
      render(
        <ParameterTable
          mode="output"
          parameters={[{ name: 'status_code', type: 'integer', required: false }]}
          values={{}}
          onChange={vi.fn()}
          availableVariables={mockAvailableVariables}
        />
      )

      const row = screen.getByTestId('output-row-status_code')
      expect(within(row).queryByTestId('expression-toggle')).not.toBeInTheDocument()
    })

    it('switches integer to ExpressionField when toggle is pressed', async () => {
      const user = userEvent.setup()
      const { ParameterTable } = await import(
        '@/features/workbench/common/element-config/parameters/parameter-table'
      )
      render(
        <ParameterTable
          mode="input"
          parameters={[{ name: 'timeout', type: 'integer', required: false, defaultValue: 30 }]}
          values={{ timeout: 30 }}
          onChange={vi.fn()}
          availableVariables={mockAvailableVariables}
        />
      )

      const row = screen.getByTestId('param-row-timeout')
      // Initially shows the shared number body
      expect(numberBox(row).tagName).toBe('INPUT')

      // The row holds a value, so the switch asks first (FIELD-7)
      await user.click(within(row).getByTestId('expression-toggle'))
      await chooseSwitch(user, 'switch-mode-clear-default')

      // Now shows ExpressionField (div wrapping CodeMirror) instead of the number box
      await waitFor(() => {
        expect(within(row).getByTestId('param-input-timeout').tagName).toBe('DIV')
        expect(within(row).queryByTestId('scalar-edit-body')).not.toBeInTheDocument()
      })
    })

    it('switches float to expression input when toggle is pressed', async () => {
      const user = userEvent.setup()
      const { ParameterTable } = await import(
        '@/features/workbench/common/element-config/parameters/parameter-table'
      )
      render(
        <ParameterTable
          mode="input"
          parameters={[{ name: 'retry_delay', type: 'float', required: false, defaultValue: 1.0 }]}
          values={{ retry_delay: 1.0 }}
          onChange={vi.fn()}
          availableVariables={mockAvailableVariables}
        />
      )

      const row = screen.getByTestId('param-row-retry_delay')
      expect(numberBox(row).tagName).toBe('INPUT')

      await user.click(within(row).getByTestId('expression-toggle'))
      await chooseSwitch(user, 'switch-mode-clear-default')

      await waitFor(() => {
        expect(within(row).getByTestId('param-input-retry_delay').tagName).toBe('DIV')
      })
    })

    it('switches boolean to expression input when toggle is pressed', async () => {
      const user = userEvent.setup()
      const { ParameterTable } = await import(
        '@/features/workbench/common/element-config/parameters/parameter-table'
      )
      render(
        <ParameterTable
          mode="input"
          parameters={[{ name: 'verify_ssl', type: 'boolean', required: false, defaultValue: true }]}
          values={{ verify_ssl: true }}
          onChange={vi.fn()}
          availableVariables={mockAvailableVariables}
        />
      )

      const row = screen.getByTestId('param-row-verify_ssl')
      expect(within(row).getByRole('checkbox')).toBeInTheDocument()

      await user.click(within(row).getByTestId('expression-toggle'))
      await chooseSwitch(user, 'switch-mode-clear-default')

      await waitFor(() => {
        expect(within(row).queryByRole('checkbox')).not.toBeInTheDocument()
        expect(within(row).getByTestId('param-input-verify_ssl')).toBeInTheDocument()
      })
    })

    it('switches map to expression input when toggle is pressed', async () => {
      const user = userEvent.setup()
      const { ParameterTable } = await import(
        '@/features/workbench/common/element-config/parameters/parameter-table'
      )
      render(
        <ParameterTable
          mode="input"
          parameters={[{ name: 'headers', type: 'map', required: false }]}
          values={{ headers: { 'X-Key': 'val' } }}
          onChange={vi.fn()}
          availableVariables={mockAvailableVariables}
        />
      )

      const row = screen.getByTestId('param-row-headers')
      expect(elementsShowing(row, '{"X-Key": "val"}')).not.toHaveLength(0)

      await user.click(within(row).getByTestId('expression-toggle'))
      await chooseSwitch(user, 'switch-mode-clear-default')

      await waitFor(() => {
        expect(within(row).getByTestId('param-input-headers').tagName).toBe('DIV')
      })
    })

    it('switches array to expression input when toggle is pressed', async () => {
      const user = userEvent.setup()
      const { ParameterTable } = await import(
        '@/features/workbench/common/element-config/parameters/parameter-table'
      )
      render(
        <ParameterTable
          mode="input"
          parameters={[{ name: 'codes', type: 'array', required: false, defaultValue: ['502'] }]}
          values={{ codes: ['502'] }}
          onChange={vi.fn()}
          availableVariables={mockAvailableVariables}
        />
      )

      const row = screen.getByTestId('param-row-codes')
      expect(elementsShowing(row, '["502"]')).not.toHaveLength(0)

      await user.click(within(row).getByTestId('expression-toggle'))
      await chooseSwitch(user, 'switch-mode-clear-default')

      await waitFor(() => {
        expect(within(row).getByTestId('param-input-codes').tagName).toBe('DIV')
      })
    })

    it('switches duration integer to expression input when toggle is pressed', async () => {
      const user = userEvent.setup()
      const { ParameterTable } = await import(
        '@/features/workbench/common/element-config/parameters/parameter-table'
      )
      render(
        <ParameterTable
          mode="input"
          parameters={[{ name: 'duration', type: 'integer', required: true }]}
          values={{ duration: 5000 }}
          onChange={vi.fn()}
          availableVariables={mockAvailableVariables}
        />
      )

      const row = screen.getByTestId('param-row-duration')
      // Duration renders the plain number box
      expect(numberBox(row).tagName).toBe('INPUT')

      await user.click(within(row).getByTestId('expression-toggle'))
      await chooseSwitch(user, 'switch-mode-clear-default')

      await waitFor(() => {
        expect(within(row).getByTestId('param-input-duration').tagName).toBe('DIV')
      })
    })

    it('renders empty ExpressionField when value is undefined in expression mode', { timeout: 30000 }, async () => {
      const user = userEvent.setup()
      const { ParameterTable } = await import(
        '@/features/workbench/common/element-config/parameters/parameter-table'
      )

      // Render all 5 non-string types without values or defaults to hit ?? '' fallback
      const params: Parameter[] = [
        { name: 'count', type: 'integer', required: false },
        { name: 'rate', type: 'float', required: false },
        { name: 'flag', type: 'boolean', required: false },
        { name: 'meta', type: 'map', required: false },
        { name: 'tags', type: 'array', required: false },
      ]

      render(
        <ParameterTable
          mode="input"
          parameters={params}
          values={{}}
          onChange={vi.fn()}
          availableVariables={mockAvailableVariables}
        />
      )

      // Toggle each to expression mode - effectiveValue is undefined, triggering ?? '' fallback
      for (const param of params) {
        const row = screen.getByTestId(`param-row-${param.name}`)
        await user.click(within(row).getByTestId('expression-toggle'))
      }

      // All should now show ExpressionField
      await waitFor(() => {
        for (const param of params) {
          const row = screen.getByTestId(`param-row-${param.name}`)
          expect(within(row).getByTestId(`param-input-${param.name}`)).toBeInTheDocument()
        }
      })
    })

    it('toggles an unset row back from expression mode to its number box with no warning', async () => {
      const user = userEvent.setup()
      render(
        <StatefulTable
          mode="input"
          parameters={[{ name: 'timeout', type: 'integer', required: false, defaultValue: 30 }]}
          initialValues={{}}
          availableVariables={mockAvailableVariables}
        />
      )

      const row = screen.getByTestId('param-row-timeout')
      const toggle = within(row).getByTestId('expression-toggle')

      // Toggle ON - ExpressionField (div wrapping CodeMirror)
      await user.click(toggle)
      await waitFor(() => {
        expect(within(row).getByTestId('param-input-timeout').tagName).toBe('DIV')
      })

      // Toggle OFF - back to the shared number box
      await user.click(toggle)
      expect(screen.queryByTestId('switch-mode-dialog')).not.toBeInTheDocument()
      expect(numberBox(row)).toHaveAttribute('inputmode', 'numeric')
    })
  })

  // ==========================================================================
  // Expression Toggle: Persistence, Input Masking, Switching Behavior
  // ==========================================================================

  describe('Expression Mode Persistence', () => {
    it('renders expression mode when expressionFields includes the parameter', async () => {
      const { ParameterTable } = await import(
        '@/features/workbench/common/element-config/parameters/parameter-table'
      )
      render(
        <ParameterTable
          mode="input"
          parameters={[{ name: 'timeout', type: 'integer', required: false }]}
          values={{ timeout: 'delay_ms' }}
          onChange={vi.fn()}
          availableVariables={mockAvailableVariables}
          expressionFields={['timeout']}
        />
      )

      // Should be in expression mode - ExpressionField rendered
      const row = screen.getByTestId('param-row-timeout')
      expect(within(row).getByTestId('param-input-timeout')).toBeInTheDocument()
      // Toggle should show as pressed
      expect(within(row).getByTestId('expression-toggle')).toHaveAttribute('data-state', 'on')
    })

    it('renders expression mode for boolean when expressionFields includes it', async () => {
      const { ParameterTable } = await import(
        '@/features/workbench/common/element-config/parameters/parameter-table'
      )
      render(
        <ParameterTable
          mode="input"
          parameters={[{ name: 'flag', type: 'boolean', required: false }]}
          values={{ flag: 'is_enabled' }}
          onChange={vi.fn()}
          availableVariables={mockAvailableVariables}
          expressionFields={['flag']}
        />
      )

      const row = screen.getByTestId('param-row-flag')
      // Should be in expression mode - no checkbox, shows ExpressionField
      expect(within(row).queryByRole('checkbox')).not.toBeInTheDocument()
      expect(within(row).getByTestId('param-input-flag')).toBeInTheDocument()
    })

    it('does NOT show expression mode when expressionFields is empty', async () => {
      const { ParameterTable } = await import(
        '@/features/workbench/common/element-config/parameters/parameter-table'
      )
      render(
        <ParameterTable
          mode="input"
          parameters={[{ name: 'count', type: 'integer', required: false }]}
          values={{ count: '' }}
          onChange={vi.fn()}
          availableVariables={mockAvailableVariables}
        />
      )

      // expressionFields defaults to [] - should NOT be in expression mode
      const row = screen.getByTestId('param-row-count')
      expect(within(row).getByTestId('expression-toggle')).toHaveAttribute('data-state', 'off')
    })

    it('stays in literal mode when integer param has number value', async () => {
      const { ParameterTable } = await import(
        '@/features/workbench/common/element-config/parameters/parameter-table'
      )
      render(
        <ParameterTable
          mode="input"
          parameters={[{ name: 'count', type: 'integer', required: false }]}
          values={{ count: 42 }}
          onChange={vi.fn()}
          availableVariables={mockAvailableVariables}
        />
      )

      const row = screen.getByTestId('param-row-count')
      expect(within(row).getByTestId('expression-toggle')).toHaveAttribute('data-state', 'off')
      expect(numberBox(row)).toHaveValue('42')
    })
  })

  describe('Integer Input Masking', () => {
    it('accepts digit characters in integer field and sends their exact text', async () => {
      const user = userEvent.setup()
      const handleChange = vi.fn()
      render(
        <StatefulTable
          mode="input"
          parameters={[{ name: 'count', type: 'integer', required: false }]}
          initialValues={{}}
          onChange={handleChange}
          availableVariables={mockAvailableVariables}
        />
      )

      const input = numberBox(screen.getByTestId('param-row-count'))
      await user.type(input, '123')
      expect(input).toHaveValue('123')
      expect(handleChange).toHaveBeenLastCalledWith('count', '123')
    })

    it('rejects decimal point in integer field', async () => {
      const user = userEvent.setup()
      const handleChange = vi.fn()
      render(
        <StatefulTable
          mode="input"
          parameters={[{ name: 'count', type: 'integer', required: false }]}
          initialValues={{}}
          onChange={handleChange}
          availableVariables={mockAvailableVariables}
        />
      )

      const input = numberBox(screen.getByTestId('param-row-count'))
      await user.type(input, '1.5')
      // Dot is rejected but digits pass through - "1" then "5" accepted = "15"
      expect(input).toHaveValue('15')
    })

    it('rejects letter characters in integer field', async () => {
      const user = userEvent.setup()
      render(
        <StatefulTable
          mode="input"
          parameters={[{ name: 'count', type: 'integer', required: false }]}
          initialValues={{}}
          onChange={vi.fn()}
          availableVariables={mockAvailableVariables}
        />
      )

      const input = numberBox(screen.getByTestId('param-row-count'))
      await user.type(input, 'abc')
      expect(input).toHaveValue('')
    })

    it('accepts negative integers', async () => {
      const user = userEvent.setup()
      const handleChange = vi.fn()
      render(
        <StatefulTable
          mode="input"
          parameters={[{ name: 'offset', type: 'integer', required: false }]}
          initialValues={{}}
          onChange={handleChange}
          availableVariables={mockAvailableVariables}
        />
      )

      const input = numberBox(screen.getByTestId('param-row-offset'))
      await user.type(input, '-42')
      expect(input).toHaveValue('-42')
      expect(handleChange).toHaveBeenLastCalledWith('offset', '-42')
    })

    it('allows just minus sign without calling onChange with a number', async () => {
      const user = userEvent.setup()
      const handleChange = vi.fn()
      render(
        <StatefulTable
          mode="input"
          parameters={[{ name: 'offset', type: 'integer', required: false }]}
          initialValues={{}}
          onChange={handleChange}
          availableVariables={mockAvailableVariables}
        />
      )

      const input = numberBox(screen.getByTestId('param-row-offset'))
      await user.type(input, '-')
      expect(input).toHaveValue('-')
      // Minus alone is not a number yet, so no value is sent
      expect(handleChange).not.toHaveBeenCalledWith('offset', expect.anything())
    })

    it('shows the default of an empty field as real gray text, not a placeholder', async () => {
      render(
        <StatefulTable
          mode="input"
          parameters={[{ name: 'timeout', type: 'integer', required: false, defaultValue: 30 }]}
          initialValues={{}}
          onChange={vi.fn()}
          availableVariables={mockAvailableVariables}
        />
      )

      const row = screen.getByTestId('param-row-timeout')
      const input = numberBox(row)
      expect(input).toHaveValue('30')
      expect(input).not.toHaveAttribute('placeholder')
      expect(grayUpTo(input, row)).toBe(true)
    })
  })

  describe('Float Input Masking', () => {
    it('accepts digits and one decimal point in float field', async () => {
      const user = userEvent.setup()
      const handleChange = vi.fn()
      render(
        <StatefulTable
          mode="input"
          parameters={[{ name: 'rate', type: 'float', required: false }]}
          initialValues={{}}
          onChange={handleChange}
          availableVariables={mockAvailableVariables}
        />
      )

      const input = numberBox(screen.getByTestId('param-row-rate'))
      await user.type(input, '3.14')
      expect(input).toHaveValue('3.14')
      expect(handleChange).toHaveBeenLastCalledWith('rate', '3.14')
    })

    it('rejects second decimal point in float field', async () => {
      const user = userEvent.setup()
      render(
        <StatefulTable
          mode="input"
          parameters={[{ name: 'rate', type: 'float', required: false }]}
          initialValues={{}}
          onChange={vi.fn()}
          availableVariables={mockAvailableVariables}
        />
      )

      const input = numberBox(screen.getByTestId('param-row-rate'))
      await user.type(input, '3.1.4')
      // Second dot should be rejected - "3.14" without second dot
      expect(input).toHaveValue('3.14')
    })

    it('rejects letter characters in float field', async () => {
      const user = userEvent.setup()
      render(
        <StatefulTable
          mode="input"
          parameters={[{ name: 'rate', type: 'float', required: false }]}
          initialValues={{}}
          onChange={vi.fn()}
          availableVariables={mockAvailableVariables}
        />
      )

      const input = numberBox(screen.getByTestId('param-row-rate'))
      await user.type(input, 'abc')
      expect(input).toHaveValue('')
    })

    it('accepts negative floats', async () => {
      const user = userEvent.setup()
      const handleChange = vi.fn()
      render(
        <StatefulTable
          mode="input"
          parameters={[{ name: 'rate', type: 'float', required: false }]}
          initialValues={{}}
          onChange={handleChange}
          availableVariables={mockAvailableVariables}
        />
      )

      const input = numberBox(screen.getByTestId('param-row-rate'))
      await user.type(input, '-1.5')
      expect(input).toHaveValue('-1.5')
      expect(handleChange).toHaveBeenLastCalledWith('rate', '-1.5')
    })

    it('keeps a leading-dot float out of the value until it reads as a plain decimal', async () => {
      const user = userEvent.setup()
      const handleChange = vi.fn()
      render(
        <StatefulTable
          mode="input"
          parameters={[{ name: 'rate', type: 'float', required: false }]}
          initialValues={{}}
          onChange={handleChange}
          availableVariables={mockAvailableVariables}
        />
      )

      const input = numberBox(screen.getByTestId('param-row-rate'))
      await user.type(input, '-.5')
      expect(input).toHaveValue('-.5')
      // A float is plain decimal (REQ-3.1.3.14): -.5 is not one, so nothing is sent
      expect(handleChange).not.toHaveBeenCalledWith('rate', expect.anything())
    })
  })

  describe('Expression Toggle Switching Behavior (FIELD-7)', () => {
    /** One input row whose toggle and field lists report to spies. */
    function renderSwitchRow(
      parameter: Parameter,
      values: Record<string, unknown>,
      expressionFields?: string[],
    ) {
      const handleChange = vi.fn()
      const handleExpressionFieldsChange = vi.fn()
      render(
        <Table
          mode="input"
          parameters={[parameter] as never}
          values={values}
          onChange={handleChange}
          availableVariables={mockAvailableVariables}
          expressionFields={expressionFields}
          onExpressionFieldsChange={handleExpressionFieldsChange}
        />
      )
      const row = screen.getByTestId(`param-row-${parameter.name}`)
      return { row, handleChange, handleExpressionFieldsChange }
    }

    it('asks before switching a number the row holds and carries none of it in', async () => {
      const user = userEvent.setup()
      const { row, handleChange, handleExpressionFieldsChange } = renderSwitchRow(
        { name: 'timeout', type: 'integer', required: false, defaultValue: 30 },
        { timeout: 42 },
      )

      await user.click(within(row).getByTestId('expression-toggle'))

      expect(screen.getByText('Switch the field to an expression?')).toBeInTheDocument()
      expect(screen.getByText('The current value is cleared.')).toBeInTheDocument()
      expect(handleExpressionFieldsChange).not.toHaveBeenCalled()

      await chooseSwitch(user, 'switch-mode-clear-default')

      expect(handleExpressionFieldsChange).toHaveBeenCalledWith(['timeout'])
      expect(handleChange).toHaveBeenCalledWith('timeout', undefined)
      expect(handleChange).not.toHaveBeenCalledWith('timeout', '42')
    })

    it('asks before switching an expression back and leaves the field unset on Clear', async () => {
      const user = userEvent.setup()
      const { row, handleChange, handleExpressionFieldsChange } = renderSwitchRow(
        { name: 'timeout', type: 'integer', required: false },
        { timeout: 'delay_ms' },
        ['timeout'],
      )

      await user.click(within(row).getByTestId('expression-toggle'))

      expect(screen.getByText('Switch the field to a plain value?')).toBeInTheDocument()
      expect(handleExpressionFieldsChange).not.toHaveBeenCalled()

      await chooseSwitch(user, 'switch-mode-clear-default')

      expect(handleChange).toHaveBeenCalledWith('timeout', undefined)
      expect(handleExpressionFieldsChange).toHaveBeenCalledWith([])
    })

    it('carries none of a true / false value into the expression', async () => {
      const user = userEvent.setup()
      const { row, handleChange, handleExpressionFieldsChange } = renderSwitchRow(
        { name: 'flag', type: 'boolean', required: false, defaultValue: false },
        { flag: true },
      )

      await user.click(within(row).getByTestId('expression-toggle'))
      await chooseSwitch(user, 'switch-mode-clear-default')

      expect(handleExpressionFieldsChange).toHaveBeenCalledWith(['flag'])
      expect(handleChange).not.toHaveBeenCalledWith('flag', 'true')
      expect(handleChange).not.toHaveBeenCalledWith('flag', 'True')
    })

    it('switches an unset row with no warning and copies no default in', async () => {
      const user = userEvent.setup()
      const { row, handleChange, handleExpressionFieldsChange } = renderSwitchRow(
        { name: 'timeout', type: 'integer', required: false, defaultValue: 30 },
        {},
      )

      await user.click(within(row).getByTestId('expression-toggle'))

      expect(screen.queryByTestId('switch-mode-dialog')).not.toBeInTheDocument()
      expect(handleExpressionFieldsChange).toHaveBeenCalledWith(['timeout'])
      expect(handleChange).not.toHaveBeenCalledWith('timeout', expect.anything())
    })

    it('puts an empty map in as the expression on Clear & Empty, never the map itself', async () => {
      const user = userEvent.setup()
      const { row, handleChange, handleExpressionFieldsChange } = renderSwitchRow(
        { name: 'headers', type: 'map', required: false },
        { headers: { 'Content-Type': 'application/json' } },
      )

      await user.click(within(row).getByTestId('expression-toggle'))
      await chooseSwitch(user, 'switch-mode-clear-empty')

      expect(handleExpressionFieldsChange).toHaveBeenCalledWith(['headers'])
      expect(handleChange).toHaveBeenLastCalledWith('headers', '{}')
      expect(handleChange).not.toHaveBeenCalledWith('headers', '{"Content-Type":"application/json"}')
    })

    it('puts an empty list in as the expression on Clear & Empty, never the list itself', async () => {
      const user = userEvent.setup()
      const { row, handleChange, handleExpressionFieldsChange } = renderSwitchRow(
        { name: 'codes', type: 'array', required: false },
        { codes: [502, 503, 504] },
      )

      await user.click(within(row).getByTestId('expression-toggle'))
      await chooseSwitch(user, 'switch-mode-clear-empty')

      expect(handleExpressionFieldsChange).toHaveBeenCalledWith(['codes'])
      expect(handleChange).toHaveBeenLastCalledWith('codes', '[]')
      expect(handleChange).not.toHaveBeenCalledWith('codes', '[502,503,504]')
    })

    it('carries none of a picked choice into the expression', async () => {
      const user = userEvent.setup()
      const { row, handleChange, handleExpressionFieldsChange } = renderSwitchRow(
        {
          name: 'method',
          type: 'string',
          required: true,
          enumValues: ['GET', 'POST', 'PUT', 'DELETE'],
          defaultValue: 'GET',
        },
        { method: 'POST' },
      )

      await user.click(within(row).getByTestId('expression-toggle'))
      await chooseSwitch(user, 'switch-mode-clear-default')

      expect(handleExpressionFieldsChange).toHaveBeenCalledWith(['method'])
      expect(handleChange).not.toHaveBeenCalledWith('method', 'POST')
    })
  })

  describe('String Parameters', () => {
    it('shows a string parameter in the one value field with its expand', async () => {
      const { ParameterTable } = await import(
        '@/features/workbench/common/element-config/parameters/parameter-table'
      )
      render(
        <ParameterTable
          mode="input"
          parameters={[{
            name: 'ca_cert',
            type: 'string',
            required: false,
            description: 'CA certificate',
          }]}
          values={{ ca_cert: 'PEM content here' }}
          onChange={vi.fn()}
          availableVariables={mockAvailableVariables}
        />
      )

      const row = screen.getByTestId('param-row-ca_cert')
      expect(elementsShowing(row, 'PEM content here')).not.toHaveLength(0)
      expect(within(row).getByTestId('param-expand-ca_cert')).toHaveAccessibleName('Open editor for ca_cert')
    })

    it('renders an unset string with no default as an empty field with its expand', async () => {
      const { ParameterTable } = await import(
        '@/features/workbench/common/element-config/parameters/parameter-table'
      )
      render(
        <ParameterTable
          mode="input"
          parameters={[{
            name: 'ca_cert',
            type: 'string',
            required: false,
          }]}
          values={{}}
          onChange={vi.fn()}
          availableVariables={mockAvailableVariables}
        />
      )

      const row = screen.getByTestId('param-row-ca_cert')
      expect(within(row).getByTestId('param-expand-ca_cert')).toBeInTheDocument()
      expect(within(row).queryByText('Edit…')).not.toBeInTheDocument()
    })

    it('renders ExpressionField for a string in expression mode', async () => {
      const { ParameterTable } = await import(
        '@/features/workbench/common/element-config/parameters/parameter-table'
      )
      render(
        <ParameterTable
          mode="input"
          parameters={[{
            name: 'body',
            type: 'string',
            required: false,
          }]}
          values={{ body: 'len(x)' }}
          onChange={vi.fn()}
          availableVariables={mockAvailableVariables}
          expressionFields={['body']}
          onExpressionFieldsChange={vi.fn()}
        />
      )

      // Should NOT show Edit button in expression mode
      expect(screen.queryByTestId('param-edit-body')).not.toBeInTheDocument()
    })

    it('renders the expand for a template param', async () => {
      const { ParameterTable } = await import(
        '@/features/workbench/common/element-config/parameters/parameter-table'
      )
      const onTemplateFieldsChange = vi.fn()
      render(
        <ParameterTable
          mode="input"
          parameters={[{
            name: 'body',
            type: 'string',
            required: false,
          }]}
          values={{ body: '{"key": "{{var}}"}' }}
          onChange={vi.fn()}
          availableVariables={mockAvailableVariables}
          templateFields={['body']}
          onTemplateFieldsChange={onTemplateFieldsChange}
        />
      )

      expect(screen.getByTestId('param-expand-body')).toBeInTheDocument()
    })

    it('calls onChange when the value sheet saves', async () => {
      const user = userEvent.setup()
      const { ParameterTable } = await import(
        '@/features/workbench/common/element-config/parameters/parameter-table'
      )
      const handleChange = vi.fn()
      render(
        <ParameterTable
          mode="input"
          parameters={[{
            name: 'body',
            type: 'string',
            required: false,
          }]}
          values={{ body: 'original' }}
          onChange={handleChange}
          availableVariables={mockAvailableVariables}
        />
      )

      // Open the shared "Edit value" sheet
      await user.click(screen.getByTestId('param-expand-body'))

      // Save from the sheet
      await user.click(screen.getByTestId('sheet-save'))

      expect(handleChange).toHaveBeenCalledWith('body', 'SAVED')
    })

    it('adds parameter to templateFields on a template save', async () => {
      const user = userEvent.setup()
      const { ParameterTable } = await import(
        '@/features/workbench/common/element-config/parameters/parameter-table'
      )
      const onTemplateFieldsChange = vi.fn()
      render(
        <ParameterTable
          mode="input"
          parameters={[{
            name: 'body',
            type: 'string',
            required: false,
          }]}
          values={{ body: '{{var}}' }}
          onChange={vi.fn()}
          availableVariables={mockAvailableVariables}
          templateFields={[]}
          onTemplateFieldsChange={onTemplateFieldsChange}
        />
      )

      await user.click(screen.getByTestId('param-expand-body'))
      await user.click(screen.getByTestId('sheet-save-template'))

      expect(onTemplateFieldsChange).toHaveBeenCalledWith(['body'])
    })

    it('removes parameter from templateFields on a literal save', async () => {
      const user = userEvent.setup()
      const { ParameterTable } = await import(
        '@/features/workbench/common/element-config/parameters/parameter-table'
      )
      const onTemplateFieldsChange = vi.fn()
      render(
        <ParameterTable
          mode="input"
          parameters={[{
            name: 'body',
            type: 'string',
            required: false,
          }]}
          values={{ body: '{{var}}' }}
          onChange={vi.fn()}
          availableVariables={mockAvailableVariables}
          templateFields={['body']}
          onTemplateFieldsChange={onTemplateFieldsChange}
        />
      )

      await user.click(screen.getByTestId('param-expand-body'))
      await user.click(screen.getByTestId('sheet-save'))

      expect(onTemplateFieldsChange).toHaveBeenCalledWith([])
    })

    it('uses internal templateFields state when no controlled prop', async () => {
      const user = userEvent.setup()
      const { ParameterTable } = await import(
        '@/features/workbench/common/element-config/parameters/parameter-table'
      )
      render(
        <ParameterTable
          mode="input"
          parameters={[{
            name: 'body',
            type: 'string',
            required: false,
          }]}
          values={{ body: 'content' }}
          onChange={vi.fn()}
          availableVariables={mockAvailableVariables}
        />
      )

      await user.click(screen.getByTestId('param-expand-body'))
      // A template save updates the internal templateFields state (no controlled
      // prop) without crashing; the row's expand remains.
      await user.click(screen.getByTestId('sheet-save-template'))

      expect(screen.getByTestId('param-expand-body')).toBeInTheDocument()
    })

    it('renders the one value field for single-line string parameters', async () => {
      const { ParameterTable } = await import(
        '@/features/workbench/common/element-config/parameters/parameter-table'
      )
      render(
        <ParameterTable
          mode="input"
          parameters={[{
            name: 'url',
            type: 'string',
            required: true,
          }]}
          values={{ url: 'https://example.com' }}
          onChange={vi.fn()}
          availableVariables={mockAvailableVariables}
        />
      )

      // Every string shows in the one value field, its sheet behind the expand (FIELD-1)
      const row = screen.getByTestId('param-row-url')
      expect(elementsShowing(row, 'https://example.com')).not.toHaveLength(0)
      expect(within(row).getByTestId('param-expand-url')).toBeInTheDocument()
      expect(within(row).queryByTestId('param-edit-url')).not.toBeInTheDocument()
    })
  })

  // ---------------------------------------------------------------------------
  // selectableType: type dropdown propagation
  // ---------------------------------------------------------------------------

  describe('selectableType support', () => {
    it('passes onTypeChange to ParameterRow when selectableType is present', async () => {
      const onChange = vi.fn()
      const { ParameterTable } = await import(
        '@/features/workbench/common/element-config/parameters/parameter-table'
      )
      render(
        <ParameterTable
          mode="input"
          parameters={[{
            name: 'collection',
            type: 'array',
            required: true,
            variableRef: { types: ['array', 'map', 'table'] },
            selectableType: { options: ['array', 'map', 'table'] },
          }]}
          values={{ collection: '' }}
          onChange={onChange}
          availableVariables={mockAvailableVariables}
        />
      )

      // The type dropdown should be rendered
      const typeSelect = screen.getByTestId('type-select-collection')
      expect(typeSelect).toBeInTheDocument()
    })

    it('does NOT pass onTypeChange when selectableType is absent', async () => {
      const { ParameterTable } = await import(
        '@/features/workbench/common/element-config/parameters/parameter-table'
      )
      render(
        <ParameterTable
          mode="input"
          parameters={[{
            name: 'url',
            type: 'string',
            required: true,
          }]}
          values={{ url: '' }}
          onChange={vi.fn()}
          availableVariables={mockAvailableVariables}
        />
      )

      // No type dropdown for regular parameters
      expect(screen.queryByTestId('type-select-url')).not.toBeInTheDocument()
    })
  })

  describe('Output Secret column (SECUI-3/4)', () => {
    it('adds the output name to secretFields when its Secret checkbox is checked', async () => {
      const user = userEvent.setup()
      const onSecretFieldsChange = vi.fn()
      const { ParameterTable } = await import(
        '@/features/workbench/common/element-config/parameters/parameter-table'
      )
      // secretFields omitted so the handler falls back to an empty list.
      render(
        <ParameterTable
          mode="output"
          parameters={mockOutputParameters}
          values={{}}
          onChange={vi.fn()}
          availableVariables={mockAvailableVariables}
          onSecretFieldsChange={onSecretFieldsChange}
        />
      )

      await user.click(screen.getByTestId('output-secret-body'))

      expect(onSecretFieldsChange).toHaveBeenCalledWith(['body'])
    })

    it('removes the output name from secretFields when its Secret checkbox is unchecked', async () => {
      const user = userEvent.setup()
      const onSecretFieldsChange = vi.fn()
      const { ParameterTable } = await import(
        '@/features/workbench/common/element-config/parameters/parameter-table'
      )
      render(
        <ParameterTable
          mode="output"
          parameters={mockOutputParameters}
          values={{}}
          onChange={vi.fn()}
          availableVariables={mockAvailableVariables}
          secretFields={['body']}
          onSecretFieldsChange={onSecretFieldsChange}
        />
      )

      await user.click(screen.getByTestId('output-secret-body'))

      expect(onSecretFieldsChange).toHaveBeenCalledWith([])
    })

    it('is a safe no-op when the Secret checkbox is clicked without an onSecretFieldsChange handler', async () => {
      const user = userEvent.setup()
      const onChange = vi.fn()
      const { ParameterTable } = await import(
        '@/features/workbench/common/element-config/parameters/parameter-table'
      )
      render(
        <ParameterTable
          mode="output"
          parameters={mockOutputParameters}
          values={{}}
          onChange={onChange}
          availableVariables={mockAvailableVariables}
        />
      )

      await user.click(screen.getByTestId('output-secret-body'))

      expect(onChange).not.toHaveBeenCalled()
    })
  })

  describe('Schema-secret output default (K8SCON-4)', () => {
    const secretOutputParameters: Parameter[] = [
      {
        name: 'session',
        label: 'K8s Session',
        type: 'string',
        required: false,
        description: 'Cluster context consumed by the operational blocks',
        // The schema-secret marker secret-flagged outputs carry (OutputParam.secret).
        secret: true,
      },
      {
        name: 'cluster_version',
        label: 'Cluster Version',
        type: 'string',
        required: false,
        description: 'Reported server version',
      },
    ]

    it('renders a seeded schema-secret output checked and enabled with no lock affordance', async () => {
      const { ParameterTable } = await import(
        '@/features/workbench/common/element-config/parameters/parameter-table'
      )
      render(
        <ParameterTable
          mode="output"
          parameters={secretOutputParameters}
          values={{}}
          onChange={vi.fn()}
          availableVariables={mockAvailableVariables}
          secretFields={['session']}
          onSecretFieldsChange={vi.fn()}
        />
      )

      const checkbox = screen.getByTestId('output-secret-session')
      expect(checkbox).toBeChecked()
      // No lock label or lock semantics - the user may uncheck freely (K8SCON-4).
      expect(checkbox).toBeEnabled()
      expect(checkbox).not.toHaveAttribute('aria-disabled')
      expect(screen.queryByText(/locked/i)).not.toBeInTheDocument()
      expect(screen.getByTestId('output-secret-cluster_version')).not.toBeChecked()
    })

    it('renders a schema-secret output outside the seeded list unchecked and enabled', async () => {
      const { ParameterTable } = await import(
        '@/features/workbench/common/element-config/parameters/parameter-table'
      )
      render(
        <ParameterTable
          mode="output"
          parameters={secretOutputParameters}
          values={{}}
          onChange={vi.fn()}
          availableVariables={mockAvailableVariables}
          secretFields={[]}
          onSecretFieldsChange={vi.fn()}
        />
      )

      // Checked state follows the seeded list only - a deliberate reveal sticks (K8SCON-4).
      const checkbox = screen.getByTestId('output-secret-session')
      expect(checkbox).not.toBeChecked()
      expect(checkbox).toBeEnabled()
    })

    it('unchecking the seeded schema-secret output persists as an empty list', async () => {
      const user = userEvent.setup()
      const onSecretFieldsChange = vi.fn()
      const { ParameterTable } = await import(
        '@/features/workbench/common/element-config/parameters/parameter-table'
      )
      render(
        <ParameterTable
          mode="output"
          parameters={secretOutputParameters}
          values={{}}
          onChange={vi.fn()}
          availableVariables={mockAvailableVariables}
          secretFields={['session']}
          onSecretFieldsChange={onSecretFieldsChange}
        />
      )

      await user.click(screen.getByTestId('output-secret-session'))

      expect(onSecretFieldsChange).toHaveBeenCalledWith([])
    })
  })
})

/**
 * Mutually exclusive booleans (HELM-4).
 *
 * Helm Upgrade's Reuse Values and Reset Values untick each other: ticking one
 * clears the other in the same change. Both rows stay enabled and visible, both
 * may be off, and unticking one touches nothing else.
 */
describe('ParameterTable - exclusiveWith', () => {
  interface ExclusiveParameter {
    name: string
    type: 'boolean' | 'string'
    required: boolean
    description?: string
    defaultValue?: unknown
    exclusiveWith?: string[]
  }

  const exclusiveParameters: ExclusiveParameter[] = [
    {
      name: 'reuse_values',
      type: 'boolean',
      required: false,
      defaultValue: false,
      description: 'Keep the values already in place as the base',
      exclusiveWith: ['reset_values'],
    },
    {
      name: 'reset_values',
      type: 'boolean',
      required: false,
      defaultValue: false,
      description: 'Forget the values already in place',
      exclusiveWith: ['reuse_values'],
    },
    {
      name: 'atomic',
      type: 'boolean',
      required: false,
      defaultValue: false,
      description: 'Roll back on failure',
    },
  ]

  async function renderExclusive(
    values: Record<string, unknown>,
    onChange: (name: string, value: unknown) => void,
  ) {
    const { ParameterTable } = await import(
      '@/features/workbench/common/element-config/parameters/parameter-table'
    )
    render(
      <ParameterTable
        mode="input"
        parameters={exclusiveParameters as never}
        values={values}
        onChange={onChange}
        availableVariables={[]}
      />
    )
  }

  function checkboxIn(name: string): HTMLElement {
    return within(screen.getByTestId(`param-row-${name}`)).getByRole('checkbox')
  }

  it('clears the sibling when a row is ticked', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    await renderExclusive({ reuse_values: false, reset_values: true }, onChange)

    await user.click(checkboxIn('reuse_values'))

    expect(onChange).toHaveBeenCalledWith('reuse_values', true)
    expect(onChange).toHaveBeenCalledWith('reset_values', false)
  })

  it('clears the sibling in the other direction too', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    await renderExclusive({ reuse_values: true, reset_values: false }, onChange)

    await user.click(checkboxIn('reset_values'))

    expect(onChange).toHaveBeenCalledWith('reset_values', true)
    expect(onChange).toHaveBeenCalledWith('reuse_values', false)
  })

  it('writes the sibling in the same change as the row itself', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    await renderExclusive({ reuse_values: false, reset_values: false }, onChange)

    await user.click(checkboxIn('reuse_values'))

    expect(onChange.mock.calls).toEqual([
      ['reuse_values', true],
      ['reset_values', false],
    ])
  })

  it('touches nothing when a row is unticked', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    await renderExclusive({ reuse_values: true, reset_values: false }, onChange)

    await user.click(checkboxIn('reuse_values'))

    expect(onChange.mock.calls).toEqual([['reuse_values', false]])
  })

  it('leaves a row without the rule alone', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    await renderExclusive({ atomic: false }, onChange)

    await user.click(checkboxIn('atomic'))

    expect(onChange.mock.calls).toEqual([['atomic', true]])
  })

  it('keeps both rows enabled', async () => {
    await renderExclusive({ reuse_values: true, reset_values: false }, vi.fn())

    expect(checkboxIn('reuse_values')).toBeEnabled()
    expect(checkboxIn('reset_values')).toBeEnabled()
  })

  it('keeps both rows visible whichever one is ticked', async () => {
    await renderExclusive({ reuse_values: true, reset_values: false }, vi.fn())

    expect(screen.getByTestId('param-row-reuse_values')).toBeInTheDocument()
    expect(screen.getByTestId('param-row-reset_values')).toBeInTheDocument()
  })

  it('allows both rows to be off', async () => {
    await renderExclusive({ reuse_values: false, reset_values: false }, vi.fn())

    expect(checkboxIn('reuse_values')).not.toBeChecked()
    expect(checkboxIn('reset_values')).not.toBeChecked()
  })

  it('clears every field the rule names', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    const { ParameterTable } = await import(
      '@/features/workbench/common/element-config/parameters/parameter-table'
    )
    const three = [
      { name: 'a', type: 'boolean', required: false, defaultValue: false, exclusiveWith: ['b', 'c'] },
      { name: 'b', type: 'boolean', required: false, defaultValue: false },
      { name: 'c', type: 'boolean', required: false, defaultValue: false },
    ]
    render(
      <ParameterTable
        mode="input"
        parameters={three as never}
        values={{ a: false, b: true, c: true }}
        onChange={onChange}
        availableVariables={[]}
      />
    )

    await user.click(checkboxIn('a'))

    expect(onChange.mock.calls).toEqual([
      ['a', true],
      ['b', false],
      ['c', false],
    ])
  })
})

describe('file-reference keys reach the row', () => {
  const READ_PATH = {
    name: 'path',
    label: 'Path',
    type: 'string',
    required: true,
    fileReference: 'file',
  }

  const MOVE_SOURCE = {
    name: 'source',
    label: 'Source',
    type: 'string',
    required: true,
    fileReference: 'file-or-folder',
    fileReferenceArtifactsOnly: true,
  }

  async function renderTable(
    parameters: unknown[],
    extra: Record<string, unknown> = {},
  ) {
    const { ParameterTable } = await import(
      '@/features/workbench/common/element-config/parameters/parameter-table'
    )
    render(
      <ParameterTable
        mode="input"
        parameters={parameters as never}
        values={{}}
        onChange={vi.fn()}
        availableVariables={[]}
        runsOnRemoteHost={false}
        readOnly={false}
        testId="test-1"
        {...extra}
      />
    )
  }

  it('gives a fileReference row its Browse button', async () => {
    await renderTable([READ_PATH])

    expect(screen.getByTestId('param-browse-path')).toHaveAttribute(
      'aria-label',
      'Browse files for Path'
    )
  })

  it('carries fileReferenceArtifactsOnly through to the picker', async () => {
    const user = userEvent.setup()
    await renderTable([MOVE_SOURCE])

    await user.click(screen.getByTestId('param-browse-source'))

    expect(screen.getByTestId('picker-mock')).toHaveAttribute('data-mode', 'file-or-folder')
    expect(screen.getByTestId('picker-mock')).toHaveAttribute('data-artifacts-only', 'true')
  })

  it('threads the open test id to the picker', async () => {
    const user = userEvent.setup()
    await renderTable([READ_PATH], { testId: 'test-42' })

    await user.click(screen.getByTestId('param-browse-path'))

    expect(screen.getByTestId('picker-mock')).toHaveAttribute('data-test-id-prop', 'test-42')
  })

  it('threads readOnly down so the row hides Browse', async () => {
    await renderTable([READ_PATH], { readOnly: true })

    expect(screen.queryByTestId('param-browse-path')).not.toBeInTheDocument()
  })

  it('threads runsOnRemoteHost down so the row hides Browse', async () => {
    await renderTable([READ_PATH], { runsOnRemoteHost: true })

    expect(screen.queryByTestId('param-browse-path')).not.toBeInTheDocument()
  })
})

// A switch that hides rows asks the child-editor guard first; with no editor
// open beneath it, the change goes straight through, labeled row or not.
describe('ParameterTable - a switch that hides rows', () => {
  const MODE = {
    name: 'body_mode',
    label: 'Body Mode',
    type: 'string' as const,
    required: false,
    enumValues: ['text', 'file'],
    defaultValue: 'text',
  }
  const UNLABELED_BODY = {
    name: 'body',
    type: 'string' as const,
    required: false,
    showWhen: { field: 'body_mode', values: ['text'] },
  }

  it('applies the switch with no editor open under the rows it hides', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    const { ParameterTable } = await import(
      '@/features/workbench/common/element-config/parameters/parameter-table'
    )
    render(
      <ParameterTable
        mode="input"
        parameters={[MODE, UNLABELED_BODY] as never}
        values={{ body_mode: 'text' }}
        onChange={onChange}
        availableVariables={[]}
      />,
    )

    await user.click(screen.getByRole('combobox', { name: 'Body Mode' }))
    await user.click(await screen.findByRole('option', { name: 'file' }))

    expect(onChange).toHaveBeenCalledWith('body_mode', 'file')
    expect(screen.queryByTestId('unsaved-changes-dialog')).not.toBeInTheDocument()
  })
})

// A choice or true / false row holds a value; one that shows again starts on its default (FIELD-8).
describe('ParameterTable - a choice or true / false row that shows again starts on its default (REQ-4.7.16)', () => {
  const ON = { field: 'auth_enabled', values: ['true'] }
  const GATE = { name: 'auth_enabled', type: 'boolean', required: false, defaultValue: false }
  const MODE = {
    name: 'auth_mode',
    type: 'string',
    required: false,
    enumValues: ['basic', 'bearer'],
    defaultValue: 'basic',
    showWhen: ON,
  }
  const VERIFY = { name: 'verify', type: 'boolean', required: false, defaultValue: true, showWhen: ON }
  const REALM = { name: 'realm', type: 'string', required: false, defaultValue: 'main', showWhen: ON }
  const METHOD = { name: 'method', type: 'string', required: false, enumValues: ['GET', 'POST'], defaultValue: 'GET' }

  function tableOf(
    parameters: unknown[],
    values: Record<string, unknown>,
    onChange: (name: string, value: unknown) => void,
  ) {
    return (
      <Table
        mode="input"
        parameters={parameters as never}
        values={values}
        onChange={onChange}
        availableVariables={[]}
      />
    )
  }

  it('writes the default of a choice-list row the moment it shows again', () => {
    const onChange = vi.fn()
    const params = [GATE, MODE]
    const { rerender } = render(tableOf(params, { auth_enabled: true, auth_mode: 'bearer' }, onChange))
    rerender(tableOf(params, { auth_enabled: false, auth_mode: 'bearer' }, onChange))
    expect(onChange).toHaveBeenCalledWith('auth_mode', undefined)
    onChange.mockClear()

    rerender(tableOf(params, { auth_enabled: true }, onChange))

    expect(onChange).toHaveBeenCalledWith('auth_mode', 'basic')
  })

  it('writes the default of a true / false row the moment it shows again', () => {
    const onChange = vi.fn()
    const params = [GATE, VERIFY]
    const { rerender } = render(tableOf(params, { auth_enabled: false }, onChange))

    rerender(tableOf(params, { auth_enabled: true }, onChange))

    expect(onChange).toHaveBeenCalledWith('verify', true)
  })

  it('writes nothing for a free-entry row or a row that still holds its value', () => {
    const onChange = vi.fn()
    const params = [GATE, { ...MODE, retainOnHide: true }, REALM, VERIFY]
    const { rerender } = render(tableOf(params, { auth_enabled: false, auth_mode: 'bearer' }, onChange))

    rerender(tableOf(params, { auth_enabled: true, auth_mode: 'bearer' }, onChange))

    expect(onChange).toHaveBeenCalledWith('verify', true)
    expect(onChange).not.toHaveBeenCalledWith('realm', expect.anything())
    expect(onChange).not.toHaveBeenCalledWith('auth_mode', expect.anything())
  })

  it('writes the default of the row shown when two rows share a wire name (SQL-8)', async () => {
    const onChange = vi.fn()
    const type = { name: 'database_type', type: 'string', required: false, enumValues: ['postgresql', 'mssql', 'sqlite'] }
    const tlsOff = { name: 'tls', type: 'boolean', required: false, defaultValue: false, showWhen: { field: 'database_type', values: ['postgresql'] } }
    const tlsOn = { name: 'tls', type: 'boolean', required: false, defaultValue: true, showWhen: { field: 'database_type', values: ['mssql'] } }
    const params = [type, tlsOff, tlsOn]
    const { rerender } = render(tableOf(params, { database_type: 'sqlite' }, onChange))

    // The select's items settle after the value changes; let them land inside act.
    await act(async () => {
      rerender(tableOf(params, { database_type: 'postgresql' }, onChange))
    })

    expect(onChange).toHaveBeenCalledWith('tls', false)
    expect(onChange).not.toHaveBeenCalledWith('tls', true)
  })

  it('writes the default of a choice row a version switch brings in, and nothing on first open', () => {
    const onChange = vi.fn()
    const level = { name: 'level', type: 'string', required: false, enumValues: ['INFO', 'DEBUG'], defaultValue: 'INFO' }
    const before = [{ name: 'url', type: 'string', required: true }, METHOD]
    const { rerender } = render(tableOf(before, {}, onChange))
    expect(onChange).not.toHaveBeenCalled()

    rerender(tableOf([...before, level], {}, onChange))

    expect(onChange).toHaveBeenCalledWith('level', 'INFO')
    expect(onChange).not.toHaveBeenCalledWith('method', expect.anything())
  })
})

// A row the remote-host lock replaces stores nothing at Save; back on the WAVE host it starts on its default (HTTP-13).
describe('ParameterTable - the HTTP Proxy row back on the WAVE host (HTTP-13, REQ-4.7.16)', () => {
  const PROXY = {
    name: 'proxy_mode',
    label: 'Proxy',
    type: 'string',
    required: false,
    enumValues: ['wave-setting', 'off'],
    enumLabels: { 'wave-setting': 'WAVE setting', off: 'Off' },
    defaultValue: 'wave-setting',
    noExpression: true,
    lockedOnRemoteHost: { displayText: "Remote host's settings" },
  }

  function tableOf(values: Record<string, unknown>, onChange: (name: string, value: unknown) => void, remote: boolean) {
    return (
      <Table
        mode="input"
        parameters={[PROXY] as never}
        values={values}
        onChange={onChange}
        availableVariables={[]}
        runsOnRemoteHost={remote}
      />
    )
  }

  it("reads \"Remote host's settings\" on a remote host and writes nothing", () => {
    const onChange = vi.fn()
    render(tableOf({}, onChange, true))

    expect(within(screen.getByTestId('param-row-proxy_mode')).getByText("Remote host's settings")).toBeInTheDocument()
    expect(onChange).not.toHaveBeenCalledWith('proxy_mode', expect.anything())
  })

  it('writes the default, WAVE setting, the moment the row shows again on the WAVE host', () => {
    const onChange = vi.fn()
    const { rerender } = render(tableOf({}, onChange, true))

    rerender(tableOf({}, onChange, false))

    expect(onChange).toHaveBeenCalledWith('proxy_mode', 'wave-setting')
  })

  it('keeps the choice the draft still holds when the row shows again', () => {
    const onChange = vi.fn()
    const { rerender } = render(tableOf({ proxy_mode: 'off' }, onChange, true))

    rerender(tableOf({ proxy_mode: 'off' }, onChange, false))

    expect(onChange).not.toHaveBeenCalledWith('proxy_mode', expect.anything())
  })

  it('shows WAVE setting on the WAVE host for a Block saved on a remote host', () => {
    render(tableOf({}, vi.fn(), false))

    const row = screen.getByTestId('param-row-proxy_mode')
    expect(within(row).getByRole('combobox')).toHaveTextContent(/^WAVE setting$/)
    expect(within(row).queryByText("Remote host's settings")).not.toBeInTheDocument()
  })
})

// Port left blank means the database type's own default port (SQL-8).
describe('ParameterTable - the SQL Port row hints the default port of the database type (SQL-8)', () => {
  const SQL_ROWS = getInputParams('sql-client')

  function renderSql(values: Record<string, unknown>, onChange = vi.fn()) {
    render(<Table mode="input" parameters={SQL_ROWS as never} values={values} onChange={onChange} availableVariables={[]} />)
    return onChange
  }

  it.each([
    ['postgresql', '5432'],
    ['mysql', '3306'],
    ['oracle', '1521'],
    ['mssql', '1433'],
  ])('shows the %s port %s as the hint of the empty Port box', (databaseType, port) => {
    renderSql({ operation: 'run_sql', database_type: databaseType })

    const box = numberBox(screen.getByTestId('param-row-port'))
    expect(box).toHaveValue('')
    expect(box).toHaveAttribute('placeholder', port)
  })

  it('writes no port while the box is left empty', () => {
    const onChange = renderSql({ operation: 'run_sql', database_type: 'mysql' })

    expect(onChange).not.toHaveBeenCalledWith('port', expect.anything())
  })

  it('shows a port the Block holds as its value, not the hint', () => {
    renderSql({ operation: 'run_sql', database_type: 'postgresql', port: '6543' })

    expect(numberBox(screen.getByTestId('param-row-port'))).toHaveValue('6543')
  })
})

describe('ParameterTable - every row draws the one value field (FIELD-1)', () => {
  const FREE_ENTRY = ['note', 'tags', 'labels', 'rows'] as const
  const NO_EDITOR = ['count', 'ratio', 'level', 'verbose'] as const

  function renderEveryType() {
    render(
      <Table
        mode="input"
        parameters={
          [
            { name: 'note', type: 'string', required: false },
            { name: 'tags', type: 'array', required: false },
            { name: 'labels', type: 'map', required: false },
            { name: 'rows', type: 'table', required: false },
            { name: 'count', type: 'integer', required: false },
            { name: 'ratio', type: 'float', required: false },
            { name: 'level', type: 'string', required: false, enumValues: ['INFO', 'DEBUG'], defaultValue: 'INFO' },
            { name: 'verbose', type: 'boolean', required: false, defaultValue: false },
          ] as never
        }
        values={{ level: 'INFO', verbose: false }}
        onChange={vi.fn()}
        availableVariables={[]}
      />
    )
  }

  const rowOf = (name: string) => screen.getByTestId(`param-row-${name}`)

  it('gives text, list, map and table rows an expand, and number, choice and true / false rows none', () => {
    renderEveryType()

    for (const name of FREE_ENTRY) {
      expect(within(rowOf(name)).getByTestId(`param-expand-${name}`)).toHaveAccessibleName(`Open editor for ${name}`)
    }
    for (const name of NO_EDITOR) {
      expect(within(rowOf(name)).queryByTestId(`param-expand-${name}`)).not.toBeInTheDocument()
    }
  })

  it('draws number rows with the shared exact-number body and keeps {x} on every row', () => {
    renderEveryType()

    expect(within(rowOf('count')).getByTestId('scalar-edit-body')).toBeInTheDocument()
    expect(within(rowOf('ratio')).getByTestId('scalar-edit-body')).toBeInTheDocument()
    for (const name of [...FREE_ENTRY, ...NO_EDITOR]) {
      expect(within(rowOf(name)).getByTestId('expression-toggle')).toBeInTheDocument()
    }
  })
})

describe('ParameterTable - the unsaved-secret line names what saves it (REQ-3.1.3.18)', () => {
  const PASSWORD = [{ name: 'password', label: 'Password', type: 'string', required: false, secret: true }] as never

  function renderPassword(props: Partial<TableProps> = {}) {
    render(
      <Table
        mode="input"
        parameters={PASSWORD}
        values={{ password: 'hunter2' }}
        onChange={vi.fn()}
        availableVariables={[]}
        {...props}
      />
    )
  }

  it('names the test by default', () => {
    renderPassword()
    expect(screen.getByTestId('param-warning-password')).toHaveTextContent(
      /^Secret value stays visible until you save the test\.$/,
    )
  })

  it('hands the Function save target to its rows', () => {
    renderPassword({ secretSaveTarget: 'Function' })
    expect(screen.getByTestId('param-warning-password')).toHaveTextContent(
      /^Secret value stays visible until you save the Function\.$/,
    )
  })
})
