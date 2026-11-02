/**
 * CatalogChip: the catalog chip in a script editor footer - Get Tables in the SQL editor, Get fields in the
 * OpenSearch Query editor - with the nouns of its catalog passed in.
 *
 * REQ-3.4.1.6, REQ-5.1.4, REQ-3.3.2.6, REQ-5.1.2; SQL-12, OS-12, OS-13
 */

import { useRef, useState } from 'react'
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest'
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import type { SqlTable } from '@/features/workbench/api/sql-tools'
import {
  CatalogChip,
  OPENSEARCH_CATALOG_NOUNS,
  SQL_CATALOG_NOUNS,
  type CatalogChipNouns,
  type CatalogChipProps,
  type CatalogChipState,
} from '@/features/workbench/common/variables/variable-inspect-modal/catalog-chip'
import type { CatalogItem } from '@/features/workbench/common/variables/variable-inspect-modal/catalog-popover'

import { SAMPLE_FIELDS } from '../../../opensearch-fixtures'
import { ORDERS, SAMPLE_TABLES } from '../../../sql-fixtures'

type User = ReturnType<typeof userEvent.setup>

const MIDDLE_DOT = '·'

const CATALOG_ORDER = ['orders', 'order_items', 'customers', 'active_customers']

const STOP_NAME = 'Stop getting tables'
const REFRESH_NAME = 'Refresh tables'
const FAILED_NAME = 'Could not get tables'

const STOP_FIELDS = 'Stop getting fields'
const REFRESH_FIELDS = 'Refresh fields'
const FAILED_FIELDS = 'Could not get fields'

const PULL_ERROR = "Cannot resolve Host: Variable 'db_host' is not defined"
const FIELDS_ERROR = 'Authentication failed: HTTP 401 from https://opensearch.example:9200'

function tableItem(table: SqlTable): CatalogItem {
  return {
    name: table.name,
    detail: '',
    children: table.columns.map((column) => ({ name: column.name, detail: column.type })),
  }
}

const TABLE_ITEMS: readonly CatalogItem[] = SAMPLE_TABLES.map(tableItem)

const FIELD_ITEMS: readonly CatalogItem[] = SAMPLE_FIELDS.map((field) => ({
  name: field.name,
  detail: field.types.join(', '),
}))

const FIELD_COUNT = FIELD_ITEMS.length

interface StateCase {
  readonly state: CatalogChipState
  readonly count: number
  readonly items: readonly CatalogItem[] | null
  readonly label: string
  /** Accessible names of every button the chip renders, in DOM order. */
  readonly buttons: readonly string[]
}

const STATE_CASES: readonly StateCase[] = [
  { state: 'idle', count: 0, items: null, label: 'Get Tables', buttons: ['Get Tables'] },
  { state: 'connecting', count: 0, items: null, label: 'Connecting...', buttons: [STOP_NAME] },
  { state: 'reading', count: 0, items: null, label: 'Getting tables...', buttons: [STOP_NAME] },
  { state: 'done', count: 4, items: TABLE_ITEMS, label: 'Got 4 tables', buttons: ['Got 4 tables'] },
  {
    state: 'settled',
    count: 4,
    items: TABLE_ITEMS,
    label: `Tables ${MIDDLE_DOT} 4`,
    buttons: [`Tables ${MIDDLE_DOT} 4`, REFRESH_NAME],
  },
  {
    state: 'failed',
    count: 0,
    items: null,
    label: 'Could not get tables',
    buttons: ['Could not get tables'],
  },
]

// The fields pull has no Connecting label: a connecting pull reads as Getting fields... (OS-12).
const FIELD_CASES: readonly StateCase[] = [
  { state: 'idle', count: 0, items: null, label: 'Get fields', buttons: ['Get fields'] },
  { state: 'connecting', count: 0, items: null, label: 'Getting fields...', buttons: [STOP_FIELDS] },
  { state: 'reading', count: 0, items: null, label: 'Getting fields...', buttons: [STOP_FIELDS] },
  {
    state: 'done',
    count: FIELD_COUNT,
    items: FIELD_ITEMS,
    label: `Got ${FIELD_COUNT} fields`,
    buttons: [`Got ${FIELD_COUNT} fields`],
  },
  {
    state: 'settled',
    count: FIELD_COUNT,
    items: FIELD_ITEMS,
    label: `Fields ${MIDDLE_DOT} ${FIELD_COUNT}`,
    buttons: [`Fields ${MIDDLE_DOT} ${FIELD_COUNT}`, REFRESH_FIELDS],
  },
  { state: 'failed', count: 0, items: null, label: FAILED_FIELDS, buttons: [FAILED_FIELDS] },
]

const BUSY_CASES = STATE_CASES.filter((c) => c.state === 'connecting' || c.state === 'reading')
const BUSY_FIELD_CASES = FIELD_CASES.filter((c) => c.state === 'connecting' || c.state === 'reading')
const BUSY_STATES = new Set<CatalogChipState>(['connecting', 'reading'])

type ChipOverrides = Partial<Omit<CatalogChipProps, 'onPopoverClosed'>> & {
  readonly withOnPopoverClosed?: boolean
}

/** The sheet host: an editor that the popover close hands focus back to. */
function ChipHarness(props: CatalogChipProps) {
  const editorRef = useRef<HTMLTextAreaElement>(null)
  const { onPopoverClosed } = props
  const handleClosed =
    onPopoverClosed === undefined
      ? undefined
      : () => {
          onPopoverClosed()
          editorRef.current?.focus()
        }

  return (
    <div>
      <textarea ref={editorRef} aria-label="Editor" data-testid="sql-editor" />
      <CatalogChip {...props} onPopoverClosed={handleClosed} />
    </div>
  )
}

function renderChip({ withOnPopoverClosed = true, ...overrides }: ChipOverrides = {}) {
  const handlers = {
    onStart: vi.fn<() => void>(),
    onStop: vi.fn<() => void>(),
    onRefresh: vi.fn<() => void>(),
    onInsert: vi.fn<(name: string) => void>(),
    onPopoverClosed: vi.fn<() => void>(),
  }
  render(
    <ChipHarness
      state="idle"
      count={0}
      items={null}
      nouns={SQL_CATALOG_NOUNS}
      onStart={handlers.onStart}
      onStop={handlers.onStop}
      onRefresh={handlers.onRefresh}
      onInsert={handlers.onInsert}
      onPopoverClosed={withOnPopoverClosed ? handlers.onPopoverClosed : undefined}
      {...overrides}
    />,
  )
  return handlers
}

