/**
 * ParameterRow - a free-entry field nobody set shows its default in one gray in both modes, switching copies
 * nothing in, choice lists and true / false hold a real value, and the reset icon takes a field back to not set.
 *
 * REQ-3.1.1.5, REQ-3.1.2.10, REQ-3.1.3.18; FIELD-1, FIELD-2, FIELD-3, FIELD-8, FIELD-10
 */

import { useState } from 'react'
import { describe, it, expect, vi } from 'vitest'
import { act, render, screen, waitFor, within } from '@testing-library/react'
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

// Cipher Suites reads its gray default list from the TLS catalog.
vi.mock('@/services/tls-capabilities', () => ({
  fetchTlsCapabilities: vi.fn(() =>
    Promise.resolve({
      defaults: { 'http-client': { '1.2-1.3': ['ECDHE-RSA-AES256-GCM-SHA384', 'TLS_AES_128_GCM_SHA256'] } },
      ciphers: [
        { openssl: 'ECDHE-RSA-AES256-GCM-SHA384', iana: 'TLS_ECDHE_RSA_WITH_AES_256_GCM_SHA384', min_version: '1.2', max_version: '1.2' },
        { openssl: 'ECDHE-RSA-AES128-SHA', iana: 'TLS_ECDHE_RSA_WITH_AES_128_CBC_SHA', min_version: '1.0', max_version: '1.2' },
        { openssl: 'TLS_AES_128_GCM_SHA256', iana: 'TLS_AES_128_GCM_SHA256', min_version: '1.3', max_version: '1.3' },
      ],
    }),
  ),
}))

import { ParameterRow } from '@/features/workbench/common/element-config/parameters/parameter-row'
import type { Parameter } from '@/features/workbench/common/element-config/parameters/parameter-table-types'
import type { ElementTypes } from '@/lib/variable-validation'
import { getValueColorClass, HELD_DEFAULT_LOOK_CLASS } from '@/lib/variable-format'

const EXPRESSION = 'source_value'
const VARIABLES = [{ name: EXPRESSION, type: 'string' }]
/** Text Muted (--color-text-muted, #71717A) as a computed color: the variable or its value. */
const TEXT_MUTED_COLORS = ['var(--color-text-muted)', 'rgb(113, 113, 122)']

const REGION: Parameter = { name: 'region', label: 'Region', type: 'string', required: false, defaultValue: 'eu-west' }
const SCRIPT: Parameter = {
  name: 'script',
  label: 'Script',
  type: 'string',
  required: false,
  allowedFormats: ['python'],
  defaultValue: 'pass',
}
const TAGS: Parameter = { name: 'tags', label: 'Tags', type: 'array', required: false, defaultValue: ['x', 'y'] }
const LABELS: Parameter = { name: 'labels', label: 'Labels', type: 'map', required: false, defaultValue: { d: '1' } }
const ROWS: Parameter = { name: 'rows', label: 'Rows', type: 'table', required: false, defaultValue: [{ id: 0 }] }
const RETRIES: Parameter = { name: 'retries', label: 'Retries', type: 'integer', required: false, defaultValue: 5 }
const RATIO: Parameter = { name: 'ratio', label: 'Ratio', type: 'float', required: false, defaultValue: 1.5 }
const METHOD: Parameter = {
  name: 'method',
  label: 'Method',
  type: 'string',
  required: false,
  enumValues: ['GET', 'POST'],
  defaultValue: 'GET',
}
const VERIFY: Parameter = { name: 'verify', label: 'Verify', type: 'boolean', required: false, defaultValue: false }

const withoutDefault = (parameter: Parameter): Parameter => ({ ...parameter, defaultValue: undefined })

interface RowState {
  value: unknown
  expressionFields: string[]
  templateFields: string[]
  elementTypes: ElementTypes | undefined
}

/** What the row last wrote, as the config window keeps it. */
const state: RowState = { value: undefined, expressionFields: [], templateFields: [], elementTypes: undefined }

interface HarnessProps {
  parameter: Parameter
  initial: unknown
  expressionFields?: string[]
  templateFields?: string[]
  elementTypes?: ElementTypes
  onValidationChange?: (name: string, error: string | null) => void
}

