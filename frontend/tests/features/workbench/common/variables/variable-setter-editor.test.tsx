/**
 * Unit tests for VariableSetterEditor component.
 *
 * The setter migrates its value editing onto the shared variable bodies:
 *   - integer / float / boolean (literal) edit INLINE via ScalarEditBody
 *   - string + array / map / table open the shared "Edit value" sheet
 *     (ValueEditorSheet) via an Edit preview button
 *   - any expression edits inline via ExpressionField (the { } toggle, unchanged)
 *   - numbers are carried as EXACT TEXT (no parseInt / parseFloat coercion)
 *   - a string row can be a template; its template-ness rides variableTemplateKeys
 *     (onTemplateKeysChange), mirroring expressionKeys
 *
 * The shared bodies + the value-editor sheet are mocked to stand-ins exposing
 * onChange / onSave so this file covers the EDITOR's orchestration (per-type
 * affordances, sheet open/save, exact-text propagation, template-key
 * propagation); each body / the sheet has its own test file.
 *
 * Design decisions: VARSET-1..10
 * REQ: REQ-3.4.1.14, REQ-3.1.3.15
 */
import React from 'react'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ExpressionField: the inline cyan source editor (CodeMirror); mock to an input.
vi.mock('@/features/workbench/common/element-config/expressions/expression-field', () => ({
  ExpressionField: ({
    value,
    onChange,
    name,
    placeholder,
    isInvalid,
  }: {
    value: string
    onChange: (v: string) => void
    name: string
    placeholder?: string
    isInvalid?: boolean
  }) =>
    React.createElement('input', {
      'data-testid': `expression-input-${name}`,
      value: value ?? '',
      onChange: (e: React.ChangeEvent<HTMLInputElement>) => onChange(e.target.value),
      placeholder,
      'aria-invalid': isInvalid ? 'true' : undefined,
    }),
}))

// The value-rule tests switch this on to drive the real ScalarEditBody.
const scalarBody = vi.hoisted(() => ({ real: false }))

interface ScalarStubProps {
  value: unknown
  type: string
  onChange: (v: unknown) => void
  onValidChange?: (valid: boolean) => void
}

// ScalarEditBody: the inline numeric / boolean affordance. The stub exposes the
// numeric input (emits the EXACT typed text) and a boolean setter button.
vi.mock('@/components/shared/variable-bodies/scalar-edit-body', async (importOriginal) => {
  const actual = await importOriginal<
    typeof import('@/components/shared/variable-bodies/scalar-edit-body')
  >()
  return {
    ScalarEditBody: (props: ScalarStubProps) => {
      if (scalarBody.real) {
        return React.createElement(
          actual.ScalarEditBody,
          props as React.ComponentProps<typeof actual.ScalarEditBody>,
        )
      }
      const { value, type, onChange, onValidChange } = props
      return React.createElement(
        'div',
        { 'data-testid': `scalar-edit-body-${type}` },
        React.createElement('input', {
          'data-testid': 'scalar-edit-input',
          value: value === null || value === undefined ? '' : String(value),
          onChange: (e: React.ChangeEvent<HTMLInputElement>) => {
            onChange(e.target.value)
            onValidChange?.(true)
          },
        }),
        React.createElement(
          'button',
          {
            'data-testid': 'scalar-edit-set-true',
            onClick: () => {
              onChange(true)
              onValidChange?.(true)
            },
          },
          'true',
        ),
      )
    },
  }
})

// ValueEditorSheet: the shared "Edit value" sheet for string / complex rows.
// The stub echoes the props it received and exposes save buttons for each kind.
vi.mock('@/features/workbench/common/variables/variable-inspect-modal/value-editor-sheet', () => ({
  ValueEditorSheet: ({
    name,
    type,
    value,
    isTemplate,
    elementTypes,
    onSave,
    onClose,
  }: {
    name: string
    type: string
    value: unknown
    isTemplate: boolean
    elementTypes?: unknown
    onSave: (value: unknown, isTemplate: boolean, exprKeys?: string[], elementTypes?: unknown) => void
    onClose: () => void
  }) =>
    React.createElement(
      'div',
      { 'data-testid': 'value-editor-sheet' },
      React.createElement('span', { 'data-testid': 'ves-name' }, name),
      React.createElement('span', { 'data-testid': 'ves-type' }, type),
      React.createElement('span', { 'data-testid': 'ves-istemplate' }, String(isTemplate)),
      React.createElement('span', { 'data-testid': 'ves-value' }, String(value)),
      React.createElement('span', { 'data-testid': 'ves-element-types' }, JSON.stringify(elementTypes ?? null)),
      React.createElement(
        'button',
        {
          'data-testid': 'ves-save-typed-map',
          onClick: () => onSave({ n: '16', zip: '02134' }, false, [], { n: 'integer', zip: 'string' }),
        },
        'save typed map',
      ),
      React.createElement(
        'button',
        { 'data-testid': 'ves-save-literal', onClick: () => onSave('edited-value', false) },
        'save literal',
      ),
      React.createElement(
        'button',
        { 'data-testid': 'ves-save-template', onClick: () => onSave('Hi {{ api_url }}', true) },
        'save template',
      ),
      React.createElement(
        'button',
        { 'data-testid': 'ves-save-array', onClick: () => onSave([1, 2, 3], false) },
        'save array',
      ),
      React.createElement('button', { 'data-testid': 'ves-close', onClick: onClose }, 'close'),
    ),
}))

// Available variables for autocomplete testing
const mockAvailableVariables = [
  { name: 'api_url', type: 'string' },
  { name: 'timeout', type: 'integer' },
  { name: 'retry_count', type: 'integer' },
  { name: 'enabled', type: 'boolean' },
]

function renderEditor(props: Record<string, unknown> = {}) {
  const defaultProps = {
    variables: {} as Record<string, unknown>,
    expressionKeys: [] as string[],
    templateKeys: [] as string[],
    secretKeys: [] as string[],
    variableTypes: {} as Record<string, string>,
    availableVariables: mockAvailableVariables,
    onVariablesChange: vi.fn(),
    onExpressionKeysChange: vi.fn(),
    onTemplateKeysChange: vi.fn(),
    onSecretKeysChange: vi.fn(),
    onTypesChange: vi.fn(),
    onValidChange: vi.fn(),
    ...props,
  }
  return {
    ...render(
      React.createElement(
        VariableSetterEditor as React.FC<typeof defaultProps>,
        defaultProps,
      ),
    ),
    props: defaultProps,
  }
}

import { VariableSetterEditor } from '@/features/workbench/common/variables/variable-setter-editor'

beforeEach(() => {
  vi.clearAllMocks()
})

// =============================================================================
// VARSET-10: Empty State
// =============================================================================

describe('Empty State (VARSET-10)', () => {
  it('renders one empty row when no variables', () => {
    renderEditor()
    expect(screen.getByTestId('varset-name-input-0')).toBeInTheDocument()
  })

  it('auto-focuses name field in empty row', () => {
    renderEditor()
    const nameInput = screen.getByTestId('varset-name-input-0')
    expect(nameInput).toHaveFocus()
  })

  it('shows default type as string for empty row', () => {
    renderEditor()
    expect(screen.getByTestId('varset-type-select-0')).toHaveTextContent(/string/i)
  })

  it('shows the Edit value button for the empty (string) row', () => {
    renderEditor()
    // String values edit via the sheet, so the row carries an Edit button.
    expect(screen.getByTestId('varset-edit-value-0')).toBeInTheDocument()
  })
})

