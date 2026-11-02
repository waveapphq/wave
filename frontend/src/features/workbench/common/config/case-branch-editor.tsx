/**
 * CaseBranchEditor - Switch/Case Control Configuration UI
 *
 * Stacked case cards with a per-case Break switch in the header, plus an
 * optional trailing DEFAULT card - the last stop of the fall-through chain.
 */

import { useCallback, useEffect } from 'react'
import { Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { AssertionBuilder, type AssertionItem } from './assertion-builder'
import { areAssertionsComplete } from './assertion-builder/tree-helpers'
import { BranchCard, incompleteBranchReason } from './branch-card'
import { nextBranchId, withBranchMoved, withoutBranch } from './branch-list-ops'

export type CaseBranchType = 'case' | 'default'

export interface CaseBranch {
  id: string
  type: CaseBranchType
  label: string
  conditions?: AssertionItem[]
  break?: boolean
}

export interface CaseBranchEditorProps {
  branches: CaseBranch[]
  availableVariables: Array<{ name: string; type: string }>
  onBranchesChange: (branches: CaseBranch[]) => void
  onValidChange: (valid: boolean) => void
}

function newCase(id: string): CaseBranch {
  return { id, type: 'case', label: '', conditions: [], break: true }
}

export function CaseBranchEditor({
  branches: externalBranches,
  availableVariables,
  onBranchesChange,
  onValidChange,
}: Readonly<CaseBranchEditorProps>) {
  const branches = externalBranches.length > 0 ? externalBranches : [newCase('branch_0')]

  // A fresh Switch starts with one case; push that seed up so Save persists it.
  useEffect(() => {
    if (externalBranches.length === 0) onBranchesChange([newCase('branch_0')])
  }, []) // Only run on mount

  useEffect(() => {
    onValidChange(
      branches.every(
        (branch) =>
          branch.type === 'default' || areAssertionsComplete(branch.conditions ?? []),
      ),
    )
  }, [branches, onValidChange])

  const updateBranch = useCallback(
    (id: string, update: Partial<CaseBranch>) => {
      onBranchesChange(branches.map((b) => (b.id === id ? { ...b, ...update } : b)))
    },
    [branches, onBranchesChange],
  )

  const addCase = useCallback(() => {
    const entry = newCase(nextBranchId(branches, 0))
    const defaultIndex = branches.findIndex((b) => b.type === 'default')
    const updated = [...branches]
    if (defaultIndex >= 0) updated.splice(defaultIndex, 0, entry)
    else updated.push(entry)
    onBranchesChange(updated)
  }, [branches, onBranchesChange])

  const addDefault = useCallback(() => {
    onBranchesChange([
      ...branches,
      { id: nextBranchId(branches, 0), type: 'default', label: '' },
    ])
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

  const caseCount = branches.filter((b) => b.type === 'case').length
  const hasDefault = branches.some((b) => b.type === 'default')

  return (
    <div className="space-y-2" data-testid="case-branch-editor">
      {branches.map((branch, idx) => {
        if (branch.type === 'default') {
          return (
            <BranchCard
              key={branch.id}
              branchId={branch.id}
              testIdPrefix="default"
              noun="default"
              badge={
                <Badge variant="default" data-testid={`default-badge-${branch.id}`}>
                  DEFAULT
                </Badge>
              }
              label={branch.label}
              onLabelChange={(label) => updateBranch(branch.id, { label })}
              canMove={false}
              canMoveUp={false}
              canMoveDown={false}
              onMove={() => undefined}
              canDelete
              onDelete={() => deleteBranch(branch.id)}
            >
              <p className="text-sm text-muted-foreground italic">
                Runs when no case matched, or when a case above falls through
              </p>
            </BranchCard>
          )
        }

        const caseIndex = branches.filter((b, i) => b.type === 'case' && i < idx).length
        return (
          <BranchCard
            key={branch.id}
            branchId={branch.id}
            testIdPrefix="case"
            noun="case"
            badge={
              <Badge variant="warning" data-testid={`case-badge-${branch.id}`}>
                CASE
              </Badge>
            }
            label={branch.label}
            onLabelChange={(label) => updateBranch(branch.id, { label })}
            headerExtra={
              <>
                <Label htmlFor={`case-break-${branch.id}`} className="cursor-pointer text-xs">
                  Break
                </Label>
                <Switch
                  id={`case-break-${branch.id}`}
                  data-testid={`case-break-${branch.id}`}
                  checked={branch.break !== false}
                  onCheckedChange={(checked) => updateBranch(branch.id, { break: checked })}
                  aria-label="Break"
                />
              </>
            }
            alert={incompleteBranchReason(branch.conditions ?? [], 'case')}
            canMove
            canMoveUp={caseIndex > 0}
            canMoveDown={caseIndex < caseCount - 1}
            onMove={(direction) => moveBranch(branch.id, direction)}
            canDelete
            deleteDisabled={caseCount === 1}
            onDelete={() => deleteBranch(branch.id)}
          >
            <AssertionBuilder
              assertions={branch.conditions ?? []}
              availableVariables={availableVariables}
              onAssertionsChange={(conditions) => updateBranch(branch.id, { conditions })}
            />
          </BranchCard>
        )
      })}

      <div className="flex gap-2 pt-1">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={addCase}
          data-testid="add-case-button"
        >
          <Plus className="w-3.5 h-3.5 mr-1" />
          Case
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={addDefault}
          disabled={hasDefault}
          className={hasDefault ? 'opacity-50 cursor-not-allowed' : undefined}
          data-testid="add-default-button"
        >
          <Plus className="w-3.5 h-3.5 mr-1" />
          Default
        </Button>
      </div>
    </div>
  )
}
