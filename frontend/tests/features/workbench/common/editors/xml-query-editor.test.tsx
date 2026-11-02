/**
 * Unit tests for XmlQueryEditor component - REQ-3.4.1.11
 *
 * Tests the custom inline XPath query editing UI for the XML Parser plugin.
 * Each query row has two lines:
 * - Line 1: XPath expression (full width) + expression toggle
 * - Line 2: alias/var_name + [type dropdown (individual)] + test button + delete button
 */
import React from 'react'
import { render, screen, within, waitFor, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

// Mock xpath-evaluator before importing the component
/* eslint-disable @typescript-eslint/no-explicit-any */
const mockEvaluateXPath = vi.fn((_xml: any, _xpath: any, _ns?: any): any => ({
  success: true,
  type: 'string',
  value: 'test-result',
}))
const mockValidateXPathSyntax = vi.fn((_expr: any): any => null)
/* eslint-enable @typescript-eslint/no-explicit-any */

vi.mock('@/features/workbench/lib/xpath-evaluator', () => ({
  evaluateXPath: (xml: string, xpath: string, ns?: Record<string, string>) =>
    mockEvaluateXPath(xml, xpath, ns),
  validateXPathSyntax: (expr: string) => mockValidateXPathSyntax(expr),
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

import { XmlQueryEditor, type XmlQueryEditorProps } from '@/features/workbench/common/editors/xml-query-editor'

import { expectRequiredMark } from '../../../../utils/required-mark'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const defaultProps: XmlQueryEditorProps = {
  queries: {},
  expressionFields: [],
  queryOutputTypes: {},
  outputMode: 'combined',
  xmlContent: '<root><item>hello</item></root>',
  xmlContentIsExpression: false,
  availableVariables: [],
  onQueriesChange: vi.fn(),
  onExpressionFieldsChange: vi.fn(),
  onQueryOutputTypesChange: vi.fn(),
  onValidChange: vi.fn(),
}

function renderEditor(overrides: Partial<XmlQueryEditorProps> = {}) {
  const props = { ...defaultProps, ...overrides }
  // Re-create callbacks so each render gets fresh mocks
  if (!overrides.onQueriesChange) props.onQueriesChange = vi.fn()
  if (!overrides.onExpressionFieldsChange) props.onExpressionFieldsChange = vi.fn()
  if (!overrides.onQueryOutputTypesChange) props.onQueryOutputTypesChange = vi.fn()
  if (!overrides.onValidChange) props.onValidChange = vi.fn()

  return {
    ...render(<XmlQueryEditor {...props} />),
    props,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  // Default: valid XPath syntax
  mockValidateXPathSyntax.mockReturnValue(null)
  mockEvaluateXPath.mockReturnValue({ success: true, type: 'string', value: 'test-result' })
})

// =============================================================================
// Rendering - Empty State
// =============================================================================

describe('Rendering - empty state', () => {
  it('renders "Add Query" button', () => {
    renderEditor()
    expect(screen.getByTestId('xml-query-add-button')).toBeInTheDocument()
    expect(screen.getByTestId('xml-query-add-button')).toHaveTextContent('Add Query')
  })

  it('starts with one empty query row when queries prop is empty', () => {
    renderEditor()
    expect(screen.getByTestId('xml-query-row-0')).toBeInTheDocument()
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

  it('has empty xpath and alias inputs in the empty row', () => {
    renderEditor()
    expect(screen.getByTestId('xml-query-xpath-0')).toHaveValue('')
    expect(screen.getByTestId('xml-query-alias-0')).toHaveValue('')
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
      queries: { status: '//status/text()', name: '//name' },
      queryOutputTypes: { status: 'string', name: 'string' },
    })
    expect(screen.getByTestId('xml-query-row-0')).toBeInTheDocument()
    expect(screen.getByTestId('xml-query-row-1')).toBeInTheDocument()
  })

  it('populates xpath and alias from the queries prop', () => {
    renderEditor({
      queries: { status: '//status/text()' },
      queryOutputTypes: { status: 'string' },
    })
    expect(screen.getByTestId('xml-query-xpath-0')).toHaveValue('//status/text()')
    expect(screen.getByTestId('xml-query-alias-0')).toHaveValue('status')
  })

  it('calls onValidChange(true) when all queries are valid', () => {
    const { props } = renderEditor({
      queries: { status: '//status/text()' },
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
      queries: { status: '//status' },
      queryOutputTypes: { status: 'string' },
    })

    await user.click(screen.getByTestId('xml-query-add-button'))

    expect(screen.getByTestId('xml-query-row-1')).toBeInTheDocument()
    expect(screen.getByTestId('xml-query-alias-1')).toHaveValue('')
  })

  it('new row has empty xpath input', async () => {
    const user = userEvent.setup({ delay: null })
    renderEditor({
      queries: { status: '//status' },
      queryOutputTypes: { status: 'string' },
    })

    await user.click(screen.getByTestId('xml-query-add-button'))

    expect(screen.getByTestId('xml-query-xpath-1')).toHaveValue('')
  })
})

// =============================================================================
// Deleting Queries
// =============================================================================

describe('Deleting queries', () => {
  it('clicking delete removes the query row', async () => {
    const user = userEvent.setup({ delay: null })
    const { props } = renderEditor({
      queries: { status: '//status', name: '//name' },
      queryOutputTypes: { status: 'string', name: 'string' },
    })

    await user.click(screen.getByTestId('xml-query-delete-0'))

    // Only one row remains
    expect(screen.getByTestId('xml-query-row-0')).toBeInTheDocument()
    expect(screen.queryByTestId('xml-query-row-1')).not.toBeInTheDocument()
    // onQueriesChange called with remaining query only
    expect(props.onQueriesChange).toHaveBeenCalledWith({ name: '//name' })
  })

  it('deleting the last row replaces it with an empty row', async () => {
    const user = userEvent.setup({ delay: null })
    renderEditor({
      queries: { status: '//status' },
      queryOutputTypes: { status: 'string' },
    })

    await user.click(screen.getByTestId('xml-query-delete-0'))

    // Should still have one row, but it is now empty
    expect(screen.getByTestId('xml-query-row-0')).toBeInTheDocument()
    expect(screen.getByTestId('xml-query-alias-0')).toHaveValue('')
    expect(screen.getByTestId('xml-query-xpath-0')).toHaveValue('')
  })

  it('delete button is disabled for the single empty default row', () => {
    renderEditor()
    expect(screen.getByTestId('xml-query-delete-0')).toBeDisabled()
  })
})

// =============================================================================
// Editing XPath
// =============================================================================

describe('Editing XPath', () => {
  it('changing XPath input calls onQueriesChange with updated queries', async () => {
    const user = userEvent.setup({ delay: null })
    const { props } = renderEditor({
      queries: { status: '//status' },
      queryOutputTypes: { status: 'string' },
    })

    const xpathInput = screen.getByTestId('xml-query-xpath-0')
    await user.clear(xpathInput)
    await user.type(xpathInput, '//name/text()')

    expect(props.onQueriesChange).toHaveBeenCalledWith({ status: '//name/text()' })
  })
})

// =============================================================================
// Editing Alias
// =============================================================================

describe('Editing alias', () => {
  it('changing alias input calls onQueriesChange', async () => {
    const user = userEvent.setup({ delay: null })
    const { props } = renderEditor({
      queries: { status: '//status' },
      queryOutputTypes: { status: 'string' },
    })

    const aliasInput = screen.getByTestId('xml-query-alias-0')
    await user.clear(aliasInput)
    await user.type(aliasInput, 'result')

    expect(props.onQueriesChange).toHaveBeenCalledWith({ result: '//status' })
  })
})

// =============================================================================
// Validation - Empty Alias
// =============================================================================

describe('Validation - empty alias', () => {
  it('shows "Name is required" error after alias field is touched (blur)', async () => {
    const user = userEvent.setup({ delay: null })
    renderEditor()

    const aliasInput = screen.getByTestId('xml-query-alias-0')
    await user.click(aliasInput)
    await user.tab() // blur

    expect(screen.getByRole('alert')).toHaveTextContent('Name is required')
  })

  it('shows the alias error eagerly before the field is touched (VMGR-91)', () => {
    renderEditor()
    // VMGR-91: a blocking alias error surfaces immediately so a disabled Save always
    // has a visible culprit - no touch/blur required.
    const alerts = screen.queryAllByRole('alert')
    expect(alerts.filter((a) => a.textContent === 'Name is required')).toHaveLength(1)
  })

  it('outlines the empty alias input red eagerly (VMGR-91)', () => {
    renderEditor()
    expect(screen.getByTestId('xml-query-alias-0').className).toContain('border-destructive')
  })
})

// =============================================================================
// Validation - Duplicate Alias
// =============================================================================

describe('Validation - duplicate alias', () => {
  it('shows "Duplicate query name" error for duplicate aliases', async () => {
    const user = userEvent.setup({ delay: null })
    renderEditor({
      queries: { status: '//status' },
      queryOutputTypes: { status: 'string' },
    })

    // Add a second row
    await user.click(screen.getByTestId('xml-query-add-button'))

    // Type the same alias in the second row
    const aliasInput = screen.getByTestId('xml-query-alias-1')
    await user.type(aliasInput, 'status')
    // Blur to mark as touched
    await user.tab()

    // VMGR-91: both colliding rows are flagged eagerly (every blocking field outlined).
    expect(screen.getAllByText('Duplicate query name')).toHaveLength(2)
  })
})

// =============================================================================
// Validation - Invalid XPath
// =============================================================================

describe('Validation - invalid XPath syntax', () => {
  it('shows error for invalid XPath after xpath field is touched', async () => {
    const user = userEvent.setup({ delay: null })
    mockValidateXPathSyntax.mockReturnValue('Invalid XPath expression')

    renderEditor({
      queries: { status: '//status' },
      queryOutputTypes: { status: 'string' },
    })

    const xpathInput = screen.getByTestId('xml-query-xpath-0')
    await user.clear(xpathInput)
    // Use fireEvent to avoid userEvent interpreting '[' as a key descriptor
    fireEvent.change(xpathInput, { target: { value: '///invalid[' } })
    // Blur to mark as touched
    fireEvent.blur(xpathInput)

    expect(screen.getByText('Invalid XPath expression')).toBeInTheDocument()
  })

  it('calls onValidChange(false) when XPath validation fails', async () => {
    const user = userEvent.setup({ delay: null })
    mockValidateXPathSyntax.mockReturnValue('Bad XPath')

    const { props } = renderEditor({
      queries: { status: '//status' },
      queryOutputTypes: { status: 'string' },
    })

    vi.mocked(props.onValidChange!).mockClear()

    const xpathInput = screen.getByTestId('xml-query-xpath-0')
    await user.clear(xpathInput)
    await user.type(xpathInput, '///bad')

    expect(props.onValidChange).toHaveBeenCalledWith(false)
  })

  it('does not validate XPath for expression-mode queries', async () => {
    mockValidateXPathSyntax.mockReturnValue('Invalid XPath expression')

    renderEditor({
      queries: { status: '//status' },
      expressionFields: ['queries.status'],
      queryOutputTypes: { status: 'string' },
    })

    // The row is in expression mode so xpath validation is skipped
    const xpathTouched = screen.getByTestId('xml-query-row-0')
    // In expression mode, ExpressionField is rendered instead of Input
    expect(within(xpathTouched).getByTestId('expression-input-xpath-0')).toBeInTheDocument()
    // No XPath error should be shown
    expect(screen.queryByText('Invalid XPath expression')).not.toBeInTheDocument()
  })
})

// =============================================================================
// Validation - Invalid Alias Pattern
// =============================================================================

describe('Validation - invalid alias pattern', () => {
  it('shows error for alias starting with a number', async () => {
    const user = userEvent.setup({ delay: null })
    renderEditor()

    const aliasInput = screen.getByTestId('xml-query-alias-0')
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
  it('toggling expression mode switches XPath input to ExpressionField', async () => {
    const user = userEvent.setup({ delay: null })
    renderEditor({
      queries: { status: '//status' },
      queryOutputTypes: { status: 'string' },
    })

    // Before toggle: regular input
    expect(screen.getByTestId('xml-query-xpath-0')).toBeInTheDocument()

    // Toggle expression mode
    await user.click(screen.getByTestId('xml-query-expr-toggle-0'))

    // After toggle: ExpressionField (mocked as input with different testid)
    expect(screen.getByTestId('expression-input-xpath-0')).toBeInTheDocument()
    expect(screen.queryByTestId('xml-query-xpath-0')).not.toBeInTheDocument()
  })

  it('toggling expression mode calls onExpressionFieldsChange', async () => {
    const user = userEvent.setup({ delay: null })
    const { props } = renderEditor({
      queries: { status: '//status' },
      queryOutputTypes: { status: 'string' },
    })

    await user.click(screen.getByTestId('xml-query-expr-toggle-0'))

    expect(props.onExpressionFieldsChange).toHaveBeenCalledWith(
      expect.arrayContaining(['queries.status'])
    )
  })

  it('toggling expression mode disables test button', async () => {
    const user = userEvent.setup({ delay: null })
    renderEditor({
      queries: { status: '//status' },
      queryOutputTypes: { status: 'string' },
    })

    await user.click(screen.getByTestId('xml-query-expr-toggle-0'))

    expect(screen.getByTestId('xml-query-test-0')).toBeDisabled()
  })
})

// =============================================================================
// Output Mode - Individual
// =============================================================================

describe('Output mode switching', () => {
  it('in individual mode, type dropdown appears', () => {
    renderEditor({
      queries: { status: '//status' },
      queryOutputTypes: { status: 'string' },
      outputMode: 'individual',
    })

    expect(screen.getByTestId('xml-query-type-0')).toBeInTheDocument()
  })

  it('in combined mode, type dropdown does not appear', () => {
    renderEditor({
      queries: { status: '//status' },
      queryOutputTypes: { status: 'string' },
      outputMode: 'combined',
    })

    expect(screen.queryByTestId('xml-query-type-0')).not.toBeInTheDocument()
  })

  it('alias placeholder changes based on output mode', () => {
    const { unmount } = render(
      <XmlQueryEditor
        {...defaultProps}
        queries={{ status: '//status' }}
        queryOutputTypes={{ status: 'string' }}
        outputMode="individual"
      />
    )
    expect(screen.getByTestId('xml-query-alias-0')).toHaveAttribute('placeholder', 'Variable name')
    unmount()

    render(
      <XmlQueryEditor
        {...defaultProps}
        queries={{ status: '//status' }}
        queryOutputTypes={{ status: 'string' }}
        outputMode="combined"
      />
    )
    expect(screen.getByTestId('xml-query-alias-0')).toHaveAttribute('placeholder', 'Result alias')
  })
})

// =============================================================================
// Type Selection (Individual Mode)
// =============================================================================

describe('Type selection', () => {
  it('changing type in individual mode calls onQueryOutputTypesChange', async () => {
    const user = userEvent.setup({ delay: null })
    const { props } = renderEditor({
      queries: { status: '//status' },
      queryOutputTypes: { status: 'string' },
      outputMode: 'individual',
    })

    // Click the type select trigger
    const typeSelect = screen.getByTestId('xml-query-type-0')
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
  it('test button is disabled when xmlContentIsExpression=true', () => {
    renderEditor({
      queries: { status: '//status' },
      queryOutputTypes: { status: 'string' },
      xmlContentIsExpression: true,
    })

    expect(screen.getByTestId('xml-query-test-0')).toBeDisabled()
  })

  it('test button is disabled when xmlContent is empty', () => {
    renderEditor({
      queries: { status: '//status' },
      queryOutputTypes: { status: 'string' },
      xmlContent: '',
    })

    expect(screen.getByTestId('xml-query-test-0')).toBeDisabled()
  })

  it('test button is disabled when xmlContent is whitespace-only', () => {
    renderEditor({
      queries: { status: '//status' },
      queryOutputTypes: { status: 'string' },
      xmlContent: '   ',
    })

    expect(screen.getByTestId('xml-query-test-0')).toBeDisabled()
  })

  it('test button is disabled when xpath is empty', () => {
    renderEditor({
      queries: { status: '' },
      queryOutputTypes: { status: 'string' },
    })

    expect(screen.getByTestId('xml-query-test-0')).toBeDisabled()
  })

  it('test button is enabled with valid xpath and literal xml content', () => {
    renderEditor({
      queries: { status: '//status' },
      queryOutputTypes: { status: 'string' },
    })

    expect(screen.getByTestId('xml-query-test-0')).not.toBeDisabled()
  })
})

// =============================================================================
// Test Button - Execution
// =============================================================================

describe('Test button - execution', () => {
  it('clicking test button calls evaluateXPath and shows dialog', async () => {
    const user = userEvent.setup({ delay: null })
    renderEditor({
      queries: { status: '//status/text()' },
      queryOutputTypes: { status: 'string' },
      xmlContent: '<root><status>ok</status></root>',
    })

    await user.click(screen.getByTestId('xml-query-test-0'))

    expect(mockEvaluateXPath).toHaveBeenCalled()
    expect(mockEvaluateXPath.mock.calls[0][0]).toBe('<root><status>ok</status></root>')
    expect(mockEvaluateXPath.mock.calls[0][1]).toBe('//status/text()')

    // Dialog should appear with result
    await waitFor(() => {
      expect(screen.getByText('status')).toBeInTheDocument()
      expect(screen.getByText('XPath evaluation result')).toBeInTheDocument()
    })
  })

  it('shows error in dialog when evaluation fails', async () => {
    const user = userEvent.setup({ delay: null })
    mockEvaluateXPath.mockReturnValue({
      success: false,
      error: 'Invalid XPath',
      detail: 'Expression is malformed',
    })

    renderEditor({
      queries: { status: '//bad[' },
      queryOutputTypes: { status: 'string' },
    })

    await user.click(screen.getByTestId('xml-query-test-0'))

    await waitFor(() => {
      expect(screen.getByText('XPath evaluation failed')).toBeInTheDocument()
      expect(screen.getByText('Invalid XPath')).toBeInTheDocument()
      expect(screen.getByText('Expression is malformed')).toBeInTheDocument()
    })
  })

  it('shows array result in dialog', async () => {
    const user = userEvent.setup({ delay: null })
    mockEvaluateXPath.mockReturnValue({
      success: true,
      type: 'array',
      value: ['first', 'second'],
    })

    renderEditor({
      queries: { items: '//item' },
      queryOutputTypes: { items: 'string' },
    })

    await user.click(screen.getByTestId('xml-query-test-0'))

    await waitFor(() => {
      expect(screen.getByText(/\[0\]/)).toBeInTheDocument()
      expect(screen.getByText(/\[1\]/)).toBeInTheDocument()
    })
  })

  it('uses "Query Result" as fallback dialog title when alias is empty', async () => {
    const user = userEvent.setup({ delay: null })
    renderEditor({
      queries: { '': '//status' },
      queryOutputTypes: {},
    })

    // Need to fill xpath so test button is enabled, but alias can be empty
    // We started with an existing query that has empty alias
    // Actually, empty alias means the query won't be in the queries prop.
    // Instead, let's render with content and manually add a row.
    // Re-render with a query that has a non-empty xpath but we'll test
    // the dialog fallback behavior by having an empty alias row.

    // Re-approach: the component starts with one empty row when queries={}
    // Type xpath but leave alias empty
    const xpathInput = screen.getByTestId('xml-query-xpath-0')
    await user.type(xpathInput, '//status')

    await user.click(screen.getByTestId('xml-query-test-0'))

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
      queries: { status: '//status' },
      queryOutputTypes: { status: 'string' },
    })
    expect(props.onValidChange).toHaveBeenCalledWith(true)
  })

  it('called with false when XPath validation fails', () => {
    mockValidateXPathSyntax.mockReturnValue('Bad XPath')
    const { props } = renderEditor({
      queries: { status: '//bad' },
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
      queries: { status: '//status' },
      queryOutputTypes: { status: 'integer' },
      outputMode: 'individual',
    })

    // Toggle expression mode
    await user.click(screen.getByTestId('xml-query-expr-toggle-0'))

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
      queries: { status: '//status' },
      queryOutputTypes: { status: 'string' },
      expressionFields: ['xml_content', 'queries.status'],
    })

    // Make a change to trigger propagation
    const aliasInput = screen.getByTestId('xml-query-alias-0')
    await user.clear(aliasInput)
    await user.type(aliasInput, 'result')

    // Should preserve 'xml_content' (non-query field) and update query fields
    expect(props.onExpressionFieldsChange).toHaveBeenCalledWith(
      expect.arrayContaining(['xml_content'])
    )
  })
})

// =============================================================================
// Tooltip for Disabled Test Button
// =============================================================================

describe('Tooltip for disabled test button', () => {
  it('wraps disabled test button in tooltip when xmlContentIsExpression', () => {
    renderEditor({
      queries: { status: '//status' },
      queryOutputTypes: { status: 'string' },
      xmlContentIsExpression: true,
    })

    // The test button should be disabled
    const testButton = screen.getByTestId('xml-query-test-0')
    expect(testButton).toBeDisabled()
    // The button should have pointer-events-none class
    expect(testButton.className).toContain('pointer-events-none')
  })

  it('wraps disabled test button in tooltip when expression mode is on', async () => {
    const user = userEvent.setup({ delay: null })
    renderEditor({
      queries: { status: '//status' },
      queryOutputTypes: { status: 'string' },
    })

    await user.click(screen.getByTestId('xml-query-expr-toggle-0'))

    const testButton = screen.getByTestId('xml-query-test-0')
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
      queries: { first: '//first', second: '//second' },
      queryOutputTypes: { first: 'string', second: 'string' },
    })

    // Change XPath on first row
    const xpathInput = screen.getByTestId('xml-query-xpath-0')
    await user.clear(xpathInput)
    await user.type(xpathInput, '//updated')

    // onQueriesChange should include both queries, with only first updated
    expect(props.onQueriesChange).toHaveBeenCalledWith(
      expect.objectContaining({ first: '//updated', second: '//second' })
    )
  })

  it('closes test result dialog via close button', async () => {
    const user = userEvent.setup({ delay: null })
    renderEditor({
      queries: { status: '//status/text()' },
      queryOutputTypes: { status: 'string' },
      xmlContent: '<root><status>ok</status></root>',
    })

    // Open dialog
    await user.click(screen.getByTestId('xml-query-test-0'))
    await waitFor(() => {
      expect(screen.getByText('XPath evaluation result')).toBeInTheDocument()
    })

    // Close dialog via the X button (DialogContent renders a close button)
    const closeButton = screen.getByRole('button', { name: /close/i })
    await user.click(closeButton)

    await waitFor(() => {
      expect(screen.queryByText('XPath evaluation result')).not.toBeInTheDocument()
    })
  })

  it('expression mode XPath input change calls onQueriesChange', async () => {
    const user = userEvent.setup({ delay: null })
    const { props } = renderEditor({
      queries: { status: '//status/text()' },
      expressionFields: ['queries.status'],
      queryOutputTypes: { status: 'string' },
    })

    // The expression field is rendered as a mocked input
    const exprInput = screen.getByTestId('expression-input-xpath-0')
    await user.clear(exprInput)
    await user.type(exprInput, '//new/text()')

    expect(props.onQueriesChange).toHaveBeenCalled()
  })

  it('deleting middle row shifts remaining rows', async () => {
    const user = userEvent.setup({ delay: null })
    renderEditor({
      queries: { a: '//a', b: '//b', c: '//c' },
      queryOutputTypes: { a: 'string', b: 'string', c: 'string' },
    })

    // Delete the middle row (index 1)
    await user.click(screen.getByTestId('xml-query-delete-1'))

    // Now row 0 should be 'a' and row 1 should be 'c'
    expect(screen.getByTestId('xml-query-alias-0')).toHaveValue('a')
    expect(screen.getByTestId('xml-query-alias-1')).toHaveValue('c')
    expect(screen.queryByTestId('xml-query-row-2')).not.toBeInTheDocument()
  })
})