function RowHarness({ parameter, initial, onValidationChange, ...initialFlags }: Readonly<HarnessProps>) {
  const [value, setValue] = useState<unknown>(initial)
  const [expressionFields, setExpressionFields] = useState<string[]>(initialFlags.expressionFields ?? [])
  const [templateFields, setTemplateFields] = useState<string[]>(initialFlags.templateFields ?? [])
  const [elementTypes, setElementTypes] = useState<ElementTypes | undefined>(initialFlags.elementTypes)
  state.value = value
  state.expressionFields = expressionFields
  state.templateFields = templateFields
  state.elementTypes = elementTypes
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
          elementTypes={elementTypes}
          onElementTypesChange={setElementTypes}
          onValidationChange={onValidationChange}
        />
      </tbody>
    </table>
  )
}

function renderRow(props: HarnessProps) {
  render(<RowHarness {...props} />)
  return { user: userEvent.setup(), row: screen.getByTestId(`param-row-${props.parameter.name}`) }
}

type RowProps = React.ComponentProps<typeof ParameterRow>

function rowElement(props: Partial<RowProps> & { parameter: Parameter }) {
  return (
    <table>
      <tbody>
        <ParameterRow
          mode="input"
          value={undefined}
          onChange={vi.fn()}
          availableVariables={VARIABLES}
          expressionFields={[]}
          onExpressionFieldsChange={vi.fn()}
          templateFields={[]}
          onTemplateFieldsChange={vi.fn()}
          {...props}
        />
      </tbody>
    </table>
  )
}

const toggle = (row: HTMLElement) => within(row).getByTestId('expression-toggle')
const valueCell = (row: HTMLElement) => row.querySelectorAll<HTMLElement>(':scope > td')[3]

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** The element of the value cell that shows exactly this text: a field's value or a text node. */
function shownIn(cell: HTMLElement, text: string): HTMLElement {
  const field = Array.from(cell.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input, textarea')).find(
    (control) => control.value === text,
  )
  return field ?? within(cell).getAllByText(text)[0]
}

/** The element, or a wrapper of it inside the cell, is painted Text Muted. */
function paintsTextMuted(element: HTMLElement, cell: HTMLElement): boolean {
  for (let node: HTMLElement | null = element; node && node !== cell; node = node.parentElement) {
    if (node.classList.contains(HELD_DEFAULT_LOOK_CLASS) || node.classList.contains('text-muted')) return true
    if (TEXT_MUTED_COLORS.includes(getComputedStyle(node).color)) return true
  }
  return false
}

function carriesClass(element: HTMLElement, cell: HTMLElement, className: string): boolean {
  for (let node: HTMLElement | null = element; node && node !== cell; node = node.parentElement) {
    if (node.classList.contains(className)) return true
  }
  return false
}

/** No part of the row is drawn in the gray of a default. */
function expectNoGray(row: HTMLElement): void {
  expect(row.querySelector('[class*="--color-text-muted"]')).toBeNull()
  expect(row.querySelector('.text-muted')).toBeNull()
}

function expressionText(row: HTMLElement): string {
  const editor = row.querySelector<HTMLElement>('.cm-editor')
  expect(editor, 'the row holds an expression box').not.toBeNull()
  const view = EditorView.findFromDOM(editor as HTMLElement)
  expect(view, 'the expression box is mounted').not.toBeNull()
  return (view as EditorView).state.doc.toString()
}

function expectHint(row: HTMLElement, hint: string): void {
  expect(row.querySelector('.cm-placeholder')).toHaveTextContent(new RegExp(`^${escapeRegExp(hint)}$`))
}

function expectBlankExpression(value: unknown): void {
  expect([undefined, '']).toContainEqual(value)
}

/** The default of each free-entry field, as the not-set field shows it on one line. */
// A Function input keeps its table default as stored, {columns, rows}; the field shows it as its rows (REQ-3.5.5.1).
const STORED_ROWS: Parameter = {
  ...ROWS,
  defaultValue: { columns: [{ name: 'id', type: 'integer' }], rows: [[0], [1]] },
}

const SHOWN_DEFAULTS: Array<[string, Parameter, string]> = [
  ['text', REGION, 'eu-west'],
  ['code', SCRIPT, 'pass'],
  ['list', TAGS, '["x", "y"]'],
  ['map', LABELS, '{"d": "1"}'],
  ['table', ROWS, '[{"id": 0}]'],
  ['stored table', STORED_ROWS, '[{"id": 0}, {"id": 1}]'],
]

