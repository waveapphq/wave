/**
 * ParameterRow - a field opens its Edit value sheet or its file picker, never both, and switching
 * the field to an expression takes whichever is open away, asking first while it holds unsaved changes.
 * The expand button opens the field's editor; in {x} mode it opens the expression editor.
 *
 * Design Reference: FIELD-1, FIELD-7
 */

import { useState } from 'react'
import { describe, it, expect, vi } from 'vitest'
import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

function makeEditBodyStub(testid: string, changeValue: unknown) {
  return ({
    value,
    onChange,
    onValidChange,
  }: {
    value?: unknown
    onChange: (value: unknown, types?: unknown) => void
    onValidChange: (valid: boolean) => void
  }) => (
    <div data-testid={testid}>
      <output data-testid={`${testid}-value`}>{JSON.stringify(value ?? null)}</output>
      <button type="button" data-testid={`${testid}-change`} onClick={() => onChange(changeValue, {})}>
        change
      </button>
      <button type="button" data-testid={`${testid}-invalid`} onClick={() => onValidChange(false)}>
        invalid
      </button>
    </div>
  )
}

vi.mock('@/components/shared/variable-bodies/scalar-edit-body', () => ({
  ScalarEditBody: makeEditBodyStub('scalar-edit-body', 'artifact://typed.txt'),
}))

vi.mock('@/components/shared/variable-bodies/map-edit-body', () => ({
  MapEditBody: makeEditBodyStub('map-edit-body', { x: '1' }),
}))

vi.mock('@/features/workbench/api/opensearch-tools', () => ({
  checkOpenSearch: vi.fn(() => Promise.resolve({ issues: [] })),
  suggestOpenSearch: vi.fn(() => Promise.resolve({ from: 0, to: 0, items: [] })),
  startFields: vi.fn(() => new Promise(() => {})),
  getFields: vi.fn(() => new Promise(() => {})),
  cancelFields: vi.fn(() => Promise.resolve({ status: 'canceled' })),
}))

vi.mock('@/features/workbench/api/sql-tools', () => ({
  checkSql: vi.fn(() => Promise.resolve({ issues: [] })),
  startCatalog: vi.fn(() => new Promise(() => {})),
  getCatalog: vi.fn(() => new Promise(() => {})),
  cancelCatalog: vi.fn(() => Promise.resolve({ status: 'canceled' })),
}))

vi.mock('@/features/workbench/api/python-tools', () => ({
  checkPython: vi.fn(() => Promise.resolve({ issues: [] })),
  completePython: vi.fn(() => Promise.resolve({ items: [] })),
  renamePython: vi.fn(() => Promise.resolve({ edits: [] })),
}))

vi.mock('@/features/workbench/common/testdata/use-testdata', () => ({
  useTestData: () => ({
    listing: { entries: [], total_files: 0, total_bytes: 0 },
    loading: false,
    error: null,
    blockedReason: null,
    uploads: [],
    refresh: vi.fn(),
    upload: vi.fn(),
    createFolder: vi.fn(),
    rename: vi.fn(),
    remove: vi.fn(),
  }),
}))

vi.mock('@/features/workbench/hooks/use-session-artifacts', () => ({
  useSessionArtifacts: () => ({
    items: [],
    count: 0,
    totalBytes: 0,
    pollError: null,
    refresh: vi.fn(),
    remove: vi.fn(),
  }),
}))

import { ParameterRow } from '@/features/workbench/common/element-config/parameters/parameter-row'
import type { Parameter } from '@/features/workbench/common/element-config/parameters/parameter-table-types'
import {
  FieldSuggestContext,
  type FieldSuggestValue,
} from '@/features/workbench/common/element-config/parameters/field-suggest-context'
import { ChildEditorParent } from '../../../../../utils/child-editor-parent'
import { SAMPLE_FIELDS, SAMPLE_INDEXES } from '../../../opensearch-fixtures'

const DESTINATION: Parameter = {
  name: 'destination',
  label: 'Destination',
  type: 'string',
  required: false,
  fileReference: 'save-as',
}

const HEADERS: Parameter = { name: 'headers', label: 'Headers', type: 'map', required: false }

const SAVED = 'artifact://out/a.txt'

const REGION: Parameter = { name: 'region', label: 'Region', type: 'string', required: false, defaultValue: 'eu-west' }
const TAGS: Parameter = { name: 'tags', label: 'Tags', type: 'array', required: false, defaultValue: ['smoke', 'nightly'] }
const LABELS: Parameter = { name: 'labels', label: 'Labels', type: 'map', required: false, defaultValue: { team: 'qa' } }

// Each not-set field with a default, the body its editor draws and the value that body's change button writes.
const DEFAULT_EDITORS = [
  ['the Edit value sheet of a text field', REGION, 'scalar-edit-body', 'artifact://typed.txt'],
  ['the map editor of a map field', LABELS, 'map-edit-body', { x: '1' }],
] as const

