/**
 * TableTransformSections - the collapsible Sorts and Filters sub-sections shared by
 * the table-producing converters.
 */

import { useState, type ReactNode } from 'react'
import { ChevronRight, Info } from 'lucide-react'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { ConditionalTooltip } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import type { AvailableVariable } from '@/features/workbench/common/element-config/expressions/expression-field'
import { SortListEditor } from './sort-list-editor'
import { FilterBlockBuilder } from './filter-block-builder'
import type { ColumnRefContext, TableFilterBlock, TableSort, SchemaColumn } from './types'

function TransformSection({
  title,
  info,
  testId,
  count,
  countLabel,
  children,
}: Readonly<{
  title: string
  info: string
  testId: string
  count: number
  countLabel: string
  children: ReactNode
}>) {
  const [open, setOpen] = useState(false)
  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className="overflow-hidden rounded-[10px] border border-border bg-card"
    >
      <CollapsibleTrigger
        data-testid={`${testId}-trigger`}
        className={cn(
          'flex w-full items-center gap-1.5 bg-muted/30 p-2 text-xs font-medium text-muted-foreground cursor-pointer select-none',
          open && 'border-b border-border',
        )}
      >
        <ChevronRight
          className={cn('h-3.5 w-3.5 shrink-0 transition-transform', open && 'rotate-90')}
        />
        <span className="truncate">{title}</span>
        <ConditionalTooltip
          content={info}
          side="right"
          wide
        >
          <span className="inline-flex" data-testid={`${testId}-info`}>
            <Info className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
          </span>
        </ConditionalTooltip>
        {count > 0 && (
          <span className="ml-auto text-[10px] text-muted-foreground tabular-nums" data-testid={`${testId}-count`}>
            {count} {countLabel}
          </span>
        )}
      </CollapsibleTrigger>
      <CollapsibleContent className="p-3">{children}</CollapsibleContent>
    </Collapsible>
  )
}

export interface TableTransformSectionsProps {
  sorts: TableSort[]
  filters: TableFilterBlock[]
  hasHeader: boolean
  schemaColumns?: SchemaColumn[]
  availableVariables?: AvailableVariable[]
  onSortsChange: (sorts: TableSort[]) => void
  onFiltersChange: (filters: TableFilterBlock[]) => void
}

export function TableTransformSections({
  sorts,
  filters,
  hasHeader,
  schemaColumns,
  availableVariables,
  onSortsChange,
  onFiltersChange,
}: Readonly<TableTransformSectionsProps>) {
  const columnRefProps: ColumnRefContext = { hasHeader, schemaColumns }
  return (
    <div className="space-y-3">
      <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
        Transform
      </h3>
      <TransformSection
        title="Sorts"
        info="Order the rows by one or more columns. The first row is the highest sort priority."
        testId="csv-sorts-section"
        count={sorts.length}
        countLabel="keys"
      >
        <SortListEditor sorts={sorts} columnRefProps={columnRefProps} onChange={onSortsChange} />
      </TransformSection>
      <TransformSection
        title="Filters"
        info="Keep only the rows that match. Each block filters one column; all blocks must match."
        testId="csv-filters-section"
        count={filters.length}
        countLabel="columns"
      >
        <FilterBlockBuilder
          filters={filters}
          columnRefProps={columnRefProps}
          availableVariables={availableVariables}
          onChange={onFiltersChange}
        />
      </TransformSection>
    </div>
  )
}
