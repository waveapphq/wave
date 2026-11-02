/**
 * FileReferencePickerSheet - the picker a Browse button opens (REQ-3.4.2.2,
 * REQ-3.4.3.2; TDATA-8, TDATA-9). One floating sheet in four modes: the open
 * test's data through the shared browser in pick mode, the session's artifacts
 * as a tree, and a Reference line holding the exact value the row receives.
 */

import { useId, useState, type KeyboardEvent, type Ref } from 'react'
import { GripVertical, X } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { DraggableSheet, type SheetHandle } from '@/components/shared/draggable-sheet'
import { useChildEditor } from '@/components/shared/child-editors/child-editor-scope'
import { TextField } from '@/components/shared/fields/text-field'
import { FileRow, rowEnterHandler } from '@/components/shared/file-row'
import { FolderRow } from '@/components/shared/folder-row'
import {
  SegmentedControl,
  type SegmentedControlOption,
} from '@/components/shared/segmented-control'
import {
  ARTIFACT_SCHEME,
  TESTDATA_SCHEME,
  buildArtifactReference,
  buildTestDataReference,
  joinReference,
  splitReference,
} from '@/lib/file-references'
import { buildPathTree, subtreeSize, type PathTreeNode } from '@/lib/path-tree'
import type { WorkbenchSessionArtifact } from '@/features/workbench/api/workbench'
import { TestDataBrowser } from '@/features/workbench/common/testdata/testdata-browser'
import type { TestDataNode } from '@/features/workbench/common/testdata/testdata-entries'
import type { TestDataSelectable } from '@/features/workbench/common/testdata/testdata-tree'
import { useTestData } from '@/features/workbench/common/testdata/use-testdata'
import { useSessionArtifacts } from '@/features/workbench/hooks/use-session-artifacts'
import type { InputParam } from '@/features/workbench/lib/node-parameters/types'
import { useWorkflowStore } from '@/features/workbench/stores/workflow-store'

export type FileReferencePickerMode = NonNullable<InputParam['fileReference']>

export interface FileReferencePickerSheetProps {
  /** Lets the opener raise this sheet again. */
  ref?: Ref<SheetHandle>
  open: boolean
  /** The label of the row this picker was opened from, as the row shows it. */
  label: string
  mode: FileReferencePickerMode
  /** No Test Data tab: the session's artifacts are the only source (Move's Source). */
  artifactsOnly?: boolean
  /** The row's current value; seeds the Reference line. */
  initialValue: string
  /** Save-as: the Name the sheet opens with (Copy / Move destinations). */
  presetName?: string
  /** The open test; null while the test is unsaved. */
  testId: string | null
  /** Writes the chosen value; the picker closes itself afterwards. */
  onChoose: (value: string) => void
  onClose: () => void
}

type EntryKind = 'file' | 'dir'
type Source = 'testdata' | 'artifacts'

interface Selection {
  source: Source
  path: string
  kind: EntryKind
}

/** The Reference plus, for save-as, the folder and Name it is composed from. */
interface Draft {
  reference: string
  folder: string
  name: string
}

/** Each tab keeps its own Reference, always under that tab's scheme. */
type Drafts = Record<Source, Draft>

const SCHEME_OF: Record<Source, string> = { testdata: TESTDATA_SCHEME, artifacts: ARTIFACT_SCHEME }

const TITLES: Record<FileReferencePickerMode, string> = {
  file: 'Choose a file',
  'file-or-folder': 'Choose a file or folder',
  folder: 'Choose a folder',
  'save-as': 'Save as',
}

const SOURCE_TABS: readonly SegmentedControlOption<Source>[] = [
  { value: 'testdata', label: 'Test Data', testId: 'picker-tab-testdata' },
  { value: 'artifacts', label: 'Artifacts', testId: 'picker-tab-artifacts' },
]

const ARTIFACTS_HINT = "Files in this session's artifacts"
const ARTIFACTS_RULE = 'A block can read one only after an earlier block in the same run wrote it.'
const SAVE_AS_HINT = "Folders and files in this session's artifacts"
const ARTIFACTS_EMPTY = 'Files this session wrote appear here. Type a path an earlier block writes.'
const NAME_MAX_LENGTH = 255

/** A save-as Reference with its folder and Name split out. */
function composedDraft(reference: string): Draft {
  const { folder, name } = splitReference(reference)
  return { reference, folder, name }
}

