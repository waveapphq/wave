/**
 * SortListEditor - a controlled priority list of column + direction sort rows.
 */

import { ChevronDown, ChevronUp, Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { nextId } from '@/features/workbench/common/config/assertion-builder/types'
import { ColumnRefControl } from './column-ref-control'
import type { ColumnRef, ColumnRefContext, TableSort } from './types'

const MOVE_BUTTONS = [
  { dir: 'up' as const, delta: -1, Icon: ChevronUp, label: 'Move sort up' },
  { dir: 'down' as const, delta: 1, Icon: ChevronDown, label: 'Move sort down' },
]

function swap<T>(items: T[], a: number, b: number): T[] {
  const next = [...items]
  ;[next[a], next[b]] = [next[b], next[a]]
  return next
}

function replaceAt<T>(items: T[], index: number, next: T): T[] {
  const copy = [...items]
  copy[index] = next
  return copy
}

export interface SortListEditorProps {
  sorts: TableSort[]
  columnRefProps: ColumnRefContext
  onChange: (sorts: TableSort[]) => void
}

export function SortListEditor({ sorts, columnRefProps, onChange }: Readonly<SortListEditorProps>) {
  const addSort = () =>
    onChange([
      ...sorts,
      { id: nextId('csv-sort'), column: { mode: 'name', value: '' }, direction: 'asc' },
    ])

  return (
    <div className="space-y-2">
      {sorts.map((sort, index) => (
        <div
          key={sort.id}
          data-testid={`sort-row-${sort.id}`}
          className="flex items-center gap-2"
        >
          <div className="flex-1 min-w-0">
            <ColumnRefControl
              mode={sort.column.mode}
              value={sort.column.value}
              hasHeader={columnRefProps.hasHeader}
              schemaColumns={columnRefProps.schemaColumns}
              onChange={(ref: ColumnRef) =>
                onChange(replaceAt(sorts, index, { ...sort, column: ref }))
              }
            />
          </div>
          <Select
            value={sort.direction}
            onValueChange={(value) =>
              onChange(replaceAt(sorts, index, { ...sort, direction: value as 'asc' | 'desc' }))
            }
          >
            <SelectTrigger
              data-testid={`sort-direction-${sort.id}`}
              className="h-8 w-[140px] shrink-0"
              aria-label="Sort direction"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="asc">Ascending</SelectItem>
              <SelectItem value="desc">Descending</SelectItem>
            </SelectContent>
          </Select>
          <div className="flex items-center gap-0.5 shrink-0">
            {MOVE_BUTTONS.map(({ dir, delta, Icon, label }) => (
              <Button
                key={dir}
                variant="ghost"
                size="sm"
                className="h-8 w-8 p-0"
                data-testid={`sort-move-${dir}-${sort.id}`}
                aria-label={label}
                onClick={() => onChange(swap(sorts, index, index + delta))}
                disabled={index + delta < 0 || index + delta >= sorts.length}
              >
                <Icon className="h-3.5 w-3.5" />
              </Button>
            ))}
            <Button
              variant="ghost"
              size="sm"
              className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive"
              data-testid={`sort-delete-${sort.id}`}
              aria-label="Delete sort"
              onClick={() => onChange(sorts.filter((other) => other.id !== sort.id))}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      ))}
      <Button
        variant="outline"
        size="sm"
        className="h-8"
        data-testid="sort-add-button"
        onClick={addSort}
      >
        <Plus className="h-3.5 w-3.5 mr-1" />
        Add Sort
      </Button>
    </div>
  )
}