const PYTHON_HINTS: Array<[string, Parameter, string]> = [
  ['a text', REGION, "'eu-west'"],
  ['a code', SCRIPT, "'pass'"],
  ['an integer', RETRIES, '5'],
  ['a float', RATIO, '1.5'],
  ['a whole-number float', { ...RATIO, defaultValue: 2 }, '2.0'],
  ['a true', { ...VERIFY, defaultValue: true }, 'True'],
  ['a false', VERIFY, 'False'],
  ['a text list', TAGS, "['x', 'y']"],
  ['a number list', { ...TAGS, typedValues: true, defaultValue: [1, 2] }, '[1, 2]'],
  ['a map', { ...LABELS, typedValues: true, defaultValue: { k: 1 } }, "{'k': 1}"],
  ['a stored table', STORED_ROWS, "[{'id': 0}, {'id': 1}]"],
  ['a table', { ...ROWS, defaultValue: [{ id: 1 }] }, "[{'id': 1}]"],
  ['a choice list', METHOD, "'GET'"],
]

describe('ParameterRow gray default in literal mode (FIELD-2)', () => {
  it.each(SHOWN_DEFAULTS)('shows the default of a not-set %s field as Text Muted text', (_kind, parameter, shown) => {
    const { row } = renderRow({ parameter, initial: undefined })
    const cell = valueCell(row)
    expect(paintsTextMuted(shownIn(cell, shown), cell)).toBe(true)
    expect(toggle(row)).toHaveAttribute('aria-pressed', 'false')
  })

  it('shows a value the user set in the string color, never the gray', () => {
    const { row } = renderRow({ parameter: REGION, initial: 'us-east' })
    const cell = valueCell(row)
    const shown = shownIn(cell, 'us-east')
    expect(paintsTextMuted(shown, cell)).toBe(false)
    expect(carriesClass(shown, cell, getValueColorClass('string'))).toBe(true)
  })

  it('shows a value equal to the default as the user value, never the gray', () => {
    const { row } = renderRow({ parameter: REGION, initial: 'eu-west' })
    const cell = valueCell(row)
    expect(paintsTextMuted(shownIn(cell, 'eu-west'), cell)).toBe(false)
  })
})

describe('ParameterRow numbers show the default as real gray text (FIELD-2)', () => {
  it.each([
    ['integer', RETRIES, '5'],
    ['float', RATIO, '1.5'],
  ] as const)('shows the default of a not-set %s field as the text of the box, not as a placeholder', (_kind, parameter, shown) => {
    const { row } = renderRow({ parameter, initial: undefined })
    const cell = valueCell(row)
    const box = within(cell).getByDisplayValue(shown)
    expect(paintsTextMuted(box, cell)).toBe(true)
    expect(cell.querySelector(`[placeholder="${shown}"]`)).toBeNull()
  })

  it('shows a number the user set as the user value, never the gray', () => {
    const { row } = renderRow({ parameter: RETRIES, initial: 7 })
    const cell = valueCell(row)
    expect(paintsTextMuted(within(cell).getByDisplayValue('7'), cell)).toBe(false)
  })
})

describe('ParameterRow {x} hint (FIELD-2)', () => {
  it.each(PYTHON_HINTS)('shows the default of %s field as its Python literal in the empty {x} box', (_kind, parameter, hint) => {
    const { row } = renderRow({ parameter, initial: undefined, expressionFields: [parameter.name] })
    expect(expressionText(row)).toBe('')
    expectHint(row, hint)
  })

  it('paints the hint Text Muted, the gray of the literal default', () => {
    const { row } = renderRow({ parameter: REGION, initial: undefined, expressionFields: ['region'] })
    const hint = row.querySelector('.cm-placeholder') as HTMLElement
    expect(hint).not.toBeNull()
    expect(TEXT_MUTED_COLORS).toContain(getComputedStyle(hint).color)
  })

  it('shows no hint on a field with no default', () => {
    const { row } = renderRow({ parameter: withoutDefault(REGION), initial: undefined, expressionFields: ['region'] })
    expect(row.querySelector('.cm-placeholder')).toBeNull()
  })

  it('shows no hint once the box holds an expression', () => {
    const { row } = renderRow({ parameter: REGION, initial: EXPRESSION, expressionFields: ['region'] })
    expect(expressionText(row)).toBe(EXPRESSION)
    expect(row.querySelector('.cm-placeholder')).toBeNull()
  })
})

