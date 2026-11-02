/**
 * FilterBlockBuilder tests (design decisions CSV-8, CSV-9, CSV-10, wireframe CSV Filter block).
 *
 * Per-column filter blocks: each block targets one column (ColumnRef) with a
 * declared `as Type`, and holds conditions - literal (operator + value) and/or
 * expression (a per-row predicate over the column value via `_cell`) - combined
 * with the assertion control's AND/OR grouping. Blocks AND together. The literal
 * operator vocabulary follows the block's `as Type` (reuses OPERATORS_BY_TYPE).
 * Controlled: emits the whole next array via onChange.
 */

import { fireEvent, render, screen, within } from '@testing-library/react'
import { useState } from 'react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

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

// CodeMirror does not work in jsdom; render the expression field as a plain input.
vi.mock('@/features/workbench/common/element-config/expressions/expression-field', () => ({
  ExpressionField: ({
    name,
    value,
    onChange,
    placeholder,
  }: {
    name: string
    value: string
    onChange: (v: string) => void
    placeholder?: string
  }) => (
    <input
      data-testid={`mock-expression-field-${name}`}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
    />
  ),
}))

import { FilterBlockBuilder } from '@/features/workbench/common/config/table-transform/filter-block-builder'
import type { TableFilterBlock } from '@/features/workbench/common/config/table-transform/types'
import {
  getOperatorsForType,
  type AssertionItem,
} from '@/features/workbench/common/config/assertion-builder/types'

function literal(id: string, valueType: string, operator: string): AssertionItem {
  return {
    id,
    type: 'literal',
    variable: '_cell',
    value_type: valueType,
    operator,
    reference_value: '',
    reference_is_expression: false,
  }
}

function block(
  id: string,
  asType: TableFilterBlock['asType'],
  conditions: AssertionItem[] = [],
): TableFilterBlock {
  return { id, column: { mode: 'name', value: 'score' }, asType, conditions }
}

function renderBuilder(overrides: Partial<React.ComponentProps<typeof FilterBlockBuilder>> = {}) {
  const onChange = (overrides.onChange ?? vi.fn()) as ReturnType<typeof vi.fn>
  const props = {
    filters: [] as TableFilterBlock[],
    columnRefProps: { hasHeader: true },
    onChange,
    ...overrides,
  }
  render(<FilterBlockBuilder {...props} />)
  return { onChange }
}

