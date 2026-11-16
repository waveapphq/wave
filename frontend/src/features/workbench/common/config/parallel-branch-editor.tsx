/** ParallelBranchEditor - the BRANCHES section of the Parallel config sheet (REQ-3.1.1.3, REQ-3.2.3.7, PARALLEL-3). */

import { useEffect, useRef } from 'react'
import { Plus } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { AvailableVariable } from '@/features/workbench/lib/codemirror/type-inference'
import {
  indexedRowModes,
  rekeyIndexedFlags,
  type FieldModes,
  type IndexedRowChange,
} from '@/features/workbench/lib/node-parameters/field-modes'
import { FieldCellView, useFieldCell } from '../element-config/parameters/field-cell'
import type { Parameter } from '../element-config/parameters/parameter-table-types'
import { BranchCard } from './branch-card'
import { nextBranchId, withBranchMoved, withoutBranch } from './branch-list-ops'

/** A lane as the Block stores it: the limit in the number wire form or {x} text, no key while unset (REQ-3.1.3.14). */
export interface ParallelLane {
  id: string
  name: string
  time_limit?: number | string
}

export interface ParallelBranchEditorProps {
  branches: ParallelLane[]
  /** The lanes, with the Block {x} list re-keyed in the same change. */
  onBranchesChange: (branches: ParallelLane[], flags: string[]) => void
  expressionFields: string[]
  onExpressionFieldsChange: (fields: string[]) => void
  availableVariables: AvailableVariable[]
  /** Window lines keyed `branches.<index>.time_limit`. */
  messages: Record<string, string>
}

const MINIMUM_BRANCHES = 2
const DELETE_BLOCKED = 'A parallel section needs at least two branches'
const LANES_FIELD = 'branches'
const LIMIT_KEY = 'time_limit'
// The name fills the free space up to the If/Else name width (PARALLEL-3).
const NAME_COLUMN = 'min-w-0 flex-1 max-w-[201px]'
// The time limit box is the Setter value box's width at 880 px (PARALLEL-3, FIELD-16).
const LIMIT_BOX_COLUMN = 'w-[357px] shrink-0'
// That box plus its expand and {x} columns, each 32 px after an 8 px gap (FIELD-1).
const LIMIT_CELL_COLUMN = 'w-[437px] shrink-0'

function seedBranches(): ParallelLane[] {
  return [
    { id: 'branch_1', name: '' },
    { id: 'branch_2', name: '' },
  ]
}

/** A lane time limit is the one field: whole milliseconds, at least 1. */
function laneLimitParameter(laneId: string): Parameter {
  return { name: `parallel-branch-limit-${laneId}`, label: 'Time Limit', type: 'integer', required: false, minimum: 1 }
}

function withLimit(lane: ParallelLane, limit: unknown): ParallelLane {
  const { time_limit: _dropped, ...rest } = lane
  // An integer field gives the number wire form or {x} text.
  return limit === undefined ? rest : { ...rest, time_limit: limit as ParallelLane['time_limit'] }
}

interface LaneCardProps {
  lane: ParallelLane
  index: number
  laneCount: number
  modes: FieldModes
  availableVariables: AvailableVariable[]
  fieldError: string | undefined
  onRename: (name: string) => void
  onLimitChange: (limit: unknown) => void
  onMove: (direction: 'up' | 'down') => void
  onDelete: () => void
}

function LaneCard({
  lane,
  index,
  laneCount,
  modes,
  availableVariables,
  fieldError,
  onRename,
  onLimitChange,
  onMove,
  onDelete,
}: Readonly<LaneCardProps>) {
  const limitCell = useFieldCell({
    mode: 'input',
    parameter: laneLimitParameter(lane.id),
    value: lane.time_limit,
    onChange: onLimitChange,
    modes,
    availableVariables,
    fieldError,
    toggleTestId: `parallel-branch-limit-toggle-${lane.id}`,
  })
  const noun = `branch ${lane.name || index + 1}`
  return (
    <BranchCard
      branchId={lane.id}
      testIdPrefix="parallel-branch"
      noun={noun}
      collapsible={false}
      badge={
        <Badge
          data-testid={`parallel-branch-badge-${lane.id}`}
          className="bg-violet-500 text-white border-transparent"
        >
          BRANCH
        </Badge>
      }
      label={lane.name}
      labelPlaceholder={`Branch ${index + 1}`}
      labelColumnClassName={NAME_COLUMN}
      onLabelChange={onRename}
      headerExtra={
        // Every lane's box is named Time Limit, so the group names the lane it belongs to.
        <fieldset
          data-testid={`parallel-branch-limit-cell-${lane.id}`}
          aria-label={`Time limit for ${noun}`}
          className={cn(LIMIT_CELL_COLUMN, 'min-w-0')}
        >
          <FieldCellView state={limitCell} />
        </fieldset>
      }
      headerGrows={limitCell.hasMessage}
      canMove
      canMoveUp={index > 0}
      canMoveDown={index < laneCount - 1}
      onMove={onMove}
      canDelete
      deleteDisabled={laneCount <= MINIMUM_BRANCHES}
      deleteDisabledReason={DELETE_BLOCKED}
      onDelete={onDelete}
    >
      {null}
    </BranchCard>
  )
}

