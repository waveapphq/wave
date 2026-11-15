/**
 * HistoryVariableManager - history-mode wrapper over
 * `VariableManagerPanel` + `VariableManagerContent`.
 *
 * Receives two views of the run's variable state:
 * - ``variables``: the test's declared variables (type, initial value,
 *   ``isExpression`` / ``isTemplate`` / ``isSecret`` flags). Each row's ``variable.value``
 *   is the literal initial value (or the expression text). The eye-OFF
 *   ("definition") toggle reads this.
 * - ``runtimeValues``: end-of-run values from the snapshot, keyed by
 *   variable id (== name in history mode). The eye-ON ("runtime") toggle
 *   reads this.
 *
 * The redesigned panel renders read-only: Add hidden, Edit pencil + Delete
 * trash disabled, eye stays usable so a reviewer flips between the test's
 * declared value and the actual evaluated outcome. The Unused and OUT badges
 * read the run's canvas the way the live panel reads the open one.
 */

import { useMemo, type ReactNode } from 'react'
import { VariableManagerPanel } from '@/features/workbench/common/variables/variable-manager-panel'
import { VariableManagerContent } from '@/features/workbench/common/variables/variable-manager-content/content'
import type { Variable } from '@/features/workbench/common/variables/variable-manager-content/types'
import type { PanelSlotProps } from '@/features/workbench/common/shell'
import type { HistoricalCanvasVariableDefinition } from '@/features/executions/api/types'
import { useFunctionScope } from '@/features/functions/canvas/use-function-scope'
import { activeFunctionScopeBody, functionScopeRows } from '@/features/workbench/lib/function-scope-rows'
import { scopeBlockUsage, scopeReferencedNames } from '@/features/workbench/lib/variable-usage'
import { useWorkflowStore } from '@/features/workbench/stores/workflow-store'
import { isColumnsRowsDict } from '@/lib/variable-table-model'
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
 * type is inferred from each value (a stored table's {columns, rows} form
 * reads as a table, not a map), only the names the run held secret are
 * secret (a copy the run stored masked is not), the eye-OFF view collapses
 * to the same content as eye-ON, but the panel still renders correctly.
 */
export function buildVariablesFromDefinitions(
  definitions: Record<string, HistoricalCanvasVariableDefinition>,
  runtimeFallback: Record<string, unknown>,
  secretNames: readonly string[],
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
        isTemplate: def.isTemplate || undefined,
        isSecret: def.secret || undefined,
      })
    }
  } else {
    for (const [name, value] of Object.entries(runtimeFallback)) {
      out.push({
        id: name,
        name,
        value,
        type: isColumnsRowsDict(value) ? 'table' : inferRuntimeType(value),
        isSecret: secretNames.includes(name) || undefined,
      })
    }
  }
  return out.toSorted((a, b) => a.name.localeCompare(b.name))
}

/** The runtime values map keyed by variable id (== name); a masked value stays, so its row shows the mask. */
export function buildRuntimeValuesMap(
  runtimeRecord: Record<string, unknown>,
): Map<string, unknown> {
  return new Map(Object.entries(runtimeRecord))
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
  // The same usage scan as the live panel: Unused and OUT read the run's canvas (VMGR-105).
  const blockUsage = useMemo(() => scopeBlockUsage(nodes, drillPath), [nodes, drillPath])
  const referencedNames = useMemo(() => scopeReferencedNames(blockUsage, rows), [blockUsage, rows])
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
        outputBoundVarNames={blockUsage.outputBoundVarNames}
        workflowReferencedVarNames={referencedNames}
        isExecuting={false}
        readOnly
        scope={scope}
      />
    </VariableManagerPanel>
  )
}
