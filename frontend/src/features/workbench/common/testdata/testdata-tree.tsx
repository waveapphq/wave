/**
 * Recursive rows of a test's data: the shared FolderRow
 * and FileRow nested by depth, with no section header. Manage mode carries
 * Copy path, Download and the kebab on every row; pick mode carries the
 * selection rule the picker asked for, muting the files it excludes.
 */

import { useMemo, useState } from 'react'
import { Download, Folder, MoreVertical, Pencil, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { FileRow, dataFlag, rowEnterHandler, rowIndentPadding } from '@/components/shared/file-row'
import { FolderRow } from '@/components/shared/folder-row'
import { entryReference, type TestDataNode } from './testdata-entries'
import { TestDataUploadRow, useNow } from './testdata-upload-row'
import type { TestDataUpload } from './use-testdata'

export type TestDataBrowserMode = 'manage' | 'pick'
export type TestDataSelectable = 'file' | 'file-or-folder' | 'folder'

const NO_PENDING: TestDataUpload[] = []

export interface TestDataTreeProps {
  nodes: TestDataNode[]
  mode: TestDataBrowserMode
  /** Manage mode: a session that does not hold the test reads but never writes. */
  readOnly?: boolean
  /** Pick mode: which rows select; files render muted in folder mode. */
  selectable?: TestDataSelectable
  selectedPath?: string | null
  /** The folder a drag is hovering, highlighted as the drop target. */
  dropTargetPath?: string
  /** Files on their way in, and files that did not land, shown under their folder. */
  uploads?: TestDataUpload[]
  onSelect?: (node: TestDataNode) => void
  onChoose?: (node: TestDataNode) => void
  onDownload: (node: TestDataNode) => void
  onRename: (node: TestDataNode) => void
  onDelete: (node: TestDataNode) => void
}

type NodeCallback = ((node: TestDataNode) => void) | undefined

interface TreeContext {
  mode: TestDataBrowserMode
  readOnly: boolean
  selectable: TestDataSelectable | undefined
  selectedPath: string | null | undefined
  dropTargetPath: string | undefined
  /** Folder path -> the rows waiting under it; the root's key is the empty string. */
  pending: Map<string, TestDataUpload[]>
  /** Wall clock, so every row ages together. */
  now: number
  onSelect: NodeCallback
  onChoose: NodeCallback
  onDownload: (node: TestDataNode) => void
  onRename: (node: TestDataNode) => void
  onDelete: (node: TestDataNode) => void
}

/** Copy path and Download are reads; only the kebab writes (TDATA-13). */
function canEdit(context: TreeContext): boolean {
  return context.mode === 'manage' && !context.readOnly
}

function folderSelectable(context: TreeContext): boolean {
  return context.mode === 'manage' || context.selectable !== 'file'
}

function fileSelectable(context: TreeContext): boolean {
  return context.mode === 'manage' || context.selectable !== 'folder'
}

function pendingIn(context: TreeContext, folder: string): TestDataUpload[] {
  return context.pending.get(folder) ?? NO_PENDING
}

interface PendingRowsProps {
  rows: TestDataUpload[]
  depth: number
  now: number
}

function PendingRows({ rows, depth, now }: Readonly<PendingRowsProps>) {
  return rows.map((upload) => (
    <TestDataUploadRow key={upload.id} upload={upload} indent={depth} now={now} />
  ))
}

function bindNode(callback: NodeCallback, node: TestDataNode): (() => void) | undefined {
  return callback && (() => callback(node))
}

interface RowMenuProps {
  name: string
  onRename: () => void
  onDelete: () => void
}

function RowMenu({ name, onRename, onDelete }: Readonly<RowMenuProps>) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={`More actions for ${name}`}>
          <MoreVertical className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-40">
        <DropdownMenuItem onSelect={onRename}>
          <Pencil className="h-4 w-4" aria-hidden="true" />
          Rename
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onDelete} className="text-error focus:text-error">
          <Trash2 className="h-4 w-4" aria-hidden="true" />
          Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

const FOLDER_TILE = (
  <span
    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-muted/20 text-muted"
    aria-hidden="true"
  >
    <Folder className="h-4 w-4" />
  </span>
)

interface NodeRowProps {
  node: TestDataNode
  depth: number
  context: TreeContext
}

