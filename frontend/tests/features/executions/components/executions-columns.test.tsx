/**
 * Executions Column Definitions Tests
 *
 * REQ-5.2.1.40: Execution history screen
 *
 * Tests for TanStack column definitions after DataTable migration.
 * Status and duration rendering are covered in the shared factory test
 * file; this file only asserts column shape and metadata.
 *
 * Module: frontend/src/features/executions/components/executions-columns.tsx
 */

import { describe, it, expect, vi } from 'vitest'
import {
  getExecutionsColumns,
  type ExecutionsColumnCallbacks,
} from '@/features/executions/components/executions-columns'

// ============================================================================
// Mock Callbacks
// ============================================================================

function createMockCallbacks(): ExecutionsColumnCallbacks {
  return {
    onRowClick: vi.fn(),
    onView: vi.fn(),
    onExport: vi.fn(),
    onRerun: vi.fn(),
    onStop: vi.fn(),
    onDelete: vi.fn(),
  }
}

// ============================================================================
// Column shape helper
// ============================================================================

interface ColumnDef {
  id?: string
  accessorKey?: string
  enableSorting?: boolean
  header?: string | (() => unknown)
  meta?: Record<string, unknown>
}

function getColumns(): ColumnDef[] {
  return getExecutionsColumns(createMockCallbacks()) as ColumnDef[]
}

function findColumn(id: string): ColumnDef | undefined {
  return getColumns().find((c) => c.id === id || c.accessorKey === id)
}

// ============================================================================
// getExecutionsColumns Tests
// ============================================================================

describe('getExecutionsColumns', () => {
  it('returns exactly 7 columns', () => {
    expect(getColumns()).toHaveLength(7)
  })

  it('returns columns in correct order: name, type, triggeredBy, startedAt, duration, status, actions', () => {
    const columns = getColumns()
    const ids = columns.map((c) => c.id)
    expect(ids).toEqual([
      'name',
      'type',
      'triggeredBy',
      'startedAt',
      'duration',
      'status',
      'actions',
    ])
  })

  it('name column has sticky left metadata', () => {
    const col = findColumn('name')
    expect(col).toBeDefined()
    expect(col!.meta?.sticky).toBe('left')
  })

  it('actions column has sticky right metadata', () => {
    const col = findColumn('actions')
    expect(col).toBeDefined()
    expect(col!.meta?.sticky).toBe('right')
  })

  it('all columns except actions are sortable', () => {
    const columns = getColumns()
    const nonActions = columns.filter((c) => c.id !== 'actions')
    nonActions.forEach((col) => {
      expect(col.enableSorting).not.toBe(false)
    })
  })

  it('actions column is not sortable', () => {
    const col = findColumn('actions')
    expect(col).toBeDefined()
    expect(col!.enableSorting).toBe(false)
  })

  it('name column has skeletonWidth w-[70%]', () => {
    const col = findColumn('name')
    expect(col!.meta?.skeletonWidth).toBe('w-[70%]')
  })

  it('type column has skeletonWidth w-16', () => {
    const col = findColumn('type')
    expect(col!.meta?.skeletonWidth).toBe('w-16')
  })

  it('triggeredBy column has skeletonWidth w-24', () => {
    const col = findColumn('triggeredBy')
    expect(col!.meta?.skeletonWidth).toBe('w-24')
  })

  it('startedAt column has skeletonWidth w-24', () => {
    const col = findColumn('startedAt')
    expect(col!.meta?.skeletonWidth).toBe('w-24')
  })

  it('duration column has skeletonWidth w-16', () => {
    const col = findColumn('duration')
    expect(col!.meta?.skeletonWidth).toBe('w-16')
  })

  it('status column has skeletonWidth w-16 and skeletonHeight h-5', () => {
    const col = findColumn('status')
    expect(col!.meta?.skeletonWidth).toBe('w-16')
    expect(col!.meta?.skeletonHeight).toBe('h-5')
  })

  it('actions column has skeletonWidth w-20 and skeletonHeight h-8', () => {
    const col = findColumn('actions')
    expect(col!.meta?.skeletonWidth).toBe('w-20')
    expect(col!.meta?.skeletonHeight).toBe('h-8')
  })
})
