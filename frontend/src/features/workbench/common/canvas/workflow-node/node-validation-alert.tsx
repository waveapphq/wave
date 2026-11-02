/** Node alert badge: the red misconfiguration badge wins; the amber reveal badge shows only when there are no issues. */

import { AlertTriangle } from 'lucide-react'

import { ConditionalTooltip } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { useWorkflowStore } from '@/features/workbench/stores/workflow-store'
import type { NodeIssue } from '@/features/workbench/lib/validation/compute-node-issues'

interface NodeValidationAlertProps {
  readonly nodeId: string
  readonly pulse: boolean
  /** The block reveals its secrets in run output (amber badge when no issues). */
  readonly revealing?: boolean
}

const REVEAL_LABEL = 'Secrets revealed - shown in cleartext in run logs and reports'

function TooltipBody({ issues }: Readonly<{ issues: NodeIssue[] }>) {
  return (
    <div className="text-left space-y-1 max-w-[320px]">
      <div className="font-semibold">Configuration incomplete</div>
      <ul className="list-disc pl-4 space-y-0.5">
        {issues.map((issue, index) => (
          <li
            key={`${issue.code}-${issue.paramName ?? index}`}
            className={cn('text-xs', issue.severity === 'warning' && 'text-amber-500')}
          >
            {issue.message}
          </li>
        ))}
      </ul>
    </div>
  )
}

function RevealTooltipBody() {
  return (
    <div className="text-left space-y-1 max-w-[320px]">
      <div className="font-semibold">Secrets revealed</div>
      <p className="text-xs">
        This block&apos;s secret values appear in cleartext in run logs and reports.
      </p>
    </div>
  )
}

export function NodeValidationAlert({ nodeId, pulse, revealing = false }: NodeValidationAlertProps) {
  const issues = useWorkflowStore((state) => state.nodeIssues.get(nodeId))

  // PYRUN-14: a warning is listed but never paints the block invalid.
  if (issues?.some((issue) => issue.severity !== 'warning')) {
    return (
      <ConditionalTooltip content={<TooltipBody issues={issues} />} side="top" align="start">
        <button
          type="button"
          aria-label="Configuration incomplete"
          data-testid="node-validation-alert"
          className={cn(
            'inline-flex h-4 w-4 items-center justify-center cursor-help border-0 bg-transparent p-0',
            pulse && 'rounded-full animate-validation-icon-pulse',
          )}
        >
          <AlertTriangle className="h-3.5 w-3.5 text-destructive" strokeWidth={2.5} aria-hidden="true" />
        </button>
      </ConditionalTooltip>
    )
  }

  if (revealing) {
    return (
      <ConditionalTooltip content={<RevealTooltipBody />} side="top" align="start">
        <button
          type="button"
          aria-label={REVEAL_LABEL}
          data-testid="node-reveal-alert"
          className="inline-flex h-4 w-4 items-center justify-center cursor-help border-0 bg-transparent p-0"
        >
          <AlertTriangle className="h-3.5 w-3.5 text-amber-500" strokeWidth={2.5} aria-hidden="true" />
        </button>
      </ConditionalTooltip>
    )
  }

  return null
}