// =============================================================================
// Column headers - the Secret checkbox column is labeled, matching the
// profile / entity variable tables.
// =============================================================================

describe('Column headers', () => {
  it('renders Name / Type / Secret / Value column headers', () => {
    renderEditor()
    for (const label of ['Name', 'Type', 'Secret', 'Value']) {
      expect(screen.getByText(label)).toBeInTheDocument()
    }
  })
})

// =============================================================================
// Secret Column (SECUI-2)
// =============================================================================

describe('Secret Column (SECUI-2)', () => {
  it('renders a Secret checkbox for each row', () => {
    renderEditor({
      variables: { token: 'x' },
      variableTypes: { token: 'string' },
    })

    expect(screen.getByTestId('varset-secret-checkbox-0')).toBeInTheDocument()
  })

  it('checks the Secret checkbox when the row name is in secretKeys', () => {
    renderEditor({
      variables: { token: 'x' },
      variableTypes: { token: 'string' },
      secretKeys: ['token'],
    })

    expect(screen.getByTestId('varset-secret-checkbox-0')).toBeChecked()
  })

  it('leaves the Secret checkbox unchecked for a non-secret row', () => {
    renderEditor({
      variables: { token: 'x' },
      variableTypes: { token: 'string' },
    })

    expect(screen.getByTestId('varset-secret-checkbox-0')).not.toBeChecked()
  })

  it('adds the row name to secretKeys when the Secret checkbox is checked', () => {
    const { props } = renderEditor({
      variables: { token: 'x' },
      variableTypes: { token: 'string' },
    })

    fireEvent.click(screen.getByTestId('varset-secret-checkbox-0'))

    expect(props.onSecretKeysChange).toHaveBeenCalledWith(['token'])
  })

  it('removes the row name from secretKeys when the Secret checkbox is unchecked', () => {
    const { props } = renderEditor({
      variables: { token: 'x' },
      variableTypes: { token: 'string' },
      secretKeys: ['token'],
    })

    fireEvent.click(screen.getByTestId('varset-secret-checkbox-0'))

    expect(props.onSecretKeysChange).toHaveBeenCalledWith([])
  })

  it('serializes only the secret-flagged rows into secretKeys', () => {
    const { props } = renderEditor({
      variables: { token: 'x', region: 'us' },
      variableTypes: { token: 'string', region: 'string' },
      secretKeys: ['token'],
    })

    // Mark the second (non-secret) row secret too.
    fireEvent.click(screen.getByTestId('varset-secret-checkbox-1'))

    expect(props.onSecretKeysChange).toHaveBeenCalledWith(['token', 'region'])
  })

  it('disables the Secret checkbox for a boolean row', () => {
    renderEditor({
      variables: { flag: false },
      variableTypes: { flag: 'boolean' },
    })

    expect(screen.getByTestId('varset-secret-checkbox-0')).toBeDisabled()
  })

  it('masks a saved secret value write-only and clears it on the edit confirm', async () => {
    const user = userEvent.setup({ delay: null })
    // A SAVED setter secret round-trips to the canvas as a sealed envelope; only a
    // stored (sealed) value masks write-only.
    const { props } = renderEditor({
      variables: { token: 'wave:enc:v1:c2stbGl2ZS1jbGFzc2lmaWVk' },
      variableTypes: { token: 'string' },
      secretKeys: ['token'],
    })

    // A secret row holding a stored value shows the masked write-only affordance,
    // not the raw envelope or the plain Edit-value button.
    expect(screen.queryByText(/wave:enc/)).not.toBeInTheDocument()
    const masked = screen.getByRole('button', { name: /edit protected value/i })

    // Clicking it opens the clear-and-edit confirm; confirming drops the value and
    // reopens the value-editor sheet for a fresh entry.
    await user.click(masked)
    const dialog = screen.getByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: /delete & edit/i }))

    expect(props.onVariablesChange).toHaveBeenLastCalledWith({ token: '' })
    expect(screen.getByTestId('value-editor-sheet')).toBeInTheDocument()
  })

  it('puts the keyboard focus on the row\'s own value control after "Delete & Edit"', async () => {
    const user = userEvent.setup({ delay: null })
    renderEditor({
      variables: { token: 'wave:enc:v1:c2stbGl2ZS1jbGFzc2lmaWVk', region: 'eu' },
      variableTypes: { token: 'string', region: 'string' },
      secretKeys: ['token'],
    })
    await user.click(screen.getByRole('button', { name: /edit protected value/i }))

    await user.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: /delete & edit/i }),
    )

    expect(screen.queryByRole('button', { name: /edit protected value/i })).not.toBeInTheDocument()
    await waitFor(() => expect(screen.getByTestId('varset-edit-value-0')).toHaveFocus())
  })

  it.each([
    ['Cancel', async (user: ReturnType<typeof userEvent.setup>) =>
      user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }))],
    ['Escape', async (user: ReturnType<typeof userEvent.setup>) => user.keyboard('{Escape}')],
  ] as const)('puts the keyboard focus back on the masked value after %s', async (_label, dismiss) => {
    const user = userEvent.setup({ delay: null })
    renderEditor({
      variables: { token: 'wave:enc:v1:c2stbGl2ZS1jbGFzc2lmaWVk' },
      variableTypes: { token: 'string' },
      secretKeys: ['token'],
    })
    await user.click(screen.getByRole('button', { name: /edit protected value/i }))

    await dismiss(user)

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /edit protected value/i })).toHaveFocus(),
    )
  })

  it('does NOT mask a freshly typed (non-stored) secret value', () => {
    // A value typed this session is plaintext, not a sealed envelope, so the row
    // stays visible and editable instead of dropping into write-only dots.
    renderEditor({
      variables: { token: 'just-typed-plaintext' },
      variableTypes: { token: 'string' },
      secretKeys: ['token'],
    })

    expect(
      screen.queryByRole('button', { name: /edit protected value/i }),
    ).not.toBeInTheDocument()
  })
})

// =============================================================================
// VARSET-1: Inline Variable Rows
// =============================================================================

describe('Inline Variable Rows (VARSET-1)', () => {
  it('renders existing variables as rows', () => {
    renderEditor({
      variables: { api_url: 'https://example.com', count: 5 },
      variableTypes: { api_url: 'string', count: 'integer' },
    })

    expect(screen.getByTestId('varset-name-input-0')).toBeInTheDocument()
    expect(screen.getByTestId('varset-name-input-1')).toBeInTheDocument()
  })

  it('each string row has name, type, Edit-value affordance, expression toggle, and delete', () => {
    renderEditor({
      variables: { myvar: 'value' },
      variableTypes: { myvar: 'string' },
    })

    expect(screen.getByTestId('varset-name-input-0')).toBeInTheDocument()
    expect(screen.getByTestId('varset-type-select-0')).toBeInTheDocument()
    expect(screen.getByTestId('varset-edit-value-0')).toBeInTheDocument()
    expect(screen.getByTestId('varset-expression-toggle-0')).toBeInTheDocument()
    expect(screen.getByTestId('varset-delete-0')).toBeInTheDocument()
  })

  it('draws the shared {x} toggle on each row', () => {
    renderEditor({
      variables: { myvar: 'value' },
      variableTypes: { myvar: 'string' },
    })
    const toggle = screen.getByTestId('varset-expression-toggle-0')
    expect(toggle).toHaveAttribute('data-slot', 'expression-toggle')
    expect(toggle).toHaveAccessibleName(/^Toggle expression mode$/)
  })

  it('shows add button', () => {
    renderEditor()
    expect(screen.getByTestId('varset-add-button')).toBeInTheDocument()
  })
})

