/**
 * ConditionBranchEditor - If/Else Control Configuration UI
 *
 * Stacked collapsible branch editor for N-branch conditional routing.
 * Each branch has a type badge, label input, expand/collapse, reorder, and delete controls.
 * If and Else-If branches embed an AssertionBuilder for condition editing.
 */

import { useCallback, useEffect, useRef } from 'react'
import { Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  AssertionBuilder,
  type AssertionItem,
} from './assertion-builder'
import { areAssertionsComplete } from './assertion-builder/tree-helpers'
import { BranchCard, incompleteBranchReason } from './branch-card'
import { withBranchMoved, withoutBranch } from './branch-list-ops'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type BranchType = 'if' | 'else_if' | 'else'

export interface ConditionBranch {
  id: string
  type: BranchType
  label: string
  conditions?: AssertionItem[]
}

export interface ConditionBranchEditorProps {
  branches: ConditionBranch[]
  availableVariables: Array<{ name: string; type: string }>
  onBranchesChange: (branches: ConditionBranch[]) => void
  onValidChange: (valid: boolean) => void
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getDefaultBranches(startId: number): ConditionBranch[] {
  return [
    { id: `branch_${startId}`, type: 'if', label: '', conditions: [] },
    { id: `branch_${startId + 1}`, type: 'else', label: '' },
  ]
}

function getBranchTypeLabel(type: BranchType): string {
  if (type === 'if') return 'IF'
  if (type === 'else_if') return 'ELSE IF'
  return 'ELSE'
}

function getBranchBadgeVariant(type: BranchType): 'warning' | 'info' | 'default' {
  if (type === 'if') return 'warning'
  if (type === 'else_if') return 'info'
  return 'default'
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ConditionBranchEditor({
  branches: externalBranches,
  availableVariables,
  onBranchesChange,
  onValidChange,
}: Readonly<ConditionBranchEditorProps>) {
  const nextIdRef = useRef(0)

  // Initialize nextId from existing branches to avoid collisions
  useEffect(() => {
    let maxId = -1
    for (const branch of externalBranches) {
      const match = /^branch_(\d+)$/.exec(branch.id)
      if (match) {
        maxId = Math.max(maxId, Number.parseInt(match[1], 10))
      }
    }
    nextIdRef.current = maxId + 1
  }, []) // Only run on mount

  // Use external branches or defaults
  const branches =
    externalBranches.length > 0
      ? externalBranches
      : getDefaultBranches(nextIdRef.current)

  // If we used defaults, push them out
  useEffect(() => {
    if (externalBranches.length === 0) {
      const defaults = getDefaultBranches(nextIdRef.current)
      nextIdRef.current += 2
      onBranchesChange(defaults)
    }
  }, []) // Only run on mount

  // Validate: every if/else_if branch must have at least one non-operator assertion
  useEffect(() => {
    const valid = branches.every((branch) => {
      if (branch.type === 'else') return true
      return areAssertionsComplete(branch.conditions ?? [])
    })
    onValidChange(valid)
  }, [branches, onValidChange])

  const updateBranch = useCallback(
    (id: string, update: Partial<ConditionBranch>) => {
      const updated = branches.map((b) =>
        b.id === id ? { ...b, ...update } : b
      )
      onBranchesChange(updated)
    },
    [branches, onBranchesChange]
  )

  const addElseIf = useCallback(() => {
    const currentId = nextIdRef.current
    nextIdRef.current++
    const newBranch: ConditionBranch = {
      id: `branch_${currentId}`,
      type: 'else_if',
      label: '',
      conditions: [],
    }
    // Insert before else (if exists), otherwise append
    const elseIndex = branches.findIndex((b) => b.type === 'else')
    const updated = [...branches]
    if (elseIndex >= 0) {
      updated.splice(elseIndex, 0, newBranch)
    } else {
      updated.push(newBranch)
    }
    onBranchesChange(updated)
  }, [branches, onBranchesChange])

  const addElse = useCallback(() => {
    const currentId = nextIdRef.current
    nextIdRef.current++
    const newBranch: ConditionBranch = {
      id: `branch_${currentId}`,
      type: 'else',
      label: '',
    }
    onBranchesChange([...branches, newBranch])
  }, [branches, onBranchesChange])

  const deleteBranch = useCallback(
    (id: string) => onBranchesChange(withoutBranch(branches, id)),
    [branches, onBranchesChange]
  )

  const moveBranch = useCallback(
    (id: string, direction: 'up' | 'down') =>
      onBranchesChange(withBranchMoved(branches, id, direction)),
    [branches, onBranchesChange]
  )

  const hasElse = branches.some((b) => b.type === 'else')

  return (
    <div className="space-y-2" data-testid="condition-branch-editor">
      {branches.map((branch, idx) => (
        <BranchCard
          key={branch.id}
          branchId={branch.id}
          testIdPrefix="branch"
          badge={
            <Badge
              variant={getBranchBadgeVariant(branch.type)}
              data-testid={`branch-badge-${branch.id}`}
            >
              {getBranchTypeLabel(branch.type)}
            </Badge>
          }
          label={branch.label}
          onLabelChange={(label) => updateBranch(branch.id, { label })}
          alert={
            branch.type === 'else'
              ? undefined
              : incompleteBranchReason(branch.conditions ?? [], 'branch')
          }
          canMove={branch.type === 'else_if'}
          canMoveUp={idx > 1}
          canMoveDown={idx < branches.length - 1 && branches[idx + 1]?.type !== 'else'}
          onMove={(direction) => moveBranch(branch.id, direction)}
          canDelete={branch.type !== 'if'}
          onDelete={() => deleteBranch(branch.id)}
        >
          {branch.type === 'else' ? (
            <p className="text-sm text-muted-foreground italic">
              Catch-all branch - no conditions needed
            </p>
          ) : (
            <AssertionBuilder
              assertions={branch.conditions ?? []}
              availableVariables={availableVariables}
              onAssertionsChange={(conditions) => updateBranch(branch.id, { conditions })}
            />
          )}
        </BranchCard>
      ))}

      {/* Add branch buttons */}
      <div className="flex gap-2 pt-1">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={addElseIf}
          data-testid="add-else-if-button"
        >
          <Plus className="w-3.5 h-3.5 mr-1" />
          Else If
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={addElse}
          disabled={hasElse}
          data-testid="add-else-button"
        >
          <Plus className="w-3.5 h-3.5 mr-1" />
          Else
        </Button>
      </div>
    </div>
  )
}