function StatefulFilterBuilder({
  initial,
  onChange,
}: Readonly<{ initial: TableFilterBlock[]; onChange: (filters: TableFilterBlock[]) => void }>) {
  const [filters, setFilters] = useState(initial)
  return (
    <FilterBlockBuilder
      filters={filters}
      columnRefProps={{ hasHeader: true }}
      onChange={(next) => {
        setFilters(next)
        onChange(next)
      }}
    />
  )
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('empty state', () => {
  it('renders an Add Filter button and no blocks', () => {
    renderBuilder()

    expect(screen.getByTestId('filter-add-block')).toBeInTheDocument()
    expect(screen.queryByTestId('filter-block-b1')).not.toBeInTheDocument()
  })
})

describe('block lifecycle', () => {
  it('appends a new empty string-typed block', async () => {
    const user = userEvent.setup()
    const { onChange } = renderBuilder({ filters: [] })

    await user.click(screen.getByTestId('filter-add-block'))

    const next = onChange.mock.calls.at(-1)![0] as TableFilterBlock[]
    expect(next).toHaveLength(1)
    expect(next[0].asType).toBe('string')
    expect(next[0].conditions).toEqual([])
  })

  it('renders a block with a column ref and a delete affordance', () => {
    renderBuilder({ filters: [block('b1', 'integer')] })

    const el = screen.getByTestId('filter-block-b1')
    expect(within(el).getByTestId('column-ref-mode')).toBeInTheDocument()
    expect(screen.getByTestId('filter-delete-block-b1')).toBeInTheDocument()
  })

  it('deletes a block', async () => {
    const user = userEvent.setup()
    const { onChange } = renderBuilder({ filters: [block('b1', 'integer')] })

    await user.click(screen.getByTestId('filter-delete-block-b1'))

    expect(onChange).toHaveBeenCalledWith([])
  })
})

describe('as Type', () => {
  it('offers the four column types', async () => {
    const user = userEvent.setup()
    renderBuilder({ filters: [block('b1', 'string')] })

    await user.click(screen.getByTestId('filter-astype-b1'))
    const labels = (await screen.findAllByRole('option')).map((o) => o.textContent?.trim())
    expect(labels).toEqual(expect.arrayContaining(['String', 'Integer', 'Float', 'Boolean']))
  })

  it('emits the updated as Type', async () => {
    const user = userEvent.setup()
    const { onChange } = renderBuilder({ filters: [block('b1', 'string')] })

    await user.click(screen.getByTestId('filter-astype-b1'))
    await user.click(await screen.findByRole('option', { name: /integer/i }))

    const next = onChange.mock.calls.at(-1)![0] as TableFilterBlock[]
    expect(next[0].asType).toBe('integer')
  })

  it('compares every literal row as the new as Type and leaves the other rows as they are (CSV-12)', async () => {
    const user = userEvent.setup()
    const expressionRow: AssertionItem = { id: 'c2', type: 'expression', expression: '_cell != None' }
    const andRow: AssertionItem = { type: 'operator', value: 'and' }
    const { onChange } = renderBuilder({
      filters: [block('b1', 'string', [literal('c1', 'string', 'equals'), andRow, expressionRow])],
    })

    await user.click(screen.getByTestId('filter-astype-b1'))
    await user.click(await screen.findByRole('option', { name: /integer/i }))

    const next = onChange.mock.calls.at(-1)![0] as TableFilterBlock[]
    expect(next[0].conditions).toEqual([literal('c1', 'integer', 'equals'), andRow, expressionRow])
  })
})

describe('conditions', () => {
  it('adds a literal condition scoped to _cell at the block type', async () => {
    const user = userEvent.setup()
    const { onChange } = renderBuilder({ filters: [block('b1', 'integer')] })

    await user.click(screen.getByTestId('filter-add-literal-b1'))

    const next = onChange.mock.calls.at(-1)![0] as TableFilterBlock[]
    expect(next[0].conditions).toHaveLength(1)
    const cond = next[0].conditions[0]
    expect(cond.type).toBe('literal')
    if (cond.type === 'literal') {
      expect(cond.variable).toBe('_cell')
      expect(cond.value_type).toBe('integer')
    }
  })

  it('adds an expression condition', async () => {
    const user = userEvent.setup()
    const { onChange } = renderBuilder({ filters: [block('b1', 'integer')] })

    await user.click(screen.getByTestId('filter-add-expression-b1'))

    const next = onChange.mock.calls.at(-1)![0] as TableFilterBlock[]
    expect(next[0].conditions).toHaveLength(1)
    expect(next[0].conditions[0].type).toBe('expression')
  })

  it('inserts an AND operator between two conditions (reuses the grouping helpers)', async () => {
    const user = userEvent.setup()
    const { onChange } = renderBuilder({
      filters: [block('b1', 'integer', [literal('c1', 'integer', 'greater_than')])],
    })

    await user.click(screen.getByTestId('filter-add-literal-b1'))

    const next = onChange.mock.calls.at(-1)![0] as TableFilterBlock[]
    expect(next[0].conditions).toHaveLength(3)
    expect(next[0].conditions[1]).toEqual({ type: 'operator', value: 'and' })
  })

  it('drives the literal operator options from the block type (integer)', async () => {
    const user = userEvent.setup()
    renderBuilder({
      filters: [block('b1', 'integer', [literal('c1', 'integer', 'greater_than')])],
    })

    await user.click(screen.getByTestId('filter-condition-operator-c1'))
    const labels = (await screen.findAllByRole('option')).map((o) => o.textContent?.trim())
    expect(labels).toEqual(getOperatorsForType('integer').map((o) => o.label))
  })

  it('drives the literal operator options from the block type (string)', async () => {
    const user = userEvent.setup()
    renderBuilder({
      filters: [block('b1', 'string', [literal('c1', 'string', 'contains')])],
    })

    await user.click(screen.getByTestId('filter-condition-operator-c1'))
    const labels = (await screen.findAllByRole('option')).map((o) => o.textContent?.trim())
    expect(labels).toEqual(expect.arrayContaining(['contains', 'starts with']))
  })

  it('shows the _cell placeholder on an expression condition', () => {
    renderBuilder({
      filters: [block('b1', 'integer', [{ id: 'e1', type: 'expression', expression: '' }])],
    })

    expect(screen.getByPlaceholderText('_cell != None')).toBeInTheDocument()
  })
})

describe('multi-block and condition editing', () => {
  it('renders an AND pill between blocks (blocks AND together)', () => {
    renderBuilder({ filters: [block('b1', 'integer'), block('b2', 'string')] })

    expect(screen.getAllByText('AND').length).toBeGreaterThanOrEqual(1)
  })

  it('renders an operator pill between two conditions', () => {
    renderBuilder({
      filters: [
        block('b1', 'integer', [
          literal('c1', 'integer', 'greater_than'),
          { type: 'operator', value: 'or' },
          literal('c2', 'integer', 'less_than'),
        ]),
      ],
    })

    expect(screen.getByText('OR')).toBeInTheDocument()
  })

  it('edits an expression condition', async () => {
    const user = userEvent.setup()
    const { onChange } = renderBuilder({
      filters: [block('b1', 'integer', [{ id: 'e1', type: 'expression', expression: '' }])],
    })

    await user.type(screen.getByTestId('mock-expression-field-csv-filter-expr-e1'), 'x')

    const next = onChange.mock.calls.at(-1)![0] as TableFilterBlock[]
    const cond = next[0].conditions[0]
    expect(cond.type === 'expression' && cond.expression).toBe('x')
  })

  it('changes a literal operator', async () => {
    const user = userEvent.setup()
    const { onChange } = renderBuilder({
      filters: [block('b1', 'integer', [literal('c1', 'integer', 'greater_than')])],
    })

    await user.click(screen.getByTestId('filter-condition-operator-c1'))
    await user.click(await screen.findByRole('option', { name: /less than/i }))

    const next = onChange.mock.calls.at(-1)![0] as TableFilterBlock[]
    const cond = next[0].conditions[0]
    expect(cond.type === 'literal' && cond.operator).toBe('less_than')
  })

  it('edits a literal reference value in text mode', async () => {
    const user = userEvent.setup()
    const { onChange } = renderBuilder({
      filters: [block('b1', 'integer', [literal('c1', 'integer', 'greater_than')])],
    })

    await user.type(screen.getByTestId('filter-condition-value-c1'), '5')

    const next = onChange.mock.calls.at(-1)![0] as TableFilterBlock[]
    const cond = next[0].conditions[0]
    expect(cond.type === 'literal' && cond.reference_value).toBe('5')
  })

  // A literal compared As Integer / Float takes only what the number rule takes (REQ-3.1.3.14).
  it.each([
    ['integer', '1e5'],
    ['integer', '2.5'],
    ['float', 'abc'],
  ] as const)('drops a key the %s rule refuses in a literal value: %j', (asType, typed) => {
    const { onChange } = renderBuilder({ filters: [block('b1', asType, [literal('c1', asType, 'greater_than')])] })

    fireEvent.change(screen.getByTestId('filter-condition-value-c1'), { target: { value: typed } })

    expect(onChange).not.toHaveBeenCalled()
  })

  it.each([
    ['integer', 'numeric'],
    ['float', 'decimal'],
  ] as const)('brings up the number keyboard for a literal compared As %s', (asType, inputMode) => {
    renderBuilder({ filters: [block('b1', asType, [literal('c1', asType, 'greater_than')])] })

    expect(screen.getByTestId('filter-condition-value-c1')).toHaveAttribute('inputmode', inputMode)
  })

  it('leaves a literal compared As String free of the number rule', () => {
    const { onChange } = renderBuilder({ filters: [block('b1', 'string', [literal('c1', 'string', 'equals')])] })
    expect(screen.getByTestId('filter-condition-value-c1')).not.toHaveAttribute('inputmode')

    fireEvent.change(screen.getByTestId('filter-condition-value-c1'), { target: { value: '1e5' } })

    const cond = (onChange.mock.calls.at(-1)![0] as TableFilterBlock[])[0].conditions[0]
    expect(cond.type === 'literal' && cond.reference_value).toBe('1e5')
  })

  it('draws the shared {x} toggle beside a literal value', () => {
    renderBuilder({
      filters: [block('b1', 'integer', [literal('c1', 'integer', 'greater_than')])],
    })
    const toggle = screen.getByTestId('filter-condition-expr-toggle-c1')
    expect(toggle).toHaveAttribute('data-slot', 'expression-toggle')
    expect(toggle).toHaveAccessibleName(/^Toggle expression mode for value$/)
  })

  it('toggles a literal value into expression mode', async () => {
    const user = userEvent.setup()
    const { onChange } = renderBuilder({
      filters: [block('b1', 'integer', [literal('c1', 'integer', 'greater_than')])],
    })

    await user.click(screen.getByTestId('filter-condition-expr-toggle-c1'))

    const next = onChange.mock.calls.at(-1)![0] as TableFilterBlock[]
    const cond = next[0].conditions[0]
    expect(cond.type === 'literal' && cond.reference_is_expression).toBe(true)
  })

  it('renders and edits a reference-expression literal value', async () => {
    const user = userEvent.setup()
    const refExprLiteral: AssertionItem = {
      ...literal('c1', 'integer', 'greater_than'),
      reference_is_expression: true,
    } as AssertionItem
    const { onChange } = renderBuilder({ filters: [block('b1', 'integer', [refExprLiteral])] })

    await user.type(screen.getByTestId('mock-expression-field-csv-filter-ref-c1'), '9')

    const next = onChange.mock.calls.at(-1)![0] as TableFilterBlock[]
    const cond = next[0].conditions[0]
    expect(cond.type === 'literal' && cond.reference_value).toBe('9')
  })

  it('deletes a condition', async () => {
    const user = userEvent.setup()
    const { onChange } = renderBuilder({
      filters: [block('b1', 'integer', [literal('c1', 'integer', 'greater_than')])],
    })

    await user.click(screen.getByTestId('filter-condition-delete-c1'))

    const next = onChange.mock.calls.at(-1)![0] as TableFilterBlock[]
    expect(next[0].conditions).toEqual([])
  })

  it('deletes an expression condition', async () => {
    const user = userEvent.setup()
    const { onChange } = renderBuilder({
      filters: [block('b1', 'integer', [{ id: 'e1', type: 'expression', expression: '_cell > 2' }])],
    })

    await user.click(screen.getByTestId('filter-condition-delete-e1'))

    const next = onChange.mock.calls.at(-1)![0] as TableFilterBlock[]
    expect(next[0].conditions).toEqual([])
  })

  it('renders nothing for an unsupported condition type', () => {
    renderBuilder({
      filters: [block('b1', 'integer', [{ id: 'g1', type: 'group', items: [] }])],
    })

    expect(screen.getByTestId('filter-block-b1')).toBeInTheDocument()
    expect(screen.queryByTestId('filter-condition-operator-g1')).not.toBeInTheDocument()
  })

  it('renders an empty value field for a null text-mode reference value', () => {
    const nullLiteral: AssertionItem = {
      ...literal('c1', 'integer', 'greater_than'),
      reference_value: null,
    } as AssertionItem
    renderBuilder({ filters: [block('b1', 'integer', [nullLiteral])] })

    expect(screen.getByTestId('filter-condition-value-c1')).toHaveValue('')
  })

  it('renders an empty expression field for a null reference-expression value', () => {
    const nullExprLiteral: AssertionItem = {
      ...literal('c1', 'integer', 'greater_than'),
      reference_value: null,
      reference_is_expression: true,
    } as AssertionItem
    renderBuilder({ filters: [block('b1', 'integer', [nullExprLiteral])] })

    expect(screen.getByTestId('mock-expression-field-csv-filter-ref-c1')).toHaveValue('')
  })

  it('updates a block column when its reference changes', async () => {
    const user = userEvent.setup()
    const emptyColBlock: TableFilterBlock = {
      id: 'b1',
      column: { mode: 'name', value: '' },
      asType: 'integer',
      conditions: [],
    }
    const { onChange } = renderBuilder({ filters: [emptyColBlock] })

    const el = screen.getByTestId('filter-block-b1')
    await user.type(within(el).getByTestId('column-ref-value'), 'region')

    const next = onChange.mock.calls.at(-1)![0] as TableFilterBlock[]
    expect(next[0].column).toEqual({ mode: 'name', value: 'region' })
  })
})

describe('is null and not null on a filter row (REQ-3.1.3.25, CSV-12)', () => {
  it('a new Boolean row lands on is true and stores no compare-to value', async () => {
    const user = userEvent.setup()
    const { onChange } = renderBuilder({ filters: [block('b1', 'boolean')] })

    await user.click(screen.getByTestId('filter-add-literal-b1'))

    const next = onChange.mock.calls.at(-1)![0] as TableFilterBlock[]
    expect(next[0].conditions).toEqual([
      expect.objectContaining({ type: 'literal', value_type: 'boolean', operator: 'is_true', reference_value: null }),
    ])
  })

  it.each([
    ['is null', 'is_null'],
    ['not null', 'is_not_null'],
  ])('picking "%s" on a row holding a value stores %s with no compare-to value', async (label, wireName) => {
    const user = userEvent.setup()
    const row = { ...literal('c1', 'integer', 'greater_than'), reference_value: '5' }
    const { onChange } = renderBuilder({ filters: [block('b1', 'integer', [row])] })

    await user.click(screen.getByTestId('filter-condition-operator-c1'))
    await user.click(await screen.findByRole('option', { name: label }))

    const next = onChange.mock.calls.at(-1)![0] as TableFilterBlock[]
    expect(next[0].conditions).toEqual([{ ...row, operator: wireName, reference_value: null }])
  })

  it('switching a row from is null back to equals gives the empty value a new row has', async () => {
    const user = userEvent.setup()
    const row = { ...literal('c1', 'integer', 'is_null'), reference_value: null }
    const { onChange } = renderBuilder({ filters: [block('b1', 'integer', [row])] })

    await user.click(screen.getByTestId('filter-condition-operator-c1'))
    await user.click(await screen.findByRole('option', { name: 'equals' }))

    const next = onChange.mock.calls.at(-1)![0] as TableFilterBlock[]
    expect(next[0].conditions).toEqual([{ ...row, operator: 'equals', reference_value: '' }])
  })

  it('switching as Type to Boolean lands an equals row on is true with no compare-to value', async () => {
    const user = userEvent.setup()
    const row = { ...literal('c1', 'string', 'equals'), reference_value: 'yes' }
    const { onChange } = renderBuilder({ filters: [block('b1', 'string', [row])] })

    await user.click(screen.getByTestId('filter-astype-b1'))
    await user.click(await screen.findByRole('option', { name: /boolean/i }))

    const next = onChange.mock.calls.at(-1)![0] as TableFilterBlock[]
    expect(next[0].conditions).toEqual([
      { ...row, value_type: 'boolean', operator: 'is_true', reference_value: null },
    ])
  })

  it.each<[TableFilterBlock['asType'], string, string[]]>([
    ['string', 'equals', ['equals', 'not equals', 'contains', 'does not contain', 'starts with', 'ends with', 'matches regex', 'is null', 'not null']],
    ['integer', 'equals', ['equals', 'not equals', 'less than', 'greater than', 'less or equal', 'greater or equal', 'is null', 'not null']],
    ['float', 'equals', ['equals', 'not equals', 'less than', 'greater than', 'less or equal', 'greater or equal', 'is null', 'not null']],
    ['boolean', 'is_true', ['is true', 'is false', 'is null', 'not null']],
  ])('offers the %s filter operators in order, ending with is null and not null', async (asType, operator, expected) => {
    const user = userEvent.setup()
    renderBuilder({ filters: [block('b1', asType, [literal('c1', asType, operator)])] })

    await user.click(screen.getByTestId('filter-condition-operator-c1'))
    const labels = (await screen.findAllByRole('option')).map((o) => o.textContent?.trim())
    expect(labels).toEqual(expected)
  })

  it.each<[TableFilterBlock['asType'], string, string, string]>([
    ['string', 'equals', 'is null', 'is_null'],
    ['integer', 'greater_than', 'not null', 'is_not_null'],
    ['float', 'less_than', 'is null', 'is_null'],
    ['boolean', 'equals', 'not null', 'is_not_null'],
    ['boolean', 'equals', 'is true', 'is_true'],
  ])('%s column, operator %s: picking "%s" hides the value box and the {} toggle', async (asType, operator, label, wireName) => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(
      <StatefulFilterBuilder
        initial={[block('b1', asType, [literal('c1', asType, operator)])]}
        onChange={onChange}
      />,
    )
    expect(screen.getByTestId('filter-condition-value-c1')).toBeInTheDocument()

    await user.click(screen.getByTestId('filter-condition-operator-c1'))
    await user.click(await screen.findByRole('option', { name: label }))

    const next = onChange.mock.calls.at(-1)![0] as TableFilterBlock[]
    const cond = next[0].conditions[0]
    expect(cond.type === 'literal' && cond.operator).toBe(wireName)
    expect(screen.queryByTestId('filter-condition-value-c1')).not.toBeInTheDocument()
    expect(screen.queryByTestId('filter-condition-expr-toggle-c1')).not.toBeInTheDocument()
  })
})