/** The Artifacts tab's opening Reference: the row value when it is an artifact, else the preset Name. */
function seedArtifacts(mode: FileReferencePickerMode, artifact: string, presetName: string | undefined): Draft {
  if (mode !== 'save-as') {
    return { reference: artifact || ARTIFACT_SCHEME, folder: ARTIFACT_SCHEME, name: '' }
  }
  if (artifact === '') {
    const name = presetName ?? ''
    return { reference: joinReference(ARTIFACT_SCHEME, name), folder: ARTIFACT_SCHEME, name }
  }
  const draft = composedDraft(artifact)
  return { ...draft, name: draft.name || presetName || '' }
}

/** A row value under neither scheme opens both tabs empty; the field keeps it until Select. */
function seedDrafts(
  mode: FileReferencePickerMode,
  initialValue: string,
  presetName: string | undefined,
): Drafts {
  const underOwn = (scheme: string) => (initialValue.startsWith(scheme) ? initialValue : '')
  return {
    testdata: { reference: underOwn(TESTDATA_SCHEME) || TESTDATA_SCHEME, folder: ARTIFACT_SCHEME, name: '' },
    artifacts: seedArtifacts(mode, underOwn(ARTIFACT_SCHEME), presetName),
  }
}

function toggled(set: ReadonlySet<string>, path: string): Set<string> {
  const next = new Set(set)
  if (next.has(path)) {
    next.delete(path)
  } else {
    next.add(path)
  }
  return next
}

interface ArtifactTreeProps {
  nodes: PathTreeNode<WorkbenchSessionArtifact>[]
  indent: number
  filesSelectable: boolean
  foldersSelectable: boolean
  selectedPath: string | null
  collapsed: ReadonlySet<string>
  onToggle: (path: string) => void
  onSelect: (path: string, kind: EntryKind) => void
  onChoose: (path: string, kind: EntryKind) => void
}

/** The session's artifacts as nested folder and file rows; folders start open. */
function ArtifactTreeRows(props: Readonly<ArtifactTreeProps>) {
  const { nodes, indent, filesSelectable, foldersSelectable, selectedPath, collapsed, onToggle } =
    props
  const { onSelect, onChoose } = props
  return nodes.map((node) => {
    const item = node.item
    if (item === null) {
      const expanded = !collapsed.has(node.path)
      const chooseFolder = foldersSelectable ? () => onChoose(node.path, 'dir') : undefined
      return (
        <div
          key={node.path}
          role="none"
          data-testid="picker-artifact-row"
          data-path={node.path}
          onKeyDown={rowEnterHandler(chooseFolder)}
        >
          <FolderRow
            name={node.name}
            expanded={expanded}
            onToggle={() => onToggle(node.path)}
            indent={indent}
            sizeBytes={subtreeSize(node)}
            selected={selectedPath === node.path}
            onSelect={foldersSelectable ? () => onSelect(node.path, 'dir') : undefined}
            onDoubleClick={chooseFolder}
          />
          {expanded && (
            // fieldset is the group role the tree needs, with no styling of its own.
            <fieldset className="min-w-0">
              <ArtifactTreeRows {...props} nodes={node.children} indent={indent + 1} />
            </fieldset>
          )}
        </div>
      )
    }
    const chooseFile = filesSelectable ? () => onChoose(node.path, 'file') : undefined
    return (
      <div
        key={node.path}
        role="none"
        data-testid="picker-artifact-row"
        data-path={node.path}
        onKeyDown={rowEnterHandler(chooseFile)}
      >
        <FileRow
          name={node.name}
          sizeBytes={item.size_bytes}
          indent={indent}
          selected={selectedPath === node.path}
          muted={!filesSelectable}
          onSelect={filesSelectable ? () => onSelect(node.path, 'file') : undefined}
          onDoubleClick={chooseFile}
        />
      </div>
    )
  })
}

