/**
 * CollisionResolutionModal - Shared modal for variable type collision errors.
 *
 * Used by both suites (test membership collisions) and regressions
 * (cross-regression collisions). Takes pre-grouped collision data and
 * an optional fix action.
 */

import type { ReactNode } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { AlertTriangle } from 'lucide-react'
import { EntityListPopover } from '@/components/shared/entity-list-popover'

export interface GroupedCollision {
  variable: string
  thisType: string
  otherType: string
  entities: string[]
}

export interface CollisionFixAction {
  buttonLabel: string
  items: Array<{ id: string; name: string }>
  onFix: (ids: string[]) => void
}

export interface CollisionResolutionModalProps {
  open: boolean
  onClose: () => void
  description: string
  /** Label for the conflicting entity type ("suite", "regression") */
  entityLabel: string
  conflicts: GroupedCollision[]
  /** Optional fix action with items to remove */
  fixAction?: CollisionFixAction
}

function CollisionEntitiesPopover({ entities, label }: Readonly<{ entities: string[]; label: string }>): ReactNode {
  return (
    <EntityListPopover
      triggerLabel={`${entities.length} ${label}s`}
      entities={entities.map((name) => ({ id: name, name }))}
      label={`Conflicting ${label}s`}
      testId="collision-entities"
    />
  )
}

export function CollisionResolutionModal({
  open,
  onClose,
  description,
  entityLabel,
  conflicts,
  fixAction,
}: Readonly<CollisionResolutionModalProps>): ReactNode {
  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose() }}>
      <DialogContent className="sm:max-w-lg" data-testid="collision-resolution-modal">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-destructive" />
            Variable type collision
          </DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <div className="max-h-64 overflow-y-auto space-y-3 py-2" data-testid="collision-details">
          <div className="space-y-1.5">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Conflicts</p>
            {conflicts.map((g) => (
              <div
                key={`${g.variable}:${g.otherType}`}
                className="rounded-md border p-2.5 text-sm"
              >
                <code className="text-xs bg-muted px-1 py-0.5 rounded">{g.variable}</code>
                {' '}is <code className="text-xs bg-muted px-1 py-0.5 rounded">{g.thisType}</code>
                {' '}here but <code className="text-xs bg-muted px-1 py-0.5 rounded">{g.otherType}</code>
                {' '}in{' '}
                {g.entities.length === 1
                  ? <>{entityLabel} <strong>{g.entities[0]}</strong></>
                  : <CollisionEntitiesPopover entities={g.entities} label={entityLabel} />
                }
              </div>
            ))}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} data-testid="collision-cancel">
            {fixAction ? 'Cancel' : 'OK'}
          </Button>
          {fixAction && (
            <Button
              variant="default"
              onClick={() => fixAction.onFix(fixAction.items.map((i) => i.id))}
              data-testid="collision-fix"
            >
              {fixAction.buttonLabel}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
