/**
 * Folder row of a file tree: chevron disclosure, optional tile, name, meta
 * slot, aggregate size, Copy path and the actions slot. Clicking the row
 * selects it; only the chevron toggles it.
 */

import type { ReactNode } from 'react'
import { CopyButton } from '@/components/shared/copy-button'
import { ExpandToggle } from '@/components/shared/expand-toggle'
import {
  ROW_FOCUS_CLASS,
  ROW_SELECTED_CLASS,
  ROW_SIZE_CLASS,
  dataFlag,
  rowIndentPadding,
  selectableRowProps,
} from '@/components/shared/file-row'
import { TruncatedName } from '@/components/shared/truncated-name'
import { cn } from '@/lib/utils'
import { formatBytes } from '@/lib/format-bytes'

export interface FolderRowProps {
  name: string
  expanded: boolean
  onToggle: () => void
  indent: number
  /** Aggregate size of the subtree. */
  sizeBytes: number
  /** Optional leading tile (e.g. the Logs-tree entity icon). */
  icon?: ReactNode
  /** Rendered between the name and the size (e.g. failed / total counts). */
  meta?: ReactNode
  /** WAVE-side reference the Copy path button writes; absent = no button. */
  copyPath?: string
  /** Rendered after Copy path. */
  actions?: ReactNode
  selected?: boolean
  onSelect?: () => void
  onDoubleClick?: () => void
  /** A drag is hovering the row. */
  dropTarget?: boolean
}

const ROW_CLASS = 'flex items-center gap-2 border-b border-subtle py-1.5 pr-4 hover:bg-subtle'
const DROP_TARGET_CLASS = 'bg-primary/5 ring-1 ring-inset ring-primary'

export function FolderRow({
  name,
  expanded,
  onToggle,
  indent,
  sizeBytes,
  icon,
  meta,
  copyPath,
  actions,
  selected = false,
  onSelect,
  onDoubleClick,
  dropTarget = false,
}: Readonly<FolderRowProps>) {
  const interactive = selectableRowProps({ selected, muted: false, onSelect, onDoubleClick })

  return (
    <div
      data-testid="folder-row"
      data-selected={dataFlag(selected)}
      data-drop-target={dataFlag(dropTarget)}
      className={cn(
        ROW_CLASS,
        selected && ROW_SELECTED_CLASS,
        dropTarget && DROP_TARGET_CLASS,
        interactive.tabIndex === 0 && ROW_FOCUS_CLASS
      )}
      style={{ paddingLeft: rowIndentPadding(indent) }}
      {...interactive}
    >
      <ExpandToggle
        expanded={expanded}
        onToggle={onToggle}
        name={name}
        className="h-6 w-6 shrink-0 justify-center rounded hover:bg-muted/20"
      />
      {icon}
      <div className="min-w-0 flex-1 font-medium">
        <TruncatedName value={name} />
      </div>
      {meta}
      <span className={ROW_SIZE_CLASS}>{formatBytes(sizeBytes)}</span>
      <div className="flex shrink-0 items-center gap-1">
        {copyPath !== undefined && <CopyButton value={copyPath} label={name} />}
        {actions}
      </div>
    </div>
  )
}
