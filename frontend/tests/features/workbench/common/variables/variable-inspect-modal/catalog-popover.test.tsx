/**
 * CatalogPopover: the search popover over a loaded catalog - SQL tables with their columns under them, or flat
 * OpenSearch fields with their types - with the nouns of its catalog.
 *
 * REQ-3.4.1.6, REQ-3.3.2.6; SQL-12, OS-12, OS-13
 */

import { useRef, useState } from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import type { SqlTable } from '@/features/workbench/api/sql-tools'
import {
  CatalogPopover,
  type CatalogItem,
  type CatalogPopoverNouns,
} from '@/features/workbench/common/variables/variable-inspect-modal/catalog-popover'
import {
  OPENSEARCH_CATALOG_NOUNS,
  SQL_CATALOG_NOUNS,
} from '@/features/workbench/common/variables/variable-inspect-modal/catalog-chip'

import { SAMPLE_FIELDS } from '../../../opensearch-fixtures'
import { SAMPLE_TABLES } from '../../../sql-fixtures'

type User = ReturnType<typeof userEvent.setup>

const CATALOG_ORDER = ['orders', 'order_items', 'customers', 'active_customers']

const NO_MATCH_TEXT = 'No matching tables'
const NO_TABLES_TEXT = 'No tables'

/** A table as the SQL editor lists it: its columns under it, no detail of its own. */
function tableItem(table: SqlTable): CatalogItem {
  return {
    name: table.name,
    detail: '',
    children: table.columns.map((column) => ({ name: column.name, detail: column.type })),
  }
}

const TABLE_ITEMS: readonly CatalogItem[] = SAMPLE_TABLES.map(tableItem)

// A mixed-case name: the match element shows the name as written, not the query.
const ORDER_LINES = tableItem({
  schema: 'dbo',
  name: 'OrderLines',
  kind: 'table',
  columns: [
    { name: 'LineId', type: 'int' },
    { name: 'Sku', type: 'nvarchar' },
  ],
})

/** A field as the Query editor lists it: flat, its types as the detail. */
const FIELD_ITEMS: readonly CatalogItem[] = SAMPLE_FIELDS.map((field) => ({
  name: field.name,
  detail: field.types.join(', '),
}))

const FIELD_ORDER = SAMPLE_FIELDS.map((field) => field.name)

interface HarnessProps {
  readonly items?: readonly CatalogItem[]
  readonly nouns?: CatalogPopoverNouns
  readonly initialOpen?: boolean
  readonly onOpenChange: (open: boolean) => void
  readonly onInsert: (name: string) => void
  readonly onClosed?: () => void
}

/** The chip host: an editor that takes focus back on close, and a trigger. */
function PopoverHarness({
  items = TABLE_ITEMS,
  nouns = SQL_CATALOG_NOUNS.popover,
  initialOpen = true,
  onOpenChange,
  onInsert,
  onClosed,
}: HarnessProps) {
  const [open, setOpen] = useState(initialOpen)
  const editorRef = useRef<HTMLTextAreaElement>(null)
  const handleClosed =
    onClosed === undefined
      ? undefined
      : () => {
          onClosed()
          editorRef.current?.focus()
        }

  return (
    <div>
      <textarea ref={editorRef} aria-label="Editor" data-testid="sql-editor" />
      <CatalogPopover
        open={open}
        onOpenChange={(next: boolean) => {
          onOpenChange(next)
          setOpen(next)
        }}
        items={items}
        nouns={nouns}
        onInsert={onInsert}
        onClosed={handleClosed}
      >
        <button type="button" data-testid="tables-trigger">
          Catalog
        </button>
      </CatalogPopover>
    </div>
  )
}

interface RenderOptions {
  readonly items?: readonly CatalogItem[]
  readonly nouns?: CatalogPopoverNouns
  readonly initialOpen?: boolean
  readonly withOnClosed?: boolean
}

function renderPopover({ items, nouns, initialOpen, withOnClosed = true }: RenderOptions = {}) {
  const onOpenChange = vi.fn<(open: boolean) => void>()
  const onInsert = vi.fn<(name: string) => void>()
  const onClosed = vi.fn<() => void>()
  render(
    <PopoverHarness
      items={items}
      nouns={nouns}
      initialOpen={initialOpen}
      onOpenChange={onOpenChange}
      onInsert={onInsert}
      onClosed={withOnClosed ? onClosed : undefined}
    />,
  )
  return { onOpenChange, onInsert, onClosed }
}

