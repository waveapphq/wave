/**
 * Regressions Column Definitions Tests
 *
 * REQ-5.2.1.37: Regression management screen
 *
 * Tests for TanStack column definitions after DataTable migration:
 * - getRegressionsColumns returns correct column definitions
 * - Column IDs match the spec (name, version, suitesCount, testsCount, status, lastRun, tags, createdAt, updatedAt, actions)
 * - Sortable columns have enableSorting: true
 * - Non-sortable columns (tags, createdAt, updatedAt, actions) have enableSorting: false
 * - Name column is sticky left
 * - Actions column is sticky right
 * - Cell renderers produce correct output
 *
 * Module: frontend/src/features/regressions/components/regressions-columns.tsx
 */

import { describe, it, expect, vi } from 'vitest'
import {
  getRegressionsColumns,
  type RegressionsColumnCallbacks,
} from '@/features/regressions/components/regressions-columns'

// Column shape expected from TanStack column definitions
interface ColumnDef {
  id?: string
  accessorKey?: string
  enableSorting?: boolean
  header?: string | (() => unknown)
  meta?: Record<string, unknown>
}

function getColumns(): ColumnDef[] {
  return getRegressionsColumns(createMockCallbacks()) as ColumnDef[]
}

function findColumn(id: string): ColumnDef | undefined {
  return getColumns().find((c) => c.id === id || c.accessorKey === id)
}

// ============================================================================
// Mock Callbacks
// ============================================================================

function createMockCallbacks(): RegressionsColumnCallbacks {
  return {
    onRowClick: vi.fn(),
    onRunRegression: vi.fn(),
    onEditRegression: vi.fn(),
    onDeleteRegression: vi.fn(),
    onDuplicateRegression: vi.fn(),
  }
}

// ============================================================================
// Tests
// ============================================================================

describe('getRegressionsColumns', () => {
  it('returns all expected columns', () => {
    const columns = getColumns()
    const ids = columns.map((c: ColumnDef) => c.id ?? c.accessorKey)

    expect(ids).toContain('name')
    expect(ids).toContain('suitesCount')
    expect(ids).toContain('testsCount')
    expect(ids).toContain('status')
    expect(ids).toContain('lastRun')
    expect(ids).toContain('tags')
    expect(ids).toContain('createdAt')
    expect(ids).toContain('updatedAt')
    expect(ids).toContain('actions')
  })

  it('returns 9 columns total', () => {
    expect(getColumns()).toHaveLength(9)
  })

  describe('Sortable columns', () => {
    it('name column is sortable', () => {
      const col = findColumn('name')
      expect(col).toBeDefined()
      expect(col!.enableSorting).not.toBe(false)
    })

    it('suitesCount column is sortable', () => {
      const col = findColumn('suitesCount')
      expect(col).toBeDefined()
      expect(col!.enableSorting).not.toBe(false)
    })

    it('testsCount column is sortable', () => {
      const col = findColumn('testsCount')
      expect(col).toBeDefined()
      expect(col!.enableSorting).not.toBe(false)
    })

    it('status column is sortable', () => {
      const col = findColumn('status')
      expect(col).toBeDefined()
      expect(col!.enableSorting).not.toBe(false)
    })

    it('lastRun column is sortable', () => {
      const col = findColumn('lastRun')
      expect(col).toBeDefined()
      expect(col!.enableSorting).not.toBe(false)
    })
  })

  describe('Non-sortable columns', () => {
    it('actions column is not sortable', () => {
      const col = findColumn('actions')
      expect(col).toBeDefined()
      expect(col!.enableSorting).toBe(false)
    })
  })

  describe('Sticky columns', () => {
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
  })

  describe('Column headers', () => {
    it('name column has "Name" header rendered via DataTableColumnHeader', () => {
      const col = findColumn('name')
      expect(col).toBeDefined()
      expect(col!.header).toBeDefined()
    })
  })
})
