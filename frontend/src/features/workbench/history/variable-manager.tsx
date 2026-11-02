/**
 * HistoryVariableManager - history-mode wrapper over
 * `VariableManagerPanel` + `VariableManagerContent`.
 *
 * Receives two views of the run's variable state:
 * - ``variables``: the test's declared variables (type, initial value,
 *   ``isExpression`` / ``isSecret`` flags). Each row's ``variable.value``
 *   is the literal initial value (or the expression text). The eye-OFF
 *   ("definition") toggle reads this.
 * - ``runtimeValues``: end-of-run values from the snapshot, keyed by
 *   variable id (== name in history mode). The eye-ON ("runtime") toggle
 *   reads this.
 *
 * The redesigned panel renders read-only: Add hidden, Edit pencil + Delete
 * trash disabled, eye stays usable so a reviewer flips between the test's
 * declared value and the actual evaluated outcome.
 */

import { useMemo, type ReactNode } from 'react'
import { VariableManagerPanel } from '@/features/workbench/common/variables/variable-manager-panel'
import { VariableManagerContent } from '@/features/workbench/common/variables/variable-manager-content/content'
import type { Variable } from '@/features/workbench/common/variables/variable-manager-content/types'
import type { PanelSlotProps } from '@/features/workbench/common/shell'
import type { HistoricalCanvasVariableDefinition } from '@/features/executions/api/types'
import { MASK_PLACEHOLDER } from '@/lib/secret-envelope'
import { useFunctionScope } from '@/features/functions/canvas/use-function-scope'
import { activeFunctionScopeBody, functionScopeRows } from '@/features/workbench/lib/function-scope-rows'
import { useWorkflowStore } from '@/features/workbench/stores/workflow-store'
import { inferRuntimeType } from '@/lib/variable-validation'

function isVariableType(value: string): value is Variable['type'] {
  return (
    value === 'string' ||
    value === 'integer' ||
    value === 'float' ||
    value === 'boolean' ||
    value === 'array' ||
    value === 'map' ||
    value === 'table'
  )
}

/**
 * Build the panel's ``Variable[]`` from the test definition. Each row's
 * ``value`` carries the declared initial (or the expression source for
 * ``isExpression``), so the eye-OFF view shows what the test author
 * actually wrote.
 *
 * When the source test was deleted after the run, the BE returns an empty
 * ``variable_definitions`` and we fall back to the runtime snapshot:
 * type is inferred from each value, the eye-OFF view collapses to the
 * same content as eye-ON, but the panel still renders correctly.
 */
export function buildVariablesFromDefinitions(
  definitions: Record<string, HistoricalCanvasVariableDefinition>,
  runtimeFallback: Record<string, unknown>,
): Variable[] {
  const out: Variable[] = []
  if (Object.keys(definitions).length > 0) {
    for (const [name, def] of Object.entries(definitions)) {
      out.push({
        id: name,
        name,
        value: def.value,
        type: isVariableType(def.type) ? def.type : inferRuntimeType(def.value),
        isExpression: def.isExpression || undefined,
        isSecret: def.secret || undefined,
      })
    }
  } else {
    for (const [name, value] of Object.entries(runtimeFallback)) {
      out.push({
        id: name,
        name,
        value,
        type: inferRuntimeType(value),
        isSecret: value === MASK_PLACEHOLDER || undefined,
      })
    }
  }
  return out.toSorted((a, b) => a.name.localeCompare(b.name))
}

/**
 * Build the runtime values map keyed by variable id (== name). Entries
 * with the masked placeholder are dropped because secrets render via the
 * row's ``isSecret`` path, not the runtime overlay.
 */
export function buildRuntimeValuesMap(
  runtimeRecord: Record<string, unknown>,
): Map<string, unknown> {
  const map = new Map<string, unknown>()
  for (const [name, value] of Object.entries(runtimeRecord)) {
    if (value === MASK_PLACEHOLDER) continue
    map.set(name, value)
  }
  return map
}

export interface HistoryVariableManagerProps extends PanelSlotProps {
  variables: Variable[]
  runtimeValues: Map<string, unknown>
}

export function HistoryVariableManager({
  collapsed,
  onCollapsedChange,
  variables,
  runtimeValues,
}: Readonly<HistoryVariableManagerProps>): ReactNode {
  // Drilled into a Function, the panel shows that Function's own scope, as the live one does.
  const nodes = useWorkflowStore((state) => state.nodes)
  const drillPath = useWorkflowStore((state) => state.drillPath)
  const scope = useFunctionScope()
  const rows = useMemo(
    () => (drillPath.length === 0 ? variables : functionScopeRows(activeFunctionScopeBody(nodes, drillPath))),
    [variables, nodes, drillPath],
  )
  return (
    <VariableManagerPanel
      collapsed={collapsed}
      onCollapsedChange={onCollapsedChange}
      className={
        /* v8 ignore next - COV-BRANCH-176 */
        collapsed ? 'w-16' : undefined
      }
    >
      <VariableManagerContent
        variables={rows}
        runtimeValues={runtimeValues}
        isExecuting={false}
        readOnly
        scope={scope}
      />
    </VariableManagerPanel>
  )
}
