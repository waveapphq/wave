/**
 * VariableReadonlyTable Component Tests
 *
 * Tests for the shared read-only variable display component used by
 * System Variables (settings tab) and Suite Variables (suite detail sidebar).
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { VariableReadonlyTable } from '@/components/shared/variable-editor/variable-readonly-table'
import { NULL_LOOK_CLASS } from '@/lib/variable-format'
import { useMaskingSettingsStore } from '@/stores/masking-settings-store'

// ============================================================================
// Empty State Tests
// ============================================================================

describe('VariableReadonlyTable - empty state', () => {
  it('renders default empty message when no variables provided', () => {
    render(<VariableReadonlyTable variables={{}} />)
    const table = screen.getByTestId('variable-readonly-table')
    expect(table).toHaveTextContent('No variables defined')
  })

  it('renders custom empty message when provided', () => {
    render(<VariableReadonlyTable variables={{}} emptyMessage="No suite variables configured" />)
    const table = screen.getByTestId('variable-readonly-table')
    expect(table).toHaveTextContent('No suite variables configured')
  })

  it('does not render any variable rows when empty', () => {
    render(<VariableReadonlyTable variables={{}} />)
    expect(screen.queryAllByTestId('variable-row')).toHaveLength(0)
  })

  it('applies centered styling to empty state', () => {
    render(<VariableReadonlyTable variables={{}} />)
    const table = screen.getByTestId('variable-readonly-table')
    expect(table).toHaveClass('text-center')
  })
})

// ============================================================================
// Variable Rendering Tests
// ============================================================================

describe('VariableReadonlyTable - variable rendering', () => {
  const variables = {
    myString: { type: 'string' as const, value: 'hello', secret: false },
    myInteger: { type: 'integer' as const, value: '42', secret: false },
    myFloat: { type: 'float' as const, value: '3.14', secret: false },
    myBoolean: { type: 'boolean' as const, value: 'true', secret: false },
  }

  it('renders the correct number of rows', () => {
    render(<VariableReadonlyTable variables={variables} />)
    expect(screen.getAllByTestId('variable-row')).toHaveLength(4)
  })

  it('renders variable names', () => {
    render(<VariableReadonlyTable variables={variables} />)
    expect(screen.getByText('myString')).toBeVisible()
    expect(screen.getByText('myInteger')).toBeVisible()
    expect(screen.getByText('myFloat')).toBeVisible()
    expect(screen.getByText('myBoolean')).toBeVisible()
  })

  it('renders type badges for each variable', () => {
    render(<VariableReadonlyTable variables={variables} />)
    expect(screen.getByText('string')).toBeVisible()
    expect(screen.getByText('integer')).toBeVisible()
    expect(screen.getByText('float')).toBeVisible()
    expect(screen.getByText('boolean')).toBeVisible()
  })

  it('applies correct container classes', () => {
    render(<VariableReadonlyTable variables={variables} />)
    const table = screen.getByTestId('variable-readonly-table')
    expect(table).toHaveClass('rounded-md', 'border', 'overflow-hidden')
  })
})

// ============================================================================
// Value Formatting Tests
// ============================================================================

describe('VariableReadonlyTable - value formatting', () => {
  it('renders string values raw (no wrapping quotes)', () => {
    render(
      <VariableReadonlyTable
        variables={{ myVar: { type: 'string', value: 'hello', secret: false } }}
      />
    )
    expect(screen.getByText('hello')).toBeVisible()
  })

  it('displays integer values without quotes', () => {
    render(
      <VariableReadonlyTable
        variables={{ myVar: { type: 'integer', value: '42', secret: false } }}
      />
    )
    expect(screen.getByText('42')).toBeVisible()
  })

  it('displays float values without quotes', () => {
    render(
      <VariableReadonlyTable
        variables={{ myVar: { type: 'float', value: '3.14', secret: false } }}
      />
    )
    expect(screen.getByText('3.14')).toBeVisible()
  })

  it('displays boolean values without quotes', () => {
    render(
      <VariableReadonlyTable
        variables={{ myVar: { type: 'boolean', value: 'true', secret: false } }}
      />
    )
    expect(screen.getByText('true')).toBeVisible()
  })

  it('displays array summary', () => {
    render(
      <VariableReadonlyTable
        variables={{ myVar: { type: 'array', value: '[1,2,3]', secret: false } }}
      />
    )
    expect(screen.getByText('[3 items]')).toBeVisible()
  })

  it('displays map summary', () => {
    render(
      <VariableReadonlyTable
        variables={{ myVar: { type: 'map', value: '{"a":1,"b":2}', secret: false } }}
      />
    )
    expect(screen.getByText('{2 keys}')).toBeVisible()
  })
})

// ============================================================================
// Secret Variable Tests
// ============================================================================

describe('VariableReadonlyTable - secret variables', () => {
  it('shows asterisks for secret variable values', () => {
    render(
      <VariableReadonlyTable
        variables={{ apiKey: { type: 'string', value: 'super-secret', secret: true } }}
      />
    )
    expect(screen.getByText('********')).toBeVisible()
  })

  it('does not expose the raw value of secret variables', () => {
    render(
      <VariableReadonlyTable
        variables={{ apiKey: { type: 'string', value: 'super-secret', secret: true } }}
      />
    )
    expect(screen.queryByText('super-secret')).not.toBeInTheDocument()
  })

  it('renders lock icon for secret variables', () => {
    render(
      <VariableReadonlyTable
        variables={{ apiKey: { type: 'string', value: 'super-secret', secret: true } }}
      />
    )
    // lucide-react renders SVG icons; verify an svg is present in the variable row
    const row = screen.getByTestId('variable-row')
    const svg = row.querySelector('svg')
    expect(svg).toBeInTheDocument()
  })

  it('does not render lock icon for non-secret variables', () => {
    const { container: _ } = render(
      <VariableReadonlyTable
        variables={{ normalVar: { type: 'string', value: 'visible', secret: false } }}
      />
    )
    const row = screen.getByTestId('variable-row')
    const svg = row.querySelector('svg')
    expect(svg).not.toBeInTheDocument()
  })
})

// ============================================================================
// System Reveal Tests (shared_variables)
// ============================================================================

describe('VariableReadonlyTable - system shared_variables reveal', () => {
  // Reset before each test (nothing mounted yet) to avoid an out-of-act re-render.
  beforeEach(() => {
    useMaskingSettingsStore.setState({ sharedVariables: false })
  })

  it('reveals the plaintext secret value when shared_variables is on', () => {
    useMaskingSettingsStore.setState({ sharedVariables: true })
    render(
      <VariableReadonlyTable
        variables={{ apiKey: { type: 'string', value: 'super-secret', secret: true } }}
      />
    )
    expect(screen.getByText('super-secret')).toBeVisible()
    expect(screen.queryByText('********')).not.toBeInTheDocument()
  })

  it('still marks the row as a secret (lock icon) when revealed', () => {
    useMaskingSettingsStore.setState({ sharedVariables: true })
    render(
      <VariableReadonlyTable
        variables={{ apiKey: { type: 'string', value: 'super-secret', secret: true } }}
      />
    )
    const row = screen.getByTestId('variable-row')
    expect(row.querySelector('svg')).toBeInTheDocument()
  })

  it('masks again when shared_variables is off', () => {
    useMaskingSettingsStore.setState({ sharedVariables: false })
    render(
      <VariableReadonlyTable
        variables={{ apiKey: { type: 'string', value: 'super-secret', secret: true } }}
      />
    )
    expect(screen.getByText('********')).toBeVisible()
    expect(screen.queryByText('super-secret')).not.toBeInTheDocument()
  })
})

// ============================================================================
// Type Badge Tests
// ============================================================================

describe('VariableReadonlyTable - all type badges', () => {
  const allTypes = ['string', 'integer', 'float', 'boolean', 'array', 'map', 'table'] as const

  it.each(allTypes)('renders type badge for %s', (type) => {
    const value = type === 'array' ? '[]' : type === 'map' ? '{}' : type === 'table' ? '[]' : 'val'
    render(
      <VariableReadonlyTable
        variables={{ v: { type, value, secret: false } }}
      />
    )
    expect(screen.getByText(type)).toBeVisible()
  })
})

// ============================================================================
// Empty secrets: a secret holding nothing reads empty, never masked
// ============================================================================

describe('VariableReadonlyTable - a secret holding nothing', () => {
  beforeEach(() => {
    useMaskingSettingsStore.setState({ sharedVariables: false })
  })

  it.each(['string', 'integer', 'array', 'map'] as const)('shows an empty %s secret as empty', (type) => {
    render(<VariableReadonlyTable variables={{ apiKey: { type, value: '', secret: true } }} />)

    expect(screen.getByTestId('variable-value').textContent).toBe('')
    expect(screen.queryByText('********')).not.toBeInTheDocument()
  })

  it.each([
    ['whitespace', '   '],
    ['a sealed envelope', 'wave:enc:v1:abc'],
    ['the mask', '********'],
  ])('masks a secret holding %s', (_label, value) => {
    render(<VariableReadonlyTable variables={{ apiKey: { type: 'string', value, secret: true } }} />)

    expect(screen.getByTestId('variable-value').textContent).toBe('********')
  })
})

// ============================================================================
// Null look and list / map / table summaries (REQ-3.1.3.20, VMGR-93)
// ============================================================================

type ReadonlyVariables = Parameters<typeof VariableReadonlyTable>[0]['variables']

const NULL_VALUE = null as unknown as string

/** The classes of the one null look; fails clearly while the constant is missing. */
function nullLookClasses(): string[] {
  expect(NULL_LOOK_CLASS, 'variable-format exports NULL_LOOK_CLASS').toBeTypeOf('string')
  const classes = NULL_LOOK_CLASS.split(/\s+/).filter(Boolean)
  expect(classes.length).toBeGreaterThan(0)
  return classes
}

