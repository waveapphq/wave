/**
 * FilterBlockBuilder tests (design decisions CSV-8, CSV-9, CSV-10, wireframe CSV Filter block).
 *
 * Per-column filter blocks: each block targets one column (ColumnRef) with a
 * declared `as Type`, and holds conditions - literal (operator + value) and/or
 * expression (a per-row predicate over the column value via `_cell`) - combined
 * with the assertion control's AND/OR grouping. Blocks AND together. The literal
 * operator vocabulary follows the block's `as Type` (reuses OPERATORS_BY_TYPE).
 * Controlled: emits the whole next array via onChange.
 *
 * A filter row is the check Blocks' condition row without the variable box (FIELD-15, CSV-12):
 * the compare value is the one field with its expand and {x}, its message under it, and an as Type
 * change that would drop a compare value asks the shared type-change question first (FIELD-13).
 * REQ-3.4.1.12, REQ-3.4.1.13
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

// CodeMirror does not work in jsdom; render the expression field as a plain input inside the
// `param-input-<name>` box the real expression input draws.
vi.mock('@/features/workbench/common/element-config/expressions/expression-field', () => ({
  ExpressionField: ({
    name,
    value,
    onChange,
    placeholder,
    isInvalid,
  }: {
    name: string
    value: string
    onChange: (v: string) => void
    placeholder?: string
    isInvalid?: boolean
  }) => (
    <div data-testid={`param-input-${name}`}>
      <input
        data-testid={`mock-expression-field-${name}`}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        data-invalid={isInvalid ? 'true' : undefined}
      />
    </div>
  ),
}))

import { FilterBlockBuilder } from '@/features/workbench/common/config/table-transform/filter-block-builder'
import type { TableFilterBlock } from '@/features/workbench/common/config/table-transform/types'
import {
  getOperatorsForType,
  type AssertionItem,
  type LiteralAssertion,
} from '@/features/workbench/common/config/assertion-builder/types'

/** A literal row with no compare value: the stored shape keeps no value key until one is set. */
function literal(id: string, valueType: string, operator: string): LiteralAssertion {
  return {
    id,
    type: 'literal',
    variable: '_cell',
    value_type: valueType,
    operator,
  }
}

const VALUE_KEYS = ['reference_value', 'reference_is_expression', 'reference_is_template'] as const
const TYPE_CHANGE_TITLE = 'Change entry type?'
const OPERATOR_CHANGE_TITLE = 'Change operator?'

/** The cell stem of a literal row's compare value (FIELD-15). */
const valueStem = (condId: string) => `filter-condition-value-${condId}`

/** A cell's box: the text or number box, or the {x} box, that carries param-input-<stem>. */
function cellBox(stem: string): HTMLElement | null {
  return screen.queryByTestId(`param-input-${stem}`)
}