function renderCase(stateCase: StateCase, overrides: ChipOverrides = {}) {
  return renderChip({
    state: stateCase.state,
    count: stateCase.count,
    items: stateCase.items,
    ...overrides,
  })
}

function renderFieldCase(stateCase: StateCase, overrides: ChipOverrides = {}) {
  return renderCase(stateCase, { nouns: OPENSEARCH_CATALOG_NOUNS, ...overrides })
}

function caseIn(cases: readonly StateCase[], state: CatalogChipState): StateCase {
  const found = cases.find((c) => c.state === state)
  if (found === undefined) throw new Error(`no case for ${state}`)
  return found
}

const caseOf = (state: CatalogChipState) => caseIn(STATE_CASES, state)
const fieldCaseOf = (state: CatalogChipState) => caseIn(FIELD_CASES, state)

/** Renders the chip once, then walks it through `states` on the same mount. */
function walkStates(
  states: readonly CatalogChipState[],
  onEach: (stateCase: StateCase) => void,
  cases: readonly StateCase[] = STATE_CASES,
  nouns: CatalogChipNouns = SQL_CATALOG_NOUNS,
) {
  const props = (stateCase: StateCase): CatalogChipProps => ({
    state: stateCase.state,
    count: stateCase.count,
    items: stateCase.items,
    nouns,
    onStart: vi.fn(),
    onStop: vi.fn(),
    onRefresh: vi.fn(),
    onInsert: vi.fn(),
  })
  const [first, ...rest] = states.map((state) => caseIn(cases, state))
  const view = render(<ChipHarness {...props(first)} />)
  onEach(first)
  for (const stateCase of rest) {
    view.rerender(<ChipHarness {...props(stateCase)} />)
    onEach(stateCase)
  }
}

/** Keyboard focus opens the shared tooltip at once, without the hover delay. */
function focusButton(name: string): HTMLElement {
  const button = screen.getByRole('button', { name })
  act(() => {
    button.focus()
  })
  return button
}

const chip = () => screen.getByTestId('get-tables-chip')
const status = () => screen.getByTestId('get-tables-status')
const popover = () => screen.queryByTestId('tables-popover')
const searchBox = () => within(screen.getByTestId('tables-popover')).getByRole('combobox')

function rowNames(): string[] {
  return screen
    .queryAllByTestId(/^tables-popover-item-/)
    .map((el) => (el.getAttribute('data-testid') ?? '').replace('tables-popover-item-', ''))
}

async function openPopover(user: User, name: string) {
  await user.click(screen.getByRole('button', { name }))
  await waitFor(() => {
    expect(searchBox()).toHaveFocus()
  })
}

// ============================================================================
// Labels and controls per state
// ============================================================================

describe('CatalogChip - SQL states (SQL-12)', () => {
  it.each(STATE_CASES)('renders exactly its own buttons while $state', (stateCase) => {
    renderCase(stateCase)

    const expected = stateCase.buttons.map((name) => screen.getByRole('button', { name }))
    expect(screen.getAllByRole('button')).toEqual(expected)
  })

  it.each(STATE_CASES)('marks the chip data-state="$state"', (stateCase) => {
    renderCase(stateCase)

    expect(chip()).toHaveAttribute('data-state', stateCase.state)
  })

  it.each(STATE_CASES)('holds exactly "$label" in the polite live status while $state', (stateCase) => {
    renderCase(stateCase)

    expect(status()).toHaveAttribute('aria-live', 'polite')
    expect(status().textContent).toBe(stateCase.label)
  })

  it.each(STATE_CASES)('shows the spinner only while busy ($state)', (stateCase) => {
    renderCase(stateCase)

    const spinner = screen.queryByTestId('get-tables-spinner')
    if (BUSY_STATES.has(stateCase.state)) {
      expect(spinner).toBeInTheDocument()
      expect(spinner).toHaveAttribute('aria-hidden', 'true')
    } else {
      expect(spinner).not.toBeInTheDocument()
    }
  })

  it('names the idle button Get Tables and gives it a decorative Database icon', () => {
    renderCase(caseOf('idle'))

    const button = screen.getByRole('button', { name: 'Get Tables' })
    const icon = button.querySelector('svg.lucide-database')
    expect(icon).not.toBeNull()
    expect(icon).toHaveAttribute('aria-hidden', 'true')
  })

  it('names the done button after the count and gives it a decorative checkmark', () => {
    renderCase(caseOf('done'))

    const button = screen.getByRole('button', { name: 'Got 4 tables' })
    const icon = button.querySelector('svg.lucide-check')
    expect(icon).not.toBeNull()
    expect(icon).toHaveAttribute('aria-hidden', 'true')
  })

  it.each([
    ['settled', `Tables ${MIDDLE_DOT} 4`, 'svg.lucide-database'],
    ['failed', 'Could not get tables', 'svg.lucide-circle-alert'],
  ] as const)('gives the %s button its decorative icon', (state, name, selector) => {
    renderCase(caseOf(state))

    const icon = screen.getByRole('button', { name }).querySelector(selector)
    expect(icon).not.toBeNull()
    expect(icon).toHaveAttribute('aria-hidden', 'true')
  })

  it('draws Refresh as an icon-only refresh button', () => {
    renderCase(caseOf('settled'))

    const refresh = screen.getByRole('button', { name: REFRESH_NAME })
    expect((refresh.textContent ?? '').trim()).toBe('')
    expect(refresh.querySelector('svg.lucide-refresh-cw')).toHaveAttribute('aria-hidden', 'true')
  })

  it('reads Got 1 table for a single table', () => {
    renderChip({ state: 'done', count: 1, items: [tableItem(ORDERS)] })

    expect(screen.getByRole('button', { name: 'Got 1 table' })).toBeInTheDocument()
    expect(status().textContent).toBe('Got 1 table')
  })

  it('reads Got 0 tables when the database holds none', () => {
    renderChip({ state: 'done', count: 0, items: [] })

    expect(screen.getByRole('button', { name: 'Got 0 tables' })).toBeInTheDocument()
    expect(status().textContent).toBe('Got 0 tables')
  })

  it(`reads Tables ${MIDDLE_DOT} 1 once settled on a single table`, () => {
    renderChip({ state: 'settled', count: 1, items: [tableItem(ORDERS)] })

    expect(screen.getByRole('button', { name: `Tables ${MIDDLE_DOT} 1` })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: REFRESH_NAME })).toBeInTheDocument()
    expect(status().textContent).toBe(`Tables ${MIDDLE_DOT} 1`)
  })

  it(`reads Tables ${MIDDLE_DOT} 0 once settled on none`, () => {
    renderChip({ state: 'settled', count: 0, items: [] })

    expect(screen.getByRole('button', { name: `Tables ${MIDDLE_DOT} 0` })).toBeInTheDocument()
    expect(status().textContent).toBe(`Tables ${MIDDLE_DOT} 0`)
  })
})