describe('VariableReadonlyTable - null values', () => {
  beforeEach(() => {
    useMaskingSettingsStore.setState({ sharedVariables: false })
  })

  it.each(['string', 'integer', 'float', 'boolean', 'array', 'map', 'table'] as const)(
    'shows a null %s as null in the null look beside the type pill',
    (type) => {
      render(<VariableReadonlyTable variables={{ v: { type, value: NULL_VALUE, secret: false } }} />)

      const row = screen.getByTestId('variable-row')
      expect(within(row).getByText(type)).toBeVisible()
      expect(within(row).getByText('null')).toHaveClass(...nullLookClasses())
    },
  )

  it('shows a variable with no value as null in the null look', () => {
    const variables = { v: { type: 'integer', secret: false } } as unknown as ReadonlyVariables
    render(<VariableReadonlyTable variables={variables} />)

    expect(within(screen.getByTestId('variable-row')).getByText('null')).toHaveClass(
      ...nullLookClasses(),
    )
  })

  it('shows a null secret as null in the null look, never the mask', () => {
    render(
      <VariableReadonlyTable variables={{ apiKey: { type: 'string', value: NULL_VALUE, secret: true } }} />,
    )

    expect(within(screen.getByTestId('variable-row')).getByText('null')).toHaveClass(
      ...nullLookClasses(),
    )
    expect(screen.queryByText('********')).not.toBeInTheDocument()
  })

  it('shows a string holding the text "null" as an ordinary string, not in the null look', () => {
    render(<VariableReadonlyTable variables={{ v: { type: 'string', value: 'null', secret: false } }} />)

    expect(within(screen.getByTestId('variable-row')).getByText('null')).not.toHaveClass(
      ...nullLookClasses(),
    )
  })
})

