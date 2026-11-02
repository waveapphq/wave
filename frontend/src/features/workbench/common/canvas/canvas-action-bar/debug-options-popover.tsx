/**
 * Debug Options Popover
 *
 * Gear icon popover with debug configuration checkboxes:
 * - Pause on first block
 * - Pause on errors
 *
 * The shape matches the backend payload: ``pause_on_first_block`` /
 * ``pause_on_errors`` camel-cased as ``pauseOnFirstBlock`` / ``pauseOnErrors``.
 * Gear icon renders in the primary (blue) color when either option is
 * enabled (DEBUG-4 / RUN-10).
 */

/* v8 ignore next - COV-V8-001 */
import type { ReactNode } from 'react'
import { Settings2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Checkbox } from '@/components/ui/checkbox'

export interface DebugOptionsValue {
  pauseOnFirstBlock: boolean
  pauseOnErrors: boolean
}

interface DebugOptionsPopoverProps {
  debugOptions: DebugOptionsValue
  onDebugOptionsChange?: (options: DebugOptionsValue) => void
  /** Mirror lock: a watching viewer cannot change debug options. */
  disabled?: boolean
}

export function DebugOptionsPopover({
  debugOptions,
  onDebugOptionsChange,
  disabled,
}: Readonly<DebugOptionsPopoverProps>): ReactNode {
  const anyActive = debugOptions.pauseOnFirstBlock || debugOptions.pauseOnErrors

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          data-testid="debug-options-gear"
          variant="ghost"
          size="sm"
          disabled={disabled}
          className={`h-8 w-8 p-0 ${anyActive ? 'text-primary' : ''}`}
        >
          <Settings2 className="h-4 w-4" />
          <span className="sr-only">Debug Options</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent
        data-testid="debug-options-popover"
        align="start"
        sideOffset={8}
        className="w-56"
      >
        <div className="space-y-3">
          <div className="text-sm font-medium">Debug Options</div>
          <div className="space-y-2">
            <label className="flex items-center gap-2 cursor-pointer">
              <Checkbox
                data-testid="pause-on-first-checkbox"
                checked={debugOptions.pauseOnFirstBlock}
                onCheckedChange={(checked) =>
                  onDebugOptionsChange?.({
                    ...debugOptions,
                    pauseOnFirstBlock: checked === true,
                  })
                }
              />
              <span className="text-sm">Pause on first block</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <Checkbox
                data-testid="pause-on-errors-checkbox"
                checked={debugOptions.pauseOnErrors}
                onCheckedChange={(checked) =>
                  onDebugOptionsChange?.({
                    ...debugOptions,
                    pauseOnErrors: checked === true,
                  })
                }
              />
              <span className="text-sm">Pause on errors</span>
            </label>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}
