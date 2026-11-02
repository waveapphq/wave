/**
 * DebugSplitButton
 *
 * Debug-specific wrapper around the shared ``SplitButton`` primitive. Mirrors
 * the Run split button layout (primary + caret) but uses the "outline" variant
 * and the debug blue accent. Dropdown exposes scope options for "Debug
 * Scope" (the currently-opened block) and "Debug All" (the entire parent test).
 */

import type { ReactNode } from 'react'
import { Bug } from 'lucide-react'
import { SplitButton } from '@/components/shared/split-button'

export interface DebugSplitButtonProps {
  onDebug: (scope: 'current' | 'all', environmentOverride?: string) => void
  selectedEnvironment: string | null
  showCurrentScope: boolean
  disabled: boolean
}

export function DebugSplitButton({
  onDebug,
  selectedEnvironment,
  showCurrentScope,
  disabled,
}: Readonly<DebugSplitButtonProps>): ReactNode {
  const options = [
    ...(showCurrentScope
      ? [
          {
            id: 'current',
            label: 'Debug Scope',
            onClick: () => {
              onDebug('current')
            },
          },
        ]
      : []),
    {
      id: 'all',
      label: 'Debug All',
      onClick: () => {
        onDebug('all')
      },
    },
  ]

  // Primary click always calls onDebug with scope 'current'. When no env is
  // selected the caller (e.g. the canvas action bar) intercepts the call and
  // opens the env-selection dialog instead of dispatching a debug run.
  const handlePrimary = () => {
    onDebug('current')
  }

  return (
    <SplitButton
      label="Debug"
      icon={<Bug className="h-4 w-4" />}
      variant="outline"
      onPrimaryClick={handlePrimary}
      caretDisabled={!selectedEnvironment}
      disabled={disabled}
      testIdPrefix="debug"
      options={options}
    />
  )
}
