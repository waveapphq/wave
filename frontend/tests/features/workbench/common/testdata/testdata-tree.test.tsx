/**
 * TestDataTree - the recursive rows the browser renders.
 *
 * Module: frontend/src/features/workbench/common/testdata/testdata-tree.tsx
 *
 * Folders are the shared FolderRow, files the shared FileRow, nested by depth
 * with no section header above them. Manage mode carries Copy path, Download
 * and the kebab on every row. Pick mode carries the selection rule the picker
 * asked for: files only, folders only (files stay visible but muted), or both.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ComponentProps } from 'react'
import { TestDataTree } from '@/features/workbench/common/testdata/testdata-tree'
import type { TestDataUpload } from '@/features/workbench/common/testdata/use-testdata'
import type { TestDataNode } from '@/features/workbench/common/testdata/testdata-entries'
import type { TestDataEntry } from '@/features/tests/api/types'
import { clipboardMock } from '../../../../setup'

const MODIFIED = '2026-09-01T10:00:00+00:00'

function entry(path: string, kind: 'file' | 'dir', sizeBytes: number): TestDataEntry {
  return { path, kind, size_bytes: sizeBytes, modified_at: MODIFIED }
}

function fileNode(path: string, sizeBytes: number): TestDataNode {
  return {
    name: path.slice(path.lastIndexOf('/') + 1),
    path,
    kind: 'file',
    children: [],
    entry: entry(path, 'file', sizeBytes),
    sizeBytes,
  }
}

function folderNode(path: string, children: TestDataNode[]): TestDataNode {
  return {
    name: path.slice(path.lastIndexOf('/') + 1),
    path,
    kind: 'dir',
    children,
    entry: entry(path, 'dir', 0),
    sizeBytes: children.reduce((total, child) => total + child.sizeBytes, 0),
  }
}

const NODES: TestDataNode[] = [
  folderNode('fixtures', [
    fileNode('fixtures/orders.json', 4_198),
    fileNode('fixtures/users.csv', 18_432),
  ]),
  folderNode('payloads', [fileNode('payloads/big.bin', 98_304)]),
  fileNode('schema.xsd', 2_355),
]

const DEEP_NODES: TestDataNode[] = [
  folderNode('a', [folderNode('a/b', [fileNode('a/b/deep.txt', 12)])]),
]

const EMPTY_FOLDER_NODES: TestDataNode[] = [folderNode('scratch', []), fileNode('schema.xsd', 12)]

type TreeProps = ComponentProps<typeof TestDataTree>

function renderTree(props: Partial<TreeProps> = {}) {
  const handlers = {
    onSelect: vi.fn(),
    onChoose: vi.fn(),
    onDownload: vi.fn(),
    onRename: vi.fn(),
    onDelete: vi.fn(),
  }
  render(<TestDataTree nodes={NODES} mode="manage" {...handlers} {...props} />)
  return handlers
}

function row(name: string): HTMLElement {
  return screen.getByText(name).closest('[data-testid="testdata-row"]') as HTMLElement
}

function chevron(name: string): HTMLElement {
  return row(name).querySelector('[aria-expanded]') as HTMLElement
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('TestDataTree - rendering', () => {
  it('renders a row per node, typed folder or file', () => {
    renderTree()

    expect(row('fixtures')).toHaveAttribute('data-entry-type', 'dir')
    expect(row('schema.xsd')).toHaveAttribute('data-entry-type', 'file')
    expect(screen.getAllByTestId('testdata-row')).toHaveLength(6)
  })

  it('renders every level of a nested tree', () => {
    renderTree({ nodes: DEEP_NODES })

    expect(row('a')).toBeInTheDocument()
    expect(row('b')).toBeInTheDocument()
    expect(row('deep.txt')).toBeInTheDocument()
  })

  it('shows the aggregate size on a folder row', () => {
    renderTree()

    expect(screen.getByText('22.1 KB')).toBeInTheDocument()
  })

  it('shows no section header above the rows', () => {
    renderTree()

    expect(screen.queryByRole('heading')).not.toBeInTheDocument()
  })
})

describe('TestDataTree - collapsing folders', () => {
  it('starts expanded and reports it on the chevron', () => {
    renderTree()

    expect(chevron('fixtures')).toHaveAttribute('aria-expanded', 'true')
    expect(row('users.csv')).toBeInTheDocument()
  })

  it('hides the children when the folder collapses', async () => {
    const user = userEvent.setup()
    renderTree()

    await user.click(chevron('fixtures'))

    expect(screen.queryByText('users.csv')).not.toBeInTheDocument()
    expect(chevron('fixtures')).toHaveAttribute('aria-expanded', 'false')
  })

  it('shows them again when it expands', async () => {
    const user = userEvent.setup()
    renderTree()

    await user.click(chevron('fixtures'))
    await user.click(chevron('fixtures'))

    expect(screen.getByText('users.csv')).toBeInTheDocument()
  })

  it('toggles a folder on Enter in manage mode', () => {
    renderTree()

    fireEvent.keyDown(row('fixtures'), { key: 'Enter' })

    expect(screen.queryByText('users.csv')).not.toBeInTheDocument()
  })
})

describe('TestDataTree - manage mode row actions', () => {
  it('carries Copy path, Download and the kebab on a file row', () => {
    renderTree()

    expect(screen.getByRole('button', { name: 'Copy path of users.csv' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Download users.csv' })).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'More actions for users.csv' })
    ).toBeInTheDocument()
  })

  it('carries the same three actions on a folder row', () => {
    renderTree()

    expect(screen.getByRole('button', { name: 'Copy path of payloads' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Download payloads' })).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'More actions for payloads' })
    ).toBeInTheDocument()
  })

  it('copies the testdata reference of the row', async () => {
    renderTree()

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Copy path of users.csv' }))
    })

    expect(clipboardMock.writeText).toHaveBeenCalledWith('testdata://fixtures/users.csv')
  })

  it('reports a download with the node', async () => {
    const user = userEvent.setup()
    const handlers = renderTree()

    await user.click(screen.getByRole('button', { name: 'Download users.csv' }))

    expect(handlers.onDownload).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'fixtures/users.csv' })
    )
  })

  it('reports Rename and Delete from the kebab', async () => {
    const user = userEvent.setup()
    const handlers = renderTree()

    await user.click(screen.getByRole('button', { name: 'More actions for users.csv' }))
    await user.click(screen.getByRole('menuitem', { name: 'Rename' }))
    expect(handlers.onRename).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'fixtures/users.csv' })
    )

    await user.click(screen.getByRole('button', { name: 'More actions for users.csv' }))
    await user.click(screen.getByRole('menuitem', { name: 'Delete' }))
    expect(handlers.onDelete).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'fixtures/users.csv' })
    )
  })

  it('selects the file the user clicks', async () => {
    const user = userEvent.setup()
    const handlers = renderTree()

    await user.click(screen.getByText('users.csv'))

    expect(handlers.onSelect).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'fixtures/users.csv' })
    )
  })

  it('marks the selected file row', () => {
    renderTree({ selectedPath: 'fixtures/users.csv' })

    expect(row('users.csv')).toHaveAttribute('data-selected', 'true')
  })

  it('selects the folder the user clicks without collapsing it', async () => {
    const user = userEvent.setup()
    const handlers = renderTree()

    await user.click(screen.getByText('fixtures'))

    expect(handlers.onSelect).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'fixtures' })
    )
    expect(screen.getByText('users.csv')).toBeInTheDocument()
  })
})

describe('TestDataTree - read only manage mode', () => {
  it('keeps Copy path and Download on a file row and drops the kebab', () => {
    renderTree({ readOnly: true })

    expect(screen.getByRole('button', { name: 'Copy path of users.csv' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Download users.csv' })).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'More actions for users.csv' })
    ).not.toBeInTheDocument()
  })

  it('keeps the same two reads on a folder row and drops the kebab', () => {
    renderTree({ readOnly: true })

    expect(screen.getByRole('button', { name: 'Copy path of payloads' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Download payloads' })).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'More actions for payloads' })
    ).not.toBeInTheDocument()
  })
})

describe('TestDataTree - pick mode selectability', () => {
  it('makes only files selectable in file mode', async () => {
    const user = userEvent.setup()
    const handlers = renderTree({ mode: 'pick', selectable: 'file' })

    await user.click(screen.getByText('users.csv'))
    expect(handlers.onSelect).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'fixtures/users.csv' })
    )

    handlers.onSelect.mockClear()
    await user.click(screen.getByText('payloads'))
    expect(handlers.onSelect).not.toHaveBeenCalled()
  })

  it('makes only folders selectable in folder mode and mutes the files', async () => {
    const user = userEvent.setup()
    const handlers = renderTree({ mode: 'pick', selectable: 'folder' })

    const muted = row('users.csv').querySelector('[data-testid="file-row"]')
    expect(muted).toHaveAttribute('data-muted', 'true')
    expect(muted).toHaveAttribute('aria-disabled', 'true')

    await user.click(screen.getByText('users.csv'))
    expect(handlers.onSelect).not.toHaveBeenCalled()

    await user.click(screen.getByText('payloads'))
    expect(handlers.onSelect).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'payloads' })
    )
  })

  it('makes both selectable in file-or-folder mode', async () => {
    const user = userEvent.setup()
    const handlers = renderTree({ mode: 'pick', selectable: 'file-or-folder' })

    await user.click(screen.getByText('users.csv'))
    await user.click(screen.getByText('payloads'))

    expect(handlers.onSelect).toHaveBeenCalledTimes(2)
    expect(document.querySelector('[data-muted="true"]')).toBeNull()
  })

  it('carries no row actions in pick mode', () => {
    renderTree({ mode: 'pick', selectable: 'file' })

    expect(screen.queryByRole('button', { name: /^More actions for/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Download / })).not.toBeInTheDocument()
  })
})

describe('TestDataTree - selection marker', () => {
  it('marks exactly one row as selected', () => {
    renderTree({ mode: 'pick', selectable: 'file', selectedPath: 'fixtures/users.csv' })

    const selected = screen
      .getAllByTestId('testdata-row')
      .filter((element) => element.getAttribute('data-selected') === 'true')

    expect(selected).toHaveLength(1)
    expect(selected[0]).toHaveTextContent('users.csv')
  })

  it('marks nothing when no path is selected', () => {
    renderTree({ mode: 'pick', selectable: 'file' })

    expect(document.querySelector('[data-selected="true"]')).toBeNull()
  })
})

describe('TestDataTree - keyboard and double click', () => {
  it('chooses a selectable row on Enter in pick mode', () => {
    const handlers = renderTree({ mode: 'pick', selectable: 'file' })

    fireEvent.keyDown(row('users.csv'), { key: 'Enter' })

    expect(handlers.onChoose).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'fixtures/users.csv' })
    )
  })

  it('selects a folder on Enter in folder mode instead of toggling it', () => {
    const handlers = renderTree({ mode: 'pick', selectable: 'folder' })

    fireEvent.keyDown(row('payloads'), { key: 'Enter' })

    expect(handlers.onSelect).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'payloads' })
    )
    expect(handlers.onChoose).not.toHaveBeenCalled()
  })

  it('leaves a muted row inert on Enter', () => {
    const handlers = renderTree({ mode: 'pick', selectable: 'folder' })

    fireEvent.keyDown(row('users.csv'), { key: 'Enter' })

    expect(handlers.onSelect).not.toHaveBeenCalled()
    expect(handlers.onChoose).not.toHaveBeenCalled()
  })

  it('chooses the row the user double clicks', async () => {
    const user = userEvent.setup()
    const handlers = renderTree({ mode: 'pick', selectable: 'file' })

    await user.dblClick(screen.getByText('users.csv'))

    expect(handlers.onChoose).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'fixtures/users.csv' })
    )
  })

  it('leaves a folder inert on a double click in file mode', async () => {
    const user = userEvent.setup()
    const handlers = renderTree({ mode: 'pick', selectable: 'file' })

    await user.dblClick(screen.getByText('payloads'))

    expect(handlers.onChoose).not.toHaveBeenCalled()
    expect(handlers.onSelect).not.toHaveBeenCalled()
  })

  it('leaves every other key to the row', () => {
    const handlers = renderTree({ mode: 'pick', selectable: 'file' })

    fireEvent.keyDown(row('users.csv'), { key: ' ' })

    expect(handlers.onChoose).not.toHaveBeenCalled()
    expect(handlers.onSelect).not.toHaveBeenCalled()
  })
})

describe('TestDataTree - empty folders', () => {
  it('says the folder is empty instead of showing a chevron over nothing', () => {
    renderTree({ nodes: EMPTY_FOLDER_NODES })

    expect(screen.getByTestId('testdata-empty-folder')).toHaveTextContent('Empty folder')
  })

  it('indents the line under the folder that owns it', () => {
    renderTree({ nodes: EMPTY_FOLDER_NODES })

    expect(screen.getByTestId('testdata-empty-folder')).toHaveStyle({ paddingLeft: '2.25rem' })
  })

  it('drops the line when the folder collapses', async () => {
    const user = userEvent.setup()
    renderTree({ nodes: EMPTY_FOLDER_NODES })

    await user.click(chevron('scratch'))

    expect(screen.queryByTestId('testdata-empty-folder')).not.toBeInTheDocument()
  })

  it('shows nothing of the kind for a folder that holds files', () => {
    renderTree()

    expect(screen.queryByTestId('testdata-empty-folder')).not.toBeInTheDocument()
  })

  it('counts as no entry row, so nothing selects it', () => {
    renderTree({ nodes: EMPTY_FOLDER_NODES })

    expect(screen.getAllByTestId('testdata-row')).toHaveLength(2)
  })
})

/** One file on its way into `folder`, or stopped there. */
function pending(
  name: string,
  folder: string,
  overrides: Partial<TestDataUpload> = {}
): TestDataUpload {
  return {
    id: name,
    name,
    folder,
    path: folder ? `${folder}/${name}` : name,
    loaded: 0,
    total: 1_000,
    eta: null,
    startedAt: Date.now(),
    status: 'uploading',
    failure: null,
    retry: null,
    chooseFile: null,
    cancel: null,
    dismiss: vi.fn(),
    ...overrides,
  }
}

