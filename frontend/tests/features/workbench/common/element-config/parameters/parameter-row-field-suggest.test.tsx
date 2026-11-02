/**
 * ParameterRow - the OpenSearch rows that suggest names (Index pattern, Group by field, Sort by, Time field) draw
 * the one value field like every text row, with its expand column, and keep their suggestion list under its box.
 *
 * REQ-3.1.1.5, REQ-3.3.2.5, REQ-3.3.2.6; FIELD-1, FIELD-2, FIELD-3, OS-13
 */

import { useState } from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('@/features/workbench/api/opensearch-tools', () => ({
  checkOpenSearch: vi.fn(() => Promise.resolve({ issues: [] })),
  suggestOpenSearch: vi.fn(() => Promise.resolve({ from: 0, to: 0, items: [] })),
  startFields: vi.fn(() => new Promise(() => {})),
  getFields: vi.fn(() => new Promise(() => {})),
  cancelFields: vi.fn(() => Promise.resolve({ status: 'canceled' })),
}))

// The Edit value sheet is heavy (CodeMirror): a stand-in says what value it opened on.
vi.mock('@/features/workbench/common/variables/variable-inspect-modal/value-editor-sheet', () => ({
  ValueEditorSheet: ({ value }: { value: unknown }) => (
    <div data-testid="value-editor-sheet" data-value={String(value)} />
  ),
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
import {
  FieldSuggestContext,
  type FieldSuggestValue,
} from '@/features/workbench/common/element-config/parameters/field-suggest-context'
import { getInputParams } from '@/features/workbench/lib/node-parameters'
import { getValueColorClass } from '@/lib/variable-format'
import { SAMPLE_FIELDS, SAMPLE_INDEXES } from '../../../opensearch-fixtures'

const TEXT_MUTED = 'text-[color:var(--color-text-muted)]'
const SUGGESTING_ROWS = [
  ['index', 'Index pattern'],
  ['group_by_field', 'Group by field'],
  ['sort_by', 'Sort by'],
  ['time_field', 'Time field'],
] as const

// The sample fields plus a second date field, so the Time field list has more than its default to offer.
const FIELDS = [...SAMPLE_FIELDS, { name: 'event.created', types: ['date_nanos'], aggregatable: true }]

/** The block's own descriptor of the row. */
function openSearchRow(name: string): Parameter {
  const found = (getInputParams('opensearch') ?? []).find((parameter) => parameter.name === name)
  expect(found, `the OpenSearch block declares ${name}`).toBeDefined()
  return found as unknown as Parameter
}

function suggest(overrides: Partial<FieldSuggestValue> = {}): FieldSuggestValue {
  return {
    fields: FIELDS,
    indexes: SAMPLE_INDEXES,
    state: 'settled',
    start: vi.fn(),
    startIndexes: vi.fn(),
    ...overrides,
  }
}

/** What the row last wrote, as the config window keeps it. */
const written = { value: undefined as unknown }

function RowHarness({
  parameter,
  initial,
  context,
}: Readonly<{ parameter: Parameter; initial: unknown; context?: FieldSuggestValue }>) {
  const [value, setValue] = useState<unknown>(initial)
  const [expressionFields, setExpressionFields] = useState<string[]>([])
  written.value = value
  const row = (
    <table>
      <tbody>
        <ParameterRow
          mode="input"
          parameter={parameter}
          value={value}
          onChange={(next) => setValue(next)}
          availableVariables={[]}
          expressionFields={expressionFields}
          onExpressionFieldsChange={setExpressionFields}
          templateFields={[]}
          onTemplateFieldsChange={() => {}}
        />
      </tbody>
    </table>
  )
  return context ? <FieldSuggestContext value={context}>{row}</FieldSuggestContext> : row
}

function renderRow(name: string, { initial, context = suggest() }: { initial?: unknown; context?: FieldSuggestValue } = {}) {
  render(<RowHarness parameter={openSearchRow(name)} initial={initial} context={context} />)
  const row = screen.getByTestId(`param-row-${name}`)
  return { user: userEvent.setup(), row, box: () => within(row).getByTestId(`param-input-${name}`) }
}

const optionNames = () => screen.queryAllByRole('option').map((option) => option.getAttribute('data-value'))

function option(name: string): HTMLElement {
  const found = screen.getAllByRole('option').find((candidate) => candidate.getAttribute('data-value') === name)
  expect(found, `the list offers ${name}`).toBeDefined()
  return found as HTMLElement
}

describe('ParameterRow - the OpenSearch rows that suggest names draw the one value field', () => {
  it.each(SUGGESTING_ROWS)('%s is the combobox of the one field, with expand and {x} beside it', (name, label) => {
    const { row, box } = renderRow(name)
    expect(box()).toBe(within(row).getByRole('combobox', { name: label }))
    expect(box().closest('[data-slot="input-group"]')).not.toBeNull()
    expect(within(row).getByTestId(`param-expand-${name}`)).toBeInTheDocument()
    expect(within(row).getByTestId('expression-toggle')).toBeInTheDocument()
  })

  it('Time field not set shows its @timestamp default in gray, with no reset icon', () => {
    const { row, box } = renderRow('time_field')
    expect(box()).toHaveValue('@timestamp')
    expect(box()).toHaveClass(TEXT_MUTED)
    expect(within(row).queryByTestId('param-reset-time_field')).not.toBeInTheDocument()
    expect(written.value).toBeUndefined()
  })

  it('typing over the gray default replaces it with the user value', async () => {
    const { user, box } = renderRow('time_field')
    await user.type(box(), 'ts')
    expect(written.value).toBe('ts')
    expect(box()).toHaveValue('ts')
    expect(box()).toHaveClass(getValueColorClass('string'))
    expect(box()).not.toHaveClass(TEXT_MUTED)
  })

  it('a picked suggestion becomes the user value, and the reset icon brings the gray default back', async () => {
    const { user, row, box } = renderRow('time_field')
    await user.click(box())
    expect(optionNames()).toEqual(['@timestamp', 'event.created'])
    await user.click(option('event.created'))
    expect(written.value).toBe('event.created')
    expect(box()).toHaveValue('event.created')
    expect(box()).not.toHaveClass(TEXT_MUTED)

    await user.click(within(row).getByTestId('param-reset-time_field'))
    expect(written.value).toBeUndefined()
    expect(box()).toHaveValue('@timestamp')
    expect(box()).toHaveClass(TEXT_MUTED)
  })

  it('the list narrows to the fields holding the typed text', async () => {
    const { user, box } = renderRow('group_by_field')
    await user.type(box(), 'serv')
    expect(written.value).toBe('serv')
    expect(optionNames()).toEqual(['service.name', 'service.version'])
  })

  it('Group by field offers only aggregatable fields', async () => {
    const { user, box } = renderRow('group_by_field')
    await user.click(box())
    expect(optionNames()).toContain('host.name')
    expect(optionNames()).not.toContain('message')
  })

  it('Index pattern lists every pulled index whatever is typed', async () => {
    const { user, box } = renderRow('index')
    await user.type(box(), 'app-*')
    expect(optionNames()).toEqual(SAMPLE_INDEXES.map((index) => index.name))
  })

  it('the Index pattern footer starts the pull from the Index pattern row', async () => {
    const context = suggest({ fields: null, indexes: null, state: 'idle' })
    const { user, box } = renderRow('index', { context })
    await user.click(box())
    await user.click(screen.getByRole('button', { name: 'Get indexes' }))
    expect(context.startIndexes).toHaveBeenCalledTimes(1)
    expect(context.start).not.toHaveBeenCalled()
  })

  it('a field row shows the busy footer while the pull runs', async () => {
    const { user, box } = renderRow('sort_by', { context: suggest({ fields: null, indexes: null, state: 'reading' }) })
    await user.click(box())
    expect(screen.getByText('Getting fields...')).toBeInTheDocument()
  })

  it.each([
    ['group_by_field', 'No field'],
    ['sort_by', 'Time field'],
    ['index', 'logs-*'],
  ] as const)('%s shows its declared hint %s while its box holds no text, never <empty string>', (name, hint) => {
    const { row, box } = renderRow(name)
    expect(box()).toHaveValue('')
    expect(box()).toHaveAttribute('placeholder', hint)
    expect(within(row).queryByText('<empty string>')).not.toBeInTheDocument()
  })

  it('expand opens the Edit value sheet on the gray default', async () => {
    const { user, row } = renderRow('time_field')
    await user.click(within(row).getByTestId('param-expand-time_field'))
    expect(screen.getByTestId('value-editor-sheet')).toHaveAttribute('data-value', '@timestamp')
    expect(written.value).toBeUndefined()
  })

  it('in {x} mode the row is the expression box, with no list', async () => {
    const { user, row } = renderRow('time_field')
    await user.click(within(row).getByTestId('expression-toggle'))
    expect(within(row).getByTestId('param-input-time_field')).not.toHaveAttribute('role', 'combobox')
    expect(within(row).queryByRole('combobox')).not.toBeInTheDocument()
    expect(screen.queryAllByRole('option')).toHaveLength(0)
  })

  it('outside an OpenSearch sheet the row is the one value field with no list', () => {
    render(<RowHarness parameter={openSearchRow('time_field')} initial={undefined} />)
    const row = screen.getByTestId('param-row-time_field')
    const box = within(row).getByRole('textbox', { name: 'Time field' })
    expect(box).toHaveValue('@timestamp')
    expect(box).toHaveClass(TEXT_MUTED)
    expect(within(row).queryByRole('combobox')).not.toBeInTheDocument()
    expect(within(row).getByTestId('param-expand-time_field')).toBeInTheDocument()
  })
})