function renderFields(options: Omit<RenderOptions, 'nouns'> = {}) {
  return renderPopover({ items: FIELD_ITEMS, nouns: OPENSEARCH_CATALOG_NOUNS.popover, ...options })
}

const trigger = () => screen.getByTestId('tables-trigger')
const popover = () => screen.queryByTestId('tables-popover')
// cmdk labels its input by an empty label of its own, so the box is found by role.
const searchBox = () => within(screen.getByTestId('tables-popover')).getByRole('combobox')
const row = (name: string) => screen.getByTestId(`tables-popover-item-${name}`)

function normalize(text: string): string {
  return text.replaceAll(/\s+/g, ' ').trim()
}

function rowNames(): string[] {
  return screen
    .queryAllByTestId(/^tables-popover-item-/)
    .map((el) => (el.getAttribute('data-testid') ?? '').replace('tables-popover-item-', ''))
}

function columnsOf(name: string): string[] {
  const columns = within(row(name)).getByTestId(`tables-popover-columns-${name}`)
  return normalize(columns.textContent ?? '').split(' ')
}

function detailOf(name: string): string | null {
  return within(row(name)).queryByTestId(`tables-popover-detail-${name}`)?.textContent ?? null
}

/** The row's text without its columns line and its detail. */
function nameLineOf(name: string): string {
  const clone = row(name).cloneNode(true) as HTMLElement
  clone.querySelector(`[data-testid="tables-popover-columns-${name}"]`)?.remove()
  clone.querySelector(`[data-testid="tables-popover-detail-${name}"]`)?.remove()
  return normalize(clone.textContent ?? '')
}

function matchTextOf(name: string): string | null {
  const matches = within(row(name)).queryAllByTestId('tables-popover-match')
  expect(matches.length, `row ${name} holds at most one match element`).toBeLessThanOrEqual(1)
  return matches[0]?.textContent ?? null
}

function highlightedRows(): string[] {
  return screen
    .queryAllByTestId(/^tables-popover-item-/)
    .filter((el) => el.getAttribute('aria-selected') === 'true')
    .map((el) => (el.getAttribute('data-testid') ?? '').replace('tables-popover-item-', ''))
}

async function openedPopover() {
  await waitFor(() => {
    expect(searchBox()).toHaveFocus()
  })
}

async function search(user: User, query: string) {
  await openedPopover()
  await user.type(searchBox(), query)
}

// ============================================================================
// Opening
// ============================================================================

describe('CatalogPopover - opening (SQL-12)', () => {
  it('renders only its trigger while closed', () => {
    renderPopover({ initialOpen: false })

    expect(trigger()).toBeInTheDocument()
    expect(popover()).not.toBeInTheDocument()
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
  })

  it('uses the given element as its trigger, with no wrapper button around it', () => {
    renderPopover({ initialOpen: false })

    expect(screen.getAllByRole('button')).toEqual([trigger()])
    expect(trigger()).toHaveAttribute('aria-expanded', 'false')
  })

  it('asks to open when its trigger is clicked', async () => {
    const user = userEvent.setup()
    const { onOpenChange } = renderPopover({ initialOpen: false })

    await user.click(trigger())

    expect(onOpenChange.mock.calls).toEqual([[true]])
    expect(popover()).toBeInTheDocument()
    expect(trigger()).toHaveAttribute('aria-expanded', 'true')
  })

  it('shows its content while open, with a search box labeled Search tables', () => {
    renderPopover()

    expect(popover()).toBeInTheDocument()
    expect(within(popover() as HTMLElement).getAllByRole('combobox')).toHaveLength(1)
    expect(searchBox()).toHaveAttribute('aria-label', 'Search tables')
  })

  it('shows the placeholder Search tables… in the empty search box', () => {
    renderPopover()

    expect(searchBox()).toHaveAttribute('placeholder', 'Search tables…')
  })

  it('names the list Tables', () => {
    renderPopover()

    expect(popover()).toHaveAttribute('aria-label', 'Tables')
  })

  it('puts focus in the search box when it opens', async () => {
    renderPopover()

    await waitFor(() => {
      expect(searchBox()).toHaveFocus()
    })
  })

  it('puts focus in the search box when opened from its trigger', async () => {
    const user = userEvent.setup()
    renderPopover({ initialOpen: false })

    await user.click(trigger())

    await waitFor(() => {
      expect(searchBox()).toHaveFocus()
    })
  })

  it('starts with an empty search box', () => {
    renderPopover()

    expect(searchBox()).toHaveValue('')
  })
})

