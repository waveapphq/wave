/**
 * EntitySummaryTable Component
 *
 * Displays a table of entity types from a validated backup with checkboxes
 * for selecting which types to restore; a type with entries opens to list them.
 */

import { Fragment, useId } from 'react'
import { ExpandToggle } from '@/components/shared/expand-toggle'
import { Checkbox } from '@/components/ui/checkbox'
import { entityTypeLabel } from '@/features/settings/components/entity-selector'
import type { BackupEntitySummary } from '@/features/settings/api/backup'
import { cn } from '@/lib/utils'
import { RestoreItemList } from './restore-item-list'
import { STATUS_ICONS } from './status-icons'

type Status = keyof typeof STATUS_ICONS

interface EntitySummaryTableProps {
  entitySummary: Record<string, BackupEntitySummary>
  selectedTypes: string[]
  onTypeToggle: (entityType: string) => void
  openTypes: string[]
  onOpenToggle: (entityType: string) => void
}

interface StatusHeaderProps {
  status: Status
  label: string
  className: string
}

function StatusHeader({ status, label, className }: Readonly<StatusHeaderProps>) {
  const { Icon, className: colorClass } = STATUS_ICONS[status]
  return (
    <th className={cn('text-center p-2', className)}>
      <span className="flex items-center justify-center gap-1">
        <Icon data-status={status} className={cn('h-3 w-3', colorClass)} />
        {label}
      </span>
    </th>
  )
}

interface StatusCountProps {
  status: Status
  count: number
  className?: string
}

function StatusCount({ status, count, className }: Readonly<StatusCountProps>) {
  return (
    <td className="p-2 text-center tabular-nums">
      {count > 0 ? (
        <span className={cn(STATUS_ICONS[status].className, className)}>{count}</span>
      ) : (
        count
      )}
    </td>
  )
}

export function EntitySummaryTable({
  entitySummary,
  selectedTypes,
  onTypeToggle,
  openTypes,
  onOpenToggle,
}: Readonly<EntitySummaryTableProps>) {
  const typeLabelId = useId()
  return (
    <div className="max-w-2xl">
      <h3 className="text-sm font-semibold mb-2">Entity Summary</h3>
      <table data-testid="entity-summary-table" className="w-full text-sm border rounded-md overflow-hidden">
        <thead>
          <tr className="bg-muted/50 text-xs text-muted-foreground">
            <th className="text-left p-2 w-8"></th>
            <th className="text-left p-2">Type</th>
            <th className="text-center p-2 w-16">Total</th>
            <StatusHeader status="ok" label="OK" className="w-16" />
            <StatusHeader status="conflict" label="Conflicts" className="w-20" />
            <StatusHeader status="fixable" label="Fixable" className="w-16" />
            <StatusHeader status="fatal" label="Errors" className="w-16" />
          </tr>
        </thead>
        <tbody>
          {Object.entries(entitySummary).map(([type, summary]) => {
            const nameId = `${typeLabelId}-${type}`
            const label = entityTypeLabel(type)
            const hasItems = summary.items.length > 0
            const open = hasItems && openTypes.includes(type)
            const name = (
              <span
                id={nameId}
                className="capitalize font-medium text-foreground group-hover:underline"
              >
                {label}
              </span>
            )
            return (
              <Fragment key={type}>
                <tr className="border-t" data-testid={`entity-row-${type}`}>
                  <td className="p-2">
                    <Checkbox
                      data-testid={`restore-checkbox-${type}`}
                      aria-labelledby={nameId}
                      checked={selectedTypes.includes(type)}
                      onCheckedChange={() => onTypeToggle(type)}
                      disabled={summary.fatal === summary.total}
                    />
                  </td>
                  <td className="p-2">
                    {hasItems ? (
                      <ExpandToggle
                        expanded={open}
                        onToggle={() => onOpenToggle(type)}
                        name={label}
                        data-testid={`entity-row-toggle-${type}`}
                        className="cursor-pointer text-muted-foreground"
                      >
                        {name}
                      </ExpandToggle>
                    ) : (
                      <>
                        <span aria-hidden="true" className="inline-block w-6" />
                        {name}
                      </>
                    )}
                  </td>
                  <td className="p-2 text-center tabular-nums">{summary.total}</td>
                  <td className="p-2 text-center tabular-nums">{summary.ok}</td>
                  <StatusCount status="conflict" count={summary.conflicts} />
                  <StatusCount status="fixable" count={summary.fixable} />
                  <StatusCount status="fatal" count={summary.fatal} className="font-medium" />
                </tr>
                {open && (
                  <tr data-testid={`entity-row-items-${type}`}>
                    <td />
                    <td colSpan={6} className="px-2 pb-2.5">
                      <RestoreItemList items={summary.items} stage="preview" labelId={nameId} />
                    </td>
                  </tr>
                )}
              </Fragment>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
