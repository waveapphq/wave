/**
 * Tests for the shared column factories.
 */

import { useState } from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ExpandedState } from '@tanstack/react-table'
import {
  actionsColumn,
  countColumn,
  durationColumn,
  expandableNameColumn,
  nameColumn,
  statusColumn,
  tagsColumn,
} from '@/components/shared/data-table/column-factories'
import { DataTable } from '@/components/shared/data-table/data-table'
import type { ColumnDef } from '@tanstack/react-table'

interface Row {
  id: string
  name: string
  status: string
  tags: string[]
  duration: string
  count: number
}

const row: Row = {
  id: 'r1',
  name: 'Alpha',
  status: 'passed',
  tags: ['t1', 't2'],
  duration: '1m 5s',
  count: 1,
}

function renderTable(columns: ColumnDef<Row, unknown>[], data: Row[] = [row]) {
  return render(
    <DataTable
      columns={columns}
      data={data}
      getRowId={(r) => r.id}
      entityName="rows"
      defaultPageSize={0}
    />,
  )
}

describe('nameColumn', () => {
  it('renders a bold button that fires onClick with the full row', async () => {
    const handleClick = vi.fn()
    const user = userEvent.setup()
    renderTable([
      nameColumn<Row>({
        accessor: (r) => r.name,
        testId: 'alpha-name',
        onClick: handleClick,
      }),
    ])
    const btn = screen.getByTestId('alpha-name')
    expect(btn.tagName).toBe('BUTTON')
    expect(btn.className).toContain('font-medium')
    await user.click(btn)
    expect(handleClick).toHaveBeenCalledWith(row)
  })

  it('renders a bold span when onClick is omitted', () => {
    renderTable([
      nameColumn<Row>({
        accessor: (r) => r.name,
        testId: 'plain-name',
        id: 'displayName',
        label: 'Display',
      }),
    ])
    const el = screen.getByTestId('plain-name')
    expect(el.tagName).toBe('SPAN')
    expect(el.className).toContain('font-medium')
    expect(el).toHaveTextContent('Alpha')
  })

  it('renders a bounded, muted description line under the name when provided', () => {
    renderTable([
      nameColumn<Row>({
        accessor: (r) => r.name,
        testId: 'desc-name',
        description: () => 'a secondary line',
        descriptionTestId: 'desc-sub',
      }),
    ])
    const sub = screen.getByTestId('desc-sub')
    expect(sub).toHaveTextContent('a secondary line')
    expect(sub.querySelector('span')?.className).toContain('text-muted-foreground')
  })

  it('omits the description line when the accessor returns empty', () => {
    renderTable([
      nameColumn<Row>({
        accessor: (r) => r.name,
        testId: 'nodesc-name',
        description: () => '',
        descriptionTestId: 'nodesc-sub',
      }),
    ])
    expect(screen.queryByTestId('nodesc-sub')).toBeNull()
  })

  it('renders the truncation tooltip when the inner span overflows its cap', async () => {
    // jsdom always reports scrollWidth = clientWidth = 0, so the truncation
    // detection branch never fires by default. Force it by stubbing the
    // properties on HTMLElement just for this test - mirrors the production
    // ResizeObserver-driven measurement.
    const scrollDescriptor = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      'scrollWidth',
    )
    const clientDescriptor = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      'clientWidth',
    )
    Object.defineProperty(HTMLElement.prototype, 'scrollWidth', {
      configurable: true,
      get() {
        return 800
      },
    })
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
      configurable: true,
      get() {
        return 200
      },
    })

    try {
      const longName = 'A very long entity name that should clip and surface a tooltip'
      const longRow: Row = { ...row, name: longName }
      const user = userEvent.setup()
      renderTable(
        [
          nameColumn<Row>({
            accessor: (r) => r.name,
            testId: 'long-name',
          }),
        ],
        [longRow],
      )
      const trigger = screen.getByTestId('long-name')
      await user.hover(trigger)
      // Radix portals the tooltip into the body; querying the document for
      // role=tooltip is enough to confirm the truncation branch ran.
      const tooltip = await screen.findByRole('tooltip')
      expect(tooltip).toHaveTextContent(longName)
    } finally {
      if (scrollDescriptor) {
        Object.defineProperty(HTMLElement.prototype, 'scrollWidth', scrollDescriptor)
      }
      if (clientDescriptor) {
        Object.defineProperty(HTMLElement.prototype, 'clientWidth', clientDescriptor)
      }
    }
  })
})