// ============================================================================
// The OpenSearch nouns in every state
// ============================================================================

describe('CatalogChip - OpenSearch states (OS-12)', () => {
  it.each(FIELD_CASES)('renders exactly its own buttons while $state', (stateCase) => {
    renderFieldCase(stateCase)

    const expected = stateCase.buttons.map((name) => screen.getByRole('button', { name }))
    expect(screen.getAllByRole('button')).toEqual(expected)
  })

  it.each(FIELD_CASES)('holds exactly "$label" in the polite live status while $state', (stateCase) => {
    renderFieldCase(stateCase)

    expect(status()).toHaveAttribute('aria-live', 'polite')
    expect(status().textContent).toBe(stateCase.label)
  })

  it.each(FIELD_CASES)('marks the chip data-state="$state"', (stateCase) => {
    renderFieldCase(stateCase)

    expect(chip()).toHaveAttribute('data-state', stateCase.state)
  })

  it.each(FIELD_CASES)('shows the spinner only while busy ($state)', (stateCase) => {
    renderFieldCase(stateCase)

    const spinner = screen.queryByTestId('get-tables-spinner')
    if (BUSY_STATES.has(stateCase.state)) {
      expect(spinner).toBeInTheDocument()
    } else {
      expect(spinner).not.toBeInTheDocument()
    }
  })

  it.each(FIELD_CASES)('shows no table noun while $state', (stateCase) => {
    renderFieldCase(stateCase)

    expect(chip().textContent ?? '').not.toMatch(/tables?\b/i)
    for (const button of screen.getAllByRole('button')) {
      expect(button.getAttribute('aria-label') ?? '').not.toMatch(/tables?\b/i)
    }
  })

  it('names the idle button Get fields and gives it a decorative Database icon', () => {
    renderFieldCase(fieldCaseOf('idle'))

    const icon = screen.getByRole('button', { name: 'Get fields' }).querySelector('svg.lucide-database')
    expect(icon).not.toBeNull()
    expect(icon).toHaveAttribute('aria-hidden', 'true')
  })

  it('reads Getting fields... while connecting, never a Connecting label', () => {
    renderFieldCase(fieldCaseOf('connecting'))

    expect(status().textContent).toBe('Getting fields...')
    expect(screen.queryByText('Connecting...')).not.toBeInTheDocument()
  })

  it('reads Got 214 fields with a decorative checkmark once the pull is done', () => {
    renderChip({ state: 'done', count: 214, items: FIELD_ITEMS, nouns: OPENSEARCH_CATALOG_NOUNS })

    const button = screen.getByRole('button', { name: 'Got 214 fields' })
    expect(button.querySelector('svg.lucide-check')).toHaveAttribute('aria-hidden', 'true')
    expect(status().textContent).toBe('Got 214 fields')
  })

  it('reads Got 1 field for a single field', () => {
    renderChip({ state: 'done', count: 1, items: FIELD_ITEMS.slice(0, 1), nouns: OPENSEARCH_CATALOG_NOUNS })

    expect(screen.getByRole('button', { name: 'Got 1 field' })).toBeInTheDocument()
    expect(status().textContent).toBe('Got 1 field')
  })

  it('reads Got 0 fields when the index holds none', () => {
    renderChip({ state: 'done', count: 0, items: [], nouns: OPENSEARCH_CATALOG_NOUNS })

    expect(status().textContent).toBe('Got 0 fields')
  })

  it(`reads Fields ${MIDDLE_DOT} 214 once settled, with Refresh fields beside it`, () => {
    renderChip({ state: 'settled', count: 214, items: FIELD_ITEMS, nouns: OPENSEARCH_CATALOG_NOUNS })

    const button = screen.getByRole('button', { name: `Fields ${MIDDLE_DOT} 214` })
    expect(button.querySelector('svg.lucide-database')).toHaveAttribute('aria-hidden', 'true')
    expect(screen.getByRole('button', { name: REFRESH_FIELDS })).toBeInTheDocument()
    expect(status().textContent).toBe(`Fields ${MIDDLE_DOT} 214`)
  })

  it(`reads Fields ${MIDDLE_DOT} 1 once settled on a single field`, () => {
    renderChip({ state: 'settled', count: 1, items: FIELD_ITEMS.slice(0, 1), nouns: OPENSEARCH_CATALOG_NOUNS })

    expect(status().textContent).toBe(`Fields ${MIDDLE_DOT} 1`)
  })

  it.each(BUSY_FIELD_CASES)('draws Stop getting fields as an icon-only square while $state', (stateCase) => {
    renderFieldCase(stateCase)

    const stop = screen.getByRole('button', { name: STOP_FIELDS })
    expect((stop.textContent ?? '').trim()).toBe('')
    expect(stop.querySelector('svg.lucide-square')).toHaveAttribute('aria-hidden', 'true')
    expect(chip()).toContainElement(stop)
  })

  it.each(BUSY_FIELD_CASES)('calls onStop, and nothing else, from Stop getting fields while $state', async (stateCase) => {
    const user = userEvent.setup()
    const handlers = renderFieldCase(stateCase)

    await user.click(screen.getByRole('button', { name: STOP_FIELDS }))

    expect(handlers.onStop).toHaveBeenCalledTimes(1)
    expect(handlers.onStart).not.toHaveBeenCalled()
    expect(handlers.onRefresh).not.toHaveBeenCalled()
  })

  it('draws Refresh fields as an icon-only refresh button that calls onRefresh', async () => {
    const user = userEvent.setup()
    const handlers = renderFieldCase(fieldCaseOf('settled'))

    const refresh = screen.getByRole('button', { name: REFRESH_FIELDS })
    expect((refresh.textContent ?? '').trim()).toBe('')
    expect(refresh.querySelector('svg.lucide-refresh-cw')).toHaveAttribute('aria-hidden', 'true')

    await user.click(refresh)

    expect(handlers.onRefresh).toHaveBeenCalledTimes(1)
    expect(handlers.onStart).not.toHaveBeenCalled()
  })

  it('calls onStart once from Get fields and opens no popover', async () => {
    const user = userEvent.setup()
    const handlers = renderFieldCase(fieldCaseOf('idle'))

    await user.click(screen.getByRole('button', { name: 'Get fields' }))

    expect(handlers.onStart).toHaveBeenCalledTimes(1)
    expect(popover()).not.toBeInTheDocument()
  })

  it('shows the error text as the tooltip of Could not get fields, and a click tries again', async () => {
    const user = userEvent.setup()
    const handlers = renderFieldCase(fieldCaseOf('failed'), { error: FIELDS_ERROR })

    const button = focusButton(FAILED_FIELDS)

    expect(screen.getByRole('tooltip').textContent).toBe(FIELDS_ERROR)
    expect(button).toHaveAccessibleDescription(FIELDS_ERROR)
    expect(button.querySelector('svg.lucide-circle-alert')).toHaveAttribute('aria-hidden', 'true')

    await user.click(button)

    expect(handlers.onStart).toHaveBeenCalledTimes(1)
  })

  it('keeps the same polite status element through a whole fields pull', () => {
    const path: readonly CatalogChipState[] = ['idle', 'connecting', 'reading', 'done', 'settled', 'failed', 'idle']
    let first: HTMLElement | null = null
    const labels: string[] = []

    walkStates(
      path,
      () => {
        first ??= status()
        expect(status()).toBe(first)
        labels.push(status().textContent ?? '')
      },
      FIELD_CASES,
      OPENSEARCH_CATALOG_NOUNS,
    )

    expect(labels).toEqual([
      'Get fields',
      'Getting fields...',
      'Getting fields...',
      `Got ${FIELD_COUNT} fields`,
      `Fields ${MIDDLE_DOT} ${FIELD_COUNT}`,
      FAILED_FIELDS,
      'Get fields',
    ])
  })
})