function FieldHarness({
  parameter,
  initial,
  expression = false,
}: Readonly<{ parameter: Parameter; initial: unknown; expression?: boolean }>) {
  const [value, setValue] = useState<unknown>(initial)
  const [expressionFields, setExpressionFields] = useState<string[]>(expression ? [parameter.name] : [])
  const [templateFields, setTemplateFields] = useState<string[]>([])
  return (
    <ChildEditorParent>
      <output data-testid="row-value">{JSON.stringify(value)}</output>
      <table>
        <tbody>
          <ParameterRow
            mode="input"
            parameter={parameter}
            value={value}
            onChange={setValue}
            availableVariables={[]}
            expressionFields={expressionFields}
            onExpressionFieldsChange={setExpressionFields}
            templateFields={templateFields}
            onTemplateFieldsChange={setTemplateFields}
            runsOnRemoteHost={false}
            readOnly={false}
            testId="test-1"
          />
        </tbody>
      </table>
    </ChildEditorParent>
  )
}

function renderDestination() {
  render(<FieldHarness parameter={DESTINATION} initial={SAVED} />)
  return userEvent.setup()
}

const editor = () => screen.queryByTestId('value-editor-sheet')
const picker = () => screen.queryByTestId('file-reference-picker-sheet')
const question = () => screen.queryByTestId('unsaved-changes-dialog')
const rowValue = () => JSON.parse(screen.getByTestId('row-value').textContent ?? 'null') as unknown
const PULSE = /animate-sheet-select-pulse/

async function openEditor(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByTestId('param-expand-destination'))
}

async function openEditorWithChange(user: ReturnType<typeof userEvent.setup>) {
  await openEditor(user)
  await user.click(screen.getByTestId('scalar-edit-body-change'))
}

async function browse(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByTestId('param-browse-destination'))
}

async function openPickerWithPick(user: ReturnType<typeof userEvent.setup>) {
  await browse(user)
  const reference = screen.getByTestId('picker-reference-input')
  await user.clear(reference)
  await user.type(reference, 'picked.txt')
}

describe('Browse while the Edit value sheet is open', () => {
  it('closes a sheet with nothing unsaved and opens the picker without asking', async () => {
    const user = renderDestination()
    await openEditor(user)
    await browse(user)
    expect(question()).not.toBeInTheDocument()
    expect(editor()).not.toBeInTheDocument()
    expect(picker()).toBeInTheDocument()
  })

  it('asks Keep Editing, Close or Save while the sheet holds unsaved changes', async () => {
    const user = renderDestination()
    await openEditorWithChange(user)
    await browse(user)
    const dialog = question() as HTMLElement
    expect(within(dialog).getByTestId('unsaved-keep-editing')).toHaveTextContent('Keep Editing')
    expect(within(dialog).getByTestId('unsaved-close')).toHaveTextContent('Close')
    expect(within(dialog).getByTestId('unsaved-save')).toBeEnabled()
    expect(picker()).not.toBeInTheDocument()
  })

  it('leaves the sheet open, in front and pulsing, and opens no picker on Keep Editing', async () => {
    const user = renderDestination()
    await openEditorWithChange(user)
    await browse(user)
    await user.click(screen.getByTestId('unsaved-keep-editing'))
    expect(question()).not.toBeInTheDocument()
    expect(editor()).toHaveAttribute('data-active', 'true')
    expect((editor() as HTMLElement).className).toMatch(PULSE)
    expect(picker()).not.toBeInTheDocument()
    expect(rowValue()).toBe(SAVED)
  })

  it('discards the changes and opens the picker on the saved value on Close', async () => {
    const user = renderDestination()
    await openEditorWithChange(user)
    await browse(user)
    await user.click(screen.getByTestId('unsaved-close'))
    expect(editor()).not.toBeInTheDocument()
    expect(rowValue()).toBe(SAVED)
    expect(screen.getByTestId('picker-reference-input')).toHaveValue('out/a.txt')
  })

  it('writes the changes into the field and opens the picker on the new value on Save', async () => {
    const user = renderDestination()
    await openEditorWithChange(user)
    await browse(user)
    await user.click(screen.getByTestId('unsaved-save'))
    expect(editor()).not.toBeInTheDocument()
    expect(rowValue()).toBe('artifact://typed.txt')
    expect(screen.getByTestId('picker-reference-input')).toHaveValue('typed.txt')
  })

  it('disables Save and names the editor while the sheet cannot be saved', async () => {
    const user = renderDestination()
    await openEditorWithChange(user)
    await user.click(screen.getByTestId('scalar-edit-body-invalid'))
    await browse(user)
    const dialog = question() as HTMLElement
    expect(within(dialog).getByTestId('unsaved-save')).toBeDisabled()
    expect(within(dialog).getByText('Save is disabled: the Destination editor has errors')).toBeInTheDocument()
  })
})

