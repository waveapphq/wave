/**
 * Environment Selector
 *
 * Popover-based environment selector with search, recent environments,
 * all environments list, and a "remember selection" checkbox.
 */

/* v8 ignore next - COV-V8-001 */
import type { ReactNode } from 'react'
import { ChevronDown, Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { SearchInput } from '@/components/ui/search-input'
import { Separator } from '@/components/ui/separator'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Checkbox } from '@/components/ui/checkbox'
import type { Environment } from './types'

interface EnvironmentSelectorProps {
  selectedEnvironment: string | null
  selectedEnvName: string | null
  recentEnvironments: Environment[]
  filteredEnvironments: Environment[]
  rememberSelection: boolean
  envSearch: string
  popoverOpen: boolean
  onPopoverOpenChange: (open: boolean) => void
  onSearchChange: (value: string) => void
  onEnvironmentChange?: (env: string | null) => void
  onRememberSelectionChange?: (remember: boolean) => void
  /** Mirror lock: a watching viewer cannot change the run environment. */
  disabled?: boolean
}

export function EnvironmentSelector({
  selectedEnvironment,
  selectedEnvName,
  recentEnvironments,
  filteredEnvironments,
  rememberSelection,
  envSearch,
  popoverOpen,
  onPopoverOpenChange,
  onSearchChange,
  onEnvironmentChange,
  onRememberSelectionChange,
  disabled,
}: Readonly<EnvironmentSelectorProps>): ReactNode {
  return (
    <Popover open={popoverOpen} onOpenChange={onPopoverOpenChange}>
      <PopoverTrigger asChild>
        <Button
          data-testid="environment-selector"
          variant="outline"
          size="sm"
          disabled={disabled}
          className="h-8 gap-1.5 min-w-[160px] justify-between"
        >
          <span className="text-sm truncate">
            {selectedEnvName || 'Select Environment'}
          </span>
          <ChevronDown className="h-3 w-3 shrink-0" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        data-testid="environment-popover"
        align="end"
        className="w-64 p-0"
      >
        {/* Search */}
        <div className="p-2 border-b border-default">
          <SearchInput
            inputTestId="environment-search"
            size="xs"
            className="w-full"
            placeholder="Search environments…"
            value={envSearch}
            onChange={(e) => onSearchChange(e.target.value)}
          />
        </div>

        <div className="max-h-64 overflow-y-auto">
          {/* Recent */}
          {recentEnvironments.length > 0 && !envSearch && (
            <>
              <div className="px-3 py-2">
                <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Recent
                </div>
              </div>
              <div className="px-1 pb-1">
                {recentEnvironments.map((env) => (
                  <button
                    key={`recent-${env.id}`}
                    data-testid={`env-recent-${env.id}`}
                    onClick={() => {
                      onEnvironmentChange?.(env.id)
                      onPopoverOpenChange(false)
                    }}
                    className="flex w-full items-center justify-between rounded-sm px-2 py-1.5 text-sm hover:bg-muted"
                  >
                    <span>{env.name}</span>
                    {selectedEnvironment === env.id && (
                      <Check className="h-4 w-4 text-primary" />
                    )}
                  </button>
                ))}
              </div>
              <Separator className="my-1" />
            </>
          )}

          {/* All Environments */}
          <div className="px-3 py-2">
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              All Environments
            </div>
          </div>
          <div className="px-1 pb-1">
            {filteredEnvironments.length === 0 ? (
              <div className="px-2 py-4 text-center text-sm text-muted-foreground">
                No environments found
              </div>
            ) : (
              filteredEnvironments.map((env) => (
                <button
                  key={env.id}
                  data-testid={`env-${env.id}`}
                  onClick={() => {
                    onEnvironmentChange?.(env.id)
                    onPopoverOpenChange(false)
                  }}
                  className="flex w-full items-center justify-between rounded-sm px-2 py-1.5 text-sm hover:bg-muted"
                >
                  <span>{env.name}</span>
                  {selectedEnvironment === env.id && (
                    <Check className="h-4 w-4 text-primary" />
                  )}
                </button>
              ))
            )}
          </div>
        </div>

        {/* Remember Selection */}
        <div className="border-t border-default p-2">
          <label className="flex items-center gap-2 cursor-pointer">
            <Checkbox
              data-testid="remember-selection-checkbox"
              checked={rememberSelection}
              onCheckedChange={(checked) =>
                onRememberSelectionChange?.(checked === true)
              }
            />
            <span className="text-sm text-muted-foreground">
              Remember selection
            </span>
          </label>
        </div>
      </PopoverContent>
    </Popover>
  )
}
