/**
 * CopyValuesModal Component
 *
 * PROFILE-32: "Copy Values" button
 * PROFILE-44: Search by name or tags
 * PROFILE-45, PROFILE-46: Recommended environments by tag matching
 * PROFILE-48: Other environments section
 */

import * as React from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ConditionalTooltip } from '@/components/ui/tooltip'
import type { Environment } from './types'

interface CopyValuesModalProps {
  open: boolean
  currentEnvId: string
  environments: Environment[]
  /** Function to check if an environment has values */
  hasValues: (envId: string) => boolean
  onClose: () => void
  onConfirm: (sourceEnvId: string) => void
}

export function CopyValuesModal({
  open,
  currentEnvId,
  environments,
  hasValues,
  onClose,
  onConfirm,
}: Readonly<CopyValuesModalProps>) {
  const [sourceEnvId, setSourceEnvId] = React.useState('')
  const [searchQuery, setSearchQuery] = React.useState('')

  // Get current environment's tags for matching
  const currentEnv = environments.find((e) => e.id === currentEnvId)
  const currentEnvTags = currentEnv?.tags ?? []

  // Filter out current environment from source options
  const sourceEnvironments = environments.filter((e) => e.id !== currentEnvId)

  // Filter by search query (matches name or tags - PROFILE-44)
  const filteredEnvironments = sourceEnvironments.filter((env) => {
    const query = searchQuery.toLowerCase()
    return (
      env.name.toLowerCase().includes(query) ||
      env.tags?.some((tag) => tag.toLowerCase().includes(query))
    )
  })

  // Get matching tags between current environment and source environment (PROFILE-46)
  const getMatchingTags = (env: Environment): string[] => {
    if (!currentEnvTags.length || !env.tags?.length) return []
    return env.tags.filter((tag) => currentEnvTags.includes(tag))
  }

  // Count matching tags between current environment and source environment (PROFILE-46)
  const getMatchingTagCount = (env: Environment): number => getMatchingTags(env).length

  // Find max tag match count among environments with values
  const envsWithValues = filteredEnvironments.filter((env) => hasValues(env.id))
  const maxMatchCount = Math.max(0, ...envsWithValues.map(getMatchingTagCount))

  // Separate into:
  // 1. Recommended: has values AND max matching tags (only envs with the highest match count)
  // 2. Other: has values but fewer than max matching tags (or all if no matches)
  // 3. Disabled: no values
  const recommendedEnvs = maxMatchCount > 0
    ? envsWithValues.filter((env) => getMatchingTagCount(env) === maxMatchCount)
    : []
  const otherEnvs = maxMatchCount > 0
    ? envsWithValues
        .filter((env) => getMatchingTagCount(env) < maxMatchCount)
        .sort((a, b) => getMatchingTagCount(b) - getMatchingTagCount(a))
    : envsWithValues // All go to "Other" if no tag matches
  const envsWithoutValues = filteredEnvironments.filter((env) => !hasValues(env.id))

  // Reset state when modal opens
  React.useEffect(() => {
    if (open) {
      setSourceEnvId('')
      setSearchQuery('')
    }
  }, [open])

  const selectedEnv = environments.find((e) => e.id === sourceEnvId)

  if (!open) return null

  return (
    <DialogPrimitive.Root open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-[60] bg-black/80" />
        <DialogPrimitive.Content
          className="fixed left-[50%] top-[50%] z-[60] w-full max-w-sm translate-x-[-50%] translate-y-[-50%] border bg-background p-4 shadow-lg sm:rounded-lg"
        >
          <div className="flex items-center justify-between mb-3">
            <DialogPrimitive.Title className="text-base font-semibold">
              Copy Values From
            </DialogPrimitive.Title>
            <DialogPrimitive.Description className="sr-only">
              Select an environment to copy parameter values from
            </DialogPrimitive.Description>
            <DialogPrimitive.Close asChild>
              <Button variant="ghost" size="sm" aria-label="Close" className="h-6 w-6 p-0">
                <X className="h-4 w-4" />
              </Button>
            </DialogPrimitive.Close>
          </div>

          {/* Search input */}
          <div className="relative mb-3">
            <Input
              placeholder="Search environments…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-8 h-9"
            />
            <svg
              className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground"
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
              />
            </svg>
          </div>

          {/* Environment list */}
          <div className="max-h-64 overflow-y-auto space-y-3 mb-4">
            {/* Recommended section - environments with values AND matching tags (PROFILE-45, PROFILE-46) */}
            {recommendedEnvs.length > 0 && (
              <div className="pb-3">
                <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1.5 px-1">
                  Recommended
                </div>
                <div className="space-y-0.5">
                  {recommendedEnvs.map((env) => {
                    const matchingTags = getMatchingTags(env)
                    const matchCount = matchingTags.length
                    return (
                      <button
                        key={env.id}
                        type="button"
                        onClick={() => setSourceEnvId(env.id)}
                        className={cn(
                          'w-full flex items-center justify-between px-2 py-1.5 rounded text-sm text-left',
                          'hover:bg-accent transition-colors',
                          sourceEnvId === env.id && 'bg-primary text-primary-foreground hover:bg-primary'
                        )}
                      >
                        <span>{env.name}</span>
                        <ConditionalTooltip
                          wide
                          content={
                            <div className="flex flex-wrap gap-1">
                              {matchingTags.map((tag) => (
                                <span key={tag} className="inline-block px-1.5 py-0.5 rounded-sm bg-muted text-muted-foreground text-xs font-medium">
                                  {tag}
                                </span>
                              ))}
                            </div>
                          }
                        >
                          <span
                            className={cn(
                              'text-xs px-1.5 py-0.5 rounded cursor-default',
                              sourceEnvId === env.id
                                ? 'bg-primary-foreground/20 text-primary-foreground'
                                : 'bg-success/20 text-success'
                            )}
                          >
                            {matchCount} {matchCount === 1 ? 'tag matches' : 'tags match'}
                          </span>
                        </ConditionalTooltip>
                      </button>
                    )
                  })}
                </div>
              </div>
            )}

            {/* Other section - environments with values but fewer matching tags (PROFILE-48) */}
            {otherEnvs.length > 0 && (
              <div className={cn(recommendedEnvs.length > 0 && 'pt-3 border-t border-border', 'pb-3')}>
                <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1.5 px-1">
                  Other
                </div>
                <div className="space-y-0.5">
                  {otherEnvs.map((env) => {
                    const matchingTags = getMatchingTags(env)
                    const matchCount = matchingTags.length
                    const badge = (
                      <span
                        className={cn(
                          'text-xs px-1.5 py-0.5 rounded',
                          sourceEnvId === env.id
                            ? 'bg-primary-foreground/20 text-primary-foreground'
                            : 'bg-muted text-muted-foreground'
                        )}
                      >
                        {matchCount} {matchCount === 1 ? 'tag matches' : 'tags match'}
                      </span>
                    )
                    return (
                      <button
                        key={env.id}
                        type="button"
                        onClick={() => setSourceEnvId(env.id)}
                        className={cn(
                          'w-full flex items-center justify-between px-2 py-1.5 rounded text-sm text-left',
                          'hover:bg-accent transition-colors',
                          sourceEnvId === env.id && 'bg-primary text-primary-foreground hover:bg-primary'
                        )}
                      >
                        <span>{env.name}</span>
                        {matchCount > 0 ? (
                          <ConditionalTooltip
                            wide
                            content={
                              <div className="flex flex-wrap gap-1">
                                {matchingTags.map((tag) => (
                                  <span key={tag} className="inline-block px-1.5 py-0.5 rounded bg-muted text-muted-foreground text-xs">
                                    {tag}
                                  </span>
                                ))}
                              </div>
                            }
                          >
                            <span
                              className={cn(
                                'text-xs px-1.5 py-0.5 rounded cursor-default',
                                sourceEnvId === env.id
                                  ? 'bg-primary-foreground/20 text-primary-foreground'
                                  : 'bg-muted text-muted-foreground'
                              )}
                            >
                              {matchCount} {matchCount === 1 ? 'tag matches' : 'tags match'}
                            </span>
                          </ConditionalTooltip>
                        ) : badge}
                      </button>
                    )
                  })}
                </div>
              </div>
            )}

            {/* Disabled section - environments without values */}
            {envsWithoutValues.length > 0 && (
              <div className={(recommendedEnvs.length > 0 || otherEnvs.length > 0) ? 'pt-3 border-t border-border' : ''}>
                <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1.5 px-1">
                  No Values
                </div>
                <div className="space-y-0.5">
                  {envsWithoutValues.map((env) => (
                    <ConditionalTooltip
                      key={env.id}
                      content="Cannot copy from an environment with no values"
                      disabled
                    >
                      <div className="w-full flex items-center justify-between px-2 py-1.5 rounded text-sm text-muted-foreground/50 cursor-not-allowed">
                        <span>{env.name}</span>
                        <span className="text-xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground/50">
                          no values
                        </span>
                      </div>
                    </ConditionalTooltip>
                  ))}
                </div>
              </div>
            )}

            {/* Empty state */}
            {filteredEnvironments.length === 0 && (
              <div className="text-center text-sm text-muted-foreground py-4">
                {searchQuery ? 'No environments match your search' : 'No other environments available'}
              </div>
            )}
          </div>

          {/* Selected environment info */}
          {selectedEnv && (
            <p className="text-xs text-muted-foreground mb-3">
              Copy values from <strong>{selectedEnv.name}</strong> to <strong>{currentEnv?.name}</strong>
            </p>
          )}

          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={onClose}>
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={() => {
                onConfirm(sourceEnvId)
                onClose()
              }}
              disabled={!sourceEnvId}
            >
              Apply
            </Button>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}