describe('The field while the picker is open', () => {
  it('closes a picker with nothing picked and opens the Edit value sheet without asking', async () => {
    const user = renderDestination()
    await browse(user)
    await openEditor(user)
    expect(question()).not.toBeInTheDocument()
    expect(picker()).not.toBeInTheDocument()
    expect(editor()).toBeInTheDocument()
  })

  it('asks while the picker holds a pick not yet selected, and Close opens the Edit value sheet', async () => {
    const user = renderDestination()
    await openPickerWithPick(user)
    await openEditor(user)
    expect(question()).toBeInTheDocument()
    await user.click(screen.getByTestId('unsaved-close'))
    expect(picker()).not.toBeInTheDocument()
    expect(editor()).toBeInTheDocument()
    expect(rowValue()).toBe(SAVED)
  })

  it('writes the pick into the field on Save before the Edit value sheet opens', async () => {
    const user = renderDestination()
    await openPickerWithPick(user)
    await openEditor(user)
    await user.click(screen.getByTestId('unsaved-save'))
    expect(picker()).not.toBeInTheDocument()
    expect(editor()).toBeInTheDocument()
    expect(rowValue()).toBe('artifact://picked.txt')
  })
})

describe('Switching the field to an expression', () => {
  it('asks Keep Editing or Close, with no Save, while the Edit value sheet holds unsaved changes', async () => {
    const user = renderDestination()
    await openEditorWithChange(user)
    await user.click(screen.getByTestId('expression-toggle'))
    const dialog = question() as HTMLElement
    expect(within(dialog).getByTestId('unsaved-keep-editing')).toBeInTheDocument()
    expect(within(dialog).getByTestId('unsaved-close')).toBeInTheDocument()
    expect(within(dialog).queryByTestId('unsaved-save')).not.toBeInTheDocument()
  })

  it('stays literal with the sheet open and in front on Keep Editing', async () => {
    const user = renderDestination()
    await openEditorWithChange(user)
    await user.click(screen.getByTestId('expression-toggle'))
    await user.click(screen.getByTestId('unsaved-keep-editing'))
    expect(screen.getByTestId('expression-toggle')).toHaveAttribute('aria-pressed', 'false')
    expect(editor()).toHaveAttribute('data-active', 'true')
    expect((editor() as HTMLElement).className).toMatch(PULSE)
  })

  it('closes the sheet with its changes on Close, then asks the switch warning before it switches', async () => {
    const user = renderDestination()
    await openEditorWithChange(user)
    await user.click(screen.getByTestId('expression-toggle'))
    await user.click(screen.getByTestId('unsaved-close'))
    expect(editor()).not.toBeInTheDocument()
    expect(screen.getByTestId('switch-mode-dialog')).toBeInTheDocument()
    expect(screen.getByTestId('expression-toggle')).toHaveAttribute('aria-pressed', 'false')
    await user.click(screen.getByTestId('switch-mode-clear-empty'))
    expect(screen.getByTestId('expression-toggle')).toHaveAttribute('aria-pressed', 'true')
    expect(rowValue()).toBe("''")
  })

  it('closes the picker at once while nothing is picked, then asks the switch warning', async () => {
    const user = renderDestination()
    await browse(user)
    await user.click(screen.getByTestId('expression-toggle'))
    expect(question()).not.toBeInTheDocument()
    expect(picker()).not.toBeInTheDocument()
    expect(screen.getByTestId('switch-mode-dialog')).toBeInTheDocument()
    await user.click(screen.getByTestId('switch-mode-clear-default'))
    expect(screen.getByTestId('expression-toggle')).toHaveAttribute('aria-pressed', 'true')
  })

  it('opens neither sheet again when a field that holds nothing switches back to literal', async () => {
    render(<FieldHarness parameter={DESTINATION} initial={undefined} />)
    const user = userEvent.setup()
    await openEditor(user)
    await user.click(screen.getByTestId('expression-toggle'))
    await user.click(screen.getByTestId('expression-toggle'))
    expect(screen.getByTestId('expression-toggle')).toHaveAttribute('aria-pressed', 'false')
    expect(editor()).not.toBeInTheDocument()
    expect(picker()).not.toBeInTheDocument()
  })

  it('asks for a map editor holding unsaved changes and leaves it open on Keep Editing', async () => {
    render(<FieldHarness parameter={HEADERS} initial={{}} />)
    const user = userEvent.setup()
    await user.click(screen.getByTestId('param-expand-headers'))
    await user.click(screen.getByTestId('map-edit-body-change'))
    await user.click(screen.getByTestId('expression-toggle'))
    await user.click(screen.getByTestId('unsaved-keep-editing'))
    expect(screen.getByTestId('expression-toggle')).toHaveAttribute('aria-pressed', 'false')
    expect(editor()).toBeInTheDocument()
  })
})