describe('ParameterRow switching copies nothing in (FIELD-2)', () => {
  it.each([
    ['text', REGION, 'eu-west', "'eu-west'"],
    ['list', TAGS, '["x", "y"]', "['x', 'y']"],
    ['map', LABELS, '{"d": "1"}', "{'d': '1'}"],
  ] as const)(
    'switches a not-set %s field into {x} and back with nothing copied either way',
    async (_kind, parameter, shown, hint) => {
      const { user, row } = renderRow({ parameter, initial: undefined })
      await user.click(toggle(row))
      expect(toggle(row)).toHaveAttribute('aria-pressed', 'true')
      expectBlankExpression(state.value)
      expect(expressionText(row)).toBe('')
      expectHint(row, hint)

      await user.click(toggle(row))
      expect(toggle(row)).toHaveAttribute('aria-pressed', 'false')
      expect(state.value).toBeUndefined()
      const cell = valueCell(row)
      expect(paintsTextMuted(shownIn(cell, shown), cell)).toBe(true)
    },
  )

  it.each([
    ['integer', RETRIES, '5'],
    ['float', RATIO, '1.5'],
  ] as const)('switches a not-set %s field into {x} with nothing copied in', async (_kind, parameter, hint) => {
    const { user, row } = renderRow({ parameter, initial: undefined })
    await user.click(toggle(row))
    expectBlankExpression(state.value)
    expect(expressionText(row)).toBe('')
    expectHint(row, hint)
  })

  it("drops a typed map's element types when it switches into {x}", async () => {
    const { user, row } = renderRow({
      parameter: { ...LABELS, typedValues: true },
      initial: { k: 1 },
      elementTypes: { k: 'integer' },
    })
    await user.click(toggle(row))
    await user.click(screen.getByTestId('switch-mode-clear-default'))
    expect(toggle(row)).toHaveAttribute('aria-pressed', 'true')
    expect(state.expressionFields).toEqual(['labels'])
    expect(state.elementTypes).toBeUndefined()
  })
})

describe('ParameterRow choice lists and true / false hold a real value (FIELD-8)', () => {
  it.each([
    ['a value of its own', 'POST'],
    ['its default', 'GET'],
  ])('shows a choice list holding %s in normal color with no reset and no expand', (_case, held) => {
    render(rowElement({ parameter: METHOD, value: held }))
    const row = screen.getByTestId('param-row-method')
    expect(within(row).getByRole('combobox', { name: 'Method' })).toHaveTextContent(new RegExp(`^${held}$`))
    expectNoGray(row)
    expect(within(row).queryByTestId('param-reset-method')).not.toBeInTheDocument()
    expect(within(row).queryByTestId('param-expand-method')).not.toBeInTheDocument()
  })

  it.each([
    ['a value of its own', true],
    ['its default', false],
  ])('shows a true / false holding %s in normal color with no reset and no expand', (_case, held) => {
    render(rowElement({ parameter: VERIFY, value: held }))
    const row = screen.getByTestId('param-row-verify')
    expect(within(row).getByRole('checkbox', { name: 'Verify' })).toHaveAttribute('aria-checked', String(held))
    expectNoGray(row)
    expect(within(row).queryByTestId('param-reset-verify')).not.toBeInTheDocument()
    expect(within(row).queryByTestId('param-expand-verify')).not.toBeInTheDocument()
  })
})

describe('ParameterRow expand column (FIELD-1)', () => {
  it.each([
    ['text', REGION],
    ['code', SCRIPT],
    ['list', TAGS],
    ['map', LABELS],
    ['table', ROWS],
  ] as const)('gives a %s field the expand button', (_kind, parameter) => {
    render(rowElement({ parameter, value: undefined }))
    const expand = screen.getByTestId(`param-expand-${parameter.name}`)
    const name = `Open editor for ${parameter.label}`
    expect(expand).toHaveAccessibleName(name)
    expect(within(screen.getByTestId(`param-row-${parameter.name}`)).getByRole('button', { name })).toBe(expand)
  })

  it('keeps the expand button of a field in {x} mode', () => {
    render(rowElement({ parameter: REGION, value: EXPRESSION, expressionFields: ['region'] }))
    expect(screen.getByTestId('param-expand-region')).toHaveAccessibleName('Open editor for Region')
  })

  it.each([
    ['integer', RETRIES, 7],
    ['float', RATIO, 2.5],
    ['choice list', METHOD, 'POST'],
    ['true / false', VERIFY, true],
  ] as const)('leaves the expand column of a %s field empty', (_kind, parameter, held) => {
    render(rowElement({ parameter, value: held }))
    const row = screen.getByTestId(`param-row-${parameter.name}`)
    expect(within(row).queryByTestId(`param-expand-${parameter.name}`)).not.toBeInTheDocument()
    expect(within(row).queryByRole('button', { name: /^Open editor/ })).not.toBeInTheDocument()
  })

  const PASSWORD: Parameter = { name: 'password', label: 'Password', type: 'string', required: false, secret: true }

  it('gives a stored protected value no expand', () => {
    render(rowElement({ parameter: PASSWORD, value: 'wave:enc:v1:c2VhbGVk' }))
    expect(screen.queryByTestId('param-expand-password')).not.toBeInTheDocument()
  })

  it('gives a protected value typed after Delete & Edit the expand button', () => {
    render(rowElement({ parameter: PASSWORD, value: 'typed-again' }))
    expect(screen.getByTestId('param-expand-password')).toHaveAccessibleName('Open editor for Password')
  })
})

