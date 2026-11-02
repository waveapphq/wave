/**
 * ParameterRow - switching {x} on or off while the field holds a value asks first, and never carries a value in.
 *
 * REQ-3.1.1.5, REQ-3.1.3.18; FIELD-7; a confirmation never dismisses on Esc or backdrop.
 */

import { useState } from 'react'
import { describe, it, expect, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { EditorView } from '@codemirror/view'

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

import { ParameterRow } from '@/features/workbench/common/element-config/parameters/parameter-row'
import type { Parameter } from '@/features/workbench/common/element-config/parameters/parameter-table-types'

const EXPRESSION = 'source_value'
const VARIABLES = [{ name: EXPRESSION, type: 'string' }]
const TO_EXPRESSION_TITLE = 'Switch the field to an expression?'
const TO_PLAIN_TITLE = 'Switch the field to a plain value?'
const BODY = 'The current value is cleared.'

interface FieldCase {
  kind: string
  parameter: Parameter
  /** A value the user set in literal mode. */
  value: unknown
  defaultValue: unknown
  /** The default as the gray hint of an empty {x} box: its Python literal. */
  hint: string
  /** Text, list, map and table only: what Clear & Empty puts in each mode. */
  empty?: { expression: string; value: unknown }
}

const TEXT: FieldCase = {
  kind: 'text',
  parameter: { name: 'region', label: 'Region', type: 'string', required: false },
  value: 'us-east',
  defaultValue: 'eu-west',
  hint: "'eu-west'",
  empty: { expression: "''", value: '' },
}
const CODE: FieldCase = {
  kind: 'code',
  parameter: { name: 'script', label: 'Script', type: 'string', required: false, allowedFormats: ['python'] },
  value: 'print(1)',
  defaultValue: 'pass',
  hint: "'pass'",
  empty: { expression: "''", value: '' },
}
const LIST: FieldCase = {
  kind: 'list',
  parameter: { name: 'tags', label: 'Tags', type: 'array', required: false },
  value: ['a'],
  defaultValue: ['x', 'y'],
  hint: "['x', 'y']",
  empty: { expression: '[]', value: [] },
}
const MAP: FieldCase = {
  kind: 'map',
  parameter: { name: 'labels', label: 'Labels', type: 'map', required: false },
  value: { k: 'v' },
  defaultValue: { d: '1' },
  hint: "{'d': '1'}",
  empty: { expression: '{}', value: {} },
}
const TABLE: FieldCase = {
  kind: 'table',
  parameter: { name: 'rows', label: 'Rows', type: 'table', required: false },
  value: [{ id: 1 }],
  defaultValue: [{ id: 0 }],
  hint: "[{'id': 0}]",
  empty: { expression: '[]', value: [] },
}
const INTEGER: FieldCase = {
  kind: 'integer',
  parameter: { name: 'retries', label: 'Retries', type: 'integer', required: false },
  value: 7,
  defaultValue: 5,
  hint: '5',
}
const FLOAT: FieldCase = {
  kind: 'float',
  parameter: { name: 'ratio', label: 'Ratio', type: 'float', required: false },
  value: 2.5,
  defaultValue: 1.5,
  hint: '1.5',
}
const CHOICE: FieldCase = {
  kind: 'choice list',
  parameter: { name: 'method', label: 'Method', type: 'string', required: false, enumValues: ['GET', 'POST'] },
  value: 'POST',
  defaultValue: 'GET',
  hint: "'GET'",
}
const BOOLEAN: FieldCase = {
  kind: 'true / false',
  parameter: { name: 'verify', label: 'Verify', type: 'boolean', required: false },
  value: true,
  defaultValue: false,
  hint: 'False',
}

/** Fields with an empty value: Clear & Empty is offered. */
const WITH_EMPTY = [TEXT, CODE, LIST, MAP, TABLE]
const NUMBERS = [INTEGER, FLOAT]
/** Choice lists and true / false always declare a default (FIELD-8). */
const ALWAYS_DEFAULT = [CHOICE, BOOLEAN]
const FREE_ENTRY = [...WITH_EMPTY, ...NUMBERS]
const EVERY_FIELD = [...FREE_ENTRY, ...ALWAYS_DEFAULT]

const withDefault = (field: FieldCase): Parameter => ({ ...field.parameter, defaultValue: field.defaultValue })
const byKind = (fields: FieldCase[]) => fields.map((field): [string, FieldCase] => [field.kind, field])

interface RowState {
  value: unknown
  expressionFields: string[]
  templateFields: string[]
}

/** What the row last wrote, as the config window keeps it. */
const state: RowState = { value: undefined, expressionFields: [], templateFields: [] }

function RowHarness({
  parameter,
  initial,
  expression = false,
  template = false,
}: Readonly<{ parameter: Parameter; initial: unknown; expression?: boolean; template?: boolean }>) {
  const [value, setValue] = useState<unknown>(initial)
  const [expressionFields, setExpressionFields] = useState<string[]>(expression ? [parameter.name] : [])
  const [templateFields, setTemplateFields] = useState<string[]>(template ? [parameter.name] : [])
  state.value = value
  state.expressionFields = expressionFields
  state.templateFields = templateFields
  return (
    <table>
      <tbody>
        <ParameterRow
          mode="input"
          parameter={parameter}
          value={value}
          onChange={(next) => setValue(next)}
          availableVariables={VARIABLES}
          expressionFields={expressionFields}
          onExpressionFieldsChange={setExpressionFields}
          templateFields={templateFields}
          onTemplateFieldsChange={setTemplateFields}
        />
      </tbody>
    </table>
  )
}

function renderRow(parameter: Parameter, initial: unknown, options: { expression?: boolean; template?: boolean } = {}) {
  render(<RowHarness parameter={parameter} initial={initial} {...options} />)
  return { user: userEvent.setup(), row: screen.getByTestId(`param-row-${parameter.name}`) }
}

const toggle = (row: HTMLElement) => within(row).getByTestId('expression-toggle')
const switchDialog = () => screen.queryByTestId('switch-mode-dialog')
const dialogButtons = () =>
  within(screen.getByTestId('switch-mode-dialog'))
    .getAllByRole('button')
    .map((button) => button.textContent)

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** The text of the row's {x} box. */
function expressionText(row: HTMLElement): string {
  const editor = row.querySelector<HTMLElement>('.cm-editor')
  expect(editor, 'the row holds an expression box').not.toBeNull()
  const view = EditorView.findFromDOM(editor as HTMLElement)
  expect(view, 'the expression box is mounted').not.toBeNull()
  return (view as EditorView).state.doc.toString()
}

/** A blank {x} box holds nothing: no value or an empty expression (REQ-3.1.1.5). */
function expectBlankExpression(value: unknown): void {
  expect([undefined, '']).toContainEqual(value)
}

function expectHint(row: HTMLElement, hint: string): void {
  expect(row.querySelector('.cm-placeholder')).toHaveTextContent(new RegExp(`^${escapeRegExp(hint)}$`))
}

async function askToExpression(field: FieldCase, parameter: Parameter = withDefault(field)) {
  const rendered = renderRow(parameter, field.value)
  await rendered.user.click(toggle(rendered.row))
  return rendered
}

async function askToPlain(parameter: Parameter) {
  const rendered = renderRow(parameter, EXPRESSION, { expression: true })
  await rendered.user.click(toggle(rendered.row))
  return rendered
}

/** The buttons each field offers, with and without a default (FIELD-7). */
const BUTTON_SETS = [
  ...WITH_EMPTY.map((field) => ({ kind: field.kind, field, hasDefault: true, labels: ['Cancel', 'Clear & Default', 'Clear & Empty'] })),
  ...WITH_EMPTY.map((field) => ({ kind: field.kind, field, hasDefault: false, labels: ['Cancel', 'Clear', 'Clear & Empty'] })),
  ...NUMBERS.map((field) => ({ kind: field.kind, field, hasDefault: true, labels: ['Cancel', 'Clear & Default'] })),
  ...NUMBERS.map((field) => ({ kind: field.kind, field, hasDefault: false, labels: ['Cancel', 'Clear'] })),
  ...ALWAYS_DEFAULT.map((field) => ({ kind: field.kind, field, hasDefault: true, labels: ['Cancel', 'Clear & Default'] })),
]

/** Clear & Empty on every field with an empty value, with and without a default. */
const EMPTY_CASES = [
  ...WITH_EMPTY.map((field) => ({ kind: field.kind, field, parameter: withDefault(field), hasDefault: true })),
  ...WITH_EMPTY.map((field) => ({ kind: field.kind, field, parameter: field.parameter, hasDefault: false })),
]

describe('ParameterRow switching into {x} while the field holds a value (FIELD-7)', () => {
  it.each(byKind(EVERY_FIELD))('asks before switching a %s field', async (_kind, field) => {
    const { row } = await askToExpression(field)
    const dialog = screen.getByTestId('switch-mode-dialog')
    expect(within(dialog).getByRole('heading')).toHaveTextContent(new RegExp(`^${escapeRegExp(TO_EXPRESSION_TITLE)}$`))
    expect(within(dialog).getByText(BODY)).toBeInTheDocument()
    expect(toggle(row)).toHaveAttribute('aria-pressed', 'false')
    expect(state.value).toEqual(field.value)
  })

  it.each(BUTTON_SETS)('offers the buttons of a $kind field (has a default: $hasDefault)', async ({ field, hasDefault, labels }) => {
    await askToExpression(field, hasDefault ? withDefault(field) : field.parameter)
    expect(dialogButtons()).toEqual(labels)
  })

  it.each(byKind(EVERY_FIELD))('keeps the value and the literal mode of a %s field on Cancel', async (_kind, field) => {
    const { user, row } = await askToExpression(field)
    await user.click(screen.getByTestId('switch-mode-cancel'))
    expect(switchDialog()).not.toBeInTheDocument()
    expect(toggle(row)).toHaveAttribute('aria-pressed', 'false')
    expect(state.value).toEqual(field.value)
    expect(state.expressionFields).toEqual([])
  })

  it.each(byKind(EVERY_FIELD))(
    'empties the {x} box of a %s field on Clear & Default and shows its default as the hint',
    async (_kind, field) => {
      const { user, row } = await askToExpression(field)
      await user.click(screen.getByTestId('switch-mode-clear-default'))
      expect(switchDialog()).not.toBeInTheDocument()
      expect(toggle(row)).toHaveAttribute('aria-pressed', 'true')
      expect(state.expressionFields).toEqual([field.parameter.name])
      expectBlankExpression(state.value)
      expect(expressionText(row)).toBe('')
      expectHint(row, field.hint)
    },
  )

  it.each(byKind(FREE_ENTRY))('switches a %s field with no default into an empty {x} box on Clear', async (_kind, field) => {
    const { user, row } = await askToExpression(field, field.parameter)
    await user.click(screen.getByTestId('switch-mode-clear-default'))
    expect(toggle(row)).toHaveAttribute('aria-pressed', 'true')
    expectBlankExpression(state.value)
    expect(expressionText(row)).toBe('')
    expect(row.querySelector('.cm-placeholder')).toBeNull()
  })

  it.each(EMPTY_CASES)(
    'puts the empty value of a $kind field into the {x} box on Clear & Empty (has a default: $hasDefault)',
    async ({ field, parameter }) => {
      const { user, row } = await askToExpression(field, parameter)
      await user.click(screen.getByTestId('switch-mode-clear-empty'))
      expect(toggle(row)).toHaveAttribute('aria-pressed', 'true')
      expect(state.value).toBe(field.empty?.expression)
      expect(expressionText(row)).toBe(field.empty?.expression)
    },
  )

  it('drops the template mark of a text field it switches into {x}', async () => {
    const { user, row } = renderRow(withDefault(TEXT), 'Hello {{ name }}', { template: true })
    await user.click(toggle(row))
    await user.click(screen.getByTestId('switch-mode-clear-default'))
    expect(state.expressionFields).toEqual(['region'])
    expect(state.templateFields).toEqual([])
  })
})

describe('ParameterRow switching out of {x} while the field holds an expression (FIELD-7)', () => {
  it.each(byKind(EVERY_FIELD))('asks before switching a %s field back to a plain value', async (_kind, field) => {
    const { row } = await askToPlain(withDefault(field))
    const dialog = screen.getByTestId('switch-mode-dialog')
    expect(within(dialog).getByRole('heading')).toHaveTextContent(new RegExp(`^${escapeRegExp(TO_PLAIN_TITLE)}$`))
    expect(within(dialog).getByText(BODY)).toBeInTheDocument()
    expect(toggle(row)).toHaveAttribute('aria-pressed', 'true')
    expect(state.value).toBe(EXPRESSION)
  })

  it.each(BUTTON_SETS)(
    'offers the buttons of a $kind field on the way back (has a default: $hasDefault)',
    async ({ field, hasDefault, labels }) => {
      await askToPlain(hasDefault ? withDefault(field) : field.parameter)
      expect(dialogButtons()).toEqual(labels)
    },
  )

  it.each(byKind(EVERY_FIELD))('keeps {x} and the expression of a %s field on Cancel', async (_kind, field) => {
    const { user, row } = await askToPlain(withDefault(field))
    await user.click(screen.getByTestId('switch-mode-cancel'))
    expect(switchDialog()).not.toBeInTheDocument()
    expect(toggle(row)).toHaveAttribute('aria-pressed', 'true')
    expect(state.value).toBe(EXPRESSION)
    expect(expressionText(row)).toBe(EXPRESSION)
  })

  it.each(byKind(FREE_ENTRY))('leaves a %s field not set on Clear & Default, so its default shows', async (_kind, field) => {
    const { user, row } = await askToPlain(withDefault(field))
    await user.click(screen.getByTestId('switch-mode-clear-default'))
    expect(toggle(row)).toHaveAttribute('aria-pressed', 'false')
    expect(state.expressionFields).toEqual([])
    expect(state.value).toBeUndefined()
  })

  it.each(byKind(ALWAYS_DEFAULT))('writes the default of a %s field as its value on Clear & Default', async (_kind, field) => {
    const { user, row } = await askToPlain(withDefault(field))
    await user.click(screen.getByTestId('switch-mode-clear-default'))
    expect(toggle(row)).toHaveAttribute('aria-pressed', 'false')
    expect(state.value).toEqual(field.defaultValue)
  })

  it.each(byKind(FREE_ENTRY))('leaves a %s field with no default not set on Clear', async (_kind, field) => {
    const { user, row } = await askToPlain(field.parameter)
    expect(dialogButtons()).toContain('Clear')
    await user.click(screen.getByTestId('switch-mode-clear-default'))
    expect(toggle(row)).toHaveAttribute('aria-pressed', 'false')
    expect(state.value).toBeUndefined()
  })

  it.each(EMPTY_CASES)(
    'gives a $kind field its empty value as the user value on Clear & Empty (has a default: $hasDefault)',
    async ({ field, parameter }) => {
      const { user, row } = await askToPlain(parameter)
      await user.click(screen.getByTestId('switch-mode-clear-empty'))
      expect(toggle(row)).toHaveAttribute('aria-pressed', 'false')
      expect(state.expressionFields).toEqual([])
      expect(state.value).toEqual(field.empty?.value)
    },
  )
})

describe('ParameterRow values that count as held (FIELD-4, FIELD-5)', () => {
  it('asks before switching a field that holds empty text', async () => {
    const { user, row } = renderRow(withDefault(TEXT), '')
    await user.click(toggle(row))
    expect(switchDialog()).toBeInTheDocument()
    expect(state.value).toBe('')
  })

  it('asks before switching a field that holds a stored null', async () => {
    const { user, row } = renderRow(TEXT.parameter, null)
    await user.click(toggle(row))
    expect(switchDialog()).toBeInTheDocument()
    expect(state.value).toBeNull()
  })
})

describe('ParameterRow a field that holds nothing switches silently (FIELD-7)', () => {
  it.each(byKind(FREE_ENTRY))(
    'switches a not-set %s field into {x} with no warning and copies nothing in',
    async (_kind, field) => {
      const { user, row } = renderRow(withDefault(field), undefined)
      await user.click(toggle(row))
      expect(switchDialog()).not.toBeInTheDocument()
      expect(toggle(row)).toHaveAttribute('aria-pressed', 'true')
      expectBlankExpression(state.value)
      expect(expressionText(row)).toBe('')
      expectHint(row, field.hint)
    },
  )

  it.each(byKind(FREE_ENTRY))(
    'switches a not-set %s field with no default into {x} with no warning',
    async (_kind, field) => {
      const { user, row } = renderRow(field.parameter, undefined)
      await user.click(toggle(row))
      expect(switchDialog()).not.toBeInTheDocument()
      expect(toggle(row)).toHaveAttribute('aria-pressed', 'true')
      expectBlankExpression(state.value)
    },
  )

  it('switches an empty {x} box back to a plain value with no warning', async () => {
    const { user, row } = renderRow(withDefault(TEXT), undefined, { expression: true })
    await user.click(toggle(row))
    expect(switchDialog()).not.toBeInTheDocument()
    expect(toggle(row)).toHaveAttribute('aria-pressed', 'false')
    expect(state.value).toBeUndefined()
  })
})

describe('ParameterRow switch warning keyboard and dismissal (FIELD-7)', () => {
  it('stays open on Esc and leaves the field as it was', async () => {
    const { user, row } = await askToExpression(TEXT)
    await user.keyboard('{Escape}')
    expect(switchDialog()).toBeInTheDocument()
    expect(toggle(row)).toHaveAttribute('aria-pressed', 'false')
    expect(state.value).toBe(TEXT.value)
  })

  it('stays open on a click on the backdrop and leaves the field as it was', async () => {
    const { row } = await askToExpression(TEXT)
    const backdrop = screen.getByTestId('switch-mode-dialog').previousElementSibling as HTMLElement
    fireEvent.pointerDown(backdrop)
    fireEvent.mouseDown(backdrop)
    fireEvent.click(backdrop)
    expect(switchDialog()).toBeInTheDocument()
    expect(toggle(row)).toHaveAttribute('aria-pressed', 'false')
    expect(state.value).toBe(TEXT.value)
  })

  it('starts focus on Cancel', async () => {
    await askToExpression(TEXT)
    expect(screen.getByTestId('switch-mode-cancel')).toHaveFocus()
  })

  it('moves Cancel, then Clear & Default, then Clear & Empty on Tab', async () => {
    const { user } = await askToExpression(TEXT)
    await user.tab()
    expect(screen.getByTestId('switch-mode-clear-default')).toHaveFocus()
    await user.tab()
    expect(screen.getByTestId('switch-mode-clear-empty')).toHaveFocus()
  })

  it('switches on Enter on the focused Clear & Empty', async () => {
    const { user, row } = await askToExpression(TEXT)
    await user.tab()
    await user.tab()
    await user.keyboard('{Enter}')
    expect(toggle(row)).toHaveAttribute('aria-pressed', 'true')
    expect(state.value).toBe("''")
  })
})

describe('ParameterRow secret fields keep their own confirm (REQ-3.1.3.18)', () => {
  const PASSWORD: Parameter = { name: 'password', label: 'Password', type: 'string', required: false, secret: true }
  const SEALED = 'wave:enc:v1:c2VhbGVk'

  it('asks the discard confirm, not the switch warning, for a stored protected value', async () => {
    const { user, row } = renderRow(PASSWORD, SEALED)
    await user.click(toggle(row))
    expect(screen.getByRole('alertdialog', { name: 'Discard protected value?' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Switch to expression' })).toBeInTheDocument()
    expect(switchDialog()).not.toBeInTheDocument()
  })

  it('switches the stored protected value into an empty {x} box once confirmed', async () => {
    const { user, row } = renderRow(PASSWORD, SEALED)
    await user.click(toggle(row))
    await user.click(screen.getByRole('button', { name: 'Switch to expression' }))
    expect(toggle(row)).toHaveAttribute('aria-pressed', 'true')
    expectBlankExpression(state.value)
  })

  it('asks the switch warning for a value typed after Delete & Edit', async () => {
    const { user, row } = renderRow(PASSWORD, 'typed-again')
    await user.click(toggle(row))
    expect(switchDialog()).toBeInTheDocument()
    expect(screen.queryByRole('alertdialog', { name: 'Discard protected value?' })).not.toBeInTheDocument()
    expect(dialogButtons()).toEqual(['Cancel', 'Clear', 'Clear & Empty'])
  })
})