describe('The expand button (FIELD-1)', () => {
  it('opens the Edit value sheet of a text field', async () => {
    const user = renderDestination()
    const expand = screen.getByTestId('param-expand-destination')
    expect(expand).toHaveAccessibleName('Open editor for Destination')
    await user.click(expand)
    expect(editor()).toBeInTheDocument()
    expect(screen.getByTestId('scalar-edit-body')).toBeInTheDocument()
  })

  it.each([
    ['Enter', '{Enter}'],
    ['Space', ' '],
  ])('opens the Edit value sheet on %s', async (_key, keys) => {
    const user = renderDestination()
    act(() => screen.getByTestId('param-expand-destination').focus())
    await user.keyboard(keys)
    expect(editor()).toBeInTheDocument()
  })

  it('opens the map editor of a map field', async () => {
    render(<FieldHarness parameter={HEADERS} initial={{ a: '1' }} />)
    await userEvent.setup().click(screen.getByTestId('param-expand-headers'))
    expect(editor()).toBeInTheDocument()
    expect(screen.getByTestId('map-edit-body')).toBeInTheDocument()
  })

  it('opens the table editor of a table field, and its Save writes the table back', async () => {
    const results: Parameter = { name: 'results', label: 'Results', type: 'table', required: false }
    render(<FieldHarness parameter={results} initial={{ columns: [{ name: 'name', type: 'string' }], rows: [['a']] }} />)
    const user = userEvent.setup()
    await user.click(screen.getByTestId('param-expand-results'))
    const cell = within(editor() as HTMLElement).getByTestId('table-cell-0-0')
    await user.clear(cell)
    await user.type(cell, 'b')
    await user.click(screen.getByTestId('value-editor-save-button'))
    expect(rowValue()).toEqual({ columns: [{ name: 'name', type: 'string' }], rows: [['b']] })
  })

  it('opens the expression editor in {x} mode, never the Edit value sheet', async () => {
    render(<FieldHarness parameter={DESTINATION} initial="base_dir" expression />)
    await userEvent.setup().click(screen.getByTestId('param-expand-destination'))
    expect(screen.getByTestId('expression-editor-modal')).toBeInTheDocument()
    expect(editor()).not.toBeInTheDocument()
  })

  it('opens nothing when the field text itself is clicked', async () => {
    const user = renderDestination()
    await user.click(screen.getByRole('textbox', { name: 'Destination' }))
    expect(editor()).not.toBeInTheDocument()
    expect(screen.getByTestId('param-expand-destination')).toBeInTheDocument()
  })
})

describe('Expand on a field that is not set and has a default (FIELD-2)', () => {
  const sheet = () => editor() as HTMLElement
  const draftOf = (body: string) =>
    JSON.parse(within(sheet()).getByTestId(`${body}-value`).textContent ?? 'null') as unknown

  it.each(DEFAULT_EDITORS)('opens %s with the default filled in', async (_what, parameter, body) => {
    render(<FieldHarness parameter={parameter} initial={undefined} />)
    await userEvent.setup().click(screen.getByTestId(`param-expand-${parameter.name}`))
    expect(within(sheet()).getByTestId(body)).toBeInTheDocument()
    expect(draftOf(body)).toEqual(parameter.defaultValue)
  })

  it.each(DEFAULT_EDITORS)('keeps the field not set after Save and Close with no change in %s', async (_what, parameter) => {
    render(<FieldHarness parameter={parameter} initial={undefined} />)
    const user = userEvent.setup()
    await user.click(screen.getByTestId(`param-expand-${parameter.name}`))
    await user.click(within(sheet()).getByTestId('value-editor-save-button'))
    await user.click(within(sheet()).getByTestId('value-editor-cancel-button'))
    expect(editor()).not.toBeInTheDocument()
    expect(question()).not.toBeInTheDocument()
    expect(screen.getByTestId('row-value')).toBeEmptyDOMElement()
    expect(screen.queryByTestId(`param-reset-${parameter.name}`)).not.toBeInTheDocument()
  })

  it.each(DEFAULT_EDITORS)('makes any edit in %s the user value on Save', async (_what, parameter, body, written) => {
    render(<FieldHarness parameter={parameter} initial={undefined} />)
    const user = userEvent.setup()
    await user.click(screen.getByTestId(`param-expand-${parameter.name}`))
    await user.click(within(sheet()).getByTestId(`${body}-change`))
    await user.click(within(sheet()).getByTestId('value-editor-save-button'))
    expect(rowValue()).toEqual(written)
    expect(screen.getByTestId(`param-reset-${parameter.name}`)).toBeInTheDocument()
  })

  it('opens the list editor of a list field with the default items filled in', async () => {
    render(<FieldHarness parameter={TAGS} initial={undefined} />)
    await userEvent.setup().click(screen.getByTestId('param-expand-tags'))
    expect(within(sheet()).getByTestId('array-edit-input-0')).toHaveValue('smoke')
    expect(within(sheet()).getByTestId('array-edit-input-1')).toHaveValue('nightly')
  })

  it('keeps a list field not set after Save and Close with no change in the list editor', async () => {
    render(<FieldHarness parameter={TAGS} initial={undefined} />)
    const user = userEvent.setup()
    await user.click(screen.getByTestId('param-expand-tags'))
    await user.click(within(sheet()).getByTestId('value-editor-save-button'))
    await user.click(within(sheet()).getByTestId('value-editor-cancel-button'))
    expect(editor()).not.toBeInTheDocument()
    expect(screen.getByTestId('row-value')).toBeEmptyDOMElement()
    expect(screen.queryByTestId('param-reset-tags')).not.toBeInTheDocument()
  })

  it('makes an edit of a default item in the list editor the user value on Save', async () => {
    render(<FieldHarness parameter={TAGS} initial={undefined} />)
    const user = userEvent.setup()
    await user.click(screen.getByTestId('param-expand-tags'))
    await user.type(within(sheet()).getByTestId('array-edit-input-0'), '-1')
    await user.click(within(sheet()).getByTestId('value-editor-save-button'))
    expect(rowValue()).toEqual(['smoke-1', 'nightly'])
    expect(screen.getByTestId('param-reset-tags')).toBeInTheDocument()
  })

  it('opens the Edit value sheet of a field that holds a value with that value, not the default', async () => {
    render(<FieldHarness parameter={REGION} initial="us-east" />)
    await userEvent.setup().click(screen.getByTestId('param-expand-region'))
    expect(draftOf('scalar-edit-body')).toBe('us-east')
  })
})