function uploadRow(name: string): HTMLElement {
  return screen.getByTestId(`testdata-upload-${name}`)
}

describe('TestDataTree - where a file being uploaded sits (TDATA-14)', () => {
  it('puts the row inside the folder the file is going to', () => {
    renderTree({ uploads: [pending('big.bin', 'payloads')] })

    const folder = row('payloads')
    expect(folder).toContainElement(uploadRow('big.bin'))
    expect(uploadRow('big.bin')).toHaveAttribute('data-upload-folder', 'payloads')
  })

  it('indents it like the entries beside it', () => {
    renderTree({ uploads: [pending('big.bin', 'payloads')] })

    expect(uploadRow('big.bin')).toHaveStyle({ paddingLeft: '2.25rem' })
  })

  it('puts a file bound for the root at the top level, outside every folder', () => {
    renderTree({ uploads: [pending('schema2.xsd', '')] })

    expect(row('fixtures')).not.toContainElement(uploadRow('schema2.xsd'))
    expect(row('payloads')).not.toContainElement(uploadRow('schema2.xsd'))
    expect(uploadRow('schema2.xsd')).toHaveStyle({ paddingLeft: '1rem' })
  })

  it('falls back to the root rather than losing a row whose folder is not shown', () => {
    renderTree({ uploads: [pending('ghost.bin', 'not-listed')] })

    expect(uploadRow('ghost.bin')).toBeInTheDocument()
    expect(row('fixtures')).not.toContainElement(uploadRow('ghost.bin'))
  })

  it('opens a folder the person had closed while a file is arriving into it', async () => {
    const user = userEvent.setup()
    renderTree({ uploads: [pending('big.bin', 'payloads')] })

    await user.click(chevron('payloads'))

    expect(uploadRow('big.bin')).toBeInTheDocument()
  })

  it('lets a folder stay closed over a file that only did not land', async () => {
    const user = userEvent.setup()
    renderTree({
      uploads: [pending('big.bin', 'payloads', { status: 'interrupted', failure: 'no room' })],
    })

    await user.click(chevron('payloads'))

    expect(screen.queryByTestId('testdata-upload-big.bin')).not.toBeInTheDocument()
  })

  it('shows the arriving file instead of the empty-folder line', () => {
    renderTree({ nodes: EMPTY_FOLDER_NODES, uploads: [pending('big.bin', 'scratch')] })

    expect(screen.queryByTestId('testdata-empty-folder')).not.toBeInTheDocument()
    expect(row('scratch')).toContainElement(uploadRow('big.bin'))
  })

  it('keeps the empty-folder line for a folder nothing is arriving into', () => {
    renderTree({ nodes: EMPTY_FOLDER_NODES, uploads: [pending('big.bin', '')] })

    expect(screen.getByTestId('testdata-empty-folder')).toBeInTheDocument()
  })
})
