/**
 * One file row shared by the artifact drill sections, the artifact tree, the
 * Session Artifacts sheet, the Test Data tree and the file reference picker.
 *
 * A live row shows a file-type tile (or a supplied entity icon), the name over
 * an optional subtitle, the formatted size and its actions: Copy path, then
 * Download and Delete (each hidden when its handler is absent), then the
 * trailing slot. A removed (tombstone) row is muted with a struck name, a
 * "Removed ..." audit tag, the size and no actions.
 */

import type { HTMLAttributes, KeyboardEvent, ReactNode } from 'react'
import {
  Download,
  Trash2,
  AlertTriangle,
  FileArchive,
  FileCode,
  FileCode2,
  FileImage,
  FileJson,
  FileSpreadsheet,
  FileText,
  type LucideIcon,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { CopyButton } from '@/components/shared/copy-button'
import { TruncatedName } from '@/components/shared/truncated-name'
import { cn } from '@/lib/utils'
import { formatBytes } from '@/lib/format-bytes'

export type FileIconKind =
  | 'error'
  | 'json'
  | 'html'
  | 'spreadsheet'
  | 'code'
  | 'text'
  | 'image'
  | 'archive'
  | 'doc'

// TDATA-11 buckets, keyed by the last extension.
const EXTENSION_KINDS = new Map<string, FileIconKind>([
  ['json', 'json'],
  ['html', 'html'],
  ['htm', 'html'],
  ['csv', 'spreadsheet'],
  ['xlsx', 'spreadsheet'],
  ['xlsm', 'spreadsheet'],
  ['xls', 'spreadsheet'],
  ['xml', 'code'],
  ['yaml', 'code'],
  ['yml', 'code'],
  ['py', 'code'],
  ['sh', 'code'],
  ['js', 'code'],
  ['ts', 'code'],
  ['txt', 'text'],
  ['log', 'text'],
  ['md', 'text'],
  ['png', 'image'],
  ['jpg', 'image'],
  ['jpeg', 'image'],
  ['gif', 'image'],
  ['svg', 'image'],
  ['zip', 'archive'],
  ['tar', 'archive'],
  ['gz', 'archive'],
  ['tgz', 'archive'],
])

/** File-type bucket for the row tile, by extension (error.json special). */
export function fileIconKind(name: string): FileIconKind {
  const lower = name.toLowerCase()
  if (lower === 'error.json') {
    return 'error'
  }
  const dot = lower.lastIndexOf('.')
  if (dot < 0) {
    return 'doc'
  }
  return EXTENSION_KINDS.get(lower.slice(dot + 1)) ?? 'doc'
}

export interface FileRowProps {
  name: string
  sizeBytes: number
  indent?: number
  removed?: boolean
  removedAt?: string
  removedBy?: string
  /** Leading icon override (e.g. the Logs-tree test-tube); defaults to the file-type icon. */
  icon?: ReactNode
  /** Secondary line under the name: a description, or the file path in flat mode. */
  subtitle?: string
  subtitleMono?: boolean
  /** WAVE-side reference the Copy path button writes; absent = no button. */
  copyPath?: string
  /** Optional: when absent the download button is not rendered (pick mode). */
  onDownload?: () => void
  /** Optional: when absent the delete button is not rendered (tracked sessions). */
  onDelete?: () => void
  /** Rendered after the built-in actions (the kebab slot). */
  trailingActions?: ReactNode
  selected?: boolean
  /** Visible but not selectable and out of the tab order (folder-mode picker). */
  muted?: boolean
  onSelect?: () => void
  onDoubleClick?: () => void
}

const INDENT_STEP_REM = 1.25
const ROW_BASE_REM = 1
const ROW_CLASS =
  'flex items-center gap-3 border-b border-subtle py-2 pr-4 last:border-b-0 hover:bg-subtle'
const NAME_CLASS = 'font-mono text-[13px] font-semibold'

/** Size column shared by the file and folder rows. */
export const ROW_SIZE_CLASS = 'shrink-0 min-w-[3.5rem] text-right text-xs tabular-nums text-muted'
/** Tint of a selected file or folder row. */
export const ROW_SELECTED_CLASS = 'bg-primary/10'
/** Focus ring of a selectable row. */
export const ROW_FOCUS_CLASS =
  'cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary'
const ROW_MUTED_CLASS = 'opacity-50 cursor-not-allowed'

/** Left padding of a tree row at the given depth. */
export function rowIndentPadding(indent: number): string {
  return `${ROW_BASE_REM + indent * INDENT_STEP_REM}rem`
}

/** Value of a boolean `data-*` marker: present as "true" or absent. */
export function dataFlag(on: boolean | undefined): 'true' | undefined {
  return on ? 'true' : undefined
}

export interface SelectableRowOptions {
  selected: boolean
  muted: boolean
  onSelect?: () => void
  onDoubleClick?: () => void
}

/** Interactive attributes of a tree row; empty for a plain listing row. */
export function selectableRowProps({
  selected,
  muted,
  onSelect,
  onDoubleClick,
}: SelectableRowOptions): HTMLAttributes<HTMLDivElement> {
  if (!onSelect && !onDoubleClick) {
    return {}
  }
  if (muted) {
    return { role: 'treeitem' }
  }
  // Keyboard activation belongs to the tree that owns the row (its mode decides Enter).
  return {
    role: 'treeitem',
    tabIndex: 0,
    'aria-selected': selected,
    onClick: onSelect,
    onDoubleClick,
  }
}

/** Enter on a tree row: the row nearest the key wins, never the folder above it. */
export function rowEnterHandler(action: (() => void) | undefined) {
  return (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Enter') return
    event.preventDefault()
    event.stopPropagation()
    action?.()
  }
}

const FILE_ICONS: Record<FileIconKind, { Icon: LucideIcon; className: string }> = {
  error: { Icon: AlertTriangle, className: 'bg-error/10 text-error' },
  json: { Icon: FileJson, className: 'bg-primary/10 text-primary' },
  html: { Icon: FileCode, className: 'bg-warning/10 text-warning' },
  spreadsheet: { Icon: FileSpreadsheet, className: 'bg-info/10 text-info' },
  code: { Icon: FileCode2, className: 'bg-success/10 text-success' },
  text: { Icon: FileText, className: 'bg-muted/20 text-muted' },
  image: { Icon: FileImage, className: 'bg-primary/10 text-primary' },
  archive: { Icon: FileArchive, className: 'bg-warning/10 text-warning' },
  doc: { Icon: FileText, className: 'bg-muted/20 text-muted' },
}

function FileTypeIcon({ name }: Readonly<{ name: string }>) {
  const kind = fileIconKind(name)
  const { Icon, className } = FILE_ICONS[kind]
  return (
    <span
      data-testid="artifact-file-icon"
      data-file-kind={kind}
      className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-md', className)}
      aria-hidden="true"
    >
      <Icon className="h-4 w-4" />
    </span>
  )
}

function removedLabel(removedAt?: string, removedBy?: string): string {
  const datePart = removedAt ? ` ${new Date(removedAt).toLocaleDateString()}` : ''
  const byPart = removedBy ? ` · ${removedBy}` : ''
  return `Removed${datePart}${byPart}`
}

interface RemovedFileRowProps {
  name: string
  sizeBytes: number
  paddingLeft: string
  icon: ReactNode
  removedAt?: string
  removedBy?: string
}

function RemovedFileRow({
  name,
  sizeBytes,
  paddingLeft,
  icon,
  removedAt,
  removedBy,
}: Readonly<RemovedFileRowProps>) {
  return (
    <div data-testid="file-row" className={cn(ROW_CLASS, 'opacity-60')} style={{ paddingLeft }}>
      {icon}
      <TruncatedName value={name} textClassName={cn(NAME_CLASS, 'line-through')} />
      <span className="shrink-0 rounded border border-strong px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-muted">
        {removedLabel(removedAt, removedBy)}
      </span>
      <span className="flex-1" />
      <span className={ROW_SIZE_CLASS}>{formatBytes(sizeBytes)}</span>
    </div>
  )
}

interface FileRowActionsProps {
  name: string
  copyPath?: string
  onDownload?: () => void
  onDelete?: () => void
  trailingActions?: ReactNode
}

function FileRowActions({
  name,
  copyPath,
  onDownload,
  onDelete,
  trailingActions,
}: Readonly<FileRowActionsProps>) {
  return (
    <div className="flex shrink-0 items-center gap-1">
      {copyPath !== undefined && <CopyButton value={copyPath} label={name} />}
      {onDownload && (
        <Button variant="ghost" size="icon" aria-label={`Download ${name}`} onClick={onDownload}>
          <Download className="h-4 w-4" />
        </Button>
      )}
      {onDelete && (
        <Button
          variant="ghost"
          size="icon"
          aria-label={`Delete ${name}`}
          onClick={onDelete}
          className="text-error hover:bg-error/10 hover:text-error"
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      )}
      {trailingActions}
    </div>
  )
}

export function FileRow({
  name,
  sizeBytes,
  indent = 0,
  removed = false,
  removedAt,
  removedBy,
  icon,
  subtitle,
  subtitleMono = false,
  copyPath,
  onDownload,
  onDelete,
  trailingActions,
  selected = false,
  muted = false,
  onSelect,
  onDoubleClick,
}: Readonly<FileRowProps>) {
  const paddingLeft = rowIndentPadding(indent)
  const iconNode = icon ?? <FileTypeIcon name={name} />

  if (removed) {
    return (
      <RemovedFileRow
        name={name}
        sizeBytes={sizeBytes}
        paddingLeft={paddingLeft}
        icon={iconNode}
        removedAt={removedAt}
        removedBy={removedBy}
      />
    )
  }

  const interactive = selectableRowProps({ selected, muted, onSelect, onDoubleClick })

  return (
    <div
      data-testid="file-row"
      data-selected={dataFlag(selected)}
      data-muted={dataFlag(muted)}
      aria-disabled={dataFlag(muted)}
      className={cn(
        ROW_CLASS,
        selected && ROW_SELECTED_CLASS,
        muted && ROW_MUTED_CLASS,
        interactive.tabIndex === 0 && ROW_FOCUS_CLASS
      )}
      style={{ paddingLeft }}
      {...interactive}
    >
      {iconNode}
      <div className="min-w-0 flex-1">
        <TruncatedName value={name} textClassName={NAME_CLASS} />
        {subtitle && (
          <div
            data-testid="artifact-file-subtitle"
            className={cn('truncate text-xs text-muted', subtitleMono && 'font-mono')}
          >
            {subtitle}
          </div>
        )}
      </div>
      <span className={ROW_SIZE_CLASS}>{formatBytes(sizeBytes)}</span>
      <FileRowActions
        name={name}
        copyPath={copyPath}
        onDownload={onDownload}
        onDelete={onDelete}
        trailingActions={trailingActions}
      />
    </div>
  )
}