// ============================================================================
// Rows
// ============================================================================

describe('CatalogPopover - rows (SQL-12)', () => {
  it('lists every loaded table in catalog order', () => {
    renderPopover()

    expect(rowNames()).toEqual(CATALOG_ORDER)
  })

  it('shows each table name on the first line and its columns in catalog order on the second', () => {
    renderPopover()

    for (const table of SAMPLE_TABLES) {
      expect(nameLineOf(table.name)).toBe(table.name)
      expect(columnsOf(table.name)).toEqual(table.columns.map((column: { name: string }) => column.name))
    }
  })

  it('shows no detail for a table whose detail is empty', () => {
    renderPopover()

    for (const name of CATALOG_ORDER) {
      expect(detailOf(name)).toBeNull()
    }
  })

  it('lists a view like a table, with no mark of its own', () => {
    renderPopover()

    expect(nameLineOf('active_customers')).toBe('active_customers')
    expect(columnsOf('active_customers')).toEqual(['id', 'email'])
    expect(row('active_customers').textContent).not.toContain('view')
  })

  it('highlights the first row when it opens', () => {
    renderPopover()

    expect(highlightedRows()).toEqual(['orders'])
    for (const name of CATALOG_ORDER.slice(1)) {
      expect(row(name)).toHaveAttribute('aria-selected', 'false')
    }
  })

  it('shows no match element while the query is empty', () => {
    renderPopover()

    expect(screen.queryAllByTestId('tables-popover-match')).toHaveLength(0)
  })

  it('does not show the no-match text while rows are listed', () => {
    renderPopover()

    expect(screen.queryByText(NO_MATCH_TEXT)).not.toBeInTheDocument()
  })

  it('does not show No tables while rows are listed', () => {
    renderPopover()

    expect(screen.queryByText(NO_TABLES_TEXT)).not.toBeInTheDocument()
  })

  it('says No tables, and no row, for a loaded catalog with no tables', () => {
    renderPopover({ items: [] })

    expect(rowNames()).toEqual([])
    expect(within(screen.getByTestId('tables-popover')).getByText(NO_TABLES_TEXT)).toBeInTheDocument()
  })

  it('does not say No matching tables for a loaded catalog with no tables while nothing is typed', () => {
    renderPopover({ items: [] })

    expect(searchBox()).toHaveValue('')
    expect(screen.queryByText(NO_MATCH_TEXT)).not.toBeInTheDocument()
  })

  it('keeps saying No tables, not No matching tables, when a search is typed over a catalog with no tables', async () => {
    const user = userEvent.setup()
    renderPopover({ items: [] })

    await search(user, 'ord')

    expect(rowNames()).toEqual([])
    expect(within(screen.getByTestId('tables-popover')).getByText(NO_TABLES_TEXT)).toBeInTheDocument()
    expect(screen.queryByText(NO_MATCH_TEXT)).not.toBeInTheDocument()
  })
})

// ============================================================================
// Search
// ============================================================================