describe('Expand on empty text and on null (FIELD-4, FIELD-5)', () => {
  const NOTE: Parameter = { name: 'note', label: 'Note', type: 'string', required: false, acceptsNull: true }
  const draft = () =>
    JSON.parse(within(editor() as HTMLElement).getByTestId('scalar-edit-body-value').textContent ?? 'null') as unknown

  it('opens the string editor empty on a field holding empty text', async () => {
    render(<FieldHarness parameter={{ ...NOTE, acceptsNull: undefined }} initial="" />)
    await userEvent.setup().click(screen.getByTestId('param-expand-note'))
    expect(draft()).toBe('')
  })

  it('keeps empty text after Save and Close with no change', async () => {
    render(<FieldHarness parameter={{ ...NOTE, acceptsNull: undefined }} initial="" />)
    const user = userEvent.setup()
    await user.click(screen.getByTestId('param-expand-note'))
    await user.click(screen.getByTestId('value-editor-save-button'))
    await user.click(screen.getByTestId('value-editor-cancel-button'))
    expect(editor()).not.toBeInTheDocument()
    expect(rowValue()).toBe('')
  })

  it('keeps a stored null after Save and Close with no change in the editor', async () => {
    render(<FieldHarness parameter={NOTE} initial={null} />)
    const user = userEvent.setup()
    await user.click(screen.getByTestId('param-expand-note'))
    expect(editor()).toBeInTheDocument()
    await user.click(screen.getByTestId('value-editor-save-button'))
    await user.click(screen.getByTestId('value-editor-cancel-button'))
    expect(editor()).not.toBeInTheDocument()
    expect(question()).not.toBeInTheDocument()
    expect(rowValue()).toBeNull()
    expect(screen.getByTestId('param-null-note')).toHaveAttribute('aria-pressed', 'true')
  })
})

// Record-row list settings: one line on the row, the shared list editor behind expand (FIELD-10, SHRUN-4, OS-6, OS-7).
const records = (...values: unknown[]) => values.map((value) => ({ value }))
const argumentsOf = (label: string): Parameter => ({
  name: 'arguments',
  label,
  type: 'array',
  required: false,
  noExpression: true,
  orderedList: { itemNoun: 'argument', positionPrefix: '$' },
})
const OUT_ARGUMENTS: Parameter = {
  name: 'out_arguments',
  label: 'Out arguments',
  type: 'array',
  required: false,
  noExpression: true,
  orderedList: { itemNoun: 'argument', positionPrefix: '' },
}
const FIELDS: Parameter = {
  name: 'fields',
  label: 'Fields',
  type: 'array',
  required: false,
  defaultValue: [{ value: '@timestamp' }],
  orderedList: { itemNoun: 'field', positionPrefix: '', entry: 'field' },
}
const STATS: Parameter = {
  name: 'stats',
  label: 'Stats',
  type: 'array',
  required: false,
  defaultValue: [{ value: { stat: 'count' } }],
  orderedList: { itemNoun: 'stat', positionPrefix: '', entry: 'stat' },
}
const SETTLED_FIELDS: FieldSuggestValue = {
  fields: SAMPLE_FIELDS,
  indexes: SAMPLE_INDEXES,
  state: 'settled',
  start: vi.fn(),
}

function ListHarness({
  parameter,
  initial,
  expressionFields: initialFields = [],
}: Readonly<{ parameter: Parameter; initial: unknown; expressionFields?: string[] }>) {
  const [value, setValue] = useState<unknown>(initial)
  const [expressionFields, setExpressionFields] = useState<string[]>(initialFields)
  return (
    <FieldSuggestContext value={SETTLED_FIELDS}>
      <ChildEditorParent>
        <output data-testid="row-value">{JSON.stringify(value)}</output>
        <output data-testid="row-expression-fields">{JSON.stringify(expressionFields)}</output>
        <table>
          <tbody>
            <ParameterRow
              mode="input"
              parameter={parameter}
              value={value}
              onChange={setValue}
              availableVariables={[]}
              expressionFields={expressionFields}
              onExpressionFieldsChange={setExpressionFields}
              templateFields={[]}
              onTemplateFieldsChange={() => {}}
              runsOnRemoteHost={false}
              readOnly={false}
              testId="test-1"
            />
          </tbody>
        </table>
      </ChildEditorParent>
    </FieldSuggestContext>
  )
}

function renderList(parameter: Parameter, initial: unknown, expressionFields: string[] = []) {
  render(<ListHarness parameter={parameter} initial={initial} expressionFields={expressionFields} />)
  return { user: userEvent.setup(), row: screen.getByTestId(`param-row-${parameter.name}`) }
}

const rowExpressionFields = () =>
  JSON.parse(screen.getByTestId('row-expression-fields').textContent ?? '[]') as string[]