// ============================================================================
// Nouns passed in
// ============================================================================

describe('CatalogChip - nouns passed in', () => {
  it('shows the reading label while connecting when the nouns carry no connecting label', () => {
    const nouns: CatalogChipNouns = { ...SQL_CATALOG_NOUNS, connecting: undefined }
    renderChip({ state: 'connecting', nouns })

    expect(status().textContent).toBe('Getting tables...')
    expect(chip()).toHaveAttribute('data-state', 'connecting')
    expect(screen.getByRole('button', { name: STOP_NAME })).toBeInTheDocument()
  })

  it('reads its done and settled labels from the nouns, with the count', () => {
    const done = vi.fn((count: number) => `Found ${count}`)
    const settled = vi.fn((count: number) => `Catalog ${MIDDLE_DOT} ${count}`)
    const nouns: CatalogChipNouns = { ...OPENSEARCH_CATALOG_NOUNS, done, settled }

    renderChip({ state: 'done', count: 7, items: FIELD_ITEMS, nouns })
    expect(status().textContent).toBe('Found 7')
    expect(done).toHaveBeenCalledWith(7)
    cleanup()

    renderChip({ state: 'settled', count: 7, items: FIELD_ITEMS, nouns })
    expect(status().textContent).toBe(`Catalog ${MIDDLE_DOT} 7`)
    expect(settled).toHaveBeenCalledWith(7)
  })
})

// ============================================================================
// One live region
// ============================================================================

// A pull from start to a refresh that fails, a retry and a Stop.
const PULL_PATH: readonly CatalogChipState[] = [
  'idle',
  'connecting',
  'reading',
  'done',
  'settled',
  'connecting',
  'failed',
  'connecting',
  'idle',
]

describe('CatalogChip - one live region (SQL-12)', () => {
  it('keeps the same polite status element mounted through a whole pull', () => {
    let first: HTMLElement | null = null
    const labels: string[] = []

    walkStates(PULL_PATH, (stateCase) => {
      first ??= status()
      expect(status(), `status element while ${stateCase.state}`).toBe(first)
      expect(status()).toHaveAttribute('aria-live', 'polite')
      labels.push(status().textContent ?? '')
    })

    expect(labels).toEqual(PULL_PATH.map((state) => caseOf(state).label))
  })

  it.each(STATE_CASES)('keeps the same status element when $state follows every other state', (target) => {
    for (const from of STATE_CASES.filter((c) => c.state !== target.state)) {
      const seen: HTMLElement[] = []
      walkStates([from.state, target.state], () => {
        seen.push(status())
      })
      expect(seen[1], `${from.state} -> ${target.state}`).toBe(seen[0])
      expect(seen[1].textContent).toBe(target.label)
      cleanup()
    }
  })

  it('renders exactly one status element in every state', () => {
    walkStates(PULL_PATH, (stateCase) => {
      expect(screen.getAllByTestId('get-tables-status'), stateCase.state).toHaveLength(1)
    })
  })
})

// ============================================================================
// Busy states
// ============================================================================

describe('CatalogChip - busy (SQL-12)', () => {
  it.each(BUSY_CASES)('holds the status, the spinner and one Stop inside the chip while $state', (stateCase) => {
    renderCase(stateCase)

    const stops = screen.getAllByRole('button', { name: STOP_NAME })
    expect(stops).toHaveLength(1)
    expect(chip()).toContainElement(stops[0])
    expect(chip()).toContainElement(status())
    expect(chip()).toContainElement(screen.getByTestId('get-tables-spinner'))
  })

  it.each(BUSY_CASES)('puts the status text "$label" in no button', (stateCase) => {
    renderCase(stateCase)

    expect(screen.queryByRole('button', { name: stateCase.label })).not.toBeInTheDocument()
    for (const button of screen.getAllByRole('button')) {
      expect(button.textContent ?? '').not.toContain(stateCase.label)
      expect(button).not.toContainElement(status())
    }
  })

  it.each(BUSY_CASES)('draws Stop as an icon-only square while $state', (stateCase) => {
    renderCase(stateCase)

    const stop = screen.getByRole('button', { name: STOP_NAME })
    expect((stop.textContent ?? '').trim()).toBe('')
    const icon = stop.querySelector('svg.lucide-square')
    expect(icon).not.toBeNull()
    expect(icon).toHaveAttribute('aria-hidden', 'true')
  })

  it.each(BUSY_CASES)('calls onStop, and nothing else, when Stop is clicked while $state', async (stateCase) => {
    const user = userEvent.setup()
    const handlers = renderCase(stateCase)

    await user.click(screen.getByRole('button', { name: STOP_NAME }))

    expect(handlers.onStop).toHaveBeenCalledTimes(1)
    expect(handlers.onStart).not.toHaveBeenCalled()
    expect(handlers.onRefresh).not.toHaveBeenCalled()
    expect(handlers.onInsert).not.toHaveBeenCalled()
    expect(popover()).not.toBeInTheDocument()
  })
})

// ============================================================================
// Start, retry and refresh
// ============================================================================