describe('ParameterRow reset icon (FIELD-3)', () => {
  it('shows "Reset to default" inside a field with a default that holds the user value', () => {
    const { row } = renderRow({ parameter: REGION, initial: 'us-east' })
    const reset = within(row).getByTestId('param-reset-region')
    expect(reset).toHaveAccessibleName('Reset to default')
    expect(valueCell(row)).toContainElement(reset)
  })

  it('shows the reset icon on a value equal to the default, which is the user value', () => {
    const { row } = renderRow({ parameter: REGION, initial: 'eu-west' })
    expect(within(row).getByTestId('param-reset-region')).toBeInTheDocument()
  })

  it('names itself "Reset to default" in its tooltip', async () => {
    const { row } = renderRow({ parameter: REGION, initial: 'us-east' })
    act(() => within(row).getByTestId('param-reset-region').focus())
    const tooltips = await screen.findAllByRole('tooltip')
    expect(tooltips.map((tooltip) => tooltip.textContent)).toContain('Reset to default')
  })

  it('takes a text field back to not set, drops its template mark and shows the gray default', async () => {
    const { user, row } = renderRow({ parameter: REGION, initial: 'Hi {{ name }}', templateFields: ['region'] })
    await user.click(within(row).getByTestId('param-reset-region'))
    expect(state.value).toBeUndefined()
    expect(state.templateFields).toEqual([])
    const cell = valueCell(row)
    expect(paintsTextMuted(shownIn(cell, 'eu-west'), cell)).toBe(true)
    expect(within(row).queryByTestId('param-reset-region')).not.toBeInTheDocument()
  })

  it("drops a map's dotted {x} entries and element types, and keeps every other field's flags", async () => {
    const typedLabels: Parameter = { ...LABELS, typedValues: true }
    const { user, row } = renderRow({
      parameter: typedLabels,
      initial: { k: 1, j: EXPRESSION },
      expressionFields: ['labels.j', 'other', 'other.k'],
      elementTypes: { k: 'integer', j: 'string' },
    })
    await user.click(within(row).getByTestId('param-reset-labels'))
    expect(state.value).toBeUndefined()
    expect(state.expressionFields).toEqual(['other', 'other.k'])
    expect(state.elementTypes).toBeUndefined()
  })

  it('empties the {x} box of a field in {x} mode, keeps the mode and shows the gray hint', async () => {
    const { user, row } = renderRow({ parameter: REGION, initial: EXPRESSION, expressionFields: ['region'] })
    await user.click(within(row).getByTestId('param-reset-region'))
    expectBlankExpression(state.value)
    expect(state.expressionFields).toEqual(['region'])
    expect(toggle(row)).toHaveAttribute('aria-pressed', 'true')
    expect(expressionText(row)).toBe('')
    expectHint(row, "'eu-west'")
  })

  it.each([
    ['Enter', '{Enter}'],
    ['Space', ' '],
  ])('resets on %s', async (_key, keys) => {
    const { user, row } = renderRow({ parameter: REGION, initial: 'us-east' })
    act(() => within(row).getByTestId('param-reset-region').focus())
    await user.keyboard(keys)
    expect(state.value).toBeUndefined()
  })

  it('reports the reset as a change of the field', async () => {
    const onChange = vi.fn()
    render(rowElement({ parameter: REGION, value: 'us-east', onChange }))
    await userEvent.setup().click(screen.getByTestId('param-reset-region'))
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenCalledWith(undefined)
  })

  it('is hidden while the field is not set', () => {
    render(rowElement({ parameter: REGION, value: undefined }))
    expect(screen.queryByTestId('param-reset-region')).not.toBeInTheDocument()
  })

  it('is hidden on a field with no default, and shown once the same field has one', () => {
    const { rerender } = render(rowElement({ parameter: withoutDefault(REGION), value: 'us-east' }))
    expect(screen.queryByTestId('param-reset-region')).not.toBeInTheDocument()
    rerender(rowElement({ parameter: REGION, value: 'us-east' }))
    expect(screen.getByTestId('param-reset-region')).toBeInTheDocument()
  })

  it('is hidden on a Required Function input, whose Block shows no default', () => {
    const requiredInput: Parameter = { name: 'region', label: 'Region', type: 'string', required: true }
    const { rerender } = render(rowElement({ parameter: requiredInput, value: 'us-east' }))
    expect(screen.queryByTestId('param-reset-region')).not.toBeInTheDocument()
    rerender(rowElement({ parameter: REGION, value: 'us-east' }))
    expect(screen.getByTestId('param-reset-region')).toBeInTheDocument()
  })

  it('is hidden on a secret field, even one given a default', () => {
    const secretRegion: Parameter = { ...REGION, secret: true }
    const { rerender } = render(rowElement({ parameter: secretRegion, value: 'typed-again' }))
    expect(screen.queryByTestId('param-reset-region')).not.toBeInTheDocument()
    rerender(rowElement({ parameter: REGION, value: 'typed-again' }))
    expect(screen.getByTestId('param-reset-region')).toBeInTheDocument()
  })

  it.each([
    ['a choice list', METHOD, 'POST'],
    ['a true / false', VERIFY, true],
  ] as const)('is hidden on %s holding a value other than its default', (_kind, parameter, held) => {
    render(rowElement({ parameter, value: held }))
    expect(screen.queryByTestId(`param-reset-${parameter.name}`)).not.toBeInTheDocument()
  })

  it('is hidden on a row its lockedWhen pins, and shown once the lock lets go', () => {
    const pinned: Parameter = { ...REGION, lockedWhen: { field: 'mode', values: ['pinned'], value: 'eu-central' } }
    const { rerender } = render(rowElement({ parameter: pinned, value: 'us-east', allValues: { mode: 'pinned' } }))
    expect(screen.queryByTestId('param-reset-region')).not.toBeInTheDocument()
    rerender(rowElement({ parameter: pinned, value: 'us-east', allValues: { mode: 'free' } }))
    expect(screen.getByTestId('param-reset-region')).toBeInTheDocument()
  })

  it('is hidden on a row locked on a remote host, and shown back on the WAVE host', () => {
    const remoteLocked: Parameter = { ...REGION, lockedOnRemoteHost: { displayText: "Remote host's settings" } }
    const { rerender } = render(rowElement({ parameter: remoteLocked, value: 'us-east', runsOnRemoteHost: true }))
    expect(screen.queryByTestId('param-reset-region')).not.toBeInTheDocument()
    rerender(rowElement({ parameter: remoteLocked, value: 'us-east', runsOnRemoteHost: false }))
    expect(screen.getByTestId('param-reset-region')).toBeInTheDocument()
  })
})

