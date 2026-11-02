/**
 * Environment Selection Dialog
 *
 * Modal dialog shown when the user clicks Run or Debug without an environment selected.
 * Allows searching and selecting an environment before proceeding with the action.
 */

/* v8 ignore next - COV-V8-001 */
import type { ReactNode } from 'react'
import { Play, Bug, Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { SearchInput } from '@/components/ui/search-input'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import type { Environment } from './types'

interface EnvironmentSelectionDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  action: 'run' | 'debug'
  environments: Environment[]
  searchValue: string
  onSearchChange: (value: string) => void
  selectedEnv: string | null
  onSelectEnv: (envId: string) => void
  onConfirm: () => void
}

export function EnvironmentSelectionDialog({
  open,
  onOpenChange,
  action,
  environments,
  searchValue,
  onSearchChange,
  selectedEnv,
  onSelectEnv,
  onConfirm,
}: Readonly<EnvironmentSelectionDialogProps>): ReactNode {
  const filteredEnvironments = environments.filter((env) =>
    env.name.toLowerCase().includes(searchValue.toLowerCase())
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="env-selection-dialog">
        <DialogHeader>
          <DialogTitle>
            {action === 'run' ? 'Run Test' : 'Debug Test'}
          </DialogTitle>
          <DialogDescription>
            Select an environment to {action === 'run' ? 'run' : 'debug'} your test.
          </DialogDescription>
        </DialogHeader>

        {/* Environment Search */}
        <SearchInput
          inputTestId="env-dialog-search"
          size="sm"
          className="w-full"
          placeholder="Search environments…"
          value={searchValue}
          onChange={(e) => onSearchChange(e.target.value)}
        />

        {/* Environment List */}
        <div className="max-h-48 overflow-y-auto border rounded-md">
          {filteredEnvironments.length === 0 ? (
            <div className="px-3 py-4 text-center text-sm text-muted-foreground">
              No environments found
            </div>
          ) : (
            filteredEnvironments.map((env) => (
              <button
                key={env.id}
                data-testid={`env-dialog-${env.id}`}
                onClick={() => onSelectEnv(env.id)}
                className={`flex w-full items-center justify-between px-3 py-2 text-sm hover:bg-muted ${
                  selectedEnv === env.id ? 'bg-muted' : ''
                }`}
              >
                <span>{env.name}</span>
                {selectedEnv === env.id && (
                  <Check className="h-4 w-4 text-primary" />
                )}
              </button>
            ))
          )}
        </div>

        <DialogFooter>
          <Button
            data-testid="env-dialog-cancel"
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            data-testid="env-dialog-confirm"
            variant="default"
            onClick={onConfirm}
            disabled={!selectedEnv}
          >
            {action === 'run' ? (
              <>
                <Play className="h-4 w-4 mr-1.5" />
                Run
              </>
            ) : (
              <>
                <Bug className="h-4 w-4 mr-1.5" />
                Debug
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
