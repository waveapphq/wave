/**
 * LoopTargetSelector - Dropdown for Break/Continue target_loop parameter
 *
 * Traverses the workflow graph to find enclosing loops and renders a
 * Shadcn Select dropdown. Auto-selects the innermost loop when no
 * value is stored.
 *
 * REQ-3.5.1.2: Break current block execution
 * REQ-3.5.1.3: Continue to next iteration
 */

import { useEffect, useMemo } from 'react'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Label } from '@/components/ui/label'
import { useWorkflowStore } from '@/features/workbench/stores/workflow-store'
import { findEnclosingLoops } from '@/features/workbench/lib/find-enclosing-loops'
import { validateLoopTarget } from '@/features/workbench/lib/validate-loop-target'

interface LoopTargetSelectorProps {
  nodeId: string
  value: string
  onChange: (value: string) => void
}

export function LoopTargetSelector({
  nodeId,
  value,
  onChange,
}: Readonly<LoopTargetSelectorProps>) {
  const nodes = useWorkflowStore((s) => s.nodes)
  const edges = useWorkflowStore((s) => s.edges)

  const loopOptions = useMemo(
    () => findEnclosingLoops(nodeId, nodes, edges),
    [nodeId, nodes, edges],
  )

  // Auto-select innermost (last) loop when no value is stored
  useEffect(() => {
    if (!value && loopOptions.length > 0) {
      onChange(loopOptions.at(-1)!.nodeId)
    }
  }, [value, loopOptions, onChange])

  const validation = useMemo(
    () => validateLoopTarget(nodeId, value, nodes, edges),
    [nodeId, value, nodes, edges],
  )

  const hasOptions = loopOptions.length > 0

  return (
    <div className="space-y-2">
      <Label htmlFor="target-loop-select">Target Loop</Label>
      <Select
        value={value || undefined}
        onValueChange={onChange}
        disabled={!hasOptions}
      >
        <SelectTrigger id="target-loop-select">
          <SelectValue
            placeholder={hasOptions ? 'Select target loop…' : 'No loops detected'}
          />
        </SelectTrigger>
        <SelectContent>
          {loopOptions.map((opt) => (
            <SelectItem key={opt.nodeId} value={opt.nodeId}>
              {opt.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {!hasOptions && (
        <p className="text-xs text-destructive">
          This control must be placed inside a loop body
        </p>
      )}
      {hasOptions && value && !validation.valid && validation.error && (
        <p className="text-xs text-destructive">{validation.error}</p>
      )}
    </div>
  )
}