function follows(first: Element, second: Element): boolean {
  return (first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0
}

/** The empty 32 px placeholder columns between two elements: an empty expand or {x} slot. */
function emptySlotsBetween(start: Element, end: Element): Element[] {
  return Array.from(document.body.querySelectorAll('span[aria-hidden="true"]')).filter(
    (slot) => slot.childNodes.length === 0 && follows(start, slot) && follows(slot, end),
  )
}

function valueBox(condId: string): HTMLElement {
  const box = cellBox(valueStem(condId))
  expect(box, `the compare value box of ${condId} is drawn`).not.toBeNull()
  return box as HTMLElement
}

/** The row with none of the three compare value keys. */
function bare(row: AssertionItem): LiteralAssertion {
  const rest: Partial<LiteralAssertion> = { ...(row as LiteralAssertion) }
  for (const key of VALUE_KEYS) delete rest[key]
  return rest as LiteralAssertion
}

function expectNoCompareTo(row: AssertionItem): void {
  for (const key of VALUE_KEYS) expect(row).not.toHaveProperty(key)
}

function lastFilters(onChange: ReturnType<typeof vi.fn>): TableFilterBlock[] {
  return onChange.mock.calls.at(-1)![0] as TableFilterBlock[]
}

async function pickAsType(user: ReturnType<typeof userEvent.setup>, blockId: string, label: RegExp) {
  await user.click(screen.getByTestId(`filter-astype-${blockId}`))
  await user.click(await screen.findByRole('option', { name: label }))
}

async function confirmTypeChange(user: ReturnType<typeof userEvent.setup>) {
  await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Change type' }))
}

async function confirmOperatorChange(user: ReturnType<typeof userEvent.setup>) {
  await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Change operator' }))
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

    await user.type(screen.getByTestId('mock-expression-field-filter-condition-expr-e1'), 'x')

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

    await user.type(valueBox('c1'), '5')

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

    fireEvent.change(valueBox('c1'), { target: { value: typed } })

    expect(onChange).not.toHaveBeenCalled()
  })

  it.each([
    ['integer', 'numeric'],
    ['float', 'decimal'],
  ] as const)('brings up the number keyboard for a literal compared As %s', (asType, inputMode) => {
    renderBuilder({ filters: [block('b1', asType, [literal('c1', asType, 'greater_than')])] })

    expect(valueBox('c1')).toHaveAttribute('inputmode', inputMode)
  })

  it('leaves a literal compared As String free of the number rule', () => {
    const { onChange } = renderBuilder({ filters: [block('b1', 'string', [literal('c1', 'string', 'equals')])] })
    expect(valueBox('c1')).not.toHaveAttribute('inputmode')

    fireEvent.change(valueBox('c1'), { target: { value: '1e5' } })

    const cond = (onChange.mock.calls.at(-1)![0] as TableFilterBlock[])[0].conditions[0]
    expect(cond.type === 'literal' && cond.reference_value).toBe('1e5')
  })

  it('draws the shared {x} toggle beside a literal value', () => {
    renderBuilder({
      filters: [block('b1', 'integer', [literal('c1', 'integer', 'greater_than')])],
    })
    const toggle = screen.getByTestId('filter-condition-expr-toggle-c1')
    expect(toggle).toHaveAttribute('data-slot', 'expression-toggle')
    expect(toggle).toHaveAccessibleName(/^Value expression mode$/)
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

    await user.type(screen.getByTestId('mock-expression-field-filter-condition-value-c1'), '9')

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

    expect(valueBox('c1')).toHaveValue('')
  })

  it('renders an empty expression field for a null reference-expression value', () => {
    const nullExprLiteral: AssertionItem = {
      ...literal('c1', 'integer', 'greater_than'),
      reference_value: null,
      reference_is_expression: true,
    } as AssertionItem
    renderBuilder({ filters: [block('b1', 'integer', [nullExprLiteral])] })

    expect(screen.getByTestId('mock-expression-field-filter-condition-value-c1')).toHaveValue('')
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
      expect.objectContaining({ type: 'literal', value_type: 'boolean', operator: 'is_true' }),
    ])
    expectNoCompareTo(next[0].conditions[0])
  })

  it.each([
    ['is null', 'is_null'],
    ['not null', 'is_not_null'],
  ])('picking "%s" on a row holding a value asks first, then stores %s with no compare-to value', async (label, wireName) => {
    const user = userEvent.setup()
    const row = { ...literal('c1', 'integer', 'greater_than'), reference_value: '5', reference_is_expression: false }
    const { onChange } = renderBuilder({ filters: [block('b1', 'integer', [row])] })

    await user.click(screen.getByTestId('filter-condition-operator-c1'))
    await user.click(await screen.findByRole('option', { name: label }))
    const dialog = screen.getByRole('alertdialog')
    expect(within(dialog).getByRole('heading', { name: OPERATOR_CHANGE_TITLE })).toBeInTheDocument()
    expect(
      within(dialog).getByText(new RegExp(`^Changing operator to ${label} will clear 1 existing integer value\\. This cannot be undone\\.$`)),
    ).toBeInTheDocument()
    expect(onChange).not.toHaveBeenCalled()
    await confirmOperatorChange(user)

    const next = onChange.mock.calls.at(-1)![0] as TableFilterBlock[]
    expect(next[0].conditions).toEqual([bare({ ...row, operator: wireName })])
    expectNoCompareTo(next[0].conditions[0])
  })

  it('switching a row from is null back to equals leaves the compare value not set', async () => {
    const user = userEvent.setup()
    const row = literal('c1', 'integer', 'is_null')
    const { onChange } = renderBuilder({ filters: [block('b1', 'integer', [row])] })

    await user.click(screen.getByTestId('filter-condition-operator-c1'))
    await user.click(await screen.findByRole('option', { name: 'equals' }))

    const next = onChange.mock.calls.at(-1)![0] as TableFilterBlock[]
    expect(next[0].conditions).toEqual([{ ...row, operator: 'equals' }])
    expect(next[0].conditions[0]).not.toHaveProperty('reference_value')
  })

  it('switching as Type to Boolean asks first, then lands an equals row on is true with no compare-to value', async () => {
    const user = userEvent.setup()
    const row = { ...literal('c1', 'string', 'equals'), reference_value: 'yes', reference_is_expression: false }
    const { onChange } = renderBuilder({ filters: [block('b1', 'string', [row])] })

    await user.click(screen.getByTestId('filter-astype-b1'))
    await user.click(await screen.findByRole('option', { name: /boolean/i }))
    expect(within(screen.getByRole('alertdialog')).getByRole('heading', { name: TYPE_CHANGE_TITLE })).toBeInTheDocument()
    expect(onChange).not.toHaveBeenCalled()
    await confirmTypeChange(user)

    const next = onChange.mock.calls.at(-1)![0] as TableFilterBlock[]
    expect(next[0].asType).toBe('boolean')
    expect(next[0].conditions).toEqual([bare({ ...row, value_type: 'boolean', operator: 'is_true' })])
    expectNoCompareTo(next[0].conditions[0])
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
    expect(valueBox('c1')).toBeInTheDocument()

    await user.click(screen.getByTestId('filter-condition-operator-c1'))
    await user.click(await screen.findByRole('option', { name: label }))

    const next = onChange.mock.calls.at(-1)![0] as TableFilterBlock[]
    const cond = next[0].conditions[0]
    expect(cond.type === 'literal' && cond.operator).toBe(wireName)
    expect(cellBox(valueStem('c1'))).not.toBeInTheDocument()
    expect(screen.queryByTestId('filter-condition-expr-toggle-c1')).not.toBeInTheDocument()
  })
})

