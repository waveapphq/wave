/** ParallelBranchEditor - the BRANCHES section of the Parallel config sheet. */

import { use, useCallback, useEffect, useState } from 'react'
import { Plus } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { FieldErrorContext } from '@/components/shared/fields/field-error-context'
import {
  acceptsNumericInput,
  compareNumbers,
  MAX_INTEGER_DIGITS,
  numberValueProblem,
  plainNumberText,
  sameNumber,
  wireNumber,
} from '@/lib/number-rule'
import { BranchCard } from './branch-card'
import { nextBranchId, withBranchMoved, withoutBranch } from './branch-list-ops'

export interface ParallelBranch {
  id: string
  name: string
  /** Milliseconds in the number wire form: a JS number when exact, else its digit text (REQ-3.1.3.14). */
  timeLimit?: number | string
}

export interface ParallelBranchEditorProps {
  branches: ParallelBranch[]
  onBranchesChange: (branches: ParallelBranch[]) => void
  onValidChange: (valid: boolean) => void
}

const MINIMUM_BRANCHES = 2
const DELETE_BLOCKED = 'A parallel section needs at least two branches'

function seedBranches(): ParallelBranch[] {
  return [
    { id: 'branch_1', name: '' },
    { id: 'branch_2', name: '' },
  ]
}

type BranchLimit = number | string | undefined

function isLegalLimit(limit: BranchLimit): boolean {
  if (limit === undefined) return true
  return numberValueProblem(limit, 'integer') === null && compareNumbers(limit, 0) > 0
}

function limitText(limit: BranchLimit): string {
  return limit === undefined ? '' : plainNumberText(limit)
}

/** The box already shows this limit: the same text, or the same exact number. */
function showsLimit(text: string, limit: BranchLimit): boolean {
  if (text === limitText(limit)) return true
  return isWholeNumber(text) && limit !== undefined && isWholeNumber(limit) && sameNumber(text, limit)
}

function isWholeNumber(value: number | string): boolean {
  return numberValueProblem(value, 'integer') === null
}

// A limit is at least 1 ms, so the box takes no minus key.
const LIMIT_RULE = { negative: false } as const

interface TimeLimitInputProps {
  branchId: string
  limit: BranchLimit
  ariaLabel: string
  onChange: (limit: BranchLimit) => void
}

// The shared number rule in the branch's own box: exact digits in the wire form; unfinished text holds the section.
function TimeLimitInput({ branchId, limit, ariaLabel, onChange }: Readonly<TimeLimitInputProps>) {
  const errorId = use(FieldErrorContext)
  const [text, setText] = useState(() => limitText(limit))
  const [shownLimit, setShownLimit] = useState(limit)
  if (!Object.is(shownLimit, limit)) {
    setShownLimit(limit)
    if (!showsLimit(text, limit)) setText(limitText(limit))
  }
  const handleChange = (next: string) => {
    if (!acceptsNumericInput(next, 'integer', LIMIT_RULE)) return
    setText(next)
    onChange(next === '' ? undefined : wireNumber(next, 'integer'))
  }
  return (
    <Input
      type="text"
      inputMode="numeric"
      maxLength={MAX_INTEGER_DIGITS + 1}
      data-testid={`parallel-branch-limit-${branchId}`}
      name={`time-limit-${branchId}`}
      autoComplete="off"
      aria-label={ariaLabel}
      aria-describedby={errorId}
      value={text}
      onChange={(event) => handleChange(event.target.value)}
      placeholder="No limit"
      wrapperClassName="w-36"
      className="h-7 text-sm"
    />
  )
}

export function ParallelBranchEditor({
  branches: externalBranches,
  onBranchesChange,
  onValidChange,
}: Readonly<ParallelBranchEditorProps>) {
  const branches = externalBranches.length > 0 ? externalBranches : seedBranches()

  // A fresh Parallel starts with two lanes; push that seed up so Save persists it.
  useEffect(() => {
    if (externalBranches.length === 0) onBranchesChange(seedBranches())
  }, []) // Only run on mount

  useEffect(() => {
    onValidChange(branches.every((branch) => isLegalLimit(branch.timeLimit)))
  }, [branches, onValidChange])

  const updateBranch = useCallback(
    (id: string, update: Partial<ParallelBranch>) => {
      onBranchesChange(branches.map((b) => (b.id === id ? { ...b, ...update } : b)))
    },
    [branches, onBranchesChange],
  )

  const changeLimit = useCallback(
    (id: string, limit: BranchLimit) => {
      onBranchesChange(
        branches.map((b) => {
          if (b.id !== id) return b
          if (limit === undefined) {
            const { timeLimit: _dropped, ...rest } = b
            return rest
          }
          return { ...b, timeLimit: limit }
        }),
      )
    },
    [branches, onBranchesChange],
  )

  const addBranch = useCallback(() => {
    onBranchesChange([...branches, { id: nextBranchId(branches, 1), name: '' }])
  }, [branches, onBranchesChange])

  const deleteBranch = useCallback(
    (id: string) => onBranchesChange(withoutBranch(branches, id)),
    [branches, onBranchesChange],
  )

  const moveBranch = useCallback(
    (id: string, direction: 'up' | 'down') =>
      onBranchesChange(withBranchMoved(branches, id, direction)),
    [branches, onBranchesChange],
  )

  const atMinimum = branches.length <= MINIMUM_BRANCHES

  return (
    <div className="space-y-2 pt-3" data-testid="parallel-branch-editor">
      <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
        Branches
      </h3>
      {/* Mirrors the row's flex layout, so each label sits over its own field:
          an invisible badge holds the badge column, and the trailing spacer
          matches the reorder pair plus the delete button. */}
      <div
        data-testid="parallel-branch-columns"
        className="flex items-center gap-2 px-[13px] text-xs text-muted-foreground"
      >
        <Badge aria-hidden="true" className="invisible">
          BRANCH
        </Badge>
        <span className="flex-1">Name</span>
        <span className="w-36 shrink-0">Time limit (ms)</span>
        <span className="w-16 shrink-0" aria-hidden="true" />
      </div>

      {branches.map((branch, idx) => (
        <BranchCard
          key={branch.id}
          branchId={branch.id}
          testIdPrefix="parallel-branch"
          noun={`branch ${branch.name || idx + 1}`}
          collapsible={false}
          badge={
            <Badge
              data-testid={`parallel-branch-badge-${branch.id}`}
              className="bg-violet-500 text-white border-transparent"
            >
              BRANCH
            </Badge>
          }
          label={branch.name}
          labelPlaceholder={`Branch ${idx + 1}`}
          labelStretch
          onLabelChange={(name) => updateBranch(branch.id, { name })}
          headerExtra={
            <TimeLimitInput
              branchId={branch.id}
              limit={branch.timeLimit}
              onChange={(limit) => changeLimit(branch.id, limit)}
              ariaLabel={`Time limit for branch ${branch.name || idx + 1}`}
            />
          }
          canMove
          canMoveUp={idx > 0}
          canMoveDown={idx < branches.length - 1}
          onMove={(direction) => moveBranch(branch.id, direction)}
          canDelete
          deleteDisabled={atMinimum}
          deleteDisabledReason={DELETE_BLOCKED}
          onDelete={() => deleteBranch(branch.id)}
        >
          {null}
        </BranchCard>
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
