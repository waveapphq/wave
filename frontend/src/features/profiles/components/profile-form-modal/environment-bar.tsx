/**
 * EnvironmentBar - Environment selector, copy values button, and incomplete warning
 *
 * PROFILE-31: "Environment:" + scrollable dropdown
 * PROFILE-32: "Copy Values" button
 */

import * as React from 'react'
import { ChevronDown, Check as CheckIcon, Copy, AlertTriangle } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { ConditionalTooltip } from '@/components/ui/tooltip'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import {
  Command,
  CommandGroup,
  CommandInput,
  CommandList,
} from '@/components/ui/command'
import type { Environment } from './types'

export interface EnvironmentBarProps {
  environments: Environment[]
  selectedEnvId: string
  selectedEnv: Environment | undefined
  loading: boolean
  parametersCount: number
  environmentHasValues: (envId: string) => boolean
  hasIncompleteEnvironments: boolean
  envsWithoutValues: number

  // Environment selector state
  envSelectOpen: boolean
  setEnvSelectOpen: React.Dispatch<React.SetStateAction<boolean>>
  envSearch: string
  setEnvSearch: React.Dispatch<React.SetStateAction<string>>

  onEnvironmentSelect: (envId: string) => void
  onCopyValuesClick: () => void
}

export function EnvironmentBar({
  environments,
  selectedEnvId,
  selectedEnv,
  loading,
  parametersCount,
  environmentHasValues,
  hasIncompleteEnvironments,
  envsWithoutValues,
  envSelectOpen,
  setEnvSelectOpen,
  envSearch,
  setEnvSearch,
  onEnvironmentSelect,
  onCopyValuesClick,
}: Readonly<EnvironmentBarProps>) {
  return (
    <div className="flex items-center gap-3">
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium">Environment:</span>
        {/* v8 ignore next 3 - COV-BRANCH-193 */}
        <Popover open={envSelectOpen} onOpenChange={(open) => {
          setEnvSelectOpen(open)
          if (!open) setEnvSearch('')
        }}>
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-haspopup="listbox"
              aria-expanded={envSelectOpen}
              aria-controls="env-selector-listbox"
              aria-disabled={loading || environments.length === 0}
              disabled={loading || environments.length === 0}
              data-testid="env-selector"
              className="input flex h-9 w-[180px] items-center justify-between whitespace-nowrap px-3 py-2 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <span className="flex items-center gap-1.5 truncate">
                {selectedEnv && !environmentHasValues(selectedEnv.id) && parametersCount > 0 && (
                  <span className="h-1.5 w-1.5 rounded-full bg-warning flex-shrink-0" />
                )}
                {/* v8 ignore next - COV-BRANCH-194 */}
                {selectedEnv?.name ?? 'Select…'}
              </span>
              <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start" role="dialog">
            <Command shouldFilter={false}>
              <CommandInput
                placeholder="Search environment…"
                value={envSearch}
                onValueChange={setEnvSearch}
              />
              <CommandList role="listbox" id="env-selector-listbox">
                <CommandGroup>
                  {[...environments]
                    .filter((env) => env.name.toLowerCase().includes(envSearch.toLowerCase()))
                    .sort((a, b) => a.name.localeCompare(b.name))
                    .map((env) => {
                    const hasValues = environmentHasValues(env.id)
                    const showWarning = !hasValues && parametersCount > 0
                    return (
                      <button
                        type="button"
                        key={env.id}
                        onClick={() => onEnvironmentSelect(env.id)}
                        className="relative flex w-full cursor-default select-none items-center rounded-sm px-2 py-1.5 text-sm text-left outline-none hover:bg-accent hover:text-accent-foreground"
                      >
                        <CheckIcon
                          className={cn(
                            'mr-2 h-4 w-4 flex-shrink-0',
                            selectedEnvId === env.id ? 'opacity-100' : 'opacity-0'
                          )}
                        />
                        <span className="flex items-center gap-1.5 flex-1">
                          {env.name}
                          {showWarning && (
                            <ConditionalTooltip content="No values configured">
                              <span className="ml-auto flex-shrink-0">
                                <span
                                  className="h-1.5 w-1.5 rounded-full bg-warning inline-block"
                                  data-testid={`env-warning-${env.id}`}
                                />
                              </span>
                            </ConditionalTooltip>
                          )}
                        </span>
                      </button>
                    )
                  })}
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
      </div>

      {/* Warning indicator for incomplete environments */}
      {hasIncompleteEnvironments && (
        <ConditionalTooltip
          content={`${envsWithoutValues} ${envsWithoutValues === 1 ? 'environment has' : 'environments have'} no values configured`}
        >
          <span className="inline-flex items-center gap-1 text-warning text-sm" data-testid="environments-incomplete-warning">
            <AlertTriangle className="h-4 w-4" />
            <span className="text-xs">{envsWithoutValues} unset</span>
          </span>
        </ConditionalTooltip>
      )}

      <Button
        type="button"
        variant="link"
        onClick={onCopyValuesClick}
        disabled={loading || environments.length < 2}
        className="text-primary p-0 h-auto"
      >
        <Copy className="mr-1 h-3.5 w-3.5" />
        Copy Values
      </Button>
    </div>
  )
}