interface TreeRow {
  id: string
  name: string
  kind: 'parent' | 'child'
  children?: TreeRow[]
}

describe('expandableNameColumn', () => {
  const parent: TreeRow = {
    id: 'p',
    name: 'Parent',
    kind: 'parent',
    children: [{ id: 'c', name: 'Child', kind: 'child' }],
  }

  function TreeHarness({ col }: Readonly<{ col: ColumnDef<TreeRow, unknown> }>) {
    const [expanded, setExpanded] = useState<ExpandedState>({})
    return (
      <DataTable<TreeRow>
        columns={[col]}
        data={[parent]}
        getRowId={(r) => r.id}
        getSubRows={(r) => (r.kind === 'parent' ? r.children : undefined)}
        expanded={expanded}
        onExpandedChange={setExpanded}
        entityName="rows"
        defaultPageSize={0}
      />
    )
  }

  function renderTree(col: ColumnDef<TreeRow, unknown>) {
    return render(<TreeHarness col={col} />)
  }

  it('renders an expand/collapse toggle for expandable rows', async () => {
    const user = userEvent.setup()
    const col = expandableNameColumn<TreeRow>({
      accessor: (r) => r.name,
      testId: 'tree-name',
      isExpandable: (r) => r.kind === 'parent',
      childIndent: true,
      childDecoration: (r) => <span data-testid={`dec-${r.id}`}>*</span>,
    })
    renderTree(col)
    const toggle = screen.getByRole('button', { name: 'Expand Parent' })
    expect(toggle.className).toContain('font-medium')
    await user.click(toggle)
    expect(screen.getByRole('button', { name: 'Collapse Parent' })).toBeInTheDocument()
    expect(screen.getByText('Child')).toBeInTheDocument()
    expect(screen.getByTestId('dec-c')).toBeInTheDocument()
  })

  it('renders a plain child row without indent or decoration by default', async () => {
    const user = userEvent.setup()
    const col = expandableNameColumn<TreeRow>({
      accessor: (r) => r.name,
      testId: 'tree-name',
      isExpandable: (r) => r.kind === 'parent',
    })
    renderTree(col)
    await user.click(screen.getByRole('button', { name: 'Expand Parent' }))
    const child = await screen.findByText('Child')
    expect(child.className).toContain('font-medium')
    expect(child.closest('div')?.className).not.toContain('pl-8')
  })
})

describe('statusColumn', () => {
  it('renders StatusBadgeCell with the optional testIdPrefix', () => {
    renderTable([
      statusColumn<Row>({
        accessor: (r) => r.status,
        testIdPrefix: 'row',
        id: 'myStatus',
        label: 'State',
      }),
    ])
    expect(screen.getByTestId('status-badge-passed')).toBeInTheDocument()
  })

  it('omits the data-testid when no prefix is supplied', () => {
    renderTable([statusColumn<Row>({ accessor: (r) => r.status })])
    expect(screen.queryByTestId('status-badge-passed')).toBeNull()
  })

  it('pulses the dot when status is running', () => {
    renderTable(
      [statusColumn<Row>({ accessor: (r) => r.status, testIdPrefix: 'row' })],
      [{ ...row, status: 'running' }],
    )
    expect(screen.getByTestId('status-dot').className).toContain('animate-pulse')
  })
})

describe('tagsColumn', () => {
  it('renders tags as inline pill badges', () => {
    renderTable([
      tagsColumn<Row>({
        accessor: (r) => r.tags,
        testId: 'row-tags',
        id: 'customTags',
        label: 'Labels',
      }),
    ])
    const el = screen.getByTestId('row-tags')
    expect(el).toHaveTextContent('t1')
    expect(el).toHaveTextContent('t2')
    expect(el.className).toContain('flex')
  })
})