describe('VariableReadonlyTable - list, map and table summaries', () => {
  it.each([
    ['array', '[1]', '[1 item]'],
    ['array', '[]', '[0 items]'],
    ['map', '{"a":1}', '{1 key}'],
    ['map', '{}', '{0 keys}'],
    ['table', '[{"a":1,"b":2},{"a":3,"b":4},{"a":5,"b":6}]', '3×2 table'],
    ['table', '[]', '0×0 table'],
  ] as const)('summarizes the %s text %s as %s', (type, value, summary) => {
    render(<VariableReadonlyTable variables={{ v: { type, value, secret: false } }} />)
    expect(screen.getByText(summary)).toBeVisible()
  })

  it.each([
    ['array', '[3 items]', [1, 2, 3]],
    ['map', '{2 keys}', { a: 1, b: 2 }],
    ['table', '1×2 table', [{ a: 1, b: 2 }]],
  ] as const)('summarizes a structured %s value as %s', (type, summary, value) => {
    render(
      <VariableReadonlyTable
        variables={{ v: { type, value: value as unknown as string, secret: false } }}
      />,
    )
    expect(screen.getByText(summary)).toBeVisible()
  })

  it.each([
    ['array', '[0 items]'],
    ['map', '{0 keys}'],
    ['table', '0×0 table'],
  ] as const)('summarizes an empty-text %s as %s, never as an edit prompt', (type, summary) => {
    render(<VariableReadonlyTable variables={{ v: { type, value: '', secret: false } }} />)
    expect(screen.getByText(summary)).toBeVisible()
    expect(screen.queryByText('Edit…')).not.toBeInTheDocument()
  })
})
