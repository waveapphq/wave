// The window's value field: one field per type, kind and state (VMGR-110, VMGR-111, VMGR-113, REQ-3.1.3.14, REQ-3.1.3.19).

import { useState, type ComponentProps } from 'react'
import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const sheet = vi.hoisted(() => ({
  props: [] as Array<Record<string, unknown>>,
  save: { value: undefined as unknown, elementTypes: undefined as unknown },
}))

interface SheetStubProps {
  type: string
  value: unknown
  isTemplate: boolean
  allowTemplate?: boolean
  itemType?: string
  elementTypes?: unknown
  onSave: (value: unknown, isTemplate: boolean, exprKeys: string[], elementTypes: unknown) => void
  onClose: () => void
}

// The larger editor is a real floating sheet whose body only records what it was opened with.
vi.mock('@/features/workbench/common/variables/variable-inspect-modal/value-editor-sheet', async () => {
  const { DraggableSheet } = await vi.importActual<typeof import('@/components/shared/draggable-sheet')>(
    '@/components/shared/draggable-sheet',
  )
  function ValueEditorSheetStub(props: Readonly<SheetStubProps>) {
    sheet.props.push({ ...props })
    return (
      <DraggableSheet
        open
        onClose={props.onClose}
        ariaLabel="Edit value"
        data-testid="value-editor-sheet"
        header={<span>Edit value</span>}
      >
        <button
          type="button"
          onClick={() => props.onSave(sheet.save.value, false, [], sheet.save.elementTypes)}
        >
          Save value
        </button>
        <button type="button" onClick={props.onClose}>
          Close value editor
        </button>
      </DraggableSheet>
    )
  }
  return { ValueEditorSheet: ValueEditorSheetStub }
})

// The expression box is CodeMirror; a plain input keeps its change and blur wiring testable.
vi.mock('@/features/workbench/common/element-config/expressions/expression-field', async () => {
  const { useCanvasReadOnly } = await vi.importActual<
    typeof import('@/features/workbench/common/canvas/read-only-context')
  >('@/features/workbench/common/canvas/read-only-context')
  function ExpressionFieldStub({
    value,
    onChange,
    onBlur,
    availableVariables,
    template,
  }: {
    value: string
    onChange: (value: string) => void
    onBlur?: () => void
    availableVariables?: Array<{ name: string }>
    template?: boolean
  }) {
    return (
      <input
        data-testid="expression-field"
        aria-label="Expression"
        data-variables={(availableVariables ?? []).map((variable) => variable.name).join(',')}
        data-template={template === true ? 'true' : 'false'}
        readOnly={useCanvasReadOnly()}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onBlur={onBlur}
      />
    )
  }
  return { ExpressionField: ExpressionFieldStub }
})

import { WindowValueField } from '@/features/workbench/common/variables/variable-inspect-modal/window-value-field'
import type { AvailableVariable } from '@/features/workbench/common/element-config/expressions/expression-field'
import { describeJsonError } from '@/lib/codemirror/json-data-editor'
import { MASK_PLACEHOLDER } from '@/lib/secret-envelope'
import { NULL_LOOK_CLASS } from '@/lib/variable-format'

type FieldProps = ComponentProps<typeof WindowValueField>
type HarnessProps = Partial<FieldProps>

const NO_VARIABLES: AvailableVariable[] = []
const NOOP = () => {}
const OPEN_EDITOR = 'Open editor'

const TYPED_COLUMNS = [
  { name: 'host', type: 'string' },
  { name: 'port', type: 'integer' },
]
const TYPED_TABLE = {
  columns: TYPED_COLUMNS,
  rows: [
    ['db-1', '5432'],
    ['db-2', '5433'],
  ],
}
const TYPED_TABLE_TEXT = '[{"host": "db-1", "port": 5432}, {"host": "db-2", "port": 5433}]'

const ALL_TYPES = ['string', 'integer', 'float', 'boolean', 'array', 'map', 'table'] as const

// Holds the value the way the window does, so the field sees its own changes come back.
function ControlledField({
  value: initialValue,
  elementTypes: initialTypes,
  onChange,
  ...rest
}: Readonly<HarnessProps>) {
  const [value, setValue] = useState<unknown>(initialValue)
  const [elementTypes, setElementTypes] = useState(initialTypes)
  return (
    <WindowValueField
      type="string"
      kind="literal"
      nullState="off"
      secret="none"
      name="v"
      availableVariables={NO_VARIABLES}
      onValidation={NOOP}
      {...rest}
      value={value}
      elementTypes={elementTypes}
      onChange={(next, nextTypes) => {
        setValue(next)
        setElementTypes(nextTypes)
        onChange?.(next, nextTypes)
      }}
    />
  )
}

function renderField(props: HarnessProps = {}) {
  const spies = {
    onChange: vi.fn(),
    onValidation: vi.fn(),
    onEmptyBlur: vi.fn(),
    onExpressionBlur: vi.fn(),
    onEditSecret: vi.fn(),
  }
  render(<ControlledField {...spies} {...props} onChange={spies.onChange} />)
  return spies
}

const field = () => screen.getByTestId('window-value-field')
const textInput = () => within(field()).getByRole('textbox')
const numberBox = () => within(field()).getByTestId('scalar-edit-input')
const openEditor = () => screen.queryByRole('button', { name: OPEN_EDITOR })
const lastProblems = (spy: Mock) => spy.mock.lastCall?.[0]
const typeText = (text: string) => fireEvent.change(textInput(), { target: { value: text } })
const lastSheetProps = () => sheet.props.at(-1)

function jsonSyntaxMessage(text: string): string {
  try {
    JSON.parse(text)
  } catch (error) {
    return describeJsonError(text, error)
  }
  throw new Error(`${text} is valid JSON`)
}

beforeEach(() => {
  sheet.props = []
  sheet.save = { value: undefined, elementTypes: undefined }
})

