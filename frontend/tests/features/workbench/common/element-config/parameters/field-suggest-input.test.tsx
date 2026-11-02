/**
 * Field suggestions on rows: a combobox over the block's pulled fields or indexes, filtered by the typed text and by
 * kind (date, aggregatable, numeric), with a footer that starts or retries the pull. Free text is always accepted.
 * Outside an OpenSearch sheet the input is a plain text box.
 *
 * Design Reference: OS-13
 * REQ-3.3.2.5: OpenSearch index pattern selection (wildcards, date math)
 * REQ-3.3.2.6: OpenSearch field-based filtering and queries
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useState, type ComponentProps, type ContextType } from 'react'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('@/features/workbench/api/opensearch-tools', () => ({
  checkOpenSearch: vi.fn(() => Promise.resolve({ issues: [] })),
  suggestOpenSearch: vi.fn(() => Promise.resolve({ from: 0, to: 0, items: [] })),
  startFields: vi.fn(() => new Promise(() => {})),
  getFields: vi.fn(() => new Promise(() => {})),
  cancelFields: vi.fn(() => Promise.resolve({ status: 'canceled' })),
}))

import { FieldSuggestInput } from '@/features/workbench/common/element-config/parameters/field-suggest-input'
import { EntryBox } from '@/components/shared/variable-bodies/body-parts'
import { FieldSuggestContext } from '@/features/workbench/common/element-config/parameters/field-suggest-context'
import type { OpenSearchField } from '@/features/workbench/api/opensearch-tools'
import {
  SAMPLE_FIELDS,
  SAMPLE_FIELDS_REQUEST,
  SAMPLE_INDEXES,
  SAMPLE_OS_CONNECTION,
} from '../../../opensearch-fixtures'

type FieldSuggestValue = ContextType<typeof FieldSuggestContext>
type InputProps = ComponentProps<typeof FieldSuggestInput>

const NUMERIC_TYPES = [
  'long',
  'integer',
  'short',
  'byte',
  'double',
  'float',
  'half_float',
  'scaled_float',
  'unsigned_long',
]

/** One field per type, for the kind filters. */
const TYPED_FIELDS: readonly OpenSearchField[] = [
  ...NUMERIC_TYPES.map((type) => ({ name: `n_${type}`, types: [type], aggregatable: true })),
  { name: 'event.created', types: ['date_nanos'], aggregatable: true },
  { name: '@timestamp', types: ['date'], aggregatable: true },
  { name: 'client.ip', types: ['ip'], aggregatable: true },
  { name: 'is_error', types: ['boolean'], aggregatable: true },
  { name: 'log.level', types: ['keyword'], aggregatable: true },
  { name: 'message', types: ['text'], aggregatable: false },
]

function suggest(overrides: Partial<FieldSuggestValue> = {}): FieldSuggestValue {
  return {
    fields: SAMPLE_FIELDS,
    indexes: SAMPLE_INDEXES,
    state: 'settled',
    start: vi.fn(),
    ...overrides,
  }
}

interface HarnessProps extends Partial<Omit<InputProps, 'value' | 'onChange'>> {
  initialValue?: string
  context?: FieldSuggestValue
  onChange: (value: string) => void
}

/** Holds the value the way a row does; without a context the default applies. */
function Harness({ initialValue = '', context, onChange, ...props }: Readonly<HarnessProps>) {
  const [value, setValue] = useState(initialValue)
  const input = (
    <FieldSuggestInput
      source="fields"
      ariaLabel="Time field"
      {...props}
      value={value}
      onChange={(next) => {
        onChange(next)
        setValue(next)
      }}
    />
  )
  return context ? <FieldSuggestContext value={context}>{input}</FieldSuggestContext> : input
}

function renderInput(props: Partial<Omit<HarnessProps, 'onChange'>> = {}) {
  const onChange = vi.fn()
  render(<Harness onChange={onChange} {...props} />)
  return { onChange }
}