// =============================================================================
// VARSET-2: Inline Empty Row for Adding
// =============================================================================

describe('Adding Variables (VARSET-2)', () => {
  it('add button inserts new empty row', async () => {
    const user = userEvent.setup({ delay: null })
    renderEditor({
      variables: { existing: 'val' },
      variableTypes: { existing: 'string' },
    })

    await user.click(screen.getByTestId('varset-add-button'))

    expect(screen.getByTestId('varset-name-input-1')).toBeInTheDocument()
  })
})

// =============================================================================
// VARSET-3: Name Field with Autocomplete
// =============================================================================

describe('Name Field Autocomplete (VARSET-3)', () => {
  it('typing in name field filters available variables', async () => {
    const user = userEvent.setup({ delay: null })
    renderEditor()

    const nameInput = screen.getByTestId('varset-name-input-0')
    await user.type(nameInput, 'api')

    await waitFor(() => {
      expect(screen.getByText('api_url')).toBeInTheDocument()
    })
  })

  it('shows variables in autocomplete with type label', async () => {
    const user = userEvent.setup({ delay: null })
    renderEditor()

    const nameInput = screen.getByTestId('varset-name-input-0')
    await user.type(nameInput, 'a')

    await waitFor(() => {
      const apiItem = screen.getByText('api_url').closest('[cmdk-item]')!
      expect(apiItem).toHaveTextContent('string')
    })
  })

  it('hides variables already present in other setter rows', async () => {
    const user = userEvent.setup({ delay: null })
    renderEditor({
      variables: { api_url: 'https://example.com' },
      variableTypes: { api_url: 'string' },
    })

    await user.click(screen.getByTestId('varset-add-button'))
    const nameInput = screen.getByTestId('varset-name-input-1')
    await user.type(nameInput, 'a')

    await waitFor(() => {
      const apiInItems = screen
        .queryAllByText('api_url')
        .filter((el) => el.closest('[cmdk-item]'))
      expect(apiInItems).toHaveLength(0)
    })
  })

  it('deduplicates variables by name', async () => {
    const user = userEvent.setup({ delay: null })
    renderEditor({
      availableVariables: [
        { name: 'shared_var', type: 'string' },
        { name: 'shared_var', type: 'string' },
        { name: 'only_other', type: 'integer' },
      ],
    })

    const nameInput = screen.getByTestId('varset-name-input-0')
    await user.type(nameInput, 'shared')

    await waitFor(() => {
      const items = screen.getAllByText('shared_var')
      expect(items).toHaveLength(1)
    })
  })

  it('allows typing new variable names not in autocomplete', async () => {
    const user = userEvent.setup({ delay: null })
    renderEditor()

    const nameInput = screen.getByTestId('varset-name-input-0')
    await user.type(nameInput, 'brand_new_var')
    fireEvent.blur(nameInput)

    expect(screen.queryByText(/already exists/i)).not.toBeInTheDocument()
  })

  it('hides profile aliases and dotted namespace entries from name field suggestions', async () => {
    const user = userEvent.setup({ delay: null })
    renderEditor({
      availableVariables: [
        { name: 'cpr_var', type: 'string' },
        { name: 'cpr', type: 'map', source: 'Profile: staging' },
        { name: 'cpr.host', type: 'string', source: 'Profile: staging' },
        { name: 'system.cpr', type: 'string', source: 'System' },
      ],
    })

    const nameInput = screen.getByTestId('varset-name-input-0')
    await user.type(nameInput, 'cpr')

    await waitFor(() => {
      const items = screen
        .queryAllByText('cpr_var')
        .filter((el) => el.closest('[cmdk-item]'))
      expect(items).toHaveLength(1)
    })

    const cprItems = screen
      .queryAllByText('cpr')
      .filter((el) => el.closest('[cmdk-item]'))
    expect(cprItems).toHaveLength(0)

    const dottedItems = screen
      .queryAllByText(/cpr\.host|system\.cpr/)
      .filter((el) => el.closest('[cmdk-item]'))
    expect(dottedItems).toHaveLength(0)
  })
})

// =============================================================================
// VARSET-4: No Shadowing
// =============================================================================

describe('No Shadowing (VARSET-4)', () => {
  it('does not show shadow warning (all variables are test-local)', async () => {
    const user = userEvent.setup({ delay: null })
    renderEditor()

    const nameInput = screen.getByTestId('varset-name-input-0')
    await user.clear(nameInput)
    await user.type(nameInput, 'timeout')
    fireEvent.blur(nameInput)

    await waitFor(() => {
      expect(screen.queryByText(/will shadow/i)).not.toBeInTheDocument()
    })
  })

  it('rejects bare namespace keyword targets', async () => {
    const user = userEvent.setup({ delay: null })
    renderEditor()

    const nameInput = screen.getByTestId('varset-name-input-0')
    await user.clear(nameInput)
    await user.type(nameInput, 'system')
    fireEvent.blur(nameInput)

    await waitFor(() => {
      expect(screen.getByText(/cannot modify namespace variable/i)).toBeInTheDocument()
    })
  })
})

// =============================================================================
// VARSET-5: Type Behavior
// =============================================================================

describe('Type Behavior (VARSET-5)', () => {
  it('type dropdown defaults to string for new variable', () => {
    renderEditor()
    expect(screen.getByTestId('varset-type-select-0')).toHaveTextContent(/string/i)
  })

  it('type dropdown is active for new variable name', async () => {
    const user = userEvent.setup({ delay: null })
    renderEditor()

    const nameInput = screen.getByTestId('varset-name-input-0')
    await user.type(nameInput, 'brand_new')
    fireEvent.blur(nameInput)

    const typeSelect = screen.getByTestId('varset-type-select-0')
    expect(typeSelect).not.toBeDisabled()
  })

  it('type dropdown is disabled for existing variable from autocomplete', async () => {
    renderEditor({
      variables: { api_url: '' },
      variableTypes: { api_url: 'string' },
      availableVariables: [{ name: 'api_url', type: 'string' }],
    })

    const typeSelect = screen.getByTestId('varset-type-select-0')
    expect(typeSelect).toHaveAttribute('aria-disabled', 'true')
  })
})

// =============================================================================
// VARSET-6: Expression Mode Per Variable
// =============================================================================