describe('ParameterRow null button on a field that takes a whole null (FIELD-5, REQ-3.1.3.21)', () => {
  const NOTE: Parameter = { name: 'note', label: 'Note', type: 'string', required: false, acceptsNull: true }
  const IDS: Parameter = { name: 'ids', label: 'Ids', type: 'array', required: false, acceptsNull: true }
  const LIMIT: Parameter = { name: 'limit', label: 'Limit', type: 'integer', required: false, acceptsNull: true }
  const nullButton = (row: HTMLElement, name: string) => within(row).queryByTestId(`param-null-${name}`)

  function expectNullShown(row: HTMLElement, name: string): void {
    const cell = valueCell(row)
    expect(paintsTextMuted(shownIn(cell, 'null'), cell)).toBe(true)
    expect(nullButton(row, name)).toHaveAttribute('aria-pressed', 'true')
  }

  it.each([
    ['text', NOTE, 'ship it'],
    ['list', IDS, ['a']],
    ['number', LIMIT, '7'],
  ] as const)('shows "Set <label> to null" inside a %s field that takes a null and has no default', (_kind, parameter, held) => {
    const { row } = renderRow({ parameter, initial: held })
    const button = nullButton(row, parameter.name) as HTMLElement
    expect(button).toHaveAccessibleName(`Set ${parameter.label} to null`)
    expect(button).toHaveAttribute('aria-pressed', 'false')
    expect(valueCell(row)).toContainElement(button)
  })

  it('shows no null button on a field that refuses a whole null, and shows it once the field takes one', () => {
    const { rerender } = render(rowElement({ parameter: { ...NOTE, acceptsNull: false }, value: 'ship it' }))
    expect(screen.queryByTestId('param-null-note')).not.toBeInTheDocument()
    rerender(rowElement({ parameter: { ...NOTE, acceptsNull: undefined }, value: 'ship it' }))
    expect(screen.queryByTestId('param-null-note')).not.toBeInTheDocument()
    rerender(rowElement({ parameter: NOTE, value: 'ship it' }))
    expect(screen.getByTestId('param-null-note')).toBeInTheDocument()
  })

  it('shows no null button on a field with a default, even one marked as taking a null', () => {
    render(rowElement({ parameter: { ...NOTE, defaultValue: 'n/a' }, value: 'ship it' }))
    expect(screen.queryByTestId('param-null-note')).not.toBeInTheDocument()
    expect(screen.getByTestId('param-reset-note')).toBeInTheDocument()
  })

  it('stores null when pressed and shows null with the button pressed', async () => {
    const { user, row } = renderRow({ parameter: NOTE, initial: 'ship it' })
    await user.click(nullButton(row, 'note') as HTMLElement)
    expect(state.value).toBeNull()
    expectNullShown(row, 'note')
  })

  it('stores null on a list field when pressed', async () => {
    const { user, row } = renderRow({ parameter: IDS, initial: ['a'] })
    await user.click(nullButton(row, 'ids') as HTMLElement)
    expect(state.value).toBeNull()
    expectNullShown(row, 'ids')
  })

  it.each([
    ['text', NOTE],
    ['list', IDS],
  ] as const)('shows a stored null on a %s field as null with the button pressed', (_kind, parameter) => {
    const { row } = renderRow({ parameter, initial: null })
    expectNullShown(row, parameter.name)
  })

  it('shows null with the button pressed on a field that takes a null and is not set', () => {
    const { row } = renderRow({ parameter: NOTE, initial: undefined })
    expectNullShown(row, 'note')
    expect(state.value).toBeUndefined()
  })

  it('shows no null button while the field is an expression', () => {
    const { row } = renderRow({ parameter: NOTE, initial: EXPRESSION, expressionFields: ['note'] })
    expect(nullButton(row, 'note')).not.toBeInTheDocument()
  })

  it('leaves the field not set and shows null after Clear out of {x}', async () => {
    const { user, row } = renderRow({ parameter: NOTE, initial: EXPRESSION, expressionFields: ['note'] })
    await user.click(toggle(row))
    await user.click(screen.getByTestId('switch-mode-clear-default'))
    expect(toggle(row)).toHaveAttribute('aria-pressed', 'false')
    expect(state.value).toBeUndefined()
    expectNullShown(row, 'note')
  })
})

