/**
 * The field cell outside a table: the one field with its expand and {x} columns, the switch warning, the
 * value-loss question, its own sheets and the flag cleanup, driven by the modes its host hands it.
 *
 * REQ-3.1.1.5, REQ-3.1.3.18, REQ-3.1.3.19, REQ-3.1.3.21; FIELD-1, FIELD-5, FIELD-7, FIELD-14, FIELDERR-1, FIELDERR-3
 */

import { useState } from 'react'
import { describe, it, expect, vi } from 'vitest'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { EditorView } from '@codemirror/view'

// The expression box reads the flow scope from the workflow store: these cells sit in the root flow.
vi.mock('@/features/functions/canvas/use-function-scope', () => ({
  useFunctionScope: () => ({
    insideFunction: false,
    scopeId: '',
    declaredInputNames: [],
    declaredOutputNames: [],
    allowedVarNames: new Set<string>(),
  }),
}))

import { FieldCellView, useFieldCell } from '@/features/workbench/common/element-config/parameters/field-cell'
import type { FieldModes } from '@/features/workbench/lib/node-parameters/field-modes'
import type { Parameter } from '@/features/workbench/common/element-config/parameters/parameter-table-types'
import type { ElementTypes } from '@/lib/variable-validation'
import { ChildEditorParent } from '../../../../../utils/child-editor-parent'

type CellProps = Parameters<typeof useFieldCell>[0]

const EXPRESSION = 'attempt + 1'
const VARIABLES = [
  { name: 'attempt', type: 'integer' },
  { name: 'timeout_ms', type: 'integer' },
]
const SEALED = 'wave:enc:v1:c2VhbGVk'
const TO_EXPRESSION_TITLE = 'Switch the field to an expression?'
const TO_PLAIN_TITLE = 'Switch the field to a plain value?'
const SWITCH_BODY = 'The current value is cleared.'

// Field descriptors as the control hosts build them.
const COMPARE_TEXT: Parameter = { name: 'assert-value-0', label: 'Value', type: 'string', required: false }
const COMPARE_NUMBER: Parameter = { name: 'assert-value-1', label: 'Value', type: 'integer', required: false }
const LANE_LIMIT: Parameter = {
  name: 'parallel-branch-limit-branch_1',
  label: 'Time Limit',
  type: 'integer',
  required: false,
  minimum: 1,
}
const COUNT: Parameter = { name: 'count', label: 'Count', type: 'integer', required: true, acceptsNull: true }
const COUNT_IN_COUNT_MODE: Parameter = {
  name: 'count',
  label: 'Count',
  type: 'integer',
  required: false,
  acceptsNull: true,
  requiredWhen: { field: 'mode', values: ['count'] },
}
const setterValue = (index: number, label: string): Parameter => ({
  name: `varset-value-${index}`,
  label,
  type: 'string',
  required: false,
  acceptsNull: true,
})
const SETTER_SECRET: Parameter = { ...setterValue(0, 'token'), secret: true }
const LABELS: Parameter = { name: 'labels', label: 'Labels', type: 'map', required: false }
const TYPED_LIST: Parameter = { name: 'params', label: 'Params', type: 'array', required: false, typedValues: true }

// ---------------------------------------------------------------------------
// Host: keeps the value and the field's modes as one window would, outside any table.
// ---------------------------------------------------------------------------

interface ModeState {
  expression: boolean
  template: boolean
  entryExpressions: readonly string[]
  elementTypes: ElementTypes | undefined
}

interface CellRecord {
  value: unknown
  modes: ModeState
  hasMessage: boolean | undefined
}

/** What each cell last held, keyed by its stem. */
const records: Record<string, CellRecord> = {}

const NO_MODES: ModeState = { expression: false, template: false, entryExpressions: [], elementTypes: undefined }

function FieldCell(props: Readonly<CellProps>) {
  const state = useFieldCell(props)
  records[props.parameter.name].hasMessage = state.hasMessage
  return <FieldCellView state={state} />
}

interface HostedCellProps {
  parameter: Parameter
  initial: unknown
  modes?: Partial<ModeState>
  extra?: Partial<CellProps>
}

function HostedCell({ parameter, initial, modes: initialModes, extra }: Readonly<HostedCellProps>) {
  const [value, setValue] = useState<unknown>(initial)
  const [modeState, setModeState] = useState<ModeState>({ ...NO_MODES, ...initialModes })
  records[parameter.name] = { value, modes: modeState, hasMessage: records[parameter.name]?.hasMessage }
  // The FieldModes contract: one setExpression call also clears Template, entry {x} and element types.
  const modes: FieldModes = {
    ...modeState,
    setExpression: (pressed: boolean) =>
      setModeState((current) => ({
        ...current,
        expression: pressed,
        template: false,
        entryExpressions: [],
        elementTypes: undefined,
      })),
    setTemplate: (on: boolean) => setModeState((current) => ({ ...current, template: on })),
    setEntryExpressions: (keys: readonly string[]) =>
      setModeState((current) => ({ ...current, entryExpressions: [...keys] })),
    setElementTypes: (types: ElementTypes | undefined) =>
      setModeState((current) => ({ ...current, elementTypes: types })),
  }
  return (
    <FieldCell
      mode="input"
      parameter={parameter}
      value={value}
      onChange={(next: unknown) => setValue(next)}
      modes={modes}
      availableVariables={VARIABLES}
      {...extra}
    />
  )
}