describe('Expression Mode (VARSET-6)', () => {
  it('clicking expression toggle enables expression mode for that variable', () => {
    renderEditor({
      variables: { myvar: 'hello' },
      variableTypes: { myvar: 'string' },
      expressionKeys: ['myvar'],
    })

    expect(screen.getByTestId('expression-input-myvar')).toBeInTheDocument()
  })

  it('expression toggle calls onExpressionKeysChange', async () => {
    const user = userEvent.setup({ delay: null })
    const { props } = renderEditor({
      variables: { myvar: 'hello' },
      variableTypes: { myvar: 'string' },
    })

    await user.click(screen.getByTestId('varset-expression-toggle-0'))

    expect(props.onExpressionKeysChange).toHaveBeenCalledWith(['myvar'])
  })

  it('toggling expression off removes key from expression keys', async () => {
    const user = userEvent.setup({ delay: null })
    const { props } = renderEditor({
      variables: { myvar: '1 + 2' },
      variableTypes: { myvar: 'string' },
      expressionKeys: ['myvar'],
    })

    await user.click(screen.getByTestId('varset-expression-toggle-0'))

    expect(props.onExpressionKeysChange).toHaveBeenCalledWith([])
  })

  it('renders the inline ExpressionField (no { x } badge) for an expression row', () => {
    renderEditor({
      variables: { myvar: '1 + 2' },
      variableTypes: { myvar: 'string' },
      expressionKeys: ['myvar'],
    })

    // The { } toggle conveys expression mode; no extra { x } badge, and
    // an expression edits inline (never via the Edit-value sheet).
    expect(screen.getByTestId('expression-input-myvar')).toBeInTheDocument()
    expect(screen.queryByTestId('varset-edit-value-0')).not.toBeInTheDocument()
  })

  it('editing an expression row value propagates through onVariablesChange', async () => {
    const user = userEvent.setup({ delay: null })
    const { props } = renderEditor({
      variables: { myvar: '1 + 2' },
      variableTypes: { myvar: 'string' },
      expressionKeys: ['myvar'],
    })

    const input = screen.getByTestId('expression-input-myvar')
    await user.clear(input)
    await user.type(input, 'attempt + 1')

    expect(props.onVariablesChange).toHaveBeenLastCalledWith({ myvar: 'attempt + 1' })
  })
})

// =============================================================================
// Inline scalar affordances (ScalarEditBody)
// =============================================================================

describe('Inline Scalar Affordances', () => {
  it('integer type edits inline via ScalarEditBody (not the sheet)', () => {
    renderEditor({
      variables: { count: 0 },
      variableTypes: { count: 'integer' },
    })

    expect(screen.getByTestId('scalar-edit-body-integer')).toBeInTheDocument()
    expect(screen.queryByTestId('varset-edit-value-0')).not.toBeInTheDocument()
  })

  it('float type edits inline via ScalarEditBody', () => {
    renderEditor({
      variables: { rate: 0 },
      variableTypes: { rate: 'float' },
    })

    expect(screen.getByTestId('scalar-edit-body-float')).toBeInTheDocument()
  })

  it('boolean type edits inline via ScalarEditBody', () => {
    renderEditor({
      variables: { flag: false },
      variableTypes: { flag: 'boolean' },
    })

    expect(screen.getByTestId('scalar-edit-body-boolean')).toBeInTheDocument()
  })
})

// =============================================================================
// Exact-text numeric propagation (no parseInt / parseFloat)
// =============================================================================

describe('Exact-text Numeric Propagation', () => {
  it('propagates an integer as the exact typed string', async () => {
    const user = userEvent.setup({ delay: null })
    const { props } = renderEditor({
      variables: { count: 0 },
      variableTypes: { count: 'integer' },
    })

    const input = screen.getByTestId('scalar-edit-input')
    await user.clear(input)
    await user.type(input, '42')

    expect(props.onVariablesChange).toHaveBeenLastCalledWith({ count: '42' })
  })

  it('propagates a float as the exact typed string (no precision loss)', async () => {
    const user = userEvent.setup({ delay: null })
    const { props } = renderEditor({
      variables: { rate: 0 },
      variableTypes: { rate: 'float' },
    })

    const input = screen.getByTestId('scalar-edit-input')
    await user.clear(input)
    await user.type(input, '3.14')

    expect(props.onVariablesChange).toHaveBeenLastCalledWith({ rate: '3.14' })
  })

  it('propagates a boolean as a real boolean', async () => {
    const user = userEvent.setup({ delay: null })
    const { props } = renderEditor({
      variables: { flag: false },
      variableTypes: { flag: 'boolean' },
    })

    await user.click(screen.getByTestId('scalar-edit-set-true'))

    expect(props.onVariablesChange).toHaveBeenLastCalledWith({ flag: true })
  })
})

// =============================================================================
// String + complex edit via the value-editor sheet
// =============================================================================

describe('Value Editor Sheet', () => {
  it('array type shows a compact summary on the Edit button', () => {
    renderEditor({
      variables: { my_array: [1, 2, 3] },
      variableTypes: { my_array: 'array' },
    })

    expect(screen.getByTestId('varset-edit-value-0')).toHaveTextContent('3 items')
  })

  it('map type shows a compact summary on the Edit button', () => {
    renderEditor({
      variables: { my_map: { a: 1, b: 2 } },
      variableTypes: { my_map: 'map' },
    })

    expect(screen.getByTestId('varset-edit-value-0')).toHaveTextContent('2 pairs')
  })

  it('table type shows a compact summary on the Edit button', () => {
    renderEditor({
      variables: {
        my_table: [
          { col1: 'a', col2: 'b' },
          { col1: 'c', col2: 'd' },
          { col1: 'e', col2: 'f' },
        ],
      },
      variableTypes: { my_table: 'table' },
    })

    expect(screen.getByTestId('varset-edit-value-0')).toHaveTextContent(/3 rows/)
  })

  it('shows the "Edit…" fallback when a complex value does not match its shape', () => {
    renderEditor({
      variables: { broken_array: 'not-a-list' },
      variableTypes: { broken_array: 'array' },
    })

    expect(screen.getByTestId('varset-edit-value-0')).toHaveTextContent('Edit…')
  })

  it('clicking Edit on a string row opens the value-editor sheet (type string)', async () => {
    const user = userEvent.setup({ delay: null })
    renderEditor({
      variables: { greeting: 'hello' },
      variableTypes: { greeting: 'string' },
    })

    await user.click(screen.getByTestId('varset-edit-value-0'))

    expect(screen.getByTestId('value-editor-sheet')).toBeInTheDocument()
    expect(screen.getByTestId('ves-type')).toHaveTextContent('string')
    expect(screen.getByTestId('ves-name')).toHaveTextContent('greeting')
  })

  it('clicking Edit on an array row opens the value-editor sheet (type array)', async () => {
    const user = userEvent.setup({ delay: null })
    renderEditor({
      variables: { my_array: [1, 2] },
      variableTypes: { my_array: 'array' },
    })

    await user.click(screen.getByTestId('varset-edit-value-0'))

    expect(screen.getByTestId('value-editor-sheet')).toBeInTheDocument()
    expect(screen.getByTestId('ves-type')).toHaveTextContent('array')
  })

  it('NEVER opens a legacy array/map/table editor modal', async () => {
    const user = userEvent.setup({ delay: null })
    renderEditor({
      variables: { my_map: { k: 'v' } },
      variableTypes: { my_map: 'map' },
    })

    await user.click(screen.getByTestId('varset-edit-value-0'))

    expect(screen.queryByTestId('array-editor-modal')).not.toBeInTheDocument()
    expect(screen.queryByTestId('map-editor-modal')).not.toBeInTheDocument()
    expect(screen.queryByTestId('table-editor-modal')).not.toBeInTheDocument()
  })

  it('closes the sheet without changes on Cancel/close', async () => {
    const user = userEvent.setup({ delay: null })
    const { props } = renderEditor({
      variables: { greeting: 'hello' },
      variableTypes: { greeting: 'string' },
    })

    await user.click(screen.getByTestId('varset-edit-value-0'))
    await user.click(screen.getByTestId('ves-close'))

    expect(screen.queryByTestId('value-editor-sheet')).not.toBeInTheDocument()
    // Closing does not re-propagate the value.
    expect(props.onVariablesChange).not.toHaveBeenCalled()
  })
})