// The first key or paste replaces the gray default and typing goes on; text equal to the default is the user value (FIELD-2).
describe('ParameterRow typing and pasting over the gray default (FIELD-2)', () => {
  const RETRY_DELAY: Parameter = { name: 'retry_delay', label: 'Retry Delay', type: 'float', required: false, defaultValue: 1 }
  const HEADER_ROW: Parameter = { name: 'header_row', label: 'Header row', type: 'integer', required: false, defaultValue: 1 }
  const RETRYABLE: Parameter = {
    name: 'retryable_status_codes',
    label: 'Retryable Codes',
    type: 'array',
    required: false,
    defaultValue: ['502', '503', '504'],
  }
  const ENVIRONMENT: Parameter = { name: 'env', label: 'Environment', type: 'map', required: false, defaultValue: {} }
  const box = (row: HTMLElement, label: string) => within(row).getByRole('textbox', { name: label }) as HTMLInputElement

  it.each([
    ['a float 1.5 over Retry Delay 1', RETRY_DELAY, '1.5'],
    ['an integer 10 over Header row 1', HEADER_ROW, '10'],
  ] as const)('stores %s as typed', async (_case, parameter, typed) => {
    const { user, row } = renderRow({ parameter, initial: undefined })
    await user.click(box(row, parameter.label as string))
    await user.keyboard(typed)
    expect(box(row, parameter.label as string)).toHaveValue(typed)
    expect(state.value).toBe(typed)
    expect(within(row).getByTestId(`param-reset-${parameter.name}`)).toBeInTheDocument()
  })

  it('stores a list typed key by key over Retryable Codes', async () => {
    const { user, row } = renderRow({ parameter: RETRYABLE, initial: undefined })
    await user.click(box(row, 'Retryable Codes'))
    await user.keyboard('[["429"]')
    expect(box(row, 'Retryable Codes')).toHaveValue('["429"]')
    expect(state.value).toEqual(['429'])
  })

  it('stores a map typed key by key over an empty map default', async () => {
    const { user, row } = renderRow({ parameter: ENVIRONMENT, initial: undefined })
    await user.click(box(row, 'Environment'))
    await user.keyboard('{{"A": "1"}')
    expect(state.value).toEqual({ A: '1' })
  })

  it('names the problem of unfinished list text and holds Save while the field is still not set', async () => {
    const onValidationChange = vi.fn()
    const { user, row } = renderRow({ parameter: RETRYABLE, initial: undefined, onValidationChange })
    await user.click(box(row, 'Retryable Codes'))
    await user.keyboard('[["4')
    expect(state.value).toBeUndefined()
    expect(within(row).getByTestId('param-error-retryable_status_codes')).toHaveTextContent(/^Line 1: Unterminated string$/)
    expect(onValidationChange).toHaveBeenLastCalledWith('retryable_status_codes', 'Line 1: Unterminated string')
    expect(paintsTextMuted(box(row, 'Retryable Codes'), valueCell(row))).toBe(false)
  })

  it.each([
    ['text', REGION, 'Region', 'eu-west', 'eu-west'],
    ['list', TAGS, 'Tags', '["x", "y"]', ['x', 'y']],
  ] as const)('pasting the copied %s default back stores it as the user value', async (_kind, parameter, label, _line, stored) => {
    const { user, row } = renderRow({ parameter, initial: undefined })
    await user.click(box(row, label))
    await user.keyboard('{Control>}a{/Control}')
    await user.copy()
    await user.paste()
    expect(state.value).toEqual(stored)
    expect(paintsTextMuted(box(row, label), valueCell(row))).toBe(false)
    expect(within(row).getByTestId(`param-reset-${parameter.name}`)).toBeInTheDocument()
  })

  it('pasting the copied number default back stores the text a typed number stores', async () => {
    const { user, row } = renderRow({ parameter: RETRIES, initial: undefined })
    const numberBox = within(valueCell(row)).getByDisplayValue('5')
    await user.click(numberBox)
    await user.paste('5')
    expect(state.value).toBe('5')
    expect(within(row).getByTestId('param-reset-retries')).toBeInTheDocument()
  })
})