function optionNames(): string[] {
  return screen.getAllByRole('option').map((option) => option.getAttribute('data-value') ?? '')
}

/** The option whose own name is exactly `name`, read from its first text line. */
function option(name: string): HTMLElement {
  const found = screen.getAllByRole('option').find((candidate) => candidate.getAttribute('data-value') === name)
  expect(found).toBeDefined()
  return found as HTMLElement
}

function hasOption(name: string): boolean {
  return screen.queryAllByRole('option').some((candidate) => candidate.getAttribute('data-value') === name)
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('FieldSuggestInput', () => {
  describe('outside an OpenSearch sheet (default context)', () => {
    it('renders a plain text box named by its label', () => {
      renderInput()
      expect(screen.getByRole('textbox', { name: 'Time field' })).toBeInTheDocument()
      expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
    })

    it('writes what is typed', async () => {
      const user = userEvent.setup()
      const { onChange } = renderInput()

      await user.type(screen.getByRole('textbox', { name: 'Time field' }), 'ts')

      expect(onChange).toHaveBeenLastCalledWith('ts')
    })

    it('shows the placeholder and marks an invalid value', () => {
      renderInput({ placeholder: 'No field', invalid: true })
      const box = screen.getByRole('textbox', { name: 'Time field' })
      expect(box).toHaveAttribute('placeholder', 'No field')
      expect(box).toHaveAttribute('aria-invalid', 'true')
    })

    it('offers no Get fields row', () => {
      renderInput()
      expect(screen.queryByRole('button', { name: 'Get fields' })).not.toBeInTheDocument()
    })
  })

  describe('the combobox over the pulled fields', () => {
    it('is a combobox named by its label, closed at first', () => {
      renderInput({ context: suggest() })
      const combobox = screen.getByRole('combobox', { name: 'Time field' })
      expect(combobox).toHaveAttribute('aria-expanded', 'false')
    })

    it('lists every pulled field in the order the server gave', async () => {
      const user = userEvent.setup()
      renderInput({ context: suggest() })

      await user.click(screen.getByRole('combobox', { name: 'Time field' }))

      expect(screen.getByRole('combobox', { name: 'Time field' })).toHaveAttribute('aria-expanded', 'true')
      expect(optionNames()).toEqual(SAMPLE_FIELDS.map((field) => field.name))
    })

    it('shows each field with its types', async () => {
      const user = userEvent.setup()
      renderInput({ context: suggest() })

      await user.click(screen.getByRole('combobox', { name: 'Time field' }))

      expect(within(option('@timestamp')).getByText('date')).toBeInTheDocument()
      expect(within(option('latency_ms')).getByText('long')).toBeInTheDocument()
      expect(option('status')).toHaveTextContent(/keyword/)
      expect(option('status')).toHaveTextContent(/long/)
    })

    it('lists the fields for a done pull too', async () => {
      const user = userEvent.setup()
      renderInput({ context: suggest({ state: 'done' }) })

      await user.click(screen.getByRole('combobox', { name: 'Time field' }))

      expect(optionNames()).toHaveLength(SAMPLE_FIELDS.length)
    })

    it('narrows the list to names holding the typed text, whatever the case', async () => {
      const user = userEvent.setup()
      renderInput({ context: suggest() })

      await user.type(screen.getByRole('combobox', { name: 'Time field' }), 'SERVICE')

      expect(optionNames()).toEqual(['service.name', 'service.version'])
    })

    it('writes a picked field', async () => {
      const user = userEvent.setup()
      const { onChange } = renderInput({ context: suggest() })

      await user.click(screen.getByRole('combobox', { name: 'Time field' }))
      await user.click(option('trace.id'))

      expect(onChange).toHaveBeenLastCalledWith('trace.id')
      expect(screen.getByRole('combobox', { name: 'Time field' })).toHaveValue('trace.id')
    })

    it('accepts a name the list does not hold', async () => {
      const user = userEvent.setup()
      const { onChange } = renderInput({ context: suggest() })

      await user.type(screen.getByRole('combobox', { name: 'Time field' }), 'no.such.field')

      expect(onChange).toHaveBeenLastCalledWith('no.such.field')
      expect(screen.getByRole('combobox', { name: 'Time field' })).toHaveValue('no.such.field')
    })

    it('puts no length cap on a field name', () => {
      const long = `nested.${'deep.'.repeat(30)}leaf`
      renderInput({ context: suggest(), initialValue: long })

      const combobox = screen.getByRole('combobox', { name: 'Time field' })
      expect(combobox).not.toHaveAttribute('maxlength')
      expect(combobox).toHaveValue(long)
    })

    it('shows the placeholder and marks an invalid value', () => {
      renderInput({ context: suggest(), placeholder: 'No field', invalid: true })
      const combobox = screen.getByRole('combobox', { name: 'Time field' })
      expect(combobox).toHaveAttribute('placeholder', 'No field')
      expect(combobox).toHaveAttribute('aria-invalid', 'true')
    })

    it('closes the list on Escape', async () => {
      const user = userEvent.setup()
      renderInput({ context: suggest() })
      const combobox = screen.getByRole('combobox', { name: 'Time field' })

      await user.click(combobox)
      await user.keyboard('{Escape}')

      expect(combobox).toHaveAttribute('aria-expanded', 'false')
    })
  })

  describe('the kind filters', () => {
    it('offers date and date_nanos fields for date', async () => {
      const user = userEvent.setup()
      renderInput({ context: suggest({ fields: TYPED_FIELDS }), types: 'date' })

      await user.click(screen.getByRole('combobox', { name: 'Time field' }))

      expect(optionNames()).toEqual(['event.created', '@timestamp'])
    })

    it('offers aggregatable fields for aggregatable', async () => {
      const user = userEvent.setup()
      renderInput({ context: suggest(), types: 'aggregatable' })

      await user.click(screen.getByRole('combobox', { name: 'Time field' }))

      expect(optionNames()).toEqual(
        SAMPLE_FIELDS.filter((field) => field.aggregatable).map((field) => field.name),
      )
      expect(hasOption('message')).toBe(false)
    })

    it('offers every numeric type for numeric', async () => {
      const user = userEvent.setup()
      renderInput({ context: suggest({ fields: TYPED_FIELDS }), types: 'numeric' })

      await user.click(screen.getByRole('combobox', { name: 'Time field' }))

      expect(optionNames()).toEqual(NUMERIC_TYPES.map((type) => `n_${type}`))
    })

    it('offers numeric sample fields and no text, keyword or date field for numeric', async () => {
      const user = userEvent.setup()
      renderInput({ context: suggest(), types: 'numeric' })

      await user.click(screen.getByRole('combobox', { name: 'Time field' }))

      expect(hasOption('latency_ms')).toBe(true)
      expect(hasOption('requests_total')).toBe(true)
      for (const name of ['@timestamp', 'log.level', 'message', 'service.name', 'user.id']) {
        expect(hasOption(name)).toBe(false)
      }
    })
  })

  describe('the indexes source', () => {
    it('lists the pulled indexes with their kind', async () => {
      const user = userEvent.setup()
      renderInput({ context: suggest(), source: 'indexes', ariaLabel: 'Index pattern' })

      await user.click(screen.getByRole('combobox', { name: 'Index pattern' }))

      expect(optionNames()).toEqual(['filebeat-*', 'app-logs', 'logs-current', 'metrics-app'])
      expect(within(option('filebeat-*')).getByText('30 indexes')).toBeInTheDocument()
      expect(within(option('app-logs')).getByText('index')).toBeInTheDocument()
      expect(within(option('logs-current')).getByText('alias')).toBeInTheDocument()
      expect(within(option('metrics-app')).getByText('data stream')).toBeInTheDocument()
    })

    it('writes a picked index', async () => {
      const user = userEvent.setup()
      const { onChange } = renderInput({ context: suggest(), source: 'indexes', ariaLabel: 'Index pattern' })

      await user.click(screen.getByRole('combobox', { name: 'Index pattern' }))
      await user.click(option('app-logs'))

      expect(onChange).toHaveBeenLastCalledWith('app-logs')
    })
  })

  describe('the footer per pull state', () => {
    it('offers Get fields before any pull, and it starts the pull', async () => {
      const user = userEvent.setup()
      const context = suggest({ fields: null, indexes: null, state: 'idle' })
      renderInput({ context })

      await user.click(screen.getByRole('combobox', { name: 'Time field' }))
      expect(screen.queryAllByRole('option')).toHaveLength(0)
      await user.click(screen.getByRole('button', { name: 'Get fields' }))

      expect(context.start).toHaveBeenCalledTimes(1)
    })

    it.each([['connecting'], ['reading']] as const)(
      'shows Getting fields... while the pull is %s',
      async (state) => {
        const user = userEvent.setup()
        renderInput({ context: suggest({ fields: null, indexes: null, state }) })

        await user.click(screen.getByRole('combobox', { name: 'Time field' }))

        expect(screen.getByText('Getting fields...')).toBeInTheDocument()
        expect(screen.queryByRole('button', { name: 'Get fields' })).not.toBeInTheDocument()
        expect(screen.queryAllByRole('option')).toHaveLength(0)
      },
    )

    it('offers a retry after a failed pull, and it starts the pull again', async () => {
      const user = userEvent.setup()
      const context = suggest({ fields: null, indexes: null, state: 'failed' })
      renderInput({ context })

      await user.click(screen.getByRole('combobox', { name: 'Time field' }))
      expect(screen.queryAllByRole('option')).toHaveLength(0)
      await user.click(screen.getByRole('button', { name: 'Could not get fields. Try again' }))

      expect(context.start).toHaveBeenCalledTimes(1)
    })

    it.each([['done'], ['settled']] as const)('shows no footer once the pull is %s', async (state) => {
      const user = userEvent.setup()
      renderInput({ context: suggest({ state }) })

      await user.click(screen.getByRole('combobox', { name: 'Time field' }))

      expect(screen.queryByRole('button', { name: 'Get fields' })).not.toBeInTheDocument()
      expect(screen.queryByText('Getting fields...')).not.toBeInTheDocument()
      expect(
        screen.queryByRole('button', { name: 'Could not get fields. Try again' }),
      ).not.toBeInTheDocument()
    })

    it('still accepts a typed name before any pull', async () => {
      const user = userEvent.setup()
      const { onChange } = renderInput({ context: suggest({ fields: null, indexes: null, state: 'idle' }) })

      await user.type(screen.getByRole('combobox', { name: 'Time field' }), '@ts')

      expect(onChange).toHaveBeenLastCalledWith('@ts')
    })
  })
})

// The empty line of the list: only a loaded list says nothing matched; the footer tells every other state (OS-13).
describe('FieldSuggestInput - the empty line', () => {
  it.each([['done'], ['settled']] as const)('says no field matches the typed text once the pull is %s', async (state) => {
    const user = userEvent.setup()
    renderInput({ context: suggest({ state }) })

    await user.type(screen.getByRole('combobox', { name: 'Time field' }), 'no.such.field')

    expect(screen.queryAllByRole('option')).toHaveLength(0)
    expect(screen.getByText('No matching fields')).toBeInTheDocument()
    expect(screen.queryByText('No matching variables')).not.toBeInTheDocument()
  })

  it('says no index matches when the pattern matched none on an index row', async () => {
    const user = userEvent.setup()
    renderInput({ context: suggest({ indexes: [] }), source: 'indexes', ariaLabel: 'Index pattern' })

    await user.type(screen.getByRole('combobox', { name: 'Index pattern' }), 'no-such-index')

    expect(screen.getByText('No matching indexes')).toBeInTheDocument()
    expect(screen.queryByText('No matching variables')).not.toBeInTheDocument()
  })

  it.each([['idle'], ['connecting'], ['reading'], ['failed']] as const)(
    'shows no empty line while the pull is %s',
    async (state) => {
      const user = userEvent.setup()
      renderInput({ context: suggest({ fields: null, indexes: null, state }) })

      await user.click(screen.getByRole('combobox', { name: 'Time field' }))

      expect(screen.getByRole('combobox', { name: 'Time field' })).toHaveAttribute('aria-expanded', 'true')
      expect(screen.queryByText('No matching fields')).not.toBeInTheDocument()
      expect(screen.queryByText('No matching variables')).not.toBeInTheDocument()
    },
  )
})

// At rest the row's one 32px box draws the field, the mono value in the string color (OS-13, FIELD-1).
describe('FieldSuggestInput - the box at rest', () => {
  it('draws the combobox as a flat control of the row box, the mono value in the string color', () => {
    renderInput({ context: suggest(), initialValue: '@timestamp' })

    const box = screen.getByRole('combobox', { name: 'Time field' })
    expect(box).toHaveClass('h-[30px]', 'border-0', 'bg-transparent', 'font-mono', 'text-sky-300', 'shadow-none')
    expect(box).not.toHaveClass('h-9', 'shadow-sm', 'border-input')
  })

  it('draws the plain text box outside an OpenSearch sheet the same way', () => {
    renderInput({ initialValue: '@timestamp' })

    const box = screen.getByRole('textbox', { name: 'Time field' })
    expect(box).toHaveClass('h-[30px]', 'border-0', 'bg-transparent', 'font-mono', 'text-sky-300', 'shadow-none')
  })

  it('fills the row box it sits in, the ∅ inside the same box', () => {
    render(
      <FieldSuggestContext value={suggest()}>
        <EntryBox nullButton={{ label: 'Item 1', pressed: false, onClick: vi.fn(), testId: 'array-edit-input-0-null' }}>
          <FieldSuggestInput value="@timestamp" onChange={vi.fn()} source="fields" ariaLabel="Item 1 value" />
        </EntryBox>
      </FieldSuggestContext>,
    )

    const box = screen.getByRole('combobox', { name: 'Item 1 value' }).closest('[data-slot="input-group"]') as HTMLElement
    expect(box).toHaveClass('h-8')
    expect(box.firstElementChild).toHaveClass('min-w-0', 'flex-1')
    expect(screen.getByTestId('array-edit-input-0-null').closest('[data-slot="input-group"]')).toBe(box)
  })

  it('keeps the placeholder muted', () => {
    renderInput({ context: suggest(), placeholder: 'No field' })

    expect(screen.getByRole('combobox', { name: 'Time field' })).toHaveClass('placeholder:text-muted-foreground/70')
  })
})

// The Index pattern row lists indexes, so its footer speaks of indexes (OS-13).
describe('FieldSuggestInput - the Index pattern row footer', () => {
  function renderIndexRow(overrides: Partial<FieldSuggestValue> = {}) {
    const context = suggest({ fields: null, indexes: null, state: 'idle', startIndexes: vi.fn(), ...overrides })
    renderInput({ context, source: 'indexes', ariaLabel: 'Index pattern' })
    return context
  }

  async function openIndexRow(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getByRole('combobox', { name: 'Index pattern' }))
  }

  it('offers Get indexes before any pull, and it starts the pull from the Index pattern row', async () => {
    const user = userEvent.setup()
    const context = renderIndexRow()

    await openIndexRow(user)
    expect(screen.queryByRole('button', { name: 'Get fields' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Get indexes' }))

    expect(context.startIndexes).toHaveBeenCalledTimes(1)
    expect(context.start).not.toHaveBeenCalled()
  })

  it.each([['connecting'], ['reading']] as const)('shows Getting indexes... while the pull is %s', async (state) => {
    const user = userEvent.setup()
    renderIndexRow({ state })

    await openIndexRow(user)

    expect(screen.getByText('Getting indexes...')).toBeInTheDocument()
    expect(screen.queryByText('Getting fields...')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Get indexes' })).not.toBeInTheDocument()
  })

  it('offers a retry after a failed pull, and it starts the pull again from the Index pattern row', async () => {
    const user = userEvent.setup()
    const context = renderIndexRow({ state: 'failed' })

    await openIndexRow(user)
    expect(screen.queryByRole('button', { name: 'Could not get fields. Try again' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Could not get indexes. Try again' }))

    expect(context.startIndexes).toHaveBeenCalledTimes(1)
    expect(context.start).not.toHaveBeenCalled()
  })

  it.each([['done'], ['settled']] as const)('shows no footer once the pull is %s', async (state) => {
    const user = userEvent.setup()
    renderIndexRow({ state, indexes: SAMPLE_INDEXES })

    await openIndexRow(user)

    expect(screen.queryByRole('button', { name: 'Get indexes' })).not.toBeInTheDocument()
    expect(screen.queryByText('Getting indexes...')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Could not get indexes. Try again' })).not.toBeInTheDocument()
  })

  it('starts the pull itself when the host gives no Index pattern start', async () => {
    const user = userEvent.setup()
    const context = renderIndexRow({ startIndexes: undefined })

    await openIndexRow(user)
    await user.click(screen.getByRole('button', { name: 'Get indexes' }))

    expect(context.start).toHaveBeenCalledTimes(1)
  })

  it('keeps Get fields on a field row beside it', async () => {
    const user = userEvent.setup()
    const context = suggest({ fields: null, indexes: null, state: 'idle', startIndexes: vi.fn() })
    renderInput({ context })

    await user.click(screen.getByRole('combobox', { name: 'Time field' }))
    await user.click(screen.getByRole('button', { name: 'Get fields' }))

    expect(context.start).toHaveBeenCalledTimes(1)
    expect(context.startIndexes).not.toHaveBeenCalled()
  })
})

// A field list needs an Index pattern: a field row waits while it is blank, whatever the pull holds (OS-13).
describe('FieldSuggestInput - a blank Index pattern', () => {
  const FILL_IN = 'Fill in Index pattern to get fields'

  function requestWithIndex(index: unknown, expressionFields: string[] = []) {
    return {
      ...SAMPLE_FIELDS_REQUEST,
      connection: { ...SAMPLE_OS_CONNECTION, index },
      expression_fields: expressionFields,
    }
  }

  const BLANK = requestWithIndex('  ')

  it.each([
    ['idle', null],
    ['reading', null],
    ['failed', null],
    ['done', SAMPLE_FIELDS],
    ['settled', SAMPLE_FIELDS],
  ] as const)('shows the muted Fill in line and nothing to click while the pull is %s', async (state, fields) => {
    const user = userEvent.setup()
    const context = suggest({ state, fields, request: BLANK })
    renderInput({ context })

    await user.click(screen.getByRole('combobox', { name: 'Time field' }))

    const line = screen.getByText(FILL_IN)
    expect(line).toHaveClass('text-muted-foreground')
    expect(line.closest('button')).toBeNull()
    expect(screen.queryAllByRole('button')).toHaveLength(0)
    expect(screen.queryAllByRole('option')).toHaveLength(0)
    expect(screen.queryByText('Getting fields...')).not.toBeInTheDocument()
    await user.click(line)
    expect(context.start).not.toHaveBeenCalled()
  })

  it('lists no loaded field and says no field matches nothing', async () => {
    const user = userEvent.setup()
    renderInput({ context: suggest({ state: 'settled', request: requestWithIndex('') }) })

    await user.type(screen.getByRole('combobox', { name: 'Time field' }), 'log')

    expect(screen.queryAllByRole('option')).toHaveLength(0)
    expect(screen.queryByText('No matching fields')).not.toBeInTheDocument()
    expect(screen.getByText(FILL_IN)).toBeInTheDocument()
  })

  it('waits on an Index pattern that was never set', async () => {
    const user = userEvent.setup()
    renderInput({ context: suggest({ state: 'idle', fields: null, request: requestWithIndex(null) }) })

    await user.click(screen.getByRole('combobox', { name: 'Time field' }))

    expect(screen.getByText(FILL_IN)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Get fields' })).not.toBeInTheDocument()
  })

  it('still accepts a typed field name', async () => {
    const user = userEvent.setup()
    const { onChange } = renderInput({ context: suggest({ request: BLANK }) })

    await user.type(screen.getByRole('combobox', { name: 'Time field' }), '@ts')

    expect(onChange).toHaveBeenLastCalledWith('@ts')
  })

  it('leaves the Index pattern row free to get indexes', async () => {
    const user = userEvent.setup()
    const context = suggest({ fields: null, indexes: null, state: 'idle', request: BLANK, startIndexes: vi.fn() })
    renderInput({ context, source: 'indexes', ariaLabel: 'Index pattern' })

    await user.click(screen.getByRole('combobox', { name: 'Index pattern' }))
    await user.click(screen.getByRole('button', { name: 'Get indexes' }))

    expect(context.startIndexes).toHaveBeenCalledTimes(1)
    expect(screen.queryByText(FILL_IN)).not.toBeInTheDocument()
  })

  it('lists the loaded indexes on the Index pattern row', async () => {
    const user = userEvent.setup()
    renderInput({ context: suggest({ request: BLANK }), source: 'indexes', ariaLabel: 'Index pattern' })

    await user.click(screen.getByRole('combobox', { name: 'Index pattern' }))

    expect(optionNames()).toEqual(SAMPLE_INDEXES.map((index) => index.name))
  })

  it('does not wait on an Index pattern held by an expression', async () => {
    const user = userEvent.setup()
    const context = suggest({ fields: null, indexes: null, state: 'idle', request: requestWithIndex('', ['index']) })
    renderInput({ context })

    await user.click(screen.getByRole('combobox', { name: 'Time field' }))
    await user.click(screen.getByRole('button', { name: 'Get fields' }))

    expect(context.start).toHaveBeenCalledTimes(1)
    expect(screen.queryByText(FILL_IN)).not.toBeInTheDocument()
  })

  it('offers the fields once an Index pattern is written', async () => {
    const user = userEvent.setup()
    renderInput({ context: suggest({ request: SAMPLE_FIELDS_REQUEST }) })

    await user.click(screen.getByRole('combobox', { name: 'Time field' }))

    expect(optionNames()).toEqual(SAMPLE_FIELDS.map((field) => field.name))
    expect(screen.queryByText(FILL_IN)).not.toBeInTheDocument()
  })
})

describe('FieldSuggestInput - the Index pattern row list', () => {
  // The pulled list is what the typed pattern matches, so the typed text never narrows it.
  it('lists every index the typed wildcard pattern matched', async () => {
    const user = userEvent.setup()
    const context = suggest({ fields: null, indexes: SAMPLE_INDEXES, state: 'settled' })
    renderInput({ context, source: 'indexes', ariaLabel: 'Index pattern', initialValue: 'app-*,metrics-*' })

    await user.click(screen.getByRole('combobox', { name: 'Index pattern' }))

    expect(optionNames()).toEqual(SAMPLE_INDEXES.map((index) => index.name))
    expect(screen.queryByText('No matching indexes')).not.toBeInTheDocument()
  })

  it('still narrows a field list by the typed text', async () => {
    const user = userEvent.setup()
    renderInput({ context: suggest(), ariaLabel: 'Time field', initialValue: 'zzz-no-such' })

    await user.click(screen.getByRole('combobox', { name: 'Time field' }))

    expect(screen.queryAllByRole('option')).toHaveLength(0)
    expect(screen.getByText('No matching fields')).toBeInTheDocument()
  })
})