/** A literal equals row of `valueType` holding `value`. */
function valued(id: string, valueType: string, value: string): LiteralAssertion {
  return { ...literal(id, valueType, 'equals'), reference_value: value }
}

describe('a compare-to value that is no number of the as Type (REQ-3.1.3.14)', () => {
  it('names a stored value the as Type cannot read under the box', () => {
    renderBuilder({ filters: [block('b1', 'integer', [valued('c1', 'integer', 'abc')])] })

    const box = valueBox('c1')
    expect(box).toHaveValue('abc')
    expect(box).toHaveAttribute('aria-invalid', 'true')
    const message = screen.getByTestId('param-error-filter-condition-value-c1')
    expect(box.getAttribute('aria-describedby') ?? '').toContain(message.id)
    expect(message).toHaveTextContent(/^Enter a valid integer value$/)
    expect(message).toHaveAttribute('role', 'alert')
  })

  it('lifts the message once a number is typed', async () => {
    const user = userEvent.setup()
    const row = valued('c1', 'float', 'abc')
    render(<StatefulFilterBuilder initial={[block('b1', 'float', [row])]} onChange={vi.fn()} />)
    expect(screen.getByTestId('param-error-filter-condition-value-c1')).toHaveTextContent(/^Enter a valid float value$/)

    await user.clear(valueBox('c1'))
    await user.type(valueBox('c1'), '2.5')

    expect(valueBox('c1')).toHaveValue('2.5')
    expect(valueBox('c1')).not.toHaveAttribute('aria-invalid')
    expect(screen.queryByTestId('param-error-filter-condition-value-c1')).not.toBeInTheDocument()
  })

  it('names nothing for a String column', () => {
    renderBuilder({ filters: [block('b1', 'string', [valued('c1', 'string', 'abc')])] })
    expect(screen.queryByTestId('param-error-filter-condition-value-c1')).not.toBeInTheDocument()
  })
})

