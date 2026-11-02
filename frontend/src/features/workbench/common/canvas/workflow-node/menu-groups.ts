import {
  Play,
  Bug,
  Copy,
  Scissors,
  Trash2,
  Circle,
  Ban,
  SkipForward,
  Unlink,
  ArrowDownRight,
  Upload,
  Unplug,
  PencilLine,
  XCircle,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { formatShortcut } from '@/lib/platform'

export type BlockContextMenuAction =
  | 'open'
  | 'edit'
  | 'publish-to-library'
  | 'publish-edit-mode'
  | 'make-local'
  | 'drop-changes'
  | 'run-current'
  | 'run-from-here'
  | 'debug-current'
  | 'debug-from-here'
  | 'toggle-breakpoint'
  | 'duplicate'
  | 'copy'
  | 'cut'
  | 'unlink'
  | 'disable'
  | 'skip'
  | 'delete'

const BLOCKED_AD_HOC_ELEMENT_TYPES = new Set(['break', 'continue', 'note'])

export interface BlockMenuItemDescriptor {
  action: BlockContextMenuAction
  label: string
  icon: React.ComponentType<{ className?: string }>
  iconClassName: string
  dataState?: string
  destructiveClassName?: string
  itemDisabled?: boolean
  shortcutLabel?: string
}

export interface BlockMenuGroupsState {
  hasBreakpoint: boolean
  disabled: boolean
  skipped: boolean
  hasConnections: boolean
  isExecuting?: boolean
  isNodeRunning?: boolean
  elementType?: string
  /** Function nodes only: 'local' = drillable; 'shared' = library reference. */
  functionLifecycle?: 'local' | 'shared'
  /** Shared Function instance: true when the node carries an in-Test draft (REQ-3.1.2.2). */
  editMode?: boolean
  /** Shared Function instance: true when the pinned library version is gone. */
  missingVersion?: boolean
  /** A read-only scope the Workbench can still run (an opened Published Function body). */
  inspectOnly?: boolean
}

/** Whether a node's menu shows at all, and whether it offers only the run and debug items. */
export function resolveMenuAccess(
  readOnly: boolean,
  isExecuting: boolean,
  adHocOffered: boolean,
): { hidden: boolean; inspectOnly: boolean } {
  const idleReadOnly = readOnly && !isExecuting
  return { hidden: idleReadOnly && !adHocOffered, inspectOnly: idleReadOnly && adHocOffered }
}

function buildLifecycleGroup(state: BlockMenuGroupsState): BlockMenuItemDescriptor[] {
  if (state.elementType !== 'function') return []
  const isLocal = state.functionLifecycle !== 'shared'
  const editMode = !!state.editMode
  const missingVersion = !!state.missingVersion

  const group: BlockMenuItemDescriptor[] = [
    {
      action: 'open',
      label: 'Open',
      icon: ArrowDownRight,
      iconClassName: 'h-4 w-4 mr-2 text-emerald-500',
    },
  ]
  if (isLocal) {
    group.push({
      action: 'publish-to-library',
      label: 'Publish to Library',
      icon: Upload,
      iconClassName: 'h-4 w-4 mr-2 text-indigo-500',
    })
    return group
  }
  // Shared: 'Edit' exposes the entry point only when NOT yet in edit mode.
  // Once a draft exists, 'Publish' + 'Drop changes' replace it.
  if (editMode) {
    group.push(
      {
        action: 'publish-edit-mode',
        label: 'Publish',
        icon: Upload,
        iconClassName: 'h-4 w-4 mr-2 text-indigo-500',
      },
      {
        action: 'drop-changes',
        label: 'Drop changes',
        icon: XCircle,
        iconClassName: 'h-4 w-4 mr-2 text-amber-500',
      },
    )
    return group
  }
  group.push(
    {
      action: 'edit',
      label: 'Edit',
      icon: PencilLine,
      iconClassName: 'h-4 w-4 mr-2 text-indigo-500',
      // Cannot snapshot a gone source - edit is disabled when the pinned
      // version no longer exists in the library.
      itemDisabled: missingVersion,
    },
    {
      action: 'make-local',
      label: 'Make Local…',
      icon: Unplug,
      iconClassName: 'h-4 w-4 mr-2 text-amber-500',
      // Missing-version state has no source body to deep-copy.
      itemDisabled: missingVersion,
    },
  )
  return group
}

export function getBlockMenuGroups(state: BlockMenuGroupsState): BlockMenuItemDescriptor[][] {
  const exec = !!state.isExecuting
  const adhocBlocked =
    exec ||
    state.disabled ||
    state.skipped ||
    (state.elementType ? BLOCKED_AD_HOC_ELEMENT_TYPES.has(state.elementType) : false)

  const runGroups: BlockMenuItemDescriptor[][] = [
    [
      { action: 'run-current', label: 'Run Current', icon: Play, iconClassName: 'h-4 w-4 mr-2 text-green-500', itemDisabled: adhocBlocked },
      { action: 'run-from-here', label: 'Run from Here', icon: Play, iconClassName: 'h-4 w-4 mr-2 text-green-500', itemDisabled: adhocBlocked },
    ],
    [
      { action: 'debug-current', label: 'Debug Current', icon: Bug, iconClassName: 'h-4 w-4 mr-2 text-yellow-500', itemDisabled: adhocBlocked },
      { action: 'debug-from-here', label: 'Debug from Here', icon: Bug, iconClassName: 'h-4 w-4 mr-2 text-yellow-500', itemDisabled: adhocBlocked },
      {
        action: 'toggle-breakpoint', label: 'Toggle Breakpoint', icon: Circle,
        iconClassName: cn('h-4 w-4 mr-2 text-red-500', state.hasBreakpoint && 'fill-red-500'),
        dataState: state.hasBreakpoint ? 'checked' : 'unchecked',
      },
    ],
  ]
  if (state.inspectOnly) return runGroups

  const lifecycleGroup = buildLifecycleGroup(state)
  const openGroup: BlockMenuItemDescriptor[][] =
    lifecycleGroup.length > 0 ? [lifecycleGroup] : []
  return [
    ...openGroup,
    ...runGroups,
    [
      { action: 'duplicate', label: 'Duplicate', icon: Copy, iconClassName: 'h-4 w-4 mr-2', shortcutLabel: formatShortcut('D'), itemDisabled: exec },
      { action: 'copy', label: 'Copy', icon: Copy, iconClassName: 'h-4 w-4 mr-2', shortcutLabel: formatShortcut('C'), itemDisabled: exec },
      { action: 'cut', label: 'Cut', icon: Scissors, iconClassName: 'h-4 w-4 mr-2', shortcutLabel: formatShortcut('X'), itemDisabled: exec },
      { action: 'unlink', label: 'Unlink', icon: Unlink, iconClassName: 'h-4 w-4 mr-2', itemDisabled: !state.hasConnections || exec, shortcutLabel: 'Backspace' },
    ],
    [
      { action: 'disable', label: state.disabled ? 'Enable' : 'Disable', icon: Ban, iconClassName: 'h-4 w-4 mr-2', itemDisabled: exec },
      { action: 'skip', label: state.skipped ? 'Unskip' : 'Skip', icon: SkipForward, iconClassName: 'h-4 w-4 mr-2', itemDisabled: state.disabled || !!state.isNodeRunning },
    ],
    [
      { action: 'delete', label: 'Delete', icon: Trash2, iconClassName: 'h-4 w-4 mr-2', destructiveClassName: 'text-destructive focus:text-destructive', shortcutLabel: 'Del', itemDisabled: exec },
    ],
  ]
}