const listBody = () => within(editor() as HTMLElement).getByTestId('array-edit-body')
const positionLabels = () => within(listBody()).getAllByTestId('array-edit-index').map((cell) => cell.textContent)

/** The deepest element of the row showing exactly this line, or a field holding it as its value. */
function shownLine(row: HTMLElement, line: string | RegExp): HTMLElement | undefined {
  const matches = (text: string) => (typeof line === 'string' ? text === line : line.test(text))
  const field = Array.from(row.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input, textarea')).find(
    (control) => matches(control.value),
  )
  if (field) return field
  return Array.from(row.querySelectorAll<HTMLElement>('*')).find(
    (element) =>
      matches(element.textContent ?? '') &&
      !Array.from(element.children).some((child) => matches(child.textContent ?? '')),
  )
}

function expectNoInlineRows(row: HTMLElement): void {
  expect(within(row).queryAllByRole('listitem')).toHaveLength(0)
  expect(screen.queryAllByTestId(/^ordered-/)).toHaveLength(0)
  expect(editor()).not.toBeInTheDocument()
}

describe.each([
  ['Shell Script', argumentsOf('Arguments')],
  ['Python', argumentsOf('Arguments')],
])('%s Arguments row: a one-line list field over the stored record rows (FIELD-10)', (_block, parameter) => {
  it('draws the stored rows as one line, the {x} row as {{ expr }}, with no inline rows', () => {
    const { row } = renderList(parameter, records('a', 'run_id'), ['arguments.1.value'])
    expect(shownLine(row, '["a", {{ run_id }}]')).toBeDefined()
    expect(within(row).getByTestId('param-expand-arguments')).toHaveAccessibleName('Open editor for Arguments')
    expectNoInlineRows(row)
  })

  it('opens the shared list editor from expand with $1 labels and the {x} row in its expression slot', async () => {
    const { user } = renderList(parameter, records('a', 'run_id'), ['arguments.1.value'])
    await user.click(screen.getByTestId('param-expand-arguments'))
    expect(positionLabels()).toEqual(['$1', '$2'])
    expect(within(listBody()).getByTestId('array-edit-input-0')).toHaveValue('a')
    expect(within(listBody()).getByTestId('array-expr-value-1')).toHaveTextContent(/^run_id$/)
    expect(within(listBody()).getByTestId('array-expr-toggle-1')).toHaveAttribute('aria-pressed', 'true')
    expect(within(listBody()).getByTestId('array-expr-toggle-0')).toHaveAttribute('aria-pressed', 'false')
  })

  it('saves an edit back as stored record rows and keeps the dotted {x} flag of the other row', async () => {
    const { user } = renderList(parameter, records('a', 'run_id'), ['script', 'arguments.1.value'])
    await user.click(screen.getByTestId('param-expand-arguments'))
    await user.type(within(listBody()).getByTestId('array-edit-input-0'), 'b')
    await user.click(screen.getByTestId('value-editor-save-button'))
    expect(rowValue()).toEqual(records('ab', 'run_id'))
    expect([...rowExpressionFields()].sort()).toEqual(['arguments.1.value', 'script'])
  })

  it('names the editor rows by the argument noun: Add, value, move and remove (SHRUN-4)', async () => {
    const { user } = renderList(parameter, records('a', 'b'))
    await user.click(screen.getByTestId('param-expand-arguments'))
    const body = listBody()
    expect(within(body).getByRole('button', { name: 'Add argument' })).toBeInTheDocument()
    expect(within(body).getByRole('textbox', { name: 'Argument $2 value' })).toHaveValue('b')
    expect(within(body).getByRole('button', { name: 'Move argument $2 up' })).toBeInTheDocument()
    expect(within(body).getByRole('button', { name: 'Remove argument $2' })).toBeInTheDocument()
    expect(within(body).queryByRole('button', { name: /item/i })).not.toBeInTheDocument()
  })

  it('saves a row turned into {x} in the editor as its dotted flag, its text cleared by the switch', async () => {
    const { user } = renderList(parameter, records('a', 'b'))
    await user.click(screen.getByTestId('param-expand-arguments'))
    await user.click(within(listBody()).getByTestId('array-expr-toggle-0'))
    await user.click(screen.getByRole('button', { name: 'Clear' }))
    await user.click(screen.getByTestId('value-editor-save-button'))
    expect(rowExpressionFields()).toEqual(['arguments.0.value'])
    expect(rowValue()).toEqual(records('', 'b'))
  })
})