describe('filter rows render the shared condition row (FIELD-15, CSV-12)', () => {
  it('draws a String compare value as the one field with its expand', () => {
    renderBuilder({ filters: [block('b1', 'string', [valued('c1', 'string', 'eu-west')])] })

    expect(valueBox('c1')).toHaveValue('eu-west')
    expect(screen.getByTestId('param-expand-filter-condition-value-c1')).toBeInTheDocument()
    // The compare value never takes null.
    expect(screen.queryByTestId('param-null-filter-condition-value-c1')).not.toBeInTheDocument()
  })

  it.each<[TableFilterBlock['asType'], string]>([
    ['integer', 'numeric'],
    ['float', 'decimal'],
  ])('draws an %s compare value as a number box with an empty expand slot', (asType, inputMode) => {
    renderBuilder({ filters: [block('b1', asType, [valued('c1', asType, '500')])] })

    expect(screen.getByTestId('param-input-filter-condition-value-c1')).toHaveValue('500')
    expect(valueBox('c1')).toHaveAttribute('inputmode', inputMode)
    expect(screen.queryByTestId('param-expand-filter-condition-value-c1')).not.toBeInTheDocument()
    const slots = emptySlotsBetween(valueBox('c1'), screen.getByTestId('filter-condition-expr-toggle-c1'))
    expect(slots).toHaveLength(1)
    expect(slots[0]).toHaveClass('w-8')
  })

  it('keeps the {x} toggle id and names it after the Value label', () => {
    renderBuilder({ filters: [block('b1', 'string', [valued('c1', 'string', 'eu-west')])] })

    const toggle = screen.getByTestId('filter-condition-expr-toggle-c1')
    expect(toggle).toHaveAccessibleName(/^Value expression mode$/)
    expect(toggle).toHaveAttribute('aria-pressed', 'false')
  })

  it('draws an {x} compare value in the expression box of the cell, with expand', () => {
    const row = { ...valued('c1', 'integer', 'limit'), reference_is_expression: true } as AssertionItem
    renderBuilder({ filters: [block('b1', 'integer', [row])] })

    const box = screen.getByTestId('param-input-filter-condition-value-c1')
    expect(within(box).getByTestId('mock-expression-field-filter-condition-value-c1')).toHaveValue('limit')
    expect(screen.getByTestId('param-expand-filter-condition-value-c1')).toBeInTheDocument()
    expect(screen.getByTestId('filter-condition-expr-toggle-c1')).toHaveAttribute('aria-pressed', 'true')
  })

  it('shows Value is required on a new literal row and no variable message', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<StatefulFilterBuilder initial={[block('b1', 'string')]} onChange={onChange} />)

    await user.click(screen.getByTestId('filter-add-literal-b1'))

    const added = lastFilters(onChange)[0].conditions[0] as LiteralAssertion
    expect(added).not.toHaveProperty('reference_value')
    const message = screen.getByTestId(`param-error-filter-condition-value-${added.id}`)
    expect(message).toHaveTextContent(/^Value is required$/)
    expect(message).toHaveAttribute('role', 'alert')
    expect(screen.queryByText('Choose a variable.')).not.toBeInTheDocument()
    expect(screen.getByTestId(`param-expand-filter-condition-value-${added.id}`)).toBeInTheDocument()
  })

  it.each([
    ['a blank {x}', { ...valued('c1', 'string', ''), reference_is_expression: true }],
    ['a blank Template', { ...valued('c1', 'string', ''), reference_is_template: true }],
  ])('shows Value is required under %s', (_what, row) => {
    renderBuilder({ filters: [block('b1', 'string', [row as AssertionItem])] })
    expect(screen.getByTestId('param-error-filter-condition-value-c1')).toHaveTextContent(/^Value is required$/)
  })

  // Empty text typed on purpose is a value and compares with empty text (FIELD-4, CSV-12).
  it.each([
    ['empty text', ''],
    ['text of spaces', '   '],
  ])('takes %s on a String filter as a value with no message', (_what, text) => {
    renderBuilder({ filters: [block('b1', 'string', [valued('c1', 'string', text) as AssertionItem])] })
    expect(screen.queryByTestId('param-error-filter-condition-value-c1')).not.toBeInTheDocument()
  })

  it('shows Condition is required on a blank expression row', () => {
    renderBuilder({ filters: [block('b1', 'integer', [{ id: 'e1', type: 'expression', expression: '' }])] })

    const message = screen.getByTestId('param-error-filter-condition-expr-e1')
    expect(message).toHaveTextContent(/^Condition is required$/)
    expect(message).toHaveAttribute('role', 'alert')
    expect(screen.getByTestId('param-expand-filter-condition-expr-e1')).toBeInTheDocument()
    expect(screen.queryByTestId('filter-condition-expr-toggle-e1')).not.toBeInTheDocument()
  })

  it('shows no message on a written expression row', () => {
    renderBuilder({ filters: [block('b1', 'integer', [{ id: 'e1', type: 'expression', expression: '_cell > 2' }])] })
    expect(screen.queryByTestId('param-error-filter-condition-expr-e1')).not.toBeInTheDocument()
  })

  it('re-reads the compare type when the as Type changes', async () => {
    const user = userEvent.setup()
    render(<StatefulFilterBuilder initial={[block('b1', 'string', [literal('c1', 'string', 'equals')])]} onChange={vi.fn()} />)
    expect(screen.getByTestId('param-expand-filter-condition-value-c1')).toBeInTheDocument()

    await pickAsType(user, 'b1', /integer/i)

    expect(screen.getByTestId('param-input-filter-condition-value-c1')).toHaveAttribute('inputmode', 'numeric')
    expect(screen.queryByTestId('param-expand-filter-condition-value-c1')).not.toBeInTheDocument()
  })

  it('draws no value and no {x} on a Boolean as Type', () => {
    renderBuilder({ filters: [block('b1', 'boolean', [literal('c1', 'boolean', 'is_true')])] })
    expect(cellBox(valueStem('c1'))).not.toBeInTheDocument()
    expect(screen.queryByTestId('filter-condition-expr-toggle-c1')).not.toBeInTheDocument()
    expect(screen.queryByTestId('param-error-filter-condition-value-c1')).not.toBeInTheDocument()
  })
})