describe('CatalogPopover - search (SQL-12)', () => {
  it('keeps only the tables whose name holds the query, a column never keeps one', async () => {
    const user = userEvent.setup()
    renderPopover()

    await search(user, 'ord')

    // customers has the column order_count, but its name does not hold "ord".
    expect(rowNames()).toEqual(['orders', 'order_items'])
  })

  it('marks the matched part of each kept name and still reads the whole name', async () => {
    const user = userEvent.setup()
    renderPopover()

    await search(user, 'ord')

    for (const name of ['orders', 'order_items']) {
      expect(matchTextOf(name)).toBe('ord')
      expect(nameLineOf(name)).toBe(name)
      const match = within(row(name)).getByTestId('tables-popover-match')
      expect(within(row(name)).getByTestId(`tables-popover-columns-${name}`)).not.toContainElement(
        match,
      )
    }
  })

  it('keeps the columns line under each kept name', async () => {
    const user = userEvent.setup()
    renderPopover()

    await search(user, 'ord')

    expect(columnsOf('orders')).toEqual(['id', 'customer_id', 'status', 'total', 'created_at'])
    expect(columnsOf('order_items')).toEqual(['id', 'order_id', 'sku', 'qty', 'price'])
  })

  it('matches without regard to case', async () => {
    const user = userEvent.setup()
    renderPopover()

    await search(user, 'ORD')

    expect(rowNames()).toEqual(['orders', 'order_items'])
    expect(matchTextOf('orders')).toBe('ord')
    expect(matchTextOf('order_items')).toBe('ord')
  })

  it('matches inside a name, not only at its start', async () => {
    const user = userEvent.setup()
    renderPopover()

    await search(user, 'items')

    expect(rowNames()).toEqual(['order_items'])
    expect(matchTextOf('order_items')).toBe('items')
    expect(nameLineOf('order_items')).toBe('order_items')
  })

  it('shows the matched part as the name writes it, not as the query does', async () => {
    const user = userEvent.setup()
    renderPopover({ items: [...TABLE_ITEMS, ORDER_LINES] })

    await search(user, 'lines')

    expect(rowNames()).toEqual(['OrderLines'])
    expect(matchTextOf('OrderLines')).toBe('Lines')
    expect(nameLineOf('OrderLines')).toBe('OrderLines')
  })

  it('lists a view that matches', async () => {
    const user = userEvent.setup()
    renderPopover()

    await search(user, 'active')

    expect(rowNames()).toEqual(['active_customers'])
    expect(matchTextOf('active_customers')).toBe('active')
  })

  it('keeps no table when only a column holds the query', async () => {
    const user = userEvent.setup()
    renderPopover()

    await search(user, 'email')

    expect(rowNames()).toEqual([])
    expect(screen.getByText(NO_MATCH_TEXT)).toBeInTheDocument()
  })

  it('shows No matching tables and no row when no name holds the query', async () => {
    const user = userEvent.setup()
    renderPopover()

    await search(user, 'zzz')

    expect(rowNames()).toEqual([])
    expect(screen.getByText(NO_MATCH_TEXT)).toBeInTheDocument()
    expect(screen.queryAllByTestId('tables-popover-match')).toHaveLength(0)
  })

  it('says No matching tables, not No tables, when a typed search keeps none of the loaded tables', async () => {
    const user = userEvent.setup()
    renderPopover()

    await search(user, 'zzz')

    expect(screen.getByText(NO_MATCH_TEXT)).toBeInTheDocument()
    expect(screen.queryByText(NO_TABLES_TEXT)).not.toBeInTheDocument()
  })

  it('lists every table again, with no match element, once the query is cleared', async () => {
    const user = userEvent.setup()
    renderPopover()
    await search(user, 'ord')
    expect(rowNames()).toEqual(['orders', 'order_items'])

    await user.clear(searchBox())

    expect(rowNames()).toEqual(CATALOG_ORDER)
    expect(screen.queryAllByTestId('tables-popover-match')).toHaveLength(0)
    expect(screen.queryByText(NO_MATCH_TEXT)).not.toBeInTheDocument()
  })

  it('highlights the first kept row once the list narrows', async () => {
    const user = userEvent.setup()
    renderPopover()

    await search(user, 'items')

    expect(highlightedRows()).toEqual(['order_items'])
  })
})

// ============================================================================
// Inserting
// ============================================================================

describe('CatalogPopover - inserting (SQL-12)', () => {
  it('inserts the highlighted table on Enter, then closes', async () => {
    const user = userEvent.setup()
    const { onInsert, onOpenChange } = renderPopover()
    await openedPopover()

    await user.keyboard('{Enter}')

    expect(onInsert.mock.calls).toEqual([['orders']])
    expect(onOpenChange.mock.calls).toEqual([[false]])
    expect(onInsert.mock.invocationCallOrder[0]).toBeLessThan(
      onOpenChange.mock.invocationCallOrder[0],
    )
    expect(popover()).not.toBeInTheDocument()
  })

  it('moves the highlight with ArrowDown and ArrowUp', async () => {
    const user = userEvent.setup()
    renderPopover()
    await openedPopover()

    await user.keyboard('{ArrowDown}')
    expect(highlightedRows()).toEqual(['order_items'])

    await user.keyboard('{ArrowUp}')
    expect(highlightedRows()).toEqual(['orders'])
  })

  it('inserts the next table on ArrowDown then Enter', async () => {
    const user = userEvent.setup()
    const { onInsert, onOpenChange } = renderPopover()
    await openedPopover()

    await user.keyboard('{ArrowDown}{Enter}')

    expect(onInsert.mock.calls).toEqual([['order_items']])
    expect(onOpenChange.mock.calls).toEqual([[false]])
    expect(popover()).not.toBeInTheDocument()
  })

  it('inserts the first kept table on Enter after a search', async () => {
    const user = userEvent.setup()
    const { onInsert } = renderPopover()

    await search(user, 'items')
    await user.keyboard('{Enter}')

    expect(onInsert.mock.calls).toEqual([['order_items']])
    expect(popover()).not.toBeInTheDocument()
  })

  it('inserts a clicked table, then closes', async () => {
    const user = userEvent.setup()
    const { onInsert, onOpenChange } = renderPopover()
    await openedPopover()

    await user.click(row('customers'))

    expect(onInsert.mock.calls).toEqual([['customers']])
    expect(onOpenChange.mock.calls).toEqual([[false]])
    expect(onInsert.mock.invocationCallOrder[0]).toBeLessThan(
      onOpenChange.mock.invocationCallOrder[0],
    )
    expect(popover()).not.toBeInTheDocument()
  })

  it('inserts a clicked view by its name', async () => {
    const user = userEvent.setup()
    const { onInsert } = renderPopover()
    await openedPopover()

    await user.click(row('active_customers'))

    expect(onInsert.mock.calls).toEqual([['active_customers']])
  })

  it('inserts nothing on Enter when no table matches', async () => {
    const user = userEvent.setup()
    const { onInsert } = renderPopover()

    await search(user, 'zzz')
    await user.keyboard('{Enter}')

    expect(onInsert).not.toHaveBeenCalled()
    expect(screen.getByText(NO_MATCH_TEXT)).toBeInTheDocument()
  })
})