export function FileReferencePickerSheet({
  ref,
  open,
  label,
  mode,
  artifactsOnly = false,
  initialValue,
  presetName,
  testId,
  onChoose,
  onClose,
}: Readonly<FileReferencePickerSheetProps>) {
  const isSaveAs = mode === 'save-as'
  const pickSelectable: TestDataSelectable | null = mode === 'save-as' ? null : mode
  const showTestData = pickSelectable !== null && !artifactsOnly
  const [tab, setTab] = useState<Source>(() =>
    initialValue.startsWith(ARTIFACT_SCHEME) ? 'artifacts' : 'testdata',
  )
  const source: Source = showTestData ? tab : 'artifacts'
  const scheme = SCHEME_OF[source]

  const [selection, setSelection] = useState<Selection | null>(null)
  const [drafts, setDrafts] = useState<Drafts>(() => seedDrafts(mode, initialValue, presetName))
  const [openedWith] = useState(drafts)
  const draft = drafts[source]
  const setDraft = (tabSource: Source, update: (prev: Draft) => Draft) =>
    setDrafts((prev) => ({ ...prev, [tabSource]: update(prev[tabSource]) }))
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set())
  const referenceId = useId()
  const schemeId = useId()
  const nameId = useId()

  // Browse never opens on a read-only canvas, so this session holds the test.
  const testData = useTestData(showTestData ? testId : null, true)
  const running = useWorkflowStore((s) => s.executionStatus === 'running')
  const artifacts = useSessionArtifacts({
    sessionActive: open,
    running,
    sheetOpen: open && source === 'artifacts',
  })
  const artifactTree = buildPathTree(artifacts.items, (item) => item.path, {
    order: 'folders-first',
  })

  const selectTestData = (node: TestDataNode) => {
    setSelection({ source: 'testdata', path: node.path, kind: node.kind })
    setDraft('testdata', (prev) => ({ ...prev, reference: buildTestDataReference(node.path) }))
  }
  const choose = (reference: string) => {
    onChoose(reference)
    onClose()
  }
  const chooseTestData = (node: TestDataNode) => choose(buildTestDataReference(node.path))

  const selectArtifact = (path: string, kind: EntryKind) => {
    setSelection({ source: 'artifacts', path, kind })
    const reference = buildArtifactReference(path)
    if (!isSaveAs) {
      setDraft('artifacts', (prev) => ({ ...prev, reference }))
      return
    }
    if (kind === 'dir') {
      setDraft('artifacts', (prev) => ({ ...prev, folder: reference, reference: joinReference(reference, prev.name) }))
      return
    }
    setDraft('artifacts', () => composedDraft(reference))
  }
  const chooseArtifact = (path: string, kind: EntryKind) => {
    // Save-as: a folder is where the Name goes, not the value itself.
    if (isSaveAs && kind === 'dir') return
    choose(buildArtifactReference(path))
  }

  const changeName = (name: string) =>
    setDraft('artifacts', (prev) => ({ ...prev, name, reference: joinReference(prev.folder, name) }))
  // Only the path is typed; the scheme is the tab's and cannot be edited away.
  const changePath = (path: string) => {
    setSelection(null)
    const reference = scheme + path
    setDraft(source, (prev) => (isSaveAs ? composedDraft(reference) : { ...prev, reference }))
  }

  const path = draft.reference.slice(scheme.length).trim()
  const value = scheme + path
  const canConfirm = isSaveAs ? splitReference(value).name !== '' : path !== ''
  const confirm = () => choose(value)

  useChildEditor(
    open
      ? {
          label,
          hasChanges: draft.reference !== openedWith[source].reference,
          cannotBeSaved: !canConfirm,
          apply: () => onChoose(value),
        }
      : null,
  )
  const confirmOnEnter = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter' || !canConfirm) return
    event.preventDefault()
    confirm()
  }
  const chooseSelectedArtifact = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== 'Enter' || selection?.source !== 'artifacts') return
    event.preventDefault()
    chooseArtifact(selection.path, selection.kind)
  }

  const title = TITLES[mode]
  const selectedTestDataPath = selection?.source === 'testdata' ? selection.path : null
  const selectedArtifactPath = selection?.source === 'artifacts' ? selection.path : null

  const renderTestData = (selectable: TestDataSelectable) => {
    if (testData.error) {
      return (
        <p role="alert" data-testid="picker-testdata-error" className="px-4 py-3 text-xs text-destructive">
          {testData.error.message}
        </p>
      )
    }
    if (testData.loading) {
      return (
        <p aria-live="polite" className="px-4 py-3 text-xs text-muted-foreground">
          Loading test data…
        </p>
      )
    }
    return (
      <TestDataBrowser
        testId={testId}
        listing={testData.listing}
        mode="pick"
        selectable={selectable}
        selectedPath={selectedTestDataPath}
        onSelect={selectTestData}
        onChoose={chooseTestData}
        onUpload={testData.upload}
        onCreateFolder={testData.createFolder}
        onRename={testData.rename}
        onDelete={testData.remove}
        blockedReason={testData.blockedReason}
        uploads={testData.uploads}
      />
    )
  }

  const renderArtifacts = () => (
    <>
      <div className="shrink-0 text-xs text-muted-foreground">
        {isSaveAs ? (
          <p>{SAVE_AS_HINT}</p>
        ) : (
          <>
            <p>{ARTIFACTS_HINT}</p>
            <p>{ARTIFACTS_RULE}</p>
          </>
        )}
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain rounded-lg border">
        {artifacts.items.length === 0 ? (
          <p
            data-testid="picker-artifacts-empty"
            className="px-6 py-10 text-center text-xs text-muted-foreground"
          >
            {ARTIFACTS_EMPTY}
          </p>
        ) : (
          <div
            data-testid="picker-artifacts-list"
            role="tree"
            aria-label="Session artifacts"
            // The rows carry the tab stops; the tree itself only needs to be focusable.
            tabIndex={-1}
            onKeyDown={chooseSelectedArtifact}
          >
            <ArtifactTreeRows
              nodes={artifactTree}
              indent={0}
              filesSelectable={mode !== 'folder'}
              foldersSelectable={mode !== 'file'}
              selectedPath={selectedArtifactPath}
              collapsed={collapsed}
              onToggle={(path) => setCollapsed((prev) => toggled(prev, path))}
              onSelect={selectArtifact}
              onChoose={chooseArtifact}
            />
          </div>
        )}
      </div>
    </>
  )

  return (
    <DraggableSheet
      ref={ref}
      open={open}
      onClose={onClose}
      sheetId="file-reference-picker"
      resizable
      ariaLabel={title}
      data-testid="file-reference-picker-sheet"
      initialWidth={520}
      initialHeight={600}
      minWidth={460}
      minHeight={420}
      className="max-w-[90vw] max-h-[90vh] shadow-xl"
      headerClassName="py-2"
      header={
        <>
          <div className="flex flex-1 items-center gap-2 min-w-0">
            <GripVertical className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <h2 className="text-sm font-semibold truncate">{title}</h2>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Close"
            onClick={onClose}
            onPointerDown={(event) => event.stopPropagation()}
            className="h-7 w-7"
          >
            <X className="h-4 w-4" />
          </Button>
        </>
      }
    >
      <div
        data-testid="file-reference-picker"
        data-picker-mode={mode}
        className="flex flex-1 min-h-0 flex-col gap-3 px-4 py-3"
      >
        {showTestData && (
          <SegmentedControl
            options={SOURCE_TABS}
            value={tab}
            onChange={setTab}
            aria-label="File source"
            className="w-fit"
          />
        )}
        <div className="flex flex-1 min-h-0 flex-col gap-2">
          {source === 'testdata' && pickSelectable !== null
            ? renderTestData(pickSelectable)
            : renderArtifacts()}
        </div>
        {isSaveAs && (
          <div className="flex shrink-0 items-center gap-2">
            <label htmlFor={nameId} className="shrink-0 text-xs text-muted-foreground">
              Name
            </label>
            <TextField
              id={nameId}
              data-testid="picker-name-input"
              value={draft.name}
              onChange={changeName}
              onKeyDown={confirmOnEnter}
              maxLength={NAME_MAX_LENGTH}
              className="h-8 font-mono text-sm"
            />
          </div>
        )}
      </div>

      <div className="flex items-center gap-2 px-3 py-2 border-t bg-muted/30 rounded-b-lg shrink-0">
        <label htmlFor={referenceId} className="shrink-0 text-xs text-muted-foreground">
          Reference
        </label>
        <div className="flex min-w-0 flex-1 items-stretch rounded-md focus-within:ring-1 focus-within:ring-ring">
          <span
            id={schemeId}
            translate="no"
            data-testid="picker-reference-scheme"
            className="flex h-8 shrink-0 items-center rounded-l-md border border-r-0 border-input bg-muted px-2 font-mono text-xs text-muted-foreground select-none"
          >
            {scheme}
          </span>
          <TextField
            id={referenceId}
            data-testid="picker-reference-input"
            aria-describedby={schemeId}
            value={draft.reference.slice(scheme.length)}
            onChange={changePath}
            onKeyDown={confirmOnEnter}
            className="h-8 rounded-l-none font-mono text-xs focus-visible:ring-0"
          />
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="shrink-0 whitespace-nowrap"
          data-testid="picker-cancel-button"
          onClick={onClose}
        >
          Cancel
        </Button>
        <Button
          type="button"
          size="sm"
          className="shrink-0 whitespace-nowrap"
          data-testid="picker-use-button"
          disabled={!canConfirm}
          onClick={confirm}
        >
          Select
        </Button>
      </div>
    </DraggableSheet>
  )
}