describe('CatalogChip - start, retry and refresh (SQL-12)', () => {
  it('calls onStart once on an idle click and opens no popover', async () => {
    const user = userEvent.setup()
    const handlers = renderCase(caseOf('idle'))

    await user.click(screen.getByRole('button', { name: 'Get Tables' }))

    expect(handlers.onStart).toHaveBeenCalledTimes(1)
    expect(handlers.onStop).not.toHaveBeenCalled()
    expect(handlers.onRefresh).not.toHaveBeenCalled()
    expect(popover()).not.toBeInTheDocument()
  })

  it('calls onStart once on a failed click, to try again, and opens no popover', async () => {
    const user = userEvent.setup()
    const handlers = renderCase(caseOf('failed'))

    await user.click(screen.getByRole('button', { name: 'Could not get tables' }))

    expect(handlers.onStart).toHaveBeenCalledTimes(1)
    expect(handlers.onStop).not.toHaveBeenCalled()
    expect(handlers.onRefresh).not.toHaveBeenCalled()
    expect(popover()).not.toBeInTheDocument()
  })

  it('calls onRefresh once from the Refresh button and opens no popover', async () => {
    const user = userEvent.setup()
    const handlers = renderCase(caseOf('settled'))

    await user.click(screen.getByRole('button', { name: REFRESH_NAME }))

    expect(handlers.onRefresh).toHaveBeenCalledTimes(1)
    expect(handlers.onStart).not.toHaveBeenCalled()
    expect(handlers.onStop).not.toHaveBeenCalled()
    expect(popover()).not.toBeInTheDocument()
  })
})

// ============================================================================
// Why a pull failed
// ============================================================================

describe('CatalogChip - failure reason (SQL-12)', () => {
  it('shows the error text of the failed pull as the tooltip of the failed button', () => {
    renderChip({ state: 'failed', error: PULL_ERROR })

    focusButton(FAILED_NAME)

    expect(screen.getByRole('tooltip').textContent).toBe(PULL_ERROR)
  })

  it('gives the failed button the error text as its accessible description', () => {
    renderChip({ state: 'failed', error: PULL_ERROR })

    const button = focusButton(FAILED_NAME)

    expect(button).toHaveAccessibleDescription(PULL_ERROR)
  })

  it('keeps the label Could not get tables with an error text', () => {
    renderChip({ state: 'failed', error: PULL_ERROR })

    expect(screen.getAllByRole('button')).toEqual([screen.getByRole('button', { name: FAILED_NAME })])
    expect(status().textContent).toBe(FAILED_NAME)
    expect(chip().textContent).not.toContain(PULL_ERROR)
  })

  it('still tries again on a click with an error text', async () => {
    const user = userEvent.setup()
    const handlers = renderChip({ state: 'failed', error: PULL_ERROR })

    await user.click(screen.getByRole('button', { name: FAILED_NAME }))

    expect(handlers.onStart).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['empty', ''],
  ] as const)('shows no tooltip and no description when the error text is %s', (_label, error) => {
    renderChip({ state: 'failed', error })

    const button = focusButton(FAILED_NAME)

    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
    expect(button).not.toHaveAccessibleDescription()
  })
})

// ============================================================================
// Catalog popover
// ============================================================================

describe('CatalogChip - Tables popover (SQL-12)', () => {
  it(`opens the popover with the loaded tables from the settled chip`, async () => {
    const user = userEvent.setup()
    const handlers = renderCase(caseOf('settled'))

    await openPopover(user, `Tables ${MIDDLE_DOT} 4`)

    expect(popover()).toBeInTheDocument()
    expect(popover()).toHaveAttribute('aria-label', 'Tables')
    expect(searchBox()).toHaveAttribute('placeholder', 'Search tables…')
    expect(rowNames()).toEqual(CATALOG_ORDER)
    expect(screen.getByRole('button', { name: `Tables ${MIDDLE_DOT} 4` })).toHaveAttribute(
      'aria-expanded',
      'true',
    )
    expect(handlers.onStart).not.toHaveBeenCalled()
    expect(handlers.onRefresh).not.toHaveBeenCalled()
  })

  it('opens the popover with the loaded tables from the done chip', async () => {
    const user = userEvent.setup()
    const handlers = renderCase(caseOf('done'))

    await openPopover(user, 'Got 4 tables')

    expect(popover()).toBeInTheDocument()
    expect(rowNames()).toEqual(CATALOG_ORDER)
    expect(handlers.onStart).not.toHaveBeenCalled()
  })

  it('opens an empty popover when no items are given', async () => {
    const user = userEvent.setup()
    renderChip({ state: 'settled', count: 0, items: null })

    await openPopover(user, `Tables ${MIDDLE_DOT} 0`)

    expect(popover()).toBeInTheDocument()
    expect(rowNames()).toEqual([])
  })

  it('says No tables in the popover of a database that holds none', async () => {
    const user = userEvent.setup()
    renderChip({ state: 'settled', count: 0, items: [] })

    await openPopover(user, `Tables ${MIDDLE_DOT} 0`)

    expect(rowNames()).toEqual([])
    expect(within(popover() as HTMLElement).getByText('No tables')).toBeInTheDocument()
    expect(within(popover() as HTMLElement).queryByText('No matching tables')).not.toBeInTheDocument()
  })

  it('calls onInsert with a clicked table and closes the popover', async () => {
    const user = userEvent.setup()
    const handlers = renderCase(caseOf('settled'))
    await openPopover(user, `Tables ${MIDDLE_DOT} 4`)

    await user.click(within(popover() as HTMLElement).getByTestId('tables-popover-item-orders'))

    expect(handlers.onInsert.mock.calls).toEqual([['orders']])
    expect(popover()).not.toBeInTheDocument()
  })

  it('calls onInsert with the table picked by keyboard and closes the popover', async () => {
    const user = userEvent.setup()
    const handlers = renderCase(caseOf('done'))
    await openPopover(user, 'Got 4 tables')

    await user.keyboard('{ArrowDown}{Enter}')

    expect(handlers.onInsert.mock.calls).toEqual([['order_items']])
    expect(popover()).not.toBeInTheDocument()
  })

  it('calls onPopoverClosed after a pick, so focus goes back to the editor', async () => {
    const user = userEvent.setup()
    const handlers = renderCase(caseOf('settled'))
    await openPopover(user, `Tables ${MIDDLE_DOT} 4`)

    await user.click(within(popover() as HTMLElement).getByTestId('tables-popover-item-customers'))

    await waitFor(() => {
      expect(handlers.onPopoverClosed).toHaveBeenCalledTimes(1)
    })
    expect(screen.getByTestId('sql-editor')).toHaveFocus()
  })

  it('closes on Escape without inserting and calls onPopoverClosed', async () => {
    const user = userEvent.setup()
    const handlers = renderCase(caseOf('settled'))
    await openPopover(user, `Tables ${MIDDLE_DOT} 4`)

    await user.keyboard('{Escape}')

    expect(popover()).not.toBeInTheDocument()
    expect(handlers.onInsert).not.toHaveBeenCalled()
    await waitFor(() => {
      expect(handlers.onPopoverClosed).toHaveBeenCalledTimes(1)
    })
    expect(screen.getByTestId('sql-editor')).toHaveFocus()
    expect(screen.getByRole('button', { name: `Tables ${MIDDLE_DOT} 4` })).not.toHaveFocus()
  })

  it('closes without an onPopoverClosed handler', async () => {
    const user = userEvent.setup()
    const handlers = renderCase(caseOf('settled'), { withOnPopoverClosed: false })
    await openPopover(user, `Tables ${MIDDLE_DOT} 4`)

    await user.keyboard('{Escape}')

    expect(popover()).not.toBeInTheDocument()
    expect(handlers.onPopoverClosed).not.toHaveBeenCalled()
  })

  it('opens again after a pick, with every table listed', async () => {
    const user = userEvent.setup()
    const handlers = renderCase(caseOf('settled'))
    await openPopover(user, `Tables ${MIDDLE_DOT} 4`)
    await user.keyboard('{Enter}')
    expect(popover()).not.toBeInTheDocument()

    await openPopover(user, `Tables ${MIDDLE_DOT} 4`)

    expect(rowNames()).toEqual(CATALOG_ORDER)
    expect(handlers.onInsert.mock.calls).toEqual([['orders']])
  })
})

