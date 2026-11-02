/**
 * The one Test Data browser both the Test Data sheet and the file reference
 * picker mount, always for one test. Manage mode
 * carries the toolbar, the row actions and the dialogs; pick mode carries the
 * selection rule the picker asks for. Upload conflicts are found against the
 * listing on screen before anything is sent, so the user answers once and one
 * request follows. The two toolbar buttons portal into a host slot when the
 * host offers one.
 */

import { useCallback, useMemo, useRef, useState, type ChangeEvent, type DragEvent } from 'react'
import { createPortal } from 'react-dom'
import { FolderPlus, Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog'
import { SearchInput } from '@/components/ui/search-input'
import { dataFlag } from '@/components/shared/file-row'
import { testdataApi } from '@/features/tests/api/testdata'
import type { TestDataEntry, TestDataListing } from '@/features/tests/api/types'
import { useFileDrop } from '@/hooks/use-file-drop'
import { toFailureDetail } from '@/lib/failure-detail'
import { joinReference, splitReference } from '@/lib/file-references'
import { formatBytes } from '@/lib/format-bytes'
import { joinLabels } from '@/lib/join-labels'
import { pluralize } from '@/lib/pluralize'
import { buildTree, filterEntries, parentOf, type TestDataNode } from './testdata-entries'
import { TestDataNameDialog } from './testdata-name-dialog'
import { TestDataTree, type TestDataBrowserMode, type TestDataSelectable } from './testdata-tree'
import type { TestDataUpload } from './use-testdata'

type Outcome = void | Promise<void>

export interface TestDataBrowserProps {
  /** Null for a test that was never saved: no folder exists yet. */
  testId: string | null
  listing: TestDataListing
  mode: TestDataBrowserMode
  /** Pick mode: which rows select. */
  selectable?: TestDataSelectable
  /** Pick mode: the row the picker holds selected. */
  selectedPath?: string | null
  onSelect?: (node: TestDataNode) => void
  onChoose?: (node: TestDataNode) => void
  onUpload: (folder: string, files: File[], replace: boolean) => Outcome
  onCreateFolder: (path: string) => Outcome
  /** Reports the entry's path and its bare new name. */
  onRename: (path: string, name: string) => Outcome
  onDelete: (path: string) => Outcome
  /** The server's 409 message for a refused write, shown above the tree. */
  blockedReason?: string | null
  /** The files still going and the ones that did not land, shown under their folder. */
  uploads?: TestDataUpload[]
  /** A session that does not hold the test reads its files but never changes them. */
  readOnly?: boolean
  /** Host element the Upload and New folder buttons portal into; inline when absent. */
  toolbarSlot?: HTMLElement | null
}

type Prompt = { kind: 'folder' } | { kind: 'rename'; node: TestDataNode }

/** The row the user clicked; the write actions target it or the folder holding it. */
interface Selection {
  path: string
  kind: TestDataNode['kind']
}

interface PendingUpload {
  folder: string
  files: File[]
  conflicts: string[]
}

const DELETE_DESCRIPTIONS: Record<TestDataNode['kind'], string> = {
  file: "The file is removed from this test's data.",
  dir: "The folder and everything inside it are removed from this test's data.",
}

const EMPTY_BODY =
  'Upload the files this test reads. Reference them as testdata:// paths where a block reads a file.'
const EMPTY_BODY_READ_ONLY = "Blocks read this test's files as testdata:// paths."
const READ_ONLY_NOTE = 'Only the session holding this test can change its files.'

const DROP_PATH_SELECTOR = '[data-drop-path]'
const NO_UPLOADS: TestDataUpload[] = []

/** Names of the entries directly inside a folder ("" for the root). */
function namesIn(entries: TestDataEntry[], folder: string): string[] {
  return entries
    .filter((entry) => parentOf(entry.path) === folder)
    .map((entry) => splitReference(entry.path).name)
}

function stillListed(entries: TestDataEntry[], selection: Selection | null): Selection | null {
  if (selection === null) return null
  const listed = entries.some(
    (entry) => entry.path === selection.path && entry.kind === selection.kind
  )
  return listed ? selection : null
}

/** Where Upload and New folder land: the selected folder, a selected file's folder, or the root. */
function targetFolderOf(selection: Selection | null): string {
  if (selection === null) return ''
  return selection.kind === 'dir' ? selection.path : parentOf(selection.path)
}

function promptSiblings(entries: TestDataEntry[], prompt: Prompt, folder: string): string[] {
  if (prompt.kind === 'folder') return namesIn(entries, folder)
  return namesIn(entries, parentOf(prompt.node.path)).filter(
    (name) => name !== prompt.node.name
  )
}

function conflictDescription(conflicts: string[]): string {
  const verb = conflicts.length === 1 ? 'exists' : 'exist'
  return `${joinLabels(conflicts)} already ${verb} in the target folder.`
}

function downloadNode(testId: string, node: TestDataNode): Promise<void> {
  return node.kind === 'dir'
    ? testdataApi.downloadZip(testId, node.path)
    : testdataApi.download(testId, node.path)
}

interface NoticeProps {
  testId: string
  children: string
}

function Notice({ testId, children }: Readonly<NoticeProps>) {
  return (
    <p data-testid={testId} role="alert" className="shrink-0 border-b px-4 py-2 text-xs text-error">
      {children}
    </p>
  )
}

type ContentKind = 'empty' | 'no-matches' | 'tree'

/** A file on its way in keeps the tree on screen, whatever the listing holds. */
function contentKind(entries: number, nodes: number, uploads: number): ContentKind {
  if (uploads > 0 || nodes > 0) return 'tree'
  return entries === 0 ? 'empty' : 'no-matches'
}

interface NoticesProps {
  readOnly: boolean
  blockedReason: string | null | undefined
  failure: string | null
}

/** The lines above the tree: why this session cannot write, and what was refused. */
function BrowserNotices({ readOnly, blockedReason, failure }: Readonly<NoticesProps>) {
  return (
    <>
      {readOnly && (
        <p
          data-testid="testdata-read-only"
          className="shrink-0 border-b px-4 py-2 text-xs text-muted-foreground"
        >
          {READ_ONLY_NOTE}
        </p>
      )}
      {blockedReason ? <Notice testId="testdata-blocked">{blockedReason}</Notice> : null}
      {failure === null ? null : <Notice testId="testdata-action-failed">{failure}</Notice>}
    </>
  )
}

interface EmptyStateProps {
  onUpload: () => void
  readOnly: boolean
}

function EmptyState({ onUpload, readOnly }: Readonly<EmptyStateProps>) {
  return (
    <div data-testid="testdata-empty-state" className="px-6 py-10 text-center">
      <p className="text-[13px] font-medium">No test data yet</p>
      <p className="mt-1 text-xs text-muted-foreground">
        {readOnly ? EMPTY_BODY_READ_ONLY : EMPTY_BODY}
      </p>
      {!readOnly && (
        <Button
          type="button"
          variant="primary"
          size="sm"
          className="mt-4"
          leftIcon={<Upload className="h-3.5 w-3.5" aria-hidden="true" />}
          onClick={onUpload}
        >
          Upload files
        </Button>
      )}
    </div>
  )
}

/** Clicking the selected row clears the selection; any other row takes it. */
function toggleSelection(previous: Selection | null, node: TestDataNode): Selection | null {
  return previous?.path === node.path ? null : { path: node.path, kind: node.kind }
}

interface NamePromptProps {
  prompt: Prompt | null
  entries: TestDataEntry[]
  targetFolder: string
  runAction: (action: () => Outcome) => void
  onCreateFolder: (path: string) => Outcome
  onRename: (path: string, name: string) => Outcome
  onClose: () => void
}

/** New folder / Rename: the one name dialog both prompts share. */
function TestDataNamePrompt({
  prompt,
  entries,
  targetFolder,
  runAction,
  onCreateFolder,
  onRename,
  onClose,
}: Readonly<NamePromptProps>) {
  if (prompt === null) return null
  const renaming = prompt.kind === 'rename' ? prompt : null
  return (
    <TestDataNameDialog
      open
      mode={prompt.kind}
      initialName={renaming?.node.name}
      folder={targetFolder}
      siblings={promptSiblings(entries, prompt, targetFolder)}
      onSave={(name) =>
        runAction(() =>
          renaming === null
            ? onCreateFolder(joinReference(targetFolder, name))
            : onRename(renaming.node.path, name)
        )
      }
      onClose={onClose}
    />
  )
}

interface ConfirmationsProps {
  pendingUpload: PendingUpload | null
  pendingDelete: TestDataNode | null
  runAction: (action: () => Outcome) => void
  onUpload: (folder: string, files: File[], replace: boolean) => Outcome
  onDelete: (path: string) => Outcome
  onCloseUpload: () => void
  onCloseDelete: () => void
}

/** The two writes that ask first: replacing uploaded names, and deleting an entry. */
function TestDataConfirmations({
  pendingUpload,
  pendingDelete,
  runAction,
  onUpload,
  onDelete,
  onCloseUpload,
  onCloseDelete,
}: Readonly<ConfirmationsProps>) {
  return (
    <>
      {pendingUpload === null ? null : (
        <ConfirmationDialog
          isOpen
          variant="overwrite"
          title="Replace existing files?"
          description={conflictDescription(pendingUpload.conflicts)}
          confirmLabel="Replace all"
          onConfirm={() =>
            runAction(() => onUpload(pendingUpload.folder, pendingUpload.files, true))
          }
          onClose={onCloseUpload}
        />
      )}
      {pendingDelete === null ? null : (
        <ConfirmationDialog
          isOpen
          variant="delete"
          itemName={pendingDelete.name}
          description={DELETE_DESCRIPTIONS[pendingDelete.kind]}
          onConfirm={() => runAction(() => onDelete(pendingDelete.path))}
          onClose={onCloseDelete}
        />
      )}
    </>
  )
}

export function TestDataBrowser({
  testId,
  listing,
  mode,
  selectable,
  selectedPath,
  onSelect,
  onChoose,
  onUpload,
  onCreateFolder,
  onRename,
  onDelete,
  blockedReason,
  uploads = NO_UPLOADS,
  readOnly = false,
  toolbarSlot,
}: Readonly<TestDataBrowserProps>) {
  const [filter, setFilter] = useState('')
  const [selection, setSelection] = useState<Selection | null>(null)
  const [hoveredFolder, setHoveredFolder] = useState('')
  const [prompt, setPrompt] = useState<Prompt | null>(null)
  const [pendingUpload, setPendingUpload] = useState<PendingUpload | null>(null)
  const [pendingDelete, setPendingDelete] = useState<TestDataNode | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const unsaved = testId === null
  const entries = listing.entries
  // An entry renamed or deleted under the selection falls back to the root.
  const selected = stillListed(entries, selection)
  const targetFolder = targetFolderOf(selected)
  const nodes = useMemo(() => buildTree(filterEntries(entries, filter)), [entries, filter])

  // The owner of an action reports its refusals; anything else lands here.
  const runAction = useCallback((action: () => Outcome) => {
    setFailure(null)
    Promise.resolve(action()).catch((error_: unknown) => {
      setFailure(toFailureDetail(error_).message)
    })
  }, [])

  const startUpload = useCallback(
    (folder: string, files: File[]) => {
      const taken = new Set(namesIn(entries, folder))
      const conflicts = files.map((file) => file.name).filter((name) => taken.has(name))
      if (conflicts.length === 0) {
        runAction(() => onUpload(folder, files, false))
        return
      }
      setPendingUpload({ folder, files, conflicts })
    },
    [entries, onUpload, runAction]
  )

  const clearHoveredFolder = useCallback(() => setHoveredFolder(''), [])

  const handleDrop = useCallback(
    (files: File[]) => {
      startUpload(hoveredFolder || targetFolder, files)
      clearHoveredFolder()
    },
    [hoveredFolder, targetFolder, startUpload, clearHoveredFolder]
  )

  const { isDragging, dropZoneRef } = useFileDrop<HTMLDivElement>({
    onFiles: handleDrop,
    enabled: !unsaved && !readOnly,
  })

  const handleDragOver = (event: DragEvent<HTMLDivElement>) => {
    // The zone itself carries an empty drop path, so a hover always resolves.
    const target = (event.target as Element).closest(DROP_PATH_SELECTOR) as HTMLElement
    setHoveredFolder(target.dataset.dropPath as string)
  }

  const handleInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget
    startUpload(targetFolder, Array.from(input.files as FileList))
    input.value = ''
  }

  const openFilePicker = () => {
    const input = fileInputRef.current as HTMLInputElement
    input.click()
  }

  const selectEntry = (node: TestDataNode) => {
    setSelection((previous) => toggleSelection(previous, node))
  }

  const toolbar = (
    <>
      <Button
        type="button"
        variant="secondary"
        size="sm"
        leftIcon={<Upload className="h-3.5 w-3.5" aria-hidden="true" />}
        disabled={unsaved}
        onClick={openFilePicker}
        data-testid="testdata-upload-button"
      >
        Upload
      </Button>
      <Button
        type="button"
        variant="secondary"
        size="sm"
        leftIcon={<FolderPlus className="h-3.5 w-3.5" aria-hidden="true" />}
        disabled={unsaved}
        onClick={() => setPrompt({ kind: 'folder' })}
        data-testid="testdata-new-folder-button"
      >
        New folder
      </Button>
    </>
  )

  let content
  const kind = contentKind(entries.length, nodes.length, uploads.length)
  if (kind === 'empty') {
    content = <EmptyState onUpload={openFilePicker} readOnly={readOnly} />
  } else if (kind === 'no-matches') {
    content = <p className="px-4 py-6 text-center text-xs text-muted-foreground">No matches</p>
  } else {
    content = (
      <TestDataTree
        key={filter}
        nodes={nodes}
        mode={mode}
        readOnly={readOnly}
        uploads={uploads}
        selectable={selectable}
        selectedPath={mode === 'pick' ? selectedPath : (selected?.path ?? null)}
        dropTargetPath={hoveredFolder}
        onSelect={mode === 'manage' ? selectEntry : onSelect}
        onChoose={onChoose}
        onDownload={(node) => runAction(() => downloadNode(testId as string, node))}
        onRename={(node) => setPrompt({ kind: 'rename', node })}
        onDelete={setPendingDelete}
      />
    )
  }

  return (
    <div
      data-testid="testdata-browser"
      data-read-only={dataFlag(readOnly)}
      className="flex min-h-0 flex-1 flex-col"
    >
      {!readOnly &&
        (toolbarSlot ? (
          createPortal(toolbar, toolbarSlot)
        ) : (
          <div className="flex shrink-0 items-center gap-1 border-b px-4 py-2">{toolbar}</div>
        ))}
      {!readOnly && (
        <input
          ref={fileInputRef}
          type="file"
          multiple
          hidden
          data-testid="testdata-upload-input"
          onChange={handleInputChange}
        />
      )}
      {unsaved ? (
        <p
          data-testid="testdata-save-first"
          className="px-6 py-10 text-center text-xs text-muted-foreground"
        >
          Save the test first to add files.
        </p>
      ) : (
        <>
          {entries.length > 0 && (
            <div className="flex shrink-0 items-center gap-3 border-b px-4 py-2">
              <SearchInput
                data-testid="testdata-filter"
                size="sm"
                placeholder="Filter files…"
                value={filter}
                onChange={(event) => setFilter(event.target.value)}
                className="flex-1"
              />
              <span className="shrink-0 text-xs text-muted-foreground">
                {pluralize(listing.total_files, 'file')} - {formatBytes(listing.total_bytes)}
              </span>
            </div>
          )}
          <BrowserNotices readOnly={readOnly} blockedReason={blockedReason} failure={failure} />
          <div
            ref={dropZoneRef}
            role="none"
            data-testid="testdata-dropzone"
            data-drop-path=""
            data-dragging={dataFlag(isDragging)}
            onDragOver={handleDragOver}
            onDragLeave={clearHoveredFolder}
            className="max-h-[50vh] min-h-0 flex-1 overflow-y-auto overscroll-contain data-[dragging=true]:ring-2 data-[dragging=true]:ring-inset data-[dragging=true]:ring-primary"
          >
            {content}
          </div>
        </>
      )}
      <TestDataNamePrompt
        prompt={prompt}
        entries={entries}
        targetFolder={targetFolder}
        runAction={runAction}
        onCreateFolder={onCreateFolder}
        onRename={onRename}
        onClose={() => setPrompt(null)}
      />
      <TestDataConfirmations
        pendingUpload={pendingUpload}
        pendingDelete={pendingDelete}
        runAction={runAction}
        onUpload={onUpload}
        onDelete={onDelete}
        onCloseUpload={() => setPendingUpload(null)}
        onCloseDelete={() => setPendingDelete(null)}
      />
    </div>
  )
}