describe('A plain list row: per-item {x} in the list editor (FIELD-6)', () => {
  const TARGETS: Parameter = { name: 'targets', label: 'Targets', type: 'array', required: false }
  const toggle = (index: number) => within(listBody()).getByTestId(`array-expr-toggle-${index}`)
  const openTargets = (user: ReturnType<typeof userEvent.setup>) => user.click(screen.getByTestId('param-expand-targets'))
  const save = (user: ReturnType<typeof userEvent.setup>) => user.click(screen.getByTestId('value-editor-save-button'))

  it('opens an {x} item as {x} and a plain item as plain text', async () => {
    const { user } = renderList(TARGETS, ['web-1', 'backup_host'], ['targets.1'])
    await openTargets(user)
    expect(within(listBody()).getByTestId('array-edit-input-0')).toHaveValue('web-1')
    expect(toggle(0)).toHaveAttribute('aria-pressed', 'false')
    expect(within(listBody()).getByTestId('array-expr-value-1')).toHaveTextContent(/^backup_host$/)
    expect(toggle(1)).toHaveAttribute('aria-pressed', 'true')
    expect(within(listBody()).queryByTestId('array-edit-input-1')).not.toBeInTheDocument()
  })

  it('reports the {x} item index on Save and keeps the flags of the other fields', async () => {
    const { user } = renderList(TARGETS, ['web-1', 'backup_host'], ['url', 'targets.1'])
    await openTargets(user)
    await user.type(within(listBody()).getByTestId('array-edit-input-0'), '0')
    await save(user)
    expect(rowValue()).toEqual(['web-10', 'backup_host'])
    expect([...rowExpressionFields()].sort()).toEqual(['targets.1', 'url'])
  })

  it('saves an item turned into {x} as its dotted flag, its text cleared by the switch', async () => {
    const { user } = renderList(TARGETS, ['web-1', 'backup_host'])
    await openTargets(user)
    await user.click(toggle(1))
    await user.click(screen.getByRole('button', { name: 'Clear' }))
    await save(user)
    expect(rowExpressionFields()).toEqual(['targets.1'])
    expect(rowValue()).toEqual(['web-1', ''])
  })

  it('drops the dotted flag of an item taken out of {x}, its expression cleared to the type default', async () => {
    const { user, row } = renderList(TARGETS, ['web-1', 'backup_host'], ['targets.1'])
    await openTargets(user)
    await user.click(toggle(1))
    await user.click(screen.getByRole('button', { name: 'Clear' }))
    await save(user)
    expect(rowExpressionFields()).toEqual([])
    expect(shownLine(row, '["web-1", ""]')).toBeDefined()
  })

  it('keeps the {x} flag on the same item when an item above it is deleted', async () => {
    const { user, row } = renderList(TARGETS, ['web-1', 'db-1', 'backup_host'], ['targets.2'])
    await openTargets(user)
    await user.click(within(listBody()).getByTestId('array-remove-0'))
    await save(user)
    expect(rowValue()).toEqual(['db-1', 'backup_host'])
    expect(rowExpressionFields()).toEqual(['targets.1'])
    expect(shownLine(row, '["db-1", {{ backup_host }}]')).toBeDefined()
  })

  it('keeps the {x} flag on the item it moves with', async () => {
    const { user, row } = renderList(TARGETS, ['web-1', 'backup_host'], ['targets.1'])
    await openTargets(user)
    await user.click(within(listBody()).getByTestId('array-move-up-1'))
    await save(user)
    expect(rowValue()).toEqual(['backup_host', 'web-1'])
    expect(rowExpressionFields()).toEqual(['targets.0'])
    expect(shownLine(row, '[{{ backup_host }}, "web-1"]')).toBeDefined()
  })

  it('keeps the Visual / Code switch in its Edit value sheet', async () => {
    const { user } = renderList(TARGETS, ['web-1', 'backup_host'], ['targets.1'])
    await openTargets(user)
    expect(within(editor() as HTMLElement).getByTestId('view-dropdown')).toBeInTheDocument()
  })
})

describe('A record-row list keeps its Visual-only editor (FIELD-10, SHRUN-4, OS-6, OS-7)', () => {
  it.each([
    ['Arguments', argumentsOf('Arguments'), records('a')],
    ['Out arguments', OUT_ARGUMENTS, records('status')],
    ['Fields', FIELDS, records('@timestamp')],
    ['Stats', STATS, records({ stat: 'count' })],
  ] as const)('offers no Visual / Code switch in the %s editor', async (_label, parameter, rows) => {
    const { user } = renderList(parameter, rows)
    await user.click(screen.getByTestId(`param-expand-${parameter.name}`))
    expect(within(listBody()).getByTestId('array-edit-input-0')).toBeInTheDocument()
    expect(within(editor() as HTMLElement).queryByTestId('view-dropdown')).not.toBeInTheDocument()
  })
})

describe('A record-row list holding something that is not a list', () => {
  it('opens its editor with no rows', async () => {
    const { user } = renderList(argumentsOf('Arguments'), 'not a list')
    await user.click(screen.getByTestId('param-expand-arguments'))
    expect(within(listBody()).queryByTestId('array-edit-input-0')).not.toBeInTheDocument()
  })
})