describe('CatalogChip - Fields popover (OS-12, OS-13)', () => {
  it(`opens the Fields popover from the settled Fields ${MIDDLE_DOT} N chip`, async () => {
    const user = userEvent.setup()
    const handlers = renderFieldCase(fieldCaseOf('settled'))

    await openPopover(user, `Fields ${MIDDLE_DOT} ${FIELD_COUNT}`)

    expect(popover()).toHaveAttribute('aria-label', 'Fields')
    expect(searchBox()).toHaveAttribute('aria-label', 'Search fields')
    expect(searchBox()).toHaveAttribute('placeholder', 'Search fields…')
    expect(rowNames()).toEqual(SAMPLE_FIELDS.map((field) => field.name))
    expect(handlers.onStart).not.toHaveBeenCalled()
    expect(handlers.onRefresh).not.toHaveBeenCalled()
  })

  it('opens the Fields popover from the done chip', async () => {
    const user = userEvent.setup()
    renderFieldCase(fieldCaseOf('done'))

    await openPopover(user, `Got ${FIELD_COUNT} fields`)

    expect(rowNames()).toEqual(SAMPLE_FIELDS.map((field) => field.name))
  })

  it('says No fields in the popover of a pull that found none', async () => {
    const user = userEvent.setup()
    renderChip({ state: 'settled', count: 0, items: [], nouns: OPENSEARCH_CATALOG_NOUNS })

    await openPopover(user, `Fields ${MIDDLE_DOT} 0`)

    expect(within(popover() as HTMLElement).getByText('No fields')).toBeInTheDocument()
  })

  it('calls onInsert with the dotted name of a clicked field and closes the popover', async () => {
    const user = userEvent.setup()
    const handlers = renderFieldCase(fieldCaseOf('settled'))
    await openPopover(user, `Fields ${MIDDLE_DOT} ${FIELD_COUNT}`)

    await user.click(within(popover() as HTMLElement).getByTestId('tables-popover-item-service.name'))

    expect(handlers.onInsert.mock.calls).toEqual([['service.name']])
    expect(popover()).not.toBeInTheDocument()
    await waitFor(() => {
      expect(handlers.onPopoverClosed).toHaveBeenCalledTimes(1)
    })
    expect(screen.getByTestId('sql-editor')).toHaveFocus()
  })
})

// ============================================================================
// Focus when the focused control is replaced
// ============================================================================

const OUTSIDE_START = 'Get tables from the suggestion row'

/** A host that owns the chip's state, so a click changes the chip it came from. */
function StatefulChip({
  initial,
  cases = STATE_CASES,
  nouns = SQL_CATALOG_NOUNS,
}: Readonly<{ initial: CatalogChipState; cases?: readonly StateCase[]; nouns?: CatalogChipNouns }>) {
  const [state, setState] = useState<CatalogChipState>(initial)
  const stateCase = caseIn(cases, state)
  return (
    <div>
      <textarea aria-label="Editor" data-testid="sql-editor" />
      <button type="button" onClick={() => setState('connecting')}>
        {OUTSIDE_START}
      </button>
      <CatalogChip
        state={state}
        count={stateCase.count}
        items={stateCase.items}
        nouns={nouns}
        onStart={() => setState('connecting')}
        onStop={() => setState('idle')}
        onRefresh={() => setState('reading')}
        onInsert={vi.fn()}
      />
    </div>
  )
}

/** Renders the chip in `from`, runs `before`, then moves it to `to` on the same mount. */
function moveState(from: CatalogChipState, to: CatalogChipState, before: () => void) {
  const props = (state: CatalogChipState): CatalogChipProps => ({
    state,
    count: caseOf(state).count,
    items: caseOf(state).items,
    nouns: SQL_CATALOG_NOUNS,
    onStart: vi.fn(),
    onStop: vi.fn(),
    onRefresh: vi.fn(),
    onInsert: vi.fn(),
  })
  const view = render(<ChipHarness {...props(from)} />)
  before()
  view.rerender(<ChipHarness {...props(to)} />)
}

const editor = () => screen.getByTestId('sql-editor')

function focusEditor() {
  act(() => {
    editor().focus()
  })
}

