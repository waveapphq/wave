/**
 * Table Transform - shared types for the Sorts + Filters config UI.
 *
 * Persisted verbatim in the node's config.values.sorts / config.values.filters.
 */

import type { AssertionItem } from '@/features/workbench/common/config/assertion-builder/types'

export type ColumnRefMode = 'name' | 'index'

/** A reference to a parsed column, by name or 0-based index. */
export interface ColumnRef {
  mode: ColumnRefMode
  value: string
}

export type TableColumnType = 'string' | 'integer' | 'float' | 'boolean'

/** One sort key: a column reference plus a direction. List order is priority. */
export interface TableSort {
  id: string
  column: ColumnRef
  direction: 'asc' | 'desc'
}

/** A per-column filter block: a column (with a declared `as Type`) and its
 *  interleaved literal / expression / operator conditions. Blocks AND together. */
export interface TableFilterBlock {
  id: string
  column: ColumnRef
  asType: TableColumnType
  conditions: AssertionItem[]
}

/** A resolved schema column, surfaced as a searchable option in schema mode. */
export interface SchemaColumn {
  name: string
  type: string
}

/** Header/schema context the parent supplies to every column-ref row; each row
 *  fills in mode / value / onChange itself. */
export interface ColumnRefContext {
  hasHeader: boolean
  schemaColumns?: SchemaColumn[]
}