describe('SQL Out arguments row: a one-line list field with per-item {x} (FIELD-10, SQL-6)', () => {
  it('draws the stored rows as one line with no inline rows', () => {
    const { row } = renderList(OUT_ARGUMENTS, records('status', 'total'), ['out_arguments.1.value'])
    expect(shownLine(row, '["status", {{ total }}]')).toBeDefined()
    expectNoInlineRows(row)
  })

  it('opens the shared list editor numbered from one, with a {x} toggle on every row', async () => {
    const { user } = renderList(OUT_ARGUMENTS, records('status', 'total'))
    await user.click(screen.getByTestId('param-expand-out_arguments'))
    expect(positionLabels()).toEqual(['1', '2'])
    expect(within(listBody()).getByTestId('array-edit-input-1')).toHaveValue('total')
    expect(within(listBody()).getByTestId('array-expr-toggle-0')).toBeInTheDocument()
    expect(within(listBody()).getByTestId('array-expr-toggle-1')).toBeInTheDocument()
    expect(within(listBody()).getByRole('textbox', { name: 'Argument 2 value' })).toHaveValue('total')
    expect(within(listBody()).getByRole('button', { name: 'Add argument' })).toBeInTheDocument()
  })

  it('saves the rows back as stored record rows', async () => {
    const { user } = renderList(OUT_ARGUMENTS, records('status'))
    await user.click(screen.getByTestId('param-expand-out_arguments'))
    await user.click(within(listBody()).getByTestId('array-add-item'))
    await user.type(within(listBody()).getByTestId('array-edit-input-1'), 'total')
    await user.click(screen.getByTestId('value-editor-save-button'))
    expect(rowValue()).toEqual(records('status', 'total'))
  })
})

describe('OpenSearch Fields row: a one-line list field whose expand opens the Fields editor (FIELD-10, OS-6)', () => {
  it('draws the stored rows as one line, the {x} row as {{ expr }}, with no inline rows', () => {
    const { row } = renderList(FIELDS, records('@timestamp', 'time_field'), ['fields.1.value'])
    expect(shownLine(row, '["@timestamp", {{ time_field }}]')).toBeDefined()
    expectNoInlineRows(row)
  })

  it('opens the Fields editor: each row in the field box, numbered from one', async () => {
    const { user } = renderList(FIELDS, records('@timestamp', 'message'))
    await user.click(screen.getByTestId('param-expand-fields'))
    expect(positionLabels()).toEqual(['1', '2'])
    expect(within(listBody()).getByTestId('array-edit-input-0')).toHaveRole('combobox')
    expect(within(listBody()).getByTestId('array-edit-input-1')).toHaveValue('message')
    expect(within(listBody()).getByRole('button', { name: 'Add field' })).toBeInTheDocument()
    expect(within(listBody()).getByRole('button', { name: 'Remove field 2' })).toBeInTheDocument()
    expect(within(listBody()).getByRole('combobox', { name: 'Field 2 value' })).toHaveValue('message')
  })

  it('opens the Fields editor of a field that is not set with the default rows filled in', async () => {
    const { user } = renderList(FIELDS, undefined)
    await user.click(screen.getByTestId('param-expand-fields'))
    expect(within(listBody()).getByTestId('array-edit-input-0')).toHaveValue('@timestamp')
  })

  it('saves a typed field name back as stored record rows', async () => {
    const { user } = renderList(FIELDS, records('@timestamp'))
    await user.click(screen.getByTestId('param-expand-fields'))
    await user.click(within(listBody()).getByTestId('array-add-item'))
    await user.type(within(listBody()).getByTestId('array-edit-input-1'), 'geo.city')
    await user.click(screen.getByTestId('value-editor-save-button'))
    expect(rowValue()).toEqual(records('@timestamp', 'geo.city'))
  })
})

describe('OpenSearch Stats row: a one-line list field whose expand opens the Stats editor (FIELD-10, OS-7)', () => {
  it('draws the stored stats as one line with no inline rows', () => {
    const { row } = renderList(STATS, records({ stat: 'count' }, { stat: 'sum', field: 'bytes' }))
    expect(shownLine(row, '[{"stat": "count"}, {"stat": "sum", "field": "bytes"}]')).toBeDefined()
    expectNoInlineRows(row)
  })

  it('draws a stat row held as {x} as {{ expr }}', () => {
    const { row } = renderList(STATS, records('stat_entry', { stat: 'count' }), ['stats.0.value'])
    expect(shownLine(row, '[{{ stat_entry }}, {"stat": "count"}]')).toBeDefined()
  })

  it('opens the Stats editor: each row read in words on its trigger, numbered from one', async () => {
    const { user } = renderList(STATS, records({ stat: 'count' }, { stat: 'sum', field: 'bytes' }))
    await user.click(screen.getByTestId('param-expand-stats'))
    expect(positionLabels()).toEqual(['1', '2'])
    expect(within(listBody()).getByRole('button', { name: 'Stat 1: Count' })).toBeInTheDocument()
    expect(within(listBody()).getByRole('button', { name: 'Stat 2: Sum of bytes' })).toBeInTheDocument()
    expect(within(listBody()).getByRole('button', { name: 'Add stat' })).toBeInTheDocument()
    expect(within(listBody()).getByRole('button', { name: 'Move stat 2 up' })).toBeInTheDocument()
  })

  it('saves a removed stat back as stored record rows', async () => {
    const { user } = renderList(STATS, records({ stat: 'count' }, { stat: 'sum', field: 'bytes' }))
    await user.click(screen.getByTestId('param-expand-stats'))
    await user.click(within(listBody()).getByTestId('array-remove-0'))
    await user.click(screen.getByTestId('value-editor-save-button'))
    expect(rowValue()).toEqual(records({ stat: 'sum', field: 'bytes' }))
  })
})
