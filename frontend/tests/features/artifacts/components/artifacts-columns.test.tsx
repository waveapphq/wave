/**
 * Artifacts column definitions (components/artifacts-columns.tsx).
 *
 * Execution-first columns: Execution / Type / Status / Finished / Artifacts /
 * Size / Actions. Cells tolerate a null name / status / type (summary rows can
 * carry nulls when the execution record is sparse).
 */

import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  getArtifactsColumns,
  type ArtifactsColumnCallbacks,
} from '@/features/artifacts/components/artifacts-columns'
import type { ExecutionArtifactSummary } from '@/features/artifacts/api/types'

function makeRow(overrides: Partial<ExecutionArtifactSummary> = {}): ExecutionArtifactSummary {
  return {
    execution_id: 'exec-1',
    name: 'Nightly API Suite',
    entity_type: 'suite',
    status: 'failed',
    finished_at: '2026-06-10T11:07:13+00:00',
    artifact_count: 12,
    total_size_bytes: 48210,
    ...overrides,
  }
}

function createCallbacks(): ArtifactsColumnCallbacks {
  return { onOpen: vi.fn(), onDownloadZip: vi.fn(), onDelete: vi.fn() }
}

interface ColumnShape {
  id?: string
  accessorFn?: (row: ExecutionArtifactSummary) => unknown
  cell?: (ctx: { row: { original: ExecutionArtifactSummary } }) => React.ReactNode
}

function getColumns(callbacks = createCallbacks()): ColumnShape[] {
  return getArtifactsColumns(callbacks) as unknown as ColumnShape[]
}

function renderCell(columnId: string, row: ExecutionArtifactSummary, callbacks = createCallbacks()) {
  const column = getColumns(callbacks).find((c) => c.id === columnId)
  expect(column).toBeDefined()
  return render(<>{column!.cell!({ row: { original: row } })}</>)
}

describe('getArtifactsColumns - shape', () => {
  it('returns columns in execution-first order', () => {
    expect(getColumns().map((column) => column.id)).toEqual([
      'execution',
      'type',
      'status',
      'finishedAt',
      'artifacts',
      'size',
      'actions',
    ])
  })
})

describe('getArtifactsColumns - accessors', () => {
  it('exposes sortable accessors for the type and finished columns', () => {
    const columns = getColumns()
    const type = columns.find((column) => column.id === 'type')
    const finished = columns.find((column) => column.id === 'finishedAt')

    expect(type?.accessorFn?.(makeRow({ entity_type: 'suite' }))).toBe('suite')
    expect(finished?.accessorFn?.(makeRow())).toBe('2026-06-10T11:07:13+00:00')
  })
})

describe('getArtifactsColumns - cells', () => {
  it('execution cell shows the name and opens the drill on click', async () => {
    const user = userEvent.setup()
    const callbacks = createCallbacks()
    renderCell('execution', makeRow(), callbacks)

    expect(screen.getByText('Nightly API Suite')).toBeInTheDocument()
    await user.click(screen.getByText('Nightly API Suite'))
    expect(callbacks.onOpen).toHaveBeenCalled()
  })

  it('execution cell tolerates a missing name', () => {
    expect(() => renderCell('execution', makeRow({ name: null }))).not.toThrow()
  })

  it('type cell renders the entity chip with its icon', () => {
    renderCell('type', makeRow({ entity_type: 'regression' }))
    const chip = screen.getByTestId('artifact-type')
    expect(chip).toHaveTextContent('Regression')
    expect(chip.querySelector('svg')).not.toBeNull()
  })

  it('type cell tolerates a missing type', () => {
    renderCell('type', makeRow({ entity_type: null }))
    expect(screen.getByTestId('artifact-type')).toHaveTextContent('-')
  })

  it('status cell renders the status badge', () => {
    renderCell('status', makeRow({ status: 'passed' }))
    expect(screen.getByText(/passed/i)).toBeInTheDocument()
  })

  it('status cell tolerates a missing status', () => {
    expect(() => renderCell('status', makeRow({ status: null }))).not.toThrow()
  })

  it('finished cell renders a relative time', () => {
    renderCell('finishedAt', makeRow())
    expect(screen.getByTestId('artifact-finished-at')).toBeInTheDocument()
  })

  it('artifacts cell shows the count', () => {
    renderCell('artifacts', makeRow({ artifact_count: 7 }))
    expect(screen.getByTestId('artifact-count')).toHaveTextContent('7')
  })

  it('size cell shows the formatted total', () => {
    renderCell('size', makeRow({ total_size_bytes: 2048 }))
    expect(screen.getByTestId('artifact-size')).toHaveTextContent('2.0 KB')
  })

  it('actions cell renders the row actions', () => {
    renderCell('actions', makeRow())
    expect(screen.getByRole('button', { name: /open/i })).toBeInTheDocument()
  })
})