describe('an as Type change through the shared value-loss check (FIELD-13)', () => {
  it.each<[string, TableFilterBlock['asType'], TableFilterBlock['asType'], RegExp, string]>([
    ['500 from Integer to Float', 'integer', 'float', /float/i, '500'],
    ['42 from Integer to String', 'integer', 'string', /string/i, '42'],
  ])('keeps every compare value and asks nothing when each still fits the new as Type (%s)', async (_what, from, to, label, value) => {
    const user = userEvent.setup()
    const { onChange } = renderBuilder({ filters: [block('b1', from, [valued('c1', from, value)])] })

    await pickAsType(user, 'b1', label)

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    const next = lastFilters(onChange)
    expect(next[0].asType).toBe(to)
    expect(next[0].conditions).toEqual([valued('c1', to, value)])
  })

  it('keeps an {x} compare value whatever the new as Type', async () => {
    const user = userEvent.setup()
    const row = { ...valued('c1', 'string', 'limit'), reference_is_expression: true } as AssertionItem
    const { onChange } = renderBuilder({ filters: [block('b1', 'string', [row])] })

    await pickAsType(user, 'b1', /integer/i)

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(lastFilters(onChange)[0].conditions).toEqual([{ ...row, value_type: 'integer' }])
  })

  it.each<[string, TableFilterBlock['asType'], RegExp, string]>([
    ['abc from String to Integer', 'integer', /integer/i, 'abc'],
    ['yes from String to Boolean', 'boolean', /boolean/i, 'yes'],
  ])('asks Change entry type? before an as Type change drops a compare value that no longer fits (%s)', async (_what, to, label, value) => {
    const user = userEvent.setup()
    const { onChange } = renderBuilder({ filters: [block('b1', 'string', [valued('c1', 'string', value)])] })

    await pickAsType(user, 'b1', label)

    const dialog = screen.getByRole('alertdialog')
    expect(within(dialog).getByRole('heading', { name: TYPE_CHANGE_TITLE })).toBeInTheDocument()
    expect(within(dialog).getByText(new RegExp(`^Changing type to ${to} will clear 1 existing string value\\. This cannot be undone\\.$`))).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Change type' })).toBeInTheDocument()
    expect(onChange).not.toHaveBeenCalled()
  })

  it('asks once for the block however many compare values would go', async () => {
    const user = userEvent.setup()
    const { onChange } = renderBuilder({
      filters: [block('b1', 'string', [valued('c1', 'string', 'abc'), { type: 'operator', value: 'and' }, valued('c2', 'string', 'xyz')])],
    })

    await pickAsType(user, 'b1', /integer/i)

    expect(screen.getAllByRole('alertdialog')).toHaveLength(1)
    expect(within(screen.getByRole('alertdialog')).getByText(/^Changing type to integer will clear 2 existing string entries\. This cannot be undone\.$/)).toBeInTheDocument()
    expect(onChange).not.toHaveBeenCalled()
  })

  it('drops the lost values and both flags on Change type, keeps the rows that fit, and keeps the old as Type on Cancel', async () => {
    const lost = { ...valued('c1', 'string', 'abc'), reference_is_expression: false } as AssertionItem
    const template = { ...valued('c2', 'string', '{{ limit }}'), reference_is_template: true } as AssertionItem
    const fits = valued('c3', 'string', '42')
    const expressionRow = { ...valued('c4', 'string', 'limit'), reference_is_expression: true } as AssertionItem
    const and: AssertionItem = { type: 'operator', value: 'and' }
    const conditions = [lost, and, template, and, fits, and, expressionRow]

    // Change type: the values that no longer fit go with both flags; the others stay.
    const user = userEvent.setup()
    const onChange = vi.fn()
    const view = render(<StatefulFilterBuilder initial={[block('b1', 'string', conditions)]} onChange={onChange} />)
    await pickAsType(user, 'b1', /integer/i)
    await confirmTypeChange(user)

    const next = lastFilters(onChange)
    expect(next[0].asType).toBe('integer')
    expect(next[0].conditions).toEqual([
      bare({ ...lost, value_type: 'integer' } as AssertionItem),
      and,
      bare({ ...template, value_type: 'integer' } as AssertionItem),
      and,
      valued('c3', 'integer', '42'),
      and,
      { ...expressionRow, value_type: 'integer' },
    ])
    expectNoCompareTo(next[0].conditions[0])
    expectNoCompareTo(next[0].conditions[2])
    expect(screen.getByTestId('param-error-filter-condition-value-c1')).toHaveTextContent(/^Value is required$/)
    expect(screen.queryByTestId('param-error-filter-condition-value-c3')).not.toBeInTheDocument()
    view.unmount()

    // Cancel: the old as Type and every value stay.
    const onCancelChange = vi.fn()
    render(<StatefulFilterBuilder initial={[block('b1', 'string', conditions)]} onChange={onCancelChange} />)
    await pickAsType(user, 'b1', /integer/i)
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Cancel' }))

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(onCancelChange).not.toHaveBeenCalled()
    expect(screen.getByTestId('filter-astype-b1')).toHaveTextContent(/^String$/)
    expect(valueBox('c1')).toHaveValue('abc')
    expect(valueBox('c3')).toHaveValue('42')
  })

  it('changes the as Type at once when no literal row holds a compare value', async () => {
    const user = userEvent.setup()
    const expressionCondition: AssertionItem = { id: 'e1', type: 'expression', expression: '_cell != None' }
    const { onChange } = renderBuilder({
      filters: [block('b1', 'string', [literal('c1', 'string', 'equals'), { type: 'operator', value: 'and' }, expressionCondition])],
    })

    await pickAsType(user, 'b1', /boolean/i)

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    const next = lastFilters(onChange)
    expect(next[0].asType).toBe('boolean')
    expect(next[0].conditions).toEqual([
      literal('c1', 'boolean', 'is_true'),
      { type: 'operator', value: 'and' },
      expressionCondition,
    ])
    expectNoCompareTo(next[0].conditions[0])
  })
})