// ============================================================================
// Closing
// ============================================================================

describe('CatalogPopover - closing (SQL-12)', () => {
  it('closes on Escape without inserting', async () => {
    const user = userEvent.setup()
    const { onInsert, onOpenChange } = renderPopover()
    await openedPopover()

    await user.keyboard('{Escape}')

    expect(onOpenChange.mock.calls).toEqual([[false]])
    expect(onInsert).not.toHaveBeenCalled()
    expect(popover()).not.toBeInTheDocument()
    expect(trigger()).toHaveAttribute('aria-expanded', 'false')
  })

  it('calls onClosed on Escape and leaves focus where onClosed put it, not on the trigger', async () => {
    const user = userEvent.setup()
    const { onClosed } = renderPopover()
    await openedPopover()

    await user.keyboard('{Escape}')

    await waitFor(() => {
      expect(onClosed).toHaveBeenCalledTimes(1)
    })
    expect(screen.getByTestId('sql-editor')).toHaveFocus()
    expect(trigger()).not.toHaveFocus()
  })

  it('calls onClosed after a pick and leaves focus where onClosed put it', async () => {
    const user = userEvent.setup()
    const { onClosed, onInsert } = renderPopover()
    await openedPopover()

    await user.keyboard('{Enter}')

    expect(onInsert.mock.calls).toEqual([['orders']])
    await waitFor(() => {
      expect(onClosed).toHaveBeenCalledTimes(1)
    })
    expect(screen.getByTestId('sql-editor')).toHaveFocus()
    expect(trigger()).not.toHaveFocus()
  })

  it('does not call onClosed while it stays open', async () => {
    const user = userEvent.setup()
    const { onClosed } = renderPopover()

    await search(user, 'ord')

    expect(onClosed).not.toHaveBeenCalled()
  })

  it('closes without an onClosed handler', async () => {
    const user = userEvent.setup()
    const { onOpenChange } = renderPopover({ withOnClosed: false })
    await openedPopover()

    await user.keyboard('{Escape}')

    expect(onOpenChange.mock.calls).toEqual([[false]])
    expect(popover()).not.toBeInTheDocument()
  })

  it('clears the query on Escape, so reopening lists every table', async () => {
    const user = userEvent.setup()
    renderPopover()
    await search(user, 'ord')

    await user.keyboard('{Escape}')
    expect(popover()).not.toBeInTheDocument()
    await user.click(trigger())
    await openedPopover()

    expect(searchBox()).toHaveValue('')
    expect(rowNames()).toEqual(CATALOG_ORDER)
    expect(screen.queryAllByTestId('tables-popover-match')).toHaveLength(0)
  })

  it('clears the query after a pick, so reopening lists every table', async () => {
    const user = userEvent.setup()
    renderPopover()
    await search(user, 'ord')

    await user.keyboard('{Enter}')
    expect(popover()).not.toBeInTheDocument()
    await user.click(trigger())
    await openedPopover()

    expect(searchBox()).toHaveValue('')
    expect(rowNames()).toEqual(CATALOG_ORDER)
    expect(highlightedRows()).toEqual(['orders'])
  })
})