describe('durationColumn', () => {
  it('renders the pre-formatted duration with tabular digits', () => {
    renderTable([
      durationColumn<Row>({
        accessor: (r) => r.duration,
        testId: 'row-duration',
        id: 'dur',
        label: 'Elapsed',
      }),
    ])
    const el = screen.getByTestId('row-duration')
    expect(el).toHaveTextContent('1m 5s')
    expect(el.className).toContain('tabular-nums')
  })
})

describe('countColumn', () => {
  it('uses the singular label when count is 1', () => {
    renderTable([
      countColumn<Row>({
        id: 'items',
        accessor: (r) => r.count,
        label: 'Items',
        singularLabel: 'item',
        pluralLabel: 'items',
        testId: 'item-count',
      }),
    ])
    expect(screen.getByTestId('item-count')).toHaveTextContent('1 item')
  })

  it('uses the plural label when count is not 1', () => {
    renderTable(
      [
        countColumn<Row>({
          id: 'items',
          accessor: (r) => r.count,
          label: 'Items',
          singularLabel: 'item',
          pluralLabel: 'items',
          skeletonWidth: 'w-24',
        }),
      ],
      [{ ...row, count: 5 }],
    )
    expect(screen.getByText('5 items')).toBeInTheDocument()
  })
})

describe('accessorFn (sort key extraction)', () => {
  type ColWithAccessor = ColumnDef<Row, unknown> & { accessorFn: (row: Row, index: number) => unknown }

  it('exposes accessorFn for nameColumn, statusColumn, durationColumn, countColumn, tagsColumn', () => {
    const name = nameColumn<Row>({ accessor: (r) => r.name, testId: 'n' }) as ColWithAccessor
    const status = statusColumn<Row>({ accessor: (r) => r.status }) as ColWithAccessor
    const duration = durationColumn<Row>({ accessor: (r) => r.duration }) as ColWithAccessor
    const count = countColumn<Row>({
      id: 'c',
      accessor: (r) => r.count,
      label: 'C',
      singularLabel: 'c',
      pluralLabel: 'cs',
    }) as ColWithAccessor
    const tags = tagsColumn<Row>({ accessor: (r) => r.tags, testId: 't' }) as ColWithAccessor
    expect(name.accessorFn(row, 0)).toBe('Alpha')
    expect(status.accessorFn(row, 0)).toBe('passed')
    expect(duration.accessorFn(row, 0)).toBe('1m 5s')
    expect(count.accessorFn(row, 0)).toBe(1)
    expect(tags.accessorFn(row, 0)).toBe('t1, t2')
  })

  it('expandableNameColumn exposes accessorFn for sort', () => {
    const col = expandableNameColumn<TreeRow>({
      accessor: (r) => r.name,
      testId: 't',
      isExpandable: () => false,
    }) as ColumnDef<TreeRow, unknown> & { accessorFn: (row: TreeRow, index: number) => unknown }
    expect(col.accessorFn({ id: 'x', name: 'Parent', kind: 'parent' }, 0)).toBe('Parent')
  })
})

describe('actionsColumn', () => {
  it('renders via the provided render callback and is non-sortable', async () => {
    const handleAction = vi.fn()
    const user = userEvent.setup()
    const columns = [
      actionsColumn<Row>({
        render: (r) => (
          <button type="button" data-testid="row-action" onClick={() => handleAction(r.id)}>
            X
          </button>
        ),
        id: 'ops',
        skeletonWidth: 'w-8',
        skeletonHeight: 'h-7',
      }),
    ]
    renderTable(columns)
    await user.click(screen.getByTestId('row-action'))
    expect(handleAction).toHaveBeenCalledWith('r1')
    const col = columns[0] as { meta?: { sticky?: string } }
    expect(col.meta?.sticky).toBe('right')
  })
})
