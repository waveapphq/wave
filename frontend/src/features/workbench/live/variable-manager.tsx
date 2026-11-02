/**
 * LiveVariableManager - live-mode wrapper around `VariableManagerPanel`
 * + `VariableManagerContent`.
 *
 * Forwards every variable CRUD / watch / expression handler the live
 * container assembles. The shell owns `collapsed` / `onCollapsedChange`
 * and feeds them in via render-prop.
 */

import { VariableManagerContent } from '@/features/workbench/common/variables/variable-manager-content/content'
import { VariableManagerPanel } from '@/features/workbench/common/variables/variable-manager-panel'
import type { VariableManagerContentProps } from '@/features/workbench/common/variables/variable-manager-content/types'
import type { PanelSlotProps } from '@/features/workbench/common/shell'
import { useReadOnlyCanvas } from '@/features/workbench/common/canvas/use-readonly-canvas'

export type LiveVariableManagerProps = VariableManagerContentProps & PanelSlotProps

export function LiveVariableManager({
  collapsed,
  onCollapsedChange,
  readOnly,
  onVariableCurrentEdit,
  ...contentProps
}: Readonly<LiveVariableManagerProps>) {
  // A drilled-into-Shared scope (library View or in-Test inspect) is read-only:
  // the scope flag drives the panel so the +Add affordance is hidden even when
  // the caller did not flag readOnly. A mirroring viewer is read-only too.
  const readOnlyScope = useReadOnlyCanvas()
  // A Current value is run state, so a read-only scope still sets it; a mirroring viewer does not (REQ-3.1.2.10).
  const currentEdit = readOnly ? undefined : onVariableCurrentEdit
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
        {...contentProps}
        readOnly={readOnlyScope || Boolean(readOnly)}
        onVariableCurrentEdit={currentEdit}
      />
    </VariableManagerPanel>
  )
}