describe('WindowValueField - one-line text (VMGR-110)', () => {
  it('shows a string as one-line text holding the whole value, cut with an ellipsis', () => {
    const long = 'a value long enough to run past the right edge of the window field'
    renderField({ type: 'string', value: long })
    expect(textInput()).toHaveValue(long)
    expect(textInput()).toHaveClass('truncate')
    expect(textInput()).not.toHaveAttribute('readonly')
  })

  it('types a string into the field', async () => {
    const user = userEvent.setup()
    const { onChange } = renderField({ type: 'string', value: '' })
    await user.type(textInput(), 'hello')
    expect(onChange.mock.lastCall?.[0]).toBe('hello')
  })

  it('keeps the format and view pickers out of the field', () => {
    renderField({ type: 'string', value: '{"a": 1}' })
    expect(within(field()).queryByRole('combobox')).not.toBeInTheDocument()
    expect(screen.queryByTestId('format-dropdown')).not.toBeInTheDocument()
    expect(screen.queryByTestId('view-dropdown')).not.toBeInTheDocument()
  })

  it('shows the first line of a string with a line break, cut with "…", read-only', () => {
    renderField({ type: 'string', value: 'first line\nsecond line' })
    expect(textInput()).toHaveValue('first line…')
    expect(textInput()).toHaveAttribute('readonly')
  })

  it('exposes the full text of a string with a line break as the field title', () => {
    renderField({ type: 'string', value: 'first line\nsecond line' })
    expect(textInput()).toHaveAttribute('title', 'first line\nsecond line')
  })

  it('never types into a string with a line break', async () => {
    const user = userEvent.setup()
    const { onChange } = renderField({ type: 'string', value: 'first line\nsecond line' })
    await user.type(textInput(), 'x')
    expect(onChange).not.toHaveBeenCalled()
    expect(textInput()).toHaveValue('first line…')
  })

  it('keeps the Open editor button on a string with a line break', () => {
    renderField({ type: 'string', value: 'first line\nsecond line' })
    expect(openEditor()).toBeInTheDocument()
  })
})

describe('WindowValueField - number box (REQ-3.1.3.14)', () => {
  it.each([
    ['integer', '1234567890123456789'],
    ['float', '0.1000000000000000000000000001'],
  ] as const)('shows %s digits exactly in the number box', (type, digits) => {
    renderField({ type, value: digits })
    expect(numberBox()).toHaveValue(digits)
    expect(openEditor()).not.toBeInTheDocument()
  })

  it.each(['integer', 'float'] as const)('types into the %s box and reports no problem', (type) => {
    const { onChange, onValidation } = renderField({ type, value: '0' })
    fireEvent.change(numberBox(), { target: { value: '42' } })
    expect(onChange.mock.lastCall?.[0]).toBe('42')
    expect(lastProblems(onValidation)).toEqual([])
  })

  it.each([
    ['integer', '-1234567890123456789'],
    ['float', '-0.1231231231232131231231231231'],
  ] as const)('keeps every typed %s digit', (type, digits) => {
    const { onChange, onValidation } = renderField({ type, value: '0' })
    fireEvent.change(numberBox(), { target: { value: digits } })
    expect(onChange.mock.lastCall?.[0]).toBe(digits)
    expect(numberBox()).toHaveValue(digits)
    expect(lastProblems(onValidation)).toEqual([])
  })

  it.each(['integer', 'float'] as const)(
    'refuses unfinished %s text with "Enter a valid <type> value"',
    (type) => {
      const { onValidation } = renderField({ type, value: '0' })
      fireEvent.change(numberBox(), { target: { value: '-' } })
      expect(lastProblems(onValidation)).toEqual([`Enter a valid ${type} value`])
    },
  )

  it('clears the problem once the number is finished', () => {
    const { onValidation } = renderField({ type: 'integer', value: '0' })
    fireEvent.change(numberBox(), { target: { value: '-' } })
    fireEvent.change(numberBox(), { target: { value: '-7' } })
    expect(lastProblems(onValidation)).toEqual([])
  })

  it('an emptied box ticks Set to null when it loses focus where Set to null is free', () => {
    const { onEmptyBlur } = renderField({ type: 'integer', value: '5', nullState: 'off' })
    fireEvent.change(numberBox(), { target: { value: '' } })
    fireEvent.blur(numberBox())
    expect(onEmptyBlur).toHaveBeenCalledTimes(1)
  })

  it('a box that still holds a number never ticks Set to null on blur', () => {
    const { onEmptyBlur } = renderField({ type: 'integer', value: '5', nullState: 'off' })
    fireEvent.blur(numberBox())
    expect(onEmptyBlur).not.toHaveBeenCalled()
  })

  it.each(['integer', 'float'] as const)(
    'an emptied %s box blocks with "Enter a valid <type> value" where Set to null is locked off',
    (type) => {
      const { onValidation, onEmptyBlur } = renderField({ type, value: '5', nullState: 'locked-off' })
      fireEvent.change(numberBox(), { target: { value: '' } })
      fireEvent.blur(numberBox())
      expect(lastProblems(onValidation)).toEqual([`Enter a valid ${type} value`])
      expect(onEmptyBlur).not.toHaveBeenCalled()
      expect(numberBox()).toHaveValue('')
    },
  )

  it('an emptied box on a Required input default means no default', () => {
    const { onChange, onValidation, onEmptyBlur } = renderField({
      type: 'integer',
      value: '5',
      nullState: 'locked-off',
      blank: 'unset',
    })
    fireEvent.change(numberBox(), { target: { value: '' } })
    fireEvent.blur(numberBox())
    expect(onChange.mock.lastCall?.[0]).toBe('')
    expect(lastProblems(onValidation)).toEqual([])
    expect(onEmptyBlur).not.toHaveBeenCalled()
    expect(numberBox()).toHaveValue('')
  })
})

