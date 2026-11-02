/**
 * FileReferencePickerSheet - the four-mode file-reference picker (TDATA-8, TDATA-9).
 *
 * Design Reference: REQ-3.4.2.2
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { focusSheet } from '@/components/shared/draggable-sheet'
import { FileReferencePickerSheet } from '@/features/workbench/common/element-config/parameters/file-reference-picker-sheet'
import {
  ChildEditorParent,
  applyParentChildren,
  parentChildren,
} from '../../../../../utils/child-editor-parent'

interface BrowserEntry {
  path: string
  kind: 'file' | 'dir'
}

interface BrowserMockProps {
  testId: string | null
  mode: string
  selectable?: string
  selectedPath?: string
  onSelect?: (entry: BrowserEntry) => void
  onChoose?: (entry: BrowserEntry) => void
}

interface RowMockProps {
  name: string
  selected?: boolean
  muted?: boolean
  subtitle?: string
  expanded?: boolean
  onToggle?: () => void
  onSelect?: () => void
  onDoubleClick?: () => void
}

interface SessionArtifact {
  path: string
  size_bytes: number
  created_at: string
}

const ARTIFACTS: SessionArtifact[] = [
  { path: 'result.json', size_bytes: 35, created_at: '2026-09-01T10:00:00Z' },
  { path: 'reports/summary.json', size_bytes: 1200, created_at: '2026-09-01T10:01:00Z' },
]

const artifactsState: { items: SessionArtifact[] } = { items: ARTIFACTS }

const testDataState: { loading: boolean; error: { message: string } | null } = {
  loading: false,
  error: null,
}

// Group FB owns the browser and its tree; the picker only hands it a mode and a
// selectability and reads the entry back.
vi.mock('@/features/workbench/common/testdata/testdata-browser', () => ({
  TestDataBrowser: ({
    testId,
    mode,
    selectable,
    selectedPath,
    onSelect,
    onChoose,
  }: BrowserMockProps) => (
    <div
      data-testid="testdata-browser-mock"
      data-test-id-prop={testId ?? ''}
      data-mode={mode}
      data-selectable={selectable ?? ''}
      data-selected-path={selectedPath ?? ''}
    >
      <button
        type="button"
        data-testid="browser-select-file"
        onClick={() => onSelect?.({ path: 'fixtures/users.csv', kind: 'file' })}
      >
        select file
      </button>
      <button
        type="button"
        data-testid="browser-select-folder"
        onClick={() => onSelect?.({ path: 'fixtures', kind: 'dir' })}
      >
        select folder
      </button>
      <button
        type="button"
        data-testid="browser-choose-file"
        onClick={() => onChoose?.({ path: 'fixtures/users.csv', kind: 'file' })}
      >
        choose file
      </button>
    </div>
  ),
}))

vi.mock('@/features/workbench/common/testdata/use-testdata', () => ({
  useTestData: () => ({
    listing: { entries: [], total_files: 0, total_bytes: 0 },
    loading: testDataState.loading,
    error: testDataState.error,
    blockedReason: null,
    uploads: [],
    refresh: vi.fn(),
    upload: vi.fn(),
    createFolder: vi.fn(),
    rename: vi.fn(),
    remove: vi.fn(),
  }),
}))

vi.mock('@/features/workbench/hooks/use-session-artifacts', () => ({
  useSessionArtifacts: () => ({
    items: artifactsState.items,
    count: artifactsState.items.length,
    totalBytes: artifactsState.items.reduce((sum, item) => sum + item.size_bytes, 0),
    pollError: null,
    refresh: vi.fn(),
    remove: vi.fn(),
  }),
}))

// Group FA owns the shared rows; the picker's own job is which row it renders
// and what it does with the selection.
// Partial: the rows are mocked, the shared row-key helper the tree uses is real.
vi.mock('@/components/shared/file-row', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/components/shared/file-row')>()),
  FileRow: ({ name, subtitle, selected, muted, onSelect, onDoubleClick }: RowMockProps) => (
    <button
      type="button"
      data-testid={`mock-file-row-${name}`}
      data-subtitle={subtitle ?? ''}
      data-selected={String(!!selected)}
      data-muted={String(!!muted)}
      onClick={onSelect}
      onDoubleClick={onDoubleClick}
    >
      {name}
    </button>
  ),
}))

vi.mock('@/components/shared/folder-row', () => ({
  FolderRow: ({ name, expanded, selected, onToggle, onSelect, onDoubleClick }: RowMockProps) => (
    <span data-testid={`mock-folder-${name}`}>
      <button
        type="button"
        data-testid={`mock-folder-toggle-${name}`}
        data-expanded={String(!!expanded)}
        onClick={onToggle}
      >
        toggle
      </button>
      <button
        type="button"
        data-testid={`mock-folder-row-${name}`}
        data-selected={String(!!selected)}
        onClick={onSelect}
        onDoubleClick={onDoubleClick}
      >
        {name}
      </button>
    </span>
  ),
}))

type PickerMode = 'file' | 'file-or-folder' | 'folder' | 'save-as'

function renderPicker(
  overrides: {
    mode?: PickerMode
    artifactsOnly?: boolean
    initialValue?: string
    presetName?: string
    testId?: string | null
  } = {},
) {
  const onChoose = vi.fn()
  const onClose = vi.fn()
  render(
    <FileReferencePickerSheet
      open
      label="Script File"
      mode={overrides.mode ?? 'file'}
      artifactsOnly={overrides.artifactsOnly}
      initialValue={overrides.initialValue ?? ''}
      presetName={overrides.presetName}
      testId={overrides.testId === undefined ? 'test-1' : overrides.testId}
      onChoose={onChoose}
      onClose={onClose}
    />,
  )
  return { onChoose, onClose }
}

const reference = () => screen.getByTestId('picker-reference-input')
const primary = () => screen.getByTestId('picker-use-button')

beforeEach(() => {
  artifactsState.items = ARTIFACTS
  testDataState.loading = false
  testDataState.error = null
  vi.clearAllMocks()
})

describe('FileReferencePickerSheet chrome', () => {
  it('registers the sheet under the file-reference-picker id', () => {
    renderPicker()

    let focused = false
    act(() => {
      focused = focusSheet('file-reference-picker')
    })

    expect(focused).toBe(true)
  })

  it('does not start a drag when the pointer lands on Close', () => {
    renderPicker()
    const root = screen.getByTestId('file-reference-picker-sheet')
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Close' }), {
      button: 0,
      pointerId: 1,
      clientX: 100,
      clientY: 100,
    })
    fireEvent.pointerMove(screen.getByTestId('file-reference-picker-sheet-drag-handle'), {
      pointerId: 1,
      clientX: 200,
      clientY: 220,
    })
    expect(root.style.transform).toBe('translate(calc(-50% + 0px), calc(-50% + 0px))')
  })

  it('titles the sheet "Choose a file" in file mode', () => {
    renderPicker({ mode: 'file' })
    expect(screen.getByText('Choose a file')).toBeInTheDocument()
    expect(screen.getByTestId('file-reference-picker')).toHaveAttribute('data-picker-mode', 'file')
  })

  it('titles the sheet "Choose a file or folder" in file-or-folder mode', () => {
    renderPicker({ mode: 'file-or-folder' })
    expect(screen.getByText('Choose a file or folder')).toBeInTheDocument()
    expect(screen.getByTestId('file-reference-picker')).toHaveAttribute(
      'data-picker-mode',
      'file-or-folder',
    )
  })

  it('titles the sheet "Choose a folder" in folder mode', () => {
    renderPicker({ mode: 'folder' })
    expect(screen.getByText('Choose a folder')).toBeInTheDocument()
    expect(screen.getByTestId('file-reference-picker')).toHaveAttribute(
      'data-picker-mode',
      'folder',
    )
  })

  it('titles the sheet "Save as" in save-as mode', () => {
    renderPicker({ mode: 'save-as' })
    expect(screen.getByText('Save as')).toBeInTheDocument()
    expect(screen.getByTestId('file-reference-picker')).toHaveAttribute(
      'data-picker-mode',
      'save-as',
    )
  })
})

describe('FileReferencePickerSheet tabs', () => {
  it('shows Test Data and Artifacts tabs in file mode with Test Data active', () => {
    renderPicker({ mode: 'file' })
    expect(screen.getByTestId('picker-tab-testdata')).toHaveTextContent('Test Data')
    expect(screen.getByTestId('picker-tab-testdata')).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByTestId('picker-tab-artifacts')).toHaveTextContent('Artifacts')
    expect(screen.getByTestId('picker-tab-artifacts')).toHaveAttribute('aria-pressed', 'false')
  })

  it('shows both tabs in file-or-folder mode', () => {
    renderPicker({ mode: 'file-or-folder' })
    expect(screen.getByTestId('picker-tab-testdata')).toBeInTheDocument()
    expect(screen.getByTestId('picker-tab-artifacts')).toBeInTheDocument()
  })

  it('shows both tabs in folder mode', () => {
    renderPicker({ mode: 'folder' })
    expect(screen.getByTestId('picker-tab-testdata')).toBeInTheDocument()
    expect(screen.getByTestId('picker-tab-artifacts')).toBeInTheDocument()
  })

  it('shows no tabs in save-as mode', () => {
    renderPicker({ mode: 'save-as' })
    expect(screen.queryByTestId('picker-tab-testdata')).not.toBeInTheDocument()
    expect(screen.queryByTestId('picker-tab-artifacts')).not.toBeInTheDocument()
    expect(screen.queryByTestId('testdata-browser-mock')).not.toBeInTheDocument()
  })

  it('shows no tabs and no Test Data browser when the field is artifacts-only', () => {
    renderPicker({ mode: 'file-or-folder', artifactsOnly: true })
    expect(screen.queryByTestId('picker-tab-testdata')).not.toBeInTheDocument()
    expect(screen.queryByTestId('picker-tab-artifacts')).not.toBeInTheDocument()
    expect(screen.queryByTestId('testdata-browser-mock')).not.toBeInTheDocument()
    expect(screen.getByTestId('picker-artifacts-list')).toBeInTheDocument()
  })
})

describe('FileReferencePickerSheet Test Data tab', () => {
  it('mounts the browser in pick mode for the open test', () => {
    renderPicker({ mode: 'file', testId: 'test-42' })
    const browser = screen.getByTestId('testdata-browser-mock')
    expect(browser).toHaveAttribute('data-mode', 'pick')
    expect(browser).toHaveAttribute('data-test-id-prop', 'test-42')
  })

  it('makes only files selectable in file mode', () => {
    renderPicker({ mode: 'file' })
    expect(screen.getByTestId('testdata-browser-mock')).toHaveAttribute('data-selectable', 'file')
  })

  it('makes files and folders selectable in file-or-folder mode', () => {
    renderPicker({ mode: 'file-or-folder' })
    expect(screen.getByTestId('testdata-browser-mock')).toHaveAttribute(
      'data-selectable',
      'file-or-folder',
    )
  })

  it('makes only folders selectable in folder mode', () => {
    renderPicker({ mode: 'folder' })
    expect(screen.getByTestId('testdata-browser-mock')).toHaveAttribute('data-selectable', 'folder')
  })

  it('writes the selected file into the Reference as a testdata reference', async () => {
    const user = userEvent.setup()
    renderPicker({ mode: 'file' })
    await user.click(screen.getByTestId('browser-select-file'))
    expect(reference()).toHaveValue('fixtures/users.csv')
  })

  it('marks the selected path on the browser', async () => {
    const user = userEvent.setup()
    renderPicker({ mode: 'file' })
    await user.click(screen.getByTestId('browser-select-file'))
    expect(screen.getByTestId('testdata-browser-mock')).toHaveAttribute(
      'data-selected-path',
      'fixtures/users.csv',
    )
  })

  it('only selects on a single click - it does not choose', async () => {
    const user = userEvent.setup()
    const { onChoose } = renderPicker({ mode: 'file' })
    await user.click(screen.getByTestId('browser-select-file'))
    expect(onChoose).not.toHaveBeenCalled()
  })

  it('chooses the entry the browser reports as chosen', async () => {
    const user = userEvent.setup()
    const { onChoose } = renderPicker({ mode: 'file' })
    await user.click(screen.getByTestId('browser-choose-file'))
    expect(onChoose).toHaveBeenCalledWith('testdata://fixtures/users.csv')
  })

  it('shows the read failure in place of the browser', () => {
    testDataState.error = { message: 'Could not read the test data folder' }
    renderPicker({ mode: 'file' })
    expect(screen.getByTestId('picker-testdata-error')).toHaveTextContent(
      'Could not read the test data folder',
    )
    expect(screen.queryByTestId('testdata-browser-mock')).not.toBeInTheDocument()
  })

  it('shows a loading line while the test data is still being read', () => {
    testDataState.loading = true
    renderPicker({ mode: 'file' })
    expect(screen.getByText('Loading test data\u2026')).toBeInTheDocument()
    expect(screen.queryByTestId('testdata-browser-mock')).not.toBeInTheDocument()
  })

  it('shows the read failure ahead of the loading line', () => {
    testDataState.error = { message: 'Could not read the test data folder' }
    testDataState.loading = true
    renderPicker({ mode: 'file' })
    expect(screen.getByTestId('picker-testdata-error')).toBeInTheDocument()
    expect(screen.queryByText('Loading test data\u2026')).not.toBeInTheDocument()
  })
})

describe('FileReferencePickerSheet Artifacts tab', () => {
  it('lists the session artifacts when the Artifacts tab is picked', async () => {
    const user = userEvent.setup()
    renderPicker({ mode: 'file' })
    await user.click(screen.getByTestId('picker-tab-artifacts'))
    const list = screen.getByTestId('picker-artifacts-list')
    expect(within(list).getByText('result.json')).toBeInTheDocument()
    expect(within(list).getByText('summary.json')).toBeInTheDocument()
  })

  it('presses the Artifacts tab and releases the Test Data tab', async () => {
    const user = userEvent.setup()
    renderPicker({ mode: 'file' })
    await user.click(screen.getByTestId('picker-tab-artifacts'))
    expect(screen.getByTestId('picker-tab-artifacts')).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByTestId('picker-tab-testdata')).toHaveAttribute('aria-pressed', 'false')
    expect(screen.queryByTestId('testdata-browser-mock')).not.toBeInTheDocument()
  })

  it('says a block reads an artifact only after an earlier block wrote it', async () => {
    const user = userEvent.setup()
    renderPicker({ mode: 'file' })
    await user.click(screen.getByTestId('picker-tab-artifacts'))
    expect(screen.getByText("Files in this session's artifacts")).toBeInTheDocument()
    expect(
      screen.getByText('A block can read one only after an earlier block in the same run wrote it.'),
    ).toBeInTheDocument()
  })

  it('shows the empty state when the session wrote nothing', async () => {
    artifactsState.items = []
    const user = userEvent.setup()
    renderPicker({ mode: 'file' })
    await user.click(screen.getByTestId('picker-tab-artifacts'))
    expect(screen.getByTestId('picker-artifacts-empty')).toHaveTextContent(
      'Files this session wrote appear here. Type a path an earlier block writes.',
    )
  })

  it('writes the picked artifact into the Reference as an artifact reference', async () => {
    const user = userEvent.setup()
    renderPicker({ mode: 'file' })
    await user.click(screen.getByTestId('picker-tab-artifacts'))
    await user.click(screen.getByTestId('mock-file-row-summary.json'))
    expect(reference()).toHaveValue('reports/summary.json')
  })

  it('chooses an artifact on a double click', async () => {
    const user = userEvent.setup()
    const { onChoose } = renderPicker({ mode: 'file' })
    await user.click(screen.getByTestId('picker-tab-artifacts'))
    await user.dblClick(screen.getByTestId('mock-file-row-result.json'))
    expect(onChoose).toHaveBeenCalledWith('artifact://result.json')
  })

  it('mutes the artifact files in folder mode and refuses to select them', async () => {
    const user = userEvent.setup()
    renderPicker({ mode: 'folder' })
    await user.click(screen.getByTestId('picker-tab-artifacts'))
    const file = screen.getByTestId('mock-file-row-result.json')
    expect(file).toHaveAttribute('data-muted', 'true')
    await user.click(file)
    expect(reference()).toHaveValue('')
  })

  it('chooses a folder on a double click in folder mode', async () => {
    const user = userEvent.setup()
    const { onChoose } = renderPicker({ mode: 'folder' })
    await user.click(screen.getByTestId('picker-tab-artifacts'))
    await user.dblClick(screen.getByTestId('mock-folder-row-reports'))
    expect(onChoose).toHaveBeenCalledWith('artifact://reports')
  })

  it('starts with the folders open', async () => {
    const user = userEvent.setup()
    renderPicker({ mode: 'file' })
    await user.click(screen.getByTestId('picker-tab-artifacts'))
    expect(screen.getByTestId('mock-folder-toggle-reports')).toHaveAttribute(
      'data-expanded',
      'true',
    )
    expect(screen.getByTestId('mock-file-row-summary.json')).toBeInTheDocument()
  })

  it('hides the files under a folder that is collapsed', async () => {
    const user = userEvent.setup()
    renderPicker({ mode: 'file' })
    await user.click(screen.getByTestId('picker-tab-artifacts'))
    await user.click(screen.getByTestId('mock-folder-toggle-reports'))
    expect(screen.getByTestId('mock-folder-toggle-reports')).toHaveAttribute(
      'data-expanded',
      'false',
    )
    expect(screen.queryByTestId('mock-file-row-summary.json')).not.toBeInTheDocument()
    expect(screen.getByTestId('mock-file-row-result.json')).toBeInTheDocument()
  })

  it('brings the files back when the folder is opened again', async () => {
    const user = userEvent.setup()
    renderPicker({ mode: 'file' })
    await user.click(screen.getByTestId('picker-tab-artifacts'))
    await user.click(screen.getByTestId('mock-folder-toggle-reports'))
    await user.click(screen.getByTestId('mock-folder-toggle-reports'))
    expect(screen.getByTestId('mock-folder-toggle-reports')).toHaveAttribute(
      'data-expanded',
      'true',
    )
    expect(screen.getByTestId('mock-file-row-summary.json')).toBeInTheDocument()
  })
})

describe('FileReferencePickerSheet Enter on the artifacts list', () => {
  const artifactsList = () => screen.getByTestId('picker-artifacts-list')

  it('chooses the selected artifact', async () => {
    const user = userEvent.setup()
    const { onChoose } = renderPicker({ mode: 'file' })
    await user.click(screen.getByTestId('picker-tab-artifacts'))
    await user.click(screen.getByTestId('mock-file-row-result.json'))
    fireEvent.keyDown(artifactsList(), { key: 'Enter' })
    expect(onChoose).toHaveBeenCalledWith('artifact://result.json')
  })

  it('does nothing while nothing is selected', async () => {
    const user = userEvent.setup()
    const { onChoose } = renderPicker({ mode: 'file' })
    await user.click(screen.getByTestId('picker-tab-artifacts'))
    fireEvent.keyDown(artifactsList(), { key: 'Enter' })
    expect(onChoose).not.toHaveBeenCalled()
  })

  it('does nothing on any other key', async () => {
    const user = userEvent.setup()
    const { onChoose } = renderPicker({ mode: 'file' })
    await user.click(screen.getByTestId('picker-tab-artifacts'))
    await user.click(screen.getByTestId('mock-file-row-result.json'))
    fireEvent.keyDown(artifactsList(), { key: 'a' })
    expect(onChoose).not.toHaveBeenCalled()
  })

  it('does nothing when the selection came from the Test Data tab', async () => {
    const user = userEvent.setup()
    const { onChoose } = renderPicker({ mode: 'file' })
    await user.click(screen.getByTestId('browser-select-file'))
    await user.click(screen.getByTestId('picker-tab-artifacts'))
    fireEvent.keyDown(artifactsList(), { key: 'Enter' })
    expect(onChoose).not.toHaveBeenCalled()
  })

  it('does not choose a folder in save-as mode', async () => {
    const user = userEvent.setup()
    const { onChoose } = renderPicker({ mode: 'save-as' })
    await user.click(screen.getByTestId('mock-folder-row-reports'))
    fireEvent.keyDown(artifactsList(), { key: 'Enter' })
    expect(onChoose).not.toHaveBeenCalled()
  })
})

describe('FileReferencePickerSheet Enter on an artifact row', () => {
  const artifactRow = (path: string) => {
    const row = screen
      .getAllByTestId('picker-artifact-row')
      .find((element) => element.dataset.path === path)
    if (!row) throw new Error(`no artifact row for ${path}`)
    return row
  }

  it('chooses the focused file row without a prior click', async () => {
    const user = userEvent.setup()
    const { onChoose } = renderPicker({ mode: 'file' })
    await user.click(screen.getByTestId('picker-tab-artifacts'))
    fireEvent.keyDown(artifactRow('result.json'), { key: 'Enter' })
    expect(onChoose).toHaveBeenCalledWith('artifact://result.json')
  })

  it('chooses the focused folder row without a prior click', async () => {
    const user = userEvent.setup()
    const { onChoose } = renderPicker({ mode: 'folder' })
    await user.click(screen.getByTestId('picker-tab-artifacts'))
    fireEvent.keyDown(artifactRow('reports'), { key: 'Enter' })
    expect(onChoose).toHaveBeenCalledWith('artifact://reports')
  })

  it('ignores Enter on a row the mode cannot select', async () => {
    const user = userEvent.setup()
    const { onChoose } = renderPicker({ mode: 'folder' })
    await user.click(screen.getByTestId('picker-tab-artifacts'))
    fireEvent.keyDown(artifactRow('result.json'), { key: 'Enter' })
    expect(onChoose).not.toHaveBeenCalled()
  })

  it('ignores any other key on a row', async () => {
    const user = userEvent.setup()
    const { onChoose } = renderPicker({ mode: 'file' })
    await user.click(screen.getByTestId('picker-tab-artifacts'))
    fireEvent.keyDown(artifactRow('result.json'), { key: 'a' })
    expect(onChoose).not.toHaveBeenCalled()
  })

  it('keeps a nested row Enter from reaching the folder above it', async () => {
    const user = userEvent.setup()
    const { onChoose } = renderPicker({ mode: 'file-or-folder' })
    await user.click(screen.getByTestId('picker-tab-artifacts'))
    fireEvent.keyDown(artifactRow('reports/summary.json'), { key: 'Enter' })
    expect(onChoose).toHaveBeenCalledTimes(1)
    expect(onChoose).toHaveBeenCalledWith('artifact://reports/summary.json')
  })
})

describe('FileReferencePickerSheet save-as mode', () => {
  it('lists the session artifacts under the save-as hint', () => {
    renderPicker({ mode: 'save-as' })
    expect(screen.getByText("Folders and files in this session's artifacts")).toBeInTheDocument()
    expect(screen.getByTestId('picker-artifacts-list')).toBeInTheDocument()
  })

  it('presets the Name field from presetName and caps it at 255 characters', () => {
    renderPicker({ mode: 'save-as', presetName: 'users.csv' })
    const name = screen.getByTestId('picker-name-input')
    expect(name).toHaveValue('users.csv')
    expect(name).toHaveAttribute('maxlength', '255')
  })

  it('keeps the Name when a folder is picked and composes the Reference', async () => {
    const user = userEvent.setup()
    renderPicker({ mode: 'save-as', presetName: 'users.csv' })
    await user.click(screen.getByTestId('mock-folder-row-reports'))
    expect(screen.getByTestId('picker-name-input')).toHaveValue('users.csv')
    expect(reference()).toHaveValue('reports/users.csv')
  })

  it('takes the file name when a file is picked', async () => {
    const user = userEvent.setup()
    renderPicker({ mode: 'save-as', presetName: 'users.csv' })
    await user.click(screen.getByTestId('mock-file-row-result.json'))
    expect(screen.getByTestId('picker-name-input')).toHaveValue('result.json')
    expect(reference()).toHaveValue('result.json')
  })

  it('recomposes the Reference when the Name is edited', async () => {
    const user = userEvent.setup()
    renderPicker({ mode: 'save-as', presetName: 'users.csv' })
    await user.click(screen.getByTestId('mock-folder-row-reports'))
    await user.clear(screen.getByTestId('picker-name-input'))
    await user.type(screen.getByTestId('picker-name-input'), 'out.csv')
    expect(reference()).toHaveValue('reports/out.csv')
  })

  it('disables Select while the Reference carries no name', async () => {
    const user = userEvent.setup()
    renderPicker({ mode: 'save-as', presetName: 'users.csv' })
    await user.click(screen.getByTestId('mock-folder-row-reports'))
    await user.clear(screen.getByTestId('picker-name-input'))
    expect(primary()).toBeDisabled()
  })

  it('does not choose a folder on a double click', async () => {
    const user = userEvent.setup()
    const { onChoose } = renderPicker({ mode: 'save-as' })
    await user.dblClick(screen.getByTestId('mock-folder-row-reports'))
    expect(onChoose).not.toHaveBeenCalled()
  })

  it('treats a bare Reference as an artifact path when the Name is edited', async () => {
    const user = userEvent.setup()
    renderPicker({ mode: 'save-as' })
    await user.type(reference(), 'out.csv')
    expect(screen.getByTestId('picker-name-input')).toHaveValue('out.csv')
    await user.clear(screen.getByTestId('picker-name-input'))
    await user.type(screen.getByTestId('picker-name-input'), 'final.csv')
    expect(reference()).toHaveValue('final.csv')
  })

  it('seeds the Name from the reference the row already holds', () => {
    renderPicker({ mode: 'save-as', initialValue: 'artifact://reports/out.csv' })
    expect(screen.getByTestId('picker-name-input')).toHaveValue('out.csv')
    expect(reference()).toHaveValue('reports/out.csv')
  })

  it('keeps the folder of the row value when the Name is edited', async () => {
    const user = userEvent.setup()
    renderPicker({ mode: 'save-as', initialValue: 'artifact://reports/out.csv' })
    await user.clear(screen.getByTestId('picker-name-input'))
    await user.type(screen.getByTestId('picker-name-input'), 'final.csv')
    expect(reference()).toHaveValue('reports/final.csv')
  })

  it('falls back to the preset Name when the row value names no file', () => {
    renderPicker({ mode: 'save-as', initialValue: 'artifact://reports/', presetName: 'users.csv' })
    expect(screen.getByTestId('picker-name-input')).toHaveValue('users.csv')
    expect(reference()).toHaveValue('reports/')
  })

  it('leaves the Name empty when neither the row value nor a preset names a file', () => {
    renderPicker({ mode: 'save-as', initialValue: 'artifact://' })
    expect(screen.getByTestId('picker-name-input')).toHaveValue('')
    expect(reference()).toHaveValue('')
  })
})

describe('FileReferencePickerSheet Reference line', () => {
  it('seeds the Reference from the row value', () => {
    renderPicker({ mode: 'file', initialValue: 'testdata://fixtures/orders.json' })
    expect(reference()).toHaveValue('fixtures/orders.json')
  })

  it('renders the Reference in a mono font', () => {
    renderPicker({ mode: 'file' })
    expect(reference().className).toContain('font-mono')
  })

  it.each<PickerMode>(['file', 'file-or-folder', 'folder', 'save-as'])(
    'lets the Reference be typed in %s mode',
    async (mode) => {
      const user = userEvent.setup()
      renderPicker({ mode })
      await user.clear(reference())
      await user.type(reference(), '/srv/data/in.csv')
      expect(reference()).toHaveValue('/srv/data/in.csv')
    },
  )

  it('labels the Reference line', () => {
    renderPicker({ mode: 'file' })
    expect(screen.getByText('Reference')).toBeInTheDocument()
  })
})

describe('FileReferencePickerSheet Reference scheme', () => {
  const scheme = () => screen.getByTestId('picker-reference-scheme')

  it('puts testdata:// in front of the path on the Test Data tab', () => {
    renderPicker({ mode: 'file', initialValue: 'testdata://fixtures/orders.json' })
    expect(scheme()).toHaveTextContent(/^testdata:\/\/$/)
    expect(reference()).toHaveValue('fixtures/orders.json')
  })

  it('keeps the scheme out of page translation and reads it with the path', () => {
    renderPicker({ mode: 'file' })
    expect(scheme()).toHaveAttribute('translate', 'no')
    expect(reference()).toHaveAccessibleDescription('testdata://')
  })

  it('draws one focus ring around the scheme and the path together', () => {
    renderPicker({ mode: 'file' })
    expect(scheme().parentElement).toHaveClass('focus-within:ring-1', 'focus-within:ring-ring')
    expect(reference()).toHaveClass('focus-visible:ring-0')
  })

  it('puts artifact:// in front of the path on the Artifacts tab', async () => {
    const user = userEvent.setup()
    renderPicker({ mode: 'file' })
    await user.click(screen.getByTestId('picker-tab-artifacts'))
    expect(scheme()).toHaveTextContent(/^artifact:\/\/$/)
  })

  it.each([
    ['save-as', false],
    ['file-or-folder', true],
  ] as const)('puts artifact:// in front of the path in %s mode (artifacts-only %s)', (mode, artifactsOnly) => {
    renderPicker({ mode, artifactsOnly })
    expect(scheme()).toHaveTextContent(/^artifact:\/\/$/)
  })

  it('opens on the Artifacts tab with its path when the row holds an artifact', () => {
    renderPicker({ mode: 'file', initialValue: 'artifact://reports/summary.json' })
    expect(screen.getByTestId('picker-tab-artifacts')).toHaveAttribute('aria-pressed', 'true')
    expect(scheme()).toHaveTextContent(/^artifact:\/\/$/)
    expect(reference()).toHaveValue('reports/summary.json')
  })

  it('hands back the scheme with the typed path', async () => {
    const user = userEvent.setup()
    const { onChoose } = renderPicker({ mode: 'file', initialValue: 'testdata://a.csv' })
    await user.clear(reference())
    await user.type(reference(), 'fixtures/in.csv')
    await user.click(primary())
    expect(onChoose).toHaveBeenCalledWith('testdata://fixtures/in.csv')
  })

  it('opens with an empty path, and Select disabled, when the row value is under neither scheme', () => {
    renderPicker({ mode: 'file', initialValue: '/srv/data/in.csv' })
    expect(scheme()).toHaveTextContent(/^testdata:\/\/$/)
    expect(reference()).toHaveValue('')
    expect(primary()).toBeDisabled()
  })

  it("keeps each tab's own path and hands back the tab in front", async () => {
    const user = userEvent.setup()
    const { onChoose } = renderPicker({ mode: 'file' })
    await user.click(screen.getByTestId('browser-select-file'))
    await user.click(screen.getByTestId('picker-tab-artifacts'))
    expect(reference()).toHaveValue('')
    expect(primary()).toBeDisabled()
    await user.click(screen.getByTestId('mock-file-row-result.json'))
    await user.click(screen.getByTestId('picker-tab-testdata'))
    expect(reference()).toHaveValue('fixtures/users.csv')
    await user.click(screen.getByTestId('picker-tab-artifacts'))
    await user.click(primary())
    expect(onChoose).toHaveBeenCalledWith('artifact://result.json')
  })

  it('reports no changes to the parent when only the other tab is looked at', async () => {
    const user = userEvent.setup()
    render(
      <ChildEditorParent>
        <FileReferencePickerSheet
          open
          label="Script File"
          mode="file"
          initialValue="testdata://a.csv"
          testId="test-1"
          onChoose={vi.fn()}
          onClose={vi.fn()}
        />
      </ChildEditorParent>,
    )
    await user.click(screen.getByTestId('picker-tab-artifacts'))
    expect(parentChildren()).toEqual([{ label: 'Script File', hasChanges: false, cannotBeSaved: true }])
  })
})

describe('FileReferencePickerSheet primary and cancel', () => {
  it.each(['file', 'folder', 'save-as', 'file-or-folder'] as const)(
    'reads Select in %s mode',
    (mode) => {
      renderPicker({ mode })
      expect(primary()).toHaveTextContent('Select')
    }
  )

  it('keeps reading Select whatever the selection is', async () => {
    const user = userEvent.setup()
    renderPicker({ mode: 'file-or-folder' })
    await user.click(screen.getByTestId('browser-select-file'))
    expect(primary()).toHaveTextContent('Select')
    await user.click(screen.getByTestId('browser-select-folder'))
    expect(primary()).toHaveTextContent('Select')
  })

  it('stays disabled while the Reference is empty', () => {
    renderPicker({ mode: 'file', initialValue: '' })
    expect(primary()).toBeDisabled()
  })

  it('enables once the Reference has a value', async () => {
    const user = userEvent.setup()
    renderPicker({ mode: 'file', initialValue: '' })
    await user.type(reference(), '/srv/data/in.csv')
    expect(primary()).toBeEnabled()
  })

  it('hands the Reference back when the primary is pressed', async () => {
    const user = userEvent.setup()
    const { onChoose } = renderPicker({ mode: 'file', initialValue: 'testdata://a.csv' })
    await user.click(primary())
    expect(onChoose).toHaveBeenCalledWith('testdata://a.csv')
  })

  it('closes once the chosen Reference is handed back', async () => {
    const user = userEvent.setup()
    const { onChoose, onClose } = renderPicker({ mode: 'file', initialValue: 'testdata://a.csv' })
    await user.click(primary())
    expect(onChoose).toHaveBeenCalledTimes(1)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('confirms on Enter in the Reference field', async () => {
    const user = userEvent.setup()
    const { onChoose } = renderPicker({ mode: 'file', initialValue: 'testdata://a.csv' })
    await user.type(reference(), '{Enter}')
    expect(onChoose).toHaveBeenCalledWith('testdata://a.csv')
  })

  it('closes on Cancel without choosing', async () => {
    const user = userEvent.setup()
    const { onChoose, onClose } = renderPicker({ mode: 'file', initialValue: 'testdata://a.csv' })
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(onChoose).not.toHaveBeenCalled()
  })
})

describe('FileReferencePickerSheet - the parent it was opened from', () => {
  function renderInParent(overrides: { mode?: PickerMode; initialValue?: string; presetName?: string } = {}) {
    const onChoose = vi.fn()
    const onClose = vi.fn()
    render(
      <ChildEditorParent>
        <FileReferencePickerSheet
          open
          label="Working Directory"
          mode={overrides.mode ?? 'file'}
          initialValue={overrides.initialValue ?? 'testdata://a.csv'}
          presetName={overrides.presetName}
          testId="test-1"
          onChoose={onChoose}
          onClose={onClose}
        />
      </ChildEditorParent>,
    )
    return { onChoose, onClose }
  }

  it('reports nothing while it is closed', () => {
    const onChoose = vi.fn()
    render(
      <ChildEditorParent>
        <FileReferencePickerSheet
          open={false}
          label="Working Directory"
          mode="file"
          initialValue="testdata://a.csv"
          testId="test-1"
          onChoose={onChoose}
          onClose={vi.fn()}
        />
      </ChildEditorParent>,
    )
    expect(parentChildren()).toEqual([])
  })

  it('reports its row label with no changes while the Reference is the one it opened with', () => {
    renderInParent()
    expect(parentChildren()).toEqual([
      { label: 'Working Directory', hasChanges: false, cannotBeSaved: false },
    ])
  })

  it('reports no changes for a save-as Reference seeded from the preset name', () => {
    renderInParent({ mode: 'save-as', initialValue: '', presetName: 'report.csv' })
    expect(parentChildren()).toEqual([
      { label: 'Working Directory', hasChanges: false, cannotBeSaved: false },
    ])
  })

  it('reports changes once a row is selected', async () => {
    const user = userEvent.setup()
    renderInParent()
    await user.click(screen.getByTestId('browser-select-file'))
    expect(parentChildren()).toEqual([
      { label: 'Working Directory', hasChanges: true, cannotBeSaved: false },
    ])
  })

  it('reports changes it cannot save once the Reference is cleared', async () => {
    const user = userEvent.setup()
    renderInParent()
    await user.clear(reference())
    expect(parentChildren()).toEqual([
      { label: 'Working Directory', hasChanges: true, cannotBeSaved: true },
    ])
  })

  it('lets the parent write the Reference without closing', async () => {
    const user = userEvent.setup()
    const { onChoose, onClose } = renderInParent()
    await user.clear(reference())
    await user.type(reference(), 'in.csv')

    act(() => applyParentChildren())

    expect(onChoose).toHaveBeenCalledExactlyOnceWith('testdata://in.csv')
    expect(onClose).not.toHaveBeenCalled()
  })
})