// =============================================================================
// Sheet save + template-key propagation
// =============================================================================

describe('Sheet Save and Template Keys', () => {
  it('saving a literal string propagates the value and clears the template key', async () => {
    const user = userEvent.setup({ delay: null })
    const { props } = renderEditor({
      variables: { greeting: 'hello' },
      variableTypes: { greeting: 'string' },
    })

    await user.click(screen.getByTestId('varset-edit-value-0'))
    await user.click(screen.getByTestId('ves-save-literal'))

    expect(props.onVariablesChange).toHaveBeenLastCalledWith({ greeting: 'edited-value' })
    expect(props.onTemplateKeysChange).toHaveBeenLastCalledWith([])
  })

  it('saving a template string propagates the value and sets the template key', async () => {
    const user = userEvent.setup({ delay: null })
    const { props } = renderEditor({
      variables: { greeting: 'hello' },
      variableTypes: { greeting: 'string' },
    })

    await user.click(screen.getByTestId('varset-edit-value-0'))
    await user.click(screen.getByTestId('ves-save-template'))

    expect(props.onVariablesChange).toHaveBeenLastCalledWith({ greeting: 'Hi {{ api_url }}' })
    expect(props.onTemplateKeysChange).toHaveBeenLastCalledWith(['greeting'])
  })

  it('saving a complex value propagates the value', async () => {
    const user = userEvent.setup({ delay: null })
    const { props } = renderEditor({
      variables: { my_array: [] },
      variableTypes: { my_array: 'array' },
    })

    await user.click(screen.getByTestId('varset-edit-value-0'))
    await user.click(screen.getByTestId('ves-save-array'))

    expect(props.onVariablesChange).toHaveBeenLastCalledWith({ my_array: [1, 2, 3] })
  })

  it('keeps the sheet open after a save until Close (PYRUN-20)', async () => {
    const user = userEvent.setup({ delay: null })
    renderEditor({
      variables: { greeting: 'hello' },
      variableTypes: { greeting: 'string' },
    })

    await user.click(screen.getByTestId('varset-edit-value-0'))
    await user.click(screen.getByTestId('ves-save-literal'))
    expect(screen.getByTestId('value-editor-sheet')).toBeInTheDocument()

    await user.click(screen.getByTestId('ves-close'))
    expect(screen.queryByTestId('value-editor-sheet')).not.toBeInTheDocument()
  })

  it('seeds the sheet with isTemplate=true for a row already in templateKeys', async () => {
    const user = userEvent.setup({ delay: null })
    renderEditor({
      variables: { greeting: 'Hi {{ api_url }}' },
      variableTypes: { greeting: 'string' },
      templateKeys: ['greeting'],
    })

    await user.click(screen.getByTestId('varset-edit-value-0'))

    expect(screen.getByTestId('ves-istemplate')).toHaveTextContent('true')
  })

  it('seeds the sheet with isTemplate=false for a non-template string row', async () => {
    const user = userEvent.setup({ delay: null })
    renderEditor({
      variables: { greeting: 'hello' },
      variableTypes: { greeting: 'string' },
    })

    await user.click(screen.getByTestId('varset-edit-value-0'))

    expect(screen.getByTestId('ves-istemplate')).toHaveTextContent('false')
  })
})

// =============================================================================
// VARSET-8: Inline Per-Row Validation
// =============================================================================

describe('Validation (VARSET-8)', () => {
  it('shows error for invalid Python identifier', async () => {
    const user = userEvent.setup({ delay: null })
    renderEditor()

    const nameInput = screen.getByTestId('varset-name-input-0')
    await user.type(nameInput, '123invalid')
    fireEvent.blur(nameInput)

    await waitFor(() => {
      expect(screen.getByText(/must start with a letter/i)).toBeInTheDocument()
    })
  })

  it('shows error for Python keyword', async () => {
    const user = userEvent.setup({ delay: null })
    renderEditor()

    const nameInput = screen.getByTestId('varset-name-input-0')
    await user.type(nameInput, 'pass')
    fireEvent.blur(nameInput)

    await waitFor(() => {
      expect(screen.getByText(/Python keyword/i)).toBeInTheDocument()
    })
  })

  it('shows error for duplicate name within this setter', async () => {
    const user = userEvent.setup({ delay: null })
    renderEditor({
      variables: { first_var: 'a', second_var: 'b' },
      variableTypes: { first_var: 'string', second_var: 'string' },
    })

    const nameInput = screen.getByTestId('varset-name-input-1')
    await user.clear(nameInput)
    await user.type(nameInput, 'first_var')
    fireEvent.blur(nameInput)

    await waitFor(() => {
      expect(screen.getByText(/duplicate/i)).toBeInTheDocument()
    })
  })

  it('shows error for empty name on blur', async () => {
    renderEditor({
      variables: { '': 'value' },
      variableTypes: { '': 'string' },
    })

    const nameInput = screen.getByTestId('varset-name-input-0')
    fireEvent.focus(nameInput)
    fireEvent.blur(nameInput)

    await waitFor(() => {
      expect(screen.getByText(/name is required/i)).toBeInTheDocument()
    })
  })
})

// =============================================================================
// VARSET-9: Value Starts Empty
// =============================================================================

describe('Value Starts Empty (VARSET-9)', () => {
  it('shows the Edit value button when an existing string variable is selected', () => {
    renderEditor({
      variables: { api_url: '' },
      variableTypes: { api_url: 'string' },
    })

    expect(screen.getByTestId('varset-edit-value-0')).toBeInTheDocument()
  })
})

// =============================================================================
// Delete functionality
// =============================================================================