/** A literal equals row of `valueType` holding `value`. */
function valued(id: string, valueType: string, value: string): AssertionItem {
  return { ...(literal(id, valueType, 'equals') as Extract<AssertionItem, { type: 'literal' }>), reference_value: value }
}

describe('a compare-to value that is no number of the as Type (REQ-3.1.3.14)', () => {
  it('keeps the value an as Type change leaves and names it under the box', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    const row = valued('c1', 'string', 'abc')
    render(<StatefulFilterBuilder initial={[block('b1', 'string', [row])]} onChange={onChange} />)
    expect(screen.queryByTestId('filter-condition-error-c1')).not.toBeInTheDocument()

    await user.click(screen.getByTestId('filter-astype-b1'))
    await user.click(await screen.findByRole('option', { name: /integer/i }))

    const next = onChange.mock.calls.at(-1)![0] as TableFilterBlock[]
    expect(next[0].conditions).toEqual([valued('c1', 'integer', 'abc')])
    const box = screen.getByTestId('filter-condition-value-c1')
    expect(box).toHaveValue('abc')
    expect(box).toHaveAttribute('aria-invalid', 'true')
    expect(box).toHaveAttribute('aria-describedby', 'filter-condition-error-c1')
    const message = screen.getByTestId('filter-condition-error-c1')
    expect(message).toHaveTextContent(/^Enter a valid integer value$/)
    expect(message).toHaveAttribute('role', 'alert')
  })

  it('lifts the message once a number is typed', async () => {
    const user = userEvent.setup()
    const row = valued('c1', 'float', 'abc')
    render(<StatefulFilterBuilder initial={[block('b1', 'float', [row])]} onChange={vi.fn()} />)
    expect(screen.getByTestId('filter-condition-error-c1')).toHaveTextContent(/^Enter a valid float value$/)

    const box = screen.getByTestId('filter-condition-value-c1')
    await user.clear(box)
    await user.type(box, '2.5')

    expect(box).toHaveValue('2.5')
    expect(box).not.toHaveAttribute('aria-invalid')
    expect(screen.queryByTestId('filter-condition-error-c1')).not.toBeInTheDocument()
  })

  it('names nothing for a String column', () => {
    renderBuilder({ filters: [block('b1', 'string', [valued('c1', 'string', 'abc')])] })
    expect(screen.queryByTestId('filter-condition-error-c1')).not.toBeInTheDocument()
  })
})
