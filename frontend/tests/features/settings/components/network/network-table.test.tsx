/**
 * NetworkTable Component Tests
 *
 * REQ-4.5.14, NET-3: SearchInput (left) + actions slot (right) over the
 * shared DataTable with client-side search, sortable headers, 10 rows per
 * page, empty state and optional selection. No Columns menu.
 *
 * Component under test: frontend/src/features/settings/components/network/network-table.tsx
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ColumnDef } from '@tanstack/react-table'
import type { ComponentProps } from 'react'

import { NetworkTable } from '@/features/settings/components/network/network-table'

interface ServerRow {
  id: string
  name: string
  port: number
  owner: string
}

const COLUMNS: ColumnDef<ServerRow, unknown>[] = [
  { id: 'name', accessorKey: 'name', header: 'Name' },
  { id: 'port', accessorKey: 'port', header: 'Port' },
]

const THREE_ROWS: ServerRow[] = [
  { id: 's-alpha', name: 'alpha', port: 22, owner: 'carol' },
  { id: 's-bravo', name: 'bravo', port: 2222, owner: 'dave' },
  { id: 's-charlie', name: 'charlie', port: 80, owner: 'carol' },
]

const TWELVE_ROWS: ServerRow[] = Array.from({ length: 12 }, (_, index) => {
  const number = String(index + 1).padStart(2, '0')
  return { id: `s-${number}`, name: `host-${number}`, port: 22, owner: 'erin' }
})

type ServerTableProps = ComponentProps<typeof NetworkTable<ServerRow>>

function renderTable(props: Partial<ServerTableProps> = {}) {
  const defaults: ServerTableProps = {
    columns: COLUMNS,
    data: THREE_ROWS,
    getRowId: (row) => row.id,
    getRowLabel: (row) => row.name,
    searchPlaceholder: 'Search servers…',
    searchText: (row) => `${row.name} ${row.owner}`,
    entityName: 'servers',
    emptyMessage: 'No servers yet',
    'data-testid': 'server-table',
    ...props,
  }
  return render(<NetworkTable {...defaults} />)
}

function bodyRows(): HTMLElement[] {
  return within(screen.getByRole('table')).getAllByRole('row').slice(1)
}

function firstCellTexts(): string[] {
  return bodyRows().map((row) => within(row).getAllByRole('cell')[0].textContent ?? '')
}

describe('NetworkTable', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Toolbar', () => {
    it('renders the search input with the given placeholder inside the table wrapper', () => {
      renderTable()

      const wrapper = screen.getByTestId('server-table')
      expect(within(wrapper).getByPlaceholderText('Search servers…')).toBeInTheDocument()
      expect(within(wrapper).getByRole('table')).toBeInTheDocument()
    })

    it('renders the actions slot after the search input and before the table', () => {
      renderTable({ actions: <button type="button">Add servers</button> })

      const search = screen.getByPlaceholderText('Search servers…')
      const action = screen.getByRole('button', { name: 'Add servers' })
      const table = screen.getByRole('table')
      expect(search.compareDocumentPosition(action) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
      expect(action.compareDocumentPosition(table) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    })

    it('has no Columns menu', () => {
      renderTable({ actions: <button type="button">Add servers</button> })

      expect(screen.queryByRole('button', { name: /columns/i })).not.toBeInTheDocument()
    })

    it('keeps the browser from filling or spell-checking the search input', () => {
      renderTable()

      const search = screen.getByRole('searchbox', { name: 'Search servers' })
      expect(search).toHaveAttribute('autocomplete', 'off')
      expect(search).toHaveAttribute('spellcheck', 'false')
    })
  })

  describe('Search', () => {
    it('filters rows through searchText, including text no column shows', async () => {
      const user = userEvent.setup()
      renderTable()

      await user.type(screen.getByPlaceholderText('Search servers…'), 'carol')

      await waitFor(() => {
        expect(firstCellTexts()).toEqual(['alpha', 'charlie'])
      })
      expect(screen.getByTestId('pagination-item-count')).toHaveTextContent('Showing 1-2 of 2 servers')
    })

    it('matches an upper-case query against lower-case text', async () => {
      const user = userEvent.setup()
      renderTable()

      await user.type(screen.getByPlaceholderText('Search servers…'), 'BRAVO')

      await waitFor(() => {
        expect(firstCellTexts()).toEqual(['bravo'])
      })
    })

    it('matches a lower-case query against mixed-case text', async () => {
      const user = userEvent.setup()
      renderTable({
        data: [
          { id: 's-delta', name: 'Delta-Gateway', port: 22, owner: 'Frank' },
          { id: 's-echo', name: 'echo', port: 22, owner: 'grace' },
        ],
      })

      await user.type(screen.getByPlaceholderText('Search servers…'), 'delta-gateway')

      await waitFor(() => {
        expect(firstCellTexts()).toEqual(['Delta-Gateway'])
      })
    })

    it('shows every row again when the search is cleared', async () => {
      const user = userEvent.setup()
      renderTable()
      const input = screen.getByPlaceholderText('Search servers…')

      await user.type(input, 'dave')
      await waitFor(() => {
        expect(firstCellTexts()).toEqual(['bravo'])
      })
      await user.clear(input)

      await waitFor(() => {
        expect(bodyRows()).toHaveLength(3)
      })
    })

    it('returns to the first page when the search changes', async () => {
      const user = userEvent.setup()
      renderTable({ data: TWELVE_ROWS })

      await user.click(screen.getByRole('button', { name: 'Next page' }))
      expect(screen.getByTestId('pagination-item-count')).toHaveTextContent('Showing 11-12 of 12 servers')

      await user.type(screen.getByPlaceholderText('Search servers…'), 'host-1')

      await waitFor(() => {
        expect(screen.getByTestId('pagination-item-count')).toHaveTextContent('Showing 1-3 of 3 servers')
      })
      expect(firstCellTexts()).toEqual(['host-10', 'host-11', 'host-12'])
    })
  })

  describe('Sorting', () => {
    it('sorts by a column header ascending, then descending', async () => {
      const user = userEvent.setup()
      renderTable()
      const portHeader = screen.getByRole('columnheader', { name: 'Port' })

      await user.click(portHeader)
      expect(portHeader).toHaveAttribute('aria-sort', 'ascending')
      expect(firstCellTexts()).toEqual(['alpha', 'charlie', 'bravo'])

      await user.click(portHeader)
      expect(portHeader).toHaveAttribute('aria-sort', 'descending')
      expect(firstCellTexts()).toEqual(['bravo', 'charlie', 'alpha'])
    })

    it('sorts from the keyboard with Enter', async () => {
      const user = userEvent.setup()
      renderTable()
      const portHeader = screen.getByRole('columnheader', { name: 'Port' })

      portHeader.focus()
      await user.keyboard('{Enter}')

      expect(portHeader).toHaveAttribute('aria-sort', 'ascending')
      expect(firstCellTexts()).toEqual(['alpha', 'charlie', 'bravo'])
    })
  })

  describe('Pagination', () => {
    it('fills the height its parent gives it, so the pagination sits at the bottom of a full-height page', () => {
      renderTable()

      expect(screen.getByTestId('server-table')).toHaveClass('flex', 'flex-col', 'flex-1', 'min-h-0')
    })

    it('shows 10 rows per page with the entity name in the count', () => {
      renderTable({ data: TWELVE_ROWS })

      expect(bodyRows()).toHaveLength(10)
      expect(screen.getByTestId('pagination-item-count')).toHaveTextContent('Showing 1-10 of 12 servers')
    })

    it('moves to the next page', async () => {
      const user = userEvent.setup()
      renderTable({ data: TWELVE_ROWS })

      await user.click(screen.getByRole('button', { name: 'Next page' }))

      expect(bodyRows()).toHaveLength(2)
      expect(firstCellTexts()).toEqual(['host-11', 'host-12'])
      expect(screen.getByTestId('pagination-item-count')).toHaveTextContent('Showing 11-12 of 12 servers')
    })
  })

  describe('Empty and loading', () => {
    it('shows the empty message and the empty action when there are no rows', () => {
      renderTable({
        data: [],
        emptyAction: <button type="button">Add first server</button>,
      })

      const message = screen.getByText('No servers yet')
      const cell = message.closest('td') as HTMLElement
      expect(within(cell).getByRole('button', { name: 'Add first server' })).toBeInTheDocument()
    })

    it('shows skeleton rows and no empty message while loading', () => {
      renderTable({ data: [], loading: true })

      expect(screen.getAllByTestId('skeleton-row').length).toBeGreaterThan(0)
      expect(screen.queryByText('No servers yet')).not.toBeInTheDocument()
    })

    it('shows no data rows while loading', () => {
      renderTable({ loading: true })

      expect(screen.queryByText('alpha')).not.toBeInTheDocument()
      expect(screen.getAllByTestId('skeleton-row').length).toBeGreaterThan(0)
    })
  })

  describe('Selection', () => {
    it('shows no checkboxes without a selection prop', () => {
      renderTable()

      expect(screen.queryAllByRole('checkbox')).toHaveLength(0)
    })

    it('shows no checkboxes while selection is not active', () => {
      renderTable({ selection: { active: false, selected: {}, onChange: vi.fn() } })

      expect(screen.queryAllByRole('checkbox')).toHaveLength(0)
    })

    it('shows a checkbox per row named by the row label while selection is active', () => {
      renderTable({ selection: { active: true, selected: {}, onChange: vi.fn() } })

      expect(screen.getByRole('checkbox', { name: 'Select alpha' })).toBeInTheDocument()
      expect(screen.getByRole('checkbox', { name: 'Select bravo' })).toBeInTheDocument()
      expect(screen.getByRole('checkbox', { name: 'Select charlie' })).toBeInTheDocument()
    })

    it('reflects the selected rows', () => {
      renderTable({ selection: { active: true, selected: { 's-bravo': true }, onChange: vi.fn() } })

      expect(screen.getByRole('checkbox', { name: 'Select bravo' })).toHaveAttribute('aria-checked', 'true')
      expect(screen.getByRole('checkbox', { name: 'Select alpha' })).toHaveAttribute('aria-checked', 'false')
    })

    it('reports a checked row as the next selection state', async () => {
      const user = userEvent.setup()
      const onChange = vi.fn()
      renderTable({ selection: { active: true, selected: { 's-alpha': true }, onChange } })

      await user.click(screen.getByRole('checkbox', { name: 'Select charlie' }))

      expect(onChange).toHaveBeenCalledWith({ 's-alpha': true, 's-charlie': true })
    })

    it('reports an unchecked row as removed from the selection state', async () => {
      const user = userEvent.setup()
      const onChange = vi.fn()
      renderTable({ selection: { active: true, selected: { 's-alpha': true, 's-bravo': true }, onChange } })

      await user.click(screen.getByRole('checkbox', { name: 'Select alpha' }))

      expect(onChange).toHaveBeenCalledWith({ 's-bravo': true })
    })

    it('reports select-all as every row of the page', async () => {
      const user = userEvent.setup()
      const onChange = vi.fn()
      renderTable({ selection: { active: true, selected: {}, onChange } })

      await user.click(screen.getByRole('checkbox', { name: 'Select all' }))

      expect(onChange).toHaveBeenCalledWith({ 's-alpha': true, 's-bravo': true, 's-charlie': true })
    })
  })

  describe('Default sorting', () => {
    it('opens sorted by the default sorting it is given', () => {
      renderTable({ defaultSorting: [{ id: 'port', desc: false }] })

      expect(screen.getByRole('columnheader', { name: 'Port' })).toHaveAttribute('aria-sort', 'ascending')
      expect(firstCellTexts()).toEqual(['alpha', 'charlie', 'bravo'])
    })

    it('opens unsorted without a default sorting', () => {
      renderTable()

      expect(screen.getByRole('columnheader', { name: 'Port' })).toHaveAttribute('aria-sort', 'none')
      expect(firstCellTexts()).toEqual(['alpha', 'bravo', 'charlie'])
    })
  })

  describe('Search with no match', () => {
    it('says no rows match the search and drops the empty action', async () => {
      const user = userEvent.setup()
      renderTable({ emptyAction: <button type="button">Add first server</button> })

      await user.type(screen.getByPlaceholderText('Search servers…'), 'zulu')

      await waitFor(() => {
        expect(screen.getByText('No matching servers found')).toBeInTheDocument()
      })
      expect(screen.queryByText('No servers yet')).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Add first server' })).not.toBeInTheDocument()
    })

    it('keeps the empty message and action for an empty table even while a search is typed', async () => {
      const user = userEvent.setup()
      renderTable({ data: [], emptyAction: <button type="button">Add first server</button> })

      await user.type(screen.getByPlaceholderText('Search servers…'), 'zulu')

      expect(screen.getByText('No servers yet')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Add first server' })).toBeInTheDocument()
    })
  })
})