describe('Delete Variable Row', () => {
  it('clicking delete removes the variable row', async () => {
    const user = userEvent.setup({ delay: null })
    const { props } = renderEditor({
      variables: { var1: 'a', var2: 'b' },
      variableTypes: { var1: 'string', var2: 'string' },
    })

    await user.click(screen.getByTestId('varset-delete-0'))

    expect(props.onVariablesChange).toHaveBeenCalledWith({ var2: 'b' })
  })

  it('deleting also removes from expressionKeys if present', async () => {
    const user = userEvent.setup({ delay: null })
    const { props } = renderEditor({
      variables: { var1: '1+1', var2: 'b' },
      variableTypes: { var1: 'string', var2: 'string' },
      expressionKeys: ['var1'],
    })

    await user.click(screen.getByTestId('varset-delete-0'))

    expect(props.onExpressionKeysChange).toHaveBeenCalledWith([])
  })

  it('deleting also removes from variableTypes', async () => {
    const user = userEvent.setup({ delay: null })
    const { props } = renderEditor({
      variables: { var1: 'a', var2: 'b' },
      variableTypes: { var1: 'string', var2: 'string' },
    })

    await user.click(screen.getByTestId('varset-delete-0'))

    expect(props.onTypesChange).toHaveBeenCalledWith({ var2: 'string' })
  })

  it('deleting also removes from templateKeys if present', async () => {
    const user = userEvent.setup({ delay: null })
    const { props } = renderEditor({
      variables: { var1: 'Hi {{ x }}', var2: 'b' },
      variableTypes: { var1: 'string', var2: 'string' },
      templateKeys: ['var1'],
    })

    await user.click(screen.getByTestId('varset-delete-0'))

    expect(props.onTemplateKeysChange).toHaveBeenCalledWith([])
  })
})

// =============================================================================
// Name editing updates variable map key
// =============================================================================

describe('Name Editing', () => {
  it('changing name renames the variable in the map', async () => {
    const user = userEvent.setup({ delay: null })
    const { props } = renderEditor({
      variables: { old_name: 'value' },
      variableTypes: { old_name: 'string' },
    })

    const nameInput = screen.getByTestId('varset-name-input-0')
    await user.clear(nameInput)
    await user.type(nameInput, 'new_name')
    fireEvent.blur(nameInput)

    expect(props.onVariablesChange).toHaveBeenCalledWith(
      expect.objectContaining({ new_name: 'value' }),
    )
  })
})

// =============================================================================
// Autocomplete selection
// =============================================================================

describe('Autocomplete Selection', () => {
  it('selecting a variable from autocomplete dropdown updates the name and type', async () => {
    const user = userEvent.setup({ delay: null })
    const { props } = renderEditor()

    const nameInput = screen.getByTestId('varset-name-input-0')

    await user.type(nameInput, 'time')

    await waitFor(() => {
      expect(screen.getByText('timeout')).toBeInTheDocument()
    })

    const suggestion = screen.getByText('timeout')
    fireEvent.click(suggestion.closest('[cmdk-item]')!)

    await waitFor(() => {
      expect(props.onVariablesChange).toHaveBeenCalledWith(
        expect.objectContaining({ timeout: 0 }),
      )
    })
  })

  it('selecting an existing complex variable seeds a typed-empty value (regression: array Edit crash)', async () => {
    // An existing array var reset to '' crashed the Edit sheet's ArrayEditBody
    // (value.map). Selecting it must reset type-appropriately ([] for an array).
    const user = userEvent.setup({ delay: null })
    const { props } = renderEditor({
      availableVariables: [{ name: 'my_arr', type: 'array' }],
    })

    // Typing the exact existing-var name selects it (same handleNameChange path
    // as the autocomplete click): the type becomes array and the value resets.
    const nameInput = screen.getByTestId('varset-name-input-0')
    await user.type(nameInput, 'my_arr')

    await waitFor(() => {
      expect(props.onVariablesChange).toHaveBeenCalledWith(
        expect.objectContaining({ my_arr: [] }),
      )
    })
    // The Edit-value button renders the empty-array summary - value is [] not ''.
    expect(screen.getByTestId('varset-edit-value-0')).toHaveTextContent('0 items')
  })
})

// =============================================================================
// variableTypes fallback (?? 'string')
// =============================================================================

describe('Variable Type Fallback', () => {
  it('defaults to string type when variable name is not in variableTypes', () => {
    renderEditor({
      variables: { untyped_var: 'hello' },
      variableTypes: {},
    })

    expect(screen.getByTestId('varset-type-select-0')).toHaveTextContent(/string/i)
  })
})

// =============================================================================
// Expression toggle on empty name (if (!name) return)
// =============================================================================

describe('Expression Toggle Guard', () => {
  it('toggles expression mode on row with empty name without adding to expressionKeys', async () => {
    const user = userEvent.setup({ delay: null })
    const { props } = renderEditor()

    await user.click(screen.getByTestId('varset-expression-toggle-0'))

    expect(props.onExpressionKeysChange).toHaveBeenCalledWith([])
  })
})

// =============================================================================
// Escape key in name input
// =============================================================================

describe('Escape Key Handling', () => {
  it('pressing Escape in name input closes autocomplete', async () => {
    const user = userEvent.setup({ delay: null })
    renderEditor()

    const nameInput = screen.getByTestId('varset-name-input-0')
    await user.type(nameInput, 'api')

    await waitFor(() => {
      expect(screen.getByText('api_url')).toBeInTheDocument()
    })

    fireEvent.keyDown(nameInput, { key: 'Escape' })

    await waitFor(() => {
      expect(screen.queryByText('api_url')).not.toBeInTheDocument()
    })
  })
})

// =============================================================================
// Expression mode with non-string value and empty name
// =============================================================================

describe('Expression Mode Edge Cases', () => {
  it('uses empty string fallback when expression value is non-string', () => {
    renderEditor({
      variables: { num_expr: 42 },
      variableTypes: { num_expr: 'integer' },
      expressionKeys: ['num_expr'],
    })

    expect(screen.getByTestId('expression-input-num_expr')).toHaveValue('')
  })
})

// =============================================================================
// Ctrl+Space keyboard shortcut
// =============================================================================

describe('Ctrl+Space Autocomplete Trigger', () => {
  it('pressing Ctrl+Space opens autocomplete dropdown', async () => {
    const user = userEvent.setup({ delay: null })
    renderEditor({
      variables: { api: 'value' },
      variableTypes: { api: 'string' },
    })

    const nameInput = screen.getByTestId('varset-name-input-0')

    await user.click(document.body)
    await waitFor(() => {
      expect(screen.queryByText('api_url')).not.toBeInTheDocument()
    })

    fireEvent.keyDown(nameInput, { key: ' ', ctrlKey: true })

    await waitFor(() => {
      expect(screen.getByText('api_url')).toBeInTheDocument()
    })
  })
})

// =============================================================================
// Type change resets the value by type
// =============================================================================

