/**
 * EnvReadout - read-only `Env: <name>` display rendered in the selector's slot.
 */

import { type ReactNode } from 'react'
import { Button } from '@/components/ui/button'

export interface EnvReadoutProps {
  /** Environment name to display. `null` means "no env recorded". */
  environmentName: string | null
}

export function EnvReadout({ environmentName }: Readonly<EnvReadoutProps>): ReactNode {
  return (
    <Button
      data-testid="environment-selector"
      variant="outline"
      size="sm"
      disabled
      className="h-8 gap-1.5 min-w-[160px] justify-between disabled:opacity-70"
    >
      <span className="text-xs text-muted-foreground">Env:</span>
      <span className="truncate text-sm">{environmentName ?? 'None'}</span>
    </Button>
  )
}