function renderCells(cells: HostedCellProps[]) {
  render(
    <ChildEditorParent>
      <div data-testid="flex-host">
        {cells.map((cell) => (
          <HostedCell key={cell.parameter.name} {...cell} />
        ))}
      </div>
    </ChildEditorParent>,
  )
  return { user: userEvent.setup(), host: screen.getByTestId('flex-host') }
}

const renderCell = (cell: HostedCellProps) => renderCells([cell])
const record = (stem: string) => records[stem]
const toggle = (testId = 'expression-toggle') => screen.getByTestId(testId)
const switchDialog = () => screen.queryByTestId('switch-mode-dialog')
const dialogButtons = () =>
  within(screen.getByTestId('switch-mode-dialog'))
    .getAllByRole('button')
    .map((button) => button.textContent)

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

const exactly = (text: string) => new RegExp(`^${escapeRegExp(text)}$`)

/** A blank {x} box holds nothing: no value or an empty expression (REQ-3.1.1.5). */
function expectBlankExpression(value: unknown): void {
  expect([undefined, '']).toContainEqual(value)
}

/** The text of the CodeMirror editor inside an element. */
function editorText(element: HTMLElement): string {
  const editor = element.querySelector<HTMLElement>('.cm-editor')
  expect(editor, 'the element holds a CodeMirror editor').not.toBeNull()
  const view = EditorView.findFromDOM(editor as HTMLElement)
  expect(view, 'the editor is mounted').not.toBeNull()
  return (view as EditorView).state.doc.toString()
}

/** Types into the CodeMirror editor inside an element, as a key press would. */
function typeIntoEditor(element: HTMLElement, text: string): void {
  const view = EditorView.findFromDOM(element.querySelector<HTMLElement>('.cm-editor') as HTMLElement) as EditorView
  act(() => {
    view.dispatch({ changes: { from: view.state.doc.length, insert: text } })
  })
}