describe('Type Change', () => {
  it('changing type to array resets value to empty array', async () => {
    const user = userEvent.setup({ delay: null })
    const { props } = renderEditor({
      variables: { myvar: 'hello' },
      variableTypes: { myvar: 'string' },
    })

    const typeSelect = screen.getByTestId('varset-type-select-0')
    await user.click(typeSelect)

    await waitFor(() => {
      expect(screen.getByRole('option', { name: 'Array' })).toBeInTheDocument()
    })
    await user.click(screen.getByRole('option', { name: 'Array' }))

    await waitFor(() => {
      expect(props.onVariablesChange).toHaveBeenCalledWith(
        expect.objectContaining({ myvar: expect.any(Array) }),
      )
    })
  })

  it('changing type to map records the new type', async () => {
    const user = userEvent.setup({ delay: null })
    const { props } = renderEditor({
      variables: { myvar: 'hello' },
      variableTypes: { myvar: 'string' },
    })

    const typeSelect = screen.getByTestId('varset-type-select-0')
    await user.click(typeSelect)

    await waitFor(() => {
      expect(screen.getByRole('option', { name: 'Map' })).toBeInTheDocument()
    })
    await user.click(screen.getByRole('option', { name: 'Map' }))

    await waitFor(() => {
      expect(props.onTypesChange).toHaveBeenCalledWith(
        expect.objectContaining({ myvar: 'map' }),
      )
    })
  })

  it('changing type to boolean resets value to false', async () => {
    const user = userEvent.setup({ delay: null })
    const { props } = renderEditor({
      variables: { myvar: 'hello' },
      variableTypes: { myvar: 'string' },
    })

    const typeSelect = screen.getByTestId('varset-type-select-0')
    await user.click(typeSelect)

    await waitFor(() => {
      expect(screen.getByRole('option', { name: 'Boolean' })).toBeInTheDocument()
    })
    await user.click(screen.getByRole('option', { name: 'Boolean' }))

    await waitFor(() => {
      expect(props.onVariablesChange).toHaveBeenCalledWith(
        expect.objectContaining({ myvar: false }),
      )
    })
  })

  it('changing type to string resets value to empty string', async () => {
    const user = userEvent.setup({ delay: null })
    const { props } = renderEditor({
      variables: { myvar: 42 },
      variableTypes: { myvar: 'integer' },
    })

    const typeSelect = screen.getByTestId('varset-type-select-0')
    await user.click(typeSelect)

    await waitFor(() => {
      expect(screen.getByRole('option', { name: 'String' })).toBeInTheDocument()
    })
    await user.click(screen.getByRole('option', { name: 'String' }))

    await waitFor(() => {
      expect(props.onVariablesChange).toHaveBeenCalledWith(
        expect.objectContaining({ myvar: '' }),
      )
    })
  })

  it('changing type to table resets value to empty array', async () => {
    const user = userEvent.setup({ delay: null })
    const { props } = renderEditor({
      variables: { myvar: 'hello' },
      variableTypes: { myvar: 'string' },
    })

    const typeSelect = screen.getByTestId('varset-type-select-0')
    await user.click(typeSelect)

    await waitFor(() => {
      expect(screen.getByRole('option', { name: 'Table' })).toBeInTheDocument()
    })
    await user.click(screen.getByRole('option', { name: 'Table' }))

    await waitFor(() => {
      expect(props.onVariablesChange).toHaveBeenCalledWith(
        expect.objectContaining({ myvar: expect.any(Array) }),
      )
    })
  })
})

// =============================================================================
// Delete last row
// =============================================================================

describe('Delete Last Row', () => {
  it('deleting the only row leaves one empty row', async () => {
    const user = userEvent.setup({ delay: null })
    const { props } = renderEditor({
      variables: { solo: 'value' },
      variableTypes: { solo: 'string' },
    })

    await user.click(screen.getByTestId('varset-delete-0'))

    expect(props.onVariablesChange).toHaveBeenCalledWith({})

    expect(screen.getByTestId('varset-name-input-0')).toBeInTheDocument()
    expect(screen.getByTestId('varset-name-input-0')).toHaveValue('')
  })
})

describe('VariableSetterEditor - element types (REQ-3.1.3.19)', () => {
  it('opens a map row on its stored element types and stores the types the sheet saves', async () => {
    const user = userEvent.setup({ delay: null })
    const onElementTypesChange = vi.fn()
    renderEditor({
      variables: { m: { n: '1' } },
      variableTypes: { m: 'map' },
      variableElementTypes: { m: { n: 'float' } },
      onElementTypesChange,
    })
    await user.click(screen.getByTestId('varset-edit-value-0'))
    expect(screen.getByTestId('ves-element-types')).toHaveTextContent('{"n":"float"}')

    await user.click(screen.getByTestId('ves-save-typed-map'))
    expect(onElementTypesChange).toHaveBeenLastCalledWith({ m: { n: 'integer', zip: 'string' } })
  })

  it('drops a row\'s element types when its type changes', async () => {
    const user = userEvent.setup({ delay: null })
    const onElementTypesChange = vi.fn()
    renderEditor({
      variables: { m: { n: '1' } },
      variableTypes: { m: 'map' },
      variableElementTypes: { m: { n: 'integer' } },
      onElementTypesChange,
    })
    await user.click(screen.getByTestId('varset-type-select-0'))
    await user.click(await screen.findByRole('option', { name: 'Array' }))
    await waitFor(() => expect(onElementTypesChange).toHaveBeenLastCalledWith({}))
  })

  it('stores no element types for an expression row', async () => {
    const user = userEvent.setup({ delay: null })
    const onElementTypesChange = vi.fn()
    renderEditor({
      variables: { m: { n: '1' } },
      variableTypes: { m: 'map' },
      variableElementTypes: { m: { n: 'integer' } },
      onElementTypesChange,
    })
    await user.click(screen.getByTestId('varset-expression-toggle-0'))
    expect(onElementTypesChange).toHaveBeenLastCalledWith({})
  })

  it('drops the element types of a row renamed to an existing variable', () => {
    const onElementTypesChange = vi.fn()
    renderEditor({
      variables: { m: { n: '1' } },
      variableTypes: { m: 'map' },
      variableElementTypes: { m: { n: 'integer' } },
      availableVariables: [{ name: 'other_map', type: 'map' }],
      onElementTypesChange,
    })
    fireEvent.change(screen.getByTestId('varset-name-input-0'), { target: { value: 'other_map' } })
    expect(onElementTypesChange).toHaveBeenLastCalledWith({})
  })

  it('works without an element-type sink', async () => {
    const user = userEvent.setup({ delay: null })
    renderEditor({ variables: { m: {} }, variableTypes: { m: 'map' } })
    await user.click(screen.getByTestId('varset-edit-value-0'))
    expect(screen.getByTestId('ves-element-types')).toHaveTextContent('null')
    await user.click(screen.getByTestId('ves-save-typed-map'))
  })
})

// =============================================================================
// Value rules (REQ-3.4.3.8, VMGR-93, VMGR-95)
// =============================================================================

function touchRow(index: number) {
  fireEvent.blur(screen.getByTestId(`varset-name-input-${index}`))
}