describe('WindowValueField - true / false', () => {
  it('shows true / false as a segmented control with the value picked', () => {
    renderField({ type: 'boolean', value: true })
    expect(screen.getByRole('button', { name: 'true' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'false' })).toHaveAttribute('aria-pressed', 'false')
    expect(openEditor()).not.toBeInTheDocument()
  })

  it('picks a side on click', async () => {
    const user = userEvent.setup()
    const { onChange } = renderField({ type: 'boolean', value: true })
    await user.click(screen.getByRole('button', { name: 'false' }))
    expect(onChange.mock.lastCall?.[0]).toBe(false)
    expect(screen.getByRole('button', { name: 'false' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('a Required true / false input always has one side picked, even with no default', async () => {
    const user = userEvent.setup()
    const { onChange } = renderField({
      type: 'boolean',
      value: undefined,
      nullState: 'locked-off',
      blank: 'unset',
    })
    expect(screen.getByRole('button', { name: 'false' })).toHaveAttribute('aria-pressed', 'true')
    await user.click(screen.getByRole('button', { name: 'false' }))
    expect(onChange.mock.lastCall?.[0]).toBe(false)
    expect(screen.getByRole('button', { name: 'false' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'true' })).toHaveAttribute('aria-pressed', 'false')
  })
})

describe('WindowValueField - list text (VMGR-110)', () => {
  it('writes a list out as one-line JSON, cut with an ellipsis', () => {
    renderField({ type: 'array', value: [1, 2, 3] })
    expect(textInput()).toHaveValue('[1, 2, 3]')
    expect(textInput()).toHaveClass('truncate')
  })

  it.each([
    ['array', '[]', []],
    ['map', '{}', {}],
    ['table', '[]', []],
  ] as const)('writes an empty %s as %s', (type, text, value) => {
    renderField({ type, value })
    expect(textInput()).toHaveValue(text)
  })

  it('keeps exact digits and element types in the list text (REQ-3.1.3.14, REQ-3.1.3.19)', () => {
    renderField({
      type: 'array',
      value: ['02134', '1234567890123456789', '0.1000000000000000000000000001'],
      elementTypes: ['string', 'integer', 'float'],
    })
    expect(textInput()).toHaveValue('["02134", 1234567890123456789, 0.1000000000000000000000000001]')
  })

  it('parses typed list text into the value and its element types', () => {
    const { onChange, onValidation } = renderField({ type: 'array', value: [] })
    typeText('["02134", 7, 0.1000000000000000000000000001]')
    expect(onChange).toHaveBeenLastCalledWith(
      ['02134', '7', '0.1000000000000000000000000001'],
      ['string', 'integer', 'float'],
    )
    expect(lastProblems(onValidation)).toEqual([])
  })

  it('keeps the text as typed while the value follows it', () => {
    renderField({ type: 'array', value: [] })
    typeText('[1,2]')
    expect(textInput()).toHaveValue('[1,2]')
  })

  it('shows a value set from outside the field', () => {
    const props = {
      type: 'array' as const,
      kind: 'literal' as const,
      nullState: 'off' as const,
      secret: 'none' as const,
      name: 'v',
      availableVariables: NO_VARIABLES,
      onChange: NOOP,
      onValidation: NOOP,
    }
    const { rerender } = render(<WindowValueField {...props} value={[1]} />)
    rerender(<WindowValueField {...props} value={[5, 6]} />)
    expect(textInput()).toHaveValue('[5, 6]')
  })

  it.each(['{"a": 1}', 'null'])('refuses %s as list text with "Must be a JSON array"', (text) => {
    const { onValidation } = renderField({ type: 'array', value: [] })
    typeText(text)
    expect(lastProblems(onValidation)).toEqual(['Must be a JSON array'])
  })

  it('refuses list text that is not JSON with the shared syntax message', () => {
    const { onValidation } = renderField({ type: 'array', value: [] })
    typeText('[1, 2')
    expect(lastProblems(onValidation)).toEqual([jsonSyntaxMessage('[1, 2')])
  })

  it('clears the problem once the list text is fixed', () => {
    const { onValidation } = renderField({ type: 'array', value: [] })
    typeText('[1, 2')
    typeText('[1, 2]')
    expect(lastProblems(onValidation)).toEqual([])
  })

  it('reads numbers in a typed list as its item type and stores no element types', () => {
    const { onChange } = renderField({ type: 'array', value: [], itemType: 'integer' })
    typeText('[3, 4]')
    expect(onChange.mock.lastCall?.[0]).toEqual([3, 4])
    expect(onChange.mock.lastCall?.[1]).toBeUndefined()
  })
})

describe('WindowValueField - map text (VMGR-110)', () => {
  it('writes a map out as one-line JSON by its element types', () => {
    renderField({
      type: 'map',
      value: { host: 'db.internal', port: '5432' },
      elementTypes: { host: 'string', port: 'integer' },
    })
    expect(textInput()).toHaveValue('{"host": "db.internal", "port": 5432}')
    expect(textInput()).toHaveClass('truncate')
  })

  it('parses typed map text into the value and its element types', () => {
    const { onChange, onValidation } = renderField({ type: 'map', value: {} })
    typeText('{"retries": 3, "name": "x"}')
    expect(onChange).toHaveBeenLastCalledWith(
      { retries: '3', name: 'x' },
      { retries: 'integer', name: 'string' },
    )
    expect(lastProblems(onValidation)).toEqual([])
  })

  it.each(['[1]', 'null'])('refuses %s as map text with "Must be a JSON object"', (text) => {
    const { onValidation } = renderField({ type: 'map', value: {} })
    typeText(text)
    expect(lastProblems(onValidation)).toEqual(['Must be a JSON object'])
  })

  it('refuses a key written twice with "Duplicate key"', () => {
    const { onValidation } = renderField({ type: 'map', value: {} })
    typeText('{"a": 1, "a": 2}')
    expect(lastProblems(onValidation)).toEqual(['Duplicate key "a"'])
  })

  it('refuses map text that is not JSON with the shared syntax message', () => {
    const { onValidation } = renderField({ type: 'map', value: {} })
    typeText('{"a": ')
    expect(lastProblems(onValidation)).toEqual([jsonSyntaxMessage('{"a": ')])
  })
})

describe('WindowValueField - table text (VMGR-70, VMGR-71, REQ-3.5.5.1)', () => {
  it('writes a table out as one-line JSON of its rows, cut with an ellipsis', () => {
    renderField({ type: 'table', value: TYPED_TABLE })
    expect(textInput()).toHaveValue(TYPED_TABLE_TEXT)
    expect(textInput()).toHaveClass('truncate')
  })

  it('writes a table held as a plain list of rows out as one-line JSON', () => {
    renderField({ type: 'table', value: [{ host: 'db-1', port: 5432 }] })
    expect(textInput()).toHaveValue('[{"host": "db-1", "port": 5432}]')
  })

  it('saves typed rows with the column types', () => {
    const { onChange, onValidation } = renderField({ type: 'table', value: TYPED_TABLE })
    typeText('[{"host": "db-3", "port": 6543}]')
    expect(onChange.mock.lastCall?.[0]).toEqual({ columns: TYPED_COLUMNS, rows: [['db-3', '6543']] })
    expect(lastProblems(onValidation)).toEqual([])
  })

  it('refuses a column the table does not have', () => {
    const { onValidation } = renderField({ type: 'table', value: TYPED_TABLE })
    typeText('[{"host": "db-1", "port": 5432, "extra": 1}]')
    expect(lastProblems(onValidation)).toEqual([
      'Unexpected column "extra" - change columns in the Visual view',
    ])
  })

  it('refuses a row that drops a column', () => {
    const { onValidation } = renderField({ type: 'table', value: TYPED_TABLE })
    typeText('[{"host": "db-1"}]')
    expect(lastProblems(onValidation)).toEqual([
      'Missing column "port" - change columns in the Visual view',
    ])
  })

  it('refuses a cell outside its column type with the shared table message', () => {
    const { onValidation } = renderField({ type: 'table', value: TYPED_TABLE })
    typeText('[{"host": "db-1", "port": "x"}]')
    expect(lastProblems(onValidation)).toEqual(['Row 0 "port": expected integer'])
  })

  it('reports every table problem, columns before cells', () => {
    const { onValidation } = renderField({ type: 'table', value: TYPED_TABLE })
    typeText('[{"host": "db-1", "port": "x", "extra": 1}]')
    expect(lastProblems(onValidation)).toEqual([
      'Unexpected column "extra" - change columns in the Visual view',
      'Row 0 "port": expected integer',
    ])
  })

  it.each(['{"a": 1}', 'null', '[1, 2]'])(
    'refuses %s as table text with "Table must be a list of rows"',
    (text) => {
      const { onValidation } = renderField({ type: 'table', value: TYPED_TABLE })
      typeText(text)
      expect(lastProblems(onValidation)).toEqual(['Table must be a list of rows'])
    },
  )

  it('refuses table text that is not JSON with the shared syntax message', () => {
    const { onValidation } = renderField({ type: 'table', value: TYPED_TABLE })
    typeText('[{')
    expect(lastProblems(onValidation)).toEqual([jsonSyntaxMessage('[{')])
  })

  it('clearing the rows keeps the columns', () => {
    const { onChange, onValidation } = renderField({ type: 'table', value: TYPED_TABLE })
    typeText('[]')
    expect(onChange.mock.lastCall?.[0]).toEqual({ columns: TYPED_COLUMNS, rows: [] })
    expect(lastProblems(onValidation)).toEqual([])
  })

  it('a table with columns and no rows keeps its columns for new rows', () => {
    const { onChange } = renderField({ type: 'table', value: { columns: TYPED_COLUMNS, rows: [] } })
    expect(textInput()).toHaveValue('[]')
    typeText('[{"host": "db-1", "port": 1}]')
    expect(onChange.mock.lastCall?.[0]).toEqual({ columns: TYPED_COLUMNS, rows: [['db-1', '1']] })
  })

  it('a table with columns and no rows still refuses a new column', () => {
    const { onValidation } = renderField({ type: 'table', value: { columns: TYPED_COLUMNS, rows: [] } })
    typeText('[{"host": "db-1", "port": 1, "extra": 2}]')
    expect(lastProblems(onValidation)).toEqual([
      'Unexpected column "extra" - change columns in the Visual view',
    ])
  })

  it('takes the columns of a table with none from the first typed rows, typed by their values', () => {
    const { onChange, onValidation } = renderField({ type: 'table', value: [] })
    typeText('[{"zip": "02134", "n": 7, "rate": 1.5, "ok": true}]')
    expect(onChange.mock.lastCall?.[0]).toEqual({
      columns: [
        { name: 'zip', type: 'string' },
        { name: 'n', type: 'integer' },
        { name: 'rate', type: 'float' },
        { name: 'ok', type: 'boolean' },
      ],
      rows: [['02134', '7', '1.5', true]],
    })
    expect(lastProblems(onValidation)).toEqual([])
  })

  it('lets the first typed rows keep defining the columns while they are typed', () => {
    const { onChange, onValidation } = renderField({ type: 'table', value: [] })
    typeText('[{"zip": "02134"}]')
    typeText('[{"zip": "02134", "n": 7}]')
    expect(onChange.mock.lastCall?.[0]).toEqual({
      columns: [
        { name: 'zip', type: 'string' },
        { name: 'n', type: 'integer' },
      ],
      rows: [['02134', '7']],
    })
    expect(lastProblems(onValidation)).toEqual([])
  })

  it('refuses a later typed row that differs from the first one', () => {
    const { onValidation } = renderField({ type: 'table', value: [] })
    typeText('[{"a": 1}, {"b": 2}]')
    expect(lastProblems(onValidation)).toEqual([
      'Unexpected column "b" - change columns in the Visual view',
      'Missing column "a" - change columns in the Visual view',
    ])
  })
})

describe('WindowValueField - a Required input with no default (VMGR-113)', () => {
  it.each(['string', 'array', 'map', 'table'] as const)(
    'shows an empty %s field with no placeholder text and keeps Open editor',
    (type) => {
      renderField({ type, value: undefined, nullState: 'locked-off', blank: 'unset' })
      expect(textInput()).toHaveValue('')
      expect((textInput() as HTMLInputElement).placeholder).toBe('')
      expect(openEditor()).toBeInTheDocument()
    },
  )

  it.each(['integer', 'float'] as const)('shows an empty %s box with no placeholder text', (type) => {
    renderField({ type, value: undefined, nullState: 'locked-off', blank: 'unset' })
    expect(numberBox()).toHaveValue('')
    expect((numberBox() as HTMLInputElement).placeholder).toBe('')
  })

  it('clearing list text on a Required input default reports no problem', () => {
    const { onChange, onValidation } = renderField({
      type: 'array',
      value: [1],
      nullState: 'locked-off',
      blank: 'unset',
    })
    typeText('')
    expect(onChange.mock.lastCall?.[0]).toBe('')
    expect(lastProblems(onValidation)).toEqual([])
  })

  it('clearing list text anywhere else is refused with the shared syntax message', () => {
    const { onValidation } = renderField({ type: 'array', value: [1], nullState: 'locked-off' })
    typeText('')
    expect(lastProblems(onValidation)).toEqual([jsonSyntaxMessage('')])
  })
})

describe('WindowValueField - Set to null (VMGR-111)', () => {
  it.each(ALL_TYPES)('a ticked Set to null shows one grayed italic null field for the %s type', (type) => {
    renderField({ type, value: null, nullState: 'ticked' })
    expect(within(field()).getByText('null')).toHaveClass(...NULL_LOOK_CLASS.split(' '))
    expect(within(field()).queryByRole('textbox')).not.toBeInTheDocument()
    expect(within(field()).queryByRole('group')).not.toBeInTheDocument()
  })

  it('a ticked Set to null wins over a masked secret', () => {
    renderField({ type: 'string', value: null, nullState: 'ticked', secret: 'masked' })
    expect(within(field()).getByText('null')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Edit protected value$/ })).not.toBeInTheDocument()
  })
})

describe('WindowValueField - secret value', () => {
  it.each(['string', 'integer', 'boolean', 'array', 'table'] as const)(
    'masks a saved %s secret with the pencil control and no Open editor',
    (type) => {
      renderField({ type, value: MASK_PLACEHOLDER, secret: 'masked' })
      expect(screen.getByRole('button', { name: /Edit protected value$/ })).toBeInTheDocument()
      expect(within(field()).queryByRole('textbox')).not.toBeInTheDocument()
      expect(screen.queryByDisplayValue(MASK_PLACEHOLDER)).not.toBeInTheDocument()
      expect(openEditor()).not.toBeInTheDocument()
    },
  )

  it('asks the host to clear a masked secret from its pencil', async () => {
    const user = userEvent.setup()
    const { onEditSecret } = renderField({ type: 'string', value: MASK_PLACEHOLDER, secret: 'masked' })
    await user.click(screen.getByRole('button', { name: /Edit protected value$/ }))
    expect(onEditSecret).toHaveBeenCalledTimes(1)
  })

  it('a cleared secret takes a new value in the empty type face', async () => {
    const user = userEvent.setup()
    const { onChange } = renderField({ type: 'string', value: '', secret: 'write-only' })
    expect(textInput()).toHaveValue('')
    await user.type(textInput(), 'new')
    expect(onChange.mock.lastCall?.[0]).toBe('new')
    expect(openEditor()).toBeInTheDocument()
  })

  it('a cleared number secret takes a new value in an empty number box', () => {
    const { onChange } = renderField({ type: 'integer', value: '', secret: 'write-only' })
    expect(numberBox()).toHaveValue('')
    fireEvent.change(numberBox(), { target: { value: '9' } })
    expect(onChange.mock.lastCall?.[0]).toBe('9')
  })
})

describe('WindowValueField - expression and template (VMGR-74)', () => {
  it.each(ALL_TYPES)('an expression of type %s is the expression box with no Open editor', (type) => {
    renderField({ type, kind: 'expression', value: 'n_int * 2' })
    expect(screen.getByTestId('expression-field')).toHaveValue('n_int * 2')
    expect(within(field()).queryByTestId('scalar-edit-input')).not.toBeInTheDocument()
    expect(openEditor()).not.toBeInTheDocument()
  })

  it('types an expression and checks it when the box loses focus', () => {
    const { onChange, onExpressionBlur } = renderField({ type: 'integer', kind: 'expression', value: '' })
    fireEvent.change(screen.getByTestId('expression-field'), { target: { value: 'x + 1' } })
    expect(onChange.mock.lastCall?.[0]).toBe('x + 1')
    fireEvent.blur(screen.getByTestId('expression-field'))
    expect(onExpressionBlur).toHaveBeenCalledTimes(1)
  })

  it('a Template string is its source field, typable, with no Open editor', () => {
    const { onChange } = renderField({ type: 'string', kind: 'template', value: 'Hi {{ name }}' })
    expect(screen.getByTestId('expression-field')).toHaveValue('Hi {{ name }}')
    fireEvent.change(screen.getByTestId('expression-field'), { target: { value: 'Bye {{ name }}' } })
    expect(onChange.mock.lastCall?.[0]).toBe('Bye {{ name }}')
    expect(openEditor()).not.toBeInTheDocument()
  })

  it.each([
    ['template', 'true'],
    ['expression', 'false'],
  ] as const)('runs the %s box in template mode: %s', (kind, templateMode) => {
    renderField({ type: 'string', kind, value: 'Hi {{ name }}' })
    expect(screen.getByTestId('expression-field')).toHaveAttribute('data-template', templateMode)
  })

  it.each(['expression', 'template'] as const)('offers the in-scope variables to the %s box', (kind) => {
    const inScope: AvailableVariable[] = [
      { name: 'base', type: 'integer' },
      { name: 'label', type: 'string' },
    ]
    renderField({ type: 'string', kind, value: '', availableVariables: inScope })
    expect(screen.getByTestId('expression-field')).toHaveAttribute('data-variables', 'base,label')
  })
})

describe('WindowValueField - Open editor (VMGR-110)', () => {
  it.each([
    ['string', 'hello'],
    ['array', [1]],
    ['map', { a: 'x' }],
    ['table', TYPED_TABLE],
  ] as const)('shows the Open editor button for a Literal of type %s', (type, value) => {
    renderField({ type, value })
    expect(screen.getByTestId('open-value-editor-button')).toBe(openEditor())
  })

  it.each([
    ['integer', '1', () => numberBox()],
    ['float', '1.5', () => numberBox()],
    ['boolean', true, () => within(field()).getByRole('button', { name: 'true' })],
  ] as const)('shows no Open editor button for the %s type', (type, value, face) => {
    renderField({ type, value })
    expect(face()).toBeInTheDocument()
    expect(openEditor()).not.toBeInTheDocument()
  })

  it('carries the tooltip "Open editor"', async () => {
    const user = userEvent.setup()
    renderField({ type: 'string', value: 'hello' })
    await user.click(textInput())
    await user.tab()
    expect(openEditor()).toHaveFocus()
    expect(await screen.findByRole('tooltip')).toHaveTextContent(/^Open editor$/)
  })

  it.each([
    ['string', 'hello'],
    ['array', [1]],
    ['map', { a: 'x' }],
    ['table', TYPED_TABLE],
  ] as const)('opens the "Edit value" window for the %s type as a Literal', async (type, value) => {
    const user = userEvent.setup()
    renderField({ type, value })
    await user.click(openEditor() as HTMLElement)
    expect(await screen.findByTestId('value-editor-sheet')).toBeInTheDocument()
    expect(lastSheetProps()).toMatchObject({ type, value, isTemplate: false, allowTemplate: false })
  })

  it('opens the larger editor on the whole text of a string with a line break', async () => {
    const user = userEvent.setup()
    renderField({ type: 'string', value: 'first line\nsecond line' })
    await user.click(openEditor() as HTMLElement)
    await screen.findByTestId('value-editor-sheet')
    expect(lastSheetProps()).toMatchObject({ type: 'string', value: 'first line\nsecond line' })
  })

  it('hands the element types of a list to the larger editor', async () => {
    const user = userEvent.setup()
    renderField({ type: 'array', value: ['02134'], elementTypes: ['string'] })
    await user.click(openEditor() as HTMLElement)
    await screen.findByTestId('value-editor-sheet')
    expect(lastSheetProps()).toMatchObject({ elementTypes: ['string'] })
  })

  it('types the larger editor of a typed list by its item type', async () => {
    const user = userEvent.setup()
    renderField({ type: 'array', value: [1, 2], itemType: 'integer' })
    await user.click(openEditor() as HTMLElement)
    await screen.findByTestId('value-editor-sheet')
    expect(lastSheetProps()).toMatchObject({ type: 'array', itemType: 'integer' })
  })

  it('applies a list saved by the larger editor to the field', async () => {
    const user = userEvent.setup()
    const { onChange } = renderField({ type: 'array', value: [] })
    await user.click(openEditor() as HTMLElement)
    sheet.save = { value: ['1', '2'], elementTypes: ['integer', 'integer'] }
    await user.click(await screen.findByRole('button', { name: 'Save value' }))
    expect(onChange).toHaveBeenLastCalledWith(['1', '2'], ['integer', 'integer'])
    expect(textInput()).toHaveValue('[1, 2]')
  })

  it('shows a table saved by the larger editor as its rows', async () => {
    const user = userEvent.setup()
    const { onChange } = renderField({ type: 'table', value: [] })
    await user.click(openEditor() as HTMLElement)
    sheet.save = { value: TYPED_TABLE, elementTypes: undefined }
    await user.click(await screen.findByRole('button', { name: 'Save value' }))
    expect(onChange.mock.lastCall?.[0]).toEqual(TYPED_TABLE)
    expect(textInput()).toHaveValue(TYPED_TABLE_TEXT)
  })

  it('a string saved with a line break by the larger editor turns read-only in the field', async () => {
    const user = userEvent.setup()
    renderField({ type: 'string', value: 'one' })
    await user.click(openEditor() as HTMLElement)
    sheet.save = { value: 'one\ntwo', elementTypes: undefined }
    await user.click(await screen.findByRole('button', { name: 'Save value' }))
    expect(textInput()).toHaveValue('one…')
    expect(textInput()).toHaveAttribute('readonly')
  })

  it.each([
    ['Enter', '{Enter}'],
    ['Space', ' '],
  ])('opens the larger editor from the keyboard with %s', async (_key, keys) => {
    const user = userEvent.setup()
    renderField({ type: 'array', value: [1] })
    act(() => (openEditor() as HTMLElement).focus())
    await user.keyboard(keys)
    expect(await screen.findByTestId('value-editor-sheet')).toBeInTheDocument()
  })

  it('returns focus to the button when the larger editor closes', async () => {
    const user = userEvent.setup()
    renderField({ type: 'map', value: { a: 'x' } })
    await user.click(openEditor() as HTMLElement)
    await user.click(await screen.findByRole('button', { name: 'Close value editor' }))
    await waitFor(() => expect(screen.queryByTestId('value-editor-sheet')).not.toBeInTheDocument())
    expect(openEditor()).toHaveFocus()
  })

  it('Escape closes the larger editor and leaves focus on the button', async () => {
    const user = userEvent.setup()
    renderField({ type: 'table', value: TYPED_TABLE })
    act(() => (openEditor() as HTMLElement).focus())
    await user.keyboard('{Enter}')
    await screen.findByTestId('value-editor-sheet')
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByTestId('value-editor-sheet')).not.toBeInTheDocument())
    expect(openEditor()).toHaveFocus()
  })
})

describe('WindowValueField - more list and map text (REQ-3.1.3.19)', () => {
  it('keeps a quoted item of a typed list as written', () => {
    const { onChange, onValidation } = renderField({ type: 'array', value: [], itemType: 'integer' })
    typeText('[3, "x"]')
    expect(onChange.mock.lastCall?.[0]).toEqual([3, 'x'])
    expect(lastProblems(onValidation)).toEqual([])
  })

  it('takes a null map value as null, fitting any element type', () => {
    const { onChange, onValidation } = renderField({ type: 'map', value: {} })
    typeText('{"a": null, "n": 2}')
    expect(onChange).toHaveBeenLastCalledWith({ a: null, n: '2' }, { a: 'string', n: 'integer' })
    expect(lastProblems(onValidation)).toEqual([])
  })
})

describe('WindowValueField - a value set from outside (VMGR-108)', () => {
  const props = {
    kind: 'literal' as const,
    nullState: 'off' as const,
    secret: 'none' as const,
    name: 'v',
    availableVariables: NO_VARIABLES,
    onChange: NOOP,
  }

  it('drops the problem of the text it replaces', () => {
    const onValidation = vi.fn()
    const { rerender } = render(<WindowValueField {...props} type="array" value={[1]} onValidation={onValidation} />)
    typeText('[1, 2')
    expect(lastProblems(onValidation)).toEqual([jsonSyntaxMessage('[1, 2')])
    rerender(<WindowValueField {...props} type="array" value={[7]} onValidation={onValidation} />)
    expect(textInput()).toHaveValue('[7]')
    expect(lastProblems(onValidation)).toEqual([])
  })

  it('shows a number set from outside in the number box', () => {
    const { rerender } = render(<WindowValueField {...props} type="integer" value="5" onValidation={NOOP} />)
    rerender(<WindowValueField {...props} type="integer" value="7" onValidation={NOOP} />)
    expect(numberBox()).toHaveValue('7')
  })
})

describe('WindowValueField - the caption names and focuses the field (VMGR-110)', () => {
  function renderCaptioned(props: HarnessProps) {
    render(
      <>
        <label htmlFor="value-field-id">Value</label>
        <ControlledField id="value-field-id" onChange={vi.fn()} {...props} />
      </>,
    )
  }

  it('names the one-line text by the caption, and a click on the caption focuses it', async () => {
    const user = userEvent.setup()
    renderCaptioned({ type: 'array', value: [1] })
    await user.click(screen.getByText('Value'))
    expect(screen.getByRole('textbox', { name: 'Value' })).toHaveFocus()
  })

  it('names the number box by the caption, and a click on the caption focuses it', async () => {
    const user = userEvent.setup()
    renderCaptioned({ type: 'float', value: '1.5' })
    await user.click(screen.getByText('Value'))
    expect(screen.getByRole('textbox', { name: 'Value' })).toBe(numberBox())
    expect(numberBox()).toHaveFocus()
  })
})

describe("WindowValueField - a secret input's default held at null (VMGR-111)", () => {
  const REASON = 'A secret input has no default: the Function Block gives the value.'

  it('shows a read-only null field named by its caption that gives the reason below it', async () => {
    renderField({ type: 'string', value: null, nullState: 'ticked', nullReason: REASON, label: 'Default value' })
    const held = screen.getByRole('textbox', { name: 'Default value' })
    expect(held).toHaveValue('null')
    expect(held).toHaveAttribute('readonly')
    expect(held).toHaveAttribute('aria-disabled', 'true')
    act(() => held.focus())
    const tip = await screen.findByRole('tooltip')
    expect(tip).toHaveTextContent(/^A secret input has no default: the Function Block gives the value\.$/)
    expect(tip.closest('[data-slot="tooltip-content"]')).toHaveAttribute('data-side', 'bottom')
  })
})

// A null value keeps the Open editor button of a type with a full editor, drawn off, so the field never jumps.
describe('WindowValueField - the Open editor button of a null value', () => {
  it.each(['string', 'array', 'map', 'table'] as const)('keeps a null %s field Open editor button, disabled', async (type) => {
    const user = userEvent.setup()
    renderField({ type, value: null, nullState: 'ticked' })
    const button = screen.getByTestId('open-value-editor-button')
    expect(button).toHaveAccessibleName(OPEN_EDITOR)
    expect(button).toBeDisabled()
    await user.click(button)
    expect(screen.queryByTestId('value-editor-sheet')).not.toBeInTheDocument()
  })

  it.each(['integer', 'float', 'boolean'] as const)('gives a null %s field no Open editor button: it has no full editor', (type) => {
    renderField({ type, value: null, nullState: 'ticked' })
    expect(openEditor()).not.toBeInTheDocument()
  })

  it('gives a read-only null field no Open editor button, as a read-only value has none', () => {
    renderField({ type: 'array', value: null, nullState: 'ticked', readOnly: true })
    expect(openEditor()).not.toBeInTheDocument()
  })
})

describe('WindowValueField - an expression with no source yet', () => {
  it('shows an empty expression box', () => {
    renderField({ type: 'integer', kind: 'expression', value: undefined })
    expect(screen.getByTestId('expression-field')).toHaveValue('')
  })
})

describe('WindowValueField - an enum input (VMGR-112, REQ-3.1.2.11)', () => {
  const enumSelect = () => within(screen.getByTestId('enum-value-select')).getByRole('combobox')

  it('is a select of the allowed values named by its caption, the picked value in its type color', () => {
    renderField({ type: 'string', value: 'staging', enumValues: ['dev', 'staging', 'prod'], label: 'Value' })
    expect(screen.getByRole('combobox', { name: 'Value' })).toBe(enumSelect())
    expect(enumSelect()).toHaveTextContent(/^staging$/)
    expect(within(enumSelect()).getByText('staging')).toHaveClass('font-mono', 'text-sky-300')
    expect(openEditor()).not.toBeInTheDocument()
  })

  it('reads a pick back as the input type and leaves the empty select uncolored', async () => {
    const user = userEvent.setup()
    const { onChange, onValidation } = renderField({ type: 'integer', value: undefined, enumValues: [1, 2] })
    expect(within(enumSelect()).getByText('Select…')).not.toHaveClass('font-mono')
    await user.click(enumSelect())
    await user.click(await screen.findByRole('option', { name: '2' }))
    expect(onChange.mock.lastCall?.[0]).toBe(2)
    expect(lastProblems(onValidation)).toEqual([])
    expect(enumSelect()).toHaveTextContent(/^2$/)
  })

  it('outlines the select in red with the message under it, linked to the select', () => {
    renderField({
      type: 'string',
      value: undefined,
      enumValues: ['dev'],
      enumError: 'Default value is required',
    })
    expect(enumSelect()).toHaveAttribute('aria-invalid', 'true')
    const message = screen.getByTestId('create-enum-default-error')
    expect(message).toHaveTextContent(/^Default value is required$/)
    expect(enumSelect().getAttribute('aria-describedby')).toContain(message.id)
  })

  it('shows no message while a value is picked', () => {
    renderField({ type: 'string', value: 'dev', enumValues: ['dev'] })
    expect(enumSelect()).toHaveAttribute('aria-invalid', 'false')
    expect(screen.queryByTestId('create-enum-default-error')).not.toBeInTheDocument()
  })
})

describe('WindowValueField - the larger editor of a value not set yet', () => {
  it('opens on the type default of a Required input with no default', async () => {
    const user = userEvent.setup()
    renderField({ type: 'array', value: undefined, nullState: 'locked-off', blank: 'unset' })
    await user.click(openEditor() as HTMLElement)
    await screen.findByTestId('value-editor-sheet')
    expect(lastSheetProps()).toMatchObject({ type: 'array', value: [] })
  })

  it('names the larger editor after the caption', async () => {
    const user = userEvent.setup()
    renderField({ type: 'string', value: 'eu', label: 'Default value' })
    await user.click(openEditor() as HTMLElement)
    await screen.findByTestId('value-editor-sheet')
    expect(lastSheetProps()).toMatchObject({ label: 'Default value', name: 'v' })
  })
})

describe('WindowValueField - the Allowed values field (VMGR-112)', () => {
  it('carries the Allowed values test ids', () => {
    renderField({ type: 'array', value: ['dev'], itemType: 'string', field: 'allowed-values' })
    expect(within(screen.getByTestId('allowed-values-field')).getByRole('textbox')).toHaveValue('["dev"]')
    expect(screen.getByTestId('open-allowed-values-editor-button')).toBe(openEditor())
    expect(screen.queryByTestId('window-value-field')).not.toBeInTheDocument()
  })
})

describe('WindowValueField - a read-only value is shown, never changed (REQ-3.1.2.10)', () => {
  it.each([
    ['string', 'eu'],
    ['array', [1, 2]],
  ] as const)('shows a %s as read-only text with no Open editor', async (type, value) => {
    const user = userEvent.setup()
    const { onChange } = renderField({ type, value, readOnly: true })
    expect(textInput()).toHaveAttribute('readonly')
    await user.type(textInput(), 'x')
    expect(openEditor()).not.toBeInTheDocument()
    expect(onChange).not.toHaveBeenCalled()
  })

  it('shows a number in a read-only number box', () => {
    renderField({ type: 'integer', value: '7', readOnly: true })
    expect(numberBox()).toHaveAttribute('readonly')
    expect(numberBox()).toHaveValue('7')
  })

  it('shows true / false with both sides locked', () => {
    renderField({ type: 'boolean', value: true, readOnly: true })
    expect(within(field()).getByRole('group')).toBeDisabled()
  })

  it('shows the picked enum value in a locked select', () => {
    renderField({ type: 'string', value: 'staging', enumValues: ['dev', 'staging'], label: 'Value', readOnly: true })
    const select = screen.getByRole('combobox', { name: 'Value' })
    expect(select).toBeDisabled()
    expect(select).toHaveTextContent(/^staging$/)
  })

  it('shows an empty locked select when no enum value is picked', () => {
    renderField({ type: 'string', value: undefined, enumValues: ['dev'], label: 'Value', readOnly: true })
    const select = screen.getByRole('combobox', { name: 'Value' })
    expect(select).toBeDisabled()
    expect(select).toHaveTextContent(/^$/)
  })

  it('locks the pencil of a masked secret', () => {
    renderField({ type: 'string', value: MASK_PLACEHOLDER, secret: 'masked', readOnly: true })
    expect(screen.getByRole('button', { name: /Edit protected value$/ })).toBeDisabled()
  })

  it.each(['expression', 'template'] as const)('shows the %s source read-only', (kind) => {
    renderField({ type: 'string', kind, value: 'x', readOnly: true })
    expect(screen.getByTestId('expression-field')).toHaveAttribute('readonly')
  })

  it('keeps the source box editable when the value is not read-only', () => {
    renderField({ type: 'string', kind: 'expression', value: 'x' })
    expect(screen.getByTestId('expression-field')).not.toHaveAttribute('readonly')
  })
})

describe('WindowValueField - the caption is tied to an enum select (VMGR-110)', () => {
  it('ties the select to the caption by its id', () => {
    render(
      <>
        <label htmlFor="enum-field-id">Value</label>
        <ControlledField id="enum-field-id" type="string" value="dev" enumValues={['dev', 'prod']} />
      </>,
    )
    const select = within(screen.getByTestId('enum-value-select')).getByRole('combobox')
    expect(select).toHaveAttribute('id', 'enum-field-id')
    expect(screen.getByText('Value')).toHaveAttribute('for', 'enum-field-id')
  })
})

describe('WindowValueField - each input carries its form name', () => {
  const allowedText = () => within(screen.getByTestId('allowed-values-field')).getByRole('textbox')

  it.each([
    ['string', 'hello'],
    ['array', [1]],
    ['map', { a: 1 }],
  ] as const)('names the %s one-line text variable-value', (type, value) => {
    renderField({ type, value })
    expect(textInput()).toHaveAttribute('name', 'variable-value')
  })

  it.each(['integer', 'float'] as const)('names the %s number box variable-value', (type) => {
    renderField({ type, value: '7' })
    expect(numberBox()).toHaveAttribute('name', 'variable-value')
  })

  it('names the held null field variable-value', () => {
    renderField({ type: 'string', value: null, nullState: 'ticked', nullReason: 'Held.', label: 'Default value' })
    expect(screen.getByRole('textbox', { name: 'Default value' })).toHaveAttribute('name', 'variable-value')
  })

  it('names the Allowed values text allowed-values', () => {
    renderField({ type: 'array', value: ['dev'], itemType: 'string', field: 'allowed-values' })
    expect(allowedText()).toHaveAttribute('name', 'allowed-values')
  })
})

describe('WindowValueField - a refused text points at the message under it', () => {
  const allowedText = () => within(screen.getByTestId('allowed-values-field')).getByRole('textbox')

  it('marks the one-line text invalid and described by the message the host shows', () => {
    render(
      <>
        <ControlledField type="array" value={[]} itemType="string" field="allowed-values" errorId="allowed-error" />
        <p id="allowed-error">Enum allowed values cannot be empty</p>
      </>,
    )
    expect(allowedText()).toHaveAttribute('aria-invalid', 'true')
    expect(allowedText()).toHaveAccessibleDescription('Enum allowed values cannot be empty')
  })

  it('leaves a text with no message neither invalid nor described', () => {
    renderField({ type: 'array', value: ['dev'], itemType: 'string', field: 'allowed-values' })
    expect(allowedText()).not.toHaveAttribute('aria-invalid')
    expect(allowedText()).not.toHaveAttribute('aria-describedby')
  })
})

describe('WindowValueField - a stored value is checked as the window opens (FIELD-12)', () => {
  it.each([
    [
      'list item',
      { type: 'array', value: ['1', 'abc'], elementTypes: ['integer', 'integer'] },
      ['Index 1: expected integer'],
    ],
    [
      'map value',
      { type: 'map', value: { port: 'abc' }, elementTypes: { port: 'integer' } },
      ['Key "port": expected integer'],
    ],
    [
      'table cell',
      { type: 'table', value: { columns: TYPED_COLUMNS, rows: [['db-1', 'x']] } },
      ['Row 0 "port": expected integer'],
    ],
    ['number', { type: 'integer', value: 'abc' }, ['Enter a valid integer value']],
    ['integer past 19 digits', { type: 'integer', value: '12345678901234567890' }, ['Maximum 19 digits']],
    ['float past 28 significant digits', { type: 'float', value: `0.${'1'.repeat(29)}` }, ['Maximum 28 significant digits']],
    ['number in exponent text', { type: 'float', value: '1e-7' }, ['Enter a valid float value']],
  ] as Array<[string, HarnessProps, string[]]>)(
    'reports an invalid stored %s as soon as the field opens',
    (_label, props, problems) => {
      const { onValidation } = renderField(props)
      expect(onValidation).toHaveBeenCalledWith(problems)
      expect(lastProblems(onValidation)).toEqual(problems)
    },
  )
})

describe('WindowValueField - a stored null entry is no problem (REQ-3.1.3.20)', () => {
  it('opens a map whose typed value is null with no problem', () => {
    const { onValidation } = renderField({ type: 'map', value: { port: null }, elementTypes: { port: 'integer' } })
    expect(onValidation).not.toHaveBeenCalled()
  })
})

describe('WindowValueField - a stored JS number (REQ-3.1.3.14)', () => {
  it('opens a small float in plain digits with no problem', () => {
    const { onValidation } = renderField({ type: 'float', value: 0.0000001 })
    expect(onValidation).not.toHaveBeenCalled()
    expect(numberBox()).toHaveValue('0.0000001')
  })
})

describe('WindowValueField - one gray for null (REQ-3.1.3.20)', () => {
  it('draws a ticked Set to null in the Text Muted gray of the default', () => {
    renderField({ type: 'string', value: null, nullState: 'ticked' })
    const marker = within(field()).getByText('null')
    expect(marker).toHaveClass('text-[color:var(--color-text-muted)]', 'italic')
    expect(marker).not.toHaveClass('text-muted-foreground')
  })
})