describe('CatalogChip - focus follows the replaced control (SQL-12)', () => {
  it.each([
    { initial: 'idle' as const, name: 'Get Tables' },
    { initial: 'failed' as const, name: FAILED_NAME },
    { initial: 'settled' as const, name: REFRESH_NAME },
  ])('moves focus from the clicked $name to the busy Stop', async ({ initial, name }) => {
    const user = userEvent.setup()
    render(<StatefulChip initial={initial} />)

    await user.click(screen.getByRole('button', { name }))

    expect(screen.getByRole('button', { name: STOP_NAME })).toHaveFocus()
  })

  it('moves focus from the clicked busy Stop to the idle Get Tables', async () => {
    const user = userEvent.setup()
    render(<StatefulChip initial="reading" />)

    await user.click(screen.getByRole('button', { name: STOP_NAME }))

    expect(screen.getByRole('button', { name: 'Get Tables' })).toHaveFocus()
  })

  it.each([
    { initial: 'idle' as const, name: 'Get fields' },
    { initial: 'failed' as const, name: FAILED_FIELDS },
    { initial: 'settled' as const, name: REFRESH_FIELDS },
  ])('moves focus from the clicked $name to Stop getting fields', async ({ initial, name }) => {
    const user = userEvent.setup()
    render(<StatefulChip initial={initial} cases={FIELD_CASES} nouns={OPENSEARCH_CATALOG_NOUNS} />)

    await user.click(screen.getByRole('button', { name }))

    expect(screen.getByRole('button', { name: STOP_FIELDS })).toHaveFocus()
  })

  it('moves focus from Stop getting fields to the idle Get fields', async () => {
    const user = userEvent.setup()
    render(<StatefulChip initial="reading" cases={FIELD_CASES} nouns={OPENSEARCH_CATALOG_NOUNS} />)

    await user.click(screen.getByRole('button', { name: STOP_FIELDS }))

    expect(screen.getByRole('button', { name: 'Get fields' })).toHaveFocus()
  })

  it.each([
    { to: 'done' as const, name: 'Got 4 tables' },
    { to: 'settled' as const, name: `Tables ${MIDDLE_DOT} 4` },
    { to: 'failed' as const, name: FAILED_NAME },
  ])('moves focus from the busy Stop to $name when the pull ends', ({ to, name }) => {
    moveState('reading', to, () => focusButton(STOP_NAME))

    expect(screen.getByRole('button', { name })).toHaveFocus()
  })

  it('keeps focus on the Tables button when the done chip settles', () => {
    moveState('done', 'settled', () => focusButton('Got 4 tables'))

    expect(screen.getByRole('button', { name: `Tables ${MIDDLE_DOT} 4` })).toHaveFocus()
  })

  it('keeps focus in the editor when a pull starts from outside the chip', () => {
    moveState('idle', 'connecting', focusEditor)

    expect(editor()).toHaveFocus()
  })

  it.each(['done', 'settled', 'failed'] as const)(
    'keeps focus in the editor when a pull ends %s with focus outside the chip',
    (to) => {
      moveState('reading', to, focusEditor)

      expect(editor()).toHaveFocus()
    },
  )

  it('leaves focus on a control outside the chip that starts the next pull', async () => {
    const user = userEvent.setup()
    render(<StatefulChip initial="idle" />)
    await user.click(screen.getByRole('button', { name: 'Get Tables' }))
    await user.click(screen.getByRole('button', { name: STOP_NAME }))

    await user.click(screen.getByRole('button', { name: OUTSIDE_START }))

    expect(screen.getByRole('button', { name: STOP_NAME })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: OUTSIDE_START })).toHaveFocus()
  })
})

// ============================================================================
// Blocked: nothing can be pulled yet, and the tooltip says why (OS-13)
// ============================================================================

describe('CatalogChip - blocked (OS-13)', () => {
  const NOTE = 'Fill in Index pattern to get fields'

  it.each(FIELD_CASES.map((stateCase) => [stateCase.state, stateCase] as const))(
    'shows Get fields visually disabled whatever the pull is (%s)',
    (_state, stateCase) => {
      renderFieldCase(stateCase, { blockedNote: NOTE })

      const button = screen.getByRole('button', { name: 'Get fields' })
      expect(screen.getAllByRole('button')).toEqual([button])
      expect(button).toHaveAttribute('aria-disabled', 'true')
      expect(button).toHaveClass('opacity-50', 'cursor-not-allowed')
      expect(status().textContent).toBe('Get fields')
      expect(chip()).toHaveAttribute('data-state', 'idle')
      expect(screen.queryByTestId('get-tables-spinner')).not.toBeInTheDocument()
    },
  )

  it('shows the note as the tooltip and the description of the chip', () => {
    renderFieldCase(fieldCaseOf('idle'), { blockedNote: NOTE })

    const button = focusButton('Get fields')

    expect(screen.getByRole('tooltip').textContent).toBe(NOTE)
    expect(button).toHaveAccessibleDescription(NOTE)
  })

  it('shows the note, not the reason of a failed pull', () => {
    renderFieldCase(fieldCaseOf('failed'), { blockedNote: NOTE, error: FIELDS_ERROR })

    focusButton('Get fields')

    expect(screen.getByRole('tooltip').textContent).toBe(NOTE)
  })

  it.each([['idle'], ['failed'], ['settled']] as const)(
    'starts, refreshes and opens nothing on a click (%s)',
    async (state) => {
      const user = userEvent.setup()
      const handlers = renderFieldCase(fieldCaseOf(state), { blockedNote: NOTE })

      await user.click(screen.getByRole('button', { name: 'Get fields' }))

      expect(handlers.onStart).not.toHaveBeenCalled()
      expect(handlers.onRefresh).not.toHaveBeenCalled()
      expect(popover()).not.toBeInTheDocument()
    },
  )

  it('starts nothing from the keyboard', async () => {
    const user = userEvent.setup()
    const handlers = renderFieldCase(fieldCaseOf('idle'), { blockedNote: NOTE })

    focusButton('Get fields')
    await user.keyboard('{Enter}')
    await user.keyboard(' ')

    expect(handlers.onStart).not.toHaveBeenCalled()
  })

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['empty', ''],
  ] as const)('keeps the chip enabled with no note (%s)', async (_label, blockedNote) => {
    const user = userEvent.setup()
    const handlers = renderFieldCase(fieldCaseOf('idle'), { blockedNote })

    const button = screen.getByRole('button', { name: 'Get fields' })
    expect(button).not.toHaveAttribute('aria-disabled')
    expect(button).not.toHaveClass('opacity-50')
    await user.click(button)

    expect(handlers.onStart).toHaveBeenCalledTimes(1)
  })

  it('shows the pull again once the note is gone', () => {
    const settled = fieldCaseOf('settled')
    const props: CatalogChipProps = {
      state: settled.state,
      count: settled.count,
      items: settled.items,
      nouns: OPENSEARCH_CATALOG_NOUNS,
      onStart: vi.fn(),
      onStop: vi.fn(),
      onRefresh: vi.fn(),
      onInsert: vi.fn(),
    }
    const view = render(<ChipHarness {...props} blockedNote={NOTE} />)
    expect(screen.getAllByRole('button').map((button) => button.textContent)).toEqual(['Get fields'])

    view.rerender(<ChipHarness {...props} blockedNote={null} />)

    expect(screen.getByRole('button', { name: settled.label })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: REFRESH_FIELDS })).toBeInTheDocument()
    expect(chip()).toHaveAttribute('data-state', 'settled')
  })
})

