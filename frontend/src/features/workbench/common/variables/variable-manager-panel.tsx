/**
 * VariableManagerPanel Component
 *
 * Collapsible panel for managing workflow variables.
 * Right side of canvas, shows variable definitions and values.
 * Sizing is controlled by the parent ResizablePanel.
 */

import { type ReactNode } from 'react'
import { Variable } from 'lucide-react'
import { CollapsiblePanel } from '@/features/workbench/common/canvas/chrome/collapsible-panel'

interface VariableManagerPanelProps {
  /** Initial collapsed state */
  defaultCollapsed?: boolean
  /** Controlled collapsed state */
  collapsed?: boolean
  /** Callback when collapse state changes */
  onCollapsedChange?: (collapsed: boolean) => void
  /** Panel content */
  children?: ReactNode
  /** Additional class names */
  className?: string
}

export function VariableManagerPanel({
  defaultCollapsed = true,
  collapsed,
  onCollapsedChange,
  children,
  className,
}: Readonly<VariableManagerPanelProps>) {
  return (
    <CollapsiblePanel
      testId="variable-manager"
      title="Variable Manager"
      icon={<Variable className="h-5 w-5" />}
      orientation="vertical"
      position="right"
      defaultCollapsed={defaultCollapsed}
      collapsed={collapsed}
      onCollapsedChange={onCollapsedChange}
      className={className}
    >
      {children}
    </CollapsiblePanel>
  )
}