function FolderNode({ node, depth, context }: Readonly<NodeRowProps>) {
  const [open, setOpen] = useState(true)
  const pending = pendingIn(context, node.path)
  // A folder never hides a file that is arriving into it (TDATA-14).
  const expanded = open || pending.some((upload) => upload.status === 'uploading')
  const manage = context.mode === 'manage'
  const selected = node.path === context.selectedPath
  const select = bindNode(context.onSelect, node)
  const choose = bindNode(context.onChoose, node)
  const toggle = () => setOpen((shown) => !shown)
  // Folder mode picks a folder on Enter; everywhere else Enter discloses it.
  const enterAction = context.selectable === 'folder' && context.mode === 'pick' ? select : toggle

  return (
    <div
      role="none"
      data-testid="testdata-row"
      data-entry-type="dir"
      data-path={node.path}
      data-drop-path={node.path}
      data-selected={dataFlag(selected)}
      onKeyDown={rowEnterHandler(enterAction)}
    >
      <FolderRow
        name={node.name}
        expanded={expanded}
        onToggle={toggle}
        indent={depth}
        sizeBytes={node.sizeBytes}
        icon={FOLDER_TILE}
        copyPath={manage ? entryReference(node.path) : undefined}
        actions={
          manage ? (
            <>
              <DownloadButton name={node.name} onClick={() => context.onDownload(node)} />
              {canEdit(context) && (
                <RowMenu
                  name={node.name}
                  onRename={() => context.onRename(node)}
                  onDelete={() => context.onDelete(node)}
                />
              )}
            </>
          ) : undefined
        }
        selected={selected}
        onSelect={folderSelectable(context) ? select : undefined}
        onDoubleClick={folderSelectable(context) ? choose : undefined}
        dropTarget={node.path === context.dropTargetPath}
      />
      {expanded && (
        // fieldset is the group role the tree needs, with no styling of its own.
        <fieldset className="min-w-0">
          {node.children.length === 0 && pending.length === 0 ? (
            <EmptyFolderRow depth={depth + 1} />
          ) : (
            node.children.map((child) => (
              <TreeNode key={child.path} node={child} depth={depth + 1} context={context} />
            ))
          )}
          <PendingRows rows={pending} depth={depth + 1} now={context.now} />
        </fieldset>
      )}
    </div>
  )
}

function EmptyFolderRow({ depth }: Readonly<{ depth: number }>) {
  return (
    <div
      role="none"
      data-testid="testdata-empty-folder"
      className="border-b border-subtle py-2 pr-4 text-xs italic text-muted-foreground last:border-b-0"
      style={{ paddingLeft: rowIndentPadding(depth) }}
    >
      Empty folder
    </div>
  )
}

interface DownloadButtonProps {
  name: string
  onClick: () => void
}

function DownloadButton({ name, onClick }: Readonly<DownloadButtonProps>) {
  return (
    <Button variant="ghost" size="icon" aria-label={`Download ${name}`} onClick={onClick}>
      <Download className="h-4 w-4" />
    </Button>
  )
}

function FileNode({ node, depth, context }: Readonly<NodeRowProps>) {
  const manage = context.mode === 'manage'
  const selected = node.path === context.selectedPath
  const muted = context.mode === 'pick' && context.selectable === 'folder'
  const live = fileSelectable(context)
  const select = bindNode(context.onSelect, node)
  const choose = bindNode(context.onChoose, node)

  return (
    <div
      role="none"
      data-testid="testdata-row"
      data-entry-type="file"
      data-path={node.path}
      data-selected={dataFlag(selected)}
      onKeyDown={rowEnterHandler(live ? choose : undefined)}
    >
      <FileRow
        name={node.name}
        sizeBytes={node.sizeBytes}
        indent={depth}
        copyPath={manage ? entryReference(node.path) : undefined}
        onDownload={manage ? () => context.onDownload(node) : undefined}
        trailingActions={
          canEdit(context) ? (
            <RowMenu
              name={node.name}
              onRename={() => context.onRename(node)}
              onDelete={() => context.onDelete(node)}
            />
          ) : undefined
        }
        selected={selected}
        muted={muted}
        onSelect={live ? select : undefined}
        onDoubleClick={live ? choose : undefined}
      />
    </div>
  )
}

function TreeNode(props: Readonly<NodeRowProps>) {
  return props.node.kind === 'dir' ? <FolderNode {...props} /> : <FileNode {...props} />
}

/** Every folder the tree actually renders, so a row is never placed nowhere. */
function folderPaths(nodes: TestDataNode[], into: Set<string>): Set<string> {
  for (const node of nodes) {
    if (node.kind === 'dir') {
      into.add(node.path)
      folderPaths(node.children, into)
    }
  }
  return into
}

/** Group the rows by the folder they are going to; anything else sits at the root. */
function groupPending(
  uploads: TestDataUpload[],
  nodes: TestDataNode[]
): Map<string, TestDataUpload[]> {
  const folders = folderPaths(nodes, new Set())
  const grouped = new Map<string, TestDataUpload[]>()
  for (const upload of uploads) {
    const key = folders.has(upload.folder) ? upload.folder : ''
    grouped.set(key, [...(grouped.get(key) ?? []), upload])
  }
  return grouped
}

export function TestDataTree({
  nodes,
  mode,
  readOnly = false,
  selectable,
  selectedPath,
  dropTargetPath,
  uploads = NO_PENDING,
  onSelect,
  onChoose,
  onDownload,
  onRename,
  onDelete,
}: Readonly<TestDataTreeProps>) {
  const now = useNow(uploads.some((upload) => upload.status === 'uploading'))
  const pending = useMemo(() => groupPending(uploads, nodes), [uploads, nodes])
  const context: TreeContext = {
    mode,
    readOnly,
    selectable,
    selectedPath,
    dropTargetPath,
    pending,
    now,
    onSelect,
    onChoose,
    onDownload,
    onRename,
    onDelete,
  }
  return (
    <div role="tree" aria-label="Test data files">
      {nodes.map((node) => (
        <TreeNode key={node.path} node={node} depth={0} context={context} />
      ))}
      <PendingRows rows={pendingIn(context, '')} depth={0} now={now} />
    </div>
  )
}
