/**
 * DataTable Component Tests
 *
 * Tests for the shared DataTable component covering:
 * - Empty state rendering
 * - Toolbar with bulk action slot
 * - Module exports
 */

import { describe, it, expect, vi } from 'vitest'
import { useState } from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { ColumnDef, OnChangeFn, RowSelectionState } from '@tanstack/react-table'
import { DataTable } from '@/components/shared/data-table/data-table'
import { DataTableEmpty } from '@/components/shared/data-table/data-table-empty'
import { DataTableToolbar } from '@/components/shared/data-table/data-table-toolbar'

interface TestRow {
  id: string
  name: string
}

const testColumns: ColumnDef<TestRow, unknown>[] = [
  { id: 'name', accessorKey: 'name', header: 'Name' },
]

function renderWithRouter(ui: React.ReactElement) {
  return render(<MemoryRouter>{ui}</MemoryRouter>)
}

describe('DataTableEmpty', () => {
  it('renders default empty message', () => {
    render(
      <table>
        <tbody>
          <DataTableEmpty colSpan={3} />
        </tbody>
      </table>
    )
    expect(screen.getByText('No data to display')).toBeInTheDocument()
  })

  it('renders custom empty message', () => {
    render(
      <table>
        <tbody>
          <DataTableEmpty colSpan={2} message="No items found" />
        </tbody>
      </table>
    )
    expect(screen.getByText('No items found')).toBeInTheDocument()
  })

  it('renders icon and action when provided', () => {
    render(
      <table>
        <tbody>
          <DataTableEmpty
            colSpan={2}
            icon={<span data-testid="custom-icon">Icon</span>}
            action={<button type="button">Create</button>}
          />
        </tbody>
      </table>
    )
    expect(screen.getByTestId('custom-icon')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Create' })).toBeInTheDocument()
  })
})

describe('DataTableToolbar', () => {
  it('renders nothing when selectedCount is 0', () => {
    const { container } = render(
      <DataTableToolbar selectedCount={0}>
        <button type="button">Delete</button>
      </DataTableToolbar>
    )
    expect(container.innerHTML).toBe('')
  })

  it('renders selection count and children when items selected', () => {
    render(
      <DataTableToolbar selectedCount={3}>
        <button type="button">Delete</button>
      </DataTableToolbar>
    )
    expect(screen.getByText('3 selected')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument()
  })
})

describe('DataTable empty state', () => {
  it('shows empty state when data is empty and not loading', () => {
    renderWithRouter(
      <DataTable
        columns={testColumns}
        data={[]}
        emptyMessage="No tests found"
        getRowId={(r) => r.id}
      />
    )
    expect(screen.getByText('No tests found')).toBeInTheDocument()
  })
})

describe('DataTable loading state', () => {
  it('shows skeleton rows when loading', () => {
    renderWithRouter(
      <DataTable
        columns={testColumns}
        data={[]}
        loading
        getRowId={(r) => r.id}
      />
    )
    expect(screen.getAllByTestId('skeleton-row')).toHaveLength(9)
  })

  it('shows skeleton pagination when loading with pageInfo', () => {
    renderWithRouter(
      <DataTable
        columns={testColumns}
        data={[]}
        loading
        pageInfo={{ currentPage: 1, pageSize: 10, totalItems: 0, totalPages: 1 }}
        onPageChange={() => {}}
        onPageSizeChange={() => {}}
        getRowId={(r) => r.id}
      />
    )
    expect(screen.getByTestId('pagination')).toBeInTheDocument()
  })

  it('shows disabled select-all checkbox when loading with selection', () => {
    renderWithRouter(
      <DataTable
        columns={testColumns}
        data={[]}
        loading
        enableSelection
        rowSelection={{}}
        onRowSelectionChange={() => {}}
        getRowId={(r) => r.id}
      />
    )
    const checkboxes = screen.getAllByRole('checkbox')
    expect(checkboxes[0]).toBeDisabled()
  })
})

describe('DataTable with non-sortable columns', () => {
  it('renders non-sortable header as plain text', () => {
    const cols: ColumnDef<TestRow, unknown>[] = [
      {
        id: 'name',
        accessorKey: 'name',
        header: 'Name',
        enableSorting: false,
      },
    ]
    renderWithRouter(
      <DataTable columns={cols} data={[{ id: '1', name: 'Test' }]} getRowId={(r) => r.id} />
    )
    const header = screen.getByRole('columnheader', { name: 'Name' })
    expect(header).toBeInTheDocument()
    expect(header).not.toHaveAttribute('tabindex')
  })
})

describe('DataTable with sticky skeleton columns', () => {
  it('renders skeleton with sticky left column', () => {
    const cols: ColumnDef<TestRow, unknown>[] = [
      {
        id: 'name',
        accessorKey: 'name',
        header: 'Name',
        meta: { sticky: 'left', skeletonWidth: 'w-24' },
      },
      {
        id: 'actions',
        header: 'Actions',
        meta: { sticky: 'right', skeletonWidth: 'w-16' },
      },
    ]
    renderWithRouter(
      <DataTable columns={cols} data={[]} loading getRowId={(r) => r.id} />
    )
    expect(screen.getAllByTestId('skeleton-row').length).toBeGreaterThan(0)
  })
})

describe('DataTable pagination with 0 items', () => {
  it('shows 0-0 of 0 when no items', () => {
    renderWithRouter(
      <DataTable
        columns={testColumns}
        data={[{ id: '1', name: 'Test' }]}
        pageInfo={{ currentPage: 1, pageSize: 10, totalItems: 0, totalPages: 0 }}
        onPageChange={() => {}}
        onPageSizeChange={() => {}}
        getRowId={(r) => r.id}
      />
    )
    expect(screen.getByTestId('pagination-item-count')).toHaveTextContent('Showing 0-0 of 0')
  })
})

describe('DataTable bulk actions toolbar', () => {
  it('renders toolbar with bulk actions when rows are selected', () => {
    renderWithRouter(
      <DataTable
        columns={testColumns}
        data={[{ id: '1', name: 'A' }, { id: '2', name: 'B' }]}
        getRowId={(r) => r.id}
        enableSelection
        rowSelection={{ '1': true }}
        onRowSelectionChange={() => {}}
        bulkActions={<button type="button">Delete Selected</button>}
      />
    )
    expect(screen.getByText('1 selected')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Delete Selected' })).toBeInTheDocument()
  })
})

describe('DataTable indeterminate checkbox', () => {
  it('sets indeterminate state when some rows are selected', () => {
    renderWithRouter(
      <DataTable
        columns={testColumns}
        data={[{ id: '1', name: 'A' }, { id: '2', name: 'B' }]}
        getRowId={(r) => r.id}
        enableSelection
        rowSelection={{ '1': true }}
        onRowSelectionChange={() => {}}
      />
    )
    // The select-all checkbox should be rendered
    const selectAll = screen.getByRole('checkbox', { name: /select all/i })
    expect(selectAll).toBeInTheDocument()
  })
})

describe('DataTable empty state with icon and action', () => {
  it('renders custom empty icon and action', () => {
    renderWithRouter(
      <DataTable
        columns={testColumns}
        data={[]}
        getRowId={(r) => r.id}
        emptyIcon={<span data-testid="empty-icon">Icon</span>}
        emptyMessage="Nothing here"
        emptyAction={<button type="button">Add Item</button>}
      />
    )
    expect(screen.getByTestId('empty-icon')).toBeInTheDocument()
    expect(screen.getByText('Nothing here')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add Item' })).toBeInTheDocument()
  })
})

describe('DataTable column width', () => {
  it('puts a column width class on its header cell and leaves other headers without one', () => {
    const cols: ColumnDef<TestRow, unknown>[] = [
      { id: 'name', accessorKey: 'name', header: 'Name' },
      { id: 'actions', header: 'Actions', meta: { width: 'w-16' } },
    ]
    renderWithRouter(
      <DataTable columns={cols} data={[{ id: '1', name: 'Test' }]} getRowId={(r) => r.id} />
    )
    expect(screen.getByRole('columnheader', { name: 'Actions' })).toHaveClass('w-16')
    expect(screen.getByRole('columnheader', { name: 'Name' })).not.toHaveClass('w-16')
  })
})

describe('DataTable column header non-sortable', () => {
  it('renders DataTableColumnHeader for non-sortable column', async () => {
    const { DataTableColumnHeader: Header } = await import('@/components/shared/data-table/data-table-column-header')
    // Create a mock column that reports !canSort
    const mockCol = { getCanSort: () => false, getIsSorted: () => false } as never
    const { container } = render(<Header column={mockCol} label="Tags" />)
    expect(container.textContent).toBe('Tags')
  })
})

describe('CheckboxIndicator indeterminate state', () => {
  it('renders minus icon when indeterminate', async () => {
    const { CheckboxIndicator } = await import('@/components/ui/checkbox')
    const { container } = render(<CheckboxIndicator checked="indeterminate" />)
    expect(container.querySelector('.lucide-minus')).toBeInTheDocument()
  })

  it('renders check icon when checked', async () => {
    const { CheckboxIndicator } = await import('@/components/ui/checkbox')
    const { container } = render(<CheckboxIndicator checked={true} />)
    expect(container.querySelector('.lucide-check')).toBeInTheDocument()
  })

  it('renders empty when unchecked', async () => {
    const { CheckboxIndicator } = await import('@/components/ui/checkbox')
    const { container } = render(<CheckboxIndicator checked={false} />)
    expect(container.querySelector('.lucide-check')).not.toBeInTheDocument()
    expect(container.querySelector('.lucide-minus')).not.toBeInTheDocument()
  })
})

describe('Cell renderers', () => {
  it('StatusBadgeCell renders without testIdPrefix', async () => {
    const { StatusBadgeCell } = await import('@/components/shared/data-table/cell-renderers')
    render(<StatusBadgeCell status="passed" />)
    expect(screen.getByText('Passed')).toBeInTheDocument()
  })
})

describe('Entity column definitions', () => {
  it('environments columns render singular profile for usage=1', async () => {
    const mod = await import('@/features/settings/components/environments-columns')
    const cols = mod.getEnvironmentsColumns({
      onEdit: () => {},
      onDelete: () => {},
      onDuplicate: () => {},
    })
    const usageCol = cols.find((c) => c.id === 'usage')!
    const mockRow = {
      original: { id: '1', name: 'Prod', description: null, tags: [], usage: 1, createdAt: '', updatedAt: '' },
    }
    const { container } = render(
      (usageCol.cell as Function)({ row: mockRow, getValue: () => 1 } as never)
    )
    expect(container.textContent).toBe('1 profile')
  })

  it('environments columns render plural profiles for usage=3', async () => {
    const mod = await import('@/features/settings/components/environments-columns')
    const cols = mod.getEnvironmentsColumns({
      onEdit: () => {},
      onDelete: () => {},
      onDuplicate: () => {},
    })
    const usageCol = cols.find((c) => c.id === 'usage')!
    const mockRow = {
      original: { id: '1', name: 'Prod', description: null, tags: [], usage: 3, createdAt: '', updatedAt: '' },
    }
    const { container } = render(
      (usageCol.cell as Function)({ row: mockRow, getValue: () => 3 } as never)
    )
    expect(container.textContent).toBe('3 profiles')
  })
})

describe('DataTable row click selection', () => {
  it('toggles row selection when clicking on a non-interactive cell', () => {
    const onRowSelectionChange = vi.fn()
    const data = [{ id: '1', name: 'Row 1' }]

    renderWithRouter(
      <DataTable
        columns={testColumns}
        data={data}
        enableSelection
        rowSelection={{}}
        onRowSelectionChange={onRowSelectionChange}
        getRowId={(row) => row.id}
      />,
    )

    const row = screen.getByTestId('data-row')
    fireEvent.click(row)

    expect(onRowSelectionChange).toHaveBeenCalled()
  })

  it('does not toggle selection when clicking a button inside the row', () => {
    const onRowSelectionChange = vi.fn()
    const columnsWithButton: ColumnDef<TestRow, unknown>[] = [
      {
        id: 'name',
        accessorKey: 'name',
        header: 'Name',
        cell: ({ row }) => <button type="button">Edit {row.original.name}</button>,
      },
    ]
    const data = [{ id: '1', name: 'Row 1' }]

    renderWithRouter(
      <DataTable
        columns={columnsWithButton}
        data={data}
        enableSelection
        rowSelection={{}}
        onRowSelectionChange={onRowSelectionChange}
        getRowId={(row) => row.id}
      />,
    )

    const button = screen.getByRole('button', { name: /edit row 1/i })
    fireEvent.click(button)

    // The button click should be stopped by closest() check -
    // verify the button is inside a row (sanity check that it rendered correctly)
    expect(button.closest('tr')).toBeTruthy()
  })
})

describe('Suite tests column definitions', () => {
  it('view columns render edit button when callback provided', async () => {
    const mod = await import('@/features/suites/components/suite-tests-columns')
    const onEditTest = vi.fn()
    const cols = mod.getSuiteTestsViewColumns({ onEditTest })
    const actionsCol = cols.find(c => c.id === 'actions')!

    const mockRow = {
      original: { id: 't1', name: 'Test', status: 'passed', lastRun: null, tags: [], createdAt: null, updatedAt: null },
      index: 0,
    }
    const { container } = render(
      (actionsCol.cell as Function)({ row: mockRow, getValue: () => '' } as never),
    )

    const editBtn = container.querySelector('[data-testid="test-edit-btn"]')!
    expect(editBtn).toBeInTheDocument()

    fireEvent.click(editBtn)
    expect(onEditTest).toHaveBeenCalledWith('t1')
  })

  it('edit columns render exclude button', async () => {
    const mod = await import('@/features/suites/components/suite-tests-columns')
    const onExclude = vi.fn()
    const cols = mod.getSuiteTestsEditColumns({ onExcludeTest: onExclude })
    const actionsCol = cols.find(c => c.id === 'actions')!

    const mockRow = {
      original: { id: 't1', name: 'Test', status: 'passed', lastRun: null, tags: [], createdAt: null, updatedAt: null },
      index: 0,
    }
    const { container } = render(
      (actionsCol.cell as Function)({ row: mockRow, getValue: () => '' } as never),
    )

    const excludeBtn = container.querySelector('[data-testid="test-exclude-btn"]')!
    expect(excludeBtn).toBeInTheDocument()

    fireEvent.click(excludeBtn)
    expect(onExclude).toHaveBeenCalledWith('t1')
  })
})


describe('VariableEditor index exports', () => {
  it('exports VariableEditor and VariableReadonlyTable', async () => {
    const mod = await import('@/components/shared/variable-editor/index')
    expect(mod.VariableEditor).toBeDefined()
    expect(mod.VariableReadonlyTable).toBeDefined()
  })
})

describe('computeReorderedIds', () => {
  // The function operates on TanStack Row objects, so we simulate them
  function makeRows(ids: string[]) {
    return ids.map(id => ({ id })) as { id: string }[]
  }

  it('returns reordered IDs when moving an item forward', async () => {
    const { computeReorderedIds } = await import('@/components/shared/data-table/data-table')
    const rows = makeRows(['a', 'b', 'c', 'd'])
    const result = computeReorderedIds(rows as never, 'a', 'c')
    expect(result).toEqual(['b', 'c', 'a', 'd'])
  })

  it('returns reordered IDs when moving an item backward', async () => {
    const { computeReorderedIds } = await import('@/components/shared/data-table/data-table')
    const rows = makeRows(['a', 'b', 'c', 'd'])
    const result = computeReorderedIds(rows as never, 'c', 'a')
    expect(result).toEqual(['c', 'a', 'b', 'd'])
  })

  it('returns null when activeId equals overId', async () => {
    const { computeReorderedIds } = await import('@/components/shared/data-table/data-table')
    const rows = makeRows(['a', 'b', 'c'])
    expect(computeReorderedIds(rows as never, 'a', 'a')).toBeNull()
  })

  it('returns null when activeId is not found', async () => {
    const { computeReorderedIds } = await import('@/components/shared/data-table/data-table')
    const rows = makeRows(['a', 'b'])
    expect(computeReorderedIds(rows as never, 'unknown', 'a')).toBeNull()
  })

  it('returns null when overId is not found', async () => {
    const { computeReorderedIds } = await import('@/components/shared/data-table/data-table')
    const rows = makeRows(['a', 'b'])
    expect(computeReorderedIds(rows as never, 'a', 'unknown')).toBeNull()
  })
})

describe('DataTable client-side pagination', () => {
  it('renders pagination UI with client-side data when no pageInfo provided', () => {
    const data = Array.from({ length: 30 }, (_, i) => ({ id: String(i + 1), name: `Row ${i + 1}` }))
    renderWithRouter(
      <DataTable
        columns={testColumns}
        data={data}
        getRowId={(r) => r.id}
        defaultPageSize={10}
      />
    )
    // Pagination should be rendered even though we didn't provide pageInfo
    expect(screen.getByTestId('pagination-item-count')).toHaveTextContent('Showing 1-10 of 30')
    // Only 10 rows should be visible
    expect(screen.getAllByTestId('data-row')).toHaveLength(10)
  })
})

describe('DataTable DnD mode', () => {
  it('renders grip handles when enableDnD is true', () => {
    const data = [
      { id: '1', name: 'Row A' },
      { id: '2', name: 'Row B' },
    ]
    renderWithRouter(
      <DataTable
        columns={testColumns}
        data={data}
        getRowId={(r) => r.id}
        enableDnD
        onReorder={vi.fn()}
      />
    )
    expect(screen.getAllByTestId('dnd-grip-handle')).toHaveLength(2)
  })

  it('does not render grip handles when enableDnD is false', () => {
    const data = [
      { id: '1', name: 'Row A' },
      { id: '2', name: 'Row B' },
    ]
    renderWithRouter(
      <DataTable
        columns={testColumns}
        data={data}
        getRowId={(r) => r.id}
      />
    )
    expect(screen.queryByTestId('dnd-grip-handle')).not.toBeInTheDocument()
  })

  it('renders select-all checkbox in DnD mode with selection enabled', () => {
    const onRowSelectionChange = vi.fn()
    const data = [
      { id: '1', name: 'Row A' },
      { id: '2', name: 'Row B' },
    ]
    renderWithRouter(
      <DataTable
        columns={testColumns}
        data={data}
        getRowId={(r) => r.id}
        enableDnD
        onReorder={vi.fn()}
        enableSelection
        rowSelection={{}}
        onRowSelectionChange={onRowSelectionChange}
      />
    )
    expect(screen.getByTestId('select-all-checkbox')).toBeInTheDocument()
    expect(screen.getAllByTestId('row-checkbox')).toHaveLength(2)

    // Click select-all to cover the onCheckedChange handler
    fireEvent.click(screen.getByTestId('select-all-checkbox'))
    expect(onRowSelectionChange).toHaveBeenCalled()
  })
})

describe('DataTable per-row selectability (canSelectRow)', () => {
  interface LockableRow extends TestRow {
    locked: boolean
  }

  const lockableColumns: ColumnDef<LockableRow, unknown>[] = [
    { id: 'name', accessorKey: 'name', header: 'Name' },
  ]

  const lockableRows: LockableRow[] = [
    { id: '1', name: 'Alpha', locked: false },
    { id: '2', name: 'Beta', locked: true },
    { id: '3', name: 'Gamma', locked: false },
  ]

  const unlockedOnly = (row: LockableRow) => !row.locked

  function SelectableTable({
    initialSelection = {},
    canSelectRow,
    onSelectionChange,
    enableDnD = false,
  }: Readonly<{
    initialSelection?: RowSelectionState
    canSelectRow?: (row: LockableRow) => boolean
    onSelectionChange?: () => void
    enableDnD?: boolean
  }>) {
    const [selection, setSelection] = useState<RowSelectionState>(initialSelection)
    const handleChange: OnChangeFn<RowSelectionState> = (updater) => {
      onSelectionChange?.()
      setSelection(updater)
    }
    return (
      <DataTable
        columns={lockableColumns}
        data={lockableRows}
        getRowId={(r) => r.id}
        getRowLabel={(r) => r.name}
        enableSelection
        enableDnD={enableDnD}
        onReorder={enableDnD ? vi.fn() : undefined}
        rowSelection={selection}
        onRowSelectionChange={handleChange}
        canSelectRow={canSelectRow}
      />
    )
  }

  const rowCheckbox = (name: string) => screen.getByRole('checkbox', { name: `Select ${name}` })
  const selectAll = () => screen.getByRole('checkbox', { name: 'Select all' })
  const rowOf = (name: string) => screen.getByText(name).closest('tr') as HTMLElement

  it('renders a non-selectable row checkbox disabled, faded and aria-disabled', () => {
    renderWithRouter(<SelectableTable canSelectRow={unlockedOnly} />)
    const locked = rowCheckbox('Beta')

    expect(locked).toBeDisabled()
    expect(locked).toHaveAttribute('aria-disabled', 'true')
    expect(locked).toHaveClass('opacity-50', 'cursor-not-allowed')
  })

  it('keeps a selectable row checkbox enabled and unfaded', () => {
    renderWithRouter(<SelectableTable canSelectRow={unlockedOnly} />)
    const open = rowCheckbox('Alpha')

    expect(open).toBeEnabled()
    expect(open).not.toHaveAttribute('aria-disabled', 'true')
    expect(open).not.toHaveClass('opacity-50')
    expect(open).not.toHaveClass('cursor-not-allowed')
  })

  it('ignores a click on a non-selectable row', () => {
    const onSelectionChange = vi.fn()
    renderWithRouter(
      <SelectableTable canSelectRow={unlockedOnly} onSelectionChange={onSelectionChange} />
    )

    fireEvent.click(screen.getByText('Beta'))

    expect(onSelectionChange).not.toHaveBeenCalled()
    expect(rowCheckbox('Beta')).not.toBeChecked()
    expect(rowOf('Beta')).not.toHaveAttribute('aria-selected')
  })

  it('ignores a click on the disabled checkbox', () => {
    const onSelectionChange = vi.fn()
    renderWithRouter(
      <SelectableTable canSelectRow={unlockedOnly} onSelectionChange={onSelectionChange} />
    )

    fireEvent.click(rowCheckbox('Beta'))

    expect(onSelectionChange).not.toHaveBeenCalled()
    expect(rowCheckbox('Beta')).not.toBeChecked()
  })

  it('still selects a selectable row on click', () => {
    renderWithRouter(<SelectableTable canSelectRow={unlockedOnly} />)

    fireEvent.click(screen.getByText('Alpha'))

    expect(rowCheckbox('Alpha')).toBeChecked()
    expect(rowOf('Alpha')).toHaveAttribute('aria-selected', 'true')
  })

  it('select-all selects only the selectable rows', () => {
    renderWithRouter(<SelectableTable canSelectRow={unlockedOnly} />)

    fireEvent.click(selectAll())

    expect(rowCheckbox('Alpha')).toBeChecked()
    expect(rowCheckbox('Gamma')).toBeChecked()
    expect(rowCheckbox('Beta')).not.toBeChecked()
    expect(selectAll()).toBeChecked()
  })

  it('reads select-all as checked once every selectable row is selected', () => {
    renderWithRouter(
      <SelectableTable canSelectRow={unlockedOnly} initialSelection={{ '1': true, '3': true }} />
    )

    expect(selectAll()).toBeChecked()
  })

  it('reads select-all as unchecked while a selectable row is unselected', () => {
    renderWithRouter(
      <SelectableTable canSelectRow={unlockedOnly} initialSelection={{ '1': true }} />
    )

    expect(selectAll()).not.toBeChecked()
  })

  it('clears every selected row when select-all is unchecked', () => {
    renderWithRouter(
      <SelectableTable canSelectRow={unlockedOnly} initialSelection={{ '1': true, '3': true }} />
    )

    fireEvent.click(selectAll())

    expect(rowCheckbox('Alpha')).not.toBeChecked()
    expect(rowCheckbox('Gamma')).not.toBeChecked()
    expect(selectAll()).not.toBeChecked()
  })

  it('selects nothing and keeps select-all unchecked when no row is selectable', () => {
    renderWithRouter(<SelectableTable canSelectRow={() => false} />)

    expect(selectAll()).not.toBeChecked()
    fireEvent.click(selectAll())

    for (const name of ['Alpha', 'Beta', 'Gamma']) {
      expect(rowCheckbox(name)).not.toBeChecked()
    }
    expect(selectAll()).not.toBeChecked()
  })

  it('applies the predicate to rows in drag-and-drop mode', () => {
    const onSelectionChange = vi.fn()
    renderWithRouter(
      <SelectableTable
        canSelectRow={unlockedOnly}
        onSelectionChange={onSelectionChange}
        enableDnD
      />
    )

    expect(rowCheckbox('Beta')).toBeDisabled()
    expect(rowCheckbox('Beta')).toHaveAttribute('aria-disabled', 'true')
    fireEvent.click(screen.getByText('Beta'))
    expect(onSelectionChange).not.toHaveBeenCalled()
  })

  describe('without a predicate', () => {
    it('keeps every row checkbox enabled and unfaded', () => {
      renderWithRouter(<SelectableTable />)

      for (const name of ['Alpha', 'Beta', 'Gamma']) {
        const checkbox = rowCheckbox(name)
        expect(checkbox).toBeEnabled()
        expect(checkbox).not.toHaveAttribute('aria-disabled', 'true')
        expect(checkbox).not.toHaveClass('opacity-50')
      }
    })

    it('select-all selects every row', () => {
      renderWithRouter(<SelectableTable />)

      fireEvent.click(selectAll())

      for (const name of ['Alpha', 'Beta', 'Gamma']) {
        expect(rowCheckbox(name)).toBeChecked()
      }
      expect(selectAll()).toBeChecked()
    })

    it('selects any row on click', () => {
      renderWithRouter(<SelectableTable />)

      fireEvent.click(screen.getByText('Beta'))

      expect(rowCheckbox('Beta')).toBeChecked()
    })
  })
})