// ============================================================================
// OpenSearch fields: flat items with types and the Fields nouns
// ============================================================================

describe('CatalogPopover - OpenSearch fields (OS-12, OS-13)', () => {
  it('labels the search box Search fields and shows the placeholder Search fields…', () => {
    renderFields()

    expect(searchBox()).toHaveAttribute('aria-label', 'Search fields')
    expect(searchBox()).toHaveAttribute('placeholder', 'Search fields…')
  })

  it('names the list Fields', () => {
    renderFields()

    expect(popover()).toHaveAttribute('aria-label', 'Fields')
  })

  it('lists every field flat, in the order the server answered', () => {
    renderFields()

    expect(rowNames()).toEqual(FIELD_ORDER)
    expect(screen.queryAllByTestId(/^tables-popover-columns-/)).toHaveLength(0)
  })

  it('shows each field name with its types beside it', () => {
    renderFields()

    for (const field of SAMPLE_FIELDS) {
      expect(nameLineOf(field.name)).toBe(field.name)
      expect(detailOf(field.name)).toBe(field.types.join(', '))
    }
  })

  it('shows every type of a field mapped differently across the indexes', () => {
    renderFields()

    expect(detailOf('status')).toBe('keyword, long')
  })

  it('highlights the first field when it opens', () => {
    renderFields()

    expect(highlightedRows()).toEqual(['@timestamp'])
  })

  it('keeps the fields whose dotted name holds the query', async () => {
    const user = userEvent.setup()
    renderFields()

    await search(user, 'service.')

    expect(rowNames()).toEqual(['service.name', 'service.version'])
    expect(matchTextOf('service.name')).toBe('service.')
    expect(nameLineOf('service.name')).toBe('service.name')
  })

  it('matches the part of a name after its dot', async () => {
    const user = userEvent.setup()
    renderFields()

    await search(user, 'level')

    expect(rowNames()).toEqual(['log.level'])
    expect(matchTextOf('log.level')).toBe('level')
    expect(detailOf('log.level')).toBe('keyword')
  })

  it('never keeps a field for its type alone and says No matching fields', async () => {
    const user = userEvent.setup()
    renderFields()

    await search(user, 'keyword')

    expect(rowNames()).toEqual([])
    expect(within(popover() as HTMLElement).getByText('No matching fields')).toBeInTheDocument()
    expect(screen.queryByText('No fields')).not.toBeInTheDocument()
  })

  it('says No fields, and no row, for a pull that found no fields', () => {
    renderFields({ items: [] })

    expect(rowNames()).toEqual([])
    expect(within(popover() as HTMLElement).getByText('No fields')).toBeInTheDocument()
    expect(screen.queryByText('No matching fields')).not.toBeInTheDocument()
  })

  it('keeps saying No fields when a search is typed over no fields', async () => {
    const user = userEvent.setup()
    renderFields({ items: [] })

    await search(user, 'log')

    expect(within(popover() as HTMLElement).getByText('No fields')).toBeInTheDocument()
    expect(screen.queryByText('No matching fields')).not.toBeInTheDocument()
  })

  it('shows no table noun anywhere in the fields popover', async () => {
    const user = userEvent.setup()
    renderFields()

    await search(user, 'zzz')

    expect(within(popover() as HTMLElement).queryByText(/tables/i)).not.toBeInTheDocument()
    expect(searchBox()).not.toHaveAttribute('aria-label', 'Search tables')
  })

  it('inserts the highlighted first field on Enter, then closes', async () => {
    const user = userEvent.setup()
    const { onInsert, onOpenChange } = renderFields()
    await openedPopover()

    await user.keyboard('{Enter}')

    expect(onInsert.mock.calls).toEqual([['@timestamp']])
    expect(onOpenChange.mock.calls).toEqual([[false]])
    expect(popover()).not.toBeInTheDocument()
  })

  it('inserts the whole dotted name of a clicked field, not its types', async () => {
    const user = userEvent.setup()
    const { onInsert } = renderFields()
    await openedPopover()

    await user.click(row('log.level'))

    expect(onInsert.mock.calls).toEqual([['log.level']])
    expect(popover()).not.toBeInTheDocument()
  })

  it('inserts the first kept field on Enter after a search', async () => {
    const user = userEvent.setup()
    const { onInsert } = renderFields()

    await search(user, 'latency')
    await user.keyboard('{Enter}')

    expect(onInsert.mock.calls).toEqual([['latency_ms']])
  })
})