// Cipher Suites is the same typeable list field (FIELD-10): a list typed over its gray default sticks.
describe('ParameterRow Cipher Suites typed over its gray default (FIELD-10)', () => {
  const CIPHERS: Parameter = {
    name: 'cipher_suites',
    label: 'Cipher Suites',
    type: 'array',
    required: false,
    cipherPicker: true,
    cipherDefaultsBlock: 'http-client',
  }
  const DEFAULT_LINE = '["ECDHE-RSA-AES256-GCM-SHA384", "TLS_AES_128_GCM_SHA256"]'
  const cipherBox = (row: HTMLElement) => within(row).getByRole('textbox', { name: 'Cipher Suites' }) as HTMLInputElement

  it('stores a list typed key by key over the gray default', async () => {
    const { user, row } = renderRow({ parameter: CIPHERS, initial: undefined })
    await waitFor(() => expect(cipherBox(row)).toHaveValue(DEFAULT_LINE))
    await user.click(cipherBox(row))
    await user.keyboard('[["ECDHE-RSA-AES128-SHA"]')
    expect(cipherBox(row)).toHaveValue('["ECDHE-RSA-AES128-SHA"]')
    expect(state.value).toEqual(['ECDHE-RSA-AES128-SHA'])
    expect(paintsTextMuted(cipherBox(row), valueCell(row))).toBe(false)
  })

  it('takes a new list typed after select all + Backspace brought the gray default back', async () => {
    const { user, row } = renderRow({ parameter: CIPHERS, initial: ['ECDHE-RSA-AES128-SHA'] })
    await waitFor(() => expect(cipherBox(row)).toHaveValue('["ECDHE-RSA-AES128-SHA"]'))
    await user.click(cipherBox(row))
    await user.keyboard('{Control>}a{/Control}{Backspace}')
    expect(state.value).toBeUndefined()
    expect(cipherBox(row)).toHaveValue(DEFAULT_LINE)
    await user.keyboard('[["TLS_AES_128_GCM_SHA256"]')
    expect(state.value).toEqual(['TLS_AES_128_GCM_SHA256'])
  })
})