// The 20 px a message adds is padding, so it never collapses with the 8 px spacing of the rows (FIELD-15, CSV-12).
describe('a filter row with a message grows 20 px below it', () => {
  const rowLine = (condId: string) => screen.getByTestId(`filter-condition-delete-${condId}`).parentElement as HTMLElement
  const bottomMarginClasses = (element: HTMLElement) =>
    element.className.split(/\s+/).filter((token) => /^(mb|my|m)-/.test(token))

  it('grows a literal row with a message by bottom padding and leaves a row with none as it is', () => {
    renderBuilder({
      filters: [block('b1', 'integer', [valued('c1', 'integer', 'abc'), { type: 'operator', value: 'and' }, valued('c2', 'integer', '3')])],
    })

    expect(screen.getByTestId('param-error-filter-condition-value-c1')).toHaveTextContent(/^Enter a valid integer value$/)
    expect(rowLine('c1')).toHaveClass('pb-5')
    expect(bottomMarginClasses(rowLine('c1'))).toEqual([])
    expect(rowLine('c2')).not.toHaveClass('pb-5')
  })

  it('grows an expression row with a message by bottom padding', () => {
    renderBuilder({ filters: [block('b1', 'integer', [{ id: 'e1', type: 'expression', expression: '' }])] })

    expect(screen.getByTestId('param-error-filter-condition-expr-e1')).toHaveTextContent(/^Condition is required$/)
    expect(rowLine('e1')).toHaveClass('pb-5')
    expect(bottomMarginClasses(rowLine('e1'))).toEqual([])
  })
})
