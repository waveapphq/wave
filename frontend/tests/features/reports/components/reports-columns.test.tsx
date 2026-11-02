/**
 * Reports Column Definitions Tests
 *
 * Columns per RVIEW-11/RVIEW-12: Name, Type, Status, Finished, Duration,
 * Report ("Generated <relative> - <size>" or italic "Not generated"),
 * Actions (eye = View when a JSON report exists, file-plus = Generate
 * when not; both open the viewer).
 *
 * Module: frontend/src/features/reports/components/reports-columns.tsx
 */

import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReportListRow } from '@/features/reports/api/types'
import {
  getReportsColumns,
  type ReportsColumnCallbacks,
} from '@/features/reports/components/reports-columns'

function makeRow(overrides: Partial<ReportListRow['reports']> = {}): ReportListRow {
  return {
    execution: {
      id: 'exec-1',
      name: 'Nightly API Suite',
      entity_type: 'suite',
      entity_id: 'suite-1',
      status: 'failed',
      triggered_by: 'dev',
      started_at: '2026-06-10T11:06:52+00:00',
      ended_at: '2026-06-10T11:07:13+00:00',
      duration: 21,
    },
    reports: {
      json: null,
      html: null,
      ...overrides,
    },
  }
}

const JSON_META = {
  artifact_id: 'dir-1/report.v2.json',
  version: 2,
  size_bytes: 14541,
  generated_at: '2026-06-10T11:30:00+00:00',
}

function createCallbacks(): ReportsColumnCallbacks {
  return {
    onRowClick: vi.fn(),
    onView: vi.fn(),
  }
}

interface ColumnShape {
  id?: string
  enableSorting?: boolean
  meta?: Record<string, unknown>
  cell?: (ctx: { row: { original: ReportListRow } }) => React.ReactNode
}

function getColumns(callbacks = createCallbacks()): ColumnShape[] {
  return getReportsColumns(callbacks) as unknown as ColumnShape[]
}

function renderCell(columnId: string, row: ReportListRow, callbacks = createCallbacks()) {
  const column = getColumns(callbacks).find((c) => c.id === columnId)
  expect(column).toBeDefined()
  return render(<>{column!.cell!({ row: { original: row } })}</>)
}

describe('getReportsColumns - shape', () => {
  it('returns columns in order: name, type, status, finishedAt, duration, report, actions', () => {
    const ids = getColumns().map((c) => c.id)
    expect(ids).toEqual([
      'name',
      'type',
      'status',
      'finishedAt',
      'duration',
      'report',
      'actions',
    ])
  })

  it('name column has sticky left metadata', () => {
    expect(getColumns().find((c) => c.id === 'name')!.meta?.sticky).toBe('left')
  })

  it('actions column has sticky right metadata and is not sortable', () => {
    const actions = getColumns().find((c) => c.id === 'actions')!
    expect(actions.meta?.sticky).toBe('right')
    expect(actions.enableSorting).toBe(false)
  })

  it('report column is not sortable (backend offers no report-field sorts)', () => {
    expect(getColumns().find((c) => c.id === 'report')!.enableSorting).toBe(false)
  })
})

describe('getReportsColumns - cells', () => {
  it('type cell renders the capitalized entity type', () => {
    renderCell('type', makeRow())
    expect(screen.getByTestId('report-type')).toHaveTextContent('Suite')
  })

  it('status cell renders the shared status badge', () => {
    renderCell('status', makeRow())
    expect(screen.getByTestId('status-badge-failed')).toBeInTheDocument()
  })

  it('report cell shows Generated with the formatted size when a JSON report exists', () => {
    renderCell('report', makeRow({ json: JSON_META }))

    const cell = screen.getByTestId('report-cell')
    expect(cell).toHaveTextContent(/Generated/)
    expect(cell).toHaveTextContent('14.2 KB')
    expect(cell).not.toHaveTextContent('Not generated')
  })

  it('report cell shows an italic "Not generated" when no JSON report exists', () => {
    renderCell('report', makeRow())

    const cell = screen.getByTestId('report-cell')
    expect(cell).toHaveTextContent('Not generated')
    expect(cell.querySelector('.italic')).not.toBeNull()
  })

  it('report cell ignores an HTML-only artifact (the viewer consumes JSON)', () => {
    renderCell('report', makeRow({ html: { ...JSON_META, artifact_id: 'dir-1/report.v1.html' } }))

    expect(screen.getByTestId('report-cell')).toHaveTextContent('Not generated')
  })

  it('actions cell renders the View action when a JSON report exists', async () => {
    const user = userEvent.setup()
    const callbacks = createCallbacks()
    renderCell('actions', makeRow({ json: JSON_META }), callbacks)

    const view = screen.getByTestId('row-action-view')
    expect(view).toHaveAccessibleName('View report')
    expect(screen.queryByTestId('row-action-generate')).toBeNull()

    await user.click(view)
    expect(callbacks.onView).toHaveBeenCalledWith('exec-1')
  })

  it('actions cell renders the Generate action when no JSON report exists', async () => {
    const user = userEvent.setup()
    const callbacks = createCallbacks()
    renderCell('actions', makeRow(), callbacks)

    const generate = screen.getByTestId('row-action-generate')
    expect(generate).toHaveAccessibleName('Generate report')
    expect(screen.queryByTestId('row-action-view')).toBeNull()

    await user.click(generate)
    expect(callbacks.onView).toHaveBeenCalledWith('exec-1')
  })
})