describe('Value rules - expression rows', () => {
  it.each([
    ['empty text', ''],
    ['spaces only', '   '],
    ['a stored null', null],
  ])('blocks Save for an expression row holding %s and says "Expression is required"', async (_label, value) => {
    const { props } = renderEditor({
      variables: { result: value },
      variableTypes: { result: 'string' },
      expressionKeys: ['result'],
    })

    expect(props.onValidChange).toHaveBeenLastCalledWith(false)

    touchRow(0)

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/^Expression is required$/)
    })
    expect(screen.getByTestId('expression-input-result')).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByTestId('varset-name-input-0')).not.toHaveAttribute('aria-invalid')
    expect(screen.queryByRole('button', { name: 'result (null)' })).not.toBeInTheDocument()
  })

  it('blocks Save when the user empties an expression and unblocks it when one is typed', async () => {
    const user = userEvent.setup({ delay: null })
    const { props } = renderEditor({
      variables: { result: 'attempt + 1' },
      variableTypes: { result: 'string' },
      expressionKeys: ['result'],
    })
    expect(props.onValidChange).toHaveBeenLastCalledWith(true)

    await user.clear(screen.getByTestId('expression-input-result'))
    expect(props.onValidChange).toHaveBeenLastCalledWith(false)

    touchRow(0)
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/^Expression is required$/)
    })
    expect(screen.getByTestId('expression-input-result')).toHaveAttribute('aria-invalid', 'true')

    await user.type(screen.getByTestId('expression-input-result'), 'attempt')
    expect(props.onValidChange).toHaveBeenLastCalledWith(true)
    expect(props.onVariablesChange).toHaveBeenLastCalledWith({ result: 'attempt' })
    await waitFor(() => {
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    })
    expect(screen.getByTestId('expression-input-result')).not.toHaveAttribute('aria-invalid')
  })

  it('blocks Save when an empty text row becomes an expression and unblocks it when it turns back', async () => {
    const user = userEvent.setup({ delay: null })
    const { props } = renderEditor({
      variables: { note: '' },
      variableTypes: { note: 'string' },
    })
    expect(props.onValidChange).toHaveBeenLastCalledWith(true)

    await user.click(screen.getByTestId('varset-expression-toggle-0'))
    expect(props.onValidChange).toHaveBeenLastCalledWith(false)

    touchRow(0)
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/^Expression is required$/)
    })

    await user.click(screen.getByTestId('varset-expression-toggle-0'))
    expect(props.onValidChange).toHaveBeenLastCalledWith(true)
    await waitFor(() => {
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    })
  })
})

describe('Value rules - text rows', () => {
  it('does not block Save for an empty text row and writes empty text', async () => {
    const user = userEvent.setup({ delay: null })
    const { props } = renderEditor()

    const nameInput = screen.getByTestId('varset-name-input-0')
    await user.type(nameInput, 'note')
    fireEvent.blur(nameInput)

    expect(props.onVariablesChange).toHaveBeenLastCalledWith({ note: '' })
    expect(props.onTypesChange).toHaveBeenLastCalledWith({ note: 'string' })
    expect(props.onValidChange).toHaveBeenLastCalledWith(true)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})

describe('Value rules - an emptied number box', () => {
  beforeEach(() => {
    scalarBody.real = true
  })

  afterEach(() => {
    scalarBody.real = false
  })

  it.each([
    ['integer', '5', 'Must be a valid integer'],
    ['float', '2.5', 'Must be a valid number'],
  ] as const)('blocks Save for an emptied %s box and never writes 0', async (type, stored, message) => {
    const user = userEvent.setup({ delay: null })
    const { props } = renderEditor({
      variables: { count: stored },
      variableTypes: { count: type },
    })

    await user.clear(screen.getByTestId('scalar-edit-input'))

    expect(props.onValidChange).toHaveBeenLastCalledWith(false)
    expect(props.onVariablesChange).not.toHaveBeenCalledWith({ count: '0' })
    expect(props.onVariablesChange).not.toHaveBeenCalledWith({ count: 0 })

    touchRow(0)
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(new RegExp(`^${message}$`))
    })
    const input = screen.getByTestId('scalar-edit-input')
    expect(input).toHaveValue('')
    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(input).toHaveAccessibleDescription(message)
    expect(props.onValidChange).toHaveBeenLastCalledWith(false)
  })

  it.each([
    ['integer', '5'],
    ['float', '2.5'],
  ] as const)('unblocks Save when a number is typed into the emptied %s box', async (type, stored) => {
    const user = userEvent.setup({ delay: null })
    const { props } = renderEditor({
      variables: { count: stored },
      variableTypes: { count: type },
    })

    await user.clear(screen.getByTestId('scalar-edit-input'))
    await user.type(screen.getByTestId('scalar-edit-input'), '7')
    touchRow(0)

    expect(props.onValidChange).toHaveBeenLastCalledWith(true)
    expect(props.onVariablesChange).toHaveBeenLastCalledWith({ count: '7' })
    await waitFor(() => {
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    })
    expect(screen.getByTestId('scalar-edit-input')).not.toHaveAttribute('aria-invalid')
  })
})

describe('Value rules - unfinished number text (REQ-3.1.3.14)', () => {
  beforeEach(() => {
    scalarBody.real = true
  })

  afterEach(() => {
    scalarBody.real = false
  })

  it.each([
    ['integer', '5', '-', 'Enter a valid integer value'],
    ['float', '2.5', '2.', 'Enter a valid float value'],
  ] as const)('names unfinished %s text under the row as it is typed and blocks Save', async (type, stored, typed, message) => {
    const user = userEvent.setup({ delay: null })
    const { props } = renderEditor({
      variables: { count: stored },
      variableTypes: { count: type },
    })

    await user.clear(screen.getByTestId('scalar-edit-input'))
    await user.type(screen.getByTestId('scalar-edit-input'), typed)

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(new RegExp(`^${message}$`))
    })
    expect(props.onValidChange).toHaveBeenLastCalledWith(false)
  })
})

describe('Value rules - a stored null literal', () => {
  it.each([
    ['string', ''],
    ['integer', 0],
    ['float', 0],
    ['boolean', false],
    ['array', []],
    ['map', {}],
    ['table', []],
  ] as const)('shows a stored null %s as the null chip and gives the type default on click', async (type, typeDefault) => {
    const user = userEvent.setup({ delay: null })
    const { props } = renderEditor({
      variables: { retries: null },
      variableTypes: { retries: type },
    })

    const chip = screen.getByRole('button', { name: 'retries (null)' })
    expect(chip).toHaveTextContent(/^null$/)

    await user.click(chip)

    expect(props.onVariablesChange).toHaveBeenLastCalledWith({ retries: typeDefault })
    expect(screen.queryByRole('button', { name: 'retries (null)' })).not.toBeInTheDocument()
  })

  it('explains the null chip with "Click to enter a value"', async () => {
    renderEditor({
      variables: { retries: null },
      variableTypes: { retries: 'integer' },
    })

    const chip = screen.getByRole('button', { name: 'retries (null)' })
    act(() => chip.focus())

    expect(await screen.findByRole('tooltip')).toHaveTextContent(/^Click to enter a value$/)
  })

  it('keeps a string holding the text "null" an ordinary string', () => {
    renderEditor({
      variables: { label: 'null' },
      variableTypes: { label: 'string' },
    })

    expect(screen.getByTestId('varset-edit-value-0')).toHaveTextContent(/^"null"$/)
    expect(screen.queryByRole('button', { name: 'label (null)' })).not.toBeInTheDocument()
  })
})

describe('Accessible names and error links', () => {
  it('names the name field by its column', () => {
    renderEditor()
    expect(screen.getByRole('textbox', { name: 'Name' })).toBe(screen.getByTestId('varset-name-input-0'))
  })

  it('links an invalid name to its message', async () => {
    const user = userEvent.setup({ delay: null })
    renderEditor()
    const nameInput = screen.getByTestId('varset-name-input-0')
    await user.type(nameInput, '123invalid')
    fireEvent.blur(nameInput)

    const message = await screen.findByRole('alert')
    expect(message.id).not.toBe('')
    expect(nameInput).toHaveAttribute('aria-describedby', message.id)
  })

  it('does not point a valid name at a message', () => {
    renderEditor({ variables: { count: 'a' }, variableTypes: { count: 'string' } })
    expect(screen.getByTestId('varset-name-input-0')).not.toHaveAttribute('aria-describedby')
  })
})
