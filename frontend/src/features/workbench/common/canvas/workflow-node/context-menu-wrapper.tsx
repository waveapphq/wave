/**
 * Right-click context menu for workflow nodes.
 * Mirrors the kebab menu items (CANVAS-39).
 */

import { Fragment } from 'react'
import {
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
} from '@/components/ui/context-menu'
import type { BlockContextMenuAction } from './menu-groups'

interface MenuItem {
  action: BlockContextMenuAction
  destructiveClassName?: string
  dataState?: string
  itemDisabled?: boolean
  icon: React.ComponentType<{ className?: string }>
  iconClassName?: string
  label: string
  shortcutLabel?: string
}

interface NodeContextMenuContentProps {
  menuGroups: MenuItem[][]
  onAction: (action: BlockContextMenuAction) => void
}

/** Context menu content rendered inside ContextMenu wrapper */
export function NodeContextMenuContent({ menuGroups, onAction }: Readonly<NodeContextMenuContentProps>) {
  return (
    <ContextMenuContent className="w-48">
      {menuGroups.map((group, gi) => {
        const groupKey = `group-${gi}`
        return (
        <Fragment key={groupKey}>
          {gi > 0 && <ContextMenuSeparator />}
          {group.map((item) => (
            <ContextMenuItem
              key={item.action}
              onClick={() => onAction(item.action)}
              className={item.destructiveClassName}
              data-state={item.dataState}
              disabled={item.itemDisabled}
            >
              <item.icon className={item.iconClassName} />
              {item.label}
              {item.shortcutLabel && (
                <span aria-hidden="true" className="ml-auto pl-4 text-xs text-muted-foreground">{item.shortcutLabel}</span>
              )}
            </ContextMenuItem>
          ))}
        </Fragment>
      )})}
    </ContextMenuContent>
  )
}