export function ParallelBranchEditor({
  branches: externalBranches,
  onBranchesChange,
  expressionFields,
  onExpressionFieldsChange,
  availableVariables,
  messages,
}: Readonly<ParallelBranchEditorProps>) {
  const branches = externalBranches.length > 0 ? externalBranches : seedBranches()
  // One {x} switch writes its flag, then its value: the value write carries the flag written before it.
  const written = useRef<{ base: string[]; flags: string[] } | null>(null)

  // A fresh Parallel starts with two lanes; push that seed up so Save persists it.
  useEffect(() => {
    if (externalBranches.length === 0) onBranchesChange(seedBranches(), expressionFields)
  }, []) // Only run on mount

  const latestFlags = () => (written.current?.base === expressionFields ? written.current.flags : expressionFields)

  const writeFlags = (flags: string[]) => {
    written.current = { base: expressionFields, flags }
    onExpressionFieldsChange(flags)
  }

  const writeLanes = (next: ParallelLane[], change?: IndexedRowChange) => {
    const flags = latestFlags()
    onBranchesChange(next, change ? rekeyIndexedFlags(flags, LANES_FIELD, LIMIT_KEY, change) : flags)
  }

  const updateLane = (index: number, update: (lane: ParallelLane) => ParallelLane) =>
    writeLanes(branches.map((lane, at) => (at === index ? update(lane) : lane)))

  const addBranch = () =>
    writeLanes([...branches, { id: nextBranchId(branches, 1), name: '' }], { kind: 'add', at: branches.length })

  const moveBranch = (index: number, direction: 'up' | 'down') => {
    const to = direction === 'up' ? index - 1 : index + 1
    writeLanes(withBranchMoved(branches, branches[index].id, direction), { kind: 'move', from: index, to })
  }

  const deleteBranch = (index: number) =>
    writeLanes(withoutBranch(branches, branches[index].id), { kind: 'delete', at: index })

  return (
    <div className="space-y-2 pt-3" data-testid="parallel-branch-editor">
      <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
        Branches
      </h3>
      {/* Mirrors the row: badge, name, box, expand, {x}, then the reorder pair and delete. */}
      <div
        data-testid="parallel-branch-columns"
        className="flex items-center gap-2 px-[13px] text-xs text-muted-foreground"
      >
        <Badge aria-hidden="true" className="invisible">
          BRANCH
        </Badge>
        <span className={NAME_COLUMN}>Name</span>
        <span className={cn(LIMIT_BOX_COLUMN, 'whitespace-nowrap')}>Time limit (ms)</span>
        <span className="w-8 shrink-0" aria-hidden="true" />
        <span className="w-8 shrink-0" aria-hidden="true" />
        <span className="w-16 shrink-0" aria-hidden="true" />
      </div>

      {branches.map((lane, index) => (
        <LaneCard
          key={lane.id}
          lane={lane}
          index={index}
          laneCount={branches.length}
          modes={indexedRowModes(LANES_FIELD, LIMIT_KEY, index, {
            expressionFields,
            onExpressionFieldsChange: writeFlags,
          })}
          availableVariables={availableVariables}
          fieldError={messages[`${LANES_FIELD}.${index}.${LIMIT_KEY}`]}
          onRename={(name) => updateLane(index, (current) => ({ ...current, name }))}
          onLimitChange={(limit) => updateLane(index, (current) => withLimit(current, limit))}
          onMove={(direction) => moveBranch(index, direction)}
          onDelete={() => deleteBranch(index)}
        />
      ))}

      <div className="flex gap-2 pt-1">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={addBranch}
          data-testid="add-branch-button"
        >
          <Plus className="w-3.5 h-3.5 mr-1" />
          Branch
        </Button>
      </div>
    </div>
  )
}
