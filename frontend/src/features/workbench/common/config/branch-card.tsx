/**
 * BranchCard - the collapsible branch-card shell shared by the If/Else branch
 * editor and the Switch case editor.
 *
 * Owns its open state; callers keep no open-id bookkeeping.
 */

import { useCallback, useState, type ReactNode } from 'react'
import { ChevronDown, ChevronUp, Trash2, AlertTriangle } from 'lucide-react'
import { Collapsible, CollapsibleContent } from '@/components/ui/collapsible'
import { Input } from '@/components/ui/input'
import { ConditionalTooltip } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { MovePair, RowActionButton } from './move-pair'
import { conditionListComplete } from '@/features/workbench/lib/validation/condition-checks'
import type { AssertionItem } from './assertion-builder/types'

/** Why a branch blocks Save, or undefined when it is complete (REQ-3.5.1.5). */
export function incompleteBranchReason(
  conditions: AssertionItem[],
  noun: string,
): string | undefined {
  if (conditionListComplete(conditions)) return undefined
  const hasRows = conditions.some((item) => item.type !== 'operator')
  return hasRows
    ? `This ${noun} has an unfinished assertion - Save stays blocked until it is complete`
    : `This ${noun} has no assertions - Save stays blocked until it has one`
}

export interface BranchCardProps {
  branchId: string
  /** Test-id family: 'branch' for If/Else, 'case' / 'default' for Switch. */
  testIdPrefix: string
  /** Aria noun used in the Expand/Collapse, Move and Delete labels. */
  noun?: string
  badge: ReactNode
  label: string
  onLabelChange: (value: string) => void
  defaultOpen?: boolean
  canMove: boolean
  canMoveUp: boolean
  canMoveDown: boolean
  onMove: (direction: 'up' | 'down') => void
  canDelete: boolean
  deleteDisabled?: boolean
  /** Why the delete is disabled; explained on hover. Omit to say nothing. */
  deleteDisabledReason?: string
  onDelete: () => void
  /** Why this branch blocks Save. Marks the header so a collapsed card says so too. */
  alert?: string
  /** Rendered between the label input and the reorder pair; never toggles the card. */
  headerExtra?: ReactNode
  /** The header grows 20 px at its bottom while the header extra shows a line under it. */
  headerGrows?: boolean
  /** Placeholder for the name field when the branch is unnamed. */
  labelPlaceholder?: string
  /** The name field's column width; without one the field keeps its own width. */
  labelColumnClassName?: string
  /** False renders the header alone - no chevron, no body - for a card with no content. */
  collapsible?: boolean
  children: ReactNode
}

export function BranchCard({
  branchId,
  testIdPrefix,
  noun = 'branch',
  badge,
  label,
  onLabelChange,
  defaultOpen = true,
  canMove,
  canMoveUp,
  canMoveDown,
  onMove,
  canDelete,
  deleteDisabled = false,
  deleteDisabledReason,
  onDelete,
  alert,
  headerExtra,
  headerGrows = false,
  labelPlaceholder = 'Branch name…',
  labelColumnClassName,
  collapsible = true,
  children,
}: Readonly<BranchCardProps>) {
  const [open, setOpen] = useState(defaultOpen)
  const toggle = useCallback(() => setOpen((prev) => !prev), [])
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <div
        data-testid={`${testIdPrefix}-card-${branchId}`}
        className="border border-border rounded-lg"
      >
        {/* The chevron is the only toggle: a labeled button carrying the
            expanded state, so the row needs no click handling of its own. */}
        <div
          className={cn('flex items-center gap-2 px-3 pt-2 bg-muted/50', headerGrows ? 'pb-7' : 'pb-2')}
          data-testid={`${testIdPrefix}-header-${branchId}`}
        >
          {collapsible && (
            <button
              type="button"
              className="group shrink-0 rounded focus-visible:ring-2 focus-visible:ring-offset-2"
              data-testid={`${testIdPrefix}-toggle-${branchId}`}
              aria-expanded={open}
              aria-label={open ? `Collapse ${noun}` : `Expand ${noun}`}
              onClick={toggle}
            >
              {open ? (
                <ChevronUp className="w-4 h-4 text-muted-foreground group-hover:text-foreground" />
              ) : (
                <ChevronDown className="w-4 h-4 text-muted-foreground group-hover:text-foreground" />
              )}
            </button>
          )}

          {badge}

          {alert && (
            <ConditionalTooltip content={alert}>
              {/* A button, so the reason opens from the keyboard too, as the canvas alert does. */}
              <button
                type="button"
                aria-label={alert}
                data-testid={`${testIdPrefix}-alert-${branchId}`}
                className="inline-flex shrink-0 items-center justify-center cursor-help border-0 bg-transparent p-0 text-destructive"
              >
                <AlertTriangle className="w-4 h-4" aria-hidden="true" />
              </button>
            </ConditionalTooltip>
          )}

          <Input
            value={label}
            onChange={(e) => onLabelChange(e.target.value)}
            name={`${testIdPrefix}-label`}
            autoComplete="off"
            aria-label={`Name for ${noun}`}
            placeholder={labelPlaceholder}
            wrapperClassName={labelColumnClassName}
            className="h-7 text-sm flex-1"
            data-testid={`${testIdPrefix}-label-${branchId}`}
          />

          {headerExtra && (
            <div className="flex items-center gap-1.5 shrink-0">{headerExtra}</div>
          )}

          {canMove && (
            <MovePair
              canMoveUp={canMoveUp}
              canMoveDown={canMoveDown}
              onMove={onMove}
              upLabel={`Move ${noun} up`}
              downLabel={`Move ${noun} down`}
              upTestId={`${testIdPrefix}-move-up-${branchId}`}
              downTestId={`${testIdPrefix}-move-down-${branchId}`}
            />
          )}

          {canDelete && (
            <ConditionalTooltip
              content={deleteDisabled ? deleteDisabledReason : undefined}
              disabled={deleteDisabled}
            >
              {/* A disabled button swallows its own hover, so the wrapper carries
                  the tooltip that explains why the delete does nothing. */}
              <span className="flex shrink-0">
                <RowActionButton
                  testId={`${testIdPrefix}-delete-${branchId}`}
                  ariaLabel={`Delete ${noun}`}
                  disabled={deleteDisabled}
                  onClick={onDelete}
                  className={deleteDisabled ? undefined : 'hover:text-destructive'}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </RowActionButton>
              </span>
            </ConditionalTooltip>
          )}
        </div>

        {collapsible && (
          <CollapsibleContent>
            <div className="px-3 py-3 space-y-2" data-testid={`${testIdPrefix}-body-${branchId}`}>
              {children}
            </div>
          </CollapsibleContent>
        )}
      </div>
    </Collapsible>
  )
}