// ============================================================================
// A short footer: the chip's label gives way first, cut with an ellipsis
// ============================================================================

const FOOTER_CASES = [
  ...STATE_CASES.map((stateCase) => ({ ...stateCase, nouns: SQL_CATALOG_NOUNS })),
  ...FIELD_CASES.map((stateCase) => ({ ...stateCase, nouns: OPENSEARCH_CATALOG_NOUNS })),
]
const LABELED_CASES = FOOTER_CASES.filter((stateCase) => !BUSY_STATES.has(stateCase.state))
const BUSY_FOOTER_CASES = FOOTER_CASES.filter((stateCase) => BUSY_STATES.has(stateCase.state))
const LOADED_CASES = LABELED_CASES.filter(
  (stateCase) => stateCase.state === 'done' || stateCase.state === 'settled',
)

/** The chip's words inside its own button. */
function chipLabel(button: HTMLElement, label: string): HTMLElement {
  return within(button).getByText(label)
}

describe('CatalogChip - a short footer (SQL-12, OS-12)', () => {
  it.each(LABELED_CASES)('lets the $label chip shrink in the footer', (stateCase) => {
    renderCase(stateCase, { nouns: stateCase.nouns })

    expect(chip()).toHaveClass('min-w-0')
    expect(screen.getByRole('button', { name: stateCase.label })).toHaveClass('min-w-0')
  })

  it.each(LABELED_CASES)('cuts the label $label with an ellipsis, on one line', (stateCase) => {
    renderCase(stateCase, { nouns: stateCase.nouns })

    const button = screen.getByRole('button', { name: stateCase.label })
    const label = chipLabel(button, stateCase.label)
    expect(label.parentElement).toBe(button)
    expect(label).toHaveClass('min-w-0', 'truncate')
  })

  it.each(LABELED_CASES)('holds only a whole icon and the label in the $label button', (stateCase) => {
    renderCase(stateCase, { nouns: stateCase.nouns })

    const button = screen.getByRole('button', { name: stateCase.label })
    const [icon, label, ...rest] = Array.from(button.children)
    expect(icon.tagName.toLowerCase()).toBe('svg')
    expect(icon).toHaveClass('shrink-0')
    expect(label).toBe(chipLabel(button, stateCase.label))
    expect(rest).toEqual([])
  })

  it.each(BUSY_FOOTER_CASES)('cuts the busy status $label with an ellipsis, never the spinner or Stop', (stateCase) => {
    renderCase(stateCase, { nouns: stateCase.nouns })

    expect(chip()).toHaveClass('min-w-0')
    expect(status()).toHaveClass('min-w-0', 'truncate')
    expect(screen.getByTestId('get-tables-spinner')).toHaveClass('shrink-0')
    expect(screen.getByRole('button', { name: stateCase.nouns.stopLabel })).toHaveClass('shrink-0')
  })

  it.each([
    [SQL_CATALOG_NOUNS, caseOf('settled')],
    [OPENSEARCH_CATALOG_NOUNS, fieldCaseOf('settled')],
  ] as const)('keeps the refresh button whole (%#)', (nouns, stateCase) => {
    renderCase(stateCase, { nouns })

    expect(screen.getByRole('button', { name: nouns.refreshLabel })).toHaveClass('shrink-0')
  })

  it.each(LOADED_CASES)('shows no tooltip on the $label chip while its label fits', (stateCase) => {
    renderCase(stateCase, { nouns: stateCase.nouns })

    focusButton(stateCase.label)

    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
  })
})

describe('CatalogChip - a label cut short (SQL-12, OS-12, OS-13)', () => {
  const NOTE = 'Fill in Index pattern to get fields'
  let restoreWidths: () => void = () => {}

  // jsdom lays nothing out: every label reads wider than its box.
  beforeEach(() => {
    const scrollWidth = vi.spyOn(Element.prototype, 'scrollWidth', 'get').mockReturnValue(160)
    const clientWidth = vi.spyOn(Element.prototype, 'clientWidth', 'get').mockReturnValue(120)
    restoreWidths = () => {
      scrollWidth.mockRestore()
      clientWidth.mockRestore()
    }
  })

  afterEach(() => {
    restoreWidths()
  })

  const tooltipLines = () => Array.from(screen.getByRole('tooltip').children).map((line) => line.textContent)

  it.each(LABELED_CASES.filter((stateCase) => stateCase.state === 'idle'))(
    'shows the whole label $label as the tooltip',
    (stateCase) => {
      renderCase(stateCase, { nouns: stateCase.nouns })

      focusButton(stateCase.label)

      expect(screen.getByRole('tooltip').textContent).toBe(stateCase.label)
    },
  )

  it.each(LOADED_CASES)('shows the whole label $label as the tooltip of the loaded chip', (stateCase) => {
    renderCase(stateCase, { nouns: stateCase.nouns })

    focusButton(stateCase.label)

    expect(screen.getByRole('tooltip').textContent).toBe(stateCase.label)
  })

  it.each(LOADED_CASES)('still opens the popover from the $label chip', async (stateCase) => {
    const user = userEvent.setup()
    renderCase(stateCase, { nouns: stateCase.nouns })

    await openPopover(user, stateCase.label)

    expect(popover()).toBeInTheDocument()
  })

  it('shows the whole label, then the reason, on the failed chip', () => {
    renderFieldCase(fieldCaseOf('failed'), { error: FIELDS_ERROR })

    const button = focusButton(FAILED_FIELDS)

    expect(tooltipLines()).toEqual([FAILED_FIELDS, FIELDS_ERROR])
    expect(button).toHaveAccessibleName(FAILED_FIELDS)
  })

  it('shows only the whole label on a failed chip with no reason', () => {
    renderChip({ state: 'failed', error: null })

    focusButton(FAILED_NAME)

    expect(screen.getByRole('tooltip').textContent).toBe(FAILED_NAME)
  })

  it('shows the whole label, then the note, on the blocked chip', () => {
    renderFieldCase(fieldCaseOf('idle'), { blockedNote: NOTE })

    focusButton('Get fields')

    expect(tooltipLines()).toEqual(['Get fields', NOTE])
  })

  it.each(LABELED_CASES)('keeps $label whole as the accessible name', (stateCase) => {
    renderCase(stateCase, { nouns: stateCase.nouns })

    expect(screen.getByRole('button', { name: stateCase.label })).toBeInTheDocument()
  })
})
