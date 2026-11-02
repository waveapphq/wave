/**
 * Unit tests for JsonQueryEditor component - REQ-3.4.1.14
 *
 * Tests the custom inline JSONPath query editing UI for the JSON Parser plugin.
 * Each query row has two lines:
 * - Line 1: JSONPath expression (full width) + expression toggle
 * - Line 2: alias/var_name + [type dropdown (individual)] + test button + delete button
 */
import React from 'react'
import { render, screen, within, waitFor, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

// Mock jsonpath-evaluator before importing the component
/* eslint-disable @typescript-eslint/no-explicit-any */
const mockEvaluateJsonPath = vi.fn((_json: any, _jsonpath: any): any => ({
  success: true,
  type: 'string',
  value: 'test-result',
}))
const mockValidateJsonPathSyntax = vi.fn((_expr: any, _json?: any): any => null)
/* eslint-enable @typescript-eslint/no-explicit-any */

vi.mock('@/features/workbench/lib/jsonpath-evaluator', () => ({
  evaluateJsonPath: (json: string, jsonpath: string) =>
    mockEvaluateJsonPath(json, jsonpath),
  validateJsonPathSyntax: (expr: string, json?: string) => mockValidateJsonPathSyntax(expr, json),
}))

// Mock ExpressionField as simple input (CodeMirror not available in jsdom)
vi.mock('@/features/workbench/common/element-config/expressions/expression-field', () => ({
  ExpressionField: ({
    value,
    onChange,
    name,
  }: {
    value: string
    onChange: (v: string) => void
    name: string
    placeholder?: string
    availableVariables?: unknown[]
    isFieldExpression?: boolean
  }) =>
    React.createElement('input', {
      'data-testid': `expression-input-${name}`,
      value: value ?? '',
      onChange: (e: React.ChangeEvent<HTMLInputElement>) => onChange(e.target.value),
    }),
}))

// Mock useViewport for Tooltip component (returns desktop by default)
vi.mock('@/hooks/use-viewport', () => ({
  useViewport: () => ({
    width: 1280,
    height: 800,
    breakpoint: 'xl',
    isAtLeast: () => true,
    isBelow: () => false,
    isMobile: false,
    isTablet: false,
    isDesktop: true,
    sidebarShouldBeVisible: true,
    canvasInteractionEnabled: true,
    isTouchDevice: false,
  }),
}))

import { JsonQueryEditor, type JsonQueryEditorProps } from '@/features/workbench/common/editors/json-query-editor'
import { JsonNumberText } from '@/lib/variable-format'

import { expectRequiredMark } from '../../../../utils/required-mark'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const defaultProps: JsonQueryEditorProps = {
  queries: {},
  expressionFields: [],
  queryOutputTypes: {},
  outputMode: 'combined',
  jsonContent: '{"store": {"name": "Test"}}',
  jsonContentIsExpression: false,
  availableVariables: [],
  onQueriesChange: vi.fn(),
  onExpressionFieldsChange: vi.fn(),
  onQueryOutputTypesChange: vi.fn(),
  onValidChange: vi.fn(),
}

function renderEditor(overrides: Partial<JsonQueryEditorProps> = {}) {
  const props = { ...defaultProps, ...overrides }
  // Re-create callbacks so each render gets fresh mocks
  if (!overrides.onQueriesChange) props.onQueriesChange = vi.fn()
  if (!overrides.onExpressionFieldsChange) props.onExpressionFieldsChange = vi.fn()
  if (!overrides.onQueryOutputTypesChange) props.onQueryOutputTypesChange = vi.fn()
  if (!overrides.onValidChange) props.onValidChange = vi.fn()

  return {
    ...render(<JsonQueryEditor {...props} />),
    props,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  // Default: valid JSONPath syntax
  mockValidateJsonPathSyntax.mockReturnValue(null)
  mockEvaluateJsonPath.mockReturnValue({ success: true, type: 'string', value: 'test-result' })
})

// =============================================================================
// Rendering - Empty State
// =============================================================================

describe('Rendering - empty state', () => {
  it('renders "Add Query" button', () => {
    renderEditor()
    expect(screen.getByTestId('json-query-add-button')).toBeInTheDocument()
    expect(screen.getByTestId('json-query-add-button')).toHaveTextContent('Add Query')
  })

  it('starts with one empty query row when queries prop is empty', () => {
    renderEditor()
    expect(screen.getByTestId('json-query-row-0')).toBeInTheDocument()
  })

  it('shows the "Queries" label with required asterisk', () => {
    renderEditor()
    expect(screen.getByText('Queries')).toBeInTheDocument()
    // The asterisk is in a sibling span
    expect(screen.getByText('*')).toBeInTheDocument()
  })

  it('marks the "Queries" label with the shared RequiredMark', () => {
    renderEditor()
    expectRequiredMark(screen.getByText('Queries'))
  })

  it('has empty jsonpath and alias inputs in the empty row', () => {
    renderEditor()
    expect(screen.getByTestId('json-query-jsonpath-0')).toHaveValue('')
    expect(screen.getByTestId('json-query-alias-0')).toHaveValue('')
  })

  it('calls onValidChange(false) on initial render for empty alias', () => {
    const { props } = renderEditor()
    // Empty alias triggers "Name is required" validation error
    expect(props.onValidChange).toHaveBeenCalledWith(false)
  })
})

// =============================================================================
// Rendering - With Existing Queries
// =============================================================================

describe('Rendering - with existing queries', () => {
  it('renders rows for each query in the queries prop', () => {
    renderEditor({
      queries: { status: '$.status', name: '$.name' },
      queryOutputTypes: { status: 'string', name: 'string' },
    })
    expect(screen.getByTestId('json-query-row-0')).toBeInTheDocument()
    expect(screen.getByTestId('json-query-row-1')).toBeInTheDocument()
  })

  it('populates jsonpath and alias from the queries prop', () => {
    renderEditor({
      queries: { status: '$.status' },
      queryOutputTypes: { status: 'string' },
    })
    expect(screen.getByTestId('json-query-jsonpath-0')).toHaveValue('$.status')
    expect(screen.getByTestId('json-query-alias-0')).toHaveValue('status')
  })

  it('calls onValidChange(true) when all queries are valid', () => {
    const { props } = renderEditor({
      queries: { status: '$.status' },
      queryOutputTypes: { status: 'string' },
    })
    expect(props.onValidChange).toHaveBeenCalledWith(true)
  })
})

// =============================================================================
// Adding Queries
// =============================================================================

describe('Adding queries', () => {
  it('clicking "Add Query" creates a new empty row', async () => {
    const user = userEvent.setup({ delay: null })
    renderEditor({
      queries: { status: '$.status' },
      queryOutputTypes: { status: 'string' },
    })

    await user.click(screen.getByTestId('json-query-add-button'))

    expect(screen.getByTestId('json-query-row-1')).toBeInTheDocument()
    expect(screen.getByTestId('json-query-alias-1')).toHaveValue('')
  })

  it('new row has empty jsonpath input', async () => {
    const user = userEvent.setup({ delay: null })
    renderEditor({
      queries: { status: '$.status' },
      queryOutputTypes: { status: 'string' },
    })

    await user.click(screen.getByTestId('json-query-add-button'))

    expect(screen.getByTestId('json-query-jsonpath-1')).toHaveValue('')
  })
})

// =============================================================================
// Deleting Queries
// =============================================================================

describe('Deleting queries', () => {
  it('clicking delete removes the query row', async () => {
    const user = userEvent.setup({ delay: null })
    const { props } = renderEditor({
      queries: { status: '$.status', name: '$.name' },
      queryOutputTypes: { status: 'string', name: 'string' },
    })

    await user.click(screen.getByTestId('json-query-delete-0'))

    // Only one row remains
    expect(screen.getByTestId('json-query-row-0')).toBeInTheDocument()
    expect(screen.queryByTestId('json-query-row-1')).not.toBeInTheDocument()
    // onQueriesChange called with remaining query only
    expect(props.onQueriesChange).toHaveBeenCalledWith({ name: '$.name' })
  })

  it('deleting the last row replaces it with an empty row', async () => {
    const user = userEvent.setup({ delay: null })
    renderEditor({
      queries: { status: '$.status' },
      queryOutputTypes: { status: 'string' },
    })

    await user.click(screen.getByTestId('json-query-delete-0'))

    // Should still have one row, but it is now empty
    expect(screen.getByTestId('json-query-row-0')).toBeInTheDocument()
    expect(screen.getByTestId('json-query-alias-0')).toHaveValue('')
    expect(screen.getByTestId('json-query-jsonpath-0')).toHaveValue('')
  })

  it('delete button is disabled for the single empty default row', () => {
    renderEditor()
    expect(screen.getByTestId('json-query-delete-0')).toBeDisabled()
  })
})

// =============================================================================
// Editing JSONPath
// =============================================================================

describe('Editing JSONPath', () => {
  it('changing JSONPath input calls onQueriesChange with updated queries', async () => {
    const user = userEvent.setup({ delay: null })
    const { props } = renderEditor({
      queries: { status: '$.status' },
      queryOutputTypes: { status: 'string' },
    })

    const jsonpathInput = screen.getByTestId('json-query-jsonpath-0')
    await user.clear(jsonpathInput)
    await user.type(jsonpathInput, '$.name')

    expect(props.onQueriesChange).toHaveBeenCalledWith({ status: '$.name' })
  })
})

// =============================================================================
// Editing Alias
// =============================================================================

describe('Editing alias', () => {
  it('changing alias input calls onQueriesChange', async () => {
    const user = userEvent.setup({ delay: null })
    const { props } = renderEditor({
      queries: { status: '$.status' },
      queryOutputTypes: { status: 'string' },
    })

    const aliasInput = screen.getByTestId('json-query-alias-0')
    await user.clear(aliasInput)
    await user.type(aliasInput, 'result')

    expect(props.onQueriesChange).toHaveBeenCalledWith({ result: '$.status' })
  })
})

// =============================================================================
// Validation - Empty Alias
// =============================================================================

describe('Validation - empty alias', () => {
  it('shows "Name is required" error after alias field is touched (blur)', async () => {
    const user = userEvent.setup({ delay: null })
    renderEditor()

    const aliasInput = screen.getByTestId('json-query-alias-0')
    await user.click(aliasInput)
    await user.tab() // blur

    expect(screen.getByRole('alert')).toHaveTextContent('Name is required')
  })

  it('shows the alias error eagerly before the field is touched', () => {
    renderEditor()
    // A blocking alias error surfaces immediately so a disabled Save always
    // has a visible culprit - no touch/blur required.
    const alerts = screen.queryAllByRole('alert')
    expect(alerts.filter((a) => a.textContent === 'Name is required')).toHaveLength(1)
  })

  it('outlines the empty alias input red eagerly', () => {
    renderEditor()
    expect(screen.getByTestId('json-query-alias-0').className).toContain('border-destructive')
  })
})

// =============================================================================
// Validation - Duplicate Alias
// =============================================================================

describe('Validation - duplicate alias', () => {
  it('shows "Duplicate query name" error for duplicate aliases', async () => {
    const user = userEvent.setup({ delay: null })
    renderEditor({
      queries: { status: '$.status' },
      queryOutputTypes: { status: 'string' },
    })

    // Add a second row
    await user.click(screen.getByTestId('json-query-add-button'))

    // Type the same alias in the second row
    const aliasInput = screen.getByTestId('json-query-alias-1')
    await user.type(aliasInput, 'status')
    // Blur to mark as touched
    await user.tab()

    // Both colliding rows are flagged eagerly (every blocking field outlined).
    expect(screen.getAllByText('Duplicate query name')).toHaveLength(2)
  })
})

// =============================================================================
// Validation - Invalid JSONPath
// =============================================================================

describe('Validation - invalid JSONPath syntax', () => {
  it('shows error for invalid JSONPath after jsonpath field is touched', async () => {
    const user = userEvent.setup({ delay: null })
    mockValidateJsonPathSyntax.mockReturnValue('Invalid JSONPath expression')

    renderEditor({
      queries: { status: '$.status' },
      queryOutputTypes: { status: 'string' },
    })

    const jsonpathInput = screen.getByTestId('json-query-jsonpath-0')
    await user.clear(jsonpathInput)
    // Use fireEvent to avoid userEvent interpreting '[' as a key descriptor
    fireEvent.change(jsonpathInput, { target: { value: '$..invalid[' } })
    // Blur to mark as touched
    fireEvent.blur(jsonpathInput)

    expect(screen.getByText('Invalid JSONPath expression')).toBeInTheDocument()
  })

  it('calls onValidChange(false) when JSONPath validation fails', async () => {
    const user = userEvent.setup({ delay: null })
    mockValidateJsonPathSyntax.mockReturnValue('Bad JSONPath')

    const { props } = renderEditor({
      queries: { status: '$.status' },
      queryOutputTypes: { status: 'string' },
    })

    vi.mocked(props.onValidChange!).mockClear()

    const jsonpathInput = screen.getByTestId('json-query-jsonpath-0')
    await user.clear(jsonpathInput)
    await user.type(jsonpathInput, '$..bad')

    expect(props.onValidChange).toHaveBeenCalledWith(false)
  })

  it('does not validate JSONPath for expression-mode queries', async () => {
    mockValidateJsonPathSyntax.mockReturnValue('Invalid JSONPath expression')

    renderEditor({
      queries: { status: '$.status' },
      expressionFields: ['queries.status'],
      queryOutputTypes: { status: 'string' },
    })

    // The row is in expression mode so jsonpath validation is skipped
    const jsonpathTouched = screen.getByTestId('json-query-row-0')
    // In expression mode, ExpressionField is rendered instead of Input
    expect(within(jsonpathTouched).getByTestId('expression-input-jsonpath-0')).toBeInTheDocument()
    // No JSONPath error should be shown
    expect(screen.queryByText('Invalid JSONPath expression')).not.toBeInTheDocument()
  })
})

// =============================================================================
// Validation - Invalid Alias Pattern
// =============================================================================

describe('Validation - invalid alias pattern', () => {
  it('shows error for alias starting with a number', async () => {
    const user = userEvent.setup({ delay: null })
    renderEditor()

    const aliasInput = screen.getByTestId('json-query-alias-0')
    await user.type(aliasInput, '1invalid')
    await user.tab()

    expect(
      screen.getByText('Must start with a letter or underscore, contain only letters, numbers, and underscores')
    ).toBeInTheDocument()
  })
})

// =============================================================================
// Expression Toggle
// =============================================================================

describe('Expression toggle', () => {
  it('draws the shared {x} toggle named by its query', async () => {
    const user = userEvent.setup({ delay: null })
    renderEditor({
      queries: { status: '$.status' },
      queryOutputTypes: { status: 'string' },
    })
    const toggle = screen.getByTestId('json-query-expr-toggle-0')
    expect(toggle).toHaveAttribute('data-slot', 'expression-toggle')
    expect(toggle).toHaveAccessibleName(/^Query 1 expression mode$/)
    await user.click(toggle)
    expect(screen.getByTestId('json-query-expr-toggle-0')).toHaveAttribute('data-state', 'on')
  })

  it('toggling expression mode switches JSONPath input to ExpressionField', async () => {
    const user = userEvent.setup({ delay: null })
    renderEditor({
      queries: { status: '$.status' },
      queryOutputTypes: { status: 'string' },
    })

    // Before toggle: regular input
    expect(screen.getByTestId('json-query-jsonpath-0')).toBeInTheDocument()

    // Toggle expression mode
    await user.click(screen.getByTestId('json-query-expr-toggle-0'))

    // After toggle: ExpressionField (mocked as input with different testid)
    expect(screen.getByTestId('expression-input-jsonpath-0')).toBeInTheDocument()
    expect(screen.queryByTestId('json-query-jsonpath-0')).not.toBeInTheDocument()
  })

  it('toggling expression mode calls onExpressionFieldsChange', async () => {
    const user = userEvent.setup({ delay: null })
    const { props } = renderEditor({
      queries: { status: '$.status' },
      queryOutputTypes: { status: 'string' },
    })

    await user.click(screen.getByTestId('json-query-expr-toggle-0'))

    expect(props.onExpressionFieldsChange).toHaveBeenCalledWith(
      expect.arrayContaining(['queries.status'])
    )
  })

  it('toggling expression mode disables test button', async () => {
    const user = userEvent.setup({ delay: null })
    renderEditor({
      queries: { status: '$.status' },
      queryOutputTypes: { status: 'string' },
    })

    await user.click(screen.getByTestId('json-query-expr-toggle-0'))

    expect(screen.getByTestId('json-query-test-0')).toBeDisabled()
  })
})

// =============================================================================
// Output Mode - Individual
// =============================================================================

describe('Output mode switching', () => {
  it('in individual mode, type dropdown appears', () => {
    renderEditor({
      queries: { status: '$.status' },
      queryOutputTypes: { status: 'string' },
      outputMode: 'individual',
    })

    expect(screen.getByTestId('json-query-type-0')).toBeInTheDocument()
  })

  it('in combined mode, type dropdown does not appear', () => {
    renderEditor({
      queries: { status: '$.status' },
      queryOutputTypes: { status: 'string' },
      outputMode: 'combined',
    })

    expect(screen.queryByTestId('json-query-type-0')).not.toBeInTheDocument()
  })

  it('alias placeholder changes based on output mode', () => {
    const { unmount } = render(
      <JsonQueryEditor
        {...defaultProps}
        queries={{ status: '$.status' }}
        queryOutputTypes={{ status: 'string' }}
        outputMode="individual"
      />
    )
    expect(screen.getByTestId('json-query-alias-0')).toHaveAttribute('placeholder', 'Variable name')
    unmount()

    render(
      <JsonQueryEditor
        {...defaultProps}
        queries={{ status: '$.status' }}
        queryOutputTypes={{ status: 'string' }}
        outputMode="combined"
      />
    )
    expect(screen.getByTestId('json-query-alias-0')).toHaveAttribute('placeholder', 'Result alias')
  })
})

// =============================================================================
// Type Selection (Individual Mode)
// =============================================================================

describe('Type selection', () => {
  it('changing type in individual mode calls onQueryOutputTypesChange', async () => {
    const user = userEvent.setup({ delay: null })
    const { props } = renderEditor({
      queries: { status: '$.status' },
      queryOutputTypes: { status: 'string' },
      outputMode: 'individual',
    })

    // Click the type select trigger
    const typeSelect = screen.getByTestId('json-query-type-0')
    await user.click(typeSelect)

    // Select "Integer" from the dropdown
    const integerOption = await screen.findByText('Integer')
    await user.click(integerOption)

    expect(props.onQueryOutputTypesChange).toHaveBeenCalledWith({ status: 'integer' })
  })
})

// =============================================================================
// Test Button Disabled States
// =============================================================================

describe('Test button disabled states', () => {
  it('test button is disabled when jsonContentIsExpression=true', () => {
    renderEditor({
      queries: { status: '$.status' },
      queryOutputTypes: { status: 'string' },
      jsonContentIsExpression: true,
    })

    expect(screen.getByTestId('json-query-test-0')).toBeDisabled()
  })

  it('test button is disabled when jsonContent is empty', () => {
    renderEditor({
      queries: { status: '$.status' },
      queryOutputTypes: { status: 'string' },
      jsonContent: '',
    })

    expect(screen.getByTestId('json-query-test-0')).toBeDisabled()
  })

  it('test button is disabled when jsonContent is whitespace-only', () => {
    renderEditor({
      queries: { status: '$.status' },
      queryOutputTypes: { status: 'string' },
      jsonContent: '   ',
    })

    expect(screen.getByTestId('json-query-test-0')).toBeDisabled()
  })

  it('test button is disabled when jsonpath is empty', () => {
    renderEditor({
      queries: { status: '' },
      queryOutputTypes: { status: 'string' },
    })

    expect(screen.getByTestId('json-query-test-0')).toBeDisabled()
  })

  it('test button is enabled with valid jsonpath and literal json content', () => {
    renderEditor({
      queries: { status: '$.status' },
      queryOutputTypes: { status: 'string' },
    })

    expect(screen.getByTestId('json-query-test-0')).not.toBeDisabled()
  })
})

// =============================================================================
// Test Button - Execution
// =============================================================================

describe('Test button - execution', () => {
  it('clicking test button calls evaluateJsonPath and shows dialog', async () => {
    const user = userEvent.setup({ delay: null })
    renderEditor({
      queries: { status: '$.status' },
      queryOutputTypes: { status: 'string' },
      jsonContent: '{"status":"ok"}',
    })

    await user.click(screen.getByTestId('json-query-test-0'))

    expect(mockEvaluateJsonPath).toHaveBeenCalled()
    expect(mockEvaluateJsonPath.mock.calls[0][0]).toBe('{"status":"ok"}')
    expect(mockEvaluateJsonPath.mock.calls[0][1]).toBe('$.status')

    // Dialog should appear with result
    await waitFor(() => {
      expect(screen.getByText('status')).toBeInTheDocument()
      expect(screen.getByText('JSONPath evaluation result')).toBeInTheDocument()
    })
  })

  it('shows error in dialog when evaluation fails', async () => {
    const user = userEvent.setup({ delay: null })
    mockEvaluateJsonPath.mockReturnValue({
      success: false,
      error: 'Invalid JSONPath',
      detail: 'Expression is malformed',
    })

    renderEditor({
      queries: { status: '$..bad[' },
      queryOutputTypes: { status: 'string' },
    })

    await user.click(screen.getByTestId('json-query-test-0'))

    await waitFor(() => {
      expect(screen.getByText('JSONPath evaluation failed')).toBeInTheDocument()
      expect(screen.getByText('Invalid JSONPath')).toBeInTheDocument()
      expect(screen.getByText('Expression is malformed')).toBeInTheDocument()
    })
  })

  it('shows array result in dialog', async () => {
    const user = userEvent.setup({ delay: null })
    mockEvaluateJsonPath.mockReturnValue({
      success: true,
      type: 'array',
      value: ['first', 'second'],
    })

    renderEditor({
      queries: { items: '$.items[*]' },
      queryOutputTypes: { items: 'string' },
    })

    await user.click(screen.getByTestId('json-query-test-0'))

    await waitFor(() => {
      expect(screen.getByText(/\[0\]/)).toBeInTheDocument()
      expect(screen.getByText(/\[1\]/)).toBeInTheDocument()
    })
  })

  it('shows a result number exactly as the sample holds it, in a list too (REQ-3.1.3.14)', async () => {
    const user = userEvent.setup({ delay: null })
    mockEvaluateJsonPath.mockReturnValue({
      success: true,
      type: 'array',
      value: [new JsonNumberText('12345678901234567890'), 1e21],
    })

    renderEditor({
      queries: { ids: '$.ids[*]' },
      queryOutputTypes: { ids: 'string' },
    })

    await user.click(screen.getByTestId('json-query-test-0'))

    await waitFor(() => {
      expect(screen.getByText('[0] 12345678901234567890')).toBeInTheDocument()
      expect(screen.getByText('[1] 1000000000000000000000')).toBeInTheDocument()
    })
  })

  it('shows a single result map with its numbers exactly', async () => {
    const user = userEvent.setup({ delay: null })
    mockEvaluateJsonPath.mockReturnValue({
      success: true,
      type: 'map',
      value: { rate: new JsonNumberText('1.50') },
    })

    renderEditor({
      queries: { row: '$.row' },
      queryOutputTypes: { row: 'map' },
    })

    await user.click(screen.getByTestId('json-query-test-0'))

    await waitFor(() => {
      expect(screen.getByText('{"rate":1.50}')).toBeInTheDocument()
    })
  })

  it('uses "Query Result" as fallback dialog title when alias is empty', async () => {
    const user = userEvent.setup({ delay: null })
    renderEditor({
      queries: { '': '$.status' },
      queryOutputTypes: {},
    })

    // Need to fill jsonpath so test button is enabled, but alias can be empty
    // We started with an existing query that has empty alias
    // Actually, empty alias means the query won't be in the queries prop.
    // Instead, let's render with content and manually add a row.
    // Re-render with a query that has a non-empty jsonpath but we'll test
    // the dialog fallback behavior by having an empty alias row.

    // Re-approach: the component starts with one empty row when queries={}
    // Type jsonpath but leave alias empty
    const jsonpathInput = screen.getByTestId('json-query-jsonpath-0')
    await user.type(jsonpathInput, '$.status')

    await user.click(screen.getByTestId('json-query-test-0'))

    await waitFor(() => {
      expect(screen.getByText('Query Result')).toBeInTheDocument()
    })
  })
})

// =============================================================================
// onValidChange Callback
// =============================================================================

describe('onValidChange callback', () => {
  it('called with false when validation errors exist (empty alias)', () => {
    const { props } = renderEditor()
    expect(props.onValidChange).toHaveBeenCalledWith(false)
  })

  it('called with true when all queries are valid', () => {
    const { props } = renderEditor({
      queries: { status: '$.status' },
      queryOutputTypes: { status: 'string' },
    })
    expect(props.onValidChange).toHaveBeenCalledWith(true)
  })

  it('called with false when JSONPath validation fails', () => {
    mockValidateJsonPathSyntax.mockReturnValue('Bad JSONPath')
    const { props } = renderEditor({
      queries: { status: '$..bad' },
      queryOutputTypes: { status: 'string' },
    })
    expect(props.onValidChange).toHaveBeenCalledWith(false)
  })
})

// =============================================================================
// Expression Mode Forces String Type
// =============================================================================

describe('Expression mode type coercion', () => {
  it('expression queries force string type in onQueryOutputTypesChange', async () => {
    const user = userEvent.setup({ delay: null })
    const { props } = renderEditor({
      queries: { status: '$.status' },
      queryOutputTypes: { status: 'integer' },
      outputMode: 'individual',
    })

    // Toggle expression mode
    await user.click(screen.getByTestId('json-query-expr-toggle-0'))

    // Should have called onQueryOutputTypesChange with string type
    expect(props.onQueryOutputTypesChange).toHaveBeenCalledWith({ status: 'string' })
  })
})

// =============================================================================
// Propagation of Non-Query Expression Fields
// =============================================================================

describe('Non-query expression fields preservation', () => {
  it('preserves non-query expression fields when propagating', async () => {
    const user = userEvent.setup({ delay: null })
    const { props } = renderEditor({
      queries: { status: '$.status' },
      queryOutputTypes: { status: 'string' },
      expressionFields: ['json_content', 'queries.status'],
    })

    // Make a change to trigger propagation
    const aliasInput = screen.getByTestId('json-query-alias-0')
    await user.clear(aliasInput)
    await user.type(aliasInput, 'result')

    // Should preserve 'json_content' (non-query field) and update query fields
    expect(props.onExpressionFieldsChange).toHaveBeenCalledWith(
      expect.arrayContaining(['json_content'])
    )
  })
})

// =============================================================================
// Tooltip for Disabled Test Button
// =============================================================================

describe('Tooltip for disabled test button', () => {
  it('wraps disabled test button in tooltip when jsonContentIsExpression', () => {
    renderEditor({
      queries: { status: '$.status' },
      queryOutputTypes: { status: 'string' },
      jsonContentIsExpression: true,
    })

    // The test button should be disabled
    const testButton = screen.getByTestId('json-query-test-0')
    expect(testButton).toBeDisabled()
    // The button should have pointer-events-none class
    expect(testButton.className).toContain('pointer-events-none')
  })

  it('wraps disabled test button in tooltip when expression mode is on', async () => {
    const user = userEvent.setup({ delay: null })
    renderEditor({
      queries: { status: '$.status' },
      queryOutputTypes: { status: 'string' },
    })

    await user.click(screen.getByTestId('json-query-expr-toggle-0'))

    const testButton = screen.getByTestId('json-query-test-0')
    expect(testButton).toBeDisabled()
  })
})

// =============================================================================
// Multiple Query Interactions
// =============================================================================

describe('Multiple query interactions', () => {
  it('editing one query does not affect other queries', async () => {
    const user = userEvent.setup({ delay: null })
    const { props } = renderEditor({
      queries: { first: '$.first', second: '$.second' },
      queryOutputTypes: { first: 'string', second: 'string' },
    })

    // Change JSONPath on first row
    const jsonpathInput = screen.getByTestId('json-query-jsonpath-0')
    await user.clear(jsonpathInput)
    await user.type(jsonpathInput, '$.updated')

    // onQueriesChange should include both queries, with only first updated
    expect(props.onQueriesChange).toHaveBeenCalledWith(
      expect.objectContaining({ first: '$.updated', second: '$.second' })
    )
  })

  it('closes test result dialog via close button', async () => {
    const user = userEvent.setup({ delay: null })
    renderEditor({
      queries: { status: '$.status' },
      queryOutputTypes: { status: 'string' },
      jsonContent: '{"status":"ok"}',
    })

    // Open dialog
    await user.click(screen.getByTestId('json-query-test-0'))
    await waitFor(() => {
      expect(screen.getByText('JSONPath evaluation result')).toBeInTheDocument()
    })

    // Close dialog via the X button (DialogContent renders a close button)
    const closeButton = screen.getByRole('button', { name: /close/i })
    await user.click(closeButton)

    await waitFor(() => {
      expect(screen.queryByText('JSONPath evaluation result')).not.toBeInTheDocument()
    })
  })

  it('expression mode JSONPath input change calls onQueriesChange', async () => {
    const user = userEvent.setup({ delay: null })
    const { props } = renderEditor({
      queries: { status: '$.status' },
      expressionFields: ['queries.status'],
      queryOutputTypes: { status: 'string' },
    })

    // The expression field is rendered as a mocked input
    const exprInput = screen.getByTestId('expression-input-jsonpath-0')
    await user.clear(exprInput)
    await user.type(exprInput, '$.new')

    expect(props.onQueriesChange).toHaveBeenCalled()
  })

  it('deleting middle row shifts remaining rows', async () => {
    const user = userEvent.setup({ delay: null })
    renderEditor({
      queries: { a: '$.a', b: '$.b', c: '$.c' },
      queryOutputTypes: { a: 'string', b: 'string', c: 'string' },
    })

    // Delete the middle row (index 1)
    await user.click(screen.getByTestId('json-query-delete-1'))

    // Now row 0 should be 'a' and row 1 should be 'c'
    expect(screen.getByTestId('json-query-alias-0')).toHaveValue('a')
    expect(screen.getByTestId('json-query-alias-1')).toHaveValue('c')
    expect(screen.queryByTestId('json-query-row-2')).not.toBeInTheDocument()
  })
})
