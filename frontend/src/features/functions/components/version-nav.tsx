/**
 * VersionNav - grouped, collapsible major-version navigator.
 *
 * Versions are grouped by major (newest major first), each group collapsible.
 * The latest version carries a badge; pre-release versions are muted. Each row
 * shows a per-version usage count and a per-version delete affordance.
 */

import { useMemo, useState } from 'react'
import { ChevronRight, Trash2 } from 'lucide-react'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import type { VersionDescriptor } from '@/features/functions/api/types'

export interface VersionNavProps {
  versions: VersionDescriptor[]
  latest: string
  selected: string
  usageCount: (version: string) => number
  onSelect: (version: string) => void
  onDeleteVersion: (version: string) => void
}

function majorOf(version: string): string {
  return version.split('.')[0]
}

function isPrerelease(version: string): boolean {
  return version.includes('-')
}

export function VersionNav({
  versions,
  latest,
  selected,
  usageCount,
  onSelect,
  onDeleteVersion,
}: Readonly<VersionNavProps>) {
  const groups = useMemo(() => {
    const byMajor = new Map<string, VersionDescriptor[]>()
    for (const version of versions) {
      const major = majorOf(version.version)
      const bucket = byMajor.get(major)
      if (bucket) {
        bucket.push(version)
      } else {
        byMajor.set(major, [version])
      }
    }
    return [...byMajor.entries()].sort((a, b) => Number(b[0]) - Number(a[0]))
  }, [versions])

  // Older majors collapse by default; only the latest version's major opens so
  // the page makes no usage work for groups the user has not looked at. `null`
  // means "untouched" - it resolves to the default each render (latest loads async).
  const latestMajor = majorOf(latest)
  const [openMajors, setOpenMajors] = useState<Set<string> | null>(null)
  const defaultOpen = () => new Set(latestMajor ? [latestMajor] : [])
  const effectiveOpen = openMajors ?? defaultOpen()

  const toggleMajor = (major: string) => {
    setOpenMajors((prev) => {
      const next = new Set(prev ?? defaultOpen())
      if (next.has(major)) {
        next.delete(major)
      } else {
        next.add(major)
      }
      return next
    })
  }

  return (
    <nav aria-label="Versions" className="flex flex-col gap-1">
      <div className="flex items-center px-2 pb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        <span>Versions</span>
        <span className="ml-auto pr-5">Usage</span>
      </div>
      {groups.map(([major, majorVersions]) => {
        const open = effectiveOpen.has(major)
        return (
          <Collapsible key={major} open={open} onOpenChange={() => toggleMajor(major)}>
            <CollapsibleTrigger
              data-testid={`version-major-${major}`}
              className="flex w-full items-center gap-1.5 px-2 py-1 text-xs font-semibold text-muted-foreground uppercase tracking-wide transition-colors hover:text-foreground"
            >
              <ChevronRight className={cn('h-3.5 w-3.5 transition-transform', open && 'rotate-90')} />
              {major}.x
            </CollapsibleTrigger>
            <CollapsibleContent className="flex flex-col gap-0.5 pl-2">
              {majorVersions.map((version) => {
                const isSelected = version.version === selected
                return (
                  <div
                    key={version.version}
                    className={cn(
                      'group/version flex items-center gap-2 rounded-md px-2 py-1',
                      isSelected ? 'bg-muted' : 'hover:bg-muted/50',
                    )}
                  >
                    <button
                      type="button"
                      data-testid={`version-nav-item-${version.version}`}
                      aria-current={isSelected ? 'true' : undefined}
                      onClick={() => onSelect(version.version)}
                      className="flex min-w-0 flex-1 items-center gap-2 text-left text-sm"
                    >
                      <span
                        className={cn(
                          'font-medium tabular-nums',
                          isPrerelease(version.version) && 'text-muted-foreground',
                        )}
                      >
                        {version.version}
                      </span>
                      {version.version === latest && (
                        <Badge variant="info" className="h-5 px-1.5 text-[10px]">
                          Latest
                        </Badge>
                      )}
                      <span className="ml-auto text-xs text-muted-foreground">
                        {usageCount(version.version)}
                      </span>
                    </button>
                    <button
                      type="button"
                      data-testid={`version-delete-${version.version}`}
                      aria-label={`Delete version ${version.version}`}
                      onClick={() => onDeleteVersion(version.version)}
                      className="text-muted-foreground opacity-0 transition-opacity hover:text-error group-hover/version:opacity-100 group-focus-within/version:opacity-100 focus-visible:opacity-100"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                )
              })}
            </CollapsibleContent>
          </Collapsible>
        )
      })}
    </nav>
  )
}
