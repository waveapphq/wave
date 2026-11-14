/**
 * The one condition row of If/Else, Switch, Assert, While, Wait Until and the CSV / Excel filters (FIELD-15).
 *
 * The literal row draws the compare value as the one field (FIELD-1, FIELD-14) with its expand and {x}
 * columns; the expression row gains expand. Switching {x} asks first (FIELD-7), and an operator change
 * that would drop a compare value asks the shared value-loss question, worded for the operator, first (FIELD-13).
 *
 * REQ-3.5.1.5, REQ-3.5.1.1, REQ-3.5.1.11, REQ-3.5.1.17, REQ-3.5.1.20, REQ-3.5.4.3
 */

import { useState, type ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { EditorView } from '@codemirror/view'

import { SheetFrozenContext } from '@/components/shared/sheet-layer'

// The Edit value sheet is heavy (CodeMirror) and never opened here.
vi.mock('@/features/workbench/common/variables/variable-inspect-modal/value-editor-sheet', () => ({
  ValueEditorSheet: () => null,
}))

// The expression box reads the flow scope from the workflow store: these rows sit in the root flow.
vi.mock('@/features/functions/canvas/use-function-scope', () => ({
  useFunctionScope: () => ({
    insideFunction: false,
    scopeId: '',
    declaredInputNames: [],
    declaredOutputNames: [],
    allowedVarNames: new Set<string>(),
  }),
}))

import {
  ConditionExpressionRow,
  ConditionLiteralRow,
} from '@/features/workbench/common/config/assertion-builder/condition-row'
import {
  newLiteralRow,
  type ExpressionAssertion,
  type LiteralAssertion,
} from '@/features/workbench/common/config/assertion-builder/types'
import { conditionRowProblem } from '@/features/workbench/lib/validation/condition-checks'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const VARIABLES = [
  { name: 'status', type: 'string' },
  { name: 'retries', type: 'integer' },
  { name: 'ratio', type: 'float' },
  { name: 'hosts', type: 'array' },
  { name: 'max_retries', type: 'integer' },
]

const STEM = 'assert-value-0'
const OPERATOR_ID = 'assert-operator-0'
const TOGGLE_ID = 'assert-expr-toggle-0'
const EXPR_STEM = 'assert-expr-0'
const VALUE_KEYS = ['reference_value', 'reference_is_expression', 'reference_is_template'] as const

const TO_EXPRESSION_TITLE = 'Switch the field to an expression?'
const TO_PLAIN_TITLE = 'Switch the field to a plain value?'
const SWITCH_BODY = 'The current value is cleared.'
const OPERATOR_CHANGE_TITLE = 'Change operator?'

/** A literal row comparing the string variable `status`; unset keys stay off the row (stored shape). */
function literal(overrides: Partial<LiteralAssertion> = {}): LiteralAssertion {
  return {
    id: 'lit-1',
    type: 'literal',
    variable: 'status',
    value_type: 'string',
    operator: 'equals',
    reference_value: 'ready',
    ...overrides,
  }
}

/** The row with none of the three compare value keys. */
function bare(row: LiteralAssertion): LiteralAssertion {
  const rest: Partial<LiteralAssertion> = { ...row }
  for (const key of VALUE_KEYS) delete rest[key]
  return rest as LiteralAssertion
}

function expression(text: string): ExpressionAssertion {
  return { id: 'expr-1', type: 'expression', expression: text }
}

// ---------------------------------------------------------------------------
// Hosts: each keeps the row it last wrote and passes the row's message, as AssertionItemRow does
// ---------------------------------------------------------------------------

function LiteralHost({
  initial,
  onRow,
  leading,
  grows,
}: Readonly<{ initial: LiteralAssertion; onRow: (next: LiteralAssertion) => void; leading?: ReactNode; grows?: boolean }>) {
  const [row, setRow] = useState(initial)
  const problem = conditionRowProblem(row)
  const valueMessage = problem?.field === 'value' ? problem.message : undefined
  return (
    <ConditionLiteralRow
      row={row}
      onRow={(next) => {
        setRow(next)
        onRow(next)
      }}
      availableVariables={VARIABLES}
      testIdStem={STEM}
      operatorTestId={OPERATOR_ID}
      toggleTestId={TOGGLE_ID}
      valueMessage={valueMessage}
      grows={grows ?? valueMessage !== undefined}
      leading={leading}
      actions={
        <button type="button" data-testid="row-actions">
          Delete
        </button>
      }
    />
  )
}

function ExpressionHost({
  initial,
  onRow,
}: Readonly<{ initial: ExpressionAssertion; onRow: (next: ExpressionAssertion) => void }>) {
  const [row, setRow] = useState(initial)
  const problem = conditionRowProblem(row)
  const message = problem?.field === 'expression' ? problem.message : undefined
  return (
    <ConditionExpressionRow
      row={row}
      onRow={(next) => {
        setRow(next)
        onRow(next)
      }}
      availableVariables={VARIABLES}
      testIdStem={EXPR_STEM}
      message={message}
      grows={message !== undefined}
      leading={<span data-testid="assert-expression-icon-0">{'{}'}</span>}
      actions={
        <button type="button" data-testid="row-actions">
          Delete
        </button>
      }
    />
  )
}

function renderLiteral(initial: LiteralAssertion, options: { leading?: ReactNode; grows?: boolean } = {}) {
  const onRow = vi.fn<(next: LiteralAssertion) => void>()
  const view = render(<LiteralHost initial={initial} onRow={onRow} {...options} />)
  return { onRow, user: userEvent.setup(), container: view.container, unmount: view.unmount }
}

function renderExpression(initial: ExpressionAssertion) {
  const onRow = vi.fn<(next: ExpressionAssertion) => void>()
  render(<ExpressionHost initial={initial} onRow={onRow} />)
  return { onRow, user: userEvent.setup() }
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/** A cell's box: the text or number box, or the {x} box, that carries param-input-<stem>. */
function cellBox(stem: string): HTMLElement | null {
  return screen.queryByTestId(`param-input-${stem}`)
}

function valueBox(): HTMLElement {
  const box = cellBox(STEM)
  expect(box, 'the compare value box is drawn').not.toBeNull()
  return box as HTMLElement
}

const queryValueBox = () => cellBox(STEM)
const queryExpand = () => screen.queryByTestId(`param-expand-${STEM}`)
const queryToggle = () => screen.queryByTestId(TOGGLE_ID)
const queryValueError = () => screen.queryByTestId(`param-error-${STEM}`)

/** The operator list's trigger: the test id sits on it or on its wrapper. */
function operatorTrigger(): HTMLElement {
  const marked = screen.getByTestId(OPERATOR_ID)
  return marked.getAttribute('role') === 'combobox' ? marked : within(marked).getByRole('combobox')
}

async function pickOperator(user: ReturnType<typeof userEvent.setup>, label: string) {
  await user.click(operatorTrigger())
  await user.click(await screen.findByRole('option', { name: label }))
}

/** The text of the CodeMirror box inside a cell. */
function sourceText(box: HTMLElement): string {
  const editor = box.querySelector<HTMLElement>('.cm-editor')
  expect(editor, 'the cell holds an expression box').not.toBeNull()
  const view = EditorView.findFromDOM(editor as HTMLElement)
  expect(view, 'the expression box is mounted').not.toBeNull()
  return (view as EditorView).state.doc.toString()
}

function dialogButtons(dialog: HTMLElement): string[] {
  return within(dialog)
    .getAllByRole('button')
    .map((button) => button.textContent ?? '')
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

/** The row grows 20 px at the bottom (mock `.cr-row-msg`, margin-bottom 20px). */
const GROWN = '.mb-5, .pb-5, .mb-\\[20px\\], .pb-\\[20px\\]'

/** Presses Ctrl+E inside the CodeMirror box of a cell. */
function pressCtrlE(box: HTMLElement): void {
  const view = EditorView.findFromDOM(box.querySelector<HTMLElement>('.cm-editor') as HTMLElement) as EditorView
  act(() => {
    view.contentDOM.dispatchEvent(new KeyboardEvent('keydown', { key: 'e', ctrlKey: true, bubbles: true, cancelable: true }))
  })
}

function lastRow<T>(onRow: { mock: { calls: T[][] } }): T {
  const calls = onRow.mock.calls
  expect(calls.length, 'the row wrote a change').toBeGreaterThan(0)
  return calls[calls.length - 1][0]
}

function expectNoCompareTo(row: LiteralAssertion): void {
  for (const key of VALUE_KEYS) expect(row).not.toHaveProperty(key)
}

// ---------------------------------------------------------------------------
// ConditionLiteralRow
// ---------------------------------------------------------------------------

describe('ConditionLiteralRow - one line in the FIELD-15 order', () => {
  it('draws variable, pill, operator, value, expand, {x} and actions in that order', () => {
    renderLiteral(literal(), {
      leading: (
        <>
          <span data-testid="lead-variable">status</span>
          <span data-testid="lead-pill">string</span>
        </>
      ),
    })

    const order = [
      screen.getByTestId('lead-variable'),
      screen.getByTestId('lead-pill'),
      screen.getByTestId(OPERATOR_ID),
      valueBox(),
      screen.getByTestId(`param-expand-${STEM}`),
      screen.getByTestId(TOGGLE_ID),
      screen.getByTestId('row-actions'),
    ]
    for (let i = 1; i < order.length; i++) {
      expect(follows(order[i - 1], order[i]), `${order[i - 1].dataset.testid} comes before ${order[i].dataset.testid}`).toBe(true)
    }
  })

  it('names the {x} toggle after the Value label and draws it unpressed', () => {
    renderLiteral(literal())
    const toggle = screen.getByTestId(TOGGLE_ID)
    expect(toggle).toHaveAccessibleName(/^Value expression mode$/)
    expect(toggle).toHaveAttribute('aria-pressed', 'false')
  })

  it('draws the operator list with the operators of the value type', async () => {
    const { user } = renderLiteral(literal({ variable: 'retries', value_type: 'integer', reference_value: '500' }))
    expect(operatorTrigger()).toHaveTextContent(/^equals$/)

    await user.click(operatorTrigger())
    const labels = (await screen.findAllByRole('option')).map((option) => option.textContent?.trim())
    expect(labels).toEqual(['equals', 'not equals', 'less than', 'greater than', 'less or equal', 'greater or equal', 'is null', 'not null'])
  })

  it('gives a text value expand and a number value an empty expand slot', () => {
    const text = renderLiteral(literal({ reference_value: 'ready' }))
    expect(valueBox()).toHaveValue('ready')
    expect(queryExpand()).toBeInTheDocument()
    // The compare value never takes null (FIELD-15).
    expect(screen.queryByTestId(`param-null-${STEM}`)).not.toBeInTheDocument()
    text.unmount()

    renderLiteral(literal({ variable: 'retries', value_type: 'integer', reference_value: '500' }))
    expect(valueBox()).toHaveValue('500')
    expect(queryExpand()).not.toBeInTheDocument()
    const slots = emptySlotsBetween(valueBox(), screen.getByTestId(TOGGLE_ID))
    expect(slots).toHaveLength(1)
    expect(slots[0]).toHaveClass('w-8')
  })

  it.each([
    ['integer', 'retries', 'numeric'],
    ['float', 'ratio', 'decimal'],
  ])('draws a %s compare value as a number box with no expand and keeps the {x} column', (valueType, variable, inputMode) => {
    renderLiteral(literal({ variable, value_type: valueType, reference_value: '500' }))
    expect(valueBox()).toHaveValue('500')
    expect(valueBox()).toHaveAttribute('inputmode', inputMode)
    expect(queryExpand()).not.toBeInTheDocument()
    expect(emptySlotsBetween(valueBox(), screen.getByTestId(TOGGLE_ID))).toHaveLength(1)
    expect(screen.queryByTestId(`param-null-${STEM}`)).not.toBeInTheDocument()
  })

  it('compares an array length as a whole number with no expand', () => {
    renderLiteral(literal({ variable: 'hosts', value_type: 'array', operator: 'length_equals', reference_value: '3' }))
    expect(valueBox()).toHaveAttribute('inputmode', 'numeric')
    expect(queryExpand()).not.toBeInTheDocument()
  })

  it('draws no value, expand or {x} for an operator that takes none and keeps the actions in their column', () => {
    renderLiteral(bare(literal({ operator: 'is_null' })))
    expect(queryValueBox()).not.toBeInTheDocument()
    expect(queryExpand()).not.toBeInTheDocument()
    expect(queryToggle()).not.toBeInTheDocument()
    expect(queryValueError()).not.toBeInTheDocument()
    expect(screen.getByTestId(OPERATOR_ID)).toBeInTheDocument()
    expect(follows(screen.getByTestId(OPERATOR_ID), screen.getByTestId('row-actions'))).toBe(true)
  })

  it.each([
    ['text', literal({ reference_value: 'expected_status', reference_is_expression: true })],
    ['number', literal({ variable: 'retries', value_type: 'integer', reference_value: 'max_retries', reference_is_expression: true })],
  ])('draws the expression look when {x} is pressed on a %s compare value', (_kind, row) => {
    renderLiteral(row)
    expect(sourceText(valueBox())).toBe(row.reference_value)
    expect(screen.getByTestId(TOGGLE_ID)).toHaveAttribute('aria-pressed', 'true')
    // An {x} value always has expand (FIELD-15).
    expect(queryExpand()).toBeInTheDocument()
  })

  it('draws the Template face for a text compare value held as Template', () => {
    renderLiteral(literal({ reference_value: '{{ host }}/health', reference_is_template: true }))
    expect(sourceText(valueBox())).toBe('{{ host }}/health')
    expect(screen.getByTestId(TOGGLE_ID)).toHaveAttribute('aria-pressed', 'false')
    expect(queryExpand()).toBeInTheDocument()
    expect(screen.queryByTestId(`param-null-${STEM}`)).not.toBeInTheDocument()
  })

  it('grows 20 px at the bottom while grows is set', () => {
    // The host sets grows for a line it draws itself (the variable line), so the value has no message here.
    const grown = renderLiteral(literal(), { grows: true })
    expect(queryValueError()).not.toBeInTheDocument()
    expect(grown.container.querySelector(GROWN)).not.toBeNull()
    grown.unmount()

    const flat = renderLiteral(literal(), { grows: false })
    expect(flat.container.querySelector(GROWN)).toBeNull()
  })

  it('opens the expression editor titled Edit Value from the expand of an {x} compare value', async () => {
    const { user } = renderLiteral(literal({ reference_value: 'expected_status', reference_is_expression: true }))
    await user.click(screen.getByTestId(`param-expand-${STEM}`))

    const editor = await screen.findByTestId('expression-editor-modal')
    expect(within(editor).getByRole('heading', { name: /^Edit Value$/ })).toBeInTheDocument()
  })

  it('opens the same editor titled Edit Value on Ctrl+E in an {x} compare value', async () => {
    renderLiteral(literal({ reference_value: 'expected_status', reference_is_expression: true }))
    pressCtrlE(valueBox())

    const editor = await screen.findByTestId('expression-editor-modal')
    expect(within(editor).getByRole('heading', { name: /^Edit Value$/ })).toBeInTheDocument()
  })

  it('keeps expand and disables {x} in a read-only window', () => {
    render(
      <fieldset disabled>
        <SheetFrozenContext value>
          <LiteralHost initial={literal()} onRow={vi.fn()} />
        </SheetFrozenContext>
      </fieldset>,
    )
    expect(screen.getByTestId(`param-expand-${STEM}`)).not.toBeDisabled()
    expect(screen.getByTestId(TOGGLE_ID)).toBeDisabled()
  })

  it('starts a new row with no compare value', () => {
    const row = newLiteralRow()
    expect(row).not.toHaveProperty('reference_value')
    const { onRow } = renderLiteral(row)

    expect(valueBox()).toHaveValue('')
    expect(valueBox().getAttribute('placeholder') ?? '').toBe('')
    expect(queryExpand()).toBeInTheDocument()
    expect(screen.getByTestId(TOGGLE_ID)).toHaveAttribute('aria-pressed', 'false')
    // One message per row, variable first: the host shows Choose a variable., the value is not flagged.
    expect(queryValueError()).not.toBeInTheDocument()
    expect(onRow).not.toHaveBeenCalled()
  })
})

describe('ConditionLiteralRow - messages under the value (FIELDERR-1)', () => {
  it.each([
    ['a value not set', bare(literal())],
    ['a blank {x}', literal({ reference_value: '', reference_is_expression: true })],
    ['a {x} holding only spaces', literal({ reference_value: '   ', reference_is_expression: true })],
    ['a blank Template', literal({ reference_value: '', reference_is_template: true })],
    ['empty text on a number compare', literal({ variable: 'retries', value_type: 'integer', reference_value: '' })],
  ])('shows Value is required under %s', (_what, row) => {
    renderLiteral(row)
    const line = screen.getByTestId(`param-error-${STEM}`)
    expect(line).toHaveTextContent(/^Value is required$/)
    expect(line).toHaveAttribute('role', 'alert')
  })

  it('shows Value is required under a blank value and under a blank {x}', () => {
    const plain = renderLiteral(bare(literal()))
    expect(screen.getByTestId(`param-error-${STEM}`)).toHaveTextContent(/^Value is required$/)
    expect(valueBox()).toHaveAttribute('aria-invalid', 'true')
    expect(valueBox().getAttribute('aria-describedby') ?? '').toContain(screen.getByTestId(`param-error-${STEM}`).id)
    plain.unmount()

    renderLiteral(literal({ reference_value: '', reference_is_expression: true }))
    expect(screen.getByTestId(`param-error-${STEM}`)).toHaveTextContent(/^Value is required$/)
  })

  it.each([
    ['an integer compare', literal({ variable: 'retries', value_type: 'integer', reference_value: 'abc' }), 'Enter a valid integer value'],
    ['a float compare', literal({ variable: 'ratio', value_type: 'float', reference_value: 'abc' }), 'Enter a valid float value'],
    [
      'an array length compare',
      literal({ variable: 'hosts', value_type: 'array', operator: 'length_equals', reference_value: 'two' }),
      'Enter a valid integer value',
    ],
  ])('shows the number rule message for text %s cannot read', (_what, row, message) => {
    renderLiteral(row)
    expect(valueBox()).toHaveValue(String(row.reference_value))
    expect(screen.getByTestId(`param-error-${STEM}`)).toHaveTextContent(new RegExp(`^${message}$`))
  })

  it.each([
    ['a text value', literal({ reference_value: 'ready' })],
    ['a number value', literal({ variable: 'retries', value_type: 'integer', reference_value: '500' })],
    ['an {x} value', literal({ reference_value: 'expected_status', reference_is_expression: true })],
    ['a Template value', literal({ reference_value: '{{ host }}', reference_is_template: true })],
    ['an operator that takes no value', bare(literal({ operator: 'is_not_null' }))],
  ])('shows no message for %s', (_what, row) => {
    renderLiteral(row)
    expect(queryValueError()).not.toBeInTheDocument()
  })

  // Empty text typed on purpose is a value and compares with empty text (FIELD-4, FIELD-15).
  it('draws empty text typed on purpose as <empty string> with no message', () => {
    renderLiteral(literal({ reference_value: '' }))
    expect(queryValueError()).not.toBeInTheDocument()
    expect(screen.getByText(/^<empty string>$/)).toBeInTheDocument()
    expect(valueBox()).not.toHaveAttribute('aria-invalid', 'true')
  })

  it('takes text of spaces on a text compare as a value with no message', () => {
    renderLiteral(literal({ reference_value: '   ' }))
    expect(queryValueError()).not.toBeInTheDocument()
    expect(valueBox()).toHaveValue('   ')
  })
})

describe('ConditionLiteralRow - switching {x} (FIELD-7)', () => {
  it('asks before {x} on a text value: Cancel, Clear, Clear & Empty', async () => {
    const { user, onRow } = renderLiteral(literal({ reference_value: 'ready' }))
    await user.click(screen.getByTestId(TOGGLE_ID))

    const dialog = screen.getByTestId('switch-mode-dialog')
    expect(within(dialog).getByRole('heading')).toHaveTextContent(new RegExp(`^${TO_EXPRESSION_TITLE.replace('?', '\\?')}$`))
    expect(within(dialog).getByText(SWITCH_BODY)).toBeInTheDocument()
    expect(dialogButtons(dialog)).toEqual(['Cancel', 'Clear', 'Clear & Empty'])
    expect(onRow).not.toHaveBeenCalled()
  })

  it('asks before {x} on a number value: Cancel, Clear', async () => {
    const { user } = renderLiteral(literal({ variable: 'retries', value_type: 'integer', reference_value: '500' }))
    await user.click(screen.getByTestId(TOGGLE_ID))
    expect(dialogButtons(screen.getByTestId('switch-mode-dialog'))).toEqual(['Cancel', 'Clear'])
  })

  it('keeps the value and the literal mode on Cancel', async () => {
    const { user, onRow } = renderLiteral(literal({ reference_value: 'ready' }))
    await user.click(screen.getByTestId(TOGGLE_ID))
    await user.click(screen.getByTestId('switch-mode-cancel'))

    expect(screen.queryByTestId('switch-mode-dialog')).not.toBeInTheDocument()
    expect(onRow).not.toHaveBeenCalled()
    expect(valueBox()).toHaveValue('ready')
    expect(screen.getByTestId(TOGGLE_ID)).toHaveAttribute('aria-pressed', 'false')
  })

  it('empties the box into {x} on Clear and asks for a value', async () => {
    const { user, onRow } = renderLiteral(literal({ reference_value: 'ready' }))
    await user.click(screen.getByTestId(TOGGLE_ID))
    await user.click(screen.getByTestId('switch-mode-clear-default'))

    const next = lastRow(onRow)
    expect(next.reference_is_expression).toBe(true)
    expect([undefined, '']).toContainEqual(next.reference_value)
    expect(sourceText(valueBox())).toBe('')
    expect(screen.getByTestId(`param-error-${STEM}`)).toHaveTextContent(/^Value is required$/)
  })

  it("puts '' in as the expression on Clear & Empty", async () => {
    const { user, onRow } = renderLiteral(literal({ reference_value: 'ready' }))
    await user.click(screen.getByTestId(TOGGLE_ID))
    await user.click(screen.getByTestId('switch-mode-clear-empty'))

    expect(lastRow(onRow)).toMatchObject({ reference_is_expression: true, reference_value: "''" })
    expect(sourceText(valueBox())).toBe("''")
  })

  it('switches at once when the value holds nothing', async () => {
    const { user, onRow } = renderLiteral(bare(literal()))
    await user.click(screen.getByTestId(TOGGLE_ID))

    expect(screen.queryByTestId('switch-mode-dialog')).not.toBeInTheDocument()
    expect(lastRow(onRow).reference_is_expression).toBe(true)
    expect(screen.getByTestId(TOGGLE_ID)).toHaveAttribute('aria-pressed', 'true')
  })

  it('asks before leaving {x}: Clear leaves the value not set', async () => {
    const { user, onRow } = renderLiteral(literal({ reference_value: 'expected_status', reference_is_expression: true }))
    await user.click(screen.getByTestId(TOGGLE_ID))

    const dialog = screen.getByTestId('switch-mode-dialog')
    expect(within(dialog).getByRole('heading')).toHaveTextContent(new RegExp(`^${TO_PLAIN_TITLE.replace('?', '\\?')}$`))
    expect(dialogButtons(dialog)).toEqual(['Cancel', 'Clear', 'Clear & Empty'])

    await user.click(screen.getByTestId('switch-mode-clear-default'))
    const next = lastRow(onRow)
    expect(next.reference_is_expression ?? false).toBe(false)
    expect(next).not.toHaveProperty('reference_value')
    expect(valueBox()).toHaveValue('')
    expect(screen.getByTestId(`param-error-${STEM}`)).toHaveTextContent(/^Value is required$/)
  })
})

describe('ConditionLiteralRow - an operator change that would drop the compare value (FIELD-13)', () => {
  const HELD: Array<[string, LiteralAssertion]> = [
    ['a literal value', literal({ reference_value: 'ready', reference_is_expression: false, reference_is_template: false })],
    ['an {x} text', literal({ reference_value: 'expected_status', reference_is_expression: true, reference_is_template: false })],
    ['a Template', literal({ reference_value: '{{ host }}', reference_is_expression: false, reference_is_template: true })],
  ]

  it.each(HELD)('asks before an operator that takes no value drops the compare value (%s)', async (_what, row) => {
    const { user, onRow } = renderLiteral(row)
    await pickOperator(user, 'is null')

    const dialog = screen.getByRole('alertdialog')
    expect(within(dialog).getByRole('heading', { name: OPERATOR_CHANGE_TITLE })).toBeInTheDocument()
    expect(within(dialog).getByText(/^Changing operator to is null will clear .+\. This cannot be undone\.$/)).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Change operator' })).toBeInTheDocument()
    expect(onRow).not.toHaveBeenCalled()

    // Cancel keeps the operator and the value.
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(onRow).not.toHaveBeenCalled()
    expect(operatorTrigger()).toHaveTextContent(/^equals$/)
    expect(queryValueBox()).toBeInTheDocument()
  })

  it('names the new operator and the value it clears in the question', async () => {
    const { user } = renderLiteral(literal({ reference_value: 'ready' }))
    await pickOperator(user, 'is null')

    expect(
      within(screen.getByRole('alertdialog')).getByText(
        /^Changing operator to is null will clear 1 existing string value\. This cannot be undone\.$/,
      ),
    ).toBeInTheDocument()
  })

  it.each(HELD)('drops the value and both flags once confirmed (%s)', async (_what, row) => {
    const { user, onRow } = renderLiteral(row)
    await pickOperator(user, 'is null')
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Change operator' }))

    const next = lastRow(onRow)
    expect(next).toEqual(bare({ ...row, operator: 'is_null' }))
    expectNoCompareTo(next)
    expect(queryValueBox()).not.toBeInTheDocument()
    expect(queryExpand()).not.toBeInTheDocument()
    expect(queryToggle()).not.toBeInTheDocument()
  })

  it.each([
    ['no compare value', bare(literal())],
    ['an empty text', literal({ reference_value: '' })],
    ['a blank {x}', literal({ reference_value: '', reference_is_expression: true })],
  ])('changes at once when the row holds no value the change would lose (%s)', async (_what, row) => {
    const { user, onRow } = renderLiteral(row)
    await pickOperator(user, 'not null')

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    const next = lastRow(onRow)
    expect(next).toEqual(bare({ ...row, operator: 'is_not_null' }))
    expectNoCompareTo(next)
  })

  it('keeps the compare value when the new operator still takes one', async () => {
    const { user, onRow } = renderLiteral(literal({ reference_value: 'ready' }))
    await pickOperator(user, 'contains')

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(lastRow(onRow)).toEqual(literal({ reference_value: 'ready', operator: 'contains' }))
  })

  // One fit rule for an operator and a variable pick: a held value must fit the new compare type (FIELD-13).
  const LIST_HELD: Array<[string, LiteralAssertion]> = [
    ['a literal text', literal({ variable: 'hosts', value_type: 'array', operator: 'contains', reference_value: 'abc' })],
    [
      'a Template',
      literal({ variable: 'hosts', value_type: 'array', operator: 'contains', reference_value: '{{ host }}', reference_is_template: true }),
    ],
  ]

  it.each(LIST_HELD)('asks before a number compare drops a value it cannot hold (%s)', async (_what, row) => {
    const { user, onRow } = renderLiteral(row)
    await pickOperator(user, 'length equals')

    const dialog = screen.getByRole('alertdialog')
    expect(within(dialog).getByRole('heading', { name: OPERATOR_CHANGE_TITLE })).toBeInTheDocument()
    expect(
      within(dialog).getByText(
        /^Changing operator to length equals will clear 1 existing string value\. This cannot be undone\.$/,
      ),
    ).toBeInTheDocument()
    expect(onRow).not.toHaveBeenCalled()

    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(onRow).not.toHaveBeenCalled()
    expect(operatorTrigger()).toHaveTextContent(/^contains$/)
  })

  it.each(LIST_HELD)('drops the value and both flags once a number compare is confirmed (%s)', async (_what, row) => {
    const { user, onRow } = renderLiteral(row)
    await pickOperator(user, 'length equals')
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Change operator' }))

    const next = lastRow(onRow)
    expect(next).toEqual(bare({ ...row, operator: 'length_equals' }))
    expectNoCompareTo(next)
    expect(valueBox()).toHaveValue('')
    expect(screen.getByTestId(`param-error-${STEM}`)).toHaveTextContent(/^Value is required$/)
  })

  it.each([
    ['a whole number', literal({ variable: 'hosts', value_type: 'array', operator: 'contains', reference_value: '2' })],
    [
      'an {x} text',
      literal({ variable: 'hosts', value_type: 'array', operator: 'contains', reference_value: 'max_retries', reference_is_expression: true }),
    ],
  ])('keeps a value that still fits the number compare, with no question (%s)', async (_what, row) => {
    const { user, onRow } = renderLiteral(row)
    await pickOperator(user, 'length equals')

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(lastRow(onRow)).toEqual({ ...row, operator: 'length_equals' })
  })

  it('leaves the value not set when the operator changes from one that takes none', async () => {
    const { user, onRow } = renderLiteral(bare(literal({ operator: 'is_null' })))
    await pickOperator(user, 'equals')

    const next = lastRow(onRow)
    expect(next.operator).toBe('equals')
    expect(next).not.toHaveProperty('reference_value')
    expect(valueBox()).toHaveValue('')
    expect(screen.getByTestId(TOGGLE_ID)).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByTestId(`param-error-${STEM}`)).toHaveTextContent(/^Value is required$/)
  })
})

// ---------------------------------------------------------------------------
// ConditionExpressionRow
// ---------------------------------------------------------------------------

describe('ConditionExpressionRow - the expression row (FIELD-15)', () => {
  it('gains expand that opens the editor titled Edit Condition', async () => {
    const { user } = renderExpression(expression('len(errors) == 0'))
    expect(sourceText(screen.getByTestId(`param-input-${EXPR_STEM}`))).toBe('len(errors) == 0')

    await user.click(screen.getByTestId(`param-expand-${EXPR_STEM}`))

    const editor = await screen.findByTestId('expression-editor-modal')
    expect(within(editor).getByRole('heading', { name: /^Edit Condition$/ })).toBeInTheDocument()
  })

  it.each([
    ['blank', ''],
    ['holding only spaces', '   '],
  ])('shows Condition is required for an expression that is %s', (_what, text) => {
    renderExpression(expression(text))
    const line = screen.getByTestId(`param-error-${EXPR_STEM}`)
    expect(line).toHaveTextContent(/^Condition is required$/)
    expect(line).toHaveAttribute('role', 'alert')
  })

  it('shows Condition is required for a blank expression', () => {
    renderExpression(expression(''))
    expect(screen.getByTestId(`param-error-${EXPR_STEM}`)).toHaveTextContent(/^Condition is required$/)
  })

  it('shows no message for a written expression', () => {
    renderExpression(expression('len(errors) == 0'))
    expect(screen.queryByTestId(`param-error-${EXPR_STEM}`)).not.toBeInTheDocument()
  })

  it('keeps an empty {x} slot', () => {
    renderExpression(expression('len(errors) == 0'))
    expect(screen.queryByTestId('expression-toggle')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /expression mode$/ })).not.toBeInTheDocument()
    const expand = screen.getByTestId(`param-expand-${EXPR_STEM}`)
    const actions = screen.getByTestId('row-actions')
    expect(follows(expand, actions)).toBe(true)
    const slots = emptySlotsBetween(expand, actions)
    expect(slots).toHaveLength(1)
    expect(slots[0]).toHaveClass('w-8')
  })

  it('writes the typed expression back to the row', async () => {
    const { onRow } = renderExpression(expression(''))
    const editor = screen.getByTestId(`param-input-${EXPR_STEM}`).querySelector<HTMLElement>('.cm-editor')
    const view = EditorView.findFromDOM(editor as HTMLElement) as EditorView
    act(() => {
      view.dispatch({ changes: { from: 0, insert: 'retries > 2' } })
    })
    expect(lastRow(onRow)).toEqual(expression('retries > 2'))
  })

  it('opens the same editor on Ctrl+E', async () => {
    renderExpression(expression('len(errors) == 0'))
    pressCtrlE(screen.getByTestId(`param-input-${EXPR_STEM}`))

    const modal = await screen.findByTestId('expression-editor-modal')
    expect(within(modal).getByRole('heading', { name: /^Edit Condition$/ })).toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// Row growth and the Template face (FIELD-15)
// ---------------------------------------------------------------------------

/** The row's own flex line: the element that holds the row's actions. */
function rowLine(): HTMLElement {
  return screen.getByTestId('row-actions').parentElement as HTMLElement
}

/** A bottom margin on the row collapses with the list's spacing, so the row must not carry one. */
function bottomMarginClasses(element: HTMLElement): string[] {
  return element.className.split(/\s+/).filter((token) => /^(mb|my|m)-/.test(token))
}

describe('Condition rows - the 20 px a message adds never collapses with the list spacing (FIELD-15)', () => {
  it('grows a literal row by bottom padding while its host draws a line under it', () => {
    renderLiteral(literal(), { grows: true })
    expect(rowLine()).toHaveClass('pb-5')
    expect(bottomMarginClasses(rowLine())).toEqual([])
  })

  it('grows a literal row by bottom padding while its compare value shows a message', () => {
    renderLiteral(literal({ reference_value: '', reference_is_expression: true }))
    expect(screen.getByTestId(`param-error-${STEM}`)).toHaveTextContent(/^Value is required$/)
    expect(rowLine()).toHaveClass('pb-5')
    expect(bottomMarginClasses(rowLine())).toEqual([])
  })

  it('grows an expression row by bottom padding while it shows a message', () => {
    renderExpression(expression(''))
    expect(screen.getByTestId(`param-error-${EXPR_STEM}`)).toHaveTextContent(/^Condition is required$/)
    expect(rowLine()).toHaveClass('pb-5')
    expect(bottomMarginClasses(rowLine())).toEqual([])
  })

  it('adds no bottom padding to a row with no message', () => {
    renderLiteral(literal(), { grows: false })
    expect(rowLine()).not.toHaveClass('pb-5')
    renderExpression(expression('retries > 2'))
    for (const line of screen.getAllByTestId('row-actions').map((actions) => actions.parentElement as HTMLElement)) {
      expect(line).not.toHaveClass('pb-5')
    }
  })
})

describe('Condition rows - the Template face reads the names the {x} face reads (FIELD-15)', () => {
  it('marks no declared variable inside {{ }} of a Template compare value', () => {
    renderLiteral(literal({ reference_value: '{{ status }}/health', reference_is_template: true }))
    expect(sourceText(valueBox())).toBe('{{ status }}/health')
    expect(valueBox().querySelector('.cm-unknown-variable')).toBeNull()
  })

  it('still marks a name no variable declares', () => {
    renderLiteral(literal({ reference_value: '{{ not_declared }}/health', reference_is_template: true }))
    expect(valueBox().querySelector('.cm-unknown-variable')).toHaveTextContent(/^not_declared$/)
  })
})
