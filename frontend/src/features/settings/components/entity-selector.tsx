/**
 * EntitySelector Component
 *
 * Reusable checkbox grid for selecting entity types in backup operations.
 */

import { useId } from 'react'
import { Checkbox } from '@/components/ui/checkbox'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'

// ============================================================================
// Constants
// ============================================================================

export const BACKUP_ENTITY_TYPES = [
  'tests',
  'environments',
  'profiles',
  'suites',
  'regressions',
  'functions',
  'system_variables',
  'ssh_hosts',
  'certificates',
] as const

const ENTITY_TYPE_LABELS: Record<string, string> = {
  system_variables: 'System Variables',
  ssh_hosts: 'SSH Hosts',
  certificates: 'Additional Certificates',
}

/** The name a backup entity type is shown under. */
export function entityTypeLabel(entityType: string): string {
  return ENTITY_TYPE_LABELS[entityType] ?? entityType
}

// ============================================================================
// Types
// ============================================================================

export interface EntitySelectorProps {
  selected: string[]
  onChange: (selected: string[]) => void
  className?: string
  disabled?: boolean
}

// ============================================================================
// Component
// ============================================================================

export function EntitySelector({
  selected,
  onChange,
  className,
  disabled = false,
}: Readonly<EntitySelectorProps>) {
  const selectorId = useId()

  const handleToggle = (entityType: string) => {
    if (selected.includes(entityType)) {
      onChange(selected.filter((t) => t !== entityType))
    } else {
      onChange([...selected, entityType])
    }
  }

  const handleSelectAll = () => {
    onChange([...BACKUP_ENTITY_TYPES])
  }

  const handleDeselectAll = () => {
    onChange([])
  }

  return (
    <div data-testid="entity-selector" className={className}>
      <div className="flex items-center gap-2 mb-3">
        <Button
          variant="link"
          size="sm"
          onClick={handleSelectAll}
          disabled={disabled}
          className="h-auto p-0 text-xs"
        >
          Select all
        </Button>
        <span aria-hidden="true" className="text-muted-foreground text-xs">/</span>
        <Button
          variant="link"
          size="sm"
          onClick={handleDeselectAll}
          disabled={disabled}
          className="h-auto p-0 text-xs"
        >
          Deselect all
        </Button>
      </div>
      <div className="grid grid-cols-3 gap-3">
        {BACKUP_ENTITY_TYPES.map((entityType) => {
          const checkboxId = `${selectorId}-${entityType}`
          return (
            <div
              key={entityType}
              data-testid={`entity-item-${entityType}`}
              className="flex items-center gap-2"
            >
              <Checkbox
                id={checkboxId}
                data-testid={`entity-checkbox-${entityType}`}
                checked={selected.includes(entityType)}
                disabled={disabled}
                onCheckedChange={() => handleToggle(entityType)}
              />
              <Label htmlFor={checkboxId} className="text-sm capitalize">
                {entityTypeLabel(entityType)}
              </Label>
            </div>
          )
        })}
      </div>
    </div>
  )
}