const follows = (later: Element, earlier: Element) =>
  !earlier.contains(later) && (earlier.compareDocumentPosition(later) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0

function expectInOrder(...elements: Element[]): void {
  for (let i = 1; i < elements.length; i += 1) {
    expect(follows(elements[i], elements[i - 1]), `element ${i} comes after element ${i - 1}`).toBe(true)
  }
}

/** The `null` the field draws over its box; the screen reader line that says it is left out. */
const drawnNull = (host: HTMLElement) =>
  within(host)
    .queryAllByText('null')
    .filter((element) => !element.classList.contains('sr-only'))

/** The empty placeholder columns drawn between two elements: an empty expand or {x} slot. */
function emptySlotsBetween(start: Element, end: Element): Element[] {
  return Array.from(document.body.querySelectorAll('span[aria-hidden="true"]')).filter(
    (slot) => slot.childNodes.length === 0 && follows(slot, start) && follows(end, slot),
  )
}

// ---------------------------------------------------------------------------
// The one field outside a table (FIELD-1, FIELD-14)
// ---------------------------------------------------------------------------

describe('The field cell outside a table (FIELD-1, FIELD-14)', () => {
  it('draws the one field in a flex row with its expand and {x} columns', () => {
    const { host } = renderCell({ parameter: COMPARE_TEXT, initial: 'ready' })
    expect(host.querySelector('table, tr, td')).toBeNull()
    const box = within(host).getByRole('textbox', { name: 'Value' })
    expect(box).toHaveValue('ready')
    // The cell id sits on the text box itself, as on the number box (FIELD-1).
    expect(box).toHaveAttribute('data-testid', 'param-input-assert-value-0')
    const expand = screen.getByTestId('param-expand-assert-value-0')
    expect(expand).toHaveAccessibleName('Open editor for Value')
    const xToggle = toggle()
    expect(xToggle).toHaveAccessibleName('Value expression mode')
    expect(xToggle).toHaveAttribute('aria-pressed', 'false')
    expectInOrder(box, expand, xToggle)
    expect(screen.queryByTestId('param-error-assert-value-0')).not.toBeInTheDocument()
    expect(record('assert-value-0').hasMessage).toBe(false)
  })

  it('draws a number value with an empty expand slot and its {x} column', () => {
    renderCell({ parameter: COMPARE_NUMBER, initial: '500' })
    const box = screen.getByTestId('param-input-assert-value-1')
    expect(box).toHaveValue('500')
    expect(screen.queryByTestId('param-expand-assert-value-1')).not.toBeInTheDocument()
    expect(emptySlotsBetween(box, toggle())).toHaveLength(1)
  })

  it('draws an {x} value as the expression box with its expand, {x} pressed', () => {
    renderCell({ parameter: COMPARE_TEXT, initial: 'expected_status', modes: { expression: true } })
    const box = screen.getByTestId('param-input-assert-value-0')
    expect(editorText(box)).toBe('expected_status')
    expect(screen.getByTestId('param-expand-assert-value-0')).toHaveAccessibleName('Open editor for Value')
    expect(toggle()).toHaveAttribute('aria-pressed', 'true')
  })

  it('draws a text value held as Template in the Template face, with no null button', () => {
    renderCell({ parameter: setterValue(0, 'summary'), initial: 'Run {{ run_id }} done', modes: { template: true } })
    expect(editorText(screen.getByTestId('param-input-varset-value-0'))).toBe('Run {{ run_id }} done')
    expect(screen.queryByTestId('param-null-varset-value-0')).not.toBeInTheDocument()
    expect(screen.getByTestId('param-expand-varset-value-0')).toHaveAccessibleName('Open editor for summary')
    expect(toggle()).toHaveAttribute('aria-pressed', 'false')
  })

  it('keeps an empty {x} slot for a field that takes no {x}', () => {
    const CONDITION: Parameter = {
      name: 'assert-expr-0',
      label: 'Condition',
      type: 'string',
      required: false,
      noExpression: true,
    }
    const { host } = renderCell({ parameter: CONDITION, initial: 'attempt > 3', modes: { expression: true } })
    expect(editorText(screen.getByTestId('param-input-assert-expr-0'))).toBe('attempt > 3')
    const expand = screen.getByTestId('param-expand-assert-expr-0')
    expect(expand).toHaveAccessibleName('Open editor for Condition')
    expect(screen.queryByTestId('expression-toggle')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Condition expression mode' })).not.toBeInTheDocument()
    const slotsAfterExpand = Array.from(host.querySelectorAll('span[aria-hidden="true"]')).filter(
      (slot) => slot.childNodes.length === 0 && follows(slot, expand),
    )
    expect(slotsAfterExpand).toHaveLength(1)
    expect(slotsAfterExpand[0]).toHaveClass('w-8')
  })

  it('uses the toggle test id the host gives', () => {
    renderCell({
      parameter: LANE_LIMIT,
      initial: undefined,
      extra: { toggleTestId: 'parallel-branch-limit-toggle-branch_1' },
    })
    const xToggle = screen.getByTestId('parallel-branch-limit-toggle-branch_1')
    expect(xToggle).toHaveAccessibleName('Time Limit expression mode')
    expect(xToggle).toHaveAttribute('aria-pressed', 'false')
    expect(screen.queryByTestId('expression-toggle')).not.toBeInTheDocument()
  })

  it('keeps an empty 32 px expand column beside a number and draws the expand in it in {x} mode', () => {
    const EXPRESSION_LIMIT: Parameter = { ...LANE_LIMIT, name: 'parallel-branch-limit-branch_2' }
    renderCells([
      { parameter: LANE_LIMIT, initial: 30000, extra: { toggleTestId: 'toggle-plain' } },
      {
        parameter: EXPRESSION_LIMIT,
        initial: 'timeout_ms',
        modes: { expression: true },
        extra: { toggleTestId: 'toggle-expression' },
      },
    ])
    const plain = screen.getByTestId('param-input-parallel-branch-limit-branch_1')
    const plainSlots = emptySlotsBetween(plain, toggle('toggle-plain'))
    expect(plainSlots).toHaveLength(1)
    expect(plainSlots[0]).toHaveClass('w-8')
    expect(screen.queryByTestId('param-expand-parallel-branch-limit-branch_1')).not.toBeInTheDocument()
    const box = screen.getByTestId('param-input-parallel-branch-limit-branch_2')
    const expand = screen.getByTestId('param-expand-parallel-branch-limit-branch_2')
    expect(expand).toHaveAccessibleName('Open editor for Time Limit')
    expectInOrder(box, expand, toggle('toggle-expression'))
    expect(emptySlotsBetween(box, toggle('toggle-expression'))).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// The switch warning (FIELD-7)
// ---------------------------------------------------------------------------

describe('The field cell switch warning (FIELD-7)', () => {
  it('asks before {x} on a text value: Cancel, Clear, Clear & Empty', async () => {
    const { user } = renderCell({ parameter: COMPARE_TEXT, initial: 'ready' })
    await user.click(toggle())
    const dialog = screen.getByTestId('switch-mode-dialog')
    expect(within(dialog).getByRole('heading')).toHaveTextContent(exactly(TO_EXPRESSION_TITLE))
    expect(within(dialog).getByText(SWITCH_BODY)).toBeInTheDocument()
    expect(dialogButtons()).toEqual(['Cancel', 'Clear', 'Clear & Empty'])
    expect(toggle()).toHaveAttribute('aria-pressed', 'false')
    expect(record('assert-value-0').value).toBe('ready')
    expect(record('assert-value-0').modes.expression).toBe(false)
  })

  it('keeps the text value and the literal mode on Cancel', async () => {
    const { user } = renderCell({ parameter: COMPARE_TEXT, initial: 'ready' })
    await user.click(toggle())
    await user.click(screen.getByTestId('switch-mode-cancel'))
    expect(switchDialog()).not.toBeInTheDocument()
    expect(toggle()).toHaveAttribute('aria-pressed', 'false')
    expect(record('assert-value-0').value).toBe('ready')
    expect(record('assert-value-0').modes.expression).toBe(false)
  })

  it('switches a text value into an empty {x} box on Clear', async () => {
    const { user } = renderCell({ parameter: COMPARE_TEXT, initial: 'ready' })
    await user.click(toggle())
    await user.click(screen.getByTestId('switch-mode-clear-default'))
    expect(switchDialog()).not.toBeInTheDocument()
    expect(toggle()).toHaveAttribute('aria-pressed', 'true')
    expect(record('assert-value-0').modes.expression).toBe(true)
    expectBlankExpression(record('assert-value-0').value)
    expect(editorText(screen.getByTestId('param-input-assert-value-0'))).toBe('')
  })

  it("puts '' into the {x} box on Clear & Empty", async () => {
    const { user } = renderCell({ parameter: COMPARE_TEXT, initial: 'ready' })
    await user.click(toggle())
    await user.click(screen.getByTestId('switch-mode-clear-empty'))
    expect(toggle()).toHaveAttribute('aria-pressed', 'true')
    expect(record('assert-value-0').value).toBe("''")
    expect(editorText(screen.getByTestId('param-input-assert-value-0'))).toBe("''")
  })

  it('asks before {x} on a number: Cancel, Clear', async () => {
    const { user } = renderCell({ parameter: COMPARE_NUMBER, initial: '500' })
    await user.click(toggle())
    const dialog = screen.getByTestId('switch-mode-dialog')
    expect(within(dialog).getByRole('heading')).toHaveTextContent(exactly(TO_EXPRESSION_TITLE))
    expect(within(dialog).getByText(SWITCH_BODY)).toBeInTheDocument()
    expect(dialogButtons()).toEqual(['Cancel', 'Clear'])
    await user.click(screen.getByTestId('switch-mode-clear-default'))
    expect(toggle()).toHaveAttribute('aria-pressed', 'true')
    expectBlankExpression(record('assert-value-1').value)
  })

  it.each([
    ['a value that is not set', COMPARE_TEXT, undefined],
    ['a null on a field that takes null', setterValue(0, 'greeting'), null],
  ] as const)('switches at once when the value holds nothing: %s', async (_case, parameter, initial) => {
    const { user } = renderCell({ parameter, initial })
    await user.click(toggle())
    expect(switchDialog()).not.toBeInTheDocument()
    expect(toggle()).toHaveAttribute('aria-pressed', 'true')
    expect(record(parameter.name).modes.expression).toBe(true)
    expectBlankExpression(record(parameter.name).value)
  })

  it('asks before {x} on a stored null on a field that refuses null', async () => {
    const { user } = renderCell({ parameter: COMPARE_TEXT, initial: null })
    await user.click(toggle())
    expect(within(screen.getByTestId('switch-mode-dialog')).getByRole('heading')).toHaveTextContent(
      exactly(TO_EXPRESSION_TITLE),
    )
    expect(toggle()).toHaveAttribute('aria-pressed', 'false')
    expect(record('assert-value-0').value).toBeNull()
  })

  it('asks before leaving {x}: Clear leaves the value not set', async () => {
    const { user } = renderCell({ parameter: LANE_LIMIT, initial: 'timeout_ms * 2', modes: { expression: true } })
    await user.click(toggle())
    const dialog = screen.getByTestId('switch-mode-dialog')
    expect(within(dialog).getByRole('heading')).toHaveTextContent(exactly(TO_PLAIN_TITLE))
    expect(within(dialog).getByText(SWITCH_BODY)).toBeInTheDocument()
    expect(dialogButtons()).toEqual(['Cancel', 'Clear'])
    await user.click(screen.getByTestId('switch-mode-clear-default'))
    expect(switchDialog()).not.toBeInTheDocument()
    expect(toggle()).toHaveAttribute('aria-pressed', 'false')
    expect(record(LANE_LIMIT.name).modes.expression).toBe(false)
    expect(record(LANE_LIMIT.name).value).toBeUndefined()
    expect(screen.getByTestId('param-input-parallel-branch-limit-branch_1')).toHaveValue('')
  })

  it('leaves a required field that takes null not set on Clear out of {x}, with its required message', async () => {
    const { user, host } = renderCell({ parameter: COUNT, initial: 'attempt + 1', modes: { expression: true } })
    await user.click(toggle())
    expect(within(screen.getByTestId('switch-mode-dialog')).getByRole('heading')).toHaveTextContent(
      exactly(TO_PLAIN_TITLE),
    )
    await user.click(screen.getByTestId('switch-mode-clear-default'))
    expect(record('count').value).toBeUndefined()
    expect(screen.getByTestId('param-input-count')).toHaveValue('')
    expect(drawnNull(host)).toHaveLength(0)
    expect(screen.getByTestId('param-null-count')).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByTestId('param-error-count')).toHaveTextContent(exactly('Count is required'))
  })

  it('keeps the expression and {x} on Cancel when leaving {x}', async () => {
    const { user } = renderCell({ parameter: COMPARE_TEXT, initial: EXPRESSION, modes: { expression: true } })
    await user.click(toggle())
    await user.click(screen.getByTestId('switch-mode-cancel'))
    expect(toggle()).toHaveAttribute('aria-pressed', 'true')
    expect(record('assert-value-0').value).toBe(EXPRESSION)
    expect(editorText(screen.getByTestId('param-input-assert-value-0'))).toBe(EXPRESSION)
  })

  it('asks before leaving {x} on a text value: Cancel, Clear, Clear & Empty', async () => {
    const { user } = renderCell({ parameter: COMPARE_TEXT, initial: EXPRESSION, modes: { expression: true } })
    await user.click(toggle())
    expect(within(screen.getByTestId('switch-mode-dialog')).getByRole('heading')).toHaveTextContent(
      exactly(TO_PLAIN_TITLE),
    )
    expect(dialogButtons()).toEqual(['Cancel', 'Clear', 'Clear & Empty'])
  })

  it('leaves a text compare value not set on Clear out of {x}', async () => {
    const { user } = renderCell({ parameter: COMPARE_TEXT, initial: EXPRESSION, modes: { expression: true } })
    await user.click(toggle())
    expect(within(screen.getByTestId('switch-mode-dialog')).getByRole('heading')).toHaveTextContent(
      exactly(TO_PLAIN_TITLE),
    )
    await user.click(screen.getByTestId('switch-mode-clear-default'))
    expect(toggle()).toHaveAttribute('aria-pressed', 'false')
    expect(record('assert-value-0').value).toBeUndefined()
    expect(screen.getByRole('textbox', { name: 'Value' })).toHaveValue('')
  })

  it('leaves empty text as the user value on Clear & Empty out of {x}', async () => {
    const { user } = renderCell({ parameter: COMPARE_TEXT, initial: EXPRESSION, modes: { expression: true } })
    await user.click(toggle())
    await user.click(screen.getByTestId('switch-mode-clear-empty'))
    expect(switchDialog()).not.toBeInTheDocument()
    expect(toggle()).toHaveAttribute('aria-pressed', 'false')
    expect(record('assert-value-0').modes.expression).toBe(false)
    expect(record('assert-value-0').value).toBe('')
  })

  it('leaves a field that takes null not set on Clear out of {x}, so it shows null', async () => {
    const { user, host } = renderCell({
      parameter: setterValue(0, 'greeting'),
      initial: EXPRESSION,
      modes: { expression: true },
    })
    await user.click(toggle())
    await user.click(screen.getByTestId('switch-mode-clear-default'))
    expect(toggle()).toHaveAttribute('aria-pressed', 'false')
    expect(record('varset-value-0').value).toBeUndefined()
    expect(drawnNull(host)).toHaveLength(1)
    expect(screen.getByTestId('param-null-varset-value-0')).toHaveAttribute('aria-pressed', 'true')
  })

  it('asks Discard protected value? before {x} on a masked value', async () => {
    const { user } = renderCell({ parameter: SETTER_SECRET, initial: SEALED })
    expect(screen.queryByTestId('param-expand-varset-value-0')).not.toBeInTheDocument()
    await user.click(toggle())
    const confirm = screen.getByRole('alertdialog', { name: 'Discard protected value?' })
    expect(confirm).toHaveTextContent(
      'The protected value stored in token will be discarded when you switch to an expression. The field will then reference a variable instead.',
    )
    expect(switchDialog()).not.toBeInTheDocument()
    expect(toggle()).toHaveAttribute('aria-pressed', 'false')
    expect(record('varset-value-0').value).toBe(SEALED)
    await user.click(within(confirm).getByRole('button', { name: 'Switch to expression' }))
    expect(toggle()).toHaveAttribute('aria-pressed', 'true')
    expect(record('varset-value-0').modes.expression).toBe(true)
    expectBlankExpression(record('varset-value-0').value)
  })

  it('keeps the masked value and the literal mode when the discard is canceled', async () => {
    const { user } = renderCell({ parameter: SETTER_SECRET, initial: SEALED })
    await user.click(toggle())
    const confirm = screen.getByRole('alertdialog', { name: 'Discard protected value?' })
    await user.click(within(confirm).getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('alertdialog', { name: 'Discard protected value?' })).not.toBeInTheDocument()
    expect(toggle()).toHaveAttribute('aria-pressed', 'false')
    expect(record('varset-value-0').value).toBe(SEALED)
    expect(screen.getByRole('button', { name: 'token: Edit protected value' })).toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// The value-loss question and the field's own sheets
// ---------------------------------------------------------------------------

describe('The field cell sheets and the value-loss question (REQ-3.1.3.19)', () => {
  const listBody = () => within(screen.getByTestId('value-editor-sheet')).getByTestId('array-edit-body')

  async function pickItemType(user: ReturnType<typeof userEvent.setup>, index: number, type: string) {
    await user.click(within(listBody()).getByTestId(`array-type-${index}`))
    await user.click(await screen.findByRole('option', { name: type }))
  }

  it('asks the value-loss question before a type change drops a value', async () => {
    const { user } = renderCell({ parameter: TYPED_LIST, initial: ['abc'], modes: { elementTypes: ['string'] } })
    await user.click(screen.getByTestId('param-expand-params'))
    await pickItemType(user, 0, 'integer')
    const question = screen.getByRole('alertdialog', { name: 'Change item type?' })
    expect(question).toHaveTextContent('Changing type to integer will clear 1 existing string value. This cannot be undone.')
    await user.click(within(question).getByRole('button', { name: 'Change type' }))
    await user.click(screen.getByTestId('value-editor-save-button'))
    expect(record('params').modes.elementTypes).toEqual(['integer'])
    expect(record('params').value).toEqual(['0'])
  })

  it('keeps the item, its type and the field as they were when the question is canceled', async () => {
    const { user } = renderCell({ parameter: TYPED_LIST, initial: ['abc'], modes: { elementTypes: ['string'] } })
    await user.click(screen.getByTestId('param-expand-params'))
    await pickItemType(user, 0, 'integer')
    const question = screen.getByRole('alertdialog', { name: 'Change item type?' })
    await user.click(within(question).getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('alertdialog', { name: 'Change item type?' })).not.toBeInTheDocument()
    expect(record('params').value).toEqual(['abc'])
    expect(record('params').modes.elementTypes).toEqual(['string'])
  })

  it('two cells keep two sheets open at once', async () => {
    const { user } = renderCells([
      { parameter: setterValue(0, 'greeting'), initial: 'hello', extra: { toggleTestId: 'varset-expression-toggle-0' } },
      { parameter: setterValue(1, 'farewell'), initial: 'bye', extra: { toggleTestId: 'varset-expression-toggle-1' } },
    ])
    await user.click(screen.getByTestId('param-expand-varset-value-0'))
    const first = screen.getByTestId('value-editor-sheet')
    typeIntoEditor(first, ' world')
    await user.click(screen.getByTestId('param-expand-varset-value-1'))
    const sheets = screen.getAllByTestId('value-editor-sheet')
    expect(sheets).toHaveLength(2)
    expect(sheets).toContain(first)
    expect(screen.queryByTestId('unsaved-changes-dialog')).not.toBeInTheDocument()
    expect(editorText(first)).toBe('hello world')
    const second = sheets.find((sheet) => sheet !== first) as HTMLElement
    expect(editorText(second)).toBe('bye')
    expect(record('varset-value-0').value).toBe('hello')
    expect(record('varset-value-1').value).toBe('bye')
  })

  it('asks before {x} takes away a sheet that holds unsaved changes', async () => {
    const { user } = renderCell({ parameter: setterValue(0, 'greeting'), initial: 'hello' })
    await user.click(screen.getByTestId('param-expand-varset-value-0'))
    typeIntoEditor(screen.getByTestId('value-editor-sheet'), ' world')
    await user.click(toggle())
    const question = screen.getByTestId('unsaved-changes-dialog')
    expect(within(question).getByTestId('unsaved-keep-editing')).toBeInTheDocument()
    expect(within(question).getByTestId('unsaved-close')).toBeInTheDocument()
    expect(within(question).queryByTestId('unsaved-save')).not.toBeInTheDocument()
    expect(switchDialog()).not.toBeInTheDocument()
    expect(toggle()).toHaveAttribute('aria-pressed', 'false')
    await user.click(within(question).getByTestId('unsaved-close'))
    expect(screen.queryByTestId('value-editor-sheet')).not.toBeInTheDocument()
    expect(within(screen.getByTestId('switch-mode-dialog')).getByRole('heading')).toHaveTextContent(
      exactly(TO_EXPRESSION_TITLE),
    )
    expect(record('varset-value-0').value).toBe('hello')
  })

  it('writes an entry {x} set in the map editor back through the modes', async () => {
    const { user } = renderCell({ parameter: LABELS, initial: { app: 'web', tier: '' } })
    await user.click(screen.getByTestId('param-expand-labels'))
    const sheet = screen.getByTestId('value-editor-sheet')
    await user.click(within(sheet).getByTestId('map-expr-toggle-1'))
    typeIntoEditor(within(sheet).getByTestId('map-expr-value-1'), 'backend_tier')
    await user.click(screen.getByTestId('value-editor-save-button'))
    const { modes, value } = record('labels')
    expect(modes.entryExpressions).toEqual(['tier'])
    expect(modes.expression).toBe(false)
    expect(value).toEqual({ app: 'web', tier: 'backend_tier' })
  })

  it('hands its value box to the sheet a Delete & Edit opens, so the box has the focus when the sheet closes', async () => {
    const { user } = renderCell({ parameter: { ...LABELS, secret: true }, initial: { app: SEALED, tier: SEALED } })
    await user.click(screen.getByRole('button', { name: 'Labels: Edit protected value' }))
    await user.click(within(screen.getByRole('dialog', { name: 'Edit Protected Value?' })).getByRole('button', { name: 'Delete & Edit' }))
    expect(record('labels').value).toEqual({})
    expect(screen.getByTestId('value-editor-sheet')).toBeInTheDocument()
    await user.click(screen.getByTestId('value-editor-cancel-button'))
    expect(screen.queryByTestId('value-editor-sheet')).not.toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Labels' })).toHaveFocus())
  })
})

// ---------------------------------------------------------------------------
// Required, null and the field's own messages (FIELD-5, FIELDERR-1, FIELDERR-3, REQ-3.1.3.21)
// ---------------------------------------------------------------------------

describe('The field cell required rule on a field that takes null (FIELD-5, REQ-3.1.3.21)', () => {
  it.each([
    ['a required field', COUNT, undefined],
    ['a field required in count mode', COUNT_IN_COUNT_MODE, { allValues: { mode: 'count' } }],
  ] as const)(
    'shows an empty box and the required message for a required field that takes null and is not set: %s',
    (_case, parameter, extra) => {
      const onValidationChange = vi.fn()
      const { host } = renderCell({ parameter, initial: undefined, extra: { ...extra, onValidationChange } })
      const box = screen.getByTestId('param-input-count')
      expect(box).toHaveValue('')
      expect(drawnNull(host)).toHaveLength(0)
      const nullButton = screen.getByTestId('param-null-count')
      expect(nullButton).toHaveAccessibleName('Set Count to null')
      expect(nullButton).toHaveAttribute('aria-pressed', 'false')
      const error = screen.getByTestId('param-error-count')
      expect(error).toHaveAttribute('role', 'alert')
      expect(error).toHaveTextContent(exactly('Count is required'))
      expect(onValidationChange).toHaveBeenLastCalledWith('count', 'Count is required')
    },
  )

  it('takes an explicit null as filled', () => {
    const onValidationChange = vi.fn()
    const { host } = renderCell({ parameter: COUNT, initial: null, extra: { onValidationChange } })
    expect(drawnNull(host)).toHaveLength(1)
    expect(screen.getByTestId('param-null-count')).toHaveAttribute('aria-pressed', 'true')
    expect(screen.queryByTestId('param-error-count')).not.toBeInTheDocument()
    expect(onValidationChange).toHaveBeenLastCalledWith('count', null)
  })

  it('fills the field when the null button is pressed', async () => {
    const onValidationChange = vi.fn()
    const { user, host } = renderCell({ parameter: COUNT, initial: undefined, extra: { onValidationChange } })
    await user.click(screen.getByTestId('param-null-count'))
    expect(record('count').value).toBeNull()
    expect(drawnNull(host)).toHaveLength(1)
    expect(screen.getByTestId('param-null-count')).toHaveAttribute('aria-pressed', 'true')
    expect(screen.queryByTestId('param-error-count')).not.toBeInTheDocument()
    expect(onValidationChange).toHaveBeenLastCalledWith('count', null)
  })
})

describe('The field cell flag cleanup (FIELD-6, REQ-3.1.3.19)', () => {
  const HELD_MAP = { app: 'web', tier: 'backend_tier' }
  const HELD_TYPES: ElementTypes = { app: 'string', tier: 'string' }

  it('drops entry flags and element types when the field goes to {x}', async () => {
    const { user } = renderCell({
      parameter: LABELS,
      initial: HELD_MAP,
      modes: { entryExpressions: ['tier'], elementTypes: HELD_TYPES },
    })
    await user.click(toggle())
    expect(switchDialog()).toBeInTheDocument()
    await user.click(screen.getByTestId('switch-mode-clear-default'))
    const { modes, value } = record('labels')
    expect(modes.expression).toBe(true)
    expect(modes.entryExpressions).toEqual([])
    expect(modes.elementTypes).toBeUndefined()
    expect(modes.template).toBe(false)
    expectBlankExpression(value)
  })

  it('drops the Template mark when a text field goes to {x}', async () => {
    const { user } = renderCell({ parameter: COMPARE_TEXT, initial: 'Run {{ run_id }}', modes: { template: true } })
    await user.click(toggle())
    await user.click(screen.getByTestId('switch-mode-clear-default'))
    expect(record('assert-value-0').modes).toMatchObject({ expression: true, template: false })
  })

  it('drops entry flags and element types when the null button is pressed', async () => {
    const { user } = renderCell({
      parameter: { ...LABELS, acceptsNull: true },
      initial: HELD_MAP,
      modes: { entryExpressions: ['tier'], elementTypes: HELD_TYPES },
    })
    await user.click(screen.getByTestId('param-null-labels'))
    const { modes, value } = record('labels')
    expect(value).toBeNull()
    expect(modes.entryExpressions).toEqual([])
    expect(modes.elementTypes).toBeUndefined()
    expect(modes.expression).toBe(false)
  })

  it('drops entry flags and element types when the field is reset to its default', async () => {
    const { user } = renderCell({
      parameter: { ...LABELS, defaultValue: { app: 'api' } },
      initial: HELD_MAP,
      modes: { entryExpressions: ['tier'], elementTypes: HELD_TYPES },
    })
    await user.click(screen.getByTestId('param-reset-labels'))
    const { modes, value } = record('labels')
    expect(value).toBeUndefined()
    expect(modes.entryExpressions).toEqual([])
    expect(modes.elementTypes).toBeUndefined()
  })

  it('draws the {x} entries the modes hold in the one line', () => {
    const { host } = renderCell({ parameter: LABELS, initial: HELD_MAP, modes: { entryExpressions: ['tier'] } })
    expect(host).toHaveTextContent('{{ backend_tier }}')
  })
})

describe('The field cell messages (FIELDERR-1, FIELDERR-3)', () => {
  it('shows the fieldError line under the box with role alert', () => {
    const { host } = renderCell({ parameter: COMPARE_TEXT, initial: '', extra: { fieldError: 'Value is required' } })
    const error = screen.getByTestId('param-error-assert-value-0')
    expect(error).toHaveAttribute('role', 'alert')
    expect(error).toHaveTextContent(exactly('Value is required'))
    const box = within(host).getByRole('textbox', { name: 'Value' })
    expect(box.getAttribute('aria-describedby')?.split(' ')).toContain(error.id)
    expect(box).toHaveAttribute('aria-invalid', 'true')
    expect(record('assert-value-0').hasMessage).toBe(true)
  })

  it('shows the fieldError line under a blank {x} box', () => {
    renderCell({
      parameter: LANE_LIMIT,
      initial: undefined,
      modes: { expression: true },
      extra: { fieldError: 'Time Limit is required' },
    })
    const error = screen.getByTestId('param-error-parallel-branch-limit-branch_1')
    expect(error).toHaveAttribute('role', 'alert')
    expect(error).toHaveTextContent(exactly('Time Limit is required'))
  })

  it('shows an expression finding as an amber line that does not hold Save', async () => {
    const onValidationChange = vi.fn()
    renderCell({
      parameter: COMPARE_TEXT,
      initial: 'missing_var + 1',
      modes: { expression: true },
      extra: { onValidationChange },
    })
    const note = await screen.findByTestId('param-warning-assert-value-0')
    expect(note).toHaveTextContent(exactly("Identifier 'missing_var' is not defined"))
    expect(note).not.toHaveAttribute('role', 'alert')
    expect(screen.queryByTestId('param-error-assert-value-0')).not.toBeInTheDocument()
    expect(onValidationChange).not.toHaveBeenCalledWith('assert-value-0', expect.any(String))
    expect(record('assert-value-0').hasMessage).toBe(true)
  })

  it('checks a declared minimum with no allValues from the host', () => {
    const onValidationChange = vi.fn()
    renderCell({ parameter: LANE_LIMIT, initial: 0, extra: { onValidationChange } })
    const error = screen.getByTestId('param-error-parallel-branch-limit-branch_1')
    expect(error).toHaveAttribute('role', 'alert')
    expect(error).toHaveTextContent(exactly('Time Limit must be at least 1'))
    expect(screen.getByTestId('param-input-parallel-branch-limit-branch_1')).toHaveValue('0')
    expect(onValidationChange).toHaveBeenLastCalledWith('parallel-branch-limit-branch_1', 'Time Limit must be at least 1')
  })

  it('shows no bound message for a value at the minimum or above it', () => {
    const onValidationChange = vi.fn()
    renderCell({ parameter: LANE_LIMIT, initial: 30000, extra: { onValidationChange } })
    expect(screen.queryByTestId('param-error-parallel-branch-limit-branch_1')).not.toBeInTheDocument()
    expect(onValidationChange).toHaveBeenLastCalledWith('parallel-branch-limit-branch_1', null)
  })

  it('checks no bound on an {x} value', () => {
    renderCell({ parameter: LANE_LIMIT, initial: '0', modes: { expression: true } })
    expect(screen.queryByTestId('param-error-parallel-branch-limit-branch_1')).not.toBeInTheDocument()
  })

  it('shows the number rule message for text an integer value cannot read', () => {
    const onValidationChange = vi.fn()
    renderCell({ parameter: COMPARE_NUMBER, initial: 'abc', extra: { onValidationChange } })
    const error = screen.getByTestId('param-error-assert-value-1')
    expect(error).toHaveTextContent(exactly('Enter a valid integer value'))
    expect(onValidationChange).toHaveBeenLastCalledWith('assert-value-1', 'Enter a valid integer value')
  })
})

// ---------------------------------------------------------------------------
// A Template value is written source, as an {x} value is (REQ-3.1.3.15)
// ---------------------------------------------------------------------------

const URL_FIELD: Parameter = { name: 'url', label: 'URL', type: 'string', required: true }
const URL_MESSAGE = 'URL must start with http:// or https://'
const BASE_URL = [{ name: 'base_url', type: 'string' }]

describe('The field cell Template face (REQ-3.1.3.15, FIELDERR-1)', () => {
  it('checks a Template url as written source: no format message, nothing holds Save', () => {
    const onValidationChange = vi.fn()
    renderCell({
      parameter: URL_FIELD,
      initial: '{{ base_url }}/health',
      modes: { template: true },
      extra: { availableVariables: BASE_URL, onValidationChange },
    })

    const box = screen.getByTestId('param-input-url')
    expect(editorText(box)).toBe('{{ base_url }}/health')
    expect(screen.queryByTestId('param-error-url')).not.toBeInTheDocument()
    expect(onValidationChange).toHaveBeenLastCalledWith('url', null)
    expect(record('url').hasMessage).toBe(false)
  })

  it('still checks the same text typed as a literal url', () => {
    const onValidationChange = vi.fn()
    renderCell({
      parameter: URL_FIELD,
      initial: '{{ base_url }}/health',
      extra: { availableVariables: BASE_URL, onValidationChange },
    })

    expect(screen.getByTestId('param-error-url')).toHaveTextContent(exactly(URL_MESSAGE))
    expect(onValidationChange).toHaveBeenLastCalledWith('url', URL_MESSAGE)
  })

  it('marks no declared variable inside {{ }} of a Template url, as the {x} face reads it', () => {
    renderCell({
      parameter: URL_FIELD,
      initial: '{{ base_url }}/health',
      modes: { template: true },
      extra: { availableVariables: BASE_URL },
    })
    expect(screen.getByTestId('param-input-url').querySelector('.cm-unknown-variable')).toBeNull()
  })

  it('marks a name inside {{ }} that no variable declares', () => {
    renderCell({ parameter: URL_FIELD, initial: '{{ host }}/health', modes: { template: true }, extra: { availableVariables: BASE_URL } })
    expect(screen.getByTestId('param-input-url').querySelector('.cm-unknown-variable')).toHaveTextContent(exactly('host'))
  })
})
