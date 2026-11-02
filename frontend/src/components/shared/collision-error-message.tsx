import type { ReactNode } from 'react'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'

export interface CollisionEntry {
  variable: string
  this_type: string
  other_name: string
  other_id: string
  other_type: string
}

export interface GroupedCollision {
  variable: string
  thisType: string
  otherType: string
  sources: string[]
}

export function groupCollisions(collisions: CollisionEntry[]): GroupedCollision[] {
  const map = new Map<string, GroupedCollision>()
  for (const c of collisions) {
    const key = `${c.variable}:${c.this_type}:${c.other_type}`
    const existing = map.get(key)
    if (existing) {
      if (!existing.sources.includes(c.other_name)) {
        existing.sources.push(c.other_name)
      }
    } else {
      map.set(key, {
        variable: c.variable,
        thisType: c.this_type,
        otherType: c.other_type,
        sources: [c.other_name],
      })
    }
  }
  return [...map.values()]
}

export function SourceListPopover({
  sources,
  entityLabel,
  testIdPrefix,
}: Readonly<{
  sources: string[]
  entityLabel: string
  testIdPrefix: string
}>): ReactNode {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="underline decoration-dotted underline-offset-2 cursor-pointer hover:decoration-solid"
          data-testid={`collision-${testIdPrefix}-trigger`}
        >
          {sources.length} {entityLabel}s
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-56 p-0" align="start">
        <div className="max-h-48 overflow-y-auto p-2" data-testid={`collision-${testIdPrefix}-list`}>
          <p className="text-xs font-medium text-muted-foreground px-2 py-1">Conflicting {entityLabel}s</p>
          {sources.map((name) => (
            <div
              key={name}
              className="px-2 py-1 text-sm rounded hover:bg-muted"
            >
              {name}
            </div>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  )
}

export function CollisionErrorMessage({
  collisions,
  entityLabel,
  testIdPrefix,
}: Readonly<{
  collisions: CollisionEntry[]
  entityLabel: string
  testIdPrefix: string
}>): ReactNode {
  const groups = groupCollisions(collisions)

  return (
    <div className="space-y-1" data-testid="collision-error">
      <p className="font-medium">Variable type collision</p>
      {groups.map((g) => (
        <p key={`${g.variable}:${g.otherType}`} className="text-sm">
          <code className="text-xs bg-muted px-1 py-0.5 rounded">{g.variable}</code>
          {' '}is <code className="text-xs bg-muted px-1 py-0.5 rounded">{g.thisType}</code>
          {' '}here but <code className="text-xs bg-muted px-1 py-0.5 rounded">{g.otherType}</code>
          {' '}in{' '}
          {g.sources.length === 1
            ? <>{entityLabel} <strong>{g.sources[0]}</strong></>
            : <SourceListPopover sources={g.sources} entityLabel={entityLabel} testIdPrefix={testIdPrefix} />
          }
        </p>
      ))}
    </div>
  )
}
